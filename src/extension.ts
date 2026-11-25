// Brokspace for VS Code. SPDX-License-Identifier: MIT OR Apache-2.0

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { registerChatParticipant } from './chat';
import { message } from './core/brok';
import { assetName, installBrok, RELEASES } from './core/installer';
import { type BugInput, type Memory, type MemoryKind, type MemoryScope, MINIMUM_BROK_VERSION } from './core/protocol';
import { lastLines } from './core/text';
import { MemoryStore } from './memory';
import { BrokspaceModel, type BrokspaceState } from './model';
import { searchWorkspace } from './search';
import { type Item, kindIcon, LinksTree, MemoryTree, OverviewTree, ShardsTree, SkillsTree } from './views';
import type { SettingsSection } from './webview-protocol';
import { ChatPanel, SettingsPanel } from './webviews';

const t = vscode.l10n.t;
const INSTALL_URL = 'https://brokspace.org/docs/getting-started#1-install-brok';
const SECTIONS: SettingsSection[] = ['overview', 'model', 'search', 'memory', 'links', 'agents', 'diagnostics', 'report'];

/** What the extension exposes to other extensions and tests. */
export interface BrokspaceApi {
    /** Where Brokspace stands in this window: `ready`, `not-initialized`, `no-brok`... */
    state(): BrokspaceState['kind'];
}

export function activate(context: vscode.ExtensionContext): BrokspaceApi {
    const model = new BrokspaceModel(context.globalStorageUri.fsPath);
    const memory = new MemoryStore(model);
    const settings = new SettingsPanel(context, model, memory);
    const chat = new ChatPanel(context, model, memory);
    const output = vscode.window.createOutputChannel('Brokspace');
    context.subscriptions.push(model, memory, settings, chat, output);

    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('brokspace.overview', new OverviewTree(model)),
        vscode.window.registerTreeDataProvider('brokspace.memory', new MemoryTree(model, memory)),
        vscode.window.registerTreeDataProvider('brokspace.links', new LinksTree(model)),
        vscode.window.registerTreeDataProvider('brokspace.shards', new ShardsTree(model)),
        vscode.window.registerTreeDataProvider('brokspace.skills', new SkillsTree(model)),
    );
    registerChatParticipant(context, model, memory);
    registerMcp(context, model);
    context.subscriptions.push(statusBar(model));

    /** Runs a brok command, shows its output, refreshes; offers a bug report when it fails. */
    const runInOutput = async (title: string, args: string[], success?: string, cancellable = false): Promise<boolean> => {
        const root = model.root;
        if (!root) {
            void vscode.window.showWarningMessage(t('Open a folder first.'));
            return false;
        }
        output.show(true);
        output.appendLine(`\n${title}: brok ${args.join(' ')}`);
        const result = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `${title}…`, cancellable },
            (_progress, token) => {
                const abort = new AbortController();
                token.onCancellationRequested(() => abort.abort());
                return model.brok.run(root, args, abort.signal).then((done) => ({ ...done, cancelled: token.isCancellationRequested }));
            },
        );
        if (result.cancelled) {
            output.appendLine(t('Cancelled. Nothing is lost: run it again to continue.'));
            void model.refresh();
            void vscode.window.showInformationMessage(t('{0} was cancelled. Run it again to continue.', title));
            return false;
        }
        for (const line of `${result.stdout}${result.stderr}`.split(/\r?\n/)) {
            if (line.trim()) {
                output.appendLine(line);
            }
        }
        void model.refresh();
        if (result.code === 0) {
            if (success) {
                void vscode.window.showInformationMessage(success);
            }
            return true;
        }
        void offerReport(t('{0} failed. See the Brokspace output for details.', title), {
            title: `brok ${args[0] ?? ''}: ${title} failed`,
            whatHappened: lastLines(`${result.stdout}${result.stderr}`),
            steps: `brok ${args.join(' ')}`,
        });
        return false;
    };

    const runQuiet = async (args: string[], success: string): Promise<void> => {
        const root = model.root;
        if (!root) {
            return;
        }
        const result = await model.brok.run(root, args);
        if (result.code === 0) {
            void vscode.window.showInformationMessage(success);
        } else {
            const out = (result.stderr || result.stdout).trim();
            void offerReport(t('brok {0} failed: {1}', args.join(' '), out), {
                title: `brok ${args.join(' ')} failed`,
                whatHappened: lastLines(out),
                steps: `brok ${args.join(' ')}`,
            });
        }
        await model.refresh();
    };

    const offerReport = async (text: string, bug: Partial<BugInput>): Promise<void> => {
        const report = t('Report a Bug');
        if ((await vscode.window.showErrorMessage(text, report)) === report) {
            settings.show('report', { bug: { repo: 'brok', ...bug } });
        }
    };

    const requireReady = (): boolean => {
        if (model.ready) {
            return true;
        }
        void vscode.commands.executeCommand('workbench.view.extension.brokspace');
        return false;
    };

    const register = (id: string, run: (...args: never[]) => unknown) =>
        context.subscriptions.push(vscode.commands.registerCommand(id, run as (...args: unknown[]) => unknown));

    // ---------------------------------------------------------------- search, chat, reviews
    register('brokspace.search', () => requireReady() && searchWorkspace(model));
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('brokspace.chat', chat, { webviewOptions: { retainContextWhenHidden: true } }),
    );
    register('brokspace.openChat', () => chat.show());
    register('brokspace.openChatInEditor', () => chat.showInEditor());
    register('brokspace.newChat', () => {
        chat.newChat();
        chat.show();
    });
    register('brokspace.stopChat', () => chat.stop());
    register('brokspace.getStarted', () => {
        chat.getStarted();
        chat.show();
    });
    register('brokspace.ask', async (prompt?: unknown) => {
        if (typeof prompt === 'string' && prompt.trim()) {
            chat.show(prompt);
            return;
        }
        const question = await vscode.window.showInputBox({
            prompt: t('Ask about this workspace'),
            placeHolder: t('How does the refresh flow work?'),
        });
        if (question !== undefined) {
            chat.show(question || undefined);
        }
    });
    register('brokspace.review', () => requireReady() && chat.show('/review'));
    register('brokspace.reviewStaged', () => requireReady() && chat.show('/review staged'));
    register('brokspace.runSkill', async (arg?: unknown) => {
        const root = model.root;
        if (!root || !requireReady()) {
            return;
        }
        let skill = typeof arg === 'string' ? arg : (arg as Item | undefined)?.skill;
        if (!skill) {
            const skills = await model.brok.skills(root);
            const pick = await vscode.window.showQuickPick(
                skills.filter((s) => s.user_invoked).map((s) => ({ label: s.name, description: s.source, detail: s.description })),
                { placeHolder: t('Run a skill on your LLM') },
            );
            skill = pick?.label;
        }
        if (!skill) {
            return;
        }
        const input = await vscode.window.showInputBox({
            prompt: t('What should {0} work on?', skill),
            placeHolder: t('A task, a question, a file…'),
        });
        if (input !== undefined) {
            chat.show(`/skill ${skill} ${input}`);
        }
    });
    register('brokspace.commitMessage', async () => {
        const root = model.root;
        if (!root || !requireReady()) {
            return;
        }
        const git = vscode.extensions.getExtension<GitExtension>('vscode.git');
        const api = (git?.isActive ? git.exports : await git?.activate())?.getAPI(1);
        const repository = api?.repositories.find((repo) => root.startsWith(repo.rootUri.fsPath)) ?? api?.repositories[0];
        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.SourceControl, title: t('Writing the commit message from the staged changes…') },
            async () => {
                try {
                    const text = await model.brok.commitMessage(root);
                    if (repository) {
                        repository.inputBox.value = text;
                    } else {
                        await vscode.env.clipboard.writeText(text);
                        void vscode.window.showInformationMessage(t('Commit message copied to the clipboard.'));
                    }
                } catch (error) {
                    void offerReport(t('Brokspace could not write the commit message: {0}', message(error)), {
                        title: 'brok commit --print failed',
                        whatHappened: message(error),
                        steps: 'brok commit --print',
                    });
                }
            },
        );
    });

    // ---------------------------------------------------------------- memory
    register('brokspace.remember', (initial?: { body?: string }) => requireReady() && remember(memory, initial?.body));
    register('brokspace.rememberSelection', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.selection.isEmpty || !requireReady()) {
            return;
        }
        const { start, end } = editor.selection;
        const code = editor.document.getText(editor.selection).trim();
        const where = `${vscode.workspace.asRelativePath(editor.document.uri)}:${start.line + 1}-${end.line + 1}`;
        await remember(memory, `\`${where}\`\n\n\`\`\`${editor.document.languageId}\n${code}\n\`\`\``);
    });
    register('brokspace.openMemory', async (target?: Memory) => {
        if (target?.path) {
            await vscode.window.showTextDocument(vscode.Uri.file(target.path), { preview: true });
        }
    });
    register('brokspace.forgetMemory', async (arg?: unknown) => {
        if (!requireReady()) {
            return;
        }
        let target = (arg as Item | undefined)?.memory ?? (isMemory(arg) ? arg : undefined);
        if (!target) {
            await memory.ensureLoaded();
            const pick = await vscode.window.showQuickPick(
                memory.memories.map((m) => ({
                    label: `$(${kindIcon(m.kind)}) ${m.title}`,
                    description: `${m.kind} · ${m.scope}`,
                    memory: m,
                })),
                { placeHolder: t('Choose a memory to forget') },
            );
            target = pick?.memory;
        }
        const forget = t('Forget');
        if (target && (await vscode.window.showWarningMessage(t('Forget "{0}"?', target.title), { modal: true }, forget)) === forget) {
            await memory.forget(target).catch((error) => vscode.window.showErrorMessage(message(error)));
        }
    });

    // ---------------------------------------------------------------- linked workspaces
    register('brokspace.addLink', () => requireReady() && settings.show('links', { addLink: true }));
    register('brokspace.syncLinks', async (arg?: unknown) => {
        const root = model.root;
        if (!root || !requireReady()) {
            return;
        }
        const name = (arg as Item | undefined)?.link?.name;
        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: t('Syncing linked workspaces…') },
            async () => {
                try {
                    const failed = (await model.brok.syncLinks(root, name ? [name] : [])).filter((result) => result.error);
                    if (failed.length) {
                        void vscode.window.showWarningMessage(failed.map((result) => `${result.name}: ${result.error}`).join('\n'));
                    } else {
                        void vscode.window.showInformationMessage(t('Linked workspaces are up to date.'));
                    }
                } catch (error) {
                    void vscode.window.showErrorMessage(message(error));
                }
            },
        );
        await model.refresh();
    });
    register('brokspace.removeLink', async (arg?: unknown) => {
        const root = model.root;
        if (!root || !requireReady()) {
            return;
        }
        let name = (arg as Item | undefined)?.link?.name;
        if (!name) {
            const links = model.ready?.status.links ?? [];
            name = (await vscode.window.showQuickPick(links.map((link) => ({ label: link.name, description: link.git ?? link.root }))))
                ?.label;
        }
        const unlink = t('Unlink');
        if (
            name &&
            (await vscode.window.showWarningMessage(
                t('Unlink {0}? Its folder is not touched; the copy and index Brokspace keeps for it are deleted.', name),
                { modal: true },
                unlink,
            )) === unlink
        ) {
            await model.brok.removeLink(root, name).catch((error) => vscode.window.showErrorMessage(message(error)));
            await model.refresh();
        }
    });

    // ---------------------------------------------------------------- settings, diagnostics, reports
    register('brokspace.settings', (section?: unknown) => settings.show(isSection(section) ? section : 'overview'));
    register('brokspace.showDiagnostics', () => settings.show('diagnostics'));
    register('brokspace.reportBug', (bug?: unknown) =>
        settings.show('report', { bug: typeof bug === 'object' && bug ? (bug as Partial<BugInput>) : { repo: 'vscode' } }),
    );

    // ---------------------------------------------------------------- service, setup, shards
    register('brokspace.setup', () => runInOutput(t('Setting up Brokspace'), ['init', '--yes'], t('Brokspace is ready.'), true));
    register('brokspace.start', () => runQuiet(['start'], t('Brokspace started.')));
    register('brokspace.stop', () => runQuiet(['stop'], t('Brokspace stopped.')));
    register('brokspace.restart', () => runQuiet(['restart'], t('Brokspace restarted.')));
    register('brokspace.reindex', () => runInOutput(t('Rebuilding the index'), ['index', '--rebuild'], t('Index rebuilt.')));
    register('brokspace.doctor', () => runInOutput(t('Brokspace doctor'), ['doctor']));
    register('brokspace.showLogs', () => runInOutput(t('Brokspace logs'), ['logs']));
    register('brokspace.connectAgents', () =>
        runInOutput(
            t('Connecting coding agents'),
            ['setup', 'agents', '--yes'],
            t('Coding agents connected: they can search and remember through Brokspace.'),
        ),
    );
    register('brokspace.exportSkills', () =>
        runInOutput(t('Exporting skills'), ['skill', 'export'], t('Skills exported to your coding agents.')),
    );
    register('brokspace.installShard', async () => {
        const source = await vscode.window.showInputBox({
            prompt: t('Install a shard: a git URL or a local folder. Its permissions are listed in the output.'),
            placeHolder: 'https://github.com/someone/some-shard',
        });
        const install = t('Install');
        if (
            source &&
            (await vscode.window.showWarningMessage(
                t('Install {0}? A shard runs on your machine with the permissions its shard.json declares.', source),
                { modal: true },
                install,
            )) === install
        ) {
            await runInOutput(
                t('Installing {0}', source),
                ['shard', 'install', '--yes', source],
                t('Shard installed. Restart Brokspace to start it.'),
            );
        }
    });
    register('brokspace.removeShard', async (arg?: unknown) => {
        let name = (arg as Item | undefined)?.shard?.name;
        if (!name) {
            const shards = (model.ready?.status.shards ?? []).filter((shard) => shard.source !== 'builtin');
            name = (await vscode.window.showQuickPick(shards.map((shard) => ({ label: shard.name, description: shard.version }))))?.label;
        }
        const remove = t('Remove');
        if (name && (await vscode.window.showWarningMessage(t('Remove the shard {0}?', name), { modal: true }, remove)) === remove) {
            await runQuiet(['shard', 'remove', name], t('Removed {0}.', name));
        }
    });
    register('brokspace.addProvider', async () => {
        const root = model.root;
        if (!root || !requireReady()) {
            return;
        }
        const name = await vscode.window.showInputBox({
            prompt: t('Name of the provider (letters, digits, dashes)'),
            placeHolder: 'openrouter',
            validateInput: (value) =>
                /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value) ? undefined : t('Use letters, digits, dashes and underscores.'),
        });
        const baseUrl =
            name &&
            (await vscode.window.showInputBox({
                prompt: t('Base URL of its OpenAI-compatible API, up to /v1'),
                value: 'http://localhost:11434/v1',
            }));
        const llm = baseUrl && (await vscode.window.showInputBox({ prompt: t('Model name'), placeHolder: 'qwen2.5-coder:7b' }));
        if (!name || !baseUrl || !llm) {
            return;
        }
        const keyEnv = await vscode.window.showInputBox({
            prompt: t('Environment variable with its API key (leave empty for local servers)'),
            placeHolder: 'OPENROUTER_API_KEY',
        });
        try {
            await model.brok.setConfig(root, `llm.providers.${name}`, {
                base_url: baseUrl,
                model: llm,
                ...(keyEnv ? { api_key_env: keyEnv } : {}),
            });
            void vscode.window.showInformationMessage(t('Added {0}. Make it the default in Brokspace settings.', name));
        } catch (error) {
            void vscode.window.showErrorMessage(message(error));
        }
        await model.refresh();
    });
    register('brokspace.refresh', () => model.refresh());
    register('brokspace.installHelp', () => vscode.env.openExternal(vscode.Uri.parse(INSTALL_URL)));

    // Download brok on first use, only with the user's consent and never over an existing install.
    let installing: Promise<boolean> | undefined;
    const installBrokCommand = (): Promise<boolean> => {
        installing ??= (async () => {
            const asset = assetName();
            if (!asset) {
                void vscode.window.showWarningMessage(
                    t('There is no brok download for this platform. Install it by hand: {0}', INSTALL_URL),
                );
                return false;
            }
            const confirm = t('Download');
            const answer = await vscode.window.showInformationMessage(
                t(
                    'Brokspace needs the brok command line tool. Download it from {0} (about 150 to 220 MB)? It is checked against its published SHA-256, kept in the extension storage folder and needs no administrator rights.',
                    RELEASES,
                ),
                { modal: true },
                confirm,
            );
            if (answer !== confirm) {
                return false;
            }
            try {
                const installed = await vscode.window.withProgress(
                    { location: vscode.ProgressLocation.Notification, title: t('Downloading brok'), cancellable: true },
                    async (progress, token) => {
                        const abort = new AbortController();
                        token.onCancellationRequested(() => abort.abort());
                        let last = 0;
                        return installBrok({
                            storageDir: context.globalStorageUri.fsPath,
                            signal: abort.signal,
                            onProgress: (received, total) => {
                                if (!total) {
                                    return;
                                }
                                const percent = Math.floor((received / total) * 100);
                                progress.report({ increment: percent - last, message: `${percent}%` });
                                last = percent;
                            },
                        });
                    },
                );
                void vscode.window.showInformationMessage(t('brok {0} installed.', installed.tag));
                await model.reloadBrok();
                return true;
            } catch (error) {
                if (!(error instanceof Error && error.name === 'AbortError')) {
                    void vscode.window.showErrorMessage(t('Could not install brok: {0}', message(error)));
                }
                return false;
            }
        })().finally(() => {
            installing = undefined;
        });
        return installing;
    };
    register('brokspace.installBrok', installBrokCommand);

    void model.refresh().then(async (state) => {
        if (state.kind !== 'no-brok' || context.globalState.get<boolean>('brokspace.skipInstallPrompt')) {
            return;
        }
        const install = t('Install brok');
        const never = t('Do not ask again');
        const choice = await vscode.window.showInformationMessage(
            t('Brokspace needs the brok command line tool, which was not found.'),
            install,
            t('Install guide'),
            never,
        );
        if (choice === install) {
            await installBrokCommand();
        } else if (choice === never) {
            await context.globalState.update('brokspace.skipInstallPrompt', true);
        } else if (choice) {
            await vscode.env.openExternal(vscode.Uri.parse(INSTALL_URL));
        }
    });
    return { state: () => model.state.kind };
}

export function deactivate(): void {}

/** Remember something: a title, then its kind and who sees it. */
async function remember(memory: MemoryStore, body?: string): Promise<void> {
    const title = await vscode.window.showInputBox({
        prompt: t('What should Brokspace remember? One line: a decision, a fact, a convention.'),
        placeHolder: t('Orders are idempotent per cart id'),
    });
    if (!title?.trim()) {
        return;
    }
    const kinds: [MemoryKind, string][] = [
        ['note', t('Note')],
        ['decision', t('Decision')],
        ['fact', t('Fact')],
        ['handoff', t('Handoff')],
    ];
    const kind = await vscode.window.showQuickPick(
        kinds.map(([id, label]) => ({ id, label: `$(${kindIcon(id)}) ${label}` })),
        { placeHolder: t('What is it?') },
    );
    if (!kind) {
        return;
    }
    const scopes: [MemoryScope, string][] = [
        ['private', t('Private: only me, this workspace')],
        ['shared', t('Shared: my team, through git')],
        ['global', t('Global: me, every workspace')],
    ];
    const scope = await vscode.window.showQuickPick(
        scopes.map(([id, label]) => ({ id, label })),
        { placeHolder: t('Who should it be for?') },
    );
    if (!scope) {
        return;
    }
    try {
        const saved = await memory.save({ title, body, kind: kind.id, scope: scope.id });
        if (saved) {
            void vscode.window.showInformationMessage(t('Remembered: {0}', saved.title));
        }
    } catch (error) {
        void vscode.window.showErrorMessage(t('Brokspace could not remember it: {0}', message(error)));
    }
}

/** Service state and model at a glance; opens the Brokspace view. */
function statusBar(model: BrokspaceModel): vscode.Disposable {
    const item = vscode.window.createStatusBarItem('brokspace.status', vscode.StatusBarAlignment.Left, 100);
    item.name = 'Brokspace';
    item.command = 'workbench.view.extension.brokspace';
    const update = (state: BrokspaceState) => {
        if (!vscode.workspace.getConfiguration('brokspace').get<boolean>('statusBar.enabled', true)) {
            item.hide();
            return;
        }
        item.backgroundColor = undefined;
        switch (state.kind) {
            case 'ready': {
                const running = state.status.daemon?.running;
                const label = running ? t('Running') : t('Stopped');
                item.text = `$(${running ? 'pulse' : 'circle-slash'}) Brokspace${state.status.llm?.model ? ` · ${state.status.llm.model}` : ''}`;
                item.tooltip = running
                    ? t('Brokspace is running: the index follows your edits. Click to open.')
                    : `${label}. ${t('Brokspace is stopped: start it for live indexing. Click to open.')}`;
                break;
            }
            case 'not-initialized':
                item.text = `$(rocket) ${t('Set up Brokspace')}`;
                item.tooltip = t('This folder has no Brokspace workspace yet. Click to set it up.');
                break;
            case 'no-brok':
                item.text = `$(warning) ${t('brok not found')}`;
                item.tooltip = t('Install brok to use Brokspace. Click for the options.');
                item.command = 'brokspace.installBrok';
                item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
                break;
            case 'outdated':
                item.text = `$(warning) brok ${state.info.version ?? ''}`;
                item.tooltip = t('This extension needs brok {0} or newer. Run "brok upgrade" in a terminal.', MINIMUM_BROK_VERSION);
                item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
                break;
            case 'error':
                item.text = `$(error) Brokspace`;
                item.tooltip = state.message;
                item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
                break;
            default:
                item.hide();
                return;
        }
        item.show();
    };
    const listener = model.onDidChange(update);
    const settings = vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration('brokspace.statusBar') && update(model.state));
    update(model.state);
    return vscode.Disposable.from(item, listener, settings);
}

/**
 * Offers `brok mcp` to the editor's AI (VS Code 1.101+), so agent mode and
 * other tools get Brokspace search and memory without `brok setup agents`.
 * Skipped when the workspace's .vscode/mcp.json already declares it.
 */
function registerMcp(context: vscode.ExtensionContext, model: BrokspaceModel): void {
    const lm = (vscode as unknown as { lm?: Record<string, unknown> }).lm;
    const register = lm?.registerMcpServerDefinitionProvider as
        | ((
              id: string,
              provider: { onDidChangeMcpServerDefinitions: vscode.Event<void>; provideMcpServerDefinitions(): unknown[] },
          ) => vscode.Disposable)
        | undefined;
    const Definition = (vscode as unknown as { McpStdioServerDefinition?: new (...args: unknown[]) => { cwd?: vscode.Uri } })
        .McpStdioServerDefinition;
    if (typeof register !== 'function' || !Definition) {
        return;
    }
    const changed = new vscode.EventEmitter<void>();
    let wasReady = false;
    context.subscriptions.push(
        changed,
        model.onDidChange((state) => {
            if ((state.kind === 'ready') !== wasReady) {
                wasReady = state.kind === 'ready';
                changed.fire();
            }
        }),
        vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration('brokspace.mcp') && changed.fire()),
        register('brokspace.mcp', {
            onDidChangeMcpServerDefinitions: changed.event,
            provideMcpServerDefinitions: () => {
                const root = model.root;
                if (!root || !model.ready || !vscode.workspace.getConfiguration('brokspace').get<boolean>('mcp.enabled', true)) {
                    return [];
                }
                if (declaredInWorkspace(root)) {
                    return [];
                }
                const definition = new Definition('Brokspace', model.brok.executable, ['mcp'], {}, model.ready.info.version);
                definition.cwd = vscode.Uri.file(root);
                return [definition];
            },
        }),
    );
}

function declaredInWorkspace(root: string): boolean {
    try {
        return /"brokspace"\s*:/.test(fs.readFileSync(path.join(root, '.vscode', 'mcp.json'), 'utf8'));
    } catch {
        return false;
    }
}

function isSection(value: unknown): value is SettingsSection {
    return typeof value === 'string' && (SECTIONS as string[]).includes(value);
}

function isMemory(value: unknown): value is Memory {
    return (
        typeof value === 'object' &&
        value !== null &&
        typeof (value as Memory).id === 'string' &&
        typeof (value as Memory).scope === 'string'
    );
}

/** The part of the built-in Git extension's API used here. */
interface GitExtension {
    getAPI(version: 1): { repositories: { rootUri: vscode.Uri; inputBox: { value: string } }[] };
}
