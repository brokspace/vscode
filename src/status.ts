// Brokspace for VS Code. SPDX-License-Identifier: MIT OR Apache-2.0

/** The words for brok's readiness report, shown by the status bar. */

import * as vscode from 'vscode';
import type { Readiness } from './core/protocol';
import { embeddedPercent, type NextStep } from './core/readiness';

const t = vscode.l10n.t;

/** What the suggested step does, as a short label. */
export function stepLabel(step: NextStep): string {
    switch (step) {
        case 'rebuildIndex':
            return t('Rebuild the index');
        case 'downloadSearchModel':
            return t('Download the search model');
        case 'index':
            return t('Index this folder');
        case 'restart':
            return t('Restart Brokspace');
        case 'start':
            return t('Start Brokspace');
        case 'installAgent':
            return t('Install the agent');
        case 'setup':
            return t('Set up this folder again');
        case 'upgrade':
            return t('Update brok');
        case 'logs':
            return t('Show the logs');
        case 'chooseModel':
            return t('Choose a model');
    }
}

/** One line per part of Brokspace; states from a newer brok are left out. */
export function readinessLines(readiness: Readiness): string[] {
    const text: Record<string, string> = {
        ready: t('Keyword search: ready'),
        not_indexed: t('Keyword search: not indexed yet'),
        empty: t('Keyword search: nothing to search'),
        unreadable: t('Keyword search: the index cannot be read'),
    };
    const percent = embeddedPercent(readiness);
    const meaning: Record<string, string> = {
        ready: t('Search by meaning: ready'),
        embedding: percent === undefined ? '' : t('Search by meaning: {0}% embedded', percent),
        not_built: t('Search by meaning: not built yet'),
        no_model: t('Search by meaning: the search model is missing'),
        unsupported: t('Search by meaning: not available in this brok'),
        disabled: t('Search by meaning: off'),
    };
    const agent: Record<string, string> = {
        ready: t('Agent: ready'),
        stopped: t('Agent: stopped'),
        starting: t('Agent: starting'),
        not_connected: t('Agent: not connected'),
        disabled: t('Agent: off'),
        not_installed: t('Agent: not installed'),
        missing_program: t('Agent: its program is missing'),
        incompatible: t('Agent: needs another brok version'),
    };
    const model: Record<string, string> = {
        ready: t('Model: ready'),
        unreachable: t('Model: its server does not answer'),
        not_installed: t('Model: not downloaded'),
        missing_key: t('Model: the API key is missing'),
        not_configured: t('Model: none chosen'),
        unchecked: t('Model: not checked'),
    };
    return [
        text[readiness.text_search.state],
        meaning[readiness.meaning_search.state],
        agent[readiness.agent.state],
        model[readiness.model.state],
    ].filter((line): line is string => !!line);
}
