// Brokspace for VS Code. SPDX-License-Identifier: MIT OR Apache-2.0

import type { AnswerRequest, ConversationTurn, MemoryInput, SourceRef } from './protocol';

/** Characters of each answer kept in a session memory. */
const SESSION_ANSWER_CHARS = 1_200;

/** `path:start-end`, the way sources are cited. */
export function cite(source: Pick<SourceRef, 'path' | 'start_line' | 'end_line'>): string {
    return `${source.path}:${source.start_line}-${source.end_line}`;
}

/** One question and its answer, for a session memory. */
export interface SessionTurn {
    question: string;
    answer: string;
    sources: string[];
}

/**
 * The memory of a chat session: its questions, the start of each answer and
 * the sources, so later sessions can build on it. Saved again (same id)
 * after every answer.
 */
export function sessionMemory(sessionId: string, turns: SessionTurn[]): MemoryInput | undefined {
    if (!turns.length) {
        return undefined;
    }
    const body = turns
        .map((turn) => {
            const answer =
                turn.answer.length > SESSION_ANSWER_CHARS ? `${turn.answer.slice(0, SESSION_ANSWER_CHARS).trimEnd()}…` : turn.answer.trim();
            const sources = turn.sources.length ? `\n\nSources: ${turn.sources.map((source) => `\`${source}\``).join(', ')}` : '';
            return `### ${turn.question}\n\n${answer}${sources}`;
        })
        .join('\n\n');
    return {
        id: `session-${sessionId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64)}`,
        title: oneLine(turns[0].question, 90),
        body,
        kind: 'session',
        scope: 'private',
        tags: ['chat'],
    };
}

/** Slash commands map to brok commands; anything else is a question. */
export function parseRequest(text: string, history: ConversationTurn[] = []): AnswerRequest {
    const [command, ...rest] = text.trim().split(/\s+/);
    switch (command?.toLowerCase()) {
        case '/review': {
            const [mode, ref] = rest;
            if (mode === 'staged' || mode === '--staged') {
                return { kind: 'review', staged: true };
            }
            if ((mode === 'base' || mode === '--base') && ref) {
                return { kind: 'review', base: ref };
            }
            return { kind: 'review' };
        }
        case '/staged':
            return { kind: 'review', staged: true };
        case '/skill': {
            const [name, ...input] = rest;
            if (name) {
                return { kind: 'skill', name, input: input.join(' ') };
            }
            break;
        }
    }
    return { kind: 'ask', prompt: text.trim(), history };
}

/** The LLM could not be reached or is not configured: worth answering from the index instead. */
export function llmUnavailable(message: string): boolean {
    return /no answer from the agent|connection refused|not reachable|no LLM|llm/i.test(message);
}

/** The last cause of an error brok chained with ': ' ("Connection refused (os error 111)"). */
export function lastCause(message: string): string {
    return message.split(': ').pop() ?? message;
}

/** `42 ms`, `1.8 s`, `2.5 min`. */
export function formatMs(ms: number): string {
    if (ms < 1_000) {
        return `${Math.round(ms)} ms`;
    }
    return ms < 60_000 ? `${(ms / 1_000).toFixed(1)} s` : `${(ms / 60_000).toFixed(1)} min`;
}

/** How long ago `iso` was: `today`, a number of days or weeks, or the date. */
export function age(iso: string, now = Date.now()): { unit: 'today' | 'days' | 'weeks' | 'date'; value: string } {
    const days = Math.floor((now - Date.parse(iso)) / 86_400_000);
    if (!Number.isFinite(days)) {
        return { unit: 'date', value: '' };
    }
    if (days < 1) {
        return { unit: 'today', value: '' };
    }
    if (days < 14) {
        return { unit: 'days', value: String(days) };
    }
    if (days < 60) {
        return { unit: 'weeks', value: String(Math.floor(days / 7)) };
    }
    return { unit: 'date', value: iso.slice(0, 10) };
}

/** `../checkout`, `https://github.com/acme/checkout.git` -> `checkout` */
export function suggestName(target: string): string {
    const last =
        target
            .trim()
            .replace(/[\\/]+$/, '')
            .split(/[\\/:]/)
            .pop() ?? '';
    return last
        .replace(/\.git$/, '')
        .replace(/[^A-Za-z0-9._-]/g, '-')
        .replace(/^[.-]+/, '')
        .slice(0, 64);
}

/** Whether a link target is a git URL rather than a folder. */
export function isGitUrl(target: string): boolean {
    return /:\/\/|^git@|\.git$/.test(target.trim());
}

/** The first line that says something (no blanks, headings markers or comment markers). */
export function firstLine(text: string): string {
    return (
        text
            .split('\n')
            .map((line) => line.replace(/^[#>*\-\s]+/, '').trim())
            .find((line) => line && !/^(\/\/|\/\*|\*)/.test(line)) ?? ''
    );
}

export function oneLine(text: string, max: number): string {
    const line = text.replace(/\s+/g, ' ').trim();
    return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/** The last few lines of a command's output, for a bug report. */
export function lastLines(output: string, count = 12): string {
    return output
        .split(/\r?\n/)
        .filter((line) => line.trim())
        .slice(-count)
        .join('\n');
}
