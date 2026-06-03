<template>
    <div class="trace-viewer">
        <div v-if="loading" class="trace-loading">
            <v-progress-circular indeterminate size="20" width="2" class="mr-2" />
            Loading trace…
        </div>

        <div v-else-if="!trace" class="trace-empty">
            No trace available for this query.
            <span v-if="hint" class="hint">{{ hint }}</span>
        </div>

        <template v-else>
            <div class="trace-meta">
                <v-chip size="x-small" variant="tonal" color="info">{{
                    trace.model || 'model ?'
                }}</v-chip>
                <v-chip size="x-small" variant="tonal">{{ trace.hosting }}</v-chip>
                <v-chip size="x-small" variant="tonal" color="primary"
                    >{{ trace.toolCalls.length }} MCP calls</v-chip
                >
            </div>

            <v-alert
                v-if="trace.agentError"
                type="error"
                density="compact"
                variant="tonal"
                class="mb-3"
            >
                {{ trace.agentError }}
            </v-alert>

            <div class="answer-row">
                <span class="answer-label">Answer</span>
                <code class="answer-value">{{ formatAnswer(trace.parsedAnswer) }}</code>
            </div>
            <div v-if="trace.reasoning" class="reasoning">{{ trace.reasoning }}</div>

            <div class="section-title">MCP navigation ({{ trace.toolCalls.length }})</div>
            <div v-if="trace.toolCalls.length === 0" class="trace-empty">
                The agent made no MCP tool calls.
            </div>
            <v-expansion-panels v-else multiple variant="accordion" class="tool-panels">
                <v-expansion-panel v-for="tc in trace.toolCalls" :key="tc.index">
                    <v-expansion-panel-title>
                        <span class="call-index">{{ tc.index + 1 }}</span>
                        <code class="call-name">{{ tc.name }}</code>
                        <span class="call-args-preview">{{ argsPreview(tc.args) }}</span>
                    </v-expansion-panel-title>
                    <v-expansion-panel-text>
                        <div class="kv-label">arguments</div>
                        <pre class="json">{{ pretty(tc.args) }}</pre>
                        <div class="kv-label">response</div>
                        <pre class="json">{{ pretty(tc.response) }}</pre>
                    </v-expansion-panel-text>
                </v-expansion-panel>
            </v-expansion-panels>

            <v-expansion-panels variant="accordion" class="mt-3">
                <v-expansion-panel>
                    <v-expansion-panel-title>Agent final output (raw)</v-expansion-panel-title>
                    <v-expansion-panel-text>
                        <pre class="json">{{ trace.finalText || '(empty)' }}</pre>
                    </v-expansion-panel-text>
                </v-expansion-panel>
            </v-expansion-panels>
        </template>
    </div>
</template>

<script setup lang="ts">
    import type { QueryTrace } from '~/types/queryrunner';

    defineProps<{
        trace?: QueryTrace | null;
        loading?: boolean;
        hint?: string;
    }>();

    function formatAnswer(v: string | number | null): string {
        if (v === null || v === undefined) return '(no answer)';
        return String(v);
    }

    function pretty(v: unknown): string {
        if (v === undefined) return '(no response captured)';
        try {
            const s = JSON.stringify(v, null, 2);
            return s.length > 8000 ? s.slice(0, 8000) + '\n… (truncated)' : s;
        } catch {
            return String(v);
        }
    }

    function argsPreview(args: Record<string, unknown>): string {
        try {
            const parts = Object.entries(args).map(([k, val]) => {
                const s = typeof val === 'string' ? val : JSON.stringify(val);
                return `${k}=${s.length > 30 ? s.slice(0, 30) + '…' : s}`;
            });
            return parts.join(', ');
        } catch {
            return '';
        }
    }
</script>

<style scoped>
    .trace-viewer {
        font-size: 0.85rem;
    }

    .trace-loading,
    .trace-empty {
        color: var(--lv-silver, #94a3b8);
        padding: 8px 0;
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
    }

    .hint {
        font-size: 0.78rem;
        font-style: italic;
    }

    .trace-meta {
        display: flex;
        gap: 6px;
        margin-bottom: 10px;
        flex-wrap: wrap;
    }

    .answer-row {
        display: flex;
        align-items: baseline;
        gap: 10px;
        margin-bottom: 4px;
    }

    .answer-label {
        font-size: 0.72rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--lv-silver, #94a3b8);
    }

    .answer-value {
        font-family: var(--font-mono, ui-monospace, monospace);
        color: var(--lv-green, #3fea00);
        font-size: 0.95rem;
    }

    .reasoning {
        color: var(--lv-silver, #94a3b8);
        margin-bottom: 12px;
        font-style: italic;
    }

    .section-title {
        font-size: 0.72rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--lv-silver, #94a3b8);
        margin: 10px 0 6px;
    }

    .tool-panels {
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 8px;
        overflow: hidden;
    }

    .call-index {
        font-family: var(--font-mono, ui-monospace, monospace);
        color: var(--lv-silver, #94a3b8);
        margin-right: 10px;
        min-width: 18px;
    }

    .call-name {
        font-family: var(--font-mono, ui-monospace, monospace);
        color: var(--lv-green, #3fea00);
        margin-right: 12px;
    }

    .call-args-preview {
        font-family: var(--font-mono, ui-monospace, monospace);
        font-size: 0.78rem;
        color: var(--lv-silver, #94a3b8);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .kv-label {
        font-size: 0.7rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--lv-silver, #94a3b8);
        margin: 6px 0 2px;
    }

    .json {
        font-family: var(--font-mono, ui-monospace, monospace);
        font-size: 0.78rem;
        background: rgba(0, 0, 0, 0.35);
        border-radius: 6px;
        padding: 8px 10px;
        overflow-x: auto;
        white-space: pre-wrap;
        word-break: break-word;
        margin: 0 0 4px;
    }
</style>
