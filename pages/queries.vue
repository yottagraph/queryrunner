<template>
    <div class="queries-page">
        <PageHeader title="Query catalog" icon="mdi-format-list-checks">
            <template #actions>
                <v-btn
                    color="primary"
                    variant="flat"
                    prepend-icon="mdi-play"
                    :loading="runningAll"
                    :disabled="queries.length === 0"
                    @click="onRunAll"
                >
                    Run all
                </v-btn>
                <v-btn
                    color="primary"
                    variant="tonal"
                    prepend-icon="mdi-plus"
                    class="ml-2"
                    @click="openNew"
                >
                    New query
                </v-btn>
            </template>
        </PageHeader>

        <div class="content">
            <v-card v-if="queries.length === 0" class="empty-card">
                <v-card-text class="text-center pa-8">
                    <v-icon size="x-large" class="mb-2">mdi-comment-question-outline</v-icon>
                    <div class="text-h6 mb-2">No queries yet</div>
                    <div class="text-body-2 mb-4">
                        Add a plaintext question for the agent to answer against the Knowledge
                        Graph.
                    </div>
                    <v-btn color="primary" prepend-icon="mdi-plus" @click="openNew">
                        Add your first query
                    </v-btn>
                </v-card-text>
            </v-card>

            <v-card v-else class="catalog-card">
                <v-table density="comfortable">
                    <thead>
                        <tr>
                            <th>Status</th>
                            <th>Question</th>
                            <th>Expected</th>
                            <th>Last answer</th>
                            <th class="text-center">MCP</th>
                            <th class="text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="q in queries" :key="q.id">
                            <td>
                                <QueryResultChip
                                    :pass="result(q.id)?.pass ?? null"
                                    :error="result(q.id)?.error"
                                    :duration-ms="result(q.id)?.durationMs ?? null"
                                />
                            </td>
                            <td>
                                <div class="q-question">{{ q.question }}</div>
                                <div v-if="q.name || q.description" class="q-desc">
                                    {{ [q.name, q.description].filter(Boolean).join(' — ') }}
                                </div>
                            </td>
                            <td class="mono">{{ describeExpectation(q.expected) }}</td>
                            <td class="mono answer-cell">{{ result(q.id)?.actual ?? '—' }}</td>
                            <td class="text-center">
                                <v-btn
                                    v-if="liveResults[q.id]?.trace"
                                    size="x-small"
                                    variant="tonal"
                                    :to="`/result/${q.id}`"
                                >
                                    {{ liveResults[q.id]?.toolCallCount ?? 0 }}
                                    <v-icon end size="small">mdi-magnify</v-icon>
                                </v-btn>
                                <span v-else class="muted">—</span>
                            </td>
                            <td class="text-right action-cell">
                                <v-btn
                                    icon
                                    size="small"
                                    variant="text"
                                    :loading="runningOne === q.id"
                                    title="Run this query"
                                    @click="onRunOne(q)"
                                >
                                    <v-icon>mdi-play</v-icon>
                                </v-btn>
                                <v-btn
                                    icon
                                    size="small"
                                    variant="text"
                                    title="Edit"
                                    @click="openEdit(q)"
                                >
                                    <v-icon>mdi-pencil</v-icon>
                                </v-btn>
                                <v-btn
                                    icon
                                    size="small"
                                    variant="text"
                                    title="Delete"
                                    @click="confirmDelete(q)"
                                >
                                    <v-icon>mdi-delete-outline</v-icon>
                                </v-btn>
                            </td>
                        </tr>
                    </tbody>
                </v-table>
            </v-card>
        </div>

        <v-dialog v-model="editorOpen" max-width="720">
            <QueryEditDialog :existing="editorTarget" @close="editorOpen = false" @save="onSave" />
        </v-dialog>

        <v-dialog v-model="confirmOpen" max-width="420">
            <v-card>
                <v-card-title>Delete query?</v-card-title>
                <v-card-text>
                    <p>
                        This removes
                        <strong>{{ deleteTarget?.name || deleteTarget?.question }}</strong>
                        from the catalog.
                    </p>
                    <p class="text-caption">History entries that reference it are preserved.</p>
                </v-card-text>
                <v-card-actions>
                    <v-spacer />
                    <v-btn variant="text" @click="confirmOpen = false">Cancel</v-btn>
                    <v-btn color="error" variant="flat" @click="onDelete">Delete</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>
    </div>
</template>

<script setup lang="ts">
    import { computed, ref } from 'vue';
    import type { AnswerExpectation, QueryDef, QueryResult } from '~/types/queryrunner';
    import { describeExpectation } from '~/types/queryrunner';

    const {
        queries,
        runs,
        liveResults,
        recordResult,
        addQuery,
        updateQuery,
        deleteQuery,
        runQuery,
        runAll,
    } = useQueryRunner();
    const { show: notify } = useNotification();

    const editorOpen = ref(false);
    const editorTarget = ref<QueryDef | null>(null);
    const confirmOpen = ref(false);
    const deleteTarget = ref<QueryDef | null>(null);
    const runningOne = ref<string | null>(null);
    const runningAll = ref(false);

    const lastResultByQuery = computed(() => {
        const map: Record<string, QueryResult> = {};
        for (const run of runs.value) {
            for (const r of run.results) {
                if (!map[r.queryId]) map[r.queryId] = r;
            }
        }
        return map;
    });

    function result(id: string): QueryResult | undefined {
        return liveResults.value[id] ?? lastResultByQuery.value[id];
    }

    function openNew() {
        editorTarget.value = null;
        editorOpen.value = true;
    }

    function openEdit(q: QueryDef) {
        editorTarget.value = q;
        editorOpen.value = true;
    }

    function onSave(payload: {
        name: string;
        description: string;
        question: string;
        expected: AnswerExpectation;
    }) {
        if (editorTarget.value) {
            updateQuery(editorTarget.value.id, payload);
            notify('Query updated', 'success');
        } else {
            addQuery(payload);
            notify('Query added', 'success');
        }
        editorOpen.value = false;
    }

    function confirmDelete(q: QueryDef) {
        deleteTarget.value = q;
        confirmOpen.value = true;
    }

    function onDelete() {
        if (deleteTarget.value) {
            deleteQuery(deleteTarget.value.id);
            notify('Query deleted', 'info');
        }
        confirmOpen.value = false;
        deleteTarget.value = null;
    }

    async function onRunOne(q: QueryDef) {
        runningOne.value = q.id;
        try {
            const r = await runQuery(q);
            recordResult(r);
            const tone = r.error ? 'warning' : r.pass ? 'success' : 'error';
            notify(`"${q.name || q.question}": ${r.pass ? 'pass' : 'fail'}`, tone);
        } finally {
            runningOne.value = null;
        }
    }

    async function onRunAll() {
        if (runningAll.value || queries.value.length === 0) return;
        runningAll.value = true;
        try {
            const run = await runAll();
            // runAll strips traces from the persisted run; re-run is not needed
            // — but we still want session traces, so reflect the run results.
            for (const r of run.results) recordResult(r);
            const total = run.results.length;
            notify(
                `Run complete: ${run.passCount}/${total} passed`,
                run.passCount === total ? 'success' : 'warning'
            );
        } finally {
            runningAll.value = false;
        }
    }
</script>

<style scoped>
    .queries-page {
        height: 100%;
        overflow-y: auto;
    }

    .content {
        max-width: 1100px;
        margin: 0 auto;
        padding: 24px;
    }

    .empty-card,
    .catalog-card {
        overflow: hidden;
    }

    .q-question {
        font-weight: 500;
    }

    .q-desc {
        font-size: 0.8rem;
        color: var(--lv-silver, #94a3b8);
    }

    .mono {
        font-family: var(--font-mono, ui-monospace, monospace);
        font-size: 0.85rem;
    }

    .answer-cell {
        max-width: 220px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .muted {
        color: var(--lv-silver, #94a3b8);
    }

    .action-cell {
        white-space: nowrap;
    }
</style>
