// Brokspace for VS Code. SPDX-License-Identifier: MIT OR Apache-2.0

import * as vscode from 'vscode';
import { message } from './core/brok';
import type { Memory, MemoryInput } from './core/protocol';
import { type SessionTurn, sessionMemory } from './core/text';
import type { BrokspaceModel } from './model';

/**
 * Brokspace's memories (`brok memory`): loaded when first needed, reloaded
 * after every change made here and when brok's status says the counts
 * changed (memories saved by coding agents, the CLI or another window).
 */
export class MemoryStore implements vscode.Disposable {
    protected readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
    readonly onDidChange = this.onDidChangeEmitter.event;
    protected readonly disposables: vscode.Disposable[] = [this.onDidChangeEmitter];

    protected _memories: Memory[] = [];
    protected _error: string | undefined;
    protected loaded = false;
    protected loading: Promise<void> | undefined;
    protected counts = '';

    constructor(protected readonly model: BrokspaceModel) {
        this.disposables.push(
            model.onDidChange((state) => {
                if (state.kind !== 'ready') {
                    return;
                }
                const counts = JSON.stringify(state.status.memory?.counts ?? {});
                if (this.loaded && counts !== this.counts) {
                    void this.reload();
                }
                this.counts = counts;
            }),
        );
    }

    dispose(): void {
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
    }

    get memories(): Memory[] {
        return this._memories;
    }

    get error(): string | undefined {
        return this._error;
    }

    get isLoaded(): boolean {
        return this.loaded;
    }

    /** Whether brok keeps memories in this workspace. */
    get enabled(): boolean {
        return this.model.ready?.status.memory?.enabled !== false;
    }

    ensureLoaded(): Promise<void> {
        return this.loaded ? Promise.resolve() : this.reload();
    }

    reload(): Promise<void> {
        this.loading ??= this.doReload().finally(() => {
            this.loading = undefined;
        });
        return this.loading;
    }

    protected async doReload(): Promise<void> {
        const root = this.model.root;
        if (!root || !this.model.ready || !this.enabled) {
            this._memories = [];
        } else {
            try {
                this._memories = await this.model.brok.memories(root);
                this._error = undefined;
            } catch (error) {
                this._error = message(error);
            }
        }
        this.loaded = true;
        this.onDidChangeEmitter.fire();
    }

    async save(memory: MemoryInput): Promise<Memory | undefined> {
        const root = this.model.root;
        if (!root) {
            return undefined;
        }
        const saved = await this.model.brok.saveMemory(root, memory);
        await this.reload();
        return saved;
    }

    async forget(memory: Pick<Memory, 'id' | 'scope'>): Promise<void> {
        const root = this.model.root;
        if (root) {
            await this.model.brok.forgetMemory(root, memory.id, memory.scope);
            await this.reload();
        }
    }

    /**
     * Saves (or updates) the memory of a chat session, unless turned off here
     * (`brokspace.chat.saveSessions`) or in brok.yml (`memory.sessions`).
     */
    async saveSession(sessionId: string, turns: SessionTurn[]): Promise<void> {
        const memory = sessionMemory(sessionId, turns);
        if (!memory || !this.model.ready || !this.sessionsEnabled) {
            return;
        }
        await this.save(memory);
    }

    /** Whether chats are saved: on in `brokspace.chat.saveSessions` and not turned off by brok's `memory` settings. */
    get sessionsEnabled(): boolean {
        const memory = this.model.ready?.status.memory;
        return (
            memory?.enabled !== false &&
            memory?.sessions !== false &&
            vscode.workspace.getConfiguration('brokspace').get<boolean>('chat.saveSessions', true)
        );
    }
}
