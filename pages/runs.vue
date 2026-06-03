<template>
    <div class="runs-page">
        <PageHeader title="Run history" icon="mdi-history">
            <template #actions>
                <v-btn
                    v-if="runs.length > 0"
                    color="error"
                    variant="text"
                    prepend-icon="mdi-delete-sweep-outline"
                    @click="confirmClear = true"
                >
                    Clear history
                </v-btn>
            </template>
        </PageHeader>

        <div class="content">
            <v-card v-if="runs.length === 0" class="empty-card">
                <v-card-text class="text-center pa-8">
                    <v-icon size="x-large" class="mb-2">mdi-history</v-icon>
                    <div class="text-h6 mb-2">No runs recorded</div>
                    <div class="text-body-2 mb-4">
                        Trigger <strong>Run all</strong> from the dashboard or queries page to start
                        collecting metrics.
                    </div>
                    <NuxtLink to="/">
                        <v-btn color="primary" prepend-icon="mdi-view-dashboard-outline">
                            Go to dashboard
                        </v-btn>
                    </NuxtLink>
                </v-card-text>
            </v-card>

            <v-card v-else class="runs-card">
                <v-table density="comfortable">
                    <thead>
                        <tr>
                            <th>Finished</th>
                            <th>Queries</th>
                            <th>Pass</th>
                            <th>Fail</th>
                            <th>Errors</th>
                            <th>Duration</th>
                            <th class="text-right">Pass rate</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="r in runs" :key="r.id">
                            <td>{{ formatTime(r.finishedAt) }}</td>
                            <td>{{ r.results.length }}</td>
                            <td class="pass-cell">{{ r.passCount }}</td>
                            <td class="fail-cell">{{ r.failCount }}</td>
                            <td class="err-cell">{{ r.errorCount }}</td>
                            <td class="mono">{{ r.finishedAt - r.startedAt }} ms</td>
                            <td class="text-right mono">
                                {{ rateLabel(r.passCount, r.results.length) }}
                            </td>
                            <td class="text-right">
                                <NuxtLink :to="`/runs/${r.id}`" class="link">View →</NuxtLink>
                            </td>
                        </tr>
                    </tbody>
                </v-table>
            </v-card>
        </div>

        <v-dialog v-model="confirmClear" max-width="420">
            <v-card>
                <v-card-title>Clear all run history?</v-card-title>
                <v-card-text>
                    This deletes every recorded test run. Your query catalog is preserved.
                </v-card-text>
                <v-card-actions>
                    <v-spacer />
                    <v-btn variant="text" @click="confirmClear = false">Cancel</v-btn>
                    <v-btn color="error" variant="flat" @click="onClear">Clear</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>
    </div>
</template>

<script setup lang="ts">
    import { ref } from 'vue';

    const { runs, clearHistory } = useQueryRunner();
    const { show: notify } = useNotification();

    const confirmClear = ref(false);

    function onClear() {
        clearHistory();
        confirmClear.value = false;
        notify('Run history cleared', 'info');
    }

    function rateLabel(pass: number, total: number) {
        if (total === 0) return '—';
        return `${Math.round((pass / total) * 100)}%`;
    }

    function formatTime(ts: number) {
        return new Date(ts).toLocaleString();
    }
</script>

<style scoped>
    .runs-page {
        height: 100%;
        overflow-y: auto;
    }

    .content {
        max-width: 1100px;
        margin: 0 auto;
        padding: 24px;
    }

    .runs-card,
    .empty-card {
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

    .link {
        color: var(--lv-green, #00ff9c);
        text-decoration: none;
        font-size: 0.88rem;
    }

    .link:hover {
        text-decoration: underline;
    }
</style>
