import * as Iron from '@hapi/iron';

import type { H3Event, EventHandlerRequest } from 'h3';

/**
 * Helpers for reading the Auth0 / session-cookie secrets.
 *
 * Before ENG-768 these lived under `runtimeConfig.public.*` (i.e.
 * shipped to the browser bundle). They now live at the top level of
 * `runtimeConfig` so they're available to server code only.
 *
 * The legacy `NUXT_PUBLIC_AUTH0_CLIENT_SECRET` / `NUXT_PUBLIC_COOKIE_SECRET`
 * env-var names are still accepted as a transitional fallback so a
 * Vercel-hosted BC 1.0 tenant whose env hasn't been re-injected yet
 * keeps working. New deployments should set the un-prefixed names
 * (`NUXT_AUTH0_CLIENT_SECRET`, `NUXT_COOKIE_SECRET`); the fallback
 * will be removed once all tenants are migrated.
 */

export function getAuth0Secret(event: H3Event): string {
    const config = useRuntimeConfig(event);
    const fromServer = (config as Record<string, unknown>).auth0ClientSecret;
    if (typeof fromServer === 'string' && fromServer.length > 0) return fromServer;
    const fromPublic = (config.public as Record<string, unknown>).auth0ClientSecret;
    if (typeof fromPublic === 'string' && fromPublic.length > 0) return fromPublic;
    const fromEnv = process.env.NUXT_PUBLIC_AUTH0_CLIENT_SECRET;
    return typeof fromEnv === 'string' ? fromEnv : '';
}

export function getCookieSecret(event: H3Event): string {
    const config = useRuntimeConfig(event);
    const fromServer = (config as Record<string, unknown>).cookieSecret;
    if (typeof fromServer === 'string' && fromServer.length > 0) return fromServer;
    const fromPublic = (config.public as Record<string, unknown>).cookieSecret;
    if (typeof fromPublic === 'string' && fromPublic.length > 0) return fromPublic;
    const fromEnv = process.env.NUXT_PUBLIC_COOKIE_SECRET;
    return typeof fromEnv === 'string' ? fromEnv : '';
}

export function getCookieName(event: H3Event): string {
    const config = useRuntimeConfig(event);
    return (config.public.auth0CookieName as string) || 'llai-cookie';
}

export async function unsealCookie(event: H3Event<EventHandlerRequest>) {
    const config = useRuntimeConfig(event);
    const clientSecret = getAuth0Secret(event);
    const cookieSecret = getCookieSecret(event);

    // No Auth0 client_secret configured → Auth0 isn't in use. Return
    // a synthetic anonymous payload so local-dev handlers can still
    // attribute requests to the `NUXT_PUBLIC_USER_NAME` bypass user.
    if (!clientSecret || clientSecret.length === 0) {
        return {
            user: {
                sub: config.public.userName,
            },
        };
    }

    const cookieName = getCookieName(event);
    const cookie = getCookie(event, cookieName) || undefined;
    if (!cookie) {
        console.log(`ERROR: No ${cookieName} cookie found.`);
        return undefined;
    }

    if (!cookieSecret) {
        console.error('ERROR: cookie present but no cookie secret configured');
        return undefined;
    }

    const unsealed = await Iron.unseal(cookie, cookieSecret, Iron.defaults);
    return unsealed;
}
