/**
 * QueryRunner — agent-answered KG query test harness types.
 *
 * The execution model: a query is a plaintext, human-language QUESTION
 * (e.g. "What is the official name of Apple?"). It is answered by an
 * app-hosted agent that navigates the Elemental Knowledge Graph through a
 * single MCP toolset and returns ONE value (string or number). That value is
 * judged deterministically against the query's `expected` answer, so every
 * query is pass/fail.
 *
 * A `QueryDef` is a reusable test definition. A `QueryResult` is what one
 * execution produced (including the full agent/MCP trace for debugging). A
 * `TestRun` groups N results under one timestamp; pass rate is a function of
 * results across runs.
 */

/** How the agent's single answer value is judged against the expected value. */
export type AnswerExpectation =
    | { kind: 'string'; value: string; match: 'exact' | 'iexact' | 'icontains' }
    | { kind: 'number'; value: number; tolerance?: number }
    | { kind: 'number_range'; min?: number; max?: number };

export interface QueryDef {
    id: string;
    /** Optional label; the dashboard falls back to the question when empty. */
    name?: string;
    /** The plaintext, human-language question the agent must answer. */
    question: string;
    /** Deterministic expectation the agent's answer is judged against. */
    expected: AnswerExpectation;
    description?: string;
    createdAt: number;
    updatedAt: number;
}

/** One MCP tool call the agent made while answering — request + response. */
export interface ToolCallTrace {
    index: number;
    name: string;
    args: Record<string, unknown>;
    /** The value the MCP tool returned (present once the response arrives). */
    response?: unknown;
    /**
     * Timing, relative to the first observed tool call (ms). Absent on traces
     * captured before timing was recorded, so always treat as optional.
     */
    startOffsetMs?: number;
    /** Offset (ms from first call) when the tool response was observed. */
    endOffsetMs?: number;
    /** Round-trip duration of this tool call in ms (`endOffsetMs - startOffsetMs`). */
    durationMs?: number;
}

/**
 * Logs emitted by one component of the stack during a single query. Captured
 * by diffing each component's logfile across the agent call (see
 * `server/utils/stackLogs.ts`), so the lines are exactly what that process
 * printed while answering this question.
 */
export interface StackLog {
    /** Stable key for the component, e.g. 'ui' | 'agent' | 'mcp'. */
    source: string;
    /** Human label for the UI. */
    label: string;
    /** The lines that component printed during this query (ANSI-stripped). */
    lines: string[];
    /** Set when the source couldn't be captured (e.g. logfile not present). */
    note?: string;
}

/**
 * Everything we captured about a single agent run — the navigation record.
 * Returned inline on the live result and persisted in full to Postgres (when
 * configured) so a run's behaviour can be inspected and optimised later.
 */
export interface QueryTrace {
    question: string;
    model: string;
    hosting: string;
    sessionId: string | null;
    /** Every MCP tool call, in order, with args and responses. */
    toolCalls: ToolCallTrace[];
    /** The agent's raw final text (the message that should contain the JSON). */
    finalText: string;
    /** The JSON object the agent emitted (parsed), or null if none parsed. */
    rawAnswerJson: unknown | null;
    /** The single value extracted from `answer`. */
    parsedAnswer: string | number | null;
    /** The agent's stated reasoning, if it provided any. */
    reasoning?: string;
    /** Error from the agent-call path (transport / config / parse). */
    agentError?: string;
    /**
     * Per-component logs captured during this query (UI server, agent,
     * MCP). Absent on traces captured before log capture existed, and empty
     * for components whose logfiles aren't being written (e.g. in prod).
     */
    stackLogs?: StackLog[];
}

export interface QueryResult {
    queryId: string;
    queryName: string;
    question: string;
    pass: boolean;
    /** String rendering of the agent's answer (for tables). */
    actual: string;
    /** Human description of what was expected. */
    expected: string;
    /** Set for transport / config / agent errors (distinct from a clean fail). */
    error?: string;
    durationMs: number;
    /** Number of MCP tool calls the agent made (kept even when trace is stripped). */
    toolCallCount: number;
    /** Full trace — returned inline; stripped before persisting to prefs. */
    trace?: QueryTrace;
}

export interface TestRun {
    id: string;
    startedAt: number;
    finishedAt: number;
    /** Per-query results; persisted WITHOUT `trace` to stay within prefs budget. */
    results: QueryResult[];
    passCount: number;
    failCount: number;
    errorCount: number;
}

/** Wire format for POST /api/queryrunner/execute */
export interface ExecuteRequest {
    /** Groups the persisted trace with the rest of a run. */
    runId?: string;
    queryId: string;
    queryName: string;
    question: string;
    expected: AnswerExpectation;
}

/**
 * Human-readable description of an expectation, for tables/labels.
 *
 * Tolerates `null`/`undefined`/legacy shapes (returns "—") so a single
 * malformed catalog entry can't throw mid-render and blank the whole list.
 */
export function describeExpectation(exp: AnswerExpectation | null | undefined): string {
    if (!exp || typeof exp !== 'object') return '—';
    switch (exp.kind) {
        case 'string':
            if (exp.match === 'icontains') return `contains "${exp.value}"`;
            if (exp.match === 'iexact') return `= "${exp.value}" (any case)`;
            return `= "${exp.value}"`;
        case 'number':
            return exp.tolerance ? `${exp.value} ± ${exp.tolerance}` : `= ${exp.value}`;
        case 'number_range': {
            const lo = exp.min ?? '−∞';
            const hi = exp.max ?? '∞';
            return `between ${lo} and ${hi}`;
        }
        default:
            return '—';
    }
}
