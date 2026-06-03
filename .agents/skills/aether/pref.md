# User Preferences

Persist per-user state with a few reactive composables. No path math,
no schemas to register, no separate "load then save" dance — read
and write JavaScript properties on a reactive object and the values
land in storage automatically.

## TL;DR

```ts
// Top-level prefs for this app:
const prefs = useAppPrefs({ nickname: '', fontSize: 14 });
prefs.nickname = 'tob'; // persists (150 ms debounced)

// One feature's prefs, isolated under a subtree. No explicit
// generic needed — the defaults object infers the schema.
const theme = useAppFeaturePrefs('appearance', {
    darkMode: false,
    accent: 'cyber-green' as 'cyber-green' | 'tropical-coral',
});
theme.darkMode = true; // persists

// Cross-app prefs (follow this user into every Aether app):
const i18n = useGlobalPrefs({ language: 'en' });
const a11y = useGlobalFeaturePrefs('accessibility', { reduceMotion: false });

// Status + error surfacing:
const { backend, hydrated, lastError, clearError } = usePrefsStatus();

// Introspection only (no schema — just the raw merged doc):
const appRoot = useAppPrefsRoot();
const globalRoot = useGlobalPrefsRoot();
```

```vue
<v-text-field v-model="prefs.nickname" />
<v-switch v-model="theme.darkMode" />
<v-select v-model="i18n.language" :items="['en', 'es', 'fr']" />
```

That's the whole API. Four typed composables for the data, one for
status, and two introspection-only "give me the raw root" helpers.

**Return-shape convention:** the four data composables and the two
`*PrefsRoot` helpers return Vue `reactive()` proxies — read/write
properties directly (`prefs.nickname = 'tob'`), don't destructure,
don't `.value`. `usePrefsStatus()` is the only composable in this
family that returns `ComputedRef`s — destructure it and use `.value`
in JS, drop `.value` in templates (Vue auto-unwraps top-level refs
in `<template>` bindings).

## When to use which

| You want…                                          | Use                                     |
| -------------------------------------------------- | --------------------------------------- |
| Prefs for THIS app, top-level (no namespace)       | `useAppPrefs(defaults)`                 |
| Prefs for THIS app, isolated under one feature     | `useAppFeaturePrefs(name, defaults)`    |
| Prefs that follow the user across every Aether app | `useGlobalPrefs(defaults)`              |
| Global prefs isolated under one feature            | `useGlobalFeaturePrefs(name, defaults)` |
| Backend status + hydration + most-recent failure   | `usePrefsStatus()`                      |
| Raw app-scope root for introspection / debug UI    | `useAppPrefsRoot()`                     |
| Raw global-scope root for introspection / debug UI | `useGlobalPrefsRoot()`                  |

The cutoff between the two: **`useAppPrefs` / `useGlobalPrefs` is
for ≤ 3 scalar keys that genuinely belong at the top level** (last
search term, current workspace name, preferred language —
sibling-of-everything data that no specific feature owns).
**Everything else goes in `*FeaturePrefs`** with a domain-specific
feature name. Four typed display settings sound shallow but
they're a feature (\"app appearance\") wearing scalar clothing —
namespace them under `useAppFeaturePrefs('appearance', { ... })`
so a future feature that also wants a `font` or `theme` key
doesn't fight for the same top-level slot.

The `*PrefsRoot` helpers exist for one purpose: rendering a live
JSON snapshot of the merged doc in a debug/introspection surface
(the prefs-demo page is the canonical example). They don't
contribute to the schema and they don't seed any defaults — they're
read-only windows onto whatever the typed composables put there.
**Do not** reach for them in feature code; reach for `useAppPrefs(...)`
or `useAppFeaturePrefs(...)`.

## Inference: inline `as` casts, not explicit generics

The composables infer their return type from the defaults object.
**The primary pattern is inline `as` casts at the default value**;
the explicit generic exists only as a narrow escape hatch.

```ts
// Idiomatic — let inference flow. Widen literal unions with inline
// `as` casts; widen empty arrays / collections with `as Type[]`.
const reader = useAppFeaturePrefs('reader', {
    font: 'inter' as 'inter' | 'merriweather' | 'jetbrains-mono',
    lineHeight: 1.5 as 1.2 | 1.5 | 1.8,
    theme: 'system' as 'system' | 'light' | 'dark',
    recentSearches: [] as string[],
});
```

The explicit-generic form is only justified when an inline cast
would be awkward — typically when widening the result type before
the defaults exist (rare). Don't reach for it just because TypeScript
will let you; the redundant generic misleads reviewers into thinking
it's load-bearing.

```ts
// Avoid — the generic just restates the inferred shape.
const theme = useAppFeaturePrefs<AppearancePrefs>('appearance', { ... });
```

For the same reason, the wrapper function that exposes a feature
should NOT annotate its return type:

```ts
// Avoid — restates a type the call site already knows; future
// `ReactivePrefs<T>` branding work (ENG-545) will give us a
// type-system signal that "don't destructure" carries through, and
// pre-annotated wrappers erase that signal at the boundary.
export function useAppearancePrefs(): AppearancePrefs { ... }

// Preferred — let the wrapper return the inferred reactive proxy.
export function useAppearancePrefs() {
    return useAppFeaturePrefs('appearance', { ... });
}
```

Honest caveat: this rule is **currently cosmetic**, not semantic.
The four platform composables themselves return `T` (look at the
signature on `useAppFeaturePrefs<T extends object>(...): T`), so
TypeScript already treats their return value as a plain `T` and a
destructure compiles silently either way. The "don't destructure"
anti-pattern is enforced by Vue's runtime (destructuring a
`reactive()` proxy returns unwrapped scalar copies, not refs) and
by code review, not by the type system today. The wrapper-doesn't-
annotate rule earns its keep once ENG-545 ships a branded
`ReactivePrefs<T>` return type and the platform composables stop
laundering it back to `T`. Until then, the rule is about leaving
the future-branding-friendly shape in your codebase — not about
catching a destructure today.

The same `as` cast pattern applies to `useAppPrefs` and
`useGlobalPrefs` top-level defaults — the §"Worked example" below
uses `useAppFeaturePrefs`, but `useAppPrefs({ theme: 'system' as
'system' | 'light' | 'dark', recentSearches: [] as string[] })`
follows the identical idiom. No structural difference between the
two; the cast-the-default rule is the same.

## The mental model

> **Stored values are trusted at face value.** Your `defaults` are
> TypeScript-only — they tell the compiler what shape your code
> expects. The composables do **not** validate that what came back
> from disk matches the literal union or numeric range you
> declared. A prior schema version's `lineHeight: 1.4` survives a
> later `1.2 | 1.5 | 1.8` narrowing release and silently breaks
> `<v-select>` bindings ("no item matches" → blank field). This is
> a property of every literal-union or numeric-range default, not
> just intentional migrations — see §"Schema migrations" for the
> handful of fixes (most apps don't need them; the literal-union
> case is the only common foot-gun and only fires on narrowing).

Each user has exactly two preference documents:

- An **app-scoped** doc (`useAppPrefs` / `useAppFeaturePrefs`) — values
  follow them within this specific Aether app.
- A **global** doc (`useGlobalPrefs` / `useGlobalFeaturePrefs`) — values
  follow them across every Aether app they use.

Each doc is just a JSON object. Feature composables write into a
property of that object — `useAppFeaturePrefs('appearance', …)` lives
at `appPrefs.appearance` — so the resulting state is greppable and
debuggable. You don't pick paths; the composable owns the layout.

### Feature names are wire-format keys

The `name` argument to `useAppFeaturePrefs` / `useGlobalFeaturePrefs`
is the property key inside the stored doc. It is part of the
on-disk schema, not a presentation label:

- **Pick it once, never rename it.** Renaming `'appearance'` to
  `'theme'` orphans every existing user's stored data — the next
  hydration sees nothing at `appPrefs.theme` and re-seeds defaults,
  while the old `appPrefs.appearance` value sits in storage taking
  up space forever.
- **Namespace it.** Two features both calling
  `useAppFeaturePrefs('settings', …)` will silently coexist (their
  defaults merge non-destructively into whichever called first),
  so generic names like `'settings'`, `'state'`, `'config'` are
  footguns. Prefer `'appearance'`, `'auth-onboarding'`,
  `'filing-tracker'` — names that mean exactly one thing.
- **Even in the global scope, prefer an app-prefixed name** unless
  your feature is genuinely platform-curated cross-app state
  (`'language'`, `'reduceMotion'`, `'theme'` — the small set of
  things every Aether app should agree on). The temptation to
  reach for a generic name like `'notifications'` is strongest in
  global scope because the data IS conceptually cross-app, but
  two unrelated apps each declaring
  `useGlobalFeaturePrefs('notifications', …)` with different
  schemas will collide just as silently. App-prefixed names like
  `'habit-streaks-notifications'` survive that collision; the
  curated cross-app namespace is small and platform-defined for
  exactly the reasons a tenant should hesitate to invent into it.
- **It survives schema evolution within reason.** Adding new keys
  to the defaults object is safe — they show up on next hydration
  for users who don't have them. Changing the _type_ of an existing
  key (e.g. `density: 'compact'` → `density: { mode: 'compact' }`)
  is a schema migration; see the migration note below.

## Worked example

A typical "feature owns its prefs schema" module:

```ts
// features/appearance/prefs.ts
import { useAppFeaturePrefs } from '~/composables/useAppFeaturePrefs';

// Deliberately no return type annotation. `useAppFeaturePrefs<T>`
// returns a Vue `reactive()` proxy, not a plain T; annotating the
// wrapper as `: AppearancePrefs` would erase the reactive nature
// from TypeScript's view and silently let `const { darkMode } = ...`
// through (the very destructuring anti-pattern the next section
// warns about). Let inference flow.
export function useAppearancePrefs() {
    return useAppFeaturePrefs('appearance', {
        darkMode: false,
        accent: 'cyber-green' as 'cyber-green' | 'tropical-coral' | 'arctic-blue',
        density: 'comfortable' as 'comfortable' | 'compact',
    });
}
```

A component consuming it:

```vue
<script setup lang="ts">
    import { useAppearancePrefs } from '~/features/appearance/prefs';

    const appearance = useAppearancePrefs();
</script>

<template>
    <v-switch v-model="appearance.darkMode" label="Dark mode" />
    <v-select
        v-model="appearance.accent"
        :items="['cyber-green', 'tropical-coral', 'arctic-blue']"
        label="Accent color"
    />
    <v-select v-model="appearance.density" :items="['comfortable', 'compact']" label="Density" />
</template>
```

That's the entire shape. No schema registration, no path strings,
no "is the store ready?" branching — components mount, defaults
render, stored values load in async and replace defaults
transparently, mutations persist.

The full runnable demo lives at `pages/prefs-demo.vue` (exercises all
four composables side-by-side with a live snapshot of both scope
docs as JSON, plus a backend + hydration status panel).

### Imports note (auto-import scope)

Nuxt auto-imports modules under `composables/` and `utils/`. The
prefs composables (`useAppPrefs`, `useAppFeaturePrefs`,
`useGlobalPrefs`, `useGlobalFeaturePrefs`, `useAppPrefsRoot`,
`useGlobalPrefsRoot`, `usePrefsStatus`) are all auto-imported.

Modules under `features/` are **not** auto-imported by default. A
feature-prefs module like `features/appearance/prefs.ts` is consumed
by explicit import (`import { useAppearancePrefs } from '~/features/appearance/prefs'`).
That's intentional — feature code is opt-in, and explicit imports
keep "where did this composable come from?" greppable in component
files.

## Write semantics

You can mutate as fast as the user types — the composable batches
for you.

- Each mutation cancels any pending write and reschedules a flush
  for **150 ms later**.
- A burst of mutations within the debounce window coalesces to a
  single POST containing the latest snapshot. Last-value-wins.
- Pending writes flush automatically when the tab closes (via
  `sendBeacon` on `beforeunload`) **and** when the tab is
  backgrounded (via `visibilitychange`, which is the more reliable
  signal on mobile and in switching between PWAs). A fast user
  who tabs away or switches apps before the debounce fires
  doesn't lose the change.
- Each scope (`app`, `global`) has its own in-flight write; the
  two don't block each other.

You don't need to add your own debounce on top. If a specific flow
needs immediate persistence (e.g. just before navigating away), the
in-memory state is already correct — pending writes are flushed on
unload before the navigation completes.

**Array and nested-object mutation works the way Vue's reactivity
already does.** All of these trigger the deep watcher equivalently
— pick whichever reads cleanest:

```ts
const prefs = useQuotesPrefs(); // wraps useAppFeaturePrefs('saved-quotes', { quotes: [] })

prefs.quotes.push({ text, author, addedAt: new Date().toISOString() }); // mutate-in-place
prefs.quotes.splice(idx, 1); // mutate-in-place
prefs.quotes = [...prefs.quotes, newOne]; // reassign
prefs.quotes[idx].favourited = true; // nested mutate
prefs.completions[habitId] ??= {}; // nested set
prefs.completions[habitId][isoDate] = true;
```

The persisted snapshot is `structuredClone`'d at flush time so a
post-mutation reference held by your code isn't aliased to the
on-the-wire payload. No need to copy-before-write.

If you genuinely need an explicit pre-navigate flush (not via the
browser unload path), use `flushPendingWrites`. It's auto-imported
in the same way the four `use*Prefs` composables are, so you can
just call it:

```ts
// In a click handler that navigates somewhere:
async function saveAndExit() {
    await flushPendingWrites('app');
    await navigateTo('/somewhere');
}

// In a Vue Router leave guard (catches every exit from this route,
// including back-button and in-tab URL changes):
onBeforeRouteLeave(async () => {
    await flushPendingWrites('app');
});
```

`flushPendingWrites` resolves when the pending write completes (or
immediately, if nothing was pending). Test authors awaiting writes
in Vitest should reach for this — `await nextTick()` does **not**
advance the 150 ms debounce timer (Vue's `nextTick` advances
microtasks, not `setTimeout`), so a test that mutates a pref and
immediately reads disk needs `await flushPendingWrites('app')`.

## Backend status + hydration + error surfacing

The persistence layer reports three things consumers care about:
which backend it's talking to, whether the initial read has merged
yet, and the most recent failure (if any).

### `backend`

| `backend.value` | Meaning                                                                                                                                                                                                                           |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `'loading'`     | Status probe hasn't returned yet (first frame after mount).                                                                                                                                                                       |
| `'firestore'`   | Deployed BC 2.0 tenant — writes go to per-tenant Firestore.                                                                                                                                                                       |
| `'localfs'`     | `npm run dev` — writes go to JSON files under `.aether-dev-prefs/`.                                                                                                                                                               |
| `'kv'`          | BC 1.0 tenant on Upstash Redis. Maintenance-mode; will be retired alongside BC 1.0. New code should still handle the case (the platform hasn't dropped BC 1.0 yet) but treat it as ≡ `'firestore'` for chip color / banner logic. |
| `'none'`        | Nothing is configured. Writes silently drop and a console warning fires.                                                                                                                                                          |

`'none'` shows up exactly when `server/utils/firestore.ts:isEnabled()`
returns `false` (the three Firestore env vars are missing or
`NUXT_PUBLIC_FIRESTORE_ENABLED !== 'true'`) AND the request path
isn't taking the LocalFS fallback (i.e. you're in deploy, not
local dev). In practice that means a production deploy where the
portal didn't inject the Firestore env vars — check those three
env vars on the Vercel project first.

### `hydrated`

`hydrated.value` is `true` when every prefs scope a consumer has
touched has completed its initial read — i.e. real user data is
in memory, not just seeded defaults.

- **`true` from the start** if a status banner mounts before any
  feature uses prefs (there's literally nothing to wait for).
- **`false`** while a scope's `hydrateOnce` is in flight or
  waiting for `userId` to resolve. Typical window is 50-300 ms;
  flips to `true` once the disk doc has merged in.
- **`false`** briefly after a logout/relogin transition while
  the new user's doc is re-hydrating.
- **`false` indefinitely** if `hydrateOnce` times out (30 s)
  waiting for an unauthenticated session to resolve a `userId`.
  Defaults are still in effect — the UI is renderable — but
  `lastError` carries a `'unauthenticated'` code so consumers can
  tell "still loading" apart from "stuck on auth".

The four-state matrix consumers should reason about:

| `hydrated` | `lastError`                  | Meaning                                                                                   |
| :--------: | ---------------------------- | ----------------------------------------------------------------------------------------- |
|   `true`   | `null`                       | Loaded. Real user data is in memory.                                                      |
|   `true`   | non-null                     | Loaded but a recent write failed; current in-memory state may not have round-tripped yet. |
|  `false`   | `null`                       | Still loading. Show a spinner / "Loading…" banner.                                        |
|  `false`   | `code === 'unauthenticated'` | Stuck on auth. Defaults are showing; writes won't persist until login.                    |
|  `false`   | other `code`                 | Hydration is retrying after a transient failure (server error, network blip).             |

Use `hydrated` to gate "first paint with real data" loading
states. Don't use it to decide whether to render the UI at all —
the composables always provide defaults, so the UI is always
renderable.

**One sequencing subtlety to know about.** If a status banner (a
component that consumes `usePrefsStatus()` and renders something
based on `hydrated`) mounts and paints in a render pass that runs
BEFORE the page's feature consumers have called any
`use*Prefs(...)` composable, the banner sees `hydrated: true` —
correctly, because no scope is loading anything yet. As soon as a
feature consumer runs (in a sibling, a child, or a later render
pass), the scope flips to `'hydrating'` and the banner's
`hydrated` recomputes to `false` for the load window, then back to
`true`. The user sees a brief `true → false → true` flash.

This is honest behaviour (the system genuinely transitions through
those states), but it's UX-ugly if the banner is at the page root.
Two ways to avoid the flash:

1. **Preferred — mount the status banner deeper in the tree** so
   it always paints AFTER the feature consumers it observes.
   (Common pattern: the banner is a child of a layout component
   whose parent has already called `useAppPrefs(...)`.) This
   keeps the banner visible during the healthy steady state,
   which is what most users actually want from a status footer.
2. Guard the banner with `v-if="!hydrated || lastError"` so it
   only ever appears in non-ready states. This hides the chips
   during the happy path, which is a different contract from #1
   — pick it only when "everything's fine" should mean "no
   footer at all". Renders nothing on the `true → false → true`
   transition because the first `true` passes the guard but
   renders empty.

### `lastError`

`lastError.value` is the most recent persistence failure (or
`null`). The shape:

```ts
interface PrefsErrorRecord {
    /**
     * Stable code. Common values: 'invalid_request', 'unauthorized',
     * 'no_backend', 'write_failed', 'read_failed', 'delete_failed',
     * 'flush_failed', 'unauthenticated', 'schema_type_conflict'.
     *
     * Open-ended: the list above is non-exhaustive. The server can
     * surface its own codes (e.g. 'rate_limited', 'quota_exceeded')
     * and the HTTP client passes them through unchanged. Status
     * footers that want a friendly label per code should fall back
     * to rendering the raw code (or a generic "preferences last
     * failed to {op}" message) for unknown values rather than
     * silently swallowing them.
     */
    code: string;
    message: string;
    op: 'read' | 'write' | 'delete';
    /**
     * Routing label — which scope the failed op targeted. NOT a
     * severity tier. Both transient ('write_failed' from a network
     * blip) and structural ('schema_type_conflict' from a stored
     * value of the wrong shape) errors populate it the same way.
     */
    scope?: 'app' | 'global';
    cause?: unknown;
    /** Epoch ms when the error was observed. */
    at?: number;
}
```

In dev mode, errors are also re-logged via `console.error` with the
full record so they're visible without watching the ref.

A typical "show a banner when prefs are broken or still loading"
pattern, following the four-state matrix above:

```vue
<script setup lang="ts">
    const { backend, hydrated, lastError, clearError } = usePrefsStatus();
</script>

<template>
    <v-alert v-if="backend === 'none'" type="error">
        Preferences aren't persisting. Contact your administrator.
    </v-alert>
    <v-alert v-else-if="!hydrated && lastError?.code === 'unauthenticated'" type="warning">
        Not signed in — defaults are showing; writes won't persist.
    </v-alert>
    <v-alert v-else-if="!hydrated && backend !== 'loading'" type="info">
        Loading your preferences…
    </v-alert>
    <v-alert
        v-if="lastError && lastError.code !== 'unauthenticated'"
        type="warning"
        closable
        @click:close="clearError"
    >
        Preferences last failed to {{ lastError.op }}: {{ lastError.message }}
    </v-alert>
</template>
```

**Alert-type matrix.** The four states map to exactly four alert
types. Memorise this so every status footer in the codebase agrees:

| Condition                                           | Alert type | Why                                                                                            |
| --------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------- |
| `backend === 'none'`                                | `error`    | Writes are dropped. The user needs to know.                                                    |
| `!hydrated && lastError.code === 'unauthenticated'` | `warning`  | Recoverable: signing in repairs the state. Not red.                                            |
| `!hydrated && backend !== 'loading'`                | `info`     | Active load. Transient.                                                                        |
| `lastError && code !== 'unauthenticated'`           | `warning`  | The last attempt failed but the system isn't permanently broken. **Never `error`.** See below. |

The "never `error` for `lastError`" rule is the load-bearing
opinion. A transient network blip rendered as a red banner pushes
users toward refreshing the page or filing a bug, when the right
action is "wait two seconds and try again" — the next mutation
will retry the write. `warning` matches the actual severity
(recoverable). The `lastError.code !== 'unauthenticated'` filter
on the last row avoids stacking two banners for the same condition
(the second row already handles unauthenticated).

## Verifying a prefs feature actually persists

Edge cases hide between "the field changed in the UI" and "the byte
landed in the right place". Verify all six:

1. **In-memory reactivity** — mutate the value (typing, clicking
   the switch). The bound UI element should update synchronously.
   If it doesn't, you probably destructured the composable's return
   value somewhere — see "Anti-patterns" below.

2. **Network write** — open DevTools → Network and confirm that
   after ~150 ms of inactivity you see a `POST /api/prefs/write`
   with `{"scope": "...", "state": {...}}` and a 2xx response.

3. **Re-hydration** — refresh the page. The value should still be
   present when the page mounts. If it briefly shows the default
   and then snaps to the stored value, that's expected — it's the
   async hydration race; harmless for normal use.

4. **`backend` is healthy** — `usePrefsStatus().backend.value`
   should be `'firestore'` or `'localfs'`, never `'none'`.

5. **`hydrated` flips to `true`** — `usePrefsStatus().hydrated.value`
   should be `true` within ≤ 500 ms of page mount (faster on
   `localfs`; slower if `userId` is mid-auth). If it sits at
   `false` for >5 s, check `lastError` — you're probably staring
   at an `'unauthenticated'` timeout.

6. **No `lastError`** — `usePrefsStatus().lastError.value` should
   be `null`. If it's set, fix that before assuming the feature
   works.

If all six check out, persistence is working.

## Anti-patterns

The composables return reactive objects (not refs). One footgun
matters; the rest are inherited from Vue's reactivity model.

### Don't destructure the return value

```ts
// BROKEN — destructuring a reactive() proxy returns plain values
const { nickname } = useAppPrefs({ nickname: '' });
nickname = 'tob'; // doesn't even compile (const), and even with let
// it wouldn't trigger reactivity or persist

// CORRECT — keep the proxy reference and access properties
const prefs = useAppPrefs({ nickname: '' });
prefs.nickname = 'tob';
```

If you really need refs (e.g. to pass a single field around), use
`toRefs`:

```ts
import { toRefs } from 'vue';

const prefs = useAppPrefs({ nickname: '' });
const { nickname } = toRefs(prefs);
// `nickname` is now a writable Ref<string>; mutating .value persists
```

### Don't construct paths yourself

There's no need to know that prefs live at `/users/<uid>/state/app`
or `/users/<uid>/state/global`. The composables own this layout
entirely; if you're reaching for `$fetch('/api/prefs/read?...')`
or constructing a Firestore path manually, you're working around
the API instead of with it.

### Don't pick conflicting feature names

`useAppFeaturePrefs('settings', defaultsA)` and
`useAppFeaturePrefs('settings', defaultsB)` both write to
`appPrefs.settings` and will coexist (defaults merge
non-destructively into whichever called first). Distinct, namespaced
names per feature avoid surprise mixing:

- Good: `'appearance'`, `'auth-onboarding'`, `'filing-tracker'`
- Bad: `'settings'`, `'state'`, `'data'`

### Don't collide a top-level key with a feature name

A subtler version of the collision above: `useAppPrefs({ appearance: 'red' })`
declares a top-level scalar at `appPrefs.appearance`, while
`useAppFeaturePrefs('appearance', { darkMode, accent })` expects an
object at the same key. The composables share a single root per
scope, so these two calls fight for `appPrefs.appearance` — whichever
runs first wins the type, and the other surfaces a
`'schema_type_conflict'` `lastError`. Either:

1. Keep top-level scalars (`useAppPrefs`) for genuinely scalar
   things (`lastSearch: ''`, `workspaceName: ''`) and reserve
   subtree keys (`useAppFeaturePrefs(name, ...)`) for everything
   structured, OR
2. Pick distinct names — `useAppPrefs({ appearanceAccent: 'red' })`
   plus `useAppFeaturePrefs('appearance', ...)` don't collide.

### Don't rename a feature without migrating

The feature name is the property key in the stored doc. Renaming
`useAppFeaturePrefs('appearance', …)` to
`useAppFeaturePrefs('theme', …)` orphans every existing user's
stored data — they re-seed defaults under the new key while the
old key sits in storage. If you genuinely need to rename, either:

1. Live with the data loss (announce it; users re-customise once).
2. Use the escape-hatch API to read the old doc, transform it, and
   write back under the new name before any consumer calls
   `useAppFeaturePrefs('theme', …)` for the first time.

### Don't use the prefs doc as bulk storage

Prefs payloads are KB-scale. Don't stuff arbitrary user content
(uploaded files, chat history, large arrays of records) into a
prefs doc — there's a 1 MB hard cap per scope per user, and even
well below that you're slowing every read and write of every other
pref on the same doc. For bulk per-user data, use Cloud SQL or GCS.

## Schema migrations

The API supports two kinds of schema evolution out of the box, and
flags a third as a recoverable error.

**Stored values are trusted at face value** — see the callout
under §"The mental model" for the canonical explanation and the
literal-union foot-gun (a `lineHeight: 1.4` left over from a prior
schema survives a `1.2 | 1.5 | 1.8` narrowing release). The
mitigation if you care is a coerce-to-default step in your
wrapper function; built-in runtime validation is on the deferred
list (ENG-545).

| Change you want                               | What happens                                                                                                                                                                                                                                                |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add a key to the defaults object              | Existing users get the new default on next hydration; persisted on next mutation. No code needed.                                                                                                                                                           |
| Widen a literal type (`'a' \| 'b'` → `+ 'c'`) | New literal accepted on next mutation. Existing values continue to read fine.                                                                                                                                                                               |
| Remove a key from the defaults                | Stored value persists forever in the doc (the composable doesn't prune unknown keys). To clean up, do an offline migration via the escape-hatch route, or `useAppPrefsRoot()` + `delete root.removedKey` + wait for the next debounce write.                |
| Change the _type_ of an existing key          | If the new defaults expect an object at a key where storage has a scalar/array, `seedFeatureDefaults` overwrites with the new defaults and surfaces a `schema_type_conflict` through `lastError`. The prior value is lost. For atomic migration, see below. |

For an atomic schema migration (you want to rename, restructure, or
change a stored value's shape without losing data), do it through
the escape-hatch route before any consumer calls the prefs
composable for the first time:

```ts
// Run once at app boot, before any useAppFeaturePrefs(...) call.
const raw = await $fetch<Record<string, unknown>>('/api/prefs/read?scope=app');
if (raw && typeof raw.appearance === 'string') {
    // Old shape: appearance was a single accent string.
    // New shape: appearance is an object with darkMode + accent.
    await $fetch('/api/prefs/write', {
        method: 'POST',
        body: {
            scope: 'app',
            state: {
                ...raw,
                appearance: { darkMode: false, accent: raw.appearance },
            },
        },
    });
}
```

After the migration runs, the normal `useAppFeaturePrefs('appearance',
{ darkMode, accent })` call sees the new shape and proceeds as if
it had always been there.

## Direct API (escape hatch)

The composables cover essentially every prefs use case. If you have
a genuine need to talk to the routes directly — schema migration,
introspection from outside Vue, server-side scripts — the routes
are:

```ts
// GET /api/prefs/read?scope=app|global
//   → returns { ...wholeDoc } or {} when empty
// POST /api/prefs/write
//   body: { scope: 'app'|'global', state: {...} }
//   → replaces the whole doc
// POST /api/prefs/delete
//   body: { scope: 'app'|'global' }
//   → deletes the doc (next read returns {})
// GET /api/prefs/status
//   → { available: boolean, backend: 'firestore'|'localfs'|'none' }
```

All four return structured errors (`{ ok: false, error, message }`)
with appropriate HTTP statuses — 400 for malformed inputs, 401 for
missing auth, 503 for no-backend.

## Architecture and rationale

Per-user state lives in **one Firestore doc per user per scope** —
`/users/<uid>/state/app` and `/users/<uid>/state/global`. The four
composables wrap each doc as a deeply reactive object backed by an
auto-debounced write loop. Feature composables (`use*FeaturePrefs`)
expose a subtree of the same underlying object so multiple features
share one read and one write per scope per session.

Hydration uses a **recursive merge** that overlays disk values onto
in-memory defaults without replacing subtree references — a
component holding a `useAppearancePrefs()` reference from before
the disk read keeps the same reactive proxy and sees disk values
appear in its bound fields automatically. A logout/relogin
transition resets every scope so user B never sees user A's cached
prefs; and a slow initial sign-in (`>30 s` from app load to first
authenticated request) also re-triggers hydration for any scope
that wedged on the unauthenticated-timeout path.

**The `composables/_internal/usePrefsRoot.ts` placement is
type-level enforcement, not build-level.** Nuxt's auto-import scan
is configured (via `nuxt.config.ts` `imports:dirs` hook) to skip
any directory containing `_internal`, so a bare reference to
`seedFeatureDefaults(...)` in a tenant component will trip
`nuxi typecheck` (`TS2304: Cannot find name`) and your IDE's
squiggles. **But `nuxt build` does not typecheck by default** —
the bad reference compiles to a `ReferenceError` at runtime.
Wire `nuxi typecheck` into CI (or run it in your pre-commit hook)
if you want a build-time guarantee. Same caveat applies to any
`_internal/` subdirectory you create inside your own tenant
features.

The defaults you pass to `useAppPrefs` / `useAppFeaturePrefs` /
etc. are `structuredClone`'d before insertion into the live root,
so two callers passing structurally-similar defaults don't alias
each other's mutable state. **Constraint:** defaults must be
JSON-serializable. `Date`, `Map`, `Set`, `RegExp`, class
instances, and functions don't survive the round-trip — they
either throw at clone time or land as plain objects on the other
side. This matches the wire format (JSON-only) so it's not a
limitation to lift; just pass primitives, plain objects, and
arrays. If you need a `Date`, store it as an ISO string and
parse on read.

The design rationale (including the two earlier API iterations that
got rewritten, and why this one is structurally immune to their
failure modes) is captured in
[`docs/BC_2_PREFS_API.md`](https://github.com/Lovelace-AI/broadchurch/blob/main/docs/BC_2_PREFS_API.md)
in the broadchurch repo. Read that if you're thinking about
extending the API surface.
