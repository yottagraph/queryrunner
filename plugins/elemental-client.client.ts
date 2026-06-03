import { defineNuxtPlugin } from '#app';
import { configureElementalClient } from '@yottagraph-app/elemental-api/config';
import { useUserState } from '~/composables/useUserState';
import { formatUrl } from '~/utils/formatUrl';

export default defineNuxtPlugin(() => {
    const config = useRuntimeConfig();
    const serverAddress = config.public.queryServerAddress as string;
    const gatewayUrl = (config.public as any).gatewayUrl as string;
    const tenantOrgId = (config.public as any).tenantOrgId as string;
    const qsApiKey = (config.public as any).qsApiKey as string;
    const { accessToken } = useUserState();

    const useProxy = !!(gatewayUrl && tenantOrgId && qsApiKey);
    const baseUrl = useProxy
        ? `${gatewayUrl}/api/qs/${tenantOrgId}`
        : serverAddress
          ? formatUrl(serverAddress)
          : '';

    configureElementalClient({
        baseUrl,
        fetch: async (url: string, options?: RequestInit) => {
            const headers: Record<string, string> = {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                ...((options?.headers as Record<string, string>) || {}),
            };

            if (useProxy) {
                headers['X-Api-Key'] = qsApiKey;
            } else if (accessToken.value) {
                headers['Authorization'] = `Bearer ${accessToken.value}`;
            }

            const response = await fetch(url, {
                ...options,
                headers,
                cache: options?.method === 'GET' ? 'default' : 'no-store',
            });

            let data: unknown;
            const contentLength = response.headers.get('content-length');
            if (contentLength === '0' || response.status === 204) {
                data = {};
            } else {
                const contentType = response.headers.get('content-type');
                if (contentType?.includes('application/json')) {
                    data = await response.json();
                } else if (contentType?.includes('text/')) {
                    data = await response.text();
                } else {
                    data = await response.text();
                }
            }

            return { data, status: response.status, headers: response.headers };
        },
    });
});
