// Brokspace for VS Code. SPDX-License-Identifier: MIT OR Apache-2.0

import * as assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import { cleanError, isAtLeast, parseEvent, parseShardInfo, resolveBrok } from '../../src/core/brok';
import { resolveHitPath } from '../../src/core/paths';
import {
    age,
    cite,
    firstLine,
    formatMs,
    isGitUrl,
    lastCause,
    lastLines,
    llmUnavailable,
    parseRequest,
    sessionMemory,
    suggestName,
} from '../../src/core/text';

describe('brok output', () => {
    it('keeps the message of `error:` lines', () => {
        assert.equal(cleanError('Indexing...\nerror: no Brokspace workspace found in /x\n'), 'no Brokspace workspace found in /x');
        assert.equal(cleanError('plain failure\n'), 'plain failure');
        assert.equal(cleanError(''), '');
    });

    it('reads answer events and skips anything else', () => {
        assert.deepEqual(parseEvent('{"type":"chunk","text":"Hi"}'), { type: 'chunk', text: 'Hi' });
        assert.equal(parseEvent('Starting brok in the background'), undefined);
        assert.equal(parseEvent('42'), undefined);
    });

    it('parses `brok shard info`', () => {
        const details = parseShardInfo(
            [
                '{',
                '  "name": "brok-agent",',
                '  "version": "0.2.1",',
                '  "description": "The agent",',
                '  "permissions": { "network": true }',
                '}',
                'source:   github:brokspace/brok-agent@v0.2.1',
                'binary:   none (skills only)',
                'skills:   code-review',
                'skills:   tdd',
            ].join('\n'),
        );
        assert.equal(details.manifest.name, 'brok-agent');
        assert.equal(details.source, 'github:brokspace/brok-agent@v0.2.1');
        assert.equal(details.binary, undefined);
        assert.deepEqual(details.skills, ['code-review', 'tdd']);
    });

    it('compares versions', () => {
        assert.ok(isAtLeast('0.4.0', '0.4.0'));
        assert.ok(isAtLeast('0.10.1', '0.4.0'));
        assert.ok(!isAtLeast('0.3.9', '0.4.0'));
        assert.ok(isAtLeast(undefined, '0.4.0'));
        assert.ok(isAtLeast('1.0.0-rc.1', '0.4.0'));
    });

    it('prefers the configured brok', () => {
        assert.equal(resolveBrok(' /opt/brok/brok ', {}), '/opt/brok/brok');
        assert.equal(resolveBrok('', { BROK_PATH: '/env/brok' }), '/env/brok');
    });
});

describe('paths', () => {
    it('resolves hits against the workspace, linked workspaces and global memories', () => {
        const root = path.join(os.tmpdir(), 'ws', 'user');
        assert.equal(resolveHitPath(root, 'src/a.ts'), path.join(root, 'src', 'a.ts'));
        assert.equal(resolveHitPath(root, '../checkout/src/b.ts'), path.join(os.tmpdir(), 'ws', 'checkout', 'src', 'b.ts'));
        const absolute = path.join(os.tmpdir(), 'memory', 'm.md');
        assert.equal(resolveHitPath(root, absolute), absolute);
    });
});

describe('requests', () => {
    it('maps slash commands to brok commands', () => {
        assert.deepEqual(parseRequest('/review'), { kind: 'review' });
        assert.deepEqual(parseRequest('/review staged'), { kind: 'review', staged: true });
        assert.deepEqual(parseRequest('/staged'), { kind: 'review', staged: true });
        assert.deepEqual(parseRequest('/review base main'), { kind: 'review', base: 'main' });
        assert.deepEqual(parseRequest('/skill tdd add a field'), { kind: 'skill', name: 'tdd', input: 'add a field' });
        const history = [{ role: 'user' as const, content: 'q' }];
        assert.deepEqual(parseRequest('  how does it work? ', history), { kind: 'ask', prompt: 'how does it work?', history });
        assert.equal(parseRequest('/skill').kind, 'ask');
    });

    it('tells an unreachable LLM from other failures', () => {
        assert.ok(llmUnavailable('no answer from the agent. Check `brok doctor`'));
        assert.ok(llmUnavailable('error sending request: Connection refused (os error 111)'));
        assert.ok(!llmUnavailable('no Brokspace workspace found'));
        assert.equal(lastCause('ask: request: Connection refused'), 'Connection refused');
    });
});

describe('session memories', () => {
    it('summarizes a conversation, with a stable id per session', () => {
        const memory = sessionMemory('abc-123!', [
            { question: 'How does   refresh work?', answer: 'Tokens rotate.', sources: ['src/auth.ts:1-9'] },
            { question: 'And reuse?', answer: 'x'.repeat(2_000), sources: [] },
        ]);
        assert.ok(memory);
        assert.equal(memory.id, 'session-abc-123');
        assert.equal(memory.title, 'How does refresh work?');
        assert.equal(memory.kind, 'session');
        assert.ok(memory.body?.includes('### How does   refresh work?\n\nTokens rotate.\n\nSources: `src/auth.ts:1-9`'));
        assert.ok(memory.body?.includes('…'), 'long answers are cut');
        assert.equal(sessionMemory('s', []), undefined);
    });
});

describe('formatting', () => {
    it('formats durations, ages and names', () => {
        assert.equal(formatMs(42), '42 ms');
        assert.equal(formatMs(1_800), '1.8 s');
        assert.equal(formatMs(150_000), '2.5 min');
        const now = Date.parse('2026-11-14T12:00:00Z');
        assert.deepEqual(age('2026-11-14T08:00:00Z', now), { unit: 'today', value: '' });
        assert.deepEqual(age('2026-11-10T08:00:00Z', now), { unit: 'days', value: '4' });
        assert.deepEqual(age('2026-10-10T08:00:00Z', now), { unit: 'weeks', value: '5' });
        assert.deepEqual(age('2026-01-10T08:00:00Z', now), { unit: 'date', value: '2026-01-10' });
        assert.equal(suggestName('../checkout/'), 'checkout');
        assert.equal(suggestName('https://github.com/acme/payments.git'), 'payments');
        assert.equal(suggestName('C:\\code\\.hidden'), 'hidden');
        assert.ok(isGitUrl('git@github.com:acme/x.git'));
        assert.ok(!isGitUrl('../checkout'));
        assert.equal(firstLine('\n# Title\n// comment\nbody'), 'Title');
        assert.equal(cite({ path: 'a.ts', start_line: 1, end_line: 3 }), 'a.ts:1-3');
        assert.equal(lastLines('a\n\nb\nc\n', 2), 'b\nc');
    });
});
