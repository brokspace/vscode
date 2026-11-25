// Brokspace for VS Code. SPDX-License-Identifier: MIT OR Apache-2.0

import * as React from 'react';
import type { SettingsSection } from '../src/webview-protocol';
import { codicon, type Host, t } from './host';

interface Item {
    id: string;
    icon: string;
    label: string;
    run: () => void;
}

/**
 * The compact way to everything else Brokspace does (search, memories,
 * skills, linked workspaces, shards, diagnostics) without leaving the chat or
 * giving each a competing panel. A menu button: arrows move, Enter chooses,
 * Escape closes and returns the focus.
 */
export function NavMenu({
    host,
    onOpenSettings,
    inSidebar,
}: {
    host: Host;
    onOpenSettings: (section?: SettingsSection) => void;
    inSidebar: boolean;
}): React.ReactElement {
    const [open, setOpen] = React.useState(false);
    const [active, setActive] = React.useState(0);
    const trigger = React.useRef<HTMLButtonElement>(null);
    const menu = React.useRef<HTMLDivElement>(null);
    const command = (name: string) => () => host.command(name);
    const items: Item[] = [
        { id: 'search', icon: 'search', label: t('Search the workspace'), run: command('brokspace.search') },
        { id: 'memory', icon: 'book', label: t('Memories'), run: () => onOpenSettings('memory') },
        { id: 'links', icon: 'link', label: t('Linked workspaces'), run: () => onOpenSettings('links') },
        { id: 'skills', icon: 'wand', label: t('Skills'), run: command('brokspace.skills.focus') },
        { id: 'shards', icon: 'package', label: t('Shards'), run: command('brokspace.shards.focus') },
        { id: 'overview', icon: 'dashboard', label: t('Overview'), run: command('brokspace.overview.focus') },
        { id: 'doctor', icon: 'pulse', label: t('Check the setup'), run: command('brokspace.doctor') },
        ...(inSidebar
            ? [{ id: 'editor', icon: 'multiple-windows', label: t('Open chat in the editor'), run: command('brokspace.openChatInEditor') }]
            : []),
    ];

    const close = React.useCallback((restore: boolean) => {
        setOpen(false);
        if (restore) {
            trigger.current?.focus();
        }
    }, []);

    React.useEffect(() => {
        if (!open) {
            return;
        }
        setActive(0);
        const away = (event: MouseEvent) => {
            if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', away);
        return () => document.removeEventListener('mousedown', away);
    }, [open]);

    React.useEffect(() => {
        if (open) {
            menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[active]?.focus();
        }
    }, [open, active]);

    const onKeyDown = (event: React.KeyboardEvent) => {
        const last = items.length - 1;
        switch (event.key) {
            case 'ArrowDown':
                setActive((i) => (i >= last ? 0 : i + 1));
                break;
            case 'ArrowUp':
                setActive((i) => (i <= 0 ? last : i - 1));
                break;
            case 'Home':
                setActive(0);
                break;
            case 'End':
                setActive(last);
                break;
            case 'Escape':
                close(true);
                break;
            case 'Tab':
                close(false);
                return;
            default:
                return;
        }
        event.preventDefault();
    };

    return (
        <div className="bk-nav">
            <button
                ref={trigger}
                type="button"
                className={`bk-icon-button ${codicon('menu')}`}
                title={t('Search, memories, skills and more')}
                aria-label={t('Search, memories, skills and more')}
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={() => setOpen((value) => !value)}
                onKeyDown={(event) => {
                    if (event.key === 'ArrowDown' && !open) {
                        setOpen(true);
                        event.preventDefault();
                    }
                }}
            />
            {open && (
                <div ref={menu} className="bk-nav-menu" role="menu" aria-label="Brokspace" onKeyDown={onKeyDown}>
                    {items.map((item, index) => (
                        <button
                            type="button"
                            key={item.id}
                            role="menuitem"
                            tabIndex={index === active ? 0 : -1}
                            className="bk-nav-item"
                            onClick={() => {
                                close(false);
                                item.run();
                            }}
                        >
                            <span className={codicon(item.icon)} aria-hidden="true" />
                            {item.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
