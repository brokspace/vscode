// Brokspace for VS Code. SPDX-License-Identifier: MIT OR Apache-2.0

/**
 * Saved chat conversations: the pure logic (titles, search, interrupted
 * turns, the stored format). The extension keeps them in the workspace's own
 * storage, so one workspace never sees another's conversations. They are not
 * memories: `brok memory` keeps its own copy of a session when it is enabled.
 */

import type { ChatTurn } from '../webview-protocol';
import { settle } from './activity';

export interface StoredSession {
    id: string;
    title: string;
    /** Milliseconds since the epoch. */
    updatedAt: number;
    turns: ChatTurn[];
}

export interface SessionSummary {
    id: string;
    title: string;
    updatedAt: number;
    turns: number;
}

/** What is written to the workspace storage; `version` lets a later format migrate. */
export interface StoredHistory {
    version: 1;
    sessions: StoredSession[];
}

export const MAX_SESSIONS = 100;
export const INTERRUPTED = 'Interrupted: the conversation was closed before this answer finished.';

/** A title from the first prompt: one line, 60 characters at most. */
export function titleFrom(question: string): string {
    const line = question.trim().split('\n')[0]?.replace(/\s+/g, ' ') ?? '';
    return line.length > 60 ? `${line.slice(0, 59).trimEnd()}…` : line || 'Chat';
}

/** Reads what was stored; anything unrecognized (or from the future) is an empty history, never a crash. */
export function readHistory(raw: unknown): StoredSession[] {
    if (!raw || typeof raw !== 'object' || (raw as StoredHistory).version !== 1 || !Array.isArray((raw as StoredHistory).sessions)) {
        return [];
    }
    return (raw as StoredHistory).sessions.filter(
        (session) =>
            session &&
            typeof session.id === 'string' &&
            typeof session.title === 'string' &&
            typeof session.updatedAt === 'number' &&
            Array.isArray(session.turns),
    );
}

export function writeHistory(sessions: StoredSession[]): StoredHistory {
    return { version: 1, sessions };
}

/** A turn that never finished (the window closed mid-answer) becomes a failed turn instead of vanishing or spinning forever. */
export function markInterrupted(turns: ChatTurn[], reason: string = INTERRUPTED): ChatTurn[] {
    return turns.map((turn) => {
        const steps = turn.steps && settle(turn.steps);
        return turn.done ? { ...turn, steps } : { ...turn, steps, done: true, error: turn.error ?? reason };
    });
}

/** Adds or replaces a session, newest first, keeping at most `MAX_SESSIONS`. A renamed session keeps its title. */
export function upsert(sessions: StoredSession[], session: StoredSession): StoredSession[] {
    const kept = sessions.find((existing) => existing.id === session.id);
    const merged = kept ? { ...session, title: kept.title } : session;
    return [merged, ...sessions.filter((existing) => existing.id !== session.id)].slice(0, MAX_SESSIONS);
}

export function rename(sessions: StoredSession[], id: string, title: string): StoredSession[] {
    const clean = title.trim().replace(/\s+/g, ' ');
    return clean ? sessions.map((session) => (session.id === id ? { ...session, title: clean } : session)) : sessions;
}

export function remove(sessions: StoredSession[], id: string): StoredSession[] {
    return sessions.filter((session) => session.id !== id);
}

/** Sessions whose title, or any question or answer, contains every word of `query` (case insensitive). */
export function search(sessions: StoredSession[], query: string): StoredSession[] {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) {
        return sessions;
    }
    return sessions.filter((session) => {
        const text = [session.title, ...session.turns.flatMap((turn) => [turn.question, turn.answer])].join('\n').toLowerCase();
        return words.every((word) => text.includes(word));
    });
}

export function summarize(session: StoredSession): SessionSummary {
    return { id: session.id, title: session.title, updatedAt: session.updatedAt, turns: session.turns.length };
}
