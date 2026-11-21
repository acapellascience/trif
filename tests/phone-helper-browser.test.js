'use strict';
// The phone view with the real helper (helper/host.js, started by the browser over native messaging, in a temp
// workspace), in a real browser (split from tests/phone-browser.test.js, whose first comment says what the test
// pages and the harness are): a sensitive site's phone mod listed and run, and the reloads after a phone mod's
// edit staying the phone's. Headless Chrome for Testing (tests/cdp-page.js: one browser at a time, the memory
// guard), with TRIF_BROWSER_TESTS=1 or in CI; skipped otherwise.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { browserTestsSkip, launch } = require('./cdp-page');
const { servePhonePages, extensionCopy, harness, waitFor } = require('./phone-pages');

const skip = browserTestsSkip();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A phone mod for a sensitive site, synced from the phone (Tim, 11-19: sites/phone~claude.ai/meadow.js on the Mac,
// boxed, `@match https://claude.ai/*` and `https://*.claude.ai/*`; the phone view on claude.ai listed no card and
// ran nothing: lib.js modHome took the twin, phone~claude.ai, for a site of its own, not the sensitive site
// claude.ai, so limitToSites let it run nowhere). The real helper (helper/host.js, started by the browser over
// native messaging) in a temp workspace with that file, a claude.ai stand-in (a local https page the browser
// resolves claude.ai to, its certificate accepted), TRIF on there: the phone view's panel lists it, off (new to
// this browser), the desktop panel doesn't; its switch, as the person clicks it, runs it in the phone tab only.
test('a sensitive site\'s phone mod (phone~claude.ai, boxed): the phone view lists it, off, and runs it once switched on', { skip, timeout: 900000 }, async () => {
  const https = require('https');
  const path = require('path');
  const { spawnSync } = require('child_process');
  const { tempDir, testEnv, HOST_JS } = require('./fake-extension');
  const sh = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
  const home = tempDir('wm-pcm-');
  const extra = tempDir('wm-pcmx-');
  const twin = path.join(home, 'sites', 'phone~claude.ai');
  fs.mkdirSync(twin, { recursive: true });
  const ID = 'phone~claude.ai/meadow';
  // (written once the panels are open, as a sync writes it: a mod new to this browser)
  const MEADOW = [
    '// ==WebMod==', '// @name        Meadow', '// @id e9254572-3540-4b60-881b-9ff7761b1af2',
    '// @description A meadow scene', '// @match       https://claude.ai/*', '// @match       https://*.claude.ai/*', '// @boxed', '// ==/WebMod==',
    "trif.css('html { outline: 7px solid rgb(1, 2, 3) !important; }');", '',
  ].join('\n');
  fs.writeFileSync(path.join(twin, 'other.js'), '// ==WebMod==\n// @name Other\n// @match https://example.com/*\n// @style\n// ==/WebMod==\n{ "hide": ["#x"] }\n');
  // (the stand-in: https, as claude.ai's own pages, with a certificate of its own)
  const key = path.join(extra, 'key.pem');
  const cert = path.join(extra, 'cert.pem');
  const made = spawnSync('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=claude.ai', '-addext', 'subjectAltName=DNS:claude.ai'], { encoding: 'utf8' });
  assert.equal(made.status, 0, made.stderr);
  const server = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, (req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end('<!doctype html><html><head><meta charset="utf-8"><title>Claude stand-in</title></head><body><p>A chat</p><script>window.__phone = /iPhone/.test(navigator.userAgent);</script></body></html>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `https://claude.ai:${server.address().port}/new`;
  // (the helper as the browser starts it: the test's environment, never the real ~/.trif)
  const env = testEnv(home);
  const pidFile = path.join(extra, 'helper.pid');
  const host = path.join(extra, 'host.sh');
  fs.writeFileSync(host, `#!/bin/sh\necho $$ > ${sh(pidFile)}\n${Object.entries(env).map(([k, v]) => `export ${k}=${sh(v)}`).join('\n')}\nexec ${sh(process.execPath)} ${sh(HOST_JS)} "$@"\n`);
  fs.chmodSync(host, 0o755);
  const ext = extensionCopy(['*://claude.ai/*', '*://*.claude.ai/*']);
  let browser = null;
  try {
    browser = await launch({
      extension: ext,
      args: ['--screen-info={0,0 1470x956}', '--host-resolver-rules=MAP claude.ai 127.0.0.1, MAP *.claude.ai 127.0.0.1', '--ignore-certificate-errors'],
      prepare: (profile, id) => {
        fs.mkdirSync(path.join(profile, 'NativeMessagingHosts'));
        fs.writeFileSync(path.join(profile, 'NativeMessagingHosts', 'com.webmods.helper.json'), JSON.stringify({
          name: 'com.webmods.helper', description: 'TRIF helper (a test\'s)', path: host, type: 'stdio', allowed_origins: [`chrome-extension://${id}/`],
        }));
      },
    });
    const h = await harness(browser);
    await h.allowUserScripts();
    const status = () => h.ask({ type: 'status' });
    const st = await waitFor('the helper', async () => { const s = await status(); return s.helper.connected && s.mods.some((m) => m.id === 'phone~claude.ai/other') && s; }, 30000);
    // (claude.ai: a sensitive site, blocked for a new user; Unblock, then on, as the panel does)
    if (st.blockedSites.includes('claude.ai')) await h.ask({ type: 'site.block', site: 'claude.ai', blocked: false });
    await h.ask({ type: 'site.set', site: 'claude.ai', on: true });
    const { phoneTab, homeWin } = await h.E(async (u) => {
      const w = await chrome.windows.create({ url: u, focused: true, width: 1200, height: 860 });
      await chrome.tabs.create({ windowId: w.id, url: 'about:blank', active: false });
      await new Promise((r) => setTimeout(r, 1500));
      return { phoneTab: w.tabs[0].id, homeWin: w.id };
    }, url);
    await waitFor('the stand-in', () => h.page(phoneTab, 'document.readyState === "complete" && window.__phone === false'));
    const outline = (tab) => h.page(tab, 'getComputedStyle(document.documentElement).outlineColor');
    // A panel page for a window (as the panel's own fallback opens it), and what its mods box lists
    const panelOf = async (win) => {
      await h.E((id) => chrome.windows.create({ url: chrome.runtime.getURL(`sidepanel.html?window=${id}&fallback=1`), focused: false }), win);
      const t = await waitFor(`the panel for window ${win}`, async () => (await browser.cdp.send('Target.getTargets')).targetInfos.find((x) => x.type === 'page' && x.url.includes(`/sidepanel.html?window=${win}&fallback=1`)));
      const sid = await browser._attach(t.targetId);
      return async (expr) => {
        const r = await browser.cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid);
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
        return r.result.value;
      };
    };
    const LIST = `(() => ({
      phone: document.body.classList.contains('phone-view'),
      rows: [...document.querySelectorAll('#mod-list li[data-mod]')].map((li) => li.dataset.mod),
      on: [...document.querySelectorAll('#mod-list li[data-mod] button.switch')].map((b) => b.getAttribute('aria-checked')),
    }))()`;
    // the desktop panel: no phone mods
    const desk = await panelOf(homeWin);
    await waitFor('the desktop panel', () => desk('document.readyState === "complete" && !!document.getElementById("mod-list")'));
    await sleep(2000);
    assert.deepEqual((await desk(LIST)).rows, [], 'the desktop panel lists no phone mod');
    assert.notEqual(await outline(phoneTab), 'rgb(1, 2, 3)', 'and it doesn\'t run on the desktop page');
    // the phone view on claude.ai: its panel lists the mod, off (new here: its switch is the person's)
    const opened = await h.openPhone(phoneTab, null);
    await waitFor('the phone page', () => h.page(phoneTab, 'document.readyState === "complete" && window.__phone === true'));
    const phone = await panelOf(opened.window);
    await waitFor('the phone panel', () => phone('document.readyState === "complete" && document.body.classList.contains("phone-view")'));
    await sleep(2000);
    assert.deepEqual((await phone(LIST)).rows, [], 'nothing yet (the twin\'s other mod is for another site)');
    // the sync writes the mod, the panels open
    fs.writeFileSync(path.join(twin, 'meadow.js'), MEADOW);
    await waitFor('the mod at the extension', async () => (await status()).mods.some((m) => m.id === ID), 20000);
    const m = (await status()).mods.find((x) => x.id === ID);
    assert.equal(m.sandboxed, true, 'a boxed mod');
    assert.equal(m.enabled, false, 'new here: off');
    const want = { phone: true, rows: [ID], on: ['false'] };
    await waitFor('the phone panel\'s list', async () => JSON.stringify(await phone(LIST)) === JSON.stringify(want), 20000).catch(async (e) => { console.error(JSON.stringify(await phone(LIST))); throw e; });
    assert.notEqual(await outline(phoneTab), 'rgb(1, 2, 3)', 'off: not running');
    // switched on in the phone view's panel, as the person clicks it: it runs in the phone tab
    await phone(`document.querySelector('#mod-list li[data-mod="${ID}"] button.switch').click(), 0`);
    await waitFor('switched on', async () => (await status()).mods.find((m) => m.id === ID).enabled === true);
    await h.E((id) => chrome.tabs.reload(id), phoneTab);
    await waitFor('the mod in the phone tab', async () => (await outline(phoneTab)) === 'rgb(1, 2, 3)', 20000).catch(async (e) => { console.error(JSON.stringify((await status()).mods.find((m) => m.id === ID))); throw e; });
    assert.deepEqual(await phone(LIST), { ...want, on: ['true'] });
  } finally {
    if (browser) await browser.close();
    server.close();
    let pid = 0;
    try { pid = Number(fs.readFileSync(pidFile, 'utf8')); } catch { /* never started */ }
    if (pid) { await sleep(1500); try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
    fs.rmSync(ext, { recursive: true, force: true });
    fs.rmSync(extra, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});
// A phone mod edited in the phone view, then the page reloaded, again and again, as an agent's edits, `trif verify`
// and the mod's approval do it within seconds (Tim, 11-20, on X: "i just edited a mod in phone view and when the
// page reloaded it reloaded the desktop version"). X's service worker serves its pages, without the phone's rules
// and marker; TRIF loaded the first such page again past the worker (phone.js heal), and then, for 15 s, not the
// next ones of the same address: the reload after the approval, seconds after verify's, came back the desktop's.
// Now TRIF's own reloads of a phone tab go past the worker and the cache, and a heal that worked doesn't stop the
// next. The real helper (helper/host.js, started by the browser) in a temp workspace with the phone twin's mod;
// a page with a service worker; the tab alone in its window (made the phone's) and in a window with another tab.
test('a phone mod edited in the phone view: each reload after it (trif verify, trif reload, the page\'s own) is the phone\'s, with the new version running', { skip, timeout: 900000 }, async () => {
  const path = require('path');
  const { tempDir, testEnv, HOST_JS, runCli } = require('./fake-extension');
  const sh = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
  const home = tempDir('wm-pme-');
  const extra = tempDir('wm-pmex-');
  const twin = path.join(home, 'sites', 'phone~127.0.0.1');
  fs.mkdirSync(twin, { recursive: true });
  const ID = 'phone~127.0.0.1/mark';
  const mod = (v) => ['// ==WebMod==', '// @name Mark', '// @match http://127.0.0.1/*', '// ==/WebMod==', `document.documentElement.dataset.mark = '${v}';`, ''].join('\n');
  fs.writeFileSync(path.join(twin, 'mark.js'), mod('v1'));
  const env = testEnv(home);
  const pidFile = path.join(extra, 'helper.pid');
  const host = path.join(extra, 'host.sh');
  fs.writeFileSync(host, `#!/bin/sh\necho $$ > ${sh(pidFile)}\n${Object.entries(env).map(([k, v]) => `export ${k}=${sh(v)}`).join('\n')}\nexec ${sh(process.execPath)} ${sh(HOST_JS)} "$@"\n`);
  fs.chmodSync(host, 0o755);
  const pages = await servePhonePages();
  const ext = extensionCopy(['*://127.0.0.1/*']);
  let browser = null;
  try {
    browser = await launch({
      extension: ext,
      args: ['--screen-info={0,0 1470x956}'],
      prepare: (profile, id) => {
        fs.mkdirSync(path.join(profile, 'NativeMessagingHosts'));
        fs.writeFileSync(path.join(profile, 'NativeMessagingHosts', 'com.webmods.helper.json'), JSON.stringify({
          name: 'com.webmods.helper', description: 'TRIF helper (a test\'s)', path: host, type: 'stdio', allowed_origins: [`chrome-extension://${id}/`],
        }));
      },
    });
    const h = await harness(browser);
    await h.allowUserScripts();
    const status = () => h.ask({ type: 'status' });
    await waitFor('the helper', async () => { const s = await status(); return s.helper.connected && s.mods.some((m) => m.id === ID); }, 30000);
    await h.ask({ type: 'site.set', site: '127.0.0.1', on: true });
    if (!(await status()).mods.find((m) => m.id === ID).enabled) await h.ask({ type: 'mod.enable', id: ID, enabled: true });
    const cli = async (...args) => { const r = await runCli(args, { home, timeout: 60000 }); return `${r.stdout}${r.stderr}`; };
    let v = 1;
    for (const lone of [true, false]) {
      const what = lone ? 'the tab alone in its window' : 'a window of its own';
      // the site's page, under its service worker (as X's are)
      const tabId = await h.E(async ([u, lone]) => {
        const w = await chrome.windows.create({ url: u, focused: true, width: 1200, height: 860 });
        if (!lone) await chrome.tabs.create({ windowId: w.id, url: 'about:blank', active: false });
        return w.tabs[0].id;
      }, [pages.url('/sw/detect'), lone]);
      await waitFor('the worker', () => h.page(tabId, 'window.__sw === true'));
      await h.E((id) => chrome.tabs.reload(id), tabId);
      await waitFor('the page under its worker', () => h.page(tabId, 'document.readyState === "complete" && !!navigator.serviceWorker.controller'));
      const opened = await h.openPhone(tabId, { left: 0, top: 25, width: 1470, height: 931 });
      assert.equal(!!opened.same, lone, `${what}: ${JSON.stringify(opened)}`);
      const look = () => h.page(tabId, `document.readyState === 'complete' && window.__seen && ({ ua: window.__seen.uaPhone, server: document.getElementById('server').textContent, marked: performance.getEntriesByType('navigation')[0].serverTiming.some((x) => x.name === 'trif-phone'), w: innerWidth, mark: document.documentElement.dataset.mark || null })`);
      const phone = (want) => ({ ua: true, server: 'phone', marked: true, w: opened.viewport.w, mark: `v${want}` });
      // (the page after a reload: until it has the mod's version wanted, a few seconds at most; then as it is)
      const after = async (want) => { await sleep(800); return (await waitFor(`v${want} loaded`, async () => { const x = await look(); return x && x.mark === `v${want}` && x; }, 8000).catch(() => null)) || await look(); };
      assert.deepEqual(await waitFor('the phone page', async () => { const x = await look(); return x && x.marked && x; }), phone(v), `${what}: the phone view`);
      // edited and checked, twice in a row, as an agent does it: `trif verify` reloads the tab
      for (let i = 0; i < 2; i++) {
        v++;
        fs.writeFileSync(path.join(twin, 'mark.js'), mod(`v${v}`));
        await sleep(400); // (verify waits until the browser has the version saved)
        const out = await cli('verify', ID, '--tab', String(tabId));
        assert.match(out, /reloaded/, out);
        assert.deepEqual(await after(v), phone(v), `${what}: after trif verify #${i + 1}`);
      }
      // `trif reload` (and what TRIF reloads itself: a mod switched or approved), right after
      await cli('reload', '--tab', String(tabId));
      assert.deepEqual(await after(v), phone(v), `${what}: after trif reload`);
      // the page reloading itself (a mod can: @powers go-to reload), twice
      for (let i = 0; i < 2; i++) {
        await h.page(tabId, 'setTimeout(() => location.reload(), 10), 1');
        await sleep(1500);
        assert.deepEqual(await waitFor('the page again', async () => { const x = await look(); return x && x.marked && x; }, 10000).catch(look), phone(v), `${what}: after the page's own reload #${i + 1}`);
      }
      await h.ask({ type: 'phone.close', tabId });
      await h.E((id) => chrome.tabs.get(id).then((t) => chrome.windows.remove(t.windowId)), tabId);
    }
  } finally {
    if (browser) await browser.close();
    pages.server.close();
    let pid = 0;
    try { pid = Number(fs.readFileSync(pidFile, 'utf8')); } catch { /* never started */ }
    if (pid) { await sleep(1500); try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
    fs.rmSync(ext, { recursive: true, force: true });
    fs.rmSync(extra, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});
