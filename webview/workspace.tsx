// Brokspace for VS Code. SPDX-License-Identifier: MIT OR Apache-2.0

import * as React from 'react';
import type { SettingsSection } from '../src/webview-protocol';
import { ChatApp } from './chat';
import { codicon, type Host, t } from './host';
import { SettingsApp } from './settings';

type View = 'chat' | 'settings';

/**
 * The Brokspace sidebar: the chat and the settings in one place. Both stay
 * mounted, so going to Settings and back keeps the draft, the conversation
 * and its scroll position.
 */
export function WorkspaceApp({ host }: { host: Host }): React.ReactElement {
    const [view, setView] = React.useState<View>('chat');
    const settings = React.useRef<SettingsApp>(null);
    const views: { id: View; label: string; icon: string }[] = [
        { id: 'chat', label: t('Chat'), icon: 'comment-discussion' },
        { id: 'settings', label: t('Settings'), icon: 'settings-gear' },
    ];

    const openSettings = React.useCallback((section: SettingsSection = 'overview') => {
        setView('settings');
        settings.current?.showSection(section);
    }, []);

    const onKeyDown = (event: React.KeyboardEvent) => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
            setView((current) => (current === 'chat' ? 'settings' : 'chat'));
            event.preventDefault();
        }
    };

    return (
        <div className="bk-workspace">
            <div className="bk-workspace-nav" role="tablist" aria-label="Brokspace" onKeyDown={onKeyDown}>
                {views.map(({ id, label, icon }) => (
                    <button
                        type="button"
                        key={id}
                        role="tab"
                        id={`bk-tab-${id}`}
                        aria-selected={view === id}
                        aria-controls={`bk-panel-${id}`}
                        tabIndex={view === id ? 0 : -1}
                        className={`bk-workspace-tab ${view === id ? 'bk-workspace-tab-on' : ''}`}
                        onClick={() => setView(id)}
                    >
                        <span className={codicon(icon)} aria-hidden="true" />
                        {label}
                    </button>
                ))}
            </div>
            <section
                id="bk-panel-chat"
                role="tabpanel"
                aria-labelledby="bk-tab-chat"
                className="bk-workspace-panel"
                hidden={view !== 'chat'}
            >
                <ChatApp host={host} onOpenSettings={openSettings} />
            </section>
            <section
                id="bk-panel-settings"
                role="tabpanel"
                aria-labelledby="bk-tab-settings"
                className="bk-workspace-panel bk-workspace-settings"
                hidden={view !== 'settings'}
            >
                <SettingsApp host={host} ref={settings} />
            </section>
        </div>
    );
}
