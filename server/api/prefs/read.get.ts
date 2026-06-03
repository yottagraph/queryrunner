import { unsealCookie } from '../../utils/cookies';
import { getFirestoreDb, shouldUseLocalFsFallback } from '../../utils/firestore';
import { localFsReadDoc, prefsDocPath } from '../../utils/localFsPrefsStore';

/**
 * GET /api/prefs/read?scope=app|global
 *
 * Returns the user's prefs doc for the given scope as a JSON object,
 * or `{}` when nothing's persisted yet. Returns `null` only when no
 * backend is configured (the client falls back to defaults).
 *
 * The client never specifies a path — `scope` is the only routing
 * input. The route reads from `/users/<uid>/state/<scope>`, which
 * means there's no opportunity for a malformed path to escape the
 * prefs tree.
 *
 * See `docs/BC_2_PREFS_API.md` in the broadchurch repo for the
 * one-doc-per-user-per-scope design rationale.
 */
export default defineEventHandler(async (event) => {
    const query = getQuery(event);
    const scope = query.scope === 'global' ? 'global' : query.scope === 'app' ? 'app' : null;
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
        const snap = await db.doc(docPath).get();
        if (!snap.exists) return {};
        return snap.data() || {};
    }

    if (shouldUseLocalFsFallback()) {
        return localFsReadDoc(docPath) ?? {};
    }

    return null;
});
