/**
 * Fetch one persisted query trace by runId + queryId.
 *
 * Used by the run-detail page to load the full agent/MCP navigation trace on
 * demand (traces are large, so they're fetched per-query when expanded). When
 * Postgres isn't configured this returns `{ trace: null }` and the UI falls
 * back to the inline session trace.
 */
import { getTrace } from '~/server/utils/queryTraceStore';

export default defineEventHandler(async (event) => {
    const q = getQuery(event);
    const runId = String(q.runId ?? '');
    const queryId = String(q.queryId ?? '');
    if (!runId || !queryId) {
        throw createError({ statusCode: 400, statusMessage: 'runId and queryId are required' });
    }
    const trace = await getTrace(runId, queryId);
    return { trace };
});
