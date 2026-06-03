import { unsealCookie } from '../../utils/cookies';
import { getFirestoreDb, shouldUseLocalFsFallback } from '../../utils/firestore';
import { localFsWriteDoc, prefsDocPath } from '../../utils/localFsPrefsStore';

/**
 * POST /api/prefs/write
 * Body: { scope: 'app' | 'global', state: PrefsDoc }
 *
 * Replaces the user's prefs doc for `scope` with `state`. Uses
 * Firestore's `set(state)` (NOT `update`) — whole-doc replacement
 * is the contract; the composables hold the canonical in-memory copy
 * and POST the full snapshot each debounced flush.
 *
 * Why whole-doc replace instead of field-path merge:
 * - Single-tab, single-session writes don't have concurrency to
 *   worry about (multi-device sync is deferred — see
 *   `docs/BC_2_PREFS_API.md`).
 * - The client always holds the full intended state, so there's no
 *   "merge with whatever the server has" semantics that could
 *   surprise either side.
 * - Removing keys (`delete prefs.foo`) just works without a separate
 *   `FieldValue.delete()` codepath.
 *
 * When multi-device real-time sync lands, this route will switch to
 * a field-path merge with `state` being a flat `{ 'a.b.c': value }`
 * map. Until then, simpler wins.
 */
export default defineEventHandler(async (event) => {
    const body = await readBody<{ scope?: unknown; state?: unknown }>(event);
    const scope = body?.scope === 'global' ? 'global' : body?.scope === 'app' ? 'app' : null;
    if (!scope) {
        setResponseStatus(event, 400);
        return {
            ok: false,
            error: 'invalid_scope',
            message: "scope must be 'app' or 'global'",
        };
    }
    if (!body?.state || typeof body.state !== 'object' || Array.isArray(body.state)) {
        setResponseStatus(event, 400);
        return {
            ok: false,
            error: 'invalid_state',
            message: 'state must be a JSON object',
        };
    }

    const cookieInfo = await unsealCookie(event);
    const userId = cookieInfo?.user?.sub;
    if (!userId || typeof userId !== 'string') {
        setResponseStatus(event, 401);
        return { ok: false, error: 'unauthorized', message: 'no auth cookie' };
    }
    const docPath = prefsDocPath(userId, scope);
    const state = body.state as Record<string, unknown>;

    const db = getFirestoreDb();
    if (db) {
        await db.doc(docPath).set(state);
        return { ok: true };
    }

    if (shouldUseLocalFsFallback()) {
        localFsWriteDoc(docPath, state);
        return { ok: true };
    }

    setResponseStatus(event, 503);
    return {
        ok: false,
        error: 'no_backend',
        message:
            'No prefs backend is configured. In production, set NUXT_PUBLIC_FIRESTORE_ENABLED ' +
            '+ NUXT_FIRESTORE_SA_KEY + NUXT_PUBLIC_FIRESTORE_PROJECT_ID.',
    };
});
