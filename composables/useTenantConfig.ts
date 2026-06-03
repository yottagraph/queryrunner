import { ref, readonly } from 'vue';

export interface AgentConfig {
    name: string;
    display_name: string;
    engine_id: string;
}

export interface McpServerConfig {
    name: string;
    url: string;
}

export interface TenantConfig {
    tenant: {
        name: string;
        slug: string;
        status: string;
    };
    agents: AgentConfig[];
    mcp_servers: McpServerConfig[];
    query_server: {
        url: string;
    };
    features: {
        chat: boolean;
        query_explorer: boolean;
        mcp: boolean;
    };
    branding: {
        app_name: string;
        primary_color?: string;
        logo_url?: string;
    };
}

const config = ref<TenantConfig | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
let fetchPromise: Promise<TenantConfig | null> | null = null;

export function useTenantConfig() {
    function getGatewayUrl(): string {
        const rtCfg = useRuntimeConfig();
        return (rtCfg.public as any).gatewayUrl || '';
    }

    function getTenantOrgId(): string {
        const rtCfg = useRuntimeConfig();
        return (rtCfg.public as any).tenantOrgId || '';
    }

    async function fetchConfig(): Promise<TenantConfig | null> {
        if (config.value) return config.value;
        if (fetchPromise) return fetchPromise;

        const gatewayUrl = getGatewayUrl();
        const orgId = getTenantOrgId();

        if (!gatewayUrl || !orgId) {
            error.value = 'Gateway URL or tenant org ID not configured';
            return null;
        }

        loading.value = true;
        error.value = null;

        fetchPromise = (async () => {
            try {
                const result = await $fetch<TenantConfig>(`${gatewayUrl}/api/config/${orgId}`);
                config.value = result;
                return result;
            } catch (e: any) {
                const msg = e.data?.statusMessage || e.message || 'Failed to fetch tenant config';
                error.value = msg;
                console.warn('[useTenantConfig] fetch failed:', msg);
                return null;
            } finally {
                loading.value = false;
                fetchPromise = null;
            }
        })();

        return fetchPromise;
    }

    function refresh() {
        config.value = null;
        fetchPromise = null;
        return fetchConfig();
    }

    return {
        config: readonly(config),
        loading: readonly(loading),
        error: readonly(error),
        fetchConfig,
        refresh,
    };
}
