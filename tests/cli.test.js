'use strict';
// Tests for helper/cli.js (the `trif` command), run against host.js + a fake extension.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { FakeExtension, runCli, writeMod, tempDir, REPO, privDir } = require('./fake-extension');
const { detectExpression, formatValue, parseArgs } = require('../helper/cli');

const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const ORIGIN = 'chrome-extension://iaablflfafmonebdomeikadolkgdbkhe/';

const cleanups = [];
test.after(async () => {
  for (const fn of cleanups.reverse()) { try { await fn(); } catch { /* ignore */ } }
});

// One host + fake extension shared by the page-command tests.
let shared;
async function getShared() {
  if (shared) return shared;
  const home = tempDir();
  writeMod(home, 'example.com', 'banner.js', '// ==WebMod==\n// @name Banner\n// ==/WebMod==\n1');
  const ext = new FakeExtension({ home, env: { TRIF_TIMEOUT_GRACE: '300' } });
  cleanups.push(() => ext.close());
  ext.hello();
  const off = new Set(); // mods switched off through mod.enable
  ext.handlers = {
    run: (args) => {
      if (args.code.includes('throw')) throw new Error('Error: boom\n    at <anonymous>:1:7');
      if (args.code === 'hang') return new Promise(() => {});
      if (args.code === 'obj') return { value: { a: 1, b: [1, 2] } };
      if (args.code === 'jsonstring') return { value: '{"a":1}' };
      return { value: `echo:${args.code}` };
    },
    tabs: () => [
      { id: 11, windowId: 1, active: true, url: 'https://example.com/', title: 'Example' },
      { id: 12, windowId: 1, active: false, url: 'https://x.com/home', title: 'Home / X' },
    ],
    status: () => ({
      userScripts: true, chrome: '140.0.0.0', version: '0.1.0',
      mods: [{ id: 'example.com/banner', registered: !off.has('example.com/banner'), enabled: !off.has('example.com/banner') }],
      recording: ['x.com'],
    }),
    'mod.enable': (args) => {
      if (args.id !== 'example.com/banner') throw new Error(`no mod ${args.id} (run \`trif status\` to list mods)`);
      if (args.site) return { id: args.id, enabled: args.enabled, site: args.site, offSites: args.enabled ? [] : [args.site], modEnabled: true, reloaded: null };
      if (args.enabled) off.delete(args.id); else off.add(args.id);
      return { id: args.id, enabled: args.enabled, reloaded: args.tab === 11 ? 11 : null };
    },
    screenshot: () => ({ dataUrl: `data:image/png;base64,${PNG_1PX}` }),
    reload: (args) => ({ url: args.url ? `https://${args.url}/` : 'https://example.com/' }),
    open: (args) => ({ id: 99, url: args.to }),
    navigate: (args) => ({ url: args.to }),
    text: () => ({ url: 'https://example.com/', title: 'Example', text: 'Hello world' }),
    record: (args) => ({ recording: args.on ? [args.site] : [] }),
    requests: () => [{ i: 0, method: 'GET', url: 'https://x.com/api/1', status: 200, type: 'fetch', size: 2048, time: 12 }],
    request: (args) => ({ method: 'POST', url: 'https://x.com/api/1', status: 200, requestBody: '{"q":1}', responseText: `{"i":${args.i},"items":[1,2]}` }),
    errors: () => [{ mod: 'example.com/banner', message: 'boom', stack: 'Error: boom\n    at webmods://example.com/banner.js:3:9', time: Date.now() }],
    logs: () => [{ mod: 'example.com/banner', level: 'log', args: ['hello', '42'], time: Date.now() }],
  };
  await ext.waitForSocket();
  shared = { home, ext };
  return shared;
}

function lastRequest(ext, cmd) {
  const reqs = ext.messages.filter((m) => m.type === 'request' && m.cmd === cmd);
  return reqs[reqs.length - 1];
}

// ------------------------------------------------------------------ pure functions

test('detectExpression: REPL-style detection', () => {
  assert.deepEqual(detectExpression('document.title'), { code: 'document.title', expression: true });
  assert.deepEqual(detectExpression('document.title;  \n'), { code: 'document.title', expression: true });
  assert.equal(detectExpression('await fetch("/x").then(r => r.json())').expression, true);
  assert.equal(detectExpression('{a: 1}').expression, true);
  assert.equal(detectExpression('1 // trailing comment').expression, true);
  assert.equal(detectExpression('return 1').expression, false);
  assert.equal(detectExpression('const a = 1; return a').expression, false);
  assert.equal(detectExpression('a = 1; a + 1').expression, false);
  assert.equal(detectExpression('if (x) { y() }').expression, false);
});

test('formatValue: strings bare, objects pretty', () => {
  assert.equal(formatValue('hello'), 'hello');
  assert.equal(formatValue('"hello"'), '"hello"');
  assert.equal(formatValue('[1,2]'), '[\n  1,\n  2\n]');
  assert.equal(formatValue({ a: 1 }), '{\n  "a": 1\n}');
  assert.equal(formatValue('{"a":1}'), '{\n  "a": 1\n}');
  assert.equal(formatValue(null), 'null');
  assert.equal(formatValue(3), '3');
  assert.equal(formatValue('not json {'), 'not json {');
});

test('parseArgs: flags, values, = syntax, stdin dash, --', () => {
  const r = parseArgs(['run', '--url=x.com', '--tab', '5', '-', '--json']);
  assert.deepEqual(r.pos, ['run', '-']);
  assert.deepEqual(r.opts, { '--url': 'x.com', '--tab': '5', '--json': true });
  assert.deepEqual(parseArgs(['run', '--', '--not-a-flag']).pos, ['run', '--not-a-flag']);
  assert.deepEqual(parseArgs(['request', '-o', 'f.json', '3']).opts, { '-o': 'f.json' });
  assert.throws(() => parseArgs(['tabs', '--bogus']), /unknown option/);
});

// ------------------------------------------------------------------ no helper

test('exit code 2 with a clear message when the helper is not running', async () => {
  const home = tempDir();
  for (const args of [['tabs'], ['run', '1'], ['status'], ['screenshot']]) {
    const r = await runCli(args, { home });
    assert.equal(r.code, 2, `${args} exit code`);
    assert.match(r.stderr, /helper isn't running/);
    assert.match(r.stderr, /Open Chrome/);
    assert.match(r.stderr, /trif doctor/);
    assert.equal(r.stdout, '');
  }
});

test('mods works without Chrome, reading the folder', async () => {
  const home = tempDir();
  writeMod(home, 'x.com', 'plain.js', '// ==WebMod==\n// @name Plain\n// @match https://x.com/*\n// @run-at document-end\n// ==/WebMod==\n');
  writeMod(home, 'x.com', '_wip.js', '');
  let r = await runCli(['mods'], { home });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /x\.com\/plain {2}\(Plain\)/);
  assert.match(r.stdout, /matches: https:\/\/x\.com\/\*/);
  assert.match(r.stdout, /run-at: document-end/);
  assert.doesNotMatch(r.stdout, /_wip/);
  r = await runCli(['mods', '--json'], { home });
  const j = JSON.parse(r.stdout);
  assert.equal(j.mods[0].id, 'x.com/plain');
  assert.equal(j.mods[0].runAt, 'document_end');
  assert.equal(j.mods[0].code, undefined);
});

test('help: lists every command and gives per-command help', async () => {
  const home = tempDir();
  const r = await runCli(['help'], { home });
  assert.equal(r.code, 0);
  for (const c of ['setup', 'status', 'doctor', 'tabs', 'run', 'reload', 'open', 'navigate', 'text', 'screenshot',
    'record', 'requests', 'request', 'errors', 'logs', 'mods', 'new', 'install-example', 'enable', 'disable', 'help']) {
    assert.match(r.stdout, new RegExp(`^  ${c}\\b`, 'm'), `help mentions ${c}`);
  }
  assert.match(r.stdout, /--url/);
  assert.match(r.stdout, /Exit codes/);
  const run = await runCli(['help', 'run'], { home });
  assert.match(run.stdout, /Examples:/);
  assert.match(run.stdout, /-f file\.js/);
  assert.equal((await runCli([], { home })).code, 0);
  assert.equal((await runCli(['run', '--help'], { home })).stdout, run.stdout);
  const bad = await runCli(['nope'], { home });
  assert.equal(bad.code, 1);
});

// ------------------------------------------------------------------ page commands

test('run: expression detection, args forwarded, values printed', async () => {
  const { home, ext } = await getShared();
  let r = await runCli(['run', '--url', 'example', 'document.title'], { home });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, 'echo:document.title\n');
  let req = lastRequest(ext, 'run');
  assert.equal(req.args.expression, true);
  assert.equal(req.args.url, 'example');
  assert.equal(req.args.timeout, 10000);

  r = await runCli(['run', '--tab', '12', 'const a = 1; return a'], { home });
  req = lastRequest(ext, 'run');
  assert.equal(req.args.expression, false);
  assert.equal(req.args.tab, 12);

  r = await runCli(['run', 'obj'], { home });
  assert.equal(r.stdout, JSON.stringify({ a: 1, b: [1, 2] }, null, 2) + '\n');
  r = await runCli(['run', 'jsonstring'], { home });
  assert.equal(r.stdout, '{\n  "a": 1\n}\n');
  r = await runCli(['run', '--json', 'obj'], { home });
  assert.deepEqual(JSON.parse(r.stdout), { value: { a: 1, b: [1, 2] } });
});

test('run: -f file and - (stdin)', async () => {
  const { home, ext } = await getShared();
  const f = path.join(home, 'probe.js');
  fs.writeFileSync(f, 'const n = 2;\nreturn n * 2;\n');
  let r = await runCli(['run', '-f', f], { home });
  assert.equal(r.code, 0, r.stderr);
  let req = lastRequest(ext, 'run');
  assert.equal(req.args.code, 'const n = 2;\nreturn n * 2;\n');
  assert.equal(req.args.expression, false);

  r = await runCli(['run', '-'], { home, input: 'location.href\n' });
  assert.equal(r.code, 0, r.stderr);
  req = lastRequest(ext, 'run');
  assert.equal(req.args.code, 'location.href');
  assert.equal(req.args.expression, true);

  r = await runCli(['run'], { home });
  assert.equal(r.code, 1);
});

test('run: page error gives exit 1 with the message; timeout gives exit 1', async () => {
  const { home } = await getShared();
  let r = await runCli(['run', 'throw new Error("boom")'], { home });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /boom/);
  r = await runCli(['run', '--timeout', '100', 'hang'], { home });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /timed out after 400ms/);
});

test('screenshot writes a PNG to -o and to the default folder', async () => {
  const { home } = await getShared();
  const out = path.join(home, 'shots', 'a.png');
  let r = await runCli(['screenshot', '--url', 'example', '-o', out], { home });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout.trim(), out);
  assert.deepEqual(fs.readFileSync(out), Buffer.from(PNG_1PX, 'base64'));
  r = await runCli(['screenshot'], { home });
  assert.equal(r.code, 0, r.stderr);
  const p = r.stdout.trim();
  assert.equal(path.dirname(p), path.join(privDir(home), 'screenshots'), 'in the private folder, not the workspace');
  assert.match(path.basename(p), /^\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d(-\d+)?\.png$/);
  assert.equal(fs.readFileSync(p).subarray(1, 4).toString(), 'PNG');
});

test('tabs, status, reload, open, navigate, text, record, errors, logs', async () => {
  const { home, ext } = await getShared();
  let r = await runCli(['tabs'], { home });
  assert.match(r.stdout, /11\* Example\n\s+https:\/\/example\.com\//);
  r = await runCli(['tabs', '--json'], { home });
  assert.equal(JSON.parse(r.stdout).length, 2);

  r = await runCli(['status'], { home });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /user scripts {2}on/);
  assert.match(r.stdout, /example\.com\/banner\s+registered/);
  assert.match(r.stdout, /recording {5}x\.com/);

  r = await runCli(['reload', '--hard', '--url', 'example.com'], { home });
  assert.equal(r.stdout, 'reloaded https://example.com/\n');
  assert.equal(lastRequest(ext, 'reload').args.hard, true);

  r = await runCli(['open', 'example.org'], { home });
  assert.equal(r.stdout, 'opened tab 99: https://example.org\n');
  r = await runCli(['navigate', '--tab', '11', 'http://a.test/'], { home });
  assert.equal(r.stdout, 'navigated to http://a.test/\n');
  assert.equal(lastRequest(ext, 'navigate').args.tab, 11);

  r = await runCli(['text'], { home });
  assert.match(r.stdout, /Hello world/);

  r = await runCli(['record', 'https://x.com/home'], { home });
  assert.deepEqual(lastRequest(ext, 'record').args, { site: 'x.com', on: true });
  assert.match(r.stdout, /recording: x\.com/);
  r = await runCli(['record', 'x.com', 'off'], { home });
  assert.equal(lastRequest(ext, 'record').args.on, false);
  r = await runCli(['record', 'x.com', 'maybe'], { home });
  assert.equal(r.code, 1);

  r = await runCli(['errors'], { home });
  assert.match(r.stdout, /example\.com\/banner: boom/);
  assert.match(r.stdout, /webmods:\/\/example\.com\/banner\.js:3:9/);
  r = await runCli(['logs'], { home });
  assert.match(r.stdout, /example\.com\/banner hello 42/);
});

test('enable / disable: mod.enable through the helper; status shows off; mods marks [off]', async () => {
  const { home, ext } = await getShared();
  let r = await runCli(['disable', 'example.com/banner', '--tab', '11'], { home });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, 'example.com/banner is off\nreloaded tab 11\n');
  assert.deepEqual(lastRequest(ext, 'mod.enable').args, { id: 'example.com/banner', enabled: false, wait: true, tab: 11 });

  r = await runCli(['status'], { home });
  assert.match(r.stdout, /example\.com\/banner\s+off\n/);
  assert.match(r.stdout, /off = switched off by the user/);
  r = await runCli(['mods'], { home });
  assert.match(r.stdout, /^example\.com\/banner {2}\(Banner\) {2}\[off\]$/m);
  assert.match(r.stdout, /switched off by the user \(not running; trif enable example\.com\/banner turns it on\)/);
  r = await runCli(['mods', '--json'], { home });
  assert.equal(JSON.parse(r.stdout).mods[0].enabled, false);
  // A mod TRIF ships switched off is off as TRIF ships it, not "switched off by the user".
  const pre = path.join(home, 'preinstalled.json');
  fs.writeFileSync(pre, JSON.stringify({ offered: ['example.com/banner'], startOff: ['example.com/banner'] }));
  try {
    r = await runCli(['status'], { home });
    assert.match(r.stdout, /example\.com\/banner\s+off \(as TRIF ships it\)\n/);
    assert.match(r.stdout, /off \(as TRIF ships it\) = a mod TRIF comes with, off until switched on/);
    assert.doesNotMatch(r.stdout, /switched off by the user/);
    r = await runCli(['mods'], { home });
    assert.match(r.stdout, /^ {2}off, as TRIF ships it \(not running; trif enable example\.com\/banner turns it on\)$/m);
    assert.doesNotMatch(r.stdout, /switched off by the user/);
  } finally { fs.rmSync(pre, { force: true }); }

  // a file path works as the id; no reload → says how to see it
  r = await runCli(['enable', path.join(home, 'sites', 'example.com', 'banner.js')], { home });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^example\.com\/banner is on\n/);
  assert.match(r.stdout, /reload open example\.com tabs to see it \(trif reload --url example\.com\)/);
  assert.deepEqual(lastRequest(ext, 'mod.enable').args, { id: 'example.com/banner', enabled: true, wait: true });
  r = await runCli(['status'], { home });
  assert.match(r.stdout, /example\.com\/banner\s+registered/);
  assert.doesNotMatch(r.stdout, /switched off/);
  r = await runCli(['mods'], { home });
  assert.doesNotMatch(r.stdout, /\[off\]/);
  r = await runCli(['enable', 'example.com/banner', '--json'], { home });
  assert.deepEqual(JSON.parse(r.stdout), { id: 'example.com/banner', enabled: true, reloaded: null });

  // --site: one site only
  r = await runCli(['disable', 'example.com/banner', '--site', 'twitter.com'], { home });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(lastRequest(ext, 'mod.enable').args, { id: 'example.com/banner', enabled: false, wait: true, site: 'twitter.com' });
  assert.match(r.stdout, /^example\.com\/banner is off on twitter\.com\nOff on: twitter\.com\n/);
  r = await runCli(['enable', 'example.com/banner', '--site', ' '], { home });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /--site needs a hostname/);

  r = await runCli(['disable', 'nope.com/x'], { home });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /no mod nope\.com\/x/);
  r = await runCli(['disable', 'banner'], { home });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /isn't a mod id/);
  assert.match(r.stderr, /usage: trif disable <site>\/<mod> \[--site HOST\] \[TAB\]/);
  r = await runCli(['enable'], { home });
  assert.equal(r.code, 1);
  r = await runCli(['help', 'disable'], { home });
  assert.match(r.stdout, /without deleting or editing it/);
  assert.match(r.stdout, /TAB: --tab/);
});

test('enable / disable: exit 2 without the helper; mods says nothing about switches then', async () => {
  const home = tempDir();
  writeMod(home, 'x.com', 'plain.js', '1');
  let r = await runCli(['disable', 'x.com/plain'], { home });
  assert.equal(r.code, 2);
  r = await runCli(['mods'], { home });
  assert.equal(r.code, 0);
  assert.doesNotMatch(r.stdout, /off/);
  assert.equal(JSON.parse((await runCli(['mods', '--json'], { home })).stdout).mods[0].enabled, undefined);
});

test('requests and request: table, pretty JSON bodies, -o', async () => {
  const { home, ext } = await getShared();
  let r = await runCli(['requests', '--filter', 'api', '--limit', '5'], { home });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^\s+0\s+GET\s+200\s+fetch\s+2\.0K\s+https:\/\/x\.com\/api\/1$/m);
  assert.deepEqual(lastRequest(ext, 'requests').args, { filter: 'api', limit: 5 });

  r = await runCli(['request', '3'], { home });
  assert.equal(r.code, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.deepEqual(j.response, { i: 3, items: [1, 2] });
  assert.deepEqual(j.requestBody, { q: 1 });
  assert.match(r.stdout, /"items": \[\n/);

  const f = path.join(home, 'body.json');
  r = await runCli(['request', '4', '-o', f], { home });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).responseFile, f);
  assert.deepEqual(JSON.parse(fs.readFileSync(f, 'utf8')), { i: 4, items: [1, 2] });

  r = await runCli(['request', 'x'], { home });
  assert.equal(r.code, 1);
});

// ------------------------------------------------------------------ files

test('new creates a mod from the template; refuses to overwrite', async () => {
  const home = tempDir();
  const r = await runCli(['new', 'Example.com', 'hide-banner'], { home });
  assert.equal(r.code, 0, r.stderr);
  const file = path.join(home, 'sites', 'example.com', 'hide-banner.js');
  assert.equal(r.stdout.trim(), file);
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /\/\/ @name {8}Hide Banner/);
  assert.match(text, /@match {7}\*:\/\/example\.com\/\*/);
  assert.doesNotMatch(text, /\{\{/);
  assert.equal((await runCli(['new', 'example.com', 'hide-banner'], { home })).code, 1);
  assert.equal((await runCli(['new', 'example.com', 'Bad Name!'], { home })).code, 1);
  // The template must be valid JS.
  assert.doesNotThrow(() => new Function(text));
});

test('new all-sites: one @match for every site', async () => {
  const home = tempDir();
  const r = await runCli(['new', 'all-sites', 'dark-everywhere'], { home });
  assert.equal(r.code, 0, r.stderr);
  const text = fs.readFileSync(path.join(home, 'sites', 'all-sites', 'dark-everywhere.js'), 'utf8');
  assert.deepEqual(text.match(/^\/\/ @match .*$/gm), ['// @match       *://*/*']);
  assert.match(text, /@run-at {6}document-start/);
  assert.doesNotThrow(() => new Function(text));
});

test('install-example copies from the examples folder', async () => {
  const home = tempDir();
  const examples = tempDir();
  fs.mkdirSync(path.join(examples, 'x.com'));
  fs.writeFileSync(path.join(examples, 'x.com', 'detox-timeline.js'), '// example\n');
  const env = { TRIF_EXAMPLES_DIR: examples };
  let r = await runCli(['install-example'], { home, env });
  assert.match(r.stdout, /x\.com\/detox-timeline/);
  r = await runCli(['install-example', 'x.com/detox-timeline'], { home, env });
  assert.equal(r.code, 0, r.stderr);
  const dest = path.join(home, 'sites', 'x.com', 'detox-timeline.js');
  assert.equal(fs.readFileSync(dest, 'utf8'), '// example\n');
  assert.equal((await runCli(['install-example', 'x.com/detox-timeline'], { home, env })).code, 1);
  assert.equal((await runCli(['install-example', 'x.com/detox-timeline', '--force'], { home, env })).code, 0);
  r = await runCli(['install-example', 'x.com/nope'], { home, env });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /available: x\.com\/detox-timeline/);
});

test('install-example finds the repo examples by default', async () => {
  const src = path.join(REPO, 'examples', 'sites', 'x.com', 'detox-timeline.js');
  if (!fs.existsSync(src)) return; // written by another agent; skip if not there yet
  const home = tempDir();
  const r = await runCli(['install-example', 'x.com/detox-timeline'], { home });
  assert.equal(r.code, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(home, 'sites', 'x.com', 'detox-timeline.js')));
});

// ------------------------------------------------------------------ setup and doctor

function setupArgs(root) {
  return ['setup', '--verbose', '--home', path.join(root, 'ws'), '--native-dir', path.join(root, 'native'), '--bin-dir', path.join(root, 'bin'), '--no-examples'];
}

test('setup: workspace, wrappers, manifest, link; idempotent; leaves sites alone', async () => {
  const root = tempDir();
  fs.mkdirSync(path.join(root, 'bin'));
  const ws = path.join(root, 'ws');
  let r = await runCli(setupArgs(root), { home: path.join(root, 'unused') });
  assert.equal(r.code, 0, r.stderr + r.stdout);
  for (const d of ['sites', 'bin']) assert.ok(fs.statSync(path.join(ws, d)).isDirectory(), d);
  assert.ok(!fs.existsSync(path.join(ws, 'screenshots')), 'screenshots are kept in the private folder');
  assert.ok(fs.statSync(path.join(privDir(ws), 'screenshots')).isDirectory());
  assert.equal(fs.statSync(privDir(ws)).mode & 0o777, 0o700);
  assert.equal(fs.readFileSync(path.join(ws, 'CLAUDE.md'), 'utf8').trim(), '@AGENTS.md\n@instructions.md');
  if (fs.existsSync(path.join(REPO, 'helper', 'workspace', 'AGENTS.md'))) assert.ok(fs.existsSync(path.join(ws, 'AGENTS.md')));

  const hostWrapper = path.join(ws, 'bin', 'trif-host');
  const host = fs.readFileSync(hostWrapper, 'utf8');
  assert.match(host, /^#!\/bin\/sh\n/);
  const m = host.match(/exec "([^"]+)" "([^"]+)" "\$@"\n$/);
  assert.ok(m, host);
  assert.ok(path.isAbsolute(m[1]) && fs.existsSync(m[1]), 'absolute node path');
  assert.equal(m[2], path.join(REPO, 'helper', 'host.js'));
  assert.match(host, new RegExp(`TRIF_HOME="${ws.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  assert.equal(fs.statSync(hostWrapper).mode & 0o111, 0o111);
  const cli = fs.readFileSync(path.join(ws, 'bin', 'trif'), 'utf8');
  assert.match(cli, /helper\/cli\.js" "\$@"\n$/);

  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'native', 'com.webmods.helper.json'), 'utf8'));
  assert.deepEqual(manifest, {
    name: 'com.webmods.helper',
    description: manifest.description,
    path: hostWrapper,
    type: 'stdio',
    allowed_origins: [ORIGIN],
  });
  assert.equal(fs.readlinkSync(path.join(root, 'bin', 'trif')), path.join(ws, 'bin', 'trif'));
  assert.match(r.stdout, /Load unpacked/);
  assert.match(r.stdout, /Allow User Scripts/);
  assert.match(r.stdout, new RegExp(path.join(REPO, 'extension').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  // The CLI wrapper works and points at the right home.
  const viaWrapper = await new Promise((resolve) => {
    require('child_process').execFile(path.join(ws, 'bin', 'trif'), ['mods'], { env: { PATH: process.env.PATH, HOME: root } }, (e, so) => resolve(so));
  });
  assert.match(viaWrapper, new RegExp(`no mods in ${ws.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));

  // Idempotent; user files untouched; AGENTS/CLAUDE refreshed.
  writeMod(ws, 'a.com', 'mine.js', 'keep me');
  fs.writeFileSync(path.join(ws, 'CLAUDE.md'), 'edited');
  r = await runCli(setupArgs(root), { home: path.join(root, 'unused') });
  assert.equal(r.code, 0);
  assert.equal(fs.readFileSync(path.join(ws, 'sites', 'a.com', 'mine.js'), 'utf8'), 'keep me');
  assert.equal(fs.readFileSync(path.join(ws, 'CLAUDE.md'), 'utf8').trim(), '@AGENTS.md\n@instructions.md');
  assert.match(r.stdout, /already/);
  assert.equal(fs.readFileSync(hostWrapper, 'utf8'), host);
});

test('setup: does not overwrite a non-symlink trif in the bin dir; honours TRIF_HOME', async () => {
  const root = tempDir();
  fs.mkdirSync(path.join(root, 'bin'));
  fs.writeFileSync(path.join(root, 'bin', 'trif'), 'someone else');
  const ws = path.join(root, 'envhome');
  const r = await runCli(['setup', '--verbose', '--native-dir', path.join(root, 'native'), '--bin-dir', path.join(root, 'bin')], { home: ws });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(fs.readFileSync(path.join(root, 'bin', 'trif'), 'utf8'), 'someone else');
  assert.match(r.stdout, /not a symlink/);
  assert.ok(fs.existsSync(path.join(ws, 'bin', 'trif-host')));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'native', 'com.webmods.helper.json'), 'utf8'));
  assert.equal(manifest.path, path.join(ws, 'bin', 'trif-host'));
});

test('setup: --browser picks folders under HOME; unknown browser fails', async () => {
  const root = tempDir();
  const fakeHome = path.join(root, 'fakehome');
  const r = await runCli(['setup', '--verbose', '--home', path.join(root, 'ws'), '--browser', 'brave', '--no-link'], { home: root, env: { HOME: fakeHome } });
  assert.equal(r.code, 0, r.stderr);
  const dir = process.platform === 'darwin'
    ? path.join(fakeHome, 'Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts')
    : path.join(fakeHome, '.config/BraveSoftware/Brave-Browser/NativeMessagingHosts');
  assert.ok(fs.existsSync(path.join(dir, 'com.webmods.helper.json')));
  const bad = await runCli(['setup', '--verbose', '--home', path.join(root, 'ws'), '--browser', 'netscape', '--no-link'], { home: root, env: { HOME: fakeHome } });
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /unknown browser/);
});

test('doctor: broken setup lists failures with fixes and exits 1', async () => {
  const root = tempDir();
  const r = await runCli(['doctor', '--native-dir', path.join(root, 'native')], { home: path.join(root, 'ws') });
  assert.equal(r.code, 1);
  assert.match(r.stdout, /^ok {4}Node v\d+/m);
  assert.match(r.stdout, /FAIL {2}workspace .* is missing/);
  assert.match(r.stdout, /FAIL {2}host wrapper .* is missing/);
  assert.match(r.stdout, /FAIL {2}.*native host manifest missing/);
  assert.match(r.stdout, /FAIL {2}helper isn't running/);
  assert.match(r.stdout, /fix: run: trif setup/);
  assert.match(r.stdout, /fix: first fix the failures above/);
  assert.match(r.stdout, /\d+ problems? found/);
});

test('doctor: the helper isn\'t running: advice for the browsers set up, a line each when there are several', async () => {
  const { helperDownFix } = require('../helper/lib/doctor');
  const ext = '/x/extension';
  const chrome = helperDownFix({ chromium: ['Google Chrome'], extensionDir: ext }).join('\n');
  assert.match(chrome, /^install the TRIF extension and turn it on at chrome:\/\/extensions/);
  assert.match(chrome, /Load unpacked from \/x\/extension/);
  assert.match(chrome, /service worker/);
  const fx = helperDownFix({ firefox: true, extensionDir: ext }).join('\n');
  assert.match(fx, /^install the TRIF add-on: open https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/releases\/latest\/download\/trif-firefox\.xpi in Firefox/);
  assert.doesNotMatch(fx, /chrome:\/\/|Load unpacked|service worker/);
  const safari = helperDownFix({ safari: true, extensionDir: ext }).join('\n');
  assert.match(safari, /^open TRIF\.app once/);
  assert.doesNotMatch(safari, /chrome:\/\/|Firefox/);
  const all = helperDownFix({ chromium: ['Google Chrome', 'Brave'], firefox: true, safari: true, extensionDir: ext });
  assert.deepEqual(all.map((l) => l.split(':')[0]), ['Google Chrome / Brave', 'Firefox', 'Safari', 'The helper runs while one of them is open with TRIF turned on.']);
  // Nothing known (inside an agent run): Chrome's, the usual case.
  assert.match(helperDownFix({ extensionDir: ext })[0], /^install the TRIF extension/);
});

test('doctor: setup for Firefox alone: no Chrome advice when the helper isn\'t running', async () => {
  const root = tempDir();
  const ws = path.join(root, 'ws');
  await runCli(['setup', '--verbose', '--browser', 'firefox', '--no-link', '--no-examples'], { home: ws });
  const r = await runCli(['doctor'], { home: ws });
  assert.match(r.stdout, /FAIL {2}helper isn't running/);
  assert.match(r.stdout, /install the TRIF add-on/);
  assert.doesNotMatch(r.stdout, /Load unpacked|service worker/);
});

test('doctor: after setup, wrong manifest and missing node are caught; live helper and user-scripts switch reported', async () => {
  const root = tempDir();
  const ws = path.join(root, 'ws');
  const native = path.join(root, 'native');
  await runCli(['setup', '--verbose', '--native-dir', native, '--no-link'], { home: ws });
  let r = await runCli(['doctor', '--native-dir', native], { home: ws });
  assert.match(r.stdout, /ok {4}workspace/);
  assert.match(r.stdout, /ok {4}host wrapper/);
  assert.match(r.stdout, /ok {4}.*native host manifest/);
  assert.match(r.stdout, /FAIL {2}helper isn't running/);

  // Break the manifest's origin and the wrapper's node path.
  const mf = path.join(native, 'com.webmods.helper.json');
  const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
  m.allowed_origins = ['chrome-extension://someotherid/'];
  fs.writeFileSync(mf, JSON.stringify(m));
  const wrapper = path.join(ws, 'bin', 'trif-host');
  const orig = fs.readFileSync(wrapper, 'utf8');
  fs.writeFileSync(wrapper, orig.replace(/exec "[^"]+"/, 'exec "/nonexistent/node"'));
  r = await runCli(['doctor', '--native-dir', native], { home: ws });
  assert.match(r.stdout, /FAIL {2}.*allowed_origins doesn't include chrome-extension:\/\/iaablflfafmonebdomeikadolkgdbkhe\//);
  assert.match(r.stdout, /FAIL {2}host wrapper points at node \/nonexistent\/node/);
  fs.writeFileSync(wrapper, orig);
  await runCli(['setup', '--verbose', '--native-dir', native, '--no-link'], { home: ws });

  // With a live helper whose extension has user scripts off.
  const ext = new FakeExtension({ home: ws });
  cleanups.push(() => ext.close());
  ext.hello({ userScripts: false });
  ext.handlers.status = () => ({ userScripts: false, chrome: '140', version: '0.1.0', mods: [], recording: [] });
  await ext.waitForSocket();
  r = await runCli(['doctor', '--native-dir', native], { home: ws });
  assert.match(r.stdout, /ok {4}helper running/);
  assert.match(r.stdout, /FAIL {2}"Allow User Scripts" is OFF/);
  assert.match(r.stdout, /fix: open chrome:\/\/extensions\/\?id=iaablflfafmonebdomeikadolkgdbkhe/);
  r = await runCli(['status'], { home: ws });
  assert.match(r.stdout, /user scripts {2}OFF/);
  await ext.close();
});

test('status: lists the sites TRIF is on for and marks mods waiting for theirs', async () => {
  const home = tempDir();
  writeMod(home, 'bank.com', 'a.js', '// ==WebMod==\n// @name A\n// ==/WebMod==\n');
  const ext = new FakeExtension({ home });
  cleanups.push(() => ext.close());
  ext.hello();
  ext.handlers.status = () => ({ userScripts: true, chrome: '140', version: '0.1.0', recording: [], sitesOn: ['x.com'],
    mods: [{ id: 'bank.com/a', registered: false, enabled: true, sitesOff: true }] });
  await ext.waitForSocket();
  await ext.nextMods((mods) => mods.length === 1);
  const r = await runCli(['status'], { home });
  assert.match(r.stdout, /bank\.com\/a\s+waiting: TRIF is off on its site\n/);
  assert.match(r.stdout, /waiting = not running until the user turns TRIF on for the site/);
  assert.match(r.stdout, /^sites on {6}x\.com; TRIF is off everywhere else/m);
});

test('inside a side-panel run, -f/-o/check paths are compared as the file system does: case, links, ..', async () => {
  const home = tempDir();
  const box = path.join(home, 'boxes', 'r1');
  const shots = path.join(privDir(home), 'screenshots', 'example.com');
  fs.mkdirSync(box, { recursive: true });
  fs.mkdirSync(shots, { recursive: true });
  writeMod(home, 'example.com', 'ok.js', '1 + 1');
  fs.writeFileSync(path.join(home, 'notes.js'), '"outside the mods folder"');
  fs.symlinkSync(path.join(home, 'notes.js'), path.join(home, 'sites', 'example.com', 'link.js'));
  const env = { TRIF_RUN_BOX: box, TRIF_RUN_TOKEN: 'x', TRIF_RUN_SCREENSHOTS: shots };
  const refused = /inside a side-panel agent run, files are (read|written) only in /;
  const upper = (p) => p.replace(/\/sites\//, '/SITES/');
  const caseInsensitive = fs.existsSync(upper(path.join(home, 'sites', 'example.com', 'ok.js')));
  // Outside the mods folder, however it's spelled: refused.
  for (const f of [path.join(home, 'notes.js'), path.join(home, 'NOTES.js'), path.join(home, 'sites', 'example.com', 'link.js'),
    `${path.join(home, 'sites', 'example.com')}/../../notes.js`, path.join(home.toUpperCase(), 'NOTES.JS'), path.join(home, 'sites-other', 'x.js')]) {
    const r = await runCli(['check', f], { home, env });
    assert.equal(r.code, 1, f);
    assert.match(r.stderr, refused, f);
  }
  // Inside it in another case (macOS): the same folder, so allowed.
  if (caseInsensitive) {
    const r = await runCli(['check', upper(path.join(home, 'sites', 'example.com', 'ok.js'))], { home, env });
    assert.equal(r.code, 0, r.stderr);
  }
  // Writes (-o; checked before the file is written): a mixed-case path outside, a path climbing out, a
  // link to a folder outside: refused. The run's screenshots folder in another case: fine.
  fs.mkdirSync(path.join(home, 'elsewhere'));
  fs.symlinkSync(path.join(home, 'elsewhere'), path.join(home, 'sites', 'example.com', 'out'));
  const { optionPath } = require('../helper/cli');
  const P = require('../helper/lib/paths');
  const saved = { ...process.env };
  Object.assign(process.env, env, { TRIF_HOME: home });
  try {
    const ctx = { ws: P.workspace(home) };
    for (const o of [path.join(home.toUpperCase(), 'OUT.png'), `${path.join(home, 'sites', 'example.com')}/../../out.png`, path.join(home, 'sites', 'example.com', 'out', 'x.png')]) {
      assert.throws(() => optionPath(ctx, o, { write: true }), refused, o);
    }
    assert.equal(optionPath(ctx, path.join(home, 'sites', 'example.com', 'new.txt'), { write: true }), path.join(home, 'sites', 'example.com', 'new.txt'));
    if (caseInsensitive) assert.equal(optionPath(ctx, path.join(shots.toUpperCase(), 'a.png'), { write: true }), path.join(shots, 'a.png'));
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test('site and mod names: no colon, trailing dot or space, reserved name', async () => {
  const home = tempDir();
  for (const [site, mod] of [['x.com:evil', 'a'], ['x.com.', 'a'], ['x.com', 'a.'], ['con', 'a'], ['x.com', 'nul'], ['x.com', 'a:b']]) {
    const r = await runCli(['new', site, mod], { home });
    assert.equal(r.code, 1, `${site} ${mod}: ${r.stdout}`);
  }
  const ok = await runCli(['new', 'X.COM', 'hide-it'], { home });
  assert.equal(ok.code, 0, ok.stderr);
  assert.ok(fs.existsSync(path.join(home, 'sites', 'x.com', 'hide-it.js')), 'site names are lowercased');
  const pc = require('../helper/lib/pathcheck');
  for (const n of ['a:b', 'a.', 'a ', ' a', 'CON', 'lpt1.txt', '..', '.', 'a/b', 'a\\b', '']) assert.ok(pc.badName(n), JSON.stringify(n));
  for (const n of ['x.com', 'all-sites', 'hide-sidebar', 'a.b-c_d']) assert.equal(pc.badName(n), '', n);
});

test('inside a side-panel run, the CLI reads -f and check files only from the mods folder', async () => {
  const home = tempDir();
  const box = path.join(home, 'boxes', 'r1');
  fs.mkdirSync(box, { recursive: true });
  writeMod(home, 'example.com', 'ok.js', '1 + 1');
  const secret = path.join(home, 'config.json');
  fs.writeFileSync(secret, '{\n  "anthropicApiKey": "sk-secret"\n}\n');
  const env = { TRIF_RUN_BOX: box, TRIF_RUN_TOKEN: 'x' };
  let r = await runCli(['run', '-f', secret], { home, env });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /inside a side-panel agent run, files are read only in /);
  assert.doesNotMatch(r.stdout + r.stderr, /sk-secret/);
  r = await runCli(['check', secret], { home, env });
  assert.equal(r.code, 1);
  assert.doesNotMatch(r.stdout + r.stderr, /sk-secret/);
  r = await runCli(['check', 'example.com/ok'], { home, env });
  assert.equal(r.code, 0, r.stderr);
  // The user's own terminal: no limit.
  r = await runCli(['check', secret], { home });
  assert.match(r.stdout + r.stderr, /anthropicApiKey/);
});

test('doctor: an unreadable Safari login item doesn\'t crash it; inside a run it skips the browsers\' setup files', async () => {
  const home = tempDir();
  const agentsDir = path.join(home, 'fakehome', 'Library', 'LaunchAgents');
  fs.mkdirSync(agentsDir, { recursive: true });
  const plist = path.join(agentsDir, 'dev.webmods.safari-bridge.plist');
  fs.writeFileSync(plist, '<plist/>');
  fs.chmodSync(plist, 0o000); // as a run's sandbox sees it: there, but not readable
  try {
    let r = await runCli(['doctor'], { home });
    assert.doesNotMatch(r.stderr, /EACCES|EPERM|TypeError/);
    assert.match(r.stdout, /Safari: the bridge's login item .* runs nothing/);
    const box = path.join(home, 'boxes', 'r1');
    fs.mkdirSync(box, { recursive: true });
    r = await runCli(['doctor'], { home, env: { TRIF_RUN_BOX: box, TRIF_RUN_TOKEN: 'x' } });
    assert.doesNotMatch(r.stderr, /EACCES|EPERM|TypeError/);
    assert.match(r.stdout, /inside a side-panel agent run: the browsers' setup files aren't checked/);
    assert.doesNotMatch(r.stdout, /Safari:|native host manifest|Claude Code|Codex/);
  } finally {
    fs.chmodSync(plist, 0o600);
  }
});

test('doctor: the ~/.webmods link is checked in a terminal, not inside a run (its sandbox hides ~)', async () => {
  const root = tempDir();
  const fakehome = path.join(root, 'fakehome');
  const trif = path.join(fakehome, '.trif');
  fs.mkdirSync(path.join(trif, 'sites'), { recursive: true });
  fs.writeFileSync(path.join(trif, require('../helper/lib/migrate').MARKER), `${path.join(fakehome, '.webmods')}\n`);
  // No ~/.webmods: in a terminal that's a warning (a browser may still load TRIF from there).
  const env = { HOME: fakehome, TRIF_HOME: trif };
  let r = await runCli(['doctor'], { home: root, env });
  assert.match(r.stdout, /\.webmods is gone, but this workspace was moved from there/);
  assert.match(r.stdout, /ln -s \.trif/);
  // Inside a run the link can't be seen (the sandbox denies the home folder): not checked, no warning.
  const box = path.join(root, 'boxes', 'r1');
  fs.mkdirSync(box, { recursive: true });
  r = await runCli(['doctor'], { home: root, env: { ...env, TRIF_RUN_BOX: box, TRIF_RUN_TOKEN: 'x' } });
  assert.doesNotMatch(r.stdout, /is gone|ln -s/);
  assert.match(r.stdout, /inside a side-panel agent run: the link .*\.webmods -> .*\.trif isn't checked/);
});

test('doctor: the last line says so when there were warnings', () => {
  const { formatDoctor } = require('../helper/lib/doctor');
  const ok = { status: 'ok', title: 'fine' };
  const warn = { status: 'warn', title: 'hmm', fix: 'do this' };
  const fail = { status: 'fail', title: 'broken', fix: 'do that' };
  assert.match(formatDoctor({ ok: true, checks: [ok] }), /\nAll good\.$/);
  assert.match(formatDoctor({ ok: true, checks: [ok, warn] }), /\nNo problems, but 1 warning above\.$/);
  assert.doesNotMatch(formatDoctor({ ok: true, checks: [ok, warn, warn] }), /All good/);
  assert.match(formatDoctor({ ok: true, checks: [ok, warn, warn] }), /2 warnings above\.$/);
  assert.match(formatDoctor({ ok: false, checks: [warn, fail] }), /1 problem found/);
});

test('a mailbox request works where watching a folder fails (as in an agent run\'s sandbox)', async () => {
  const { EventEmitter } = require('events');
  const box = fs.mkdtempSync(path.join(tempDir(), 'box-'));
  const realWatch = fs.watch;
  // macOS sandboxes block the folder-watching service: the watch fails a moment later, as an 'error' event.
  fs.watch = () => { const w = new EventEmitter(); w.close = () => {}; setImmediate(() => w.emit('error', Object.assign(new Error('EMFILE: too many open files, watch'), { code: 'EMFILE' }))); return w; };
  const helper = setInterval(() => { // stands in for the helper's side (runs.js _serveBox)
    for (const name of fs.readdirSync(box)) {
      if (!name.endsWith('.req')) continue;
      const req = JSON.parse(fs.readFileSync(path.join(box, name), 'utf8'));
      fs.unlinkSync(path.join(box, name));
      fs.writeFileSync(path.join(box, name.replace(/\.req$/, '.res')), JSON.stringify({ id: req.id, ok: true, result: { pong: req.cmd } }));
    }
  }, 10);
  const saved = process.env.TRIF_RUN_BOX;
  process.env.TRIF_RUN_BOX = box;
  try {
    const { request } = require('../helper/lib/client');
    assert.deepEqual(await request('/nonexistent.sock', 'ping', {}, 5000), { pong: 'ping' });
  } finally {
    fs.watch = realWatch;
    clearInterval(helper);
    if (saved === undefined) delete process.env.TRIF_RUN_BOX; else process.env.TRIF_RUN_BOX = saved;
  }
});
