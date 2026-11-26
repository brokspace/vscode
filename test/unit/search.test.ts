// Brokspace for VS Code. SPDX-License-Identifier: MIT OR Apache-2.0

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { setTimeout as pause } from 'node:timers/promises';
import { Brok, CancelledError } from '../../src/core/brok';
import { Latest } from '../../src/core/latest';

/**
 * The "brok" here is Node itself, so `search` is the script it runs: one that
 * records its process id and, for the query "slow", never finishes. That
 * works the same on Linux, macOS and Windows.
 */
const FAKE = `
const fs = require('node:fs');
const query = process.argv.at(-1);
fs.appendFileSync('pids', process.pid + '\\n');
if (query === 'slow') setInterval(() => {}, 1000);
else if (query === 'broken') { console.error('error: index unavailable'); process.exit(1); }
else console.log(JSON.stringify({ hits: [{ path: query }] }));
`;

function alive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

describe('superseded searches', () => {
    let dir: string;
    const brok = new Brok(process.execPath);
    const pids = () => {
        try {
            return fs.readFileSync(path.join(dir, 'pids'), 'utf8').trim().split('\n').map(Number);
        } catch {
            return [];
        }
    };
    const until = async (done: () => boolean) => {
        for (let i = 0; i < 500 && !done(); i++) {
            await pause(20);
        }
        assert.ok(done(), 'timed out');
    };

    before(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brokspace-search-'));
        fs.writeFileSync(path.join(dir, 'search'), FAKE);
    });

    after(() => {
        for (const pid of pids().filter(alive)) {
            process.kill(pid);
        }
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
    });

    it('ends the previous process when a newer query starts, and the last one on close', async () => {
        const latest = new Latest();
        const searches: Promise<unknown>[] = [];
        for (let i = 0; i < 4; i++) {
            const search = brok.search(dir, 'slow', 5, latest.next());
            searches.push(assert.rejects(search, CancelledError));
            await until(() => pids().length === i + 1);
            // Only the newest process survives, however fast the user types.
            await until(() => pids().filter(alive).length === 1);
        }
        latest.cancel(); // the Quick Pick closes
        await Promise.all(searches);
        await until(() => pids().filter(alive).length === 0);
    });

    it('still answers, and still reports real errors', async () => {
        const latest = new Latest();
        assert.deepEqual(await brok.search(dir, 'src/a.ts', 5, latest.next()), [{ path: 'src/a.ts' }]);
        await assert.rejects(brok.search(dir, 'broken', 5, latest.next()), /index unavailable/);
        assert.deepEqual(await brok.search(dir, 'src/b.ts', 5), [{ path: 'src/b.ts' }]);
    });

    it('does not run a search that is already cancelled', async () => {
        await assert.rejects(brok.search(dir, 'slow', 5, AbortSignal.abort()), CancelledError);
        await until(() => pids().filter(alive).length === 0);
    });
});
