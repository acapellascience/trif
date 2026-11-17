'use strict';
// By hand: the phone view (extension/phone.js) on public sites that serve a mobile layout to a logged-out
// visitor, next to their desktop page, and TRIF's panel window beside the phone. Headless Chrome for Testing
// (tests/cdp-page.js: the lock, the memory guard), one site at a time, each tab closed after.
//
//   TRIF_BROWSER_TESTS=1 node tests/phone-shots.js <out dir> [site…]
//
// Sites: x.com instagram.com reddit.com wikipedia.org (the default: all four). Public pages only, as a
// logged-out visitor sees them.

const fs = require('fs');
const path = require('path');
const { launch } = require('./cdp-page');
const { servePhonePages, extensionCopy, harness, waitFor } = require('./phone-pages');

const SITES = {
  'x.com': 'https://x.com/NASA',
  'instagram.com': 'https://www.instagram.com/nasa/',
  'reddit.com': 'https://www.reddit.com/r/pics/',
  'wikipedia.org': 'https://en.wikipedia.org/wiki/Cat',
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const out = path.resolve(process.argv[2] || 'phone-shots');
  const pick = process.argv.slice(3).length ? process.argv.slice(3) : Object.keys(SITES);
  fs.mkdirSync(out, { recursive: true });
  process.env.PHONE_SHOTS = out;
  const pages = await servePhonePages();
  const ext = extensionCopy(['*://127.0.0.1/*', ...pick.map((s) => `*://*.${s}/*`)]);
  const browser = await launch({ extension: ext, args: ['--screen-info={0,0 1470x956}', '--enable-unsafe-extension-debugging'] });
  const report = [];
  try {
    const h = await harness(browser);
    const { E, ask } = h;
    for (const site of pick) {
      const url = SITES[site];
      await ask({ type: 'site.set', site, on: true });
      const { tabId, windowId } = await E(async (u) => {
        const w = await chrome.windows.create({ url: u, focused: true });
        await chrome.windows.update(w.id, { width: 1280, height: 860 });
        return { tabId: w.tabs[0].id, windowId: w.id };
      }, url);
      await waitFor(`${site} to load`, () => E((id) => chrome.tabs.get(id).then((t) => t.status === 'complete'), tabId), 30000).catch(() => {});
      await sleep(3000);
      // A site that refuses headless browsers (an error page, a 403): left out. Getting past a site's bot check
      // isn't this script's business, and the phone view's user agent would do just that here.
      const refused = await E((id) => chrome.scripting.executeScript({ target: { tabId: id }, func: () => document.title }).then(() => false, (e) => /error page/i.test(e.message)), tabId);
      if (refused) {
        report.push({ site, url, skipped: 'it refuses headless browsers (an error page): look in a real browser' });
        await E((id) => chrome.windows.remove(id), windowId).catch(() => {});
        continue;
      }
      await h.shot(tabId, `${site}-desktop.png`);
      const r = await ask({ type: 'phone.open', tabId, screen: { left: 0, top: 25, width: 1470, height: 931 } });
      await waitFor(`${site} on the phone`, () => E((id) => chrome.tabs.get(id).then((t) => t.status === 'complete'), tabId), 30000).catch(() => {});
      await sleep(4000);
      const seen = await h.page(tabId, '({ ua: navigator.userAgent, w: innerWidth, h: innerHeight, touch: navigator.maxTouchPoints, url: location.href })').catch((e) => ({ error: e.message }));
      await h.shot(tabId, `${site}-phone.png`);
      // the panel window beside it
      if (!report.some((x) => x.viewport)) { // (the first site shown: the panel too)
        const { targetInfos } = await browser.cdp.send('Target.getTargets');
        const t = targetInfos.find((x) => x.type === 'page' && x.url.includes(`sidepanel.html?window=${r.window}&fallback=1`));
        if (t) {
          const sid = await browser._attach(t.targetId);
          await browser.cdp.send('Emulation.setDeviceMetricsOverride', { width: 420, height: 760, deviceScaleFactor: 1, mobile: false }, sid);
          await sleep(1500);
          const { data } = await browser.cdp.send('Page.captureScreenshot', { format: 'png' }, sid);
          fs.writeFileSync(path.join(out, 'panel-beside-phone.png'), Buffer.from(data, 'base64'));
        }
      }
      report.push({ site, url, viewport: r.viewport, seen });
      await ask({ type: 'phone.close', tabId });
      await E((id) => chrome.windows.remove(id), windowId).catch(() => {});
      await sleep(500);
    }
  } finally {
    await browser.close();
    pages.server.close();
    fs.rmSync(ext, { recursive: true, force: true });
  }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
