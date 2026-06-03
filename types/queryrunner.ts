/**
 * QueryRunner — KG query test harness types.
 *
 * A QueryDef is a reusable test definition. A QueryResult is what a
 * single execution produced. A TestRun groups N QueryResults under one
 * timestamp (i.e. "run all on 2026-06-03 03:57 UTC produced these N
 * results"). Pass rate is a function of QueryResults across runs.
 */

export type SearchValidator =
    | { mode: 'top_name_equals'; expected: string }
    | { mode: 'top_neid_equals'; expected: string }
    | { mode: 'top_flavor_equals'; expected: string }
    | { mode: 'has_match' };

export type PropertyValidator =
    | { mode: 'equals'; expected: string }
    | { mode: 'contains'; expected: string }
    | { mode: 'not_null' };

export type LinkedCountValidator =
    | { mode: 'gte'; expected: number }
    | { mode: 'equals'; expected: number };

export interface SearchQueryDef {
    type: 'search';
    query: string;
    validator: SearchValidator;
}

export interface PropertyQueryDef {
    type: 'property';
    entity: string;
    property: string;
    validator: PropertyValidator;
}

export interface LinkedCountQueryDef {
    type: 'linked_count';
    entity: string;
    direction: 'incoming' | 'outgoing';
    validator: LinkedCountValidator;
}

export type QueryBody = SearchQueryDef | PropertyQueryDef | LinkedCountQueryDef;

export interface QueryDef {
    id: string;
    name: string;
    description?: string;
    body: QueryBody;
    createdAt: number;
    updatedAt: number;
}

export interface QueryResult {
    queryId: string;
    queryName: string;
    pass: boolean;
    actual: string;
    expected: string;
    error?: string;
    durationMs: number;
}

export interface TestRun {
    id: string;
    startedAt: number;
    finishedAt: number;
    results: QueryResult[];
    passCount: number;
    failCount: number;
    errorCount: number;
}

/** Wire format for POST /api/queryrunner/execute */
export interface ExecuteRequest {
    queryId: string;
    queryName: string;
    body: QueryBody;
}
