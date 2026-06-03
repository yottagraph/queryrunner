/**
 * Execute a single QueryRunner test case against the Knowledge Graph.
 *
 * Server-side because:
 *  - We use the X-Api-Key path through the Portal Gateway (browser can't
 *    do that cross-origin).
 *  - We lean on `server/utils/elementalQs` for schema caching, dedup, and
 *    64-bit-safe ID handling.
 *
 * Returns a QueryResult — never throws on test failure. The only thing
 * that produces an HTTP error from this route is a misshapen request
 * body or the QS being unconfigured.
 */
import type {
    ExecuteRequest,
    QueryResult,
    SearchValidator,
    PropertyValidator,
    LinkedCountValidator,
} from '~/types/queryrunner';
import { isQsConfigured, getPropertiesByName, findLinkedCount } from '~/server/utils/elementalQs';

interface SearchMatch {
    neid: string;
    name: string;
    flavor: string;
    score?: number;
}

interface SearchResponse {
    results?: { queryId: number; matches?: SearchMatch[] }[];
}

function gatewayConfig() {
    const pub = (useRuntimeConfig().public ?? {}) as Record<string, string>;
    return {
        gatewayUrl: pub.gatewayUrl,
        orgId: pub.tenantOrgId,
        apiKey: pub.qsApiKey,
    };
}

async function searchTopMatch(query: string): Promise<SearchMatch | null> {
    const { gatewayUrl, orgId, apiKey } = gatewayConfig();
    const url = `${gatewayUrl}/api/qs/${orgId}/entities/search`;
    const res = await $fetch<SearchResponse>(url, {
        method: 'POST',
        headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' },
        body: {
            queries: [{ queryId: 1, query }],
            maxResults: 3,
            includeNames: true,
        },
    });
    const matches = res?.results?.[0]?.matches ?? [];
    return matches.length > 0 ? matches[0] : null;
}

async function resolveNeidByName(name: string): Promise<string | null> {
    const top = await searchTopMatch(name);
    return top?.neid ?? null;
}

function validateSearch(
    match: SearchMatch | null,
    validator: SearchValidator
): { pass: boolean; actual: string; expected: string } {
    if (validator.mode === 'has_match') {
        return {
            pass: match !== null,
            actual: match ? `${match.name} (${match.flavor})` : '(no match)',
            expected: 'at least one match',
        };
    }
    if (!match) {
        return { pass: false, actual: '(no match)', expected: validator.expected };
    }
    switch (validator.mode) {
        case 'top_name_equals':
            return {
                pass: match.name === validator.expected,
                actual: match.name,
                expected: validator.expected,
            };
        case 'top_neid_equals':
            return {
                pass: match.neid === validator.expected,
                actual: match.neid,
                expected: validator.expected,
            };
        case 'top_flavor_equals':
            return {
                pass: match.flavor === validator.expected,
                actual: match.flavor,
                expected: validator.expected,
            };
    }
}

function validateProperty(
    value: string | null,
    validator: PropertyValidator
): { pass: boolean; actual: string; expected: string } {
    const actual = value ?? '(null)';
    switch (validator.mode) {
        case 'equals':
            return { pass: value === validator.expected, actual, expected: validator.expected };
        case 'contains':
            return {
                pass:
                    value !== null &&
                    value.toLowerCase().includes(validator.expected.toLowerCase()),
                actual,
                expected: `contains "${validator.expected}"`,
            };
        case 'not_null':
            return {
                pass: value !== null && value.length > 0,
                actual,
                expected: 'non-empty value',
            };
    }
}

function validateLinkedCount(
    count: number,
    validator: LinkedCountValidator
): { pass: boolean; actual: string; expected: string } {
    switch (validator.mode) {
        case 'gte':
            return {
                pass: count >= validator.expected,
                actual: String(count),
                expected: `≥ ${validator.expected}`,
            };
        case 'equals':
            return {
                pass: count === validator.expected,
                actual: String(count),
                expected: `= ${validator.expected}`,
            };
    }
}

export default defineEventHandler(async (event): Promise<QueryResult> => {
    const startedAt = Date.now();
    const req = await readBody<ExecuteRequest>(event);

    if (!req || !req.body || !req.body.type || !req.queryId || !req.queryName) {
        throw createError({
            statusCode: 400,
            statusMessage: 'execute requires { queryId, queryName, body: { type, ... } }',
        });
    }

    if (!isQsConfigured()) {
        return {
            queryId: req.queryId,
            queryName: req.queryName,
            pass: false,
            actual: '(not configured)',
            expected: '(not configured)',
            error: 'Query Server is not configured for this tenant (gateway / org / api key missing).',
            durationMs: Date.now() - startedAt,
        };
    }

    try {
        if (req.body.type === 'search') {
            const match = await searchTopMatch(req.body.query);
            const v = validateSearch(match, req.body.validator);
            return {
                queryId: req.queryId,
                queryName: req.queryName,
                ...v,
                durationMs: Date.now() - startedAt,
            };
        }

        if (req.body.type === 'property') {
            const neid = await resolveNeidByName(req.body.entity);
            if (!neid) {
                return {
                    queryId: req.queryId,
                    queryName: req.queryName,
                    pass: false,
                    actual: `(entity "${req.body.entity}" not found)`,
                    expected:
                        'expected' in req.body.validator
                            ? req.body.validator.expected
                            : 'non-empty value',
                    durationMs: Date.now() - startedAt,
                };
            }
            const { values, unknownProps } = await getPropertiesByName(neid, [req.body.property]);
            if (unknownProps.length > 0) {
                return {
                    queryId: req.queryId,
                    queryName: req.queryName,
                    pass: false,
                    actual: `(unknown property "${req.body.property}")`,
                    expected:
                        'expected' in req.body.validator
                            ? req.body.validator.expected
                            : 'non-empty value',
                    durationMs: Date.now() - startedAt,
                };
            }
            const value = values[req.body.property];
            const v = validateProperty(value, req.body.validator);
            return {
                queryId: req.queryId,
                queryName: req.queryName,
                ...v,
                durationMs: Date.now() - startedAt,
            };
        }

        if (req.body.type === 'linked_count') {
            const neid = await resolveNeidByName(req.body.entity);
            if (!neid) {
                return {
                    queryId: req.queryId,
                    queryName: req.queryName,
                    pass: false,
                    actual: `(entity "${req.body.entity}" not found)`,
                    expected: `${req.body.validator.mode === 'gte' ? '≥' : '='} ${req.body.validator.expected}`,
                    durationMs: Date.now() - startedAt,
                };
            }
            const { count } = await findLinkedCount(neid, {
                direction: req.body.direction,
                limit: 200,
            });
            const v = validateLinkedCount(count, req.body.validator);
            return {
                queryId: req.queryId,
                queryName: req.queryName,
                ...v,
                durationMs: Date.now() - startedAt,
            };
        }

        throw createError({ statusCode: 400, statusMessage: `unknown query type` });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
            queryId: req.queryId,
            queryName: req.queryName,
            pass: false,
            actual: '(error)',
            expected: '(error)',
            error: message,
            durationMs: Date.now() - startedAt,
        };
    }
});
