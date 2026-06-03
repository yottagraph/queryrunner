/**
 * Notification composable for showing user feedback via Vuetify snackbars.
 *
 * This provides a simple interface for showing success, error, and info messages
 * to users throughout the application.
 *
 * @example
 * ```typescript
 * const { showSuccess, showError } = useNotification();
 *
 * // Show success message
 * showSuccess('File saved successfully');
 *
 * // Show error message
 * showError('Failed to load data');
 * ```
 */

import { ref } from 'vue';

// Global state for notifications
const notifications = ref<
    Array<{
        id: number;
        type: 'success' | 'error' | 'info' | 'warning';
        message: string;
        timeout?: number;
    }>
>([]);

let nextId = 1;

export const useNotification = () => {
    const show = (
        message: string,
        type: 'success' | 'error' | 'info' | 'warning' = 'info',
        timeout = 3000
    ) => {
        const notification = {
            id: nextId++,
            type,
            message,
            timeout,
        };

        notifications.value.push(notification);

        // Auto-remove after timeout
        if (timeout > 0) {
            setTimeout(() => {
                remove(notification.id);
            }, timeout);
        }

        return notification.id;
    };

    const remove = (id: number) => {
        const index = notifications.value.findIndex((n) => n.id === id);
        if (index > -1) {
            notifications.value.splice(index, 1);
        }
    };

    const showSuccess = (message: string, timeout?: number) => show(message, 'success', timeout);

    const showError = (message: string, timeout?: number) => show(message, 'error', timeout);

    const showInfo = (message: string, timeout?: number) => show(message, 'info', timeout);

    const showWarning = (message: string, timeout?: number) => show(message, 'warning', timeout);

    return {
        notifications: readonly(notifications),
        show,
        remove,
        showSuccess,
        showError,
        showInfo,
        showWarning,
    };
};
