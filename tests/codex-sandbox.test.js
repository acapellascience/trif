'use strict';
// An organization's Codex settings can refuse TRIF's permission profile; TRIF must stop such a run
// (codex.js sandboxOverridden, runs.js _checkSandbox), never carry on without its limits.
const test = require('node:test');
const assert = require('node:assert');
const codex = require('../helper/lib/agents/codex');
const { EventEmitter } = require('node:events');

const SAID = 'Configured value for permission_profile is disallowed by requirements; falling back from trif-run to required value CodexStandard';

test("codex: an organization's override of TRIF's profile is recognised, ordinary noise isn't", () => {
  assert.equal(codex.sandboxOverridden(SAID), true);
  assert.equal(codex.sandboxOverridden(`{"type":"error","message":"${SAID}"}`), true);
  for (const s of ['Reconnecting... 2/5 (stream disconnected)', 'Falling back from WebSockets to HTTPS transport.', '', null]) {
    assert.equal(codex.sandboxOverridden(s), false, String(s));
  }
  const m = codex.sandboxOverriddenMessage(SAID);
  assert.match(m, /stopped the run/);
  assert.match(m, /CodexStandard/);
});

test('runs: a run whose sandbox was overridden is stopped with why, and never reports success', () => {
  const runs = require('../helper/lib/runs');
  const Runs = runs.Runs || runs.AgentRuns || Object.values(runs).find((v) => typeof v === 'function' && v.prototype && v.prototype._checkSandbox);
  assert.ok(Runs, 'the runs class');
  const emitted = [];
  let killed = 0;
  const self = { logger: { warn() {} }, _emit: (run, ev) => emitted.push(ev), _kill: () => { killed++; } };
  const run = { id: 'r1', adapter: codex };
  assert.equal(Runs.prototype._checkSandbox.call(self, run, 'ordinary output'), false);
  assert.equal(Runs.prototype._checkSandbox.call(self, run, SAID), true);
  assert.equal(killed, 1);
  assert.equal(run.agentDone.ok, false);
  assert.equal(emitted[0].kind, 'error');
  assert.match(emitted[0].message, /organization's Codex settings/);
  assert.equal(Runs.prototype._checkSandbox.call(self, run, SAID), false, 'only once');
});
