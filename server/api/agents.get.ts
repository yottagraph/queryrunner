/**
 * Hosting-aware agent discovery (ADR-021).
 *
 * Returns the list of agents the chat UI can talk to, normalised to
 * `{ id, name }`, so the page stays hosting-agnostic. The `id` is what
 * gets passed to `/api/agent/{id}/stream`:
 *
 *   - `gke` (BC 2.0 in-cluster): proxy the ADK `api_server` `GET /list-apps`
 *     (returns app names = agent directory names). `id` = app name.
 *   - `agent_engine` (default): read the portal's `/api/config/{orgId}`
 *     agent list. `id` = Agent Engine `engine_id`.
 *
 * Always returns `{ agents: [...] }` and never throws on a not-yet-ready
 * backend — an empty list lets the page show its "no agents yet" state.
 */
export default defineEventHandler(async (event) => {
    const runtime = useRuntimeConfig();
    const config = runtime.public as any;
    const agentHosting = config.agentHosting || 'agent_engine';

    if (agentHosting === 'gke') {
        const base = ((runtime.agentBaseUrl as string) || '').replace(/\/+$/, '');
        if (!base) return { agents: [] };
        try {
            const apps = await $fetch<string[]>(`${base}/list-apps`, {
                signal: AbortSignal.timeout(10_000),
            });
            return { agents: (apps || []).map((app) => ({ id: app, name: app })) };
        } catch {
            // api_server not reachable yet (agent still rolling out) — the
            // page polls again, so just report an empty list for now.
            return { agents: [] };
        }
    }

    // Agent Engine path: discover via the portal gateway config.
    const gatewayUrl = config.gatewayUrl;
    const orgId = config.tenantOrgId;
    if (!gatewayUrl || !orgId) return { agents: [] };
    try {
        const cfg = await $fetch<any>(`${gatewayUrl}/api/config/${orgId}`, {
            signal: AbortSignal.timeout(10_000),
        });
        const agents = (cfg?.agents || []).map((a: any) => ({
            id: a.engine_id,
            name: a.display_name || a.name,
        }));
        return { agents };
    } catch {
        return { agents: [] };
    }
});
