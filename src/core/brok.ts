// Brokspace for VS Code. SPDX-License-Identifier: MIT OR Apache-2.0

import { type ChildProcess, execFile, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'node:readline';
import type {
    AnswerDone,
    AnswerRequest,
    BrokConfig,
    BrokInfo,
    BrokStatus,
    BugInput,
    BugReport,
    CommandResult,
    DoctorCheck,
    LinkInput,
    Memory,
    MemoryInput,
    MemoryScope,
    SearchHit,
    ShardDetails,
    ShardManifest,
    SkillInfo,
    StatsSummary,
} from './protocol';

const EXE = process.platform === 'win32' ? 'brok.exe' : 'brok';
/** Output larger than this is cut (search results with whole chunks can be big). */
const MAX_BUFFER = 32 * 1024 * 1024;

/**
 * Finds `brok`: the configured path, `BROK_PATH`, then the usual install
 * folders (the installer's, Cargo's, Homebrew's), then `PATH`, and last the
 * copy the extension downloaded (`managed`), so it never hides an install.
 */
export function resolveBrok(configured: string | undefined, env: NodeJS.ProcessEnv = process.env, managed?: string): string {
    if (configured?.trim()) {
        return configured.trim();
    }
    if (env.BROK_PATH) {
        return env.BROK_PATH;
    }
    const home = os.homedir();
    const candidates =
        process.platform === 'win32'
            ? [
                  path.join(env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local'), 'Programs', 'brok', EXE),
                  path.join(home, '.cargo', 'bin', EXE),
              ]
            : [
                  path.join(home, '.local', 'bin', EXE),
                  path.join(home, '.cargo', 'bin', EXE),
                  '/opt/homebrew/bin/brok',
                  '/usr/local/bin/brok',
              ];
    const existing = candidates.find((candidate) => fs.existsSync(candidate));
    if (existing) {
        return existing;
    }
    // An install of the user's own, on PATH, always wins over the one the extension downloaded.
    const pathDirs = (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean);
    if (!managed || pathDirs.some((dir) => fs.existsSync(path.join(dir, EXE)))) {
        return 'brok';
    }
    return fs.existsSync(managed) ? managed : 'brok';
}

/**
 * Brokspace through the `brok` CLI and its `--json` output: everything the
 * extension shows, `brok` sees too, and anything it does can be scripted.
 */
export class Brok {
    protected readonly answers = new Map<string, ChildProcess>();

    constructor(readonly executable: string) {}

    dispose(): void {
        for (const child of this.answers.values()) {
            child.kill();
        }
        this.answers.clear();
    }

    async info(): Promise<BrokInfo> {
        try {
            const { stdout } = await this.exec(os.homedir(), ['--version']);
            return { found: true, path: this.executable, version: stdout.trim().split(/\s+/).pop() };
        } catch (error) {
            return { found: false, path: this.executable, error: message(error) };
        }
    }

    status(root: string): Promise<BrokStatus> {
        return this.json<BrokStatus>(root, ['status', '--json']);
    }

    async search(root: string, query: string, limit: number): Promise<SearchHit[]> {
        const result = await this.json<{ hits: SearchHit[] }>(root, ['search', '--json', '-n', String(limit), '--', query]);
        return result.hits ?? [];
    }

    skills(root: string): Promise<SkillInfo[]> {
        return this.json<SkillInfo[]>(root, ['skill', 'list', '--json']);
    }

    async shardInfo(root: string, name: string): Promise<ShardDetails> {
        const { stdout } = await this.exec(root, ['shard', 'info', name]);
        return parseShardInfo(stdout);
    }

    memories(root: string): Promise<Memory[]> {
        return this.json<Memory[]>(root, ['memory', 'list', '--json']);
    }

    searchMemories(root: string, query: string, limit: number): Promise<SearchHit[]> {
        return this.json<SearchHit[]>(root, ['memory', 'search', '--json', '-n', String(limit), '--', query]);
    }

    /** `undefined` when brok did not save it (session memories turned off). */
    async saveMemory(root: string, memory: MemoryInput): Promise<Memory | undefined> {
        const args = [
            'memory',
            'add',
            '--json',
            '--stdin',
            `--kind=${memory.kind ?? 'note'}`,
            `--scope=${memory.scope ?? 'private'}`,
            `--source=${memory.source ?? 'vscode'}`,
        ];
        if (memory.id) {
            args.push(`--id=${memory.id}`);
        }
        for (const tag of memory.tags ?? []) {
            args.push(`--tag=${tag}`);
        }
        args.push('--', memory.title);
        const { stdout } = await this.exec(root, args, memory.body ?? '');
        const saved = JSON.parse(stdout) as Memory | { saved: false };
        return 'id' in saved ? saved : undefined;
    }

    async forgetMemory(root: string, id: string, scope?: MemoryScope): Promise<void> {
        await this.exec(root, ['memory', 'forget', '--json', ...(scope ? [`--scope=${scope}`] : []), '--', id]);
    }

    config(root: string): Promise<BrokConfig> {
        return this.json<BrokConfig>(root, ['config', 'get', '--json']);
    }

    /** `value` is YAML; JSON is YAML too, and keeps strings strings. */
    async setConfig(root: string, key: string, value: unknown): Promise<void> {
        await this.exec(root, ['config', 'set', '--', key, JSON.stringify(value)]);
    }

    async unsetConfig(root: string, key: string): Promise<void> {
        await this.exec(root, ['config', 'unset', '--', key]);
    }

    async addLink(root: string, link: LinkInput): Promise<void> {
        const args = ['link', 'add', '--json'];
        if (link.branch) {
            args.push(`--branch=${link.branch}`);
        }
        if (link.description) {
            args.push(`--description=${link.description}`);
        }
        if (link.memory === false) {
            args.push('--no-memory');
        }
        await this.exec(root, [...args, '--', link.name, link.target]);
    }

    async removeLink(root: string, name: string): Promise<void> {
        await this.exec(root, ['link', 'remove', '--json', '--', name]);
    }

    syncLinks(root: string, names: string[] = []): Promise<{ name: string; error?: string }[]> {
        return this.json(root, ['link', 'sync', '--json', ...(names.length ? ['--', ...names] : [])]);
    }

    doctor(root: string | undefined): Promise<DoctorCheck[]> {
        return this.json<DoctorCheck[]>(root || os.homedir(), ['doctor', '--json']);
    }

    stats(root: string, days: number): Promise<StatsSummary> {
        return this.json<StatsSummary>(root, ['stats', '--json', `--days=${Math.max(1, Math.round(days))}`]);
    }

    /** `brok bug --json`: saves the report and returns the prefilled issue link (opens nothing). */
    async bugReport(root: string | undefined, bug: BugInput): Promise<BugReport> {
        // `--key=value`: a value starting with "-" is never read as an option.
        const args = ['bug', '--json', '--yes', `--repo=${bug.repo}`, `--title=${bug.title}`];
        const optional: [string, string | undefined][] = [
            ['what-happened', bug.whatHappened],
            ['expected', bug.expected],
            ['steps', bug.steps],
            ['context', bug.context],
        ];
        for (const [key, value] of optional) {
            if (value?.trim()) {
                args.push(`--${key}=${value}`);
            }
        }
        try {
            return await this.json<BugReport>(root || os.homedir(), args);
        } catch (error) {
            // brok 0.4.0 predates the native `vscode` target. Keep bug reports
            // working for existing extension users while new brok releases use it.
            if (bug.repo !== 'vscode') {
                throw error;
            }
            const legacyArgs = args.map((arg) => (arg === '--repo=vscode' ? '--repo=brok' : arg));
            const report = await this.json<BugReport>(root || os.homedir(), legacyArgs);
            report.repo = 'vscode';
            report.url = report.url.replace('/brokspace/brok/issues/', '/brokspace/vscode/issues/');
            return report;
        }
    }

    /**
     * Streams an answer: `onChunk` gets each fragment; resolves with the
     * model and the sources when it is complete. `cancel(id)` stops it.
     */
    async answer(id: string, root: string, request: AnswerRequest, onChunk: (text: string) => void): Promise<AnswerDone> {
        let historyFile: string | undefined;
        const args = ((): string[] => {
            switch (request.kind) {
                case 'ask': {
                    const base = ['ask', '--json'];
                    if (request.history?.length) {
                        historyFile = path.join(os.tmpdir(), `brokspace-history-${process.pid}-${id.replace(/\W/g, '')}.json`);
                        fs.writeFileSync(historyFile, JSON.stringify(request.history));
                        base.push('--history', historyFile);
                    }
                    return [...base, '--', request.prompt];
                }
                case 'review':
                    return ['review', '--json', ...(request.staged ? ['--staged'] : []), ...(request.base ? ['--base', request.base] : [])];
                case 'skill':
                    return ['skill', 'run', '--json', request.name, '--', ...(request.input ? [request.input] : [])];
            }
        })();

        const child = spawn(this.executable, args, { cwd: root, env: env(), windowsHide: true });
        this.answers.set(id, child);
        let stderr = '';
        child.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        let done: AnswerDone | undefined;
        const lines = readline.createInterface({ input: child.stdout });
        lines.on('line', (line) => {
            const event = parseEvent(line);
            if (event?.type === 'chunk' && event.text) {
                onChunk(event.text);
            } else if (event?.type === 'done') {
                done = { provider: event.provider, model: event.model, sources: event.sources ?? [] };
            }
        });
        try {
            const code = await new Promise<number | null>((resolve, reject) => {
                child.on('error', reject);
                child.on('close', resolve);
            });
            if (done) {
                return done;
            }
            if (child.killed) {
                throw new CancelledError();
            }
            throw new Error(cleanError(stderr) || `brok exited with code ${code}`);
        } finally {
            this.answers.delete(id);
            if (historyFile) {
                fs.rm(historyFile, { force: true }, () => {
                    /* best effort */
                });
            }
        }
    }

    cancel(id: string): void {
        this.answers.get(id)?.kill();
    }

    async commitMessage(root: string): Promise<string> {
        const { stdout } = await this.exec(root, ['commit', '--print']);
        return stdout.trim();
    }

    /** Any other command; never throws, the exit code says how it went. */
    run(root: string, args: string[]): Promise<CommandResult> {
        return new Promise((resolve) => {
            execFile(
                this.executable,
                args,
                { cwd: root, env: env(), maxBuffer: MAX_BUFFER, windowsHide: true },
                (error, stdout, stderr) => {
                    const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
                    resolve({ code, stdout, stderr: stderr || (error && !stdout ? error.message : '') });
                },
            );
        });
    }

    protected async json<T>(root: string, args: string[]): Promise<T> {
        const { stdout } = await this.exec(root, args);
        return JSON.parse(stdout) as T;
    }

    /** Runs brok; `input` goes to its stdin. */
    protected exec(cwd: string, args: string[], input?: string): Promise<{ stdout: string; stderr: string }> {
        return new Promise((resolve, reject) => {
            const child = execFile(
                this.executable,
                args,
                { cwd, env: env(), maxBuffer: MAX_BUFFER, windowsHide: true },
                (error, stdout, stderr) => {
                    if (error) {
                        reject(new Error(cleanError(stderr) || error.message));
                    } else {
                        resolve({ stdout, stderr });
                    }
                },
            );
            if (input !== undefined) {
                child.stdin?.end(input);
            }
        });
    }
}

/** A cancelled answer. */
export class CancelledError extends Error {
    constructor() {
        super('Cancelled');
    }
}

/** No colors or spinners: output is parsed or shown as plain text. */
function env(): NodeJS.ProcessEnv {
    // VS Code sets it for extension hosts; Electron-based tools brok may start must not inherit it.
    const { ELECTRON_RUN_AS_NODE: _, ...rest } = process.env;
    return { ...rest, NO_COLOR: '1', CLICOLOR: '0', TERM: 'dumb' };
}

type AnswerEvent = { type?: string; text?: string } & Partial<AnswerDone>;

/** One line of `brok ask --json`; `undefined` for anything else (a stray line, an older brok). */
export function parseEvent(line: string): AnswerEvent | undefined {
    try {
        const event = JSON.parse(line) as unknown;
        return typeof event === 'object' && event !== null ? (event as AnswerEvent) : undefined;
    } catch {
        return undefined;
    }
}

/**
 * `brok shard info` prints the pretty-printed `shard.json`, then
 * `source:`, `sha256:`, `binary:` and `skills:` lines.
 */
export function parseShardInfo(stdout: string): ShardDetails {
    const lines = stdout.split(/\r?\n/);
    const end = lines.indexOf('}');
    const manifest = JSON.parse(lines.slice(0, end + 1).join('\n')) as ShardManifest;
    const details: ShardDetails = { manifest, skills: [] };
    for (const line of lines.slice(end + 1)) {
        const match = /^(source|binary|skills):\s+(.*)$/.exec(line);
        if (!match) {
            continue;
        }
        const [, key, value] = match;
        if (key === 'skills') {
            details.skills.push(value);
        } else if (key === 'source') {
            details.source = value;
        } else if (!value.startsWith('none')) {
            details.binary = value;
        }
    }
    return details;
}

/** brok prints `error: <message>`; keep the message. */
export function cleanError(stderr: string): string {
    const lines = stderr
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    const error = [...lines].reverse().find((line) => line.startsWith('error:'));
    return (error ? error.slice('error:'.length) : (lines[0] ?? '')).trim();
}

export function message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** Compares dotted versions (`0.2.10` >= `0.2.4`); unknown versions pass. */
export function isAtLeast(version: string | undefined, minimum: string): boolean {
    if (!version) {
        return true;
    }
    const parse = (v: string) =>
        v
            .split(/[.-]/)
            .slice(0, 3)
            .map((part) => Number.parseInt(part, 10) || 0);
    const [a, b] = [parse(version), parse(minimum)];
    for (let i = 0; i < 3; i++) {
        if (a[i] !== b[i]) {
            return a[i] > b[i];
        }
    }
    return true;
}
