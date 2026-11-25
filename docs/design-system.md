# Design system and accessibility baseline

The chat, the history, the settings and the first-run checklist are one React bundle (`webview/`) styled by one stylesheet (`webview/style.css`, with `settings.css` for the settings page). Everything takes its colors from the editor's theme (`--vscode-*`), so light, dark and high-contrast themes work without a Brokspace theme. `test/unit/design.test.ts` checks the rules below that can be checked without an editor.

## Tokens

Defined on `:root` in `style.css`.

| Token                                             | Use                                                                                                                                              |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--bk-space-1` to `--bk-space-8`                  | 4 px scale: gaps, padding                                                                                                                        |
| `--bk-radius-sm`, `--bk-radius`, `--bk-radius-lg` | 4, 6 and 10 px corners                                                                                                                           |
| `--bk-icon`                                       | Codicon size (16 px)                                                                                                                             |
| `--bk-line`                                       | Body line height                                                                                                                                 |
| `--bk-accent`                                     | The one brand color (forge orange; darker on light themes for contrast). Used for emphasis, never for text on its own background without a check |
| `--bk-focus`                                      | The focus ring color (`--vscode-focusBorder`)                                                                                                    |
| `--bk-border`                                     | Card and chip edges (`--vscode-widget-border`)                                                                                                   |
| `--bk-motion`                                     | Transition duration                                                                                                                              |

Literal colors are not allowed except the brand token and a fallback inside `var(--vscode-x, #fallback)`. Typography is the editor's (`--vscode-font-family`, `--vscode-font-size`); code uses `--vscode-editor-font-family`.

## Components

| Component      | Class                                    | Notes                                                                                  |
| -------------- | ---------------------------------------- | -------------------------------------------------------------------------------------- |
| Button         | `bk-button` (`bk-button-secondary`)      | Text label always. Settings uses the equivalent `theia-button`                         |
| Icon button    | `bk-icon-button` + a Codicon             | Needs an `aria-label` and a `title` (tested)                                           |
| Link button    | `bk-link-button`                         | An inline action that reads as a link                                                  |
| Field          | `theia-input`, `theia-select`            | Named by a wrapping `<label>` or an `aria-label` (tested); a placeholder is not a name |
| Tab            | `bk-workspace-tab` in a `role="tablist"` | Arrow keys move; icon only when the sidebar is narrow, the name stays                  |
| Context chip   | `bk-chip`                                | Shows what is attached and what was done to it                                         |
| Session row    | `bk-history-item`                        | History tab                                                                            |
| Activity step  | `bk-step`                                | A step of an answer: kind, state, duration                                             |
| Checklist step | `bk-guide`                               | Onboarding: done, current, optional, skipped                                           |
| Empty state    | `bk-chat-empty`                          | A sentence, then suggestions that fill the box and never send                          |
| Banner         | `bk-error`, `bk-muted`                   | `role="alert"` for errors that need attention                                          |

Icons are Codicons (`codicon(name)`); no emoji is used as a control.

## Accessibility

- **Keyboard:** every control is a real `button`, `a`, field or has a role and a `tabindex`; tabs, the slash menu and prompt recall have arrow-key support. One focus ring (`:focus-visible`, 2 px `--bk-focus`) applies to all of them.
- **Screen readers:** the conversation is `role="log"` with `aria-live="off"` (a streamed answer would otherwise be read word by word) and `aria-busy` while it writes. A visually hidden `role="status"` region announces the changes: answering, answer ready (with the number of sources), failed, stopped. Errors that block use `role="alert"`.
- **Motion:** `prefers-reduced-motion: reduce` stops transitions and spinners.
- **Contrast:** high-contrast themes get borders on cards, buttons and suggestions (`--vscode-contrastBorder`) and a thicker active tab; forced-colors mode draws button borders.
- **Layout:** the sidebar and the editor tab both work. Under 300 px wide the tabs keep their icons, buttons stack and indents shrink (`@container`); from 900 px wide the conversation keeps a readable line length.

## Checking by hand

`npm run test:unit` covers the rules above. By hand, in the Extension Development Host (`F5`): try a light, a dark and a high-contrast theme; narrow the sidebar; press Tab through the chat, History and Settings; turn on a screen reader and ask a question; set "reduce motion" in the operating system. Screenshots of these states are not in the repository yet: they need a real editor session.
