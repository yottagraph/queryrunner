/**
 * Reactive, persisted **app-scoped** preferences for the current
 * user. App-scoped means the values follow this user within this
 * specific Aether app (the `appId` in `broadchurch.yaml` /
 * `NUXT_PUBLIC_APP_ID`); use `useGlobalPrefs` for values that should
 * follow the user across every Aether app they touch.
 *
 * Returns a deeply reactive object — you read and write properties
 * directly, and any mutation auto-persists (150 ms debounce, flushed
 * on tab close).
 *
 * @example
 *   // Top-level prefs without a feature namespace:
 *   const prefs = useAppPrefs({ nickname: '', fontSize: 14 });
 *   prefs.nickname = 'tob';        // persists
 *   prefs.fontSize = 16;           // persists
 *
 *   // Template binding works without `.value`:
 *   // <v-text-field v-model="prefs.nickname" />
 *
 *   // Multiple call sites can each declare their slice of defaults.
 *   // Defaults from any one call seed the root non-destructively
 *   // (existing keys win), so cross-component coordination isn't needed.
 *
 *   // For per-feature isolation, prefer `useAppFeaturePrefs`.
 *
 * @param defaults Schema defaults. Used until the stored doc loads;
 *                 missing keys also fall through to these values
 *                 after load. **Required** — declaring defaults at
 *                 the call site is what makes the API self-documenting.
 *                 To read the merged root without contributing to
 *                 the schema (e.g. an introspection / debug surface),
 *                 use `useAppPrefsRoot()` instead.
 *
 * Do NOT destructure the returned object — it's a Vue `reactive()`
 * proxy, and destructuring breaks reactivity. Use property access
 * (or `toRefs(prefs)` if you really need refs).
 *
 * Storage: one Firestore doc per user, at `/users/<uid>/state/app`.
 * Don't construct that path yourself; the composable handles it.
 * See `docs/BC_2_PREFS_API.md` in the broadchurch repo for the
 * full design.
 */

import { getOrCreatePrefsRoot, seedDefaults } from './_internal/usePrefsRoot';
import type { PrefsDoc } from '~/utils/prefsHttpClient';

export function useAppPrefs<T extends object>(defaults: T): T {
    seedDefaults('app', defaults);
    return getOrCreatePrefsRoot('app') as T;
}

/**
 * Get the raw app-scoped prefs root WITHOUT seeding any defaults.
 * Intended for introspection / debug surfaces that want to render
 * the merged snapshot, not for normal consumers (use `useAppPrefs`
 * with a defaults object for those).
 *
 * Returns the same deeply-reactive `Record<string, unknown>` that
 * every `useAppPrefs(defaults)` / `useAppFeaturePrefs(...)` call
 * mutates, so a `<pre>{{ JSON.stringify(root, null, 2) }}</pre>`
 * binding updates live as users edit any feature's prefs anywhere
 * else in the page.
 */
export function useAppPrefsRoot(): PrefsDoc {
    return getOrCreatePrefsRoot('app');
}
