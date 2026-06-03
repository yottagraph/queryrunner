/**
 * Execute a single QueryRunner test case.
 *
 * The new execution path: the query is a plaintext human-language question.
 * We hand it to the app-hosted `query_runner_agent`, which navigates the
 * Elemental Knowledge Graph through the `elemental-query` MCP toolset and
 * returns ONE value. We parse that value, judge it deterministically against
 * the query's `expected` answer (pass/fail), persist the full agent/MCP
 * navigation trace to Postgres (when configured), and return a `QueryResult`
 * with the trace inline for immediate inspection.
 *
 * Returns a `QueryResult` — never throws on a test failure. Agent transport /
 * configuration problems are surfaced as `error` (counted as an error, not a
 * plain fail), so the harness keeps producing clean metrics.
 */
import type { ExecuteRequest, QueryResult } from '~/types/queryrunner';
import { describeExpectation } from '~/types/queryrunner';
import { runQueryAgent, judgeAnswer } from '~/server/utils/queryAgent';
import { saveTrace } from '~/server/utils/queryTraceStore';

export default defineEventHandler(async (event): Promise<QueryResult> => {
    const startedAt = Date.now();
    const req = await readBody<ExecuteRequest>(event);

    if (!req || !req.queryId || !req.question || !req.expected?.kind) {
        throw createError({
            statusCode: 400,
            statusMessage:
                'execute requires { queryId, queryName, question, expected: { kind, ... } }',
        });
    }

    const queryName = req.queryName || req.question;
    const expectedLabel = describeExpectation(req.expected);
    const runtime = useRuntimeConfig();
    const model = ((runtime.public as Record<string, unknown>)?.queryAgentModel as string) || '';

    const { trace, durationMs } = await runQueryAgent(req.question, model);
    const toolCallCount = trace.toolCalls.length;

    // Agent transport/config/parse failure → clean error result.
    if (trace.agentError) {
        return {
            queryId: req.queryId,
            queryName,
            question: req.question,
            pass: false,
            actual: '(agent error)',
            expected: expectedLabel,
            error: trace.agentError,
            durationMs: durationMs || Date.now() - startedAt,
            toolCallCount,
            trace,
        };
    }

    const { pass, actual } = judgeAnswer(trace.parsedAnswer, req.expected);

    // If the agent produced no parseable JSON answer at all, flag it as an
    // error (a harness problem to fix), not a silent content fail.
    const noAnswer = trace.rawAnswerJson === null && trace.parsedAnswer === null;
    const error = noAnswer ? 'Agent did not return a parseable JSON answer block.' : undefined;

    const result: QueryResult = {
        queryId: req.queryId,
        queryName,
        question: req.question,
        pass: error ? false : pass,
        actual,
        expected: expectedLabel,
        error,
        durationMs: durationMs || Date.now() - startedAt,
        toolCallCount,
        trace,
    };

    if (req.runId) {
        await saveTrace({
            runId: req.runId,
            queryId: req.queryId,
            queryName,
            question: req.question,
            pass: result.pass,
            expected: expectedLabel,
            actual,
            error,
            durationMs: result.durationMs,
            toolCallCount,
            trace,
        });
    }

    return result;
});
