"""
Elemental Query Server client + tool logic.

This module is the testable core of the `elemental-query` MCP server. It
talks to the Lovelace Query Server (Elemental REST) through the per-tenant
Portal Gateway and exposes a small, navigable surface that mirrors the
Elemental API: schema discovery, entity resolution, search, retrieval, and
graph traversal.

It is kept transport-agnostic on purpose — `server.py` wraps these
functions with FastMCP `@mcp.tool()` decorators, but you can also import and
call them directly (that's how the tools get tested against the live
gateway without spinning up an MCP session).

Config resolution (first hit wins):

  1. Env: GATEWAY_URL + TENANT_ORG_ID + QS_API_KEY  → gateway proxy path
  2. Env: ELEMENTAL_API_URL (+ optional ELEMENTAL_API_TOKEN) → direct QS
  3. broadchurch.yaml (gateway.url + tenant.org_id + gateway.qs_api_key)

All IDs (NEID/EID/PID/FID) are treated as opaque values. Python's json
handles 64-bit / big-negative ints natively (arbitrary precision), so the
rounding hazard that bites JavaScript callers does not apply here — but we
still carry ids as-is and never do arithmetic on them.
"""

from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path
from typing import Any

import httpx

try:  # pyyaml is optional — only needed for the broadchurch.yaml fallback
    import yaml
except Exception:  # pragma: no cover - defensive
    yaml = None  # type: ignore

_TIMEOUT = float(os.environ.get("ELEMENTAL_TIMEOUT", "30"))


# ---------------------------------------------------------------------------
# Config / base URL + auth header resolution
# ---------------------------------------------------------------------------


def _load_yaml_config() -> dict:
    if yaml is None:
        return {}
    for candidate in (Path("broadchurch.yaml"), Path(__file__).parent / "broadchurch.yaml"):
        if candidate.exists():
            try:
                return yaml.safe_load(candidate.read_text()) or {}
            except Exception:
                return {}
    return {}


def _resolve_base_and_headers() -> tuple[str, dict[str, str]]:
    """Return (base_url, headers) for Query Server calls.

    base_url has NO trailing slash and already includes the
    `/api/qs/{org}` segment when going through the gateway proxy.
    """
    gw = os.environ.get("GATEWAY_URL")
    org = os.environ.get("TENANT_ORG_ID")
    key = os.environ.get("QS_API_KEY")
    if gw and org and key:
        return f"{gw.rstrip('/')}/api/qs/{org}", {"X-Api-Key": key}

    direct = os.environ.get("ELEMENTAL_API_URL")
    if direct:
        token = os.environ.get("ELEMENTAL_API_TOKEN")
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        return direct.rstrip("/"), headers

    cfg = _load_yaml_config()
    gw_y = (cfg.get("gateway") or {}).get("url")
    org_y = (cfg.get("tenant") or {}).get("org_id")
    key_y = (cfg.get("gateway") or {}).get("qs_api_key")
    if gw_y and org_y and key_y:
        return f"{gw_y.rstrip('/')}/api/qs/{org_y}", {"X-Api-Key": key_y}

    raise RuntimeError(
        "Elemental QS is not configured. Set GATEWAY_URL + TENANT_ORG_ID + "
        "QS_API_KEY (gateway proxy) or ELEMENTAL_API_URL (direct), or provide "
        "a broadchurch.yaml."
    )


def is_configured() -> bool:
    try:
        _resolve_base_and_headers()
        return True
    except Exception:
        return False


def _get(path: str) -> Any:
    base, headers = _resolve_base_and_headers()
    resp = httpx.get(f"{base}/{path.lstrip('/')}", headers=headers, timeout=_TIMEOUT)
    resp.raise_for_status()
    return resp.json()


def _post_json(path: str, body: dict) -> Any:
    base, headers = _resolve_base_and_headers()
    resp = httpx.post(
        f"{base}/{path.lstrip('/')}",
        headers={**headers, "Content-Type": "application/json"},
        json=body,
        timeout=_TIMEOUT,
    )
    resp.raise_for_status()
    return resp.json()


def _post_form(path: str, form: dict[str, str]) -> Any:
    base, headers = _resolve_base_and_headers()
    resp = httpx.post(
        f"{base}/{path.lstrip('/')}",
        headers={**headers, "Content-Type": "application/x-www-form-urlencoded"},
        data=form,
        timeout=_TIMEOUT,
    )
    resp.raise_for_status()
    return resp.json()


def pad_neid(value: Any) -> str:
    """Zero-pad a raw entity id to a valid 20-character NEID string."""
    return str(value).rjust(20, "0")


# ---------------------------------------------------------------------------
# Schema (rich /schema endpoint) — cached for the process lifetime
# ---------------------------------------------------------------------------


@lru_cache(maxsize=1)
def _raw_schema() -> dict:
    """The rich `/schema` payload: flavors + properties + attributes.

    Cached because the data model changes infrequently and every tool that
    needs to translate names ↔ ids leans on it.
    """
    return _get("schema")


def refresh_schema() -> None:
    _raw_schema.cache_clear()


def _flavors() -> list[dict]:
    return _raw_schema().get("flavors", []) or []


def _properties() -> list[dict]:
    return _raw_schema().get("properties", []) or []


def _flavor_fid(flavor_name: str) -> Any | None:
    for f in _flavors():
        if f.get("name") == flavor_name:
            return f.get("findex", f.get("fid"))
    return None


def _is_reference(value_type: str | None) -> bool:
    return value_type == "data_nindex"


# ---------------------------------------------------------------------------
# Tool logic
# ---------------------------------------------------------------------------


def health() -> dict:
    """Connectivity + configuration probe for the Query Server."""
    if not is_configured():
        return {"ok": False, "configured": False, "error": "QS not configured"}
    try:
        schema = _raw_schema()
        return {
            "ok": True,
            "configured": True,
            "entity_types": len(schema.get("flavors", []) or []),
            "properties": len(schema.get("properties", []) or []),
        }
    except Exception as e:  # pragma: no cover - network
        return {"ok": False, "configured": True, "error": str(e)}


def list_entity_types() -> dict:
    """Every entity type (flavor) in the graph: name + human description.

    This is the schema-navigation entry point. The graph has dozens of
    entity types; start here to find the one relevant to a question, then
    call get_entity_type_schema(flavor) to see its properties.
    """
    try:
        out = []
        for f in _flavors():
            out.append(
                {
                    "name": f.get("name"),
                    "display_name": f.get("singular_display_name") or f.get("name"),
                    "description": f.get("description") or "",
                }
            )
        out.sort(key=lambda x: (x.get("name") or ""))
        return {"count": len(out), "entity_types": out}
    except Exception as e:
        return {"error": f"Failed to list entity types: {e}"}


def get_entity_type_schema(flavor: str) -> dict:
    """Properties available on a given entity type (flavor).

    Returns each property's name, display name, value type, unit, a
    description, and whether it is a reference to another entity
    (is_reference=true means the value is a NEID you must resolve to a name,
    e.g. an organization's 'country'). Only properties whose domain includes
    this flavor (or that are global) are returned, so the list stays focused
    instead of dumping all ~900 properties.
    """
    try:
        fid = _flavor_fid(flavor)
        if fid is None:
            names = [f.get("name") for f in _flavors()]
            return {
                "error": f"Unknown entity type '{flavor}'.",
                "available_types": sorted(n for n in names if n),
            }
        props = []
        for p in _properties():
            domains = p.get("domain_findexes") or []
            if domains and fid not in domains:
                continue
            props.append(
                {
                    "name": p.get("name"),
                    "display_name": p.get("display_name") or p.get("name"),
                    "value_type": p.get("value_type"),
                    "unit": p.get("unit") or None,
                    "is_reference": _is_reference(p.get("value_type")),
                    "description": (p.get("description") or "")[:300],
                }
            )
        props.sort(key=lambda x: (x.get("name") or ""))
        return {"flavor": flavor, "property_count": len(props), "properties": props}
    except Exception as e:
        return {"error": f"Failed to get schema for '{flavor}': {e}"}


def search_properties(query: str, limit: int = 25) -> dict:
    """Find properties by fuzzy text match on name, display name, or description.

    Use this when you know roughly what attribute you want (e.g. "revenue",
    "ceo", "headquarters") but not its exact property name. Returns matching
    properties with the entity types (flavors) they apply to.
    """
    try:
        q = (query or "").strip().lower()
        if not q:
            return {"error": "query must not be empty"}
        fid_to_name = {f.get("findex", f.get("fid")): f.get("name") for f in _flavors()}
        hits = []
        for p in _properties():
            hay = " ".join(
                str(x)
                for x in (p.get("name"), p.get("display_name"), p.get("description"))
                if x
            ).lower()
            if q in hay:
                domains = p.get("domain_findexes") or []
                hits.append(
                    {
                        "name": p.get("name"),
                        "display_name": p.get("display_name") or p.get("name"),
                        "value_type": p.get("value_type"),
                        "is_reference": _is_reference(p.get("value_type")),
                        "applies_to": [
                            fid_to_name.get(d) for d in domains if fid_to_name.get(d)
                        ]
                        or ["(all types)"],
                        "description": (p.get("description") or "")[:200],
                    }
                )
        # exact-ish name matches first
        hits.sort(key=lambda h: (q not in (h.get("name") or "").lower(), h.get("name") or ""))
        return {"query": query, "match_count": len(hits), "properties": hits[: max(1, limit)]}
    except Exception as e:
        return {"error": f"Property search failed: {e}"}


def get_property_detail(name: str) -> dict:
    """Full schema detail for a single property, by exact name.

    Includes value type, unit, description, the entity types it applies to
    (domain), and — for reference properties — the entity types it points at
    (target).
    """
    try:
        fid_to_name = {f.get("findex", f.get("fid")): f.get("name") for f in _flavors()}
        for p in _properties():
            if p.get("name") == name:
                domains = p.get("domain_findexes") or []
                targets = p.get("target_findexes") or []
                return {
                    "name": p.get("name"),
                    "display_name": p.get("display_name") or p.get("name"),
                    "value_type": p.get("value_type"),
                    "unit": p.get("unit") or None,
                    "is_reference": _is_reference(p.get("value_type")),
                    "description": p.get("description") or "",
                    "applies_to": [fid_to_name.get(d) for d in domains if fid_to_name.get(d)],
                    "targets": [fid_to_name.get(t) for t in targets if fid_to_name.get(t)],
                }
        return {"error": f"No property named '{name}'. Use search_properties to find it."}
    except Exception as e:
        return {"error": f"Failed to get property detail: {e}"}


def resolve_entity(name: str, flavor: str | None = None, max_results: int = 5) -> dict:
    """Resolve a name (e.g. "Apple", "JP Morgan") to ranked entity matches.

    Returns matches with neid, canonical name, flavor (entity type), and a
    confidence score. Always resolve a name to a NEID before fetching its
    properties or relationships. Optionally restrict to a single flavor.
    """
    try:
        query: dict[str, Any] = {"queryId": 1, "query": name}
        if flavor:
            query["flavors"] = [flavor]
        res = _post_json(
            "entities/search",
            {
                "queries": [query],
                "maxResults": max(1, max_results),
                "includeNames": True,
                "includeFlavors": True,
                "includeScores": True,
            },
        )
        matches = (((res or {}).get("results") or [{}])[0]).get("matches") or []
        clean = [
            {
                "neid": m.get("neid"),
                "name": m.get("name"),
                "flavor": m.get("flavor"),
                "score": m.get("score"),
            }
            for m in matches
        ]
        return {"query": name, "match_count": len(clean), "matches": clean}
    except Exception as e:
        return {"error": f"Resolution failed for '{name}': {e}"}


def _name_for_neids(neids: list[str]) -> dict[str, str]:
    """Batch NEID → display name (best-effort, never raises)."""
    unique = sorted({n for n in neids if n})
    if not unique:
        return {}
    try:
        res = _post_json("entities/names", {"neids": unique})
        results = (res or {}).get("results") or {}
        return {k: v for k, v in results.items() if v}
    except Exception:
        return {}


# ---------------------------------------------------------------------------
# Provenance: match a chosen fact to its source record, then render a citation.
#
# Two-step QS flow, mirroring moongoose's MCP provenance helper:
#   1. POST /elemental/provenance/match — quads (efid, pid, nindex, value,
#      recorded_at) → provenance trails (efid, record_index, atom_index).
#   2. POST /elemental/provenance/render — trails → rendered citations
#      (source, subject, url, supporting excerpts, …).
# Both are form-POSTs whose body is a JSON-string field, and both return a
# `results` list 1:1 with the input (same order).
# ---------------------------------------------------------------------------

# Above this many resolved facts in one response we skip citation rendering:
# match+render is a per-fact round-trip to the QS and the payloads are large.
_MAX_FACTS_FOR_CITATIONS = 10


def _match_provenance(quads: list[dict]) -> list[dict]:
    """Match fact quads to provenance trails. Best-effort: never raises."""
    if not quads:
        return []
    try:
        res = _post_form("elemental/provenance/match", {"quads": json.dumps(quads)})
        return (res or {}).get("results") or []
    except Exception:
        return []


def _render_citations(trails: list[dict]) -> list[dict]:
    """Render provenance trails to citations. Best-effort: never raises."""
    if not trails:
        return []
    try:
        res = _post_form("elemental/provenance/render", {"trails": json.dumps(trails)})
        return (res or {}).get("results") or []
    except Exception:
        return []


def _attach_rendered_citations(
    neid: str,
    wanted: list[tuple[str, Any, str]],
    by_pid: dict[str, dict],
    details: dict[str, Any],
) -> None:
    """Attach a rendered source citation to each property's `details` entry.

    Matches every chosen fact (one per property, identified by its efid) to a
    provenance trail, then renders that trail to a citation. Mutates `details`
    in place, adding a `citation` key only where a source was found. Entirely
    best-effort — any failure leaves `details` untouched.
    """
    try:
        nindex = int(neid)
    except (TypeError, ValueError):
        return

    # One quad per property that has a chosen fact with an efid, tracking which
    # property each quad belongs to so results (returned in order) map back.
    props: list[str] = []
    quads: list[dict] = []
    for nm, pid, _vtype in wanted:
        row = by_pid.get(str(pid))
        if details.get(nm) is None or row is None or not row.get("efid"):
            continue
        props.append(nm)
        quads.append(
            {
                "nindex": nindex,
                "pid": row.get("pid"),
                "value": row.get("value"),
                "recorded_at": row.get("recorded_at"),
                "efid": str(row.get("efid")),
            }
        )
    if not quads:
        return

    trail_props: list[str] = []
    trails: list[dict] = []
    for prop, m in zip(props, _match_provenance(quads)):
        if not isinstance(m, dict) or m.get("error") or not m.get("efid"):
            continue
        trail_props.append(prop)
        trails.append(
            {
                "efid": str(m.get("efid")),
                "record_index": m.get("record_index", 0),
                "atom_index": m.get("atom_index", 0),
            }
        )
    if not trails:
        return

    for prop, r in zip(trail_props, _render_citations(trails)):
        if not isinstance(r, dict) or r.get("error"):
            continue
        citation = r.get("citation")
        if citation and details.get(prop) is not None:
            details[prop]["citation"] = citation


def get_entity_properties(neid: str, properties: list[str]) -> dict:
    """Fetch named property values for one entity (by NEID).

    Translates human property names → PIDs via the schema, fetches values,
    de-duplicates (the API returns one row per source — first source wins),
    and resolves reference (data_nindex) values to the linked entity's
    display name so you never see a raw NEID where a name belongs.

    Returns:
        {
          "neid": str,
          "values": {prop: value_or_null, ...},   # resolved (refs → names)
          "details": {prop: {                      # provenance of the chosen fact
              "pid": int,                           # the property id
              "efid": str,                          # the entity-fact id of this value
              "attributes": <any|null>,             # fact qualifiers, when present
              "recorded_at": str|null,              # when the fact was recorded
              "citation": {                         # rendered source, see below
                  "source": str,
                  "source_display_name": str,
                  "subject": str,
                  "timestamp": str,
                  "property": str,
                  "value": str,
                  "url": str,
                  "excerpts": [{"text": str, "explanation": str, ...}],
              },                                    # present only when matched
          } | null, ...},
          "unknown_properties": [...],
        }

    The `citation` key is a fully rendered source attribution (via the QS
    provenance match + render endpoints). It is only fetched when the response
    has fewer than 10 resolved facts (rendering is a per-fact round-trip and
    the payloads are large), and is omitted for any fact whose source can't be
    matched.
    """
    try:
        neid = pad_neid(neid)
        name_to_prop = {p.get("name"): p for p in _properties()}
        wanted: list[tuple[str, Any, str]] = []
        unknown: list[str] = []
        for nm in properties:
            p = name_to_prop.get(nm)
            if p and p.get("pid") is not None:
                wanted.append((nm, p.get("pid"), p.get("value_type")))
            else:
                unknown.append(nm)

        values: dict[str, Any] = {nm: None for nm, _, _ in wanted}
        details: dict[str, Any] = {nm: None for nm, _, _ in wanted}
        if not wanted:
            return {
                "neid": neid,
                "values": values,
                "details": details,
                "unknown_properties": unknown,
            }

        pid_array = "[" + ",".join(str(pid) for _, pid, _ in wanted) + "]"
        res = _post_form(
            "elemental/entities/properties",
            {"eids": json.dumps([neid]), "pids": pid_array},
        )

        # first-wins dedup per pid — keep the whole fact row so we can surface
        # its provenance (efid / attributes / recorded_at), not just the value.
        by_pid: dict[str, dict] = {}
        for v in (res or {}).get("values", []) or []:
            pid = str(v.get("pid"))
            if pid in by_pid or v.get("value") is None:
                continue
            by_pid[pid] = v

        ref_neids: list[str] = []
        pending_refs: list[tuple[str, str]] = []  # (prop_name, padded_neid)
        for nm, pid, vtype in wanted:
            row = by_pid.get(str(pid))
            if row is None:
                continue
            details[nm] = {
                "pid": row.get("pid"),
                "efid": row.get("efid"),
                "attributes": row.get("attributes"),
                "recorded_at": row.get("recorded_at"),
            }
            raw = row.get("value")
            if _is_reference(vtype):
                padded = pad_neid(raw)
                pending_refs.append((nm, padded))
                ref_neids.append(padded)
            else:
                values[nm] = raw

        if ref_neids:
            name_map = _name_for_neids(ref_neids)
            for nm, padded in pending_refs:
                values[nm] = name_map.get(padded, padded)

        # Enrich with rendered source citations, but only for small responses —
        # match+render is a per-fact QS round-trip and the payloads are large.
        fact_count = sum(1 for d in details.values() if d)
        if 0 < fact_count < _MAX_FACTS_FOR_CITATIONS:
            _attach_rendered_citations(neid, wanted, by_pid, details)

        return {
            "neid": neid,
            "values": values,
            "details": details,
            "unknown_properties": unknown,
        }
    except Exception as e:
        return {"error": f"Failed to fetch properties for {neid}: {e}"}


def find_entities(expression: str, limit: int = 20) -> dict:
    """Run an Elemental `find` expression and return matching entities.

    `expression` is a JSON string in the Elemental expression language, e.g.
      - by type:   {"type":"is_type","is_type":{"fid":10}}
      - by name:   {"type":"comparison","comparison":{"operator":"string_like","pid":8,"value":"Apple"}}
      - linked:    {"type":"linked","linked":{"to_entity":"<neid>","direction":"incoming"}}
      - boolean:   {"type":"and","and":[<expr>, <expr>]}
    Returns the matched NEIDs plus resolved display names for the first
    several, so you can read the results without an extra lookup.
    """
    try:
        res = _post_form("elemental/find", {"expression": expression, "limit": str(max(1, limit))})
        eids = (res or {}).get("eids") or []
        eids = [pad_neid(e) for e in eids]
        names = _name_for_neids(eids[:25])
        sample = [{"neid": e, "name": names.get(e, e)} for e in eids[:25]]
        return {"match_count": len(eids), "results": sample, "truncated": len(eids) > 25}
    except Exception as e:
        return {"error": f"find failed: {e}"}


def count_linked_entities(
    neid: str,
    direction: str = "incoming",
    relationship: str | None = None,
    limit: int = 500,
) -> dict:
    """Count graph-linked entities for an entity (by NEID).

    direction is "incoming" or "outgoing". Optionally restrict to a single
    relationship property name (e.g. "subsidiary_of"); look it up first with
    search_properties / get_property_detail. Returns the count plus a small
    sample of linked entity names.
    """
    try:
        neid = pad_neid(neid)
        linked: dict[str, Any] = {"to_entity": neid, "distance": 1, "direction": direction}
        if relationship:
            for p in _properties():
                if p.get("name") == relationship and p.get("pid") is not None:
                    linked["pids"] = [p.get("pid")]
                    break
            else:
                return {"error": f"Unknown relationship property '{relationship}'."}
        res = _post_form(
            "elemental/find",
            {"expression": json.dumps({"type": "linked", "linked": linked}), "limit": str(limit)},
        )
        eids = [pad_neid(e) for e in ((res or {}).get("eids") or [])]
        names = _name_for_neids(eids[:10])
        return {
            "neid": neid,
            "direction": direction,
            "relationship": relationship,
            "count": len(eids),
            "sample": [names.get(e, e) for e in eids[:10]],
        }
    except Exception as e:
        return {"error": f"linked count failed: {e}"}


def get_entity_name(neid: str) -> dict:
    """Canonical display name for an entity, by NEID."""
    try:
        neid = pad_neid(neid)
        res = _get(f"entities/{neid}/name")
        return {"neid": neid, "name": (res or {}).get("name")}
    except Exception as e:
        return {"error": f"name lookup failed for {neid}: {e}"}
