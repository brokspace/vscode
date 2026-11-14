// Brokspace for VS Code. SPDX-License-Identifier: MIT OR Apache-2.0
//
// The extension in a real VS Code (`npm run test:integration`, .vscode-test.mjs):
// it activates, registers its commands, and with a brok 0.4+ (BROK_TEST_PATH)
// sets up the test workspace and shows it as ready.

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

const ID = 'brokspace.brokspace';

async function until<T>(check: () => T | undefined | Promise<T | undefined>, ms = 60_000): Promise<T> {
    const end = Date.now() + ms;
    for (;;) {
        const value = await check();
        if (value) {
            return value;
        }
        if (Date.now() > end) {
            throw new Error('timed out');
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
}

suite('Brokspace for VS Code', () => {
    test('activates and registers its commands', async () => {
        const extension = vscode.extensions.getExtension(ID);
        assert.ok(extension, 'installed');
        await extension.activate();
        const commands = await vscode.commands.getCommands(true);
        for (const id of [
            'brokspace.search',
            'brokspace.openChat',
            'brokspace.settings',
            'brokspace.remember',
            'brokspace.addLink',
            'brokspace.reportBug',
            'brokspace.showDiagnostics',
            'brokspace.commitMessage',
        ]) {
            assert.ok(commands.includes(id), `${id} is registered`);
        }
    });

    test('opens the settings page and the chat', async () => {
        await vscode.commands.executeCommand('brokspace.settings', 'diagnostics');
        await vscode.commands.executeCommand('brokspace.openChat');
        const labels = () => vscode.window.tabGroups.all.flatMap((group) => group.tabs.map((tab) => tab.label));
        // Tabs show up once the editor has laid the panels out.
        await until(() => (labels().filter((label) => /Brokspace/.test(label)).length >= 2 ? true : undefined), 15_000).catch(
            () => undefined,
        );
        assert.deepEqual(
            labels()
                .filter((label) => /Brokspace/.test(label))
                .sort(),
            ['Brokspace Chat', 'Brokspace Settings'],
            labels().join(', '),
        );
    });

    test('sets up a workspace with brok', async function (this: Mocha.Context) {
        const brok = process.env.BROK_TEST_PATH;
        if (!brok) {
            this.skip();
        }
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        assert.ok(root, 'the test workspace is open');
        await vscode.workspace.getConfiguration('brokspace').update('brokPath', brok, vscode.ConfigurationTarget.Global);
        if (!fs.existsSync(path.join(root, '.brokspace', 'brok.yml'))) {
            const { execFileSync } = await import('node:child_process');
            execFileSync(brok, ['init', '--yes', '--skip-model', '--no-agent', '--no-llm', '--no-integrations', '--no-index'], {
                cwd: root,
            });
            execFileSync(brok, ['config', 'set', 'embeddings.enabled', 'false'], { cwd: root });
            execFileSync(brok, ['index'], { cwd: root });
        }
        const api = vscode.extensions.getExtension<{ state(): string }>(ID)?.exports;
        assert.ok(api, 'the extension exposes its state to tests');
        await until(async () => {
            await vscode.commands.executeCommand('brokspace.refresh');
            return api.state() === 'ready' ? true : undefined;
        });
        assert.equal(api.state(), 'ready');
    });
});
