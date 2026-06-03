/**
 * Full-trace persistence for QueryRunner.
 *
 * Run summaries and lightweight per-query results live in user prefs (small,
 * good for the over-time pass-rate metric). The FULL agent/MCP navigation
 * trace for each query — every tool call, its arguments, and its response —
 * is large and belongs in a real database, so it goes to Postgres here.
 *
 * Everything degrades gracefully: when no Postgres transport is configured
 * (`getDb()` is null) these are no-ops / empty reads, and the live execute
 * response still carries the full trace inline for the current session.
 */
import { getDb, isDbConfigured } from '~/server/utils/db';
import type { QueryTrace } from '~/types/queryrunner';

let _tableReady = false;

async function ensureTable(): Promise<boolean> {
    const sql = getDb();
    if (!sql) return false;
    if (_tableReady) return true;
    await sql`CREATE TABLE IF NOT EXISTS query_traces (
        id BIGSERIAL PRIMARY KEY,
        run_id TEXT NOT NULL,
        query_id TEXT NOT NULL,
        query_name TEXT,
        question TEXT NOT NULL,
        pass BOOLEAN NOT NULL,
        expected TEXT,
        actual TEXT,
        error TEXT,
        duration_ms INTEGER,
        model TEXT,
        hosting TEXT,
        tool_call_count INTEGER,
        trace JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW()
    )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_query_traces_run ON query_traces(run_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_query_traces_run_query
        ON query_traces(run_id, query_id)`;
    _tableReady = true;
    return true;
}

export interface SaveTraceRecord {
    runId: string;
    queryId: string;
    queryName: string;
    question: string;
    pass: boolean;
    expected: string;
    actual: string;
    error?: string;
    durationMs: number;
    toolCallCount: number;
    trace: QueryTrace;
}

/** Persist one query's full trace. Returns whether it was stored. */
export async function saveTrace(rec: SaveTraceRecord): Promise<boolean> {
    try {
        const sql = getDb();
        if (!sql) return false;
        await ensureTable();
        await sql`INSERT INTO query_traces
            (run_id, query_id, query_name, question, pass, expected, actual, error,
             duration_ms, model, hosting, tool_call_count, trace)
            VALUES (${rec.runId}, ${rec.queryId}, ${rec.queryName}, ${rec.question},
             ${rec.pass}, ${rec.expected}, ${rec.actual}, ${rec.error ?? null},
             ${rec.durationMs}, ${rec.trace.model}, ${rec.trace.hosting},
             ${rec.toolCallCount}, ${JSON.stringify(rec.trace)})`;
        return true;
    } catch {
        // Warming up or transient — never fail the query because the trace
        // couldn't be persisted (it's still returned inline).
        return false;
    }
}

export interface PersistedTrace {
    runId: string;
    queryId: string;
    queryName: string;
    question: string;
    pass: boolean;
    expected: string;
    actual: string;
    error?: string;
    durationMs: number;
    toolCallCount: number;
    trace: QueryTrace;
    createdAt: string;
}

/** Fetch one persisted trace by (runId, queryId), or null. */
export async function getTrace(runId: string, queryId: string): Promise<PersistedTrace | null> {
    const sql = getDb();
    if (!sql) return null;
    try {
        await ensureTable();
        const rows = await sql<{
            run_id: string;
            query_id: string;
            query_name: string;
            question: string;
            pass: boolean;
            expected: string;
            actual: string;
            error: string | null;
            duration_ms: number;
            tool_call_count: number;
            trace: QueryTrace;
            created_at: string;
        }>`SELECT * FROM query_traces
            WHERE run_id = ${runId} AND query_id = ${queryId}
            ORDER BY id DESC LIMIT 1`;
        const r = rows[0];
        if (!r) return null;
        return {
            runId: r.run_id,
            queryId: r.query_id,
            queryName: r.query_name,
            question: r.question,
            pass: r.pass,
            expected: r.expected,
            actual: r.actual,
            error: r.error ?? undefined,
            durationMs: r.duration_ms,
            toolCallCount: r.tool_call_count,
            trace: r.trace,
            createdAt: r.created_at,
        };
    } catch {
        return null;
    }
}

export type TraceStorageState = 'ready' | 'unconfigured' | 'warming-up';

/** Whether persistent trace storage is available (for UI messaging). */
export async function traceStorageState(): Promise<TraceStorageState> {
    if (!isDbConfigured()) return 'unconfigured';
    try {
        const ok = await ensureTable();
        return ok ? 'ready' : 'unconfigured';
    } catch {
        return 'warming-up';
    }
}
