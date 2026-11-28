// Brokspace for VS Code. SPDX-License-Identifier: MIT OR Apache-2.0

import * as React from 'react';
import type { SessionSummary } from '../src/core/sessions';
import { codicon, type Host, t } from './host';

interface Sessions {
    enabled: boolean;
    total: number;
    sessions: SessionSummary[];
}

/** The saved conversations of this workspace: search, open, rename, delete. */
export function HistoryApp({ host, active, onOpened }: { host: Host; active: boolean; onOpened: () => void }): React.ReactElement {
    const [query, setQuery] = React.useState('');
    const [data, setData] = React.useState<Sessions | undefined>();
    const [error, setError] = React.useState<string | undefined>();

    const load = React.useCallback(async () => {
        try {
            setData(await host.rpc<Sessions>('sessions', query));
            setError(undefined);
        } catch (failure) {
            setError(failure instanceof Error ? failure.message : String(failure));
        }
    }, [host, query]);

    // biome-ignore lint/correctness/useExhaustiveDependencies: reload whenever the tab is shown or the search changes.
    React.useEffect(() => {
        if (active) {
            void load();
        }
    }, [active, load]);

    const search = React.useRef<HTMLInputElement>(null);

    const act = async (method: string, id?: string) => {
        const opener = document.activeElement as HTMLElement | null;
        const done = await host.rpc<boolean>(method, id);
        if (done && method === 'openSession') {
            onOpened();
        }
        await load();
        if (method !== 'openSession') {
            // A dialog or input box took the focus: give it back, or to the search box when the button is gone.
            requestAnimationFrame(() => (opener?.isConnected ? opener : search.current)?.focus());
        }
    };

    return (
        <div className="bk-history">
            <div className="bk-history-tools">
                <input
                    ref={search}
                    type="search"
                    className="theia-input bk-text"
                    value={query}
                    placeholder={t('Search conversations')}
                    aria-label={t('Search conversations')}
                    onChange={(event) => setQuery(event.target.value)}
                />
                {!!data?.total && (
                    <button type="button" className="bk-button" onClick={() => void act('clearSessions')}>
                        {t('Clear history')}
                    </button>
                )}
            </div>
            {data && !data.enabled && (
                <p className="bk-history-note">
                    {t(
                        'Saving conversations is off (brokspace.chat.saveSessions or memory.sessions), so new chats are not kept. Saved ones stay until you delete them.',
                    )}
                </p>
            )}
            {error && <p className="bk-history-note">{error}</p>}
            {data && !data.sessions.length && (
                <p className="bk-history-note">{data.total ? t('No conversation matches.') : t('No saved conversations yet.')}</p>
            )}
            <ul className="bk-history-list">
                {data?.sessions.map((session) => (
                    <li key={session.id} className="bk-history-item">
                        <button type="button" className="bk-history-open" onClick={() => void act('openSession', session.id)}>
                            <span className="bk-history-title">{session.title}</span>
                            <span className="bk-history-meta">
                                {new Date(session.updatedAt).toLocaleString(window.__BROKSPACE__.language)} ·{' '}
                                {session.turns === 1 ? t('1 message') : t('{0} messages', session.turns)}
                            </span>
                        </button>
                        <button
                            type="button"
                            className={`bk-icon-button ${codicon('edit')}`}
                            title={t('Rename')}
                            aria-label={`${t('Rename')}: ${session.title}`}
                            onClick={() => void act('renameSession', session.id)}
                        />
                        <button
                            type="button"
                            className={`bk-icon-button ${codicon('trash')}`}
                            title={t('Delete')}
                            aria-label={`${t('Delete')}: ${session.title}`}
                            onClick={() => void act('deleteSession', session.id)}
                        />
                    </li>
                ))}
            </ul>
        </div>
    );
}
