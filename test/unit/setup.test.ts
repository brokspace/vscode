// Brokspace for VS Code. SPDX-License-Identifier: MIT OR Apache-2.0

import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseAgentPlan, setupArgs } from '../../src/core/setup';

describe('setting up a folder', () => {
    it('writes agent files only when asked to', () => {
        assert.deepEqual(setupArgs(false), ['init', '--yes', '--no-integrations']);
        assert.deepEqual(setupArgs(true), ['init', '--yes']);
    });

    it('reads the plan, and admits when there is none', () => {
        assert.deepEqual(parseAgentPlan(0, '{"files":[".agents/skills/",".vscode/mcp.json"]}'), ['.agents/skills/', '.vscode/mcp.json']);
        assert.deepEqual(parseAgentPlan(0, '{"files":[]}'), []);
        assert.equal(parseAgentPlan(2, "error: unexpected argument '--dry-run'"), undefined);
        assert.equal(parseAgentPlan(0, 'not json'), undefined);
        assert.equal(parseAgentPlan(0, '{"files":[1]}'), undefined);
    });
});
