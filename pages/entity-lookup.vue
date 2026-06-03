<template>
    <v-container fluid class="pa-0 fill-height">
        <v-row class="fill-height ma-0">
            <v-col cols="12" class="pa-2 fill-height">
                <div class="feature-wrapper">
                    <PageHeader title="Entity Lookup" icon="mdi-magnify" />

                    <v-card class="feature-content" flat>
                        <v-card-text>
                            <v-row>
                                <v-col cols="12" md="8" lg="6">
                                    <v-text-field
                                        v-model="searchQuery"
                                        label="Entity Name"
                                        placeholder="e.g. Elon Musk, Boeing, Microsoft"
                                        variant="outlined"
                                        density="comfortable"
                                        append-inner-icon="mdi-magnify"
                                        @click:append-inner="performSearch"
                                        @keyup.enter="performSearch"
                                        :loading="loading"
                                        :disabled="loading"
                                        clearable
                                    />

                                    <v-select
                                        v-model="maxResults"
                                        :items="[5, 10, 20, 50]"
                                        label="Max Results"
                                        variant="outlined"
                                        density="comfortable"
                                        class="mt-2"
                                    />
                                </v-col>
                            </v-row>

                            <!-- Error Alert -->
                            <v-alert
                                v-if="error"
                                type="error"
                                variant="tonal"
                                class="mt-4"
                                closable
                                @click:close="error = null"
                            >
                                {{ error }}
                            </v-alert>

                            <!-- Results -->
                            <div v-if="searchResults" class="mt-6">
                                <h3 class="text-h6 mb-4">
                                    Found {{ searchResults.neids.length }} result{{
                                        searchResults.neids.length !== 1 ? 's' : ''
                                    }}
                                    for "{{ lastSearchQuery }}"
                                </h3>

                                <v-list lines="two" density="comfortable">
                                    <v-list-item
                                        v-for="(neid, index) in searchResults.neids"
                                        :key="neid"
                                        :title="`NEID: ${neid}`"
                                        :subtitle="
                                            searchResults.names
                                                ? searchResults.names[index]
                                                : 'Name not available'
                                        "
                                        class="mb-2 elevation-1"
                                    >
                                        <template v-slot:prepend>
                                            <v-avatar color="primary" variant="tonal">
                                                <v-icon>mdi-identifier</v-icon>
                                            </v-avatar>
                                        </template>

                                        <template v-slot:append>
                                            <v-tooltip text="Copy NEID">
                                                <template v-slot:activator="{ props }">
                                                    <v-btn
                                                        v-bind="props"
                                                        icon="mdi-content-copy"
                                                        size="small"
                                                        variant="text"
                                                        @click="copyToClipboard(neid)"
                                                    />
                                                </template>
                                            </v-tooltip>

                                            <v-tooltip text="View Entity Report">
                                                <template v-slot:activator="{ props }">
                                                    <v-btn
                                                        v-bind="props"
                                                        icon="mdi-file-document-outline"
                                                        size="small"
                                                        variant="text"
                                                        color="primary"
                                                        @click="viewEntityReport(neid)"
                                                        :loading="loadingReports[neid]"
                                                    />
                                                </template>
                                            </v-tooltip>
                                        </template>
                                    </v-list-item>
                                </v-list>
                            </div>

                            <!-- Empty State -->
                            <v-empty-state
                                v-else-if="!loading && hasSearched"
                                headline="No results found"
                                title="Try a different search term"
                                icon="mdi-magnify-remove-outline"
                                class="mt-6"
                            />

                            <!-- Initial State -->
                            <v-empty-state
                                v-else-if="!loading && !hasSearched"
                                headline="Search for entities"
                                title="Enter an entity name above to find its NEID"
                                icon="mdi-magnify"
                                class="mt-6"
                            />
                        </v-card-text>
                    </v-card>

                    <!-- Entity Report Dialog -->
                    <v-dialog v-model="reportDialog" max-width="800" scrollable>
                        <v-card>
                            <v-card-title class="d-flex align-center">
                                <v-icon class="mr-2">mdi-file-document-outline</v-icon>
                                Entity Report: {{ selectedNeid }}
                                <v-spacer />
                                <v-btn
                                    icon="mdi-close"
                                    variant="text"
                                    @click="reportDialog = false"
                                />
                            </v-card-title>

                            <v-divider />

                            <v-card-text class="pa-4">
                                <div v-if="selectedReport">
                                    <v-list density="comfortable">
                                        <v-list-item>
                                            <v-list-item-title>Primary Name</v-list-item-title>
                                            <v-list-item-subtitle>{{
                                                selectedReport.name
                                            }}</v-list-item-subtitle>
                                        </v-list-item>
                                        <v-list-item>
                                            <v-list-item-title>NEID</v-list-item-title>
                                            <v-list-item-subtitle>{{
                                                selectedReport.neid
                                            }}</v-list-item-subtitle>
                                        </v-list-item>
                                        <v-list-item>
                                            <v-list-item-title>Type</v-list-item-title>
                                            <v-list-item-subtitle>{{
                                                selectedReport.type
                                            }}</v-list-item-subtitle>
                                        </v-list-item>
                                        <v-list-item v-if="selectedReport.aliases.length > 0">
                                            <v-list-item-title>Aliases</v-list-item-title>
                                            <v-list-item-subtitle>
                                                <v-chip
                                                    v-for="alias in selectedReport.aliases"
                                                    :key="alias"
                                                    size="small"
                                                    class="mr-1 mb-1"
                                                >
                                                    {{ alias }}
                                                </v-chip>
                                            </v-list-item-subtitle>
                                        </v-list-item>
                                    </v-list>

                                    <v-divider class="my-4" />

                                    <details>
                                        <summary class="text-caption cursor-pointer">
                                            View Raw Data
                                        </summary>
                                        <pre class="text-body-2 mt-2">{{
                                            JSON.stringify(selectedReport, null, 2)
                                        }}</pre>
                                    </details>
                                </div>
                                <div v-else class="text-center py-4">
                                    <v-progress-circular indeterminate />
                                </div>
                            </v-card-text>
                        </v-card>
                    </v-dialog>
                </div>
            </v-col>
        </v-row>
    </v-container>
</template>

<script setup lang="ts">
    import { ref } from 'vue';
    import { useElementalClient } from '@yottagraph-app/elemental-api/client';
    import type {
        GetNamedEntityReportResponse,
        NamedEntityReport,
    } from '@yottagraph-app/elemental-api/client';
    import { useNotification } from '~/composables/useNotification';
    import { getApiErrorMessage } from '~/utils/apiErrorHandler';

    interface SearchMatch {
        neid: string;
        name: string;
        flavor?: string;
        score?: number;
    }

    // State
    const searchQuery = ref('');
    const lastSearchQuery = ref('');
    const maxResults = ref(10);
    const loading = ref(false);
    const error = ref<string | null>(null);
    const searchResults = ref<{ neids: string[]; names: string[]; matches: SearchMatch[] } | null>(
        null
    );
    const hasSearched = ref(false);
    const reportDialog = ref(false);
    const selectedReport = ref<NamedEntityReport | null>(null);
    const selectedNeid = ref<string>('');
    const loadingReports = ref<Record<string, boolean>>({});

    // Initialize composables
    const elementalClient = useElementalClient();
    const { showSuccess, showError, showWarning } = useNotification();

    // Methods
    const performSearch = async () => {
        if (!searchQuery.value.trim()) {
            error.value = 'Please enter an entity name';
            return;
        }

        loading.value = true;
        error.value = null;
        hasSearched.value = true;
        lastSearchQuery.value = searchQuery.value;

        try {
            const config = useRuntimeConfig();
            const gw = (config.public as any).gatewayUrl as string;
            const org = (config.public as any).tenantOrgId as string;
            const apiKey = (config.public as any).qsApiKey as string;

            const res = await $fetch<any>(`${gw}/api/qs/${org}/entities/search`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
                body: {
                    queries: [{ queryId: 1, query: searchQuery.value.trim() }],
                    maxResults: maxResults.value,
                    includeNames: true,
                    includeFlavors: true,
                    includeScores: true,
                },
            });

            const matches: SearchMatch[] = res?.results?.[0]?.matches ?? [];
            if (matches.length === 0) {
                searchResults.value = null;
            } else {
                searchResults.value = {
                    neids: matches.map((m) => m.neid),
                    names: matches.map((m) => m.name || m.neid),
                    matches,
                };
            }
        } catch (err) {
            console.error('Search error:', err);
            const errorMessage = getApiErrorMessage(err, 'Failed to search for entities');
            error.value = errorMessage;
            showError(errorMessage);
            searchResults.value = null;
        } finally {
            loading.value = false;
        }
    };

    const copyToClipboard = async (text: string) => {
        try {
            await navigator.clipboard.writeText(text);
            showSuccess(`NEID copied to clipboard: ${text}`);
        } catch (err) {
            console.error('Failed to copy:', err);
            showError('Failed to copy to clipboard');
        }
    };

    const viewEntityReport = async (neid: string) => {
        loadingReports.value[neid] = true;
        selectedReport.value = null;
        selectedNeid.value = neid;
        reportDialog.value = true;

        try {
            // Fetch the full entity report with proper typing
            const response = await elementalClient.getNamedEntityReport(neid);
            selectedReport.value = response.report;
        } catch (err) {
            console.error('Failed to fetch entity report:', err);
            const errorMessage = getApiErrorMessage(err, 'Failed to load entity report');
            showError(errorMessage);
            reportDialog.value = false;
        } finally {
            loadingReports.value[neid] = false;
        }
    };
</script>

<style scoped>
    .feature-wrapper {
        display: flex;
        flex-direction: column;
        height: 100%;
    }

    .feature-content {
        border-radius: 0 0 4px 4px;
        flex: 1;
        overflow-y: auto;
    }

    .fill-height {
        height: 100%;
    }

    pre {
        white-space: pre-wrap;
        word-wrap: break-word;
    }

    .cursor-pointer {
        cursor: pointer;
    }

    .cursor-pointer:hover {
        opacity: 0.8;
    }
</style>
