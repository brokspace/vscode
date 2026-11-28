// Brokspace for VS Code. SPDX-License-Identifier: MIT OR Apache-2.0
// Ported from Brokspace IDE's settings widget (brokspace/ide).

import * as React from 'react';
import type {
    BrokConfig,
    BugInput,
    BugRepo,
    BugReport,
    DoctorCheck,
    LinkInput,
    LinkStatus,
    LlmProvider,
    Memory,
    MemoryKind,
    MemoryScope,
    StatsSummary,
} from '../src/core/protocol';
import { firstLine, formatMs, suggestName } from '../src/core/text';
import type { SettingsSection, ShowOptions } from '../src/webview-protocol';
import { codicon, type Host, t } from './host';

const SECTIONS: { id: SettingsSection; icon: string }[] = [
    { id: 'overview', icon: 'home' },
    { id: 'model', icon: 'hubot' },
    { id: 'search', icon: 'search' },
    { id: 'memory', icon: 'library' },
    { id: 'links', icon: 'link' },
    { id: 'agents', icon: 'plug' },
    { id: 'diagnostics', icon: 'pulse' },
    { id: 'report', icon: 'bug' },
];

const MEMORY_SCOPES: MemoryScope[] = ['private', 'shared', 'global'];

const MEMORY_KINDS: MemoryKind[] = ['note', 'decision', 'fact', 'handoff', 'session'];

/**
 * Brokspace settings, in an editor tab: the workspace at a glance, the LLM,
 * search and index, memory, linked workspaces, coding agents, diagnostics
 * and bug reports. Every change goes through `brok config` (validated,
 * written to brok.yml at once); the page asks to restart brok when it runs.
 */
export class SettingsApp extends React.Component<{ host: Host }> {
    protected section: SettingsSection = 'overview';
    protected config: BrokConfig | undefined;
    protected configError: string | undefined;
    /** Key -> outcome of its last change. */
    protected feedback = new Map<string, { ok: boolean; text: string }>();
    protected needsRestart = false;
    protected busy = new Set<string>();

    protected memoryFilter = '';
    protected memoryScope: MemoryScope | 'all' = 'all';
    protected draft: { title: string; body: string; kind: MemoryKind; scope: MemoryScope; tags: string } = emptyDraft();
    protected showDraft = false;
    protected linkDraft: LinkInput & { open: boolean } = emptyLink();

    protected stats: StatsSummary | undefined;
    protected statsError: string | undefined;
    protected statsDays = 7;
    protected checks: DoctorCheck[] | undefined;
    protected checksError: string | undefined;
    protected bug: BugInput = { repo: 'vscode', title: '' };
    protected prepared: BugReport | undefined;
    protected unsubscribe: (() => void) | undefined;

    protected get host(): Host {
        return this.props.host;
    }

    override componentDidMount(): void {
        let wasReady = this.host.state.kind === 'ready';
        this.unsubscribe = this.host.on((msg) => {
            if (msg.type === 'show') {
                this.showSection(msg.section, msg.options);
                return;
            }
            if (msg.type === 'state' && (this.host.state.kind === 'ready') !== wasReady) {
                wasReady = this.host.state.kind === 'ready';
                this.loadConfig();
            }
            this.update();
        });
        this.loadConfig();
    }

    override componentWillUnmount(): void {
        this.unsubscribe?.();
    }

    protected update(): void {
        this.forceUpdate();
    }

    /** Shows a section; `links` with `addLink` opens the form to link a workspace. */
    showSection(section: SettingsSection, options: ShowOptions = {}): void {
        this.section = section;
        if (options.addLink) {
            this.linkDraft.open = true;
        }
        if (options.addMemory) {
            this.showDraft = true;
        }
        if (options.bug) {
            this.bug = { ...this.bug, ...options.bug };
            this.prepared = undefined;
        }
        if (section === 'memory') {
            void this.host.rpc('reloadMemories');
        }
        this.update();
    }

    protected async loadConfig(): Promise<void> {
        if (!this.host.root || this.host.state.kind !== 'ready') {
            return;
        }
        try {
            this.config = await this.host.rpc<BrokConfig>('config');
            this.configError = undefined;
        } catch (error) {
            this.configError = message(error);
        }
        this.update();
    }

    // ------------------------------------------------------------------ layout

    override render(): React.ReactNode {
        const state = this.host.state;
        if (state.kind !== 'ready') {
            return (
                <div className="bk-settings-empty">
                    <span className={`bk-card-icon ${codicon('settings-gear')}`} aria-hidden="true" />
                    <p>{t('Brokspace settings appear once Brokspace is set up in this folder.')}</p>
                    <button type="button" className="theia-button main" onClick={() => this.run('workbench.view.extension.brokspace')}>
                        {t('Open Brokspace')}
                    </button>
                </div>
            );
        }
        return (
            <div className="bk-settings">
                <nav className="bk-settings-nav" aria-label={t('Brokspace Settings')}>
                    {SECTIONS.map(({ id, icon }) => (
                        <button
                            type="button"
                            key={id}
                            className={`bk-settings-tab ${this.section === id ? 'bk-settings-tab-on' : ''}`}
                            aria-current={this.section === id ? 'page' : undefined}
                            aria-label={sectionTitle(id)}
                            title={sectionTitle(id)}
                            onClick={() => this.showSection(id)}
                        >
                            <span className={codicon(icon)} aria-hidden="true" />
                            <span>{sectionTitle(id)}</span>
                        </button>
                    ))}
                </nav>
                <main className="bk-settings-main">
                    <header className="bk-settings-header">
                        <h1>{sectionTitle(this.section)}</h1>
                        <p>{sectionDescription(this.section)}</p>
                    </header>
                    {this.needsRestart && state.status.daemon?.running && (
                        <div className="bk-banner">
                            <span className={codicon('info')} aria-hidden="true" />
                            <span>{t('Brokspace is running with the previous settings.')}</span>
                            <button type="button" className="theia-button main" onClick={() => this.restart()}>
                                {t('Restart now')}
                            </button>
                        </div>
                    )}
                    {this.configError && (
                        <div className="bk-banner bk-banner-error">
                            <span className={codicon('error')} aria-hidden="true" />
                            <span>{this.configError}</span>
                        </div>
                    )}
                    {this.renderSection()}
                </main>
            </div>
        );
    }

    protected renderSection(): React.ReactNode {
        switch (this.section) {
            case 'overview':
                return this.renderOverview();
            case 'model':
                return this.renderModel();
            case 'search':
                return this.renderSearch();
            case 'memory':
                return this.renderMemory();
            case 'links':
                return this.renderLinks();
            case 'agents':
                return this.renderAgents();
            case 'diagnostics':
                return this.renderDiagnostics();
            case 'report':
                return this.renderReport();
        }
    }

    // ------------------------------------------------------------------ sections

    protected renderOverview(): React.ReactNode {
        const state = this.host.state;
        if (state.kind !== 'ready') {
            return undefined;
        }
        const { status } = state;
        const running = !!status.daemon?.running;
        const files = (status.index ?? []).reduce((sum, p) => sum + p.files, 0);
        const hybrid = (status.index ?? []).some((p) => p.semantic);
        const counts = status.memory?.counts;
        const memories = counts ? counts.private + counts.shared + counts.global : 0;
        const tile = (icon: string, label: string, value: string, section?: SettingsSection) => (
            <button type="button" className="bk-tile" disabled={!section} onClick={() => section && this.showSection(section)}>
                <span className={`bk-tile-icon ${codicon(icon)}`} aria-hidden="true" />
                <span className="bk-tile-label">{label}</span>
                <span className="bk-tile-value" title={value}>
                    {value}
                </span>
            </button>
        );
        return (
            <>
                <div className="bk-tiles">
                    {tile(running ? 'pass-filled' : 'circle-large-outline', t('Service'), running ? t('Running') : t('Stopped'))}
                    {tile(
                        'hubot',
                        t('AI model'),
                        status.llm?.model ? `${status.llm.model} · ${status.llm.provider}` : t('None: local answers'),
                        'model',
                    )}
                    {tile('database', t('Index'), t('{0} files · {1}', files.toLocaleString(), hybrid ? t('hybrid') : t('text')), 'search')}
                    {tile('library', t('Memories'), status.memory?.enabled === false ? t('Off') : memories.toLocaleString(), 'memory')}
                    {tile('link', t('Linked workspaces'), String(status.links?.length ?? 0), 'links')}
                    {tile('extensions', t('Shards'), String(status.shards?.length ?? 0))}
                </div>
                <div className="bk-settings-group">
                    <div className="bk-setting">
                        <div className="bk-setting-text">
                            <div className="bk-setting-label">{t('Workspace')}</div>
                            <div className="bk-setting-description bk-mono">{status.root}</div>
                        </div>
                        <div className="bk-setting-control bk-buttons">
                            <button type="button" className="theia-button secondary" onClick={() => this.openConfigFile()}>
                                {t('Open brok.yml')}
                            </button>
                        </div>
                    </div>
                    <div className="bk-setting">
                        <div className="bk-setting-text">
                            <div className="bk-setting-label">{t('Service')}</div>
                            <div className="bk-setting-description">
                                {t('The background brok keeps the index in step with your edits and runs the agent and shards.')}
                            </div>
                        </div>
                        <div className="bk-setting-control bk-buttons">
                            {running ? (
                                <>
                                    <button type="button" className="theia-button secondary" onClick={() => this.restart()}>
                                        {t('Restart')}
                                    </button>
                                    <button type="button" className="theia-button secondary" onClick={() => this.run('brokspace.stop')}>
                                        {t('Stop')}
                                    </button>
                                </>
                            ) : (
                                <button type="button" className="theia-button main" onClick={() => this.run('brokspace.start')}>
                                    {t('Start')}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </>
        );
    }

    protected renderModel(): React.ReactNode {
        const config = this.config;
        if (!config) {
            return this.loadingConfig();
        }
        // The default first, then the others by name.
        const providers = Object.entries(config.llm.providers).sort(
            ([a], [b]) => Number(b === config.llm.default) - Number(a === config.llm.default) || a.localeCompare(b),
        );
        return (
            <>
                <div className="bk-settings-group">
                    {this.select(
                        'llm.default',
                        config.llm.default,
                        providers.map(([name, p]) => [name, `${name} · ${p.model}`]),
                        t('Default model'),
                        t('Every question, review and skill goes through brok to this provider.'),
                    )}
                </div>
                {providers.map(([name, provider]) => this.renderProvider(name, provider, name === config.llm.default))}
                <p className="bk-settings-note">
                    {t(
                        'Providers are OpenAI-compatible endpoints: Ollama, LM Studio or a hosted API. API keys stay in environment variables; brok.yml only names the variable.',
                    )}
                </p>
                <div className="bk-buttons">
                    <button type="button" className="theia-button secondary" onClick={() => this.addProvider()}>
                        <span className={codicon('add')} aria-hidden="true" /> {t('Add provider')}
                    </button>
                    <button type="button" className="theia-button secondary" onClick={() => this.run('brokspace.doctor')}>
                        {t('Check the connection')}
                    </button>
                </div>
            </>
        );
    }

    protected renderProvider(name: string, provider: LlmProvider, isDefault: boolean): React.ReactNode {
        const key = `llm.providers.${name}`;
        return (
            <section key={name} className="bk-settings-group" aria-label={name}>
                <div className="bk-group-head">
                    <span className="bk-group-title">{name}</span>
                    {isDefault && <span className="bk-badge bk-badge-accent">{t('default')}</span>}
                    <span className="bk-spacer" />
                    {!isDefault && (
                        <>
                            <button type="button" className="bk-link-button" onClick={() => this.save('llm.default', name)}>
                                {t('Make default')}
                            </button>
                            {this.iconButton('trash', t('Remove {0}', name), () => this.unset(key))}
                        </>
                    )}
                </div>
                {this.text(`${key}.model`, provider.model, t('Model'), '', 'qwen2.5-coder:7b')}
                {this.text(`${key}.base_url`, provider.base_url, t('Base URL'), '', 'http://localhost:11434/v1')}
                {this.text(
                    `${key}.api_key_env`,
                    provider.api_key_env ?? '',
                    t('API key variable'),
                    t('Name of the environment variable that holds the key (never the key itself).'),
                    'OPENAI_API_KEY',
                    true,
                )}
            </section>
        );
    }

    protected renderSearch(): React.ReactNode {
        const config = this.config;
        if (!config) {
            return this.loadingConfig();
        }
        return (
            <>
                <div className="bk-settings-group">
                    {this.toggle(
                        'embeddings.enabled',
                        config.embeddings.enabled,
                        t('Search by meaning'),
                        t(
                            'A local embedding model ({0}) finds code by meaning, not only by words. Turning it on or off rebuilds the index.',
                            config.embeddings.model,
                        ),
                    )}
                    {this.number(
                        'search.limit',
                        config.search.limit,
                        t('Results per search'),
                        t('Also how much context a question gets.'),
                        1,
                        50,
                        1,
                    )}
                    {this.number(
                        'search.cold_weight',
                        config.search.cold_weight,
                        t('Weight outside the current repository'),
                        t('Results from other submodules and nested repositories are scaled by this (0 to 1).'),
                        0,
                        1,
                        0.05,
                    )}
                    {this.number(
                        'search.link_weight',
                        config.search.link_weight,
                        t('Weight of linked workspaces'),
                        t('Results from linked workspaces are scaled by this (0 to 1), so your code wins ties.'),
                        0,
                        1,
                        0.05,
                    )}
                </div>
                <div className="bk-settings-group">
                    {this.toggle(
                        'workspace.submodules',
                        config.workspace.submodules,
                        t('Index submodules separately'),
                        t('Git submodules and nested repositories get their own small index, quick to update.'),
                    )}
                    {this.number(
                        'index.max_file_kb',
                        config.index.max_file_kb,
                        t('Largest file (KB)'),
                        t('Bigger files are skipped.'),
                        16,
                        16384,
                        16,
                    )}
                    {this.list(
                        'index.exclude',
                        config.index.exclude,
                        t('Skip these files'),
                        t('Glob patterns, one per line. .gitignore is always honored too.'),
                    )}
                </div>
                <div className="bk-buttons">
                    <button type="button" className="theia-button secondary" onClick={() => this.run('brokspace.reindex')}>
                        {t('Rebuild Index')}
                    </button>
                </div>
            </>
        );
    }

    protected renderMemory(): React.ReactNode {
        const config = this.config;
        if (!config) {
            return this.loadingConfig();
        }
        const enabled = config.memory.enabled;
        return (
            <>
                <div className="bk-settings-group">
                    {this.toggle(
                        'memory.enabled',
                        enabled,
                        t('Remember between sessions'),
                        t('Decisions, facts and notes are found with your code by questions, searches and coding agents.'),
                    )}
                    {this.toggle(
                        'memory.sessions',
                        config.memory.sessions,
                        t('Remember chat sessions'),
                        t('Each chat with the Brokspace agent is saved as a private memory, so the next one can build on it.'),
                        !enabled,
                    )}
                    {this.toggle(
                        'memory.global',
                        config.memory.global,
                        t('Use my global memories'),
                        t('Your personal memories, shared by every workspace (preferences, conventions).'),
                        !enabled,
                    )}
                </div>
                {enabled && this.renderMemories()}
            </>
        );
    }

    protected renderMemories(): React.ReactNode {
        const filter = this.memoryFilter.trim().toLowerCase();
        const memories = this.host.memories.filter(
            (m) =>
                (this.memoryScope === 'all' || m.scope === this.memoryScope) &&
                (!filter || `${m.title}\n${m.body}\n${m.tags.join(' ')}`.toLowerCase().includes(filter)),
        );
        return (
            <section className="bk-settings-group">
                <div className="bk-group-head">
                    <span className="bk-group-title">{t('Memories')}</span>
                    <span className="bk-spacer" />
                    <button
                        type="button"
                        className="theia-button main bk-compact"
                        onClick={() => {
                            this.showDraft = !this.showDraft;
                            this.update();
                        }}
                    >
                        <span className={codicon(this.showDraft ? 'close' : 'add')} aria-hidden="true" /> {t('New memory')}
                    </button>
                </div>
                {this.showDraft && this.renderDraft()}
                <div className="bk-filters">
                    <input
                        className="theia-input bk-grow"
                        aria-label={t('Filter memories')}
                        placeholder={t('Filter memories')}
                        value={this.memoryFilter}
                        spellCheck={false}
                        onChange={(e) => {
                            this.memoryFilter = e.currentTarget.value;
                            this.update();
                        }}
                    />
                    <div className="bk-chips" role="radiogroup" aria-label={t('Who sees it')}>
                        {(['all', ...MEMORY_SCOPES] as const).map((scope) => (
                            <button
                                type="button"
                                key={scope}
                                role="radio"
                                aria-checked={this.memoryScope === scope}
                                className={`bk-chip ${this.memoryScope === scope ? 'bk-chip-on' : ''}`}
                                onClick={() => {
                                    this.memoryScope = scope;
                                    this.update();
                                }}
                            >
                                {scope === 'all' ? t('All') : scopeLabel(scope)}
                            </button>
                        ))}
                    </div>
                </div>
                {this.host.memoriesError && <div className="bk-error">{this.host.memoriesError}</div>}
                {!this.host.memoriesLoaded ? (
                    <div className="bk-muted">{t('Loading…')}</div>
                ) : memories.length === 0 ? (
                    <div className="bk-muted">
                        {this.host.memories.length
                            ? t('No memory matches.')
                            : t('Nothing remembered yet. Add a decision here, or ask your coding agent to remember something.')}
                    </div>
                ) : (
                    <ul className="bk-memory-list">{memories.map((m) => this.renderMemoryItem(m))}</ul>
                )}
            </section>
        );
    }

    protected renderMemoryItem(memory: Memory): React.ReactNode {
        return (
            <li key={`${memory.scope}:${memory.id}`} className="bk-memory">
                <button type="button" className="bk-memory-main" title={memory.path} onClick={() => this.host.openFile(memory.path)}>
                    <span className="bk-memory-title">{memory.title}</span>
                    <span className="bk-memory-body">{firstLine(memory.body)}</span>
                    <span className="bk-memory-meta">
                        <span className={`bk-badge bk-kind-${memory.kind}`}>{kindLabel(memory.kind)}</span>
                        <span className="bk-badge">{scopeLabel(memory.scope)}</span>
                        {memory.tags.map((tag) => (
                            <span key={tag} className="bk-tag">
                                #{tag}
                            </span>
                        ))}
                        <span className="bk-memory-date">{memory.updated.slice(0, 10)}</span>
                    </span>
                </button>
                <span className="bk-memory-actions">{this.iconButton('trash', t('Forget'), () => this.forget(memory))}</span>
            </li>
        );
    }

    protected renderDraft(): React.ReactNode {
        const draft = this.draft;
        const set = (patch: Partial<typeof draft>) => {
            this.draft = { ...draft, ...patch };
            this.update();
        };
        return (
            <form
                className="bk-draft"
                onSubmit={(e) => {
                    e.preventDefault();
                    this.saveDraft();
                }}
            >
                <input
                    className="theia-input"
                    autoFocus
                    aria-label={t('What to remember, in one line')}
                    placeholder={t('What to remember, in one line')}
                    value={draft.title}
                    onChange={(e) => set({ title: e.currentTarget.value })}
                />
                <textarea
                    className="theia-input"
                    rows={4}
                    aria-label={t('Details: why, where, what to watch out for (Markdown)')}
                    placeholder={t('Details: why, where, what to watch out for (Markdown)')}
                    value={draft.body}
                    onChange={(e) => set({ body: e.currentTarget.value })}
                />
                <div className="bk-draft-row">
                    <select
                        className="theia-select"
                        value={draft.kind}
                        aria-label={t('Kind')}
                        onChange={(e) => set({ kind: e.currentTarget.value as MemoryKind })}
                    >
                        {MEMORY_KINDS.filter((k) => k !== 'session').map((kind) => (
                            <option key={kind} value={kind}>
                                {kindLabel(kind)}
                            </option>
                        ))}
                    </select>
                    <select
                        className="theia-select"
                        value={draft.scope}
                        aria-label={t('Who sees it')}
                        onChange={(e) => set({ scope: e.currentTarget.value as MemoryScope })}
                    >
                        {MEMORY_SCOPES.map((scope) => (
                            <option key={scope} value={scope}>
                                {scopeDescription(scope)}
                            </option>
                        ))}
                    </select>
                    <input
                        className="theia-input bk-grow"
                        aria-label={t('Tags, separated by commas')}
                        placeholder={t('Tags, separated by commas')}
                        value={draft.tags}
                        onChange={(e) => set({ tags: e.currentTarget.value })}
                    />
                    <button type="submit" className="theia-button main" disabled={!draft.title.trim() || this.busy.has('memory')}>
                        {t('Remember')}
                    </button>
                </div>
            </form>
        );
    }

    protected renderLinks(): React.ReactNode {
        const state = this.host.state;
        const links = state.kind === 'ready' ? (state.status.links ?? []) : [];
        return (
            <>
                {links.length === 0 && !this.linkDraft.open && (
                    <div className="bk-settings-group bk-empty-group">
                        <p>
                            {t(
                                'Working on a service that calls another one? Link it: questions and searches then know both, and their memories.',
                            )}
                        </p>
                    </div>
                )}
                {links.map((link) => this.renderLink(link))}
                {this.linkDraft.open ? (
                    this.renderLinkDraft()
                ) : (
                    <div className="bk-buttons">
                        <button
                            type="button"
                            className="theia-button main"
                            onClick={() => {
                                this.linkDraft.open = true;
                                this.update();
                            }}
                        >
                            <span className={codicon('link')} aria-hidden="true" /> {t('Link a workspace')}
                        </button>
                        {links.length > 0 && (
                            <button
                                type="button"
                                className="theia-button secondary"
                                disabled={this.busy.has('sync')}
                                onClick={() => this.syncLinks()}
                            >
                                <span className={codicon('sync')} aria-hidden="true" /> {t('Sync all')}
                            </button>
                        )}
                    </div>
                )}
            </>
        );
    }

    protected renderLink(link: LinkStatus): React.ReactNode {
        const syncing = this.busy.has(`sync:${link.name}`);
        return (
            <section key={link.name} className="bk-settings-group">
                <div className="bk-group-head">
                    <span className={codicon(link.kind === 'git' ? 'repo' : 'folder')} aria-hidden="true" />
                    <span className="bk-group-title">{link.name}</span>
                    <span className="bk-badge">{link.kind === 'git' ? 'git' : t('folder')}</span>
                    {link.index === 'own' && (
                        <span className="bk-badge" title={t('A Brokspace workspace: its own index and memories are used.')}>
                            Brokspace
                        </span>
                    )}
                    <span className="bk-spacer" />
                    {this.iconButton(syncing ? 'loading codicon-modifier-spin' : 'sync', t('Sync'), () => this.syncLinks(link.name))}
                    {this.iconButton('trash', t('Unlink {0}', link.name), () => this.removeLink(link))}
                </div>
                {link.description && <p className="bk-settings-note">{link.description}</p>}
                <dl className="bk-props">
                    <dt>{t('Location')}</dt>
                    <dd className="bk-mono" title={link.path}>
                        {link.git ?? link.root}
                    </dd>
                    {link.branch && (
                        <>
                            <dt>{t('Branch')}</dt>
                            <dd>{link.branch}</dd>
                        </>
                    )}
                    <dt>{t('Index')}</dt>
                    <dd className={link.error ? 'bk-warn' : ''}>
                        {link.error ?? t('{0} files, {1} chunks', link.files.toLocaleString(), link.chunks.toLocaleString())}
                    </dd>
                    <dt>{t('Memories')}</dt>
                    <dd>{link.memory ? t('searched') : t('not searched')}</dd>
                </dl>
            </section>
        );
    }

    protected renderLinkDraft(): React.ReactNode {
        const draft = this.linkDraft;
        const isGit = /:\/\/|^git@|\.git$/.test(draft.target.trim());
        const set = (patch: Partial<typeof draft>) => {
            this.linkDraft = { ...draft, ...patch };
            this.update();
        };
        const busy = this.busy.has('link');
        return (
            <form
                className="bk-settings-group bk-draft"
                onSubmit={(e) => {
                    e.preventDefault();
                    this.addLink();
                }}
            >
                <div className="bk-group-head">
                    <span className="bk-group-title">{t('Link a workspace')}</span>
                </div>
                <div className="bk-field">
                    <span>{t('Folder or git URL')}</span>
                    <div className="bk-draft-row">
                        <input
                            className="theia-input bk-grow bk-mono"
                            autoFocus
                            aria-label={t('Folder or git URL')}
                            placeholder="../checkout · https://github.com/acme/checkout.git"
                            value={draft.target}
                            onChange={(e) => {
                                const target = e.currentTarget.value;
                                set({ target, name: draft.name || suggestName(target) });
                            }}
                        />
                        <button type="button" className="theia-button secondary" onClick={() => this.chooseFolder()}>
                            {t('Choose folder…')}
                        </button>
                    </div>
                </div>
                <div className="bk-draft-row">
                    <label className="bk-field bk-grow">
                        <span>{t('Name')}</span>
                        <input
                            className="theia-input"
                            placeholder="checkout"
                            value={draft.name}
                            onChange={(e) => set({ name: e.currentTarget.value })}
                        />
                    </label>
                    {isGit && (
                        <label className="bk-field bk-grow">
                            <span>{t('Branch')}</span>
                            <input
                                className="theia-input"
                                placeholder="main"
                                value={draft.branch ?? ''}
                                onChange={(e) => set({ branch: e.currentTarget.value })}
                            />
                        </label>
                    )}
                </div>
                <label className="bk-field">
                    <span>{t('How this workspace uses it (optional, helps the AI)')}</span>
                    <input
                        className="theia-input"
                        placeholder={t('Carts and payments; we call its createOrder API')}
                        value={draft.description ?? ''}
                        onChange={(e) => set({ description: e.currentTarget.value })}
                    />
                </label>
                <label className="bk-check">
                    <input type="checkbox" checked={draft.memory !== false} onChange={(e) => set({ memory: e.currentTarget.checked })} />
                    <span>{t('Search its memories too')}</span>
                </label>
                <div className="bk-buttons">
                    <button type="submit" className="theia-button main" disabled={busy || !draft.name.trim() || !draft.target.trim()}>
                        {busy ? t('Linking and indexing…') : t('Link and index')}
                    </button>
                    <button
                        type="button"
                        className="theia-button secondary"
                        disabled={busy}
                        onClick={() => {
                            this.linkDraft = emptyLink();
                            this.update();
                        }}
                    >
                        {t('Cancel')}
                    </button>
                </div>
            </form>
        );
    }

    protected renderAgents(): React.ReactNode {
        const action = (icon: string, title: string, text: string, label: string, command: string) => (
            <div className="bk-setting">
                <span className={`bk-setting-icon ${codicon(icon)}`} aria-hidden="true" />
                <div className="bk-setting-text">
                    <div className="bk-setting-label">{title}</div>
                    <div className="bk-setting-description">{text}</div>
                </div>
                <div className="bk-setting-control">
                    <button type="button" className="theia-button secondary" onClick={() => this.run(command)}>
                        {label}
                    </button>
                </div>
            </div>
        );
        return (
            <div className="bk-settings-group">
                {action(
                    'plug',
                    t('Connect coding agents'),
                    t('Gives Claude Code, Cursor, VS Code / Copilot and Codex Brokspace search and memory over MCP, plus the skills.'),
                    t('Connect'),
                    'brokspace.connectAgents',
                )}
                {action(
                    'export',
                    t('Export Skills to Coding Agents'),
                    t('Copies the skills to .claude/skills and .agents/skills again, after you add or change one.'),
                    t('Export'),
                    'brokspace.exportSkills',
                )}
                {action(
                    'library',
                    t('Shards'),
                    t('Shards add integrations and skill packs. Manage them in the Brokspace view.'),
                    t('Manage'),
                    'workbench.view.extension.brokspace',
                )}
            </div>
        );
    }

    protected renderDiagnostics(): React.ReactNode {
        const state = this.host.state;
        if (state.kind !== 'ready') {
            return undefined;
        }
        if (!this.stats && !this.statsError && !this.busy.has('stats')) {
            this.loadStats();
        }
        if (!this.checks && !this.checksError && !this.busy.has('doctor')) {
            this.loadChecks();
        }
        return (
            <>
                {this.renderActivity()}
                {this.renderHealth()}
                <section className="bk-settings-group">
                    <div className="bk-group-head">
                        <span className="bk-group-title">{t('Details')}</span>
                    </div>
                    <dl className="bk-props bk-props-wide">
                        <dt>brok</dt>
                        <dd className="bk-mono">
                            {state.info.version} · {state.info.path}
                        </dd>
                        <dt>{t('Backends')}</dt>
                        <dd>{(state.status.backends ?? []).join(', ') || '—'}</dd>
                        <dt>{t('Embeddings')}</dt>
                        <dd>
                            {state.status.embeddings?.enabled
                                ? `${state.status.embeddings.model} · ${state.status.embeddings.dimensions}d`
                                : t('Off')}
                        </dd>
                        {(state.status.index ?? []).map((p) => (
                            <React.Fragment key={`${p.tier}:${p.path}`}>
                                <dt>{p.tier === 'cold' ? t('Root') : p.path}</dt>
                                <dd>{t('{0} files · {1} chunks · {2}', p.files.toLocaleString(), p.chunks.toLocaleString(), p.backend)}</dd>
                            </React.Fragment>
                        ))}
                    </dl>
                </section>
                <div className="bk-buttons">
                    <button type="button" className="theia-button secondary" onClick={() => this.run('brokspace.showLogs')}>
                        {t('Show Logs')}
                    </button>
                    <button type="button" className="theia-button secondary" onClick={() => this.openConfigFile()}>
                        {t('Open brok.yml')}
                    </button>
                    <button type="button" className="theia-button secondary" onClick={() => this.showSection('report')}>
                        <span className={codicon('bug')} aria-hidden="true" /> {t('Report a bug')}
                    </button>
                </div>
            </>
        );
    }

    /** Local metrics (`brok stats`): latencies, failures and the latest errors. */
    protected renderActivity(): React.ReactNode {
        const stats = this.stats;
        const ms = (value?: number | null) => (value === undefined || value === null ? '—' : formatMs(value));
        const tile = (icon: string, label: string, value: string, detail: string, warn = false) => (
            <div className={`bk-tile bk-tile-static ${warn ? 'bk-tile-warn' : ''}`}>
                <span className={`bk-tile-icon ${codicon(icon)}`} aria-hidden="true" />
                <span className="bk-tile-label">{label}</span>
                <span className="bk-tile-value">{value}</span>
                <span className="bk-tile-detail" title={detail}>
                    {detail}
                </span>
            </div>
        );
        return (
            <section className="bk-settings-group">
                <div className="bk-group-head">
                    <span className="bk-group-title">{t('Activity')}</span>
                    <span className="bk-spacer" />
                    <div className="bk-chips" role="radiogroup" aria-label={t('Period')}>
                        {[1, 7, 30].map((days) => (
                            <button
                                type="button"
                                key={days}
                                role="radio"
                                aria-checked={this.statsDays === days}
                                className={`bk-chip ${this.statsDays === days ? 'bk-chip-on' : ''}`}
                                onClick={() => {
                                    this.statsDays = days;
                                    this.loadStats();
                                }}
                            >
                                {t('{0}d', days)}
                            </button>
                        ))}
                    </div>
                    {this.iconButton(this.busy.has('stats') ? 'loading codicon-modifier-spin' : 'refresh', t('Refresh'), () =>
                        this.loadStats(),
                    )}
                </div>
                {this.statsError && <div className="bk-error">{this.statsError}</div>}
                {!stats ? (
                    <div className="bk-muted">{t('Loading…')}</div>
                ) : stats.events === 0 ? (
                    <p className="bk-settings-note">
                        {t(
                            'Nothing recorded yet. Searches, answers and indexing show up here as you use Brokspace; metrics stay on this machine.',
                        )}
                    </p>
                ) : (
                    <>
                        <div className="bk-tiles bk-tiles-dense">
                            {tile(
                                'search',
                                t('Searches'),
                                stats.search.latency.count.toLocaleString(),
                                t('p50 {0} · p95 {1}', ms(stats.search.latency.p50_ms), ms(stats.search.latency.p95_ms)),
                            )}
                            {tile(
                                'comment-discussion',
                                t('Answers'),
                                stats.answers.latency.count.toLocaleString(),
                                t('p50 {0} · first words {1}', ms(stats.answers.latency.p50_ms), ms(stats.answers.first_token.p50_ms)),
                                stats.answers.failed > 0,
                            )}
                            {tile(
                                'database',
                                t('Indexing'),
                                stats.index.latency.count.toLocaleString(),
                                t('{0} files · p50 {1}', stats.index.files_indexed.toLocaleString(), ms(stats.index.latency.p50_ms)),
                            )}
                            {tile(
                                'error',
                                t('Errors'),
                                stats.errors.count.toLocaleString(),
                                stats.answers.failed > 0
                                    ? t('{0} answers failed', stats.answers.failed)
                                    : t('{0} searches found nothing', stats.search.empty),
                                stats.errors.count > 0,
                            )}
                        </div>
                        {stats.errors.recent.length > 0 && (
                            <ul className="bk-errors">
                                {stats.errors.recent.map((error) => (
                                    <li key={`${error.at}:${error.command}`} className="bk-error-row">
                                        <span className={`bk-error-icon ${codicon('error')}`} aria-hidden="true" />
                                        <span className="bk-error-text">
                                            <span className="bk-mono">brok {error.command}</span> ·{' '}
                                            <span className="bk-muted-inline">{error.at.slice(0, 16).replace('T', ' ')}</span>
                                            <span className="bk-error-message" title={error.message}>
                                                {error.message}
                                            </span>
                                        </span>
                                        <button
                                            type="button"
                                            className="bk-link-button"
                                            onClick={() =>
                                                this.prepareReport({
                                                    title: `brok ${error.command}: ${error.message.slice(0, 80)}`,
                                                    whatHappened: error.message,
                                                })
                                            }
                                        >
                                            {t('Report')}
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </>
                )}
            </section>
        );
    }

    /** `brok doctor`: what works, what does not and the fix. */
    protected renderHealth(): React.ReactNode {
        const checks = this.checks;
        const icon = (status: DoctorCheck['status']) => (status === 'ok' ? 'pass' : status === 'warn' ? 'warning' : 'error');
        const failing = checks?.filter((check) => check.status !== 'ok') ?? [];
        return (
            <section className="bk-settings-group">
                <div className="bk-group-head">
                    <span className="bk-group-title">{t('Health')}</span>
                    {checks && (
                        <span className={`bk-badge ${failing.some((c) => c.status === 'fail') ? 'bk-badge-accent' : ''}`}>
                            {failing.length ? t('{0} to look at', failing.length) : t('all good')}
                        </span>
                    )}
                    <span className="bk-spacer" />
                    <button
                        type="button"
                        className="theia-button secondary bk-compact"
                        disabled={this.busy.has('doctor')}
                        onClick={() => this.loadChecks()}
                    >
                        {this.busy.has('doctor') ? t('Checking…') : t('Check again')}
                    </button>
                </div>
                {this.checksError && <div className="bk-error">{this.checksError}</div>}
                {!checks ? (
                    <div className="bk-muted">{t('Checking…')}</div>
                ) : (
                    <ul className="bk-checks">
                        {[...failing, ...checks.filter((check) => check.status === 'ok')].map((check) => (
                            <li key={`${check.name}:${check.status}:${check.detail}`} className={`bk-check-row bk-check-${check.status}`}>
                                <span
                                    className={`bk-check-icon ${codicon(icon(check.status))}`}
                                    role="img"
                                    aria-label={checkLabel(check.status)}
                                />
                                <span className="bk-check-name">{check.name}</span>
                                <span className="bk-check-detail">
                                    <span title={check.detail}>{check.detail}</span>
                                    {check.fix && (
                                        <code className="bk-check-fix" title={check.fix}>
                                            {check.fix}
                                        </code>
                                    )}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        );
    }

    /** The bug report form: what happened, then the prefilled issue with the diagnostics. */
    protected renderReport(): React.ReactNode {
        const draft = this.bug;
        const set = (patch: Partial<BugInput>) => {
            this.bug = { ...draft, ...patch };
            this.prepared = undefined;
            this.update();
        };
        const busy = this.busy.has('bug');
        const repos: [BugRepo, string][] = [
            ['brok', t('brok: setup, index, search, memory, links')],
            ['brok-agent', t('Answers, reviews, commit messages, skills')],
            ['vscode', t('Brokspace for VS Code')],
        ];
        return (
            <>
                <form
                    className="bk-settings-group bk-draft"
                    onSubmit={(e) => {
                        e.preventDefault();
                        this.prepareReport();
                    }}
                >
                    <label className="bk-field">
                        <span>{t('About')}</span>
                        <select
                            className="theia-select"
                            value={draft.repo}
                            onChange={(e) => set({ repo: e.currentTarget.value as BugRepo })}
                        >
                            {repos.map(([id, label]) => (
                                <option key={id} value={id}>
                                    {label}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="bk-field">
                        <span>{t('What went wrong, in one line')}</span>
                        <input
                            className="theia-input"
                            value={draft.title}
                            placeholder={t('Review hangs on large diffs')}
                            onChange={(e) => set({ title: e.currentTarget.value })}
                        />
                    </label>
                    <label className="bk-field">
                        <span>{t('What happened')}</span>
                        <textarea
                            className="theia-input"
                            rows={3}
                            value={draft.whatHappened ?? ''}
                            onChange={(e) => set({ whatHappened: e.currentTarget.value })}
                        />
                    </label>
                    <label className="bk-field">
                        <span>{t('What you expected')}</span>
                        <textarea
                            className="theia-input"
                            rows={2}
                            value={draft.expected ?? ''}
                            onChange={(e) => set({ expected: e.currentTarget.value })}
                        />
                    </label>
                    <label className="bk-field">
                        <span>{t('Steps to reproduce (optional)')}</span>
                        <textarea
                            className="theia-input bk-mono"
                            rows={2}
                            value={draft.steps ?? ''}
                            onChange={(e) => set({ steps: e.currentTarget.value })}
                        />
                    </label>
                    <p className="bk-settings-note">
                        {t(
                            'The report adds versions, your OS, brok doctor, recent metrics, the end of the log and brok.yml. Secrets are masked and your home folder shows as ~. Nothing is sent until you submit the issue on GitHub.',
                        )}
                    </p>
                    <div className="bk-buttons">
                        <button type="submit" className="theia-button main" disabled={busy || !draft.title.trim()}>
                            {busy ? t('Preparing the report…') : t('Prepare the report')}
                        </button>
                    </div>
                </form>
                {this.prepared && (
                    <section className="bk-settings-group">
                        <div className="bk-group-head">
                            <span className={codicon('pass')} aria-hidden="true" />
                            <span className="bk-group-title">{t('Report ready')}</span>
                        </div>
                        <p className="bk-settings-note">
                            {t(
                                'Saved to {0}. Open the issue: the summary and the diagnostics are filled in. Attach the report file for the log and the configuration, then submit.',
                                this.prepared.file_shown ?? this.prepared.file,
                            )}
                        </p>
                        <div className="bk-buttons">
                            <button type="button" className="theia-button main" onClick={() => this.openIssue()}>
                                <span className={codicon('github')} aria-hidden="true" /> {t('Open the issue on GitHub')}
                            </button>
                            <button
                                type="button"
                                className="theia-button secondary"
                                onClick={() => this.prepared && this.host.openFile(this.prepared.file)}
                            >
                                {t('Open the report')}
                            </button>
                        </div>
                        <details className="bk-preview">
                            <summary>{t('Preview')}</summary>
                            <pre className="bk-mono">{this.prepared.report}</pre>
                        </details>
                    </section>
                )}
            </>
        );
    }

    // ------------------------------------------------------------------ controls

    protected row(key: string, label: string, description: string, control: React.ReactNode): React.ReactNode {
        const feedback = this.feedback.get(key);
        return (
            <div className="bk-setting" key={key}>
                <div className="bk-setting-text">
                    <label className="bk-setting-label" htmlFor={`bk-${key}`}>
                        {label}
                    </label>
                    {description && <div className="bk-setting-description">{description}</div>}
                    {feedback && <div className={feedback.ok ? 'bk-saved' : 'bk-error'}>{feedback.text}</div>}
                </div>
                <div className="bk-setting-control">{control}</div>
            </div>
        );
    }

    protected toggle(key: string, value: boolean, label: string, description: string, disabled = false): React.ReactNode {
        return this.row(
            key,
            label,
            description,
            <input
                id={`bk-${key}`}
                type="checkbox"
                role="switch"
                aria-checked={value}
                className="bk-switch"
                checked={value}
                disabled={disabled || this.busy.has(key)}
                onChange={(e) => this.save(key, e.currentTarget.checked)}
            />,
        );
    }

    protected number(
        key: string,
        value: number,
        label: string,
        description: string,
        min: number,
        max: number,
        step: number,
    ): React.ReactNode {
        const commit = (input: HTMLInputElement) => {
            const next = Number(input.value);
            if (input.value !== '' && Number.isFinite(next) && next !== value) {
                this.save(key, Math.min(max, Math.max(min, next)));
            }
        };
        return this.row(
            key,
            label,
            description,
            <input
                id={`bk-${key}`}
                key={`${key}:${value}`}
                type="number"
                className="theia-input bk-number"
                defaultValue={value}
                min={min}
                max={max}
                step={step}
                onBlur={(e) => commit(e.currentTarget)}
                onKeyDown={(e) => e.key === 'Enter' && commit(e.currentTarget)}
            />,
        );
    }

    protected text(key: string, value: string, label: string, description: string, placeholder = '', optional = false): React.ReactNode {
        const commit = (input: HTMLInputElement) => {
            const next = input.value.trim();
            if (next === value) {
                return;
            }
            if (!next && optional) {
                this.unset(key);
            } else if (next) {
                this.save(key, next);
            }
        };
        return this.row(
            key,
            label,
            description,
            <input
                id={`bk-${key}`}
                key={`${key}:${value}`}
                className="theia-input bk-text"
                defaultValue={value}
                placeholder={placeholder}
                spellCheck={false}
                onBlur={(e) => commit(e.currentTarget)}
                onKeyDown={(e) => e.key === 'Enter' && commit(e.currentTarget)}
            />,
        );
    }

    protected list(key: string, values: string[], label: string, description: string): React.ReactNode {
        const commit = (area: HTMLTextAreaElement) => {
            const next = area.value
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter(Boolean);
            if (next.join('\n') !== values.join('\n')) {
                this.save(key, next);
            }
        };
        return this.row(
            key,
            label,
            description,
            <textarea
                id={`bk-${key}`}
                key={`${key}:${values.join('|')}`}
                className="theia-input bk-textarea bk-mono"
                rows={Math.min(10, values.length + 1)}
                defaultValue={values.join('\n')}
                spellCheck={false}
                onBlur={(e) => commit(e.currentTarget)}
            />,
        );
    }

    protected select(key: string, value: string, options: [string, string][], label: string, description: string): React.ReactNode {
        return this.row(
            key,
            label,
            description,
            <select
                id={`bk-${key}`}
                className="theia-select"
                value={value}
                disabled={this.busy.has(key)}
                onChange={(e) => this.save(key, e.currentTarget.value)}
            >
                {options.map(([id, text]) => (
                    <option key={id} value={id}>
                        {text}
                    </option>
                ))}
            </select>,
        );
    }

    protected iconButton(icon: string, title: string, onClick: () => void): React.ReactNode {
        return (
            <button
                type="button"
                className={`bk-icon-button ${codicon(icon)}`}
                title={title}
                aria-label={title}
                onClick={(e) => {
                    e.stopPropagation();
                    onClick();
                }}
            />
        );
    }

    protected loadingConfig(): React.ReactNode {
        return <div className="bk-muted">{this.configError ? '' : t('Loading…')}</div>;
    }

    // ------------------------------------------------------------------ actions

    protected run(command: string, ...args: unknown[]): void {
        this.host.command(command, ...args);
    }

    protected async save(key: string, value: unknown): Promise<void> {
        await this.change(key, () => this.host.rpc('setConfig', key, value));
    }

    protected async unset(key: string): Promise<void> {
        await this.change(key, () => this.host.rpc('unsetConfig', key));
    }

    protected async change(key: string, apply: (root: string) => Promise<unknown>): Promise<void> {
        const root = this.host.root;
        if (!root) {
            return;
        }
        this.busy.add(key);
        this.update();
        try {
            await apply(root);
            this.feedback.set(key, { ok: true, text: t('Saved') });
            this.needsRestart = true;
            setTimeout(() => {
                if (this.feedback.get(key)?.ok) {
                    this.feedback.delete(key);
                    this.update();
                }
            }, 2500);
        } catch (error) {
            this.feedback.set(key, { ok: false, text: message(error) });
        } finally {
            this.busy.delete(key);
            await this.loadConfig();
            void this.host.rpc('refresh');
        }
    }

    protected async restart(): Promise<void> {
        this.needsRestart = false;
        this.update();
        await this.host.command('brokspace.restart');
    }

    protected async saveDraft(): Promise<void> {
        const draft = this.draft;
        this.busy.add('memory');
        this.update();
        try {
            await this.host.rpc('saveMemory', {
                title: draft.title,
                body: draft.body,
                kind: draft.kind,
                scope: draft.scope,
                tags: draft.tags
                    .split(',')
                    .map((tag) => tag.trim())
                    .filter(Boolean),
            });
            this.draft = emptyDraft();
            this.showDraft = false;
        } catch (error) {
            this.host.notify('error', message(error));
        } finally {
            this.busy.delete('memory');
            this.update();
        }
    }

    protected async forget(memory: Memory): Promise<void> {
        const forget = t('Forget');
        const answer = await this.host.confirm(t('Forget "{0}"?', memory.title), forget);
        if (answer) {
            await this.host.rpc('forgetMemory', memory).catch((error) => this.host.notify('error', message(error)));
        }
    }

    protected async chooseFolder(): Promise<void> {
        const target = await this.host.rpc<string | undefined>('chooseFolder');
        if (target) {
            this.linkDraft = { ...this.linkDraft, target, name: this.linkDraft.name || suggestName(target) };
            this.update();
        }
    }

    protected async addLink(): Promise<void> {
        const root = this.host.root;
        const { open: _open, ...link } = this.linkDraft;
        if (!root) {
            return;
        }
        this.busy.add('link');
        this.update();
        try {
            await this.host.rpc('addLink', { ...link, name: link.name.trim(), target: link.target.trim() });
            this.linkDraft = emptyLink();
            this.host.notify('info', t('Linked {0}. Questions and searches now include it.', link.name));
        } catch (error) {
            this.host.notify('error', message(error));
        } finally {
            this.busy.delete('link');
            await this.host.rpc('refresh');
            this.update();
        }
    }

    protected async removeLink(link: LinkStatus): Promise<void> {
        const root = this.host.root;
        const unlink = t('Unlink');
        const answer = await this.host.confirm(
            t('Unlink {0}? Its folder is not touched; the copy and index Brokspace keeps for it are deleted.', link.name),
            unlink,
        );
        if (root && answer) {
            await this.host.rpc('removeLink', link.name).catch((error) => this.host.notify('error', message(error)));
            await this.host.rpc('refresh');
        }
    }

    protected async syncLinks(name?: string): Promise<void> {
        const root = this.host.root;
        if (!root) {
            return;
        }
        const key = name ? `sync:${name}` : 'sync';
        this.busy.add(key);
        this.update();
        try {
            const results = await this.host.rpc<{ name: string; error?: string }[]>('syncLinks', name ? [name] : []);
            const failed = results.filter((result) => result.error);
            if (failed.length) {
                this.host.notify('error', failed.map((result) => `${result.name}: ${result.error}`).join('\n'));
            }
        } catch (error) {
            this.host.notify('error', message(error));
        } finally {
            this.busy.delete(key);
            await this.host.rpc('refresh');
            this.update();
        }
    }

    protected async addProvider(): Promise<void> {
        await this.host.command('brokspace.addProvider');
        await this.loadConfig();
    }

    protected async loadStats(): Promise<void> {
        const root = this.host.root;
        if (!root) {
            return;
        }
        this.busy.add('stats');
        this.update();
        try {
            this.stats = await this.host.rpc<StatsSummary>('stats', this.statsDays);
            this.statsError = undefined;
        } catch (error) {
            this.statsError = message(error);
        } finally {
            this.busy.delete('stats');
            this.update();
        }
    }

    protected async loadChecks(): Promise<void> {
        this.busy.add('doctor');
        this.update();
        try {
            this.checks = await this.host.rpc<DoctorCheck[]>('doctor');
            this.checksError = undefined;
        } catch (error) {
            this.checksError = message(error);
        } finally {
            this.busy.delete('doctor');
            this.update();
        }
    }

    /** Builds the report (`brok bug --json`), with `bug` filled into the form first. */
    async prepareReport(bug?: Partial<BugInput>): Promise<void> {
        if (bug) {
            this.showSection('report', { bug });
        }
        if (!this.bug.title.trim()) {
            this.update();
            return;
        }
        this.busy.add('bug');
        this.update();
        try {
            this.prepared = await this.host.rpc<BugReport>('bugReport', this.bug);
        } catch (error) {
            this.host.notify('error', t('The report could not be prepared: {0}', message(error)));
        } finally {
            this.busy.delete('bug');
            this.update();
        }
    }

    protected openIssue(): void {
        if (this.prepared) {
            this.host.openExternal(this.prepared.url);
        }
    }

    protected openConfigFile(): void {
        const root = this.host.root;
        if (root) {
            this.host.openFile(`${root}/.brokspace/brok.yml`);
        }
    }
}

export function sectionTitle(section: SettingsSection): string {
    switch (section) {
        case 'overview':
            return t('Overview');
        case 'model':
            return t('AI model');
        case 'search':
            return t('Search and index');
        case 'memory':
            return t('Memory');
        case 'links':
            return t('Linked workspaces');
        case 'agents':
            return t('Coding agents');
        case 'diagnostics':
            return t('Diagnostics');
        case 'report':
            return t('Report a bug');
    }
}

function sectionDescription(section: SettingsSection): string {
    switch (section) {
        case 'overview':
            return t('This workspace at a glance.');
        case 'model':
            return t('The LLM brok sends questions to. Without one, Brokspace answers from the local index.');
        case 'search':
            return t('What gets indexed and how results are ranked.');
        case 'memory':
            return t(
                'What Brokspace remembers between sessions: private to you, shared with your team through git, or global to all your workspaces.',
            );
        case 'links':
            return t(
                'Other workspaces this one depends on, on this machine or as git repositories. Their code and memories are searched with yours.',
            );
        case 'agents':
            return t('Brokspace in the coding agents you already use.');
        case 'diagnostics':
            return t('How Brokspace performs on this machine, what failed lately and what to fix. Metrics stay local.');
        case 'report':
            return t(
                'Tell us what went wrong: the report comes with the diagnostics we need, secrets masked, and opens as a GitHub issue you review before sending.',
            );
    }
}

/** What the icon of a health check says. */
function checkLabel(status: DoctorCheck['status']): string {
    switch (status) {
        case 'ok':
            return t('OK');
        case 'warn':
            return t('Warning');
        default:
            return t('Failed');
    }
}

export function kindLabel(kind: Memory['kind']): string {
    switch (kind) {
        case 'note':
            return t('Note');
        case 'decision':
            return t('Decision');
        case 'fact':
            return t('Fact');
        case 'session':
            return t('Session');
        case 'handoff':
            return t('Handoff');
        case 'link':
            return t('Link');
    }
}

export function scopeLabel(scope: MemoryScope): string {
    switch (scope) {
        case 'private':
            return t('Private');
        case 'shared':
            return t('Shared');
        case 'global':
            return t('Global');
    }
}

export function scopeDescription(scope: MemoryScope): string {
    switch (scope) {
        case 'private':
            return t('Private: only me, this workspace');
        case 'shared':
            return t('Shared: my team, through git');
        case 'global':
            return t('Global: me, every workspace');
    }
}

function emptyDraft(): { title: string; body: string; kind: MemoryKind; scope: MemoryScope; tags: string } {
    return { title: '', body: '', kind: 'note', scope: 'private', tags: '' };
}

function emptyLink(): LinkInput & { open: boolean } {
    return { name: '', target: '', branch: '', description: '', memory: true, open: false };
}

function message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
