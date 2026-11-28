// Brokspace for VS Code. SPDX-License-Identifier: MIT OR Apache-2.0

/**
 * What `brok` prints with `--json` (docs/integrations.md in brokspace/brok):
 * the one contract between Brokspace and editors, scripts and CI.
 */

/** Oldest brok with the JSON output the extension relies on (doctor, stats and bug reports). */
export const MINIMUM_BROK_VERSION = '0.4.0';
/** The first brok major this extension has not been written for; a download never goes there. */
export const UNSUPPORTED_BROK_MAJOR = 1;

export interface BrokInfo {
    /** Whether a working `brok` was found. */
    found: boolean;
    /** The executable used (absolute when bundled or configured). */
    path: string;
    version?: string;
    /** Why `brok` could not be used. */
    error?: string;
}

/** `brok status --json`. */
export interface BrokStatus {
    version: string;
    initialized: boolean;
    root?: string;
    daemon?: { running: boolean };
    backends?: string[];
    embeddings?: { enabled: boolean; model: string; dimensions: number };
    llm?: { provider: string; model?: string | null; base_url?: string | null };
    index?: IndexPartition[];
    shards?: ShardInfo[];
    links?: LinkStatus[];
    memory?: { enabled: boolean; sessions: boolean; global: boolean; counts: Record<MemoryScope, number> };
    /** What works right now (brok 0.13 and newer). */
    readiness?: Readiness;
}

/**
 * `readiness` of `brok status --json`. The values are open: a newer brok may
 * send states and codes this extension does not know.
 */
export interface Readiness {
    text_search: { state: string };
    meaning_search: { state: string; embedded: number; chunks: number };
    agent: { state: string };
    model: { state: string };
    next_action?: { code: string; command?: string } | null;
}

export type MemoryScope = 'private' | 'shared' | 'global';
export type MemoryKind = 'note' | 'decision' | 'fact' | 'session' | 'handoff';

/** One entry of `brok memory list --json`. */
export interface Memory {
    id: string;
    title: string;
    kind: MemoryKind | 'link';
    scope: MemoryScope;
    tags: string[];
    created: string;
    updated: string;
    source?: string;
    body: string;
    /** Absolute path of the Markdown file. */
    path: string;
}

/** What to remember (`brok memory add`). */
export interface MemoryInput {
    title: string;
    body?: string;
    kind?: MemoryKind;
    scope?: MemoryScope;
    tags?: string[];
    /** Replaces the memory with this id (same scope). */
    id?: string;
    /** Who writes it, for example `vscode` or `mcp`. */
    source?: string;
}

/** One entry of `brok link list --json`. */
export interface LinkStatus {
    name: string;
    kind: 'local' | 'git';
    /** The sources, relative to the workspace when possible. */
    root: string;
    /** Absolute directory of the sources. */
    path: string;
    git?: string;
    branch?: string;
    description?: string;
    memory: boolean;
    index: 'own' | 'managed';
    exists: boolean;
    files: number;
    chunks: number;
    error?: string;
}

/** What to link (`brok link add`). */
export interface LinkInput {
    name: string;
    /** A directory or a git URL. */
    target: string;
    branch?: string;
    description?: string;
    memory?: boolean;
}

export interface IndexPartition {
    tier: string;
    path: string;
    files: number;
    chunks: number;
    backend: string;
    semantic: boolean;
}

export interface ShardInfo {
    name: string;
    version: string;
    description: string;
    state: 'enabled' | 'disabled' | 'skills' | 'missing-binary';
    source?: string | null;
}

/** A shard's `shard.json` (the fields the extension shows). */
export interface ShardManifest {
    name: string;
    version: string;
    description: string;
    authors?: string[];
    license?: string | null;
    repository?: string | null;
    runtime?: string;
    skills?: string[];
    permissions?: {
        filesystem?: { read?: string[]; write?: string[] };
        network?: boolean;
        process?: string[];
        env?: string[];
    };
    subscribes_to?: string[];
    publishes_to?: string[];
}

/** `brok shard info <name>`: the manifest and where the shard comes from. */
export interface ShardDetails {
    manifest: ShardManifest;
    source?: string;
    binary?: string;
    skills: string[];
}

/** One hit of `brok search --json`. */
export interface SearchHit {
    path: string;
    start_line: number;
    end_line: number;
    kind: string;
    symbol?: string | null;
    score: number;
    content: string;
    partition?: string;
}

/** One entry of `brok skill list --json`. */
export interface SkillInfo {
    name: string;
    description: string;
    user_invoked: boolean;
    source: string;
    bucket?: string | null;
}

export interface SourceRef {
    path: string;
    start_line: number;
    end_line: number;
    symbol?: string;
}

export interface ConversationTurn {
    role: 'user' | 'assistant';
    content: string;
}

/** What to stream an answer for. */
export type AnswerRequest =
    | { kind: 'ask'; prompt: string; history?: ConversationTurn[] }
    | { kind: 'review'; staged?: boolean; base?: string }
    | { kind: 'skill'; name: string; input: string };

export interface AnswerDone {
    provider?: string;
    model?: string;
    sources: SourceRef[];
}

/** One check of `brok doctor --json`. */
export interface DoctorCheck {
    status: 'ok' | 'warn' | 'fail';
    name: string;
    detail: string;
    fix?: string;
}

export interface Latency {
    count: number;
    p50_ms?: number | null;
    p95_ms?: number | null;
}

/** `brok stats --json`: the local metrics of the last `days` days. */
export interface StatsSummary {
    days: number;
    events: number;
    search: { latency: Latency; empty: number; semantic: number; with_links: number; with_memories: number };
    answers: { latency: Latency; first_token: Latency; failed: number; models: Record<string, number>; skills: Record<string, number> };
    index: { latency: Latency; files_indexed: number; last?: string | null };
    errors: { count: number; commands: Record<string, number>; recent: { at: string; command: string; message: string }[] };
}

/** Where a bug report goes: the CLI, the agent (answers, reviews, skills) or this extension. */
export type BugRepo = 'brok' | 'brok-agent' | 'vscode';

/** What to report (`brok bug`). */
export interface BugInput {
    repo: BugRepo;
    title: string;
    whatHappened?: string;
    expected?: string;
    steps?: string;
    /** Environment lines the editor adds (its versions). */
    context?: string;
}

/** `brok bug --json`: the prefilled issue form and the saved report. */
export interface BugReport {
    repo: BugRepo;
    url: string;
    file: string;
    /** `file` with the home directory as `~`. */
    file_shown?: string;
    /** Markdown, secrets masked. */
    report: string;
}

/** `brok config get --json`: the parts of brok.yml the extension edits. */
export interface BrokConfig {
    workspace: {
        submodules: boolean;
        links: Record<string, { path?: string; git?: string; branch?: string; description?: string; memory?: boolean }>;
    };
    index: { include: string[]; exclude: string[]; max_file_kb: number; max_chunk_lines: number; store: string };
    embeddings: { enabled: boolean; model: string; variant: string; dimensions: number; device: string; batch_size: number };
    search: { limit: number; cold_weight: number; link_weight: number };
    memory: { enabled: boolean; sessions: boolean; global: boolean };
    llm: { default: string; providers: Record<string, LlmProvider> };
    [section: string]: unknown;
}

export interface LlmProvider {
    base_url: string;
    model: string;
    api_key_env?: string;
    temperature?: number;
    max_tokens?: number;
}

export interface CommandResult {
    code: number;
    stdout: string;
    stderr: string;
}
