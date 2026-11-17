'use strict';
// Settings' Connect a phone (extension/phonelink.js, docs/PHONE-LINK.md section 7) in a real browser, with the
// real helper behind it: TRIF's own extension in headless Chrome for Testing (tests/cdp-page.js: muted, one
// browser at a time, the memory guard), its side panel's page in a tab as narrow as a side panel, and
// helper/host.js started by the browser itself over native messaging, in a temp workspace with a fake
// keychain, a stand-in dns-sd (nothing is announced on the Wi-Fi) and the listener on 127.0.0.1 alone.
// What it looks at: each state of the section (off, the code, on with no phones, a phone listed, two, one
// removed, off with phones kept), light and dark; that the code on screen reads back, from a screenshot's
// pixels with macOS's own reader (Vision), as the text the helper made, and that a stand-in phone
// (tests/phone-link-client.js) pairs with exactly that; that nothing in the section is wider than the panel;
// that the section scrolls with Settings in a short window.
//
// macOS and local only (as tests/run-sandbox.test.js is): TRIF_BROWSER_TESTS=1, with Chrome for Testing
// (TRIF_E2E_CHROME) and Xcode's `swift`. PHONE_LINK_SHOTS=<dir> also saves the screenshots there. The codes
// in them are a scratch helper's: its key and its one-time secrets are gone when the test ends.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawnSync } = require('child_process');
const { browserTestsSkip, launch } = require('./cdp-page');
const { tempDir, testEnv, waitFor, HOST_JS, REPO } = require('./fake-extension');
const { makeFakeKeychain } = require('./fake-keychain');
const { makeStandIn } = require('./fake-dns-sd');
const { PhoneClient } = require('./phone-link-client');
const { generateKeyPair } = require('../helper/lib/phonelink/noise');

const SWIFT = '/usr/bin/swift';
const skip = process.env.TRIF_BROWSER_TESTS !== '1' ? 'a local look in a real browser: set TRIF_BROWSER_TESTS=1 to run it'
  : process.platform !== 'darwin' || !fs.existsSync(SWIFT) ? 'needs macOS and swift (Vision reads the code back)'
    : browserTestsSkip();

// macOS's reader: every QR code it finds in a picture, one text a line.
const READER = `import Foundation
import Vision
import AppKit
guard let img = NSImage(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1])),
      let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { exit(2) }
let req = VNDetectBarcodesRequest()
req.symbologies = [.qr]
try VNImageRequestHandler(cgImage: cg, options: [:]).perform([req])
for r in (req.results ?? []) { if let s = r.payloadStringValue { print(s) } }
`;

const sh = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const listening = (port) => new Promise((resolve) => {
  const s = net.connect({ host: '127.0.0.1', port });
  s.once('connect', () => { s.destroy(); resolve(true); });
  s.once('error', () => resolve(false));
});
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const HELLO = { t: 'hello', app: '1.0', device: { name: 'iPhone', width: 393, height: 852 } };
const LONG = 'Aleksandra-Konstantinopolitanskaya’s iPhone 17 Pro Max'; // (the store keeps 60 characters of a phone's name)

test('Connect a phone in a real browser: each state, the code read back and paired with, nothing too wide, it scrolls', { skip, timeout: 600000 }, async () => {
  const { TEXT } = await import('../extension/phonelink.js');
  const home = tempDir('wm-plb-');
  const extra = tempDir('wm-plbx-');
  const chain = makeFakeKeychain(path.join(extra, 'keychain'));
  const standIn = makeStandIn(path.join(extra, 'bin'));
  const shots = process.env.PHONE_LINK_SHOTS ? path.resolve(process.env.PHONE_LINK_SHOTS) : path.join(extra, 'shots');
  fs.mkdirSync(shots, { recursive: true });
  const reader = path.join(extra, 'reader');
  fs.writeFileSync(`${reader}.swift`, READER);
  const built = spawnSync('/usr/bin/xcrun', ['swiftc', '-O', '-o', reader, `${reader}.swift`], { encoding: 'utf8', timeout: 180000 });
  assert.equal(built.status, 0, `the reader didn't build: ${built.stderr}`);
  /** The one code in a picture, as macOS reads it. (Its text is a secret: never in a message.) */
  const read = (file) => {
    const r = spawnSync(reader, [file], { encoding: 'utf8', timeout: 60000 });
    const lines = r.stdout.split('\n').filter(Boolean);
    assert.equal(lines.length, 1, `macOS reads one code in ${path.basename(file)} (it read ${lines.length}; ${r.stderr.slice(0, 200)})`);
    return lines[0];
  };

  // The helper as the browser starts it: the native messaging host's program sets the test's environment
  // (never the real ~/.trif, Keychain or dns-sd), says its pid, and becomes helper/host.js.
  const env = testEnv(home, { ...chain.env, TRIF_DNS_SD: standIn.bin });
  const pidFile = path.join(extra, 'helper.pid');
  const host = path.join(extra, 'host.sh');
  fs.writeFileSync(host, `#!/bin/sh\necho $$ > ${sh(pidFile)}\n${Object.entries(env).map(([k, v]) => `export ${k}=${sh(v)}`).join('\n')}\nexec ${sh(process.execPath)} ${sh(HOST_JS)} "$@"\n`);
  fs.chmodSync(host, 0o755);
  const phones = [];
  const errors = [];
  let browser = null;
  try {
    browser = await launch({
      extension: path.join(REPO, 'extension'),
      prepare: (profile, id) => {
        fs.mkdirSync(path.join(profile, 'NativeMessagingHosts'));
        fs.writeFileSync(path.join(profile, 'NativeMessagingHosts', 'com.webmods.helper.json'), JSON.stringify({
          name: 'com.webmods.helper', description: 'TRIF helper (a test\'s)', path: host, type: 'stdio', allowed_origins: [`chrome-extension://${id}/`],
        }));
      },
    });
    await browser.serviceWorker();
    const page = await browser.newPage();
    page.on('pageerror', (e) => errors.push(String(e.message || e)));
    let width = 380, height = 720, dark = false;
    const size = async (w, h) => { width = w; height = h; await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false }); };
    const theme = async (d) => { dark = d; await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: d ? 'dark' : 'light' }] }); };
    await size(380, 720);
    await theme(false);
    await page.goto(`chrome-extension://${browser.extensionId}/sidepanel.html`);

    /** The section as it is: its words, its controls, and whether anything in it is wider than it or the panel. */
    const look = () => page.evaluate(() => {
      const root = document.querySelector('#phone-link');
      const r = root.getBoundingClientRect();
      const wide = [...root.querySelectorAll('*')].filter((e) => { const b = e.getBoundingClientRect(); return b.width && (b.right > r.right + 0.5 || b.left < r.left - 0.5); }).map((e) => `${e.tagName}.${e.className}`);
      const sw = root.querySelector('.switch');
      return {
        hidden: root.hidden,
        text: root.innerText,
        toggle: sw ? sw.getAttribute('aria-checked') : null,
        button: root.querySelector('.pl-connect') ? { label: root.querySelector('.pl-connect').textContent, disabled: root.querySelector('.pl-connect').disabled } : null,
        qr: (() => { const q = root.querySelector('.pl-qr'); if (!q) return null; const b = q.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height) }; })(),
        phones: [...root.querySelectorAll('.pl-phones li')].map((li) => li.querySelector('.pl-phone').textContent),
        notes: [...root.querySelectorAll('[role=status]')].map((n) => n.textContent),
        wide,
        pageWide: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    });
    /** Brings `selector` (the section by default) into view and saves what the panel shows; returns the file. */
    const shot = async (name, selector = '#phone-link', block = 'end') => {
      await page.evaluate(([s, b]) => { document.querySelector(s).scrollIntoView({ block: b }); }, [selector, block]);
      await new Promise((r) => setTimeout(r, 250));
      const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
      const file = path.join(shots, `${name}-${dark ? 'dark' : 'light'}${width === 380 && height === 720 ? '' : `-${width}x${height}`}.png`);
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
      return file;
    };
    /** A state, looked at light and dark; what `look` says of it (the same in both). */
    const both = async (name, selector, block) => {
      const files = [];
      for (const d of [false, true]) { await theme(d); files.push(await shot(name, selector, block)); }
      await theme(false);
      const v = await look();
      assert.deepEqual(v.wide, [], `${name}: nothing in the section is wider than it`);
      assert.equal(v.pageWide, false, `${name}: the panel doesn't scroll sideways`);
      return { ...v, files };
    };
    const waitLook = (what, fits) => waitFor(async () => { const v = await look(); return fits(v) && v; }, { timeout: 20000, message: what });

    // ---- Settings, with the helper there: the section, off. Nothing listens, nothing is announced.
    await page.click('#settings-btn');
    await waitLook('the section', (v) => !v.hidden);
    const off = await both('01-off');
    assert.equal(off.toggle, null, 'no switch before there is something to switch');
    assert.deepEqual(off.button, { label: TEXT.button, disabled: false });
    assert.deepEqual([off.qr, off.phones, off.notes], [null, [], []]);
    assert.ok(off.text.includes(TEXT.label) && off.text.includes(TEXT.line), off.text);
    assert.deepEqual(standIn.calls(), [], 'nothing announced while off');
    // the "i": the explanation unfolds in place
    await page.click('#phone-link .more-btn');
    const more = await both('02-off-more');
    assert.ok(more.text.includes(TEXT.explanation.slice(TEXT.line.length).trim().slice(0, 60)), more.text);
    await page.click('#phone-link .more-btn');

    // ---- Connect a phone: the code. macOS reads it from the screen's pixels, light and dark, as one text.
    await page.click('#phone-link .pl-connect');
    await waitLook('the code', (v) => v.qr);
    const code = await both('03-code', '#phone-link .pl-pair', 'center');
    assert.deepEqual([code.toggle, code.button, code.phones], ['true', null, []]);
    assert.ok(code.text.includes(TEXT.over) && code.text.includes(TEXT.under) && code.text.includes(TEXT.cancel), code.text);
    assert.ok(code.qr.w === code.qr.h && code.qr.w >= 180 && code.qr.w <= 220, `the code is a square of 180 to 220 px (${code.qr.w}x${code.qr.h})`);
    const texts = code.files.map(read);
    assert.ok(texts[0] === texts[1], 'the same code, light and dark');
    assert.ok(/^trif:\/\/pair\?v=1&k=[\w-]{43}&s=[\w-]+&n=/.test(texts[0]), 'the code is a trif://pair link with the key, the secret and the name');
    const announced = await waitFor(() => standIn.calls()[0], { message: 'the announcement (to the stand-in)' });
    const port = Number(announced.argv[4]);
    assert.equal(await listening(port), true);
    // a short window: the code scrolls into view whole, with Settings; a narrow one: nothing sticks out
    const whole = () => page.evaluate(() => {
      const q = document.querySelector('#phone-link .pl-qr').getBoundingClientRect();
      const box = document.querySelector('#settings');
      const s = box.getBoundingClientRect();
      return { scrolls: document.querySelector('#phone-link').getBoundingClientRect().height > box.clientHeight, inView: q.top >= s.top && q.bottom <= s.bottom && q.bottom <= innerHeight, w: Math.round(q.width) };
    });
    for (const h of [420, 320]) {
      await size(380, h);
      const short = await shot('04-code', '#phone-link .pl-qr', 'center');
      const w = await whole();
      assert.deepEqual([w.scrolls, w.inView], [true, true], `a window ${h} px high: the section is taller than Settings shows, and its code scrolls into view whole (${JSON.stringify(w)})`);
      assert.ok(w.w >= 150, `the code is still ${w.w} px there`);
      assert.ok(read(short) === texts[0], `and reads the same at ${h} px`);
    }
    await size(300, 720);
    const narrow = await shot('04-code', '#phone-link .pl-pair', 'center');
    const nv = await look();
    assert.deepEqual([nv.wide, nv.pageWide], [[], false], 'at 300 px nothing is wider than the panel');
    assert.ok(read(narrow) === texts[0], 'the code reads at 300 px too');
    await size(380, 720);

    // ---- Cancel: the button again, the link still on, no phones.
    await page.click('#phone-link .pl-pair .btn');
    await waitLook('the button again', (v) => v.button && !v.qr);
    const on = await both('05-on-no-phones');
    assert.deepEqual([on.toggle, on.button, on.phones, on.notes], ['true', { label: TEXT.button, disabled: false }, [], []]);
    // the cancelled code's secret is worth nothing now
    const stale = new URL(texts[0]);
    const key = Buffer.from(stale.searchParams.get('k'), 'base64url');
    await assert.rejects(PhoneClient.connect({ port, computerKey: key, keys: generateKeyPair(), name: 'late', pair: stale.searchParams.get('s') }), 'a cancelled code pairs no phone');

    // ---- A new code; a stand-in phone pairs with what macOS read off the screen.
    const pair = async (name, shotName) => {
      await page.click('#phone-link .pl-connect');
      await waitLook('a code', (v) => v.qr);
      const u = new URL(read(await shot(shotName, '#phone-link .pl-pair', 'center')));
      const phone = await PhoneClient.connect({ port, computerKey: Buffer.from(u.searchParams.get('k'), 'base64url'), keys: generateKeyPair(), name, pair: u.searchParams.get('s') });
      phones.push(phone);
      assert.equal((await phone.request(HELLO)).t, 'hello');
      return phone;
    };
    const A = await pair('Tim’s iPhone', '06-code-again');
    await waitLook('the phone listed', (v) => v.phones.length === 1 && !v.qr);
    const one = await both('07-phone-listed');
    assert.equal(one.phones.length, 1);
    assert.ok(one.phones[0].startsWith('Tim’s iPhone · connected '), one.phones[0]);
    assert.deepEqual([one.toggle, one.button, one.notes], ['true', { label: TEXT.button, disabled: false }, ['Tim’s iPhone is connected.']]);

    // ---- A second phone with a long name: it wraps, Remove stays whole.
    await pair(LONG, '08-code-second');
    await waitLook('two phones', (v) => v.phones.length === 2 && !v.qr);
    const two = await both('09-two-phones');
    assert.deepEqual(two.notes, [`${LONG} is connected.`]);
    const rows = await page.evaluate(() => [...document.querySelectorAll('#phone-link .pl-phones li')].map((li) => { const b = li.querySelector('.btn').getBoundingClientRect(); const r = li.getBoundingClientRect(); return { btn: Math.round(b.width), in: b.right <= r.right + 0.5, h: Math.round(b.height) }; }));
    assert.ok(rows.every((r) => r.in && r.btn === rows[0].btn && r.h === rows[0].h), `Remove is whole and the same in each row: ${JSON.stringify(rows)}`);
    await size(300, 720);
    await shot('09-two-phones');
    const tv = await look();
    assert.deepEqual([tv.wide, tv.pageWide], [[], false], 'two phones at 300 px: nothing wider than the panel');
    await size(380, 720);

    // ---- Remove the first: its connection closes, the panel says so, the other stays.
    await page.click('#phone-link .pl-phones li:first-child .btn');
    await waitLook('one phone left', (v) => v.phones.length === 1);
    const removed = await both('10-removed');
    assert.ok(removed.phones[0].startsWith(LONG), removed.phones[0]);
    assert.deepEqual(removed.notes, ['Tim’s iPhone can’t reach this computer any more.']);
    await Promise.race([A.closed, new Promise((_, no) => setTimeout(() => no(new Error('the removed phone\'s connection stayed open')), 10000))]);

    // ---- The switch off: the phone is kept, nothing listens; on again: it listens.
    await page.click('#phone-link .switch');
    await waitLook('the switch off', (v) => v.toggle === 'false');
    const kept = await both('11-off-phones-kept');
    assert.equal(kept.phones.length, 1);
    assert.deepEqual(kept.button, { label: TEXT.button, disabled: false });
    await waitFor(async () => !(await listening(port)), { message: 'the listener closed' });
    const before = standIn.calls().length;
    await page.click('#phone-link .switch');
    await waitLook('the switch on', (v) => v.toggle === 'true');
    const again = await waitFor(() => standIn.calls()[before], { message: 'the announcement after the switch' });
    await waitFor(() => listening(Number(again.argv[4])), { message: 'the listener again' });

    // ---- Settings closed while a code shows: the code goes, and its window with it.
    await page.click('#phone-link .pl-connect');
    await waitLook('a code', (v) => v.qr);
    await page.click('#settings-btn');
    await page.click('#settings-btn');
    const reopened = await waitLook('the section again', (v) => !v.hidden && v.button);
    assert.equal(reopened.qr, null, 'no code after Settings closed');

    assert.deepEqual(errors, [], 'no error in the panel\'s page');
  } finally {
    for (const p of phones) { try { await p.close(); } catch { /* closed */ } }
    if (browser) await browser.close();
    // the helper goes with its browser; the stand-in dns-sd with the helper
    let pid = 0;
    try { pid = Number(fs.readFileSync(pidFile, 'utf8')); } catch { /* never started */ }
    if (pid) {
      try { await waitFor(() => !alive(pid), { timeout: 8000, message: 'the helper to end' }); } catch { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
    }
    for (const c of standIn.calls()) { try { process.kill(c.pid, 'SIGKILL'); } catch { /* gone */ } }
    for (const dir of [home, `${home}-private`, extra]) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* left */ } }
  }
});
