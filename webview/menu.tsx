// Brokspace for VS Code. SPDX-License-Identifier: MIT OR Apache-2.0

import * as React from 'react';
import { codicon } from './host';

export interface MenuItem {
    id: string;
    icon?: string;
    label: string;
    /** A second, muted line. */
    hint?: string;
    /** A check mark: the current choice. */
    checked?: boolean;
    disabled?: boolean;
    /** Draws a rule above the item. */
    divider?: boolean;
    run: () => void;
}

/**
 * A menu button: Down or Enter opens it, arrows move, Enter chooses, Escape
 * closes and returns the focus, and a click elsewhere closes it. Used for the
 * model, the tools and the context sources.
 */
export function PopMenu({
    label,
    triggerClassName,
    trigger,
    items,
    up = false,
    align = 'left',
    onOpen,
}: {
    /** The accessible name of the button and the menu. */
    label: string;
    triggerClassName: string;
    trigger: React.ReactNode;
    items: MenuItem[];
    /** Opens above the button (the composer is at the bottom). */
    up?: boolean;
    align?: 'left' | 'right';
    onOpen?: () => void;
}): React.ReactElement {
    const [open, setOpen] = React.useState(false);
    const [active, setActive] = React.useState(0);
    const button = React.useRef<HTMLButtonElement>(null);
    const menu = React.useRef<HTMLDivElement>(null);

    const close = React.useCallback((restore: boolean) => {
        setOpen(false);
        if (restore) {
            button.current?.focus();
        }
    }, []);
    const show = () => {
        setOpen(true);
        setActive(0);
        onOpen?.();
    };

    React.useEffect(() => {
        if (!open) {
            return;
        }
        const away = (event: MouseEvent) => {
            if (!menu.current?.contains(event.target as Node) && !button.current?.contains(event.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', away);
        return () => document.removeEventListener('mousedown', away);
    }, [open]);

    React.useEffect(() => {
        if (open) {
            menu.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]')[active]?.focus();
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
                ref={button}
                type="button"
                className={triggerClassName}
                title={label}
                aria-label={label}
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={() => (open ? close(false) : show())}
                onKeyDown={(event) => {
                    if (event.key === 'ArrowDown' && !open) {
                        show();
                        event.preventDefault();
                    }
                }}
            >
                {trigger}
            </button>
            {open && (
                <div
                    ref={menu}
                    className={`bk-nav-menu ${up ? 'bk-nav-up' : ''} ${align === 'right' ? 'bk-nav-right' : ''}`}
                    role="menu"
                    aria-label={label}
                    onKeyDown={onKeyDown}
                >
                    {items.map((item, index) => (
                        <React.Fragment key={item.id}>
                            {item.divider && <div className="bk-nav-rule" role="separator" />}
                            <button
                                type="button"
                                role={item.checked !== undefined ? 'menuitemradio' : 'menuitem'}
                                {...(item.checked !== undefined ? { 'aria-checked': item.checked } : {})}
                                disabled={item.disabled}
                                tabIndex={index === active ? 0 : -1}
                                className="bk-nav-item"
                                onClick={() => {
                                    close(false);
                                    item.run();
                                }}
                            >
                                <span
                                    className={item.icon ? codicon(item.icon) : item.checked ? codicon('check') : 'bk-nav-blank'}
                                    aria-hidden="true"
                                />
                                <span className="bk-nav-text">
                                    {item.label}
                                    {item.hint && <span className="bk-nav-hint">{item.hint}</span>}
                                </span>
                                {item.checked && item.icon && <span className={codicon('check')} aria-hidden="true" />}
                            </button>
                        </React.Fragment>
                    ))}
                </div>
            )}
        </div>
    );
}
