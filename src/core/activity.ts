// Brokspace for VS Code. SPDX-License-Identifier: MIT OR Apache-2.0

/**
 * What the assistant does while it answers, as a timeline of steps with a
 * lifecycle, and the gate every action that changes something passes
 * through. Pure logic; the chat shows it. Today brok's answers only read
 * (the index, attached context) and send the question to your LLM, and
 * `/remember` is the one write, so a write always needs an approval and
 * `/remember` carries the one the user gave by typing it.
 */

import { hideSecrets } from './context';

/** `read`: looks at files or the index. `network`: sends the question (and any attached context) to your LLM. `write`: changes something. */
export type StepKind = 'read' | 'network' | 'write';
export type StepStatus = 'running' | 'done' | 'failed' | 'cancelled';

export interface ActivityStep {
    id: string;
    label: string;
    kind: StepKind;
    status: StepStatus;
    startedAt: number;
    endedAt?: number;
    /** Files, sources or memories this step read or changed. */
    resources: string[];
    /** How a write was approved. */
    approval?: 'typed command' | 'you';
    error?: string;
}

/** Builds the steps of one answer; only one runs at a time. */
export class Activity {
    readonly steps: ActivityStep[] = [];
    private count = 0;

    constructor(
        private readonly now: () => number = Date.now,
        private readonly prefix = 'step',
    ) {}

    /** Starts a step, finishing the running one as done. */
    start(label: string, kind: StepKind, resources: string[] = [], approval?: ActivityStep['approval']): ActivityStep {
        this.finish('done');
        const step: ActivityStep = {
            id: `${this.prefix}-${++this.count}`,
            label,
            kind,
            status: 'running',
            startedAt: this.now(),
            resources,
            approval,
        };
        this.steps.push(step);
        return step;
    }

    /** Ends the running step (if any); `resources` are added to what it touched. */
    finish(status: Exclude<StepStatus, 'running'>, options: { error?: string; resources?: string[] } = {}): void {
        const step = this.steps.at(-1);
        if (!step || step.status !== 'running') {
            return;
        }
        step.status = status;
        step.endedAt = Math.max(this.now(), step.startedAt);
        step.resources = [...new Set([...step.resources, ...(options.resources ?? [])])];
        if (options.error) {
            step.error = hideSecrets(options.error).text;
        }
    }

    /** A step that needs no time: the context that was attached, for instance. */
    record(label: string, kind: StepKind, resources: string[]): void {
        this.start(label, kind, resources);
        this.finish('done');
    }
}

/** How long a step took, in milliseconds (still running: so far). */
export function duration(step: ActivityStep, now: number = Date.now()): number {
    return Math.max(0, (step.endedAt ?? now) - step.startedAt);
}

/** An unfinished step of a conversation that was closed becomes cancelled instead of running forever. */
export function settle(steps: ActivityStep[]): ActivityStep[] {
    return steps.map((step) =>
        step.status === 'running' ? { ...step, status: 'cancelled', endedAt: step.endedAt ?? step.startedAt } : step,
    );
}

/** The files and memories a conversation read and changed, from its steps. */
export function touched(steps: ActivityStep[]): { read: string[]; changed: string[] } {
    const read = new Set<string>();
    const changed = new Set<string>();
    for (const step of steps) {
        if (step.status !== 'done') {
            continue;
        }
        for (const resource of step.resources) {
            (step.kind === 'write' ? changed : read).add(resource);
        }
    }
    return { read: [...read], changed: [...changed] };
}

/** Whether `candidate` is inside `root` once both are normalized (no `..` escape, no other drive). */
export function isInsideWorkspace(root: string, candidate: string): boolean {
    const split = (value: string) =>
        value
            .replace(/\\/g, '/')
            .split('/')
            .filter((part) => part && part !== '.');
    const base = split(root);
    const parts: string[] = [];
    for (const part of split(candidate.startsWith('/') || /^[A-Za-z]:/.test(candidate) ? candidate : `${root}/${candidate}`)) {
        if (part === '..') {
            parts.pop();
        } else {
            parts.push(part);
        }
    }
    return base.length <= parts.length && base.every((part, i) => part === parts[i]);
}

export type ApprovalState = 'pending' | 'approved' | 'rejected' | 'running' | 'done' | 'failed' | 'cancelled';

export interface Action<T = void> {
    /** Stable: running the same action twice must not do its effect twice. */
    id: string;
    label: string;
    kind: StepKind;
    /** What it will touch, shown before it is approved. */
    resources: string[];
    run(signal: { cancelled: boolean }): Promise<T>;
}

/**
 * Runs actions that change something. A write waits for approval unless it
 * is already approved (the user typed the command); an action runs at most
 * once, and a retry after a failure runs it again but never after it
 * succeeded.
 */
export class ApprovalGate {
    private readonly states = new Map<string, ApprovalState>();
    private readonly outcomes = new Map<string, unknown>();

    state(id: string): ApprovalState | undefined {
        return this.states.get(id);
    }

    /** Registers a write that needs the user's decision. Read and network actions never wait. */
    request(action: Action<unknown>, preApproved = false): ApprovalState {
        const existing = this.states.get(action.id);
        if (existing) {
            return existing;
        }
        const state: ApprovalState = action.kind !== 'write' || preApproved ? 'approved' : 'pending';
        this.states.set(action.id, state);
        return state;
    }

    approve(id: string): void {
        if (this.states.get(id) === 'pending') {
            this.states.set(id, 'approved');
        }
    }

    reject(id: string): void {
        if (this.states.get(id) === 'pending') {
            this.states.set(id, 'rejected');
        }
    }

    /** Runs an approved action once. Done: returns the earlier result. Not approved, rejected or running: does nothing. */
    async execute<T>(
        action: Action<T>,
        signal: { cancelled: boolean } = { cancelled: false },
    ): Promise<{ ran: boolean; value?: T; error?: string }> {
        const state = this.states.get(action.id);
        if (state === 'done') {
            return { ran: false, value: this.outcomes.get(action.id) as T };
        }
        if (state !== 'approved' && state !== 'failed') {
            return { ran: false };
        }
        this.states.set(action.id, 'running');
        try {
            const value = await action.run(signal);
            if (signal.cancelled) {
                // It may have taken effect: say so instead of pretending it did not, and never run it again by itself.
                this.states.set(action.id, 'cancelled');
                return { ran: true, value, error: 'cancelled after it had started' };
            }
            this.states.set(action.id, 'done');
            this.outcomes.set(action.id, value);
            return { ran: true, value };
        } catch (error) {
            this.states.set(action.id, 'failed');
            return { ran: true, error: hideSecrets(error instanceof Error ? error.message : String(error)).text };
        }
    }
}
