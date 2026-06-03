const httpPrefix = new RegExp('^https?:\\/\\/', 'i');

export function formatUrl(baseUrl: string) {
    const protocol = window.location.protocol;
    if (!baseUrl) {
        return '';
    }
    if (baseUrl.match(httpPrefix)) {
        return baseUrl;
    }
    return `${window.location.protocol}//${baseUrl}`;
}
