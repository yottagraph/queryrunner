import { describe, it, expect } from 'vitest';
import { extractFencedJson, applyEvent, type AgentToolCall } from '~/server/utils/agentCall';
import { classifyAdkEvent, type AdkEvent } from '~/server/utils/adkEvents';

describe('extractFencedJson', () => {
    it('parses a fenced ```json block', () => {
        const text =
            'Here is the answer:\n```json\n{"answer": "Apple Inc.", "reasoning": "x"}\n```';
        expect(extractFencedJson(text)).toEqual({ answer: 'Apple Inc.', reasoning: 'x' });
    });

    it('parses a fence without a language tag', () => {
        expect(extractFencedJson('```\n{"answer": 42}\n```')).toEqual({ answer: 42 });
    });

    it('falls back to the first balanced top-level object when no fence is present', () => {
        const text = 'The answer is {"answer": 7, "reasoning": "counted"} — done.';
        expect(extractFencedJson(text)).toEqual({ answer: 7, reasoning: 'counted' });
    });

    it('handles nested braces and strings containing braces', () => {
        const text = '```json\n{"answer": "a {b} c", "meta": {"k": [1,2]}}\n```';
        expect(extractFencedJson(text)).toEqual({ answer: 'a {b} c', meta: { k: [1, 2] } });
    });

    it('returns null for empty input or no JSON', () => {
        expect(extractFencedJson('')).toBeNull();
        expect(extractFencedJson('no json at all')).toBeNull();
    });

    it('returns null when the fenced content is not valid JSON and there is no object', () => {
        expect(extractFencedJson('```json\nnot json\n```')).toBeNull();
    });
});

describe('classifyAdkEvent', () => {
    const wrap = (part: Record<string, unknown>): AdkEvent => ({ content: { parts: [part] } });

    it('classifies text parts', () => {
        expect(classifyAdkEvent(wrap({ text: 'hello' }))).toEqual({
            type: 'text',
            data: { text: 'hello' },
        });
    });

    it('classifies function calls (camelCase and snake_case)', () => {
        expect(
            classifyAdkEvent(
                wrap({ functionCall: { name: 'resolve_entity', args: { name: 'Apple' } } })
            )
        ).toEqual({
            type: 'function_call',
            data: { name: 'resolve_entity', args: { name: 'Apple' } },
        });
        expect(classifyAdkEvent(wrap({ function_call: { name: 'health', args: {} } }))).toEqual({
            type: 'function_call',
            data: { name: 'health', args: {} },
        });
    });

    it('classifies function responses and surfaces the response payload', () => {
        const evt = wrap({
            functionResponse: { name: 'resolve_entity', response: { neid: '001' } },
        });
        expect(classifyAdkEvent(evt)).toEqual({
            type: 'function_response',
            data: { name: 'resolve_entity', response: { neid: '001' } },
        });
    });

    it('returns null for empty / non-renderable events', () => {
        expect(classifyAdkEvent(null)).toBeNull();
        expect(classifyAdkEvent({ content: { parts: [] } })).toBeNull();
    });
});

describe('applyEvent — tool-call ↔ response pairing', () => {
    const mk = () => ({ text: '', toolCalls: [] as AgentToolCall[] });
    const call = (name: string, args: Record<string, unknown> = {}): AdkEvent => ({
        content: { parts: [{ functionCall: { name, args } }] },
    });
    const resp = (name: string, response: unknown): AdkEvent => ({
        content: { parts: [{ functionResponse: { name, response } }] },
    });

    it('attaches a response to its preceding call', () => {
        const acc = mk();
        applyEvent(call('resolve_entity', { name: 'Apple' }), acc);
        applyEvent(resp('resolve_entity', { neid: '001' }), acc);
        expect(acc.toolCalls).toHaveLength(1);
        expect(acc.toolCalls[0]).toEqual({
            name: 'resolve_entity',
            args: { name: 'Apple' },
            response: { neid: '001' },
        });
    });

    it('pairs distinct tools unambiguously regardless of interleaving', () => {
        const acc = mk();
        applyEvent(call('resolve_entity', { name: 'Apple' }), acc);
        applyEvent(resp('resolve_entity', { neid: '001' }), acc);
        applyEvent(call('count_linked_entities', { neid: '001' }), acc);
        applyEvent(resp('count_linked_entities', { count: 5 }), acc);
        expect(acc.toolCalls.map((t) => [t.name, t.response])).toEqual([
            ['resolve_entity', { neid: '001' }],
            ['count_linked_entities', { count: 5 }],
        ]);
    });

    it('same-name parallel calls pair best-effort to the most-recent unfilled (LIFO)', () => {
        // The ADK events carry only a tool NAME (no call id), so when two calls
        // to the SAME tool are issued before any response, association is
        // best-effort: each response binds to the most-recent still-unfilled
        // call. Sequential call→response (the common case) is unaffected.
        const acc = mk();
        applyEvent(call('get_entity_name', { neid: '1' }), acc);
        applyEvent(call('get_entity_name', { neid: '2' }), acc);
        applyEvent(resp('get_entity_name', { name: 'first' }), acc);
        applyEvent(resp('get_entity_name', { name: 'second' }), acc);
        // first response → index 1 (most recent unfilled); second → index 0
        expect(acc.toolCalls.map((t) => t.response)).toEqual([
            { name: 'second' },
            { name: 'first' },
        ]);
    });

    it('keeps the latest text part as the final text', () => {
        const acc = mk();
        applyEvent({ content: { parts: [{ text: 'thinking...' }] } }, acc);
        applyEvent({ content: { parts: [{ text: 'final answer' }] } }, acc);
        expect(acc.text).toBe('final answer');
    });

    it('a response with no matching call is ignored (no crash)', () => {
        const acc = mk();
        applyEvent(resp('orphan', { x: 1 }), acc);
        expect(acc.toolCalls).toHaveLength(0);
    });
});
