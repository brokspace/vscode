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

test('icon buttons, fields and radio groups have an accessible name', () => {
    for (const name of sources) {
        const source = read(name);
        for (const tag of tags(source, 'button').filter((tag) => tag.includes('bk-icon-button'))) {
            assert.match(tag, /aria-label=/, `${name}: icon button without aria-label`);
        }
        // A field is named by its <label> (wrapping it, or pointing at its id) or else by aria-label.
        // Both at once is wrong: aria-label wins, and screen readers then hear the example text, not the label.
        for (const element of ['input', 'textarea', 'select']) {
            for (const tag of tags(source, element)) {
                const before = source.slice(0, source.indexOf(tag));
                const labelled = before.lastIndexOf('<label') > before.lastIndexOf('</label>') || tag.includes('id=');
                const named = /aria-label=|aria-labelledby=/.test(tag);
                assert.ok(labelled !== named, `${name}: field needs exactly one name: ${tag.slice(0, 120)}`);
            }
        }
        for (const tag of tags(source, 'div').filter((tag) => tag.includes('role="radiogroup"'))) {
            assert.match(tag, /aria-label=/, `${name}: radio group without a name`);
        }
    }
});

test('icons are not read aloud, and the ones that carry meaning have a name', () => {
    for (const name of sources) {
        for (const tag of tags(read(name), 'span').filter((tag) => tag.includes('codicon(') && tag.endsWith('/>'))) {
            assert.match(tag, /aria-hidden="true"|role="img"[^>]*aria-label=/, `${name}: ${tag.slice(0, 120)}`);
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

test('the keyboard focus follows the tabs, menus and chat commands', () => {
    assert.match(read('workspace.tsx'), /chat\/reveal/);
    assert.match(read('workspace.tsx'), /focusTab\(next\)/);
    assert.match(read('menu.tsx'), /close\(true\);\s+item\.run\(\)/);
});

test('a page that loads gets the stored getting-started progress', () => {
    const source = fs.readFileSync(path.join(dir, '..', 'src', 'webviews.ts'), 'utf8');
    const ready = [...source.matchAll(/protected override onReady\(\): void \{[\s\S]*?\n {4}\}/g)].map((match) => match[0]);
    assert.ok(ready.some((body) => body.includes("'chat/state'") && body.includes('this.postOnboarding()')));
});

test('the settings sections stay named when only their icons show', () => {
    const nav = read('settings.tsx').split('className="bk-settings-nav"')[1]?.split('</nav>')[0] ?? '';
    assert.match(nav, /aria-label=\{sectionTitle\(id\)\}/);
});

test('switching the model from the chat restarts a running brok', () => {
    assert.match(read('modelpill.tsx'), /running \? host\.command\('brokspace\.restart'\)/);
});

test('streamed answers are announced through a status region, not the whole log', () => {
    const chat = read('chat.tsx');
    assert.match(chat, /role="status"/);
    assert.match(chat, /role="log"[^>]*aria-live="off"/);
});
