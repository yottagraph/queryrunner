/**
 * Reactive, persisted preferences for one feature within the
 * current app. Returns a reactive subtree of the app-prefs root
 * (`useAppPrefs()`), pre-seeded with the feature's defaults.
 *
 * Mutations flow up to the same single Firestore doc as
 * `useAppPrefs`; the feature name is just a property key inside
 * that doc. Two features with the same `name` would silently
 * coexist (defaults merge non-destructively into whichever called
 * first) — always a footgun, never useful. Pick distinct,
 * namespaced names per feature (e.g. `'appearance'`,
 * `'auth-onboarding'`, `'workspace-prefs'`). Renaming a feature
 * after shipping orphans every existing user's stored data, so
 * pick the name once and live with it.
 *
 * Convention: kebab-case the feature-folder name (`'health-settings'`,
 * `'appearance'`). Leading underscores (e.g. `'_prefs_demo'`) are a
 * demo/example marker only — don't use them for real features. The same
 * `name` from two call sites (e.g. a settings page and a dashboard card)
 * intentionally shares one reactive doc subtree — that's how you keep a
 * feature's prefs in sync across components.
 *
 * @example
 *   // features/appearance/prefs.ts
 *   export function useAppearancePrefs() {
 *       return useAppFeaturePrefs('appearance', {
 *           darkMode: false,
 *           accent: 'cyber-green' as AccentColor,
 *           density: 'comfortable' as Density,
 *       });
 *   }
 *
 *   // components/SettingsPanel.vue
 *   const appearance = useAppearancePrefs();
 *   // <v-switch v-model="appearance.darkMode" />
 *
 * @param name      Feature name. Becomes the doc property key. Must
 *                  be unique per feature.
 * @param defaults  Schema defaults for this feature. Required so
 *                  type inference flows through the return type.
 *
 * Do NOT destructure the returned object — it's a Vue `reactive()`
 * subtree. Use property access (or `toRefs(...)` if needed).
 *
 * For values that should follow the user across every Aether app,
 * use `useGlobalFeaturePrefs` instead.
 */

import { seedFeatureDefaults } from './_internal/usePrefsRoot';

export function useAppFeaturePrefs<T extends object>(name: string, defaults: T): T {
    if (!name || typeof name !== 'string') {
        throw new Error('[useAppFeaturePrefs] name must be a non-empty string');
    }
    return seedFeatureDefaults('app', name, defaults);
}
