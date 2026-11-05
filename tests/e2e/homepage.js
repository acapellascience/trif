#!/usr/bin/env node
'use strict';
// TRIF's own home page with the real extension (opt-in; not part of `npm test`). See docs/TESTING.md.
//
//   node tests/e2e/homepage.js [--work <short dir>] [--out <dir>] [--headful]
//
// The home page (site/, with its demo) is served over HTTPS as timsrobot.com from this checkout; TRIF from
// this checkout is installed into a scratch home (setup --copy), and Chrome for Testing runs headless in a
// throwaway profile, as the e2e suite does (tests/e2e/lib). It checks that the demo works, and that with
// the real TRIF installed the home page is like any other website:
//  - TRIF off for timsrobot.com: nothing marks the page; the demo's tab is outside <body> (top layer); each
//    demo mod works alone and all together, and gravity, the shooter and the rave leave the tab
//    alone; Escape on the page is the page's (Gravity's), not the panel's;
//  - then TRIF turned on for the site in the real side panel (Fix): still nothing marks the page, and the
//    demo and its mods work as before;
//  - a mod of the visitor's own for timsrobot.com runs, alongside the demo; nothing marks this page or any
//    other; with the robot off again it stops, and the demo is still there.
// Nothing in your real browsers, profiles or ~/.trif is touched (scratch home, HOME pointed at it).

const fs = require('fs');
const path = require('path');
const https = require('https');
const { pathToFileURL } = require('url');
const { ChromeDriver } = require('./lib/chrome');
const I = require('./lib/install');
const { run, waitFor, sleep, killMatching } = require('./lib/util');

const REPO = I.REPO;
const SITE = 'timsrobot.com';
let ORDER = []; // the demo's mods, in its order (site/build-demo.js DEMO_ORDER)

// What each home page mod leaves in the page (a count: 1 when it runs once).
const PROBES = {
  'tagline': '.hero .tagline[data-tt-done]',
  'jelly': 'style:@keyframes jb-jelly',
  'gravity': 'style:html[data-gm-on] { overflow: hidden !important; }',
  fireworks: 'canvas[data-fw-canvas]',
  'neon': 'main h1:is(.nt-lit, :has(.nt-word, .nt-ch))',
  'shooter': '#tss-canvas',
  'stickers': '.sb-row',
  'checklist': 'ul:has(> li .nc-box)',
  'terminal': '[data-tb]',
  'rave': '#rave-glow',
  'led': '.led-sign',
  'robot': 'svg.robot[data-lr]',
};

function parseArgs(argv) {
  const o = { work: `/tmp/trif-home-${process.getuid()}`, out: null, headless: true };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--work') o.work = path.resolve(argv[++i]);
    else if (argv[i] === '--out') o.out = path.resolve(argv[++i]);
    else if (argv[i] === '--headful') o.headless = false;
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  o.out = o.out || path.join(o.work, 'results');
  return o;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const home = path.join(o.work, 'h');
  const trif = path.join(home, '.trif');
  const priv = path.join(home, 'Library', 'Application Support', 'TRIF');
  const results = [];
  let failed = 0;
  const check = async (name, fn) => {
    const t = Date.now();
    try {
      const detail = await fn();
      results.push(`PASS ${name}${detail ? ` — ${detail}` : ''} (${((Date.now() - t) / 1000).toFixed(1)} s)`);
    } catch (e) {
      failed++;
      results.push(`FAIL ${name} — ${String(e && e.stack || e).split('\n').slice(0, 3).join(' / ')}`);
    }
    console.log(results.at(-1));
  };

  await killMatching(o.work + '/');
  fs.rmSync(path.join(o.work, 'h'), { recursive: true, force: true });
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(o.out, { recursive: true });
  let shotN = 0;
  const shots = [];

  // TRIF from this checkout, in the scratch home.
  const setup = run(process.execPath, [path.join(REPO, 'helper', 'cli.js'), 'setup', '--copy', '--no-link', '--browser', 'chrome'], { env: I.scratchEnv(home), cwd: home, timeoutMs: 180000 });
  if (setup.status !== 0) throw new Error(`setup failed: ${setup.stdout}${setup.stderr}`);
  const cfgFile = path.join(priv, 'config.json');
  fs.writeFileSync(cfgFile, JSON.stringify({ ...(I.readJson(cfgFile) || {}), checkForUpdates: false }, null, 2));
  const env = { HOME: home, TRIF_KEYCHAIN_BIN: path.join(o.work, 'no-keychain', 'security') };

  // The site (its Worker, as site/dev.js runs it) over HTTPS, as timsrobot.com.
  const certDir = path.join(o.work, 'certs');
  fs.mkdirSync(certDir, { recursive: true });
  const key = path.join(certDir, 'home-key.pem');
  const cert = path.join(certDir, 'home-cert.pem');
  if (!fs.existsSync(cert)) {
    const r = run('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '7', '-subj', `/CN=${SITE}`, '-addext', `subjectAltName=DNS:${SITE},DNS:*.${SITE}`]);
    if (r.status !== 0) throw new Error(`openssl: ${r.stderr}`);
  }
  await import(pathToFileURL(path.join(REPO, 'site', 'build-demo.js')).href).then((m) => { m.writeDemoModule(); ORDER = m.DEMO_ORDER; });
  const { default: worker } = await import(pathToFileURL(path.join(REPO, 'site', 'src', 'index.js')).href);
  const { localAssets } = await import(pathToFileURL(path.join(REPO, 'site', 'local-assets.js')).href);
  const siteEnv = { REPORT_TO: 'x@example.com', REPORT_FROM: 'r@example.com', EMAIL: { async send() { return {}; } }, EXTENSION: localAssets(path.join(REPO, 'extension')) };
  const server = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, async (req, res) => {
    try {
      const response = await worker.fetch(new Request(`https://${SITE}${req.url}`, { method: req.method, headers: req.headers }), siteEnv);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (e) { res.writeHead(500); res.end(String(e)); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `https://${SITE}:${server.address().port}`;
  // And another site, which must never be marked.
  const other = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, (req, res) => { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><title>other</title><p>other site'); });
  await new Promise((r) => other.listen(0, '127.0.0.1', r));

  const d = new ChromeDriver({ userDataDir: path.join(home, 'Library/Application Support/Google/Chrome'), home, env, extensionDir: path.join(trif, 'app', 'extension'), headless: o.headless, hosts: [SITE, `*.${SITE}`] });
  try {
    await d.start();
    await d.installExtension();
    const control = await d.openTab(`${d.origin}/onboarding.html`);
    await sleep(1500);
    await d.grantUserScripts(control);
    const ext = (fn, args = []) => d.eval(control, fn, args);
    const cli = (args) => run(path.join(trif, 'bin', 'trif'), args, { env: I.scratchEnv(home, env), cwd: home });
    await waitFor('the helper', async () => JSON.parse(cli(['status', '--json']).stdout || '{}').extension, { timeoutMs: 30000 });

    const win = await ext(`async (url) => { const w = await chrome.windows.create({ url, width: 1280, height: 860, focused: true }); return { windowId: w.id, tabId: w.tabs[0].id }; }`, [`${base}/`]);
    const pageCtx = await d.findPage((u) => u.startsWith(base));
    const sid = await d._attach(pageCtx);
    const page = (fn, args = []) => d.eval(pageCtx, fn, args);
    const load = async (q = '') => { await d.navigate(pageCtx, `${base}/${q}`); await waitFor('the page', () => page('async () => document.readyState === "complete"')); await sleep(2500); };
    const shot = async (name) => { const f = path.join(o.out, `home-${String(++shotN).padStart(2, '0')}-${name}.png`); await d.screenshot(pageCtx, f); shots.push(f); };
    const key = async (k, code, vk) => {
      await d.cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk }, sid);
      if (k.length === 1) await d.cdp.send('Input.dispatchKeyEvent', { type: 'char', text: k, key: k, code }, sid);
      await d.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk }, sid);
    };
    // What's on the page: any marker (there must be none), the demo's tab and panel, and each mod's effect.
    const state = () => page(`async (probes) => {
      const tab = document.querySelector('.demo-tab');
      const r = tab?.getBoundingClientRect();
      const count = (p) => p.startsWith('style:') ? [...document.querySelectorAll('style')].filter((s) => s.textContent.includes(p.slice(6))).length : document.querySelectorAll(p).length;
      return {
        marker: document.documentElement.getAttribute('data-trif'),
        mine: document.documentElement.dataset.e2eMine || null,
        tab: tab ? { parent: tab.parentElement.tagName, top: tab.matches(':popover-open'), shown: !tab.hidden && r.width > 0 && r.height > 0,
          label: tab.textContent.trim(), inView: r.right <= innerWidth + 1 && r.left >= innerWidth - 60, rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
          color: getComputedStyle(tab).color, bg: getComputedStyle(tab).backgroundColor, transform: getComputedStyle(tab).transform,
          hit: document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === tab } : null,
        panel: !!document.querySelector('.demo-panel') && document.documentElement.classList.contains('demo-open'),
        flag: sessionStorage.getItem('trif-demo-open'),
        mods: Object.fromEntries(Object.entries(probes).map(([k, p]) => [k, count(p)])),
        gravity: document.documentElement.hasAttribute('data-gm-on'),
        url: location.pathname + location.search,
      };
    }`, [PROBES]);
    const demoPanel = (fn, args = []) => page(`async (src, args) => { const doc = document.querySelector('.demo-panel iframe')?.contentDocument; if (!doc) throw new Error('no demo panel'); return (0, eval)('(' + src + ')')(doc, ...args); }`, [fn, args]);

    // ---- TRIF off for timsrobot.com: the demo
    let s0;
    await check('TRIF off for timsrobot.com: nothing marks the page; at a desk the demo panel starts open; closed, its tab ("Show the fixer") is outside <body>, in the top layer, on screen', async () => {
      await load();
      const first = await state();
      if (!first.panel) throw new Error('the panel didn\'t start open');
      await page(`async () => document.querySelector('.demo-close').click()`);
      await sleep(800);
      s0 = await state();
      if (s0.marker !== null) throw new Error(`marker ${s0.marker}`);
      if (s0.panel || !s0.tab || s0.tab.parent !== 'HTML' || !s0.tab.top || !s0.tab.shown || !s0.tab.inView || !s0.tab.hit || s0.tab.label !== 'Show the fixer') throw new Error(JSON.stringify(s0.tab));
      if (Object.values(s0.mods).some((n) => n)) throw new Error(`mods running: ${JSON.stringify(s0.mods)}`);
      await shot('tab');
      return `tab at ${s0.tab.rect}`;
    });

    await check('the demo panel starts with no mods, the first recorded prompt (the first mod in Tim\'s order) waiting in a box that can\'t be typed in, and Send highlighted', async () => {
      await page(`async () => { document.querySelector('.demo-tab').click(); }`);
      await sleep(2500);
      const first = require('../../site/demo/chats/tagline.json');
      // (the waiting prompt types itself in: give it a few seconds)
      await waitFor('the first prompt typed in', async () => (await demoPanel(`(doc) => doc.getElementById('input').value`)) === first.prompt, { timeoutMs: 8000 }).catch(() => {});
      const p = await demoPanel(`(doc) => ({ rows: doc.querySelectorAll('#mod-list > li').length, value: doc.getElementById('input').value, ro: doc.getElementById('input').readOnly })`);
      if (ORDER[0] !== 'tagline') throw new Error(`Tim's order starts with ${ORDER[0]}: update this check`);
      if (p.rows !== 0 || !p.ro || p.value !== (first.prompt ?? first.messages?.[0]?.text)) throw new Error(JSON.stringify(p));
      const hint = await demoPanel(`(doc) => doc.documentElement.classList.contains('demo-hint-send') && getComputedStyle(doc.getElementById('send')).animationName`);
      if (hint !== 'demo-send-pulse') throw new Error(`Send isn't highlighted: ${hint}`);
      await shot('demo-panel');
      return `waiting: ${p.value.slice(0, 50)}…`;
    });

    for (const slug of ORDER) {
      await check(`demo: ${slug} alone runs once; the tab stays put`, async () => {
        await load(`?mods=${slug}`);
        const s = await state();
        if (s.mods[slug] !== 1) throw new Error(`${slug}: ${s.mods[slug]}`);
        const others = Object.entries(s.mods).filter(([k, n]) => k !== slug && n);
        if (others.length) throw new Error(`others running: ${JSON.stringify(others)}`);
        if (!s.panel && !s.tab?.shown) throw new Error('neither the panel nor the tab');
        if (s.tab && (s.tab.parent !== 'HTML' || (s.tab.shown && !s.tab.hit))) throw new Error(JSON.stringify(s.tab));
        return s.panel ? 'panel open (reopened after the reload)' : 'tab shown';
      });
    }

    await check(`demo: all ${ORDER.length} together, each once; gravity, the shooter and the rave leave the tab alone; Escape is the page's`, async () => {
      // Closed panel, so the tab shows.
      await page(`async () => sessionStorage.setItem('trif-demo-open', '')`);
      await load(`?mods=${ORDER.join(',')}`);
      let s = await state();
      const twice = Object.entries(s.mods).filter(([, n]) => n !== 1);
      if (twice.length) throw new Error(`not once: ${JSON.stringify(twice)}`);
      const before = s.tab;
      if (!before?.shown || !before.hit || before.parent !== 'HTML') throw new Error(JSON.stringify(before));
      // The mouse over the page, rave (white text), the shooter firing, then gravity.
      await d.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 200, y: 200 }, sid);
      await sleep(400);
      for (let i = 0; i < 6; i++) { await key(' ', 'Space', 32); await sleep(120); }
      await key('g', 'KeyG', 71);
      await sleep(2500);
      s = await state();
      if (!s.gravity) throw new Error('gravity didn\'t start');
      const after = s.tab;
      if (!after?.shown || !after.hit || JSON.stringify(after.rect) !== JSON.stringify(before.rect) || after.color !== before.color || after.bg !== before.bg || after.transform !== before.transform) {
        throw new Error(`the tab changed: ${JSON.stringify({ before, after })}`);
      }
      await shot('demo-all-gravity');
      // Escape on the page: Gravity puts the page back (nothing of the demo's to close, and it doesn't try).
      await key('Escape', 'Escape', 27);
      await sleep(1500);
      s = await state();
      if (s.gravity) throw new Error('Escape didn\'t end gravity');
      // With the panel open: Escape on the page still goes to gravity, the panel stays.
      await page(`async () => { document.querySelector('.demo-tab').click(); }`);
      await sleep(1500);
      await page(`async () => { document.activeElement?.blur?.(); document.body.focus(); }`);
      await key('g', 'KeyG', 71);
      await sleep(1500);
      await key('Escape', 'Escape', 27);
      await sleep(1500);
      s = await state();
      if (s.gravity || !s.panel) throw new Error(`gravity ${s.gravity}, panel ${s.panel}`);
      // From the panel's close button, Escape closes it.
      await page(`async () => document.querySelector('.demo-close').focus()`);
      await key('Escape', 'Escape', 27);
      await sleep(500);
      s = await state();
      if (s.panel || !s.tab?.shown) throw new Error(`panel ${s.panel}, tab ${JSON.stringify(s.tab)}`);
      return `tab unmoved at ${after.rect}, colour ${after.color}`;
    });

    // ---- the real TRIF on for timsrobot.com: the home page is like any other website
    let panelCtx;
    await check('the real TRIF on for timsrobot.com (Fix): nothing marks the page; the demo stays, its mod runs once', async () => {
      // The demo's space shooter on (a fresh demo on the page's address with it: listed and on), the panel open.
      await load();
      await page(`async () => { sessionStorage.removeItem('trif-demo-state'); sessionStorage.setItem('trif-demo-open', ''); }`);
      await load('?mods=shooter');
      await page(`async () => { document.querySelector('.demo-tab').click(); }`);
      await sleep(2500);
      const listed = await demoPanel(`(doc) => doc.querySelector('li[data-mod="timsrobot.com/shooter"] button.switch')?.getAttribute('aria-checked')`);
      if (listed !== 'true') throw new Error(`the demo's shooter: ${listed}`);
      // The real side panel: Fix (TRIF on for timsrobot.com).
      await ext(`async (url) => { await chrome.windows.create({ url, width: 400, height: 860 }); }`, [`${d.origin}/sidepanel.html?window=${win.windowId}`]);
      panelCtx = await d.findPage('sidepanel.html');
      await waitFor('the gate', () => d.eval(panelCtx, `async () => !document.querySelector('#gate').hidden`), { timeoutMs: 20000 });
      await d.click(panelCtx, '#gate-btn');
      await waitFor('TRIF on for the site', () => d.eval(panelCtx, `async () => document.querySelector('#gate').hidden && document.querySelector('#site-switch').getAttribute('aria-checked') === 'true'`), { timeoutMs: 20000 });
      await load('?mods=shooter');
      const s = await state();
      if (s.marker !== null) throw new Error(`the page is marked: ${s.marker}`);
      if (!s.panel && !s.tab?.shown) throw new Error(`the demo is gone: ${JSON.stringify({ tab: s.tab, panel: s.panel })}`);
      if (s.mods.shooter !== 1) throw new Error(`ships: ${s.mods.shooter} (url ${s.url})`);
      await shot('real-on-demo-stays');
      return `url ${s.url}: no marker, demo ${s.panel ? 'panel open' : 'tab shown'}, 1 ship`;
    });

    await check('a mod of the visitor\'s own for timsrobot.com runs alongside the demo; nothing marks this page or any other', async () => {
      const dir = path.join(trif, 'sites', SITE);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'e2e-mine.js'), [
        '// ==WebMod==', '// @name        E2E Mine', '// @description A visitor\'s own mod for TRIF\'s home page',
        `// @match       https://${SITE}/*`, '// @run-at      document-start', '// ==/WebMod==',
        'document.documentElement.dataset.e2eMine = "ran";', ''].join('\n'));
      await waitFor('the panel to list it', () => d.eval(panelCtx, `async () => !!document.querySelector('li[data-mod="timsrobot.com/e2e-mine"] button.switch[aria-checked="true"]')`), { timeoutMs: 20000 });
      await load('?mods=shooter');
      const s = await state();
      if (s.mine !== 'ran') throw new Error(`the visitor's mod didn't run: ${JSON.stringify(s)}`);
      if (s.marker !== null) throw new Error(`the page is marked: ${s.marker}`);
      if (!s.panel && !s.tab?.shown) throw new Error('the demo is gone');
      if (s.mods.shooter !== 1) throw new Error(`ships: ${s.mods.shooter}`);
      await shot('real-own-mod');
      for (const url of [`https://127.0.0.1:${other.address().port}/`, `http://localhost:${other.address().port}/`]) {
        await d.navigate(pageCtx, url);
        await sleep(1200);
        const m = await page(`async () => document.documentElement.getAttribute('data-trif')`);
        if (m !== null) throw new Error(`${url} is marked: ${m}`);
      }
      return 'the visitor\'s mod ran, the demo too, no marker anywhere';
    });

    await check('the robot off for timsrobot.com again: the visitor\'s mod stops, the demo is still there', async () => {
      await d.navigate(pageCtx, `${base}/`);
      await sleep(1500);
      await d.click(panelCtx, '#site-switch');
      await sleep(1500);
      await load();
      const s = await state();
      if (s.mine !== null || s.marker !== null || (!s.tab?.shown && !s.panel)) throw new Error(JSON.stringify(s));
      return s.panel ? 'panel open' : 'tab shown';
    });

    const problems = (await d.consoleProblems()).filter((p) => /^(chrome-extension|https:\/\/timsrobot)/.test(p.source || '') && p.level === 'error' && !/favicon\.ico/.test(p.source));
    await check('no errors from the extension or the page', async () => { if (problems.length) throw new Error(JSON.stringify(problems.slice(0, 5))); });
  } finally {
    await d.stop().catch(() => {});
    server.close(); other.close();
    await killMatching(o.work + '/');
  }
  console.log(`\n${results.length - failed} passed, ${failed} failed; screenshots in ${o.out}`);
  return failed ? 1 : 0;
}

main().then((c) => { process.exitCode = c; }, (e) => { console.error(e); process.exitCode = 1; });
