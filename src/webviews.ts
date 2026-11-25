// Brokspace for VS Code. SPDX-License-Identifier: MIT OR Apache-2.0

import * as crypto from 'node:crypto';
import * as vscode from 'vscode';
import { answer } from './chat';
import { message } from './core/brok';
import type { BugInput } from './core/protocol';
import {
    markInterrupted,
    readHistory,
    remove,
    rename,
    type StoredSession,
    search,
    summarize,
    titleFrom,
    upsert,
    writeHistory,
} from './core/sessions';
import { cite, parseRequest, type SessionTurn } from './core/text';
import type { MemoryStore } from './memory';
import type { BrokspaceModel } from './model';
import { openHit } from './search';
import type { ChatTurn, HostMessage, Page, SettingsSection, ShowOptions, WebviewMessage } from './webview-protocol';

const t = vscode.l10n.t;

const HISTORY_KEY = 'brokspace.chat.history';

/** Shared by both webviews: RPC with brok, commands, opening files and links. */
abstract class BrokspaceWebview implements vscode.Disposable {
    protected panel: vscode.WebviewPanel | undefined;
    /** Every page showing this state: an editor tab and, for the chat, the sidebar view. */
    protected readonly webviews = new Set<vscode.Webview>();
    protected readonly disposables: vscode.Disposable[] = [];

    constructor(
        protected readonly context: vscode.ExtensionContext,
        protected readonly model: BrokspaceModel,
        protected readonly memory: MemoryStore,
        protected readonly page: Page,
        protected readonly title: string,
    ) {
        this.disposables.push(
            model.onDidChange(() => this.postState()),
            memory.onDidChange(() => this.postMemories()),
        );
    }

    dispose(): void {
        this.panel?.dispose();
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
    }

    protected resourceRoots(): vscode.Uri[] {
        return [vscode.Uri.joinPath(this.context.extensionUri, 'dist'), vscode.Uri.joinPath(this.context.extensionUri, 'media')];
    }

    protected reveal(column: vscode.ViewColumn): vscode.WebviewPanel {
        if (this.panel) {
            this.panel.reveal(column);
            return this.panel;
        }
        const panel = vscode.window.createWebviewPanel(`brokspace.${this.page}`, this.title, column, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: this.resourceRoots(),
        });
        panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'icon.png');
        this.attach(panel.webview, panel.onDidDispose.bind(panel));
        panel.onDidDispose(() => {
            this.panel = undefined;
        });
        this.panel = panel;
        return panel;
    }

    /** Shows the page in a webview (an editor tab or a sidebar view) and routes its messages here. */
    protected attach(webview: vscode.Webview, onDispose: (listener: () => void) => vscode.Disposable, page: Page = this.page): void {
        this.webviews.add(webview);
        webview.html = html(webview, this.context.extensionUri, page);
        webview.onDidReceiveMessage((msg: WebviewMessage) => this.onMessage(msg), undefined, this.disposables);
        onDispose(() => this.webviews.delete(webview));
    }

    protected post(msg: HostMessage): void {
        for (const webview of this.webviews) {
            void webview.postMessage(msg);
        }
    }

    protected postState(): void {
        this.post({ type: 'state', state: this.model.state, root: this.model.root });
    }

    protected postMemories(): void {
        this.post({ type: 'memories', memories: this.memory.memories, loaded: this.memory.isLoaded, error: this.memory.error });
    }

    protected async onMessage(msg: WebviewMessage): Promise<void> {
        switch (msg.type) {
            case 'ready':
                this.postState();
                this.postMemories();
                this.onReady();
                return;
            case 'rpc':
                try {
                    this.post({ type: 'rpc', id: msg.id, result: await this.call(msg.method, msg.params ?? []) });
                } catch (error) {
                    this.post({ type: 'rpc', id: msg.id, error: message(error) });
                }
                return;
            case 'command':
                await vscode.commands.executeCommand(msg.command, ...(msg.args ?? []));
                return;
            case 'open':
                if (this.model.root) {
                    await openHit(this.model.root, { path: msg.path, start_line: msg.line ?? 1, end_line: msg.endLine ?? msg.line ?? 1 });
                }
                return;
            case 'openFile':
                await vscode.window.showTextDocument(vscode.Uri.file(msg.path));
                return;
            case 'openExternal':
                await vscode.env.openExternal(vscode.Uri.parse(msg.url));
                return;
            default:
                this.onOtherMessage(msg);
        }
    }

    protected onReady(): void {}

    protected onOtherMessage(_msg: WebviewMessage): void {}

    /** The webview's calls into brok (with the workspace root) and the editor. */
    protected async call(method: string, params: unknown[]): Promise<unknown> {
        const brok = this.model.brok;
        const root = this.model.root ?? '';
        switch (method) {
            case 'config':
                return brok.config(root);
            case 'setConfig':
                return brok.setConfig(root, params[0] as string, params[1]);
            case 'unsetConfig':
                return brok.unsetConfig(root, params[0] as string);
            case 'stats':
                return brok.stats(root, params[0] as number);
            case 'doctor':
                return brok.doctor(this.model.root);
            case 'bugReport':
                return brok.bugReport(this.model.root, { ...(params[0] as BugInput), context: editorContext() });
            case 'addLink':
                return brok.addLink(root, params[0] as Parameters<typeof brok.addLink>[1]);
            case 'removeLink':
                return brok.removeLink(root, params[0] as string);
            case 'syncLinks':
                return brok.syncLinks(root, (params[0] as string[] | undefined) ?? []);
            case 'saveMemory':
                return this.memory.save(params[0] as Parameters<MemoryStore['save']>[0]);
            case 'forgetMemory':
                return this.memory.forget(params[0] as Parameters<MemoryStore['forget']>[0]);
            case 'reloadMemories':
                return this.memory.reload();
            case 'refresh':
                await this.model.refresh();
                return undefined;
            case 'chooseFolder': {
                const picked = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, openLabel: t('Link') });
                return picked?.[0]?.fsPath;
            }
            case 'confirm': {
                const [text, action] = params as [string, string];
                return (await vscode.window.showWarningMessage(text, { modal: true }, action)) === action;
            }
            case 'notify': {
                const [kind, text] = params as ['info' | 'error', string];
                void (kind === 'error' ? vscode.window.showErrorMessage(text) : vscode.window.showInformationMessage(text));
                return undefined;
            }
            default:
                throw new Error(`unknown method ${method}`);
        }
    }
}

/** Brokspace settings, diagnostics and bug reports, in an editor tab. */
export class SettingsPanel extends BrokspaceWebview {
    protected pending: { section: SettingsSection; options: ShowOptions } | undefined;

    constructor(context: vscode.ExtensionContext, model: BrokspaceModel, memory: MemoryStore) {
        super(context, model, memory, 'settings', t('Brokspace Settings'));
    }

    show(section: SettingsSection = 'overview', options: ShowOptions = {}): void {
        const fresh = !this.panel;
        this.reveal(vscode.ViewColumn.Active);
        if (section === 'memory') {
            void this.memory.ensureLoaded();
        }
        if (fresh) {
            this.pending = { section, options }; // sent once the page is ready
        } else {
            this.post({ type: 'show', section, options });
        }
    }

    protected override onReady(): void {
        if (this.pending) {
            this.post({ type: 'show', ...this.pending });
            this.pending = undefined;
        }
    }
}

/**
 * The Brokspace chat, in an editor tab next to the code: works in every
 * editor (VS Code, Cursor, Windsurf), with or without VS Code's chat.
 */
export class ChatPanel extends BrokspaceWebview {
    protected turns: ChatTurn[] = [];
    protected sessionId: string = crypto.randomUUID();
    protected running: vscode.CancellationTokenSource | undefined;

    constructor(context: vscode.ExtensionContext, model: BrokspaceModel, memory: MemoryStore) {
        super(context, model, memory, 'chat', t('Brokspace Chat'));
        this.history = readHistory(context.workspaceState.get(HISTORY_KEY));
    }

    /** The saved conversations of this workspace (workspace storage: another workspace never sees them). */
    protected history: StoredSession[];

    /** Writes the current conversation to the history, when saving is on. */
    protected persist(id: string, turns: ChatTurn[]): void {
        if (!this.memory.sessionsEnabled || !turns.length) {
            return;
        }
        const session: StoredSession = {
            id,
            title: titleFrom(turns[0].question),
            updatedAt: Date.now(),
            turns: structuredClone(turns),
        };
        this.history = upsert(this.history, session);
        void this.context.workspaceState.update(HISTORY_KEY, writeHistory(this.history));
    }

    protected saveHistory(history: StoredSession[]): void {
        this.history = history;
        void this.context.workspaceState.update(HISTORY_KEY, writeHistory(history));
    }

    /** Starts an empty conversation. */
    protected reset(): void {
        this.running?.cancel();
        this.turns = [];
        this.sessionId = crypto.randomUUID();
        this.post({ type: 'chat/state', turns: this.turns });
    }

    protected override async call(method: string, params: unknown[]): Promise<unknown> {
        switch (method) {
            case 'sessions':
                return {
                    enabled: this.memory.sessionsEnabled,
                    total: this.history.length,
                    sessions: search(this.history, (params[0] as string | undefined) ?? '').map(summarize),
                };
            case 'openSession': {
                const session = this.history.find((item) => item.id === params[0]);
                if (!session) {
                    return false;
                }
                this.running?.cancel();
                this.sessionId = session.id;
                this.turns = markInterrupted(
                    structuredClone(session.turns),
                    t('Interrupted: the conversation was closed before this answer finished.'),
                );
                this.post({ type: 'chat/state', turns: this.turns });
                return true;
            }
            case 'renameSession': {
                const session = this.history.find((item) => item.id === params[0]);
                const title = session && (await vscode.window.showInputBox({ prompt: t('Rename the conversation'), value: session.title }));
                if (!session || title === undefined) {
                    return false;
                }
                this.saveHistory(rename(this.history, session.id, title));
                return true;
            }
            case 'deleteSession': {
                const action = t('Delete');
                if (
                    (await vscode.window.showWarningMessage(
                        t('Delete this conversation? This cannot be undone.'),
                        { modal: true },
                        action,
                    )) !== action
                ) {
                    return false;
                }
                const id = params[0] as string;
                this.saveHistory(remove(this.history, id));
                if (id === this.sessionId) {
                    this.reset();
                }
                return true;
            }
            case 'clearSessions': {
                const action = t('Delete all');
                if (
                    (await vscode.window.showWarningMessage(
                        t('Delete all saved conversations of this workspace? This cannot be undone.'),
                        { modal: true },
                        action,
                    )) !== action
                ) {
                    return false;
                }
                this.saveHistory([]);
                this.reset();
                return true;
            }
            default:
                return super.call(method, params);
        }
    }

    /** The chat in the Brokspace sidebar: the home of the assistant. It shares this conversation with the editor tab. */
    resolveWebviewView(view: vscode.WebviewView): void {
        view.webview.options = { enableScripts: true, localResourceRoots: this.resourceRoots() };
        this.attach(view.webview, view.onDidDispose.bind(view), 'workspace');
    }

    /** Opens the chat in the sidebar; `prompt` is sent right away. */
    show(prompt?: string): void {
        void vscode.commands.executeCommand('brokspace.chat.focus');
        this.sendPrompt(prompt);
    }

    /** Opens the chat in an editor tab next to the code, for a larger canvas. */
    showInEditor(prompt?: string): void {
        this.reveal(vscode.ViewColumn.Beside);
        this.sendPrompt(prompt);
    }

    private sendPrompt(prompt?: string): void {
        // A page that is still loading gets the turn with the conversation once it is ready.
        if (prompt?.trim()) {
            void this.send(prompt);
        }
    }

    protected override onReady(): void {
        this.post({ type: 'chat/state', turns: this.turns });
    }

    protected override onOtherMessage(msg: WebviewMessage): void {
        switch (msg.type) {
            case 'chat/send':
                void this.send(msg.text);
                return;
            case 'chat/cancel':
                this.running?.cancel();
                return;
            case 'chat/new':
                this.reset();
                return;
        }
    }

    protected async send(text: string): Promise<void> {
        if (this.running || !text.trim()) {
            return;
        }
        const history = this.turns
            .filter((turn) => turn.kind === 'ask' && turn.done && !turn.error)
            .flatMap((turn) => [
                { role: 'user' as const, content: turn.question },
                { role: 'assistant' as const, content: turn.answer },
            ]);
        const request = parseRequest(text, history);
        const turn: ChatTurn = { id: crypto.randomUUID(), question: text.trim(), kind: request.kind, answer: '', sources: [] };
        const [sessionId, conversation] = [this.sessionId, this.turns]; // the conversation may be replaced while this answers
        conversation.push(turn);
        this.persist(sessionId, conversation);
        this.post({ type: 'chat/turn', turn });
        const running = new vscode.CancellationTokenSource();
        this.running = running;
        try {
            const result = await answer(
                this.model,
                request,
                {
                    progress: (progress) => this.post({ type: 'chat/progress', id: turn.id, text: progress }),
                    markdown: (chunk) => {
                        turn.answer += chunk;
                        this.post({ type: 'chat/chunk', id: turn.id, text: chunk });
                    },
                },
                running.token,
            );
            turn.answer = result.text;
            turn.sources = result.done?.sources ?? [];
            turn.model = result.done?.model ? [result.done.provider, result.done.model].filter(Boolean).join('/') : undefined;
            turn.local = result.local;
            turn.cancelled = running.token.isCancellationRequested;
            turn.done = true;
            if (request.kind === 'ask' && !turn.cancelled) {
                const turns: SessionTurn[] = conversation
                    .filter((done) => done.kind === 'ask' && done.done && !done.error && done.answer)
                    .map((done) => ({ question: done.question, answer: done.answer, sources: done.sources.map(cite) }));
                void this.memory.saveSession(sessionId, turns).catch(() => undefined);
            }
        } catch (error) {
            turn.error = message(error);
            turn.done = true;
        } finally {
            this.running = undefined;
            running.dispose();
            this.persist(sessionId, conversation);
            this.post({ type: 'chat/done', turn });
        }
    }
}

/** The editor's versions, for bug reports. */
function editorContext(): string {
    const extension = vscode.extensions.getExtension('brokspace.brokspace');
    return [
        `Brokspace for VS Code ${extension?.packageJSON?.version ?? ''}`.trim(),
        `${vscode.env.appName} ${vscode.version} (${vscode.env.uiKind === vscode.UIKind.Web ? 'web' : 'desktop'}${vscode.env.remoteName ? `, remote ${vscode.env.remoteName}` : ''})`,
        `UI language: ${vscode.env.language}`,
    ].join('\n');
}

/** The page: the bundle, the codicons and the strings of the UI language. */
function html(webview: vscode.Webview, extensionUri: vscode.Uri, page: Page): string {
    const nonce = crypto.randomBytes(16).toString('base64');
    const asset = (...parts: string[]) => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', ...parts)).toString();
    const boot = {
        page,
        l10n: vscode.l10n.bundle ?? {},
        language: vscode.env.language,
    };
    return `<!doctype html>
<html lang="${vscode.env.language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource}; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${asset('codicons', 'codicon.css')}">
<link rel="stylesheet" href="${asset('webview.css')}">
<title>Brokspace</title>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}">window.__BROKSPACE__ = ${JSON.stringify(boot).replace(/</g, '\\u003c')};</script>
<script nonce="${nonce}" src="${asset('webview.js')}"></script>
</body>
</html>`;
}
