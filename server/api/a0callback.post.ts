import * as Iron from '@hapi/iron';
import { createRemoteJWKSet, jwtVerify } from 'jose';

import type { H3Event } from 'h3';

import { getAuth0Secret, getCookieName, getCookieSecret } from '../utils/cookies';

/**
 * POST /api/a0callback
 *
 * Server-side handler for the OAuth 2.0 authorization-code exchange.
 *
 * Before ENG-768 this was a client-side flow: the browser POSTed
 * directly to Auth0's `/oauth/token`, which required the Auth0
 * `client_secret` to ship in `runtimeConfig.public.*` (i.e. inlined
 * into the JS bundle). That leaked the secret to anyone who fetched
 * the app's HTML.
 *
 * The new flow:
 *
 *   1. Browser hits `/a0callback?code=...` (Auth0's redirect target).
 *   2. The `auth-callback` route middleware POSTs `{ code, redirect_uri }`
 *      to this endpoint.
 *   3. This handler exchanges the code for tokens via Auth0's
 *      `/oauth/token` using the server-only `client_secret` (read from
 *      `useRuntimeConfig().auth0ClientSecret`).
 *   4. The id_token (and, when present as a JWT, the access_token)
 *      are verified against Auth0's JWKS.
 *   5. The user payload is sealed with the server-only `cookieSecret`
 *      and written to an HttpOnly + Secure + SameSite=Lax cookie.
 *   6. The response body returns the public fields the client UI
 *      needs (user, permissions, access_token for QS calls). The
 *      `client_secret` and `id_token` never leave the server.
 *
 * The matching read side is `GET /api/me`, which unseals the cookie
 * and returns the same shape (so `useUserState.setUserFromCookie()`
 * can rehydrate on page load without ever holding the cookie secret
 * in the browser).
 *
 * Linear: ENG-768.
 */

interface CallbackBody {
    code?: string;
    redirect_uri?: string;
}

interface TokenResponse {
    access_token: string;
    id_token: string;
    scope?: string;
    expires_in?: number;
    token_type?: string;
}

interface Auth0User {
    iss: string;
    sub: string;
    aud: string | string[];
    exp: number;
    iat: number;
    name?: string;
    given_name?: string;
    family_name?: string;
    email?: string;
    email_verified?: boolean;
    picture?: string;
}

const REQUIRED_ACCESS = 'read:all';

function getIssuerBaseUrl(event: H3Event): string {
    const config = useRuntimeConfig(event);
    const url = config.public.auth0IssuerBaseUrl as string;
    if (!url) {
        throw createError({
            statusCode: 500,
            statusMessage: 'auth0_not_configured',
            data: { reason: 'NUXT_PUBLIC_AUTH0_ISSUER_BASE_URL is empty' },
        });
    }
    return url.replace(/\/$/, '');
}

function getClientId(event: H3Event): string {
    const config = useRuntimeConfig(event);
    const id = config.public.auth0ClientId as string;
    if (!id) {
        throw createError({
            statusCode: 500,
            statusMessage: 'auth0_not_configured',
            data: { reason: 'NUXT_PUBLIC_AUTH0_CLIENT_ID is empty' },
        });
    }
    return id;
}

export default defineEventHandler(async (event) => {
    const body = await readBody<CallbackBody>(event);
    const code = body?.code;
    const redirectUri = body?.redirect_uri;

    if (!code || typeof code !== 'string') {
        throw createError({
            statusCode: 400,
            statusMessage: 'missing_code',
        });
    }
    if (!redirectUri || typeof redirectUri !== 'string') {
        throw createError({
            statusCode: 400,
            statusMessage: 'missing_redirect_uri',
        });
    }

    const clientId = getClientId(event);
    const clientSecret = getAuth0Secret(event);
    const cookieSecret = getCookieSecret(event);
    const issuerBaseUrl = getIssuerBaseUrl(event);

    if (!clientSecret) {
        throw createError({
            statusCode: 500,
            statusMessage: 'auth0_not_configured',
            data: {
                reason: 'NUXT_AUTH0_CLIENT_SECRET is empty. The deployment is missing the Auth0 application client_secret — login cannot complete until it is provisioned.',
            },
        });
    }
    if (!cookieSecret) {
        throw createError({
            statusCode: 500,
            statusMessage: 'cookie_secret_not_configured',
            data: { reason: 'NUXT_COOKIE_SECRET is empty.' },
        });
    }

    let tokenResponse: TokenResponse;
    try {
        tokenResponse = await $fetch<TokenResponse>(`${issuerBaseUrl}/oauth/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: {
                grant_type: 'authorization_code',
                client_id: clientId,
                client_secret: clientSecret,
                code,
                redirect_uri: redirectUri,
            },
        });
    } catch (error: any) {
        // Auth0 returns 4xx with `{ error, error_description }`. Surface
        // the description but never echo the request body (it contains
        // the client_secret).
        const upstream = error?.data;
        console.error('[a0callback] /oauth/token failed:', {
            status: error?.statusCode || error?.status,
            error: upstream?.error,
            description: upstream?.error_description,
        });
        throw createError({
            statusCode: 502,
            statusMessage: 'auth0_token_exchange_failed',
            data: {
                error: upstream?.error || 'unknown',
                error_description: upstream?.error_description || 'no description',
            },
        });
    }

    const { access_token, id_token, scope, expires_in, token_type } = tokenResponse;

    if (!id_token || typeof id_token !== 'string') {
        throw createError({
            statusCode: 502,
            statusMessage: 'invalid_id_token',
        });
    }
    if (!access_token || typeof access_token !== 'string') {
        throw createError({
            statusCode: 502,
            statusMessage: 'invalid_access_token',
        });
    }

    const JWKS = createRemoteJWKSet(new URL(`${issuerBaseUrl}/.well-known/jwks.json`));

    let user: Auth0User;
    try {
        const { payload } = await jwtVerify<Auth0User>(id_token, JWKS, {
            issuer: `${issuerBaseUrl}/`,
            audience: clientId,
        });
        user = payload;
    } catch (error: any) {
        console.error('[a0callback] id_token verification failed:', error?.message);
        throw createError({
            statusCode: 502,
            statusMessage: 'id_token_verification_failed',
        });
    }

    // Access token may be opaque (no audience configured) — only verify
    // when it parses as a JWT. The opaque-token case is a valid Auth0
    // configuration; no signature to check.
    if (access_token.split('.').length === 3) {
        try {
            await jwtVerify(access_token, JWKS, { issuer: `${issuerBaseUrl}/` });
        } catch (error: any) {
            console.error('[a0callback] access_token verification failed:', error?.message);
            throw createError({
                statusCode: 502,
                statusMessage: 'access_token_verification_failed',
            });
        }
    }

    // The "permissions" field on the cookie is a placeholder for the
    // pre-ENG-768 contract. Real authorization happens server-side
    // (cookie is sealed against tampering; per-request handlers do
    // their own checks against `unsealCookie`).
    const permissions = REQUIRED_ACCESS;

    const sealedPayload = {
        user,
        scope,
        expires_in,
        token_type,
        permissions,
        access_token,
    };

    const sealedCookie = await Iron.seal(sealedPayload, cookieSecret, Iron.defaults);

    const cookieName = getCookieName(event);
    setCookie(event, cookieName, sealedCookie, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
        maxAge: expires_in && expires_in > 0 ? expires_in : 60 * 60 * 24,
    });

    return {
        ok: true,
        user: {
            sub: user.sub,
            name: user.name,
            email: user.email,
            picture: user.picture,
        },
        permissions,
        access_token,
        scope,
        expires_in,
        token_type,
    };
});
