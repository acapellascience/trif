'use strict';
// The Chrome Web Store TRIF next to the unpacked one: the store ID's one place (paths.js) and what reads it
// (setup's steps, doctor, the site's links), the helper telling each extension which TRIF it is, the two
// TRIFs in one profile finding each other (extension/twins.js), and the words for store users' updates.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { FakeExtension, tempDir, privDir, testEnv, REPO } = require('./fake-extension');
const { request } = require('../helper/lib/client');
const P = require('../helper/lib/paths');
const D = require('../helper/lib/doctor');
const U = require('../helper/lib/update');

const DEV = P.DEV_EXTENSION_ID;
const STORE = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const OTHER = 'abcdefghijklmnopabcdefghijklmnop';

test('paths: the store ID has one place, and nothing points at the store until it is set and listed', () => {
  // (while it's '' the slot is empty and nothing links to the store; tests must pass before and after it's filled in)
  assert.equal(typeof P.STORE_EXTENSION_ID, 'string');
  assert.ok(P.STORE_EXTENSION_ID === '' || /^[a-p]{32}$/.test(P.STORE_EXTENSION_ID), 'the store ID is empty or a real ID');
  assert.deepEqual(P.STORE_EXTENSION_IDS, P.STORE_EXTENSION_ID ? [P.STORE_EXTENSION_ID] : []);
  if (!P.STORE_EXTENSION_ID) assert.equal(P.storeListingUrl(), null);
  assert.equal(P.storeListingUrl({ id: STORE, listed: false }), null, 'not listed yet: no link');
  assert.equal(P.storeListingUrl({ id: '', listed: true }), null, 'no ID: no link');
  assert.equal(P.storeListingUrl({ id: STORE, listed: true }), `https://chromewebstore.google.com/detail/${STORE}`);
  assert.equal(P.extensionKind(DEV), 'unpacked');
  assert.equal(P.extensionKind(STORE, [STORE]), 'store');
  assert.equal(P.extensionKind(OTHER, [STORE]), 'other');
  assert.equal(P.extensionKind('nope'), null);
  assert.equal(P.callerExtensionId(`chrome-extension://${DEV}/`), DEV);
  assert.equal(P.callerExtensionId('/path/to/manifest.json'), null, "Firefox's first argument is the manifest's path");
  assert.equal(P.callerExtensionId(undefined), null);
});

test('doctor: install from the store once it is listed (Load unpacked as the other way), never from a checkout', () => {
  const store = `https://chromewebstore.google.com/detail/${STORE}`;
  assert.match(D.installHow('/x/extension', { store: null, checkout: false }), /^Load unpacked from \/x\/extension; its ID must be /);
  assert.equal(D.installHow('/x/extension', { store, checkout: false }), `from the Chrome Web Store, ${store} (or Load unpacked from /x/extension; its ID must be ${DEV})`);
  assert.match(D.installHow('/x/extension', { store, checkout: true }), /^Load unpacked/);
  const fix = D.helperDownFix({ chromium: ['Google Chrome'], extensionDir: '/x/extension', store, checkout: false }).join('\n');
  assert.ok(fix.includes(store), fix);
  assert.ok(fix.includes('Load unpacked from /x/extension'), fix);
});

test('doctor: TRIF installed twice, and a store extension behind the helper', () => {
  const twice = D.storeChecks({ helper: '0.3.1', extension: { id: STORE, kind: 'store', version: '0.3.1', browser: 'Chrome' }, twins: { others: [{ id: DEV, kind: 'unpacked', version: '0.3.1' }], standingDown: false } });
  assert.equal(twice.length, 1);
  assert.equal(twice[0].status, 'warn');
  assert.match(twice[0].title, /installed twice/);
  assert.ok(twice[0].fix.includes(`chrome://extensions/?id=${DEV}`), 'says which one to remove');
  // (the unpacked one's own helper says the same, about itself)
  const self = D.storeChecks({ helper: '0.3.1', extension: { id: DEV, kind: 'unpacked', version: '0.3.1' }, twins: { others: [{ id: STORE, kind: 'store' }], standingDown: true } });
  assert.match(self[0].title, /leaves the sites/);
  assert.ok(self[0].fix.includes(DEV));
  assert.deepEqual(D.storeChecks({ helper: '0.3.1', extension: { id: DEV, kind: 'unpacked', version: '0.3.1' }, twins: null }), []);
  const behind = D.storeChecks({ helper: '0.3.2', extension: { id: STORE, kind: 'store', version: '0.3.1' }, twins: null });
  assert.equal(behind.length, 1);
  assert.equal(behind[0].status, 'info', 'not a problem: the store updates it');
  assert.match(behind[0].title, /Chrome Web Store by itself/);
  assert.deepEqual(D.storeChecks({ helper: '0.3.2', extension: { id: DEV, kind: 'unpacked', version: '0.3.1' } }), [], 'the unpacked one: the existing version check says so');
  // Both kinds connected but neither found the other (an unpacked one from before 0.3.1 can't answer):
  const info = (id, kind, extra = {}) => ({ extension: { id, kind, version: '0.3.1', browser: 'Chrome', chrome: '142' }, ...extra });
  const both = D.bothKindsConnected(info(STORE, 'store'), [{ info: info(DEV, 'unpacked') }]);
  assert.match(both.title, /if they're in the same profile/);
  assert.ok(both.fix.includes(DEV));
  assert.equal(D.bothKindsConnected(info(STORE, 'store', { twins: { others: [] } }), [{ info: info(DEV, 'unpacked') }]), null, 'the extensions said: no guessing');
  assert.equal(D.bothKindsConnected(info(DEV, 'unpacked'), [{ info: { extension: { ...info(STORE, 'store').extension, browser: 'Firefox' } } }]), null);
});

function setupSteps(opts) {
  const root = tempDir();
  const home = path.join(root, 'ws');
  const native = path.join(root, 'native');
  const script = `const { setup } = require(${JSON.stringify(path.join(REPO, 'helper', 'lib', 'setup.js'))});
    const r = setup(${JSON.stringify({ home, nativeDir: native, noLink: true, noExamples: true, ...opts })});
    process.stdout.write(JSON.stringify({ lines: r.lines, store: r.store }));`;
  const r = spawnSync(process.execPath, ['-e', script], { env: testEnv(home), encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test('setup: Chrome Web Store steps once it is listed, Load unpacked until then and from a checkout', () => {
  const store = `https://chromewebstore.google.com/detail/${STORE}`;
  const listed = setupSteps({ mode: 'copy', storeUrl: store });
  const text = listed.lines.join('\n');
  assert.equal(listed.store, store);
  assert.match(text, /1\. Install the extension from the Chrome Web Store: click "Add to Chrome"\./);
  assert.ok(text.includes(store));
  assert.match(text, /Load unpacked" and choose .*extension/, 'Load unpacked is still there, as the other way');
  assert.match(text, /Already have TRIF loaded unpacked\?/);
  assert.match(text, /2\. Turn on "Allow User Scripts"/);
  const unlisted = setupSteps({ mode: 'copy', storeUrl: null }).lines.join('\n');
  assert.match(unlisted, /Until TRIF is on the Chrome Web Store, load it unpacked/);
  assert.doesNotMatch(unlisted, /chromewebstore/);
  const checkout = setupSteps({ mode: 'link', storeUrl: store }).lines.join('\n');
  assert.match(checkout, /From a checkout, load it unpacked/);
  assert.doesNotMatch(checkout, /chromewebstore/);
});

test('setup wait: says the Web Store when the steps did', () => {
  const { waitingFor } = require('../helper/lib/setupwait');
  const chrome = [{ key: 'chrome', label: 'Google Chrome' }];
  assert.equal(waitingFor(chrome).how, 'drag the folder onto chrome://extensions');
  assert.equal(waitingFor(chrome, { store: true }).how, 'add TRIF from the Chrome Web Store');
});

test('update: never says the store extension updated', () => {
  assert.equal(U.storeNote(['unpacked']), null);
  assert.equal(U.storeNote([]), null);
  assert.match(U.storeNote(['unpacked', 'store']), /Chrome Web Store isn't updated here/);
  const src = fs.readFileSync(path.join(REPO, 'helper', 'lib', 'update.js'), 'utf8');
  assert.match(src, /Nothing here may say the store's extension updated/);
});

test('helper: tells the extension which TRIF it is (from Chrome\'s argument) and the other TRIF IDs; keeps what it finds', async (t) => {
  const home = tempDir();
  fs.writeFileSync(path.join(privDir(home), 'config.json'), JSON.stringify({ extensionIds: [OTHER] }));
  const ext = new FakeExtension({ home });
  t.after(() => ext.close());
  ext.hello({ features: ['modsParts'] });
  const id = await ext.next((m) => m.type === 'identity');
  assert.equal(id.id, DEV);
  assert.equal(id.kind, 'unpacked');
  assert.deepEqual(id.others, [...P.STORE_EXTENSION_IDS.map((s) => ({ id: s, kind: 'store' })), { id: OTHER, kind: 'other' }]);
  await ext.waitForSocket();
  let info = await request(ext.sock, 'ping', {}, 5000);
  assert.equal(info.extension.id, DEV);
  assert.equal(info.extension.kind, 'unpacked');
  assert.equal(info.twins, null);
  // The extension found another TRIF in its profile (background.js findTwins):
  ext.send({ type: 'twins', others: [{ id: OTHER, version: '0.3.1', ready: true }], standingDown: true });
  for (let i = 0; i < 50 && !info.twins; i++) { await new Promise((r) => setTimeout(r, 50)); info = await request(ext.sock, 'ping', {}, 5000); }
  assert.deepEqual(info.twins.others, [{ id: OTHER, kind: 'other', version: '0.3.1' }]);
  assert.equal(info.twins.standingDown, true);
  ext.send({ type: 'twins', others: [] });
  for (let i = 0; i < 50 && info.twins; i++) { await new Promise((r) => setTimeout(r, 50)); info = await request(ext.sock, 'ping', {}, 5000); }
  assert.equal(info.twins, null, 'gone again');
  // (the update info says where this extension's updates come from: with the helper, for the unpacked one)
  const u = await ext.next((m) => m.type === 'update');
  assert.equal(u.update.extensionUpdates, 'helper');
});

test('helper: a store build loaded unpacked (another ID) is told it is "other", with the unpacked one among the others', async (t) => {
  const home = tempDir();
  fs.writeFileSync(path.join(privDir(home), 'config.json'), JSON.stringify({ extensionIds: [OTHER] }));
  const ext = new FakeExtension({ home, origin: `chrome-extension://${OTHER}/` });
  t.after(() => ext.close());
  ext.hello({ features: ['modsParts'] });
  const id = await ext.next((m) => m.type === 'identity');
  assert.equal(id.kind, 'other');
  assert.ok(id.others.some((o) => o.id === DEV && o.kind === 'unpacked'));
  assert.ok(!id.others.some((o) => o.id === OTHER), 'not itself');
});

test('twins: the unpacked TRIF leaves the store one\'s sites to it, only for TRIF IDs the helper named', async () => {
  const T = await import('../extension/twins.js');
  const unpacked = T.normalizeIdentity({ id: DEV, kind: 'unpacked', others: [{ id: STORE, kind: 'store' }, { id: 'nope', kind: 'store' }, { id: DEV, kind: 'unpacked' }] });
  assert.deepEqual(unpacked.others, [{ id: STORE, kind: 'store' }], 'bad and own IDs dropped');
  assert.equal(T.normalizeIdentity({ id: DEV, kind: 'weird' }), null);
  const storeMsg = T.twinState({ version: '0.3.1', kind: 'store', connected: true, userScripts: true, paused: false, sites: ['x.com', 'google.com'] });
  assert.equal(storeMsg.type, T.TWIN_MESSAGE);
  assert.equal(storeMsg.ready, true);
  const twin = T.readTwin(unpacked, STORE, storeMsg);
  assert.deepEqual(twin, { id: STORE, kind: 'store', version: '0.3.1', ready: true, sites: ['x.com', 'google.com'] });
  assert.equal(T.readTwin(unpacked, OTHER, storeMsg), null, 'an extension the helper didn\'t name is ignored');
  assert.equal(T.readTwin(unpacked, STORE, { ...storeMsg, type: 'other' }), null);
  assert.deepEqual(T.cededSites(unpacked, [twin]), ['google.com', 'x.com']);
  // (the store one never leaves a site; a twin that can't run mods yet takes none)
  const store = T.normalizeIdentity({ id: STORE, kind: 'store', others: [{ id: DEV, kind: 'unpacked' }] });
  assert.deepEqual(T.cededSites(store, [{ id: DEV, kind: 'unpacked', ready: true, sites: ['x.com'] }]), []);
  const notReady = T.readTwin(unpacked, STORE, T.twinState({ version: '0.3.1', kind: 'store', connected: true, userScripts: false, sites: ['x.com'] }));
  assert.deepEqual(notReady.sites, [], 'user scripts off there: it runs nothing, so nothing is left to it');
  assert.deepEqual(T.cededSites(unpacked, [notReady]), []);
  assert.deepEqual(T.twinState({ kind: 'store', connected: true, userScripts: true, paused: true, sites: ['x.com'] }).sites, []);
  // What each panel says:
  assert.deepEqual(T.twinNotice(unpacked, [twin]), { me: 'unpacked', other: STORE, ceded: 2, otherReady: true });
  assert.deepEqual(T.twinNotice(store, [{ id: DEV, kind: 'unpacked', ready: true, sites: ['bbc.co.uk'] }]), { me: 'store', other: DEV, otherRunning: true });
  assert.deepEqual(T.twinNotice(store, [{ id: DEV, kind: 'unpacked', ready: true, sites: [] }]), { me: 'store', other: DEV, otherRunning: false });
  assert.equal(T.twinNotice(unpacked, []), null);
  assert.equal(T.twinNotice(null, [twin]), null);
});

test('extension: no page can send the twins\' messages (no externally_connectable), and the panel has their notice', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO, 'extension', 'manifest.json'), 'utf8'));
  assert.equal(manifest.externally_connectable, undefined);
  const bg = fs.readFileSync(path.join(REPO, 'extension', 'background.js'), 'utf8');
  assert.match(bg, /onMessageExternal\?\.addListener/);
  assert.match(bg, /sitesOn: state\.paused \? \[\] : runningSites\(\)/, 'mods register only on the sites this TRIF runs');
  const html = fs.readFileSync(path.join(REPO, 'extension', 'sidepanel.html'), 'utf8');
  assert.match(html, /<section id="twin" class="notice bad" hidden>/);
});

test('site: /privacy is store/PRIVACY.md (its module up to date), /support loads, /chrome goes to the listing or the README', async () => {
  const B = await import('../site/build-pages.js');
  assert.equal(fs.readFileSync(B.OUT, 'utf8'), B.pagesModule(), 'run: node site/build-demo.js');
  const worker = (await import('../site/src/index.js')).default;
  const get = (p) => worker.fetch(new Request(`https://timsrobot.com${p}`), {});
  const md = fs.readFileSync(B.PRIVACY_MD, 'utf8');
  const res = await get('/privacy');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /<h1>Privacy policy<\/h1>/);
  assert.ok(html.includes(`Last updated: ${/^Last updated:\s*(.*)$/m.exec(md)[1]}`));
  for (const [, h] of md.matchAll(/^## (.*)$/gm)) assert.ok(html.includes(`>${B.inline(h)}</h2>`), h);
  assert.match(html, /<a href="mailto:privacy@timsrobot.com">privacy@timsrobot.com<\/a>/);
  assert.match(html, /<table>/);
  assert.doesNotMatch(html, /\*\*|<script/, 'no markdown left over, no script');
  const support = await get('/support');
  assert.equal(support.status, 200);
  assert.match(await support.text(), /trif doctor/);
  const chrome = await get('/chrome');
  assert.equal(chrome.status, 302);
  const { STORE_URL } = await import('../site/src/pages-data.js');
  assert.equal(chrome.headers.get('location'), STORE_URL || 'https://github.com/acapellascience/trif#install');
  assert.equal(STORE_URL, P.storeListingUrl());
  const home = await (await get('/')).text();
  assert.match(home, /<a href="\/privacy">Privacy<\/a>/);
  assert.match(home, /<a href="\/support">Support<\/a>/);
  // (the markdown it understands)
  assert.equal(B.markdownToHtml('a **b** `c*d*` [e](https://x.y/) https://z.w/a.\n\n- one\n  more\n- two'),
    '<p>a <strong>b</strong> <code>c*d*</code> <a href="https://x.y/">e</a> <a href="https://z.w/a">https://z.w/a</a>.</p>\n<ul><li>one more</li><li>two</li></ul>');
});
