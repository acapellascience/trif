#!/usr/bin/env node
'use strict';
// How much memory a browser uses with big mods (opt-in measurement; not part of `npm test` or the e2e suite).
//
//   node tests/e2e/measure-big-mods.js firefox|chrome --work <dir> [--sizes 1,2,4] [--mod-mb 1] [--kind data|code]
//        [--changes 1] [--over] [--reports] [--minimize] [--limit-mb 2048] [--tgz <package.tgz>]
//
// Installs this checkout into a scratch home (as the e2e suite does), starts a throwaway headless browser,
// turns TRIF on for the test site, then for each size in --sizes (MB of mods in all, at most the 16 MB cap)
// writes that much in mods of --mod-mb each (data: a base64 string, like a mod with its sounds in it; code:
// plain functions) and measures the browser's memory (the footprint of all its processes, as Activity
// Monitor and macOS's out-of-memory killer count it; the helper not counted): once the mods are registered,
// after loading the test page with them twice, after a change to one mod and --changes more in a row, and
// after removing them. --over: then mods over the caps, which the helper must refuse. --reports: Firefox's
// about:memory figures for its parent process. --minimize: then collect garbage everywhere and measure again
// (what's left is what's really held). --tgz: measure another build (the Chrome extension comes from it).
// docs/PROTOCOL.md "How big mods can be" has the numbers this gave.
//
// Safety: the browser is killed, and the run stops, the moment all its processes together pass --limit-mb
// (default 2048). Run it under a memory guard too, one browser at a time, with a --work folder of its own.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { sleep, waitFor, run, killMatching } = require('./lib/util');
const { Results } = require('./lib/util');
const { startServers } = require('./lib/server');
const I = require('./lib/install');
const { Scenario } = require('./scenario');

const MAX_TOTAL_MB = 16; // TRIF's cap for all mods together (helper/lib/mods.js MAX_MODS_BYTES)

function parseArgs(argv) {
  const o = { browser: null, sizes: [1], modMb: 1, kind: 'data', limitMb: 2048, changes: 1 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); return argv[++i]; };
    if (a === 'firefox' || a === 'chrome') o.browser = a;
    else if (a === '--work') o.work = path.resolve(val());
    else if (a === '--sizes') o.sizes = val().split(',').map(Number);
    else if (a === '--mod-mb') o.modMb = Number(val());
    else if (a === '--kind') o.kind = val();
    else if (a === '--limit-mb') o.limitMb = Number(val());
    else if (a === '--tgz') o.tgz = path.resolve(val());
    else if (a === '--reports') o.reports = true;
    else if (a === '--minimize') o.minimize = true;
    else if (a === '--changes') o.changes = Number(val());
    else if (a === '--over') o.over = true;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!o.browser) throw new Error('say firefox or chrome');
  if (!o.work) throw new Error('--work <dir> is required (a short path, not under /tmp)');
  if (o.sizes.some((s) => !(s > 0) || s > MAX_TOTAL_MB)) throw new Error(`sizes must be between 0 and ${MAX_TOTAL_MB} MB`);
  if (!['data', 'code'].includes(o.kind)) throw new Error('--kind is data or code');
  return o;
}

// ---- memory

// Memory is each process's footprint (what Activity Monitor's Memory column and macOS's out-of-memory killer
// count), from `top`; resident sizes (ps) would count the browser's shared libraries once per process.
function topMem() {
  return new Promise((resolve) => {
    execFile('/usr/bin/top', ['-l', '1', '-s', '0', '-stats', 'pid,mem'], { maxBuffer: 16 << 20 }, (err, stdout) => {
      const mem = new Map();
      const unit = { K: 1, M: 1024, G: 1024 * 1024, B: 1 / 1024 };
      for (const l of String(stdout || '').split('\n')) {
        const m = /^\s*(\d+)\s+([\d.]+)([KMGB])[+-]?\s*$/.exec(l);
        if (m) mem.set(Number(m[1]), Number(m[2]) * unit[m[3]]);
      }
      resolve(mem);
    });
  });
}

/** Every process descended from `root` (the browser), the helper (node) left out. */
function tree(root) {
  const r = run('/bin/ps', ['-axo', 'pid=,ppid=,rss=,command=']);
  const procs = r.stdout.split('\n').map((l) => /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(l)).filter(Boolean)
    .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), rss: Number(m[3]), command: m[4] }));
  const kids = new Map();
  for (const p of procs) { if (!kids.has(p.ppid)) kids.set(p.ppid, []); kids.get(p.ppid).push(p); }
  const out = [];
  const walk = (pid) => { for (const k of kids.get(pid) || []) { out.push(k); walk(k.pid); } };
  const self = procs.find((p) => p.pid === root);
  if (self) out.push(self);
  walk(root);
  return out.filter((p) => !/\bnode\b|host\.js|trif-host/.test(p.command));
}

function kind(command) {
  const t = /--type=([\w-]+)/.exec(command);
  if (t) return /--extension-process/.test(command) ? 'extension' : t[1];
  if (/plugin-container/.test(command)) return `child ${command.split(' ').pop()}`;
  return 'browser';
}

/** Samples the browser's memory every second; kills it (and says so) past the limit. */
class Sampler {
  constructor(root, limitMb) {
    this.root = root;
    this.limitKb = limitMb * 1024;
    this.peakKb = 0;
    this.peakProcs = [];
    this.killed = null;
    this.busy = false;
    this.timer = setInterval(() => { if (!this.busy) this.sample().catch(() => {}); }, 1000);
  }

  async sample() {
    this.busy = true;
    try {
      const mem = await topMem();
      const procs = tree(this.root).map((p) => ({ ...p, mem: mem.get(p.pid) ?? p.rss }));
      const kb = procs.reduce((n, p) => n + p.mem, 0);
      if (kb > this.peakKb) { this.peakKb = kb; this.peakProcs = procs; }
      if (kb > this.limitKb && !this.killed) {
        this.killed = `the browser's processes reached ${Math.round(kb / 1024)} MB together (limit ${this.limitKb / 1024} MB); killed it`;
        console.error(`measure: ${this.killed}`);
        for (const p of procs) { try { process.kill(p.pid, 'SIGKILL'); } catch { /* gone */ } }
      }
      return { kb, procs };
    } finally {
      this.busy = false;
    }
  }

  /** Starts a new peak (for the next step). */
  resetPeak() { this.peakKb = 0; this.peakProcs = []; }

  stop() { clearInterval(this.timer); }
}

const mb = (kb) => Math.round(kb / 1024);

function byKind(procs) {
  const m = {};
  for (const p of procs) { const k = kind(p.command); m[k] = (m[k] || 0) + p.mem; }
  return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${mb(v)}`).join(', ');
}


// ---- what the browser says it's using

/** Firefox's parent process memory reports (about:memory's), the biggest "explicit" ones, summed to 5 levels. */
async function firefoxReports(d, proc = '^Main Process') {
  return d.chrome(`async (want) => {
    const mgr = Cc['@mozilla.org/memory-reporter-manager;1'].getService(Ci.nsIMemoryReporterManager);
    const sums = new Map();
    let explicit = 0;
    await new Promise((resolve) => mgr.getReports((proc, path, kind, units, amount) => {
      // (The parent's reports name no process, or "Main Process (pid N)"; the add-ons' is "WebExtensions (pid N)".)
      if (!new RegExp(want).test(proc || 'Main Process')) return;
      if (units !== Ci.nsIMemoryReporter.UNITS_BYTES || !path.startsWith('explicit/')) return;
      explicit += amount;
      const key = path.split('/').slice(0, 5).join('/').replace(/0x[0-9a-f]+/g, '…').slice(0, 140);
      sums.set(key, (sums.get(key) || 0) + amount);
    }, null, resolve, null, false));
    const top = [...sums].sort((a, b) => b[1] - a[1]).slice(0, 14);
    return ['    explicit ' + Math.round(explicit / 1048576) + ' MB', ...top.map(([k, v]) => '    ' + Math.round(v / 1048576) + ' MB  ' + k)].join('\\n');
  }`, [proc]).catch((e) => `    (${e.message})`);
}

/** Collects garbage everywhere (about:memory's "Minimize memory usage"; in Chrome, the pages' and workers' GC). */
async function minimize(d) {
  if (d.name === 'Firefox') {
    await d.chrome(`async () => new Promise((resolve) => Cc['@mozilla.org/memory-reporter-manager;1'].getService(Ci.nsIMemoryReporterManager).minimizeMemoryUsage(resolve))`).catch(() => {});
  } else {
    for (const t of await d.targets()) {
      if (!['page', 'service_worker'].includes(t.type)) continue;
      try { const sid = await d._attach(t.targetId); await d.cdp.send('HeapProfiler.collectGarbage', {}, sid, 20000); } catch { /* not that one */ }
    }
  }
}

// ---- mods

/** A mod of `bytes` bytes: a base64 string ('data') or functions ('code'), marking the page with its tag. */
function bigMod(name, tag, bytes, how) {
  const head = `// ==WebMod==\n// @name ${name}\n// @match *://127.0.0.1/*\n// ==/WebMod==\n`;
  const mark = `(document.documentElement.dataset.trifBig = (document.documentElement.dataset.trifBig || '') + ${JSON.stringify(`${name}:${tag};`)});\n`;
  const room = Math.max(0, bytes - head.length - mark.length - 64);
  if (how === 'data') {
    const d = crypto.randomBytes(Math.floor(room * 3 / 4)).toString('base64');
    return `${head}const d = "${d}";\nif (d.length < 1) throw new Error('empty');\n${mark}`;
  }
  const fns = [];
  for (let i = 0, n = 0; n < room - 40; i++) {
    const f = `function f${i}(a) { const x = a * ${i} + ${i % 13}; return x % 7 === 3 ? String(x) + "${crypto.randomBytes(12).toString('hex')}" : x; }\n`;
    fns.push(f);
    n += f.length;
  }
  return `${head}${fns.join('')}f0(1);\n${mark}`;
}

// ---- the run

async function main() {
  const o = parseArgs(process.argv.slice(2));
  fs.mkdirSync(o.work, { recursive: true });
  const results = new Results(path.join(o.work, 'results'));
  let tgz = o.tgz;
  if (!tgz) tgz = I.packRepo(path.join(o.work, 'pack'));
  const fxDir = path.join(I.REPO, 'dist', 'firefox');
  if (o.browser === 'firefox') {
    const r = run(process.execPath, [path.join(I.REPO, 'scripts', 'build-extension.js'), 'firefox'], { cwd: I.REPO });
    if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  }
  const servers = await startServers(path.join(o.work, 'certs'));
  const work = path.join(o.work, o.browser === 'firefox' ? 'ff' : 'cr');
  const sc = new Scenario({ browser: o.browser, kind: 'fresh', newTgz: tgz, results, servers, work, headless: true, extensionDirFirefox: fxDir });
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(sc.home, { recursive: true });
  let sampler;
  const rows = [];
  try {
    await sc.install();
    await sc.startBrowser();
    const d = sc.d;
    sampler = new Sampler(d.proc.pid, o.limitMb);
    const alive = () => { if (sampler.killed) throw new Error(sampler.killed); };
    sc.control = await d.openTab(`${d.origin}/onboarding.html`);
    await d.grantUserScripts(sc.control);
    await waitFor('user scripts on', async () => (await sc.cli(['status'], { json: true })).json?.extension?.userScripts, { timeoutMs: 20000 });
    // TRIF on for the test site, as the panel's button does.
    await sc.ext(`async () => new Promise((resolve, reject) => {
      const p = chrome.runtime.connect({ name: 'panel' });
      p.onMessage.addListener((m) => { if (m.type === 'reply' && m.reqId === 1) { p.disconnect(); m.ok ? resolve(m.result) : reject(new Error(m.error)); } });
      p.postMessage({ type: 'site.set', site: '127.0.0.1', on: true, reqId: 1 });
    })`);
    const base = `http://127.0.0.1:${servers.port}`;
    sc.pageUrlPrefix = base;
    sc.pageCtx = await d.openTab(`${base}/?e2e=1`);
    await sc.waitPage('the banner mod on the test page', (s) => s.banner === 'ran', 30000);

    const log = path.join(sc.priv, 'helper.log');
    const logSize = () => fs.statSync(log).size;
    const logSince = (at) => fs.readFileSync(log).subarray(at).toString('utf8');
    const settle = async (ms = 4000) => { await sleep(ms); alive(); return (await sampler.sample()).kb; };
    const delivered = async (what, write, pred) => {
      const at = logSize();
      const t0 = Date.now();
      write();
      const text = await waitFor(`the helper to send ${what} and the extension to apply it`, () => {
        alive();
        const t = logSince(at);
        const sent = /sent (\d+) mod\(s\) to the extension[^\n]*?, (\d+) KB(?: in (\d+) parts)?/.exec(t);
        return sent && pred(sent) && /extension registered \d+ mod\(s\)/.test(t.slice(sent.index)) ? t : null;
      }, { timeoutMs: 120000, intervalMs: 100 });
      const sent = /sent (\d+) mod\(s\) to the extension[^\n]*?, (\d+) KB(?: in (\d+) parts)?/.exec(text);
      return { ms: Date.now() - t0, kb: Number(sent[2]), parts: Number(sent[3] || 0) };
    };
    const load = async (want) => {
      const t0 = Date.now();
      await d.navigate(sc.pageCtx, `${base}/?e2e=${Date.now()}`).catch(() => {});
      let last = null;
      await waitFor('the test page with the big mods', async () => {
        alive();
        const s = await sc.page(`async () => ({ big: document.documentElement.dataset.trifBig || '', ready: document.readyState, url: location.href })`).catch((e) => ({ error: e.message }));
        last = s;
        return s && s.ready === 'complete' && want(s.big) ? s : null;
      }, { timeoutMs: 120000 }).catch((e) => { throw new Error(`${e.message}; the page: ${JSON.stringify(last).slice(0, 300)}`); });
      return Date.now() - t0;
    };

    const dir = path.join(sc.trif, 'sites', '127.0.0.1');
    const baseline = await settle(6000);
    console.log(`${d.name} ${d.version}, ${o.kind} mods of ${o.modMb} MB; baseline ${mb(baseline)} MB (${byKind(sampler.peakProcs)})`);
    for (const size of o.sizes) {
      const n = Math.ceil(size / o.modMb);
      // (The cap counts the shipped mods too, about 350 KB: at the cap, the big ones leave room for them.)
      const room = Math.min(size * 1024 * 1024, MAX_TOTAL_MB * 1024 * 1024 - 512 * 1024);
      const each = Math.floor(room / n);
      const files = Array.from({ length: n }, (_, i) => path.join(dir, `big-${i}.js`));
      const names = files.map((_, i) => `big${i}`);
      const all = (tag0, tag) => (big) => names.every((nm, i) => big.includes(`${nm}:${i === 0 ? tag0 : tag};`));
      const row = { size, n };
      const before = await settle(2000);
      sampler.resetPeak();
      const sent = await delivered(`${size} MB of mods`, () => files.forEach((f, i) => fs.writeFileSync(f, bigMod(names[i], 'v1', each, o.kind))), (m) => Number(m[1]) >= n);
      row.sendMs = sent.ms; row.parts = sent.parts;
      row.registered = await settle();
      row.loadMs = await load(all('v1', 'v1'));
      row.page = await settle();
      row.load2Ms = await load(all('v1', 'v1'));
      row.page2 = await settle();
      const ch = await delivered('a change to one mod', () => fs.writeFileSync(files[0], bigMod(names[0], 'v2', each, o.kind)), () => true);
      row.changeMs = ch.ms;
      await load(all('v2', 'v1'));
      row.changed = await settle();
      // More changes, one after another (an agent editing a mod): the memory should level off, not climb.
      row.more = [];
      for (let k = 2; k <= o.changes; k++) {
        await delivered(`change ${k}`, () => fs.writeFileSync(files[(k - 1) % n], bigMod(names[(k - 1) % n], `v${k}`, each, o.kind)), () => true);
        row.more.push(await settle(1500));
      }
      if (row.more.length) console.log(`  after each of ${row.more.length} more changes: ${row.more.map(mb).join(', ')} MB`);
      row.peak = sampler.peakKb;
      row.peakKinds = byKind(sampler.peakProcs);
      await delivered('the set without them', () => files.forEach((f) => fs.rmSync(f)), () => true);
      await load((big) => big === '');
      row.removed = await settle();
      row.before = before;
      rows.push(row);
      const x = (kb) => `${mb(kb)} MB (+${mb(kb - before)}, ${((kb - before) / 1024 / size).toFixed(1)}x)`;
      console.log(`${size} MB in ${n} mod(s), ${row.parts} parts: before ${mb(before)} MB; registered ${x(row.registered)} in ${row.sendMs} ms; ` +
        `page ${x(row.page)} (load ${row.loadMs} ms); again ${x(row.page2)} (${row.load2Ms} ms); changed ${x(row.changed)} (${row.changeMs} ms); ` +
        `peak ${x(row.peak)}; removed ${mb(row.removed)} MB`);
      console.log(`  at the peak: ${row.peakKinds}`);
      if (d.name === 'Firefox') {
        const info = await d.chrome(`async () => { const i = await ChromeUtils.requestProcInfo(); return [{ type: 'parent', memory: i.memory }, ...i.children.map((c) => ({ type: c.type, memory: c.memory, origin: c.origin }))]; }`).catch((e) => `(${e.message})`);
        if (Array.isArray(info)) console.log(`  Firefox's own figures now: ${info.map((p) => `${p.type}${p.origin ? ` ${p.origin.slice(0, 40)}` : ''} ${Math.round(p.memory / 1048576)}`).join(', ')}`);
        if (o.reports) console.log(`  the parent process's biggest memory reports (about:memory):\n${await firefoxReports(d)}`);
        if (o.reports) console.log(`  the add-ons' process:\n${await firefoxReports(d, '^WebExtensions')}`);
      }
      if (o.minimize) {
        await minimize(d);
        const after = await settle(3000);
        console.log(`  after minimizing memory (GC and CC everywhere): ${mb(after)} MB (+${mb(after - before)})`);
        if (d.name === 'Firefox' && o.reports) console.log(`  the parent's reports after that:\n${await firefoxReports(d)}`);
      }
    }
    if (o.over) {
      // Over the caps: a 4.1 MB mod isn't sent; five mods of 3.9 MB (19.5 MB) are over 16 MB together, so the
      // largest isn't sent either. The browser gets at most 16 MB; the helper says why in its log,
      // `trif status` and `trif doctor`.
      const files = [path.join(dir, 'over.js'), ...[0, 1, 2, 3, 4].map((i) => path.join(dir, `near-${i}.js`))];
      const before = await settle(2000);
      sampler.resetPeak();
      const sent = await delivered('mods over the caps', () => {
        fs.writeFileSync(files[0], bigMod('over', 'v1', Math.ceil(4.1 * 1024 * 1024), o.kind));
        files.slice(1).forEach((f, i) => fs.writeFileSync(f, bigMod(`near${i}`, 'v1', Math.floor(3.9 * 1024 * 1024) - i * 1024, o.kind)));
      }, (m) => /near/.test(fs.readFileSync(log, 'utf8').slice(-4000)) && Number(m[1]) > 17);
      const errs = (await sc.cli(['status'], { json: true })).json?.helper?.modErrors || [];
      await load((big) => [1, 2, 3, 4].every((i) => big.includes(`near${i}:v1;`)));
      const after = await settle();
      const doc = (await sc.cli(['doctor'], { json: true, timeoutMs: 60000 })).json;
      const fails = (doc?.checks || []).filter((c) => c.status === 'fail' && /over|near/.test(c.title));
      console.log(`over the caps: sent ${sent.kb} KB in ${sent.parts} parts; not sent: ${errs.map((e) => `${e.id} (${e.limit}): ${e.error}`).join('; ')}`);
      console.log(`  trif doctor: ${fails.map((c) => `${c.title} -> ${c.fix}`).join('; ')}`);
      console.log(`  memory with the 4 that were sent: ${mb(after)} MB (+${mb(after - before)}), peak ${mb(sampler.peakKb)} MB (${byKind(sampler.peakProcs)})`);
      files.forEach((f) => fs.rmSync(f, { force: true }));
    }
  } finally {
    if (sampler) sampler.stop();
    if (sc.d) await sc.d.stop().catch(() => {});
    await killMatching(work + '/');
    await servers.close().catch(() => {});
  }
  fs.writeFileSync(path.join(o.work, `measure-${o.browser}.json`), JSON.stringify(rows, null, 2));
}

main().then(() => { process.exitCode = 0; }, (e) => { console.error(e.stack || e.message); process.exitCode = 1; });
