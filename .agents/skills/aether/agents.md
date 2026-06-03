# Agent Development (Google ADK)

This project supports developing and deploying AI agents alongside the UI. Agents live in the `agents/` directory. How they deploy depends on `agent.hosting` in `broadchurch.yaml`: BC 2.0 tenants with the agent capability (`agent.hosting: gke`) **auto-deploy on push to `main`** — the same push that ships the UI; Agent Engine tenants deploy via the `/deploy_agent` command. See [§ Deployment](#deployment) and [§ Hosting modes](#hosting-modes-agent-engine-vs-in-cluster-gke-adr-021).

## Starter agent

`agents/example_agent/` is a working starter agent that queries the Elemental
Knowledge Graph. It includes schema discovery, entity search, property lookup,
and optional MCP server integration. Use it as a starting point — customize the
instruction, add tools, and follow the patterns described below.

## Agent vs job vs MCP server — which primitive?

If you find yourself adding a batch loop or a tool-calling abstraction inside
an agent, stop — a different primitive is probably the better fit:

- **Agent** (this file): conversational, long-lived, runs in Vertex AI Agent
  Engine. Right for chat, multi-turn reasoning, or "answer with reasoning"
  endpoints.
- **Compute job** ([`compute.md`](compute.md)): container that runs and
  exits. Right for cron, batch enrichment, sharded fan-out, or anything
  that takes longer than a Vercel function's 60s ceiling.
- **MCP server** ([`mcp-servers.md`](mcp-servers.md)): exposes tools agents
  can call. Right when you want the platform's other agents (incl. the
  Cursor / Claude Code coding agent) to be able to call your custom tool
  programmatically.

The three coexist: agents can invoke jobs via `POST /jobs/<name>/run`;
jobs can invoke agents via the Agent Engine API; agents can call MCP
servers as tools.

## Directory Structure

Each agent is a self-contained Python package. **Directory names must use underscores, not hyphens** (ADK uses the directory name as a Python identifier).

```
agents/my_agent/            # Underscores only! "my-agent" will NOT work.
├── __init__.py             # Required (can be empty)
├── agent.py                # Required: must export root_agent
├── requirements.txt        # Required: must include google-adk
└── .env                    # Optional: local env vars (git-ignored)
```

## Writing an Agent

Agents use the [Google Agent Development Kit (ADK)](https://google.github.io/adk-docs/). The core pattern:

```python
from google.adk.agents import Agent

def my_tool(query: str) -> dict:
    """Tool docstrings become the LLM's understanding of what the tool does.
    Be specific about parameters and return values."""
    # Tool implementation
    return {"result": "..."}

root_agent = Agent(
    model="gemini-2.5-flash",
    name="my_agent",
    instruction="Clear instructions about the agent's purpose and capabilities.",
    tools=[my_tool],
)
```

Key rules:

- The `agent.py` file MUST export a variable named `root_agent`
- Tool functions should have detailed docstrings -- the LLM reads these to understand when and how to use each tool
- Use `google-adk` for the agent framework, `httpx` for HTTP calls
- Pin dependency versions in `requirements.txt` for reproducible deployments

For agents that call the **Elemental API** (`broadchurch_auth`, endpoints,
local `ELEMENTAL_*` env vars), see [agents-data.md](agents-data.md) in this skill. For agents
using **Elemental MCP tools**, [agents-data.md](agents-data.md) also covers
`McpToolset` wiring — use `StreamableHTTPConnectionParams` (not
`SseConnectionParams`) and read the `elemental-mcp-patterns` skill for
response handling patterns.

## Local Testing

Test agents locally before deploying. Run `adk web` from the `agents/`
directory (NOT from inside the agent folder — ADK discovers agents by
scanning subdirectories):

```bash
cd agents/                  # The PARENT of your agent directories
pip install -r my_agent/requirements.txt

# Required: tell ADK to use Vertex AI for Gemini
export GOOGLE_CLOUD_PROJECT=broadchurch
export GOOGLE_CLOUD_LOCATION=us-central1
export GOOGLE_GENAI_USE_VERTEXAI=1

adk web                     # Opens browser UI at http://127.0.0.1:8000/dev-ui/
```

Select your agent from the dropdown in the web UI. You can also run a single agent directly: `adk run my_agent/`

`broadchurch_auth.py` lives at the `agents/` root, so it's importable
during local dev (agents/ is the CWD → on sys.path). At deploy time, the
workflow copies it into the agent directory alongside `broadchurch.yaml`.

In production, all Elemental API calls go through the Portal Gateway at
`{gateway_url}/api/qs/{org_id}/...`. The agent sends `X-Api-Key` (from
`broadchurch.yaml`) and the portal injects its own Auth0 M2M token
upstream. This keeps QS credentials out of agents entirely and gives the
platform a per-tenant kill switch.

**Important:** Always use the try/except import pattern shown above. ADK
wraps agent code in a package at deploy time, so absolute imports fail at
runtime in Agent Engine — the relative import fallback is required.

## Deployment

**GKE-hosted agents (`agent.hosting: gke`) deploy on push — no command
needed.** Pushing `agents/**` (or `broadchurch.yaml`) to `main` matches
`deploy-agent.yml`'s path filter, which builds the agent container, pushes
it to the per-tenant Artifact Registry, and hands off to the Portal →
ArgoCD rolls it into the cluster. This is the same `git push origin main`
that deploys the UI, so a normal build-and-push delivers UI **and** agent
with zero extra steps. (The agent typically goes green a few minutes after
the UI.) You can still trigger it explicitly two ways:

1. **Portal UI** -- Open the project in the Broadchurch Portal. It scans
   `agents/` in your GitHub repo and shows agents with a Deploy button.
2. **Cursor command** -- Run `/deploy_agent`. It reads `broadchurch.yaml`
   and dispatches the same workflow.

**Agent Engine-hosted agents (`agent.hosting` unset / `agent_engine`) do
NOT auto-deploy on push** — use the Portal Deploy button or `/deploy_agent`
to ship them. The deploy command/button picks the right target
automatically from `agent.hosting` (see [§ Hosting modes](#hosting-modes-agent-engine-vs-in-cluster-gke-adr-021)):
for `gke` it builds a container running `adk api_server`; for
`agent_engine` it runs `adk deploy agent_engine`. Either way the agent is
registered with the Portal Gateway on success.

Manual CLI deployment (advanced):

```bash
adk deploy agent_engine \
  --project <from broadchurch.yaml> \
  --region <from broadchurch.yaml> \
  --staging_bucket <from broadchurch.yaml> \
  --display_name "<agent-name>" \
  --trace_to_cloud \
  agents/<agent-name>/
```

## Hosting modes: Agent Engine vs in-cluster GKE (ADR-021)

An agent runs in one of two places, controlled by `agent.hosting` in
`broadchurch.yaml`:

| `agent.hosting`            | Runtime                                                 | When                                                           |
| -------------------------- | ------------------------------------------------------- | -------------------------------------------------------------- |
| _(unset)_ / `agent_engine` | Vertex AI Agent Engine (managed)                        | BC 1.0 tenants and BC 2.0 tenants without the agent capability |
| `gke`                      | In-cluster ADK `api_server` on the tenant's GKE cluster | BC 2.0 tenants provisioned with the `agent` capability         |

**The agent code you write is identical either way** — a `root_agent` in
`agents/<name>/agent.py` (see below). The deploy command (`/deploy_agent`
or the Portal Deploy button) and the `deploy-agent.yml` workflow pick the
right target automatically based on `agent.hosting`. For `gke`, the
workflow builds a container that runs `adk api_server` and ships it to the
tenant's cluster via GitOps; there is no Agent Engine resource.

**The built-in `/chat` page works automatically in both modes.** It calls
the hosting-agnostic `GET /api/agents` to discover agents and
`POST /api/agent/{agentId}/stream` to talk to them — the Nitro server
resolves the backend for you. You do **not** need to special-case hosting
in UI code.

What differs is the **agent identifier** used as `{agentId}`:

- `agent_engine`: the Vertex `engine_id` (a numeric resource ID).
- `gke`: the ADK **app name**, which is the **agent directory name** (e.g.
  `example_agent`). ADK's `api_server` discovers apps by scanning
  subdirectories, so the directory name is the public handle. Keep it
  underscore-cased and descriptive.

The in-cluster agent is reachable only from inside the cluster, at
`http://aether-agent.tenant-agent.svc.cluster.local` (the Nitro server
uses this via the server-only `NUXT_AGENT_BASE_URL`; the browser never
calls it directly). Custom UIs should always go through
`POST /api/agent/{agentId}/stream` and `GET /api/agents` rather than
hardcoding the cluster URL.

## How Agents Reach the App

For Agent-Engine-hosted agents, the app talks to Agent Engine directly —
the portal is only in the auth path:

```
Browser → Tenant Nitro Server (POST /api/agent/:agentId/stream)
  → Portal /authorize (gets short-lived tenant SA token, cached 15 min)
  → Agent Engine :streamQuery (direct, single hop)
  → Agent runs (may invoke tools, make multiple LLM calls)
  → Nitro re-emits ADK events as clean SSE to the browser
```

The gateway URL and tenant ID come from `broadchurch.yaml` (injected as
`NUXT_PUBLIC_GATEWAY_URL` and `NUXT_PUBLIC_TENANT_ORG_ID`). The token is
minted for the tenant's GCP service account via SA impersonation.

### Agent Discovery

> **Hosting-agnostic discovery (preferred):** call `GET /api/agents`, which
> returns `{ agents: [{ id, name }] }` and resolves the backend for you
> (`/list-apps` on the in-cluster `api_server` for `gke`, or the portal
> config below for `agent_engine`). The built-in `/chat` page uses this.
> The `id` it returns is exactly what you pass as `{agentId}` to
> `/api/agent/{agentId}/stream`. Use the portal-config route below only
> when you specifically need Agent-Engine metadata (`engine_id`, etc.).

> **`{ agents: [] }` is a normal state, not an error.** A `200` with an
> empty array means "no agent registered **yet**" — common in the window
> between pushing `agents/**` and the GKE deploy finishing (a few minutes),
> or before `/deploy_agent` runs on Agent Engine. It is **indistinguishable
> from a healthy idle tenant**, so do NOT treat an empty list as "the
> cluster is unreachable" or "the URL is wrong." A genuine connectivity
> failure is a thrown error / non-2xx from `GET /api/agents`, not an empty
> array. Render an empty list as a friendly "no agents deployed yet" state
> and let it fill in on the next poll.

For Agent-Engine tenants, the app can also discover deployed agents by
fetching the tenant config directly:

```
GET {NUXT_PUBLIC_GATEWAY_URL}/api/config/{NUXT_PUBLIC_TENANT_ORG_ID}
```

The response includes an `agents` array:

```json
{
  "agents": [
    { "name": "filing_analyst", "display_name": "Filing Analyst", "engine_id": "1234567890" },
    { "name": "research_bot", "display_name": "Research Bot", "engine_id": "0987654321" }
  ],
  "features": { "chat": true, ... },
  ...
}
```

Each agent entry has:

| Field          | Type     | Description                                                                   |
| -------------- | -------- | ----------------------------------------------------------------------------- |
| `name`         | `string` | Agent directory name (e.g. `filing_analyst`)                                  |
| `display_name` | `string` | Human-readable name for the UI                                                |
| `engine_id`    | `string` | Vertex AI Agent Engine resource ID — used as `{agentId}` in query/stream URLs |

The `engine_id` is the key value — it becomes the `{agentId}` path
parameter in `/api/agent/{agentId}/stream` (the local Nitro route) and
the portal's `/authorize` endpoint.

**How agents get populated:** The portal discovers agents from two sources:

1. **Firestore** — agents registered by the deploy workflow (`deploy-agent.yml`
   calls `POST /api/agents/{tenantId}` to register)
2. **Agent Engine API** — the portal also queries Vertex AI for reasoning
   engines whose display name starts with the project name (e.g.
   `my-project--filing_analyst`), catching agents that were deployed but
   not yet registered

Both sources are merged and deduplicated by name. If the config endpoint
returns an empty `agents` array, no agents have been deployed yet.

Use `useTenantConfig()` to fetch this config from Vue code:

```typescript
import { useTenantConfig } from '~/composables/useTenantConfig';

const { config, fetchConfig } = useTenantConfig();
await fetchConfig();

const agents = config.value?.agents ?? [];
const agentId = agents[0]?.engine_id; // use as {agentId} in query URLs
```

### Streaming via the Local Nitro Route

The `useAgentChat` composable calls `POST /api/agent/:agentId/stream` (the
local Nitro route). This route handles token acquisition, session creation,
and SSE parsing — the browser just sees clean Server-Sent Events.

### Calling an agent from a server route

For server-side, one-shot agent calls — the canonical BC 2.0 pattern of
"call an agent, get its final answer, then store/process it" — use
`callAgent()` from [`~/server/utils/agentCall.ts`](#). **Do not** hand-roll
the `/authorize` → session → stream-drain dance; `callAgent()` is the
hosting-aware (`gke` and `agent_engine`) request/response wrapper that
mirrors `POST /api/agent/:agentId/stream` exactly and returns the agent's
final text plus the tool calls it made:

````typescript
// server/api/<feature>.post.ts
import { callAgent, extractFencedJson } from '~/server/utils/agentCall';

const { text, sessionId, toolCalls, hosting } = await callAgent({
    agentId: 'insights', // ADK app name (gke) or engine_id (agent_engine)
    message: `Look up and analyse: ${names.join(', ')}`,
    // userId?, sessionId? (to continue a thread), timeoutMs? (default 4 min)
});

// For structured output, instruct the agent to end its reply with one
// fenced ```json block, then parse it deterministically (ALWAYS null-check):
const payload = extractFencedJson(text) as { entities: Entity[] } | null;
````

`callAgent()` and `extractFencedJson()` are auto-imported in server routes
(Nitro auto-imports `server/utils`); the explicit import above also works.
The low-level ADK parsing primitives both this helper and the streaming
route share live in `~/server/utils/adkEvents.ts`. For the full
agent → JSON → BigQuery recipe (incl. batch insert), see
[`bigquery.md` § Cookbook](bigquery.md#cookbook-agent--structured-json--bigquery-the-canonical-bc-20-flow).

### ADK Event Stream Format

The `events` array contains one object per step the agent took. Each event
has `content.parts[]` where each part is one of:

```json
{ "text": "The agent's text response..." }
{ "functionCall": { "name": "search", "args": { "q": "AAPL" } } }
{ "functionResponse": { "name": "search", "response": { "results": [...] } } }
```

A typical stream for an agent that uses a tool:

```json
[
    {
        "content": {
            "parts": [{ "functionCall": { "name": "search", "args": { "q": "AAPL 8-K" } } }],
            "role": "model"
        }
    },
    {
        "content": {
            "parts": [
                { "functionResponse": { "name": "search", "response": { "results": ["..."] } } }
            ],
            "role": "tool"
        }
    },
    {
        "content": {
            "parts": [{ "text": "Here is the summary of the 8-K filing..." }],
            "role": "model"
        }
    }
]
```

The final text is the last `text` part that isn't in a `functionCall` or
`functionResponse` event. Events may also arrive as JSON strings rather
than objects — always handle both.

### Parsing Agent Responses (Non-Streaming)

For non-streaming use cases (e.g. extracting text from a buffered response),
use `extractAgentText`:

```typescript
import { extractAgentText } from '~/composables/useAgentChat';
const text = extractAgentText(response.output);
```

`extractAgentText` handles: plain strings, ADK event stream arrays (with
JSON-string or object elements), single event objects, and several legacy
Agent Engine response shapes. It skips `functionCall` / `functionResponse`
events and returns the agent's final text.

### Streaming SSE Events

The local Nitro route (`POST /api/agent/:agentId/stream`) returns
Server-Sent Events. The `useAgentChat` composable handles these
automatically.

SSE event types:

| Event               | Data Shape                               | Description                                                              |
| ------------------- | ---------------------------------------- | ------------------------------------------------------------------------ |
| `text`              | `{ "text": "..." }`                      | Agent text output (replaces previous text)                               |
| `function_call`     | `{ "name": "...", "args": {...} }`       | Agent is calling a tool                                                  |
| `function_response` | `{ "name": "...", "response": {...} }`   | Tool returned a result                                                   |
| `error`             | `{ "message": "...", "code": "..." }`    | Error during processing (`code` is `PERMISSION_DENIED` for IAM failures) |
| `done`              | `{ "session_id": "...", "text": "..." }` | Stream complete with final text                                          |

For custom agent UIs that need streaming, import `readSSE`:

```typescript
import { readSSE } from '~/composables/useAgentChat';

const res = await fetch(streamUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Hello' }),
});

for await (const { event, data } of readSSE(res)) {
    if (event === 'text') console.log('Agent says:', data.text);
    if (event === 'function_call') console.log('Calling:', data.name);
    if (event === 'done') console.log('Session:', data.session_id);
}
```

The `done` event always includes the final extracted text, so you don't
need to track text deltas yourself.

## useAgentChat Gotcha — Vue Reactivity

When building a chat UI with `useAgentChat`, do NOT hold a local reference
to a message object after pushing it into the `messages` array. Vue's
reactivity only tracks mutations made through the reactive Proxy — writes
to the original plain object are invisible to the template.

```typescript
// WRONG — local ref bypasses Vue's reactivity, UI won't update:
const msg: ChatMessage = { id: '...', role: 'agent', text: '', streaming: true };
messages.value.push(msg);
msg.text = 'hello'; // data changes, but Vue doesn't know
msg.streaming = false; // template still shows typing indicator

// CORRECT — access through the reactive array:
messages.value.push({ id: '...', role: 'agent', text: '', streaming: true });
const idx = messages.value.length - 1;
messages.value[idx].text = 'hello'; // Vue detects this
messages.value[idx].streaming = false; // template re-renders
```

The `useAgentChat` composable uses the correct pattern internally (via an
`updateAgent()` helper that writes through the array index). If you build a
custom chat composable or modify `sendMessage`, follow the same approach.

## Agent Design Guidelines

- Keep agents focused: one agent per domain or task type
- Write clear, specific instructions -- the LLM follows them literally
- Tool docstrings are critical: they're the LLM's API documentation
- Handle errors gracefully in tools: return error messages, don't raise exceptions
- Use `get_schema` as a discovery tool so the agent can learn about entity types at runtime

## Agent Tool Design

LLMs are better at parsing prose than nested JSON. The difference between
a tool that works reliably and one that confuses the agent often comes down
to how the tool formats its output. Follow these principles:

### Runtime invariants for data-heavy agents

These are generic constraints that improve reliability across graph-backed
agents (MCP or REST-backed):

- **Resolve entities before domain fan-out.** For user prompts about named
  entities, do explicit entity resolution first, then run domain-specific
  retrieval (events, filings, relationships, sanctions, etc.).
- **Use internal IDs only for precision.** Keep stable IDs (NEID/EID/etc.)
  in tool calls and state, but do not expose raw internal IDs in
  user-facing prose unless the user explicitly asks for them.
- **Prefer canonical APIs over heuristic parsing.** For domain concepts
  like events, use the dedicated API/tool and its typed fields; do not infer
  semantics from property name substring matching.
- **Separate gather from synthesize.** Retrieval tools should gather and
  format reliable intermediate outputs; the final user answer should be
  composed after all relevant tool outputs are available.

### Return formatted strings, not raw JSON

This applies to ADK agent tools, where the LLM reads tool output directly.
MCP server tools follow different conventions (structured dicts/lists) — see
[mcp-servers.md](mcp-servers.md).

The agent's LLM will try to interpret whatever the tool returns. Raw API
responses with nested dicts, numeric IDs, and arrays of unlabeled values
create unnecessary interpretation burden.

```python
# BAD — raw API response overwhelms the LLM:
def lookup_entity(name: str) -> dict:
    resp = elemental_client.get(f"/entities/lookup?entityName={name}&maxResults=5")
    resp.raise_for_status()
    return resp.json()  # {"results": [{"neid": "00416400910670863867", ...}]}

# GOOD — formatted string the LLM can immediately use:
def lookup_entity(name: str) -> str:
    """Look up an entity by name. Returns entity name, ID, and type."""
    try:
        resp = elemental_client.get(f"/entities/lookup?entityName={name}&maxResults=5")
        resp.raise_for_status()
        data = resp.json()
        results = data.get("results", [])
        if not results:
            return f"No entities found matching '{name}'."
        lines = []
        for r in results[:5]:
            lines.append(f"- {r.get('name', 'Unknown')} (ID: {r.get('neid', '?')}, Type: {r.get('type', '?')})")
        return f"Found {len(results)} result(s) for '{name}':\n" + "\n".join(lines)
    except Exception as e:
        return f"Error looking up '{name}': {e}"
```

### Catch all exceptions — never let errors propagate

`raise_for_status()` without a try/catch will crash the tool and produce an
opaque error in the agent's event stream. Always catch exceptions and return
a descriptive error string.

```python
# BAD — unhandled exception kills the tool call:
def get_data(neid: str) -> dict:
    resp = elemental_client.post("/elemental/entities/properties", data={...})
    resp.raise_for_status()
    return resp.json()

# GOOD — agent gets a useful error message it can relay to the user:
def get_data(neid: str) -> str:
    """Get properties for an entity by its NEID."""
    try:
        resp = elemental_client.post("/elemental/entities/properties", data={...})
        resp.raise_for_status()
        # ... format results ...
        return formatted_output
    except Exception as e:
        return f"Error fetching data for {neid}: {e}"
```

### Pre-resolve known entities for focused agents

If your agent tracks specific companies, people, or assets, hardcode their
NEIDs instead of requiring a lookup step. This eliminates a fragile
search-then-resolve flow.

```python
TRACKED_COMPANIES = {
    "Apple": "00416400910670863867",
    "Tesla": "00508379502570440213",
    "Microsoft": "00112855504880632635",
}

def get_company_info(company_name: str) -> str:
    """Get current information about a tracked company.
    Available companies: Apple, Tesla, Microsoft."""
    neid = TRACKED_COMPANIES.get(company_name)
    if not neid:
        return f"Unknown company '{company_name}'. Available: {', '.join(TRACKED_COMPANIES)}"
    # ... fetch and format properties using the known NEID ...
```

### Combine multi-step API flows into single tools

The fewer tools the agent needs to chain together, the more reliably it
operates. If every query requires lookup → get properties → format, combine
those steps into a single tool.

```python
# BAD — agent must chain 3 tools correctly:
#   1. lookup_entity("Apple") → get NEID
#   2. get_schema() → find property PIDs
#   3. get_property_values(neid, pids) → parse values array

# GOOD — one tool does the full flow:
def get_company_summary(name: str) -> str:
    """Get a summary of a company including name, country, and industry."""
    try:
        neid = resolve_entity(name)
        if not neid:
            return f"Could not find entity '{name}'."
        props = fetch_properties(neid, [NAME_PID, COUNTRY_PID, INDUSTRY_PID])
        return format_company_summary(neid, props)
    except Exception as e:
        return f"Error getting summary for '{name}': {e}"
```

### Two agent archetypes

**General explorer** — uses `get_schema` + `find_entities` +
`get_property_values` with runtime discovery. Good for open-ended
exploration but requires more tool calls and is more error-prone.

**Focused domain agent** — pre-resolves entity IDs, hardcodes relevant PIDs,
returns formatted strings. Fewer tools, more reliable, better for production
use cases. **Prefer this pattern** unless the agent genuinely needs to
explore arbitrary entity types.

### McpToolset passthrough is not a substitute for custom tools

When DESIGN.md specifies named agent tools (e.g. `entity_search`,
`corporate_structure`, `event_monitor`), each must be implemented as a
**Python function** that calls MCP, formats results, and handles errors.
Passing a raw `McpToolset` as the agent's only tool source and writing a
long system prompt does **not** satisfy the spec.

`McpToolset` passthrough means:

- The LLM receives raw JSON responses — no Markdown formatting, no
  human-readable reports
- No session-state caching — repeated queries for the same entity make
  redundant MCP calls every turn
- No property type handling — `data_nindex` values (entity references)
  render as meaningless 19-digit numbers
- No error boundaries — MCP failures surface as opaque tool errors
- No compound cache keys or report generation — the patterns that make
  multi-turn research conversations reliable

`McpToolset` passthrough is fine for **simple exploration agents** or
quick prototypes. It is **not acceptable** when the project spec
describes a production agent with a defined tool suite. If DESIGN.md
lists N custom tools, build N custom Python functions — each calling MCP
tools internally, formatting output as Markdown, catching exceptions,
and saving reports to session state where appropriate.
