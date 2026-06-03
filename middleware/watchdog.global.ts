export default defineNuxtRouteMiddleware(async (to, from) => {
    const { userIsPermitted, userName } = useUserState();

    if (!userName.value) {
        if (to.path !== '/a0callback' && to.path !== '/login' && to.path !== '/logout') {
            return navigateTo('/login');
        }
    } else {
        if (!userIsPermitted()) {
            if (to.path !== '/pending' && to.path !== '/logout') {
                return navigateTo('pending');
            }
        }
    }
});
