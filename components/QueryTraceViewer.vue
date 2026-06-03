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
                <v-chip v-if="totalMs > 0" size="x-small" variant="tonal" color="amber"
                    >{{ fmtMs(totalMs) }} on tools</v-chip
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

            <div class="section-title">Call flow ({{ trace.toolCalls.length }})</div>

            <div v-if="trace.toolCalls.length === 0" class="trace-empty">
                The agent made no MCP tool calls.
            </div>

            <div v-else class="flow">
                <div class="flow-lanes">
                    <span class="lane-label lane-agent">Agent</span>
                    <span class="lane-rule" />
                    <span class="lane-label lane-mcp">elemental-query MCP</span>
                </div>

                <ol class="calls">
                    <li
                        v-for="tc in trace.toolCalls"
                        :key="tc.index"
                        class="call"
                        :class="{ open: isOpen(tc.index) }"
                    >
                        <button class="call-head" type="button" @click="toggle(tc.index)">
                            <span class="call-index">{{ tc.index + 1 }}</span>
                            <span class="call-main">
                                <span class="call-name-row">
                                    <span class="req-arrow">→</span>
                                    <code class="call-name">{{ tc.name }}</code>
                                    <span class="call-args-preview">{{
                                        argsPreview(tc.args)
                                    }}</span>
                                </span>
                                <span v-if="hasTiming" class="track" :title="trackTitle(tc)">
                                    <span class="track-bar" :style="barStyle(tc)" />
                                </span>
                            </span>
                            <span class="call-timing">
                                <span v-if="tc.durationMs !== undefined" class="dur">{{
                                    fmtMs(tc.durationMs)
                                }}</span>
                                <span v-if="tc.startOffsetMs !== undefined" class="offset"
                                    >@ {{ fmtMs(tc.startOffsetMs) }}</span
                                >
                            </span>
                            <v-icon class="chevron" size="18">{{
                                isOpen(tc.index) ? 'mdi-chevron-up' : 'mdi-chevron-down'
                            }}</v-icon>
                        </button>

                        <div v-if="isOpen(tc.index)" class="call-detail">
                            <div class="kv-label">params (Agent → MCP)</div>
                            <pre class="json">{{ pretty(tc.args) }}</pre>
                            <div class="kv-label">response (MCP → Agent)</div>
                            <pre class="json">{{ pretty(displayResponse(tc.response)) }}</pre>
                        </div>
                    </li>
                </ol>

                <div v-if="!hasTiming" class="timing-note">
                    Timing wasn’t recorded for this run (older trace). Re-run the query to capture
                    per-call timing.
                </div>
            </div>

            <template v-if="stackLogs.length">
                <div class="section-title">Stack logs</div>
                <v-expansion-panels variant="accordion" multiple>
                    <v-expansion-panel v-for="log in stackLogs" :key="log.source">
                        <v-expansion-panel-title>
                            <span class="log-source">{{ log.label }}</span>
                            <span class="log-count">{{ logCountLabel(log) }}</span>
                        </v-expansion-panel-title>
                        <v-expansion-panel-text>
                            <div v-if="log.note" class="trace-empty">{{ log.note }}</div>
                            <div v-else-if="!log.lines.length" class="trace-empty">
                                No output during this query.
                            </div>
                            <pre v-else class="json log-lines">{{ log.lines.join('\n') }}</pre>
                        </v-expansion-panel-text>
                    </v-expansion-panel>
                </v-expansion-panels>
            </template>

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
    import { computed, reactive } from 'vue';
    import type { QueryTrace, StackLog, ToolCallTrace } from '~/types/queryrunner';

    const props = defineProps<{
        trace?: QueryTrace | null;
        loading?: boolean;
        hint?: string;
    }>();

    const open = reactive(new Set<number>());
    function isOpen(i: number): boolean {
        return open.has(i);
    }
    function toggle(i: number): void {
        if (open.has(i)) open.delete(i);
        else open.add(i);
    }

    /** Total span of the tool phase, used to scale the waterfall bars. */
    const totalMs = computed(() => {
        const calls = props.trace?.toolCalls ?? [];
        let max = 0;
        for (const tc of calls) {
            const end = tc.endOffsetMs ?? tc.startOffsetMs;
            if (typeof end === 'number') max = Math.max(max, end);
            if (typeof tc.startOffsetMs === 'number' && typeof tc.durationMs === 'number') {
                max = Math.max(max, tc.startOffsetMs + tc.durationMs);
            }
        }
        return max;
    });

    const hasTiming = computed(() =>
        (props.trace?.toolCalls ?? []).some((tc) => typeof tc.startOffsetMs === 'number')
    );

    const stackLogs = computed<StackLog[]>(() => props.trace?.stackLogs ?? []);

    function logCountLabel(log: StackLog): string {
        if (log.note) return 'unavailable';
        const n = log.lines.length;
        return `${n} line${n === 1 ? '' : 's'}`;
    }

    function barStyle(tc: ToolCallTrace): Record<string, string> {
        const span = totalMs.value || 1;
        const start = tc.startOffsetMs ?? 0;
        const dur = tc.durationMs ?? 0;
        const left = (start / span) * 100;
        // Floor the width so sub-percent calls stay visible.
        const width = Math.max((dur / span) * 100, 1.5);
        return { left: `${left}%`, width: `${Math.min(width, 100 - left)}%` };
    }

    function trackTitle(tc: ToolCallTrace): string {
        const start = tc.startOffsetMs !== undefined ? fmtMs(tc.startOffsetMs) : '?';
        const dur = tc.durationMs !== undefined ? fmtMs(tc.durationMs) : '?';
        return `starts @ ${start}, took ${dur}`;
    }

    function fmtMs(ms: number): string {
        if (ms < 1000) return `${Math.round(ms)}ms`;
        return `${(ms / 1000).toFixed(2)}s`;
    }

    function formatAnswer(v: string | number | null): string {
        if (v === null || v === undefined) return '(no answer)';
        return String(v);
    }

    /**
     * MCP tool responses carry both `structuredContent` (the real object) and a
     * `content` array that's just a stringified duplicate of it. Drop `content`
     * for display — the capture keeps the full payload.
     */
    function displayResponse(resp: unknown): unknown {
        if (resp && typeof resp === 'object' && !Array.isArray(resp) && 'content' in resp) {
            const rest = { ...(resp as Record<string, unknown>) };
            delete rest.content;
            return rest;
        }
        return resp;
    }

    function pretty(v: unknown): string {
        if (v === undefined) return '(no response captured)';
        try {
            // Intentionally NOT truncated — the call-flow detail must show the
            // full MCP response (args/response) for debugging.
            return JSON.stringify(v, null, 2);
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

    .flow {
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 8px;
        overflow: hidden;
    }

    .flow-lanes {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 6px 12px;
        background: rgba(255, 255, 255, 0.03);
        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    }

    .lane-label {
        font-size: 0.7rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--lv-silver, #94a3b8);
        white-space: nowrap;
    }

    .lane-agent {
        color: var(--lv-green, #3fea00);
    }

    .lane-rule {
        flex: 1;
        height: 0;
        border-top: 1px dashed rgba(255, 255, 255, 0.18);
    }

    .calls {
        list-style: none;
        margin: 0;
        padding: 0;
    }

    .call {
        border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    }

    .call:last-child {
        border-bottom: none;
    }

    .call-head {
        width: 100%;
        display: grid;
        grid-template-columns: 22px 1fr auto 18px;
        align-items: center;
        gap: 10px;
        padding: 8px 12px;
        background: none;
        border: none;
        text-align: left;
        cursor: pointer;
        color: inherit;
    }

    .call-head:hover {
        background: rgba(255, 255, 255, 0.03);
    }

    .call.open .call-head {
        background: rgba(255, 255, 255, 0.04);
    }

    .call-index {
        font-family: var(--font-mono, ui-monospace, monospace);
        color: var(--lv-silver, #94a3b8);
        font-size: 0.8rem;
    }

    .call-main {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 5px;
    }

    .call-name-row {
        display: flex;
        align-items: baseline;
        gap: 8px;
        min-width: 0;
    }

    .req-arrow {
        color: var(--lv-green, #3fea00);
        font-weight: 700;
    }

    .call-name {
        font-family: var(--font-mono, ui-monospace, monospace);
        color: var(--lv-green, #3fea00);
        white-space: nowrap;
    }

    .call-args-preview {
        font-family: var(--font-mono, ui-monospace, monospace);
        font-size: 0.76rem;
        color: var(--lv-silver, #94a3b8);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        min-width: 0;
    }

    .track {
        position: relative;
        height: 8px;
        width: 100%;
        background: rgba(255, 255, 255, 0.05);
        border-radius: 4px;
        overflow: hidden;
    }

    .track-bar {
        position: absolute;
        top: 0;
        bottom: 0;
        background: linear-gradient(90deg, var(--lv-green, #3fea00), #2bb300);
        border-radius: 4px;
        min-width: 2px;
    }

    .call-timing {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 2px;
        font-family: var(--font-mono, ui-monospace, monospace);
        white-space: nowrap;
    }

    .dur {
        color: #ffca28;
        font-size: 0.8rem;
    }

    .offset {
        color: var(--lv-silver, #94a3b8);
        font-size: 0.7rem;
    }

    .chevron {
        color: var(--lv-silver, #94a3b8);
    }

    .call-detail {
        padding: 4px 12px 12px 44px;
    }

    .timing-note {
        padding: 8px 12px;
        font-size: 0.76rem;
        font-style: italic;
        color: var(--lv-silver, #94a3b8);
        border-top: 1px solid rgba(255, 255, 255, 0.05);
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

    .log-source {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .log-count {
        font-family: var(--font-mono, ui-monospace, monospace);
        font-size: 0.72rem;
        color: var(--lv-silver, #94a3b8);
        margin-right: 8px;
        white-space: nowrap;
    }

    .log-lines {
        max-height: 360px;
        overflow: auto;
        white-space: pre;
        word-break: normal;
    }
</style>
