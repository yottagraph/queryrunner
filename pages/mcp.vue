<template>
    <v-container fluid class="fill-height pa-0">
        <div
            class="d-flex flex-column"
            style="height: 100%; width: 100%; max-width: 1000px; margin: 0 auto"
        >
            <!-- Header -->
            <div class="d-flex align-center pa-4 pb-2">
                <v-icon class="mr-2" color="primary">mdi-server</v-icon>
                <span class="text-h6 font-weight-medium">MCP Tool Explorer</span>
                <v-spacer />
                <v-btn
                    v-if="!configLoading && mcpServers.length > 0"
                    icon="mdi-refresh"
                    size="small"
                    variant="text"
                    :loading="refreshing"
                    @click="refreshAll"
                />
            </div>

            <!-- Loading -->
            <div
                v-if="configLoading"
                class="d-flex flex-column align-center justify-center flex-grow-1"
            >
                <v-progress-circular indeterminate size="32" color="primary" />
                <div class="text-body-2 text-medium-emphasis mt-3">
                    Loading MCP server configuration...
                </div>
            </div>

            <!-- Error -->
            <div
                v-else-if="configError"
                class="d-flex flex-column align-center justify-center flex-grow-1"
            >
                <v-icon size="64" color="error" class="mb-4" style="opacity: 0.3"
                    >mdi-alert-circle-outline</v-icon
                >
                <div class="text-body-2 text-error text-center" style="max-width: 400px">
                    {{ configError }}
                </div>
            </div>

            <!-- No servers -->
            <div
                v-else-if="mcpServers.length === 0"
                class="d-flex flex-column align-center justify-center flex-grow-1"
            >
                <v-icon size="64" color="primary" class="mb-4" style="opacity: 0.3"
                    >mdi-server-off</v-icon
                >
                <div class="text-h6 text-medium-emphasis mb-2">No MCP servers deployed</div>
                <div class="text-body-2 text-medium-emphasis text-center" style="max-width: 400px">
                    Deploy an MCP server using <code>/deploy_mcp</code> in Cursor. Servers provide
                    tools that agents can call.
                </div>
            </div>

            <!-- Server list -->
            <div v-else class="flex-grow-1 overflow-y-auto px-4 py-2">
                <div class="d-flex flex-column ga-4">
                    <v-card v-for="server in mcpServers" :key="server.name" variant="outlined">
                        <v-card-title class="d-flex align-center">
                            <v-icon class="mr-2" size="20">mdi-server</v-icon>
                            {{ server.name }}
                            <v-spacer />
                            <v-btn
                                size="small"
                                variant="text"
                                icon="mdi-refresh"
                                :loading="isLoadingTools(server.name)"
                                @click="listTools(server.name)"
                            />
                        </v-card-title>

                        <v-card-text>
                            <!-- Tools loading -->
                            <div
                                v-if="isLoadingTools(server.name)"
                                class="d-flex align-center ga-2 pa-2"
                            >
                                <v-progress-circular
                                    indeterminate
                                    size="16"
                                    width="2"
                                    color="primary"
                                />
                                <span class="text-body-2 text-medium-emphasis"
                                    >Discovering tools...</span
                                >
                            </div>

                            <!-- Tools error -->
                            <v-alert
                                v-else-if="getToolsError(server.name)"
                                type="error"
                                variant="tonal"
                                density="compact"
                                class="mb-3"
                            >
                                {{ getToolsError(server.name) }}
                            </v-alert>

                            <!-- Tools list -->
                            <div
                                v-else-if="getTools(server.name).length > 0"
                                class="d-flex flex-column ga-3"
                            >
                                <div
                                    v-for="tool in getTools(server.name)"
                                    :key="tool.name"
                                    class="pa-3 rounded-lg"
                                    style="background: rgba(255, 255, 255, 0.04)"
                                >
                                    <div class="d-flex align-center mb-2">
                                        <v-icon size="16" class="mr-2" color="primary"
                                            >mdi-wrench</v-icon
                                        >
                                        <span class="text-body-2 font-weight-medium font-mono">{{
                                            tool.name
                                        }}</span>
                                    </div>
                                    <div
                                        v-if="tool.description"
                                        class="text-caption text-medium-emphasis mb-3"
                                    >
                                        {{ tool.description }}
                                    </div>

                                    <!-- Input fields from schema -->
                                    <div
                                        v-if="tool.inputSchema?.properties"
                                        class="d-flex flex-column ga-2 mb-3"
                                    >
                                        <v-text-field
                                            v-for="(prop, propName) in tool.inputSchema.properties"
                                            :key="String(propName)"
                                            v-model="
                                                toolInputs[
                                                    `${server.name}:${tool.name}:${String(propName)}`
                                                ]
                                            "
                                            :label="String(propName)"
                                            :hint="prop.description || prop.type"
                                            persistent-hint
                                            variant="outlined"
                                            density="compact"
                                            hide-details="auto"
                                            class="font-mono"
                                        />
                                    </div>

                                    <v-btn
                                        size="small"
                                        color="primary"
                                        variant="tonal"
                                        prepend-icon="mdi-play"
                                        :loading="
                                            callLoading &&
                                            activeCall === `${server.name}:${tool.name}`
                                        "
                                        @click="runTool(server.name, tool)"
                                    >
                                        Run
                                    </v-btn>

                                    <!-- Result -->
                                    <div
                                        v-if="
                                            lastResult &&
                                            lastResult.toolName === tool.name &&
                                            activeResultKey === `${server.name}:${tool.name}`
                                        "
                                        class="mt-3"
                                    >
                                        <v-alert
                                            v-if="lastResult.error"
                                            type="error"
                                            variant="tonal"
                                            density="compact"
                                        >
                                            {{ lastResult.error }}
                                        </v-alert>
                                        <pre
                                            v-else
                                            class="text-caption font-mono pa-3 rounded"
                                            style="
                                                background: rgba(255, 255, 255, 0.06);
                                                overflow-x: auto;
                                                white-space: pre-wrap;
                                                word-break: break-word;
                                            "
                                            >{{ formatResult(lastResult.result) }}</pre
                                        >
                                    </div>
                                </div>
                            </div>

                            <!-- No tools discovered yet -->
                            <div v-else class="text-body-2 text-medium-emphasis pa-2 text-center">
                                Click
                                <v-icon size="14">mdi-refresh</v-icon>
                                to discover available tools.
                            </div>
                        </v-card-text>
                    </v-card>
                </div>
            </div>
        </div>
    </v-container>
</template>

<script setup lang="ts">
    import { useTenantConfig, type McpServerConfig } from '~/composables/useTenantConfig';
    import { useMcpExplorer, type McpTool } from '~/composables/useMcpExplorer';

    const {
        config: tenantConfig,
        loading: configLoading,
        error: configError,
        refresh: refreshConfig,
    } = useTenantConfig();
    const {
        listTools,
        callTool,
        getTools,
        isLoadingTools,
        getToolsError,
        lastResult,
        callLoading,
    } = useMcpExplorer();

    const mcpServers = ref<McpServerConfig[]>([]);
    const toolInputs = ref<Record<string, string>>({});
    const activeCall = ref<string | null>(null);
    const activeResultKey = ref<string | null>(null);
    const refreshing = ref(false);

    onMounted(async () => {
        await refreshConfig();
        loadServers();
        for (const server of mcpServers.value) {
            listTools(server.name);
        }
    });

    function loadServers() {
        mcpServers.value = tenantConfig.value?.mcp_servers ?? [];
    }

    async function refreshAll() {
        refreshing.value = true;
        await refreshConfig();
        loadServers();
        await Promise.all(mcpServers.value.map((s) => listTools(s.name)));
        refreshing.value = false;
    }

    function buildArgs(serverName: string, tool: McpTool): Record<string, any> {
        const args: Record<string, any> = {};
        const props = tool.inputSchema?.properties || {};
        for (const key of Object.keys(props)) {
            const raw = toolInputs.value[`${serverName}:${tool.name}:${key}`];
            if (raw === undefined || raw === '') continue;
            const propType = props[key]?.type;
            if (propType === 'integer' || propType === 'number') {
                args[key] = Number(raw);
            } else if (propType === 'boolean') {
                args[key] = raw === 'true';
            } else if (propType === 'object' || propType === 'array') {
                try {
                    args[key] = JSON.parse(raw);
                } catch {
                    args[key] = raw;
                }
            } else {
                args[key] = raw;
            }
        }
        return args;
    }

    async function runTool(serverName: string, tool: McpTool) {
        const key = `${serverName}:${tool.name}`;
        activeCall.value = key;
        activeResultKey.value = key;
        const args = buildArgs(serverName, tool);
        await callTool(serverName, tool.name, args);
        activeCall.value = null;
    }

    function formatResult(result: any): string {
        if (typeof result === 'string') return result;
        try {
            return JSON.stringify(result, null, 2);
        } catch {
            return String(result);
        }
    }
</script>
