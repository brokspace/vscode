// Brokspace for VS Code. SPDX-License-Identifier: MIT OR Apache-2.0
//
// The CLI contract, against a real brok: set BROK_TEST_PATH to a brok
// 0.4.0 or newer (CI downloads the latest release). Skipped otherwise.

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Brok } from '../../src/core/brok';

const executable = process.env.BROK_TEST_PATH;

describe('brok CLI contract', { skip: !executable && 'set BROK_TEST_PATH to run' }, () => {
    let dir: string;
    let user: string;
    let brok: Brok;

    before(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brokspace-vscode-'));
        user = path.join(dir, 'user');
        const checkout = path.join(dir, 'checkout', 'src');
        fs.mkdirSync(path.join(user, 'src'), { recursive: true });
        fs.mkdirSync(checkout, { recursive: true });
        fs.writeFileSync(path.join(user, 'src', 'profile.ts'), 'export function loadProfile(id: string) { return db.users.find(id); }\n');
        fs.writeFileSync(
            path.join(checkout, 'orders.ts'),
            'export async function createOrder(cartId: string) { return orders.insert({ cartId }); }\n',
        );
        process.env.BROK_CONFIG_DIR = path.join(dir, 'config'); // never the developer's own global memories
        brok = new Brok(executable as string);
        const init = await brok.run(user, ['init', '--yes', '--skip-model', '--no-agent', '--no-llm', '--no-integrations', '--no-index']);
        assert.equal(init.code, 0, init.stderr);
        await brok.setConfig(user, 'embeddings.enabled', false);
        assert.equal((await brok.run(user, ['index'])).code, 0);
    });

    after(() => {
        brok?.dispose();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('reports its version and status', async () => {
        const info = await brok.info();
        assert.ok(info.found, info.error);
        const status = await brok.status(user);
        assert.ok(status.initialized);
        assert.equal(status.daemon?.running, false);
        assert.ok((status.index ?? []).some((p) => p.files > 0));
    });

    it('reads and changes brok.yml', async () => {
        await brok.setConfig(user, 'search.limit', 12);
        assert.equal((await brok.config(user)).search.limit, 12);
        await brok.unsetConfig(user, 'search.limit');
        assert.equal((await brok.config(user)).search.limit, 8);
        await assert.rejects(brok.setConfig(user, 'search.cold_weight', 3), /cold_weight/);
    });

    it('remembers, finds and forgets', async () => {
        const saved = await brok.saveMemory(user, {
            title: 'Profiles are cached',
            body: 'token=supersecret123 for redis',
            kind: 'decision',
            tags: ['cache'],
        });
        assert.ok(saved);
        assert.equal(saved.kind, 'decision');
        assert.ok(!saved.body.includes('supersecret123'), 'secrets are masked');
        assert.equal((await brok.memories(user)).length, 1);
        const hits = await brok.searchMemories(user, 'profiles cached', 5);
        assert.equal(hits[0]?.symbol, 'Profiles are cached');
        await brok.forgetMemory(user, saved.id, saved.scope);
        assert.equal((await brok.memories(user)).length, 0);
    });

    it('links a workspace and searches it', async () => {
        await brok.addLink(user, { name: 'checkout', target: '../checkout', description: 'Carts and orders' });
        const status = await brok.status(user);
        assert.equal(status.links?.[0]?.name, 'checkout');
        const hits = await brok.search(user, 'createOrder', 5);
        assert.ok(
            hits.some((hit) => hit.path === '../checkout/src/orders.ts'),
            JSON.stringify(hits.map((h) => h.path)),
        );
        const synced = await brok.syncLinks(user);
        assert.equal(synced[0]?.error, undefined);
        await brok.removeLink(user, 'checkout');
        assert.equal((await brok.status(user)).links?.length ?? 0, 0);
    });

    it('runs doctor, stats and bug reports', async () => {
        const checks = await brok.doctor(user);
        assert.ok(checks.some((check) => check.name === 'workspace'));
        const stats = await brok.stats(user, 7);
        assert.ok(stats.search.latency.count > 0, 'searches above were recorded');
        const report = await brok.bugReport(user, { repo: 'vscode', title: 'Something & broke', whatHappened: 'it did' });
        assert.ok(report.url.startsWith('https://github.com/brokspace/vscode/issues/new?'), report.url);
        assert.ok(report.url.includes('title=Something%20%26%20broke'));
        assert.ok(fs.existsSync(report.file));
        assert.ok(report.report.includes('## brok doctor'));
    });

    it('reports failures with their exit code and message', async () => {
        const result = await brok.run(user, ['memory', 'show', 'no-such-memory']);
        assert.notEqual(result.code, 0);
        assert.match(result.stderr, /no memory/);
    });
});
