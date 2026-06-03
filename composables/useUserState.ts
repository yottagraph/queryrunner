import { ref, readonly } from 'vue';

interface Auth0UserSummary {
    sub?: string;
    name?: string;
    email?: string;
    picture?: string;
}

interface SessionResponse {
    ok: boolean;
    anon?: boolean;
    user?: Auth0UserSummary;
    permissions?: string;
    access_token?: string;
    scope?: string;
    expires_in?: number;
    token_type?: string;
    error?: string;
}

const REQUIRED_ACCESS = 'read:all';

const _accessToken = ref<string | undefined>(undefined);
const _picture = ref<string | undefined>(undefined);
const _permissions = ref('');
const _userId = ref<string | undefined>(undefined);
const _userName = ref<string | undefined>(undefined);
const _signedIn = ref(false);

/**
 * Client-side user state composable.
 *
 * Before ENG-768 this performed the OAuth `code-for-token` exchange,
 * id_token signature verification, and iron-seal cookie wrapping
 * directly in the browser. That required `auth0ClientSecret` and
 * `cookieSecret` in `runtimeConfig.public.*` — i.e. the secrets
 * shipped to anyone who fetched the SPA bundle.
 *
 * The composable now delegates every secret-handling step to the
 * Nitro server:
 *
 *   - `setUserFromAuth0(code)`   → `POST /api/a0callback`
 *   - `setUserFromCookie()`      → `GET  /api/me`
 *   - `clearUser()`              → `POST /api/logout` (+ Auth0 logout redirect)
 *
 * No secrets are ever read on the client. The session cookie is
 * HttpOnly so the browser can't read it directly either; the client
 * holds only the `access_token` (used as a bearer for QS calls) and
 * the public user fields needed by the UI.
 */
export function useUserState() {
    function _applySession(s: SessionResponse) {
        _accessToken.value = s.access_token;
        _permissions.value = s.permissions || (s.anon ? REQUIRED_ACCESS : '');
        _picture.value = s.user?.picture;
        _userId.value = s.user?.sub;
        _userName.value = s.user?.name || s.user?.sub;
        _signedIn.value = Boolean(s.user?.sub);
    }

    function _resetSession() {
        _accessToken.value = undefined;
        _permissions.value = '';
        _picture.value = undefined;
        _userId.value = undefined;
        _userName.value = undefined;
        _signedIn.value = false;
    }

    async function clearUser() {
        console.log('clearUser');
        _resetSession();

        try {
            await $fetch('/api/logout', { method: 'POST' });
        } catch (error) {
            console.error('[useUserState] /api/logout failed:', error);
        }

        const id = useRuntimeConfig().public.auth0ClientId;
        const url = useRuntimeConfig().public.auth0IssuerBaseUrl;
        const redirectUrl = `${useRequestURL().origin}/login`;
        const logoutUrl = `${url}/v2/logout?client_id=${id}&returnTo=${redirectUrl}`;

        await navigateTo(logoutUrl, {
            external: true,
            redirectCode: 302,
        });
    }

    // Called from the `/a0callback` route middleware after Auth0
    // redirects back with `?code=...`. The server-side handler does
    // the code-for-token exchange, signature verification, and cookie
    // sealing; this client method just relays the code and applies
    // the (non-secret) response.
    async function setUserFromAuth0(code: string) {
        console.log('setUserFromAuth0', code);

        const redirectUri = `${useRequestURL().origin}/a0callback`;

        const session = await $fetch<SessionResponse>('/api/a0callback', {
            method: 'POST',
            body: { code, redirect_uri: redirectUri },
        });

        if (!session?.ok || !session.user?.sub) {
            throw new Error('Auth0 callback returned an invalid session');
        }

        _applySession(session);
        return session;
    }

    // Called from `plugins/auth.client.ts` on app boot. The session
    // cookie is HttpOnly, so we can't read it directly — instead we
    // ask the server to unseal it and return the public fields.
    //
    // Return-value contract (preserved from pre-ENG-768):
    //   true  — boot is OK (either a valid session was loaded, or no
    //           cookie was present at all — the watchdog middleware
    //           will redirect to /login for protected routes)
    //   false — a cookie was present but couldn't be decoded (e.g.
    //           the cookie secret rotated). Caller should hard-reset
    //           via the logout path.
    async function setUserFromCookie() {
        let session: SessionResponse | undefined;
        try {
            session = await $fetch<SessionResponse>('/api/me', {
                method: 'GET',
                ignoreResponseError: true,
            });
        } catch (e) {
            console.error(`Failed to load session from /api/me: ${e}`);
            _resetSession();
            return false;
        }

        if (!session) {
            _resetSession();
            return true;
        }

        if (session.ok) {
            _applySession(session);
            return true;
        }

        _resetSession();
        // `no_session` = browser had no cookie; this is the
        // unauthenticated boot path, not an error. Anything else
        // (e.g. `invalid_session`) means the cookie failed to unseal
        // and the caller should force a logout.
        return session.error === 'no_session';
    }

    function setUserFromString(userName: string) {
        console.log('setUserFromString', userName);
        _userId.value = userName;
        _userName.value = userName;
        _permissions.value = REQUIRED_ACCESS;
        _picture.value = undefined;
        _signedIn.value = true;

        const devToken = btoa(
            JSON.stringify({
                sub: userName,
                name: userName,
                iat: Math.floor(Date.now() / 1000),
                exp: Math.floor(Date.now() / 1000) + 86400,
                scope: REQUIRED_ACCESS,
            })
        );
        _accessToken.value = `dev-token-${devToken}`;
    }

    function userIsPermitted() {
        return _permissions.value?.includes(REQUIRED_ACCESS) ?? false;
    }

    return {
        clearUser,
        setUserFromAuth0,
        setUserFromCookie,
        setUserFromString,
        userIsPermitted,
        signedIn: readonly(_signedIn),
        accessToken: readonly(_accessToken),
        userId: readonly(_userId),
        userName: readonly(_userName),
        userPicture: readonly(_picture),
    };
}
