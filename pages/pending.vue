<template>
    <v-container fluid class="fill-height d-flex align-center justify-center pending-page">
        <v-card class="text-center pa-8" elevation="0" max-width="500">
            <v-icon size="64" color="warning" class="mb-4">mdi-clock-outline</v-icon>

            <h1 class="text-h4 mb-4">Access Pending</h1>

            <p class="text-body-1 mb-6">
                Your account has been created but is awaiting approval. Please contact your
                administrator for access.
            </p>

            <v-alert type="info" variant="tonal" density="compact" class="mb-6">
                <div class="text-left"><strong>Logged in as:</strong> {{ userName }}</div>
            </v-alert>

            <v-btn color="primary" variant="outlined" @click="logout" size="large">
                <v-icon start>mdi-logout</v-icon>
                Logout
            </v-btn>
        </v-card>
    </v-container>
</template>

<script setup lang="ts">
    const { userName, clearUser } = useUserState();

    async function logout() {
        await clearUser();
    }
</script>

<style scoped>
    .pending-page {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        min-height: 100vh;
    }
</style>
