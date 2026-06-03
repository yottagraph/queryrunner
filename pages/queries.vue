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
                    <v-icon size="x-large" class="mb-2">mdi-test-tube</v-icon>
                    <div class="text-h6 mb-2">No queries yet</div>
                    <div class="text-body-2 mb-4">
                        Add a query to start validating the Knowledge Graph.
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
                            <th>Name</th>
                            <th>Type</th>
                            <th>Validation</th>
                            <th>Last actual</th>
                            <th class="text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="q in queries" :key="q.id">
                            <td>
                                <QueryResultChip
                                    :pass="
                                        liveResults[q.id]?.pass ??
                                        lastResultByQuery[q.id]?.pass ??
                                        null
                                    "
                                    :error="
                                        liveResults[q.id]?.error ?? lastResultByQuery[q.id]?.error
                                    "
                                    :duration-ms="
                                        liveResults[q.id]?.durationMs ??
                                        lastResultByQuery[q.id]?.durationMs ??
                                        null
                                    "
                                />
                            </td>
                            <td>
                                <div class="q-name">{{ q.name }}</div>
                                <div v-if="q.description" class="q-desc">{{ q.description }}</div>
                            </td>
                            <td class="mono">{{ q.body.type }}</td>
                            <td class="mono">{{ describeValidator(q) }}</td>
                            <td class="mono">
                                {{
                                    liveResults[q.id]?.actual ??
                                    lastResultByQuery[q.id]?.actual ??
                                    '—'
                                }}
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
                        This removes <strong>{{ deleteTarget?.name }}</strong> from the catalog.
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
    import { computed, reactive, ref } from 'vue';
    import type { QueryDef, QueryResult } from '~/types/queryrunner';

    const { queries, runs, addQuery, updateQuery, deleteQuery, runQuery, runAll } =
        useQueryRunner();
    const { show: notify } = useNotification();

    const editorOpen = ref(false);
    const editorTarget = ref<QueryDef | null>(null);
    const confirmOpen = ref(false);
    const deleteTarget = ref<QueryDef | null>(null);
    const runningOne = ref<string | null>(null);
    const runningAll = ref(false);

    // queryId → most recent result observed THIS SESSION (resets on
    // reload). Distinct from `lastResultByQuery`, which reads from the
    // persisted run history.
    const liveResults = reactive<Record<string, QueryResult>>({});

    const lastResultByQuery = computed(() => {
        const map: Record<string, QueryResult> = {};
        for (const run of runs.value) {
            for (const r of run.results) {
                if (!map[r.queryId]) map[r.queryId] = r;
            }
        }
        return map;
    });

    function openNew() {
        editorTarget.value = null;
        editorOpen.value = true;
    }

    function openEdit(q: QueryDef) {
        editorTarget.value = q;
        editorOpen.value = true;
    }

    function onSave(payload: { name: string; description: string; body: QueryDef['body'] }) {
        if (editorTarget.value) {
            updateQuery(editorTarget.value.id, {
                name: payload.name,
                description: payload.description,
                body: payload.body,
            });
            notify('Query updated', 'success');
        } else {
            addQuery({
                name: payload.name,
                description: payload.description,
                body: payload.body,
            });
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
            const result = await runQuery(q);
            liveResults[q.id] = result;
            const tone = result.error ? 'warning' : result.pass ? 'success' : 'error';
            notify(`"${q.name}": ${result.pass ? 'pass' : 'fail'}`, tone);
        } finally {
            runningOne.value = null;
        }
    }

    async function onRunAll() {
        if (runningAll.value || queries.value.length === 0) return;
        runningAll.value = true;
        try {
            const run = await runAll();
            for (const r of run.results) liveResults[r.queryId] = r;
            const total = run.results.length;
            notify(
                `Run complete: ${run.passCount}/${total} passed`,
                run.passCount === total ? 'success' : 'warning'
            );
        } finally {
            runningAll.value = false;
        }
    }

    function describeValidator(q: QueryDef): string {
        const v = q.body;
        if (v.type === 'search') {
            if (v.validator.mode === 'has_match') return `has match for "${v.query}"`;
            return `${v.validator.mode.replace('top_', 'top ')} = "${v.validator.expected}"`;
        }
        if (v.type === 'property') {
            const target = `${v.entity}.${v.property}`;
            if (v.validator.mode === 'not_null') return `${target} not null`;
            return `${target} ${v.validator.mode} "${v.validator.expected}"`;
        }
        const v2 = v.validator;
        return `${v.direction} linked count ${v2.mode === 'gte' ? '≥' : '='} ${v2.expected}`;
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

    .empty-card {
        padding: 16px;
    }

    .catalog-card {
        overflow: hidden;
    }

    .q-name {
        font-weight: 500;
    }

    .q-desc {
        font-size: 0.82rem;
        color: var(--lv-silver, #94a3b8);
    }

    .mono {
        font-family: var(--font-mono, ui-monospace, monospace);
        font-size: 0.85rem;
    }

    .action-cell {
        white-space: nowrap;
    }
</style>
