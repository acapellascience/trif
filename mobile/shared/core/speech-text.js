// The microphone's words, put together so they only ever grow (docs/MOBILE-BEHAVIOUR.md, Voice; Tim 11-18: "If you
// pause, it deletes the things you've said so far"): what was said before a pause stays, a restarted recognizer's
// words go after it, a revised partial replaces only the words since the last committed ones. The recognizers, the
// audio and the box stay each app's. Both phone apps run this (mobile/shared/gen/core.js: TrifCore.speechText);
// speech-text-cases.json holds the answers the iPhone's Swift (SpeechText.swift) gave.
//
// The words' state is a plain record {said, live, taskSaid, restarts}; the committed words stay the caller's (they
// only grow). `apply` takes one recognizer event and gives the next state, what to add to the committed words, and
// the text's tail after them. Events:
//   - iOS 26's SpeechAnalyzer: ['volatile', s] the words being heard (they may change), ['final', s] a finished stretch.
//   - SFSpeechRecognizer (and Android's SpeechRecognizer the same way): ['partial', s] the task's best transcription so
//     far, ['segment', s] the recognizer marked the utterance done, ['newTask'] a task ended and the next one starts.
//
// The iPhone's Swift split words on Characters (a whitespace followed by a mark is one whitespace Character; a Prepend
// sign joins what follows it), lowercased scalar by scalar (no final-sigma rule), kept Characters whose first scalar is
// a letter or a number, and compared by canonical equivalence; so does this.

'use strict';

/** what joins the Character before it (marks, joiners, emoji modifiers, tags, Thai and Lao AM): nearly Unicode's
 * Extend + SpacingMark, as the iPhone's Swift has them */
const JOINS = '\\p{M}\\u200C\\u200D\\u0E33\\u0EB3\\uFF9E\\uFF9F\\u{1F3FB}-\\u{1F3FF}\\u{E0020}-\\u{E007F}';
/** Unicode's Prepend signs (they join the Character after them unless it's a control) */
const PREPEND = '\\u0600-\\u0605\\u06DD\\u070F\\u0890\\u0891\\u08E2\\u0D4E\\u{110BD}\\u{110CD}\\u{111C2}\\u{111C3}\\u{1193F}\\u{11941}\\u{11A3A}\\u{11A84}-\\u{11A89}\\u{11D46}\\u{11F02}';
/** a control: nothing joins it, and a Prepend sign doesn't join it */
const CONTROL = `(?![\\u200C\\u200D\\u{E0020}-\\u{E007F}${PREPEND}])[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}]`;
const CHARACTER = new RegExp(`[${PREPEND}]+(?!${CONTROL})[^][${JOINS}]*|\\r\\n|${CONTROL}|[^][${JOINS}]*`, 'gu');
const SPACE = /^\p{White_Space}/u;
const KEEP = /^[\p{Alphabetic}\p{N}]/u;
const PLAIN = /^[\x21-\x7e]*$/;

const same = (a, b) => a === b || a.normalize('NFC') === b.normalize('NFC');

/** The words in `s`: split at whitespace Characters, none empty. */
function words(s) {
  s = String(s);
  if (/^[\x20-\x7e\t\n\v\f\r]*$/.test(s)) return s.split(/[ \t\n\v\f\r]+/).filter((w) => w !== '');
  const out = [];
  let w = '';
  for (const c of s.match(CHARACTER) || []) {
    if (SPACE.test(c)) { if (w) out.push(w); w = ''; } else w += c;
  }
  if (w) out.push(w);
  return out;
}

/** A word as it's compared: lowercased scalar by scalar, only its letters and numbers. */
function norm(w) {
  w = String(w);
  if (PLAIN.test(w)) return w.toLowerCase().replace(/[^a-z0-9]/g, '');
  let lower = '';
  for (const c of w) lower += c.toLowerCase();
  return (lower.match(CHARACTER) || []).filter((c) => KEEP.test(c)).join('');
}

/** `s`'s words with one space between them. */
const clean = (s) => words(s).join(' ');

/** what a join trims (Foundation's whitespacesAndNewlines: White_Space and U+200B; all of it is in the BMP) */
const trims = (c) => c === 0x20 || (c >= 9 && c <= 13) || c === 0x85 || c === 0xa0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200b) ||
  c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000;

/** `s` without those at either end (a loop, not a regular expression: `committed` grows long) */
function trim(s) {
  let i = 0, j = s.length;
  while (i < j && trims(s.charCodeAt(i))) i++;
  while (j > i && trims(s.charCodeAt(j - 1))) j--;
  return i === 0 && j === s.length ? s : s.slice(i, j);
}

/** `a` then `b`, trimmed, with a space between when both have words. */
function join(a, b) {
  a = trim(String(a));
  b = trim(String(b));
  if (!a) return b;
  if (!b) return a;
  return a + ' ' + b;
}

/**
 * Whether `next` is a new transcription rather than a revision of `previous`: shorter, and either starting
 * differently or much shorter. (A wrong guess repeats a few words; the other way round would lose them.)
 */
function isFresh(previous, next) {
  const p = words(previous).map(norm), n = words(next).map(norm);
  if (p.length < 2 || n.length >= p.length) return false;
  if (n.length === 0) return true;
  for (let i = 0; i < Math.min(2, n.length); i++) if (!same(n[i], p[i])) return true;
  return n.length * 3 <= p.length * 2;
}

/** `s` without the task's already committed words at its start (when the recognizer repeats them). */
function afterTaskSaid(taskSaid, s) {
  if (!taskSaid) return s;
  const said = words(taskSaid), all = words(s);
  if (all.length < said.length) return s;
  const a = said.map(norm), b = all.slice(0, said.length).map(norm);
  let alike = 0;
  for (let i = 0; i < a.length; i++) if (same(a[i], b[i])) alike++;
  // (the same words; or, for a longer stretch, nearly the same: a word revised in the repeat)
  const ok = alike === a.length || (a.length >= 3 && alike >= a.length - Math.max(1, Math.floor(a.length / 5)) && same(a[0], b[0]));
  return ok ? all.slice(said.length).join(' ') : s;
}

/** The words before anything was heard. */
const start = () => ({ said: false, live: '', taskSaid: '', restarts: 0 });

/**
 * The next state after one recognizer event. What's committed stays the caller's (it only grows, and it grows long:
 * it never crosses): the answer says what to add to its end, and what follows it in the text.
 * @param {{said: boolean, live: string, taskSaid: string, restarts: number}|null} state said: anything committed yet
 * @param {Array} event ['volatile'|'final'|'partial'|'segment', text] or ['newTask']
 * @returns {{added: string, said: boolean, live: string, taskSaid: string, restarts: number, tail: string}}
 *   committed += added; text = committed + tail. restarts: how many times a fresh transcription was caught replacing
 *   the live words (for diagnostics)
 */
function apply(state, event) {
  const st = state || {};
  let live = String(st.live || ''), taskSaid = String(st.taskSaid || ''), restarts = Number(st.restarts) || 0;
  let said = !!st.said, added = '';
  // join(committed, x): committed is always trimmed, so only whether it has words matters
  const commit = (x) => {
    x = trim(x);
    if (!x) return;
    added += (said ? ' ' : '') + x;
    said = true;
  };
  const partial = (whole) => {
    const next = afterTaskSaid(taskSaid, clean(whole));
    if (isFresh(live, next)) {
      // (the recognizer started over after a pause: the words it dropped are kept)
      commit(live);
      restarts += 1;
    }
    live = next;
  };
  const [kind, s] = Array.isArray(event) ? event : [];
  switch (kind) {
    case 'volatile': live = clean(s || ''); break;
    case 'final': commit(clean(s || '')); live = ''; break;
    case 'partial': partial(s || ''); break;
    case 'segment': {
      partial(s || '');
      commit(live);
      live = '';
      const w = clean(s || '');
      if (w) taskSaid = w;
      break;
    }
    case 'newTask': commit(live); live = ''; taskSaid = ''; break;
    default: break;
  }
  const rest = trim(live);
  return { added, said, live, taskSaid, restarts, tail: rest ? (said ? ' ' : '') + rest : '' };
}

module.exports = { words, norm, clean, join, isFresh, start, apply };
