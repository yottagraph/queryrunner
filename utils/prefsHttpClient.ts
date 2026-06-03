/**
 * Thin HTTP client for the prefs server routes. Doesn't import Vue —
 * pure async functions that talk to `/api/prefs/*`. The composables
 * in `composables/useAppPrefs.ts` (etc.) layer reactivity on top of
 * this.
 *
 * On any failure, calls `recordPrefsError` from `usePrefsState` so the
 * UI-visible `lastError` channel surfaces the failure rather than it
 * disappearing into a swallowed catch. Reads return `null` on failure
 * (callers fall back to defaults); writes don't throw (failure is
 * recorded, in-memory state continues to reflect the user's intent).
 */

import { recordPrefsError } from '~/composables/usePrefsState';

export type PrefsScope = 'app' | 'global';

/** Plain JSON object — the whole-doc shape we read and write. */
export type PrefsDoc = Record<string, unknown>;

interface ServerError {
    ok?: false;
    error?: string;
    message?: string;
    [k: string]: unknown;
}

function extractServerError(err: unknown): ServerError | undefined {
    const data = (err as { data?: ServerError; response?: { _data?: ServerError } })?.data;
    if (data && typeof data === 'object') return data;
    const respData = (err as { response?: { _data?: ServerError } })?.response?._data;
    if (respData && typeof respData === 'object') return respData;
    return undefined;
}

function describeError(err: unknown, defaultCode: string): { code: string; message: string } {
    const server = extractServerError(err);
    if (server?.error) {
        return { code: server.error, message: server.message ?? server.error };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { code: defaultCode, message: msg };
}

/** Read the whole prefs doc for this user + scope. `null` on failure. */
export async function readPrefsDoc(scope: PrefsScope): Promise<PrefsDoc | null> {
    try {
        const result = await $fetch<PrefsDoc | null>('/api/prefs/read', {
            params: { scope },
        });
        if (!result || typeof result !== 'object') return null;
        return result;
    } catch (err) {
        const { code, message } = describeError(err, 'read_failed');
        recordPrefsError({ code, message, op: 'read', scope, cause: err });
        return null;
    }
}

/**
 * Replace the whole prefs doc for this user + scope. Server-side
 * uses `set()` (not `update()`) — the whole doc is overwritten with
 * the supplied state.
 *
 * Whole-doc replacement is deliberate: prefs payloads are KB-scale
 * and a single user has only one session writing at a time (until
 * we add real-time multi-device sync, which is deferred — see
 * `docs/BC_2_PREFS_API.md`). When sync lands we'll switch to
 * field-path merges; until then, simpler is better.
 */
export async function writePrefsDoc(scope: PrefsScope, state: PrefsDoc): Promise<boolean> {
    try {
        await $fetch('/api/prefs/write', {
            method: 'POST',
            body: { scope, state },
        });
        return true;
    } catch (err) {
        const { code, message } = describeError(err, 'write_failed');
        recordPrefsError({ code, message, op: 'write', scope, cause: err });
        return false;
    }
}

/** Delete the whole prefs doc for this user + scope (resets to defaults on next load). */
export async function deletePrefsDoc(scope: PrefsScope): Promise<boolean> {
    try {
        await $fetch('/api/prefs/delete', {
            method: 'POST',
            body: { scope },
        });
        return true;
    } catch (err) {
        const { code, message } = describeError(err, 'delete_failed');
        recordPrefsError({ code, message, op: 'delete', scope, cause: err });
        return false;
    }
}
