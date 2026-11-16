'use strict';
// The TRIF skill's page scripts (skill/trif/scripts/page/) in a real page, pasted and called the way a model with
// a JavaScript tool in the tab (Claude in Chrome) does: Runtime.evaluate of the file's text, then of the calls.
// try-style runs TRIF's own style runtime and undoes it; try-boxed runs a boxed mod's code over the page and
// refuses what the box refuses; record keeps the page's own JSON and puts fetch back; sweep is trif sweep; download
// saves a file TRIF's import takes. A local page only; headless, muted, one browser at a time (tests/cdp-page.js).
// With TRIF_BROWSER_TESTS=1 or in CI; skipped otherwise.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { browserTestsSkip, launch } = require('./cdp-page');
const { checkMod } = require('../skill/trif/scripts/check-mod');
const share = require('../helper/lib/share');
const { originOf } = require('../helper/lib/downloads');

const PAGE_DIR = path.join(__dirname, '..', 'skill', 'trif', 'scripts', 'page');
const script = (name) => fs.readFileSync(path.join(PAGE_DIR, name), 'utf8');

const FEED = `<!doctype html><html><head><title>Feed</title>
<style>body { font: 14px sans-serif; margin: 0; display: flex; } aside { width: 200px; background: #eee; } main { flex: 1; }</style></head>
<body><aside data-testid="sidebarColumn"><div aria-label="Trending">Trending now</div><div>Who to follow</div></aside>
<main data-testid="primaryColumn"><div id="feed"></div></main>
<script>
let n = 0;
function add(k) { for (let i = 0; i < k; i++) { n++; const d = document.createElement('div'); d.dataset.testid = 'cellInnerDiv';
  const a = document.createElement('article'); a.textContent = 'Post ' + n + (n % 3 === 0 ? ' Promoted' : '') + ' about Grok'; d.append(a); document.getElementById('feed').append(d); } }
add(6);
window.loadMore = () => fetch('/api/feed?page=2').then((r) => r.json()).then((j) => { add(j.items.length); return j.items.length; });
</script></body></html>`;
const API = { items: [{ id: 'p7', text: 'Post 7' }, { id: 'p8', text: 'Post 8', promoted: true }, { id: 'p9', text: 'Post 9' }], cursor: { bottom: 'c-2' } };

function serve() {
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/feed')) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(API)); }
    const headers = { 'Content-Type': 'text/html' };
    if (req.url === '/csp') headers['Content-Security-Policy'] = "style-src 'self'";
    res.writeHead(200, headers);
    res.end(FEED);
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

// (as the model's JavaScript tool: the text evaluated, a promise awaited)
const paste = (page, text) => page.evaluate(text);

test('the skill\'s page scripts in a real page: try-style, try-boxed, record, sweep and download, each undone', { skip: browserTestsSkip() }, async (t) => {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const downloads = fs.mkdtempSync(path.join(os.tmpdir(), 'trif-skill-dl-'));
  let browser;
  try {
    browser = await launch();
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${base}/`);
    const shown = (sel) => page.evaluate(`[...document.querySelectorAll(${JSON.stringify(sel)})].filter((e) => getComputedStyle(e).display !== 'none').length`);

    await t.test('try-style: TRIF\'s runtime on the page, a report of what each rule hit, and undo', async () => {
      assert.match(await paste(page, script('try-style.js')), /try-style ready/);
      const rules = { hide: ['[data-testid=sidebarColumn] [aria-label=Trending]', '.nothing-here'], filter: [{ items: '[data-testid=cellInnerDiv]', hideIfText: 'promoted' }], replace: [{ in: 'article', find: 'Grok', with: 'the robot' }], css: '[data-testid=primaryColumn] { max-width: 700px }' };
      const r = await page.evaluate(`__trifTry.style(${JSON.stringify(rules)})`);
      assert.deepEqual(r.hide.map((h) => [h.selector, h.matches, h.wereShowing]), [['[data-testid=sidebarColumn] [aria-label=Trending]', 1, 1], ['.nothing-here', 0, 0]]);
      assert.deepEqual([r.filter[0].matches, r.filter[0].hidden], [6, 2]);
      assert.ok(r.filter[0].hiddenSamples.every((s) => /Promoted/.test(s)) && r.filter[0].keptSamples.every((s) => !/Promoted/.test(s)), JSON.stringify(r.filter));
      assert.equal(r.replace[0].textsChanged, 6);
      assert.deepEqual(r.css, [{ selector: '[data-testid=primaryColumn]', matches: 1 }]);
      assert.ok(r.warnings.some((w) => /\.nothing-here matches nothing/.test(w)));
      assert.equal(await shown('[aria-label=Trending]'), 0);
      assert.equal(await shown('[data-testid=cellInnerDiv]'), 4);
      assert.equal(await page.evaluate('getComputedStyle(document.querySelector("main")).maxWidth'), '700px');
      // (content that arrives later: the rules re-apply, as in TRIF)
      await page.evaluate('add(3)');
      const again = await page.evaluate('__trifTry.report()');
      assert.deepEqual([again.filter[0].matches, again.filter[0].hidden, again.replace[0].textsChanged], [9, 3, 9]);
      const u = await page.evaluate('__trifTry.undo()');
      assert.deepEqual(u, { undone: 1, left: 0 });
      await page.waitForTimeout(100);
      assert.equal(await shown('[aria-label=Trending]'), 1);
      assert.equal(await shown('[data-testid=cellInnerDiv]'), 9);
      assert.equal(await page.evaluate('document.body.innerText.includes("the robot")'), false);
      assert.equal(await page.evaluate('getComputedStyle(document.querySelector("main")).maxWidth'), 'none');
      // (and after undo, what the page adds stays as the page made it)
      await page.evaluate('add(3)');
      await page.waitForTimeout(100);
      assert.equal(await shown('[data-testid=cellInnerDiv]'), 12);
    });

    await t.test('try-style on a page whose security policy refuses inline styles: a constructed sheet, and a note', async () => {
      await page.goto(`${base}/csp`);
      await paste(page, script('try-style.js'));
      const r = await page.evaluate('__trifTry.style({ css: "main { outline: 3px solid rgb(255, 0, 0) }", hide: ["aside"] })');
      assert.ok(r.warnings.some((w) => /security policy/.test(w)), JSON.stringify(r.warnings));
      assert.equal(await page.evaluate('getComputedStyle(document.querySelector("main")).outlineColor'), 'rgb(255, 0, 0)');
      assert.equal(await shown('aside'), 0);
      await page.evaluate('__trifTry.undo()');
      assert.equal(await shown('aside'), 1);
      assert.equal(await page.evaluate('document.adoptedStyleSheets.length'), 0);
    });

    await t.test('try-boxed: a boxed mod\'s code over the page, what the box refuses refused, and undo', async () => {
      await page.goto(`${base}/`);
      assert.match(await paste(page, script('try-boxed.js')), /try-boxed ready/);
      const mod = `trif.css('.trif-box-long { outline: 2px solid red }');
        trif.observe('[data-testid=cellInnerDiv]', (cell) => {
          if (cell.text.includes('Promoted')) return cell.hide();
          cell.classes.add('trif-box-long');
          const tick = page.create('span'); tick.setText(' ok'); tick.setAttr('data-trif-box-tick', ''); cell.append(tick);
        });
        trif.log('started', trif.style.width, typeof window, typeof document, typeof fetch);`;
      const r = await page.evaluate(`__trifBox.run(async function (trif, page) { with (__trifBox.scope) {\n${mod}\n}}, { style: { width: 700 } })`);
      assert.equal(r.ok, true, JSON.stringify(r));
      assert.deepEqual([r.changed.hidden, r.changed.classes, r.made], [2, 4, 4]);
      assert.ok(r.logs.includes('log: started 700 undefined undefined undefined'), JSON.stringify(r.logs));
      assert.equal(await page.evaluate('document.querySelectorAll(".trif-box-long").length'), 4);
      // (later content: observe sees it)
      await page.evaluate('add(3)');
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate('document.querySelectorAll("[data-trif-box-tick]").length'), 6);
      const u = await page.evaluate('__trifBox.undo()');
      assert.equal(u.left, 0);
      assert.equal(await page.evaluate('document.querySelectorAll(".trif-box-long, [data-trif-box-tick]").length'), 0);
      assert.equal(await shown('[data-testid=cellInnerDiv]'), 9);
      assert.equal(await page.evaluate('[...document.styleSheets].some((s) => [...s.cssRules].some((r) => /trif-box-long/.test(r.cssText)))'), false);
      await page.evaluate('add(3)');
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate('document.querySelectorAll("[data-trif-box-tick]").length'), 0, 'its observer is stopped');

      // what the box doesn't allow
      const bad = await page.evaluate(`__trifBox.run(async function (trif, page) { with (__trifBox.scope) {
        try { page.find('#feed').classes.add('mine'); } catch {}
        try { page.find('#feed').setAttr('onclick', 'x()'); } catch {}
        try { trif.css('body { background: url(https://elsewhere.example/a.png) }'); } catch {}
        try { trif.audio(); } catch {}
        document.title = 'x';
      }})`);
      assert.equal(bad.ok, false);
      assert.ok(bad.refused.some((x) => /trif-box-/.test(x)), JSON.stringify(bad.refused));
      assert.ok(bad.refused.some((x) => /setAttr\("onclick"/.test(x)));
      assert.ok(bad.refused.some((x) => /loads something new/.test(x)));
      assert.ok(bad.refused.some((x) => /sound power/.test(x)));
      assert.ok(bad.errors.some((x) => /title|undefined/.test(x)), JSON.stringify(bad.errors));
      assert.equal(await page.evaluate('document.getElementById("feed").className'), '');
      await page.evaluate('__trifBox.undo()');
    });

    await t.test('record: the page\'s own JSON kept, a site-data filter tried on it, and fetch put back', async () => {
      await page.goto(`${base}/`);
      assert.match(await paste(page, script('record.js')), /record ready/);
      assert.match(await page.evaluate('__trifRecord.start(/\\/api\\//)'), /recording/);
      assert.equal(await page.evaluate('loadMore()'), 3);
      await page.waitForTimeout(100);
      const list = await page.evaluate('__trifRecord.list()');
      assert.deepEqual(list.map((x) => [x.method, x.url.replace(base, ''), x.status, x.top]), [['GET', '/api/feed?page=2', 200, ['items', 'cursor']]]);
      assert.deepEqual(await page.evaluate('__trifRecord.find(0, "post 8")'), ['items.1.text']);
      assert.deepEqual(await page.evaluate('__trifRecord.shape(0, "", 1)'), { items: '[3]', cursor: '{1 keys}' });
      // a boxed mod's site-data filter, kept by try-boxed, run on what was recorded
      await paste(page, script('try-boxed.js'));
      await page.evaluate(`__trifBox.run(async function (trif, page) { with (__trifBox.scope) {
        trif.filterResponse('*/api/feed*', (data) => { data.items = data.items.filter((i) => !i.promoted); return data; });
      }}, { powers: ['site-data'] })`);
      const tried = await page.evaluate(`(() => { const before = __trifRecord.get(0); const copy = structuredClone(before);
        const after = __trifBox.filters[0].fn(copy, __trifRecord.info(0)) ?? copy;
        return { kept: after.items.map((i) => i.id), cursor: after.cursor.bottom, rule: __trifBox.checkFilter(before, after),
          bad: __trifBox.checkFilter(before, { ...after, note: 'made up' }) }; })()`);
      assert.deepEqual(tried.kept, ['p7', 'p9']);
      assert.equal(tried.cursor, 'c-2');
      assert.deepEqual(tried.rule, { ok: true });
      assert.equal(tried.bad.ok, false);
      await page.evaluate('__trifBox.undo()');
      assert.deepEqual(await page.evaluate('__trifRecord.stop()'), { stopped: true, kept: 1 });
      assert.equal(await page.evaluate('String(window.fetch).includes("[native code]") && String(XMLHttpRequest.prototype.open).includes("[native code]")'), true);
    });

    await t.test('sweep: trif sweep itself, pasted', async () => {
      assert.match(await paste(page, script('sweep.js')), /sweep ready/);
      const r = await page.evaluate('__trifSweep({ selector: "[data-testid=cellInnerDiv]" })');
      assert.ok(!r.error, r.error);
      assert.equal(r.total, 9, JSON.stringify(r).slice(0, 300));
      assert.equal(r.summary.visible, 9);
      const text = await page.evaluate('__trifSweep({ text: "Promoted", limit: 5 })');
      assert.ok(text.total >= 3, JSON.stringify(text).slice(0, 300));
    });

    await t.test('download: the mod saved by the browser, and TRIF\'s import takes the file as the checker said', async () => {
      await browser.cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads, eventsEnabled: true });
      const mod = '// ==WebMod==\n// @name        Calm feed\n// @description Hides promoted posts in the feed\n// @match       http://127.0.0.1/*\n// @style\n// @risk        1 hides promoted posts, so their ad impressions never report\n// ==/WebMod==\n{ "filter": [{ "items": "[data-testid=cellInnerDiv]", "hideIfText": "Promoted" }] }\n';
      assert.match(await paste(page, script('download.js')), /download ready/);
      const r = await page.evaluate(`__trifDownload('calm-feed.js', ${JSON.stringify(mod)})`);
      assert.equal(r.saved, true);
      const file = path.join(downloads, 'calm-feed.js');
      const end = Date.now() + 10000;
      while (!fs.existsSync(file) && Date.now() < end) await page.waitForTimeout(100);
      assert.equal(fs.readFileSync(file, 'utf8'), mod);
      await assert.rejects(page.evaluate('__trifDownload("x.js", "alert(1)")'), /isn't a mod/);
      const home = fs.mkdtempSync(path.join(os.tmpdir(), 'trif-skill-ws-'));
      const imported = share.importMod({ home, modsDir: path.join(home, 'sites') }, { text: fs.readFileSync(file, 'utf8'), name: 'calm-feed.js' });
      assert.equal(imported.id, '127.0.0.1/calm-feed');
      assert.equal(checkMod(mod, { fileName: 'calm-feed.js' }).id, imported.id);
      assert.deepEqual(Object.keys(share.loadImported(home)), ['127.0.0.1/calm-feed'], 'marked imported: TRIF starts it off');
      // (where it came from, as Chrome recorded it on the file: what TRIF's "Add this mod?" card names. Headless
      // Chrome for Testing writes the quarantine record but, here, no where-from record: the card then says the file is in
      // the Downloads folder, without a site)
      if (process.platform === 'darwin') { const o = await originOf(file); t.diagnostic(`recorded on the download: ${JSON.stringify(o)}`); assert.match(String(o.app), /Chrome/, 'the quarantine record names the browser'); assert.ok(o.from === null || o.from === '127.0.0.1', 'a where-from record, if any, names the page\'s site, never more'); }
    });

    assert.deepEqual(errors, [], 'nothing thrown in the page');
  } finally {
    if (browser) await browser.close();
    server.close();
    fs.rmSync(downloads, { recursive: true, force: true });
  }
});
