// This is called when the /a0callback route is hit.
export default defineNuxtRouteMiddleware(async (to, from) => {
    const { setUserFromAuth0 } = useUserState();

    const code = to.query?.code;
    let authError = null;

    if (!code) {
        authError = 'No authorization code received from Auth0';
    } else {
        try {
            await setUserFromAuth0(code);
        } catch (error) {
            authError = error.message || 'Authentication failed';
            console.error('[auth-callback] Authentication failed:', error);
        }
    }

    if (authError) {
        return navigateTo({
            path: '/login',
            query: {
                error: authError,
                ...Object.fromEntries(Object.entries(to.query).filter(([key]) => key !== 'code')),
            },
        });
    }

    return navigateTo({
        path: '/',
        query: { ...to.query, code: undefined },
    });
});
