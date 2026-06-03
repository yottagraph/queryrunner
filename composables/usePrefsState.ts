/**
 * Module-scoped state + status for the prefs API.
 *
 * Exposes:
 *   - `usePrefsStatus()` — reactive `backend`, `hydrated`, and
 *     `lastError` plus a `clearError()` helper. The single composable
 *     apps consume for "is persistence working?" / "is the local
 *     reactive state synced with disk?" / "did anything fail
 *     recently?"
 *   - `recordPrefsError()` — internal: called by the HTTP client
 *     when a request fails (and by `usePrefsRoot` for client-side
 *     conditions like unauthenticated-hydration timeout or
 *     schema-type conflicts), so the failure surfaces through
 *     `lastError` instead of disappearing into a swallowed catch.
 *   - `ensureBackendProbed()` — internal: triggers a one-time
 *     `/api/prefs/status` probe so `backend.value` reflects the
 *     real backend instead of `'loading'` forever.
 *   - `markHydrationStarted` / `markHydrationComplete` /
 *     `markHydrationReset` — internal: signal-emitters used by
 *     `usePrefsRoot` so the `hydrated` flag in `usePrefsStatus()`
 *     reflects what's actually happening behind the scenes.
 *
 * No knowledge of paths, scopes, or schema lives here — this file
 * is purely about observability of the store as a whole.
 */

import { computed, reactive, ref, type ComputedRef } from 'vue';

import type { PrefsScope } from '~/utils/prefsHttpClient';

export type PrefsBackend = 'firestore' | 'localfs' | 'kv' | 'none' | 'loading';

export interface PrefsErrorRecord {
    /**
     * Stable machine-readable code. Common values:
     *   - `'invalid_request'`, `'unauthorized'`, `'no_backend'`,
     *     `'write_failed'`, `'read_failed'`, `'delete_failed'`,
     *     `'flush_failed'` — surface from the server / network layer.
     *   - `'unauthenticated'` — surfaced when hydration times out
     *     waiting for a signed-in user (no userId resolved).
     *   - `'schema_type_conflict'` — surfaced when a stored value at
     *     a feature key is the wrong type (e.g. previously a string,
     *     now expected to be an object); the new defaults take over
     *     and the prior value is lost.
     */
    code: string;
    /** Human-readable description. */
    message: string;
    /** Which operation triggered the error. */
    op: 'read' | 'write' | 'delete';
    /**
     * Which prefs scope the operation targeted. Always set today for
     * everything that flows through `recordPrefsError`, but kept
     * optional so a future system-wide error (e.g. backend probe
     * failure) can omit it. `scope` is a routing label, NOT a
     * severity tier — both `unauthenticated` (recoverable) and
     * `write_failed` (transient network blip) populate it.
     */
    scope?: PrefsScope;
    /** Original error / response body, for debug surfaces. */
    cause?: unknown;
    /**
     * Epoch ms when the error was observed. Optional — if omitted,
     * `recordPrefsError` stamps `Date.now()` automatically.
     */
    at?: number;
}

const _backend = ref<PrefsBackend>('loading');
const _lastError = ref<PrefsErrorRecord | null>(null);
let _probed = false;

/**
 * Per-scope hydration state.
 *   - `'untouched'`: no consumer has called `useAppPrefs` / etc. on
 *     this scope yet — there's literally nothing to hydrate.
 *   - `'hydrating'`: a scope has been created and the initial read
 *     is in flight (or waiting for `userId`).
 *   - `'hydrated'`: the initial read has merged into the reactive
 *     root and the scope is participating in normal write debouncing.
 *
 * The `hydrated` computed in `usePrefsStatus()` reports `true` when
 * NO scope is mid-flight — i.e. all touched scopes have completed
 * their initial read. Untouched scopes don't count against
 * hydration; if a status banner mounts before any prefs are used,
 * `hydrated` is already `true` (correctly, because there's nothing
 * to wait for).
 */
const _hydration = reactive<Record<PrefsScope, 'untouched' | 'hydrating' | 'hydrated'>>({
    app: 'untouched',
    global: 'untouched',
});

/** Signal that a scope's initial hydration read has started. */
export function markHydrationStarted(scope: PrefsScope): void {
    _hydration[scope] = 'hydrating';
}

/** Signal that a scope's initial hydration has completed. */
export function markHydrationComplete(scope: PrefsScope): void {
    _hydration[scope] = 'hydrated';
}

/**
 * Signal that a scope was reset (logout/relogin, manual reset).
 * Flips `hydrated` back to `false` until the next read completes.
 */
export function markHydrationReset(scope: PrefsScope): void {
    _hydration[scope] = 'hydrating';
}

/**
 * Record the latest prefs-client failure. Called from
 * `utils/prefsHttpClient.ts` on every HTTP failure, and from
 * `composables/_internal/usePrefsRoot.ts` for client-side conditions. In dev
 * mode, also re-logs via `console.error` (with a stack trace) so the
 * failure shows up in the browser console even if no consumer is
 * watching `lastError`.
 */
export function recordPrefsError(record: PrefsErrorRecord): void {
    _lastError.value = { ...record, at: record.at ?? Date.now() };
    if (process.env.NODE_ENV !== 'production') {
        // Dev should never lie. Logging here in addition to (not
        // instead of) the recorded ref so the line shows up in the
        // browser console with a stack trace pointing at the caller.
        // eslint-disable-next-line no-console
        console.error(
            `[prefs] ${record.op}` + (record.scope ? ` (${record.scope})` : '') + ' failed:',
            record
        );
    }
}

/** Clear the recorded error after a successful retry / recovery. */
export function clearPrefsError(): void {
    _lastError.value = null;
}

/**
 * Probe the backend once per session. Called by the prefs composables
 * on first use; idempotent. Resolves `backend.value` from `'loading'`
 * to one of the concrete states.
 */
export async function ensureBackendProbed(): Promise<void> {
    if (_probed) return;
    _probed = true;
    try {
        const status = await $fetch<{
            available: boolean;
            backend: 'firestore' | 'localfs' | 'none';
        }>('/api/prefs/status');
        _backend.value = status.backend;
        if (!status.available) {
            // eslint-disable-next-line no-console
            console.warn(
                '[prefs] no backend configured — preferences will hold defaults but not persist. ' +
                    'In production, verify NUXT_PUBLIC_FIRESTORE_ENABLED + NUXT_FIRESTORE_SA_KEY. ' +
                    'In dev, the local-FS fallback should activate automatically; check ' +
                    'shouldUseLocalFsFallback() in server/utils/firestore.ts.'
            );
        }
    } catch {
        // Legacy BC 1.0 tenant — fall back to the KV status probe.
        try {
            const kv = await $fetch<{ available: boolean }>('/api/kv/status');
            _backend.value = kv.available ? 'kv' : 'none';
        } catch {
            _backend.value = 'none';
        }
    }
}

/**
 * Reactive backend status + hydration flag + last error. Use this
 * for a status chip in your UI, or to render an alert when writes
 * are failing.
 *
 * @example
 *   const { backend, hydrated, lastError, clearError } = usePrefsStatus();
 *
 *   // <v-chip>{{ backend }}</v-chip>
 *   //
 *   // <v-alert v-if="!hydrated && backend !== 'none'" type="info">
 *   //   Loading your preferences…
 *   // </v-alert>
 *   //
 *   // <v-alert v-if="lastError" type="warning" closable @click:close="clearError">
 *   //   {{ lastError.message }}
 *   // </v-alert>
 *
 * `backend.value` is one of:
 *
 *   - `'loading'`   — before the first status probe completes
 *   - `'firestore'` — deployed BC 2.0 tenant (per-tenant Firestore)
 *   - `'localfs'`   — `npm run dev` fallback (JSON files under .aether-dev-prefs/)
 *   - `'kv'`        — legacy BC 1.0 tenant on Upstash Redis
 *   - `'none'`      — no backend configured; writes are dropped
 *
 * `hydrated.value` is `true` when every prefs scope a consumer has
 * touched has completed its initial read. Defaults to `true` (a
 * status banner that mounts before any prefs are used has nothing
 * to wait for). Flips to `false` while a scope is mid-hydration or
 * after a logout/relogin reset, then back to `true` once the read
 * completes.
 *
 * `lastError.value` is the most recent `PrefsErrorRecord` (or
 * `null`) the client has observed. Survives until the next failure
 * or until `clearError()` is called. `lastError.scope` is a routing
 * label (which scope the failed op targeted) — NOT a severity tier;
 * treat the alert as a warning regardless of which scope it carries.
 */
export function usePrefsStatus(): {
    backend: ComputedRef<PrefsBackend>;
    hydrated: ComputedRef<boolean>;
    lastError: ComputedRef<PrefsErrorRecord | null>;
    clearError: () => void;
} {
    void ensureBackendProbed();
    return {
        backend: computed(() => _backend.value),
        hydrated: computed(
            () => _hydration.app !== 'hydrating' && _hydration.global !== 'hydrating'
        ),
        lastError: computed(() => _lastError.value),
        clearError: clearPrefsError,
    };
}
