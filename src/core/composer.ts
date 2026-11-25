// Brokspace for VS Code. SPDX-License-Identifier: MIT OR Apache-2.0

/** The chat composer's pure logic: slash-command matching, local commands and input history. */

export interface SlashEntry {
    /** What the composer gets when the entry is chosen (a trailing space when arguments follow). */
    insert: string;
    /** Whether the command takes arguments after `insert`. */
    args: boolean;
}

/**
 * The entries that complete what was typed. Nothing is suggested for text
 * that is not a command, for a command with arguments already typed, or
 * for a complete command that takes none (Enter must then send it).
 */
export function matchSlash<T extends SlashEntry>(entries: T[], draft: string): T[] {
    if (!draft.startsWith('/') || draft.includes('\n')) {
        return [];
    }
    const typed = draft.toLowerCase();
    return entries.filter((entry) => {
        const insert = entry.insert.toLowerCase();
        return insert.startsWith(typed) && (entry.args || insert.trimEnd() !== typed.trimEnd());
    });
}

/** Commands answered without the LLM, so the chat handles them itself. */
export type LocalCommand = { command: 'search' | 'remember'; argument: string };

export function parseLocalCommand(text: string): LocalCommand | undefined {
    const match = /^\/(search|remember)(?:\s+([\s\S]*))?$/i.exec(text.trim());
    return match ? { command: match[1]?.toLowerCase() as LocalCommand['command'], argument: (match[2] ?? '').trim() } : undefined;
}

/**
 * Walks the prompts sent before (Up goes back, Down forward). `index` is
 * the position in `prompts` (`prompts.length` is the draft being written).
 */
export function stepHistory(prompts: string[], index: number, direction: 'up' | 'down'): number {
    return direction === 'up' ? Math.max(0, index - 1) : Math.min(prompts.length, index + 1);
}
