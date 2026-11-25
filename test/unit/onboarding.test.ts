// Brokspace for VS Code. SPDX-License-Identifier: MIT OR Apache-2.0

import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { checklist, emptyProgress, isActive, readProgress } from '../../src/core/onboarding';
import type { BrokspaceState } from '../../src/webview-protocol';

const info = { found: true, path: 'brok', version: '0.6.0' };
const ready = (llm?: string): BrokspaceState => ({
    kind: 'ready',
    info,
    status: {
        version: '0.6.0',
        initialized: true,
        llm: llm ? { provider: llm } : undefined,
        memory: { enabled: true, sessions: true, global: false, counts: { private: 0, shared: 0, global: 0 } },
    },
});
const status = (steps: ReturnType<typeof checklist>, id: string) => steps.find((s) => s.id === id)?.status;

test('a fresh install walks the required steps in order', () => {
    const progress = emptyProgress();
    assert.equal(status(checklist({ kind: 'no-brok', info: { ...info, found: false } }, progress), 'local'), 'current');
    const acknowledged = { ...progress, acknowledged: true };
    assert.equal(status(checklist({ kind: 'no-brok', info: { ...info, found: false } }, acknowledged), 'brok'), 'current');
    assert.equal(status(checklist({ kind: 'no-folder' }, acknowledged), 'folder'), 'current');
    assert.equal(status(checklist({ kind: 'not-initialized', info }, acknowledged), 'workspace'), 'current');
    assert.equal(status(checklist(ready(), acknowledged), 'first'), 'current');
});

test('an existing install and workspace are detected as done', () => {
    const steps = checklist(ready('ollama'), { ...emptyProgress(), acknowledged: true });
    for (const id of ['brok', 'folder', 'workspace', 'model']) {
        assert.equal(status(steps, id), 'done');
    }
});

test('optional steps never block and can be skipped', () => {
    const progress = { ...emptyProgress(), acknowledged: true, skipped: ['model' as const] };
    const steps = checklist(ready(), progress);
    assert.equal(status(steps, 'model'), 'skipped');
    assert.equal(status(steps, 'first'), 'current');
    assert.equal(status(checklist(ready(), { ...progress, skipped: [] }), 'model'), 'todo');
});

test('an outdated brok is not done', () => {
    assert.equal(status(checklist({ kind: 'outdated', info }, { ...emptyProgress(), acknowledged: true }), 'brok'), 'current');
});

test('the checklist goes away after the first answer or when closed', () => {
    assert.equal(isActive(ready(), emptyProgress()), true);
    assert.equal(isActive(ready(), { ...emptyProgress(), firstAnswer: true }), false);
    assert.equal(isActive({ kind: 'no-folder' }, { ...emptyProgress(), firstAnswer: true }), true);
    assert.equal(isActive(ready(), { ...emptyProgress(), dismissed: true }), false);
    assert.equal(isActive({ kind: 'loading' }, emptyProgress()), false);
});

test('stored progress ignores garbage', () => {
    assert.deepEqual(readProgress(null), emptyProgress());
    assert.deepEqual(readProgress({ version: 2 }), emptyProgress());
    assert.deepEqual(readProgress({ version: 1, acknowledged: true, skipped: ['model', 'nope', 3] }).skipped, ['model']);
});
