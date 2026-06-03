<template>
    <div class="prefs-demo">
        <PageHeader
            title="Prefs API demo"
            subtitle="ENG-534 — useAppPrefs / useGlobalPrefs / useFeaturePrefs"
        />

        <v-card class="demo-card">
            <v-card-title>Backend status</v-card-title>
            <v-card-text>
                <v-chip
                    :color="backendChipColor"
                    variant="tonal"
                    data-testid="prefs-demo-backend-chip"
                >
                    backend: {{ backend }}
                </v-chip>
                <v-chip
                    :color="hydratedChipColor"
                    variant="tonal"
                    class="ms-2"
                    data-testid="prefs-demo-hydrated-chip"
                >
                    {{ hydratedChipLabel }}
                </v-chip>
                <p class="hint">
                    <code>localfs</code> on <code>npm run dev</code>, <code>firestore</code> on
                    deployed BC 2.0 tenants. <code>none</code> means writes will be dropped — check
                    <code>NUXT_PUBLIC_FIRESTORE_ENABLED</code> and friends.
                </p>
                <v-alert
                    v-if="backend === 'none'"
                    type="error"
                    class="mt-3"
                    data-testid="prefs-demo-no-backend"
                >
                    No prefs backend configured. Mutations on this page will not persist.
                </v-alert>
                <v-alert
                    v-else-if="!hydrated && lastError?.code === 'unauthenticated'"
                    type="warning"
                    class="mt-3"
                    data-testid="prefs-demo-unauthenticated"
                >
                    Not signed in — defaults are showing; writes won't persist.
                </v-alert>
                <v-alert
                    v-else-if="!hydrated && backend !== 'loading'"
                    type="info"
                    class="mt-3"
                    data-testid="prefs-demo-loading"
                >
                    Loading your preferences…
                </v-alert>
                <v-alert
                    v-if="lastError"
                    type="warning"
                    class="mt-3"
                    closable
                    data-testid="prefs-demo-error"
                    @click:close="clearError"
                >
                    <div>
                        <strong>{{ lastError.code }}</strong> on {{ lastError.op }} (scope:
                        {{ lastError.scope ?? '—' }})
                    </div>
                    <div class="error-detail">{{ lastError.message }}</div>
                </v-alert>
            </v-card-text>
        </v-card>

        <v-card class="demo-card">
            <v-card-title>App-scoped feature prefs (useAppFeaturePrefs)</v-card-title>
            <v-card-text>
                <p class="hint">
                    Imported from <code>features/demo-prefs/prefs.ts</code>. Persists to
                    <code>state/app</code> under the <code>demo</code> property; values follow this
                    user within this Aether app.
                </p>
                <v-text-field
                    v-model="demoPrefs.nickname"
                    label="Nickname"
                    data-testid="prefs-demo-nickname"
                />
                <v-switch
                    v-model="demoPrefs.darkModeBias"
                    label="Dark mode bias"
                    color="primary"
                    data-testid="prefs-demo-dark-mode"
                />
                <v-text-field
                    v-model.number="demoPrefs.fontSize"
                    type="number"
                    label="Font size"
                    data-testid="prefs-demo-font-size"
                />
                <v-combobox
                    v-model="demoPrefs.favoriteTags"
                    label="Favorite tags"
                    multiple
                    chips
                    closable-chips
                    data-testid="prefs-demo-tags"
                />
            </v-card-text>
        </v-card>

        <v-card class="demo-card">
            <v-card-title>Top-level app prefs (useAppPrefs)</v-card-title>
            <v-card-text>
                <p class="hint">
                    Defaults declared inline at the call site. Equivalent to having a feature, just
                    without the subtree namespace.
                </p>
                <v-text-field
                    v-model="appPrefs.lastSearch"
                    label="Last search term"
                    data-testid="prefs-demo-app-search"
                />
                <v-text-field
                    v-model="appPrefs.workspaceName"
                    label="Workspace name"
                    data-testid="prefs-demo-app-workspace"
                />
            </v-card-text>
        </v-card>

        <v-card class="demo-card">
            <v-card-title>Cross-app prefs (useGlobalPrefs)</v-card-title>
            <v-card-text>
                <p class="hint">
                    Persists to <code>state/global</code> — the same value would surface in every
                    Aether app this user touches.
                </p>
                <v-select
                    v-model="globalPrefs.language"
                    label="Preferred language"
                    :items="['en', 'es', 'fr', 'de', 'ja']"
                    data-testid="prefs-demo-language"
                />
                <v-switch
                    v-model="globalPrefs.reduceMotion"
                    label="Reduce motion"
                    data-testid="prefs-demo-reduce-motion"
                />
            </v-card-text>
        </v-card>

        <v-card class="demo-card">
            <v-card-title>Global feature prefs (useGlobalFeaturePrefs)</v-card-title>
            <v-card-text>
                <p class="hint">
                    Same shape as <code>useAppFeaturePrefs</code> but the subtree lives in
                    <code>state/global</code>. The feature name is intentionally namespaced
                    <code>_prefs_demo_global</code> so this demo doesn't silently merge state with
                    any real app's accessibility (or similarly-named) feature in the same Aether
                    project.
                </p>
                <v-text-field
                    v-model.number="demoGlobalPrefs.fontScale"
                    type="number"
                    step="0.1"
                    label="Font scale (demo)"
                    data-testid="prefs-demo-font-scale"
                />
                <v-switch
                    v-model="demoGlobalPrefs.highContrast"
                    label="High contrast (demo)"
                    data-testid="prefs-demo-high-contrast"
                />
            </v-card-text>
        </v-card>

        <v-card class="demo-card">
            <v-card-title>Live snapshot</v-card-title>
            <v-card-text>
                <p class="hint">
                    Raw view of the two scope docs as they sit in memory, fetched via
                    <code>useAppPrefsRoot()</code> / <code>useGlobalPrefsRoot()</code> (the
                    introspection-only companions to the typed composables). Updates instantly with
                    any field above; the persisted view follows after the 150 ms debounce.
                </p>
                <div class="snapshot">
                    <strong>state/app:</strong>
                    <pre>{{ JSON.stringify(appRoot, null, 2) }}</pre>
                </div>
                <div class="snapshot">
                    <strong>state/global:</strong>
                    <pre>{{ JSON.stringify(globalRoot, null, 2) }}</pre>
                </div>
            </v-card-text>
        </v-card>
    </div>
</template>

<script setup lang="ts">
    import { computed } from 'vue';

    import { useDemoPrefs } from '~/features/demo-prefs/prefs';

    const demoPrefs = useDemoPrefs();

    const appPrefs = useAppPrefs({
        lastSearch: '',
        workspaceName: '',
    });

    const globalPrefs = useGlobalPrefs({
        language: 'en' as 'en' | 'es' | 'fr' | 'de' | 'ja',
        reduceMotion: false,
    });

    // Demo-flavored namespace so this page doesn't share state with
    // any real tenant feature that the doc rightly recommends naming
    // 'accessibility'. The demo page lives in every freshly-scaffolded
    // tenant repo; collisions here would be a footgun.
    const demoGlobalPrefs = useGlobalFeaturePrefs('_prefs_demo_global', {
        fontScale: 1.0,
        highContrast: false,
    });

    // Introspection-only roots for the live snapshot. These don't
    // contribute to the schema — they just expose the merged
    // in-memory doc.
    const appRoot = useAppPrefsRoot();
    const globalRoot = useGlobalPrefsRoot();

    const { backend, hydrated, lastError, clearError } = usePrefsStatus();
    const backendChipColor = computed(() => {
        switch (backend.value) {
            case 'firestore':
                return 'success';
            case 'localfs':
                return 'info';
            case 'kv':
                return 'warning';
            case 'none':
                return 'error';
            case 'loading':
            default:
                return 'default';
        }
    });
    // Three-state hydration label so the chip distinguishes "still
    // loading" from "stuck on auth" — `hydrated` alone collapses
    // both into one signal.
    const hydratedChipLabel = computed(() => {
        if (hydrated.value) return 'hydrated';
        if (lastError.value?.code === 'unauthenticated') return 'unauthenticated';
        return 'hydrating…';
    });
    const hydratedChipColor = computed(() => {
        if (hydrated.value) return 'success';
        if (lastError.value?.code === 'unauthenticated') return 'warning';
        return 'info';
    });
</script>

<style scoped>
    .prefs-demo {
        max-width: 720px;
        margin: 0 auto;
        padding: 24px;
        display: flex;
        flex-direction: column;
        gap: 16px;
    }

    .demo-card {
        padding: 8px;
    }

    .hint {
        color: var(--lv-silver);
        font-size: 0.875rem;
        margin-top: 8px;
        margin-bottom: 12px;
    }

    .hint code {
        font-family: var(--font-mono);
        font-size: 0.85em;
        padding: 1px 5px;
        background: var(--lv-surface);
        border-radius: 3px;
    }

    .error-detail {
        font-size: 0.875rem;
        opacity: 0.9;
        margin-top: 4px;
    }

    .snapshot {
        margin-top: 12px;
    }

    .snapshot pre {
        background: var(--lv-surface);
        padding: 12px;
        border-radius: 4px;
        font-size: 0.8125rem;
        overflow-x: auto;
        margin-top: 4px;
    }
</style>
