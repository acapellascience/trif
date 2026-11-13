#!/usr/bin/env node
'use strict';
// A smoke test of the Safari probe's extension, in Chromium (the only browser that runs here): the checks
// run on every probe page without the suite itself breaking, and the picker hides what's pointed at and
// hides it again on the next load. What Safari on an iPhone answers is the thing the probe is for; this
// only says the probe's own code works.
//
//   node mobile/test/smoke.js      (npm test finds it too; skipped where Playwright has no Chromium)

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { handler } = require('../serve');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch { /* none here: skipped */ }

test('the mobile probes: the Safari probe\'s extension and the browser probe\'s checks run, in Chromium', { skip: chromium ? false : 'no Playwright Chromium here', timeout: 170000 }, async () => {
  execFileSync(process.execPath, [path.join(__dirname, '..', 'prepare.js'), '--check'], { stdio: 'inherit' });
  const ext = execFileSync(process.execPath, [path.join(__dirname, '..', 'safari-probe', 'build.js'), '--chrome']).toString().trim();
  const canary = [];
  const server = http.createServer(handler((line) => canary.push(line)));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'trif-probe-'));
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
  try {
    const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const page = await context.newPage();
    const answers = {};
    for (const name of ['plain', 'strict', 'trusted', 'hostile', 'spa']) {
      await page.goto(`${base}/${name}.html`);
      await page.waitForTimeout(300);
      const run = await sw.evaluate(async (url) => { const [tab] = await chrome.tabs.query({ url }); return runSuite(tab.id); }, `${base}/${name}.html`);
      assert.ok(!run.error, run.error);
      answers[name] = Object.fromEntries(run.results.map((r) => [r.id, r.answer]));
      const errors = run.results.filter((r) => r.answer === 'error');
      console.log(`${name}: ${run.results.map((r) => `${r.id}=${r.answer}`).join(' ')}`);
      for (const r of run.results) if (process.env.VERBOSE || r.answer === 'error') console.log(`   ${r.id}: ${JSON.stringify(r.detail)}`);
      // (no app behind it here, so the native check can't answer; everything else has to)
      assert.deepEqual(errors.filter((r) => r.id !== 'native').map((r) => r.id), [], `${name}: checks that broke`);
    }
    // What Chromium answers, where that's known. Its extension world refuses eval (which is why TRIF's box
    // lives in a userScripts world there), so the box checks get as far as starting and then say no: the
    // question the probe puts to Safari.
    for (const name of Object.keys(answers)) {
      for (const id of ['main.func', 'box.ses', 'box.start', 'kit', 'styles', 'timing.start', 'network']) assert.equal(answers[name][id], 'yes', `${name} ${id}`);
      for (const id of ['own.eval', 'box.compartment', 'box.run']) assert.equal(answers[name][id], 'no', `${name} ${id}`);
    }
    assert.equal(answers.plain['main.eval'], 'yes');
    assert.equal(answers.strict['main.eval'], 'no');
    assert.ok(canary.length > 0, 'the canary was asked for');

    // The box checks' own code, where eval is allowed (the plain page's own world): they say yes there.
    const fresh = await context.newPage();
    await fresh.goto(`${base}/plain.html`);
    const gen = path.join(ext, 'gen');
    await fresh.addScriptTag({ path: path.join(gen, 'ses.umd.min.js') });
    await fresh.addScriptTag({ path: path.join(gen, 'sandbox-runtime.js') });
    const src = await sw.evaluate(() => ({ start: pageSesStart.toString(), evaluate: pageSesEvaluate.toString() }));
    const started = await fresh.evaluate(`(${src.start})()`);
    assert.equal(started.started, true, JSON.stringify(started));
    await fresh.evaluate(`(${src.evaluate})('__r', 'p1', '[typeof document, typeof fetch, page.findAll("article").length].join(",")')`);
    await fresh.waitForFunction(() => globalThis.__r !== undefined);
    const env = JSON.parse(await fresh.evaluate(() => globalThis.__r));
    assert.equal(env.ok, true, JSON.stringify(env));
    assert.equal(JSON.parse(env.json), 'undefined,undefined,6');
    await fresh.close();

    // pointing: pick the promoted post, hide it, and it's hidden again after a reload
    await page.goto(`${base}/plain.html`);
    await page.waitForTimeout(300);
    await sw.evaluate(async (url) => { const [tab] = await chrome.tabs.query({ url }); await chrome.tabs.sendMessage(tab.id, { type: 'pick' }); }, `${base}/plain.html`);
    await page.locator('article.promoted h2').click();
    assert.equal(await page.evaluate(() => window.__clicked), undefined);
    const bar = page.locator('trif-probe-bar');
    assert.equal(await bar.count(), 1);
    // (the bar's root is closed, so it's pressed by where it is)
    const picked = await sw.evaluate(async (url) => {
      const [tab] = await chrome.tabs.query({ url });
      const r = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => { const k = globalThis.__trifKit; let d = k.describe(k.chosen()); while (d.tag !== 'article') d = k.wider(); return d; } });
      return r[0].result;
    }, `${base}/plain.html`);
    console.log(`picked: ${JSON.stringify(picked)}`);
    assert.equal(picked.selector, 'article[data-testid="promoted-post"]');
    assert.equal(picked.how, 'test id');
    await sw.evaluate((host) => saveRule(host, { selector: 'article[data-testid="promoted-post"]', how: 'test id', matches: 1, text: '', at: Date.now() }), '127.0.0.1');
    await page.reload();
    await page.waitForTimeout(400);
    assert.equal(await page.locator('article.promoted').isVisible(), false, 'hidden again after a reload');
    const rec = await sw.evaluate(async (url) => { const [tab] = await chrome.tabs.query({ url }); const r = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => globalThis.__trifProbeStart }); return r[0].result; }, `${base}/plain.html`);
    console.log(`reload: ${JSON.stringify(rec)}`);
    assert.equal(rec.rules, 1);
    assert.equal(rec.way.way, 'adopted sheet');
    // the same on the strict page (same host, so the same rule)
    await page.goto(`${base}/strict.html`);
    await page.waitForTimeout(400);
    assert.equal(await page.locator('article.promoted').isVisible(), false, 'hidden on the strict page too');

    // the kit names things the way the notes say: build-tool classes fall back to position
    const names = await sw.evaluate(async (url) => {
      const [tab] = await chrome.tabs.query({ url });
      const r = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => {
        const k = globalThis.__trifKit; const q = (s) => document.querySelector(s);
        return { banner: k.selectorFor(q('#promo-banner')), cookie: k.selectorFor(q('.cookie-consent')), atomic: k.selectorFor(q('.r-1habvwh:nth-of-type(2)')), trending: k.selectorFor(q('.trending')), like: k.similarTo(q('article')), outline: k.outline(6000).text };
      } });
      return r[0].result;
    }, `${base}/strict.html`);
    console.log(JSON.stringify({ ...names, outline: undefined }, null, 1));
    console.log(names.outline);
    assert.equal(names.banner.selector, '#promo-banner');
    assert.equal(names.atomic.how, 'position');
    assert.equal(names.like.matches, 5);

    // The browser probe's JavaScript checks, as the app would run them (each step the body of an async
    // function given prevJson), all in one world here: Chromium has no second world to give them. So the
    // checks about worlds being apart say no, and the rest have to answer.
    const checks = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'shared', 'gen', 'browser-checks.json'), 'utf8'));
    const web = path.join(__dirname, '..', 'browser-probe', 'TrifProbe', 'Web');
    const app = await context.newPage();
    await app.addInitScript({ content: `${fs.readFileSync(path.join(__dirname, '..', 'shared', 'kit.js'), 'utf8')}\n${fs.readFileSync(path.join(web, 'start-own.js'), 'utf8')}({});\n${fs.readFileSync(path.join(web, 'start-page.js'), 'utf8')}\nwindow.webkit = { messageHandlers: { trif: { postMessage: async (m) => ({ ok: true, received: (m.pad || '').length }) } } };` });
    await app.goto(`${base}/plain.html`);
    let boxed = false;
    const got = {};
    for (const check of checks) {
      if (!boxed && check.steps.some((st) => st.world === 'box')) { boxed = true; await app.addScriptTag({ path: path.join(gen, 'ses.umd.min.js') }); await app.addScriptTag({ path: path.join(gen, 'sandbox-runtime.js') }); }
      let prev = 'null';
      // (as text: once SES has locked the page down, the async function constructor is gone, as it is for a mod)
      for (const st of check.steps) prev = await app.evaluate(`(async (prevJson) => { ${st.body}\n})(${JSON.stringify(prev)})`);
      const last = JSON.parse(prev);
      assert.ok(last && typeof last.answer === 'string' && 'detail' in last, `${check.id}: ${prev}`);
      got[check.id] = last.answer;
      if (process.env.VERBOSE) console.log(`   app ${check.id}: ${prev.slice(0, 600)}`);
    }
    console.log(`app checks: ${Object.entries(got).map(([k, v]) => `${k}=${v}`).join(' ')}`);
    for (const id of ['worlds.clean', 'page.eval', 'own.eval', 'timing.own', 'timing.page', 'messaging', 'styles.own', 'kit', 'box.start', 'box.compartment', 'box.run', 'box.confined', 'box.mod']) assert.equal(got[id], 'yes', `app ${id}`);
    assert.equal(await app.locator('#out').textContent(), 'a boxed mod wrote this');
    await app.close();

    // the report page and the popup load without errors
    const id = new URL(sw.url()).host;
    const errors = [];
    for (const file of ['report.html', 'popup.html']) {
      const p = await context.newPage();
      p.on('pageerror', (e) => errors.push(`${file}: ${e.message}`));
      await p.goto(`chrome-extension://${id}/${file}`);
      await p.waitForTimeout(400);
      if (file === 'report.html') { const json = JSON.parse(await p.locator('#json').inputValue()); assert.equal(json.probe, 'safari'); assert.ok(json.runs.length >= 5); }
      await p.close();
    }
    assert.deepEqual(errors, []);
    console.log('\nsmoke: ok');
  } finally {
    await context.close();
    server.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
