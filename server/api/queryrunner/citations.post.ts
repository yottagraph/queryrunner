/**
 * On-demand source citations for one entity's properties.
 *
 * Citations are deliberately NOT fetched during a query run (rendering is a
 * per-fact round-trip to the QS provenance endpoints — see DESIGN.md). The
 * `/result` page calls this once per `get_entity_properties` tool call when a
 * result is inspected, then merges the citations into the displayed trace.
 *
 * This proxies the elemental-query MCP server's `/citations` custom route
 * (which reuses the QS-native, big-int-safe Python rendering). It degrades
 * gracefully: when the MCP URL isn't configured or the call fails, it returns
 * an empty citation map rather than erroring, so the trace still renders.
 */
interface CitationsRequest {
    neid: string;
    properties: string[];
}

interface CitationsResponse {
    neid: string;
    /** property name → rendered citation object (shape per the QS render API). */
    citations: Record<string, unknown>;
}

export default defineEventHandler(async (event): Promise<CitationsResponse> => {
    const req = await readBody<CitationsRequest>(event);
    const neid = req?.neid;
    const properties = Array.isArray(req?.properties) ? req.properties : [];
    if (!neid || properties.length === 0) {
        return { neid: neid ?? '', citations: {} };
    }

    const runtime = useRuntimeConfig();
    const mcpUrl = (runtime.queryMcpUrl as string) || '';
    if (!mcpUrl) return { neid, citations: {} };

    // The MCP server serves `/mcp` (protocol) and `/citations` (this route)
    // off the same origin; swap the suffix.
    const citationsUrl = mcpUrl.replace(/\/mcp\/?$/, '') + '/citations';

    try {
        const res = await $fetch<{ neid?: string; citations?: Record<string, unknown> }>(
            citationsUrl,
            {
                method: 'POST',
                body: { neid, properties },
                timeout: 60_000,
            }
        );
        return { neid: res?.neid ?? neid, citations: res?.citations ?? {} };
    } catch {
        // MCP unreachable / unauthorized (e.g. prod without an ID token) —
        // degrade to no citations.
        return { neid, citations: {} };
    }
});
