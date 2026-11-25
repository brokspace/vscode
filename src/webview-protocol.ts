// Brokspace for VS Code. SPDX-License-Identifier: MIT OR Apache-2.0

/**
 * Messages between the extension and its webviews (settings, chat). Types
 * only: the webview bundle imports this file too, so nothing here may use
 * the VS Code API.
 */

import type { ActivityStep } from './core/activity';
import type { Progress, StepId } from './core/onboarding';
import type { BrokInfo, BrokStatus, BugInput, Memory, SourceRef } from './core/protocol';

export type BrokspaceState =
    | { kind: 'loading' }
    | { kind: 'no-folder' }
    | { kind: 'no-brok'; info: BrokInfo }
    | { kind: 'outdated'; info: BrokInfo }
    | { kind: 'not-initialized'; info: BrokInfo }
    | { kind: 'ready'; info: BrokInfo; status: BrokStatus }
    | { kind: 'error'; info: BrokInfo; message: string };

export type Page = 'settings' | 'chat' | 'workspace';

export type SettingsSection = 'overview' | 'model' | 'search' | 'memory' | 'links' | 'agents' | 'diagnostics' | 'report';

export interface ShowOptions {
    addLink?: boolean;
    addMemory?: boolean;
    bug?: Partial<BugInput>;
}

/** One piece of attached context as the composer shows it (never its content). */
export interface ContextChip {
    id: string;
    kind: 'file' | 'selection' | 'diagnostics';
    label: string;
    persistent: boolean;
    chars: number;
    truncated: boolean;
    redactions: number;
    external: boolean;
    /** Left out of the next question: the total budget is used up. */
    omitted: boolean;
}

export type ContextSource = 'file' | 'selection' | 'pick' | 'diagnostics' | 'tabs' | 'folder';

/** One question of the chat panel and its answer. */
export interface ChatTurn {
    id: string;
    question: string;
    kind: 'ask' | 'review' | 'skill' | 'search' | 'remember';
    answer: string;
    sources: SourceRef[];
    /** `provider/model` that answered. */
    model?: string;
    /** Answered from the local index (no LLM). */
    local?: boolean;
    done?: boolean;
    cancelled?: boolean;
    error?: string;
    /** What was attached to this question. */
    context?: string[];
    /** What the assistant did to answer: the steps of this turn. */
    steps?: ActivityStep[];
}

export type HostMessage =
    | { type: 'state'; state: BrokspaceState; root?: string }
    | { type: 'memories'; memories: Memory[]; loaded: boolean; error?: string }
    | { type: 'rpc'; id: number; result?: unknown; error?: string }
    | { type: 'show'; section: SettingsSection; options: ShowOptions }
    | { type: 'context/state'; items: ContextChip[]; limit: number }
    | { type: 'editor/state'; file?: string; selection: boolean; sendWith: 'enter' | 'ctrlEnter' }
    | { type: 'chat/state'; turns: ChatTurn[] }
    | { type: 'chat/turn'; turn: ChatTurn }
    | { type: 'chat/progress'; id: string; text: string }
    | { type: 'chat/chunk'; id: string; text: string }
    | { type: 'chat/steps'; id: string; steps: ActivityStep[] }
    | { type: 'chat/done'; turn: ChatTurn }
    | { type: 'onboarding/state'; progress: Progress; mcpEnabled: boolean; busy?: 'setup' };

export type WebviewMessage =
    | { type: 'ready' }
    | { type: 'rpc'; id: number; method: string; params?: unknown[] }
    | { type: 'command'; command: string; args?: unknown[] }
    | { type: 'open'; path: string; line?: number; endLine?: number }
    | { type: 'openFile'; path: string }
    | { type: 'openExternal'; url: string }
    | { type: 'chat/send'; text: string }
    | { type: 'context/add'; source: ContextSource }
    | { type: 'context/remove'; id: string }
    | { type: 'context/pin'; id: string }
    | { type: 'chat/cancel' }
    | { type: 'chat/new' }
    | { type: 'onboarding/acknowledge' }
    | { type: 'onboarding/skip'; step: StepId }
    | { type: 'onboarding/resume'; step: StepId }
    | { type: 'onboarding/dismiss' }
    | { type: 'onboarding/reopen' };
