/**
 * Postgres access for the tenant Aether app — dual-transport, like
 * `server/utils/bigquery.ts`.
 *
 * ┌──────────────────────────────────────────────────────────────────┐
 * │ DO NOT swap this for a raw `new Pool({ connectionString })` or a   │
 * │ Neon-only client. The transport is picked at runtime and BOTH      │
 * │ paths matter:                                                      │
 * └──────────────────────────────────────────────────────────────────┘
 *
 *   - BC 2.0 (GKE-hosted): the per-tenant Cloud SQL instance is reached
 *     through the **Cloud SQL Auth Proxy sidecar** that the `aether-ui`
 *     Helm chart injects when a connection name is present. The proxy
 *     runs with `--auto-iam-authn`, binds `127.0.0.1:<port>`, and does
 *     the IAM-token + mTLS dance upstream using the pod's Workload
 *     Identity. So the app connects to localhost as the IAM database
 *     user with **no password and no SSL** (the loopback hop is already
 *     inside the pod; the proxy secures the real connection). Signalled
 *     by `CLOUD_SQL_CONNECTION_NAME` + `CLOUD_SQL_IAM_USER` +
 *     `CLOUD_SQL_DATABASE` in the env (rendered by the chart).
 *
 *   - Local dev / Vercel / Neon: a plain `DATABASE_URL` connection
 *     string. Used whenever the Cloud SQL env trio is absent.
 *
 * Why not `@google-cloud/cloud-sql-connector`? It pulls in
 * `google-auth-library`, which the prebuild guard
 * (`scripts/check-no-direct-gcp.js`) forbids — the BC 2.0 posture is to
 * reach GCP via Workload Identity WITHOUT a GCP SDK in the bundle. The
 * Auth Proxy sidecar moves that dependency out of the Node process, so
 * the app only needs `pg`.
 *
 * Cloud SQL warms up for ~5–15 minutes after a tenant is provisioned;
 * until the instance + sidecar are ready, `isDbConfigured()` may be true
 * but a query can still fail. Server routes MUST catch and render a
 * friendly "warming up" / error state rather than throwing.
 */
import pg from 'pg';

type QueryConfig = pg.PoolConfig & { _mode: 'cloudsql-proxy' | 'connection-string' };

let _pool: pg.Pool | null = null;

function resolveConfig(): QueryConfig | null {
    const conn = process.env.CLOUD_SQL_CONNECTION_NAME;
    const iamUser = process.env.CLOUD_SQL_IAM_USER;
    const database = process.env.CLOUD_SQL_DATABASE;

    // Direct GKE mode: connect to the Cloud SQL Auth Proxy sidecar.
    if (conn && iamUser && database) {
        return {
            _mode: 'cloudsql-proxy',
            host: process.env.CLOUD_SQL_HOST || '127.0.0.1',
            port: Number(process.env.CLOUD_SQL_PORT || '5432'),
            user: iamUser,
            database,
            // No password (proxy injects the IAM token) and no SSL
            // (loopback to the in-pod proxy).
            ssl: false,
            max: 5,
        };
    }

    // Fallback: plain connection string (local dev / Vercel / Neon).
    const url = process.env.DATABASE_URL;
    if (url) {
        return { _mode: 'connection-string', connectionString: url, max: 5 };
    }

    return null;
}

/**
 * True when a Postgres transport is wired up (Cloud SQL proxy env trio
 * OR a DATABASE_URL). A `true` here does NOT guarantee the instance is
 * reachable yet — Cloud SQL warm-up + sidecar startup can lag — so
 * callers must still try/catch their queries.
 */
export function isDbConfigured(): boolean {
    return resolveConfig() !== null;
}

/** The active transport, for diagnostics / status endpoints. */
export function dbMode(): 'cloudsql-proxy' | 'connection-string' | 'none' {
    return resolveConfig()?._mode ?? 'none';
}

function getPool(): pg.Pool | null {
    if (_pool) return _pool;
    const cfg = resolveConfig();
    if (!cfg) return null;
    const { _mode, ...poolConfig } = cfg;
    void _mode;
    _pool = new pg.Pool(poolConfig);
    return _pool;
}

/**
 * A Neon-compatible tagged-template query function so route code reads
 * identically on both transports.
 *
 * TWO DISTINCT FAILURE MODES — don't conflate them (they need different
 * UI states):
 *
 *   1. `getDb()` returns `null` → NO transport is configured. Either the
 *      tenant has no Cloud SQL (`DATABASE_URL` / proxy env trio absent),
 *      or you're in local dev. This is "unconfigured", not "warming up".
 *   2. `getDb()` returns a tag but the query THROWS → the transport is
 *      configured but the instance/sidecar isn't reachable yet. Cloud
 *      SQL warms up for ~5–15 min after provision; the pool will throw
 *      `ECONNREFUSED` / timeout until then. THIS is "warming up".
 *
 * So the honest pattern catches both:
 *
 *   const sql = getDb();
 *   if (!sql) return { state: 'unconfigured', rows: [] };
 *   try {
 *     const rows = await sql`SELECT id FROM activity_log ORDER BY id DESC LIMIT 10`;
 *     return { state: 'ready', rows };
 *   } catch (e) {
 *     // connection-level error ⇒ warming up; SQL error ⇒ a real bug.
 *     return { state: 'warming-up', rows: [], error: String(e) };
 *   }
 *
 * (Note the `ORDER BY id` above, not `ORDER BY at` — `at` is fine in
 * Postgres but a reserved word in BigQuery; keep aliases consistent
 * across planes to avoid copy-paste surprises.)
 *
 * Interpolated values are passed as bound `$1..$n` parameters (NOT
 * string-concatenated), so this is injection-safe the same way Neon's
 * tagged template is. Returns `null` when no transport is configured.
 */
export type SqlTag = <T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
) => Promise<T[]>;

export function getDb(): SqlTag | null {
    const pool = getPool();
    if (!pool) return null;
    return async <T = Record<string, unknown>>(
        strings: TemplateStringsArray,
        ...values: unknown[]
    ): Promise<T[]> => {
        const text = strings.reduce(
            (acc, part, i) => acc + part + (i < values.length ? `$${i + 1}` : ''),
            ''
        );
        const result = await pool.query(text, values);
        return result.rows as T[];
    };
}
