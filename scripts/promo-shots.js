#!/usr/bin/env node
'use strict';
// Promo screenshots of TRIF on the sites it ships mods for, in Tim's own Chrome and Firefox (macOS only).
//
//   node scripts/promo-shots.js open [chrome|firefox|both]   a new window in each, a tab per site, sized so
//                                                             the area under the toolbar (page + side panel)
//                                                             is exactly 16:9, as big as the screen allows
//   node scripts/promo-shots.js shoot [chrome|firefox|both] [--out DIR]
//                                                             every tab of those windows, that 16:9 area
//                                                             each (full Retina resolution), into DIR
//                                                             (default dist/promo/<time>/)
//
// Between the two, set things up by hand: open TRIF's panel, switch mods, scroll. Moving a window is fine
// (`shoot` reads where it is); resizing it breaks the 16:9 (run `open` again, or put it back).
//
// macOS has to allow it, for the app this runs from (Claude, or Terminal): Screen & System Audio Recording
// (the captures), Automation of Chrome and Firefox (asked the first time: windows, tabs), Accessibility
// (Firefox has no tab scripting: ⌘1… switches its tabs). The toolbar's height is measured in the page,
// through TRIF (`trif run --browser …`), so TRIF must be on for these sites (it is, out of the box).

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SITES = ['https://www.google.com/', 'https://x.com/home', 'https://www.amazon.com/', 'https://www.instagram.com/'];
const STATE = path.join(__dirname, '..', 'dist', 'promo', 'windows.json');
const TRIF = path.join(os.homedir(), '.trif', 'bin', 'trif');
const MARGIN = 0; // pt from the usable screen's edge

const sleep = (ms) => execFileSync('/bin/sleep', [String(ms / 1000)]);
const osa = (script, js = false) => execFileSync('osascript', [...(js ? ['-l', 'JavaScript'] : []), '-e', script], { encoding: 'utf8' }).trim();
const q = (s) => JSON.stringify(String(s)); // an AppleScript string literal (no backslashes or quotes in ours)

/** The usable screen (no menu bar, no Dock), in points, top-left origin. */
function screen() {
  return JSON.parse(osa(`ObjC.import('AppKit'); const s = $.NSScreen.mainScreen, f = s.frame, v = s.visibleFrame;
    JSON.stringify({ x: v.origin.x, y: f.size.height - (v.origin.y + v.size.height), w: v.size.width, h: v.size.height, scale: s.backingScaleFactor })`, true));
}

/** [outerWidth, outerHeight, innerWidth, innerHeight] of the active tab of the browser's last-focused window. */
function measure(browser) {
  for (let i = 0; i < 20; i++) {
    try {
      const out = execFileSync(TRIF, ['run', '--browser', browser, '[outerWidth, outerHeight, innerWidth, innerHeight]'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      const v = JSON.parse(out); // (trif run prints what the page returns, as JSON)
      if (Array.isArray(v) && v.length === 4 && v.every(Number.isFinite)) return v;
    } catch { /* the page is still loading, or TRIF isn't there yet */ }
    sleep(1000);
  }
  throw new Error(`couldn't measure ${browser}'s window through TRIF (is TRIF on, and the page loaded?)`);
}

/** The biggest 16:9 content area that fits under `top` pt of toolbar: [width, content height]. */
function fit(scr, top) {
  let w = Math.floor((scr.w - 2 * MARGIN) / 16) * 16;
  while ((w / 16) * 9 + top > scr.h - 2 * MARGIN) w -= 16;
  return [w, (w / 16) * 9];
}

function load() { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return {}; } }
function save(s) { fs.mkdirSync(path.dirname(STATE), { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(s, null, 2) + '\n'); }

// ---- Chrome: AppleScript does windows and tabs.
function chromeBounds(id) { return osa(`tell application "Google Chrome" to get bounds of window id ${id}`).split(/,\s*/).map(Number); }
function openChrome(scr) {
  const urls = SITES.slice(1).map((u) => `make new tab at end of tabs of w with properties {URL:${q(u)}}`).join('\n    ');
  const id = osa(`tell application "Google Chrome"
    activate
    set w to make new window
    set URL of active tab of w to ${q(SITES[0])}
    ${urls}
    set active tab index of w to 1
    return id of w
  end tell`);
  sleep(4000);
  // The toolbar's height (tabs, address bar, bookmarks), then the window that leaves 16:9 under it.
  let [, oh, , ih] = measure('chrome');
  const top = oh - ih;
  const [w, h] = fit(scr, top);
  osa(`tell application "Google Chrome" to set bounds of window id ${id} to {${scr.x + MARGIN}, ${scr.y + MARGIN}, ${scr.x + MARGIN + w}, ${scr.y + MARGIN + top + h}}`);
  sleep(1500);
  [, oh, , ih] = measure('chrome');
  return { id: Number(id), top: oh - ih, w, h, tabs: SITES.length, check: { innerHeight: ih, want: h } };
}
function shootChrome(st, dir) {
  const out = [];
  const n = Number(osa(`tell application "Google Chrome" to count tabs of window id ${st.id}`));
  for (let i = 1; i <= n; i++) {
    const url = osa(`tell application "Google Chrome"
      activate
      set index of window id ${st.id} to 1
      set active tab index of window id ${st.id} to ${i}
      return URL of active tab of window id ${st.id}
    end tell`);
    sleep(1500);
    const [l, t, r] = chromeBounds(st.id);
    out.push(capture(dir, 'chrome', i, url, l, t + st.top, r - l, st.h));
  }
  return out;
}

// ---- Firefox: no tab scripting, so System Events (Accessibility) for the window, ⌘1… for its tabs.
const ffWin = (body) => osa(`tell application "System Events" to tell process "Firefox"
  ${body}
end tell`);
function openFirefox(scr) {
  // (a second firefox process can't hand URLs to the running one on a Mac: typed instead, as by hand)
  osa('tell application "Firefox" to activate');
  sleep(800);
  ffWin('keystroke "n" using command down');
  SITES.forEach((u, k) => {
    sleep(k ? 600 : 1200);
    if (k) ffWin('keystroke "t" using command down');
    sleep(500);
    ffWin(`keystroke ${q(u)}
  key code 36`);
  });
  sleep(3500);
  ffWin('keystroke "1" using command down');
  sleep(1000);
  let [, oh, , ih] = measure('firefox');
  const top = oh - ih;
  const [w, h] = fit(scr, top);
  ffWin(`set position of front window to {${scr.x + MARGIN}, ${scr.y + MARGIN}}
  set size of front window to {${w}, ${top + h}}`);
  sleep(1500);
  [, oh, , ih] = measure('firefox');
  return { top: oh - ih, w, h, tabs: SITES.length, check: { innerHeight: ih, want: h } };
}
function shootFirefox(st, dir) {
  const out = [];
  osa('tell application "Firefox" to activate');
  sleep(800);
  // the promo window to the front: the one exactly its size (others may be open)
  const found = ffWin(`repeat with i from 1 to count windows
    set s to size of window i
    if item 1 of s = ${st.w} and item 2 of s = ${st.top + st.h} then
      perform action "AXRaise" of window i
      return "yes"
    end if
  end repeat
  return "no"`);
  if (found !== 'yes') throw new Error(`no Firefox window of ${st.w}×${st.top + st.h} pt: was it resized? (run open firefox again)`);
  sleep(800);
  for (let i = 1; i <= Math.min(st.tabs, 8); i++) {
    ffWin(`keystroke "${i}" using command down`);
    sleep(1500);
    const [x, y] = ffWin('get position of front window').split(/,\s*/).map(Number);
    const name = ffWin('get name of front window');
    out.push(capture(dir, 'firefox', i, name, x, y + st.top, st.w, st.h));
  }
  return out;
}

/** screencapture of a screen rectangle (points; the file is at the screen's own resolution). */
function capture(dir, browser, i, label, x, y, w, h) {
  const slug = String(label).replace(/^https?:\/\/(www\.)?/, '').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'tab';
  const file = path.join(dir, `${browser}-${i}-${slug}.png`);
  execFileSync('screencapture', ['-x', '-R', `${x},${y},${w},${h}`, file]);
  return file;
}

function main() {
  const [cmd, which = 'both', ...rest] = process.argv.slice(2);
  const browsers = which === 'both' ? ['chrome', 'firefox'] : [which];
  if (cmd === 'open') {
    const scr = screen();
    const st = load();
    for (const b of browsers) {
      st[b] = b === 'chrome' ? openChrome(scr) : openFirefox(scr);
      const { w, h, top, check } = st[b];
      console.log(`${b}: ${w}×${h} pt under a ${top} pt toolbar (${w * scr.scale}×${h * scr.scale} px)${check.innerHeight === check.want ? '' : `; the page measures ${check.innerHeight} pt, not ${check.want}: something else takes height (an infobar?)`}`);
    }
    save(st);
    console.log('Set them up as you like, then: node scripts/promo-shots.js shoot');
  } else if (cmd === 'shoot') {
    const st = load();
    const oi = rest.indexOf('--out');
    const dir = oi >= 0 ? path.resolve(rest[oi + 1]) : path.join(__dirname, '..', 'dist', 'promo', new Date().toISOString().replace(/[:.]/g, '-'));
    fs.mkdirSync(dir, { recursive: true });
    for (const b of browsers) {
      if (!st[b]) { console.log(`${b}: no window (run open first)`); continue; }
      for (const f of b === 'chrome' ? shootChrome(st[b], dir) : shootFirefox(st[b], dir)) console.log(f);
    }
  } else {
    console.log('usage: node scripts/promo-shots.js open|shoot [chrome|firefox|both] [--out DIR]');
    process.exitCode = 1;
  }
}

main();
