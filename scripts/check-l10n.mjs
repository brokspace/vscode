// Checks the translations: every UI string (`t('...')` in src/ and webview/,
// the English text is the key) is in l10n/bundle.l10n.json and in every
// bundle.l10n.<lang>.json, and every %key% of package.json is in every
// package.nls*.json.
//
//   node scripts/check-l10n.mjs          # check (CI)
//   node scripts/check-l10n.mjs --write  # regenerate l10n/bundle.l10n.json

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const call = /(?<![\w.])t\(\s*'((?:[^'\\]|\\.)*)'/g;

function sources(dir) {
    return readdirSync(join(root, dir), { recursive: true })
        .filter((file) => /\.tsx?$/.test(file) && !file.endsWith('.d.ts'))
        .map((file) => readFileSync(join(root, dir, file), 'utf8'));
}

const strings = new Set();
for (const text of [...sources('src'), ...sources('webview')]) {
    for (const match of text.matchAll(call)) {
        strings.add(match[1].replace(/\\'/g, "'"));
    }
}

const l10n = join(root, 'l10n');
if (process.argv.includes('--write')) {
    const bundle = Object.fromEntries([...strings].sort().map((s) => [s, s]));
    writeFileSync(join(l10n, 'bundle.l10n.json'), `${JSON.stringify(bundle, null, 2)}\n`);
    console.log(`l10n/bundle.l10n.json: ${strings.size} strings`);
}

let failed = false;
const report = (file, missing, unused) => {
    if (missing.length || unused.length) {
        failed = true;
        console.error(`${file}:`);
        for (const key of missing) console.error(`  missing ${JSON.stringify(key)}`);
        for (const key of unused) console.error(`  unused  ${JSON.stringify(key)}`);
    } else {
        console.log(`${file}: complete`);
    }
};

for (const file of readdirSync(l10n).filter((f) => /^bundle\.l10n(\..+)?\.json$/.test(f))) {
    const bundle = JSON.parse(readFileSync(join(l10n, file), 'utf8'));
    report(
        `l10n/${file}`,
        [...strings].filter((s) => !(s in bundle)),
        Object.keys(bundle).filter((k) => !strings.has(k)),
    );
}

const manifest = readFileSync(join(root, 'package.json'), 'utf8');
const keys = new Set([...manifest.matchAll(/"%([\w.]+)%"/g)].map((m) => m[1]));
for (const file of readdirSync(root).filter((f) => /^package\.nls(\..+)?\.json$/.test(f))) {
    const nls = JSON.parse(readFileSync(join(root, file), 'utf8'));
    report(
        file,
        [...keys].filter((k) => !(k in nls)),
        Object.keys(nls).filter((k) => !keys.has(k)),
    );
}

process.exit(failed ? 1 : 0);
