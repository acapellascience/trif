'use strict';
// Which browser TRIF says it's in (0.3.2): the extension's own signals (extension/lib.js browserFromSignals,
// detectBrowser: navigator.userAgentData.brands, navigator.brave, Vivaldi's tab fields, Arc's missing side
// panel, Firefox's getBrowserInfo), the helper's (helper/lib/browsers.js: the executable that started it),
// how the two agree, and where the name shows (hello, `trif status`, `trif doctor`, reports, --browser).

const test = require('node:test');
const assert = require('node:assert');
const net = require('net');
const { FakeExtension, runCli, tempDir, waitFor } = require('./fake-extension');
const B = require('../helper/lib/browsers');

let lib, shots;
test.before(async () => {
  lib = await import('../extension/lib.js');
  shots = await import('../extension/screenshot.js');
});

const brands = (...names) => names.map(([brand, version = '156']) => ({ brand, version }));
const GREASE = ['Not.A/Brand', '99'];

// ------------------------------------------------------------------ the extension's signals

test('browserFromSignals: Chromium browsers by their brands', () => {
  const name = (b, more = {}) => lib.browserFromSignals({ family: 'chromium', brands: b, ...more });
  assert.equal(name(brands(['Google Chrome'], ['Chromium'], GREASE)), 'Chrome');
  assert.equal(name(brands(['Chromium'], GREASE)), 'Chromium');
  assert.equal(name(brands(GREASE, ['Microsoft Edge'], ['Chromium'])), 'Edge');
  assert.equal(name(brands(['Opera', '120'], ['Chromium'], GREASE)), 'Opera');
  assert.equal(name(brands(['Opera GX', '120'], ['Chromium'], GREASE)), 'Opera GX');
  assert.equal(name(brands(['Brave'], ['Chromium'], GREASE)), 'Brave');
  // GREASE in its other spellings is never taken for a name
  assert.equal(name(brands(['Not)A;Brand', '8'], ['Chromium'])), 'Chromium');
  assert.equal(name(brands(['Not_A Brand', '24'], ['Chromium'])), 'Chromium');
  // a brand TRIF doesn't know: its own name
  assert.equal(name(brands(['YaBrowser', '25'], ['Chromium'], GREASE)), 'YaBrowser');
});

test('browserFromSignals: Brave by navigator.brave, Vivaldi by its tabs, Arc by its missing side panel', () => {
  const chromeBrands = brands(['Google Chrome'], ['Chromium'], GREASE);
  assert.equal(lib.browserFromSignals({ family: 'chromium', brands: brands(['Chromium'], GREASE), brave: true }), 'Brave');
  assert.equal(lib.browserFromSignals({ family: 'chromium', brands: chromeBrands, vivaldi: true }), 'Vivaldi');
  assert.equal(lib.browserFromSignals({ family: 'chromium', brands: chromeBrands, panelInWindow: true }), 'Arc');
  assert.equal(lib.browserFromSignals({ family: 'chromium', brands: brands(['Chromium'], GREASE), panelInWindow: true }), 'Arc');
  // a browser that names itself isn't taken for Arc for want of a side panel
  assert.equal(lib.browserFromSignals({ family: 'chromium', brands: brands(['Microsoft Edge'], ['Chromium']), panelInWindow: true }), 'Edge');
});

test('browserFromSignals: without brands, the user-agent string; Firefox and its forks; Safari', () => {
  const ua = (s) => lib.browserFromSignals({ family: 'chromium', userAgent: s });
  assert.equal(ua('Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'), 'Chrome');
  assert.equal(ua('Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0'), 'Edge');
  assert.equal(ua('Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36 OPR/106.0.0.0'), 'Opera');
  assert.equal(ua(''), 'Chrome');
  // brands, when there are any, win over the string
  assert.equal(lib.browserFromSignals({ family: 'chromium', brands: brands(['Google Chrome']), userAgent: 'Edg/1' }), 'Chrome');

  assert.equal(lib.browserFromSignals({ family: 'firefox' }), 'Firefox');
  assert.equal(lib.browserFromSignals({ family: 'firefox', firefoxName: 'Firefox' }), 'Firefox');
  assert.equal(lib.browserFromSignals({ family: 'firefox', firefoxName: 'LibreWolf' }), 'LibreWolf');
  assert.equal(lib.browserFromSignals({ family: 'firefox', firefoxName: '<b>x</b>' }), 'Firefox');
  assert.equal(lib.browserFromSignals({ family: 'firefox', firefoxName: 'x'.repeat(80) }), 'Firefox');
  assert.equal(lib.browserFromSignals({ family: 'safari', brands: brands(['Google Chrome']) }), 'Safari');
});

test('detectBrowser: waits for navigator.brave, Vivaldi tabs and the brand version; leaves out what fails', async () => {
  const nav = (b, extra = {}) => ({
    userAgent: 'Mozilla/5.0 Chrome/156.0.0.0',
    userAgentData: { brands: b, getHighEntropyValues: async () => ({ fullVersionList: b.map((x) => ({ brand: x.brand, version: `${x.version}.0.1234.5` })) }) },
    ...extra,
  });
  const api = (tabs = [{ id: 1 }]) => ({ tabs: { query: async () => tabs } });

  let r = await lib.detectBrowser({ family: 'chromium', nav: nav(brands(['Google Chrome'], ['Chromium'], GREASE)), api: api() });
  assert.deepEqual(r, { name: 'Chrome', version: '156.0.1234.5' });

  r = await lib.detectBrowser({ family: 'chromium', nav: nav(brands(['Opera', '120'], ['Chromium'], GREASE)), api: api() });
  assert.deepEqual(r, { name: 'Opera', version: '120.0.1234.5' }, "Opera's own version, not Chromium's");

  r = await lib.detectBrowser({ family: 'chromium', nav: nav(brands(['Microsoft Edge'], ['Chromium'])), api: api() });
  assert.equal(r.name, 'Edge');
  assert.equal(r.version, '156.0.1234.5');

  r = await lib.detectBrowser({ family: 'chromium', nav: nav(brands(['Chromium'], GREASE), { brave: { isBrave: async () => true } }), api: api() });
  assert.equal(r.name, 'Brave');

  r = await lib.detectBrowser({ family: 'chromium', nav: nav(brands(['Google Chrome'], ['Chromium'])), api: api([{ id: 1, vivExtData: '{}' }]) });
  assert.equal(r.name, 'Vivaldi');

  r = await lib.detectBrowser({ family: 'chromium', nav: nav(brands(['Google Chrome'], ['Chromium'])), api: api(), panelInWindow: true });
  assert.equal(r.name, 'Arc');

  // Signals that throw, reject or never answer (within a second) count as none.
  const t0 = Date.now();
  r = await lib.detectBrowser({
    family: 'chromium',
    nav: { userAgentData: { brands: brands(['Google Chrome']), getHighEntropyValues: () => new Promise(() => {}) }, brave: { isBrave: () => Promise.reject(new Error('no')) } },
    api: { tabs: { query: () => { throw new Error('no tabs'); } } },
  });
  assert.deepEqual(r, { name: 'Chrome', version: null });
  assert.ok(Date.now() - t0 < 3000);
});

test('detectBrowser: Firefox forks by getBrowserInfo, with their own version; Safari', async () => {
  const ff = (info) => ({ runtime: { getBrowserInfo: async () => info } });
  assert.deepEqual(await lib.detectBrowser({ family: 'firefox', ff: ff({ name: 'Firefox', version: '159.0' }) }), { name: 'Firefox', version: null });
  assert.deepEqual(await lib.detectBrowser({ family: 'firefox', ff: ff({ name: 'LibreWolf', version: '140.0.4-1' }) }), { name: 'LibreWolf', version: '140.0.4-1' });
  assert.deepEqual(await lib.detectBrowser({ family: 'firefox', ff: {}, api: {} }), { name: 'Firefox', version: null });
  assert.deepEqual(await lib.detectBrowser({ family: 'safari' }), { name: 'Safari', version: null });
});

test('setBrowser: every importer sees the new name (a live binding); names that aren\'t names are ignored', () => {
  const before = lib.BROWSER;
  try {
    assert.equal(lib.setBrowser('Brave'), 'Brave');
    assert.equal(lib.BROWSER, 'Brave');
    lib.setBrowser('<script>');
    lib.setBrowser('');
    lib.setBrowser(null);
    assert.equal(lib.BROWSER, 'Brave');
  } finally { lib.setBrowser(before); }
  assert.equal(lib.FAMILY, 'chromium');
});

test('screenshotPlan: a Firefox fork gets Firefox\'s handling, under its own name', () => {
  const r = shots.screenshotPlan({ showing: false, browser: 'LibreWolf', family: 'firefox', allUrls: true });
  assert.match(r.error, /after LibreWolf started.*quit and reopen LibreWolf/);
  // (without `family`, the name tells, as before)
  assert.match(shots.screenshotPlan({ showing: false, browser: 'Firefox', allUrls: true }).error, /quit and reopen Firefox/);
  assert.match(shots.screenshotPlan({ showing: false, full: true, browser: 'Brave', allUrls: true }).error, /a full page in Brave/);
});

// ------------------------------------------------------------------ the helper's signals

test('browserFromExecutable: Mac app bundles', () => {
  const mac = (p) => B.browserFromExecutable(p, 'darwin');
  assert.deepEqual(mac('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'), { name: 'Chrome', family: 'chromium' });
  assert.equal(mac('/x/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing').name, 'Chrome');
  assert.equal(mac('/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary').name, 'Chrome');
  assert.equal(mac('/Applications/Brave Browser.app/Contents/MacOS/Brave Browser').name, 'Brave');
  assert.equal(mac('/Applications/Microsoft Edge Beta.app/Contents/MacOS/Microsoft Edge Beta').name, 'Edge');
  assert.equal(mac('/Applications/Opera.app/Contents/MacOS/Opera').name, 'Opera');
  assert.equal(mac('/Applications/Opera GX.app/Contents/MacOS/Opera').name, 'Opera GX');
  assert.equal(mac('/Applications/Vivaldi.app/Contents/MacOS/Vivaldi').name, 'Vivaldi');
  assert.equal(mac('/Applications/Arc.app/Contents/MacOS/Arc').name, 'Arc');
  assert.equal(mac('/Applications/Chromium.app/Contents/MacOS/Chromium').name, 'Chromium');
  assert.deepEqual(mac('/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox'), { name: 'Firefox', family: 'firefox' });
  assert.deepEqual(mac('/Applications/LibreWolf.app/Contents/MacOS/librewolf'), { name: 'LibreWolf', family: 'firefox' });
  assert.equal(mac('/Applications/Zen.app/Contents/MacOS/zen').name, 'Zen');
  // the outermost bundle: a browser's helper app inside it is still that browser
  assert.equal(mac('/Applications/Brave Browser.app/Contents/Frameworks/Brave Browser Framework.framework/Helpers/Brave Browser Helper.app/Contents/MacOS/Brave Browser Helper').name, 'Brave');
  // not a browser: node (a terminal, the Safari bridge, a test), or no path
  assert.equal(mac('/usr/local/bin/node'), null);
  assert.equal(mac('/Applications/Safari.app/Contents/MacOS/Safari'), null);
  assert.equal(mac('/Applications/Archive Utility.app/Contents/MacOS/Archive Utility'), null);
  assert.equal(mac(''), null);
  assert.equal(mac(null), null);
});

test('browserFromExecutable: Linux paths', () => {
  const linux = (p) => B.browserFromExecutable(p, 'linux')?.name ?? null;
  assert.equal(linux('/opt/google/chrome/chrome'), 'Chrome');
  assert.equal(linux('/snap/chromium/3000/usr/lib/chromium-browser/chrome'), 'Chromium');
  assert.equal(linux('/usr/lib/chromium/chromium'), 'Chromium');
  assert.equal(linux('/opt/brave.com/brave/brave'), 'Brave');
  assert.equal(linux('/opt/microsoft/msedge/msedge'), 'Edge');
  assert.equal(linux('/opt/vivaldi/vivaldi-bin'), 'Vivaldi');
  assert.equal(linux('/usr/lib/x86_64-linux-gnu/opera/opera'), 'Opera');
  assert.equal(linux('/usr/lib/firefox/firefox'), 'Firefox');
  assert.equal(linux('/usr/bin/node'), null);
});

test('executableOf / launchingBrowser: the parent process by ps (or TRIF_LAUNCHER); nothing for pid 1', async () => {
  const seen = [];
  const run = async (args) => { seen.push(args); return '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser\n'; };
  assert.equal(await B.executableOf(4242, { platform: 'darwin', run }), '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser');
  assert.deepEqual(seen, [['-o', 'comm=', '-p', '4242']]);
  assert.equal(await B.executableOf(1, { platform: 'darwin', run }), null, 'launchd: not a browser, not asked');
  assert.equal(await B.executableOf(4242, { platform: 'darwin', run: async () => '' }), null);
  assert.equal(await B.executableOf(4242, { platform: 'darwin', run: async () => { throw new Error('no ps'); } }), null);

  assert.deepEqual(await B.launchingBrowser({ pid: 4242, platform: 'darwin', env: {}, run }),
    { name: 'Brave', family: 'chromium', exe: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser' });
  const viaEnv = await B.launchingBrowser({ pid: 4242, platform: 'darwin', env: { TRIF_LAUNCHER: '/Applications/Arc.app/Contents/MacOS/Arc' }, run });
  assert.equal(viaEnv.name, 'Arc');
  assert.equal(await B.launchingBrowser({ pid: 4242, platform: 'darwin', env: {}, run: async () => '/usr/local/bin/node' }), null);
});

test('reconcileBrowser: the launcher names it, but not over a name the extension found itself', () => {
  const chrome = { name: 'Chrome', family: 'chromium' };
  const arc = { name: 'Arc', family: 'chromium' };
  const vivaldi = { name: 'Vivaldi', family: 'chromium' };
  const firefox = { name: 'Firefox', family: 'firefox' };
  // no launcher (a terminal, Safari's bridge): what the extension says; before 0.3.2 an extension said nothing for Chrome
  assert.equal(B.reconcileBrowser({ browser: 'Edge' }, null), 'Edge');
  assert.equal(B.reconcileBrowser({}, null), 'Chrome');
  // the launcher over a plain name and over Arc's guess
  assert.equal(B.reconcileBrowser({ browser: 'Chrome', family: 'chromium' }, arc), 'Arc');
  assert.equal(B.reconcileBrowser({ browser: 'Chrome', family: 'chromium' }, vivaldi), 'Vivaldi');
  assert.equal(B.reconcileBrowser({ browser: 'Arc', family: 'chromium' }, chrome), 'Chrome', 'Chrome for Testing without a side panel (the e2e test)');
  assert.equal(B.reconcileBrowser({ browser: 'Chrome' }, { name: 'Brave', family: 'chromium' }), 'Brave', 'an extension from before 0.3.2');
  // the extension's own particular name over the launcher's plain one
  assert.equal(B.reconcileBrowser({ browser: 'Brave', family: 'chromium' }, chrome), 'Brave');
  assert.equal(B.reconcileBrowser({ browser: 'LibreWolf', family: 'firefox' }, firefox), 'LibreWolf');
  // a launcher of another kind than the extension is ignored
  assert.equal(B.reconcileBrowser({ browser: 'Firefox', family: 'firefox' }, chrome), 'Firefox');
  assert.equal(B.reconcileBrowser({ browser: 'Safari', family: 'safari' }, chrome), 'Safari');
});

test('browserFamily, browserKey, browserLabel', () => {
  assert.equal(B.browserFamily({ browser: 'Firefox' }), 'firefox');
  assert.equal(B.browserFamily({ browser: 'Safari' }), 'safari');
  assert.equal(B.browserFamily({ browser: 'Chrome' }), 'chromium');
  assert.equal(B.browserFamily({ browser: 'LibreWolf', family: 'firefox' }), 'firefox');
  assert.equal(B.browserFamily({ browser: 'Brave', family: 'bogus' }), 'chromium');
  assert.equal(B.browserFamily(null), 'chromium');
  // switches stay under the key they had when every Chromium was "Chrome"
  assert.equal(B.browserKey({ browser: 'Brave', family: 'chromium' }), 'Chrome');
  assert.equal(B.browserKey({ browser: 'LibreWolf', family: 'firefox' }), 'Firefox');
  assert.equal(B.browserKey({ browser: 'Safari' }), 'Safari');
  assert.equal(B.browserLabel({ browser: 'Opera', chrome: '156.0.0.0', browserVersion: '120.0.5543.93' }), 'Opera 120.0.5543.93');
  assert.equal(B.browserLabel({ browser: 'Chrome', chrome: '156.0.0.0' }), 'Chrome 156.0.0.0');
  assert.equal(B.browserLabel({ chrome: '140.0.0.0' }), 'Chrome 140.0.0.0');
  assert.equal(B.browserLabel(null), 'Chrome');
});

// ------------------------------------------------------------------ the helper, end to end

function sockRequest(sock, msg, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const s = net.connect(sock);
    let buf = '';
    const t = setTimeout(() => { s.destroy(); reject(new Error('socket request timed out')); }, timeout);
    s.setEncoding('utf8');
    s.on('connect', () => s.write(JSON.stringify(msg) + '\n'));
    s.on('data', (d) => {
      buf += d;
      const nl = buf.indexOf('\n');
      if (nl !== -1) { clearTimeout(t); s.destroy(); resolve(JSON.parse(buf.slice(0, nl))); }
    });
    s.on('error', (e) => { clearTimeout(t); reject(e); });
  });
}

const VERSION = require('../package.json').version;
let reqN = 0;
function extRequest(ext, cmd, args = {}) {
  const id = `b${++reqN}`;
  ext.send({ type: 'request', id, cmd, args });
  return ext.next((m) => m.type === 'response' && m.id === id, { timeout: 20000 });
}

test('helper: started by Arc, it tells the extension (which says Chrome) the name; status, doctor and reports say Arc', async (t) => {
  const home = tempDir();
  const ext = new FakeExtension({ home, env: { TRIF_LAUNCHER: process.platform === 'darwin' ? '/Applications/Arc.app/Contents/MacOS/Arc' : '/opt/arc/Arc' } });
  t.after(() => ext.close());
  if (process.platform !== 'darwin') { t.skip('Arc is a Mac browser'); return; }
  await ext.waitForSocket(15000);
  ext.send({ type: 'hello', version: VERSION, userScripts: true, chrome: '156.0.0.0', browser: 'Chrome', family: 'chromium', browserVersion: '156.0.8078.80' });
  const named = await ext.next((m) => m.type === 'browser', { timeout: 10000 });
  assert.equal(named.name, 'Arc');
  const ping = await sockRequest(ext.sock, { id: 1, cmd: 'ping' });
  assert.equal(ping.result.extension.browser, 'Arc');
  assert.equal(ping.result.extension.family, 'chromium');

  ext.handlers.status = () => ({ userScripts: true, chrome: '156.0.0.0', browser: 'Arc', family: 'chromium', browserVersion: '156.0.8078.80', version: VERSION, mods: [], recording: [] });
  let r = await runCli(['status'], { home });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /extension {5}v\S+ on Arc 156\.0\.8078\.80/);
  r = await runCli(['doctor'], { home });
  assert.match(r.stdout, /extension v\S+ on Arc 156\.0\.8078\.80/);
  const rep = await extRequest(ext, 'report.build', { site: '', mods: [] });
  assert.equal(rep.ok, true, rep.error);
  assert.match(rep.result.text, /Browser {5}Arc 156\.0\.8078\.80 \(extension /);
});

test('helper: without a browser for a parent, the extension\'s name stands, and no name is sent back', async (t) => {
  const home = tempDir();
  const ext = new FakeExtension({ home });
  t.after(() => ext.close());
  await ext.waitForSocket(15000);
  ext.send({ type: 'hello', version: VERSION, userScripts: true, chrome: '159.0', browser: 'LibreWolf', family: 'firefox', browserVersion: '140.0.4-1' });
  await waitFor(async () => (await sockRequest(ext.sock, { id: 1, cmd: 'ping' })).result.extension, { timeout: 10000, message: 'hello' });
  const ping = await sockRequest(ext.sock, { id: 2, cmd: 'ping' });
  assert.equal(ping.result.extension.browser, 'LibreWolf');
  assert.equal(ext.messages.filter((m) => m.type === 'browser').length, 0);
  // a Firefox fork gets Firefox's advice, under its own name
  ext.handlers.status = () => ({ userScripts: false, chrome: '159.0', browser: 'LibreWolf', family: 'firefox', browserVersion: '140.0.4-1', version: VERSION, mods: [], recording: [] });
  const r = await runCli(['status'], { home });
  assert.match(r.stdout, /on LibreWolf 140\.0\.4-1/);
  assert.match(r.stdout, /click the TRIF toolbar button in LibreWolf, then "Allow user scripts"/);
});

test('trif --browser chrome still reaches a Chromium browser TRIF now names (Brave); --browser brave too', async (t) => {
  const home = tempDir();
  const a = new FakeExtension({ home });
  t.after(() => a.close());
  await a.waitForSocket(15000);
  a.send({ type: 'hello', version: VERSION, userScripts: true, chrome: '156.0.0.0', browser: 'Brave', family: 'chromium' });
  a.handlers.tabs = () => [{ id: 1, windowId: 1, active: true, url: 'https://a.example/', title: 'A' }];
  await waitFor(async () => (await sockRequest(a.ownSock, { id: 1, cmd: 'ping' })).result.extension, { timeout: 10000, message: 'hello' });
  for (const name of ['chrome', 'Brave', 'brave']) {
    const r = await runCli(['tabs', '--json', '--browser', name], { home });
    assert.equal(r.code, 0, `${name}: ${r.stderr}`);
    assert.equal(JSON.parse(r.stdout)[0].url, 'https://a.example/');
  }
  const r = await runCli(['tabs', '--browser', 'edge'], { home });
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /no connected browser matches --browser edge\. Connected: Brave 156\.0\.0\.0/);
});
