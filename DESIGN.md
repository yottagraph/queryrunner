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
  `get_entity_properties` (resolves reference values to names, dedups; see
  provenance below), `find_entities` (expression language),
  `count_linked_entities`, `get_entity_name`, `health`.

`get_entity_properties` returns, alongside each `values` entry, a `details`
entry carrying the chosen fact's provenance (`pid`, `efid`, `attributes`,
`recorded_at`). It does **not** fetch source citations — that's slow and the
agent never needs it.

Rendered source citations are computed **on demand** instead, by
`render_property_citations(neid, properties)`, exposed off the MCP tool surface
as a plain HTTP route (`POST /citations` on the MCP server, registered with
`@mcp.custom_route`). It re-fetches the facts and chains the two QS provenance
endpoints — `POST /elemental/provenance/match` (fact quads → trails) then `POST
/elemental/provenance/render` (trails → citations, with source/subject/url/
excerpts), mirroring moongoose's MCP provenance helper. Doing the rendering in
Python keeps it big-int safe. The UI reaches it through the Nuxt proxy
`POST /api/queryrunner/citations` (server-only `NUXT_QUERY_MCP_URL`), and only
when a result is inspected (see the `/result` page below). Everything degrades
gracefully: an unreachable/unauthorized MCP, or an unmatched source, yields no
citation rather than an error.

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
- `pages/result/[queryId].vue` — full-page view of a single query's result
  (the catalog's MCP-column button links here). Reads the session result from
  the shared `liveResults` state in `useQueryRunner`, renders the full
  `QueryTraceViewer`, and lazily fetches + merges source citations for each
  `get_entity_properties` call via `/api/queryrunner/citations`.
- `components/QueryTraceViewer.vue` — renders a trace as an Agent ⟷ MCP
  **call flow**: each tool call shows its exact args + full (untruncated)
  response (expandable) plus per-call timing — a waterfall bar (offset +
  duration) so reasoning gaps
  between calls are visible. Also shows the parsed answer, reasoning, and raw
  agent output. Per-call timing comes from each ADK `function_call` /
  `function_response` event (the event's own `timestamp`, falling back to the
  server-observed time); offsets are anchored to the first tool call. Traces
  captured before timing existed render the flow without bars. Also renders a
  **Stack logs** section: per-component log windows (UI server, agent, MCP)
  captured for that one query (see `stackLogs` below).
- `components/QueryResultChip.vue`, `QueryRunnerNav.vue`, `PassRateSparkline.vue`.

### Per-query stack logs (`server/utils/stackLogs.ts`)

In local dev the three processes (Nuxt UI, `adk api_server`, `elemental-query`
MCP) each tail their output to a logfile under `QUERYRUNNER_STACK_LOG_DIR`
(default `.aether-dev-logs/`: `ui.log`, `agent.log`, `mcp.log`). `execute`
records each logfile's byte length right before the agent runs and reads
whatever got appended once it returns, so the delta is exactly that query's
lines (queries run serially locally). The result is attached to the trace as
`stackLogs: StackLog[]` and persisted/returned with the rest of the trace. A
missing logfile (e.g. in a deployed environment that ships logs to Cloud
Logging) is simply skipped, so the feature degrades to fewer sources. To wire
it up locally, start each process with stdout/stderr redirected to its logfile
(use `PYTHONUNBUFFERED=1` for the two Python processes so writes flush per
line).

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
