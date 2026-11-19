#!/usr/bin/env node
'use strict';
// After talking (Browser.swift talkResume + talkNudge, TRIF's world): what TRIF paused plays on, and a video that
// "plays" with its time standing still (Tim's reuters.com, 11-18: "video stuck, nudged: still stuck (3.6 → 3.6 s)")
// gets the next step, one call each, as resumeAfterTalk drives them: its own time, pause and play, 0.25 s on, 1 s on.
// The scripts are read out of Browser.swift and run in node's vm against stand-in players on a virtual clock:
//   - one that plays on at once; one whose play() is refused;
//   - one that ignores play() (and a seek to its own time) until it's paused and played again;
//   - one stuck at a gap in what it has loaded, until it's moved past it (0.25 s on);
//   - one left in a seek that never ends (`seeking` for good, as the Simulator showed 11-18) until it's loaded again;
//   - one that jumps once and stops again (not playing); one with a blob: source (never loaded again);
//   - one that never moves (all five tried, said so); one the page pauses again.
//   node --test mobile/test/talknudge.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'browser-probe', 'TrifProbe', 'Browser.swift'), 'utf8');
const script = (name) => {
  const m = SRC.match(new RegExp(`static let ${name} = """\\n([\\s\\S]*?)\\n\\s*"""`));
  assert.ok(m, `${name} in Browser.swift`);
  // (as Swift reads the string literal: its escapes undone, so what reaches the page is what's tested)
  return m[1].replace(/\\(.)/g, (x, c) => ({ n: '\n', t: '\t', '\\': '\\', "'": "'", '"': '"' })[c] ?? x);
};

/** A stand-in <video>: `unstick(action)` says which of TRIF's moves gets its time going (null: none, ever). */
function player(clock, { at = 3.6, unstick = () => true, refuse = false, pausesAgain = false, seeking = false, src = 'https://example.test/v.m3u8', jump = 0 } = {}) {
  const m = { localName: 'video', paused: true, ended: false, duration: 60, moving: false, base: at, since: 0, plays: 0, seeking, currentSrc: src, src };
  m.load = () => { m.loads = (m.loads || 0) + 1; m.paused = true; m.base = 0; if (unstick('load', 0, at)) { m.moving = true; m.seeking = false; } };
  Object.defineProperty(m, 'currentTime', {
    get() { return m.moving && !m.paused ? m.base + (clock.now - m.since) / 1000 : m.base; },
    set(t) { m.base = t; m.since = clock.now; if (!m.seeking && unstick('seek', t, at)) m.moving = true; },
  });
  m.pause = () => { m.base = m.currentTime; m.paused = true; m.pausedAt = clock.now; };
  m.play = () => {
    if (refuse) return Promise.reject(Object.assign(new Error('not allowed'), { name: 'NotAllowedError' }));
    m.plays++;
    const fromPause = m.pausedAt !== undefined && clock.now - m.pausedAt < 50 && m.plays > 1;
    m.paused = false;
    m.since = clock.now;
    if (!m.seeking && unstick(fromPause ? 'pause and play' : 'play', m.base, at)) m.moving = true;
    // (a jump: its time leaps once on this play, then stands still)
    if (jump && !m.moving) { m.base += jump; jump = 0; }
    if (pausesAgain) setImmediate(() => m.pause());
    return Promise.resolve();
  };
  return m;
}

/** Runs talkResume then talkNudge's steps the way Browser.resumeAfterTalk does; the lines it would log. */
async function afterTalk(list, clock) {
  const t0 = 1000;
  for (const m of list) m.__trifTalk = { at: t0, time: m.base };
  const ctx = vm.createContext({
    document: { querySelectorAll: () => list },
    setTimeout: (f, ms) => { clock.now += ms; setImmediate(f); },
    Promise, JSON, Map, Math, isFinite, Infinity,
  });
  const run = (body, args) => vm.runInContext(`(async (${Object.keys(args).join(', ')}) => {\n${body}\n})(${Object.values(args).map((v) => JSON.stringify(v)).join(', ')})`, ctx);
  assert.equal(await run(script('talkResume'), { t0, count: true }), String(list.length));
  const first = JSON.parse(await run(script('talkResume'), { t0, count: false }));
  let lines = first.lines, stuck = first.stuck, step = 1;
  while (stuck > 0 && step <= 5) {
    const o = JSON.parse(await run(script('talkNudge'), { step }));
    lines = lines.concat(o.lines);
    stuck = o.stuck;
    step++;
  }
  return { lines, steps: step - 1 };
}

test('after talking: plays on, refused, and stuck players each get the next step until one works', async () => {
  const clock = { now: 0 };
  const ok = player(clock);
  const refused = player(clock, { refuse: true, at: 10 });
  const r = await afterTalk([ok, refused], clock);
  assert.deepEqual(r.lines, ['video played on from 3.6 s', 'video left paused at 10.0 s (NotAllowedError)']);
  assert.equal(r.steps, 0);

  // (ignores play() and a seek to its own time; a pause then play gets it going)
  const c2 = { now: 0 };
  const deaf = player(c2, { unstick: (how) => how === 'pause and play' });
  const r2 = await afterTalk([deaf], c2);
  assert.equal(r2.lines.length, 1);
  assert.match(r2.lines[0], /^video stuck at 3\.6 s, tried its own time, pause and play: playing after pause and play \(3\.6 → [4-9]\.\d s\)$/);
  assert.equal(r2.steps, 2);
  assert.equal(deaf.paused, false);

  // (a gap in what it loaded: only a seek past it, at least 0.2 s on, moves it)
  const c3 = { now: 0 };
  const gap = player(c3, { unstick: (how, t, at) => how === 'seek' && t >= at + 0.2 });
  const r3 = await afterTalk([gap], c3);
  assert.match(r3.lines[0], /tried its own time, pause and play, 0\.25 s on: playing after 0\.25 s on \(3\.6 → /);

  // (never moves: all five tried, said so, left as it is: never the page reloaded)
  const c4 = { now: 0 };
  const dead = player(c4, { unstick: () => false });
  const r4 = await afterTalk([dead], c4);
  assert.match(r4.lines[0], /tried its own time, pause and play, 0\.25 s on, 1 s on, loaded again at its time: still stuck \(3\.6 → \d\.\d s\)$/);
  assert.equal(r4.steps, 5);
  assert.equal(dead.loads, 1);

  // (in a seek that never ends: nothing but loading it again helps; then it plays from its time)
  const c5 = { now: 0 };
  const hung = player(c5, { seeking: true, unstick: (how) => how === 'load' });
  const r5 = await afterTalk([hung], c5);
  assert.match(r5.lines[0], /^video stuck at 3\.6 s \(in a seek\), tried its own time, pause and play, 0\.25 s on, 1 s on, loaded again at its time: playing after loaded again at its time \(3\.6 → /);
  assert.equal(hung.seeking, false);

  // (a player's own stream, blob: source: never loaded again)
  const c7 = { now: 0 };
  const mse = player(c7, { seeking: true, src: 'blob:https://example.test/1', unstick: (how) => how === 'load' });
  const r7 = await afterTalk([mse], c7);
  assert.match(r7.lines[0], /tried its own time, pause and play, 0\.25 s on, 1 s on: still stuck \(3\.6 → \d\.\d s, in a seek; its player’s own stream, not loaded again\)$/);
  assert.equal(mse.loads, undefined);

  // (a leap and a stop again is not playing: the next step is tried)
  const c8 = { now: 0 };
  const leap = player(c8, { jump: 3, unstick: (how) => how === 'pause and play' });
  const r8 = await afterTalk([leap], c8);
  assert.match(r8.lines[0], /tried its own time, pause and play: playing after pause and play/);

  // (the page pauses it again itself: respected, no more steps)
  const c6 = { now: 0 };
  const again = player(c6, { pausesAgain: true });
  const r6 = await afterTalk([again], c6);
  assert.deepEqual(r6.lines, ['video played on from 3.6 s, then paused by the page']);
});
