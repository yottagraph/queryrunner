/**
 * Reactive, persisted preferences for one feature in the **global**
 * (cross-app) scope. Companion to `useAppFeaturePrefs` — same shape,
 * but the underlying doc is the user's global prefs doc, so values
 * follow them across every Aether app they touch.
 *
 * Use for: theme preferences, language, accessibility settings,
 * timezone — anything where "Aether app A and Aether app B should
 * agree" is the desired behaviour. For per-app prefs use
 * `useAppFeaturePrefs`.
 *
 * @example
 *   // features/accessibility/prefs.ts
 *   export function useAccessibilityPrefs() {
 *       return useGlobalFeaturePrefs('accessibility', {
 *           reduceMotion: false,
 *           highContrast: false,
 *           fontScale: 1.0,
 *       });
 *   }
 *
 * @param name      Feature name. Becomes the doc property key.
 * @param defaults  Schema defaults for this feature.
 *
 * Do NOT destructure the returned object — it's a Vue `reactive()`
 * subtree. Use property access (or `toRefs(...)` if needed).
 */

import { seedFeatureDefaults } from './_internal/usePrefsRoot';

export function useGlobalFeaturePrefs<T extends object>(name: string, defaults: T): T {
    if (!name || typeof name !== 'string') {
        throw new Error('[useGlobalFeaturePrefs] name must be a non-empty string');
    }
    return seedFeatureDefaults('global', name, defaults);
}
