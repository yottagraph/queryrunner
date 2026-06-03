<template>
    <div class="dashboard">
        <PageHeader title="QueryRunner" icon="mdi-pulse">
            <template #actions>
                <v-btn
                    color="primary"
                    variant="flat"
                    prepend-icon="mdi-play"
                    :loading="running"
                    :disabled="queries.length === 0"
                    @click="runAllNow"
                >
                    Run all queries
                </v-btn>
            </template>
        </PageHeader>

        <div class="content">
            <div class="metric-grid">
                <v-card class="metric-card">
                    <div class="metric-label">Queries in catalog</div>
                    <div class="metric-value">{{ queries.length }}</div>
                    <NuxtLink to="/queries" class="metric-link">Manage →</NuxtLink>
                </v-card>

                <v-card class="metric-card">
                    <div class="metric-label">Latest pass rate</div>
                    <div class="metric-value">
                        <span :class="latestRateClass">{{ latestRateLabel }}</span>
                    </div>
                    <div class="metric-sub">
                        {{
                            latestRun
                                ? `${latestRun.passCount}/${latestRun.results.length} passed`
                                : 'No runs yet'
                        }}
                    </div>
                </v-card>

                <v-card class="metric-card">
                    <div class="metric-label">All-time pass rate</div>
                    <div class="metric-value">
                        <span :class="overallRateClass">{{ overallRateLabel }}</span>
                    </div>
                    <div class="metric-sub">
                        {{ overallSummary }}
                    </div>
                </v-card>

                <v-card class="metric-card">
                    <div class="metric-label">Pass rate trend</div>
                    <PassRateSparkline :points="trendPoints" :width="220" :height="48" />
                    <div class="metric-sub">Last {{ trendPoints.length || '—' }} runs</div>
                </v-card>
            </div>

            <v-card class="section-card">
                <PageHeader title="Latest run" icon="mdi-flash" />
                <v-card-text v-if="!latestRun" class="empty">
                    <v-icon size="x-large" class="mb-2">mdi-test-tube-empty</v-icon>
                    <div>No queries have been executed yet.</div>
                    <div class="empty-sub">
                        Click <strong>Run all queries</strong> to execute the catalog and record a
                        result.
                    </div>
                </v-card-text>
                <v-card-text v-else>
                    <div class="latest-meta">
                        <div>
                            <strong>{{ formatTime(latestRun.finishedAt) }}</strong>
                            <span class="muted">
                                · {{ latestRun.results.length }} queries ·
                                {{ latestRun.finishedAt - latestRun.startedAt }} ms</span
                            >
                        </div>
                        <NuxtLink :to="`/runs/${latestRun.id}`" class="metric-link"
                            >View run →</NuxtLink
                        >
                    </div>
                    <v-table density="compact" class="result-table">
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
                            <tr v-for="r in latestRun.results" :key="r.queryId">
                                <td>
                                    <QueryResultChip
                                        :pass="r.pass"
                                        :error="r.error"
                                        :duration-ms="r.durationMs"
                                    />
                                </td>
                                <td>{{ r.queryName }}</td>
                                <td class="mono">{{ r.expected }}</td>
                                <td class="mono">{{ r.actual }}</td>
                                <td class="text-right mono">{{ r.durationMs }} ms</td>
                            </tr>
                        </tbody>
                    </v-table>
                </v-card-text>
            </v-card>

            <v-card class="section-card">
                <PageHeader title="Recent runs" icon="mdi-history">
                    <template #actions>
                        <NuxtLink to="/runs" class="metric-link">All runs →</NuxtLink>
                    </template>
                </PageHeader>
                <v-card-text v-if="recentRuns.length === 0" class="empty">
                    Nothing to show — no historical runs.
                </v-card-text>
                <v-table v-else density="compact" class="result-table">
                    <thead>
                        <tr>
                            <th>When</th>
                            <th>Queries</th>
                            <th>Pass</th>
                            <th>Fail</th>
                            <th>Errors</th>
                            <th class="text-right">Pass rate</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="r in recentRuns" :key="r.id">
                            <td>{{ formatTime(r.finishedAt) }}</td>
                            <td>{{ r.results.length }}</td>
                            <td class="pass-cell">{{ r.passCount }}</td>
                            <td class="fail-cell">{{ r.failCount }}</td>
                            <td class="err-cell">{{ r.errorCount }}</td>
                            <td class="text-right mono">
                                {{ rateLabel(r.passCount, r.results.length) }}
                            </td>
                            <td class="text-right">
                                <NuxtLink :to="`/runs/${r.id}`" class="metric-link"
                                    >View →</NuxtLink
                                >
                            </td>
                        </tr>
                    </tbody>
                </v-table>
            </v-card>
        </div>
    </div>
</template>

<script setup lang="ts">
    import { computed, ref } from 'vue';

    const { queries, runs, latestRun, runAll } = useQueryRunner();
    const { show: notify } = useNotification();

    const running = ref(false);

    async function runAllNow() {
        if (running.value || queries.value.length === 0) return;
        running.value = true;
        try {
            const run = await runAll();
            const total = run.results.length;
            notify(
                `Run complete: ${run.passCount}/${total} passed`,
                run.passCount === total ? 'success' : 'warning'
            );
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            notify(`Run failed: ${msg}`, 'error');
        } finally {
            running.value = false;
        }
    }

    const recentRuns = computed(() => runs.value.slice(0, 10));

    const trendPoints = computed(() => {
        const reversed = [...runs.value].slice(0, 20).reverse();
        return reversed.map((r) => (r.results.length ? r.passCount / r.results.length : 0));
    });

    function rateLabel(pass: number, total: number) {
        if (total === 0) return '—';
        return `${Math.round((pass / total) * 100)}%`;
    }

    const latestRateLabel = computed(() => {
        if (!latestRun.value) return '—';
        return rateLabel(latestRun.value.passCount, latestRun.value.results.length);
    });

    const latestRateClass = computed(() => {
        if (!latestRun.value) return 'rate-neutral';
        const total = latestRun.value.results.length;
        if (total === 0) return 'rate-neutral';
        const rate = latestRun.value.passCount / total;
        if (rate >= 1) return 'rate-good';
        if (rate === 0) return 'rate-bad';
        return 'rate-mid';
    });

    const overallStats = computed(() => {
        let pass = 0;
        let total = 0;
        for (const r of runs.value) {
            pass += r.passCount;
            total += r.results.length;
        }
        return { pass, total };
    });

    const overallRateLabel = computed(() => {
        const { pass, total } = overallStats.value;
        return rateLabel(pass, total);
    });

    const overallRateClass = computed(() => {
        const { pass, total } = overallStats.value;
        if (total === 0) return 'rate-neutral';
        const rate = pass / total;
        if (rate >= 0.95) return 'rate-good';
        if (rate < 0.5) return 'rate-bad';
        return 'rate-mid';
    });

    const overallSummary = computed(() => {
        const { pass, total } = overallStats.value;
        if (total === 0) return 'No runs yet';
        return `${pass}/${total} across ${runs.value.length} run${runs.value.length === 1 ? '' : 's'}`;
    });

    function formatTime(ts: number) {
        const d = new Date(ts);
        return d.toLocaleString();
    }
</script>

<style scoped>
    .dashboard {
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

    .metric-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 16px;
    }

    .metric-card {
        padding: 16px 20px;
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .metric-label {
        font-size: 0.78rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--lv-silver, #94a3b8);
    }

    .metric-value {
        font-family: var(--font-mono, ui-monospace, monospace);
        font-size: 2rem;
        font-weight: 500;
        line-height: 1.1;
    }

    .metric-sub {
        font-size: 0.82rem;
        color: var(--lv-silver, #94a3b8);
    }

    .metric-link {
        font-size: 0.85rem;
        color: var(--lv-green, #00ff9c);
        text-decoration: none;
    }

    .metric-link:hover {
        text-decoration: underline;
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

    .section-card {
        overflow: hidden;
    }

    .empty {
        text-align: center;
        padding: 32px 16px;
        color: var(--lv-silver, #94a3b8);
    }

    .empty-sub {
        margin-top: 6px;
        font-size: 0.85rem;
    }

    .latest-meta {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
    }

    .muted {
        color: var(--lv-silver, #94a3b8);
    }

    .result-table {
        font-size: 0.88rem;
    }

    .mono {
        font-family: var(--font-mono, ui-monospace, monospace);
        font-size: 0.82rem;
        max-width: 360px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
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
</style>
