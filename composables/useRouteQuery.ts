const _watchlistIds = ref<string[]>([]);

function _processRouteQuery(query: Record<string, any>) {
    console.log('Processing route query:', query);
}

export function useRouteQuery() {
    function initialize() {
        const route = useRoute();
        const query = route.query;

        console.log('Initializing route query');

        watch(
            () => route.query,
            (newQuery) => {
                _processRouteQuery(newQuery);
            },
            { deep: true, immediate: true }
        );
    }

    return {
        initialize,
        watchlistIds: readonly(_watchlistIds),
    };
}
