/**
 * Per-query stack log capture.
 *
 * The local QueryRunner stack is three processes — the Nuxt UI server, the
 * `adk api_server` agent, and the `elemental-query` MCP — each tailing its
 * output to a logfile under `QUERYRUNNER_STACK_LOG_DIR` (default
 * `.aether-dev-logs/`). To attach "what each part of the stack did" to a query
 * trace, we don't parse timestamps: we record each logfile's byte length right
 * before the agent runs (`snapshotStackLogOffsets`) and read whatever got
 * appended once it finishes (`collectStackLogsSince`). Because queries run
 * serially in local dev, that delta is exactly this query's log lines.
 *
 * Everything degrades gracefully: a missing logfile (e.g. in a deployed
 * environment that logs to Cloud Logging instead) is simply skipped, so the
 * trace just carries fewer sources.
 */
import { existsSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';
import type { StackLog } from '~/types/queryrunner';

interface LogSource {
    source: string;
    label: string;
    file: string;
}

/** Cap the appended window we read per source, so a chatty process can't bloat a trace. */
const MAX_BYTES = 96 * 1024;
const MAX_LINES = 500;
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;

function logSources(): LogSource[] {
    const dir = process.env.QUERYRUNNER_STACK_LOG_DIR || '.aether-dev-logs';
    const base = resolve(process.cwd(), dir);
    return [
        { source: 'ui', label: 'UI server (Nuxt / Nitro)', file: resolve(base, 'ui.log') },
        { source: 'agent', label: 'Agent (adk api_server)', file: resolve(base, 'agent.log') },
        { source: 'mcp', label: 'elemental-query MCP', file: resolve(base, 'mcp.log') },
    ];
}

function fileSize(file: string): number {
    try {
        return existsSync(file) ? statSync(file).size : 0;
    } catch {
        return 0;
    }
}

/** Byte length of every source logfile right now (the "before the query" mark). */
export function snapshotStackLogOffsets(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const s of logSources()) out[s.source] = fileSize(s.file);
    return out;
}

/** Read bytes [from, size) of a file as UTF-8 text. */
function readRange(file: string, from: number, size: number): string {
    const len = size - from;
    if (len <= 0) return '';
    const fd = openSync(file, 'r');
    try {
        const buf = Buffer.allocUnsafe(len);
        const read = readSync(fd, buf, 0, len, from);
        return buf.toString('utf8', 0, read);
    } finally {
        closeSync(fd);
    }
}

/**
 * For each source, return the log lines appended since `offsets` was taken.
 * Sources whose logfile no longer exists are skipped entirely; ones that exist
 * but produced nothing yield an empty `lines` array (so the UI can still show
 * "no output").
 */
export function collectStackLogsSince(offsets: Record<string, number>): StackLog[] {
    const result: StackLog[] = [];
    for (const s of logSources()) {
        if (!existsSync(s.file)) continue;
        const log: StackLog = { source: s.source, label: s.label, lines: [] };
        try {
            const size = fileSize(s.file);
            // Clamp the start: a rotated/truncated file resets the offset.
            const start = Math.min(Math.max(offsets[s.source] ?? 0, 0), size);
            let from = start;
            let windowTruncated = false;
            if (size - from > MAX_BYTES) {
                from = size - MAX_BYTES;
                windowTruncated = true;
            }
            const text = readRange(s.file, from, size).replace(ANSI, '');
            let lines = text.split('\n');
            if (lines.length && lines[lines.length - 1] === '') lines.pop();
            if (lines.length > MAX_LINES) {
                lines = lines.slice(-MAX_LINES);
                windowTruncated = true;
            }
            if (windowTruncated) lines.unshift('… (earlier lines truncated)');
            log.lines = lines;
        } catch (e) {
            log.note = `couldn't read log: ${(e as Error).message}`;
        }
        result.push(log);
    }
    return result;
}
