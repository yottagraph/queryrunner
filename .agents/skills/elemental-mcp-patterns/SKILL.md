---
name: elemental-mcp-patterns
description: How to correctly call Elemental MCP tools and process their responses when writing Python ADK agent tool functions.
---

# Elemental MCP Patterns

This skill is for **build agents writing Python tool code** that calls
Elemental MCP tools. It covers MCP wiring, transport configuration,
response shapes, property type handling, and copy-paste patterns for
common operations.

For domain knowledge (what entity types and properties exist), see the
**data-model** skill.

---

## MCP Wiring: Connecting ADK Agents to Elemental MCP

### Transport class

The Elemental MCP server uses **Streamable HTTP** transport. You **must**
use `StreamableHTTPConnectionParams`:

```python
from google.adk.tools.mcp_tool import McpToolset
from google.adk.tools.mcp_tool.mcp_session_manager import StreamableHTTPConnectionParams
```

> **Do NOT use `SseConnectionParams`.** `SseConnectionParams` is for
> legacy SSE-based MCP servers. Using it against the Elemental MCP server
> will silently fail — the agent starts with zero tools and no error is
> raised. The LLM then hallucinates tool calls.

### Resolving the MCP URL

The MCP URL comes from the environment (`ELEMENTAL_MCP_URL`) for local
dev, or from `broadchurch.yaml` for deployed agents:

```python
import os
from pathlib import Path
import yaml

def _get_mcp_url(server_name: str = "elemental") -> str:
    """Resolve MCP server URL from env or broadchurch.yaml."""
    env_url = os.environ.get("ELEMENTAL_MCP_URL")
    if env_url:
        return env_url
    for candidate in [Path("broadchurch.yaml"), Path(__file__).parent / "broadchurch.yaml"]:
        if candidate.exists():
            config = yaml.safe_load(candidate.read_text()) or {}
            gw = config.get("gateway", {})
            org_id = config.get("tenant", {}).get("org_id", "")
            if gw.get("url") and org_id:
                return f"{gw['url'].rstrip('/')}/api/mcp/{org_id}/{server_name}/mcp"
            return config.get("mcp", {}).get(server_name, "")
    return ""
```

### Complete wiring example

```python
from google.adk.agents import Agent
from google.adk.tools.mcp_tool import McpToolset
from google.adk.tools.mcp_tool.mcp_session_manager import StreamableHTTPConnectionParams

mcp_url = _get_mcp_url()  # function from above
if not mcp_url:
    raise RuntimeError("No MCP URL — check broadchurch.yaml or ELEMENTAL_MCP_URL env var")

root_agent = Agent(
    model="gemini-2.5-flash",
    name="my_mcp_agent",
    instruction="You are a research assistant with access to the Lovelace knowledge graph.",
    tools=[
        my_custom_tool,  # your Python tool functions
        McpToolset(connection_params=StreamableHTTPConnectionParams(url=mcp_url)),
    ],
)
```

The `McpToolset` automatically discovers all MCP tools at startup and
exposes them to the agent. To restrict which tools are exposed, use
`tool_filter`:

```python
McpToolset(
    connection_params=StreamableHTTPConnectionParams(url=mcp_url),
    tool_filter=["elemental_get_entity", "elemental_get_related", "elemental_get_events"],
)
```

### Silent failure mode

If `McpToolset` cannot connect, **no error is raised at agent startup**.
The agent simply has zero MCP tools. Symptoms:

- The agent never calls any `elemental_*` tools
- The LLM fabricates code or data instead of using tools
- No connection error in logs

**Always validate** the MCP URL and check for tool availability during
development. If MCP tools aren't working, verify:

1. The URL is correct (check `broadchurch.yaml` `mcp.elemental` or env var)
2. You're using `StreamableHTTPConnectionParams` (not `SseConnectionParams`)
3. The MCP server is reachable (try `curl -X POST <url> -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'`)

#### Make the silent failure loud: probe tools at boot

Since the failure is silent, add an explicit startup probe that logs how
many tools registered (and fails fast if zero). Call it once at import
time in `agent.py` — it turns "the agent mysteriously never uses tools"
into a single obvious log line:

```python
import logging

logger = logging.getLogger("elemental_mcp")

async def _probe_mcp_tools(toolset: McpToolset) -> int:
    """Count the MCP tools the toolset exposes. Logs the names so a
    misconfigured URL / unreachable server shows up as `0 tools` in the
    pod logs instead of a fabricating LLM."""
    try:
        tools = await toolset.get_tools()
        names = [getattr(t, "name", "?") for t in tools]
        logger.info("Elemental MCP: %d tools registered: %s", len(names), names)
        return len(names)
    except Exception as exc:  # connection / auth / URL problems land here
        logger.error("Elemental MCP probe failed: %s", exc)
        return 0
```

Wire it into a lightweight `mcp_health` tool (so you can also check from
the chat UI), and/or run it in an async startup hook. The goal is that a
broken MCP path is visible in `kubectl logs` the moment the pod boots —
not discovered three tool-less conversations later.

### Local dev setup

```bash
export ELEMENTAL_MCP_URL="https://mcp.pip.prod.g.lovelace.ai/elemental/mcp"
export GOOGLE_CLOUD_PROJECT=broadchurch
export GOOGLE_CLOUD_LOCATION=us-central1
export GOOGLE_GENAI_USE_VERTEXAI=1
cd agents/
adk web
```

---

## Tool Quick Reference

| Tool                           | Use when you need to...                                                                                                                                               |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `elemental_get_entity`         | Resolve an entity by name or ID, fetch its properties (supports `history` for time-series)                                                                            |
| `elemental_get_related`        | Find related entities (requires `related_flavor`); use `direction` and `relationship_types` to filter                                                                 |
| `elemental_get_events`         | Get typed events with categories, dates, participants                                                                                                                 |
| `elemental_get_citations`      | Look up provenance for `ref` hashes returned by other tools                                                                                                           |
| `elemental_get_schema`         | Discover flavors (entity types), property names, and property types                                                                                                   |
| `elemental_get_relationships`  | Get relationship types and counts between two entities                                                                                                                |
| `elemental_graph_neighborhood` | Get the most influential neighbors of an entity                                                                                                                       |
| `elemental_graph_sentiment`    | Sentiment time series, trend analysis, and statistics from news articles                                                                                              |
| `elemental_introspect`         | Discover what data **actually exists**: entity counts, populated properties with fill rates, sample values. Use before building features to verify data availability. |
| `elemental_traverse`           | Stateful graph navigation — build a working set of entities across multiple calls (start → expand → filter → inspect)                                                 |
| `elemental_health`             | Health check — verify MCP server connectivity                                                                                                                         |

### MCP Prompts

The server also exposes built-in prompts that provide pre-composed
workflows:

| Prompt              | Purpose                                             |
| ------------------- | --------------------------------------------------- |
| `company-deep-dive` | Comprehensive company research workflow             |
| `blast-radius`      | Analyze impact/connections radiating from an entity |
| `event-monitor`     | Track events and developments for entities          |

### MCP Resources

Documentation resources are available directly from the server:

| Resource                    | Description                                 |
| --------------------------- | ------------------------------------------- |
| `elemental_data_model`      | Entity types, properties, and relationships |
| `elemental_guide`           | Usage guide for the MCP tools               |
| `elemental_schema`          | Live schema data                            |
| `elemental_workflows`       | Common workflow patterns and examples       |
| `elemental_mcp_server_info` | Server capabilities and configuration       |

These prompts and resources can be useful shortcuts — check if your MCP
client supports them before building equivalent logic from scratch.

---

## Response Shapes

Every MCP tool call returns a JSON dict. Below are annotated examples of
the three tools you'll use most.

### elemental_get_entity

```python
result = await mcp_call("elemental_get_entity", {
    "entity": "Intel",
    "properties": ["country", "total_revenue", "ticker_symbol", "net_income"]
})

# Response shape:
{
    "entity": {
        "neid": "04926132345040704022",
        "name": "Intel Corporation",
        "flavor": "organization",
        "properties": {
            "country": {
                "value": "5816460566439750832",  # <-- THIS IS A NEID, NOT A NAME
                "ref": "ref_a3f2b1c8"
            },
            "total_revenue": {
                "value": 52900000000,
                "ref": "ref_d4e5f678",
                "attributes": {"filing_period": "FY"}
            },
            "ticker_symbol": {
                "value": "INTC"
            },
            "net_income": {
                "value": -267000000,
                "ref": "ref_b2c3d4e5"
            }
        }
    }
}
```

Key points:

- `entity` is `null` if resolution failed
- Each property value is `{"value": ..., "ref"?: "...", "attributes"?: {...}}`
- **`value` can be a NEID** for reference-typed properties — see
  "The Property Type Problem" below
- `ref` is a citation hash — pass it through to the LLM exactly as-is
- `low_confidence` means the entity match is fuzzy — confirm with the user

### elemental_get_related

```python
result = await mcp_call("elemental_get_related", {
    "entity": "Intel",
    "related_flavor": "person",                    # REQUIRED
    "relationship_types": ["board_member_of"],      # optional filter
    "related_properties": ["nationality", "title"], # properties on each person
    "limit": 20
})

# Response shape:
{
    "resolved": {
        "neid": "04926132345040704022",
        "name": "Intel Corporation",
        "flavor": "organization"
    },
    "total": 12,
    "relationships": [
        {
            "neid": "08371625409283746152",
            "name": "Patrick Gelsinger",
            "flavor": "person",
            "relationship_types": ["board_member_of"],
            "properties": {
                "nationality": {"value": "United States"},
                "title": {"value": "CEO"}
            }
        }
        # ... more related entities
    ]
}
```

Key points:

- `related_flavor` is **required** — you must specify what type of entity
  to look for
- `resolved` is the center entity (can be `null` if resolution failed)
- Each item in `relationships` has the same property value shape as
  `elemental_get_entity`
- Use `direction` (`"outgoing"`, `"incoming"`, `"both"`) to control
  traversal direction

### elemental_get_events

```python
result = await mcp_call("elemental_get_events", {
    "entity": "Intel",
    "categories": ["Bankruptcy", "IPO", "Regulatory Action"],  # optional
    "time_range": {"after": "2025-01-01"},                     # optional
    "include_participants": True,                               # optional
    "limit": 20
})

# Response shape:
{
    "resolved": {
        "neid": "04926132345040704022",
        "name": "Intel Corporation"
    },
    "total": 3,
    "events": [
        {
            "neid": "09283746152837461528",
            "name": "Intel CHIPS Act Award",
            "flavor": "event",
            "properties": {
                "category": {"value": "Regulatory Action"},
                "date": {"value": "2025-03-15"},
                "description": {"value": "Intel awarded $8.5B in CHIPS Act funding"},
                "likelihood": {"value": 0.95}
            },
            "participants": [
                {
                    "neid": "04926132345040704022",
                    "name": "Intel Corporation",
                    "flavor": "organization",
                    "relationship_types": ["participant"]
                }
            ]
        }
    ]
}
```

Key points:

- Events have typed fields: `category`, `date`, `description`, `likelihood`
- Use `categories` to filter — do NOT try to find events by scanning
  property names for keywords
- `participants` only included when `include_participants` is `True`

---

## The Property Type Problem

This is the single biggest source of bugs in MCP-based agents.

**The issue:** property values can be entity references (NEIDs), not
display text. If you render them raw, the user sees `"5816460566439750832"`
instead of `"United States"`.

### Step 1: Get the schema to learn property types

```python
schema = await mcp_call("elemental_get_schema", {"flavor": "organization"})

# Response includes a properties array:
# [
#   {"name": "country",       "type": "nindex", ...},  <-- entity reference!
#   {"name": "total_revenue", "type": "float",  ...},
#   {"name": "ticker_symbol", "type": "string", ...},
#   {"name": "industry",      "type": "nindex", ...},  <-- entity reference!
# ]
```

### Step 2: Build a type map (once per session)

```python
def build_property_type_map(schema_result: dict) -> dict[str, str]:
    """Map property names to their types from schema."""
    type_map = {}
    for prop in schema_result.get("properties", []):
        type_map[prop["name"]] = prop["type"]
    return type_map

# Cache this — don't re-fetch schema for every tool call
property_types = build_property_type_map(schema)
# {"country": "nindex", "total_revenue": "float", "ticker_symbol": "string", ...}
```

### Step 3: Resolve reference values before display

```python
async def format_properties(
    properties: dict,
    property_types: dict[str, str],
    mcp_call,
) -> dict[str, str]:
    """Format property values for user-facing display."""
    formatted = {}
    for name, prop in properties.items():
        value = prop["value"]
        prop_type = property_types.get(name, "string")

        if prop_type == "nindex" and isinstance(value, (str, int)):
            # This is an entity reference — resolve to display name
            resolved = await mcp_call("elemental_get_entity", {
                "entity_id": {"id": str(value), "id_type": "neid"}
            })
            entity = resolved.get("entity")
            formatted[name] = entity["name"] if entity else str(value)
        elif isinstance(value, (int, float)) and abs(value) >= 1_000_000:
            formatted[name] = _format_large_number(value)
        else:
            formatted[name] = str(value)
    return formatted

def _format_large_number(n: float) -> str:
    """Format large numbers: 52900000000 -> '$52.9B'."""
    abs_n = abs(n)
    if abs_n >= 1e12:
        return f"${n/1e12:.1f}T"
    if abs_n >= 1e9:
        return f"${n/1e9:.1f}B"
    if abs_n >= 1e6:
        return f"${n/1e6:.1f}M"
    return f"${n:,.0f}"
```

### Property type values you'll encounter

| Schema type        | Value is        | How to display                              |
| ------------------ | --------------- | ------------------------------------------- |
| `string`           | Plain text      | Display directly                            |
| `integer`, `float` | Number          | Format with units (check `unit` in schema)  |
| `nindex`           | Entity NEID     | **Must resolve** via `elemental_get_entity` |
| `boolean`          | `true`/`false`  | Display as Yes/No                           |
| `datetime`         | ISO 8601 string | Format as human-readable date               |

---

## Common Patterns

### Resolve and cache an entity

```python
async def resolve_entity(
    name: str,
    session_state: dict,
    mcp_call,
    neid: str | None = None,
) -> dict | None:
    """Resolve entity, using cache if available."""
    cache = session_state.setdefault("entities", {})

    # Check cache by NEID or name
    cache_key = neid or name.lower()
    if cache_key in cache:
        return cache[cache_key]

    params = {}
    if neid:
        params["entity_id"] = {"id": neid, "id_type": "neid"}
    else:
        params["entity"] = name

    result = await mcp_call("elemental_get_entity", params)
    entity = result.get("entity")
    if not entity:
        return None

    # Cache by both NEID and lowercase name
    cache[entity["neid"]] = entity
    cache[entity["name"].lower()] = entity
    return entity
```

### Build a rich entity briefing

Don't return a one-paragraph summary. Chain multiple calls to build a
comprehensive report:

```python
async def entity_briefing(name: str, mcp_call, session_state: dict) -> str:
    """Build a comprehensive entity briefing."""
    # 1. Resolve + properties
    entity = await mcp_call("elemental_get_entity", {
        "entity": name,
        "properties": [
            "country", "ticker_symbol", "total_revenue", "net_income",
            "total_assets", "industry", "lei", "company_cik"
        ]
    })
    if not entity.get("entity"):
        return f"Could not resolve entity: {name}"

    e = entity["entity"]
    neid = e["neid"]
    report_parts = [f"# {e['name']}", f"Type: {e.get('flavor', 'unknown')}"]

    # 2. Format properties (handling nindex resolution)
    if e.get("properties"):
        schema = await mcp_call("elemental_get_schema", {"flavor": e.get("flavor", "")})
        ptypes = build_property_type_map(schema)
        props = await format_properties(e["properties"], ptypes, mcp_call)
        for k, v in props.items():
            report_parts.append(f"- {k}: {v}")

    # 3. Key relationships
    for related_flavor, label in [("person", "Key People"), ("organization", "Related Orgs")]:
        related = await mcp_call("elemental_get_related", {
            "entity_id": {"id": neid, "id_type": "neid"},
            "related_flavor": related_flavor,
            "limit": 10
        })
        if related.get("relationships"):
            report_parts.append(f"\n## {label}")
            for r in related["relationships"]:
                types = ", ".join(r.get("relationship_types", []))
                report_parts.append(f"- {r['name']} ({types})")

    # 4. Recent events
    events = await mcp_call("elemental_get_events", {
        "entity_id": {"id": neid, "id_type": "neid"},
        "limit": 10
    })
    if events.get("events"):
        report_parts.append("\n## Recent Events")
        for ev in events["events"]:
            props = ev.get("properties", {})
            date = props.get("date", {}).get("value", "")
            cat = props.get("category", {}).get("value", "")
            desc = props.get("description", {}).get("value", ev["name"])
            report_parts.append(f"- [{date}] {cat}: {desc}")

    return "\n".join(report_parts)
```

### Fetch events correctly

Always use `elemental_get_events`. Never try to find events by scanning
property names or PID names for keywords like "event" or "filing".

```python
# CORRECT — use the dedicated events tool
events = await mcp_call("elemental_get_events", {
    "entity": "Intel",
    "categories": ["Regulatory Action", "Acquisition"],
    "time_range": {"after": "2025-01-01"},
    "include_participants": True
})

# WRONG — do NOT scan properties/PIDs for event-like names
# This matches "filed" (a document relationship), not actual events
schema = await mcp_call("elemental_get_schema", {"flavor": "organization"})
event_pids = [p for p in schema["properties"] if "event" in p["name"]]  # BAD
```

### Fetch related entities with properties

```python
# Get board members with their titles and nationalities
board = await mcp_call("elemental_get_related", {
    "entity": "JPMorgan Chase",
    "related_flavor": "person",
    "relationship_types": ["board_member_of", "is_officer"],
    "related_properties": ["title", "nationality"],
    "limit": 30
})

for person in board.get("relationships", []):
    name = person["name"]
    title = person.get("properties", {}).get("title", {}).get("value", "")
    print(f"{name} — {title}")
```

---

## Common Properties & Relationships Quick Reference

Use `elemental_introspect` to discover what's actually populated for a
given flavor. Use `elemental_get_schema` for the full property list. The
tables below are a starting-point cheat sheet — not exhaustive.

### Properties by flavor

| Flavor                 | Common properties                                                                                                                               |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `organization`         | `country` (nindex), `ticker_symbol`, `total_revenue`, `net_income`, `total_assets`, `industry` (nindex), `lei`, `company_cik`, `ein`, `website` |
| `person`               | `nationality` (nindex), `title`, `birth_date`, `gender`                                                                                         |
| `government_body`      | `country` (nindex), `jurisdiction`                                                                                                              |
| `article`              | `headline`, `published_date`, `source`, `url`                                                                                                   |
| `event`                | `category`, `date`, `description`, `likelihood`                                                                                                 |
| `financial_instrument` | `ticker_symbol`, `exchange`, `currency`                                                                                                         |

Properties marked `(nindex)` are entity references — their raw value is
a NEID that must be resolved to a display name. See "The Property Type
Problem" above.

### Relationship types and direction

The `direction` parameter on `elemental_get_related` controls traversal.
Getting it wrong returns zero results with no error.

| Relationship      | Meaning                       | Direction from center           |
| ----------------- | ----------------------------- | ------------------------------- |
| `board_member_of` | Person sits on org's board    | `"incoming"` when center is org |
| `is_officer`      | Person is an officer of org   | `"incoming"` when center is org |
| `subsidiary_of`   | Org is a subsidiary of parent | `"outgoing"` from subsidiary    |
| `owns`            | Entity owns another entity    | `"outgoing"` from owner         |
| `appears_in`      | Entity mentioned in article   | `"both"` is usually safest      |
| `participant`     | Entity participates in event  | `"both"` is usually safest      |
| `filed`           | Org filed a document          | `"outgoing"` from org           |
| `works_at`        | Person works at org           | `"outgoing"` from person        |

> **Tip:** If you're unsure about direction, use `"both"` (the default)
> first and check the results. Then narrow to `"incoming"` or
> `"outgoing"` once you know which way the edges point. You can also use
> `elemental_get_relationships` to see all relationship types and counts
> between two specific entities.

> **Tip:** Use `elemental_introspect(flavor="organization")` to see which
> properties and relationships are actually populated with data and their
> fill rates. This prevents building features against empty data.

---

## Anti-Patterns

These are mistakes previous agents have made. Do not repeat them.

1. **Do not substring-match PID names to find events or filings.**
   PIDs like `"filed"` are document relationship IDs, not event timestamps.
   Use `elemental_get_events` for events.

2. **Do not render raw NEID values in user-facing text.** If a property
   value looks like a large number (`5816460566439750832`), it's probably
   a `nindex` reference. Check the schema.

3. **Do not skip schema lookup.** Property types are not guessable from
   names alone. `"country"` looks like it should be a string, but it's
   an `nindex` (entity reference). Always call `elemental_get_schema`
   at least once per flavor.

4. **Do not return thin briefings.** When a user asks "tell me about
   Intel," they expect a comprehensive research report — not a single
   paragraph. Chain entity + related + events into a thorough response.

5. **Do not fabricate citation refs.** Only include `[ref_...]` markers
   when the `ref` field is actually present in the tool response data.
   The client renders these as numbered citations with source links.

6. **Do not pass raw `McpToolset` when the spec calls for custom tools.**
   If DESIGN.md describes named tools (e.g. `entity_search`,
   `corporate_structure`, `event_monitor`), each must be a Python
   function that calls MCP internally. Passing `McpToolset` as the
   agent's only tool source means: no Markdown report formatting, no
   session-state caching, no property type resolution (`data_nindex`
   values render as raw NEIDs), no compound cache keys, and no error
   boundaries. The LLM gets raw JSON and hallucinates when responses
   are large. `McpToolset` passthrough is acceptable for quick
   prototypes but not for production agents with a defined tool suite.

---

## Citation Handling

Property values may include a `ref` field (e.g. `"ref_a3f2b1c8"`). When
building user-facing text, include the ref in brackets after the fact:

```
Revenue was $52.9B [ref_a3f2b1c8]
```

The chat UI translates these into numbered source citations. Rules:

- Only include refs that are present in the actual response data
- Copy the ref string exactly — never construct or modify refs
- Omit the bracket when no ref is present for a value
