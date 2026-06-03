/**
 * Server-side agent streaming route — hosting-aware (ADR-021).
 *
 * The browser contract is identical regardless of where the agent runs:
 * POST `{ message, session_id? }` and consume SSE events
 * `text` / `function_call` / `function_response` / `done` / `error`.
 * Two backends are supported, selected by `runtimeConfig.public.agentHosting`:
 *
 *   - `agent_engine` (default, BC 1.0 / Vertex): get a short-lived token
 *     from the portal's /authorize endpoint, then call Agent Engine's
 *     :streamQuery directly (single hop). The portal is only in the auth
 *     path, not the streaming data path. Tokens are cached for their TTL.
 *   - `gke` (BC 2.0 in-cluster): talk to the ADK `api_server` over
 *     cluster-internal DNS (`runtimeConfig.agentBaseUrl`). `agentId` is the
 *     ADK app name (the agent's directory). Create a session, then stream
 *     via `/run_sse`. No portal hop at all.
 *
 * Both backends emit native ADK `Event` objects, so `classifyAdkEvent()`
 * and the emit path are shared. The low-level ADK parsing primitives live
 * in `~/server/utils/adkEvents` and are shared with the server-side
 * one-shot helper `~/server/utils/agentCall.ts`.
 */
import { classifyAdkEvent, extractJsonValues, parseAdkEvent } from '~/server/utils/adkEvents';

interface TokenCache {
    token: string;
    engineUrl: string;
    sessionId: string | null;
    expiresAt: number;
}

const tokenCache = new Map<string, TokenCache>();

function getCacheKey(orgId: string, agentId: string): string {
    return `${orgId}:${agentId}`;
}

async function getAgentToken(
    gatewayUrl: string,
    orgId: string,
    agentId: string,
    userId: string,
    forceRefresh: boolean = false
): Promise<TokenCache> {
    const key = getCacheKey(orgId, agentId);

    if (!forceRefresh) {
        const cached = tokenCache.get(key);
        // Use cached token if it has at least 2 minutes left.
        // The buffer ensures we never start a stream with a token
        // that could expire mid-response.
        if (cached && cached.expiresAt > Date.now() + 120_000) {
            return cached;
        }
    }

    const authUrl = `${gatewayUrl}/api/agents/${orgId}/${agentId}/authorize`;
    const res = await $fetch<any>(authUrl, {
        method: 'POST',
        body: { user_id: userId, create_session: false },
    });

    const entry: TokenCache = {
        token: res.token,
        engineUrl: res.engine_url,
        sessionId: null,
        expiresAt: Date.now() + (res.expires_in || 900) * 1000,
    };

    tokenCache.set(key, entry);
    return entry;
}

function invalidateToken(orgId: string, agentId: string): void {
    tokenCache.delete(getCacheKey(orgId, agentId));
}

async function createSession(engineUrl: string, token: string, userId: string): Promise<string> {
    const res = await $fetch<any>(`${engineUrl}:query`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: { class_method: 'async_create_session', input: { user_id: userId } },
    });
    const sessionId = res.output?.id;
    if (!sessionId) throw new Error('Failed to create agent session');
    return sessionId;
}

export default defineEventHandler(async (event) => {
    const agentId = getRouterParam(event, 'agentId');
    if (!agentId) {
        throw createError({ statusCode: 400, statusMessage: 'agentId is required' });
    }

    const runtime = useRuntimeConfig();
    const config = runtime.public as any;
    const agentHosting = config.agentHosting || 'agent_engine';

    const body = await readBody<Record<string, any>>(event);
    const message = body?.message;
    if (!message) {
        throw createError({ statusCode: 400, statusMessage: 'message is required' });
    }

    const userId = body.user_id || 'default-user';

    // BC 2.0 in-cluster GKE hosting (ADR-021): the agent runs as an ADK
    // `api_server` reachable over cluster-internal DNS. `agentId` is the
    // ADK app name. No portal / Agent Engine hop.
    if (agentHosting === 'gke') {
        const agentBaseUrl = (runtime.agentBaseUrl as string) || '';
        if (!agentBaseUrl) {
            throw createError({
                statusCode: 503,
                statusMessage: 'In-cluster agent base URL not configured',
            });
        }
        return streamInClusterAgent(event, {
            agentBaseUrl,
            appName: agentId,
            userId,
            message,
            sessionId: body.session_id || null,
        });
    }

    // ===== Agent Engine path (BC 1.0 / Vertex) =====
    const gatewayUrl = config.gatewayUrl;
    const orgId = config.tenantOrgId;

    if (!gatewayUrl || !orgId) {
        throw createError({ statusCode: 503, statusMessage: 'Gateway not configured' });
    }

    // Get token (cached or fresh). On 401/403 from Agent Engine, we
    // invalidate the cache so the next request gets a fresh token.
    let auth: TokenCache;

    async function acquireToken(force: boolean = false): Promise<TokenCache> {
        try {
            return await getAgentToken(gatewayUrl, orgId, agentId, userId, force);
        } catch (e: any) {
            const portalMsg = e.data?.statusMessage || e.message || '';
            const isMintFailure =
                portalMsg.includes('could not mint token') ||
                portalMsg.includes('impersonation failed');
            throw createError({
                statusCode: isMintFailure ? 502 : e.statusCode || 502,
                statusMessage: isMintFailure
                    ? portalMsg
                    : `Failed to authorize with portal: ${portalMsg}`,
            });
        }
    }

    auth = await acquireToken();

    // Create or reuse session
    let sessionId = body.session_id || null;
    if (!sessionId) {
        try {
            sessionId = await createSession(auth.engineUrl, auth.token, userId);
        } catch (e: any) {
            throw createError({
                statusCode: 502,
                statusMessage: `Failed to create agent session: ${e.message}`,
            });
        }
    }

    // Set up SSE headers
    setHeader(event, 'Content-Type', 'text/event-stream');
    setHeader(event, 'Cache-Control', 'no-cache');
    setHeader(event, 'Connection', 'keep-alive');

    const encoder = new TextEncoder();
    let aborted = false;

    const stream = new ReadableStream({
        async start(controller) {
            const emit = (type: string, data: any) => {
                if (aborted) return;
                try {
                    controller.enqueue(
                        encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)
                    );
                } catch {
                    /* client disconnected */
                }
            };

            event.node.req.on('close', () => {
                aborted = true;
            });

            try {
                const streamUrl = `${auth.engineUrl}:streamQuery`;
                const res = await fetch(streamUrl, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${auth.token}`,
                        'Content-Type': 'application/json',
                    },
                    signal: AbortSignal.timeout(5 * 60 * 1000),
                    body: JSON.stringify({
                        class_method: 'async_stream_query',
                        input: { user_id: userId, session_id: sessionId, message },
                    }),
                });

                if (!res.ok) {
                    if (res.status === 401 || res.status === 403) {
                        invalidateToken(orgId, agentId);
                        const errText = await res.text().catch(() => '');
                        emit('error', {
                            code: 'PERMISSION_DENIED',
                            message:
                                "Agent access denied — the project's service account " +
                                'may lack required IAM permissions. ' +
                                `(Agent Engine returned ${res.status}${errText ? ': ' + errText.slice(0, 200) : ''})`,
                        });
                        controller.close();
                        return;
                    }
                    const errText = await res.text().catch(() => 'Unknown error');
                    emit('error', { message: `Agent Engine returned ${res.status}: ${errText}` });
                    controller.close();
                    return;
                }

                if (!res.body) {
                    emit('error', { message: 'No response body from Agent Engine' });
                    controller.close();
                    return;
                }

                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';
                let finalText = '';

                while (!aborted) {
                    let done: boolean;
                    let value: Uint8Array | undefined;
                    try {
                        ({ done, value } = await reader.read());
                    } catch (readErr: any) {
                        const msg =
                            readErr?.name === 'TimeoutError'
                                ? 'Agent Engine stream timed out'
                                : `Stream read failed: ${readErr?.message || 'unknown error'}`;
                        emit('error', { message: msg });
                        break;
                    }
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const { objects, remainder } = extractJsonValues(buffer);
                    buffer = remainder;

                    for (const raw of objects) {
                        const evt = parseAdkEvent(raw);
                        const classified = classifyAdkEvent(evt);
                        if (!classified) continue;

                        emit(classified.type, classified.data);
                        if (classified.type === 'text') {
                            finalText = classified.data.text;
                        }
                    }
                }

                // Flush remaining buffer
                buffer += decoder.decode();
                if (buffer.trim()) {
                    const { objects } = extractJsonValues(buffer);
                    for (const raw of objects) {
                        const evt = parseAdkEvent(raw);
                        const classified = classifyAdkEvent(evt);
                        if (!classified) continue;
                        emit(classified.type, classified.data);
                        if (classified.type === 'text') finalText = classified.data.text;
                    }
                }

                emit('done', { session_id: sessionId, text: finalText });
            } catch (e: any) {
                const msg =
                    e?.name === 'TimeoutError'
                        ? 'Agent Engine request timed out'
                        : e.message || 'Agent Engine request failed';
                emit('error', { message: msg });
            }

            if (!aborted) {
                try {
                    controller.close();
                } catch {
                    /* already closed */
                }
            }
        },
    });

    return sendStream(event, stream);
});

// ---------------------------------------------------------------------------
// In-cluster ADK api_server streaming (BC 2.0 GKE hosting, ADR-021)
// ---------------------------------------------------------------------------

interface InClusterOpts {
    agentBaseUrl: string;
    appName: string;
    userId: string;
    message: string;
    sessionId: string | null;
}

/**
 * Stream from the in-cluster ADK `api_server`. Contract (google-adk):
 *   - session: `POST /apps/{app}/users/{user}/sessions` -> `{ id, ... }`
 *   - stream:  `POST /run_sse` with
 *     `{ appName, userId, sessionId, newMessage: { role, parts:[{text}] } }`
 *     -> `text/event-stream` of `data: <ADK Event JSON>` lines.
 * The Event shape matches Agent Engine, so `classifyAdkEvent()` is reused.
 */
async function streamInClusterAgent(event: any, opts: InClusterOpts) {
    const { appName, userId, message } = opts;
    const base = opts.agentBaseUrl.replace(/\/+$/, '');

    setHeader(event, 'Content-Type', 'text/event-stream');
    setHeader(event, 'Cache-Control', 'no-cache');
    setHeader(event, 'Connection', 'keep-alive');

    const encoder = new TextEncoder();
    let aborted = false;

    const stream = new ReadableStream({
        async start(controller) {
            const emit = (type: string, data: any) => {
                if (aborted) return;
                try {
                    controller.enqueue(
                        encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)
                    );
                } catch {
                    /* client disconnected */
                }
            };

            event.node.req.on('close', () => {
                aborted = true;
            });

            try {
                // Reuse the client's session if provided, else create one.
                let sessionId = opts.sessionId;
                if (!sessionId) {
                    try {
                        const sess = await $fetch<any>(
                            `${base}/apps/${encodeURIComponent(appName)}/users/${encodeURIComponent(
                                userId
                            )}/sessions`,
                            { method: 'POST', body: {} }
                        );
                        sessionId = sess?.id || null;
                    } catch (e: any) {
                        const detail = e?.data?.detail || e?.data?.message || e?.message || '';
                        emit('error', {
                            message: `Failed to create agent session: ${detail || 'unknown error'}`,
                        });
                        controller.close();
                        return;
                    }
                    if (!sessionId) {
                        emit('error', {
                            message: 'Failed to create agent session: no session id returned',
                        });
                        controller.close();
                        return;
                    }
                }

                const res = await fetch(`${base}/run_sse`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Accept: 'text/event-stream',
                    },
                    signal: AbortSignal.timeout(5 * 60 * 1000),
                    body: JSON.stringify({
                        appName,
                        userId,
                        sessionId,
                        newMessage: { role: 'user', parts: [{ text: message }] },
                        streaming: false,
                    }),
                });

                if (!res.ok) {
                    const errText = await res.text().catch(() => 'Unknown error');
                    if (res.status === 404) {
                        emit('error', {
                            code: 'NOT_FOUND',
                            message:
                                `Agent "${appName}" not found in cluster ` +
                                '(api_server returned 404). It may not be deployed yet.',
                        });
                    } else {
                        emit('error', {
                            message: `In-cluster agent returned ${res.status}: ${errText.slice(0, 300)}`,
                        });
                    }
                    controller.close();
                    return;
                }

                if (!res.body) {
                    emit('error', { message: 'No response body from in-cluster agent' });
                    controller.close();
                    return;
                }

                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';
                let finalText = '';

                const handleBlock = (block: string) => {
                    let dataStr = '';
                    for (const line of block.split('\n')) {
                        if (line.startsWith('data:')) dataStr += line.slice(5).trimStart();
                    }
                    if (!dataStr) return;
                    let evt: any;
                    try {
                        evt = JSON.parse(dataStr);
                    } catch {
                        return;
                    }
                    if (evt?.error || evt?.error_message || evt?.errorMessage) {
                        emit('error', {
                            message:
                                evt.error_message ||
                                evt.errorMessage ||
                                (typeof evt.error === 'string' ? evt.error : 'Agent error'),
                        });
                        return;
                    }
                    const classified = classifyAdkEvent(evt);
                    if (!classified) return;
                    emit(classified.type, classified.data);
                    if (classified.type === 'text') finalText = classified.data.text;
                };

                while (!aborted) {
                    let done: boolean;
                    let value: Uint8Array | undefined;
                    try {
                        ({ done, value } = await reader.read());
                    } catch (readErr: any) {
                        const msg =
                            readErr?.name === 'TimeoutError'
                                ? 'In-cluster agent stream timed out'
                                : `Stream read failed: ${readErr?.message || 'unknown error'}`;
                        emit('error', { message: msg });
                        break;
                    }
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const blocks = buffer.split('\n\n');
                    buffer = blocks.pop() || '';
                    for (const b of blocks) handleBlock(b);
                }

                buffer += decoder.decode();
                if (buffer.trim()) handleBlock(buffer);

                emit('done', { session_id: sessionId, text: finalText });
            } catch (e: any) {
                const msg =
                    e?.name === 'TimeoutError'
                        ? 'In-cluster agent request timed out'
                        : e.message || 'In-cluster agent request failed';
                emit('error', { message: msg });
            }

            if (!aborted) {
                try {
                    controller.close();
                } catch {
                    /* already closed */
                }
            }
        },
    });

    return sendStream(event, stream);
}

// ADK event parsing (`classifyAdkEvent`, `extractJsonValues`,
// `parseAdkEvent`) lives in `~/server/utils/adkEvents` — imported at the
// top and shared with `~/server/utils/agentCall.ts`.
