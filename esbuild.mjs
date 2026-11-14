// Builds the extension (Node, for VS Code's extension host) and the webview
// (browser: settings and chat) into dist/, and the unit tests into out/.
//
//   node esbuild.mjs [--production] [--watch] [--tests]

import { cpSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');
const tests = process.argv.includes('--tests');

const common = { bundle: true, sourcemap: !production, minify: production, logLevel: 'info' };

/** @type {esbuild.BuildOptions[]} */
const builds = tests
    ? [
          {
              ...common,
              entryPoints: readdirSync('test/unit')
                  .filter((file) => file.endsWith('.test.ts'))
                  .map((file) => join('test/unit', file)),
              outdir: 'out/test/unit',
              platform: 'node',
              format: 'cjs',
              target: 'node20',
              sourcemap: true,
              minify: false,
          },
          {
              ...common,
              entryPoints: ['test/integration/extension.test.ts'],
              outdir: 'out/test/integration',
              platform: 'node',
              format: 'cjs',
              target: 'node20',
              external: ['vscode'],
              sourcemap: true,
              minify: false,
          },
      ]
    : [
          {
              ...common,
              entryPoints: ['src/extension.ts'],
              outfile: 'dist/extension.js',
              platform: 'node',
              format: 'cjs',
              target: 'node20',
              external: ['vscode'],
          },
          {
              ...common,
              entryPoints: ['webview/main.tsx'],
              outfile: 'dist/webview.js',
              platform: 'browser',
              format: 'iife',
              target: 'es2022',
              jsx: 'automatic',
              loader: { '.ttf': 'file' },
              define: { 'process.env.NODE_ENV': JSON.stringify(production ? 'production' : 'development') },
          },
      ];

if (!tests) {
    // The icon font for the webviews (see webviews.ts, `html`).
    mkdirSync('dist/codicons', { recursive: true });
    for (const file of ['codicon.css', 'codicon.ttf']) {
        cpSync(join('node_modules/@vscode/codicons/dist', file), join('dist/codicons', file));
    }
}

if (watch) {
    for (const options of builds) {
        await (await esbuild.context(options)).watch();
    }
} else {
    await Promise.all(builds.map((options) => esbuild.build(options)));
}
