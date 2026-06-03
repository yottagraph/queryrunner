# Data — Elemental API (platform data source)

**This app is built on the Lovelace platform.** The Query Server is the
primary data source — use it first for any data needs (entities, news,
filings, sentiment, relationships, events). Do NOT call external APIs
(e.g. sec.gov, Wikipedia) for data that the platform already provides.

Tenant-owned analytical data (event streams, derived tables, time-series
features that compute jobs write into the tenant project) lives in
BigQuery, not the Elemental API. For that see [`bigquery.md`](bigquery.md)
— and importantly, do NOT add `@google-cloud/bigquery` or any GCP
credentials to this app. Queries go through the portal gateway.

The Elemental API provides access to the Lovelace Knowledge Graph through
the Query Server. Use it to search for entities, retrieve properties,
explore relationships, and analyze sentiment. New data sources are added
regularly — use the discovery-first pattern to find what's available.

## Choosing the access path — Query Server REST vs MCP

The Lovelace knowledge graph is reachable through **two protocols**, both
fronted by the per-tenant Portal Gateway proxy. They hit the **same**
backend; the choice is about which protocol fits the caller, not which
data source is "better."

| Caller                                                                                                                                 | Use                                                                                                                                                                                                 | Why                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Imperative code** — compute jobs (`jobs/<name>/main.py`), Nitro server routes (`server/api/*.ts`), CLI scripts, batch tooling        | **Query Server REST** via `{GATEWAY_URL}/api/qs/{ORG_ID}/...` with `X-Api-Key` header. From TypeScript, prefer the generated `useElementalClient()` client. From Python, use `httpx` or `requests`. | The caller knows exactly which entities and properties it wants; no LLM-in-the-loop to choose for it. REST gives typed responses, full endpoint coverage (including the `/elemental/find` expression language MCP doesn't expose), and standard HTTP status codes the agent can reason about. |
| **LLM-driven code** — ADK agents on Vertex AI Agent Engine (`agents/<name>/agent.py`); Cursor/Claude Code agents acting inside the IDE | **MCP** via `{GATEWAY_URL}/api/mcp/{ORG_ID}/{server}/mcp` (Streamable HTTP). From ADK, wire it as `McpToolset(connection_params=StreamableHTTPConnectionParams(url=...))`.                          | MCP is a protocol for LLM tool-calling. It earns its keep when the model is discovering tools at runtime, choosing which to call, and consuming prose-shaped responses naturally. Inside an LLM agent loop, MCP is the right fit; outside one, it's overhead.                                 |

The four MCP servers (`elemental`, `stocks`, `wiki`, `polymarket`) are
auto-wired by `init-project.js` in `.agents/mcp.json`. The QS REST surface
is reachable through `broadchurch.yaml`'s `gateway.url` + `tenant.org_id`

- `gateway.qs_api_key` triple (no Auth0 tokens; the gateway proxy injects
  them upstream).

**Note on briefs that say "use MCP for everything":** Treat that as a
statement about the _exposed_ surface — Lovelace is MCP-native from a
buyer perspective, and the gateway is the MCP-shaped front door for the
platform. It's not an _implementation_ prescription for what tenant code
internally calls. Pick the access path per the table above; both routes
go through the same per-tenant gateway with the same auth model, so the
buyer story (per-tenant brokerage, no shared credentials in the tenant)
holds for either choice.

## Before you "fix" an apparent platform outage

When a platform API (Query Server, MCP, Portal Gateway) appears to be
returning errors, **probe the endpoint with curl before you patch the
caller**. The single most common cause of "platform outage" reports
from build agents is the agent itself hitting a non-existent URL and
misreading the resulting `404`, `401`, or HTML body as a server-side
failure.

The smell test:

- **Have you actually observed the failing response?** If you can only
  describe the symptom in terms of the caller's behavior ("the page
  returns a 500", "the composable throws"), you haven't observed the
  failure — you've observed the _consequence_. The 500 might be your
  own code re-raising a 401 from the portal because you forgot to send
  `X-Api-Key`.
- **Are you about to "harden" or short-circuit a working probe?** If
  you're adding a branch that says "if the proxy is configured, treat
  it as healthy" without an HTTP probe, you are about to suppress a
  diagnostic signal. The result is a UI that reports "available" when
  the data plane is broken, which is strictly worse than the original
  bug.
- **Do you have a comment in the new code claiming upstream behavior?**
  Comments like "the proxy sometimes returns noisy 500s on `/status`"
  must be backed by a captured 500 response from _this session_. If
  they aren't, you're speculating, and the next agent will read your
  comment and propagate the speculation.

When any of those apply, **stop and run `/diagnose <url>`** before
making code changes. The command walks you through capturing the
actual request, probing it with curl, and classifying the response
before you touch anything. See [`commands/diagnose.md`](../../commands/diagnose.md)
or, equivalently, the "Interpreting portal-proxy errors" table later
in this file.

For tenant-side TypeScript that actually surfaces platform errors
without inventing explanations, see the
[`utils/apiErrorHandler.ts`](../../utils/apiErrorHandler.ts) helper
shipped with the template — it preserves status, headers, and body
shape on rejection so downstream code can react to the real upstream
response.

## Skill Documentation

For endpoint reference, response shapes, and edge cases, **read the
elemental-api skill** in `.agents/skills/elemental-api/` (start with `SKILL.md` and
follow the skill’s own structure). Files are copied from
`@yottagraph-app/aether-instructions` (installed during project init). If
the directory is missing, run `/update_instructions` to install it.

## Data model skill

For Lovelace **entity types, properties, relationships, and per-source schemas** (EDGAR, FRED, FDIC, etc.), read the **data-model skill** in `.agents/skills/data-model/`. Start with `SKILL.md`, then `overview.md` and the source-specific folders. Both skills are distributed via `@yottagraph-app/aether-instructions` and installed during project init.

## Test Before You Build

**ALWAYS test data access before writing application code.** The Elemental
API has response shapes that differ from what the TypeScript types suggest,
and assumptions about nesting, property formats, and field names will be
wrong without testing.

This section covers **two phases** in order:

1. **Exploration during design** — you're the build agent figuring out
   what data is available, what NEIDs resolve, what property shapes look
   like. **Use MCP tools interactively when available** — they handle
   entity resolution, PID lookups, and NEID formatting automatically, and
   they're discoverable from your IDE tool list. Curl against the QS REST
   surface is the equivalent fallback when MCP tools aren't wired into
   your environment.
2. **Implementation in code** — you're writing the production caller.
   **Use the protocol that fits the caller** per the access-path table
   above: QS REST for compute jobs and server routes; MCP (via
   `McpToolset`) for ADK agents.

The point of the exploration phase is to ground your code in real
response shapes, not to set the protocol for production. A common
mistake is "I explored via MCP, therefore my batch job should also call
MCP." It shouldn't — the batch job knows what it wants, the LLM-tool
protocol is overhead for it.

### Step 1: MCP tools (interactive exploration during design)

**If MCP tools appear in your tool list, start here for exploration.**
MCP handles entity resolution, PID lookups, and NEID formatting
automatically — use it to verify what data exists and how it's
structured. The Python/TypeScript code you eventually write may call MCP
(if it's an ADK agent) or QS REST (if it's a compute job or server
route); the exploration step is the same either way.

```
elemental_get_schema()                          → list all entity types
elemental_get_schema(flavor="article")          → properties for a type
elemental_get_entity(entity="Apple")            → resolve + fetch entity
elemental_get_related(entity="Apple",
    related_flavor="person")                    → follow relationships
```

MCP tells you the correct flavor IDs, property IDs, and data shapes. Use
these to inform your REST implementation.

**Verify MCP is working with known-good queries:**

```
elemental_get_schema()                          → should return flavors + properties
elemental_get_entity(entity="Microsoft")        → should resolve to a company
elemental_get_entity(entity="Apple Inc")        → another known entity
elemental_health()                              → server health check
```

**Interpreting MCP errors — do NOT assume the server is broken:**

- `entity not found` or 404 in entity lookup → the entity doesn't exist
  in the knowledge graph, not a connectivity problem. Try a different entity.
- `failed to get property values: 404` → the entity was resolved but has
  no data for those properties. The MCP server is working correctly.
- Schema calls succeed but entity calls fail → data is sparse for that
  entity type. Try well-known entities (Microsoft, Apple Inc, JPMorgan).
- If `elemental_health()` fails → actual connectivity problem.

**Key insight:** A 404 from an MCP entity/property call means "not found,"
not "server broken." Always test with known entities before concluding
the server is down.

### Step 2: curl (verify exact request/response shapes)

MCP doesn't cover every REST endpoint (e.g. `/elemental/find` expressions).
Test those with curl before implementing them in code.

The gateway proxy authenticates on your behalf — no Auth0 tokens needed.
Read `broadchurch.yaml` for the three values you need:

| YAML path            | Purpose                              |
| -------------------- | ------------------------------------ |
| `gateway.url`        | Portal Gateway base URL              |
| `tenant.org_id`      | Your tenant ID (path segment)        |
| `gateway.qs_api_key` | API key (sent as `X-Api-Key` header) |

Build the request URL as `{gateway.url}/api/qs/{tenant.org_id}/{endpoint}`
and include the header `X-Api-Key: {gateway.qs_api_key}`.

```bash
# Variables — read these from broadchurch.yaml
GW="https://broadchurch-portal-194773164895.us-central1.run.app"
ORG="org_abc123"
KEY="qs_..."

# Search for an entity by name
curl -s "$GW/api/qs/$ORG/entities/search" \
  -X POST -H "Content-Type: application/json" \
  -H "X-Api-Key: $KEY" \
  -d '{"queries":[{"queryId":1,"query":"Microsoft"}],"maxResults":3}'

# Test a find expression
curl -s -X POST "$GW/api/qs/$ORG/elemental/find" \
  -H "X-Api-Key: $KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode 'expression={"type":"is_type","is_type":{"fid":12}}' \
  --data-urlencode 'limit=5'

# Get entity properties (form-encoded)
curl -s -X POST "$GW/api/qs/$ORG/elemental/entities/properties" \
  -H "X-Api-Key: $KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode 'eids=["00416400910670863867"]' \
  --data-urlencode 'pids=[8,313]' | jq .
```

`/elemental/find` and `/elemental/entities/properties` require
`application/x-www-form-urlencoded` with JSON-stringified parameter values.
All other endpoints accept `application/json`.

**Interpreting errors:** 400 = expression syntax is wrong. 500 = expression
is valid but the query failed (wrong PID, unsupported operator for that
property type). 200 + empty `eids` = query worked but no results match.
404 from entity/property endpoints = entity or data doesn't exist (not a
server error). Always test with known entities (e.g. search for "Microsoft")
before assuming the API is broken.

### Step 3: Implement with confidence

Now write your composable or server route, knowing the exact API shapes.

## Pre-Built Helpers

The template includes composables and utilities that handle common
Elemental API patterns. **Use these instead of writing from scratch:**

### `useElementalSchema()` — Schema Discovery with Caching

```typescript
const { flavors, properties, flavorByName, pidByName, refresh } = useElementalSchema();
await refresh(); // fetches once, then cached
const articleFid = flavorByName('article'); // → string | null
const namePid = pidByName('name'); // → string | null
```

Handles the dual response shapes (`res.schema.flavors` vs `res.flavors`)
and the `fid`/`findex` naming inconsistency automatically.

### `utils/elementalHelpers` — Gateway URL Helpers

```typescript
import {
    buildGatewayUrl,
    getApiKey,
    padNeid,
    searchEntities,
    getEntityName,
} from '~/utils/elementalHelpers';

const url = buildGatewayUrl('entities/search'); // full gateway URL
const key = getApiKey(); // from runtimeConfig
const neid = padNeid('4926132345040704022'); // → "04926132345040704022"

const results = await searchEntities('Microsoft'); // batch name search
const name = await getEntityName(neid); // display name lookup
```

> `useElementalSchema()` and `utils/elementalHelpers` are the **client /
> composable** surface (they run in Vue components). For **server routes**
> (`server/api/*.ts`) and compute jobs, use the server helper below — Vue
> composables aren't available there.

### `server/utils/elementalQs` — Server-side enrichment (Nitro routes)

The higher-level QS primitives a real server-side "resolve → enrich →
persist" route needs. These do schema caching, the form-encoded
`getPropertyValues` call, the `(eid, pid)` dedup, `data_nindex` → name
resolution, and 64-bit-safe ID handling **for you** — so you don't
re-derive ~150 lines of gateway/dedup/padding boilerplate (and don't trip
over the opaque-string ID rule). Auto-imported in server code.

```typescript
import {
    isQsConfigured,
    getQsSchema,
    getPropertiesByName,
    findLinkedCount,
    resolveEntityNames,
} from '~/server/utils/elementalQs';

if (!isQsConfigured()) {
    /* degrade gracefully — don't 500 the page */
}

// name → { pid, type } and flavor → fid maps (ids are strings)
const { pidByName, flavorByName } = await getQsSchema();

// Enrich a NEID the agent resolved — names in, values out (nindex refs
// resolved to display names automatically):
const { values, raw, unknownProps } = await getPropertiesByName(neid, [
    'country',
    'industry',
    'ticker_symbol',
]);
// values.country === 'United States', values.industry === 'Software', ...

// Count graph-linked entities (+ a small sample):
const { count, sampleNeids } = await findLinkedCount(neid, { direction: 'incoming' });

// Batch NEID → display name:
const nameByNeid = await resolveEntityNames(sampleNeids);
```

| Helper                             | Purpose                                                                                   |
| ---------------------------------- | ----------------------------------------------------------------------------------------- |
| `isQsConfigured()`                 | Gateway + org + key all present? Guard routes and degrade gracefully when not.            |
| `getQsSchema(force?)`              | Cached schema → `pidByName` / `flavorByName` / `typeByPid` maps (all ids as **strings**). |
| `getPropertiesByName(neid, names)` | Property values by human name; dedups rows, resolves `data_nindex` refs to names.         |
| `findLinkedCount(neid, opts?)`     | Graph-layer `linked` traversal → `{ count, sampleNeids }`.                                |
| `resolveEntityNames(neids)`        | Batch `GET /entities/{neid}/name` → `{ [neid]: name }` (de-duped, failure-tolerant).      |
| `padNeid(value)` / `qsParse(t)`    | Pad a raw id to a 20-char NEID; parse QS JSON without rounding 64-bit ids.                |

## Client Usage

All API calls go through `useElementalClient()` from `@yottagraph-app/elemental-api/client`.
Auth tokens and base URL are configured automatically by the `elemental-client` plugin.

```typescript
import { useElementalClient } from '@yottagraph-app/elemental-api/client';

const client = useElementalClient();

const schema = await client.getSchema();
const entities = await client.findEntities({
    expression: JSON.stringify({
        type: 'comparison',
        comparison: { operator: 'string_like', pid: 8, value: 'Apple' },
    }),
    limit: 5,
});
```

### Client Method Quick Reference

All methods return data directly and throw on non-2xx responses.

**Entity search and lookup:**

| Method         | Signature                  | Purpose                                 |
| -------------- | -------------------------- | --------------------------------------- |
| `findEntities` | `(body: FindEntitiesBody)` | Expression-based search (see `find.md`) |

> **Entity search**: Use `findEntities()` with `string_like` on the name PID
> for name-based searches, or call `POST /entities/search` directly via
> `$fetch` for batch name resolution with scored ranking (this endpoint is
> not wrapped by the generated client).

> **Entity name lookup**: To get an entity's display name from its NEID,
> call `GET /entities/{neid}/name` directly via `$fetch` (not on the
> generated client). Returns `{"name": "..."}`. For all other entity
> data, use `getPropertyValues()`.

**Properties and schema:**

| Method              | Signature                                | Purpose                                                                              |
| ------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------ |
| `getSchema`         | `()`                                     | All entity types (flavors) and properties (PIDs)                                     |
| `getPropertyValues` | `(body: { eids: string, pids: string })` | Property values (eids: JSON array of NEID strings; pids: JSON array of numeric PIDs) |
| `summarizeProperty` | `(pid: number)`                          | Summary stats for a property                                                         |

**Relationships and graph:**

| Method         | Signature                        | Purpose                                                      |
| -------------- | -------------------------------- | ------------------------------------------------------------ |
| `findEntities` | `(body: { expression, limit? })` | Find linked entities via `linked` expression (see `find.md`) |

**Other:**

| Method       | Signature                | Purpose                        |
| ------------ | ------------------------ | ------------------------------ |
| `getHealth`  | `()`                     | Health check                   |
| `getStatus`  | `()`                     | Server status and capabilities |
| `adaMessage` | `(body: AdaMessageBody)` | Ada AI chat                    |

## Discovery-First Pattern

The knowledge graph contains many entity types and properties, and new datasets
are added regularly (e.g. Edgar filings, financial data). Do NOT hardcode entity
types or property names. Instead, discover them at runtime:

1. **Get the schema** — `client.getSchema()` returns all entity types (flavors)
   and properties (PIDs) available in the system. See `schema.md`.

    The schema response contains:
    - **Flavors** (entity types): Company, Person, GovernmentOrg, etc.
      Each flavor has a numeric ID and a human-readable name.
    - **PIDs** (properties): name, country, industry, lei_code, etc.
      Each PID has a type (`data_str`, `data_int`, `data_nindex`, etc.).
    - Properties with type `data_nindex` are references to other entities —
      resolve them with another `getPropertyValues` call.

    Use flavor names in `findEntities()` expressions and PID names in
    `getPropertyValues()`.

2. **Search with expressions** — `client.findEntities()` uses a JSON expression
   language to search by type, property value, or relationship. See `find.md`.
3. **Get property values** — `client.getPropertyValues()` fetches property data
   for specific entities.

This pattern lets agents work with any dataset without needing hardcoded
knowledge of what's in the graph.

## Semantics-First Data Handling

For reliable agent behavior, prefer typed semantics over string heuristics:

- **Use canonical endpoints/tools for each domain.** Example: fetch events
  from event APIs (`elemental_get_events` / event endpoints), not by scanning
  unrelated property names for words like "event" or "filing".
- **Treat reference-typed properties as links, not display text.** For
  relationship/reference values (`data_nindex` and similar), resolve linked
  entities before presenting user-facing output.
- **Interpret 404s as data absence first.** A 404 on entity/property lookups
  usually means "not found in current data," not transport failure. Validate
  connectivity separately (for example, with health endpoints).

## API Gotchas

### `getSchema()` response structure differs by endpoint

There are two schema endpoints with **different response shapes**:

| Endpoint                         | Flavors at                    | Flavor ID field | Detail level                         |
| -------------------------------- | ----------------------------- | --------------- | ------------------------------------ |
| `GET /schema`                    | top-level (`res.flavors`)     | `findex`        | Rich (display names, units, domains) |
| `GET /elemental/metadata/schema` | nested (`res.schema.flavors`) | `fid`           | Basic (name + type only)             |

The TypeScript client's `getSchema()` calls `/elemental/metadata/schema`,
so the response nests data under `.schema`. The generated types may suggest
top-level access, but it won't work at runtime.

```typescript
// WRONG — will crash (data is nested under .schema):
const res = await client.getSchema();
const props = res.properties; // undefined!

// CORRECT — always use fallback to handle both shapes:
const res = await client.getSchema();
const properties = res.schema?.properties ?? (res as any).properties ?? [];
const flavors = res.schema?.flavors ?? (res as any).flavors ?? [];
```

### Flavor ID field: `fid` vs `findex`

The flavor identifier has **different field names** depending on the endpoint:
`GET /schema` returns `findex`, `/elemental/metadata/schema` returns `fid`.
Same value, different key. Always use a fallback:

```typescript
const articleFlavor = flavors.find((f) => f.name === 'article');
// Always use String() — safe for small IDs (12) and required for large ones
const articleFid = String(articleFlavor?.fid ?? articleFlavor?.findex ?? '');

// When building a FID lookup map:
const fidMap = new Map(flavors.map((f) => [String(f.fid ?? f.findex), f.name]));
```

The `is_type` expression in `/elemental/find` always uses the `fid` key
regardless of which schema endpoint provided the value.

### The opaque-string ID rule — NEIDs, EIDs, PIDs, and FIDs are strings, never numbers

**Every identifier in the knowledge graph — NEID, EID, PID, FID/findex —
is a 64-bit signed integer that you must carry as an opaque `string` end
to end.** Never store one in a JS `number`, never do arithmetic on one,
never `JSON.parse` a payload that contains a bare one, and never render a
raw NEID as a user-facing label (resolve it to a name first — see below).
They are identity tokens, not quantities.

Why this is non-negotiable: many ids are small (`12`), but plenty exceed
JavaScript's `Number.MAX_SAFE_INTEGER` (2^53 − 1) **in both directions** —
NEIDs are 20-digit values, and real-tenant PIDs are frequently large
**negatives** like `-5294792805565584640` (e.g. `ticker_symbol`) or
`-8736335044941237186` (e.g. `founded`). The moment such a value passes
through a JS number it is silently rounded:

```typescript
JSON.parse('{"pid":-5294792805565584640}'); // → { pid: -5294792805565585000 }  ❌ corrupted
JSON.stringify([-5294792805565584640]); // → "[-5294792805565585000]"        ❌ corrupted
```

The corrupted id then returns **empty results and no error** — the single
most common "the data doesn't exist" false alarm.

**The rules that follow from this:**

- **Parse defensively.** When you have a raw JSON string that contains
  ids, rewrite the numeric `pid` / `fid` / `findex` / `eid` / `value`
  fields to quoted strings _before_ `JSON.parse`. (The server helper
  `server/utils/elementalQs.ts` does exactly this — `qsParse()` — so
  prefer it over hand-rolling.)
- **Build request arrays via string interpolation, not `JSON.stringify`
  of numbers.** For `pids`, use `` `[${pids.join(',')}]` `` where `pids`
  are strings — that yields `[8,-5294792805565584640]` with the literal
  intact. `JSON.stringify([...])` would round them.
- **Type them `string`.** In every interface, ref, table column, and
  function signature, an id is `string`. If you catch yourself writing
  `neid: number` or `pid: number`, stop.
- **UIs carry NEIDs verbatim.** Use them as map keys / `:key` / dataset
  ids, but render the resolved _name_ to users — never the raw NEID
  (see `getEntityName` / `resolveEntityNames`).

### Relationship property values need zero-padding to form valid NEIDs

Relationship properties (`data_nindex`) return linked entity IDs as raw
numbers (e.g. `4926132345040704022`). These must be **zero-padded to 20
characters** to form valid NEIDs. This is easy to miss and causes silent
failures — `getPropertyValues` returns empty results and
`/entities/{neid}/name` returns a 404.

```typescript
// WRONG — raw value is NOT a valid NEID:
const filingId = res.values[0].value; // "4926132345040704022" (19 chars)

// CORRECT — always pad to 20 characters:
const filingNeid = String(res.values[0].value).padStart(20, '0'); // "04926132345040704022"
```

> **WARNING -- `getPropertyValues()` takes JSON-stringified arrays**: The `eids`
> and `pids` parameters must be JSON-encoded strings, NOT native arrays. The
> TypeScript type is `string`, not `string[]`. Passing a raw array will silently
> return no data.

> **WARNING -- PIDs are numeric IDs, not string names.** Property IDs (PIDs)
> are integers, not human-readable names. `pids: JSON.stringify(['name'])`
> will fail — use `pids: JSON.stringify([8])` (where 8 is the PID for "name"
> from `getSchema()`). Always call `getSchema()` first to discover the
> numeric PID for each property.

```typescript
// WRONG — PIDs are numbers, not strings:
const values = await client.getPropertyValues({
    eids: JSON.stringify(['00416400910670863867']),
    pids: JSON.stringify(['name', 'country', 'industry']), // FAILS
});

// CORRECT — use numeric PIDs from getSchema():
const values = await client.getPropertyValues({
    eids: JSON.stringify(['00416400910670863867']),
    pids: JSON.stringify([8, 313]), // 8=name, 313=country (from schema)
});
```

> **Big/negative PIDs:** `JSON.stringify([...])` rounds large PIDs (see the
> opaque-string ID rule above). When any PID may be large, build the array
> by string interpolation instead — `` pids: `[${pidStrings.join(',')}]` ``
> — or just use `getPropertiesByName()` from `server/utils/elementalQs.ts`,
> which handles it.

### `getPropertyValues` returns MULTIPLE rows per (eid, pid) — dedup them

The response is **not** one row per property. `getPropertyValues` returns
one row per `(eid, pid, efid)` — i.e. one per **source** that asserted the
value — so a single property can come back as many rows. For a
well-covered entity you'll routinely see a dozen identical rows for the
same pid (e.g. ≥12 rows all saying `"Microsoft"` for the name pid), each
with a different `efid` and possibly the same `recorded_at`.

If you build a `pid → value` map by iterating naively, later rows clobber
earlier ones (harmless when identical, lossy when sources disagree). The
canonical rule is **first-wins per `(eid, pid)`**:

```typescript
const byPid = new Map<string, string>(); // pid (string!) → value
for (const v of res.values ?? []) {
    const pid = String(v.pid);
    if (byPid.has(pid)) continue; // first source wins
    if (v.value == null) continue;
    byPid.set(pid, String(v.value)); // value is a string — see the ID rule
}
```

(If you need provenance or "latest", sort by `recorded_at` first — but for
display/enrichment, first-wins is the right default.) `getPropertiesByName()`
in `server/utils/elementalQs.ts` already does this dedup for you.

### Traversing relationships: graph-layer vs property-layer entities

The knowledge graph has two layers:

- **Graph layer** — people, organizations, and locations are first-class
  nodes with edges between them. Use `findEntities()` with a `linked`
  expression to traverse these (see `find.md`).
- **Property layer** — documents, filings, articles, financial instruments,
  events, and all other types are attached as property values on graph
  nodes. Use `getPropertyValues()` with the relationship PID to traverse
  these.

If you need to find people linked to an organization, use `findEntities`
with a `linked` expression:

```typescript
const res = await client.findEntities({
    expression: JSON.stringify({
        type: 'linked',
        linked: {
            to_entity: orgNeid,
            distance: 1,
            pids: [isOfficerPid, isDirectorPid, worksAtPid],
            direction: 'incoming',
        },
    }),
    limit: 50,
});
const personNeids = (res as any).eids ?? [];
```

For non-graph-node types (filings, documents, etc.), use `getPropertyValues`
with the relationship PID. Relationship properties (`data_nindex`) return
linked entity IDs as values. Zero-pad the returned IDs to 20 characters
to form valid NEIDs.

```typescript
const pidMap = await getPropertyPidMap(client);
const filedPid = pidMap.get('filed')!;
const res = await client.getPropertyValues({
    eids: JSON.stringify([orgNeid]),
    pids: JSON.stringify([filedPid]),
});
const docNeids = (res.values ?? []).map((v) => String(v.value).padStart(20, '0'));
```

See [cookbook-data.md](cookbook-data.md) in this skill for a full "Get filings for a company" recipe.

### Expression language pitfalls

These mistakes come up repeatedly when building `/elemental/find` queries:

- **Entity type filtering**: Use `is_type` (not `comparison` with pid=0).
  `comparison` requires `pid != 0`.
- **`string_like` is name-only**: Only works on the name property (PID 8).
  Use `eq` for exact matches on other string properties.
- **Boolean combinators**: Use `{"type": "and", "and": [...]}` — not
  `conjunction` or any other name.
- **`lt`/`gt` are numeric-only**: Only work on `data_int` and `data_float`
  properties.
- **`regex` is not implemented**: Will return an error.

Read the "Common Mistakes" section in the **elemental-api skill** (`find.md`)
for examples of each.

### Entity Search

Use `client.findEntities()` (`POST /elemental/find`) for entity search.
It supports filtering by type, property value, and relationship via the
expression language (see `find.md`). For name-based lookups, use
`string_like` on the name property (PID 8).

For batch name resolution with scored ranking, call `POST /entities/search`
directly via `$fetch` (not on the generated client). See the
**elemental-api skill** (`entities.md`) for request/response shapes.

## Traversing Relationships

Relationships between entities are discoverable via the schema — use
`getSchema()` to find relationship properties (`data_nindex` type) and
their PIDs. Do NOT hardcode relationship names or PIDs; they can change
as the knowledge graph evolves. See the **data-model skill** for
source-specific schemas.

**Two traversal methods:**

- **Graph-layer entities** (person, organization, location): Use
  `findEntities()` with a `linked` expression. See `find.md`.
- **Property-layer entities** (documents, filings, articles, etc.): Use
  `getPropertyValues()` with the relationship PID. Values are entity IDs
  that must be zero-padded to 20 characters.

See [cookbook-data.md](cookbook-data.md) (news feed recipe) for a full example.

## Error Handling

```typescript
try {
    const data = await client.findEntities({
        expression: JSON.stringify({
            type: 'comparison',
            comparison: { operator: 'string_like', pid: 8, value: 'Apple' },
        }),
        limit: 5,
    });
} catch (error) {
    console.error('API Error:', error);
    showError('Failed to load data. Please try again.');
}
```

Methods on `useElementalClient()` return data directly and throw on non-2xx
responses. For full `{ data, status, headers }` access, import the raw
functions instead:

```typescript
import { getArticle } from '@yottagraph-app/elemental-api/client';

const response = await getArticle(artid);
if (response.status === 404) {
    /* handle not found */
}
```

## Lovelace MCP Servers

The Lovelace platform exposes **exactly four** MCP servers, all proxied
through the Broadchurch Portal Gateway:

| Server       | What it provides                                                              |
| ------------ | ----------------------------------------------------------------------------- |
| `elemental`  | Knowledge Graph: entities, relationships, events, sentiment, schema discovery |
| `stocks`     | Stock/financial market data                                                   |
| `wiki`       | Wikipedia entity enrichment                                                   |
| `polymarket` | Prediction market data                                                        |

> **Data sources are not separate MCP servers.** EDGAR filings, FRED
> economic indicators, FDIC bank data, etc. are entity sources INSIDE
> the Elemental knowledge graph — query them via the `elemental` server,
> not via invented names like `fred`, `edgar`, or `lovelace-fred`. If
> you generate a URL pointing at a server name outside the four above,
> the portal will return a `404 JSON` with a `valid_paths` list.

### The `lovelace-` prefix is a client-side alias, NOT part of the URL

`.agents/mcp.json` declares each server with a `lovelace-` prefix
(e.g. `lovelace-elemental`). That prefix is purely a **client-side
alias** that Cursor and Claude Code use when surfacing tools in the
IDE — it disambiguates platform MCP tools from any custom MCP servers
the app might also configure. It is **NOT a URL segment**.

```json
{
    "lovelace-elemental": {
        "url": "https://broadchurch-portal-194773164895.us-central1.run.app/api/mcp/{org_id}/elemental/mcp"
    }
}
```

Note the URL path: `.../api/mcp/{org_id}/elemental/mcp` — just
`elemental`, no `lovelace-` prefix. When calling MCP programmatically
(server route, plugin, Python agent), always use the **un-prefixed**
server name in the URL path.

### MCP is JSON-RPC over a single endpoint per server — NOT REST

Each MCP server exposes a single HTTP endpoint at `/mcp` that speaks
JSON-RPC 2.0. There are no REST-shaped sub-paths like `/macro`,
`/context`, `/latest`, `/search`, or `/tools/<name>`. Every operation —
listing tools, calling a tool, opening a session — is a `POST` to the
same `/mcp` URL with a JSON-RPC envelope in the body.

```
POST {gateway.url}/api/mcp/{tenant.org_id}/{server_name}/mcp
Content-Type: application/json

{"jsonrpc":"2.0","id":1,"method":"tools/list"}
```

```
POST {gateway.url}/api/mcp/{tenant.org_id}/{server_name}/mcp
Content-Type: application/json

{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{
  "name":"elemental_get_entity",
  "arguments":{"entity":"Microsoft"}
}}
```

> ⚠️ Those two snippets show the **envelope shape only**. From app code
> you can't fire them standalone: `tools/list` / `tools/call` are
> rejected until you complete the stateful `initialize` handshake and
> echo the `Mcp-Session-Id` header. See § "Programmatic use — calling
> MCP from app code" below for the full, correct client. (In the Cursor /
> Claude Code IDE the handshake is handled for you — this only bites
> code you write.)

If you find yourself constructing a URL like
`/api/mcp/{org}/elemental/find` or `/api/mcp/{org}/stocks/quote/AAPL`,
stop — those are not valid MCP paths and the portal will respond with
a `404 JSON` body containing a `hint` and `valid_paths` list.

### Interactive use — read your tool list first

In Cursor and Claude Code, MCP tools appear in your tool list at startup
(e.g. `elemental_get_schema`, `elemental_get_entity`). **If those tools
appear, use them directly** — the IDE handles JSON-RPC for you. They
are your primary discovery/exploration interface and replace most curl
testing during research. If they don't appear, the connection failed;
check `.agents/mcp.json`, then fall back to curl (below).

| Tool                           | Purpose                                                        | Use to verify...                     |
| ------------------------------ | -------------------------------------------------------------- | ------------------------------------ |
| `elemental_get_schema`         | Discover entity types (flavors), properties, and relationships | Flavor IDs, property IDs, data types |
| `elemental_get_entity`         | Look up entity by name or NEID; returns properties             | Entity resolution, property shapes   |
| `elemental_get_related`        | Related entities with type/relationship filters                | Relationship types and traversal     |
| `elemental_get_relationships`  | Relationship types and counts between two entities             | Edge types between specific entities |
| `elemental_graph_neighborhood` | Most influential neighbors of an entity                        | Graph connectivity                   |
| `elemental_graph_sentiment`    | Sentiment analysis from news articles                          | Sentiment data availability          |
| `elemental_get_events`         | Events for an entity or by search query                        | Event categories and shapes          |
| `elemental_health`             | Health check                                                   | Server connectivity                  |

### Programmatic use — calling MCP from app code

When you need to call an MCP server from a Nitro server route,
composable, or any code that runs in the app (not the IDE), POST a
JSON-RPC body to the portal proxy. **Three things bite first-time
implementers — get them right or every call 502s:**

1. **The `initialize` handshake is mandatory and stateful.** You MUST
   call `initialize` _before_ `tools/list` / `tools/call`. Skip it and
   the server rejects every call with
   `method "tools/list" is invalid during session initialization`
   (the portal passes that through as a 502 on your route).
2. **The session id comes back in the `Mcp-Session-Id` RESPONSE
   HEADER — not the body.** Capture it from the header and echo it on
   the `Mcp-Session-Id` REQUEST header of every subsequent call. After
   `initialize`, send a one-off `notifications/initialized` (no `id`).
3. **The server replies with `text/event-stream` (SSE), not JSON.** So
   `$fetch` (which assumes JSON) won't parse it — use raw `fetch` and
   pull the JSON out of the `data:` line. Send
   `Accept: application/json, text/event-stream`.

Here is a correct, copy-pasteable client (`server/utils/elementalMcp.ts`):

```typescript
const ACCEPT = 'application/json, text/event-stream';
let sessionId: string | null = null; // one session per process
let id = 0;

// SSE-aware body parser: the proxy returns the JSON-RPC envelope wrapped
// in a `data:` line, not raw application/json.
async function parse(res: Response): Promise<any> {
    const text = await res.text();
    if ((res.headers.get('content-type') || '').includes('text/event-stream')) {
        const line = text
            .split(/\r?\n/)
            .reverse()
            .find((l) => l.startsWith('data:'));
        if (!line) throw new Error(`MCP: empty SSE body (status ${res.status})`);
        return JSON.parse(line.slice(5).trim());
    }
    return JSON.parse(text);
}

async function ensureSession(url: string): Promise<string> {
    if (sessionId) return sessionId;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: ACCEPT },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: ++id,
            method: 'initialize',
            params: {
                protocolVersion: '2025-03-26',
                capabilities: {},
                clientInfo: { name: 'aether-app', version: '1.0' },
            },
        }),
    });
    sessionId = res.headers.get('mcp-session-id'); // <-- HEADER, not body
    await parse(res); // drain + surface any initialize error
    if (!sessionId) throw new Error('MCP initialize returned no Mcp-Session-Id header');
    // Tell the server we're ready (notification: no id, no response).
    await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: ACCEPT,
            'Mcp-Session-Id': sessionId,
        },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
    return sessionId;
}

export async function callMcpTool(url: string, name: string, args: Record<string, unknown>) {
    const sid = await ensureSession(url);
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: ACCEPT, 'Mcp-Session-Id': sid },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: ++id,
            method: 'tools/call',
            params: { name, arguments: args },
        }),
    });
    const env = await parse(res);
    if (env.error) throw new Error(`MCP error ${env.error.code}: ${env.error.message}`);
    // Tools return data as `structuredContent`, or JSON inside a text block.
    const r = env.result;
    if (r?.structuredContent !== undefined) return r.structuredContent;
    const txt = r?.content?.find((c: any) => c.type === 'text')?.text;
    return txt ? JSON.parse(txt) : r;
}

// Usage in a route:
//   const { public: config } = useRuntimeConfig();
//   const url = `${config.gatewayUrl}/api/mcp/${config.tenantOrgId}/elemental/mcp`;
//   const data = await callMcpTool(url, 'elemental_get_entity', { entity: 'Microsoft' });
```

Production hardening to add: if a later call returns HTTP 404 or a
`...invalid during session initialization` error, the session went stale
(server restart / proxy recycle) — reset `sessionId = null` and retry
once so a single blip doesn't wedge the client.

The portal injects upstream credentials, so no bearer tokens are needed
client-side. Cross-origin requests from `*.yottagraph.app` are allowed
by CORS on `/api/mcp/*` paths.

> **For Python ADK agents** (in `agents/`), do NOT roll your own
> JSON-RPC client — use `McpToolset` with `StreamableHTTPConnectionParams`.
> See the `elemental-mcp-patterns` skill (`.agents/skills/elemental-mcp-patterns/SKILL.md`)
> for the full wiring pattern. The URL shape is identical:
> `{gateway.url}/api/mcp/{org_id}/{server_name}/mcp` with the un-prefixed
> `server_name`.

### Interpreting portal-proxy errors

The portal proxies both `/api/qs/*` (Query Server REST) and
`/api/mcp/*` (MCP JSON-RPC). When a proxied call fails, the status code
tells you whether the problem is in your request, the portal, or
upstream:

| Status | Where it comes from      | Typical cause                                                  |
| ------ | ------------------------ | -------------------------------------------------------------- |
| `400`  | portal (validation)      | Missing path segment or malformed body                         |
| `401`  | portal (auth)            | Missing/wrong `X-Api-Key` on QS, or missing/expired MCP bearer |
| `403`  | portal (tenant state)    | Tenant suspended or in `deprovisioning`                        |
| `404`  | portal (route mismatch)  | Bad URL path or unknown server/tenant; body has `hint` field   |
| `502`  | portal (upstream fetch)  | Portal couldn't reach the QS or MCP server                     |
| Other  | upstream QS / MCP server | Status passed through; treat per upstream's docs               |

A `404 JSON` with a `data.hint` and `data.valid_paths` block is the
portal telling you the URL is wrong — read the hint and adjust the URL
shape rather than retrying. **The portal never returns HTML for `/api/*`
paths**; if a caller is parsing HTML as JSON and surfacing a 500, the
bug is in the caller's error handling (probably swallowing the real
404/401 from the portal).

If you can't classify a response against this table — or you're about
to change code because a platform API "seems broken" — run
`/diagnose <url>` first. The command captures the actual request and
response with curl so the classification is grounded in observed bytes,
not inferred behavior. See § "Before you 'fix' an apparent platform
outage" near the top of this file for the reasoning.

### Setup

`.agents/mcp.json` is auto-generated by `init-project.js` and rewritten
on every `node init-project.js` run. If it's missing, run
`node init-project.js --local` to regenerate it. For provisioned
projects the servers route through the Portal Gateway proxy and need
no local credentials. For local development without a gateway, the
servers require an `AUTH0_M2M_DEV_TOKEN` environment variable and a
direct (non-proxied) URL in `mcp.json`.
