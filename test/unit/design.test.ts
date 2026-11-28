// Brokspace for VS Code. SPDX-License-Identifier: MIT OR Apache-2.0

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';

/** The design rules (docs/design-system.md) that can be checked without an editor. */
const dir = path.join(__dirname, '..', '..', '..', 'webview');
const read = (name: string) => fs.readFileSync(path.join(dir, name), 'utf8');
const sources = fs.readdirSync(dir).filter((name) => name.endsWith('.tsx'));

/** Every JSX opening tag of an element, with its attributes. */
function tags(source: string, element: string): string[] {
    // Attributes may hold braces (handlers with arrows), nested one level.
    return [...source.matchAll(new RegExp(`<${element}\\b(?:[^<>{}]|\\{(?:[^{}]|\\{[^{}]*\\})*\\})*>`, 'g'))].map((match) => match[0]);
}

test('an icon-only button, input and text box have an accessible name', () => {
    for (const name of sources) {
        const source = read(name);
        for (const tag of tags(source, 'button').filter((tag) => tag.includes('bk-icon-button'))) {
            assert.match(tag, /aria-label=/, `${name}: icon button without aria-label`);
        }
        // A field is named by aria-label, or by the <label> that wraps it (checked by hand: bug report, link and memory forms).
        for (const tag of [...tags(source, 'input'), ...tags(source, 'textarea')]) {
            const wrapped = /type="checkbox"|rows=\{/.test(tag);
            assert.ok(wrapped || /aria-label=|aria-labelledby=|id=/.test(tag), `${name}: field without a name: ${tag.slice(0, 80)}`);
        }
    }
});

test('the stylesheet follows the theme and the accessibility preferences', () => {
    const css = read('style.css');
    assert.match(css, /:focus-visible/, 'a focus ring');
    assert.match(css, /prefers-reduced-motion: reduce/, 'reduced motion');
    assert.match(css, /vscode-high-contrast/, 'high contrast');
    assert.match(css, /@container \(max-width/, 'a narrow layout');
    assert.match(css, /\.bk-sr-only/, 'screen-reader-only text');
});

test('colors come from the theme, with a fallback at most', () => {
    for (const name of ['style.css', 'settings.css']) {
        const css = read(name);
        // A literal color is allowed as the brand token, in a var() fallback, or inside a color-mix of those.
        const lines = css
            .split('\n')
            .filter((line) => /#[0-9a-fA-F]{3,8}\b/.test(line) && !/var\([^)]*#/.test(line) && !/--bk-(forge|accent)/.test(line));
        assert.deepEqual(lines, [], `${name}: literal colors outside tokens`);
    }
});

test('the settings sections stay named when only their icons show', () => {
    const nav = read('settings.tsx').split('className="bk-settings-nav"')[1]?.split('</nav>')[0] ?? '';
    assert.match(nav, /aria-label=\{sectionTitle\(id\)\}/);
});

test('streamed answers are announced through a status region, not the whole log', () => {
    const chat = read('chat.tsx');
    assert.match(chat, /role="status"/);
    assert.match(chat, /role="log"[^>]*aria-live="off"/);
});
