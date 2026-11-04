#!/usr/bin/env node
'use strict';
// TRIF's own home page with the real extension (opt-in; not part of `npm test`). See docs/TESTING.md.
//
//   node tests/e2e/homepage.js [--work <short dir>] [--out <dir>] [--headful]
//
// The home page (site/, with its demo) is served over HTTPS as timsrobot.com from this checkout; TRIF from
// this checkout is installed into a scratch home (setup --copy, which ships the 13 home page mods, off), and
// Chrome for Testing runs headless in a throwaway profile, as the e2e suite does (tests/e2e/lib). It checks
// that the demo and the real TRIF don't get in each other's way:
//  - TRIF off for timsrobot.com: no marker; the demo's tab is outside <body> (top layer); each demo mod
//    works alone and all together, and gravity, the shooter, tilting and the rave leave the tab alone;
//    Escape on the page is the page's (Gravity's), not the panel's;
//  - then, the way a visitor gets there: the demo open with a demo mod on, TRIF turned on for the site in the
//    real side panel, a real mod switched on (the tab reloads): the marker is there, the tab is gone, the
//    demo panel doesn't come back, and the demo's mod stands aside (one ship, not two);
//  - every real mod on: each effect once; other sites never get the marker.
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
const ORDER = require('../../helper/lib/preinstalled').DEFAULT_ORDER[SITE].map((id) => id.split('/')[1]);

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
  'tilt': 'style[data-tc]',
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
  await import(pathToFileURL(path.join(REPO, 'site', 'build-demo.js')).href).then((m) => m.writeDemoModule());
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
    // What's on the page: the marker, the demo's tab and panel, and each mod's effect.
    const state = () => page(`async (probes) => {
      const tab = document.querySelector('.demo-tab');
      const r = tab?.getBoundingClientRect();
      const count = (p) => p.startsWith('style:') ? [...document.querySelectorAll('style')].filter((s) => s.textContent.includes(p.slice(6))).length : document.querySelectorAll(p).length;
      return {
        marker: document.documentElement.getAttribute('data-trif'),
        tab: tab ? { parent: tab.parentElement.tagName, top: tab.matches(':popover-open'), shown: !tab.hidden && r.width > 0 && r.height > 0,
          inView: r.right <= innerWidth + 1 && r.left >= innerWidth - 60, rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
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
    await check('TRIF off for timsrobot.com: no marker; the demo tab is outside <body>, in the top layer, on screen', async () => {
      await load();
      s0 = await state();
      if (s0.marker !== null) throw new Error(`marker ${s0.marker}`);
      if (!s0.tab || s0.tab.parent !== 'HTML' || !s0.tab.top || !s0.tab.shown || !s0.tab.inView || !s0.tab.hit) throw new Error(JSON.stringify(s0.tab));
      if (Object.values(s0.mods).some((n) => n)) throw new Error(`mods running: ${JSON.stringify(s0.mods)}`);
      await shot('tab');
      return `tab at ${s0.tab.rect}`;
    });

    await check('the demo panel lists the 13 home page mods in Tim\'s order, all off, with descriptions', async () => {
      await page(`async () => { document.querySelector('.demo-tab').click(); }`);
      await sleep(2500);
      const rows = await demoPanel(`(doc) => [...doc.querySelectorAll('#mod-list > li')].map((li) => ({ slug: li.dataset.mod.split('/')[1], on: li.querySelector('button.switch')?.getAttribute('aria-checked'), desc: li.querySelector('.mod-desc')?.textContent || '', file: li.querySelector('.mod-file')?.textContent }))`);
      if (JSON.stringify(rows.map((r) => r.slug)) !== JSON.stringify(ORDER)) throw new Error(`order: ${rows.map((r) => r.slug)}`);
      if (rows.some((r) => r.on !== 'false' || !r.desc || r.file !== `${r.slug}.js`)) throw new Error(JSON.stringify(rows));
      await shot('demo-panel');
      return rows.map((r) => r.slug).join(', ');
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

    await check('demo: all 13 together, each once; gravity, the shooter, tilting and the rave leave the tab alone; Escape is the page\'s', async () => {
      // Closed panel, so the tab shows.
      await page(`async () => sessionStorage.setItem('trif-demo-open', '')`);
      await load(`?mods=${ORDER.join(',')}`);
      let s = await state();
      const twice = Object.entries(s.mods).filter(([, n]) => n !== 1);
      if (twice.length) throw new Error(`not once: ${JSON.stringify(twice)}`);
      const before = s.tab;
      if (!before?.shown || !before.hit || before.parent !== 'HTML') throw new Error(JSON.stringify(before));
      // Tilt (the mouse over the page), rave (white text), the shooter firing, then gravity.
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

    // ---- the visitor turns the real TRIF on
    let panelCtx;
    await check('demo open with a demo mod on, then the real TRIF on and a real mod on: the tab goes, the demo doesn\'t reopen, one ship', async () => {
      await load();
      await page(`async () => { document.querySelector('.demo-tab').click(); }`);
      await sleep(2500);
      // The demo's space shooter on (the page reloads with it, the panel back).
      await demoPanel(`(doc) => doc.querySelector('li[data-mod="timsrobot.com/shooter"] button.switch').click()`);
      await waitFor('the demo\'s reload', async () => (await state()).url.includes('mods=shooter'), { timeoutMs: 10000 });
      await sleep(2500);
      let s = await state();
      if (s.mods['shooter'] !== 1 || !s.panel || s.flag !== '1') throw new Error(JSON.stringify(s));
      // The real side panel: Fix (TRIF on for timsrobot.com): no reload for that alone.
      await ext(`async (url) => { await chrome.windows.create({ url, width: 400, height: 860 }); }`, [`${d.origin}/sidepanel.html?window=${win.windowId}`]);
      panelCtx = await d.findPage('sidepanel.html');
      await waitFor('the gate', () => d.eval(panelCtx, `async () => !document.querySelector('#gate').hidden`), { timeoutMs: 20000 });
      await d.click(panelCtx, '#gate-btn');
      await waitFor('the real mods listed', () => d.eval(panelCtx, `async () => document.querySelectorAll('#mod-list > li').length === 13`), { timeoutMs: 20000 });
      const realOrder = await d.eval(panelCtx, `async () => [...document.querySelectorAll('#mod-list > li')].map((li) => li.dataset.mod.split('/')[1])`);
      if (JSON.stringify(realOrder) !== JSON.stringify(ORDER)) throw new Error(`the real panel's order: ${realOrder}`);
      // A real mod on: the tab reloads.
      await d.click(panelCtx, 'li[data-mod="timsrobot.com/shooter"] button.switch');
      await waitFor('the marker after the reload', async () => { try { return (await state()).marker === 'on'; } catch { return false; } }, { timeoutMs: 15000 });
      await sleep(2500);
      s = await state();
      if (s.tab || s.panel) throw new Error(`demo still there: ${JSON.stringify({ tab: s.tab, panel: s.panel })}`);
      if (s.flag) throw new Error(`the open flag is still set: ${s.flag}`);
      if (s.mods['shooter'] !== 1) throw new Error(`ships: ${s.mods['shooter']} (url ${s.url})`);
      await shot('real-one-ship');
      return `url ${s.url}: marker on, no tab, no panel, 1 ship`;
    });

    await check('the real TRIF with every home page mod on: each once, no demo; other sites unmarked', async () => {
      for (const slug of ORDER) {
        if (slug === 'shooter') continue;
        await d.click(panelCtx, `li[data-mod="timsrobot.com/${slug}"] button.switch`);
        await sleep(400);
      }
      await load(`?mods=${ORDER.join(',')}`); // (even asking for the demo's copies of all of them)
      const s = await state();
      const wrong = Object.entries(s.mods).filter(([, n]) => n !== 1);
      if (wrong.length) throw new Error(`not once: ${JSON.stringify(wrong)}`);
      if (s.tab || s.panel || s.marker !== 'on') throw new Error(JSON.stringify(s));
      await shot('real-all');
      await key('g', 'KeyG', 71);
      await sleep(2000);
      if (!(await state()).gravity) throw new Error('gravity didn\'t start');
      await key('Escape', 'Escape', 27);
      await sleep(1500);
      if ((await state()).gravity) throw new Error('Escape didn\'t end gravity');
      // Other sites: no marker.
      for (const url of [`https://127.0.0.1:${other.address().port}/`, `http://localhost:${other.address().port}/`]) {
        await d.navigate(pageCtx, url);
        await sleep(1200);
        const m = await page(`async () => document.documentElement.getAttribute('data-trif')`);
        if (m !== null) throw new Error(`${url} is marked: ${m}`);
      }
      return 'each effect once, gravity and Escape work';
    });

    await check('the robot off for timsrobot.com again: no marker after a reload, the demo is back', async () => {
      await d.eval(panelCtx, `async () => true`);
      await d.navigate(pageCtx, `${base}/`);
      await sleep(1500);
      await d.click(panelCtx, '#site-switch');
      await sleep(1500);
      await load();
      const s = await state();
      if (s.marker !== null || !s.tab?.shown) throw new Error(JSON.stringify(s));
      return 'tab back';
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
