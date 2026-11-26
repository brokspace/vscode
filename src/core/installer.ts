// Brokspace for VS Code. SPDX-License-Identifier: MIT OR Apache-2.0

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { isAtLeast } from './brok';
import { MINIMUM_BROK_VERSION, UNSUPPORTED_BROK_MAJOR } from './protocol';

/**
 * What the installer downloads: brok, and the agent that answers questions,
 * writes commit messages and keeps the index current. Each has its own
 * repository and versions.
 */
export type Program = 'brok' | 'brok-agent';

/** Where the releases live. The installer downloads from these repositories only. */
export const RELEASES = 'https://github.com/brokspace/brok/releases';
export function releasesOf(program: Program): string {
    return `https://github.com/brokspace/${program}/releases`;
}

/** The executable file name on this platform. */
export function executableName(platform: NodeJS.Platform = process.platform, program: Program = 'brok'): string {
    return platform === 'win32' ? `${program}.exe` : program;
}

/**
 * Where the extension keeps what it downloaded (inside its own storage, no
 * admin rights). brok finds the agent because it sits next to it.
 */
export function managedExecutable(storageDir: string, platform: NodeJS.Platform = process.platform, program: Program = 'brok'): string {
    return path.join(storageDir, 'bin', executableName(platform, program));
}

/** Whether a brok downloaded by an earlier version of the extension has no agent next to it. */
export function lacksAgent(storageDir: string, platform: NodeJS.Platform = process.platform): boolean {
    return fs.existsSync(managedExecutable(storageDir, platform)) && !fs.existsSync(managedExecutable(storageDir, platform, 'brok-agent'));
}

/**
 * The release asset for a platform, named like brok's releases
 * (`brok-linux-x86_64`, `brok-macos-aarch64`, `brok-windows-x86_64.exe`), or
 * `undefined` when brok publishes no binary for it.
 */
export function assetName(
    platform: NodeJS.Platform = process.platform,
    arch: string = process.arch,
    program: Program = 'brok',
): string | undefined {
    const os = { linux: 'linux', darwin: 'macos', win32: 'windows' }[platform as string];
    const cpu = { x64: 'x86_64', arm64: 'aarch64' }[arch];
    if (!os || !cpu || (os === 'windows' && cpu !== 'x86_64')) {
        return undefined;
    }
    return `${program}-${os}-${cpu}${os === 'windows' ? '.exe' : ''}`;
}

/** Download URL of an asset of release `tag` (`v0.5.0`). */
export function assetUrl(tag: string, asset: string, program: Program = 'brok'): string {
    return `${releasesOf(program)}/download/${tag}/${asset}`;
}

/** The hex digest from a `.sha256` sidecar (`<digest>  <name>` or just `<digest>`). */
export function parseChecksum(text: string): string {
    const digest = text.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
    if (!/^[0-9a-f]{64}$/.test(digest)) {
        throw new Error('the checksum file is not a SHA-256 digest');
    }
    return digest;
}

/** Whether `tag` looks like a release tag (`v1.2.3`); anything else is refused before it reaches a URL. */
export function isReleaseTag(tag: string): boolean {
    return /^v\d+\.\d+\.\d+$/.test(tag);
}

/** Whether the extension is written for this brok release: at least the minimum, below the next major. */
export function isCompatibleTag(tag: string): boolean {
    if (!isReleaseTag(tag)) {
        return false;
    }
    const version = tag.slice(1);
    return isAtLeast(version, MINIMUM_BROK_VERSION) && Number(version.split('.')[0]) < UNSUPPORTED_BROK_MAJOR;
}

export type Fetch = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<Response>;

/** The newest stable release tag of `program`. */
export async function latestTag(fetchFn: Fetch = fetch, signal?: AbortSignal, program: Program = 'brok'): Promise<string> {
    const response = await fetchFn(`https://api.github.com/repos/brokspace/${program}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'brokspace-vscode' },
        signal,
    });
    if (!response.ok) {
        throw new Error(`GitHub answered ${response.status} when looking for the latest ${program} release`);
    }
    const tag = ((await response.json()) as { tag_name?: string }).tag_name ?? '';
    if (!isReleaseTag(tag)) {
        throw new Error(`unexpected release tag "${tag}"`);
    }
    return tag;
}

export interface InstallOptions {
    /** Extension storage directory; the executables go to `<dir>/bin/`. */
    storageDir: string;
    /** brok release to install; the latest when absent. */
    tag?: string;
    /** brok-agent release to install; the latest when absent. */
    agentTag?: string;
    platform?: NodeJS.Platform;
    arch?: string;
    fetchFn?: Fetch;
    signal?: AbortSignal;
    /** Called with the bytes of `program` received and its total when known. */
    onProgress?: (received: number, total: number | undefined, program: Program) => void;
}

export interface Installed {
    path: string;
    tag: string;
    sha256: string;
}

/**
 * Downloads brok and brok-agent from their GitHub releases, checks each
 * against the SHA-256 published next to it, and only then puts them in place.
 * A failed or cancelled download leaves any previous install untouched and no
 * partial file behind. Whether the two versions work together is checked by
 * brok when it sets up a workspace.
 */
export async function installBrok(options: InstallOptions): Promise<Installed & { agent: Installed }> {
    const platform = options.platform ?? process.platform;
    const arch = options.arch ?? process.arch;
    const fetchFn = options.fetchFn ?? fetch;
    if (!assetName(platform, arch)) {
        throw new Error(`there is no brok binary for ${platform} ${arch}; install it by hand (see the install guide)`);
    }
    const tag = options.tag ?? (await latestTag(fetchFn, options.signal));
    if (!isReleaseTag(tag)) {
        throw new Error(`"${tag}" is not a release tag`);
    }
    if (!isCompatibleTag(tag)) {
        throw new Error(
            `brok ${tag.slice(1)} is outside the versions this extension supports (${MINIMUM_BROK_VERSION} up to, not including, ${UNSUPPORTED_BROK_MAJOR}.0.0). Update the extension, or install brok yourself and set brokspace.brokPath.`,
        );
    }
    const agentTag = options.agentTag ?? (await latestTag(fetchFn, options.signal, 'brok-agent'));
    if (!isReleaseTag(agentTag)) {
        throw new Error(`"${agentTag}" is not a release tag`);
    }

    const partials: string[] = [];
    const fetched = async (program: Program, release: string) => {
        const target = managedExecutable(options.storageDir, platform, program);
        const partial = `${target}.${process.pid}.part`;
        partials.push(partial);
        const sha256 = await download(options, fetchFn, program, release, assetName(platform, arch, program) as string, partial);
        if (platform !== 'win32') {
            fs.chmodSync(partial, 0o755);
        }
        return { partial, installed: { path: target, tag: release, sha256 } };
    };
    try {
        fs.mkdirSync(path.dirname(managedExecutable(options.storageDir, platform)), { recursive: true });
        const brok = await fetched('brok', tag);
        const agent = await fetched('brok-agent', agentTag);
        // The agent first: brok being there is what counts as installed.
        fs.renameSync(agent.partial, agent.installed.path);
        fs.renameSync(brok.partial, brok.installed.path);
        return { ...brok.installed, agent: agent.installed };
    } finally {
        for (const partial of partials) {
            fs.rmSync(partial, { force: true });
        }
    }
}

/** Downloads one verified asset to `partial` and returns its digest. */
async function download(
    options: InstallOptions,
    fetchFn: Fetch,
    program: Program,
    tag: string,
    asset: string,
    partial: string,
): Promise<string> {
    const checksumResponse = await fetchFn(assetUrl(tag, `${asset}.sha256`, program), { signal: options.signal });
    if (!checksumResponse.ok) {
        throw new Error(`no checksum found for ${asset} ${tag} (${checksumResponse.status}); refusing to install an unverified binary`);
    }
    const expected = parseChecksum(await checksumResponse.text());

    const response = await fetchFn(assetUrl(tag, asset, program), { signal: options.signal });
    if (!response.ok || !response.body) {
        throw new Error(`downloading ${asset} ${tag} failed (${response.status})`);
    }
    const total = Number(response.headers.get('content-length')) || undefined;
    const hash = createHash('sha256');
    let received = 0;
    await pipeline(
        Readable.fromWeb(response.body as never),
        new Transform({
            transform(chunk: Buffer, _encoding, done) {
                hash.update(chunk);
                received += chunk.length;
                options.onProgress?.(received, total, program);
                done(null, chunk);
            },
        }),
        fs.createWriteStream(partial, { mode: 0o755 }),
        ...(options.signal ? [{ signal: options.signal }] : []),
    );
    const actual = hash.digest('hex');
    if (actual !== expected) {
        throw new Error(
            `the downloaded ${program} does not match its published SHA-256 (expected ${expected}, got ${actual}); nothing was installed`,
        );
    }
    return expected;
}
