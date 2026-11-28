// Brokspace for VS Code. SPDX-License-Identifier: MIT OR Apache-2.0

/**
 * Turns brok's readiness report into what the status bar shows and does. The
 * `command` brok suggests is never run: a repository can influence it, so each
 * known code maps to a step of the extension's own.
 */

import type { Readiness } from './protocol';

export type NextStep =
    | 'rebuildIndex'
    | 'downloadSearchModel'
    | 'index'
    | 'restart'
    | 'start'
    | 'installAgent'
    | 'setup'
    | 'upgrade'
    | 'logs'
    | 'chooseModel';

const STEPS = new Map<string, NextStep>([
    ['rebuild_index', 'rebuildIndex'],
    ['download_embedding_model', 'downloadSearchModel'],
    ['index_workspace', 'index'],
    ['finish_indexing', 'index'],
    ['restart', 'restart'],
    ['start', 'start'],
    ['install_agent', 'installAgent'],
    ['repair_agent', 'setup'],
    ['upgrade', 'upgrade'],
    ['check_logs', 'logs'],
    ['set_api_key', 'chooseModel'],
    ['pull_model', 'chooseModel'],
    ['setup_model', 'chooseModel'],
]);

/** The step brok suggests; `undefined` for nothing to do or a code from a newer brok. */
export function nextStep(readiness: Readiness | undefined): NextStep | undefined {
    return STEPS.get(readiness?.next_action?.code ?? '');
}

/** How much of the index can be searched by meaning, while vectors are still being added. */
export function embeddedPercent(readiness: Readiness | undefined): number | undefined {
    const meaning = readiness?.meaning_search;
    if (meaning?.state !== 'embedding' || meaning.chunks <= 0) {
        return undefined;
    }
    // Rounded down, so it never reads 100% while something waits.
    return Math.min(99, Math.floor((meaning.embedded * 100) / meaning.chunks));
}

/** Whether search is broken, which deserves attention in the status bar. */
export function searchBroken(readiness: Readiness | undefined): boolean {
    return readiness?.text_search.state === 'unreadable';
}
