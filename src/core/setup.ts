// Brokspace for VS Code. SPDX-License-Identifier: MIT OR Apache-2.0

/**
 * Setting up a folder: `.brokspace/` is brok's own, but files for coding
 * agents land in the repository, so the developer decides about those.
 */

/** Lists the files connecting the coding agents would write (brok 0.11 and newer). */
export const AGENT_PLAN_ARGS = ['setup', 'agents', '--dry-run', '--json'];

/** `brok init` with or without the agent files. */
export function setupArgs(withAgentFiles: boolean): string[] {
    return ['init', '--yes', ...(withAgentFiles ? [] : ['--no-integrations'])];
}

/** The files of a plan; `undefined` when brok could not say (an older brok). */
export function parseAgentPlan(code: number, stdout: string): string[] | undefined {
    if (code !== 0) {
        return undefined;
    }
    try {
        const files = (JSON.parse(stdout) as { files?: unknown }).files;
        return Array.isArray(files) && files.every((file) => typeof file === 'string') ? files : undefined;
    } catch {
        return undefined;
    }
}
