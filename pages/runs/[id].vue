<template>
    <div class="run-detail">
        <PageHeader
            :title="run ? `Run ${formatTime(run.finishedAt)}` : 'Run not found'"
            icon="mdi-flash"
        >
            <template #actions>
                <NuxtLink to="/runs">
                    <v-btn variant="text" prepend-icon="mdi-arrow-left">All runs</v-btn>
                </NuxtLink>
            </template>
        </PageHeader>

        <div class="content">
            <v-card v-if="!run" class="empty-card">
                <v-card-text class="text-center pa-8">
                    <v-icon size="x-large" class="mb-2">mdi-help-circle-outline</v-icon>
                    <div class="text-h6 mb-2">Run not found</div>
                    <div class="text-body-2">
                        The run with id <code>{{ runId }}</code> isn't in history. It may have been
                        cleared or rolled off the cap of 50 retained runs.
                    </div>
                </v-card-text>
            </v-card>

            <template v-else>
                <div class="summary-grid">
                    <v-card class="summary-card">
                        <div class="summary-label">Pass rate</div>
                        <div class="summary-value" :class="passClass">{{ passRate }}</div>
                        <div class="summary-sub">
                            {{ run.passCount }}/{{ run.results.length }} passed
                        </div>
                    </v-card>
                    <v-card class="summary-card">
                        <div class="summary-label">Duration</div>
                        <div class="summary-value">{{ run.finishedAt - run.startedAt }} ms</div>
                        <div class="summary-sub">{{ run.results.length }} queries (parallel)</div>
                    </v-card>
                    <v-card class="summary-card">
                        <div class="summary-label">Fail / Error</div>
                        <div class="summary-value">
                            <span class="fail-cell">{{ run.failCount }}</span>
                            <span class="muted"> / </span>
                            <span class="err-cell">{{ run.errorCount }}</span>
                        </div>
                        <div class="summary-sub">errors are transport / agent failures</div>
                    </v-card>
                </div>

                <v-alert
                    v-if="traceState === 'unconfigured'"
                    type="info"
                    variant="tonal"
                    density="compact"
                    class="trace-note"
                >
                    Persistent trace storage isn't configured (no Postgres on this tenant). Full
                    agent/MCP traces are kept only for the session in which a run executes.
                    Provision Cloud SQL to retain traces across sessions.
                </v-alert>
                <v-alert
                    v-else-if="traceState === 'warming-up'"
                    type="warning"
                    variant="tonal"
                    density="compact"
                    class="trace-note"
                >
                    Trace storage is warming up — traces may be temporarily unavailable.
                </v-alert>

                <v-card class="results-card">
                    <v-table density="comfortable">
                        <thead>
                            <tr>
                                <th></th>
                                <th>Status</th>
                                <th>Question</th>
                                <th>Expected</th>
                                <th>Answer</th>
                                <th class="text-center">MCP</th>
                                <th class="text-right">Duration</th>
                            </tr>
                        </thead>
                        <tbody>
                            <template v-for="r in run.results" :key="r.queryId">
                                <tr class="result-row" @click="toggle(r.queryId)">
                                    <td class="expand-cell">
                                        <v-icon size="small">{{
                                            expanded[r.queryId]
                                                ? 'mdi-chevron-down'
                                                : 'mdi-chevron-right'
                                        }}</v-icon>
                                    </td>
                                    <td>
                                        <QueryResultChip
                                            :pass="r.pass"
                                            :error="r.error"
                                            :duration-ms="r.durationMs"
                                        />
                                    </td>
                                    <td>
                                        <div>{{ r.question || r.queryName }}</div>
                                        <div v-if="r.error" class="error-text">{{ r.error }}</div>
                                    </td>
                                    <td class="mono">{{ r.expected }}</td>
                                    <td class="mono">{{ r.actual }}</td>
                                    <td class="text-center mono">{{ r.toolCallCount ?? '—' }}</td>
                                    <td class="text-right mono">{{ r.durationMs }} ms</td>
                                </tr>
                                <tr v-if="expanded[r.queryId]" class="trace-row">
                                    <td colspan="7">
                                        <QueryTraceViewer
                                            :trace="traces[r.queryId]"
                                            :loading="loadingTrace[r.queryId]"
                                            hint="Traces persist only when Cloud SQL is configured for this tenant."
                                        />
                                    </td>
                                </tr>
                            </template>
                        </tbody>
                    </v-table>
                </v-card>
            </template>
        </div>
    </div>
</template>

<script setup lang="ts">
    import { computed, reactive, ref } from 'vue';
    import type { QueryTrace } from '~/types/queryrunner';

    const route = useRoute();
    const { runs } = useQueryRunner();

    const runId = computed(() => String(route.params.id ?? ''));
    const run = computed(() => runs.value.find((r) => r.id === runId.value) ?? null);

    const expanded = reactive<Record<string, boolean>>({});
    const traces = reactive<Record<string, QueryTrace | null>>({});
    const loadingTrace = reactive<Record<string, boolean>>({});
    const traceState = ref<'ready' | 'unconfigured' | 'warming-up' | null>(null);

    async function fetchTraceStatus() {
        if (traceState.value) return;
        try {
            const res = await $fetch<{ state: 'ready' | 'unconfigured' | 'warming-up' }>(
                '/api/queryrunner/trace-status'
            );
            traceState.value = res.state;
        } catch {
            traceState.value = null;
        }
    }
    fetchTraceStatus();

    async function toggle(queryId: string) {
        expanded[queryId] = !expanded[queryId];
        if (!expanded[queryId]) return;
        if (traces[queryId] !== undefined) return; // already fetched
        loadingTrace[queryId] = true;
        try {
            const res = await $fetch<{ trace: { trace: QueryTrace } | null }>(
                '/api/queryrunner/trace',
                { params: { runId: runId.value, queryId } }
            );
            traces[queryId] = res.trace?.trace ?? null;
        } catch {
            traces[queryId] = null;
        } finally {
            loadingTrace[queryId] = false;
        }
    }

    const passRate = computed(() => {
        if (!run.value) return '—';
        const total = run.value.results.length;
        if (total === 0) return '—';
        return `${Math.round((run.value.passCount / total) * 100)}%`;
    });

    const passClass = computed(() => {
        if (!run.value) return 'rate-neutral';
        const total = run.value.results.length;
        if (total === 0) return 'rate-neutral';
        const rate = run.value.passCount / total;
        if (rate >= 1) return 'rate-good';
        if (rate === 0) return 'rate-bad';
        return 'rate-mid';
    });

    function formatTime(ts: number) {
        return new Date(ts).toLocaleString();
    }
</script>

<style scoped>
    .run-detail {
        height: 100%;
        overflow-y: auto;
    }

    .content {
        max-width: 1100px;
        margin: 0 auto;
        padding: 24px;
        display: flex;
        flex-direction: column;
        gap: 16px;
    }

    .summary-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 16px;
    }

    .summary-card {
        padding: 16px 20px;
    }

    .summary-label {
        font-size: 0.78rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--lv-silver, #94a3b8);
    }

    .summary-value {
        font-family: var(--font-mono, ui-monospace, monospace);
        font-size: 1.75rem;
        font-weight: 500;
    }

    .summary-sub {
        font-size: 0.82rem;
        color: var(--lv-silver, #94a3b8);
        margin-top: 4px;
    }

    .trace-note {
        font-size: 0.85rem;
    }

    .results-card {
        overflow: hidden;
    }

    .result-row {
        cursor: pointer;
    }

    .result-row:hover {
        background: rgba(255, 255, 255, 0.03);
    }

    .expand-cell {
        width: 32px;
    }

    .trace-row td {
        background: rgba(0, 0, 0, 0.2);
        padding: 16px 20px;
    }

    .mono {
        font-family: var(--font-mono, ui-monospace, monospace);
        font-size: 0.85rem;
    }

    .pass-cell {
        color: var(--lv-green, #00ff9c);
    }

    .fail-cell {
        color: #ff5970;
    }

    .err-cell {
        color: #ffce4d;
    }

    .muted {
        color: var(--lv-silver, #94a3b8);
    }

    .rate-good {
        color: var(--lv-green, #00ff9c);
    }

    .rate-mid {
        color: #ffce4d;
    }

    .rate-bad {
        color: #ff5970;
    }

    .rate-neutral {
        color: var(--lv-silver, #94a3b8);
    }

    .error-text {
        margin-top: 2px;
        font-size: 0.78rem;
        color: #ffce4d;
        font-family: var(--font-mono, ui-monospace, monospace);
    }

    .empty-card {
        overflow: hidden;
    }
</style>
