import { ref, computed } from 'vue';
import { useUserState } from './useUserState';

export interface ChatMessage {
    id: string;
    role: 'user' | 'agent';
    text: string;
    timestamp: number;
    error?: boolean;
    streaming?: boolean;
}

export interface AgentStreamEvent {
    event: string;
    data: any;
}

const messages = ref<ChatMessage[]>([]);
const loading = ref(false);
const sessionId = ref<string | null>(null);
const currentAgentId = ref<string | null>(null);

/**
 * Composable for the agent chat UI. Manages conversation state and sends
 * messages to deployed ADK agents via the local Nitro streaming route.
 *
 * The data path is: Browser → Nitro → Agent Engine (direct, using a
 * short-lived tenant SA token from the portal's /authorize endpoint).
 * The portal is only in the auth path, not the streaming data path.
 *
 * Returns: messages, loading, sendMessage(text), selectAgent(agentId), clearChat()
 */
export function useAgentChat() {
    const { accessToken } = useUserState();

    function selectAgent(agentId: string) {
        if (currentAgentId.value !== agentId) {
            currentAgentId.value = agentId;
            messages.value = [];
            sessionId.value = null;
        }
    }

    async function sendMessage(text: string): Promise<void> {
        if (!text.trim() || loading.value) return;

        const agentId = currentAgentId.value;

        if (!agentId) {
            messages.value.push({
                id: crypto.randomUUID(),
                role: 'agent',
                text: 'No agent selected. Choose an agent to start chatting.',
                timestamp: Date.now(),
                error: true,
            });
            return;
        }

        messages.value.push({
            id: crypto.randomUUID(),
            role: 'user',
            text,
            timestamp: Date.now(),
        });

        messages.value.push({
            id: crypto.randomUUID(),
            role: 'agent',
            text: '',
            timestamp: Date.now(),
            streaming: true,
        });
        // Access the message through the reactive array — not a local variable —
        // so Vue's Proxy tracks mutations and triggers re-renders.
        const agentMsgIdx = messages.value.length - 1;

        loading.value = true;

        const reqHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
        if (accessToken.value) {
            reqHeaders['Authorization'] = `Bearer ${accessToken.value}`;
        }
        const reqBody: any = { message: text };
        if (sessionId.value) {
            reqBody.session_id = sessionId.value;
        }

        function updateAgent(patch: Partial<ChatMessage>) {
            Object.assign(messages.value[agentMsgIdx], patch);
        }

        try {
            const streamUrl = `/api/agent/${agentId}/stream`;
            const response = await fetch(streamUrl, {
                method: 'POST',
                headers: reqHeaders,
                body: JSON.stringify(reqBody),
            });

            if (!response.ok || !response.body) {
                const errorText = await response.text().catch(() => '');
                throw Object.assign(
                    new Error(errorText || `Agent request failed (${response.status})`),
                    { status: response.status }
                );
            }

            for await (const { event, data } of readSSE(response)) {
                if (event === 'text') {
                    updateAgent({ text: data.text });
                } else if (event === 'done') {
                    if (data.session_id) sessionId.value = data.session_id;
                    if (data.text && !messages.value[agentMsgIdx].text) {
                        updateAgent({ text: data.text });
                    }
                    break;
                } else if (event === 'error') {
                    throw Object.assign(new Error(data.message || 'Agent error'), {
                        code: data.code,
                    });
                }
            }

            updateAgent({ streaming: false });
            if (!messages.value[agentMsgIdx].text) {
                updateAgent({ text: 'Agent returned no text response.' });
            }
        } catch (e: any) {
            updateAgent({
                text: agentErrorMessage(e),
                error: true,
                streaming: false,
            });
        } finally {
            loading.value = false;
        }
    }

    function clearChat() {
        messages.value = [];
        sessionId.value = null;
    }

    const hasMessages = computed(() => messages.value.length > 0);

    return {
        messages: computed(() => messages.value),
        loading: computed(() => loading.value),
        sessionId: computed(() => sessionId.value),
        currentAgentId: computed(() => currentAgentId.value),
        hasMessages,
        selectAgent,
        sendMessage,
        clearChat,
    };
}

function agentErrorMessage(e: any): string {
    const status = e.status || e.statusCode;
    const code = e.code;
    const msg = e.data?.statusMessage || e.message || '';

    if (status === 502 || msg.includes('could not mint token')) {
        return (
            "Agent authorization failed — the project's cloud permissions may be incomplete. " +
            'Check the Broadchurch portal for IAM status details.'
        );
    }
    if (status === 403 || code === 'PERMISSION_DENIED') {
        return (
            "Agent access denied — the project's service account may lack required permissions. " +
            'Check the Broadchurch portal for IAM status details.'
        );
    }
    if (status === 404) {
        return 'Agent not found. It may not be deployed yet — check the portal.';
    }
    if (status === 503) {
        return 'Agent service is not configured. Check that gateway URL and tenant org are set in your .env.';
    }
    return msg || 'Failed to get agent response.';
}

/**
 * Async generator that reads Server-Sent Events from a fetch Response.
 * Yields `{ event, data }` for each SSE message. Use with the gateway's
 * `/stream` endpoint or any SSE source.
 *
 * ```ts
 * import { readSSE } from '~/composables/useAgentChat';
 * const res = await fetch(streamUrl, { method: 'POST', body, headers });
 * for await (const { event, data } of readSSE(res)) { ... }
 * ```
 */
export async function* readSSE(response: Response): AsyncGenerator<AgentStreamEvent> {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const blocks = buffer.split('\n\n');
            buffer = blocks.pop() || '';

            for (const block of blocks) {
                const parsed = parseSSEBlock(block);
                if (parsed) yield parsed;
            }
        }

        buffer += decoder.decode();
        if (buffer.trim()) {
            const parsed = parseSSEBlock(buffer);
            if (parsed) yield parsed;
        }
    } finally {
        reader.releaseLock();
    }
}

function parseSSEBlock(block: string): AgentStreamEvent | null {
    let eventType = 'message';
    let dataLine = '';

    for (const line of block.split('\n')) {
        if (line.startsWith('event: ')) eventType = line.slice(7).trim();
        else if (line.startsWith('data: ')) dataLine = line.slice(6);
    }

    if (!dataLine) return null;

    let data: any;
    try {
        data = JSON.parse(dataLine);
    } catch {
        data = dataLine;
    }
    return { event: eventType, data };
}

/**
 * Extract readable text from an agent gateway response.
 *
 * The Portal Gateway returns `{ output, session_id, events }`. The `output`
 * field is normally a string, but falls back to the raw ADK event stream
 * (an array) when the gateway couldn't extract text server-side. This
 * function handles both cases plus several legacy/edge-case shapes.
 *
 * Import this in custom agent UIs that don't use the chat composable:
 * ```ts
 * import { extractAgentText } from '~/composables/useAgentChat';
 * const text = extractAgentText(response.output);
 * ```
 */
export function extractAgentText(output: any): string {
    if (typeof output === 'string') return output;

    // ADK event stream: array of events (objects or JSON strings)
    if (Array.isArray(output)) {
        const text = extractTextFromEventStream(output);
        if (text) return text;
    }

    // Single event object with content.parts[]
    if (output?.content?.parts) {
        const text = extractTextFromEventStream([output]);
        if (text) return text;
    }

    // Other common shapes from Agent Engine
    if (output?.text) return output.text;
    if (output?.content)
        return typeof output.content === 'string'
            ? output.content
            : JSON.stringify(output.content, null, 2);
    if (output?.messages) {
        const last = output.messages[output.messages.length - 1];
        if (last?.parts?.[0]?.text) return last.parts[0].text;
        if (last?.content) return last.content;
    }
    if (output?.output) return extractAgentText(output.output);

    return JSON.stringify(output, null, 2);
}

/**
 * Walk an ADK event stream and return the last text part that isn't a
 * tool call or tool response. Events may be JSON strings or objects.
 */
function extractTextFromEventStream(events: any[]): string {
    let lastText = '';
    for (const raw of events) {
        const evt = typeof raw === 'string' ? safeJsonParse(raw) : raw;
        if (!evt || typeof evt !== 'object') continue;
        const parts: any[] = evt.content?.parts || [];
        for (const part of parts) {
            if (
                part.text &&
                !part.functionCall &&
                !part.function_call &&
                !part.functionResponse &&
                !part.function_response
            ) {
                lastText = part.text;
            }
        }
    }
    return lastText;
}

function safeJsonParse(str: string): any {
    try {
        return JSON.parse(str);
    } catch {
        return null;
    }
}
