/**
 * Example feature-prefs schema for the prefs demo page (ENG-534).
 *
 * Shows the canonical shape of a feature-prefs module: one composable
 * per feature, defaults declared inline, returned via
 * `useAppFeaturePrefs(name, defaults)`. The returned object is
 * deeply reactive — components import the composable and bind
 * properties directly with `v-model`.
 *
 * Note: the wrapper deliberately doesn't annotate a return type.
 * `useAppFeaturePrefs<T>(name, defaults): T` returns a Vue
 * `reactive()` proxy, not a plain `T`; annotating the wrapper as
 * `: DemoPrefs` erases the reactive nature from TypeScript's view
 * and lets destructuring through silently — exactly the anti-pattern
 * the prefs skill warns against. Let inference flow.
 *
 * Copy this file's shape when adding prefs to a new feature.
 */

import { useAppFeaturePrefs } from '~/composables/useAppFeaturePrefs';

export function useDemoPrefs() {
    return useAppFeaturePrefs('_prefs_demo', {
        nickname: '',
        darkModeBias: false,
        fontSize: 14,
        favoriteTags: [] as string[],
    });
}
