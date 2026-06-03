<template>
    <div class="qr-nav">
        <v-tabs
            :model-value="activeTab"
            color="primary"
            density="compact"
            slider-color="primary"
            grow
            @update:model-value="onTab"
        >
            <v-tab value="/" prepend-icon="mdi-view-dashboard-outline">Dashboard</v-tab>
            <v-tab value="/queries" prepend-icon="mdi-format-list-checks">Queries</v-tab>
            <v-tab value="/runs" prepend-icon="mdi-history">Runs</v-tab>
        </v-tabs>
    </div>
</template>

<script setup lang="ts">
    import { computed } from 'vue';

    const route = useRoute();
    const router = useRouter();

    const activeTab = computed(() => {
        if (route.path === '/' || route.path === '/index') return '/';
        if (route.path.startsWith('/queries')) return '/queries';
        if (route.path.startsWith('/runs')) return '/runs';
        return '/';
    });

    function onTab(value: unknown) {
        if (typeof value === 'string' && value !== route.path) {
            router.push(value);
        }
    }
</script>

<style scoped>
    .qr-nav {
        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
        background: var(--lv-surface, rgba(0, 0, 0, 0.18));
    }
</style>
