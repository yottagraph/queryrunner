/**
 * Reactive, persisted **global** (cross-app) preferences for the
 * current user. Global means the values follow this user across
 * every Aether app they touch — language, accessibility settings,
 * timezone, color-blind mode, etc. For per-app prefs, use
 * `useAppPrefs` instead.
 *
 * Returns a deeply reactive object — you read and write properties
 * directly, and any mutation auto-persists (150 ms debounce,
 * flushed on tab close).
 *
 * @example
 *   const globalPrefs = useGlobalPrefs({ language: 'en', reduceMotion: false });
 *   globalPrefs.language = 'es';       // persists across all apps
 *
 *   // <v-select v-model="globalPrefs.language" :items="languages" />
 *
 * @param defaults Schema defaults. Used until the stored doc loads;
 *                 missing keys also fall through to these values
 *                 after load. **Required** — to read the merged root
 *                 without contributing to the schema (e.g. an
 *                 introspection / debug surface), use
 *                 `useGlobalPrefsRoot()` instead.
 *
 * Do NOT destructure the returned object — it's a Vue `reactive()`
 * proxy. Use property access (or `toRefs(globalPrefs)` if needed).
 *
 * Storage: one Firestore doc per user, at `/users/<uid>/state/global`.
 * See `docs/BC_2_PREFS_API.md` in the broadchurch repo.
 */

import { getOrCreatePrefsRoot, seedDefaults } from './_internal/usePrefsRoot';
import type { PrefsDoc } from '~/utils/prefsHttpClient';

export function useGlobalPrefs<T extends object>(defaults: T): T {
    seedDefaults('global', defaults);
    return getOrCreatePrefsRoot('global') as T;
}

/**
 * Get the raw global-scoped prefs root WITHOUT seeding any defaults.
 * Companion to `useAppPrefsRoot` — same purpose, different scope.
 */
export function useGlobalPrefsRoot(): PrefsDoc {
    return getOrCreatePrefsRoot('global');
}
