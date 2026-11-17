'use strict';
// The stand-in coding agent for the phone link's tests (docs/PHONE-LINK.md "Proof"): a fake `claude` on the
// PATH of a temp workspace, so that the real Runs can run in the test's own process with no model and no paid
// call. Not a test file itself.
//
//   const { home, bin, calls, go } = standInAgent('wm-plx-');   // BEFORE anything requires helper/lib/runs.js
//
// It sets this process's env to the temp workspace's (testEnv: TRIF_HOME, HOME, TRIF_BOX_ROOT, no keychain), so
// that runs.js, loaded after it, is the helper of that workspace and never of ~/.trif.
//
// What the agent does comes from words in the message (its env is the run's):
//   WRITE        writes mods all over its working folder's sites/: its phone twin, a part of the site's twin,
//                the site's desktop folder, all-sites/, another site's twin, a new folder, a look-alike
//   DELETE       deletes sites/<its twin>/old.js in its working folder
//   PHONE[args]  after those, runs the real `trif phone <args>` (helper/cli.js, through the run's mailbox, as a
//                real agent's command would), once for each such word, in order; what each printed is kept in
//                <bin>/phone/: phoneCalls() → [{args, status, stdout, stderr, shot}] (shot: the mode and first
//                bytes of the screenshot the command named, read while the run is still going)
//   CLI[args]    the same for any other command: the real `trif <args>` (a page command, say, which a phone
//                run has none of), in the order the words are in, among the PHONE ones (cli: true there)
//   PAUSE:<word> says "Working", then waits for go('<word>') before it does the rest
//   SLEEP        says "Thinking" and stays until stopped
//   LOGGEDOUT    fails at once as a logged-out agent does (a 401 result): the run's `login` error
// Each call is kept in <bin>/calls/ with its argv, env, cwd, message, context, and what it could read in
// $TRIF_RUN_SCREENSHOTS: calls() reads them, oldest first.

const fs = require('fs');
const path = require('path');
const { tempDir, privDir, testEnv } = require('./fake-extension');

const FAKE_CLAUDE = `#!${process.execPath}
'use strict';
const fs = require('fs');
const path = require('path');
const argv = process.argv.slice(2);
if (argv[0] === '--version') { console.log('9.9.9 (Claude Code)'); process.exit(0); }
const opt = (name) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1]; };
const prompt = fs.readFileSync(0, 'utf8');
const context = (() => { try { return fs.readFileSync(opt('--append-system-prompt-file'), 'utf8'); } catch { return ''; } })();
const shots = process.env.TRIF_RUN_SCREENSHOTS;
const seen = {};
try { for (const n of fs.readdirSync(shots)) { const st = fs.statSync(path.join(shots, n)); seen[n] = { mode: st.mode & 0o777, head: fs.readFileSync(path.join(shots, n)).subarray(0, 40).toString('latin1') }; } } catch (e) { seen.error = e.message; }
const calls = path.join(__dirname, 'calls');
fs.mkdirSync(calls, { recursive: true });
fs.writeFileSync(path.join(calls, Date.now() + '-' + process.pid + '.json'), JSON.stringify({ argv, env: process.env, cwd: process.cwd(), prompt, context, seen }));
const say = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
const session = opt('--resume') || 'sess-remote-1';
say({ type: 'system', subtype: 'init', session_id: session, cwd: process.cwd(), tools: [] });
function rest() {
  // (the run's own twin: the message names the folder when the context can't, in a later message of a conversation)
  const scope = (/sites\\/(phone~[a-z0-9.-]+)\\//.exec(context) || /sites\\/(phone~[a-z0-9.-]+)\\//.exec(prompt) || [])[1];
  const put = (rel, text) => { const f = path.join(process.cwd(), 'sites', rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
  if (prompt.includes('WRITE')) {
    const base = scope.slice(6);
    const mod = (name) => '// ==WebMod==\\n// @name ' + name + '\\n// ==/WebMod==\\ndocument.documentElement.dataset.trif = "' + name + '";\\n';
    put(scope + '/bottom-bar.js', mod('bottom bar'));
    put('phone~m.' + base + '/part.js', mod('a part of the site'));
    put(base + '/mine.js', 'HACKED');
    put(base + '/new.js', mod('a desktop mod'));
    try { fs.unlinkSync(path.join(process.cwd(), 'sites', base, 'keep.js')); } catch {}
    put('all-sites/everywhere.js', mod('every site'));
    put('phone~other.example/theirs.js', mod('another twin'));
    put('unrelated.example/new.js', mod('a new folder'));
    put('phone~evil' + base + '/x.js', mod('a look-alike'));
  }
  if (prompt.includes('DELETE')) { try { fs.unlinkSync(path.join(process.cwd(), 'sites', scope, 'old.js')); } catch {} }
  let n = 0;
  for (const m of prompt.matchAll(/(PHONE|CLI)\\[([^\\]]*)\\]/g)) {
    const args = m[2].split(' ').filter(Boolean);
    const cli = m[1] === 'CLI';
    const r = require('child_process').spawnSync(process.execPath, [fs.readFileSync(path.join(__dirname, 'cli'), 'utf8'), ...(cli ? [] : ['phone']), ...args], { encoding: 'utf8', env: process.env, cwd: process.cwd(), timeout: 30000 });
    const file = (/^screenshot: (.+)$/m.exec(r.stdout || '') || [])[1];
    let shot = null;
    if (file) { try { shot = { file, mode: fs.statSync(file).mode & 0o777, head: fs.readFileSync(file).subarray(0, 40).toString('latin1') }; } catch (e) { shot = { file, error: e.message }; } }
    fs.mkdirSync(path.join(__dirname, 'phone'), { recursive: true });
    fs.writeFileSync(path.join(__dirname, 'phone', String(Date.now()) + '-' + process.pid + '-' + (n++) + '.json'), JSON.stringify({ args, ...(cli ? { cli } : {}), status: r.status, stdout: r.stdout, stderr: r.stderr, shot }));
  }
  say({ type: 'assistant', message: { content: [{ type: 'text', text: 'Done.' }] } });
  say({ type: 'result', subtype: 'success', is_error: false, result: 'Done.', session_id: session, total_cost_usd: 0 });
}
const pause = /PAUSE:([a-z0-9]+)/.exec(prompt);
if (prompt.includes('LOGGEDOUT')) say({ type: 'result', subtype: 'success', is_error: true, result: 'API Error: 401 Invalid API key · Please run /login', session_id: session, total_cost_usd: 0 });
else if (prompt.includes('SLEEP')) { say({ type: 'assistant', message: { content: [{ type: 'text', text: 'Thinking' }] } }); setInterval(() => {}, 1000); }
else if (pause) {
  say({ type: 'assistant', message: { content: [{ type: 'text', text: 'Working' }] } });
  const wait = () => (fs.existsSync(path.join(__dirname, 'go-' + pause[1])) ? rest() : setTimeout(wait, 20));
  wait();
} else rest();
`;

/**
 * A temp workspace with the stand-in agent as its `claude`, and this process's env set to it. Call it before
 * runs.js is required. → {home, bin, calls() → [{argv, env, cwd, prompt, context, seen}], go(word),
 * phoneCalls() → what its `trif phone` commands printed}
 */
function standInAgent(prefix, extraEnv = {}) {
  const home = tempDir(prefix);
  Object.assign(process.env, testEnv(home), { TRIF_AGENT_KILL_GRACE_MS: '300' }, extraEnv);
  const bin = path.join(home, 'fakebin');
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(home, 'sites'));
  fs.writeFileSync(path.join(bin, 'claude'), FAKE_CLAUDE);
  fs.chmodSync(path.join(bin, 'claude'), 0o755);
  fs.writeFileSync(path.join(bin, 'cli'), path.join(__dirname, '..', 'helper', 'cli.js'));
  fs.writeFileSync(path.join(privDir(home), 'config.json'), JSON.stringify({ env: { PATH: bin } }));
  const calls = () => {
    let names = [];
    try { names = fs.readdirSync(path.join(bin, 'calls')).sort(); } catch { return []; }
    return names.map((n) => JSON.parse(fs.readFileSync(path.join(bin, 'calls', n), 'utf8')));
  };
  const go = (word) => fs.writeFileSync(path.join(bin, `go-${word}`), '');
  const phoneCalls = () => {
    let names = [];
    try { names = fs.readdirSync(path.join(bin, 'phone')).sort(); } catch { return []; }
    return names.map((n) => JSON.parse(fs.readFileSync(path.join(bin, 'phone', n), 'utf8')));
  };
  return { home, bin, calls, go, phoneCalls };
}

module.exports = { standInAgent, FAKE_CLAUDE };
