/**
 * Auto-imported re-export of the prefs `flushPendingWrites` escape
 * hatch. Lives at the public `composables/` level so Nuxt's
 * auto-import picks it up; the implementation is in
 * `composables/_internal/usePrefsRoot.ts` (skipped by auto-import
 * via the `_internal` filter in `nuxt.config.ts`).
 *
 * Use to force-flush any pending debounced write before navigation
 * or window close. Returns when the write completes (or immediately
 * if nothing was pending).
 *
 *   import { flushPendingWrites } from '#imports'; // auto-imported
 *   // or just use the bare name in a Nuxt context.
 *
 *   await flushPendingWrites('app');
 *   await flushPendingWrites('global');
 *
 * See `.agents/skills/aether/pref.md` §"Write semantics".
 */

export { flushPendingWrites } from './_internal/usePrefsRoot';
