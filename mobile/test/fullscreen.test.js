#!/usr/bin/env node
'use strict';
// Full screen is how the person is looking at the browser, not a property of a tab (Tim 11-21: "If you're in browser
// mode and you go get an old tab that was opened from a bookmark link, you still want browser mode";
// docs/MOBILE-BEHAVIOUR.md, "Icons (Home Screen) and full screen"). What this checks in the sources, with no Simulator:
//   - Browser.fullScreen is one stored flag, not looked up per tab, and nothing keeps a set of full screen tabs;
//   - setFullScreen takes no tab; select, newTab and close never touch full screen;
//   - a launch never restores it (the old "fullScreenTabs" pref is only removed), so the app starts in TRIF view; only
//     an icon (showIconTabAtLaunch / openFullScreen) and the person (toggle, ⋯, the exit button) set it.
// The behaviour itself: the iconcheck dev step's "view kept" rows (Simulator).
//   node --test mobile/test/fullscreen.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'browser-probe', 'TrifProbe');
const swift = Object.fromEntries(fs.readdirSync(APP).filter((f) => f.endsWith('.swift')).map((f) => [f, fs.readFileSync(path.join(APP, f), 'utf8')]));
const browser = swift['Browser.swift'];
// a Swift func's body, from its signature to the closing brace at the same indent
const body = (src, sig) => {
  const i = src.indexOf(sig);
  assert.ok(i >= 0, sig);
  const indent = src.slice(src.lastIndexOf('\n', i) + 1, i);
  const end = src.indexOf(`\n${indent}}`, i);
  return src.slice(i, end);
};

test('full screen is one flag for the app, not per tab', () => {
  assert.match(browser, /@Published private\(set\) var fullScreen = false\n/);
  for (const [f, src] of Object.entries(swift)) {
    assert.doesNotMatch(src, /fullScreenTabs\s*[.:=]|fullScreenTabs\.contains/, `${f}: a set of full screen tabs`);
    assert.doesNotMatch(src, /setFullScreen\([^)]*\btab:/, `${f}: setFullScreen for a tab`);
  }
  assert.match(browser, /func setFullScreen\(_ on: Bool, note: Bool = true\)/);
});

test('choosing, opening or closing a tab keeps the view', () => {
  for (const sig of ['func select(_ tab: Tab)', 'func newTab(_ address: String? = nil)', 'func close(_ tab: Tab, showing next: Tab? = nil)',
    'func webView(_ webView: WKWebView, createWebViewWith']) {
    assert.doesNotMatch(body(browser, sig), /fullScreen/i, sig);
  }
});

test('a launch starts in TRIF view: nothing restores full screen', () => {
  assert.match(browser, /UserDefaults\.standard\.removeObject\(forKey: "fullScreenTabs"\)/);
  for (const [f, src] of Object.entries(swift)) {
    const reads = src.match(/(stringArray|object|array|bool)\(forKey: "fullScreen[^"]*"\)/g) || [];
    assert.deepEqual(reads.filter((r) => !r.includes('fullScreenHinted')), [], `${f} reads a kept full screen`);
  }
  // who turns it on: the icon's two paths, and the person's own (the toggle, ⋯ → Full screen)
  const on = Object.entries(swift).flatMap(([f, src]) => (src.match(/setFullScreen\(true/g) || []).map(() => f));
  assert.deepEqual(on.sort(), ['TrifProbeApp.swift', 'WebClip.swift', 'WebClip.swift', 'WebClip.swift'].sort());
  assert.match(body(swift['WebClip.swift'], 'func showIconTabAtLaunch('), /setFullScreen\(true/);
  assert.match(body(swift['WebClip.swift'], 'func openFullScreen('), /setFullScreen\(true/);
});
