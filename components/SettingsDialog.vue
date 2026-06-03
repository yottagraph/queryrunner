<template>
    <v-card min-width="500">
        <v-card-title class="d-flex align-center">
            <span>Settings</span>
            <v-spacer></v-spacer>
            <v-btn icon variant="text" @click="state.showSettingsDialog = false">
                <v-icon>mdi-close</v-icon>
            </v-btn>
        </v-card-title>

        <v-divider />

        <v-card-text>
            <v-container>
                <v-row>
                    <v-col cols="12">
                        <h3 class="text-h6 mb-2">Server Configuration</h3>
                        <div class="mt-3">
                            <div class="text-body-2 mb-1">Current Query Server:</div>
                            <code class="text-caption">{{
                                currentQueryServer || 'Not configured'
                            }}</code>
                        </div>
                        <div class="text-caption text-medium-emphasis mt-3">
                            Use <code>/configure_query_server</code> in Cursor to change the Query
                            Server address, or update it in the Broadchurch Portal.
                        </div>
                    </v-col>
                </v-row>
            </v-container>
        </v-card-text>

        <v-divider />

        <v-card-actions>
            <v-spacer></v-spacer>
            <v-btn variant="text" @click="state.showSettingsDialog = false">Close</v-btn>
        </v-card-actions>
    </v-card>
</template>

<script setup lang="ts">
    import { state } from '~/utils/appState';

    const config = useRuntimeConfig();
    const currentQueryServer = computed(() => config.public.queryServerAddress as string);
</script>

<style scoped>
    code {
        padding: 2px 4px;
        background-color: rgba(0, 0, 0, 0.05);
        border-radius: 3px;
        font-family: monospace;
    }
</style>
