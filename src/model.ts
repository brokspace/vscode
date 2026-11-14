// Brokspace for VS Code. SPDX-License-Identifier: MIT OR Apache-2.0

import * as vscode from 'vscode';
import { Brok, isAtLeast, message, resolveBrok } from './core/brok';
import { type BrokInfo, MINIMUM_BROK_VERSION } from './core/protocol';
import type { BrokspaceState } from './webview-protocol';

export type { BrokspaceState };
export type Ready = Extract<BrokspaceState, { kind: 'ready' }>;

/** A refresh runs `brok status`, which opens the index: polled sparingly. */
const REFRESH_INTERVAL_MS = 60_000;
/** Regaining the focus refreshes a status older than this. */
const STALE_MS = 10_000;

/**
 * brok's status for the first workspace folder, refreshed on demand (after
 * every Brokspace command), on folder and setting changes, when the window
 * gets the focus back and once a minute while it has it. Sets the
 * `brokspace.*` context keys the views and menus use.
 */
export class BrokspaceModel implements vscode.Disposable {
    protected readonly onDidChangeEmitter = new vscode.EventEmitter<BrokspaceState>();
    readonly onDidChange = this.onDidChangeEmitter.event;
    protected readonly disposables: vscode.Disposable[] = [this.onDidChangeEmitter];

    protected _state: BrokspaceState = { kind: 'loading' };
    protected _brok: Brok;
    protected info: BrokInfo | undefined;
    protected refreshing: Promise<BrokspaceState> | undefined;
    protected refreshedAt = 0;

    constructor() {
        this._brok = new Brok(resolveBrok(vscode.workspace.getConfiguration('brokspace').get<string>('brokPath')));
        this.disposables.push(
            vscode.workspace.onDidChangeWorkspaceFolders(() => this.refresh()),
            vscode.workspace.onDidChangeConfiguration((e) => {
                if (e.affectsConfiguration('brokspace.brokPath')) {
                    this._brok.dispose();
                    this._brok = new Brok(resolveBrok(vscode.workspace.getConfiguration('brokspace').get<string>('brokPath')));
                    this.info = undefined;
                    this.refresh();
                }
            }),
            vscode.window.onDidChangeWindowState((window) => {
                if (window.focused && Date.now() - this.refreshedAt > STALE_MS) {
                    this.refresh();
                }
            }),
        );
        const timer = setInterval(() => {
            if (vscode.window.state.focused) {
                this.refresh();
            }
        }, REFRESH_INTERVAL_MS);
        this.disposables.push({ dispose: () => clearInterval(timer) });
        this.setContext();
    }

    dispose(): void {
        this._brok.dispose();
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
    }

    get state(): BrokspaceState {
        return this._state;
    }

    get brok(): Brok {
        return this._brok;
    }

    /** The first workspace folder, as a file system path. */
    get root(): string | undefined {
        return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    }

    get rootUri(): vscode.Uri | undefined {
        return vscode.workspace.workspaceFolders?.[0]?.uri;
    }

    get ready(): Ready | undefined {
        return this._state.kind === 'ready' ? this._state : undefined;
    }

    refresh(): Promise<BrokspaceState> {
        this.refreshing ??= this.doRefresh().finally(() => {
            this.refreshing = undefined;
        });
        return this.refreshing;
    }

    protected async doRefresh(): Promise<BrokspaceState> {
        const root = this.root;
        let state: BrokspaceState;
        if (!root) {
            state = { kind: 'no-folder' };
        } else {
            this.info ??= await this._brok.info();
            const info = this.info;
            if (!info.found) {
                this.info = undefined; // look again next time: brok may get installed
                state = { kind: 'no-brok', info };
            } else if (!isAtLeast(info.version, MINIMUM_BROK_VERSION)) {
                this.info = undefined; // look again after `brok upgrade`
                state = { kind: 'outdated', info };
            } else {
                try {
                    const status = await this._brok.status(root);
                    state = status.initialized ? { kind: 'ready', info, status } : { kind: 'not-initialized', info };
                } catch (error) {
                    state = { kind: 'error', info, message: message(error) };
                }
            }
        }
        this._state = state;
        this.refreshedAt = Date.now();
        this.setContext();
        this.onDidChangeEmitter.fire(state);
        return state;
    }

    protected setContext(): void {
        const state = this._state;
        const status = state.kind === 'ready' ? state.status : undefined;
        const counts = status?.memory?.counts;
        void vscode.commands.executeCommand('setContext', 'brokspace.state', state.kind);
        void vscode.commands.executeCommand(
            'setContext',
            'brokspace.memoryCount',
            counts ? counts.private + counts.shared + counts.global : 0,
        );
        void vscode.commands.executeCommand('setContext', 'brokspace.linkCount', status?.links?.length ?? 0);
        void vscode.commands.executeCommand('setContext', 'brokspace.shardCount', status?.shards?.length ?? 0);
        void vscode.commands.executeCommand('setContext', 'brokspace.running', !!status?.daemon?.running);
    }
}
