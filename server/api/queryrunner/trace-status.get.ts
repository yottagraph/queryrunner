/**
 * Report whether persistent (cross-session) trace storage is available.
 *
 *   ready        — Postgres is wired up and the table is reachable.
 *   unconfigured — no Postgres on this tenant (traces live only in-session).
 *   warming-up   — Postgres is configured but the instance isn't reachable yet.
 */
import { traceStorageState } from '~/server/utils/queryTraceStore';
import { dbMode } from '~/server/utils/db';

export default defineEventHandler(async () => {
    const state = await traceStorageState();
    return { state, mode: dbMode() };
});
