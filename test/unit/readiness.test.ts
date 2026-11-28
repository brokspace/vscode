// Brokspace for VS Code. SPDX-License-Identifier: MIT OR Apache-2.0

import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Readiness } from '../../src/core/protocol';
import { embeddedPercent, nextStep, searchBroken } from '../../src/core/readiness';

function report(meaning = 'ready', embedded = 10, chunks = 10, code?: string, text = 'ready'): Readiness {
    return {
        text_search: { state: text },
        meaning_search: { state: meaning, embedded, chunks },
        agent: { state: 'ready' },
        model: { state: 'ready' },
        next_action: code ? { code, command: 'rm -rf /' } : null,
    };
}

describe('readiness', () => {
    it('maps the codes brok sends to the extension steps', () => {
        const codes = [
            'rebuild_index',
            'download_embedding_model',
            'index_workspace',
            'finish_indexing',
            'restart',
            'start',
            'install_agent',
            'repair_agent',
            'upgrade',
            'check_logs',
            'set_api_key',
            'pull_model',
            'setup_model',
        ];
        for (const code of codes) {
            assert.ok(nextStep(report('ready', 1, 1, code)), code);
        }
        assert.equal(nextStep(report('ready', 1, 1, 'finish_indexing')), 'index');
        assert.equal(nextStep(report('ready', 1, 1, 'pull_model')), 'chooseModel');
    });

    it('suggests nothing without a report, a step or a known code', () => {
        assert.equal(nextStep(undefined), undefined);
        assert.equal(nextStep(report()), undefined);
        for (const code of ['something_new', 'toString', '__proto__']) {
            assert.equal(nextStep(report('ready', 1, 1, code)), undefined, code);
        }
    });

    it('shows progress only while vectors are being added', () => {
        assert.equal(embeddedPercent(report('embedding', 336, 1800)), 18);
        assert.equal(embeddedPercent(report('embedding', 999, 1000)), 99);
        assert.equal(embeddedPercent(report('embedding', 0, 0)), undefined);
        assert.equal(embeddedPercent(report('ready', 99, 100)), undefined);
        assert.equal(embeddedPercent(undefined), undefined);
    });

    it('flags an index that cannot be read', () => {
        assert.equal(searchBroken(report('not_built', 0, 0, 'rebuild_index', 'unreadable')), true);
        assert.equal(searchBroken(report()), false);
        assert.equal(searchBroken(undefined), false);
    });
});
