const { clearUser } = useUserState();

// This is called when the /logout route is hit.
export default defineNuxtRouteMiddleware(async (to, from) => {
    await clearUser();
    return navigateTo('/login');
});
