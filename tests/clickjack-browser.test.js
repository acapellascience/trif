'use strict';
// TRIF's clickjacking guard (extension/runtime.js clickGuard; docs/SANDBOX-TIER-NOTES.md RT-3) in a real
// browser: a style mod, boxed mods (the sandbox runtime under real SES, in the page's world here) and the page's
// own design, each pressed with a trusted mouse click or key. Hostile mods that hide a real button over a decoy
// are stopped and named; the page's own invisible file input over its styled button, a mod that dims, one that
// draws its own icon over a button's (Rainbow Rave's way) or its own words over it (Oppish's), and the mods' own
// controls all still work. Also the cost of a press. Runs in headless Chrome for Testing (tests/cdp-page.js),
// with TRIF_BROWSER_TESTS=1 or in CI; skipped otherwise. The e2e has the same through the real extension, in
// Chrome and Firefox (tests/e2e/scenario.js clickjackCheck).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { pathToFileURL } = require('url');

const rules = require('../helper/lib/rules');
const { browserTestsSkip, launch } = require('./cdp-page');

const skip = browserTestsSkip();

const STAGE = (n, inner) => `<div class="stage" id="s${n}">${inner}</div>`;
const DECOY = (n) => `<div class="decoy" id="decoy${n}">Win a prize</div>`;
const PAGE = `<!doctype html><html><head><title>cj</title><style>
  body { font: 16px sans-serif; margin: 0; }
  .stage { position: relative; width: 320px; height: 56px; margin: 12px; }
  .decoy { position: absolute; inset: 0; background: #2a2; color: #fff; display: flex; align-items: center; justify-content: center; }
  .real { padding: 10px 18px; background: #c00; color: #fff; border: 0; transition: opacity .3s, transform .3s; }
  .pretty { display: inline-block; padding: 10px 18px; background: #06c; color: #fff; }
  .file { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
  .ic { position: relative; display: inline-block; width: 20px; height: 20px; }
  .icon-btn { background: transparent; border: 0; padding: 4px; }
  #big a { display: block; }
  .reveal { opacity: 0; transition: opacity 2s; }
  #s12:hover .reveal { opacity: 1; }
</style></head><body>
${STAGE(1, `${DECOY(1)}<button class="real" id="real1" type="button">Delete account</button>`)}
${STAGE(2, '<span class="pretty" id="pretty">Choose a picture</span><input class="file" id="file" type="file">')}
${STAGE(3, `${DECOY(3)}<button class="real" id="real3" type="button">Follow</button>`)}
${STAGE(4, '<button class="real" id="real4" type="button">Send money</button>')}
${STAGE(5, '<button class="real" id="real5" type="button">Block</button>')}
${STAGE(6, '<input class="real" id="real6" type="submit" value="Google Search">')}
${STAGE(7, '<button class="icon-btn" id="real7" type="button"><span class="ic"><svg viewBox="0 0 20 20" width="20" height="20"><path d="M2 2h16v16H2z"/></svg></span></button>')}
${STAGE(8, '<div id="dimmed"><a href="#post" id="real8">A post I read already</a></div>')}
${STAGE(9, `${DECOY(9)}<span id="mine9"></span>`)}
${STAGE(10, '<label id="sw"><input type="checkbox" id="cb" style="position:absolute;opacity:0"><span id="swtext">Notifications</span></label>')}
${STAGE(11, `${DECOY(11)}<iframe id="fr" src="/frame" style="border:0;width:200px;height:40px"></iframe>`)}
${STAGE(12, '<button class="reveal" id="reveal" type="button">Remove</button>')}
${STAGE(13, '<button class="real" id="real13" type="button">Like</button>')}
<div id="big"></div>
<script>
  window.hits = {};
  const count = (id) => { window.hits[id] = (window.hits[id] || 0) + 1; };
  for (const id of ['real1', 'real3', 'real4', 'real5', 'real6', 'real7', 'real8', 'file', 'decoy1', 'decoy11', 'cb', 'reveal', 'real13']) {
    document.getElementById(id).addEventListener('click', (e) => { count(id); if (id === 'file' || id === 'real6') e.preventDefault(); });
  }
  document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('#big a')) { e.preventDefault(); count('big'); } });
  const big = document.getElementById('big');
  for (let i = 0; i < 3000; i++) { const a = document.createElement('a'); a.href = '#i' + i; a.id = 'b' + i; a.innerHTML = '<span>item <b>' + i + '</b></span>'; big.append(a); }
</script>
</body></html>`;
const FRAME = '<!doctype html><html><body style="margin:0"><button id="inner" style="width:200px;height:40px">Authorize</button><script>window.clicks = 0; document.getElementById("inner").addEventListener("click", () => { window.clicks++; });</script></body></html>';

// The hostile style mod: #real1 invisible, over its decoy; the frame too. And an unrelated rule that styles the
// page's own label in stage 2 (so the site's own invisible file input is looked at with a mod's sheet there).
const HOSTILE_STYLE = {
  css: `#real1 { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 5; opacity: 0; }
    #fr { position: absolute; inset: 0; z-index: 5; opacity: 0.05; }
    .pretty { border-radius: 8px; }`,
};

test('the clickjacking guard, in Chromium: hidden real controls over decoys are stopped and named; the page\'s own design and honest mods work', { skip }, async (t) => {
  const sb = await import(pathToFileURL(path.join(__dirname, '..', 'extension', 'sandbox.js')).href);
  const rt = await import(pathToFileURL(path.join(__dirname, '..', 'extension', 'runtime.js')).href);
  const ses = fs.readFileSync(path.join(__dirname, '..', 'extension', sb.SES_FILE), 'utf8');
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(req.url === '/frame' ? FRAME : PAGE); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await launch();
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e.message)));
    await page.goto(`${base}/`);
    await page.addScriptTag({ content: rt.runtimeCode([]) });
    await page.addScriptTag({ content: rules.rulesCode(rules.checkRules(HOSTILE_STYLE), '127.0.0.1/hostile-style') });
    await page.addScriptTag({ content: ses });
    await page.addScriptTag({ content: sb.sandboxRuntimeCode() });
    const run = (id, source, powers = []) => page.addScriptTag({ content: sb.sandboxModCode(id, source, powers) });
    // A hostile boxed mod: #real3 hidden by style() (inline), #real4 under its own opaque element that lets
    // clicks through, and its own invisible link over a decoy
    await run('127.0.0.1/hostile-box', `
      await trif.ready;
      const r3 = page.find('#real3');
      for (const [k, v] of [['position', 'absolute'], ['inset', '0'], ['width', '100%'], ['height', '100%'], ['z-index', '5'], ['opacity', '0.02']]) r3.style(k, v);
      const cover = page.create('div');
      cover.setText('Win a prize');
      for (const [k, v] of [['position', 'absolute'], ['inset', '0'], ['background', 'rgb(34, 170, 34)'], ['color', '#fff'], ['pointer-events', 'none'], ['z-index', '9']]) cover.style(k, v);
      page.find('#s4').append(cover);
      const a = page.create('a');
      a.setAttr('href', '#gotcha');
      a.setText('x');
      a.setAttr('id', 'trif-box-link9');
      for (const [k, v] of [['position', 'absolute'], ['inset', '0'], ['opacity', '0'], ['z-index', '5']]) a.style(k, v);
      page.find('#mine9').append(a);
    `);
    // A second hostile boxed mod, through trif.css: #real5 faded to nothing
    await run('127.0.0.1/hostile-css', `trif.css('#real5 { opacity: 0.01 !important; }');`);
    // Honest boxed mods: Oppish's way (its own words over a button whose text it made transparent), Rainbow
    // Rave's (the button's icon hidden, its own drawn over it), one that dims what was read, its own controls
    await run('127.0.0.1/oppish-like', `
      await trif.ready;
      const b = page.find('#real6');
      b.style('color', 'transparent');
      const span = page.create('span');
      span.setText('Gopoogoplepe Sepeapearch');
      for (const [k, v] of [['position', 'absolute'], ['left', '0'], ['top', '0'], ['width', '140px'], ['height', '40px'], ['pointer-events', 'none'], ['color', '#fff']]) span.style(k, v);
      b.after(span);
      const own = page.create('button');
      own.setText('mine');
      own.style('opacity', '0.35');
      own.setAttr('id', 'trif-box-own');
      page.body.append(own);
      own.on('click', () => trif.log('own clicked'));
      const sprite = page.create('div');
      for (const [k, v] of [['position', 'absolute'], ['inset', '0'], ['pointer-events', 'none'], ['background-image', 'linear-gradient(transparent, rgba(0, 0, 0, .2))']]) sprite.style(k, v);
      page.find('#s13').append(sprite);
    `, ['controls']);
    await run('127.0.0.1/rave-like', `trif.css(\`
      #real7 svg { opacity: 0 !important; }
      #real7 .ic::after { content: ''; position: absolute; inset: 0; pointer-events: none; background-image: linear-gradient(45deg, red, blue); }
      #dimmed { opacity: 0.4; }
    \`);`);
    await page.waitForTimeout(400);
    const hits = () => page.evaluate(() => window.hits);
    const errors = () => page.evaluate(() => window.__webmods.errors.filter((e) => e.kind === 'clickjack').map((e) => ({ mod: e.mod, why: e.why })));
    const clickAt = async (x, y) => { for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: type === 'mouseMoved' ? 0 : 1 }); };
    const centre = (sel) => page.evaluate((s) => { const el = document.querySelector(s); el.scrollIntoView({ block: 'center' }); const b = el.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; }, sel);

    // 1. the style mod's invisible button over the decoy: stopped, the decoy gets nothing either, no transition left running
    await page.click('#real1');
    // 2. the page's own invisible file input over its styled label (a mod's sheet styles the label): works
    await page.click('#file');
    // 3. the boxed mod's inline-hidden button: stopped
    await page.click('#real3');
    // 4. under the boxed mod's own opaque element: stopped
    await page.click('#real4');
    // 5. faded by another boxed mod's trif.css: stopped
    await page.click('#real5');
    // 6, 7, 8: Oppish's way, Rainbow Rave's way, dimmed to 0.4: all work
    await page.click('#real6');
    await clickAt(...await centre('#real7 svg'));
    await page.click('#real8');
    // 9. the boxed mod's own invisible link over a decoy: stopped
    await page.click('#trif-box-link9');
    // 10. a label over the page's own hidden checkbox: works
    await page.click('#swtext');
    // the mod's own faint button: works
    await page.click('#trif-box-own');
    // 12. the site's own button fading in as the pointer reaches it, pressed at once: works
    const [rx, ry] = await centre('#reveal');
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rx, y: ry });
    await clickAt(rx, ry);
    // 13. a mod's see-through picture over a button (DVD Logo's way): works
    await page.click('#real13');
    await page.waitForTimeout(200);
    const h = await hits();
    const running = await page.evaluate(() => document.getElementById('real1').getAnimations().length);
    t.diagnostic(`hits ${JSON.stringify(h)}`);
    for (const id of ['real1', 'real3', 'real4', 'real5', 'decoy1']) assert.equal(h[id], undefined, `${id} got the click`);
    assert.equal(h.file, 1, 'the page\'s own file input');
    assert.equal(h.real6, 1, 'Oppish\'s way');
    assert.equal(h.real7, 1, 'Rainbow Rave\'s way');
    assert.equal(h.real8, 1, 'a dimmed link');
    assert.equal(h.cb, 1, 'the label\'s checkbox');
    assert.equal(h.reveal, 1, 'the site\'s own button, fading in');
    assert.equal(h.real13, 1, 'a see-through picture over a button');
    assert.equal(await page.evaluate(() => document.getElementById('cb').checked), true);
    assert.equal(await page.evaluate(() => location.hash), '#post', 'the mod\'s own link went nowhere; the dimmed one did');
    assert.equal(running, 0, 'no transition started by the look');
    const own = await page.evaluate(() => globalThis.__trifSandbox.logs.filter((l) => l.mod === '127.0.0.1/oppish-like').map((l) => l.args.join(' ')));
    assert.deepEqual(own, ['own clicked']);

    // named, once each, by the sheet's (or the inline style's, or the element's) owner
    const errs = await errors();
    t.diagnostic(`errors ${JSON.stringify(errs)}`);
    assert.deepEqual(errs.map((e) => `${e.mod} ${e.why}`).sort(), [
      '127.0.0.1/hostile-box covered', '127.0.0.1/hostile-box faded', '127.0.0.1/hostile-css faded', '127.0.0.1/hostile-style faded',
    ]);
    // the same again: stopped, not said again
    await page.click('#real1');
    assert.equal((await hits()).real1, undefined);
    assert.equal((await errors()).length, 4);

    // the keyboard: Enter on the hidden button, focused
    await page.evaluate(() => document.getElementById('real3').focus());
    for (const type of ['rawKeyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await page.waitForTimeout(100);
    assert.equal((await hits()).real3, undefined, 'Enter on the hidden button');

    // a frame the mod hid: unclickable while the pointer is on it (the press goes to what's under it)
    const [fx, fy] = await centre('#fr');
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: fx - 5, y: fy });
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: fx, y: fy });
    await page.waitForTimeout(100);
    await clickAt(fx, fy);
    await page.waitForTimeout(200);
    const inner = await page.evaluate(() => document.getElementById('fr').contentWindow.clicks);
    assert.equal(inner, 0, 'the hidden frame\'s button');
    assert.equal((await hits()).decoy11, 1, 'the click went to what the user saw');
    assert.equal(await page.evaluate(() => document.getElementById('fr').hasAttribute('data-trif-guard')), true);

    // the cost: a press on an ordinary link in a page of 3000, and the second look's. Measured over these
    // presses only, once the guard is warm: the very first press of the run (compiling, a cold CI machine) can
    // take ~180 ms, and counted in it made the average fail on CI now and then (11-19).
    const before = await page.evaluate(() => { const s = window.__webmods.guard.stats; return { ms: s.ms, checked: s.checked }; });
    for (let i = 0; i < 10; i++) await clickAt(...await centre(`#b${i * 7}`));
    await page.waitForTimeout(100);
    const stats = await page.evaluate(() => window.__webmods.guard.stats);
    t.diagnostic(`guard ${JSON.stringify(stats)}`);
    assert.ok(stats.checked >= 20, `checked ${stats.checked}`);
    const n = stats.checked - before.checked;
    assert.ok(n >= 5, `checked ${n} of the last 10 presses`);
    const avg = (stats.ms - before.ms) / n;
    // (4 ms here; CI's shared machines run this 2–3 times slower, even warm: ~5 ms a press on 11-19's failing runs)
    const budget = process.env.CI && !/^(0|false)$/i.test(process.env.CI) ? 10 : 4;
    assert.ok(avg < budget, `a press: ${avg.toFixed(2)} ms on average (budget ${budget})`);
    // (the second looks happen earlier in the test: one cold one is allowed, the rest must be fast)
    assert.ok(stats.deep >= 2, `second looks: ${stats.deep}`);
    const deepRest = (stats.deepMs - stats.maxDeepMs) / (stats.deep - 1);
    assert.ok(deepRest < 16, `the second look: ${deepRest.toFixed(2)} ms on average, leaving out the slowest`);
    assert.equal((await hits()).big, 10);
    assert.deepEqual(pageErrors, []);
  } finally {
    if (browser) await browser.close();
    server.close(); server.closeAllConnections();
  }
});
