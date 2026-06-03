import { describe, it, expect } from 'vitest';
import { judgeAnswer } from '~/server/utils/queryAgent';
import { describeExpectation, type AnswerExpectation } from '~/types/queryrunner';

describe('judgeAnswer — string expectations', () => {
    it('exact match is case- and whitespace-sensitive (trims only)', () => {
        const exp: AnswerExpectation = { kind: 'string', value: 'Apple Inc.', match: 'exact' };
        expect(judgeAnswer('Apple Inc.', exp).pass).toBe(true);
        expect(judgeAnswer('  Apple Inc.  ', exp).pass).toBe(true); // trimmed
        expect(judgeAnswer('apple inc.', exp).pass).toBe(false); // case differs
    });

    it('iexact ignores case', () => {
        const exp: AnswerExpectation = { kind: 'string', value: 'AAPL', match: 'iexact' };
        expect(judgeAnswer('aapl', exp).pass).toBe(true);
        expect(judgeAnswer('AAPL', exp).pass).toBe(true);
        expect(judgeAnswer('AAPL.US', exp).pass).toBe(false);
    });

    it('icontains is a case-insensitive substring test', () => {
        const exp: AnswerExpectation = {
            kind: 'string',
            value: 'United States',
            match: 'icontains',
        };
        expect(judgeAnswer('United States of America', exp).pass).toBe(true);
        expect(judgeAnswer('the united states', exp).pass).toBe(true);
        expect(judgeAnswer('Canada', exp).pass).toBe(false);
    });

    it('null answer never passes a string expectation and reports (no answer)', () => {
        const exp: AnswerExpectation = { kind: 'string', value: 'x', match: 'icontains' };
        const r = judgeAnswer(null, exp);
        expect(r.pass).toBe(false);
        expect(r.actual).toBe('(no answer)');
    });

    it('a numeric answer is stringified before string comparison', () => {
        const exp: AnswerExpectation = { kind: 'string', value: '42', match: 'exact' };
        expect(judgeAnswer(42, exp).pass).toBe(true);
    });
});

describe('judgeAnswer — number expectations', () => {
    it('equals within optional tolerance', () => {
        expect(judgeAnswer(100, { kind: 'number', value: 100 }).pass).toBe(true);
        expect(judgeAnswer(101, { kind: 'number', value: 100 }).pass).toBe(false);
        expect(judgeAnswer(101, { kind: 'number', value: 100, tolerance: 2 }).pass).toBe(true);
        expect(judgeAnswer(103, { kind: 'number', value: 100, tolerance: 2 }).pass).toBe(false);
    });

    it('coerces numeric strings (commas / units / surrounding prose stripped)', () => {
        const exp: AnswerExpectation = { kind: 'number', value: 1234, tolerance: 0 };
        expect(judgeAnswer('1,234', exp).pass).toBe(true);
        expect(judgeAnswer('$1,234', exp).pass).toBe(true);
        expect(judgeAnswer('about 1234 employees', exp).pass).toBe(true);
    });

    it('handles decimals and scientific notation', () => {
        expect(judgeAnswer('3.14', { kind: 'number', value: 3.14 }).pass).toBe(true);
        expect(judgeAnswer('1e3', { kind: 'number', value: 1000 }).pass).toBe(true);
    });

    it('non-numeric answer fails a number expectation', () => {
        expect(judgeAnswer('not a number', { kind: 'number', value: 1 }).pass).toBe(false);
        expect(judgeAnswer(null, { kind: 'number', value: 1 }).pass).toBe(false);
    });
});

describe('judgeAnswer — number_range expectations', () => {
    it('respects min and max bounds (inclusive)', () => {
        const exp: AnswerExpectation = { kind: 'number_range', min: 1, max: 10 };
        expect(judgeAnswer(1, exp).pass).toBe(true);
        expect(judgeAnswer(10, exp).pass).toBe(true);
        expect(judgeAnswer(0, exp).pass).toBe(false);
        expect(judgeAnswer(11, exp).pass).toBe(false);
    });

    it('open-ended bounds when min or max omitted', () => {
        expect(judgeAnswer(99999, { kind: 'number_range', min: 1 }).pass).toBe(true);
        expect(judgeAnswer(0, { kind: 'number_range', min: 1 }).pass).toBe(false);
        expect(judgeAnswer(-5, { kind: 'number_range', max: 0 }).pass).toBe(true);
    });

    it('non-numeric answer fails a range expectation', () => {
        expect(judgeAnswer('lots', { kind: 'number_range', min: 1 }).pass).toBe(false);
    });
});

describe('describeExpectation', () => {
    it('renders human-readable labels for each kind', () => {
        expect(describeExpectation({ kind: 'string', value: 'X', match: 'exact' })).toBe('= "X"');
        expect(describeExpectation({ kind: 'string', value: 'X', match: 'iexact' })).toBe(
            '= "X" (any case)'
        );
        expect(describeExpectation({ kind: 'string', value: 'X', match: 'icontains' })).toBe(
            'contains "X"'
        );
        expect(describeExpectation({ kind: 'number', value: 5 })).toBe('= 5');
        expect(describeExpectation({ kind: 'number', value: 5, tolerance: 1 })).toBe('5 ± 1');
        expect(describeExpectation({ kind: 'number_range', min: 1, max: 10 })).toBe(
            'between 1 and 10'
        );
        expect(describeExpectation({ kind: 'number_range', min: 1 })).toContain('1');
    });
});
