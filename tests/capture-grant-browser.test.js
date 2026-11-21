'use strict';
// Screenshots without access to every site, in a real browser: TRIF's own extension with only example.com's
// access (no <all_urls>), the real helper (helper/host.js, started by the browser over native messaging, in a temp
// workspace: never the user's), and `trif screenshot` from the CLI. Chrome refuses captureVisibleTab until the
// user clicks TRIF's toolbar button on the tab (Extensions.triggerAction, as the e2e's clickToolbarButton) or
// presses TRIF's shortcut there (Alt+Shift+S, a CDP key event: the browser's own command handling); with TRIF's
// panel following the tab's window, the screenshot waits for that with a note in the panel, and is taken as soon
// as it comes. extension/capturegrant.js, background.js waitForGrant. Headless Chrome for Testing
// (tests/cdp-page.js: muted, one browser at a time, the memory guard), with TRIF_BROWSER_TESTS=1 or in CI.
// GRANT_SHOTS=<dir> saves the panel with its note there.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { browserTestsSkip, launch } = require('./cdp-page');
const { extensionCopy, harness, waitFor } = require('./phone-pages');

const skip = browserTestsSkip();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('the tab in front: refused until the robot is clicked or the shortcut pressed; the screenshot waits for it with a note in the panel', { skip, timeout: 300000 }, async () => {
  const { tempDir, testEnv, HOST_JS, CLI_JS } = require('./fake-extension');
  const { execFile } = require('child_process');
  const sh = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
  const home = tempDir('wm-grant-');
  const extra = tempDir('wm-grantx-');
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end(`<!doctype html><html><head><meta charset="utf-8"><title>Grant test</title></head><body style="background:#3a7"><h1>${req.headers.host}</h1></body></html>`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const url = `http://example.com:${port}/`;
  const env = testEnv(home);
  const pidFile = path.join(extra, 'helper.pid');
  const host = path.join(extra, 'host.sh');
  fs.writeFileSync(host, `#!/bin/sh\necho $$ > ${sh(pidFile)}\n${Object.entries(env).map(([k, v]) => `export ${k}=${sh(v)}`).join('\n')}\nexec ${sh(process.execPath)} ${sh(HOST_JS)} "$@"\n`);
  fs.chmodSync(host, 0o755);
  const ext = extensionCopy(['*://example.com/*', '*://*.example.com/*']);
  // `trif screenshot` as an agent runs it (the CLI against the test's helper), resolving {code, json, stderr}
  const screenshot = (tabId) => new Promise((resolve) => {
    const out = path.join(extra, `shot-${Date.now()}.png`);
    execFile(process.execPath, [CLI_JS, 'screenshot', '--tab', String(tabId), '--json', '-o', out], { env, timeout: 150000 }, (err, stdout, stderr) => {
      let json = null;
      try { json = JSON.parse(stdout); } catch { /* an error */ }
      resolve({ code: err ? err.code ?? -1 : 0, json, stderr, bytes: fs.existsSync(out) ? fs.statSync(out).size : 0 });
    });
  });
  let browser = null;
  try {
    browser = await launch({
      extension: ext,
      args: ['--screen-info={0,0 1470x956}', '--host-resolver-rules=MAP example.com 127.0.0.1, MAP *.example.com 127.0.0.1'],
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
    const st = await waitFor('the helper', async () => { const s = await status(); return s.helper.connected && s; }, 30000);
    assert.equal(st.access.allUrls, false, 'only the sites it has, not every site');
    await h.ask({ type: 'site.set', site: 'example.com', on: true });
    // The shortcut, as the browser has it (the manifest's suggested key).
    const cmds = await h.E(() => chrome.commands.getAll());
    const see = cmds.find((c) => c.name === 'see-tab');
    assert.ok(see && see.shortcut, `TRIF's shortcut is set: ${JSON.stringify(cmds)}`);
    const { tabId, winId } = await h.E(async (u) => {
      const w = await chrome.windows.create({ url: u, focused: true, left: 0, top: 0, width: 1000, height: 800 });
      return { tabId: w.tabs[0].id, winId: w.id };
    }, url);
    await waitFor('the page', () => h.page(tabId, 'document.readyState === "complete"'));
    const refused = () => h.E((w) => chrome.tabs.captureVisibleTab(w, { format: 'png' }).then(() => 'captured', (e) => String(e.message || e)), winId);
    assert.match(await refused(), /activeTab|all_urls/, 'Chrome refuses it before any click');

    // No panel follows that window: refused at once, as before.
    await sleep(1100); // (Chrome allows two captureVisibleTab calls a second, refused ones too)
    let t0 = Date.now();
    let r = await screenshot(tabId);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /only after the user clicks TRIF's button on it \(or press .+ with this tab in front\) \(TRIF has access/);
    assert.ok(Date.now() - t0 < 20000, 'no wait without a panel there');

    // TRIF's panel for that window (as the panel's own fallback window opens it): the screenshot waits, the panel shows the note.
    // (beside the page's window, not over it: headless Chrome doesn't draw a covered window, "image readback failed")
    await h.E((id) => chrome.windows.create({ url: chrome.runtime.getURL(`sidepanel.html?window=${id}&fallback=1`), focused: false, left: 1020, top: 0, width: 420, height: 800 }), winId);
    const pt = await waitFor('the panel', async () => (await browser.cdp.send('Target.getTargets')).targetInfos.find((x) => x.type === 'page' && x.url.includes(`/sidepanel.html?window=${winId}&fallback=1`)));
    const psid = await browser._attach(pt.targetId);
    const inPanel = async (expr) => {
      const x = await browser.cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, psid);
      if (x.exceptionDetails) throw new Error(x.exceptionDetails.exception?.description || x.exceptionDetails.text);
      return x.result.value;
    };
    await waitFor('the panel page', () => inPanel('document.readyState === "complete" && !!document.getElementById("see-tab")'));
    const NOTE = '(() => { const n = document.getElementById("see-tab"); return n && !n.hidden ? n.textContent.replace(/\\s+/g, " ").trim() : null; })()';
    assert.equal(await inPanel(NOTE), null, 'no note while nothing waits');
    // (the toolbar button on that tab, as Chrome's own click: Extensions.triggerAction on its tab target)
    const clickRobot = async () => {
      const { targetInfos } = await browser.cdp.send('Target.getTargets', { filter: [{ type: 'tab' }] });
      const cur = await h.E((id) => chrome.tabs.get(id).then((t) => t.url), tabId);
      const tab = targetInfos.find((x) => x.type === 'tab' && x.url === cur);
      assert.ok(tab, `the tab target for ${cur}`);
      await browser.cdp.send('Extensions.triggerAction', { id: browser.extensionId, targetId: tab.targetId });
    };
    t0 = Date.now();
    let pending = screenshot(tabId);
    const note = await waitFor('the note in the panel', () => inPanel(NOTE), 20000).catch(async (e) => {
      console.error('status.seeTab', JSON.stringify((await status()).seeTab), 'screenshot', JSON.stringify(await Promise.race([pending, sleep(100).then(() => 'still waiting')])));
      throw e;
    });
    assert.match(note, /^Click the robot to let TRIF see this tab\. It's at the top right of .+, next to the address bar \(or in the puzzle-piece menu\)\. Or press .+\.$/);
    assert.deepEqual((await status()).seeTab.map((w) => [w.tabId, w.windowId, w.site]), [[tabId, winId, 'example.com']]);
    // (GRANT_SHOTS=<dir>: the panel with its note, to look at)
    if (process.env.GRANT_SHOTS) {
      const { data } = await browser.cdp.send('Page.captureScreenshot', { format: 'png' }, psid);
      fs.mkdirSync(process.env.GRANT_SHOTS, { recursive: true });
      fs.writeFileSync(path.join(process.env.GRANT_SHOTS, 'panel-note.png'), Buffer.from(data, 'base64'));
    }
    await sleep(1500);
    await clickRobot();
    r = await pending;
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json.how, 'visible');
    assert.ok(r.bytes > 1000, `a PNG: ${r.bytes} bytes`);
    assert.ok(Date.now() - t0 < 30000, 'taken as the click came, not at the end of the wait');
    await waitFor('the note gone', async () => (await inPanel(NOTE)) === null, 10000);
    // Granted now: taken at once; a reload keeps it. (The click brought the panel's window to the front: the page's again.)
    await h.E((w) => chrome.windows.update(w, { focused: true }), winId);
    await h.E((id) => chrome.tabs.reload(id), tabId);
    await sleep(1000);
    await waitFor('the page again', () => h.page(tabId, 'document.readyState === "complete"'));
    // (headless Chrome may not draw a window the panel's came in front of: "image readback failed", which isn't a refusal)
    assert.doesNotMatch(await refused(), /activeTab|all_urls/, 'a reload keeps the grant');
    // Another origin takes it away (www. too), and coming back doesn't bring it back.
    await h.E(([id, u]) => chrome.tabs.update(id, { url: u }), [tabId, `http://www.example.com:${port}/`]);
    await waitFor('www.example.com', () => h.E((id) => chrome.tabs.get(id).then((t) => t.status === 'complete' && t.url.includes('www.example.com')), tabId));
    await h.E(([id, u]) => chrome.tabs.update(id, { url: u }), [tabId, url]);
    await waitFor('example.com again', () => h.E((id) => chrome.tabs.get(id).then((t) => t.status === 'complete' && !t.url.includes('www.')), tabId));
    assert.match(await refused(), /activeTab|all_urls/, 'gone after another origin');

    // TRIF's shortcut on the page, while the screenshot waits: the same.
    pending = screenshot(tabId);
    await waitFor('the note again', () => inPanel(NOTE), 20000).catch(async (e) => {
      console.error('status.seeTab', JSON.stringify((await status()).seeTab), 'screenshot', JSON.stringify(await Promise.race([pending, sleep(100).then(() => 'still waiting')])));
      throw e;
    });
    const { sid } = await (async () => {
      // (the page's own session: the key goes to the page, and Chrome's command handling takes it first)
      const { targetInfos } = await browser.cdp.send('Target.getTargets');
      const x = targetInfos.find((t) => t.type === 'page' && t.url === url);
      return { sid: await browser._attach(x.targetId) };
    })();
    const native = process.platform === 'darwin' ? { nativeVirtualKeyCode: 1 } : {}; // (kVK_ANSI_S: a Mac's shortcuts go by it)
    for (const type of ['rawKeyDown', 'keyUp']) {
      await browser.cdp.send('Input.dispatchKeyEvent', { type, modifiers: 1 | 8, key: 'S', code: 'KeyS', windowsVirtualKeyCode: 83, ...native }, sid);
    }
    r = await pending;
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json.how, 'visible');
    await waitFor('the note gone again', async () => (await inPanel(NOTE)) === null, 10000);
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
