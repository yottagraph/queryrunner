import { unsealCookie } from '../utils/cookies';

/**
 * GET /api/me
 *
 * Read side of the ENG-768 server-side auth flow.
 *
 * Returns the unsealed user payload for the current sealed cookie.
 * The cookie is HttpOnly so the browser can't read it directly —
 * `useUserState.setUserFromCookie()` calls this endpoint on every
 * page load to rehydrate the client-side user state.
 *
 * Responses:
 *   200 { ok: true, user, permissions, access_token, ... }  — valid session
 *   200 { ok: true, anon: true }                            — local dev (no Auth0)
 *   401 { ok: false, error: 'no_session' }                  — no cookie
 *   401 { ok: false, error: 'invalid_session' }             — cookie present but unseal failed
 */
export default defineEventHandler(async (event) => {
    let unsealed;
    try {
        unsealed = await unsealCookie(event);
    } catch (error: any) {
        console.warn('[api/me] unseal failed:', error?.message);
        setResponseStatus(event, 401);
        return { ok: false, error: 'invalid_session' };
    }

    if (unsealed === undefined) {
        setResponseStatus(event, 401);
        return { ok: false, error: 'no_session' };
    }

    // Local-dev short-circuit. `unsealCookie` returns a synthetic
    // payload when Auth0 isn't configured (no client_id / no client_secret),
    // mirroring the `NUXT_PUBLIC_USER_NAME` bypass the plugin uses.
    if ('user' in unsealed && unsealed.user && !('access_token' in unsealed)) {
        return {
            ok: true,
            anon: true,
            user: { sub: unsealed.user.sub, name: unsealed.user.sub },
            permissions: 'read:all',
        };
    }

    return {
        ok: true,
        user: {
            sub: unsealed.user?.sub,
            name: unsealed.user?.name,
            email: unsealed.user?.email,
            picture: unsealed.user?.picture,
        },
        permissions: unsealed.permissions,
        access_token: unsealed.access_token,
        scope: unsealed.scope,
        expires_in: unsealed.expires_in,
        token_type: unsealed.token_type,
    };
});
