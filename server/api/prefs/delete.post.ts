import { unsealCookie } from '../../utils/cookies';
import { getFirestoreDb, shouldUseLocalFsFallback } from '../../utils/firestore';
import { localFsDeleteDoc, prefsDocPath } from '../../utils/localFsPrefsStore';

/**
 * POST /api/prefs/delete
 * Body: { scope: 'app' | 'global' }
 *
 * Deletes the user's prefs doc for the given scope. Used by "reset
 * to defaults" UI affordances. The next `useAppPrefs(defaults)` /
 * `useFeaturePrefs(name, defaults)` call after a delete rehydrates
 * an empty doc and seeds defaults from the call sites' schemas.
 */
export default defineEventHandler(async (event) => {
    const body = await readBody<{ scope?: unknown }>(event);
    const scope = body?.scope === 'global' ? 'global' : body?.scope === 'app' ? 'app' : null;
    if (!scope) {
        setResponseStatus(event, 400);
        return {
            ok: false,
            error: 'invalid_scope',
            message: "scope must be 'app' or 'global'",
        };
    }

    const cookieInfo = await unsealCookie(event);
    const userId = cookieInfo?.user?.sub;
    if (!userId || typeof userId !== 'string') {
        setResponseStatus(event, 401);
        return { ok: false, error: 'unauthorized', message: 'no auth cookie' };
    }
    const docPath = prefsDocPath(userId, scope);

    const db = getFirestoreDb();
    if (db) {
        await db.doc(docPath).delete();
        return { ok: true };
    }

    if (shouldUseLocalFsFallback()) {
        localFsDeleteDoc(docPath);
        return { ok: true };
    }

    setResponseStatus(event, 503);
    return { ok: false, error: 'no_backend', message: 'No prefs backend is configured.' };
});
