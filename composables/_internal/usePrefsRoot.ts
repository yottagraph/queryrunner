/**
 * Internal: shared bootstrap + auto-persist machinery for the prefs
 * scope roots.
 *
 * Lives in `composables/_internal/` so Nuxt's auto-import scan
 * (configured in `nuxt.config.ts` `imports:dirs` hook) skips it. The
 * public surface is the four typed composables
 * (`useAppPrefs`, `useGlobalPrefs`, `useAppFeaturePrefs`,
 * `useGlobalFeaturePrefs`) plus their `*PrefsRoot()` introspection
 * companions and the `flushPendingWrites` escape hatch (re-exported
 * from `composables/flushPendingWrites.ts` for auto-import).
 *
 * **Enforcement is type-level, not build-level.** A bare reference
 * to `seedFeatureDefaults(...)` in a tenant component will trip
 * `nuxi typecheck` (`TS2304: Cannot find name`) and IDE squiggles,
 * but `nuxt build` does NOT run typecheck by default and will
 * compile the bad reference into a `ReferenceError` at runtime. The
 * matching guidance for tenants is `skills/aether/pref.md`
 * §"Architecture and rationale" — wire `nuxi typecheck` into CI if
 * you want a build-time guarantee. The `_internal/` subdirectory
 * placement is the strongest enforcement we have without
 * mandating typecheck-in-build for every tenant app.
 *
 * Each scope (`'app'`, `'global'`) gets exactly one root reactive
 * object per session. The root holds the user's full prefs JSON for
 * that scope; mutations are deep-watched, debounced (150 ms), and
 * persisted as a whole-doc replacement.
 *
 * Why one-doc-per-user-per-scope: see `docs/BC_2_PREFS_API.md` in
 * the broadchurch repo. TL;DR — Vercel-KV-shaped simplicity on top
 * of per-tenant Firestore, no path math, no segment-parity bugs.
 *
 * Why whole-doc replacement instead of field-path merges:
 * single-tab single-session writes don't have concurrency to worry
 * about, and prefs payloads are KB-scale. We'll switch to field-path
 * merges when real-time multi-device sync lands (deferred).
 */

import { effectScope, reactive, watch } from 'vue';

import { useUserState } from '../useUserState';
import {
    ensureBackendProbed,
    markHydrationComplete,
    markHydrationReset,
    markHydrationStarted,
    recordPrefsError,
} from '../usePrefsState';
import {
    readPrefsDoc,
    writePrefsDoc,
    type PrefsDoc,
    type PrefsScope,
} from '~/utils/prefsHttpClient';

const WRITE_DEBOUNCE_MS = 150;

/**
 * How long `hydrateOnce` waits for `userId` to resolve before giving
 * up and surfacing an `unauthenticated` error. Picked to be long
 * enough for slow auth round-trips (typical ≤ 2s) but short enough
 * that a leaked watcher on a perpetually-anonymous session doesn't
 * accumulate. After timeout the scope is marked hydrated (with
 * defaults only); the auth-transition watcher catches the eventual
 * login and triggers a fresh hydration.
 */
const HYDRATE_USERID_TIMEOUT_MS = 30_000;

interface ScopeState {
    /** The reactive root. Returned to consumers; deep-watched for writes. */
    root: PrefsDoc;
    /** `true` once the initial read has merged disk state into `root`. */
    hydrated: boolean;
    /** The effect scope owning the watcher; never disposed. */
    scope: ReturnType<typeof effectScope>;
    /** Pending-write debounce timer. */
    timer: ReturnType<typeof setTimeout> | null;
    /** `true` while a flush is in flight (so unmount-flushes don't pile up). */
    flushing: boolean;
}

const _scopes: Partial<Record<PrefsScope, ScopeState>> = {};

/**
 * Get-or-create the reactive root for a scope. Idempotent.
 *
 * Returns the root immediately, seeded with defaults from any
 * earlier `useAppPrefs(defaults)` calls. Hydration from storage is
 * async and merges on top (overlaying disk values onto in-memory
 * defaults without replacing subtree references — see `hydrateOnce`
 * below).
 *
 * Consumers should not destructure the returned object — it's a Vue
 * `reactive()` proxy, and destructuring breaks reactivity. Use
 * property access (or `toRefs` if you need refs).
 */
export function getOrCreatePrefsRoot(scope: PrefsScope): PrefsDoc {
    ensureAuthTransitionWatcher();
    let state = _scopes[scope];
    if (!state) {
        const effect = effectScope(true);
        state = {
            root: reactive({}) as PrefsDoc,
            hydrated: false,
            scope: effect,
            timer: null,
            flushing: false,
        };
        _scopes[scope] = state;
        bootstrap(scope, state);
    }
    return state.root;
}

/**
 * Seed defaults into a scope root, non-destructively. Existing keys
 * (whether from defaults, disk, or user mutation) are preserved.
 *
 * Called by both `useAppPrefs(defaults)` and `useFeaturePrefs(name,
 * defaults)` (the latter via `seedFeatureDefaults`) so every call
 * site contributes its slice of the schema. Two callers declaring
 * overlapping defaults will see whichever ran first.
 *
 * Each new key is `structuredClone`'d before insertion so that the
 * value the caller passed (a JS literal in their source) isn't
 * shared mutable state with the live reactive root. Without the
 * clone, two components passing structurally-similar defaults like
 * `useAppPrefs({ tags: [] })` would alias the same `[]` until Vue's
 * reactive wrapper kicks in — a narrow window, but symmetric with
 * `seedFeatureDefaults` (which clones for the same reason).
 */
export function seedDefaults<T extends object>(scope: PrefsScope, defaults: T): void {
    const root = getOrCreatePrefsRoot(scope);
    for (const key of Object.keys(defaults) as Array<keyof T & string>) {
        if (!(key in root)) {
            root[key] = structuredClone((defaults as Record<string, unknown>)[key]);
        }
    }
}

/**
 * Seed feature defaults at the `[name]` subtree. Returns the subtree
 * (which is itself reactive — Vue's `reactive()` proxies nested
 * objects transparently).
 *
 * If a value already exists at `root[name]` and it isn't a plain
 * object (e.g. a prior schema stored a scalar there), surface a
 * `schema_type_conflict` through `recordPrefsError` and overwrite
 * with the new defaults. We deliberately don't throw — the alternative
 * is a runtime crash whenever a feature's schema evolves from
 * `string` to `{ ... }`, which is a worse UX than a recorded error
 * plus a working app. If you need atomic schema migration semantics,
 * read the doc directly with the escape-hatch route (see `pref.md`).
 */
export function seedFeatureDefaults<T extends object>(
    scope: PrefsScope,
    name: string,
    defaults: T
): T {
    const root = getOrCreatePrefsRoot(scope);
    const existing = root[name];
    if (isPlainObject(existing)) {
        // Subtree exists (either from a prior call or from disk).
        // Merge missing default keys in non-destructively.
        for (const key of Object.keys(defaults) as Array<keyof T & string>) {
            if (!(key in existing)) {
                existing[key] = (defaults as Record<string, unknown>)[key];
            }
        }
        return existing as unknown as T;
    }
    if (existing !== undefined) {
        // Stored value at `name` is the wrong shape — log + overwrite.
        // The conflict was observed during the post-hydrate seed pass
        // (we read the doc, found `name` populated with a non-object),
        // so the honest `op` is `'read'` even though the recovery
        // action (overwrite-with-defaults) is itself a write. Footers
        // that render `lastError.op` show "schema_type_conflict on
        // read", which matches the user's mental model: "the data we
        // loaded from disk wasn't what the current code expected."
        // Keep `message` short (it gets rendered in single-line status
        // footers and lastError chips); put the diagnostic in `cause`.
        recordPrefsError({
            code: 'schema_type_conflict',
            message: `Feature '${name}' had the wrong shape on disk; overwrote with defaults.`,
            op: 'read',
            scope,
            cause: {
                feature: name,
                priorShape: Array.isArray(existing) ? 'array' : typeof existing,
                priorValue: existing,
                hint: 'For atomic migration, read via the escape-hatch route, transform, and write back before calling this composable.',
            },
        });
    }
    // Fresh subtree — deep-clone defaults so nested objects in the
    // user's schema literal don't become shared mutable state across
    // two callers passing structurally-similar defaults for the same
    // feature name. structuredClone deep-copies; a shallow spread
    // would only protect the top level.
    root[name] = structuredClone(defaults);
    return root[name] as T;
}

/**
 * Bootstrap a scope: lazy-hydrate from storage, install the deep
 * watcher, register the unload-flush handler. Idempotent per scope.
 */
function bootstrap(scope: PrefsScope, state: ScopeState): void {
    void ensureBackendProbed();
    markHydrationStarted(scope);
    state.scope.run(() => {
        void hydrateOnce(scope, state);

        // Watch the root for mutations. Each mutation schedules a
        // debounced whole-doc write.
        watch(
            state.root,
            () => {
                if (!state.hydrated) {
                    // Don't write during the load window — we'd race
                    // the hydration result. `hydrateOnce` only fires
                    // its own post-merge write when there are unsaved
                    // defaults to persist (dirty flag).
                    return;
                }
                scheduleWrite(scope, state);
            },
            { deep: true }
        );
    });

    if (typeof window !== 'undefined') {
        // Flush pending writes when the tab goes away. `sendBeacon`
        // is the right primitive for unload flushes — it's
        // fire-and-forget but reliably enqueued by the browser
        // before the tab closes. Falls through to a normal POST
        // attempt if sendBeacon isn't available.
        const flushOnUnload = () => {
            if (!state.timer && !state.flushing) return;
            if (state.timer) {
                clearTimeout(state.timer);
                state.timer = null;
            }
            const body = JSON.stringify({ scope, state: deepClone(state.root) });
            const sent =
                typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function'
                    ? navigator.sendBeacon(
                          '/api/prefs/write',
                          new Blob([body], { type: 'application/json' })
                      )
                    : false;
            if (!sent) {
                // Best-effort fallback. May not complete before unload.
                void writePrefsDoc(scope, state.root);
            }
        };
        window.addEventListener('beforeunload', flushOnUnload);
        // visibilitychange catches tab-switch / app-switch on mobile,
        // which is the more reliable unload signal in practice.
        window.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') flushOnUnload();
        });
    }
}

/**
 * One-shot read of the user's prefs doc, merging the result into the
 * reactive root. Waits for `userId` (with a hard timeout) before
 * issuing the read.
 *
 * Merge policy: disk values overlay defaults RECURSIVELY without
 * replacing subtree references. That means:
 *
 *   1. A `seedFeatureDefaults('appearance', { darkMode, accent })`
 *      that returned a reactive subtree BEFORE hydration keeps the
 *      same proxy identity AFTER hydration — components holding it
 *      see disk values appear in their bound fields without
 *      remounting.
 *   2. Keys that exist only in defaults (not on disk) are preserved
 *      and persisted by a post-merge write (the "dirty" path).
 *   3. Keys that exist only on disk (not in defaults) are added
 *      verbatim.
 *   4. Arrays and scalars are last-write-wins (disk overwrites).
 *
 * The dirty-flag returned by the merge gates the post-hydrate write:
 * a no-op merge (disk matched defaults exactly) doesn't schedule a
 * round-trip back to the server. Only when defaults need persisting
 * (first-ever load for a feature) do we hit the wire.
 */
async function hydrateOnce(scope: PrefsScope, state: ScopeState): Promise<void> {
    const { userId } = useUserState();
    if (!userId.value) {
        // Wait for userId; the watcher fires once auth resolves.
        // Use an explicit timeout so a perpetually-anonymous session
        // doesn't leak the watcher forever (the pre-fix behaviour).
        let resolved = false;
        const cleanup = () => {
            clearTimeout(timer);
            stop();
        };
        const stop = watch(userId, (uid) => {
            if (!uid || resolved) return;
            resolved = true;
            cleanup();
            void hydrateOnce(scope, state);
        });
        const timer = setTimeout(() => {
            if (resolved) return;
            resolved = true;
            cleanup();
            // The read never happened. Do NOT flip `state.hydrated` or
            // `markHydrationComplete` — that would be a lie:
            // `usePrefsStatus().hydrated` is the consumer's "your data
            // is loaded" signal, and we have only defaults. Record an
            // `unauthenticated` lastError instead so consumers can
            // distinguish "still loading" (hydrated=false, no error)
            // from "stuck on auth" (hydrated=false, lastError.code =
            // 'unauthenticated'). Leaving `state.hydrated = false`
            // also gates the deep-watcher's write path (line ~185),
            // which is correct — we wouldn't want to fire 401 writes
            // for an unauthenticated session.
            //
            // When auth eventually arrives, `ensureAuthTransitionWatcher`
            // catches the userId change and triggers a fresh hydration
            // pass, which will flip `hydrated` true the normal way.
            recordPrefsError({
                code: 'unauthenticated',
                message:
                    `Prefs hydration timed out after ${HYDRATE_USERID_TIMEOUT_MS / 1000}s ` +
                    `waiting for a signed-in user.`,
                op: 'read',
                scope,
            });
        }, HYDRATE_USERID_TIMEOUT_MS);
        return;
    }

    const disk = await readPrefsDoc(scope);
    let dirty = false;
    if (disk) {
        dirty = mergeIntoReactive(state.root as Record<string, unknown>, disk);
    } else {
        // No stored doc yet. If we have any defaults in the root,
        // they need persisting.
        dirty = Object.keys(state.root).length > 0;
    }
    state.hydrated = true;
    markHydrationComplete(scope);
    if (dirty) {
        // In-memory has fields that aren't on disk (newly-seeded
        // defaults). Persist them so the next session sees a populated
        // doc instead of re-seeding from code.
        scheduleWrite(scope, state);
    }
}

/**
 * Recursive merge of `source` onto `target`. Disk-wins for scalars
 * and arrays; for objects, recurse so existing subtree identity is
 * preserved (consumers holding a `useFeaturePrefs(...)` ref don't
 * get their reference orphaned).
 *
 * Returns `true` if `target` ends up with keys not present in
 * `source` — i.e. there are defaults in memory that the server
 * doesn't have yet, and a post-merge write is needed.
 */
function mergeIntoReactive(
    target: Record<string, unknown>,
    source: Record<string, unknown>
): boolean {
    let dirty = false;
    for (const [k, v] of Object.entries(source)) {
        const existing = target[k];
        if (isPlainObject(v) && isPlainObject(existing)) {
            const innerDirty = mergeIntoReactive(existing, v);
            if (innerDirty) dirty = true;
        } else {
            target[k] = v;
        }
    }
    // Detect keys in target that don't exist in source — those are
    // seeded defaults that need persisting.
    for (const k of Object.keys(target)) {
        if (!(k in source)) {
            dirty = true;
            break;
        }
    }
    return dirty;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function scheduleWrite(scope: PrefsScope, state: ScopeState): void {
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(() => {
        void flush(scope, state);
    }, WRITE_DEBOUNCE_MS);
}

async function flush(scope: PrefsScope, state: ScopeState): Promise<void> {
    state.timer = null;
    if (state.flushing) {
        // A concurrent flush is already in flight; reschedule so the
        // latest snapshot wins instead of being skipped.
        scheduleWrite(scope, state);
        return;
    }
    state.flushing = true;
    try {
        // Clone the live reactive object so the network call sees a
        // stable snapshot even if the user keeps typing during the
        // POST.
        await writePrefsDoc(scope, deepClone(state.root));
    } catch (err) {
        // The client already recorded the error through
        // `recordPrefsError`; this catch is defensive in case some
        // exception slips past.
        recordPrefsError({
            code: 'flush_failed',
            message: err instanceof Error ? err.message : String(err),
            op: 'write',
            scope,
            cause: err,
        });
    } finally {
        state.flushing = false;
    }
}

/**
 * Force-flush any pending write for a scope. Returns when the write
 * completes (or immediately if nothing was pending). Useful for
 * "save before navigation" flows where the 150 ms debounce isn't
 * acceptable.
 */
export async function flushPendingWrites(scope: PrefsScope): Promise<void> {
    const state = _scopes[scope];
    if (!state) return;
    if (state.timer) {
        clearTimeout(state.timer);
        state.timer = null;
    }
    await flush(scope, state);
}

/**
 * Reset a scope's root back to empty WITHOUT persisting the reset.
 * The next call to `useAppPrefs(defaults)` / `useFeaturePrefs(name,
 * defaults)` re-seeds defaults on top and `hydrateOnce` re-reads
 * disk under the current `userId`.
 *
 * Called automatically on auth transitions (login / logout / user
 * switch) by `ensureAuthTransitionWatcher` so user B never sees
 * user A's cached prefs — see ENG-542. Also exposed for manual
 * "reset to defaults" UI affordances; in that role, follow up with
 * a `flushPendingWrites` after re-seeding if you want the empty
 * state to round-trip to the server (the current pattern is to
 * call `/api/prefs/delete` directly, which is more honest).
 *
 * Note: any consumer holding a reference to the old subtree (e.g.
 * a component that called `useFeaturePrefs(...)` and mounted before
 * the reset) keeps that orphaned reference and will not see new
 * data. Reset only really makes sense on auth-transition flows
 * where consumers re-mount, or when the app explicitly throws
 * away the relevant UI tree.
 */
export function resetPrefsRoot(scope: PrefsScope): void {
    const state = _scopes[scope];
    if (!state) return;
    if (state.timer) {
        clearTimeout(state.timer);
        state.timer = null;
    }
    for (const key of Object.keys(state.root)) {
        delete state.root[key];
    }
    state.hydrated = false;
    state.flushing = false;
    markHydrationReset(scope);
}

/**
 * Install a one-time watcher on `userId` so that any auth transition
 * (login, logout, user-switch within the same SPA session) resets
 * every prefs scope. Without this, `_scopes[scope]` lives for the
 * lifetime of the module — across logout → relogin — and user B
 * sees user A's cached prefs, then the next mutation by user B
 * overwrites user B's stored doc with user A's stale fields plus
 * user B's change. See ENG-542 for the full failure mode.
 *
 * Installed lazily on first `getOrCreatePrefsRoot` call so that
 * apps which never use prefs don't pay for the watcher.
 */
let _authWatcherInstalled = false;
let _authWatcherScope: ReturnType<typeof effectScope> | null = null;
let _lastUserId: string | undefined = undefined;
function ensureAuthTransitionWatcher(): void {
    if (_authWatcherInstalled) return;
    _authWatcherInstalled = true;
    // Detached effect scope so the watcher's lifetime is the module's
    // lifetime, NOT the lifetime of whichever component happened to
    // be the first to call getOrCreatePrefsRoot. Without this, the
    // first component unmounting would dispose the watcher and leave
    // every subsequent component vulnerable to the cross-user cache
    // leak (ENG-542 #2).
    _authWatcherScope = effectScope(true);
    _authWatcherScope.run(() => {
        const { userId } = useUserState();
        _lastUserId = userId.value;
        watch(userId, (newUid) => {
            const prev = _lastUserId;
            _lastUserId = newUid;
            if (prev === newUid) return;

            // Initial `undefined → uid` is the "user just signed in"
            // case. Normally this isn't a transition a reset would
            // help — the scope hasn't been hydrated yet either way
            // and the inner `watch(userId)` inside `hydrateOnce`
            // will pick up the sign-in and trigger the disk read.
            //
            // EXCEPT — if the sign-in took longer than
            // `HYDRATE_USERID_TIMEOUT_MS` (30 s), that inner watcher
            // has already been disposed by the timeout cleanup. The
            // scope is now wedged at `hydrated: false` with a
            // `lastError.code === 'unauthenticated'` until a full
            // page refresh.  Walk every existing scope and re-trigger
            // hydration on the ones that look wedged (have a state
            // record but never flipped `hydrated`). No reset needed
            // since there's no stale cross-user data to clear — the
            // wedged scope only holds defaults.
            if (prev === undefined) {
                if (!newUid) return;
                for (const scope of Object.keys(_scopes) as PrefsScope[]) {
                    const state = _scopes[scope];
                    if (!state || state.hydrated) continue;
                    state.scope.run(() => {
                        void hydrateOnce(scope, state);
                    });
                }
                return;
            }

            // Identity changed mid-session (logout, login as
            // different user, session swap). Reset every existing
            // scope so user B never sees user A's cached prefs;
            // the re-bootstrap re-hydrates against the new uid.
            for (const scope of Object.keys(_scopes) as PrefsScope[]) {
                const state = _scopes[scope];
                if (!state) continue;
                resetPrefsRoot(scope);
                state.scope.run(() => {
                    void hydrateOnce(scope, state);
                });
            }
        });
    });
}

/**
 * Snapshot the live reactive root into a plain, detached object for
 * the wire.
 *
 * MUST NOT be `structuredClone(obj)`: `obj` here is the Vue
 * `reactive()` root (or a subtree of it), and `structuredClone`
 * throws a `DataCloneError` — "Failed to execute 'structuredClone' on
 * 'Window': #<Object> could not be cloned" — when handed a reactive
 * Proxy. That surfaced as a hard prefs-write failure on the BC 2.0
 * GKE-hosted UI (tide-gcp-006, ENG-775): the very first persist of
 * seeded defaults threw before the POST, so prefs never round-tripped.
 *
 * A JSON round-trip both deep-clones AND unwraps the reactive proxy to
 * the plain object we POST anyway. It's exactly the right tool here
 * because prefs docs are JSON-serializable by contract (see
 * `skills/aether/pref.md` — defaults must be JSON-serializable; no
 * `Date` / `Map` / `Set` / functions / `BigInt` / cycles), so the
 * round-trip is lossless for every legal prefs value.
 */
function deepClone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj)) as T;
}
