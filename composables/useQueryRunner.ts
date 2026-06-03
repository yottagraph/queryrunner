/**
 * QueryRunner state + actions.
 *
 * A query is a plaintext question answered by the app-hosted
 * `query_runner_agent`. The catalog and a lightweight run history live in
 * user prefs (small JSON docs); the FULL per-query agent/MCP trace is large
 * and is persisted separately to Postgres by the execute route (and returned
 * inline for the current session). Before writing a run to prefs we STRIP the
 * `trace` from each result so the prefs doc stays within budget.
 *
 * Exposes reactive `queries` / `runs` / `latestRun`, CRUD on queries,
 * `runQuery` (one), and `runAll` (record a TestRun). Runs are capped to
 * MAX_RUNS.
 */
import type {
    AnswerExpectation,
    ExecuteRequest,
    QueryDef,
    QueryResult,
    TestRun,
} from '~/types/queryrunner';

const MAX_RUNS = 50;

function uid(): string {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function blankQueries(): QueryDef[] {
    return [];
}

function blankRuns(): TestRun[] {
    return [];
}

/** Default catalog seeded the first time a user opens the app. */
function seedQueries(): QueryDef[] {
    const now = Date.now();
    const mk = (
        name: string,
        question: string,
        expected: AnswerExpectation,
        description?: string
    ): QueryDef => ({
        id: uid(),
        name,
        question,
        expected,
        description,
        createdAt: now,
        updatedAt: now,
    });
    return [
        mk(
            'Apple — official name',
            'What is the official name of Apple?',
            { kind: 'string', value: 'Apple', match: 'icontains' },
            'Agent should resolve "Apple" and report its canonical name.'
        ),
        mk('Microsoft — country', 'What country is Microsoft Corporation based in?', {
            kind: 'string',
            value: 'United States',
            match: 'icontains',
        }),
        mk('JPMorgan — linked entity count', 'How many entities are linked to JPMorgan Chase?', {
            kind: 'number_range',
            min: 1,
        }),
        mk('Apple — ticker symbol', 'What is the stock ticker symbol of Apple Inc.?', {
            kind: 'string',
            value: 'AAPL',
            match: 'iexact',
        }),
    ];
}

let initialized = false;

/**
 * A catalog entry is usable only if it's in the agent-answered shape: a
 * non-empty plaintext `question` plus an `expected` with a known `kind`.
 * Pre-refactor MVP entries (structured `body`, no `question`) fail this — they
 * can't be run by the agent and crash the catalog render, so we migrate them
 * out on load.
 */
function isAgentQuery(q: unknown): q is QueryDef {
    if (!q || typeof q !== 'object') return false;
    const o = q as Record<string, unknown>;
    const expected = o.expected as Record<string, unknown> | undefined;
    return (
        typeof o.question === 'string' &&
        o.question.trim().length > 0 &&
        !!expected &&
        typeof expected === 'object' &&
        typeof expected.kind === 'string'
    );
}

/** Drop the heavy `trace` from a result before it goes into prefs. */
function stripTrace(r: QueryResult): QueryResult {
    const { trace: _trace, ...rest } = r;
    void _trace;
    return rest;
}

export function useQueryRunner() {
    const catalog = useGlobalFeaturePrefs('queryrunner-catalog', {
        queries: blankQueries(),
    });
    const history = useGlobalFeaturePrefs('queryrunner-history', {
        runs: blankRuns(),
    });

    // Most recent result per query observed THIS SESSION — carries the full
    // inline trace. Shared across pages (the catalog records it; the /result
    // page reads it) but session-only: not persisted, gone on reload. Use
    // `useState` so every component sees the same reactive map.
    const liveResults = useState<Record<string, QueryResult>>(
        'queryrunner-live-results',
        () => ({})
    );

    function recordResult(r: QueryResult) {
        liveResults.value = { ...liveResults.value, [r.queryId]: r };
    }

    function getLiveResult(queryId: string): QueryResult | undefined {
        return liveResults.value[queryId];
    }

    if (!initialized) {
        initialized = true;
        // Normalize + seed AFTER prefs hydration, never during it. Mutating the
        // reactive root in the load window races the disk read: the post-read
        // merge clobbers the change and the write path is gated while
        // !hydrated, so nothing persists.
        //
        // `hydrated` may already be true when we get here (global prefs loaded
        // before this page mounted, e.g. client-side nav), so this must work
        // both on the immediate run and on a later flip — hence a plain
        // idempotent guard rather than a self-stopping watcher.
        const { hydrated } = usePrefsStatus();
        let done = false;
        const normalizeAndSeed = () => {
            if (done || !hydrated.value) return;
            done = true;
            // Migrate out legacy/unrunnable entries (pre-agent MVP shape).
            // They can't be answered by the agent and would crash the render.
            const valid = catalog.queries.filter(isAgentQuery);
            if (valid.length !== catalog.queries.length) {
                catalog.queries = valid;
            }
            if (catalog.queries.length === 0) {
                catalog.queries = seedQueries();
            }
        };
        watch(hydrated, normalizeAndSeed, { immediate: true });
    }

    function addQuery(input: Omit<QueryDef, 'id' | 'createdAt' | 'updatedAt'>): QueryDef {
        const now = Date.now();
        const def: QueryDef = { id: uid(), createdAt: now, updatedAt: now, ...input };
        catalog.queries = [...catalog.queries, def];
        return def;
    }

    function updateQuery(id: string, patch: Partial<Omit<QueryDef, 'id' | 'createdAt'>>) {
        catalog.queries = catalog.queries.map((q) =>
            q.id === id ? { ...q, ...patch, updatedAt: Date.now() } : q
        );
    }

    function deleteQuery(id: string) {
        catalog.queries = catalog.queries.filter((q) => q.id !== id);
    }

    /**
     * Execute one query. `runId` groups its persisted trace with a run; when
     * omitted a one-off id is generated so a single run still persists.
     * Returns the result WITH its inline trace (the caller may keep it in
     * session memory; it is not written to prefs).
     */
    async function runQuery(query: QueryDef, runId?: string): Promise<QueryResult> {
        const startedAt = Date.now();
        const req: ExecuteRequest = {
            runId: runId ?? `single-${uid()}`,
            queryId: query.id,
            queryName: query.name || query.question,
            question: query.question,
            expected: query.expected,
        };
        try {
            return await $fetch<QueryResult>('/api/queryrunner/execute', {
                method: 'POST',
                body: req,
                // Agent runs can be slow (multiple tool calls + LLM hops).
                timeout: 5 * 60 * 1000,
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
                queryId: query.id,
                queryName: query.name || query.question,
                question: query.question,
                pass: false,
                actual: '(transport error)',
                expected: '(transport error)',
                error: message,
                durationMs: Date.now() - startedAt,
                toolCallCount: 0,
            };
        }
    }

    async function runAll(): Promise<TestRun> {
        const queries = catalog.queries;
        const runId = uid();
        const startedAt = Date.now();
        const results = await Promise.all(queries.map((q) => runQuery(q, runId)));
        const finishedAt = Date.now();
        let passCount = 0;
        let failCount = 0;
        let errorCount = 0;
        for (const r of results) {
            if (r.error) errorCount += 1;
            if (r.pass) passCount += 1;
            else failCount += 1;
        }
        const run: TestRun = {
            id: runId,
            startedAt,
            finishedAt,
            results: results.map(stripTrace),
            passCount,
            failCount,
            errorCount,
        };
        const next = [run, ...history.runs].slice(0, MAX_RUNS);
        history.runs = next;
        return run;
    }

    function clearHistory() {
        history.runs = [];
    }

    const queries = computed(() => catalog.queries);
    const runs = computed(() => history.runs);
    const latestRun = computed(() => history.runs[0] ?? null);

    return {
        queries,
        runs,
        latestRun,
        liveResults,
        recordResult,
        getLiveResult,
        addQuery,
        updateQuery,
        deleteQuery,
        runQuery,
        runAll,
        clearHistory,
    };
}
