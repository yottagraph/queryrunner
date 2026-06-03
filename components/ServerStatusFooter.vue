<template>
    <v-footer v-if="configuredServers.length > 0" app height="36" class="server-status-footer">
        <v-container fluid class="pa-0 d-flex align-center" style="height: 100%">
            <div class="d-flex align-center">
                <span class="text-caption mr-3">Server Status:</span>

                <div
                    v-for="(server, index) in configuredServers"
                    :key="server.type"
                    class="d-flex align-center"
                >
                    <v-icon
                        :icon="getStatusIcon(server.status)"
                        :color="getStatusColor(server.status)"
                        size="small"
                        :class="{ rotating: server.status === 'checking' }"
                    />
                    <span class="text-caption mx-1">{{ server.name }}:</span>
                    <span
                        class="text-caption font-weight-medium mr-3"
                        :class="getStatusTextClass(server.status)"
                    >
                        {{ getStatusText(server.status) }}
                    </span>

                    <!-- Show address for available servers -->
                    <span
                        v-if="server.status === 'available' && server.address"
                        class="text-caption text-medium-emphasis mr-3"
                    >
                        ({{ formatAddress(server.address) }})
                    </span>

                    <!-- Divider between servers -->
                    <v-divider v-if="index < configuredServers.length - 1" vertical class="mx-2" />
                </div>
            </div>
        </v-container>
    </v-footer>
</template>

<script setup lang="ts">
    import { computed } from 'vue';
    import { useServerStatus } from '~/composables/useServerStatus';

    const { getConfiguredServers } = useServerStatus();
    const configuredServers = computed(() => getConfiguredServers());

    function getStatusColor(status: string) {
        switch (status) {
            case 'available':
                return 'success';
            case 'unavailable':
                return 'error';
            case 'checking':
                return 'warning';
            default:
                return 'grey';
        }
    }

    function getStatusIcon(status: string) {
        switch (status) {
            case 'available':
                return 'mdi-check-circle';
            case 'unavailable':
                return 'mdi-alert-circle';
            case 'checking':
                return 'mdi-loading';
            default:
                return 'mdi-help-circle';
        }
    }

    function getStatusText(status: string) {
        switch (status) {
            case 'available':
                return 'Connected';
            case 'unavailable':
                return 'Disconnected';
            case 'checking':
                return 'Checking...';
            default:
                return 'Unknown';
        }
    }

    function getStatusTextClass(status: string) {
        switch (status) {
            case 'available':
                return 'text-success';
            case 'unavailable':
                return 'text-error';
            case 'checking':
                return 'text-warning';
            default:
                return 'text-grey';
        }
    }

    function formatAddress(address: string) {
        // Remove https:// and trailing slashes for cleaner display
        return address.replace(/^https?:\/\//, '').replace(/\/$/, '');
    }
</script>

<style scoped>
    .server-status-footer {
        border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
    }

    .rotating {
        animation: rotate 1s linear infinite;
    }

    @keyframes rotate {
        from {
            transform: rotate(0deg);
        }
        to {
            transform: rotate(360deg);
        }
    }
</style>
