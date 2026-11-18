'use strict';
// The All mods page (extension/allmods.html, allmods.js) in a real browser, with the real helper: TRIF's extension
// (a copy granting the test's sites, as the user's Connect would) in headless Chrome for Testing (tests/cdp-page.js:
// muted, one test browser at a time, the memory guard), and helper/host.js as its native host, with a scratch
// workspace and a scratch HOME (never ~/.trif, never the user's browser or helper). Thirty-one mods on eight sites,
// every site and the phone view; then a held one, and two hundred and twenty more for the page's speed.
//
// Only with TRIF_BROWSER_TESTS=1 (or CI) and Chrome for Testing (docs/TESTING.md). ALLMODS_SHOTS=<dir> also writes
// screenshots of the page, light and dark, and of the approval card.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { browserTestsSkip, launch } = require('./cdp-page');
const { extensionCopy } = require('./phone-pages');
const { testEnv, tempDir, HOST_JS } = require('./fake-extension');
const { writeFixtureMods, writeHeldMod } = require('./allmods-fixtures');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
async function until(what, fn, ms = 20000) {
  const end = Date.now() + ms;
  let last;
  for (;;) {
    try { last = await fn(); if (last) return last; } catch (e) { last = e; }
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}${last instanceof Error ? `: ${last.message}` : ''}`);
    await sleep(150);
  }
}

const GRANTED = ['x.com', 'google.com', 'youtube.com', 'reddit.com', 'github.com', 'wikipedia.org', 'ycombinator.com'];

test('the All mods page: every mod by site, its status, search, filters, switches, holds, delete and restore, export, 250 mods', { skip: browserTestsSkip(), timeout: 300000 }, async () => {
  const home = tempDir('tam-');
  const modsDir = path.join(home, 'sites');
  writeFixtureMods(modsDir);
  const out = tempDir('tam-out-');
  // The helper as Chrome starts it: a wrapper with the test's environment only (a scratch HOME and workspace, no
  // agents on PATH, exports to `out` without a folder chooser, Show in Finder a no-op).
  const env = { ...testEnv(home), TRIF_CHOOSE_FOLDER: out, TRIF_REVEAL_CMD: '/usr/bin/true' };
  const wrapper = path.join(home, 'host.sh');
  fs.writeFileSync(wrapper, `#!/bin/sh\nexec /usr/bin/env -i ${Object.entries(env).map(([k, v]) => `${k}=${shq(v)}`).join(' ')} ${shq(process.execPath)} ${shq(HOST_JS)} "$@"\n`, { mode: 0o755 });
  const ext = extensionCopy(GRANTED.map((s) => `*://*.${s}/*`));
  const browser = await launch({ extension: ext, args: ['--window-size=1280,900'] });
  try {
    const nmh = path.join(browser.dir, 'profile', 'NativeMessagingHosts');
    fs.mkdirSync(nmh, { recursive: true });
    fs.writeFileSync(path.join(nmh, 'com.webmods.helper.json'), JSON.stringify({ name: 'com.webmods.helper', description: 'TRIF (test)', path: wrapper, type: 'stdio', allowed_origins: [`chrome-extension://${browser.extensionId}/`] }));

    // The worker started again with `patch` in its storage (what it reads as it starts): stopped from an extension
    // page of its own (DevTools' ServiceWorker.stopAllWorkers), woken by that page's next message.
    const ctl = await browser.newPage();
    await ctl.goto(`chrome-extension://${browser.extensionId}/allmods.html`);
    await ctl.send('ServiceWorker.enable');
    const restart = async (patch, ready) => {
      await ctl.evaluate((p) => chrome.storage.local.set(p), patch);
      await ctl.send('ServiceWorker.stopAllWorkers');
      await sleep(500);
      await until('the worker started again', async () => ready(await ctl.evaluate(() => chrome.runtime.sendMessage({ type: 'status' }))), 20000);
      return browser.serviceWorker();
    };
    // TRIF on for five sites, off on one (wikipedia.org), blocked on one (reddit.com), and amazon.com not connected
    let sw = await restart({ sitesOn: ['x.com', 'google.com', 'youtube.com', 'github.com', 'ycombinator.com', 'reddit.com'], blockedSites: ['reddit.com'] },
      (st) => st?.blockedSites?.includes('reddit.com'));
    const stored = await until('the mods from the helper', async () => {
      const s = await sw.evaluate(() => chrome.storage.local.get(null));
      return Array.isArray(s.modIds) && s.modIds.length === 31 && s;
    }, 30000);
    // Then what the page shows about some: an error, a click the guard stopped, one updated from Tim's mods (and
    // so off), one off
    const hash = (id) => stored[`mod:${id}`].hash;
    const health = {
      'x.com/mute-words': { hash: hash('x.com/mute-words'), errors: { a: { message: 'Cannot read properties of null (reading \'textContent\')', line: 12, count: 3, first: 1, last: Date.now() } } },
      'youtube.com/theater-default': { hash: hash('youtube.com/theater-default'), errors: { b: { message: 'TRIF stopped a click on a control a mod\'s style hid', count: 1, first: 1, last: Date.now(), clickjack: true } } },
    };
    sw = await restart({ modHealth: health, disabled: { 'x.com/calm-counts': true, 'google.com/dark-search': true }, newOff: { 'x.com/calm-counts': 'update' } },
      (st) => st?.helper?.connected && st.mods.find((m) => m.id === 'x.com/mute-words')?.broken?.length);

    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await page.goto(`chrome-extension://${browser.extensionId}/allmods.html`);
    await until('the page with every mod', () => page.evaluate(() => document.querySelectorAll('.am-row').length === 31 && !!window.__trifAllMods?.state.status?.helper?.connected));
    const rows = () => page.evaluate(() => [...document.querySelectorAll('.am-row')].filter((li) => !li.hidden && !li.closest('.am-group').hidden).map((li) => li.dataset.mod));

    // ---- grouped by site: every site first, then A to Z, then the phone mods ----
    const groups = await page.evaluate(() => [...document.querySelectorAll('.am-sections > *')].map((n) => (n.classList.contains('am-section-head') ? '#phone' : n.dataset.key)));
    assert.deepEqual(groups, ['all-sites', 'amazon.com', 'github.com', 'google.com', 'news.ycombinator.com', 'reddit.com', 'wikipedia.org', 'x.com', 'youtube.com', '#phone', 'phone~x.com', 'phone~youtube.com']);
    const states = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.am-group')].map((g) => [g.dataset.key, g.querySelector('.am-state').hidden ? null : g.querySelector('.am-state').textContent])));
    assert.equal(states['all-sites'], null);
    assert.equal(states['x.com'], 'TRIF on');
    assert.equal(states['reddit.com'], 'Blocked');
    assert.equal(states['wikipedia.org'], 'TRIF off');
    assert.equal(states['amazon.com'], 'Disconnected');
    // each row: its name, description, tier, switch, when it changed; the tags the panel would show
    const row = (id) => page.evaluate((x) => {
      const li = document.querySelector(`.am-row[data-mod="${x}"]`);
      return li && { name: li.querySelector('.am-name').textContent, desc: li.querySelector('.am-desc').textContent, tier: li.querySelector('.am-tier').textContent,
        on: li.querySelector('[role="switch"]').getAttribute('aria-checked'), tags: [...li.querySelectorAll('.mod-name .tag')].map((t) => t.textContent), when: li.querySelector('.am-when')?.textContent || '', icons: !!li.querySelector('.mod-icons svg') };
    }, id);
    assert.deepEqual(await row('x.com/mute-words'), { name: 'Mute Words', desc: 'Hides posts with words you pick', tier: 'Boxed mod', on: 'true', tags: ['error'], when: 'Changed just now', icons: false });
    assert.deepEqual((await row('youtube.com/theater-default')).tags, ['stopped a click']);
    assert.deepEqual((await row('x.com/calm-counts')).tags, ['updated']);
    assert.equal((await row('x.com/calm-counts')).on, 'false');
    assert.equal((await row('x.com/link-cleaner')).tier, 'Free mod');
    assert.ok((await row('x.com/link-cleaner')).icons, 'a free mod has its chip-and-infinity icon');
    assert.ok((await row('google.com/search-keys')).icons, 'a boxed mod with a power has its icon');

    await shots(page, 'allmods');
    await shots(page, 'allmods-narrow', { width: 680 });

    // ---- search: names, descriptions, sites, and the code ----
    await page.fill('.am-search', 'shorts');
    await until('the search', async () => JSON.stringify(await rows()) === JSON.stringify(['youtube.com/no-shorts']));
    await page.fill('.am-search', 'code-copy-sha'); // (in its code only)
    await until('the code search', async () => JSON.stringify(await rows()) === JSON.stringify(['github.com/copy-sha']));
    await page.fill('.am-search', 'wikipedia');
    await until('the search by site', async () => (await rows()).length === 3);
    await page.fill('.am-search', '');
    await until('every mod again', async () => (await rows()).length === 31);

    // ---- filters ----
    await page.click('.am-chip[data-filter="errors"]');
    assert.deepEqual((await rows()).sort(), ['x.com/mute-words', 'youtube.com/theater-default']);
    await page.click('.am-chip[data-filter="errors"]');
    await page.click('.am-chip[data-filter="siteOff"]');
    assert.ok((await rows()).every((id) => /^(reddit\.com|wikipedia\.org|amazon\.com)\//.test(id)) && (await rows()).length === 8, String(await rows()));
    await page.click('.am-chip[data-filter="siteOff"]');
    await page.evaluate(() => { const s = document.querySelector('.am-select[aria-label="Kind"]'); s.value = 'free'; s.dispatchEvent(new Event('change')); });
    assert.deepEqual((await rows()).sort(), ['github.com/copy-sha', 'x.com/link-cleaner', 'youtube.com/speed-memory']);
    await page.evaluate(() => { const s = document.querySelector('.am-select[aria-label="On or off"]'); s.value = 'off'; s.dispatchEvent(new Event('change')); });
    assert.deepEqual(await rows(), []);
    assert.match(await page.evaluate(() => document.querySelector('.am-empty:not([hidden])')?.textContent || ''), /No mods match/);
    await page.click('.am-clear');
    assert.equal((await rows()).length, 31);

    // ---- "/" goes to the search ----
    await page.evaluate(() => document.activeElement?.blur());
    for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key: '/', code: 'Slash', text: type === 'keyDown' ? '/' : undefined, windowsVirtualKeyCode: 191 });
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('am-search')), true);

    // ---- a switch, as the panel's: chrome.storage.local `disabled` follows ----
    const disabled = () => sw.evaluate(() => chrome.storage.local.get('disabled').then((s) => s.disabled || {}));
    await page.click('.am-row[data-mod="x.com/hide-trends"] [role="switch"]');
    await until('the switch off', async () => (await disabled())['x.com/hide-trends'] === true);
    await page.click('.am-row[data-mod="x.com/hide-trends"] [role="switch"]');
    await until('the switch on again', async () => !(await disabled())['x.com/hide-trends']);

    // ---- a held mod: its switch shows the approval card; nothing runs until Allow ----
    const held = writeHeldMod(modsDir);
    await until('the held mod', () => page.evaluate((x) => !!document.querySelector(`.am-row[data-mod="${x}"] .tag.on-hold`), held), 30000);
    assert.equal(await page.evaluate(() => document.querySelector('.am-chip[data-filter="waiting"] .am-chip-n').textContent), '1');
    assert.equal(await page.evaluate(() => !!document.querySelector('#approval[open]')), false, 'not opened by itself on the page');
    await page.click(`.am-row[data-mod="${held}"] [role="switch"]`);
    await until('the approval card', () => page.evaluate(() => document.querySelector('#approval[open] .ap-name')?.textContent === 'Star Counter')).catch((e) => { throw new Error(`${e.message} (page errors: ${pageErrors.join('; ') || 'none'})`); });
    await shots(page, 'allmods-approval');
    await page.click('#approval .ap-later');
    await until('Not now', () => page.evaluate(() => !document.querySelector('#approval[open]')));
    assert.equal((await row(held)).on, 'false');
    await page.click(`.am-row[data-mod="${held}"] [role="switch"]`);
    await until('the card again', () => page.evaluate(() => !!document.querySelector('#approval[open]')));
    await page.click('#approval .ap-allow');
    await until('allowed', async () => !(await row(held)).tags.includes('waiting for your OK'), 20000);

    // ---- delete: to the trash, with Undo; Recently deleted, with Restore ----
    const file = path.join(modsDir, 'reddit.com', 'old-layout.js');
    await page.click('.am-row[data-mod="reddit.com/old-layout"] .mod-delete');
    await until('deleted', async () => !(await row('reddit.com/old-layout')) && !fs.existsSync(file));
    assert.match(await page.evaluate(() => document.querySelector('.am-toast:not([hidden]) .am-toast-text')?.textContent || ''), /Deleted Old Layout\./);
    await page.click('.am-toast .am-undo');
    await until('undone', async () => !!(await row('reddit.com/old-layout')) && fs.existsSync(file));
    await page.click('.am-row[data-mod="reddit.com/old-layout"] .mod-delete');
    await until('deleted again', async () => !(await row('reddit.com/old-layout')));
    await page.evaluate(() => { document.querySelector('.am-deleted').open = true; });
    await until('Recently deleted', () => page.evaluate(() => !!document.querySelector('.am-trash-row[data-mod="reddit.com/old-layout"]')));
    await page.click('.am-trash-row[data-mod="reddit.com/old-layout"] .am-restore');
    await until('restored', async () => !!(await row('reddit.com/old-layout')) && fs.existsSync(file));

    // ---- a selection: turn off, export, delete ----
    await page.click('.am-row[data-mod="github.com/wide-diffs"] .am-check');
    await page.click('.am-row[data-mod="github.com/file-tree"] .am-check');
    assert.equal(await page.evaluate(() => document.querySelector('.am-sel-count').textContent), '2 selected');
    await page.click('.am-bulk-off');
    await until('both off', async () => { const d = await disabled(); return d['github.com/wide-diffs'] && d['github.com/file-tree']; });
    await page.click('.am-bulk-export');
    await until('the export', () => fs.existsSync(path.join(out, 'TRIF mods', 'github.com-wide-diffs.js')) && fs.existsSync(path.join(out, 'TRIF mods', 'github.com-file-tree.js')));
    await page.click('.am-bulk-delete');
    await until('both deleted', async () => !(await row('github.com/wide-diffs')) && !(await row('github.com/file-tree')));
    assert.match(await page.evaluate(() => document.querySelector('.am-toast-text').textContent), /Deleted 2 mods\./);
    await page.click('.am-toast .am-undo');
    await until('both back', async () => !!(await row('github.com/wide-diffs')) && !!(await row('github.com/file-tree')));

    // ---- 250 mods: the page keeps up ----
    writeFixtureMods(modsDir, { extra: 220 });
    await until('250 mods', () => page.evaluate(() => document.querySelectorAll('.am-row').length >= 251), 60000);
    const t = await page.evaluate(async () => {
      const A = window.__trifAllMods;
      const t0 = performance.now();
      await A.refresh();
      const refresh = performance.now() - t0;
      const s = document.querySelector('.am-search');
      const t1 = performance.now();
      s.value = 'filler 1'; s.dispatchEvent(new Event('input'));
      const search = performance.now() - t1;
      s.value = ''; s.dispatchEvent(new Event('input'));
      return { refresh, search, rows: document.querySelectorAll('.am-row').length };
    });
    console.log(`250+ mods: a refresh took ${t.refresh.toFixed(0)} ms, a search ${t.search.toFixed(0)} ms (${t.rows} rows)`);
    assert.ok(t.refresh < 1500 && t.search < 500, JSON.stringify(t));

    assert.deepEqual(pageErrors, []);

    // ---- the side panel's ⋯ menu and Settings open it: a new tab, then that one again ----
    await page.close();
    await ctl.close();
    const allmodsTabs = async () => (await browser.cdp.send('Target.getTargets')).targetInfos.filter((t) => t.type === 'page' && t.url.endsWith('/allmods.html')).length;
    const panel = await browser.newPage();
    const panelErrors = [];
    panel.on('pageerror', (e) => panelErrors.push(e.message));
    await panel.goto(`chrome-extension://${browser.extensionId}/sidepanel.html`);
    // (the panel, its approval card now approval.js's, starts as before: no website in its tab, the landing page)
    await until('the side panel', () => panel.evaluate(() => !document.getElementById('landing').hidden));
    assert.equal(await allmodsTabs(), 0);
    await panel.evaluate(() => { document.getElementById('all-mods').click(); });
    await until('the page opened from the ⋯ menu', async () => (await allmodsTabs()) === 1);
    await panel.evaluate(() => { document.getElementById('all-mods-link').click(); });
    await sleep(800);
    assert.equal(await allmodsTabs(), 1, 'Settings: the open one comes to the front, no second tab');
    assert.deepEqual(panelErrors, []);
  } finally {
    await browser.close();
    fs.rmSync(ext, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(`${home}-private`, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});

/** With ALLMODS_SHOTS, the page in light and dark (the whole page), as <name>-light.png and <name>-dark.png. */
async function shots(page, name, { width = 0 } = {}) {
  const dir = process.env.ALLMODS_SHOTS;
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  // (every site's box drawn, not only those near the screen: content-visibility skips the rest)
  await page.evaluate(() => { if (!document.getElementById('shot-style')) document.head.insertAdjacentHTML('beforeend', '<style id="shot-style">.am-group { content-visibility: visible !important; }</style>'); });
  if (width) await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
  for (const scheme of width ? ['light'] : ['light', 'dark']) {
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
    await sleep(300);
    const dialog = await page.evaluate(() => !!document.querySelector('dialog[open]'));
    const { data } = await page.send('Page.captureScreenshot', { format: 'png', ...(dialog ? {} : { captureBeyondViewport: true, clip: await page.evaluate(() => ({ x: 0, y: 0, width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight, scale: 1 })) }) });
    fs.writeFileSync(path.join(dir, `${name}-${scheme}.png`), Buffer.from(data, 'base64'));
  }
  await page.send('Emulation.setEmulatedMedia', { features: [] });
  if (width) await page.send('Emulation.clearDeviceMetricsOverride');
}
