// Brokspace for VS Code. SPDX-License-Identifier: MIT OR Apache-2.0

import { execFile } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { type ContextItem, isSensitivePath, makeItem } from './core/context';

const t = vscode.l10n.t;

/** What reading the editor gave: items to attach, or why nothing was attached. */
export interface Attached {
    items: ContextItem[];
    problem?: string;
}

const nothing = (problem: string): Attached => ({ items: [], problem });

/** Inside the workspace folder (not `..`), as a relative path with `/`. */
function inside(root: string, file: string): string | undefined {
    const relative = path.relative(root, file);
    return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative.split(path.sep).join('/') : undefined;
}

/** `git check-ignore`: true only when git says the path is ignored; outside a repository nothing is ignored. */
function gitIgnored(root: string, relative: string): Promise<boolean> {
    return new Promise((resolve) => {
        execFile('git', ['check-ignore', '-q', '--', relative], { cwd: root, windowsHide: true }, (error) => resolve(!error));
    });
}

/**
 * Whether a file may be attached. Sensitive files and ignored files never
 * are; a file outside the workspace only when the user picked it.
 */
async function check(root: string, uri: vscode.Uri, picked: boolean): Promise<{ label: string; external: boolean } | string> {
    if (uri.scheme !== 'file') {
        return t('Only files on disk can be attached.');
    }
    const relative = inside(root, uri.fsPath);
    if (!relative && !picked) {
        return t('This file is outside the workspace. Use Pick files to attach it on purpose.');
    }
    const label = relative ?? uri.fsPath;
    if (isSensitivePath(uri.fsPath)) {
        return t('{0} looks like it holds credentials, so it is never attached.', label);
    }
    if (relative && (await gitIgnored(root, relative))) {
        return t('{0} is ignored by Git, so it is not attached.', label);
    }
    return { label, external: !relative };
}

async function fileItem(root: string, uri: vscode.Uri, picked: boolean): Promise<Attached> {
    const allowed = await check(root, uri, picked);
    if (typeof allowed === 'string') {
        return nothing(allowed);
    }
    const open = vscode.workspace.textDocuments.find((document) => document.uri.toString() === uri.toString());
    try {
        // What is in the editor (with unsaved edits) wins over the disk.
        const bytes = open ? undefined : await vscode.workspace.fs.readFile(uri);
        if (bytes?.includes(0)) {
            return nothing(t('{0} is not a text file.', allowed.label));
        }
        const text = open ? open.getText() : new TextDecoder().decode(bytes);
        return { items: [makeItem(crypto.randomUUID(), 'file', allowed.label, text, { external: allowed.external })] };
    } catch {
        return nothing(t('{0} could not be read.', allowed.label));
    }
}

export async function activeFile(root: string): Promise<Attached> {
    const editor = vscode.window.activeTextEditor;
    return editor ? fileItem(root, editor.document.uri, false) : nothing(t('Open a file to attach it.'));
}

export async function selection(root: string): Promise<Attached> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) {
        return nothing(t('Select some code to attach it.'));
    }
    const allowed = await check(root, editor.document.uri, false);
    if (typeof allowed === 'string') {
        return nothing(allowed);
    }
    const { start, end } = editor.selection;
    const lines = start.line === end.line ? `${start.line + 1}` : `${start.line + 1}-${end.line + 1}`;
    return { items: [makeItem(crypto.randomUUID(), 'selection', `${allowed.label}:${lines}`, editor.document.getText(editor.selection))] };
}

export async function pickFiles(root: string): Promise<Attached> {
    const picked = await vscode.window.showOpenDialog({
        canSelectMany: true,
        canSelectFiles: true,
        canSelectFolders: false,
        defaultUri: vscode.Uri.file(root),
        openLabel: t('Attach'),
    });
    const items: ContextItem[] = [];
    const problems: string[] = [];
    for (const uri of picked ?? []) {
        const result = await fileItem(root, uri, true);
        items.push(...result.items);
        if (result.problem) {
            problems.push(result.problem);
        }
    }
    return { items, problem: problems.join(' ') || undefined };
}

/** The problems (errors and warnings) VS Code reports for the active file: opt-in context. */
export async function diagnostics(root: string): Promise<Attached> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        return nothing(t('Open a file to attach its problems.'));
    }
    const allowed = await check(root, editor.document.uri, false);
    if (typeof allowed === 'string') {
        return nothing(allowed);
    }
    const severity = ['error', 'warning'];
    const lines = vscode.languages
        .getDiagnostics(editor.document.uri)
        .filter((diagnostic) => diagnostic.severity <= vscode.DiagnosticSeverity.Warning)
        .map(
            (diagnostic) => `${allowed.label}:${diagnostic.range.start.line + 1}: ${severity[diagnostic.severity]}: ${diagnostic.message}`,
        );
    if (!lines.length) {
        return nothing(t('{0} has no errors or warnings.', allowed.label));
    }
    return { items: [makeItem(crypto.randomUUID(), 'diagnostics', t('Problems in {0}', allowed.label), lines.join('\n'))] };
}
