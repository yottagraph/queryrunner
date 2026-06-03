# Data-fetching cookbook

Copy-paste patterns that call the Elemental API, gateway, or helpers. For platform API details see [data.md](data.md) in this skill. Pure UI patterns (tables, forms, charts) are in [cookbook.md](cookbook.md).

## 1. Entity Search Page

Search for entities by name and display results. Uses `$fetch` directly
because `POST /entities/search` (batch name resolution with scored ranking)
is not wrapped by the generated `useElementalClient()` — see [data.md](data.md).

```vue
<template>
    <div class="d-flex flex-column fill-height pa-4">
        <h1 class="text-h5 mb-4">Entity Search</h1>
        <v-text-field
            v-model="query"
            label="Search entities"
            prepend-inner-icon="mdi-magnify"
            variant="outlined"
            @keyup.enter="search"
            :loading="loading"
        />
        <v-alert v-if="error" type="error" variant="tonal" class="mt-2" closable>
            {{ error }}
        </v-alert>
        <v-list v-if="results.length" class="mt-4">
            <v-list-item
                v-for="(neid, i) in results"
                :key="neid"
                :title="names[i] || neid"
                :subtitle="neid"
            />
        </v-list>
        <v-empty-state
            v-else-if="searched && !loading"
            headline="No results"
            icon="mdi-magnify-remove-outline"
        />
    </div>
</template>

<script setup lang="ts">
    import { useElementalClient } from '@yottagraph-app/elemental-api/client';

    const client = useElementalClient();
    const query = ref('');
    const results = ref<string[]>([]);
    const names = ref<string[]>([]);
    const loading = ref(false);
    const error = ref<string | null>(null);
    const searched = ref(false);

    function getSearchUrl() {
        const config = useRuntimeConfig();
        const gw = (config.public as any).gatewayUrl as string;
        const org = (config.public as any).tenantOrgId as string;
        return `${gw}/api/qs/${org}/entities/search`;
    }

    function getApiKey() {
        return (useRuntimeConfig().public as any).qsApiKey as string;
    }

    async function search() {
        if (!query.value.trim()) return;
        loading.value = true;
        error.value = null;
        searched.value = true;
        try {
            const res = await $fetch<any>(getSearchUrl(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Api-Key': getApiKey() },
                body: {
                    queries: [{ queryId: 1, query: query.value.trim() }],
                    maxResults: 10,
                    includeNames: true,
                },
            });
            const matches = res?.results?.[0]?.matches ?? [];
            results.value = matches.map((m: any) => m.neid);
            names.value = matches.map((m: any) => m.name || m.neid);
        } catch (e: any) {
            error.value = e.message || 'Search failed';
            results.value = [];
        } finally {
            loading.value = false;
        }
    }
</script>
```

## 2. News Feed — Recent Articles with Sentiment

Fetch recent articles from the knowledge graph. Uses `useElementalSchema()`
for runtime flavor/PID discovery and `buildGatewayUrl()` for gateway access.

```vue
<template>
    <div class="d-flex flex-column fill-height pa-4">
        <h1 class="text-h5 mb-4">Recent News</h1>
        <v-alert v-if="error" type="error" variant="tonal" class="mb-4" closable>
            {{ error }}
        </v-alert>
        <v-progress-linear v-if="loading" indeterminate class="mb-4" />
        <v-list v-if="articles.length" lines="three">
            <v-list-item v-for="a in articles" :key="a.neid">
                <template #title>
                    <span>{{ a.name || a.neid }}</span>
                    <v-chip
                        v-if="a.sentiment"
                        size="x-small"
                        class="ml-2"
                        :color="a.sentiment > 0 ? 'success' : a.sentiment < 0 ? 'error' : 'grey'"
                    >
                        {{ a.sentiment > 0 ? 'Bullish' : a.sentiment < 0 ? 'Bearish' : 'Neutral' }}
                    </v-chip>
                </template>
                <template #subtitle>{{ a.neid }}</template>
            </v-list-item>
        </v-list>
        <v-empty-state
            v-else-if="!loading"
            headline="No articles found"
            icon="mdi-newspaper-variant-outline"
        />
    </div>
</template>

<script setup lang="ts">
    import { useElementalClient } from '@yottagraph-app/elemental-api/client';
    import { padNeid } from '~/utils/elementalHelpers';

    const client = useElementalClient();
    const { flavorByName, pidByName, refresh: loadSchema } = useElementalSchema();

    const articles = ref<{ neid: string; name: string; sentiment: number | null }[]>([]);
    const loading = ref(false);
    const error = ref<string | null>(null);

    onMounted(async () => {
        loading.value = true;
        try {
            await loadSchema();
            const articleFid = flavorByName('article');
            if (!articleFid) {
                error.value = 'Article entity type not found in schema';
                return;
            }

            const res = await client.findEntities({
                expression: JSON.stringify({ type: 'is_type', is_type: { fid: articleFid } }),
                limit: 20,
            });
            const neids: string[] = (res as any).eids ?? [];

            if (!neids.length) {
                return;
            }

            const namePid = pidByName('name');
            const sentimentPid = pidByName('sentiment');
            const pids = [namePid, sentimentPid].filter((p): p is number => p !== null);

            const props = await client.getPropertyValues({
                eids: JSON.stringify(neids),
                pids: JSON.stringify(pids),
            });

            const valueMap = new Map<string, Record<number, any>>();
            for (const v of (props as any).values ?? []) {
                const eid = padNeid(v.eid ?? v.entity_id ?? '');
                if (!valueMap.has(eid)) valueMap.set(eid, {});
                valueMap.get(eid)![v.pid] = v.value;
            }

            articles.value = neids.map((neid) => {
                const vals = valueMap.get(neid) ?? {};
                return {
                    neid,
                    name: namePid ? ((vals[namePid] as string) ?? neid) : neid,
                    sentiment: sentimentPid ? ((vals[sentimentPid] as number) ?? null) : null,
                };
            });
        } catch (e: any) {
            error.value = e.message || 'Failed to load articles';
        } finally {
            loading.value = false;
        }
    });
</script>
```

## 3. Entity Search with Gateway Helpers

Simpler version of recipe #1 using the pre-built `searchEntities()` helper.

```vue
<template>
    <div class="d-flex flex-column fill-height pa-4">
        <h1 class="text-h5 mb-4">Entity Search</h1>
        <v-text-field
            v-model="query"
            label="Search entities"
            prepend-inner-icon="mdi-magnify"
            variant="outlined"
            @keyup.enter="search"
            :loading="loading"
        />
        <v-alert v-if="error" type="error" variant="tonal" class="mt-2" closable>
            {{ error }}
        </v-alert>
        <v-list v-if="results.length" class="mt-4">
            <v-list-item v-for="r in results" :key="r.neid" :title="r.name" :subtitle="r.neid" />
        </v-list>
        <v-empty-state
            v-else-if="searched && !loading"
            headline="No results"
            icon="mdi-magnify-remove-outline"
        />
    </div>
</template>

<script setup lang="ts">
    import { searchEntities } from '~/utils/elementalHelpers';

    const query = ref('');
    const results = ref<{ neid: string; name: string }[]>([]);
    const loading = ref(false);
    const error = ref<string | null>(null);
    const searched = ref(false);

    async function search() {
        if (!query.value.trim()) return;
        loading.value = true;
        error.value = null;
        searched.value = true;
        try {
            results.value = await searchEntities(query.value.trim());
        } catch (e: any) {
            error.value = e.message || 'Search failed';
            results.value = [];
        } finally {
            loading.value = false;
        }
    }
</script>
```

## 4. Get Filings for a Company

Fetch Edgar filings (or any relationship-linked documents) for an organization.
Uses `$fetch` for the initial entity search because `POST /entities/search`
is not wrapped by the generated client (same as recipe #1). Filing
properties are then fetched via `useElementalClient()`.

**Important:** For graph-layer entities (person, organization, location),
use `findEntities` with a `linked` expression. For property-layer entities
(documents, filings, articles), use `getPropertyValues` with the
relationship PID. See [data.md](data.md) for the two-layer architecture.

```vue
<template>
    <div class="d-flex flex-column fill-height pa-4">
        <h1 class="text-h5 mb-4">Company Filings</h1>
        <v-text-field
            v-model="query"
            label="Company name"
            prepend-inner-icon="mdi-magnify"
            @keyup.enter="search"
            :loading="loading"
        />
        <v-alert v-if="error" type="error" variant="tonal" class="mt-2" closable>
            {{ error }}
        </v-alert>
        <v-data-table
            v-if="filings.length"
            :headers="headers"
            :items="filings"
            :loading="loading"
            density="comfortable"
            hover
            class="mt-4"
        />
        <v-empty-state
            v-else-if="searched && !loading"
            headline="No filings found"
            icon="mdi-file-document-off"
        />
    </div>
</template>

<script setup lang="ts">
    import { useElementalClient } from '@yottagraph-app/elemental-api/client';

    const client = useElementalClient();
    const query = ref('');
    const filings = ref<{ neid: string; name: string }[]>([]);
    const loading = ref(false);
    const error = ref<string | null>(null);
    const searched = ref(false);

    const headers = [
        { title: 'NEID', key: 'neid', sortable: true },
        { title: 'Name', key: 'name', sortable: true },
    ];

    async function getPropertyPidMap(client: ReturnType<typeof useElementalClient>) {
        const schemaRes = await client.getSchema();
        const properties = schemaRes.schema?.properties ?? (schemaRes as any).properties ?? [];
        return new Map(properties.map((p: any) => [p.name, p.pid]));
    }

    function getSearchUrl() {
        const config = useRuntimeConfig();
        const gw = (config.public as any).gatewayUrl as string;
        const org = (config.public as any).tenantOrgId as string;
        return `${gw}/api/qs/${org}/entities/search`;
    }

    function getApiKey() {
        return (useRuntimeConfig().public as any).qsApiKey as string;
    }

    async function search() {
        if (!query.value.trim()) return;
        loading.value = true;
        error.value = null;
        searched.value = true;
        try {
            const res = await $fetch<any>(getSearchUrl(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Api-Key': getApiKey() },
                body: {
                    queries: [{ queryId: 1, query: query.value.trim(), flavors: ['organization'] }],
                    maxResults: 1,
                    includeNames: true,
                },
            });
            const matches = res?.results?.[0]?.matches ?? [];
            if (!matches.length) {
                filings.value = [];
                return;
            }
            const orgNeid = matches[0].neid;

            const pidMap = await getPropertyPidMap(client);
            const filedPid = pidMap.get('filed');
            if (!filedPid) {
                error.value = '"filed" relationship not found in schema';
                return;
            }

            const propRes = await client.getPropertyValues({
                eids: JSON.stringify([orgNeid]),
                pids: JSON.stringify([filedPid]),
            });

            const docNeids = (propRes.values ?? []).map((v: any) =>
                String(v.value).padStart(20, '0')
            );

            function getEntityNameUrl(neid: string) {
                const config = useRuntimeConfig();
                const gw = (config.public as any).gatewayUrl as string;
                const org = (config.public as any).tenantOrgId as string;
                return `${gw}/api/qs/${org}/entities/${neid}/name`;
            }

            const names = await Promise.all(
                docNeids.map(async (neid: string) => {
                    try {
                        const res = await $fetch<{ name: string }>(getEntityNameUrl(neid), {
                            headers: { 'X-Api-Key': getApiKey() },
                        });
                        return res.name || neid;
                    } catch {
                        return neid;
                    }
                })
            );

            filings.value = docNeids.map((neid: string, i: number) => ({
                neid,
                name: names[i],
            }));
        } catch (e: any) {
            error.value = e.message || 'Failed to load filings';
            filings.value = [];
        } finally {
            loading.value = false;
        }
    }
</script>
```

## 5. Async Entity Search with Live Suggestions

Type-ahead search that shows results in a dropdown as the user types. Uses
`searchEntities()` from the gateway helpers with a debounced watcher.

> **Do not use `v-autocomplete` for async search.** Vuetify's `v-autocomplete`
> with `hide-no-data` + `no-filter` + async item loading has a timing bug:
> the menu hides while items are empty (during the fetch) and does not reopen
> when results arrive. Use `v-text-field` with a manual dropdown instead.

```vue
<template>
    <div class="entity-search" style="position: relative">
        <v-text-field
            v-model="searchQuery"
            :label="label"
            :prepend-inner-icon="icon"
            variant="solo-filled"
            rounded="lg"
            clearable
            density="comfortable"
            :loading="searching"
            @focus="showMenu = suggestions.length > 0"
            @click:clear="onClear"
        />

        <v-card v-if="showMenu && suggestions.length > 0" class="search-dropdown" elevation="8">
            <v-list density="compact">
                <v-list-item
                    v-for="item in suggestions"
                    :key="item.neid"
                    :title="item.name"
                    :subtitle="item.neid"
                    @click="onSelect(item)"
                />
            </v-list>
        </v-card>
    </div>
</template>

<script setup lang="ts">
    import { searchEntities } from '~/utils/elementalHelpers';

    const props = withDefaults(
        defineProps<{
            label?: string;
            icon?: string;
            flavors?: string[];
        }>(),
        { label: 'Search', icon: 'mdi-magnify', flavors: undefined }
    );

    const emit = defineEmits<{
        selected: [entity: { neid: string; name: string }];
    }>();

    const searchQuery = ref('');
    const suggestions = ref<{ neid: string; name: string }[]>([]);
    const searching = ref(false);
    const showMenu = ref(false);
    let selectedName = '';
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    watch(searchQuery, (val) => {
        if (debounceTimer) clearTimeout(debounceTimer);
        if (val === selectedName) return;
        if (!val || val.length < 2) {
            suggestions.value = [];
            showMenu.value = false;
            return;
        }
        debounceTimer = setTimeout(() => doSearch(val), 300);
    });

    async function doSearch(query: string) {
        searching.value = true;
        try {
            suggestions.value = await searchEntities(query, {
                maxResults: 8,
                flavors: props.flavors,
            });
            showMenu.value = suggestions.value.length > 0;
        } catch {
            suggestions.value = [];
            showMenu.value = false;
        } finally {
            searching.value = false;
        }
    }

    function onSelect(item: { neid: string; name: string }) {
        selectedName = item.name;
        searchQuery.value = item.name;
        suggestions.value = [];
        showMenu.value = false;
        emit('selected', item);
    }

    function onClear() {
        selectedName = '';
        suggestions.value = [];
        showMenu.value = false;
    }

    onMounted(() => {
        document.addEventListener('click', (e) => {
            const el = (e.target as HTMLElement)?.closest('.entity-search');
            if (!el) showMenu.value = false;
        });
    });
</script>

<style scoped>
    .entity-search {
        max-width: 600px;
    }

    .search-dropdown {
        position: absolute;
        top: 100%;
        left: 0;
        right: 0;
        z-index: 100;
        max-height: 300px;
        overflow-y: auto;
        margin-top: -8px;
    }
</style>
```

Usage:

```vue
<EntitySearch
    label="Search for a company"
    icon="mdi-domain"
    :flavors="['organization']"
    @selected="onCompanySelected"
/>
```
