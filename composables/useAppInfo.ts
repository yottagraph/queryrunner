// Composable for accessing centralized app configuration

export const useAppInfo = () => {
    const config = useRuntimeConfig();

    return {
        appName: config.public.appName,
        appShortName: config.public.appShortName,
    };
};
