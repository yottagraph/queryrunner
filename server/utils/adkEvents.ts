/**
 * Shared ADK event + stream parsing primitives.
 *
 * Both consumers of an ADK agent's output use these:
 *   - `server/api/agent/[agentId]/stream.post.ts` — the browser SSE route.
 *   - `server/utils/agentCall.ts` — the server-side one-shot helper.
 *
 * They consume native ADK `Event` objects from two transports:
 *   - In-cluster ADK `api_server` `/run_sse` → a `text/event-stream` of
 *     `data: <Event JSON>` blocks (newline-framed, simple).
 *   - Agent Engine `:streamQuery` → a concatenated JSON stream (array
 *     elements / bare values) with NO SSE framing, where a single value
 *     can be split across network chunks. That transport needs the
 *     tolerant incremental splitter below (`extractJsonValues`).
 *
 * Keep this module dependency-free so it is cheap to auto-import
 * server-side and trivial to unit-test.
 */

export interface AdkPart {
    text?: string;
    functionCall?: { name?: string; args?: Record<string, unknown> };
    function_call?: { name?: string; args?: Record<string, unknown> };
    functionResponse?: { name?: string; response?: unknown };
    function_response?: { name?: string; response?: unknown };
}

export interface AdkEvent {
    content?: { parts?: AdkPart[] };
    [k: string]: unknown;
}

export type ClassifiedAdkEvent =
    | { type: 'text'; data: { text: string } }
    | { type: 'function_call'; data: { name: string; args: Record<string, unknown> } }
    | { type: 'function_response'; data: { name: string; response: unknown } };

/**
 * Map a raw ADK Event to the chat UI's event vocabulary. Returns the first
 * meaningful part (function call → function response → text) or `null` when
 * the event carries nothing renderable (e.g. a bare control event). ADK
 * emits both camelCase (`functionCall`) and snake_case (`function_call`)
 * depending on transport, so both are accepted.
 */
export function classifyAdkEvent(evt: AdkEvent | null | undefined): ClassifiedAdkEvent | null {
    if (!evt || typeof evt !== 'object') return null;
    const parts = evt.content?.parts ?? [];
    for (const part of parts) {
        const fc = part.functionCall || part.function_call;
        if (fc) {
            return { type: 'function_call', data: { name: fc.name || '', args: fc.args || {} } };
        }
        const fr = part.functionResponse || part.function_response;
        if (fr) {
            return {
                type: 'function_response',
                data: { name: fr.name || '', response: fr.response },
            };
        }
        if (part.text) {
            return { type: 'text', data: { text: part.text } };
        }
    }
    return null;
}

/** Parse a raw value that may already be an object or a JSON string. */
export function parseAdkEvent(raw: unknown): AdkEvent {
    if (typeof raw === 'string') {
        try {
            return JSON.parse(raw) as AdkEvent;
        } catch {
            return {} as AdkEvent;
        }
    }
    return (raw as AdkEvent) || ({} as AdkEvent);
}

/**
 * Incrementally pull complete JSON values (objects or quoted strings) out
 * of a buffer that may end mid-value. Returns the parsed values plus the
 * unconsumed remainder to prepend to the next chunk. Tolerant of the array
 * framing (`[`, `,`, `]`, whitespace) Agent Engine emits between elements.
 */
export function extractJsonValues(buffer: string): { objects: unknown[]; remainder: string } {
    const objects: unknown[] = [];
    let i = 0;
    while (i < buffer.length) {
        while (i < buffer.length && /[\s,[\]]/.test(buffer[i])) i++;
        if (i >= buffer.length) break;
        if (buffer[i] === '{') {
            const end = findMatchingBrace(buffer, i);
            if (end < 0) break;
            try {
                objects.push(JSON.parse(buffer.slice(i, end + 1)));
            } catch {
                /* skip malformed slice */
            }
            i = end + 1;
        } else if (buffer[i] === '"') {
            const end = findStringEnd(buffer, i);
            if (end < 0) break;
            try {
                objects.push(JSON.parse(buffer.slice(i, end + 1)));
            } catch {
                /* skip malformed slice */
            }
            i = end + 1;
        } else {
            break;
        }
    }
    return { objects, remainder: buffer.slice(i) };
}

/** Index of the `}` that closes the `{` at `start`, or -1 if incomplete. */
export function findMatchingBrace(buf: string, start: number): number {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let j = start; j < buf.length; j++) {
        if (esc) {
            esc = false;
            continue;
        }
        if (buf[j] === '\\' && inStr) {
            esc = true;
            continue;
        }
        if (buf[j] === '"') {
            inStr = !inStr;
            continue;
        }
        if (inStr) continue;
        if (buf[j] === '{') depth++;
        if (buf[j] === '}') {
            depth--;
            if (depth === 0) return j;
        }
    }
    return -1;
}

/** Index of the closing `"` of the string starting at `start`, or -1. */
export function findStringEnd(buf: string, start: number): number {
    let esc = false;
    for (let j = start + 1; j < buf.length; j++) {
        if (esc) {
            esc = false;
            continue;
        }
        if (buf[j] === '\\') {
            esc = true;
            continue;
        }
        if (buf[j] === '"') return j;
    }
    return -1;
}
