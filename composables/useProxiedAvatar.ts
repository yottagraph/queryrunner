export function useProxiedAvatar(originalUrl: Ref<string | undefined>) {
    const proxiedUrl = computed(() => {
        if (!originalUrl.value) return undefined;

        // Only proxy Google user content URLs
        if (originalUrl.value.includes('googleusercontent.com')) {
            // Encode the URL to pass it as a route parameter
            const encoded = encodeURIComponent(originalUrl.value);
            return `/api/avatar/${encoded}`;
        }

        // Return other URLs as-is
        return originalUrl.value;
    });

    return {
        proxiedUrl,
    };
}
