<template>
    <v-alert
        v-if="showWarning"
        type="warning"
        density="compact"
        closable
        class="server-status-alert"
    >
        <v-icon icon="mdi-server-off" class="mr-2"></v-icon>
        {{ warningMessage }}
    </v-alert>
</template>

<script setup lang="ts">
    import { onMounted, onUnmounted, computed } from 'vue';
    import { useServerStatus } from '~/composables/useServerStatus';

    const { servers, getConfiguredServers, startChecking, stopChecking } = useServerStatus();

    // Only show warning if configured servers are unavailable
    const showWarning = computed(() => {
        const configured = getConfiguredServers();
        return configured.length > 0 && configured.some((s) => s.status === 'unavailable');
    });

    const warningMessage = computed(() => {
        const unavailable = getConfiguredServers()
            .filter((s) => s.status === 'unavailable')
            .map((s) => s.name);

        if (unavailable.length === 1) {
            return `${unavailable[0]} is unavailable. Some features may not work properly.`;
        }
        return `The following servers are unavailable: ${unavailable.join(', ')}. Some features may not work properly.`;
    });

    onMounted(() => {
        startChecking();
    });

    onUnmounted(() => {
        stopChecking();
    });
</script>

<style scoped>
    .server-status-alert {
        position: fixed;
        top: 10px;
        right: 10px;
        z-index: 9999;
        max-width: 400px;
    }
</style>
