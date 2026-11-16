#!/usr/bin/env node
'use strict';
// A stand-in for trif-fence.exe (helper/lib/win/fence.js, TRIF_FENCE_BIN), for tests of what's around
// the fence on any system: `prepare` and `cleanup` only note that they were asked (a line each in
// <spec>.calls), and `exec <spec> -- <program> <args…>` runs the program with the spec's folder and
// environment, fenced by nothing. The real launcher is attacked on Windows by tests/windows-fence/run.js
// and tests/windows-run.js.
const fs = require('fs');
const { spawnSync } = require('child_process');

const [cmd, specFile, dashes, ...argv] = process.argv.slice(2);
let spec;
try { spec = JSON.parse(fs.readFileSync(specFile, 'utf8')); } catch (e) { process.stderr.write(`trif-fence: ${e.message}\n`); process.exit(125); }
const note = (what) => { try { fs.appendFileSync(`${specFile}.calls`, `${what}\n`); } catch { /* the run's folder is gone */ } };
// (where the tests look afterwards, the run's own folder being removed with the run)
const log = process.env.TRIF_FAKE_FENCE_LOG;
if (log) { try { fs.appendFileSync(log, `${cmd} ${spec.name}${cmd === 'exec' ? ` ${JSON.stringify(argv)}` : ''}\n`); } catch { /* not there */ } }

if (cmd === 'prepare' || cmd === 'cleanup') { note(cmd); process.exit(0); }
if (cmd === 'exec' && dashes === '--' && argv.length) {
  note(`exec ${JSON.stringify(argv)}`);
  // (the spec's environment is the whole of what the program gets, as with the real one; PATH kept so a
  // program that isn't given by its full path is still found on systems that aren't Windows)
  const r = spawnSync(argv[0], argv.slice(1), { cwd: spec.cwd, env: { ...(process.platform === 'win32' ? {} : { PATH: process.env.PATH }), ...spec.env }, stdio: 'inherit', windowsHide: true });
  if (r.error) { process.stderr.write(`trif-fence: couldn't start the command: ${r.error.message}\n`); process.exit(125); }
  process.exit(r.status === null ? 1 : r.status);
}
process.stderr.write('usage: fake-fence prepare|cleanup <spec.json> | exec <spec.json> -- <program> <args…>\n');
process.exit(125);
