<template>
    <div class="d-flex mb-4" :class="isUser ? 'justify-end' : 'justify-start'">
        <div
            class="chat-bubble pa-3 rounded-lg"
            :class="[isUser ? 'user-bubble' : 'agent-bubble', message.error ? 'error-bubble' : '']"
            style="max-width: 80%; white-space: pre-wrap; word-break: break-word"
        >
            <div v-if="!isUser" class="d-flex align-center mb-1">
                <v-icon size="16" class="mr-1" :color="message.error ? 'error' : 'primary'">
                    {{ message.error ? 'mdi-alert-circle' : 'mdi-robot' }}
                </v-icon>
                <span class="text-caption text-medium-emphasis">Agent</span>
            </div>

            <div v-if="message.streaming && !message.text" class="typing-indicator">
                <span /><span /><span />
            </div>
            <div v-else class="text-body-2 bubble-text">
                {{ message.text }}<span v-if="message.streaming" class="streaming-cursor" />
            </div>

            <div class="text-caption text-medium-emphasis mt-1" style="opacity: 0.6">
                {{ formatTime(message.timestamp) }}
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
    import type { ChatMessage } from '~/composables/useAgentChat';

    const props = defineProps<{ message: ChatMessage }>();
    const isUser = computed(() => props.message.role === 'user');

    function formatTime(ts: number): string {
        return new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    }
</script>

<style scoped>
    .user-bubble {
        background: rgba(63, 234, 0, 0.12);
        border: 1px solid rgba(63, 234, 0, 0.25);
    }
    .agent-bubble {
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.1);
    }
    .error-bubble {
        background: rgba(239, 68, 68, 0.12);
        border: 1px solid rgba(239, 68, 68, 0.3);
    }
    .bubble-text {
        color: rgba(255, 255, 255, 0.87);
    }

    .streaming-cursor {
        display: inline-block;
        width: 2px;
        height: 1em;
        background: currentColor;
        margin-left: 1px;
        vertical-align: text-bottom;
        animation: cursor-blink 0.8s steps(2) infinite;
    }

    @keyframes cursor-blink {
        0% {
            opacity: 1;
        }
        100% {
            opacity: 0;
        }
    }

    .typing-indicator {
        display: flex;
        gap: 4px;
        padding: 4px 0;
    }

    .typing-indicator span {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.4);
        animation: typing-bounce 1.2s ease-in-out infinite;
    }

    .typing-indicator span:nth-child(2) {
        animation-delay: 0.15s;
    }

    .typing-indicator span:nth-child(3) {
        animation-delay: 0.3s;
    }

    @keyframes typing-bounce {
        0%,
        60%,
        100% {
            transform: translateY(0);
            opacity: 0.4;
        }
        30% {
            transform: translateY(-4px);
            opacity: 1;
        }
    }
</style>
