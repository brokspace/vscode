// Brokspace for VS Code. SPDX-License-Identifier: MIT OR Apache-2.0

import type { Memory } from '../src/core/protocol';
import type { BrokspaceState, HostMessage, Page, WebviewMessage } from '../src/webview-protocol';

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };

/** What the extension puts in the page (webviews.ts, `html`). */
export interface Boot {
    page: Page;
    l10n: Record<string, string | { message: string }>;
    language: string;
}

declare global {
    interface Window {
        __BROKSPACE__: Boot;
    }
}

type Listener = (msg: HostMessage) => void;

/**
 * The extension, as the page sees it: brok's state and the memories (pushed
 * by the extension), calls into brok (`rpc`), and editor actions.
 */
export class Host {
    readonly boot: Boot = window.__BROKSPACE__;
    state: BrokspaceState = { kind: 'loading' };
    root: string | undefined;
    memories: Memory[] = [];
    memoriesLoaded = false;
    memoriesError: string | undefined;

    protected readonly api = acquireVsCodeApi();
    protected readonly listeners = new Set<Listener>();
    protected readonly calls = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
    protected nextId = 1;

    constructor() {
        window.addEventListener('message', (event: MessageEvent<HostMessage>) => this.receive(event.data));
    }

    start(): void {
        this.post({ type: 'ready' });
    }

    on(listener: Listener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    post(msg: WebviewMessage): void {
        this.api.postMessage(msg);
    }

    /** Calls brok (or the editor) through the extension; rejects with brok's message. */
    rpc<T = unknown>(method: string, ...params: unknown[]): Promise<T> {
        const id = this.nextId++;
        return new Promise<T>((resolve, reject) => {
            this.calls.set(id, { resolve: resolve as (value: unknown) => void, reject });
            this.post({ type: 'rpc', id, method, params });
        });
    }

    command(command: string, ...args: unknown[]): void {
        this.post({ type: 'command', command, args });
    }

    openFile(path: string): void {
        this.post({ type: 'openFile', path });
    }

    openExternal(url: string): void {
        this.post({ type: 'openExternal', url });
    }

    notify(kind: 'info' | 'error', text: string): void {
        void this.rpc('notify', kind, text);
    }

    confirm(text: string, action: string): Promise<boolean> {
        return this.rpc<boolean>('confirm', text, action);
    }

    protected receive(msg: HostMessage): void {
        switch (msg.type) {
            case 'state':
                this.state = msg.state;
                this.root = msg.root;
                break;
            case 'memories':
                this.memories = msg.memories;
                this.memoriesLoaded = msg.loaded;
                this.memoriesError = msg.error;
                break;
            case 'rpc': {
                const call = this.calls.get(msg.id);
                this.calls.delete(msg.id);
                if (msg.error !== undefined) {
                    call?.reject(new Error(msg.error));
                } else {
                    call?.resolve(msg.result);
                }
                return;
            }
        }
        for (const listener of this.listeners) {
            listener(msg);
        }
    }
}

/**
 * The UI string for `text` (the English source string, as in
 * `vscode.l10n.t`) with `{0}`, `{1}`... filled in.
 */
export function t(text: string, ...args: (string | number)[]): string {
    const entry = window.__BROKSPACE__?.l10n?.[text];
    const translated = typeof entry === 'string' ? entry : (entry?.message ?? text);
    return translated.replace(/\{(\d+)\}/g, (match, index) => {
        const value = args[Number(index)];
        return value === undefined ? match : String(value);
    });
}

export function codicon(name: string): string {
    return `codicon codicon-${name}`;
}
