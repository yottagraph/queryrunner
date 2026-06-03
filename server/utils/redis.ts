import { Redis } from '@upstash/redis';

let _redis: Redis | null = null;

/**
 * Check whether KV credentials are present (env vars set).
 * Does not attempt a connection — just checks config.
 */
export function isKVConfigured(): boolean {
    const url = process.env.KV_REST_API_URL;
    const token = process.env.KV_REST_API_TOKEN;
    return Boolean(url && token && url.startsWith('https://'));
}

/**
 * Get the Upstash Redis client. Uses KV_REST_API_URL and KV_REST_API_TOKEN
 * env vars that Vercel auto-injects when a KV store is connected.
 *
 * Returns null if KV is not configured (env vars missing).
 */
export function getRedis(): Redis | null {
    if (_redis) return _redis;

    const url = process.env.KV_REST_API_URL;
    const token = process.env.KV_REST_API_TOKEN;

    if (!url || !token || !url.startsWith('https://')) {
        return null;
    }

    _redis = new Redis({ url, token });
    return _redis;
}

/**
 * Convert a doc-style prefs path to a Redis key.
 * `/users/abc/apps/myapp/settings/general` → `prefs:users:abc:apps:myapp:settings:general`
 */
export function toRedisKey(docPath: string): string {
    return 'prefs:' + docPath.replace(/^\/+/, '').replace(/\/+/g, ':');
}

/**
 * Extract the "document ID" from a Redis key relative to a collection prefix.
 * `prefs:users:abc:apps:myapp:settings:general` with prefix `prefs:users:abc:apps:myapp:settings`
 * → `general`
 */
export function docIdFromKey(key: string, collectionPrefix: string): string | null {
    if (!key.startsWith(collectionPrefix + ':')) return null;
    const rest = key.slice(collectionPrefix.length + 1);
    if (rest.includes(':')) return null;
    return rest;
}
