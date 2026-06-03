<template>
    <div class="result-page">
        <PageHeader :title="result ? 'Query result' : 'Result not found'" icon="mdi-magnify">
            <template #actions>
                <NuxtLink to="/queries">
                    <v-btn variant="text" prepend-icon="mdi-arrow-left">Back to catalog</v-btn>
                </NuxtLink>
            </template>
        </PageHeader>

        <div class="content">
            <v-card v-if="!result" class="empty-card">
                <v-card-text class="text-center pa-8">
                    <v-icon size="x-large" class="mb-2">mdi-help-circle-outline</v-icon>
                    <div class="text-h6 mb-2">No result for this query</div>
                    <div class="text-body-2 mb-4">
                        Results (and their full agent/MCP trace) are kept only for the session in
                        which the query ran. Run the query from the catalog to inspect it here.
                    </div>
                    <NuxtLink to="/queries">
                        <v-btn color="primary" prepend-icon="mdi-format-list-checks">
                            Open catalog
                        </v-btn>
                    </NuxtLink>
                </v-card-text>
            </v-card>

            <template v-else>
                <v-card class="head-card">
                    <div class="result-question">{{ result.question }}</div>
                    <div class="result-meta">
                        <QueryResultChip
                            :pass="result.pass"
                            :error="result.error"
                            :duration-ms="result.durationMs"
                        />
                        <span class="meta-item">
                            <span class="meta-label">Expected</span>
                            <code>{{ result.expected }}</code>
                        </span>
                        <span class="meta-item">
                            <span class="meta-label">Answer</span>
                            <code>{{ result.actual }}</code>
                        </span>
                        <v-chip v-if="citationsLoading" size="x-small" variant="tonal" color="info">
                            <v-progress-circular indeterminate size="12" width="2" class="mr-1" />
                            loading citations…
                        </v-chip>
                        <v-chip
                            v-else-if="citationsCount > 0"
                            size="x-small"
                            variant="tonal"
                            color="primary"
                        >
                            {{ citationsCount }} citation{{ citationsCount === 1 ? '' : 's' }}
                        </v-chip>
                    </div>
                </v-card>

                <v-card class="trace-card">
                    <QueryTraceViewer :trace="displayTrace" />
                </v-card>
            </template>
        </div>
    </div>
</template>

<script setup lang="ts">
    import { computed, ref, watch } from 'vue';
    import type { QueryTrace, ToolCallTrace } from '~/types/queryrunner';

    const route = useRoute();
    const { getLiveResult } = useQueryRunner();

    const queryId = computed(() => String(route.params.queryId ?? ''));
    const result = computed(() => getLiveResult(queryId.value) ?? null);

    // A patchable copy of the trace: we merge lazily fetched citations into it
    // without mutating the shared session result.
    const displayTrace = ref<QueryTrace | null>(null);
    const citationsLoading = ref(false);

    const citationsCount = computed(() => {
        let n = 0;
        for (const tc of displayTrace.value?.toolCalls ?? []) {
            const details = toolDetails(tc);
            if (!details) continue;
            for (const d of Object.values(details)) {
                if (d && typeof d === 'object' && 'citation' in d) n += 1;
            }
        }
        return n;
    });

    /** structuredContent.details map of a get_entity_properties tool response. */
    function toolDetails(tc: ToolCallTrace): Record<string, Record<string, unknown>> | null {
        const resp = tc.response as { structuredContent?: { details?: unknown } } | undefined;
        const details = resp?.structuredContent?.details;
        if (details && typeof details === 'object') {
            return details as Record<string, Record<string, unknown>>;
        }
        return null;
    }

    // The trace is plain JSON data wrapped in a Vue reactive proxy;
    // `structuredClone` chokes on the proxy, so round-trip through JSON (which
    // also strips reactivity, giving us a private copy to merge citations into).
    function clone<T>(v: T): T {
        return JSON.parse(JSON.stringify(v));
    }

    /**
     * On a fresh trace, fetch source citations for every get_entity_properties
     * call and merge them into the displayed copy's details. Deferred to here
     * (not the agent run) on purpose — see DESIGN.md.
     */
    async function loadCitations(trace: QueryTrace) {
        const targets = (trace.toolCalls ?? [])
            .map((tc, index) => ({ tc, index }))
            .filter(({ tc }) => tc.name === 'get_entity_properties' && toolDetails(tc));
        if (targets.length === 0) return;

        citationsLoading.value = true;
        try {
            await Promise.all(
                targets.map(async ({ tc, index }) => {
                    const args = (tc.args ?? {}) as { neid?: unknown; properties?: unknown };
                    const neid = args.neid ? String(args.neid) : '';
                    const properties = Array.isArray(args.properties)
                        ? (args.properties as unknown[]).map(String)
                        : [];
                    if (!neid || properties.length === 0) return;
                    let citations: Record<string, unknown> = {};
                    try {
                        const res = await $fetch<{ citations: Record<string, unknown> }>(
                            '/api/queryrunner/citations',
                            { method: 'POST', body: { neid, properties }, timeout: 70_000 }
                        );
                        citations = res?.citations ?? {};
                    } catch {
                        return;
                    }
                    // Merge into the patchable copy (not the shared result).
                    const target = displayTrace.value?.toolCalls?.[index];
                    const details = target ? toolDetails(target) : null;
                    if (!details) return;
                    for (const [prop, citation] of Object.entries(citations)) {
                        if (details[prop] && typeof details[prop] === 'object') {
                            details[prop].citation = citation;
                        }
                    }
                    // Reassign to trigger reactivity on the nested mutation.
                    displayTrace.value = displayTrace.value ? { ...displayTrace.value } : null;
                })
            );
        } finally {
            citationsLoading.value = false;
        }
    }

    watch(
        result,
        (r) => {
            displayTrace.value = r?.trace ? clone(r.trace) : null;
            if (displayTrace.value) loadCitations(displayTrace.value);
        },
        { immediate: true }
    );
</script>

<style scoped>
    .result-page {
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

    .empty-card {
        overflow: hidden;
    }

    .head-card {
        padding: 16px 20px;
    }

    .result-question {
        font-size: 1.1rem;
        font-weight: 500;
        margin-bottom: 10px;
    }

    .result-meta {
        display: flex;
        align-items: center;
        gap: 16px;
        flex-wrap: wrap;
    }

    .meta-item {
        display: flex;
        align-items: baseline;
        gap: 6px;
        font-size: 0.85rem;
    }

    .meta-label {
        font-size: 0.7rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--lv-silver, #94a3b8);
    }

    .meta-item code {
        font-family: var(--font-mono, ui-monospace, monospace);
        color: var(--lv-green, #3fea00);
    }

    .trace-card {
        padding: 16px 20px;
    }
</style>
