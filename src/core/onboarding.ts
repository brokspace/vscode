// Brokspace for VS Code. SPDX-License-Identifier: MIT OR Apache-2.0

/**
 * The guided first run: a checklist computed from what brok reports and what
 * the user already chose. Pure, so the webview and the tests share it.
 * Required steps are derived from the real state (an existing install or
 * workspace is detected, never redone); only the user's choices are stored.
 */

import type { BrokspaceState } from '../webview-protocol';

export type StepId = 'local' | 'brok' | 'folder' | 'workspace' | 'model' | 'first' | 'memory' | 'mcp' | 'links';

export type StepStatus = 'done' | 'current' | 'todo' | 'skipped';

export interface Step {
    id: StepId;
    status: StepStatus;
    optional: boolean;
}

/** What is stored (per workspace). */
export interface Progress {
    version: 1;
    /** The user read how data is handled. */
    acknowledged: boolean;
    /** Optional steps put off. */
    skipped: StepId[];
    /** A question was answered once. */
    firstAnswer: boolean;
    /** The checklist was closed by the user. */
    dismissed: boolean;
    /** The user asked for the checklist again: it stays until closed. */
    reopened: boolean;
}

const UNUSABLE_MODEL = ['unreachable', 'not_installed', 'missing_key', 'not_configured'];

export const OPTIONAL: readonly StepId[] = ['model', 'memory', 'mcp', 'links'];

export function emptyProgress(): Progress {
    return { version: 1, acknowledged: false, skipped: [], firstAnswer: false, dismissed: false, reopened: false };
}

/** Reads stored progress, ignoring anything malformed. */
export function readProgress(raw: unknown): Progress {
    const base = emptyProgress();
    if (!raw || typeof raw !== 'object') {
        return base;
    }
    const value = raw as Partial<Progress>;
    if (value.version !== 1) {
        return base;
    }
    return {
        version: 1,
        acknowledged: value.acknowledged === true,
        skipped: Array.isArray(value.skipped) ? value.skipped.filter((id): id is StepId => OPTIONAL.includes(id as StepId)) : [],
        firstAnswer: value.firstAnswer === true,
        dismissed: value.dismissed === true,
        reopened: value.reopened === true,
    };
}

/** The checklist for a state; `mcpEnabled` is the `brokspace.mcp.enabled` setting. */
export function checklist(state: BrokspaceState, progress: Progress, mcpEnabled = true): Step[] {
    const ready = state.kind === 'ready';
    const status = ready ? state.status : undefined;
    const provider = status?.llm?.provider;
    const memories = status?.memory ? status.memory.counts.private + status.memory.counts.shared + status.memory.counts.global : 0;
    const done: Record<StepId, boolean> = {
        local: progress.acknowledged,
        brok: state.kind !== 'loading' && state.kind !== 'no-brok' && state.kind !== 'outdated',
        folder: state.kind !== 'loading' && state.kind !== 'no-folder',
        workspace: ready,
        // A configured model that brok reports unusable still needs the user (brok 0.13 and newer).
        model: !!provider && provider !== 'none' && !UNUSABLE_MODEL.includes(status?.readiness?.model.state ?? ''),
        first: progress.firstAnswer,
        memory: memories > 0,
        mcp: ready && mcpEnabled,
        links: (status?.links?.length ?? 0) > 0,
    };
    const order: StepId[] = ['local', 'brok', 'folder', 'workspace', 'model', 'first', 'memory', 'mcp', 'links'];
    let current = false;
    return order.map((id) => {
        const optional = OPTIONAL.includes(id);
        if (done[id]) {
            return { id, optional, status: 'done' as const };
        }
        if (optional && progress.skipped.includes(id)) {
            return { id, optional, status: 'skipped' as const };
        }
        // The first required step left is the current one; optional steps never block.
        if (!current && !optional) {
            current = true;
            return { id, optional, status: 'current' as const };
        }
        return { id, optional, status: 'todo' as const };
    });
}

/**
 * Whether the checklist is shown: asked for again, or not closed and the
 * first answer not yet given. Someone who already has a working workspace with a model (an
 * existing user) is never guided through it.
 */
export function isActive(state: BrokspaceState, progress: Progress): boolean {
    if (state.kind === 'loading') {
        return false;
    }
    if (progress.reopened) {
        return true;
    }
    if (progress.dismissed || (progress.firstAnswer && state.kind === 'ready')) {
        return false;
    }
    if (state.kind === 'ready' && !progress.acknowledged && state.status.llm && state.status.llm.provider !== 'none') {
        return false;
    }
    return true;
}
