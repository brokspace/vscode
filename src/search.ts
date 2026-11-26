// Brokspace for VS Code. SPDX-License-Identifier: MIT OR Apache-2.0

import * as vscode from 'vscode';
import { message } from './core/brok';
import { Latest } from './core/latest';
import { resolveHitPath } from './core/paths';
import type { SearchHit } from './core/protocol';
import { firstLine } from './core/text';
import type { BrokspaceModel } from './model';

const t = vscode.l10n.t;
/** Pause in typing before a search runs. */
const DEBOUNCE_MS = 250;
const LIMIT = 20;

type HitItem = vscode.QuickPickItem & { hit?: SearchHit };

/**
 * Search by meaning or by name, as you type: results from this workspace,
 * its linked workspaces and the memories; Enter opens one at its lines,
 * the arrow keeps the list open.
 */
export async function searchWorkspace(model: BrokspaceModel, initial?: string): Promise<void> {
    const root = model.root;
    if (!root || !model.ready) {
        void vscode.window.showWarningMessage(t('Set up Brokspace in this folder first.'));
        return;
    }
    const pick = vscode.window.createQuickPick<HitItem>();
    pick.placeholder = t('Search by meaning or by name: "where do we validate tokens", "parseConfig"');
    pick.matchOnDescription = false;
    pick.matchOnDetail = false;
    pick.value = initial ?? editorSelection() ?? '';
    let timer: NodeJS.Timeout | undefined;
    let generation = 0;
    // A newer query ends the brok process of the one it replaces.
    const searches = new Latest();

    const run = async (query: string) => {
        const current = ++generation;
        if (!query.trim()) {
            searches.cancel();
            pick.items = [];
            pick.busy = false;
            return;
        }
        pick.busy = true;
        try {
            const hits = await model.brok.search(root, query, LIMIT, searches.next());
            if (current !== generation) {
                return; // a newer query is running
            }
            pick.items = hits.length
                ? hits.map((hit) => hitItem(hit))
                : [{ label: t('No results. Try other words, or check that the index is up to date.'), alwaysShow: true }];
        } catch (error) {
            if (current === generation) {
                pick.items = [{ label: `$(error) ${message(error)}`, alwaysShow: true }];
            }
        } finally {
            if (current === generation) {
                pick.busy = false;
            }
        }
    };

    pick.onDidChangeValue((value) => {
        clearTimeout(timer);
        timer = setTimeout(() => void run(value), DEBOUNCE_MS);
    });
    pick.onDidAccept(() => {
        const hit = pick.selectedItems[0]?.hit;
        if (hit) {
            pick.hide();
            void openHit(root, hit);
        }
    });
    pick.onDidTriggerItemButton((event) => {
        if (event.item.hit) {
            void openHit(root, event.item.hit, true);
        }
    });
    pick.onDidHide(() => {
        clearTimeout(timer);
        generation++; // nothing may touch the disposed list
        searches.cancel();
        pick.dispose();
    });
    pick.show();
    if (pick.value) {
        void run(pick.value);
    }
}

function hitItem(hit: SearchHit): HitItem {
    const memory = hit.kind === 'memory';
    const linked = hit.partition?.startsWith('@') && !memory;
    const icon = memory ? '$(library)' : linked ? '$(link)' : '$(symbol-field)';
    return {
        label: `${icon} ${hit.symbol || hit.kind}`,
        description: `${hit.path}:${hit.start_line}${linked ? ` · ${hit.partition}` : ''}`,
        detail: firstLine(hit.content),
        hit,
        // brok ranks the hits: the editor's own filter, which compares the typed words with the label, must not hide them.
        alwaysShow: true,
        buttons: [{ iconPath: new vscode.ThemeIcon('go-to-file'), tooltip: t('Open to the side') }],
    };
}

/** Opens a hit's file with its lines selected. */
export async function openHit(root: string, hit: Pick<SearchHit, 'path' | 'start_line' | 'end_line'>, side = false): Promise<void> {
    const uri = vscode.Uri.file(resolveHitPath(root, hit.path));
    const start = Math.max(0, hit.start_line - 1);
    const end = Math.max(start, hit.end_line - 1);
    await vscode.window.showTextDocument(uri, {
        selection: new vscode.Range(start, 0, end, 0),
        viewColumn: side ? vscode.ViewColumn.Beside : undefined,
        preview: !side,
    });
}

function editorSelection(): string | undefined {
    const editor = vscode.window.activeTextEditor;
    const text = editor && !editor.selection.isEmpty ? editor.document.getText(editor.selection).trim() : '';
    return text && !text.includes('\n') && text.length <= 120 ? text : undefined;
}
