// Brokspace for VS Code. SPDX-License-Identifier: MIT OR Apache-2.0

import * as assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { resolveBrok } from '../../src/core/brok';
import {
    assetName,
    assetUrl,
    type Fetch,
    installBrok,
    isCompatibleTag,
    isReleaseTag,
    lacksAgent,
    managedExecutable,
    networkCause,
    parseChecksum,
} from '../../src/core/installer';

const BODY = Buffer.from('#!/bin/sh\necho brok 0.5.0\n');
const SHA = createHash('sha256').update(BODY).digest('hex');
const AGENT = Buffer.from('#!/bin/sh\necho brok-agent 0.5.1\n');
const AGENT_SHA = createHash('sha256').update(AGENT).digest('hex');

/** A fake GitHub: serves the asset and its sidecar, records every URL asked for. */
function fakeGithub(options: { sha?: string; sidecar?: boolean; asset?: boolean; agentSha?: string } = {}): {
    fetchFn: Fetch;
    urls: string[];
} {
    const urls: string[] = [];
    const fetchFn: Fetch = async (url) => {
        urls.push(url);
        if (url.includes('brok-agent')) {
            if (url.endsWith('/releases/latest')) {
                return new Response(JSON.stringify({ tag_name: 'v0.5.1' }));
            }
            return url.endsWith('.sha256')
                ? new Response(`${options.agentSha ?? AGENT_SHA}  brok-agent-linux-x86_64\n`)
                : new Response(AGENT, { headers: { 'content-length': String(AGENT.length) } });
        }
        if (url.endsWith('.sha256')) {
            return options.sidecar === false
                ? new Response('not found', { status: 404 })
                : new Response(`${options.sha ?? SHA}  brok-linux-x86_64\n`);
        }
        if (url.endsWith('/releases/latest')) {
            return new Response(JSON.stringify({ tag_name: 'v0.5.0' }));
        }
        return options.asset === false
            ? new Response('gone', { status: 500 })
            : new Response(BODY, { headers: { 'content-length': String(BODY.length) } });
    };
    return { fetchFn, urls };
}

describe('release assets', () => {
    it('names the asset like brok releases', () => {
        assert.equal(assetName('linux', 'x64'), 'brok-linux-x86_64');
        assert.equal(assetName('linux', 'arm64'), 'brok-linux-aarch64');
        assert.equal(assetName('darwin', 'arm64'), 'brok-macos-aarch64');
        assert.equal(assetName('darwin', 'x64'), 'brok-macos-x86_64');
        assert.equal(assetName('win32', 'x64'), 'brok-windows-x86_64.exe');
        assert.equal(assetName('win32', 'arm64'), undefined);
        assert.equal(assetName('freebsd', 'x64'), undefined);
        assert.equal(assetName('linux', 'ia32'), undefined);
    });

    it('only builds URLs from release tags', () => {
        assert.equal(
            assetUrl('v0.5.0', 'brok-linux-x86_64'),
            'https://github.com/brokspace/brok/releases/download/v0.5.0/brok-linux-x86_64',
        );
        assert.ok(isReleaseTag('v1.2.3'));
        for (const bad of ['1.2.3', 'v1.2', 'v1.2.3-rc1', '../x', 'v1.2.3/../../evil', '']) {
            assert.equal(isReleaseTag(bad), false, bad);
        }
    });

    it('reads checksum sidecars strictly', () => {
        assert.equal(parseChecksum(`${SHA.toUpperCase()}  brok\n`), SHA);
        assert.equal(parseChecksum(SHA), SHA);
        assert.throws(() => parseChecksum('<html>not found</html>'));
        assert.throws(() => parseChecksum(''));
    });
});

describe('compatible versions', () => {
    it('accepts brok 0.4.0 up to, not including, 1.0.0', () => {
        for (const tag of ['v0.4.0', 'v0.5.0', 'v0.99.3']) {
            assert.equal(isCompatibleTag(tag), true, tag);
        }
        for (const tag of ['v0.3.9', 'v1.0.0', 'v2.1.0', '0.5.0', 'v0.5']) {
            assert.equal(isCompatibleTag(tag), false, tag);
        }
    });

    it('explains and downloads nothing for a release it was not written for', async () => {
        const github = fakeGithub();
        await assert.rejects(
            installBrok({
                storageDir: fs.mkdtempSync(path.join(os.tmpdir(), 'brok-')),
                tag: 'v1.0.0',
                platform: 'linux',
                arch: 'x64',
                fetchFn: github.fetchFn,
            }),
            /outside the versions this extension supports.*Update the extension/,
        );
        assert.deepEqual(github.urls, []);
    });
});

describe('installBrok', () => {
    let dir: string;
    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brokspace-install-'));
    });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('downloads, verifies and installs an executable', async () => {
        const { fetchFn, urls } = fakeGithub();
        const seen: string[] = [];
        const result = await installBrok({
            storageDir: dir,
            platform: 'linux',
            arch: 'x64',
            fetchFn,
            onProgress: (received, _total, program) => seen.push(`${program} ${received}`),
        });
        assert.equal(result.tag, 'v0.5.0');
        assert.equal(result.sha256, SHA);
        assert.equal(result.path, managedExecutable(dir, 'linux'));
        assert.deepEqual(fs.readFileSync(result.path), BODY);
        if (process.platform !== 'win32') {
            assert.ok(fs.statSync(result.path).mode & 0o100, 'executable');
        }
        assert.equal(seen.at(-1), `brok-agent ${AGENT.length}`);
        assert.equal(result.agent.tag, 'v0.5.1');
        assert.equal(result.agent.path, managedExecutable(dir, 'linux', 'brok-agent'));
        assert.deepEqual(fs.readFileSync(result.agent.path), AGENT);
        if (process.platform !== 'win32') {
            assert.ok(fs.statSync(result.agent.path).mode & 0o100, 'executable');
        }
        const allowed = [
            /^https:\/\/api\.github\.com\/repos\/brokspace\/brok(-agent)?\//,
            /^https:\/\/github\.com\/brokspace\/brok(-agent)?\/releases\//,
        ];
        assert.ok(
            urls.every((u) => allowed.some((a) => a.test(u))),
            urls.join('\n'),
        );
        assert.deepEqual(fs.readdirSync(path.dirname(result.path)).sort(), ['brok', 'brok-agent'], 'no partial file left');
        assert.equal(lacksAgent(dir, 'linux'), false);
    });

    it('refuses a binary that does not match its checksum and keeps the previous install', async () => {
        const first = await installBrok({ storageDir: dir, platform: 'linux', arch: 'x64', tag: 'v0.5.0', fetchFn: fakeGithub().fetchFn });
        const bad = fakeGithub({ sha: 'a'.repeat(64) });
        await assert.rejects(
            installBrok({ storageDir: dir, platform: 'linux', arch: 'x64', tag: 'v0.5.1', fetchFn: bad.fetchFn }),
            /does not match its published SHA-256/,
        );
        assert.deepEqual(fs.readFileSync(first.path), BODY);
        assert.deepEqual(fs.readdirSync(path.dirname(first.path)).sort(), ['brok', 'brok-agent']);
    });

    it('installs neither when the agent fails its check', async () => {
        await assert.rejects(
            installBrok({ storageDir: dir, platform: 'linux', arch: 'x64', fetchFn: fakeGithub({ agentSha: 'b'.repeat(64) }).fetchFn }),
            /downloaded brok-agent does not match/,
        );
        assert.deepEqual(fs.readdirSync(path.join(dir, 'bin')), []);
    });

    it('notices a download from before the agent was included', () => {
        assert.equal(lacksAgent(dir, 'linux'), false, 'nothing downloaded');
        fs.mkdirSync(path.join(dir, 'bin'));
        fs.writeFileSync(managedExecutable(dir, 'linux'), BODY);
        assert.equal(lacksAgent(dir, 'linux'), true);
    });

    it('refuses to install without a checksum', async () => {
        await assert.rejects(
            installBrok({
                storageDir: dir,
                platform: 'linux',
                arch: 'x64',
                tag: 'v0.5.0',
                fetchFn: fakeGithub({ sidecar: false }).fetchFn,
            }),
            /refusing to install an unverified binary/,
        );
        assert.equal(fs.existsSync(managedExecutable(dir, 'linux')), false);
    });

    it('reports a failed download and unsupported platforms', async () => {
        await assert.rejects(
            installBrok({ storageDir: dir, platform: 'linux', arch: 'x64', tag: 'v0.5.0', fetchFn: fakeGithub({ asset: false }).fetchFn }),
            /failed \(500\)/,
        );
        await assert.rejects(installBrok({ storageDir: dir, platform: 'win32', arch: 'arm64' }), /no brok binary for win32 arm64/);
        await assert.rejects(
            installBrok({ storageDir: dir, platform: 'linux', arch: 'x64', tag: 'v1.0.0/../x', fetchFn: fakeGithub().fetchFn }),
            /not a release tag/,
        );
    });
});

describe('resolveBrok with a downloaded copy', () => {
    it('uses it last: configuration, BROK_PATH and PATH installs all win', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brokspace-resolve-'));
        try {
            const managed = managedExecutable(path.join(dir, 'storage'));
            fs.mkdirSync(path.dirname(managed), { recursive: true });
            fs.writeFileSync(managed, 'x');
            const home = path.join(dir, 'home');
            const env = { HOME: home, USERPROFILE: home, PATH: '' } as NodeJS.ProcessEnv;
            const saved = process.env.HOME;
            process.env.HOME = home;
            try {
                assert.equal(resolveBrok(undefined, env, managed), managed);
                assert.equal(resolveBrok('/custom/brok', env, managed), '/custom/brok');
                assert.equal(resolveBrok(undefined, { ...env, BROK_PATH: '/env/brok' }, managed), '/env/brok');
                const bin = path.join(dir, 'bin');
                fs.mkdirSync(bin);
                fs.writeFileSync(path.join(bin, process.platform === 'win32' ? 'brok.exe' : 'brok'), 'x');
                assert.equal(resolveBrok(undefined, { ...env, PATH: bin }, managed), 'brok', 'PATH install wins');
                assert.equal(resolveBrok(undefined, env, path.join(dir, 'nothing')), 'brok');
            } finally {
                process.env.HOME = saved;
            }
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});

it('a download that cannot reach GitHub says why', () => {
    assert.equal(networkCause(new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED') })), 'connect ECONNREFUSED');
    assert.equal(networkCause(new TypeError('terminated')), 'terminated');
    assert.equal(networkCause(new Error('no checksum found')), undefined);
});
