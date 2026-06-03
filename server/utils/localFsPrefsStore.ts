import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Filesystem-backed fallback prefs store for `npm run dev` (ENG-520
 * + ENG-534 redesign).
 *
 * Persists one JSON file per user per scope under
 * `.aether-dev-prefs/`. The new prefs API keeps exactly one
 * Firestore document per user per scope (`/users/<uid>/state/app`
 * and `/users/<uid>/state/global`); this helper mirrors that
 * layout one-for-one so dev and production behave the same way.
 *
 *   .aether-dev-prefs/users/<uid>/state/app.json
 *   .aether-dev-prefs/users/<uid>/state/global.json
 *
 * Why this exists
 * ---------------
 * BC 2.0 tenants on Vercel get a per-tenant Firestore. The
 * `/api/prefs/*` routes call this helper when Firestore is not
 * configured AND we're not running in a production build — that
 * covers `npm run dev` inside aether-dev so prefs persist across
 * page refreshes without needing a real Firestore credential.
 *
 * Safety
 * ------
 * - Never writes outside `.aether-dev-prefs/` (clamped via `resolve()`
 *   vs the root dir).
 * - Returns `null` rather than throwing on missing files so the
 *   routes behave the same shape as the Firestore implementation.
 *
 * The previous version of this file validated Firestore-style
 * collection/document segment parity on arbitrary paths. That's no
 * longer needed: the routes only ever feed in paths produced by
 * `prefsDocPath()` below, which is structurally a 4-segment doc
 * path by construction. No path validation, no failure modes that
 * dev can hide from production.
 */

const ROOT_DIR = resolve(process.cwd(), '.aether-dev-prefs');

/**
 * The Firestore-style doc path for a given user + scope.
 *
 *   prefsDocPath('alice', 'app')    → 'users/alice/state/app'
 *   prefsDocPath('alice', 'global') → 'users/alice/state/global'
 *
 * Exported so the server routes share one source of truth for the
 * doc layout — there's no "path resolver" in this design beyond
 * this single template.
 */
export function prefsDocPath(userId: string, scope: 'app' | 'global'): string {
    if (!userId || typeof userId !== 'string') {
        throw new Error('[localFsPrefsStore] userId is required');
    }
    // Defensive: Firestore disallows '/' and '..' in path segments,
    // and we don't want a malicious userId to walk the FS tree either.
    if (userId.includes('/') || userId === '.' || userId === '..') {
        throw new Error(`[localFsPrefsStore] invalid userId '${userId}'`);
    }
    return `users/${userId}/state/${scope}`;
}

function safeFileFor(docPath: string): string | null {
    const joined = resolve(ROOT_DIR, `${docPath}.json`);
    // Defence in depth: refuse anything that resolves outside ROOT_DIR.
    if (joined !== ROOT_DIR && !joined.startsWith(ROOT_DIR + '/')) {
        return null;
    }
    return joined;
}

/** Read the prefs doc; returns `null` when missing. */
export function localFsReadDoc(docPath: string): Record<string, unknown> | null {
    const file = safeFileFor(docPath);
    if (!file || !existsSync(file)) return null;
    try {
        return JSON.parse(readFileSync(file, 'utf-8')) as Record<string, unknown>;
    } catch {
        return null;
    }
}

/** Replace the prefs doc with `state`. */
export function localFsWriteDoc(docPath: string, state: Record<string, unknown>): void {
    const file = safeFileFor(docPath);
    if (!file) return;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(state, null, 2));
}

/** Delete the prefs doc. No-op when the file doesn't exist. */
export function localFsDeleteDoc(docPath: string): void {
    const file = safeFileFor(docPath);
    if (!file || !existsSync(file)) return;
    rmSync(file, { force: true });
}
