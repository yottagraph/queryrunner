"""Unit tests for the elemental-query tool logic.

These exercise `elemental.py` without an MCP session or a live Query Server:
the three HTTP primitives (`_get` / `_post_json` / `_post_form`) and the
schema accessor are monkeypatched with canned Elemental-shaped payloads, so
the tests are fully offline and deterministic.

Run:  pytest mcp-servers/elemental-query/test_elemental.py
"""

import json

import pytest

import elemental


# --- Canned schema / responses -------------------------------------------

SCHEMA = {
    "flavors": [
        {
            "name": "organization",
            "singular_display_name": "Organization",
            "description": "A company or other organization.",
            "findex": 10,
        },
        {
            "name": "person",
            "singular_display_name": "Person",
            "description": "A human being.",
            "findex": 12,
        },
        # no singular_display_name → display falls back to name
        {"name": "country", "description": "A sovereign state.", "findex": 5},
    ],
    "properties": [
        # global property (empty domain) — applies to every flavor
        {
            "name": "name",
            "display_name": "Name",
            "value_type": "data_string",
            "pid": 8,
            "domain_findexes": [],
            "description": "Canonical name.",
        },
        {
            "name": "country",
            "display_name": "Country",
            "value_type": "data_nindex",
            "pid": 313,
            "domain_findexes": [10],
            "target_findexes": [5],
            "description": "Headquarters country.",
        },
        {
            "name": "revenue",
            "display_name": "Annual Revenue",
            "value_type": "data_double",
            "unit": "USD",
            "pid": 42,
            "domain_findexes": [10],
            "description": "Total yearly revenue.",
        },
        {
            "name": "ceo",
            "display_name": "Chief Executive Officer",
            "value_type": "data_nindex",
            "pid": 99,
            "domain_findexes": [10],
            "target_findexes": [12],
            "description": "The current CEO.",
        },
    ],
}


@pytest.fixture(autouse=True)
def _stub_schema(monkeypatch):
    """Make every schema-dependent helper read SCHEMA, no network."""
    monkeypatch.setattr(elemental, "_raw_schema", lambda: SCHEMA)
    yield


# --- pad_neid -------------------------------------------------------------


def test_pad_neid_zero_pads_to_20():
    assert elemental.pad_neid("123") == "00000000000000000123"
    assert len(elemental.pad_neid(7)) == 20


def test_pad_neid_leaves_full_length_untouched():
    full = "12345678901234567890"
    assert elemental.pad_neid(full) == full


# --- config resolution ----------------------------------------------------


def test_resolve_base_gateway_proxy(monkeypatch):
    monkeypatch.setenv("GATEWAY_URL", "https://gw.example.com/")
    monkeypatch.setenv("TENANT_ORG_ID", "org_abc")
    monkeypatch.setenv("QS_API_KEY", "secret-key")
    monkeypatch.delenv("ELEMENTAL_API_URL", raising=False)
    base, headers = elemental._resolve_base_and_headers()
    assert base == "https://gw.example.com/api/qs/org_abc"
    assert headers == {"X-Api-Key": "secret-key"}


def test_resolve_base_direct_url(monkeypatch):
    for k in ("GATEWAY_URL", "TENANT_ORG_ID", "QS_API_KEY"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("ELEMENTAL_API_URL", "https://qs.example.com/")
    monkeypatch.setenv("ELEMENTAL_API_TOKEN", "tok")
    base, headers = elemental._resolve_base_and_headers()
    assert base == "https://qs.example.com"
    assert headers == {"Authorization": "Bearer tok"}


def test_resolve_base_unconfigured_raises(monkeypatch):
    for k in (
        "GATEWAY_URL",
        "TENANT_ORG_ID",
        "QS_API_KEY",
        "ELEMENTAL_API_URL",
        "ELEMENTAL_API_TOKEN",
    ):
        monkeypatch.delenv(k, raising=False)
    # also block the broadchurch.yaml fallback
    monkeypatch.setattr(elemental, "_load_yaml_config", lambda: {})
    with pytest.raises(RuntimeError):
        elemental._resolve_base_and_headers()
    assert elemental.is_configured() is False


# --- schema navigation tools ---------------------------------------------


def test_list_entity_types_sorted_with_display_fallback():
    out = elemental.list_entity_types()
    assert out["count"] == 3
    names = [e["name"] for e in out["entity_types"]]
    assert names == sorted(names) == ["country", "organization", "person"]
    country = next(e for e in out["entity_types"] if e["name"] == "country")
    assert country["display_name"] == "country"  # no singular_display_name


def test_get_entity_type_schema_scopes_to_flavor_and_globals():
    out = elemental.get_entity_type_schema("organization")
    names = {p["name"] for p in out["properties"]}
    # global `name` + the three org-domain props
    assert names == {"name", "country", "revenue", "ceo"}
    refs = {p["name"] for p in out["properties"] if p["is_reference"]}
    assert refs == {"country", "ceo"}


def test_get_entity_type_schema_person_gets_only_globals():
    out = elemental.get_entity_type_schema("person")
    assert {p["name"] for p in out["properties"]} == {"name"}


def test_get_entity_type_schema_unknown_flavor_errors_with_hints():
    out = elemental.get_entity_type_schema("widget")
    assert "error" in out
    assert "organization" in out["available_types"]


def test_search_properties_matches_and_orders_exact_name_first():
    out = elemental.search_properties("revenue")
    assert out["match_count"] == 1
    assert out["properties"][0]["name"] == "revenue"
    assert out["properties"][0]["applies_to"] == ["organization"]


def test_search_properties_empty_query_errors():
    assert "error" in elemental.search_properties("   ")


def test_search_properties_limit_respected():
    out = elemental.search_properties("a", limit=2)  # matches name/revenue/ceo via desc
    assert len(out["properties"]) <= 2


def test_get_property_detail_reference_has_targets():
    out = elemental.get_property_detail("country")
    assert out["is_reference"] is True
    assert out["applies_to"] == ["organization"]
    assert out["targets"] == ["country"]


def test_get_property_detail_unknown_errors():
    assert "error" in elemental.get_property_detail("nope")


# --- resolution / retrieval / traversal ----------------------------------


def test_resolve_entity_cleans_matches(monkeypatch):
    captured = {}

    def fake_post_json(path, body):
        captured["path"] = path
        captured["body"] = body
        return {
            "results": [
                {
                    "matches": [
                        {
                            "neid": "001",
                            "name": "Apple Inc.",
                            "flavor": "organization",
                            "score": 0.99,
                            "extra": "ignored",
                        }
                    ]
                }
            ]
        }

    monkeypatch.setattr(elemental, "_post_json", fake_post_json)
    out = elemental.resolve_entity("Apple", flavor="organization", max_results=3)
    assert captured["path"] == "entities/search"
    assert captured["body"]["queries"][0]["flavors"] == ["organization"]
    assert captured["body"]["maxResults"] == 3
    assert out["match_count"] == 1
    assert out["matches"][0] == {
        "neid": "001",
        "name": "Apple Inc.",
        "flavor": "organization",
        "score": 0.99,
    }


def test_resolve_entity_error_is_captured(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("network down")

    monkeypatch.setattr(elemental, "_post_json", boom)
    out = elemental.resolve_entity("Apple")
    assert "error" in out and "network down" in out["error"]


def test_get_entity_properties_dedup_and_reference_resolution(monkeypatch):
    def fake_post_form(path, form):
        assert path == "elemental/entities/properties"
        # pids array carries both requested known pids
        assert "8" in form["pids"] and "313" in form["pids"]
        return {
            "values": [
                {"pid": 8, "value": "Apple Inc."},
                {"pid": 8, "value": "DUPLICATE — must be ignored"},
                {"pid": 313, "value": "123"},  # reference NEID (unpadded)
            ]
        }

    def fake_post_json(path, body):
        assert path == "entities/names"
        assert "00000000000000000123" in body["neids"]
        return {"results": {"00000000000000000123": "United States"}}

    monkeypatch.setattr(elemental, "_post_form", fake_post_form)
    monkeypatch.setattr(elemental, "_post_json", fake_post_json)

    out = elemental.get_entity_properties("999", ["name", "country", "bogus"])
    assert out["neid"] == "00000000000000000999"
    assert out["values"]["name"] == "Apple Inc."  # first-wins dedup
    assert out["values"]["country"] == "United States"  # nindex resolved to name
    assert out["unknown_properties"] == ["bogus"]


def test_get_entity_properties_all_unknown_makes_no_http_call(monkeypatch):
    def fail(*a, **k):
        raise AssertionError("should not hit the network for unknown props")

    monkeypatch.setattr(elemental, "_post_form", fail)
    out = elemental.get_entity_properties("1", ["totally_made_up"])
    assert out["values"] == {}
    assert out["unknown_properties"] == ["totally_made_up"]


def test_get_entity_properties_unresolved_reference_falls_back_to_neid(monkeypatch):
    monkeypatch.setattr(
        elemental,
        "_post_form",
        lambda p, f: {"values": [{"pid": 313, "value": "123"}]},
    )
    # name lookup returns nothing → keep padded NEID
    monkeypatch.setattr(elemental, "_post_json", lambda p, b: {"results": {}})
    out = elemental.get_entity_properties("1", ["country"])
    assert out["values"]["country"] == "00000000000000000123"


def test_find_entities_pads_and_names(monkeypatch):
    monkeypatch.setattr(elemental, "_post_form", lambda p, f: {"eids": [1, 2]})
    monkeypatch.setattr(
        elemental,
        "_post_json",
        lambda p, b: {"results": {"00000000000000000001": "Apple Inc."}},
    )
    out = elemental.find_entities('{"type":"is_type","is_type":{"fid":10}}')
    assert out["match_count"] == 2
    first = out["results"][0]
    assert first["neid"] == "00000000000000000001"
    assert first["name"] == "Apple Inc."
    # the unresolved one falls back to its NEID
    assert out["results"][1]["name"] == "00000000000000000002"


def test_count_linked_entities_counts_and_samples(monkeypatch):
    captured = {}

    def fake_post_form(path, form):
        captured["expression"] = json.loads(form["expression"])
        return {"eids": [11, 22, 33]}

    monkeypatch.setattr(elemental, "_post_form", fake_post_form)
    monkeypatch.setattr(elemental, "_post_json", lambda p, b: {"results": {}})
    out = elemental.count_linked_entities("5", direction="incoming")
    assert out["count"] == 3
    assert captured["expression"]["linked"]["direction"] == "incoming"
    assert captured["expression"]["linked"]["to_entity"] == "00000000000000000005"


def test_count_linked_entities_with_known_relationship_sets_pids(monkeypatch):
    captured = {}

    def fake_post_form(path, form):
        captured["expression"] = json.loads(form["expression"])
        return {"eids": []}

    monkeypatch.setattr(elemental, "_post_form", fake_post_form)
    monkeypatch.setattr(elemental, "_post_json", lambda p, b: {"results": {}})
    out = elemental.count_linked_entities("5", relationship="ceo")
    assert out["count"] == 0
    assert captured["expression"]["linked"]["pids"] == [99]


def test_count_linked_entities_unknown_relationship_errors(monkeypatch):
    monkeypatch.setattr(elemental, "_post_form", lambda p, f: {"eids": []})
    out = elemental.count_linked_entities("5", relationship="not_a_rel")
    assert "error" in out


def test_get_entity_name(monkeypatch):
    monkeypatch.setattr(elemental, "_get", lambda path: {"name": "Apple Inc."})
    out = elemental.get_entity_name("1")
    assert out["neid"] == "00000000000000000001"
    assert out["name"] == "Apple Inc."


# --- health ---------------------------------------------------------------


def test_health_unconfigured(monkeypatch):
    monkeypatch.setattr(elemental, "is_configured", lambda: False)
    out = elemental.health()
    assert out == {"ok": False, "configured": False, "error": "QS not configured"}


def test_health_ok(monkeypatch):
    monkeypatch.setattr(elemental, "is_configured", lambda: True)
    out = elemental.health()
    assert out["ok"] is True
    assert out["entity_types"] == 3
    assert out["properties"] == 4


# --- error containment: tools never raise --------------------------------


@pytest.mark.parametrize(
    "call",
    [
        lambda: elemental.get_entity_properties("1", ["name"]),
        lambda: elemental.find_entities("{}"),
        lambda: elemental.count_linked_entities("1"),
        lambda: elemental.get_entity_name("1"),
        lambda: elemental.resolve_entity("x"),
    ],
)
def test_tools_return_error_dict_instead_of_raising(monkeypatch, call):
    def boom(*a, **k):
        raise RuntimeError("kaboom")

    monkeypatch.setattr(elemental, "_get", boom)
    monkeypatch.setattr(elemental, "_post_json", boom)
    monkeypatch.setattr(elemental, "_post_form", boom)
    out = call()
    assert isinstance(out, dict) and "error" in out
