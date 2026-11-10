#!/usr/bin/env node
'use strict';
// The Tune Composer's song sizes, format by format: the first format (git 8e21091: fixed-width events), the
// structural one with plain prefix codes (format 2) and with the range coder (format 3, what's saved).
//
//   node tests/dev/measure-tunes.js [--random N]
//
// Events are the notes and hits stored in the patterns (not as often as the song plays them).

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { SONGS, rng, randomSong } = require('../tune-songs');

const ROOT = path.join(__dirname, '..', '..');
const MOD = 'examples/sites/x.com/tune-composer.js';
const load = (src) => {
  const grab = (n) => src.slice(src.indexOf(`/* ${n}:begin */`), src.indexOf(`/* ${n}:end */`));
  return new Function(`${grab('tune-codec')}\n${grab('tune-demo')}\nreturn { TuneCodec, TUNE_DEMO };`)();
};
const NEW = load(fs.readFileSync(path.join(ROOT, MOD), 'utf8'));
const OLD = load(execFileSync('git', ['show', `8e21091:${MOD}`], { cwd: ROOT, encoding: 'utf8' }));
const C = NEW.TuneCodec;

const events = (s) => s.patterns.reduce((a, p) => a + p.p1.length + p.p2.length + p.tri.length + p.noise.length, 0);
function sizes(song) {
  const s = C.normalize(song);
  let old = null;
  try { old = OLD.TuneCodec.encode({ ...s, patterns: s.patterns, order: s.order }).length; } catch { /* past the old limits */ }
  return { events: events(s), patterns: s.patterns.length, old, plain: C.encode(s, { format: C.STATIC }).length, coded: C.encode(s).length };
}

const n = Number(process.argv[process.argv.indexOf('--random') + 1]) || 400;
const rows = [['Demo (8 bars)', sizes(C.fromText(NEW.TUNE_DEMO))], ...SONGS.map((s) => [s.name, sizes(C.fromText(s))])];
const r = rng(7), sum = { events: 0, patterns: 0, old: 0, plain: 0, coded: 0, n: 0 };
for (let i = 0; i < n; i++) {
  const x = sizes(randomSong(r, { maxPatterns: 16, maxOrder: 64 })); // (inside the first format's limits)
  for (const k of ['events', 'patterns', 'old', 'plain', 'coded']) sum[k] += x[k];
  sum.n++;
}
rows.push([`Random (${n}, totals)`, sum]);
const bpe = (bytes, ev) => (bytes == null ? '–' : ((bytes * 8) / ev).toFixed(2));
const pct = (a, b) => (a == null ? '' : ` (${Math.round((100 * b) / a)}%)`);
console.log('| song | events | first format | step 1: structural | step 2: + range coder |');
console.log('|---|---:|---:|---:|---:|');
for (const [name, x] of rows) {
  console.log(`| ${name} | ${x.events} | ${x.old} B · ${bpe(x.old, x.events)} b/ev | ${x.plain} B · ${bpe(x.plain, x.events)} b/ev${pct(x.old, x.plain)} | ${x.coded} B · ${bpe(x.coded, x.events)} b/ev${pct(x.old, x.coded)} |`);
}
