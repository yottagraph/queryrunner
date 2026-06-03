# QueryRunner

## Vision

Runs test queries against a Knowledge Graph. Each query returns a simple answer, that can be pass/fail validated. Runs many queries and produces a metric, over time, of query pass rates.

## Status

MVP implemented. The app provides a small test-harness for the Lovelace Knowledge Graph: define structured queries, run them on demand, and watch a pass-rate metric over time.

## Modules

### `pages/index.vue` — Dashboard

Top-level view. Shows:

- **Queries in catalog** count.
- **Latest pass rate** (most recent run).
- **All-time pass rate** (every recorded run aggregated).
- **Pass rate trend** sparkline (last up to 20 runs).
- **Latest run table** — every query result from the most recent run.
- **Recent runs table** — last 10 runs with pass/fail/error counts.

The “Run all queries” button kicks off a parallel execution of every catalog query and records the result.

### `pages/queries.vue` — Query catalog

CRUD over the query catalog. Each row shows the query name, type, validation rule, the last-observed actual value, and a status chip from either the most recent live run (this session) or the most recent historical result for that query. Per-row buttons run a single query, edit it, or delete it. A header button runs the entire catalog.

### `pages/runs.vue` and `pages/runs/[id].vue` — Run history

`runs.vue` lists every retained run with pass/fail counts and per-run pass rate. `[id].vue` drills into a single run and shows every query result with expected/actual/duration. Up to 50 runs are retained per the cap in `useQueryRunner`.

### `composables/useQueryRunner.ts`

Owns the data model. Persists:

- `queryrunner-catalog` (via `useGlobalFeaturePrefs`) — `{ queries: QueryDef[] }`.
- `queryrunner-history` (via `useGlobalFeaturePrefs`) — `{ runs: TestRun[] }`, capped at 50.

Exposes `addQuery`, `updateQuery`, `deleteQuery`, `runQuery`, `runAll`, `clearHistory` plus reactive `queries`, `runs`, `latestRun`. Seeds the catalog with four starter tests (Microsoft / Apple / JPMorgan) when first opened.

### `server/api/queryrunner/execute.post.ts`

Single server route that executes one query definition and returns a `QueryResult`. The route classifies test failures (mismatched expected vs actual) as `pass: false` and classifies transport / configuration failures as `pass: false, error: <message>` — it never throws for a test failure.

The route uses the pre-built `server/utils/elementalQs` helpers for property fetch / linked-count traversal, and calls the Portal Gateway `/entities/search` endpoint directly with `X-Api-Key` for top-match search.

### `types/queryrunner.ts`

Type definitions for query bodies, validators, results, and runs.

### Query types

- **`search`** — `POST /entities/search`, take top match. Validators: `top_name_equals`, `top_neid_equals`, `top_flavor_equals`, `has_match`.
- **`property`** — resolve entity by name → `getPropertiesByName(neid, [property])`. Validators: `equals`, `contains`, `not_null`.
- **`linked_count`** — resolve entity by name → `findLinkedCount(neid, { direction })`. Validators: `gte`, `equals`.

Query types are intentionally narrow so the harness produces clean pass/fail answers without per-query custom code.

### `components/QueryEditDialog.vue`

Reactive form for adding or editing a query definition. Shows only the fields relevant to the selected query type.

### `components/QueryResultChip.vue`, `components/QueryRunnerNav.vue`, `components/PassRateSparkline.vue`

Small UI pieces: status chip (pass / fail / error / not run), top-of-page tab navigation (Dashboard / Queries / Runs), and a minimal inline SVG sparkline for the pass-rate trend.

### App shell

`app.vue` mounts `<QueryRunnerNav />` directly under `<AppHeader />` so every page gets the same tab navigation without per-page boilerplate.
