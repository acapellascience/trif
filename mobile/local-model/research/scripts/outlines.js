// Capture TRIF page outlines (mobile/shared/kit.js outline()) at a phone viewport, plus an MHTML snapshot for scoring.
const fs = require('fs');
const path = require('path');
const REPO = process.env.HOME + '/WebMods-worktrees/ios-poc';
const { launch } = require(REPO + '/tests/cdp-page.js');
const OUT = path.join(__dirname, '..', 'outlines');
const KIT = fs.readFileSync(REPO + '/mobile/shared/kit.js', 'utf8');
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1';
const PAGES = [
  ['wikipedia', 'https://en.wikipedia.org/wiki/Bicycle'],
  ['hn', 'https://news.ycombinator.com/'],
  ['guardian', 'https://www.theguardian.com/international'],
  ['testfeed', 'file://' + REPO + '/mobile/shared/pages/plain.html'],
];
(async () => {
  const b = await launch();
  try {
    for (const [name, url] of PAGES) {
      const p = await b.newPage();
      await p.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
      await p.send('Emulation.setUserAgentOverride', { userAgent: UA });
      try { await p.goto(url, { timeoutMs: 45000 }); } catch (e) { console.error(name, 'goto', e.message); }
      await p.waitForTimeout(2500);
      await p.evaluate(KIT);
      const o = await p.evaluate('JSON.stringify(globalThis.__trifKit.outline(6000))');
      const { text, chars, tokens } = JSON.parse(o);
      const finalUrl = await p.evaluate('location.href');
      fs.writeFileSync(path.join(OUT, name + '.txt'), text);
      fs.writeFileSync(path.join(OUT, name + '.url'), finalUrl);
      const html = await p.evaluate(`(() => { const d = document.documentElement.cloneNode(true);
        d.querySelectorAll('script,noscript').forEach((s) => s.remove());
        const head = d.querySelector('head'); const b = document.createElement('base'); b.href = location.href; head.prepend(b);
        return '<!doctype html>\\n' + d.outerHTML; })()`);
      fs.writeFileSync(path.join(OUT, name + '.html'), html);
      console.log(name, finalUrl, chars, 'chars', tokens, 'tok est');
      await p.close();
    }
  } finally { await b.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
