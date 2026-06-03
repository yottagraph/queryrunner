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
                        <div class="summary-sub">errors are transport / config failures</div>
                    </v-card>
                </div>

                <v-card class="results-card">
                    <v-table density="comfortable">
                        <thead>
                            <tr>
                                <th>Status</th>
                                <th>Query</th>
                                <th>Expected</th>
                                <th>Actual</th>
                                <th class="text-right">Duration</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="r in run.results" :key="r.queryId">
                                <td>
                                    <QueryResultChip
                                        :pass="r.pass"
                                        :error="r.error"
                                        :duration-ms="r.durationMs"
                                    />
                                </td>
                                <td>
                                    <div>{{ r.queryName }}</div>
                                    <div v-if="r.error" class="error-text">{{ r.error }}</div>
                                </td>
                                <td class="mono">{{ r.expected }}</td>
                                <td class="mono">{{ r.actual }}</td>
                                <td class="text-right mono">{{ r.durationMs }} ms</td>
                            </tr>
                        </tbody>
                    </v-table>
                </v-card>
            </template>
        </div>
    </div>
</template>

<script setup lang="ts">
    import { computed } from 'vue';

    const route = useRoute();
    const { runs } = useQueryRunner();

    const runId = computed(() => String(route.params.id ?? ''));
    const run = computed(() => runs.value.find((r) => r.id === runId.value) ?? null);

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

    .results-card {
        overflow: hidden;
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
