// Brokspace for VS Code. SPDX-License-Identifier: MIT OR Apache-2.0

import MarkdownIt from 'markdown-it';
import * as React from 'react';
import { cite } from '../src/core/text';
import type { ChatTurn } from '../src/webview-protocol';
import { codicon, type Host, t } from './host';

// No raw HTML from the model; links open outside (see `onClick`).
const markdown = new MarkdownIt({ html: false, linkify: true, breaks: false });

/**
 * The Brokspace chat: questions about the workspace answered by your LLM
 * through brok, grounded in the index, the linked workspaces and the
 * memories, with the sources. `/review`, `/review staged`, `/skill <name>`.
 */
export function ChatApp({ host }: { host: Host }): React.ReactElement {
    const [turns, setTurns] = React.useState<ChatTurn[]>([]);
    const [progress, setProgress] = React.useState<Record<string, string>>({});
    const [draft, setDraft] = React.useState('');
    const [, setState] = React.useState(host.state);
    const end = React.useRef<HTMLDivElement>(null);
    const input = React.useRef<HTMLTextAreaElement>(null);

    React.useEffect(
        () =>
            host.on((msg) => {
                switch (msg.type) {
                    case 'state':
                        setState(host.state);
                        break;
                    case 'chat/state':
                        setTurns(msg.turns);
                        break;
                    case 'chat/turn':
                        setTurns((all) => [...all.filter((turn) => turn.id !== msg.turn.id), msg.turn]);
                        break;
                    case 'chat/progress':
                        setProgress((all) => ({ ...all, [msg.id]: msg.text }));
                        break;
                    case 'chat/chunk':
                        setTurns((all) => all.map((turn) => (turn.id === msg.id ? { ...turn, answer: turn.answer + msg.text } : turn)));
                        break;
                    case 'chat/done':
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
    const ready = host.state.kind === 'ready';
    const send = (text: string) => {
        if (!text.trim() || running) {
            return;
        }
        host.post({ type: 'chat/send', text });
        setDraft('');
    };
    const llm = host.state.kind === 'ready' ? host.state.status.llm?.model : undefined;

    return (
        <div className="bk-chat">
            <header className="bk-chat-head">
                <span className="bk-chat-title">Brokspace</span>
                <span className="bk-chat-model" title={t('Answers come from this model, through brok')}>
                    {llm ?? t('No LLM: answers from the index')}
                </span>
                <span className="bk-spacer" />
                <button
                    type="button"
                    className={`bk-icon-button ${codicon('add')}`}
                    title={t('New chat')}
                    aria-label={t('New chat')}
                    onClick={() => host.post({ type: 'chat/new' })}
                />
                <button
                    type="button"
                    className={`bk-icon-button ${codicon('settings-gear')}`}
                    title={t('Settings')}
                    aria-label={t('Settings')}
                    onClick={() => host.command('brokspace.settings', 'model')}
                />
            </header>

            <main className="bk-chat-log" aria-live="polite">
                {!ready && (
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
                                <button key={suggestion} type="button" className="bk-suggestion" onClick={() => send(suggestion)}>
                                    {suggestion}
                                </button>
                            ))}
                            <button type="button" className="bk-suggestion" onClick={() => send('/review')}>
                                <span className={codicon('checklist')} /> {t('Review my changes')}
                            </button>
                        </div>
                    </div>
                )}
                {turns.map((turn) => (
                    <Turn key={turn.id} turn={turn} progress={progress[turn.id]} host={host} />
                ))}
                <div ref={end} />
            </main>

            <form
                className="bk-chat-input"
                onSubmit={(e) => {
                    e.preventDefault();
                    send(draft);
                }}
            >
                <textarea
                    ref={input}
                    rows={Math.min(8, Math.max(2, draft.split('\n').length))}
                    value={draft}
                    disabled={!ready}
                    placeholder={t('Ask a question, or /review, /review staged, /skill <name> <task>')}
                    aria-label={t('Ask Brokspace')}
                    onChange={(e) => setDraft(e.currentTarget.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                            e.preventDefault();
                            send(draft);
                        }
                    }}
                />
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
            </form>
        </div>
    );
}

function Turn({ turn, progress, host }: { turn: ChatTurn; progress?: string; host: Host }): React.ReactElement {
    const html = React.useMemo(() => markdown.render(turn.answer), [turn.answer]);
    return (
        <article className="bk-turn">
            <div className="bk-question">{turn.question}</div>
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
                                        title={source.path}
                                        onClick={() =>
                                            host.post({
                                                type: 'open',
                                                path: source.path,
                                                line: source.start_line,
                                                endLine: source.end_line,
                                            })
                                        }
                                    >
                                        <span className={codicon(source.path.includes('memory') ? 'library' : 'file-code')} />
                                        <code>{cite(source)}</code>
                                        {source.symbol && <span className="bk-source-symbol">{source.symbol}</span>}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
                {turn.done && turn.model && <div className="bk-turn-model">{turn.model}</div>}
            </div>
        </article>
    );
}
