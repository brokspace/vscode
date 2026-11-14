// `npm run test:integration`: the extension in a downloaded VS Code, on a
// throwaway workspace (test/fixture is copied to .vscode-test/workspace).
import { cpSync, mkdirSync } from 'node:fs';
import { defineConfig } from '@vscode/test-cli';

mkdirSync('.vscode-test/workspace', { recursive: true });
cpSync('test/fixture', '.vscode-test/workspace', { recursive: true });

export default defineConfig({
    files: 'out/test/integration/**/*.test.js',
    workspaceFolder: '.vscode-test/workspace',
    mocha: { ui: 'tdd', timeout: 120_000 },
    launchArgs: ['--disable-extensions'],
});
