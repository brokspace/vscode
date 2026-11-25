// Brokspace for VS Code. SPDX-License-Identifier: MIT OR Apache-2.0

/**
 * Messages between the extension and its webviews (settings, chat). Types
 * only: the webview bundle imports this file too, so nothing here may use
 * the VS Code API.
 */

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

/** One question of the chat panel and its answer. */
export interface ChatTurn {
    id: string;
    question: string;
    kind: 'ask' | 'review' | 'skill';
    answer: string;
    sources: SourceRef[];
    /** `provider/model` that answered. */
    model?: string;
    /** Answered from the local index (no LLM). */
    local?: boolean;
    done?: boolean;
    cancelled?: boolean;
    error?: string;
}

export type HostMessage =
    | { type: 'state'; state: BrokspaceState; root?: string }
    | { type: 'memories'; memories: Memory[]; loaded: boolean; error?: string }
    | { type: 'rpc'; id: number; result?: unknown; error?: string }
    | { type: 'show'; section: SettingsSection; options: ShowOptions }
    | { type: 'chat/state'; turns: ChatTurn[] }
    | { type: 'chat/turn'; turn: ChatTurn }
    | { type: 'chat/progress'; id: string; text: string }
    | { type: 'chat/chunk'; id: string; text: string }
    | { type: 'chat/done'; turn: ChatTurn };

export type WebviewMessage =
    | { type: 'ready' }
    | { type: 'rpc'; id: number; method: string; params?: unknown[] }
    | { type: 'command'; command: string; args?: unknown[] }
    | { type: 'open'; path: string; line?: number; endLine?: number }
    | { type: 'openFile'; path: string }
    | { type: 'openExternal'; url: string }
    | { type: 'chat/send'; text: string }
    | { type: 'chat/cancel' }
    | { type: 'chat/new' };
