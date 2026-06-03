/**
 * Hosting-aware, non-streaming agent invocation for server routes.
 *
 * The browser chat path is `POST /api/agent/{id}/stream` (SSE). But the
 * canonical BC 2.0 server-side pattern is different: a Nitro route calls an
 * agent ONCE, waits for the final answer, then does something with it
 * (parse structured output, write BigQuery / Cloud SQL, etc.). `callAgent()`
 * is that request/response wrapper — it drains the agent's stream
 * server-side and hands you the final text plus the tool calls it made.
 *
 * It mirrors `server/api/agent/[agentId]/stream.post.ts` exactly (same two
 * transports, same ADK event parsing via `~/server/utils/adkEvents`) so the
 * contract is identical regardless of where the agent runs:
 *   - `gke` (BC 2.0 in-cluster): create a session on the ADK `api_server`,
 *     then drain `/run_sse`.
 *   - `agent_engine` (BC 1.0 / Vertex): authorize via the portal gateway,
 *     then drain Agent Engine `:streamQuery`.
 *
 * Typical use (entity-lookup → structured JSON → BigQuery):
 *
 *   const { text, toolCalls, hosting } = await callAgent({
 *     agentId: 'insights',
 *     message: `Look up: ${names.join(', ')}`,
 *   });
 *   const payload = extractFencedJson(text) as { entities: Entity[] } | null;
 *   // ...then insert payload.entities into BigQuery via server/utils/bigquery.ts
 *
 * Both `callAgent` and `extractFencedJson` are auto-imported in server
 * routes (Nitro auto-imports `server/utils`); an explicit
 * `import { callAgent } from '~/server/utils/agentCall'` also works.
 */
import {
    classifyAdkEvent,
    extractJsonValues,
    findMatchingBrace,
    parseAdkEvent,
    type AdkEvent,
} from '~/server/utils/adkEvents';

export interface AgentToolCall {
    name: string;
    args: Record<string, unknown>;
    /**
     * The value the tool returned, captured from the matching ADK
     * `function_response` event. Present once the response is seen.
     */
    response?: unknown;
    /** Epoch ms when the `function_call` event was observed. */
    calledAt?: number;
    /** Epoch ms when the matching `function_response` event was observed. */
    respondedAt?: number;
}

export interface AgentCallResult {
    /** The agent's final text part (last `text` event seen). */
    text: string;
    /** Session id used — pass it back in as `sessionId` to continue a thread. */
    sessionId: string | null;
    /** Tool calls the agent made, in order — handy for diagnostics in the UI. */
    toolCalls: AgentToolCall[];
    /** Hosting mode that actually ran (for diagnostics in the UI). */
    hosting: 'gke' | 'agent_engine';
}

interface CallAgentOptions {
    /** ADK app name (gke) or Agent Engine engine_id (agent_engine). */
    agentId: string;
    message: string;
    /** Defaults to `'server'`. ADK keys sessions/memory by user id. */
    userId?: string;
    /** Reuse an existing session to continue a conversation. */
    sessionId?: string | null;
    /** Wall-clock timeout for the whole call (ms). Default 4 minutes. */
    timeoutMs?: number;
}

export async function callAgent(opts: CallAgentOptions): Promise<AgentCallResult> {
    const runtime = useRuntimeConfig();
    const config = runtime.public as Record<string, unknown>;
    const agentHosting = (config.agentHosting as string) || 'agent_engine';
    const userId = opts.userId || 'server';
    const timeoutMs = opts.timeoutMs ?? 4 * 60 * 1000;

    if (agentHosting === 'gke') {
        const base = ((runtime.agentBaseUrl as string) || '').replace(/\/+$/, '');
        if (!base) {
            throw createError({
                statusCode: 503,
                statusMessage:
                    'In-cluster agent base URL not configured (NUXT_AGENT_BASE_URL is empty).',
            });
        }
        return await callGkeAgent({
            base,
            appName: opts.agentId,
            userId,
            message: opts.message,
            sessionId: opts.sessionId ?? null,
            timeoutMs,
        });
    }

    const gatewayUrl = config.gatewayUrl as string;
    const orgId = config.tenantOrgId as string;
    if (!gatewayUrl || !orgId) {
        throw createError({ statusCode: 503, statusMessage: 'Gateway not configured' });
    }
    return await callAgentEngine({
        gatewayUrl,
        orgId,
        agentId: opts.agentId,
        userId,
        message: opts.message,
        sessionId: opts.sessionId ?? null,
        timeoutMs,
    });
}

async function callGkeAgent(opts: {
    base: string;
    appName: string;
    userId: string;
    message: string;
    sessionId: string | null;
    timeoutMs: number;
}): Promise<AgentCallResult> {
    let sessionId = opts.sessionId;
    if (!sessionId) {
        const sess = await $fetch<{ id?: string }>(
            `${opts.base}/apps/${encodeURIComponent(opts.appName)}/users/${encodeURIComponent(
                opts.userId
            )}/sessions`,
            { method: 'POST', body: {}, signal: AbortSignal.timeout(15_000) }
        ).catch((e: { message?: string }) => {
            throw createError({
                statusCode: 502,
                statusMessage: `Failed to create in-cluster agent session: ${e?.message || 'unknown'}`,
            });
        });
        sessionId = sess?.id || null;
    }
    if (!sessionId) {
        throw createError({
            statusCode: 502,
            statusMessage: 'In-cluster agent did not return a session id',
        });
    }

    const res = await fetch(`${opts.base}/run_sse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        signal: AbortSignal.timeout(opts.timeoutMs),
        body: JSON.stringify({
            appName: opts.appName,
            userId: opts.userId,
            sessionId,
            newMessage: { role: 'user', parts: [{ text: opts.message }] },
            streaming: false,
        }),
    });

    if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw createError({
            statusCode: res.status === 404 ? 503 : 502,
            statusMessage:
                res.status === 404
                    ? `Agent "${opts.appName}" not found in cluster (api_server returned 404). It may not be deployed yet.`
                    : `In-cluster agent returned ${res.status}: ${errText.slice(0, 300)}`,
        });
    }
    if (!res.body) {
        throw createError({
            statusCode: 502,
            statusMessage: 'No response body from in-cluster agent',
        });
    }

    const { text, toolCalls } = await drainSseStream(res.body);
    return { text, sessionId, toolCalls, hosting: 'gke' };
}

async function callAgentEngine(opts: {
    gatewayUrl: string;
    orgId: string;
    agentId: string;
    userId: string;
    message: string;
    sessionId: string | null;
    timeoutMs: number;
}): Promise<AgentCallResult> {
    const auth = await $fetch<{ token: string; engine_url: string; expires_in?: number }>(
        `${opts.gatewayUrl}/api/agents/${opts.orgId}/${opts.agentId}/authorize`,
        {
            method: 'POST',
            body: { user_id: opts.userId, create_session: false },
            signal: AbortSignal.timeout(15_000),
        }
    ).catch((e: { message?: string; data?: { statusMessage?: string } }) => {
        throw createError({
            statusCode: 502,
            statusMessage: `Failed to authorize with portal: ${e?.data?.statusMessage || e?.message || 'unknown'}`,
        });
    });

    let sessionId = opts.sessionId;
    if (!sessionId) {
        const sess = await $fetch<{ output?: { id?: string } }>(`${auth.engine_url}:query`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${auth.token}`,
                'Content-Type': 'application/json',
            },
            body: { class_method: 'async_create_session', input: { user_id: opts.userId } },
            signal: AbortSignal.timeout(15_000),
        }).catch((e: { message?: string }) => {
            throw createError({
                statusCode: 502,
                statusMessage: `Failed to create agent session: ${e?.message || 'unknown'}`,
            });
        });
        sessionId = sess?.output?.id || null;
    }
    if (!sessionId) {
        throw createError({
            statusCode: 502,
            statusMessage: 'Agent Engine did not return a session id',
        });
    }

    const res = await fetch(`${auth.engine_url}:streamQuery`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(opts.timeoutMs),
        body: JSON.stringify({
            class_method: 'async_stream_query',
            input: { user_id: opts.userId, session_id: sessionId, message: opts.message },
        }),
    });

    if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw createError({
            statusCode: 502,
            statusMessage: `Agent Engine returned ${res.status}: ${errText.slice(0, 300)}`,
        });
    }
    if (!res.body) {
        throw createError({ statusCode: 502, statusMessage: 'No response body from Agent Engine' });
    }

    const { text, toolCalls } = await drainJsonStream(res.body);
    return { text, sessionId, toolCalls, hosting: 'agent_engine' };
}

/**
 * Collapse a classified event into our running result accumulators.
 * Exported for unit testing the tool-call ↔ response pairing.
 */
export function applyEvent(
    evt: AdkEvent,
    acc: { text: string; toolCalls: AgentToolCall[] },
    now: number = Date.now()
): void {
    const classified = classifyAdkEvent(evt);
    if (!classified) return;
    // Prefer the ADK event's own timestamp (epoch seconds) so timing reflects
    // the agent's clock even if the stream is buffered; fall back to the
    // server-observed time when the transport omits it.
    const ts = typeof evt.timestamp === 'number' && evt.timestamp > 0 ? evt.timestamp * 1000 : now;
    if (classified.type === 'function_call') {
        acc.toolCalls.push({
            name: classified.data.name,
            args: classified.data.args,
            calledAt: ts,
        });
    } else if (classified.type === 'function_response') {
        // Attach the response to the most recent matching call that's still
        // awaiting one (responses arrive after their calls, in order).
        for (let i = acc.toolCalls.length - 1; i >= 0; i--) {
            const tc = acc.toolCalls[i];
            if (tc.name === classified.data.name && tc.response === undefined) {
                tc.response = classified.data.response;
                tc.respondedAt = ts;
                return;
            }
        }
    } else if (classified.type === 'text') {
        acc.text = classified.data.text;
    }
}

/** Drain a newline-framed `data:`-prefixed SSE stream (in-cluster api_server). */
async function drainSseStream(
    body: ReadableStream<Uint8Array>
): Promise<{ text: string; toolCalls: AgentToolCall[] }> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const acc = { text: '', toolCalls: [] as AgentToolCall[] };

    const handleBlock = (block: string) => {
        let dataStr = '';
        for (const line of block.split('\n')) {
            if (line.startsWith('data:')) dataStr += line.slice(5).trimStart();
        }
        if (!dataStr) return;
        applyEvent(parseAdkEvent(dataStr), acc);
    };

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() || '';
        for (const b of blocks) handleBlock(b);
    }
    buffer += decoder.decode();
    if (buffer.trim()) handleBlock(buffer);
    return acc;
}

/** Drain a concatenated-JSON stream (Agent Engine :streamQuery). */
async function drainJsonStream(
    body: ReadableStream<Uint8Array>
): Promise<{ text: string; toolCalls: AgentToolCall[] }> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const acc = { text: '', toolCalls: [] as AgentToolCall[] };

    const flush = (chunk: string, final: boolean) => {
        buffer += chunk;
        const { objects, remainder } = extractJsonValues(buffer);
        buffer = final ? '' : remainder;
        for (const raw of objects) applyEvent(parseAdkEvent(raw), acc);
    };

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        flush(decoder.decode(value, { stream: true }), false);
    }
    flush(decoder.decode(), true);
    return acc;
}

/**
 * Pull the first fenced ```json block out of an agent's free-form reply.
 * Instruct the agent to end its answer with exactly one such block and you
 * get deterministic structured output. Falls back to scanning for the first
 * balanced top-level `{...}` when no fence is present. Returns `null` if
 * nothing parses — always null-check before using the result.
 */
export function extractFencedJson(text: string): unknown | null {
    if (!text) return null;
    const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/i);
    if (fenceMatch) {
        try {
            return JSON.parse(fenceMatch[1].trim());
        } catch {
            // fall through to a balanced-brace scan
        }
    }
    const start = text.indexOf('{');
    if (start < 0) return null;
    const end = findMatchingBrace(text, start);
    if (end < 0) return null;
    try {
        return JSON.parse(text.slice(start, end + 1));
    } catch {
        return null;
    }
}
