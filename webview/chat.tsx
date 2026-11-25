// Brokspace for VS Code. SPDX-License-Identifier: MIT OR Apache-2.0

import MarkdownIt from 'markdown-it';
import * as React from 'react';
import { type ActivityStep, duration } from '../src/core/activity';
import { matchSlash, type SlashEntry, stepHistory } from '../src/core/composer';
import { emptyProgress, isActive, type Progress } from '../src/core/onboarding';
import type { SkillInfo } from '../src/core/protocol';
import { cite, formatMs } from '../src/core/text';
import type { ChatTurn, ContextChip, ContextSource, SettingsSection } from '../src/webview-protocol';
import { codicon, type Host, t } from './host';
import { type MenuItem, PopMenu } from './menu';
import { ModelPill } from './modelpill';
import { Onboarding } from './onboarding';

// No raw HTML from the model; links open outside (see `onClick`).
const markdown = new MarkdownIt({ html: false, linkify: true, breaks: false });

/**
 * The Brokspace chat: questions about the workspace answered by your LLM
 * through brok, grounded in the index, the linked workspaces and the
 * memories, with the sources. `/review`, `/review staged`, `/skill <name>`.
 */
/** `onOpenSettings` is set when the chat lives next to the settings (the sidebar); otherwise Settings opens in an editor tab. */
export function ChatApp({
    host,
    onOpenSettings,
}: {
    host: Host;
    onOpenSettings?: (section?: SettingsSection) => void;
}): React.ReactElement {
    const [turns, setTurns] = React.useState<ChatTurn[]>([]);
    const [progress, setProgress] = React.useState<Record<string, string>>({});
    const [draft, setDraft] = React.useState('');
    const [chips, setChips] = React.useState<{ items: ContextChip[]; limit: number }>({ items: [], limit: 0 });
    const [announcement, setAnnouncement] = React.useState('');
    const [, setState] = React.useState(host.state);
    const [guide, setGuide] = React.useState<{ progress: Progress; mcpEnabled: boolean }>({ progress: emptyProgress(), mcpEnabled: true });
    const [editor, setEditor] = React.useState<{ file?: string; selection: boolean; sendWith: 'enter' | 'ctrlEnter' }>({
        selection: false,
        sendWith: 'enter',
    });
    const [skills, setSkills] = React.useState<SkillInfo[]>([]);
    const [pick, setPick] = React.useState(0);
    const [menuClosed, setMenuClosed] = React.useState(false);
    // Walking back through the prompts of this conversation: `recall` is the position (prompts.length = the draft being written).
    const [recall, setRecall] = React.useState<{ index: number; saved: string } | undefined>();
    const end = React.useRef<HTMLDivElement>(null);
    const input = React.useRef<HTMLTextAreaElement>(null);

    React.useEffect(
        () =>
            host.on((msg) => {
                switch (msg.type) {
                    case 'state':
                        setState(host.state);
                        break;
                    case 'onboarding/state':
                        setGuide({ progress: msg.progress, mcpEnabled: msg.mcpEnabled });
                        break;
                    case 'editor/state':
                        setEditor({ file: msg.file, selection: msg.selection, sendWith: msg.sendWith });
                        break;
                    case 'context/state':
                        setChips({ items: msg.items, limit: msg.limit });
                        break;
                    case 'chat/state':
                        setTurns(msg.turns);
                        break;
                    case 'chat/turn':
                        setAnnouncement(t('Brokspace is answering'));
                        setTurns((all) => [...all.filter((turn) => turn.id !== msg.turn.id), msg.turn]);
                        break;
                    case 'chat/progress':
                        setProgress((all) => ({ ...all, [msg.id]: msg.text }));
                        break;
                    case 'chat/steps':
                        setTurns((all) => all.map((turn) => (turn.id === msg.id ? { ...turn, steps: msg.steps } : turn)));
                        break;
                    case 'chat/chunk':
                        setTurns((all) => all.map((turn) => (turn.id === msg.id ? { ...turn, answer: turn.answer + msg.text } : turn)));
                        break;
                    case 'chat/done':
                        setAnnouncement(
                            msg.turn.error
                                ? t('The answer failed: {0}', msg.turn.error)
                                : msg.turn.cancelled
                                  ? t('The answer was stopped')
                                  : msg.turn.sources.length > 0
                                    ? t('Answer ready, with {0} sources', msg.turn.sources.length)
                                    : t('Answer ready'),
                        );
                        setTurns((all) => all.map((turn) => (turn.id === msg.turn.id ? msg.turn : turn)));
                        break;
                }
            }),
        [host],
    );
    // biome-ignore lint/correctness/useExhaustiveDependencies: scroll down whenever the conversation grows.
    React.useEffect(() => {
        end.current?.scrollIntoView({ block: 'end' });
    }, [turns, progress]);
    React.useEffect(() => {
        input.current?.focus();
    }, []);

    const running = turns.some((turn) => !turn.done);
    const guiding = isActive(host.state, guide.progress) && turns.length === 0;
    const ready = host.state.kind === 'ready';
    const send = (text: string) => {
        if (!text.trim() || running) {
            return;
        }
        host.post({ type: 'chat/send', text });
        setDraft('');
        setRecall(undefined);
    };
    /** A suggestion fills the composer; it never sends. */
    const suggest = (text: string, attach?: ContextSource) => {
        if (attach) {
            host.post({ type: 'context/add', source: attach });
        }
        setDraft(text);
        input.current?.focus();
    };

    const prompts = turns.map((turn) => turn.question);
    const commands: (SlashEntry & { label: string; description: string })[] = [
        { insert: '/review', args: false, label: '/review', description: t('Review your uncommitted changes') },
        { insert: '/review staged', args: false, label: '/review staged', description: t('Review only the staged changes') },
        { insert: '/review base ', args: true, label: '/review base <ref>', description: t('Review the changes since a branch or commit') },
        { insert: '/search ', args: true, label: '/search <words>', description: t('Find code in the index, without the LLM') },
        { insert: '/remember ', args: true, label: '/remember <text>', description: t('Save a note to Brokspace memory') },
        { insert: '/skill ', args: true, label: '/skill <name> <task>', description: t('Run a skill on your LLM') },
    ];
    const skillEntries = draft.toLowerCase().startsWith('/skill ')
        ? skills
              .filter((skill) => skill.user_invoked)
              .map((skill) => ({
                  insert: `/skill ${skill.name} `,
                  args: true,
                  label: `/skill ${skill.name}`,
                  description: skill.description,
              }))
        : [];
    // The popup under the box: `/` commands, or `@` context sources. Each entry knows what choosing it does.
    interface Entry {
        key: string;
        label: string;
        description: string;
        run: () => void;
    }
    const sources: [ContextSource, string, string, string][] = [
        ['file', '@file', t('The active file'), 'file-code'],
        ['selection', '@selection', t('The selected code'), 'list-selection'],
        ['diff', '@diff', t('Your uncommitted Git changes'), 'git-compare'],
        ['folder', '@folder', t('A folder you pick'), 'folder-opened'],
        ['tabs', '@tabs', t('The open tabs'), 'multiple-windows'],
        ['diagnostics', '@problems', t('Errors and warnings of the active file'), 'warning'],
        ['pick', '@files', t('Files you pick'), 'files'],
    ];
    const at = /(^|\s)@([a-z]*)$/i.exec(draft);
    const attachNow = (source: ContextSource) => {
        host.post({ type: 'context/add', source });
        setDraft(at ? draft.slice(0, draft.length - at[0].length) + at[1] : draft);
        input.current?.focus();
    };
    const entries: Entry[] = menuClosed
        ? []
        : at && ready
          ? sources
                .filter(([, label]) => label.startsWith(`@${at[2]?.toLowerCase() ?? ''}`))
                .map(([source, label, description]) => ({ key: label, label, description, run: () => attachNow(source) }))
          : matchSlash(skillEntries.length ? skillEntries : commands, draft).map((entry) => ({
                key: entry.insert,
                label: (entry as (typeof commands)[number]).label,
                description: (entry as (typeof commands)[number]).description,
                run: () => choose(entry),
            }));
    const menu = entries;
    const active = Math.min(pick, Math.max(0, menu.length - 1));
    // biome-ignore lint/correctness/useExhaustiveDependencies: fetch the skills the first time a /skill command is typed.
    React.useEffect(() => {
        if (draft.toLowerCase().startsWith('/skill ') && !skills.length && ready) {
            host.rpc<SkillInfo[]>('skills').then(setSkills, () => undefined);
        }
    }, [draft, ready]);
    const choose = (entry: SlashEntry) => {
        setDraft(entry.insert);
        setPick(0);
        input.current?.focus();
    };
    const keyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.nativeEvent.isComposing) {
            return;
        }
        if (menu.length) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                setPick((active + (e.key === 'ArrowDown' ? 1 : menu.length - 1)) % menu.length);
                return;
            }
            if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
                e.preventDefault();
                (menu[active] as Entry).run();
                return;
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                setMenuClosed(true);
                return;
            }
        }
        if (e.key === 'Escape' && running) {
            e.preventDefault();
            host.post({ type: 'chat/cancel' });
            return;
        }
        // Up and Down walk the earlier prompts only from an empty box or one already being recalled, so editing text is untouched.
        const field = e.currentTarget;
        if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && prompts.length) {
            const walking = recall !== undefined;
            const atEdge =
                e.key === 'ArrowUp' ? field.selectionStart === 0 && field.selectionEnd === 0 : field.selectionStart === field.value.length;
            if ((walking || !draft) && atEdge) {
                e.preventDefault();
                const from = recall?.index ?? prompts.length;
                const index = stepHistory(prompts, from, e.key === 'ArrowUp' ? 'up' : 'down');
                const saved = recall?.saved ?? draft;
                setRecall(index === prompts.length ? undefined : { index, saved });
                setDraft(index === prompts.length ? saved : (prompts[index] as string));
                return;
            }
        }
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            const modified = e.ctrlKey || e.metaKey;
            if (editor.sendWith === 'ctrlEnter' ? modified : !e.shiftKey && !modified) {
                e.preventDefault();
                send(draft);
            } else if (modified && editor.sendWith === 'enter') {
                // Ctrl+Enter adds a line, the way Shift+Enter does.
                e.preventDefault();
                const at = field.selectionStart;
                setDraft(`${draft.slice(0, at)}\n${draft.slice(field.selectionEnd)}`);
                requestAnimationFrame(() => field.setSelectionRange(at + 1, at + 1));
            }
        }
    };
    const openSettings = (section: SettingsSection = 'overview') =>
        onOpenSettings ? onOpenSettings(section) : host.command('brokspace.settings', section);
    const command = (name: string) => () => host.command(name);
    const tools: MenuItem[] = [
        { id: 'search', icon: 'search', label: t('Search the workspace'), run: command('brokspace.search') },
        { id: 'memory', icon: 'book', label: t('Memories'), run: () => openSettings('memory') },
        { id: 'links', icon: 'link', label: t('Linked workspaces'), run: () => openSettings('links') },
        { id: 'skills', icon: 'wand', label: t('Skills'), run: command('brokspace.skills.focus') },
        { id: 'shards', icon: 'package', label: t('Shards'), run: command('brokspace.shards.focus') },
        { id: 'overview', icon: 'dashboard', label: t('Overview'), divider: true, run: command('brokspace.overview.focus') },
        { id: 'doctor', icon: 'pulse', label: t('Check the setup'), run: command('brokspace.doctor') },
        ...(onOpenSettings
            ? [{ id: 'editor', icon: 'multiple-windows', label: t('Open chat in the editor'), run: command('brokspace.openChatInEditor') }]
            : []),
    ];
    const folder = host.root?.split(/[\\/]/).filter(Boolean).pop();
    const llm = host.state.kind === 'ready' ? (host.state.status.llm?.model ?? undefined) : undefined;

    return (
        <div className="bk-chat">
            <header className="bk-chat-head">
                <span className="bk-chat-title" title={host.root ?? 'Brokspace'}>
                    {folder ?? 'Brokspace'}
                </span>
                <ModelPill host={host} model={llm} onOpenSettings={openSettings} onIndexOnly={() => suggest('/search ')} />
                <span className="bk-spacer" />
                <PopMenu
                    label={t('Tools: search, memories, skills and more')}
                    triggerClassName="bk-tools"
                    trigger={
                        <>
                            <span className={codicon('tools')} aria-hidden="true" />
                            <span className="bk-tools-label">{t('Tools')}</span>
                            <span className={codicon('chevron-down')} aria-hidden="true" />
                        </>
                    }
                    items={tools}
                    align="right"
                />
                <button
                    type="button"
                    className={`bk-icon-button ${codicon('add')}`}
                    title={t('New chat')}
                    aria-label={t('New chat')}
                    onClick={() => host.post({ type: 'chat/new' })}
                />
            </header>

            <main className="bk-chat-log" role="log" aria-label={t('Conversation')} aria-live="off" aria-busy={running}>
                <div className="bk-sr-only" role="status" aria-live="polite">
                    {announcement}
                </div>
                {guiding && (
                    <Onboarding
                        host={host}
                        progress={guide.progress}
                        mcpEnabled={guide.mcpEnabled}
                        onOpenSettings={openSettings}
                        onSuggest={(text) => suggest(text)}
                    />
                )}
                {!ready && !guiding && (
                    <div className="bk-chat-empty">
                        <p>{t('Brokspace is not ready in this folder yet.')}</p>
                        <button type="button" className="bk-button" onClick={() => host.command('workbench.view.extension.brokspace')}>
                            {t('Open Brokspace')}
                        </button>
                    </div>
                )}
                {ready && turns.length === 0 && (
                    <div className="bk-chat-empty">
                        <span className={`bk-chat-mark ${codicon('comment-discussion')}`} />
                        <p className="bk-chat-lead">{t('Ask about this workspace. Answers cite the code they come from.')}</p>
                        <div className="bk-suggestions">
                            {[
                                t('How is this project structured?'),
                                t('Where is authentication handled?'),
                                t('What changed recently and why?'),
                            ].map((suggestion) => (
                                <button key={suggestion} type="button" className="bk-suggestion" onClick={() => suggest(suggestion)}>
                                    {suggestion}
                                </button>
                            ))}
                            {editor.selection && (
                                <button
                                    type="button"
                                    className="bk-suggestion"
                                    onClick={() => suggest(t('Explain the attached code'), 'selection')}
                                >
                                    <span className={codicon('list-selection')} /> {t('Explain the selected code')}
                                </button>
                            )}
                            {editor.file && (
                                <button
                                    type="button"
                                    className="bk-suggestion"
                                    onClick={() => suggest(t('What does the attached file do?'), 'file')}
                                >
                                    <span className={codicon('file-code')} /> {t('What does {0} do?', editor.file)}
                                </button>
                            )}
                            <button type="button" className="bk-suggestion" onClick={() => suggest('/review')}>
                                <span className={codicon('checklist')} /> {t('Review my changes')}
                            </button>
                        </div>
                    </div>
                )}
                {turns.map((turn) => (
                    <Turn key={turn.id} turn={turn} progress={progress[turn.id]} host={host} busy={running} />
                ))}
                <div ref={end} />
            </main>

            {menu.length > 0 && (
                <div id="bk-slash-menu" className="bk-slash" role="listbox" aria-label={t('Commands')}>
                    {menu.map((entry, i) => (
                        <div
                            key={entry.key}
                            id={`bk-slash-${i}`}
                            role="option"
                            tabIndex={-1}
                            aria-selected={i === active}
                            className={`bk-slash-item ${i === active ? 'bk-slash-on' : ''}`}
                            onMouseDown={(e) => {
                                e.preventDefault();
                                entry.run();
                            }}
                        >
                            <code>{entry.label}</code>
                            <span>{entry.description}</span>
                        </div>
                    ))}
                </div>
            )}

            <form
                className="bk-composer"
                onSubmit={(e) => {
                    e.preventDefault();
                    send(draft);
                }}
            >
                {chips.items.length > 0 && (
                    <ul className="bk-chips" aria-label={t('Context for your next question')}>
                        {chips.items.map((chip) => (
                            <Chip key={chip.id} chip={chip} host={host} />
                        ))}
                    </ul>
                )}
                <textarea
                    ref={input}
                    rows={Math.min(8, Math.max(2, draft.split('\n').length))}
                    value={draft}
                    disabled={!ready}
                    placeholder={t('Ask a question, / for commands, @ for context')}
                    aria-label={t('Ask Brokspace')}
                    onChange={(e) => {
                        setDraft(e.currentTarget.value);
                        setPick(0);
                        setMenuClosed(false);
                        setRecall(undefined);
                    }}
                    onKeyDown={keyDown}
                    role="combobox"
                    aria-expanded={menu.length > 0}
                    aria-controls="bk-slash-menu"
                    aria-autocomplete="list"
                    aria-activedescendant={menu.length ? `bk-slash-${active}` : undefined}
                />
                <div className="bk-composer-bar" role="group" aria-label={t('Attach context')}>
                    <PopMenu
                        label={t('Add context: files, selection, Git changes, problems')}
                        triggerClassName="bk-context-button"
                        trigger={
                            <>
                                <span className={codicon('add')} aria-hidden="true" />
                                <span>{t('Context')}</span>
                            </>
                        }
                        items={sources.map(([source, , description, icon]) => ({
                            id: source,
                            icon,
                            label: description,
                            disabled: !ready,
                            run: () => host.post({ type: 'context/add', source }),
                        }))}
                        up
                    />
                    <button
                        type="button"
                        className={`bk-icon-button ${codicon('file-code')}`}
                        title={t('Attach the active file')}
                        aria-label={t('Attach the active file')}
                        disabled={!ready || !editor.file}
                        onClick={() => host.post({ type: 'context/add', source: 'file' })}
                    />
                    <button
                        type="button"
                        className={`bk-icon-button ${codicon('list-selection')}`}
                        title={t('Attach the selected code')}
                        aria-label={t('Attach the selected code')}
                        disabled={!ready || !editor.selection}
                        onClick={() => host.post({ type: 'context/add', source: 'selection' })}
                    />
                    <span className="bk-spacer" />
                    {running ? (
                        <button
                            type="button"
                            className={`bk-send ${codicon('debug-stop')}`}
                            title={t('Stop')}
                            aria-label={t('Stop')}
                            onClick={() => host.post({ type: 'chat/cancel' })}
                        />
                    ) : (
                        <button
                            type="submit"
                            className={`bk-send ${codicon('send')}`}
                            title={t('Send')}
                            aria-label={t('Send')}
                            disabled={!draft.trim() || !ready}
                        />
                    )}
                </div>
            </form>
        </div>
    );
}

function Turn({ turn, progress, host, busy }: { turn: ChatTurn; progress?: string; host: Host; busy: boolean }): React.ReactElement {
    const html = React.useMemo(() => markdown.render(turn.answer), [turn.answer]);
    const [copied, setCopied] = React.useState(false);
    const copy = () => {
        host.rpc('copy', turn.answer).then(
            () => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
            },
            () => undefined,
        );
    };
    return (
        <article className="bk-turn">
            <div className="bk-question">{turn.question}</div>
            {turn.context && turn.context.length > 0 && (
                <div className="bk-turn-context">
                    <span className={codicon('attach')} /> {t('Context')}: {turn.context.join(', ')}
                </div>
            )}
            {turn.steps && turn.steps.length > 0 && <Activity steps={turn.steps} running={!turn.done} host={host} />}
            <div className="bk-answer">
                {!turn.done && !turn.answer && (
                    <div className="bk-progress">
                        <span className={`${codicon('loading')} codicon-modifier-spin`} /> {progress ?? t('Thinking…')}
                    </div>
                )}
                {turn.answer && (
                    <div
                        className="bk-markdown"
                        // biome-ignore lint/security/noDangerouslySetInnerHtml: markdown-it with html disabled escapes the model's text.
                        dangerouslySetInnerHTML={{ __html: html }}
                        onClick={(e) => {
                            const link = (e.target as HTMLElement).closest('a');
                            if (link?.href) {
                                e.preventDefault();
                                host.openExternal(link.href);
                            }
                        }}
                    />
                )}
                {turn.error && (
                    <div className="bk-turn-error">
                        <span className={codicon('error')} /> {turn.error}
                        <button
                            type="button"
                            className="bk-link-button"
                            onClick={() =>
                                host.command('brokspace.reportBug', {
                                    repo: turn.kind === 'ask' ? 'brok-agent' : 'brok',
                                    title: `${turn.kind}: ${turn.error?.split('\n')[0].slice(0, 80)}`,
                                    whatHappened: turn.error,
                                    steps: turn.question,
                                })
                            }
                        >
                            {t('Report a Bug')}
                        </button>
                    </div>
                )}
                {turn.cancelled && <div className="bk-muted">{t('Stopped.')}</div>}
                {turn.sources.length > 0 && (
                    <div className="bk-sources">
                        <div className="bk-sources-title">{turn.local ? t('Found in the index') : t('Sources')}</div>
                        <ul>
                            {turn.sources.map((source) => (
                                <li key={cite(source)}>
                                    <button
                                        type="button"
                                        className="bk-source"
                                        title={`${source.path}:${source.start_line}-${source.end_line}`}
                                        onClick={() =>
                                            host.post({
                                                type: 'open',
                                                path: source.path,
                                                line: source.start_line,
                                                endLine: source.end_line,
                                            })
                                        }
                                    >
                                        <span
                                            className={codicon(source.path.includes('memory') ? 'library' : 'file-code')}
                                            aria-hidden="true"
                                        />
                                        <code>{cite({ ...source, path: source.path.split('/').pop() ?? source.path })}</code>
                                        {source.symbol && <span className="bk-source-symbol">· {source.symbol}</span>}
                                        {source.path.includes('/') && (
                                            <span className="bk-source-path">{source.path.replace(/\/[^/]*$/, '')}</span>
                                        )}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
                {turn.done && (
                    <div className="bk-turn-foot">
                        {turn.answer && (
                            <button type="button" className="bk-foot-button" onClick={copy}>
                                <span className={codicon(copied ? 'check' : 'copy')} aria-hidden="true" />{' '}
                                {copied ? t('Copied') : t('Copy')}
                            </button>
                        )}
                        <button
                            type="button"
                            className="bk-foot-button"
                            disabled={busy}
                            title={t('Ask this question again')}
                            onClick={() => host.post({ type: 'chat/send', text: turn.question })}
                        >
                            <span className={codicon('refresh')} aria-hidden="true" /> {t('Retry')}
                        </button>
                        <span className="bk-spacer" />
                        {turn.model && <span className="bk-turn-model">{turn.model}</span>}
                    </div>
                )}
            </div>
        </article>
    );
}

/** One attached item: what it is, what was done to it, and how long it stays. */
function Chip({ chip, host }: { chip: ContextChip; host: Host }): React.ReactElement {
    const notes = [
        chip.omitted ? t('left out: too much context') : undefined,
        chip.truncated ? t('shortened') : undefined,
        chip.redactions ? t('{0} secrets hidden', chip.redactions) : undefined,
        chip.external ? t('outside the workspace') : undefined,
    ].filter(Boolean);
    const icon =
        chip.kind === 'selection'
            ? 'list-selection'
            : chip.kind === 'diagnostics'
              ? 'warning'
              : chip.kind === 'diff'
                ? 'git-compare'
                : 'file-code';
    return (
        <li className={`bk-chip ${chip.omitted ? 'bk-chip-omitted' : ''}`}>
            <span className={codicon(icon)} aria-hidden="true" />
            <span className="bk-chip-label" title={chip.label}>
                {chip.label}
            </span>
            {notes.length > 0 && <span className="bk-chip-note">{notes.join(', ')}</span>}
            <button
                type="button"
                className={`bk-icon-button ${codicon(chip.persistent ? 'pinned' : 'pin')}`}
                aria-pressed={chip.persistent}
                title={
                    chip.persistent
                        ? t('Kept for the whole conversation: click to use it for the next question only')
                        : t('Next question only: click to keep it for the whole conversation')
                }
                aria-label={`${chip.persistent ? t('Kept for the conversation') : t('Next question only')}: ${chip.label}`}
                onClick={() => host.post({ type: 'context/pin', id: chip.id })}
            />
            <button
                type="button"
                className={`bk-icon-button ${codicon('close')}`}
                title={t('Remove')}
                aria-label={`${t('Remove')}: ${chip.label}`}
                onClick={() => host.post({ type: 'context/remove', id: chip.id })}
            />
        </li>
    );
}

/** What the assistant did for one turn: compact steps, each with what it touched and how it ended. */
function Activity({ steps, running, host }: { steps: ActivityStep[]; running: boolean; host: Host }): React.ReactElement {
    const kinds = {
        read: { icon: 'eye', label: t('Read only') },
        network: { icon: 'cloud-upload', label: t('Sent to your LLM') },
        write: { icon: 'edit', label: t('Changes something') },
    } as const;
    const states = {
        running: { icon: `${codicon('loading')} codicon-modifier-spin`, label: t('Running') },
        done: { icon: codicon('check'), label: t('Done') },
        failed: { icon: codicon('error'), label: t('Failed') },
        cancelled: { icon: codicon('circle-slash'), label: t('Stopped') },
    } as const;
    const open = (resource: string) => {
        const match = /^(.*):(\d+)-(\d+)$/.exec(resource);
        if (match) {
            host.post({ type: 'open', path: match[1] as string, line: Number(match[2]), endLine: Number(match[3]) });
        }
    };
    return (
        <details className="bk-activity" open={running}>
            <summary>{t('Activity: {0} steps', steps.length)}</summary>
            <ol className="bk-steps">
                {steps.map((step) => (
                    <li key={step.id} className={`bk-step bk-step-${step.status}`}>
                        <span className={states[step.status].icon} role="img" aria-label={states[step.status].label} />
                        <div className="bk-step-body">
                            <div>
                                {step.label}
                                <span className="bk-step-meta">
                                    {' '}
                                    <span className={codicon(kinds[step.kind].icon)} aria-hidden="true" /> {kinds[step.kind].label}
                                    {step.endedAt !== undefined && ` · ${formatMs(duration(step))}`}
                                    {step.approval && ` · ${t('approved by typing the command')}`}
                                </span>
                            </div>
                            {step.error && <div className="bk-step-error">{step.error}</div>}
                            {step.resources.length > 0 && (
                                <ul className="bk-step-resources">
                                    {step.resources.map((resource) => (
                                        <li key={resource}>
                                            {/^.*:\d+-\d+$/.test(resource) ? (
                                                <button type="button" className="bk-link-button" onClick={() => open(resource)}>
                                                    <code>{resource}</code>
                                                </button>
                                            ) : (
                                                <code>{resource}</code>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </li>
                ))}
            </ol>
        </details>
    );
}
