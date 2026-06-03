<template>
    <v-layout>
        <v-snackbar
            v-for="notification in notifications"
            :key="notification.id"
            v-model="snackbars[notification.id]"
            :color="notification.type"
            :timeout="notification.timeout"
            location="top right"
            variant="elevated"
            multi-line
            @update:model-value="handleClose(notification.id, $event)"
        >
            {{ notification.message }}

            <template v-slot:actions>
                <v-btn variant="text" @click="remove(notification.id)"> Close </v-btn>
            </template>
        </v-snackbar>
    </v-layout>
</template>

<script setup lang="ts">
    import { ref, watch } from 'vue';
    import { useNotification } from '~/composables/useNotification';

    const { notifications, remove } = useNotification();

    // Track snackbar visibility state
    const snackbars = ref<Record<number, boolean>>({});

    // Watch for new notifications and show them
    watch(
        notifications,
        (newNotifications) => {
            newNotifications.forEach((notification) => {
                if (!(notification.id in snackbars.value)) {
                    snackbars.value[notification.id] = true;
                }
            });
        },
        { deep: true }
    );

    // Handle snackbar close
    const handleClose = (id: number, isOpen: boolean) => {
        if (!isOpen) {
            delete snackbars.value[id];
            remove(id);
        }
    };
</script>
