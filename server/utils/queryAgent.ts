/**
 * QueryRunner agent glue (server-side).
 *
 * Responsibilities:
 *   - Resolve the `query_runner_agent` id for the active hosting mode.
 *   - Run the agent on one plaintext question, capturing the full MCP
 *     navigation trace (tool calls + responses + final text).
 *   - Parse the agent's single JSON answer value.
 *   - Judge that value deterministically against a query's expectation.
 *
 * The agent itself lives in `agents/query_runner_agent/`; it answers with one
 * fenced ```json block `{ "answer": <string|number|null>, "reasoning": ... }`.
 * We reuse `callAgent()` (which now also captures tool-call responses) for the
 * hosting-aware transport, so this module stays focused on the QueryRunner
 * contract.
 */
import { callAgent, extractFencedJson } from '~/server/utils/agentCall';
import type { AnswerExpectation, QueryTrace, ToolCallTrace } from '~/types/queryrunner';

/** ADK app name for the agent (also the directory name) — used as-is on gke. */
export const QUERY_AGENT_NAME = 'query_runner_agent';

let _resolvedAgentId: string | null = null;

interface TenantConfigAgent {
    name?: string;
    display_name?: string;
    engine_id?: string;
}

/**
 * Resolve the agent id to pass to `callAgent`. For `gke` hosting the id is the
 * ADK app name (the directory name). For `agent_engine` it's the Vertex
 * `engine_id`, discovered from the portal tenant config by agent name. An
 * explicit `NUXT_QUERY_AGENT_ID` always wins. Cached per-process.
 */
export async function resolveQueryAgentId(): Promise<string> {
    const runtime = useRuntimeConfig();
    const override = (runtime.queryAgentId as string) || '';
    if (override) return override;

    const config = (runtime.public ?? {}) as Record<string, unknown>;
    const hosting = (config.agentHosting as string) || 'agent_engine';
    if (hosting === 'gke') return QUERY_AGENT_NAME;

    if (_resolvedAgentId) return _resolvedAgentId;

    const gatewayUrl = config.gatewayUrl as string;
    const orgId = config.tenantOrgId as string;
    if (!gatewayUrl || !orgId) {
        throw createError({
            statusCode: 503,
            statusMessage: 'Gateway not configured — cannot discover the QueryRunner agent.',
        });
    }
    const cfg = await $fetch<{ agents?: TenantConfigAgent[] }>(
        `${gatewayUrl}/api/config/${orgId}`,
        { signal: AbortSignal.timeout(15_000) }
    ).catch((e: { message?: string }) => {
        throw createError({
            statusCode: 502,
            statusMessage: `Failed to fetch tenant config for agent discovery: ${e?.message || 'unknown'}`,
        });
    });
    const match = (cfg?.agents ?? []).find((a) => a.name === QUERY_AGENT_NAME);
    if (!match?.engine_id) {
        throw createError({
            statusCode: 503,
            statusMessage:
                `Agent "${QUERY_AGENT_NAME}" is not registered for this tenant yet. ` +
                'Deploy it with /deploy_agent, or set NUXT_QUERY_AGENT_ID.',
        });
    }
    _resolvedAgentId = match.engine_id;
    return _resolvedAgentId;
}

export interface RunQueryAgentResult {
    trace: QueryTrace;
    durationMs: number;
}

/**
 * Run the agent on one question and assemble a full `QueryTrace`. Never
 * throws for a normal agent failure — transport/config errors are captured in
 * `trace.agentError` so the caller can record a clean error result.
 */
export async function runQueryAgent(question: string, model: string): Promise<RunQueryAgentResult> {
    const startedAt = Date.now();
    const base: QueryTrace = {
        question,
        model,
        hosting: 'agent_engine',
        sessionId: null,
        toolCalls: [],
        finalText: '',
        rawAnswerJson: null,
        parsedAnswer: null,
    };

    try {
        const agentId = await resolveQueryAgentId();
        const res = await callAgent({ agentId, message: question, userId: 'queryrunner' });

        const toolCalls: ToolCallTrace[] = res.toolCalls.map((tc, i) => ({
            index: i,
            name: tc.name,
            args: tc.args,
            response: tc.response,
        }));

        const parsedJson = extractFencedJson(res.text);
        const { answer, reasoning } = extractAnswer(parsedJson);

        return {
            trace: {
                ...base,
                hosting: res.hosting,
                sessionId: res.sessionId,
                toolCalls,
                finalText: res.text,
                rawAnswerJson: parsedJson,
                parsedAnswer: answer,
                reasoning,
            },
            durationMs: Date.now() - startedAt,
        };
    } catch (err) {
        const message =
            (err as { statusMessage?: string })?.statusMessage ||
            (err instanceof Error ? err.message : String(err));
        return {
            trace: { ...base, agentError: message },
            durationMs: Date.now() - startedAt,
        };
    }
}

/** Pull `answer` / `reasoning` out of the agent's parsed JSON object. */
function extractAnswer(json: unknown): {
    answer: string | number | null;
    reasoning?: string;
} {
    if (!json || typeof json !== 'object') return { answer: null };
    const obj = json as Record<string, unknown>;
    const raw = obj.answer;
    let answer: string | number | null = null;
    if (typeof raw === 'number' || typeof raw === 'string') answer = raw;
    else if (raw === null) answer = null;
    else if (raw !== undefined) answer = String(raw);
    const reasoning = typeof obj.reasoning === 'string' ? obj.reasoning : undefined;
    return { answer, reasoning };
}

/** Coerce an answer value to a number for numeric comparisons (commas/units stripped). */
function toNumber(value: string | number | null): number | null {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string') return null;
    // Extract the first numeric token (commas stripped); ignores stray units.
    const m = value.replace(/,/g, '').match(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (!m) return null;
    const n = Number(m[0]);
    return Number.isFinite(n) ? n : null;
}

export interface Judgement {
    pass: boolean;
    actual: string;
}

/**
 * Deterministically judge an agent answer against an expectation. The answer
 * is whatever the agent put in `answer` (string | number | null).
 */
export function judgeAnswer(
    answer: string | number | null,
    expected: AnswerExpectation
): Judgement {
    const actual = answer === null ? '(no answer)' : String(answer);

    switch (expected.kind) {
        case 'string': {
            if (answer === null) return { pass: false, actual };
            const a = String(answer).trim();
            const want = expected.value.trim();
            if (expected.match === 'exact') return { pass: a === want, actual };
            if (expected.match === 'iexact')
                return { pass: a.toLowerCase() === want.toLowerCase(), actual };
            return { pass: a.toLowerCase().includes(want.toLowerCase()), actual };
        }
        case 'number': {
            const n = toNumber(answer);
            if (n === null) return { pass: false, actual };
            const tol = expected.tolerance ?? 0;
            return { pass: Math.abs(n - expected.value) <= tol, actual };
        }
        case 'number_range': {
            const n = toNumber(answer);
            if (n === null) return { pass: false, actual };
            const okMin = expected.min === undefined || n >= expected.min;
            const okMax = expected.max === undefined || n <= expected.max;
            return { pass: okMin && okMax, actual };
        }
    }
}
