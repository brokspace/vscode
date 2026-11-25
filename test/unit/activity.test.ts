// Brokspace for VS Code. SPDX-License-Identifier: MIT OR Apache-2.0

import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type Action, Activity, ApprovalGate, duration, isInsideWorkspace, settle, touched } from '../../src/core/activity';
import { markInterrupted } from '../../src/core/sessions';

const clock = () => {
    let now = 1000;
    return () => (now += 50);
};
const write = (id: string, run: Action<string>['run']): Action<string> => ({ id, label: id, kind: 'write', resources: ['memory: x'], run });

describe('activity steps', () => {
    it('gives every step a lifecycle with a duration and the resources it touched', () => {
        const activity = new Activity(clock());
        activity.record('Attached context', 'read', ['src/a.ts']);
        activity.start('Asking your model', 'network');
        activity.finish('done', { resources: ['src/b.ts:1-9', 'src/a.ts'] });
        const [context, ask] = activity.steps;
        assert.equal(context?.status, 'done');
        assert.equal(ask?.status, 'done');
        assert.ok(duration(ask!) > 0);
        assert.deepEqual(ask?.resources, ['src/b.ts:1-9', 'src/a.ts']);
    });

    it('finishes the running step when the next one starts', () => {
        const activity = new Activity(clock());
        activity.start('one', 'read');
        activity.start('two', 'network');
        assert.deepEqual(
            activity.steps.map((step) => step.status),
            ['done', 'running'],
        );
    });

    it('records a cancelled or failed step as such, once, and hides secrets in the error', () => {
        const activity = new Activity(clock());
        activity.start('Asking', 'network');
        activity.finish('failed', { error: 'bad key sk-abcdefghijklmnopqrstuvwxyz' });
        activity.finish('done'); // nothing is running: ignored
        assert.equal(activity.steps[0]?.status, 'failed');
        assert.ok(!activity.steps[0]?.error?.includes('sk-abcdef'));
        const stopped = new Activity(clock());
        stopped.start('Asking', 'network');
        stopped.finish('cancelled');
        assert.equal(stopped.steps[0]?.status, 'cancelled');
    });

    it('turns steps left running by a closed window into cancelled ones', () => {
        const activity = new Activity(clock());
        activity.start('Asking', 'network');
        const [step] = settle(activity.steps);
        assert.equal(step?.status, 'cancelled');
        const turn = { id: 't', question: 'q', kind: 'ask' as const, answer: '', sources: [], steps: activity.steps };
        assert.equal(markInterrupted([turn])[0]?.steps?.[0]?.status, 'cancelled');
    });

    it('lists what a conversation read and what it changed, counting only what finished', () => {
        const activity = new Activity(clock());
        activity.record('Read', 'read', ['src/a.ts']);
        activity.start('Save', 'write', ['memory: note']);
        activity.finish('done');
        activity.start('Save again', 'write', ['memory: other']);
        activity.finish('failed');
        assert.deepEqual(touched(activity.steps), { read: ['src/a.ts'], changed: ['memory: note'] });
    });
});

describe('workspace boundary', () => {
    it('accepts paths inside the workspace and refuses traversal and other places', () => {
        const root = '/work/app';
        for (const inside of ['src/a.ts', './src/../src/a.ts', '/work/app/src/a.ts', 'a/b/../c']) {
            assert.equal(isInsideWorkspace(root, inside), true, inside);
        }
        for (const outside of ['../other/a.ts', 'src/../../etc/passwd', '/etc/passwd', '/work/application/a.ts', '/work', '..']) {
            assert.equal(isInsideWorkspace(root, outside), false, outside);
        }
    });

    it('handles Windows separators', () => {
        assert.equal(isInsideWorkspace('C:\\work\\app', 'src\\a.ts'), true);
        assert.equal(isInsideWorkspace('C:\\work\\app', '..\\secret.txt'), false);
        assert.equal(isInsideWorkspace('C:\\work\\app', 'D:\\other\\a.ts'), false);
    });
});

describe('approval gate', () => {
    it('keeps a write waiting until it is approved, and never runs it before', async () => {
        const gate = new ApprovalGate();
        let runs = 0;
        const action = write('w1', async () => `done ${++runs}`);
        assert.equal(gate.request(action), 'pending');
        assert.deepEqual(await gate.execute(action), { ran: false });
        assert.equal(runs, 0);
        gate.approve('w1');
        assert.deepEqual(await gate.execute(action), { ran: true, value: 'done 1' });
    });

    it('does not run a rejected write', async () => {
        const gate = new ApprovalGate();
        let runs = 0;
        const action = write('w2', async () => `${++runs}`);
        gate.request(action);
        gate.reject('w2');
        gate.approve('w2'); // too late
        assert.equal((await gate.execute(action)).ran, false);
        assert.equal(runs, 0);
        assert.equal(gate.state('w2'), 'rejected');
    });

    it('runs an approved action once: executing again returns the first result without repeating the effect', async () => {
        const gate = new ApprovalGate();
        let runs = 0;
        const action = write('w3', async () => `effect ${++runs}`);
        gate.request(action, true);
        await Promise.all([gate.execute(action)]);
        assert.deepEqual(await gate.execute(action), { ran: false, value: 'effect 1' });
        assert.equal(runs, 1);
    });

    it('refuses to start an action that is already running', async () => {
        const gate = new ApprovalGate();
        let release: () => void = () => undefined;
        let runs = 0;
        const action = write(
            'w4',
            () =>
                new Promise<string>((resolve) => {
                    runs++;
                    release = () => resolve('ok');
                }),
        );
        gate.request(action, true);
        const first = gate.execute(action);
        assert.deepEqual(await gate.execute(action), { ran: false });
        release();
        await first;
        assert.equal(runs, 1);
    });

    it('lets a failed action be retried, hiding secrets in its error', async () => {
        const gate = new ApprovalGate();
        let runs = 0;
        const action = write('w5', async () => {
            if (++runs === 1) {
                throw new Error('denied with token ghp_abcdefghijklmnopqrstuvwxyz0123456789');
            }
            return 'saved';
        });
        gate.request(action, true);
        const failed = await gate.execute(action);
        assert.equal(failed.ran, true);
        assert.ok(failed.error && !failed.error.includes('ghp_abcdef'));
        assert.equal(gate.state('w5'), 'failed');
        assert.deepEqual(await gate.execute(action), { ran: true, value: 'saved' });
        assert.equal(gate.state('w5'), 'done');
    });

    it('reports an action cancelled while it ran as cancelled and does not run it again by itself', async () => {
        const gate = new ApprovalGate();
        const signal = { cancelled: false };
        let runs = 0;
        const action = write('w6', async () => {
            runs++;
            signal.cancelled = true;
            return 'maybe applied';
        });
        gate.request(action, true);
        const outcome = await gate.execute(action, signal);
        assert.match(outcome.error ?? '', /cancelled after it had started/);
        assert.equal(gate.state('w6'), 'cancelled');
        assert.equal((await gate.execute(action)).ran, false);
        assert.equal(runs, 1);
    });

    it('never makes a read or network action wait', () => {
        const gate = new ApprovalGate();
        const read: Action<string> = { id: 'r', label: 'r', kind: 'read', resources: [], run: async () => 'x' };
        assert.equal(gate.request(read), 'approved');
    });
});
