<template>
    <v-container fluid class="fill-height pa-0">
        <div
            class="d-flex flex-column"
            style="height: 100%; width: 100%; max-width: 900px; margin: 0 auto"
        >
            <!-- Header -->
            <div class="d-flex align-center pa-4 pb-2">
                <v-icon class="mr-2" color="primary">mdi-robot</v-icon>
                <span class="text-h6 font-weight-medium">Agent Chat</span>
                <v-spacer />
                <v-select
                    v-if="agentOptions.length > 1"
                    v-model="selectedAgentId"
                    :items="agentOptions"
                    item-title="name"
                    item-value="id"
                    label="Agent"
                    variant="outlined"
                    density="compact"
                    hide-details
                    style="max-width: 260px"
                    @update:model-value="onAgentChange"
                />
                <v-chip
                    v-else-if="agentOptions.length === 1"
                    color="primary"
                    variant="tonal"
                    size="small"
                >
                    {{ agentOptions[0].name }}
                </v-chip>
                <v-btn
                    v-if="hasMessages"
                    icon="mdi-delete-outline"
                    size="small"
                    variant="text"
                    class="ml-2"
                    @click="clearChat"
                />
            </div>

            <!-- Messages -->
            <div
                ref="messagesContainer"
                class="flex-grow-1 overflow-y-auto px-4 py-2 messages-scroll"
            >
                <div
                    v-if="!hasMessages"
                    class="d-flex flex-column align-center justify-center"
                    style="height: 100%"
                >
                    <v-icon size="64" color="primary" class="mb-4" style="opacity: 0.3"
                        >mdi-chat-processing-outline</v-icon
                    >
                    <div class="text-h6 text-medium-emphasis mb-2">Start a conversation</div>
                    <div
                        class="text-body-2 text-medium-emphasis text-center"
                        style="max-width: 400px"
                    >
                        <template v-if="selectedAgentId">
                            Send a message to interact with your deployed agent.
                        </template>
                        <template v-else-if="agentsLoading">
                            Loading agent configuration...
                        </template>
                        <template v-else-if="agentsError">
                            <span class="text-error">{{ agentsError }}</span>
                        </template>
                        <template v-else-if="agentOptions.length === 0">
                            No agents deployed yet. Deploy an agent using
                            <code>/deploy_agent</code> in Cursor and it will appear here
                            automatically.
                        </template>
                        <template v-else> Select an agent to get started. </template>
                    </div>
                </div>

                <ChatMessage v-for="msg in messages" :key="msg.id" :message="msg" />

                <div v-if="showThinkingBubble" class="d-flex justify-start mb-4">
                    <div
                        class="agent-bubble pa-3 rounded-lg"
                        style="
                            background: rgba(255, 255, 255, 0.06);
                            border: 1px solid rgba(255, 255, 255, 0.1);
                        "
                    >
                        <div class="d-flex align-center">
                            <v-progress-circular
                                indeterminate
                                size="16"
                                width="2"
                                color="primary"
                                class="mr-2"
                            />
                            <span class="text-body-2 text-medium-emphasis">Thinking...</span>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Input -->
            <div class="pa-4 pt-2">
                <v-text-field
                    v-model="inputText"
                    :disabled="!selectedAgentId || loading"
                    placeholder="Type a message..."
                    variant="outlined"
                    density="comfortable"
                    color="primary"
                    hide-details
                    @keydown.enter.exact.prevent="onSend"
                >
                    <template #append-inner>
                        <v-btn
                            icon="mdi-send"
                            size="small"
                            variant="text"
                            color="primary"
                            :disabled="!inputText.trim() || loading"
                            @click="onSend"
                        />
                    </template>
                </v-text-field>
            </div>
        </div>
    </v-container>
</template>

<script setup lang="ts">
    import { useAgentChat } from '~/composables/useAgentChat';

    const { messages, loading, hasMessages, selectAgent, sendMessage, clearChat, currentAgentId } =
        useAgentChat();

    const inputText = ref('');
    const messagesContainer = ref<HTMLElement | null>(null);
    const selectedAgentId = ref<string | null>(null);
    const agentsLoading = ref(false);
    const agentsError = ref<string | null>(null);

    const showThinkingBubble = computed(
        () => loading.value && !messages.value.some((m: any) => m.streaming)
    );

    interface AgentOption {
        id: string;
        name: string;
    }

    const agentOptions = ref<AgentOption[]>([]);

    onMounted(async () => {
        await loadAgents();
    });

    // Hosting-agnostic discovery — `/api/agents` resolves the backend
    // (in-cluster GKE vs Agent Engine) server-side and returns `{ id, name }`.
    async function loadAgents() {
        agentsLoading.value = true;
        agentsError.value = null;
        try {
            const res = await $fetch<{ agents: AgentOption[] }>('/api/agents');
            agentOptions.value = res?.agents || [];
        } catch (e: any) {
            agentsError.value =
                e?.data?.statusMessage || e?.message || 'Failed to load agent configuration';
        } finally {
            agentsLoading.value = false;
        }

        // Auto-select if there's only one agent and none is selected yet
        if (agentOptions.value.length === 1 && !currentAgentId.value) {
            selectedAgentId.value = agentOptions.value[0].id;
            selectAgent(agentOptions.value[0].id);
        }

        // Restore previously selected agent if it's still available
        if (currentAgentId.value && agentOptions.value.some((a) => a.id === currentAgentId.value)) {
            selectedAgentId.value = currentAgentId.value;
        }
    }

    function onAgentChange(id: string) {
        selectAgent(id);
    }

    async function onSend() {
        const text = inputText.value.trim();
        if (!text) return;
        inputText.value = '';
        await sendMessage(text);

        // Scroll to bottom
        await nextTick();
        if (messagesContainer.value) {
            messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
        }
    }

    // Auto-scroll on new messages
    watch(
        messages,
        async () => {
            await nextTick();
            if (messagesContainer.value) {
                messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
            }
        },
        { deep: true }
    );
</script>

<style scoped>
    .messages-scroll {
        scrollbar-width: thin;
        scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
    }
    .messages-scroll::-webkit-scrollbar {
        width: 6px;
    }
    .messages-scroll::-webkit-scrollbar-track {
        background: transparent;
    }
    .messages-scroll::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.2);
        border-radius: 3px;
    }
    .messages-scroll::-webkit-scrollbar-thumb:hover {
        background: rgba(255, 255, 255, 0.35);
    }
</style>
