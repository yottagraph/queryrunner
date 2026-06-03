import { getCookieName } from '../utils/cookies';

/**
 * POST /api/logout
 *
 * Clears the sealed-session cookie. The browser is then expected to
 * navigate to Auth0's `v2/logout` endpoint (built from public values
 * client-side, so no server work needed there).
 *
 * Linear: ENG-768.
 */
export default defineEventHandler((event) => {
    const cookieName = getCookieName(event);
    setCookie(event, cookieName, '', {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 0,
    });
    return { ok: true };
});
