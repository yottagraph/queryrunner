import { ref, computed } from 'vue';
import { useUserState } from './useUserState';

export interface McpTool {
    name: string;
    description?: string;
    inputSchema?: Record<string, any>;
}

export interface ToolResult {
    toolName: string;
    result: any;
    error?: string;
    timestamp: number;
}

const toolsCache = ref<Record<string, McpTool[]>>({});
const toolsLoading = ref<Record<string, boolean>>({});
const toolsError = ref<Record<string, string | null>>({});
const lastResult = ref<ToolResult | null>(null);
const callLoading = ref(false);

// Per-server MCP session IDs for citation tracking continuity.
const sessionIds = ref<Record<string, string>>({});

export function useMcpExplorer() {
    const { accessToken } = useUserState();

    function getGatewayUrl(): string {
        const config = useRuntimeConfig();
        return (config.public as any).gatewayUrl || '';
    }

    function getTenantOrgId(): string {
        const config = useRuntimeConfig();
        return (config.public as any).tenantOrgId || '';
    }

    async function rpc(serverName: string, method: string, params?: any): Promise<any> {
        const gatewayUrl = getGatewayUrl();
        const orgId = getTenantOrgId();
        if (!gatewayUrl || !orgId) {
            throw new Error('Gateway URL or tenant org ID not configured');
        }

        const url = `${gatewayUrl}/api/mcp/${orgId}/${serverName}/rpc`;
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (accessToken.value) {
            headers['Authorization'] = `Bearer ${accessToken.value}`;
        }
        const existingSessionId = sessionIds.value[serverName];
        if (existingSessionId) {
            headers['Mcp-Session-Id'] = existingSessionId;
        }

        const res = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: Date.now(),
                method,
                ...(params ? { params } : {}),
            }),
        });

        // Persist the session ID returned by the MCP server (via the gateway).
        const returnedSessionId = res.headers.get('mcp-session-id');
        if (returnedSessionId) {
            sessionIds.value = { ...sessionIds.value, [serverName]: returnedSessionId };
        }

        // Stale session — clear it and retry once without the session ID so
        // the upstream MCP server creates a fresh session transparently.
        if (res.status === 404 && existingSessionId) {
            const { [serverName]: _, ...rest } = sessionIds.value;
            sessionIds.value = rest;
            return rpc(serverName, method, params);
        }

        if (!res.ok) {
            const text = await res.text();
            throw new Error(text || `MCP RPC failed (${res.status})`);
        }

        return await res.json();
    }

    async function listTools(serverName: string): Promise<McpTool[]> {
        toolsLoading.value = { ...toolsLoading.value, [serverName]: true };
        toolsError.value = { ...toolsError.value, [serverName]: null };
        try {
            const response: any = await rpc(serverName, 'tools/list');
            const tools: McpTool[] = (response?.result?.tools ?? []).map((t: any) => ({
                name: t.name,
                description: t.description,
                inputSchema: t.inputSchema,
            }));
            toolsCache.value = { ...toolsCache.value, [serverName]: tools };
            return tools;
        } catch (e: any) {
            const msg = e.data?.statusMessage || e.message || 'Failed to list tools';
            toolsError.value = { ...toolsError.value, [serverName]: msg };
            return [];
        } finally {
            toolsLoading.value = { ...toolsLoading.value, [serverName]: false };
        }
    }

    async function callTool(
        serverName: string,
        toolName: string,
        args: Record<string, any>
    ): Promise<ToolResult> {
        callLoading.value = true;
        try {
            const response: any = await rpc(serverName, 'tools/call', {
                name: toolName,
                arguments: args,
            });
            const result: ToolResult = {
                toolName,
                result: response?.result ?? response,
                timestamp: Date.now(),
            };
            lastResult.value = result;
            return result;
        } catch (e: any) {
            const result: ToolResult = {
                toolName,
                result: null,
                error: e.data?.statusMessage || e.message || 'Tool call failed',
                timestamp: Date.now(),
            };
            lastResult.value = result;
            return result;
        } finally {
            callLoading.value = false;
        }
    }

    function getTools(serverName: string): McpTool[] {
        return toolsCache.value[serverName] ?? [];
    }

    function isLoadingTools(serverName: string): boolean {
        return toolsLoading.value[serverName] ?? false;
    }

    function getToolsError(serverName: string): string | null {
        return toolsError.value[serverName] ?? null;
    }

    return {
        toolsCache: computed(() => toolsCache.value),
        lastResult: computed(() => lastResult.value),
        callLoading: computed(() => callLoading.value),
        listTools,
        callTool,
        getTools,
        isLoadingTools,
        getToolsError,
    };
}
