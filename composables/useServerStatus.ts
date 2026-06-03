import { ref, reactive } from 'vue';

type ServerStatus = 'checking' | 'available' | 'unavailable' | 'not-configured';

interface ServerInfo {
    type: string;
    name: string;
    configKey: string;
    status: ServerStatus;
    address?: string;
    lastChecked?: Date;
    error?: string;
}

const server = reactive<ServerInfo>({
    type: 'query',
    name: 'Query API',
    configKey: 'queryServerAddress',
    status: 'checking',
});

let checkInterval: NodeJS.Timeout | null = null;

export function useServerStatus() {
    async function checkServer() {
        // Probe via the same-origin server route — the browser cannot call
        // the Portal QS proxy directly (cross-origin → CORS). The route
        // reaches the QS server-side and reports back. See
        // server/api/qs-status.get.ts.
        try {
            const res = await $fetch<{
                status: ServerStatus;
                address?: string;
                error?: string;
            }>('/api/qs-status', { timeout: 8000 });

            server.status = res.status;
            server.address = res.address;
            server.error = res.error;
            server.lastChecked = new Date();
        } catch (error) {
            server.status = 'unavailable';
            server.error = error instanceof Error ? error.message : 'Unknown error';
            server.lastChecked = new Date();
        }
    }

    function startChecking() {
        checkServer();
        if (!checkInterval) {
            checkInterval = setInterval(checkServer, 30000);
        }
    }

    function stopChecking() {
        if (checkInterval) {
            clearInterval(checkInterval);
            checkInterval = null;
        }
    }

    function getConfiguredServers() {
        return server.status !== 'not-configured' ? [server] : [];
    }

    const overallStatus = computed(() => server.status);

    return {
        servers: readonly(reactive({ query: server })),
        getConfiguredServers,
        serverStatus: overallStatus,
        checkServerStatus: checkServer,
        startChecking,
        stopChecking,
    };
}
