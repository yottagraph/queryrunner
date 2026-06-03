# QueryRunner

## Vision

Runs test queries against the Lovelace Knowledge Graph. Each query is a
**plaintext, human-language question** (e.g. "What is the official name of
Apple?", "How many entities are linked to JP Morgan?"). Each question is
answered by an **app-hosted agent** that navigates the graph, and returns
**one structured value** that can be pass/fail validated deterministically.
Runs many queries and produces a pass-rate metric over time, with full
agent/MCP navigation traces captured alongside each query for debugging and
optimisation.

## Execution model

```
plaintext question
  → query_runner_agent (Gemini 2.5 Flash, Vertex Agent Engine)
     → elemental-query MCP server (schema / resolve / search / retrieve / traverse)
        → Elemental Query Server (Portal Gateway)
  → agent returns JSON {"answer": <string|number>, "reasoning": ...}
  → deterministic judge vs the query's `expected` → pass / fail
  → full trace (every MCP call + response) persisted + returned inline
```

Why this shape:

- **Plaintext in, structured out.** The question is free-form, but the answer
  is one value, so judging is deterministic — every query is pass/fail.
- **One MCP toolset.** All graph access flows through the `elemental-query`
  MCP server, so the agent's tool-call trace is a complete record of how it
  navigated the graph. That trace is the primary debugging/optimisation
  artifact.

## Components

### `agents/query_runner_agent/` — the answering agent

ADK agent (`gemini-2.5-flash`, override via `QUERY_AGENT_MODEL`) wired to the
`elemental-query` MCP server via `McpToolset`
(`StreamableHTTPConnectionParams`). Its instruction enforces the JSON answer
contract and graph-navigation discipline (resolve entities first, discover
properties via the schema tools, never emit raw NEIDs). A boot-time
`_probe_mcp_tools()` logs the registered tool count so a misconfigured MCP URL
is obvious in logs. MCP URL resolves from `QUERY_MCP_URL` or
`broadchurch.yaml mcp.elemental-query`; for a Cloud Run URL it mints a Google
ID token for IAM auth. Deploy with `/deploy_agent`.

### `mcp-servers/elemental-query/` — the tool surface

FastMCP server mirroring the Elemental API, the unit we iterate on. Logic
lives in `elemental.py` (testable without an MCP session); `server.py` wraps
it with `@mcp.tool()`. Tools:

- **Schema (the hard part of navigation):** `list_entity_types`,
  `get_entity_type_schema(flavor)`, `search_properties(query)`,
  `get_property_detail(name)`. The graph has ~58 entity types and ~900
  properties, so the schema is exposed _navigably_ (list types → scope
  properties to a type → fuzzy-find a property) rather than dumped wholesale.
- **Resolution / search / retrieval:** `resolve_entity`,
  `get_entity_properties` (resolves reference values to names, dedups),
  `find_entities` (expression language), `count_linked_entities`,
  `get_entity_name`, `health`.

Config comes from env (`GATEWAY_URL` + `TENANT_ORG_ID` + `QS_API_KEY`, or
`ELEMENTAL_API_URL`) or `broadchurch.yaml`. Deploy with `/deploy_mcp`.

The server speaks **Streamable HTTP** on the `/mcp` endpoint (not legacy SSE)
to match the agent's `StreamableHTTPConnectionParams`; a transport mismatch
leaves the agent with zero tools and raises no error. `QUERY_MCP_URL` must
therefore end in `/mcp`. The `test_elemental.py` / `test_server.py` suites
cover the tool logic and registration offline, and the agent's
`test_query_runner_agent.py` boots this server and asserts the toolset
connects end to end.

### `server/utils/queryAgent.ts`

Resolves the agent id for the active hosting mode (`NUXT_QUERY_AGENT_ID`
override → ADK app name on `gke` → portal tenant-config lookup by name on
`agent_engine`), runs the agent on one question capturing the full trace
(reuses `callAgent`, which now also captures tool-call **responses**), parses
the `answer` value, and judges it deterministically (`judgeAnswer`).

### `server/utils/queryTraceStore.ts` + `server/api/queryrunner/*`

`execute.post.ts` runs one query end to end and returns a `QueryResult` with
the trace inline. Full traces persist to **Postgres** (`query_traces` table)
when configured; `trace.get.ts` reads one on demand and `trace-status.get.ts`
reports storage availability. Persistence degrades gracefully: with no
Postgres, traces are still available inline for the current session.

### `composables/useQueryRunner.ts`

Owns the catalog (`queryrunner-catalog`) and a lightweight run history
(`queryrunner-history`) in user prefs. Run results are persisted **without**
their heavy `trace` (those go to Postgres), keeping prefs within budget while
the over-time pass-rate metric keeps working everywhere.

### Pages / components

- `pages/index.vue` — dashboard: catalog count, latest/all-time pass rate,
  trend sparkline, latest-run table (with MCP call counts), recent runs.
- `pages/queries.vue` — catalog CRUD over plaintext questions + expected
  answers; per-row run with an inline agent-trace dialog.
- `pages/runs.vue` / `pages/runs/[id].vue` — run history; the detail page has
  expandable per-query rows that load the full MCP navigation trace on demand.
- `components/QueryEditDialog.vue` — question + expected-answer editor.
- `components/QueryTraceViewer.vue` — renders a trace as an Agent ⟷ MCP
  **call flow**: each tool call shows its exact args + response (expandable)
  plus per-call timing — a waterfall bar (offset + duration) so reasoning gaps
  between calls are visible. Also shows the parsed answer, reasoning, and raw
  agent output. Per-call timing comes from each ADK `function_call` /
  `function_response` event (the event's own `timestamp`, falling back to the
  server-observed time); offsets are anchored to the first tool call. Traces
  captured before timing existed render the flow without bars.
- `components/QueryResultChip.vue`, `QueryRunnerNav.vue`, `PassRateSparkline.vue`.

## Expected-answer judging

`AnswerExpectation` is intentionally small and deterministic:

- `string` — `exact` / `iexact` / `icontains`.
- `number` — equals with optional `tolerance`.
- `number_range` — `min` / `max` bounds.

A run that returns no parseable JSON answer is recorded as an **error** (a
harness problem to fix), distinct from a content **fail**.

## Deployment order

1. `/deploy_mcp` the `elemental-query` server; note its Cloud Run URL.
2. Set `QUERY_MCP_URL` (or `mcp.elemental-query` in `broadchurch.yaml`) for the
   agent, then `/deploy_agent` the `query_runner_agent`.
3. Push the UI to deploy the web app. Optionally set `NUXT_QUERY_AGENT_ID` to
   skip agent discovery, and provision Cloud SQL to retain traces across
   sessions.
