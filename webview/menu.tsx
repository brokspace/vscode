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

    // The first item from `from` that can take the focus, going `step` at a time.
    const enabled = (from: number, step: 1 | -1) => {
        for (let n = 0; n < items.length; n++) {
            const index = (((from + n * step) % items.length) + items.length) % items.length;
            if (!items[index]?.disabled) {
                return index;
            }
        }
        return 0;
    };
    // A menu may open while its items still load: the focus follows them.
    const current = enabled(active, 1);

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

    // biome-ignore lint/correctness/useExhaustiveDependencies: focus again when the number of items changes.
    React.useEffect(() => {
        if (open) {
            menu.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]')[current]?.focus();
        }
    }, [open, current, items.length]);

    const onKeyDown = (event: React.KeyboardEvent) => {
        switch (event.key) {
            case 'ArrowDown':
                setActive(enabled(current + 1, 1));
                break;
            case 'ArrowUp':
                setActive(enabled(current - 1, -1));
                break;
            case 'Home':
                setActive(enabled(0, 1));
                break;
            case 'End':
                setActive(enabled(items.length - 1, -1));
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
                    } else if (event.key === 'Escape' && open) {
                        close(true);
                        event.preventDefault();
                        event.stopPropagation();
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
                                tabIndex={index === current ? 0 : -1}
                                className="bk-nav-item"
                                onClick={() => {
                                    // The button keeps the focus unless what runs moves it.
                                    close(true);
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
