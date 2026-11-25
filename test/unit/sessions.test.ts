// Brokspace for VS Code. SPDX-License-Identifier: MIT OR Apache-2.0

import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    INTERRUPTED,
    MAX_SESSIONS,
    markInterrupted,
    readHistory,
    remove,
    rename,
    type StoredSession,
    search,
    summarize,
    titleFrom,
    upsert,
    writeHistory,
} from '../../src/core/sessions';
import type { ChatTurn } from '../../src/webview-protocol';

const turn = (question: string, answer: string, extra: Partial<ChatTurn> = {}): ChatTurn => ({
    id: question,
    question,
    kind: 'ask',
    answer,
    sources: [{ path: 'src/a.rs', start_line: 1, end_line: 3 } as ChatTurn['sources'][number]],
    done: true,
    ...extra,
});
const session = (id: string, title: string, turns: ChatTurn[] = [turn(title, 'an answer')], updatedAt = 1): StoredSession => ({
    id,
    title,
    updatedAt,
    turns,
});

describe('chat history', () => {
    it('titles a conversation from the first line of its first prompt', () => {
        assert.equal(titleFrom('  how does   the refresh\nflow work?  '), 'how does the refresh');
        assert.equal(titleFrom(''), 'Chat');
        assert.equal(titleFrom('x'.repeat(100)).length, 60);
    });

    it('persists and reads back the turns with their sources and model', () => {
        const stored = JSON.parse(JSON.stringify(writeHistory([session('a', 'First', [turn('q', 'a', { model: 'ollama/qwen' })])])));
        const [back] = readHistory(stored);
        assert.equal(back?.turns[0]?.model, 'ollama/qwen');
        assert.equal(back?.turns[0]?.sources[0]?.path, 'src/a.rs');
    });

    it('reads an unknown, future or damaged format as an empty history', () => {
        for (const raw of [undefined, null, 'x', {}, { version: 2, sessions: [] }, { version: 1, sessions: 'x' }]) {
            assert.deepEqual(readHistory(raw), []);
        }
        assert.equal(readHistory({ version: 1, sessions: [{ id: 1 }, session('ok', 'Fine')] }).length, 1);
    });

    it('lists the newest first, replaces a session and keeps its renamed title', () => {
        let all = upsert([], session('a', 'First'));
        all = upsert(all, session('b', 'Second'));
        all = rename(all, 'a', '  My   title ');
        all = upsert(all, session('a', 'First (updated)', [turn('q', 'later')], 5));
        assert.deepEqual(
            all.map((item) => item.id),
            ['a', 'b'],
        );
        assert.equal(all[0]?.title, 'My title');
        assert.equal(all[0]?.turns[0]?.answer, 'later');
    });

    it('keeps at most MAX_SESSIONS, dropping the oldest', () => {
        let all: StoredSession[] = [];
        for (let i = 0; i < MAX_SESSIONS + 5; i++) {
            all = upsert(all, session(`s${i}`, `T${i}`));
        }
        assert.equal(all.length, MAX_SESSIONS);
        assert.equal(all[0]?.id, `s${MAX_SESSIONS + 4}`);
    });

    it('does not rename to an empty title, and deletes by id', () => {
        const all = [session('a', 'Keep'), session('b', 'Drop')];
        assert.equal(rename(all, 'a', '   ')[0]?.title, 'Keep');
        assert.deepEqual(
            remove(all, 'b').map((item) => item.id),
            ['a'],
        );
    });

    it('searches titles and the content of questions and answers', () => {
        const all = [
            session('a', 'Billing', [turn('where is the invoice total', 'in billing.rs')]),
            session('b', 'Auth', [turn('login', 'tokens')]),
        ];
        assert.deepEqual(
            search(all, 'INVOICE billing').map((item) => item.id),
            ['a'],
        );
        assert.deepEqual(
            search(all, 'tokens').map((item) => item.id),
            ['b'],
        );
        assert.equal(search(all, 'nothing like this').length, 0);
        assert.equal(search(all, '  ').length, 2);
    });

    it('turns an unfinished answer into a failed one instead of losing it', () => {
        const [done, cut] = markInterrupted([turn('a', 'x'), turn('b', 'partial', { done: false })]);
        assert.equal(done?.error, undefined);
        assert.equal(cut?.done, true);
        assert.equal(cut?.error, INTERRUPTED);
        assert.equal(cut?.answer, 'partial');
    });

    it('summarizes without the content', () => {
        assert.deepEqual(summarize(session('a', 'T')), { id: 'a', title: 'T', updatedAt: 1, turns: 1 });
    });

    it('keeps one workspace out of another: the history is read only from what that workspace stored', () => {
        const a = readHistory(writeHistory([session('a', 'Mine')]));
        const b = readHistory(undefined);
        assert.equal(a.length, 1);
        assert.equal(b.length, 0);
    });
});
