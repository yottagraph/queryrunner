# Aether Architecture

Aether is an app framework built on Nuxt 3 + Vue 3 + Vuetify 3 + TypeScript. It follows standard Nuxt conventions -- pages in `pages/`, components in `components/`, composables in `composables/`, server routes in `server/api/`.

**Tech stack**: Nuxt 3 (SPA), Vue 3 Composition API (`<script setup>`), Vuetify 3, TypeScript (required), Auth0 (automatic).

**Data source**: This app runs on the Lovelace platform (entities, news, filings, sentiment, relationships, events). See [data.md](data.md) in this skill for how your app accesses that data. Do not call external APIs for data the platform provides.

## Project Structure

```
pages/              # Routes (file-based routing)
components/         # Reusable Vue components
composables/        # Shared logic (useXxx.ts)
server/api/         # Nitro server routes (deploy with app)
assets/             # CSS, fonts, static assets
utils/              # Pure utility functions
agents/             # ADK agents (Python, deploy to Vertex AI)
mcp-servers/        # MCP servers (Python, deploy to Cloud Run)
```

## Data Architecture

| Store                                                         | Purpose                                       | When to use                                                                                     |
| ------------------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Platform data (Query Server / Postgres per your architecture) | Lovelace knowledge graph or synced local data | See [data.md](data.md)                                                                          |
| Per-tenant Firestore (BC 2.0) / KV (BC 1.0)                   | User preferences, lightweight state           | Settings, watchlists, UI state that should persist                                              |
| Neon Postgres                                                 | App-specific relational data                  | Custom tables, complex queries (if provisioned — see [storage.md](storage.md) for how to check) |

See [storage.md](storage.md) for backend selection and server-side usage (Firestore / KV / Neon Postgres), plus [pref.md](pref.md) for the client-side prefs composables.

## Adding Pages

Create `.vue` files in `pages/`. Nuxt generates routes automatically:

```
pages/index.vue         → /
pages/dashboard.vue     → /dashboard
pages/settings.vue      → /settings
pages/reports/index.vue → /reports
```

## App Shell

`app.vue` provides `AppHeader` (branding, user menu, settings) and renders `<NuxtPage />`. There is no prescribed layout beyond the header -- design whatever UX fits the problem.

## Adding Navigation

Only add navigation if the app genuinely needs multiple views. Choose the pattern that fits the UX:

**Sidebar** -- add to `app.vue` for persistent section navigation:

```vue
<v-navigation-drawer permanent app>
  <v-list nav density="compact">
    <v-list-item title="Dashboard" prepend-icon="mdi-view-dashboard" to="/" />
    <v-list-item title="Reports" prepend-icon="mdi-chart-bar" to="/reports" />
  </v-list>
</v-navigation-drawer>
```

**Top tabs** -- add to `app.vue` or a layout component:

```vue
<v-tabs>
  <v-tab to="/">Dashboard</v-tab>
  <v-tab to="/reports">Reports</v-tab>
</v-tabs>
```

**In-page tabs** -- for subsections within a single page:

```vue
<v-tabs v-model="tab">
  <v-tab value="overview">Overview</v-tab>
  <v-tab value="details">Details</v-tab>
</v-tabs>
<v-window v-model="tab">
  <v-window-item value="overview">...</v-window-item>
  <v-window-item value="details">...</v-window-item>
</v-window>
```

**No nav** -- single-page apps can put everything on `pages/index.vue`.

## Naming Conventions

- **Pages**: `kebab-case.vue`
- **Components**: `PascalCase.vue`
- **Composables**: `useCamelCase.ts`
- **Server routes**: `kebab-case.<method>.ts`

## New Page Checklist

- [ ] Page in `pages/` with `<script setup lang="ts">`
- [ ] Uses Vuetify components and the project's dark theme
- [ ] Updated `DESIGN.md` with current status
- [ ] (Optional) Created a design doc in `design/` for complex features

Design docs in `design/` are most useful for incremental feature work where
you need to plan, track decisions, and coordinate across multiple changes.
For initial app builds via `/build_my_app`, skip the per-page design docs —
they add friction without value when building the whole app at once. Start
using them later when adding features to an established app.

## Server Routes

Nitro server routes live in `server/api/` and deploy with the app to Vercel.
Use server routes when you need to proxy external APIs (avoid CORS), access
data server-side, or keep secrets off the client. Call them from client code
with `$fetch('/api/my-data/fetch')`.

See [server.md](server.md) for file-routing conventions and [storage.md](storage.md) for Neon Postgres patterns.
See [server-data.md](server-data.md) when calling the platform Query Server from server routes.

## Beyond the UI: Agents, MCP Servers, and Server Routes

Aether apps are more than just a Nuxt SPA. The project contains three additional directories that deploy independently:

### `agents/` -- ADK Agents (Python)

Each subdirectory is a self-contained Python agent that deploys to Vertex AI Agent Engine. See [agents.md](agents.md) for development patterns. Agents are deployed via the Broadchurch Portal UI or the `/deploy_agent` Cursor command, both of which trigger `deploy-agent.yml`. Use the `useAgentChat` composable to build a chat UI that talks to them.

**Agent query path:** The app talks to Agent Engine directly — the portal is
only in the auth path. The flow is:

1. Tenant Nitro route (`server/api/agent/[agentId]/stream.post.ts`) calls the
   Portal Gateway's `/authorize` endpoint to get a short-lived (15 min) GCP
   access token minted for the tenant's service account.
2. The Nitro route uses that token to call Agent Engine's `:streamQuery`
   directly — streaming data does NOT flow through the portal.
3. Tokens are cached server-side for their TTL.

If you see a 403 from Agent Engine, the tenant's service account is missing
IAM permissions (`roles/aiplatform.user`). Check the Broadchurch portal's
project detail page for IAM health status.

### `mcp-servers/` -- MCP Servers (Python)

Each subdirectory is a FastMCP server that deploys to Cloud Run. See [mcp-servers.md](mcp-servers.md). Deployed via Portal UI or `/deploy_mcp`, triggering `deploy-mcp.yml`. Agents can connect to MCP servers as tool providers.

### `broadchurch.yaml`

Tenant-specific configuration generated during provisioning. Contains GCP project, org ID, service account, gateway URL, and query server URL. Read by deploy commands and GitHub Actions workflows. Don't edit manually.

## Available Composables for Platform Features

The template ships composables for interacting with the Lovelace platform.
Use these to build whatever UI fits the app:

- **`useAgentChat()`** -- Send messages to deployed ADK agents. Uses the
  local Nitro streaming route (`/api/agent/:agentId/stream`) which calls
  Agent Engine directly with a tenant SA token. Handles streaming, session
  management, and response parsing. Shows clear error messages when IAM
  permissions are missing. See [agents.md](agents.md) for details.
- **`useTenantConfig()`** -- Fetch the tenant's runtime config (deployed
  agents, feature flags, MCP servers) from the Portal Gateway.
- **`useElementalClient()`** -- When using the Elemental API from the client,
  see [data.md](data.md).
- **`useAppPrefs` / `useGlobalPrefs` / `useAppFeaturePrefs` /
  `useGlobalFeaturePrefs` / `usePrefsStatus()`** -- per-tenant
  Firestore-backed user preferences (BC 2.0; KV on legacy BC 1.0
  tenants). Reactive objects with auto-debounced persistence; no
  paths, no schemas to register. See [pref.md](pref.md).
