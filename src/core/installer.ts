// Brokspace for VS Code. SPDX-License-Identifier: MIT OR Apache-2.0

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/** Where brok releases live. The only host the installer downloads from. */
export const RELEASES = 'https://github.com/brokspace/brok/releases';
const LATEST_API = 'https://api.github.com/repos/brokspace/brok/releases/latest';

/** The executable file name on this platform. */
export function executableName(platform: NodeJS.Platform = process.platform): string {
    return platform === 'win32' ? 'brok.exe' : 'brok';
}

/** Where the extension keeps the brok it downloaded (inside its own storage, no admin rights). */
export function managedExecutable(storageDir: string, platform: NodeJS.Platform = process.platform): string {
    return path.join(storageDir, 'bin', executableName(platform));
}

/**
 * The release asset for a platform, named like brok's releases
 * (`brok-linux-x86_64`, `brok-macos-aarch64`, `brok-windows-x86_64.exe`), or
 * `undefined` when brok publishes no binary for it.
 */
export function assetName(platform: NodeJS.Platform = process.platform, arch: string = process.arch): string | undefined {
    const os = { linux: 'linux', darwin: 'macos', win32: 'windows' }[platform as string];
    const cpu = { x64: 'x86_64', arm64: 'aarch64' }[arch];
    if (!os || !cpu || (os === 'windows' && cpu !== 'x86_64')) {
        return undefined;
    }
    return `brok-${os}-${cpu}${os === 'windows' ? '.exe' : ''}`;
}

/** Download URL of an asset of release `tag` (`v0.5.0`). */
export function assetUrl(tag: string, asset: string): string {
    return `${RELEASES}/download/${tag}/${asset}`;
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

export type Fetch = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<Response>;

/** The newest stable brok release tag. */
export async function latestTag(fetchFn: Fetch = fetch, signal?: AbortSignal): Promise<string> {
    const response = await fetchFn(LATEST_API, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'brokspace-vscode' },
        signal,
    });
    if (!response.ok) {
        throw new Error(`GitHub answered ${response.status} when looking for the latest brok release`);
    }
    const tag = ((await response.json()) as { tag_name?: string }).tag_name ?? '';
    if (!isReleaseTag(tag)) {
        throw new Error(`unexpected release tag "${tag}"`);
    }
    return tag;
}

export interface InstallOptions {
    /** Extension storage directory; the executable goes to `<dir>/bin/`. */
    storageDir: string;
    tag?: string;
    platform?: NodeJS.Platform;
    arch?: string;
    fetchFn?: Fetch;
    signal?: AbortSignal;
    /** Called with the bytes received and the total when known. */
    onProgress?: (received: number, total: number | undefined) => void;
}

export interface Installed {
    path: string;
    tag: string;
    sha256: string;
}

/**
 * Downloads brok from its GitHub release, checks the SHA-256 published next
 * to it, and only then puts it in place. A failed or cancelled download leaves
 * any previous install untouched and no partial file behind.
 */
export async function installBrok(options: InstallOptions): Promise<Installed> {
    const platform = options.platform ?? process.platform;
    const fetchFn = options.fetchFn ?? fetch;
    const asset = assetName(platform, options.arch ?? process.arch);
    if (!asset) {
        throw new Error(
            `there is no brok binary for ${platform} ${options.arch ?? process.arch}; install it by hand (see the install guide)`,
        );
    }
    const tag = options.tag ?? (await latestTag(fetchFn, options.signal));
    if (!isReleaseTag(tag)) {
        throw new Error(`"${tag}" is not a release tag`);
    }

    const checksumResponse = await fetchFn(assetUrl(tag, `${asset}.sha256`), { signal: options.signal });
    if (!checksumResponse.ok) {
        throw new Error(`no checksum found for ${asset} ${tag} (${checksumResponse.status}); refusing to install an unverified binary`);
    }
    const expected = parseChecksum(await checksumResponse.text());

    const response = await fetchFn(assetUrl(tag, asset), { signal: options.signal });
    if (!response.ok || !response.body) {
        throw new Error(`downloading ${asset} ${tag} failed (${response.status})`);
    }
    const total = Number(response.headers.get('content-length')) || undefined;

    const target = managedExecutable(options.storageDir, platform);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const partial = `${target}.${process.pid}.part`;
    const hash = createHash('sha256');
    let received = 0;
    try {
        await pipeline(
            Readable.fromWeb(response.body as never),
            new Transform({
                transform(chunk: Buffer, _encoding, done) {
                    hash.update(chunk);
                    received += chunk.length;
                    options.onProgress?.(received, total);
                    done(null, chunk);
                },
            }),
            fs.createWriteStream(partial, { mode: 0o755 }),
            ...(options.signal ? [{ signal: options.signal }] : []),
        );
        const actual = hash.digest('hex');
        if (actual !== expected) {
            throw new Error(
                `the downloaded file does not match its published SHA-256 (expected ${expected}, got ${actual}); nothing was installed`,
            );
        }
        if (platform !== 'win32') {
            fs.chmodSync(partial, 0o755);
        }
        fs.renameSync(partial, target);
    } catch (error) {
        fs.rmSync(partial, { force: true });
        throw error;
    }
    return { path: target, tag, sha256: expected };
}
