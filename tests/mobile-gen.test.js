'use strict';
// The iPhone probes' generated files (mobile/shared/gen: the sandbox runtime, the browser checks) are copies
// made by `node mobile/prepare.js` from extension/: a change to extension/sandbox.js without remaking them
// left them stale, and only CI's real-browser smoke test noticed. This needs no browser, so it runs everywhere.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { spawnSync } = require('child_process');

test('mobile/shared/gen is up to date with extension/ (node mobile/prepare.js)', () => {
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'mobile', 'prepare.js'), '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
});
