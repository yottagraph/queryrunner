/**
 * BigQuery client for the tenant Aether app.
 *
 * ╔════════════════════════════════════════════════════════════════════╗
 * ║                  TWO TRANSPORTS, PICKED AUTOMATICALLY               ║
 * ║                                                                    ║
 * ║  This file talks to BigQuery one of two ways, decided at runtime   ║
 * ║  by `isDirectMode()` — you do NOT choose, and you must NOT add a    ║
 * ║  third path:                                                       ║
 * ║                                                                    ║
 * ║  1. DIRECT (BC 2.0, GKE-hosted): the pod runs under Workload       ║
 * ║     Identity in its own per-tenant GCP project, so it calls the    ║
 * ║     BigQuery REST API directly using an access token from the GKE  ║
 * ║     metadata server (ADC). No portal hop, no SA key. This is the   ║
 * ║     whole point of BC 2.0 — the app talks to its own project's     ║
 * ║     services directly. Gated on `GOOGLE_CLOUD_PROJECT` being set    ║
 * ║     (only true inside the GKE pod, never on Vercel).               ║
 * ║                                                                    ║
 * ║  2. GATEWAY (legacy/transitional, Vercel-hosted): the Vercel       ║
 * ║     function can't hold a GCP identity, so it proxies through the  ║
 * ║     Broadchurch Portal gateway, which runs the job with the        ║
 * ║     portal's service account.                                      ║
 * ║                                                                    ║
 * ║  If you (the AI agent) are thinking about:                         ║
 * ║    • pasting a `GOOGLE_SERVICE_ACCOUNT_KEY` env  ← STOP            ║
 * ║    • setting `GOOGLE_APPLICATION_CREDENTIALS`    ← STOP            ║
 * ║    • hand-rolling a different BigQuery client    ← STOP            ║
 * ║                                                                    ║
 * ║  Both transports are already wired. The tenant never needs a       ║
 * ║  service-account JSON: GKE uses Workload Identity, Vercel uses     ║
 * ║  the gateway. Read `.agents/skills/aether/bigquery.md`.            ║
 * ╚════════════════════════════════════════════════════════════════════╝
 *
 * All helpers in this file must be called from Nitro server routes
 * (`server/api/**`) — never from `<script setup>` or client-side
 * code. Both transports require server-side credentials (the GKE
 * metadata server / the gateway) that don't exist in the browser.
 */

interface GatewayEnv {
    gatewayUrl: string;
    orgId: string;
    datasetId: string | null;
    projectId: string | null;
    location: string | null;
}

function readGatewayEnv(): GatewayEnv | null {
    const gatewayUrl = process.env.NUXT_PUBLIC_GATEWAY_URL;
    const orgId = process.env.NUXT_PUBLIC_TENANT_ORG_ID;
    if (!gatewayUrl || !orgId) return null;
    return {
        gatewayUrl: gatewayUrl.replace(/\/+$/, ''),
        orgId,
        datasetId: process.env.NUXT_PUBLIC_BIGQUERY_DATASET_ID || null,
        projectId: process.env.NUXT_PUBLIC_BIGQUERY_PROJECT_ID || null,
        location: process.env.NUXT_PUBLIC_BIGQUERY_LOCATION || null,
    };
}

/**
 * Direct mode = the app is running inside its own GCP project (GKE pod
 * with Workload Identity), so it can reach BigQuery without the portal.
 *
 * `GOOGLE_CLOUD_PROJECT` is injected on the GKE Deployment (the chart
 * sets it to the per-tenant project id) and is never set on Vercel, so
 * it's a clean positive signal for "ADC is available in this process."
 * Vercel builds fall through to the gateway transport below.
 */
function isDirectMode(): boolean {
    return !!process.env.GOOGLE_CLOUD_PROJECT && process.env.VERCEL !== '1';
}

/**
 * Whether BigQuery is provisioned for this tenant. Returns false in
 * local dev (env vars unset) AND in deployed builds where the tenant
 * opted out of BQ at provision time.
 *
 * Pages and routes should call this early and render a "BigQuery is
 * not configured for this app" state instead of throwing.
 */
export function isBigQueryConfigured(): boolean {
    return process.env.NUXT_PUBLIC_BIGQUERY_ENABLED === 'true';
}

/**
 * The default analytics dataset for this tenant, or null if BQ isn't
 * configured. Pass this as `defaultDataset` to `runQuery()` so the
 * agent's SQL can write `FROM events` instead of fully-qualified
 * `FROM \`project.dataset.events\``.
 */
export function getDefaultDataset(): string | null {
    return process.env.NUXT_PUBLIC_BIGQUERY_DATASET_ID || null;
}

export function getBigQueryProjectId(): string | null {
    return process.env.NUXT_PUBLIC_BIGQUERY_PROJECT_ID || null;
}

export function getBigQueryLocation(): string | null {
    return process.env.NUXT_PUBLIC_BIGQUERY_LOCATION || null;
}

export interface BqDataset {
    datasetId: string;
    projectId: string;
    location?: string;
    labels?: Record<string, string>;
    friendlyName?: string;
}

export interface BqTableField {
    name: string;
    type: string;
    mode?: string;
    description?: string;
    fields?: BqTableField[];
}

export interface BqTable {
    tableId: string;
    type?: string;
    numRows?: string | null;
    numBytes?: string | null;
    lastModifiedTime?: string | null;
    schema?: { fields: BqTableField[] };
    description?: string;
}

export interface BqQueryResult {
    /** Column definitions, in result order. */
    schema: BqTableField[];
    /**
     * Raw BigQuery v2 rows. Each row is `{ f: [{ v: ... }, ...] }`.
     * Use `toRowObjects()` to convert into `Record<string, unknown>[]`.
     */
    rows: Array<{ f: Array<{ v: unknown }> }>;
    totalRows: string;
    totalBytesProcessed: string;
    cacheHit: boolean;
    jobId: string;
    truncated: boolean;
}

export interface BqQueryParam {
    name: string;
    /**
     * BigQuery element type: STRING / INT64 / FLOAT64 / BOOL / DATE /
     * TIMESTAMP / etc. When `value` is an array this is the element type
     * and the parameter is sent as `ARRAY<type>` (so `@p` works inside
     * `UNNEST(@p)` / `x IN UNNEST(@p)`).
     */
    type: string;
    /**
     * Scalar value, OR an array of scalars for an `ARRAY<type>` param.
     * Scalars are stringified on the wire (BigQuery's REST contract);
     * `null` / `undefined` become a typed NULL.
     */
    value: unknown;
}

export interface RunQueryOptions {
    /** Default 1000, max 10000. */
    maxResults?: number;
    /** Default 1 GB, max 10 GB. BigQuery rejects queries that would scan more. */
    maxBytesBilled?: number;
    params?: BqQueryParam[];
    /**
     * Default dataset for unqualified table references. Defaults to
     * the tenant's analytics dataset.
     */
    defaultDataset?: string;
}

export interface BqMutationResult {
    jobId: string;
    /**
     * BigQuery's classification of the statement (e.g. `INSERT`,
     * `UPDATE`, `CREATE_TABLE`, `DROP_TABLE`). Useful for the UI to
     * render a precise "Inserted 3 rows" / "Created table" message.
     */
    statementType: string | null;
    /** For DML, number of rows affected. `null` for DDL. */
    numDmlAffectedRows: string | null;
    /** For DML, detailed insert/update/delete counts. `null` for DDL. */
    dmlStats: {
        insertedRowCount?: string;
        updatedRowCount?: string;
        deletedRowCount?: string;
    } | null;
    totalBytesProcessed: string;
    /**
     * True when BigQuery didn't finish the mutation inside the sync
     * window. The job is still running server-side; callers should
     * treat this as "in flight" rather than retrying.
     */
    pending: boolean;
}

export interface RunMutationOptions {
    params?: BqQueryParam[];
    /**
     * Default dataset for unqualified table references. Defaults to
     * the tenant's analytics dataset.
     */
    defaultDataset?: string;
    /** Default 1 GB, max 10 GB. */
    maxBytesBilled?: number;
}

const DEFAULT_MAX_BYTES_BILLED = 1024 * 1024 * 1024; // 1 GB
const MAX_MAX_BYTES_BILLED = 10 * 1024 * 1024 * 1024; // 10 GB
const DEFAULT_MAX_RESULTS = 1000;
const MAX_MAX_RESULTS = 10000;

function configError(): Error {
    return new Error(
        'BigQuery is not configured for this tenant. In direct (GKE) mode set ' +
            'NUXT_PUBLIC_BIGQUERY_ENABLED=true + NUXT_PUBLIC_BIGQUERY_PROJECT_ID + ' +
            'GOOGLE_CLOUD_PROJECT; in gateway (Vercel) mode also set ' +
            'NUXT_PUBLIC_GATEWAY_URL + NUXT_PUBLIC_TENANT_ORG_ID. In local dev these are ' +
            'intentionally unset — check `isBigQueryConfigured()` before calling BQ helpers.'
    );
}

// ─────────────────────────────────────────────────────────────────────
// DIRECT transport (BC 2.0, GKE Workload Identity → BigQuery REST API)
// ─────────────────────────────────────────────────────────────────────

const METADATA_TOKEN_URL =
    'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';

let _tokenCache: { token: string; expiresAt: number } | null = null;

/**
 * Fetch an OAuth access token for the pod's Workload-Identity-bound GSA
 * from the GKE metadata server. Cached until ~1 min before expiry so we
 * don't hit the metadata server on every call.
 */
async function directAccessToken(): Promise<string> {
    const now = Date.now();
    if (_tokenCache && _tokenCache.expiresAt > now + 60_000) {
        return _tokenCache.token;
    }
    const res = await fetch(METADATA_TOKEN_URL, {
        headers: { 'Metadata-Flavor': 'Google' },
    });
    if (!res.ok) {
        throw new Error(
            `bigquery: failed to obtain Workload Identity token from metadata server (${res.status} ${res.statusText})`
        );
    }
    const json = (await res.json()) as { access_token: string; expires_in: number };
    _tokenCache = {
        token: json.access_token,
        expiresAt: now + (json.expires_in ?? 3600) * 1000,
    };
    return json.access_token;
}

function directProjectId(): string {
    const projectId =
        process.env.NUXT_PUBLIC_BIGQUERY_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
    if (!projectId) throw configError();
    return projectId;
}

async function bqRest<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
    const token = await directAccessToken();
    const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${directProjectId()}${path}`;
    const res = await fetch(url, {
        method: init?.method || 'GET',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: init?.body ? JSON.stringify(init.body) : undefined,
    });
    if (!res.ok) {
        let detail = `${res.status} ${res.statusText}`;
        try {
            const json = (await res.json()) as { error?: { message?: string } };
            detail = json.error?.message || detail;
        } catch {
            // body wasn't JSON; keep the status-line detail
        }
        throw new Error(`bigquery: ${detail}`);
    }
    return res.json() as Promise<T>;
}

function clampMaxBytes(maxBytesBilled?: number): string {
    const v = Math.min(maxBytesBilled ?? DEFAULT_MAX_BYTES_BILLED, MAX_MAX_BYTES_BILLED);
    return String(v);
}

function scalarParamValue(v: unknown) {
    return { value: v === null || v === undefined ? null : String(v) };
}

function toQueryParameters(params?: BqQueryParam[]) {
    if (!params || params.length === 0) return undefined;
    return params.map((p) => {
        // ARRAY<type> param: lets `@p` drive `UNNEST(@p)` / `x IN UNNEST(@p)`.
        // BigQuery's REST shape is parameterType.arrayType + arrayValues —
        // NOT a stringified value, which is why a bare `String(p.value)`
        // silently collapsed arrays to a comma-joined STRING before.
        if (Array.isArray(p.value)) {
            return {
                name: p.name,
                parameterType: { type: 'ARRAY', arrayType: { type: p.type } },
                parameterValue: { arrayValues: p.value.map(scalarParamValue) },
            };
        }
        return {
            name: p.name,
            parameterType: { type: p.type },
            parameterValue: scalarParamValue(p.value),
        };
    });
}

interface BqV2QueryResponse {
    schema?: { fields: BqTableField[] };
    rows?: Array<{ f: Array<{ v: unknown }> }>;
    totalRows?: string;
    totalBytesProcessed?: string;
    cacheHit?: boolean;
    jobComplete?: boolean;
    jobReference?: { jobId?: string };
    pageToken?: string;
    numDmlAffectedRows?: string;
    dmlStats?: {
        insertedRowCount?: string;
        updatedRowCount?: string;
        deletedRowCount?: string;
    };
}

async function directRunQuery(sql: string, options: RunQueryOptions): Promise<BqQueryResult> {
    const datasetId = options.defaultDataset ?? getDefaultDataset() ?? undefined;
    const maxResults = Math.min(options.maxResults ?? DEFAULT_MAX_RESULTS, MAX_MAX_RESULTS);
    const body: Record<string, unknown> = {
        query: sql,
        useLegacySql: false,
        maxResults,
        maximumBytesBilled: clampMaxBytes(options.maxBytesBilled),
        timeoutMs: 30_000,
    };
    const location = getBigQueryLocation();
    if (location) body.location = location;
    if (datasetId) body.defaultDataset = { datasetId, projectId: directProjectId() };
    const qp = toQueryParameters(options.params);
    if (qp) {
        body.parameterMode = 'NAMED';
        body.queryParameters = qp;
    }

    let res = await bqRest<BqV2QueryResponse>('/queries', { method: 'POST', body });

    // jobs.query may return jobComplete=false for slow queries; poll
    // getQueryResults a bounded number of times before giving up.
    const jobId = res.jobReference?.jobId;
    let attempts = 0;
    while (!res.jobComplete && jobId && attempts < 3) {
        attempts += 1;
        const params = new URLSearchParams({
            maxResults: String(maxResults),
            timeoutMs: '30000',
        });
        if (location) params.set('location', location);
        res = await bqRest<BqV2QueryResponse>(
            `/queries/${encodeURIComponent(jobId)}?${params.toString()}`
        );
    }

    const rows = res.rows ?? [];
    const totalRows = res.totalRows ?? String(rows.length);
    return {
        schema: res.schema?.fields ?? [],
        rows,
        totalRows,
        totalBytesProcessed: res.totalBytesProcessed ?? '0',
        cacheHit: res.cacheHit ?? false,
        jobId: jobId ?? '',
        truncated: Boolean(res.pageToken) || Number(totalRows) > rows.length,
    };
}

interface BqV2Job {
    jobReference?: { jobId?: string };
    status?: { state?: string };
    statistics?: {
        query?: {
            statementType?: string;
            totalBytesProcessed?: string;
            numDmlAffectedRows?: string;
            dmlStats?: {
                insertedRowCount?: string;
                updatedRowCount?: string;
                deletedRowCount?: string;
            };
        };
    };
}

async function directRunMutation(
    sql: string,
    options: RunMutationOptions
): Promise<BqMutationResult> {
    const datasetId = options.defaultDataset ?? getDefaultDataset() ?? undefined;
    const body: Record<string, unknown> = {
        query: sql,
        useLegacySql: false,
        maximumBytesBilled: clampMaxBytes(options.maxBytesBilled),
        timeoutMs: 30_000,
    };
    const location = getBigQueryLocation();
    if (location) body.location = location;
    if (datasetId) body.defaultDataset = { datasetId, projectId: directProjectId() };
    const qp = toQueryParameters(options.params);
    if (qp) {
        body.parameterMode = 'NAMED';
        body.queryParameters = qp;
    }

    const res = await bqRest<BqV2QueryResponse>('/queries', { method: 'POST', body });
    const jobId = res.jobReference?.jobId ?? '';

    if (!res.jobComplete) {
        // Still running server-side; mirror the gateway's "pending" contract.
        return {
            jobId,
            statementType: null,
            numDmlAffectedRows: res.numDmlAffectedRows ?? null,
            dmlStats: res.dmlStats ?? null,
            totalBytesProcessed: res.totalBytesProcessed ?? '0',
            pending: true,
        };
    }

    // jobs.query doesn't return statementType; fetch the job to enrich
    // the result so the UI can render a precise verb (CREATE_TABLE etc.).
    let statementType: string | null = null;
    let dmlStats = res.dmlStats ?? null;
    let numDmlAffectedRows = res.numDmlAffectedRows ?? null;
    let totalBytesProcessed = res.totalBytesProcessed ?? '0';
    if (jobId) {
        try {
            const params = new URLSearchParams();
            if (location) params.set('location', location);
            const qs = params.toString();
            const job = await bqRest<BqV2Job>(
                `/jobs/${encodeURIComponent(jobId)}${qs ? `?${qs}` : ''}`
            );
            const q = job.statistics?.query;
            statementType = q?.statementType ?? null;
            dmlStats = q?.dmlStats ?? dmlStats;
            numDmlAffectedRows = q?.numDmlAffectedRows ?? numDmlAffectedRows;
            totalBytesProcessed = q?.totalBytesProcessed ?? totalBytesProcessed;
        } catch {
            // Best-effort enrichment; the mutation already succeeded.
        }
    }

    return {
        jobId,
        statementType,
        numDmlAffectedRows,
        dmlStats,
        totalBytesProcessed,
        pending: false,
    };
}

interface BqV2DatasetListItem {
    datasetReference?: { datasetId?: string; projectId?: string };
    location?: string;
    labels?: Record<string, string>;
    friendlyName?: string;
}

async function directListDatasets(): Promise<BqDataset[]> {
    const res = await bqRest<{ datasets?: BqV2DatasetListItem[] }>('/datasets');
    return (res.datasets ?? []).map((d) => ({
        datasetId: d.datasetReference?.datasetId ?? '',
        projectId: d.datasetReference?.projectId ?? directProjectId(),
        location: d.location,
        labels: d.labels,
        friendlyName: d.friendlyName,
    }));
}

interface BqV2TableListItem {
    tableReference?: { tableId?: string };
    type?: string;
}

interface BqV2Table {
    tableReference?: { tableId?: string };
    type?: string;
    numRows?: string;
    numBytes?: string;
    lastModifiedTime?: string;
    schema?: { fields: BqTableField[] };
    description?: string;
}

async function directListTables(datasetId: string, withSchema: boolean): Promise<BqTable[]> {
    const res = await bqRest<{ tables?: BqV2TableListItem[] }>(
        `/datasets/${encodeURIComponent(datasetId)}/tables?maxResults=1000`
    );
    const tables = res.tables ?? [];
    if (!withSchema) {
        return tables.map((t) => ({
            tableId: t.tableReference?.tableId ?? '',
            type: t.type,
        }));
    }
    // Fan out for schema + counts, capped at 200 to bound the request
    // volume (mirrors the gateway's behaviour).
    const capped = tables.slice(0, 200);
    return Promise.all(
        capped.map(async (t) => {
            const tableId = t.tableReference?.tableId ?? '';
            try {
                const full = await bqRest<BqV2Table>(
                    `/datasets/${encodeURIComponent(datasetId)}/tables/${encodeURIComponent(tableId)}`
                );
                return {
                    tableId,
                    type: full.type ?? t.type,
                    numRows: full.numRows ?? null,
                    numBytes: full.numBytes ?? null,
                    lastModifiedTime: full.lastModifiedTime ?? null,
                    schema: full.schema,
                    description: full.description,
                };
            } catch {
                return { tableId, type: t.type };
            }
        })
    );
}

// ─────────────────────────────────────────────────────────────────────
// GATEWAY transport (legacy/transitional, Vercel → Broadchurch Portal)
// ─────────────────────────────────────────────────────────────────────

async function gatewayFetch<T>(
    path: string,
    init?: RequestInit & { method?: string; body?: unknown }
): Promise<T> {
    const env = readGatewayEnv();
    if (!env) throw configError();
    const url = `${env.gatewayUrl}/api/bigquery/${env.orgId}${path}`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const res = await fetch(url, {
        method: init?.method || 'GET',
        headers,
        body: init?.body ? JSON.stringify(init.body) : undefined,
    });
    if (!res.ok) {
        let detail = `${res.status} ${res.statusText}`;
        try {
            const json = (await res.json()) as { statusMessage?: string; message?: string };
            detail = json.statusMessage || json.message || detail;
        } catch {
            // body wasn't JSON; keep the status-line detail
        }
        throw new Error(`bigquery gateway: ${detail}`);
    }
    return res.json() as Promise<T>;
}

// ─────────────────────────────────────────────────────────────────────
// Public API — branches on transport, identical contract either way
// ─────────────────────────────────────────────────────────────────────

/**
 * List datasets visible in the tenant project. In direct mode the
 * runtime GSA needs `bigquery.metadataViewer` (granted by gcp-bctenant);
 * in gateway mode the portal SA has it project-wide. Note: datasets the
 * runtime identity lacks row access to still list here but won't be
 * readable via `runQuery` until dataset ACLs are added.
 */
export async function listDatasets(): Promise<BqDataset[]> {
    if (isDirectMode()) return directListDatasets();
    const res = await gatewayFetch<{ project_id: string; datasets: BqDataset[] }>('/datasets');
    return res.datasets;
}

/**
 * List tables in a dataset. When `withSchema` is true (the default)
 * the first 200 tables come back with full schema + row/byte counts;
 * use `false` for very large datasets where the schema fan-out would
 * be slow.
 */
export async function listTables(
    datasetId: string,
    options: { withSchema?: boolean } = {}
): Promise<BqTable[]> {
    const withSchema = options.withSchema !== false;
    if (isDirectMode()) return directListTables(datasetId, withSchema);
    const res = await gatewayFetch<{
        project_id: string;
        dataset_id: string;
        tables: BqTable[];
    }>(`/tables/${encodeURIComponent(datasetId)}?withSchema=${withSchema ? 'true' : 'false'}`);
    return res.tables;
}

/**
 * Run a read-only SQL query in the tenant project. Only `SELECT` /
 * `WITH` / `CALL` are intended here (use `runMutation` for writes).
 * Caps bytes scanned (default 1 GB, max 10 GB) and rows returned
 * (default 1000, max 10000).
 *
 * Use `toRowObjects()` to convert the result into a `Record[]` for
 * easy serialization back to the client.
 *
 * COMMON GOTCHA — `AT` is a reserved keyword in BigQuery (`... AT
 * SYSTEM_TIME`). A bare `AS at` alias (e.g. `SELECT CURRENT_TIMESTAMP()
 * AS at`) fails at runtime with "Syntax error: Unexpected keyword AT".
 * Use a non-reserved alias like `AS ts`, or backtick it: `` AS `at` ``.
 * This bites health-check / "ping" queries first, so it's called out
 * here rather than left to discover at runtime.
 */
export async function runQuery(sql: string, options: RunQueryOptions = {}): Promise<BqQueryResult> {
    if (isDirectMode()) return directRunQuery(sql, options);
    const env = readGatewayEnv();
    if (!env) throw configError();
    const defaultDataset = options.defaultDataset ?? env.datasetId ?? undefined;
    const body: Record<string, unknown> = { sql };
    if (options.maxResults !== undefined) body.maxResults = options.maxResults;
    if (options.maxBytesBilled !== undefined) body.maxBytesBilled = options.maxBytesBilled;
    if (options.params && options.params.length > 0) body.params = options.params;
    if (defaultDataset) body.defaultDataset = defaultDataset;
    return gatewayFetch<BqQueryResult>('/query', { method: 'POST', body });
}

/**
 * Run a write SQL statement (DML or DDL) in the tenant project.
 *
 * Accepts: `INSERT`, `UPDATE`, `DELETE`, `MERGE`, `TRUNCATE`,
 * `CREATE TABLE` / `CREATE OR REPLACE TABLE` / `CREATE TABLE IF NOT EXISTS`,
 * `DROP TABLE`, `ALTER TABLE`, `CREATE VIEW`, `DROP VIEW`,
 * `CREATE SCHEMA`, `DROP SCHEMA`.
 *
 * Mutations cost money and aren't easily undone — surface a confirmation
 * dialog before calling for destructive verbs (`DROP`, `TRUNCATE`,
 * `DELETE` without a `WHERE`).
 *
 * If the response comes back with `pending: true`, the mutation didn't
 * finish inside the sync window but is still running server-side.
 * Don't retry; surface "still running" to the user instead.
 */
export async function runMutation(
    sql: string,
    options: RunMutationOptions = {}
): Promise<BqMutationResult> {
    if (isDirectMode()) return directRunMutation(sql, options);
    const env = readGatewayEnv();
    if (!env) throw configError();
    const defaultDataset = options.defaultDataset ?? env.datasetId ?? undefined;
    const body: Record<string, unknown> = { sql };
    if (options.maxBytesBilled !== undefined) body.maxBytesBilled = options.maxBytesBilled;
    if (options.params && options.params.length > 0) body.params = options.params;
    if (defaultDataset) body.defaultDataset = defaultDataset;
    return gatewayFetch<BqMutationResult>('/mutation', { method: 'POST', body });
}

/**
 * Helper to flatten the BigQuery `{ f: [{ v: ... }] }` row format
 * into plain `Record<string, unknown>[]` keyed by column name.
 *
 * ⚠️  Scalars round-trip as STRINGS, in BOTH directions. BigQuery's REST
 * API returns every scalar as a string — yes, even INT64 / FLOAT64 /
 * NUMERIC / BOOL — and the query params this module sends are stringified
 * too (see `parameterValue.value`). So a column you wrote as the JS number
 * `80208000000` reads back as the string `"80208000000"`. That looks like
 * a bug in dev tools but is correct and lossless. This helper leaves values
 * as-is so the caller controls precision; reach for `toTypedRowObjects()`
 * when you'd rather get JS `number`/`boolean` back for the common case.
 */
export function toRowObjects(result: BqQueryResult): Record<string, unknown>[] {
    return result.rows.map((row) => {
        const obj: Record<string, unknown> = {};
        result.schema.forEach((field, idx) => {
            obj[field.name] = row.f[idx]?.v ?? null;
        });
        return obj;
    });
}

/**
 * Like `toRowObjects()` but coerces each scalar to a JS type based on its
 * column's BigQuery type — so you don't hand-write `Number(row.x)` for
 * every numeric column. NULLs always pass through as `null`.
 *
 *   - INT64 / INTEGER / FLOAT64 / FLOAT / NUMERIC / BIGNUMERIC → `number`
 *   - BOOL / BOOLEAN                                           → `boolean`
 *   - everything else (STRING, TIMESTAMP, DATE, JSON, …)       → string as-is
 *
 * ⚠️  Precision: BigQuery returns INT64/NUMERIC as strings precisely
 * because some values exceed JS `number` range / exact-decimal needs. If a
 * column can hold values beyond ±2^53 or needs exact decimal math, DON'T
 * coerce it — use `toRowObjects()` and keep the string. REPEATED (array)
 * and RECORD (nested) columns are returned untouched.
 */
export function toTypedRowObjects(result: BqQueryResult): Record<string, unknown>[] {
    return result.rows.map((row) => {
        const obj: Record<string, unknown> = {};
        result.schema.forEach((field, idx) => {
            obj[field.name] = coerceScalar(row.f[idx]?.v ?? null, field);
        });
        return obj;
    });
}

function coerceScalar(v: unknown, field: BqTableField): unknown {
    if (v === null || v === undefined) return null;
    // Only coerce simple scalar leaves; leave arrays / nested records as-is.
    if ((field.mode || '').toUpperCase() === 'REPEATED') return v;
    if (typeof v !== 'string') return v;
    switch ((field.type || '').toUpperCase()) {
        case 'INT64':
        case 'INTEGER':
        case 'FLOAT64':
        case 'FLOAT':
        case 'NUMERIC':
        case 'BIGNUMERIC': {
            const n = Number(v);
            return Number.isFinite(n) ? n : v;
        }
        case 'BOOL':
        case 'BOOLEAN':
            return v === 'true';
        default:
            return v;
    }
}
