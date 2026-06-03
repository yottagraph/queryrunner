# Nitro Server Routes

The `server/` directory contains Nuxt's Nitro server layer. These routes deploy
with the app to Vercel -- they are NOT a separate service. They handle
server-side concerns like prefs storage (per-tenant Firestore — ENG-520),
database access, and image proxying that can't run in the browser.

## Directory Layout

```
server/
├── api/
│   ├── a0callback.post.ts   # Auth0 OAuth code-for-token exchange + sealed-cookie set (ENG-768)
│   ├── me.get.ts            # Returns the unsealed current-user payload to the client
│   ├── logout.post.ts       # Clears the sealed session cookie
│   ├── prefs/               # Per-tenant Firestore prefs CRUD — read, write, delete, documents, collections, status (BC 2.0 default)
│   ├── kv/                  # Legacy KV CRUD — read, write, delete, documents, status (BC 1.0 tenants only)
│   └── avatar/[url].ts      # Avatar image proxy
└── utils/
    ├── firestore.ts         # firebase-admin client for the per-tenant Aether prefs Firestore (lazy-init from NUXT_FIRESTORE_SA_KEY)
    ├── localFsPrefsStore.ts # Local-FS prefs fallback for `npm run dev` (`.aether-dev-prefs/`)
    ├── redis.ts             # Upstash Redis client (lazy-init from KV_REST_API_URL) — BC 1.0 legacy
    ├── db.ts                # Postgres client (lazy-init) — Cloud SQL Auth Proxy sidecar on GKE (IAM) / DATABASE_URL elsewhere; pre-scaffolded
    └── cookies.ts           # Cookie handling (@hapi/iron) + server-side secret readers
```

For Firestore (BC 2.0 prefs) / KV (BC 1.0 prefs) / Neon Postgres access
(client usage, provisioning checks, creating tables, handling missing
credentials gracefully), see
[storage.md](storage.md) in this skill. For calling the platform Query
Server from Nitro routes, see [server-data.md](server-data.md) in this
skill.

## Adding Routes

Follow Nitro file-based routing. The filename determines the HTTP method and
path:

```
server/api/my-resource.get.ts      → GET  /api/my-resource
server/api/my-resource.post.ts     → POST /api/my-resource
server/api/my-resource/[id].get.ts → GET  /api/my-resource/:id
```

Route handler pattern:

```typescript
export default defineEventHandler(async (event) => {
    const params = getQuery(event); // query string
    const body = await readBody(event); // POST body
    const id = getRouterParam(event, 'id'); // path params

    // ... implementation ...
    return { result: 'data' };
});
```

## Key Differences from Client-Side Code

- Server routes run on the server (Node.js), not in the browser
- They have access to Firestore (firebase-admin), Redis (legacy KV),
  Neon Postgres, secrets, and server-only APIs
- They do NOT have access to Vue composables, Vuetify, or any client-side code
- Use `defineEventHandler`, not Vue component patterns

## Auto-imports: `useRuntimeConfig()` and `server/utils/*` work server-side

Nitro auto-imports work in `server/api/**` AND `server/utils/**` — you do
**not** need to import them:

- `useRuntimeConfig()` is available directly in any server route or util.
  Read server-only config from the top level (e.g. `runtime.agentBaseUrl`)
  and public config from `runtime.public` (e.g.
  `runtime.public.agentHosting`, `.gatewayUrl`, `.tenantOrgId`,
  `.bigquery*`). These map to the `NUXT_*` / `NUXT_PUBLIC_*` env vars the
  platform injects (see [data.md](data.md)).
- Anything you `export` from `server/utils/*.ts` (e.g. `callAgent`,
  `runQuery`, `isBigQueryConfigured`) is auto-imported into other server
  code. An explicit `import { callAgent } from '~/server/utils/agentCall'`
  also works and reads more clearly — either is fine.

`createError`, `readBody`, `getQuery`, `getRouterParam`, `$fetch`, etc. are
auto-imported too.

See [architecture.md](architecture.md) in this skill for the full data
architecture overview, [storage.md](storage.md) for Firestore / KV /
Postgres patterns, and [pref.md](pref.md) for client-side preferences.
