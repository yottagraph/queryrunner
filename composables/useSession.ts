/**
 * Session management composable for the Query Server
 *
 * Handles session ID generation, initialization, and persistence
 * across the application lifecycle.
 *
 * Uses Nuxt's useState for proper SSR support and global state sharing.
 * All components calling useSession() will get the same session ID.
 */

export const useSession = () => {
    // useState creates global shared state - all components get the same refs
    // The key (first param) ensures singleton behavior across the app
    const sessionId = useState<string>('sessionId', () => '');
    const isSessionInitialized = useState<boolean>('sessionInitialized', () => false);
    const sessionError = useState<string | null>('sessionError', () => null);

    /**
     * Generate a unique session ID
     */
    const generateSessionId = () => {
        const timestamp = Date.now();
        const randomStr = Math.random().toString(36).substr(2, 9);
        const browserId = process.client
            ? navigator.userAgent.replace(/\D/g, '').substr(0, 6)
            : 'server';
        return `session-${timestamp}-${randomStr}-${browserId}`;
    };

    /**
     * Initialize the session with the query server
     */
    const initializeSession = async (forceNew = false) => {
        try {
            // If already initialized and not forcing new, return existing
            if (isSessionInitialized.value && !forceNew && sessionId.value) {
                return sessionId.value;
            }

            // Generate new session ID if needed
            if (!sessionId.value || forceNew) {
                sessionId.value = generateSessionId();

                // Optionally store in localStorage for persistence across page reloads
                if (process.client) {
                    localStorage.setItem('queryServerSessionId', sessionId.value);
                }
            }

            // Mark session as initialized
            // Note: In the original Aether, this would ping the server
            // but we'll skip that to avoid circular dependencies
            isSessionInitialized.value = true;
            sessionError.value = null;

            console.log('Session initialized:', sessionId.value);
            return sessionId.value;
        } catch (error: any) {
            sessionError.value = error.message || 'Failed to initialize session';
            console.error('Session initialization error:', error);
            throw error;
        }
    };

    /**
     * Get the current session ID, initializing if necessary
     */
    const getSessionId = async () => {
        if (!isSessionInitialized.value) {
            await initializeSession();
        }
        return sessionId.value;
    };

    /**
     * Clear the current session
     */
    const clearSession = () => {
        sessionId.value = '';
        isSessionInitialized.value = false;
        sessionError.value = null;

        if (process.client) {
            localStorage.removeItem('queryServerSessionId');
        }
    };

    // On client-side mount, try to restore session from localStorage
    if (process.client) {
        onMounted(() => {
            const storedSessionId = localStorage.getItem('queryServerSessionId');
            if (storedSessionId && !sessionId.value) {
                sessionId.value = storedSessionId;
                // Note: We don't set isSessionInitialized here because we need to
                // verify the session is still valid with the server
            }
        });
    }

    return {
        sessionId: readonly(sessionId),
        isSessionInitialized: readonly(isSessionInitialized),
        sessionError: readonly(sessionError),
        initializeSession,
        getSessionId,
        clearSession,
    };
};
