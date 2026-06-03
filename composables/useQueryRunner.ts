/**
 * QueryRunner state + actions.
 *
 * Holds the query catalog and run history in user prefs (cross-app
 * global feature prefs — these are small JSON docs, well within the
 * KB-scale budget). Exposes:
 *
 *  - reactive `queries` / `runs` arrays
 *  - CRUD on queries
 *  - `runQuery(query)` — executes one, returns the QueryResult
 *  - `runAll()` — executes every query in parallel and records a TestRun
 *
 * Runs are capped to MAX_RUNS so we never approach the prefs doc limit.
 */
import type { ExecuteRequest, QueryDef, QueryResult, TestRun } from '~/types/queryrunner';

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
    return [
        {
            id: uid(),
            name: 'Search: Microsoft → Microsoft Corporation',
            description: 'Top result for the string "Microsoft" should be the corporation node.',
            body: {
                type: 'search',
                query: 'Microsoft',
                validator: { mode: 'top_name_equals', expected: 'Microsoft Corporation' },
            },
            createdAt: now,
            updatedAt: now,
        },
        {
            id: uid(),
            name: 'Search: Apple has any match',
            body: {
                type: 'search',
                query: 'Apple Inc',
                validator: { mode: 'has_match' },
            },
            createdAt: now,
            updatedAt: now,
        },
        {
            id: uid(),
            name: 'Property: Microsoft name contains "Microsoft"',
            description: 'Resolve "Microsoft" and check the name property contains the string.',
            body: {
                type: 'property',
                entity: 'Microsoft',
                property: 'name',
                validator: { mode: 'contains', expected: 'Microsoft' },
            },
            createdAt: now,
            updatedAt: now,
        },
        {
            id: uid(),
            name: 'Linked-count: JPMorgan Chase incoming ≥ 1',
            body: {
                type: 'linked_count',
                entity: 'JPMorgan Chase',
                direction: 'incoming',
                validator: { mode: 'gte', expected: 1 },
            },
            createdAt: now,
            updatedAt: now,
        },
    ];
}

let seeded = false;

export function useQueryRunner() {
    const catalog = useGlobalFeaturePrefs('queryrunner-catalog', {
        queries: blankQueries(),
    });
    const history = useGlobalFeaturePrefs('queryrunner-history', {
        runs: blankRuns(),
    });

    // Seed the catalog with starter queries the first time it's empty.
    // (Hydration runs async; this fires once `useGlobalFeaturePrefs` has
    // observed the real doc — checking after a nextTick is enough.)
    if (!seeded) {
        seeded = true;
        nextTick(() => {
            if (catalog.queries.length === 0) {
                catalog.queries = seedQueries();
            }
        });
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

    async function runQuery(query: QueryDef): Promise<QueryResult> {
        const startedAt = Date.now();
        const req: ExecuteRequest = {
            queryId: query.id,
            queryName: query.name,
            body: query.body,
        };
        try {
            return await $fetch<QueryResult>('/api/queryrunner/execute', {
                method: 'POST',
                body: req,
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
                queryId: query.id,
                queryName: query.name,
                pass: false,
                actual: '(transport error)',
                expected: '(transport error)',
                error: message,
                durationMs: Date.now() - startedAt,
            };
        }
    }

    async function runAll(): Promise<TestRun> {
        const queries = catalog.queries;
        const startedAt = Date.now();
        const results = await Promise.all(queries.map(runQuery));
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
            id: uid(),
            startedAt,
            finishedAt,
            results,
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
        addQuery,
        updateQuery,
        deleteQuery,
        runQuery,
        runAll,
        clearHistory,
    };
}
