// Brokspace for VS Code. SPDX-License-Identifier: MIT OR Apache-2.0

import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { matchSlash, parseLocalCommand, type SlashEntry, stepHistory } from '../../src/core/composer';
import { parseRequest } from '../../src/core/text';

const entries: SlashEntry[] = [
    { insert: '/review', args: false },
    { insert: '/review staged', args: false },
    { insert: '/review base ', args: true },
    { insert: '/search ', args: true },
    { insert: '/remember ', args: true },
    { insert: '/skill ', args: true },
];
const inserts = (draft: string) => matchSlash(entries, draft).map((entry) => entry.insert);

describe('slash commands in the composer', () => {
    it('offers every command for a lone slash and narrows as you type', () => {
        assert.equal(inserts('/').length, entries.length);
        assert.deepEqual(inserts('/re'), ['/review', '/review staged', '/review base ', '/remember ']);
        assert.deepEqual(inserts('/REV'), ['/review', '/review staged', '/review base ']);
        assert.deepEqual(inserts('/review s'), ['/review staged']);
    });

    it('offers nothing for ordinary text, multiline text or arguments already typed', () => {
        assert.deepEqual(inserts('how do I review'), []);
        assert.deepEqual(inserts('/search\nmore'), []);
        assert.deepEqual(inserts('/search where is auth'), []);
        assert.deepEqual(inserts(''), []);
    });

    it('lets Enter send a complete command that takes no arguments, but keeps completing one that does', () => {
        assert.deepEqual(inserts('/review staged'), []);
        assert.deepEqual(inserts('/review'), ['/review staged', '/review base ']);
        assert.deepEqual(inserts('/search'), ['/search ']);
    });

    it('parses /search and /remember without touching the existing commands', () => {
        assert.deepEqual(parseLocalCommand('/search where do we validate tokens'), {
            command: 'search',
            argument: 'where do we validate tokens',
        });
        assert.deepEqual(parseLocalCommand('/Remember  Orders are idempotent '), {
            command: 'remember',
            argument: 'Orders are idempotent',
        });
        assert.deepEqual(parseLocalCommand('/search'), { command: 'search', argument: '' });
        for (const text of ['/review', '/review staged', '/skill x y', 'search the code', '/searching']) {
            assert.equal(parseLocalCommand(text), undefined, text);
        }
        assert.deepEqual(parseRequest('/review staged'), { kind: 'review', staged: true });
        assert.deepEqual(parseRequest('/skill code-review the diff'), { kind: 'skill', name: 'code-review', input: 'the diff' });
        assert.equal(parseRequest('how does it work').kind, 'ask');
    });

    it('walks the earlier prompts and stops at both ends', () => {
        const prompts = ['one', 'two', 'three'];
        assert.equal(stepHistory(prompts, 3, 'up'), 2);
        assert.equal(stepHistory(prompts, 0, 'up'), 0);
        assert.equal(stepHistory(prompts, 2, 'down'), 3);
        assert.equal(stepHistory(prompts, 3, 'down'), 3);
    });
});
