# Storage

This skill covers **transactional / state** storage — per-tenant
Firestore (always on for BC 2.0 tenants — ENG-520), the legacy KV
store (BC 1.0 tenants only), and Postgres (Cloud SQL on BC 2.0 / GKE,
Neon on BC 1.0 / Vercel — if provisioned). For **analytical /
append-only** reads from large datasets, see [`bigquery.md`](bigquery.md).

| Store                  | How to check                                   | Env var                                                                      | Utility file                                 | Always available?                                    |
| ---------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------- |
| **Firestore** (prefs)  | `NUXT_PUBLIC_FIRESTORE_ENABLED=true` in `.env` | `NUXT_PUBLIC_FIRESTORE_*` + `NUXT_FIRESTORE_SA_KEY`                          | `server/utils/firestore.ts` (pre-scaffolded) | Yes for BC 2.0 tenants                               |
| **KV** (Upstash Redis) | `KV_REST_API_URL` in `.env` (BC 1.0 only)      | `KV_REST_API_URL`, `KV_REST_API_TOKEN`                                       | `server/utils/redis.ts` (pre-scaffolded)     | Yes for BC 1.0 tenants                               |
| **Postgres**           | `isDbConfigured()` from `~/server/utils/db`    | `CLOUD_SQL_*` (BC 2.0 / GKE) **or** `DATABASE_URL` (BC 1.0 / Vercel / local) | `server/utils/db.ts` (pre-scaffolded)        | Only if Cloud SQL / Neon enabled at project creation |

For client-side user preferences that sit on top of Firestore (or KV
on legacy tenants), see [pref.md](pref.md) in this skill — that's the
right entrypoint for almost every prefs use case.

## Where credentials come from

**Deployed builds** (push to `main` → Vercel): storage env vars are
auto-injected and decrypted at runtime. Storage works with zero
configuration. **This is the primary development path** — push your code
and test on the deployed preview/production URL.

**Local dev / Cursor Cloud:**

- **Firestore prefs** — `npm run dev` falls back to a local-filesystem
  store at `.aether-dev-prefs/`. `useAppPrefs` / `useGlobalPrefs` /
  `useAppFeaturePrefs` / `useGlobalFeaturePrefs` persist across page
  refreshes without any cloud setup. Production builds never use the
  fallback. See [pref.md](pref.md) for details.
- **Postgres** — on GKE (BC 2.0) the Cloud SQL Auth Proxy sidecar isn't
  present locally, and `DATABASE_URL` is not injected for local dev, so
  `getDb()` returns `null`. Routes should handle that case (return a
  "database not configured" / "warming up" state or empty payload).

## Firestore (BC 2.0 prefs backend)

`server/utils/firestore.ts` is the per-tenant Firestore wrapper. It
inits `firebase-admin` from `NUXT_FIRESTORE_SA_KEY` (base64-encoded
service-account JSON, injected by the portal) and the
`NUXT_PUBLIC_FIRESTORE_PROJECT_ID` / `NUXT_PUBLIC_FIRESTORE_DATABASE_ID`
pair. Use `getFirestoreDb()` from server routes that need raw doc/
collection access; almost everything client-facing should go through
the prefs composables in [pref.md](pref.md).

```typescript
import { getFirestoreDb } from '~/server/utils/firestore';

const db = getFirestoreDb();
if (db) {
    // Example: a server-side ETL writing to its own per-tenant collection.
    await db.doc('etl/last-run').set({ at: Date.now() }, { merge: true });
}
```

`getFirestoreDb()` returns `null` when Firestore isn't configured (BC 1.0
tenant on KV, or local dev with the FS fallback). The pre-scaffolded
`/api/prefs/*` routes already handle the fallback case — only call
`getFirestoreDb()` directly when you need doc/collection access outside
the prefs surface.

## KV (Upstash Redis — legacy BC 1.0 only)

`server/utils/redis.ts` initializes the Upstash Redis client from env vars
that Vercel auto-injects when a KV store is connected:

- `KV_REST_API_URL` — Redis REST API endpoint
- `KV_REST_API_TOKEN` — Auth token

```typescript
import { getRedis, toRedisKey } from '~/server/utils/redis';

const redis = getRedis();
if (redis) {
    await redis.hset(toRedisKey('/users/abc/settings'), { theme: 'dark' });
    const theme = await redis.hget(toRedisKey('/users/abc/settings'), 'theme');
}
```

Returns `null` if KV is not configured (env vars missing). Always check
before using. Note: new BC 2.0 tenants don't get a KV store — the
portal provisions a per-tenant Firestore instead (see above and
[pref.md](pref.md)). The KV utility + `/api/kv/*` routes stay in the
template so legacy BC 1.0 tenants (Convergence, etc.) keep working
unchanged.

For client-side preferences, use the prefs composables
(`useAppPrefs` / `useGlobalPrefs` / `useAppFeaturePrefs` /
`useGlobalFeaturePrefs`) instead of calling KV routes directly —
see [pref.md](pref.md) in this skill. (BC 1.0 KV-backed tenants
reach the same composables; the client picks the right backend
automatically.)

## Postgres (Cloud SQL on BC 2.0, Neon on BC 1.0)

Postgres is provisioned by the portal, not by what's in `.env`. The
**`server/utils/db.ts`** helper is pre-scaffolded and picks the right
transport at runtime — your route code is identical either way:

- **BC 2.0 (GKE-hosted)** — a per-tenant **Cloud SQL** instance, reached
  through the **Cloud SQL Auth Proxy sidecar** that the `aether-ui` Helm
  chart injects. The proxy runs with `--auto-iam-authn` and authenticates
  with the pod's Workload Identity, so the app connects to the proxy on
  `127.0.0.1` as the IAM user with **no password**. The platform injects
  `CLOUD_SQL_CONNECTION_NAME` / `CLOUD_SQL_DATABASE` / `CLOUD_SQL_IAM_USER`
  (+ `CLOUD_SQL_HOST`/`PORT`); `db.ts` reads them. Nothing for you to wire.
- **BC 1.0 / Vercel / local** — a plain `DATABASE_URL` connection string,
  used whenever the `CLOUD_SQL_*` trio is absent.

> **Do NOT** create `server/utils/neon.ts`, `npm install
@neondatabase/serverless`, or `npm install @google-cloud/cloud-sql-connector`.
> The first is the legacy pattern; the connector pulls in
> `google-auth-library`, which the prebuild guard
> (`scripts/check-no-direct-gcp.js`) rejects. Use the pre-scaffolded
> `~/server/utils/db` helper — it only needs `pg`.

### How to check

```typescript
import { isDbConfigured, dbMode } from '~/server/utils/db';
// isDbConfigured() → true when CLOUD_SQL_* or DATABASE_URL is present
// dbMode() → 'cloudsql-proxy' | 'connection-string' | 'none'  (diagnostics)
```

A `true` from `isDbConfigured()` does **not** guarantee the instance is
reachable: Cloud SQL warms up for ~5–15 min after a tenant is created,
and the sidecar takes a few seconds to come up. Always try/catch queries
and render a "warming up" / error state rather than throwing.

**`getDb() === null` and "warming up" are different states** — don't
conflate them (they want different UI):

- `getDb()` returns **`null`** → no transport configured (no Cloud SQL
  on this tenant, or local dev). That's _unconfigured_, not warming up.
- `getDb()` returns a tag but the **query throws** a connection error
  (`ECONNREFUSED` / timeout) → configured but the instance/sidecar isn't
  up yet. That's the real _warming up_ case, and it's only observable
  inside a `try/catch` around the query — not from the null check.

**Local dev:** neither the sidecar nor `DATABASE_URL` is present, so
`getDb()` returns `null`. Handle that gracefully and test against the
deployed build.

### Usage

`server/utils/db.ts` exports `getDb()` (lazy-init, like `getRedis()` in
`redis.ts`): returns a Neon-style tagged-template query function, or
`null` when no transport is configured.

```typescript
import { getDb } from '~/server/utils/db';

export default defineEventHandler(async () => {
    const sql = getDb();
    // null ⇒ no Cloud SQL on this tenant (or local dev) — unconfigured.
    if (!sql) return { state: 'unconfigured', rows: [] };
    try {
        const rows = await sql`SELECT * FROM notes ORDER BY created_at DESC`;
        return { state: 'ok', rows };
    } catch (e) {
        // Connection error ⇒ the instance/sidecar is still warming up.
        // (A SQL error here is a real bug — surface it in dev.)
        return { state: 'warming-up', rows: [], error: String(e) };
    }
});
```

The tagged template binds interpolated values as `$1..$n` parameters, so
`await sql\`SELECT \* FROM notes WHERE id = ${id}\``is injection-safe.
No ORM, no query builder, no pool setup needed (the helper manages a
small`pg.Pool`).

### Creating tables

There is no migrations framework. Use `CREATE TABLE IF NOT EXISTS` directly
in a setup route or at the top of a route that needs the table:

```typescript
const sql = getDb()!;
await sql`CREATE TABLE IF NOT EXISTS notes (
  id SERIAL PRIMARY KEY,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
)`;
```

For simple apps, putting `CREATE TABLE IF NOT EXISTS` in each route that
uses the table is fine — it's a no-op after the first call. For more complex
schemas, create a `server/api/db/setup.post.ts` route that initializes all
tables.

> **Keep schema/seed SQL inline — don't read `.sql` files from disk at
> runtime.** The deployed UI runs as a Nitro server _bundle_ in the
> per-tenant GKE cluster (or Cloud Run), and that bundle ships only your
> compiled `server/` code — **not** the rest of the repo tree. A route
> that does `readFileSync('sql/schema.sql')` or
> `readFileSync(join(process.cwd(), 'sql', …))` works under local
> `npm run dev` but throws `ENOENT` / "Cannot read sql/ directory" in the
> deployed container, because there is no `sql/` dir next to the bundle.
> Prefer the inline `CREATE TABLE IF NOT EXISTS` strings above. If you
> genuinely must ship a runtime file (a large seed dataset, a templated
> migration), bundle it explicitly via `nitro.serverAssets` and read it
> with `useStorage('assets:…')` — never a `process.cwd()` path:
>
> ```ts
> // nuxt.config.ts
> export default defineNuxtConfig({
>     nitro: { serverAssets: [{ baseName: 'sql', dir: 'server/sql' }] },
> });
> ```
>
> ```ts
> // server/api/db/setup.post.ts
> const schema = await useStorage('assets:sql').getItem('schema.sql');
> ```
>
> (Surfaced in the portfolio-risk smoke test, 2026-06-02: the GKE UI
> container 500'd on `/api/db/setup` with "Cannot read sql/ directory"
> until the SQL files were moved under `server/sql/` and bundled this way.)

### Handle missing tables in GET routes

Tables created by POST/setup routes won't exist on a fresh deployment.
**Every GET route that queries a table must handle the case where the table
doesn't exist yet.** Without this, fresh deploys will 500 on every page load
until the setup route runs.

```typescript
import { getDb } from '~/server/utils/db';

export default defineEventHandler(async () => {
    const sql = getDb();
    if (!sql) return { state: 'warming-up', rows: [] };

    try {
        const rows = await sql`SELECT * FROM companies ORDER BY updated_at DESC`;
        return { state: 'ok', rows };
    } catch (err: any) {
        if (err.message?.includes('does not exist')) {
            return { state: 'ok', rows: [] };
        }
        throw err;
    }
});
```

Alternatively, ensure tables exist before querying by calling
`CREATE TABLE IF NOT EXISTS` at the top of each GET route, or by calling a
shared setup function:

```typescript
// server/utils/ensure-tables.ts
import { getDb } from '~/server/utils/db';

let _initialized = false;

export async function ensureTables() {
    if (_initialized) return;
    const sql = getDb();
    if (!sql) return;

    await sql`CREATE TABLE IF NOT EXISTS companies (
    id SERIAL PRIMARY KEY,
    neid TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    data JSONB DEFAULT '{}',
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`;

    _initialized = true;
}
```

Then call `await ensureTables()` at the start of any route that reads the
table. The `_initialized` flag makes it a no-op after the first call within
the same serverless invocation.

### The helper is pre-scaffolded — don't recreate it

`server/utils/db.ts` ships with the template and handles both transports
(Cloud SQL Auth Proxy on GKE, `DATABASE_URL` elsewhere). Don't write your
own `neon.ts` and don't add `@neondatabase/serverless` or
`@google-cloud/cloud-sql-connector` — the prebuild guard rejects the GCP
connector, and the helper already covers Neon-style `DATABASE_URL` via
`pg`. If `db.ts` is somehow missing, re-run `node init-project.js` or copy
it from the template rather than hand-rolling a Neon client.
