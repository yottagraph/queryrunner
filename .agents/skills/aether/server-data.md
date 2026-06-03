# Server routes: Elemental API (Query Server)

Server routes can call the Elemental API through the Portal Gateway proxy,
just like client-side code does. The gateway URL, tenant org ID, and API key
are available via `useRuntimeConfig()`.

**NEVER use `readFileSync('broadchurch.yaml')` in server routes.** The YAML
file is read at build time by `nuxt.config.ts` and its values flow into
`runtimeConfig`. Nitro serverless functions (Vercel) don't bundle arbitrary
project files — `readFileSync` will crash with ENOENT in production even
though it works locally.

```typescript
export default defineEventHandler(async (event) => {
    const { public: config } = useRuntimeConfig();

    const gatewayUrl = config.gatewayUrl; // Portal Gateway base URL
    const orgId = config.tenantOrgId; // Tenant org ID (path segment)
    const apiKey = config.qsApiKey; // API key for X-Api-Key header

    if (!gatewayUrl || !orgId) {
        throw createError({ statusCode: 503, statusMessage: 'Gateway not configured' });
    }

    const res = await $fetch(`${gatewayUrl}/api/qs/${orgId}/entities/search`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(apiKey && { 'X-Api-Key': apiKey }),
        },
        body: { queries: [{ queryId: 1, query: 'Microsoft' }], maxResults: 5 },
    });

    return res;
});
```

Available runtime config keys (all under `runtimeConfig.public`):

| Key                  | Source                                    | Purpose                        |
| -------------------- | ----------------------------------------- | ------------------------------ |
| `gatewayUrl`         | `broadchurch.yaml` → `gateway.url`        | Portal Gateway base URL        |
| `tenantOrgId`        | `broadchurch.yaml` → `tenant.org_id`      | Tenant ID for API path         |
| `qsApiKey`           | `broadchurch.yaml` → `gateway.qs_api_key` | API key sent as `X-Api-Key`    |
| `queryServerAddress` | `broadchurch.yaml` → `query_server.url`   | Direct QS URL (prefer gateway) |

Build the request URL as `{gatewayUrl}/api/qs/{tenantOrgId}/{endpoint}`.
See [data.md](data.md) in this skill for endpoint reference and response shapes.
