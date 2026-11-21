#!/usr/bin/env node
'use strict';
// TRIF's browser features (Tim 11-20: "i think i'm fine with browser features working, as long as they're beyond the
// modification powers of the agents and mods"): video pick-up, background play, the pause while talking, the tab
// list's "is it playing" and password looks, the desktop agent fix. They run on every site in their own content
// world, "trif-browser" (SiteAccess.swift, BrowserWorld). What this checks in the sources, with no Simulator:
//   - the world, its handler and its calls are SiteAccess.swift's alone (and the Debug-only dev steps'): no other file
//     names them, nothing shared with mods (mobile/shared: the kit, gen/mods.js, the sandbox runtime, chat.js, the
//     mod guide) mentions them, and ModStore.world can't give a mod that world;
//   - the handler is registered for that world only, and the watch posts to it alone;
//   - the app reaches the world only through TabWebView.browserFeature, by a closed list of fixed scripts (each a
//     constant string literal, never put together from data), and those scripts go nowhere else;
//   - TabWebView refuses every other script into the world, before its readable check (so on every site);
//   - the watches ignore events a page or a mod dispatches (isTrusted), run in node's vm.
//   node --test mobile/test/browserworld.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = path.join(__dirname, '..', 'browser-probe', 'TrifProbe');
const SHARED = path.join(__dirname, '..', 'shared');
const read = (f) => fs.readFileSync(f, 'utf8');
const swift = Object.fromEntries(fs.readdirSync(APP).filter((f) => f.endsWith('.swift')).map((f) => [f, read(path.join(APP, f))]));
const literal = (src, owner, name) => {
  const m = src.match(new RegExp(`static let ${name} = """\\n([\\s\\S]*?)\\n\\s*"""`));
  assert.ok(m, `${owner}.${name}`);
  return m[1].replace(/\\(.)/g, (x, c) => ({ n: '\n', t: '\t', '\\': '\\', "'": "'", '"': '"' })[c] ?? x);
};
/** A Swift file's lines inside #if DEBUG … #endif (the dev steps), and the rest. */
const split = (src) => {
  const debug = [], rest = [];
  let depth = 0, inDebug = 0;
  for (const line of src.split('\n')) {
    const t = line.trim();
    if (/^#if\b/.test(t)) { depth++; if (/^#if DEBUG\b/.test(t) && !inDebug) inDebug = depth; continue; }
    if (/^#endif\b/.test(t)) { if (inDebug === depth) inDebug = 0; depth--; continue; }
    (inDebug ? debug : rest).push(line);
  }
  return { debug: debug.join('\n'), rest: rest.join('\n') };
};

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (/\.(js|json|txt|html|css)$/.test(e.name)) out.push(p);
  }
  return out;
}

test('the browser world is SiteAccess.swift\'s alone: no other file, nothing of the mods\', names it', () => {
  for (const [f, src] of Object.entries(swift)) {
    if (f === 'SiteAccess.swift') continue;
    assert.ok(!/"trif-browser"/.test(src), `${f} names the world`);
    // (the dev steps may name it, Debug builds only: to show that a call into it is refused)
    assert.ok(!/BrowserWorld\.world\b/.test(split(src).rest), `${f} reaches the world itself`);
    assert.ok(!/super\.__(callAsync|evaluate)JavaScript/.test(src), `${f} goes past TabWebView`);
  }
  // (the stand-in pages, mobile/shared/pages, look for it from the page's side: tests, not shared code)
  for (const f of walk(SHARED).filter((x) => !x.startsWith(path.join(SHARED, 'pages') + path.sep))) {
    const t = read(f);
    assert.ok(!/trif-browser|trifBrowser|__trifVideo|__trifPause/.test(t), `${path.relative(SHARED, f)} mentions the browser world`);
  }
  // (a mod's world is the page's, TRIF's or the box: a closed choice)
  const w = /private static func world\(_ w: String\) -> WKContentWorld \{([^\n]*)\}/.exec(swift['Mods.swift']);
  assert.ok(w, 'ModStore.world');
  assert.equal(w[1].trim(), 'w == "box" ? Browser.boxWorld : w == "page" ? .page : Browser.trifWorld');
  assert.ok(!/BrowserWorld/.test(swift['Mods.swift']) && !/BrowserWorld/.test(swift['PhoneSync.swift']) && !/BrowserWorld/.test(swift['ClaudePane.swift']) && !/BrowserWorld/.test(swift['PanelChat.swift']), 'mods, sync and chats never touch it');
});

test('its handler is for its world only; only the watch posts to it', () => {
  const sa = swift['SiteAccess.swift'];
  assert.match(sa, /static let world = WKContentWorld\.world\(name: "trif-browser"\)/);
  assert.match(sa, /static let handlerName = "trifBrowser"/);
  const adds = [...Object.values(swift).join('\n').matchAll(/addScriptMessageHandler\(([^)]*)\)/g)].map((m) => m[1]);
  const ours = adds.filter((a) => /handlerName|trifBrowser/.test(a));
  assert.deepEqual(ours, ['handler, contentWorld: world, name: handlerName']);
  assert.ok(!/\.add\(\s*\w+,\s*name:/.test(Object.values(swift).join('\n')), 'no handler for the page world by the old add(_:name:)');
  const posts = Object.entries(swift).filter(([, s]) => /messageHandlers\.trifBrowser\.postMessage/.test(s)).map(([f]) => f);
  assert.deepEqual(posts, ['VideoResume.swift']);
  const watch = literal(swift['VideoResume.swift'], 'VideoResume', 'watch');
  assert.ok(!/messageHandlers\.trif\./.test(watch), 'the watch never posts to TRIF\'s handler');
  // (the handler checks the world and the frame again, and takes only the video messages)
  assert.match(sa, /guard BrowserWorld\.isIt\(message\.world\), message\.frameInfo\.isMainFrame/);
  assert.match(sa, /static let types: Set<String> = \["videoplan", "videostate", "videoplay", "videoapplied", "videoresumed"\]/);
  // (and TRIF's own handler no longer takes them)
  assert.ok(!/case "videoplan"/.test(swift['Browser.swift'].split('func videoMessage')[0]), 'TRIF\'s handler takes video messages');
});

test('the app reaches it only through browserFeature, by fixed scripts that go nowhere else', () => {
  const sa = swift['SiteAccess.swift'];
  const supers = [...sa.matchAll(/super\.__callAsyncJavaScript\(([^\n]*)/g)].map((m) => m[1]);
  assert.equal(supers.filter((s) => /BrowserWorld\.world/.test(s)).length, 1, 'one way in');
  assert.match(sa, /super\.__callAsyncJavaScript\(call\.script, arguments: call\.arguments, inFrame: nil, in: BrowserWorld\.world\)/);
  // (both script methods refuse the world first, before the readable check: on every site)
  for (const m of ['__evaluateJavaScript', '__callAsyncJavaScript']) {
    const body = new RegExp(`override func ${m}\\([^\\n]*\\n([^\\n]*)\\n([^\\n]*)`).exec(sa);
    assert.ok(body, m);
    assert.match(body[1], /guard !BrowserWorld\.isIt\(contentWorld\) else/);
    assert.match(body[2], /guard readable\(frame\) else/);
  }
  // (the closed list: each case's script a constant)
  const cases = /var script: String \{\s*switch self \{([\s\S]*?)\n\s*\}\n\s*\}/.exec(sa);
  assert.ok(cases, 'BrowserCall.script');
  const refs = [...cases[1].matchAll(/return ([^\n]+)/g)].map((m) => m[1].trim());
  const where = { Browser: 'Browser.swift', VideoResume: 'VideoResume.swift', BackgroundPlay: 'Browser.swift', PrivatePages: 'Tabs.swift' };
  for (const r of refs) {
    if (r.startsWith('"')) { assert.ok(!/\\\(/.test(r), `${r}: no interpolation`); continue; }
    const [owner, name] = r.split('.');
    const src = swift[where[owner]];
    assert.ok(src, r);
    const decl = new RegExp(`static let ${name} = ("""|")`).exec(src);
    assert.ok(decl, `${r} is a static string constant`);
    const text = decl[1] === '"""' ? literal(src, owner, name) : /static let \w+ = "([^\n]*)"$/m.exec(src.slice(decl.index))[1];
    // (no interpolation but the video id rule's own fixed text)
    assert.ok(!/\\\((?!videoIDScript\))/.test(text), `${r}: put together from data`);
    // (used nowhere but here: never handed to a script call of its own)
    const uses = Object.values(swift).join('\n').split(r).length - 1;
    assert.equal(uses, 1, `${r} used ${uses} times`);
  }
  // (arguments: numbers and yes/no only)
  const args = /var arguments: \[String: Any\] \{([\s\S]*?)\n\s{4}\}/.exec(sa)[1];
  assert.ok(!/String\(|"\\\(/.test(args), 'no text arguments');
  assert.match(sa, /case play\(forceMuted: Bool\)/);
  assert.match(sa, /case playOn\(left: Double, shown: Bool\)/);
  assert.match(sa, /case talkNudge\(step: Int\)/);
  // (the two watches are the only start scripts in the world)
  assert.match(sa, /static let scripts: \[WKUserScript\] = \[BackgroundPlay\.watch, VideoResume\.watch\]\.map/);
  assert.ok(!/start\((BackgroundPlay|VideoResume)\.watch/.test(swift['Browser.swift']), 'not in TRIF\'s world too');
});

test('the watches ignore events a page or a mod makes up (isTrusted), and play on only what the browser paused', () => {
  const watch = literal(swift['Browser.swift'], 'BackgroundPlay', 'watch');
  const listeners = {};
  const media = { paused: true, ended: false, played: 0, play() { this.played++; return Promise.resolve(); } };
  const doc = {
    visibilityState: 'visible',
    addEventListener: (k, f) => { listeners[`d:${k}`] = f; },
    querySelectorAll: () => [media],
  };
  class HTMLMediaElement {}
  Object.setPrototypeOf(media, HTMLMediaElement.prototype);
  const ctx = { document: doc, window: { addEventListener: (k, f) => { listeners[`w:${k}`] = f; } }, HTMLMediaElement, Date };
  vm.runInNewContext(watch, ctx);
  // (a made-up pause, then a made-up hide: nothing)
  listeners['d:pause']({ isTrusted: false, target: media });
  assert.equal(media.__trifPause, undefined);
  listeners['d:pause']({ isTrusted: true, target: media });
  assert.ok(media.__trifPause);
  doc.visibilityState = 'hidden';
  listeners['w:visibilitychange']({ isTrusted: false });
  assert.equal(media.played, 0);
  listeners['w:visibilitychange']({ isTrusted: true });
  assert.equal(media.played, 1);
  const v = literal(swift['VideoResume.swift'], 'VideoResume', 'watch');
  assert.match(v, /const on = \(e\) => \{\n\s*if \(!e\.isTrusted\) return;/);
  assert.match(v, /if \(e\.isTrusted\) S\.touched = Date\.now\(\)/);
});
