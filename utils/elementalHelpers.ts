/**
 * Helper utilities for Elemental API / Query Server access.
 *
 * Centralizes gateway URL construction, API key retrieval, and NEID
 * formatting so these don't need to be re-derived in every composable.
 */

/**
 * Build a full gateway URL for a Query Server endpoint.
 *
 * @example buildGatewayUrl('entities/search')
 *          → "https://…/api/qs/org_abc123/entities/search"
 */
export function buildGatewayUrl(endpoint: string): string {
    const config = useRuntimeConfig();
    const gw = (config.public as any).gatewayUrl as string;
    const org = (config.public as any).tenantOrgId as string;
    if (!gw || !org) {
        console.warn('[elementalHelpers] gatewayUrl or tenantOrgId not configured');
    }
    const base = `${gw}/api/qs/${org}`;
    return endpoint ? `${base}/${endpoint.replace(/^\//, '')}` : base;
}

/**
 * Return the Query Server API key from runtime config.
 */
export function getApiKey(): string {
    return (useRuntimeConfig().public as any).qsApiKey as string;
}

/**
 * Standard headers for gateway requests.
 */
export function gatewayHeaders(extra?: Record<string, string>): Record<string, string> {
    return {
        'X-Api-Key': getApiKey(),
        'Content-Type': 'application/json',
        ...extra,
    };
}

/**
 * Zero-pad a numeric entity ID to a 20-character NEID string.
 *
 * Relationship properties (`data_nindex`) return raw numeric IDs that are
 * often 19 characters. They must be padded to 20 to form valid NEIDs.
 */
export function padNeid(value: string | number): string {
    return String(value).padStart(20, '0');
}

/**
 * Batch-search entities by name via `POST /entities/search`.
 *
 * This endpoint is not wrapped by the generated `useElementalClient()`,
 * so we call it directly via `$fetch`.
 */
export async function searchEntities(
    query: string,
    options?: { maxResults?: number; flavors?: string[]; includeNames?: boolean }
): Promise<{ neid: string; name: string; score?: number }[]> {
    const url = buildGatewayUrl('entities/search');
    const queryObj: Record<string, any> = { queryId: 1, query };
    if (options?.flavors?.length) queryObj.flavors = options.flavors;

    const res = await $fetch<any>(url, {
        method: 'POST',
        headers: gatewayHeaders(),
        body: {
            queries: [queryObj],
            maxResults: options?.maxResults ?? 10,
            includeNames: options?.includeNames ?? true,
        },
    });
    const matches: any[] = res?.results?.[0]?.matches ?? [];
    return matches.map((m) => ({
        neid: m.neid,
        name: m.name || m.neid,
        score: m.score,
    }));
}

/**
 * Get the display name for an entity by NEID.
 *
 * Calls `GET /entities/{neid}/name` (not on the generated client).
 */
export async function getEntityName(neid: string): Promise<string> {
    const url = buildGatewayUrl(`entities/${neid}/name`);
    const res = await $fetch<{ name: string }>(url, {
        headers: { 'X-Api-Key': getApiKey() },
    });
    return res.name || neid;
}
