'use strict';
// Step 2 (docs/WHOLE-BOX-PROGRESS.md): `node scripts/release.js claude-pin <version>` moves TRIF's pinned
// Claude Code only when a passed whole-box-latest run tested exactly those packages (pinTestedProblem).

const test = require('node:test');
const assert = require('node:assert');
const { pinTestedProblem } = require('../scripts/release');

const pkg = (key, v, sum) => ({ name: `@anthropic-ai/claude-code-${key}`, tarball: `https://registry.npmjs.org/@anthropic-ai/claude-code-${key}/-/claude-code-${key}-${v}.tgz`, integrity: `sha512-${sum}` });
const pins = (v, sum = 'A') => ({ version: v, macTeam: 'Q6L2SF6YDW', packages: { 'darwin-arm64': pkg('darwin-arm64', v, sum), 'win32-x64': pkg('win32-x64', v, sum) } });

test('claude-pin\'s gate: the same version and, for every platform, the same package, tarball and checksum', () => {
  const now = pins('2.1.340');
  assert.strictEqual(pinTestedProblem({ version: '2.1.340', pins: pins('2.1.340') }, now), null);
  assert.match(pinTestedProblem({ version: '2.1.339', pins: pins('2.1.339') }, now), /tested 2\.1\.339/);
  assert.match(pinTestedProblem({ version: '2.1.340', pins: pins('2.1.340', 'B') }, now), /darwin-arm64 package isn't the registry's now/);
  const missing = pins('2.1.340');
  delete missing.packages['win32-x64'];
  assert.match(pinTestedProblem({ version: '2.1.340', pins: missing }, now), /win32-x64/);
  for (const bad of [null, {}, { version: '2.1.340' }, 'x']) assert.strictEqual(pinTestedProblem(bad, now), 'no test record');
  assert.match(pinTestedProblem({ version: '2.1.340', pins: { ...pins('2.1.340'), version: '2.1.330' } }, now), /tested/);
});
