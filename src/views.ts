// Brokspace for VS Code. SPDX-License-Identifier: MIT OR Apache-2.0

import * as vscode from 'vscode';
import { message } from './core/brok';
import type { LinkStatus, Memory, ShardDetails, ShardInfo, SkillInfo } from './core/protocol';
import { age, firstLine } from './core/text';
import type { MemoryStore } from './memory';
import type { BrokspaceModel } from './model';

const t = vscode.l10n.t;

/** Shown in the Memory view; the settings page lists them all. */
const MEMORIES_SHOWN = 50;

/** A tree node; inline buttons get the node, so it carries what they act on. */
export type Item = vscode.TreeItem & {
    children?: () => Item[] | Promise<Item[]>;
    memory?: Memory;
    link?: LinkStatus;
    shard?: ShardInfo;
    skill?: string;
};

function item(label: string, options: Partial<Item> = {}): Item {
    const node = new vscode.TreeItem(label) as Item;
    Object.assign(node, options);
    if (options.children && node.collapsibleState === undefined) {
        node.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
    }
    return node;
}

function command(id: string, title: string, ...args: unknown[]): vscode.Command {
    return { command: id, title, arguments: args };
}

/** A tree whose items are rebuilt from the model's status. */
abstract class Tree implements vscode.TreeDataProvider<Item> {
    protected readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this.onDidChangeEmitter.event;

    constructor(protected readonly model: BrokspaceModel) {
        model.onDidChange(() => this.onDidChangeEmitter.fire());
    }

    getTreeItem(node: Item): vscode.TreeItem {
        return node;
    }

    async getChildren(node?: Item): Promise<Item[]> {
        if (node) {
            return node.children ? node.children() : [];
        }
        return this.model.ready ? this.roots() : [];
    }

    protected abstract roots(): Item[] | Promise<Item[]>;
}

/** Service, model, index, memory and links at a glance, and the everyday actions. */
export class OverviewTree extends Tree {
    protected roots(): Item[] {
        const ready = this.model.ready;
        if (!ready) {
            return [];
        }
        const { status } = ready;
        const running = !!status.daemon?.running;
        const files = (status.index ?? []).reduce((sum, p) => sum + p.files, 0);
        const hybrid = (status.index ?? []).some((p) => p.semantic);
        const counts = status.memory?.counts;
        const memories = counts ? counts.private + counts.shared + counts.global : 0;
        return [
            item(running ? t('Running') : t('Stopped'), {
                iconPath: new vscode.ThemeIcon(running ? 'pass-filled' : 'circle-large-outline'),
                description: running ? t('follows your edits') : t('start for live indexing'),
                command: command(running ? 'brokspace.stop' : 'brokspace.start', running ? t('Stop') : t('Start')),
                tooltip: running ? t('Brokspace is running. Click to stop it.') : t('Brokspace is stopped. Click to start it.'),
            }),
            item(status.llm?.model ?? t('No LLM: answers from the index'), {
                iconPath: new vscode.ThemeIcon('hubot'),
                description: status.llm?.model ? status.llm.provider : undefined,
                tooltip: status.llm?.base_url ?? undefined,
                command: command('brokspace.settings', t('Settings'), 'model'),
            }),
            item(t('{0} files', files.toLocaleString()), {
                iconPath: new vscode.ThemeIcon('database'),
                description: hybrid ? t('search by meaning and words') : t('search by words'),
                command: command('brokspace.settings', t('Settings'), 'search'),
            }),
            item(t('{0} memories', memories.toLocaleString()), {
                iconPath: new vscode.ThemeIcon('library'),
                description: status.memory?.enabled === false ? t('off') : undefined,
                command: command('brokspace.settings', t('Settings'), 'memory'),
            }),
            item(t('{0} linked workspaces', (status.links?.length ?? 0).toLocaleString()), {
                iconPath: new vscode.ThemeIcon('link'),
                command: command('brokspace.settings', t('Settings'), 'links'),
            }),
            item(t('Search the workspace'), {
                iconPath: new vscode.ThemeIcon('search'),
                command: command('brokspace.search', t('Search')),
                description: 'Ctrl+Alt+F',
            }),
            item(t('Ask Brokspace'), { iconPath: new vscode.ThemeIcon('comment-discussion'), command: command('brokspace.ask', t('Ask')) }),
            item(t('Review my changes'), {
                iconPath: new vscode.ThemeIcon('checklist'),
                command: command('brokspace.review', t('Review')),
            }),
            item(t('Diagnostics'), {
                iconPath: new vscode.ThemeIcon('pulse'),
                command: command('brokspace.showDiagnostics', t('Diagnostics')),
            }),
        ];
    }
}

export function kindIcon(kind: string): string {
    switch (kind) {
        case 'decision':
            return 'law';
        case 'fact':
            return 'lightbulb';
        case 'session':
            return 'comment-discussion';
        case 'handoff':
            return 'debug-step-over';
        case 'link':
            return 'link';
        default:
            return 'note';
    }
}

export function ageLabel(iso: string): string {
    const { unit, value } = age(iso);
    switch (unit) {
        case 'today':
            return t('today');
        case 'days':
            return t('{0}d', value);
        case 'weeks':
            return t('{0}w', value);
        default:
            return value;
    }
}

/** The latest memories: open, forget, remember. */
export class MemoryTree extends Tree {
    constructor(
        model: BrokspaceModel,
        protected readonly memory: MemoryStore,
    ) {
        super(model);
        memory.onDidChange(() => this.onDidChangeEmitter.fire());
    }

    protected async roots(): Promise<Item[]> {
        if (!this.memory.enabled) {
            return [item(t('Memory is off in this workspace'), { command: command('brokspace.settings', t('Settings'), 'memory') })];
        }
        await this.memory.ensureLoaded();
        if (this.memory.error) {
            return [item(this.memory.error, { iconPath: new vscode.ThemeIcon('error') })];
        }
        const memories = this.memory.memories;
        const items = memories.slice(0, MEMORIES_SHOWN).map((memory) => memoryItem(memory));
        if (memories.length > MEMORIES_SHOWN) {
            items.push(
                item(t('{0} more…', memories.length - MEMORIES_SHOWN), { command: command('brokspace.settings', t('Settings'), 'memory') }),
            );
        }
        return items;
    }
}

function memoryItem(memory: Memory): Item {
    const tooltip = new vscode.MarkdownString(`**${memory.title}**\n\n`);
    tooltip.appendText(`${memory.kind} · ${memory.scope} · ${memory.updated.slice(0, 10)}\n\n`);
    tooltip.appendText(firstLine(memory.body));
    return item(memory.title, {
        id: `${memory.scope}:${memory.id}`,
        iconPath: new vscode.ThemeIcon(kindIcon(memory.kind)),
        description: ageLabel(memory.updated),
        tooltip,
        contextValue: 'memory',
        resourceUri: vscode.Uri.file(memory.path),
        command: command('brokspace.openMemory', t('Open'), memory),
        memory,
    });
}

/** Workspaces this one depends on. */
export class LinksTree extends Tree {
    protected roots(): Item[] {
        return (this.model.ready?.status.links ?? []).map((link) => linkItem(link));
    }
}

function linkItem(link: LinkStatus): Item {
    const where = link.git ?? link.root;
    const tooltip = new vscode.MarkdownString(`**${link.name}** · \`${where}\`\n\n`);
    if (link.description) {
        tooltip.appendText(`${link.description}\n\n`);
    }
    tooltip.appendText(link.error ?? t('{0} files, {1} chunks', link.files.toLocaleString(), link.chunks.toLocaleString()));
    return item(link.name, {
        id: `link:${link.name}`,
        iconPath: new vscode.ThemeIcon(link.error ? 'warning' : link.kind === 'git' ? 'repo' : 'folder'),
        description: link.error ? t('not indexed') : t('{0} files', link.files.toLocaleString()),
        tooltip,
        contextValue: 'link',
        link,
    });
}

/** Installed shards; expand one for its permissions and topics. */
export class ShardsTree extends Tree {
    protected readonly details = new Map<string, ShardDetails | string>();

    protected roots(): Item[] {
        this.details.clear();
        return (this.model.ready?.status.shards ?? []).map((shard) => this.shardItem(shard));
    }

    protected shardItem(shard: ShardInfo): Item {
        return item(shard.name, {
            id: `shard:${shard.name}`,
            iconPath: new vscode.ThemeIcon(
                shard.state === 'missing-binary' ? 'warning' : shard.state === 'disabled' ? 'circle-slash' : 'extensions',
            ),
            description: `${shard.version} · ${shardState(shard)}`,
            tooltip: shard.description,
            contextValue: shard.source === 'builtin' ? 'shard-builtin' : 'shard',
            shard,
            children: () => this.detailItems(shard),
        });
    }

    protected async detailItems(shard: ShardInfo): Promise<Item[]> {
        const root = this.model.root;
        if (!root) {
            return [];
        }
        let details = this.details.get(shard.name);
        if (!details) {
            try {
                details = await this.model.brok.shardInfo(root, shard.name);
            } catch (error) {
                details = message(error);
            }
            this.details.set(shard.name, details);
        }
        if (typeof details === 'string') {
            return [item(details, { iconPath: new vscode.ThemeIcon('error') })];
        }
        const { manifest } = details;
        const permissions = manifest.permissions ?? {};
        const list = (values?: string[]) => (values?.length ? values.join(', ') : t('none'));
        const rows: [string, string, string][] = [
            ['eye', t('Reads'), list(permissions.filesystem?.read)],
            ['edit', t('Writes'), list(permissions.filesystem?.write)],
            ['globe', t('Network'), permissions.network ? t('yes') : t('no')],
            ['terminal', t('Runs'), list(permissions.process)],
            ['radio-tower', t('Listens to'), list(manifest.subscribes_to)],
            ['broadcast', t('Publishes'), list(manifest.publishes_to)],
            ['package', t('Source'), details.source ?? shard.source ?? t('none')],
        ];
        return rows.map(([icon, label, value]) =>
            item(label, { iconPath: new vscode.ThemeIcon(icon), description: value, tooltip: value }),
        );
    }
}

export function shardState(shard: ShardInfo): string {
    switch (shard.state) {
        case 'enabled':
            return t('enabled');
        case 'disabled':
            return t('disabled');
        case 'skills':
            return t('skills only');
        case 'missing-binary':
            return t('binary missing');
    }
}

/** Workflows you run, and the skills your agents use. */
export class SkillsTree extends Tree {
    protected skills: SkillInfo[] | undefined;

    constructor(model: BrokspaceModel) {
        super(model);
        // Skills change with shards: reload when the shards do.
        let shards = '';
        model.onDidChange((state) => {
            const now = state.kind === 'ready' ? JSON.stringify(state.status.shards ?? []) : '';
            if (now !== shards) {
                shards = now;
                this.skills = undefined;
            }
        });
    }

    protected async roots(): Promise<Item[]> {
        const root = this.model.root;
        if (!root) {
            return [];
        }
        try {
            this.skills ??= await this.model.brok.skills(root);
        } catch (error) {
            return [item(message(error), { iconPath: new vscode.ThemeIcon('error') })];
        }
        const group = (label: string, userInvoked: boolean): Item[] => {
            const skills = (this.skills ?? []).filter((skill) => skill.user_invoked === userInvoked);
            if (!skills.length) {
                return [];
            }
            return [
                item(label, {
                    collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
                    children: () =>
                        skills.map((skill) =>
                            item(skill.name, {
                                iconPath: new vscode.ThemeIcon(userInvoked ? 'play-circle' : 'symbol-method'),
                                description: skill.source,
                                tooltip: skill.description,
                                contextValue: 'skill',
                                skill: skill.name,
                                command: userInvoked ? command('brokspace.runSkill', t('Run'), skill.name) : undefined,
                            }),
                        ),
                }),
            ];
        };
        return [...group(t('Workflows'), true), ...group(t('Used by agents'), false)];
    }
}
