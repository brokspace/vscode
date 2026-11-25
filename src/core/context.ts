// Brokspace for VS Code. SPDX-License-Identifier: MIT OR Apache-2.0

/**
 * Context the user attaches to a question: which files, selections and
 * diagnostics go to the LLM with it. Pure logic (limits, sensitive files,
 * secret hiding, the conversation turns it becomes); the extension reads the
 * editor and shows the result as chips before anything is sent.
 */

import type { ContextChip } from '../webview-protocol';
import type { ConversationTurn } from './protocol';

export const MAX_ITEM_CHARS = 12_000;
export const MAX_TOTAL_CHARS = 40_000;

export type ContextKind = 'file' | 'selection' | 'diagnostics';

export interface ContextItem {
    id: string;
    kind: ContextKind;
    /** Shown on the chip and in the prompt: a workspace-relative path, with lines for a selection. */
    label: string;
    /** Kept for the whole conversation (otherwise for the next question only). */
    persistent: boolean;
    /** Already bounded and with secrets hidden. */
    text: string;
    chars: number;
    truncated: boolean;
    redactions: number;
    /** Outside the workspace, attached because the user picked it. */
    external: boolean;
}

/** Files that hold credentials: never attached, whatever the user does. */
export function isSensitivePath(path: string): boolean {
    const name = path.split(/[\\/]/).pop()?.toLowerCase() ?? '';
    return (
        name === '.env' ||
        name.startsWith('.env.') ||
        /\.(pem|key|p12|pfx|jks|keystore|kdbx|asc|gpg)$/.test(name) ||
        /^(id_rsa|id_dsa|id_ecdsa|id_ed25519)/.test(name) ||
        [
            '.npmrc',
            '.netrc',
            '.pypirc',
            '.git-credentials',
            'credentials',
            'credentials.json',
            'secrets.json',
            'secrets.yml',
            'secrets.yaml',
        ].includes(name)
    );
}

const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g;
const TOKENS = [
    /\bAKIA[0-9A-Z]{16}\b/g,
    /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g,
    /\bgithub_pat_[A-Za-z0-9_]{30,}\b/g,
    /\bsk-[A-Za-z0-9_-]{20,}\b/g,
    /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
    /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/g,
];
const ASSIGNMENT =
    /\b((?:[A-Za-z0-9_-]*(?:password|passwd|secret|token|api[_-]?key|apikey|auth(?:orization)?|private[_-]?key))\s*["']?\s*[:=]\s*["']?)([^\s"',;]{6,})/gi;
const HIDDEN = '[hidden]';

/** Hides credentials in text bound for an LLM; returns how many were hidden. */
export function hideSecrets(text: string): { text: string; count: number } {
    let count = 0;
    const hide = () => {
        count++;
        return HIDDEN;
    };
    let out = text.replace(PRIVATE_KEY, hide);
    for (const pattern of TOKENS) {
        out = out.replace(pattern, hide);
    }
    out = out.replace(ASSIGNMENT, (_all, key: string, value: string) => {
        if (value === HIDDEN || value.startsWith('${') || value.startsWith('$(') || /^(process\.env|env\.|os\.environ)/.test(value)) {
            return `${key}${value}`; // a reference to a variable, not a value
        }
        count++;
        return `${key}${HIDDEN}`;
    });
    return { text: out, count };
}

/** At most `max` characters, cut at a line, with a marker saying how much was left out. */
export function bound(text: string, max: number): { text: string; truncated: boolean } {
    if (text.length <= max) {
        return { text, truncated: false };
    }
    const cut = text.slice(0, max);
    const kept = cut.slice(0, Math.max(cut.lastIndexOf('\n'), max / 2));
    return { text: `${kept}\n… [${text.length - kept.length} more characters not attached]`, truncated: true };
}

/** An item from raw text: secrets hidden, then bounded. */
export function makeItem(
    id: string,
    kind: ContextKind,
    label: string,
    raw: string,
    options: { persistent?: boolean; external?: boolean } = {},
): ContextItem {
    const hidden = hideSecrets(raw);
    const limited = bound(hidden.text, MAX_ITEM_CHARS);
    return {
        id,
        kind,
        label,
        persistent: options.persistent ?? false,
        text: limited.text,
        chars: raw.length,
        truncated: limited.truncated,
        redactions: hidden.count,
        external: options.external ?? false,
    };
}

/** The items that fit in the total budget, in order; the rest are left out and shown as such. */
export function withinBudget(items: ContextItem[], budget = MAX_TOTAL_CHARS): { included: ContextItem[]; omitted: ContextItem[] } {
    const included: ContextItem[] = [];
    const omitted: ContextItem[] = [];
    let used = 0;
    for (const item of items) {
        if (used + item.text.length <= budget) {
            included.push(item);
            used += item.text.length;
        } else {
            omitted.push(item);
        }
    }
    return { included, omitted };
}

/** What the chip shows: no content. */
export function chipOf(item: ContextItem, omitted: boolean): ContextChip {
    return {
        id: item.id,
        kind: item.kind,
        label: item.label,
        persistent: item.persistent,
        chars: item.chars,
        truncated: item.truncated,
        redactions: item.redactions,
        external: item.external,
        omitted,
    };
}

/**
 * The attached context as an earlier exchange of the conversation: the
 * question itself stays clean for retrieval, and the LLM sees the context.
 */
export function contextTurns(items: ContextItem[]): ConversationTurn[] {
    if (!items.length) {
        return [];
    }
    const parts = items.map((item) => `### ${item.label}\n\`\`\`\n${item.text.replace(/```/g, '`​``')}\n\`\`\``);
    return [
        {
            role: 'user',
            content: `I attached this context from my editor for my next question. Use it together with what you retrieve from the workspace.\n\n${parts.join('\n\n')}`,
        },
        { role: 'assistant', content: 'Understood. I will use the attached context.' },
    ];
}
