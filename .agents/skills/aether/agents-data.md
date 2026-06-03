# Agents: Elemental API (Query Server)

## Connecting to the Elemental API

Use `broadchurch_auth` for all Elemental API calls. It lives at
`agents/broadchurch_auth.py` and is automatically bundled into each agent
directory at deploy time. It handles:

- Routing through the Broadchurch Portal gateway proxy in production
  (no direct QS credentials needed — the portal handles Auth0 M2M auth)
- Authenticating to the proxy with a per-tenant API key from
  `broadchurch.yaml` (`gateway.qs_api_key`)
- Falling back to `ELEMENTAL_API_URL` + `ELEMENTAL_API_TOKEN` env vars
  for local dev

```python
try:
    from broadchurch_auth import elemental_client
except ImportError:
    from .broadchurch_auth import elemental_client

def get_schema() -> dict:
    """Get the yottagraph schema."""
    resp = elemental_client.get("/elemental/metadata/schema")
    resp.raise_for_status()
    return resp.json()

def find_entities(expression: str, limit: int = 10) -> dict:
    """Search for entities."""
    resp = elemental_client.post("/elemental/find", data={"expression": expression, "limit": str(limit)})
    resp.raise_for_status()
    return resp.json()
```

The try/except is required because the import path differs between local
dev (`agents/` on sys.path → absolute import) and Agent Engine runtime
(code packaged inside an ADK module → relative import).

**Do NOT** hardcode URLs or manually handle auth tokens. Do NOT read
`broadchurch.yaml` directly — `broadchurch_auth` handles all of this.

Key endpoints:

- `GET /elemental/metadata/schema` — entity types and properties
- `POST /elemental/find` — search for entities by expression
- `POST /entities/search` — search for entities by name (batch, scored)
- `POST /elemental/entities/properties` — get entity property values

Requirements for agents using the Elemental API (add to `requirements.txt`):

```
google-auth>=2.20.0
pyyaml>=6.0
```

## Local testing: Elemental API env vars

When testing agents locally with `adk web`, for agents that call the Elemental API:

```bash
export ELEMENTAL_API_URL=https://stable-query.lovelace.ai
export ELEMENTAL_API_TOKEN=<your-token>
```

In production, all Elemental API calls go through the Portal Gateway at
`{gateway_url}/api/qs/{org_id}/...`. The agent sends `X-Api-Key` (from
`broadchurch.yaml`) and the portal injects its own Auth0 M2M token
upstream.

## Agent secrets (DATABASE_URL etc.)

For runtime values that aren't shipped in `broadchurch.yaml` and can't be
sourced from Vercel — most commonly `DATABASE_URL` for tenants whose
Postgres is provisioned via the Vercel Neon integration — use
`get_agent_secret()` from `broadchurch_auth`. It fetches from the portal
at `GET /api/agent-secrets/{org_id}` using the same `X-Api-Key` the agent
already carries, and caches per-process.

```python
try:
    from broadchurch_auth import get_agent_secret
except ImportError:
    from .broadchurch_auth import get_agent_secret

def my_db_tool() -> str:
    db_url = get_agent_secret("DATABASE_URL")
    if not db_url:
        return "DATABASE_URL is not configured for this tenant."
    # ... use db_url ...
```

Resolution order is `os.environ[name]` → portal-stored secret → default.
The env var path means local dev "just works" with `export DATABASE_URL=...`
without touching the portal.

Set values via the portal admin endpoint:

```bash
curl -X PUT $GATEWAY_URL/api/projects/$ORG_ID/agent-secrets \
  -H 'Content-Type: application/json' \
  -d '{"vars": {"DATABASE_URL": "postgresql://..."}}'
```

Secrets are stored encrypted-at-rest in Firestore on the tenant doc.
There is no per-tenant Vercel/Neon integration — when credentials rotate,
push the new value via the same endpoint and let the agent cold-start
pick it up (or call `get_agent_secrets(refresh=True)`).

## MCP-based agents

When the project uses **MCP-only data architecture**, agents access the
knowledge graph through Elemental MCP tools instead of REST. The MCP tools
(`elemental_get_entity`, `elemental_get_related`, `elemental_get_events`,
etc.) handle entity resolution, NEID formatting, and schema lookups
automatically. Use the `data-model` skill docs for entity types,
properties, and relationship schemas.

### Wiring McpToolset (transport class)

The Elemental MCP server uses **Streamable HTTP** transport. Use
`StreamableHTTPConnectionParams` — **NOT** `SseConnectionParams`. The
`SseConnectionParams` class is for older SSE-based MCP servers and will
silently fail against the Elemental server (the agent starts with zero
tools and the LLM hallucinates code).

```python
from google.adk.tools.mcp_tool import McpToolset
from google.adk.tools.mcp_tool.mcp_session_manager import StreamableHTTPConnectionParams

McpToolset(
    connection_params=StreamableHTTPConnectionParams(url=mcp_url)
)
```

Resolve the MCP URL from the environment or `broadchurch.yaml`:

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

For **local dev**, set the env var:

```bash
export ELEMENTAL_MCP_URL="https://mcp.pip.prod.g.lovelace.ai/elemental/mcp"
```

In **production**, the agent reads the gateway URL and org_id from
`broadchurch.yaml` and routes through the Portal MCP proxy, which handles
authentication automatically.

### Silent failure warning

If `McpToolset` cannot connect (wrong transport class, bad URL, or server
down), **the agent starts with zero MCP tools and no error is raised**.
The LLM will then hallucinate tool calls instead of executing real ones.
Always validate the MCP URL at agent startup:

```python
mcp_url = _get_mcp_url()
if not mcp_url:
    raise RuntimeError("No MCP URL — check broadchurch.yaml or ELEMENTAL_MCP_URL env var")
```

### MCP response patterns

**Read the `elemental-mcp-patterns` skill** (`skills/elemental-mcp-patterns/`)
before writing tool code. It covers MCP response shapes, property type
handling (the `data_nindex` problem), and copy-paste Python patterns for
entity resolution, property formatting, events, and relationships.

## Reliability invariants

These constraints reduce failure modes when building graph-aware agents,
whether using REST or MCP:

- **Resolve entities first.** For named-entity questions, do explicit entity
  resolution before deeper property/relationship/event retrieval.
- **Prefer domain endpoints over heuristic matching.** Use dedicated event or
  relationship APIs (`elemental_get_events`, event endpoints) instead of
  inferring semantics from property/PID names. Substring-matching PID names
  for words like "event" or "filing" returns wrong results — PIDs like
  "filed" are document relationship IDs, not event timestamps.
- **Keep IDs internal to tool calls.** Use NEIDs/EIDs internally for precise
  requests, and render human-readable names in user-facing output. Never
  show raw NEIDs to users.
- **Handle reference-typed properties (`data_nindex`).** Some property
  values are entity references (NEIDs), not display text. Use
  `elemental_get_schema` or the data-model skill to check a property's
  type. For `data_nindex` properties (e.g. "country" on an organization),
  resolve the NEID to a display name before rendering. A helper like
  `_pid_types()` that maps PIDs to their schema type is very useful.
- **Treat 404 as not-found data by default.** Validate server health
  separately before classifying these as connectivity failures.
