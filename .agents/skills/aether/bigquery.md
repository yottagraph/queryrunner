# BigQuery

`server/utils/bigquery.ts` reaches BigQuery one of two ways, picked
automatically at runtime — you import the same helpers (`runQuery`,
`runMutation`, `listDatasets`, `listTables`) either way:

- **Direct (BC 2.0, GKE-hosted):** the pod runs under Workload Identity
  in its own per-tenant GCP project, so the helper calls the BigQuery
  REST API directly using an Application Default Credentials token from
  the GKE metadata server. No portal hop, no service-account key. This
  is the BC 2.0 default and what new GCP-hosted tenants use.
- **Gateway (legacy/transitional, Vercel-hosted):** a Vercel function
  can't hold a GCP identity, so the helper proxies through the
  **Broadchurch Portal gateway**, which runs the query in the tenant's
  project with the portal's service account.

The transport is decided by whether `GOOGLE_CLOUD_PROJECT` is set (only
true inside the GKE pod). You never choose it and never need a
service-account key in either mode.

| Capability                | How to check                                                      | Env var                                                                                               | Utility file                                |
| ------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| **BigQuery (analytical)** | `process.env.NUXT_PUBLIC_BIGQUERY_ENABLED === 'true'`             | `NUXT_PUBLIC_BIGQUERY_ENABLED`                                                                        | `server/utils/bigquery.ts` (pre-scaffolded) |
|                           | OR `curl <gateway.url>/api/tenants/<org_id>` → `gcp.bigquery` set | `NUXT_PUBLIC_BIGQUERY_DATASET_ID`, `NUXT_PUBLIC_BIGQUERY_PROJECT_ID`, `NUXT_PUBLIC_BIGQUERY_LOCATION` |                                             |

Only available if the tenant was provisioned with BigQuery enabled (or
had it enabled later via the portal's "Enable BigQuery" action). Check
`isBigQueryConfigured()` before calling any of the helpers.

For transactional / relational data see [storage.md](storage.md)
(Postgres + KV); BigQuery is the analytical store, optimized for
append-only / large columnar scans.

## Critical: never do these

The agent reflexively reaches for `@google-cloud/bigquery` and a
service-account-key env var when asked to talk to BigQuery. Both
transports are ALREADY wired in `server/utils/bigquery.ts` and neither
needs an SDK or a key — the GKE path uses `fetch` against the REST API
with a Workload Identity token, the Vercel path uses the gateway. The
`prebuild` guard (`scripts/check-no-direct-gcp.js`) fails the build if
the SDK sneaks in. If you find yourself about to write any of these,
**stop**, re-read this file, and use `server/utils/bigquery.ts` instead:

- DO NOT add `@google-cloud/bigquery` to `package.json`. It's
  unnecessary in BOTH modes (the direct path uses the REST API over
  `fetch`); it only bloats the bundle and bypasses the helper. The
  prebuild guard rejects it.
- DO NOT paste a JSON service-account key into env (as
  `GCP_SERVICE_ACCOUNT_KEY` or any other name). On GKE the pod has
  Workload Identity; on Vercel the portal holds credentials. There is
  no key for the app to hold in either case.
- DO NOT add `GOOGLE_APPLICATION_CREDENTIALS`. The GKE path resolves
  ADC from the metadata server automatically; Vercel has no key file.
- DO NOT call the BigQuery REST API directly from `<script setup>` or
  any client-side code. Always go through a Nitro server route
  (`server/api/**`) — the credentials (metadata server / gateway) only
  exist server-side.

## Where credentials come from

**Direct (GKE):** the pod's Kubernetes ServiceAccount is bound (Workload
Identity) to the per-tenant `bc-aether-ui` runtime GSA. `gcp-bctenant`
Terraform grants that GSA `roles/bigquery.user` + `bigquery.metadataViewer`
at the project level and `roles/bigquery.dataEditor` on the tenant's
analytics dataset. `server/utils/bigquery.ts` gets an access token from
the GKE metadata server — no key on disk, nothing to configure.

**Gateway (Vercel):** there is no credential on the tenant side. The
portal gateway resolves the tenant's GCP project from `org_id` and runs
jobs with the portal SA's ADC.

The analytical dataset is **`bctenant_analytics`** (one per tenant
project; on BC 2.0 the slug prefix is redundant because every tenant has
its own project). It lives in the **`US`** multi-region — queries that
reference it run in `US`, which is why `NUXT_PUBLIC_BIGQUERY_LOCATION` is
`US`. The picker can list every dataset in the project, but `runQuery()`
will fail on datasets the runtime identity hasn't been ACL'd into.

## `isBigQueryConfigured()` — feature gating

The provisioner injects `NUXT_PUBLIC_BIGQUERY_ENABLED=true` into the
Vercel env when BQ is on. Use it to gate UI:

```vue
<script setup lang="ts">
    const bqEnabled = useRuntimeConfig().public.bigqueryEnabled === 'true';
</script>

<template>
    <v-card v-if="bqEnabled">…analytics UI…</v-card>
    <v-card v-else>
        <v-card-title>BigQuery is not configured</v-card-title>
        <v-card-text> Ask the platform operator to enable BigQuery for this app. </v-card-text>
    </v-card>
</template>
```

For server routes, use `isBigQueryConfigured()` from
`server/utils/bigquery.ts` and return a 503-style message when it's
false (don't throw — the page should still render).

## Server-route pattern

All BQ access lives in `server/api/**`. Helpers exposed by
`server/utils/bigquery.ts`:

| Helper                            | Returns                                                                                                      |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `isBigQueryConfigured()`          | `boolean`                                                                                                    |
| `getDefaultDataset()`             | `string \| null` — the tenant analytics dataset, `bctenant_analytics`                                        |
| `getBigQueryProjectId()`          | `string \| null` — the per-tenant GCP project, `bc-{slug}`                                                   |
| `getBigQueryLocation()`           | `string \| null` — the dataset multi-region, `US`                                                            |
| `listDatasets()`                  | `BqDataset[]`                                                                                                |
| `listTables(datasetId, options?)` | `BqTable[]`                                                                                                  |
| `runQuery(sql, options?)`         | `BqQueryResult` (read-only: SELECT / WITH / CALL)                                                            |
| `runMutation(sql, options?)`      | `BqMutationResult` (writes: DML + table/view/schema DDL)                                                     |
| `toRowObjects(result)`            | `Record<string, unknown>[]` — values are raw BQ wire-format **strings** (see the warning below)              |
| `toTypedRowObjects(result)`       | `Record<string, unknown>[]` — same, but coerces numeric/bool columns to JS `number`/`boolean` by schema type |

> **⚠️ Scalars round-trip as strings, in BOTH directions.** BigQuery's REST
> API returns every scalar as a string — yes, even `INT64` / `FLOAT64` /
> `NUMERIC` / `BOOL` — and the query params this module sends are
> stringified too. So a column you wrote as the JS number `80208000000`
> reads back as `"80208000000"`. This looks like a bug in dev tools but is
> correct and lossless. Use `toTypedRowObjects()` to get JS numbers/booleans
> back for the common (fits-in-a-double) case; keep `toRowObjects()` +
> strings for `INT64`/`NUMERIC` columns that can exceed ±2^53. Full detail +
> per-type table in [Wire-format gotcha](#wire-format-gotcha-torowobjects-returns-raw-bq-strings).

### Which helper to use

| You want to …                                                 | Use                   | Notes                                                       |
| ------------------------------------------------------------- | --------------------- | ----------------------------------------------------------- |
| Run a SELECT, list rows from a view, etc.                     | `runQuery`            | 10 k row cap, 30 s timeout, 10 GB scan cap                  |
| Insert / update / delete rows                                 | `runMutation`         | parameterise — never string-interpolate user input          |
| Create a new table or schema (incl. `CREATE TABLE AS SELECT`) | `runMutation`         | 60 s timeout; long DDL returns `{ pending: true }`          |
| Drop / alter a table or view                                  | `runMutation`         | irreversible — confirm before calling                       |
| Anything else (CALL, GRANT, EXPORT DATA, …)                   | (none — out of scope) | open an issue if you need it; do not hand-roll a workaround |

### Example: list datasets

```typescript
// server/api/bq/datasets.get.ts
import { isBigQueryConfigured, listDatasets } from '~/server/utils/bigquery';

export default defineEventHandler(async () => {
    if (!isBigQueryConfigured()) {
        throw createError({ statusCode: 503, statusMessage: 'BigQuery not configured' });
    }
    return await listDatasets();
});
```

### Example: list tables in a dataset

```typescript
// server/api/bq/tables/[dataset].get.ts
import { isBigQueryConfigured, listTables } from '~/server/utils/bigquery';

export default defineEventHandler(async (event) => {
    if (!isBigQueryConfigured()) {
        throw createError({ statusCode: 503, statusMessage: 'BigQuery not configured' });
    }
    const dataset = getRouterParam(event, 'dataset');
    if (!dataset) {
        throw createError({ statusCode: 400, statusMessage: 'dataset is required' });
    }
    return await listTables(dataset);
});
```

### Example: run a parameterized SELECT

```typescript
// server/api/bq/events.get.ts
import { isBigQueryConfigured, runQuery, toRowObjects } from '~/server/utils/bigquery';

export default defineEventHandler(async (event) => {
    if (!isBigQueryConfigured()) {
        throw createError({ statusCode: 503, statusMessage: 'BigQuery not configured' });
    }
    const { date, limit } = getQuery(event);
    const result = await runQuery(
        `SELECT * FROM events WHERE event_date = @date ORDER BY ts DESC LIMIT @limit`,
        {
            params: [
                { name: 'date', type: 'DATE', value: String(date ?? '2026-01-01') },
                { name: 'limit', type: 'INT64', value: Number(limit ?? 100) },
            ],
        }
    );
    return {
        schema: result.schema,
        rows: toRowObjects(result),
        truncated: result.truncated,
    };
});
```

`defaultDataset` is set automatically to **`bctenant_analytics`** (the
per-tenant analytics dataset, the same constant for every tenant — the
value of `NUXT_PUBLIC_BIGQUERY_DATASET_ID` / `getDefaultDataset()`) for
unqualified table refs. Don't hardcode the name; reference `events`
unqualified or call `getDefaultDataset()`. Pass `options.defaultDataset`
to override. Fully qualified, an unqualified `events` resolves to
`` `bc-{slug}-xxxx.bctenant_analytics.events` `` (project · dataset · table).

### Example: insert rows with `runMutation`

```typescript
// server/api/bq/events.post.ts
import { isBigQueryConfigured, runMutation } from '~/server/utils/bigquery';

export default defineEventHandler(async (event) => {
    if (!isBigQueryConfigured()) {
        throw createError({ statusCode: 503, statusMessage: 'BigQuery not configured' });
    }
    const body = await readBody<{ id: string; value: number }>(event);
    const result = await runMutation(
        `INSERT INTO events (id, value, inserted_at) VALUES (@id, @value, CURRENT_TIMESTAMP())`,
        {
            params: [
                { name: 'id', type: 'STRING', value: body.id },
                { name: 'value', type: 'INT64', value: body.value },
            ],
        }
    );
    return {
        inserted: result.numDmlAffectedRows,
        jobId: result.jobId,
        pending: result.pending,
    };
});
```

### Example: bootstrap a table the agent's app needs

```typescript
// server/api/bq/admin/init-events-table.post.ts
import { isBigQueryConfigured, runMutation } from '~/server/utils/bigquery';

export default defineEventHandler(async () => {
    if (!isBigQueryConfigured()) {
        throw createError({ statusCode: 503, statusMessage: 'BigQuery not configured' });
    }
    await runMutation(`
        CREATE TABLE IF NOT EXISTS events (
            id STRING NOT NULL,
            value INT64,
            inserted_at TIMESTAMP NOT NULL
        )
        PARTITION BY DATE(inserted_at)
        CLUSTER BY id
    `);
    return { ok: true };
});
```

### Cookbook: agent → structured JSON → BigQuery (the canonical BC 2.0 flow)

The most common BC 2.0 demo shape is: a server route calls an agent, the
agent returns structured data, and the route persists it for analysis. Use
`callAgent()` + `extractFencedJson()` from
[`~/server/utils/agentCall.ts`](agents.md#calling-an-agent-from-a-server-route)
for the agent half (instruct the agent to end its reply with one fenced
` ```json ` block), then insert one parameterised row per record:

````typescript
// server/api/insights/lookup.post.ts
import { callAgent, extractFencedJson } from '~/server/utils/agentCall';
import { isBigQueryConfigured, runMutation } from '~/server/utils/bigquery';

interface Insight {
    name: string;
    neid: string | null;
    category: string | null;
    confidence: number | null;
}

export default defineEventHandler(async (event) => {
    if (!isBigQueryConfigured()) {
        throw createError({ statusCode: 503, statusMessage: 'BigQuery not configured' });
    }
    const { names } = await readBody<{ names: string[] }>(event);

    // 1. Ask the agent (Elemental MCP entity lookup + analysis lives there).
    const { text, toolCalls, hosting } = await callAgent({
        agentId: 'insights',
        message: `Look up and analyse: ${names.join(', ')}`,
    });

    // 2. Parse the agent's fenced ```json block. ALWAYS null-check.
    const payload = extractFencedJson(text) as { entities?: Insight[] } | null;
    const rows = payload?.entities ?? [];
    if (rows.length === 0) return { records: [], diagnostics: { hosting, toolCalls } };

    // 3. One parameterised INSERT per record. Clean, NULL-safe, and plenty
    //    fast for the handful of rows an interactive lookup produces — no
    //    hand-built VALUES tuples, no clever UNNEST gymnastics. (Each scalar
    //    param round-trips as a string on the wire; that's expected.)
    for (const r of rows) {
        await runMutation(
            `INSERT INTO entity_insights (name, neid, category, confidence, inserted_at)
             VALUES (@name, @neid, @category, @confidence, CURRENT_TIMESTAMP())`,
            {
                params: [
                    { name: 'name', type: 'STRING', value: r.name },
                    { name: 'neid', type: 'STRING', value: r.neid },
                    { name: 'category', type: 'STRING', value: r.category },
                    { name: 'confidence', type: 'FLOAT64', value: r.confidence },
                ],
            }
        );
    }
    return { records: rows, diagnostics: { hosting, toolCalls } };
});
````

> **Don't reach for a multi-column `UNNEST(@arr) WITH OFFSET … JOIN` insert.**
> It looks clever but it's fragile: a BigQuery `ARRAY` **cannot contain NULL
> elements**, so the moment one record has a null `neid`/`confidence` the whole
> statement errors. Per-record `INSERT … VALUES` (above) is the robust default.
>
> Where array params **do** shine is the **read** side — `runQuery` /
> `runMutation` send `value: [...]` as a real `ARRAY<type>`, so you can pass a
> list straight into `UNNEST`:
>
> ```typescript
> // "fetch the rows for exactly these NEIDs" — one param, any N, no string-building
> const res = await runQuery(`SELECT * FROM entity_insights WHERE neid IN UNNEST(@neids)`, {
>     params: [{ name: 'neids', type: 'STRING', value: neids }], // string[] → ARRAY<STRING>
> });
> ```

### Destructive verbs — confirm before calling

`runMutation` will happily run `DROP TABLE`, `TRUNCATE`, or
`DELETE` without a `WHERE`. The gateway doesn't second-guess
intent — the UI must. Pattern:

```vue
<script setup lang="ts">
    async function dropTable(name: string) {
        const ok = window.confirm(
            `This permanently deletes the table ${name} and all its data. Continue?`
        );
        if (!ok) return;
        await $fetch(`/api/bq/tables/${name}`, { method: 'DELETE' });
    }
</script>
```

## Wire-format gotcha: `toRowObjects()` returns raw BQ strings

`toRowObjects()` does NOT decode BigQuery's wire-format scalars into
the obvious JavaScript types. Every value comes back as a string,
keyed by column name. The caller is responsible for parsing.

| BQ type     | Wire format you'll receive                                              | How to parse                                                                             |
| ----------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `STRING`    | the string itself                                                       | use as-is                                                                                |
| `INT64`     | a decimal string (e.g. `"42"`)                                          | `Number(v)` or `BigInt(v)` if it might exceed `Number.MAX_SAFE_INTEGER`                  |
| `FLOAT64`   | a decimal string (e.g. `"3.14"`)                                        | `Number(v)`                                                                              |
| `BOOL`      | `"true"` / `"false"`                                                    | `v === 'true'`                                                                           |
| `DATE`      | ISO date string (e.g. `"2026-05-19"`)                                   | `new Date(v)` or use as-is                                                               |
| `TIMESTAMP` | **fractional Unix epoch seconds** as a string (e.g. `"1779242063.072"`) | `new Date(Number(v) * 1000)` — NOT `new Date(v)`, which silently produces `Invalid Date` |
| `DATETIME`  | ISO datetime without zone (e.g. `"2026-05-19T20:00:00"`)                | `new Date(v + 'Z')` if you want UTC                                                      |
| `JSON`      | the JSON-encoded string                                                 | `JSON.parse(v)`                                                                          |
| `BYTES`     | base64                                                                  | `atob(v)` / `Buffer.from(v, 'base64')`                                                   |

`TIMESTAMP` is the one that catches every agent: passing the wire
value straight to `new Date()` produces `Invalid Date` because JS
doesn't recognise fractional epoch seconds. A standard helper to keep
in any page that renders timestamps:

```typescript
function formatTimestamp(raw: string | null | undefined): string {
    if (!raw) return '';
    const asNumber = Number(raw);
    const date = Number.isFinite(asNumber) ? new Date(asNumber * 1000) : new Date(raw);
    if (Number.isNaN(date.getTime())) return String(raw);
    return date.toLocaleString();
}
```

The fallback to `new Date(raw)` keeps this helper safe if a future BQ
client (or a JOIN that produces `DATETIME`) ever returns ISO strings
instead.

If you want typed values without writing per-column parsers, do the
casting in SQL with `UNIX_MILLIS(ts)` or `FORMAT_TIMESTAMP('%FT%T%Ez', ts)`
before `SELECT`ing — BQ will still return a string, but it'll be one
that `new Date()` accepts.

## Gotcha: `AT` is a reserved keyword

BigQuery reserves `AT` (for `... AT SYSTEM_TIME`). The very first query
most apps write is a health-check "ping" — and the natural alias for a
timestamp column is `at`:

```sql
-- ❌ fails: "Syntax error: Unexpected keyword AT"
SELECT CURRENT_TIMESTAMP() AS at;

-- ✅ use a non-reserved alias
SELECT CURRENT_TIMESTAMP() AS ts;

-- ✅ or backtick it if you really want the column named `at`
SELECT CURRENT_TIMESTAMP() AS `at`;
```

This bites ping/health queries before any real analytics, so reach for
`ts` (or backticks) from the start. Same applies to other reserved words
(`hash`, `current`, `range`, …) — backtick any alias you're unsure about.

## Guardrails the gateway enforces

|                      | Read (`runQuery` / `/query`)                                                                          | Write (`runMutation` / `/mutation`)                                          |
| -------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Allowed verbs        | `SELECT`, `WITH`, `CALL`                                                                              | `INSERT`, `UPDATE`, `DELETE`, `MERGE`, `TRUNCATE`, `CREATE`, `DROP`, `ALTER` |
| Refused verbs        | DML, DDL, `CREATE`/`DROP`                                                                             | `SELECT`, `WITH`, `CALL`, `GRANT`, `REVOKE`, `EXPORT DATA`, `LOAD DATA`      |
| Bytes scanned cap    | 10 GB (default 1 GB)                                                                                  | 10 GB (default 1 GB)                                                         |
| Row cap              | 10,000 per call (default 1,000)                                                                       | n/a — DML/DDL doesn't return rows                                            |
| Wall-clock           | 30 s; sets `truncated: true` if BQ ran out of time                                                    | 60 s; sets `pending: true` if BQ ran out of time (job continues server-side) |
| Cross-project safety | Portal SA only has roles inside the tenant's GCP project — cross-project references 403 at the BQ API | Same                                                                         |

For row-by-row append from a long-running job, prefer a compute job
(K8s Job) or Workflow in the tenant project writing directly via the
official BQ client — the sync gateway is the wrong tool for streaming
inserts.

## Local dev

`NUXT_PUBLIC_BIGQUERY_*` are intentionally unset in local `.env`.
`isBigQueryConfigured()` returns false, helpers throw with a clear
message ("BigQuery is not configured for this tenant…"). Test BQ
features on the deployed preview/production URL where the env vars
are injected.

## Where the data goes

Compute jobs (K8s Jobs on the per-tenant GKE cluster) and Workflows
in the tenant project write to `bctenant_analytics` (see
[`compute.md`](compute.md) and [`deployment.md`](deployment.md)). The
tenant app reads from that dataset
through this gateway. Round-trip:

```
Compute job (K8s) → BigQuery (bctenant_analytics) → Portal gateway → Aether app
                                                       ↑
                                                  portal SA's ADC
```

If you see "Permission denied on resource project" in the gateway
response, the dataset's IAM was likely created in a previous tenant
version and is missing the portal SA. Re-run "Enable BigQuery" in the
portal cockpit to reconcile.
