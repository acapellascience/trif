'use strict';
// What a mod's code can do that matters for the user's account, found by reading the code (not from its
// header, which whoever wrote the mod also wrote). Used to hold a side-panel run's mods (held.js) and for
// the review of mods the user already has. See docs/SECURITY.md.
//
//   powersOf(code, { sites }) -> [{ key, fact, found: [names], line, lines: [line numbers] }]   (empty: restyles, hides, reads)
//
// Keys (stable: approvals are stored by key):
//   sends     sends requests or messages (fetch, XMLHttpRequest, sendBeacon, WebSocket, forms, postMessage…)
//   acts      clicks, types or presses keys for the user (.click(), synthetic UI events, execCommand, the clipboard)
//   loads     loads from an address it works out while running (src/href/url(…) built at run time): such a
//             load can carry what the mod read to anywhere
//   navigates sends the page somewhere (location, window.open)
//   site:<h>  names another site (a URL literal for a host outside the mod's own sites)
//   hidden    code TRIF can't check (eval, Function, string timers, code built from strings, computed
//             access to the page's globals, another frame's window, inline handlers): it could do any of the above
//
// This is a conservative reading, not a proof: anything it can't follow counts as `hidden`, so getting past
// it takes code that looks like nothing at all. It reads tokens (comments and strings are told apart from
// code), and checks its own reading against the JavaScript engine: if the code with every string, comment
// and regex blanked out doesn't compile the same way, the reading was wrong and the mod is `hidden`.

const vm = require('vm');

const FACTS = {
  sends: (f) => `can send requests or messages from the page as you (it uses ${f})`,
  acts: (f) => `can click, type or press keys on the page for you (it uses ${f})`,
  loads: () => 'can load things from addresses it works out while running, which can carry what it reads to another site',
  navigates: (f) => `can send the page somewhere else (it uses ${f})`,
  hidden: (f) => `has code TRIF can't check, which could do any of this (${f})`,
};
const siteFact = (host) => `names another site: ${host}`;

// --- tokens ---------------------------------------------------------------------------------------------

const KEYWORDS_BEFORE_REGEX = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'instanceof', 'yield', 'await']);
const ID_START = /[A-Za-z_$\u0080-￿\\]/;
const ID_PART = /[A-Za-z0-9_$\u0080-￿\\‌‍]/;

/** Tokens: {t: 'id'|'str'|'tpl'|'num'|'p'|'re', v, line, interp?}. Throws on what it can't read. */
function tokenize(src) {
  const out = [];
  let i = 0, line = 1;
  const n = src.length;
  // template nesting: each entry is the brace depth at which a `${` opened
  const tplStack = [];
  let braces = 0;
  const prevSig = () => out[out.length - 1];
  const regexAllowed = () => {
    const p = prevSig();
    if (!p) return true;
    if (p.t === 'id') return KEYWORDS_BEFORE_REGEX.has(p.v);
    if (p.t === 'num' || p.t === 'str' || p.t === 're') return false;
    if (p.t === 'tpl') return false;
    if (p.t === 'p') return !(p.v === ')' || p.v === ']' || p.v === '}' || p.v === '++' || p.v === '--');
    return true;
  };
  const readEscapedId = () => { // an identifier, with \uXXXX and \u{...} escapes decoded
    let v = '';
    while (i < n && ID_PART.test(src[i])) {
      if (src[i] === '\\') {
        const m = /^\\u(?:\{([0-9a-fA-F]+)\}|([0-9a-fA-F]{4}))/.exec(src.slice(i, i + 12));
        if (!m) throw new Error('bad escape in a name');
        v += String.fromCodePoint(parseInt(m[1] || m[2], 16));
        i += m[0].length;
      } else v += src[i++];
    }
    return v;
  };
  const readString = (q) => { // after the opening quote
    let v = '';
    while (i < n && src[i] !== q) {
      if (src[i] === '\n') throw new Error('unterminated string');
      if (src[i] === '\\') {
        const c = src[i + 1];
        if (c === '\n') { line++; i += 2; continue; }
        const m = /^\\(?:x([0-9a-fA-F]{2})|u\{([0-9a-fA-F]+)\}|u([0-9a-fA-F]{4}))/.exec(src.slice(i, i + 12));
        if (m) { v += String.fromCodePoint(parseInt(m[1] || m[2] || m[3], 16)); i += m[0].length; continue; }
        v += { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' }[c] ?? c;
        i += 2;
        continue;
      }
      v += src[i++];
    }
    if (i >= n) throw new Error('unterminated string');
    i++;
    return v;
  };
  // A template's text up to the closing backtick (token 'tpl', end) or to a `${` (token 'tpl', open).
  const readTemplatePart = () => {
    let v = '';
    while (i < n) {
      const c = src[i];
      if (c === '`') { i++; return { v, open: false }; }
      if (c === '$' && src[i + 1] === '{') { i += 2; return { v, open: true }; }
      if (c === '\\') { v += src[i + 1] === '`' ? '`' : src.slice(i, i + 2); i += 2; continue; }
      if (c === '\n') line++;
      v += c; i++;
    }
    throw new Error('unterminated template');
  };
  while (i < n) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end < 0) throw new Error('unterminated comment');
      for (let k = i; k < end; k++) if (src[k] === '\n') line++;
      i = end + 2;
      continue;
    }
    const at = line;
    if (c === '"' || c === "'") { i++; out.push({ t: 'str', v: readString(c), line: at }); continue; }
    if (c === '`') {
      i++;
      const part = readTemplatePart();
      const tok = { t: 'tpl', v: part.v, line: at, interp: part.open };
      out.push(tok);
      if (part.open) { tplStack.push({ depth: braces, tok }); braces++; out.push({ t: 'p', v: '${', line: at }); }
      continue;
    }
    if (c === '}' && tplStack.length && tplStack[tplStack.length - 1].depth === braces - 1) {
      // the end of a `${…}`: the template goes on
      braces--;
      const { tok } = tplStack.pop();
      out.push({ t: 'p', v: '}$', line: at });
      i++;
      const part = readTemplatePart();
      tok.v += '\u0000' + part.v; // (the pieces between the ${…}s, joined by a mark)
      if (part.open) { tplStack.push({ depth: braces, tok }); braces++; out.push({ t: 'p', v: '${', line: at }); }
      else out.push({ t: 'p', v: '`end', line: at });
      continue;
    }
    if (ID_START.test(c)) { out.push({ t: 'id', v: readEscapedId(), line: at }); continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      const m = /^(?:0[xXoObB][0-9a-fA-F_]+n?|(?:\d[\d_]*)?\.?\d*(?:[eE][+-]?\d+)?n?)/.exec(src.slice(i));
      i += Math.max(1, m[0].length);
      out.push({ t: 'num', v: m[0], line: at });
      continue;
    }
    if (c === '/' && regexAllowed()) {
      let k = i + 1, inClass = false;
      while (k < n) {
        const d = src[k];
        if (d === '\n') throw new Error('unterminated regex');
        if (d === '\\') { k += 2; continue; }
        if (d === '[') inClass = true;
        else if (d === ']') inClass = false;
        else if (d === '/' && !inClass) break;
        k++;
      }
      if (k >= n) throw new Error('unterminated regex');
      k++;
      while (k < n && /[a-z]/i.test(src[k])) k++;
      out.push({ t: 're', v: src.slice(i, k), line: at });
      i = k;
      continue;
    }
    const p3 = src.slice(i, i + 4);
    const op = ['>>>=', '...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??=', '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '**', '<<', '>>']
      .find((o) => p3.startsWith(o)) || c;
    if (op === '{') braces++;
    if (op === '}') braces--;
    out.push({ t: 'p', v: op, line: at });
    i += op.length;
  }
  if (tplStack.length) throw new Error('unterminated template');
  return out;
}

// The code as these tokens read it, with every string, template and regex replaced by something neutral
// that holds a line break. It must still compile. If the browser would have read one of those as part of
// a regex (a division taken for a regex, or the other way round, after a } or a )), the line break ends
// that regex too early and the result doesn't compile: the tokens were misread, and what looked like a
// string may have been code.
function blanked(tokens) {
  const out = [];
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k], prev = tokens[k - 1], next = tokens[k + 1];
    if (t.t === 'str' || (t.t === 'tpl' && !t.interp)) {
      const key = next && next.t === 'p' && next.v === ':' && prev && prev.t === 'p' && (prev.v === '{' || prev.v === ',');
      out.push(key ? '[\n0\n]' : '(\n0\n)');
    } else if (t.t === 'tpl') out.push('(\n[');
    else if (t.t === 're') out.push('/x/');
    else if (t.t === 'p' && t.v === '${') out.push('(');
    else if (t.t === 'p' && t.v === '}$') out.push('),');
    else if (t.t === 'p' && t.v === '`end') out.push(']\n)');
    else out.push(t.v);
  }
  return out.join(' ');
}

function compiles(code) {
  try { new vm.Script(`(async function(){\n${code}\n})`); return true; } catch { return false; }
}

// --- what counts --------------------------------------------------------------------------------------

const SENDS = new Set(['fetch', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'EventSource', 'WebTransport', 'RTCPeerConnection',
  'Worker', 'SharedWorker', 'importScripts', 'submit', 'requestSubmit', 'postMessage', 'BroadcastChannel', 'serviceWorker', 'registerProtocolHandler']);
const ACTS = new Set(['click', 'execCommand', 'clipboard', 'dispatchEvent', 'showModal']);
const UI_EVENTS = /^(click|dblclick|auxclick|contextmenu|mouse\w*|pointer\w*|touch\w*|key\w*|input|beforeinput|change|submit|reset|focus\w*|blur|paste|cut|copy|drop|drag\w*|composition\w*|select\w*|wheel)$/i;
const UI_EVENT_CLASSES = new Set(['MouseEvent', 'PointerEvent', 'KeyboardEvent', 'InputEvent', 'TouchEvent', 'SubmitEvent', 'FocusEvent', 'WheelEvent', 'DragEvent', 'ClipboardEvent', 'CompositionEvent', 'UIEvent']);
const NAVIGATES = new Set(['location', 'open', 'assign', 'replace', 'navigate']);
// Names that run code TRIF can't read (a reading by name can't see what's in it). Other frames' windows
// (contentWindow, parent) aren't here: their fetch is still called fetch.
const HIDDEN = new Set(['eval', 'Function', 'constructor', 'Reflect', 'createContextualFragment', 'srcdoc', 'GeneratorFunction', 'AsyncFunction']);
// Ways to make a string TRIF can't read off the page (base64, character codes, reversing): together with
// a name worked out at run time, they can make "fetch" or "script" without writing it.
const DECODERS = new Set(['atob', 'fromCharCode', 'fromCodePoint', 'unescape', 'TextDecoder', 'reverse']);
// Things that hand back the page's globals; a computed property on one (or using one as a value) can reach anything.
const GLOBALS = new Set(['window', 'self', 'globalThis', 'top', 'parent', 'frames', 'opener', 'navigator', 'document', 'location', 'Object', 'Reflect',
  'HTMLElement', 'Element', 'Node', 'EventTarget', 'HTMLFormElement', 'HTMLInputElement', 'Document', 'Window', 'prototype']);
const LOAD_PROPS = new Set(['src', 'srcset', 'href', 'action', 'formAction', 'formaction', 'poster', 'ping', 'codebase', 'imageSrcset', 'xlink:href']);
const DANGER_TAGS = /^(script|iframe|object|embed|frame|base|meta|portal|fencedframe)$/i;
// Inline handler attributes (on + an event's name) and srcdoc: an attribute name worked out at run time is
// only a worry when it could be one of these. (Not just /^on/: "once" and "oneUp" aren't handlers.)
const HANDLER_ATTR = /^(srcdoc|on(abort|afterprint|animation(end|iteration|start)|auxclick|before(input|print|unload)|blur|cancel|canplay(through)?|change|click|close|contextmenu|copy|cuechange|cut|dblclick|drag(end|enter|leave|over|start)?|drop|durationchange|emptied|ended|error|focus(in|out)?|formdata|hashchange|input|invalid|key(down|press|up)|load(eddata|edmetadata|start)?|message(error)?|mouse(down|enter|leave|move|out|over|up|wheel)|offline|online|page(hide|show)|paste|pause|play(ing)?|pointer(cancel|down|enter|leave|move|out|over|up)|popstate|progress|ratechange|reset|resize|scroll(end)?|search|seek(ed|ing)|select(start|ionchange)?|show|stalled|storage|submit|suspend|timeupdate|toggle|touch(cancel|end|move|start)|transition(cancel|end|run|start)|unload|volumechange|waiting|wheel))$/i;
// Namespace URIs (xmlns), not places a request goes
const NOT_SITES = new Set(['www.w3.org', 'w3.org']);
const HTML_SINKS = new Set(['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'write', 'writeln', 'parseFromString', 'setHTMLUnsafe']);
const TIMERS = new Set(['setTimeout', 'setInterval']);

function hostsIn(text) {
  const out = [];
  const re = /(?:\b(?:https?|wss?|ftp):)?\/\/([a-z0-9.-]+\.[a-z]{2,}|\[[0-9a-f:]+\]|\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?/gi;
  let m;
  while ((m = re.exec(text))) {
    // (a protocol-relative //host only counts where a URL could start: not "a // comment-ish" inside text)
    if (!/^[a-z]+:/i.test(m[0]) && m.index > 0 && !/[\s'"`(=,]/.test(text[m.index - 1])) continue;
    out.push(m[1].toLowerCase());
  }
  return out;
}
function ownHost(host, sites) {
  return sites.some((s) => host === s || host.endsWith(`.${s}`));
}

/**
 * The powers in `code`: [{key, fact, found, line}], one per key, in a fixed order. `sites`: the hosts the
 * mod is for (its folder's site and its @match hosts); URLs for those don't count as another site.
 */
function powersOf(code, { sites = [] } = {}) {
  const found = new Map(); // key -> {names:Set, line}
  const add = (key, name, line) => {
    if (!found.has(key)) found.set(key, { names: new Set(), line, lines: new Set() });
    found.get(key).names.add(name);
    found.get(key).lines.add(line);
  };
  let toks;
  try { toks = tokenize(String(code)); } catch (e) { add('hidden', `code TRIF can't read: ${e.message}`, 1); return finish(found); }
  if (!compiles(blanked(toks)) && compiles(String(code))) add('hidden', 'code TRIF reads differently from the browser', 1);
  const site = sites.map((s) => String(s).toLowerCase().replace(/^\*\./, '').replace(/^www\./, ''));
  // Every string the code could hand to something worked out at run time: its string literals, template
  // pieces, literals joined with +, and object keys ({ onload: … } then setAttribute(k, v)).
  const cands = new Set();
  const CMP = new Set(['===', '!==', '==', '!=', 'case']);
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    // (a string only compared with, el.tagName === 'SCRIPT' or typeof x === 'object', is never handed on)
    if (t.t === 'str' && !(CMP.has(toks[k - 1]?.v) || CMP.has(toks[k + 1]?.v))) cands.add(t.v);
    if (t.t === 'tpl') for (const piece of t.v.split('\u0000')) cands.add(piece.trim());
    if (t.t === 'id' && toks[k + 1] && toks[k + 1].t === 'p' && toks[k + 1].v === ':') cands.add(t.v);
    if (t.t === 'str' && toks[k + 1] && toks[k + 1].v === '+' && toks[k + 2] && toks[k + 2].t === 'str' && !(toks[k - 1] && toks[k - 1].v === '+')) {
      let joined = t.v, j = k;
      while (toks[j + 1] && toks[j + 1].v === '+' && toks[j + 2] && toks[j + 2].t === 'str') { joined += toks[j + 2].v; j += 2; }
      cands.add(joined);
      classifyName(joined, t.line, true, [{}, { t: 'p', v: '(' }], 0); // ('fe' + 'tch': what it spells)
      if (/<\s*(script|iframe|object|embed)\b|\son[a-z]+\s*=|javascript:/i.test(joined)) add('hidden', 'HTML or code spelled out in pieces', t.line);
    }
    // Strings put together from literal pieces in other ways spell names too: ['s', 'r', 'c'].join(''),
    // 'sr'.concat('c'), `${'s'}rc`. Work them out, and count what they spell like any other string.
    const spelled = (joined) => {
      cands.add(joined);
      classifyName(joined, t.line, true, [{}, { t: 'p', v: '(' }], 0);
      if (/<\s*(script|iframe|object|embed)\b|\son[a-z]+\s*=|javascript:/i.test(joined)) add('hidden', 'HTML or code spelled out in pieces', t.line);
    };
    const lit = (x) => x && (x.t === 'str' || (x.t === 'tpl' && !x.interp));
    if (t.t === 'p' && t.v === '[' && lit(toks[k + 1])) { // [ 'a', 'b', … ].join( 'sep'? )
      const parts = [];
      let j = k + 1;
      while (lit(toks[j])) { parts.push(toks[j].v); if (toks[j + 1]?.v === ',') j += 2; else { j++; break; } }
      if (toks[j]?.v === ']' && toks[j + 1]?.v === '.' && toks[j + 2]?.v === 'join' && toks[j + 3]?.v === '(') {
        const sep = lit(toks[j + 4]) && toks[j + 5]?.v === ')' ? toks[j + 4].v : toks[j + 4]?.v === ')' ? ',' : null;
        if (sep !== null) spelled(parts.join(sep));
      }
    }
    if (lit(t) && toks[k + 1]?.v === '.' && toks[k + 2]?.v === 'concat' && toks[k + 3]?.v === '(') { // 'a'.concat('b', …)
      let joined = t.v, j = k + 4;
      while (lit(toks[j])) { joined += toks[j].v; if (toks[j + 1]?.v === ',') j += 2; else { j++; break; } }
      if (toks[j]?.v === ')') spelled(joined);
    }
    if (t.t === 'tpl' && t.interp) { // `${'s'}rc`: a template whose every ${} is one literal
      const pieces = t.v.split('\u0000');
      const inner = [];
      let j = k + 1, ok = true;
      for (let n = 0; n < pieces.length - 1 && ok; n++) {
        if (toks[j]?.v === '${' && lit(toks[j + 1]) && toks[j + 2]?.v === '}$') { inner.push(toks[j + 1].v); j += 3; } else ok = false;
      }
      if (ok) spelled(pieces.map((p, n) => p + (inner[n] ?? '')).join(''));
    }
  }
  const decodes = toks.some((t, k) => {
    if (t.t !== 'id' || !DECODERS.has(t.v)) return false;
    // atob straight into bytes (Uint8Array.from(atob(…)): an embedded sound or picture), not a name
    if (t.v === 'atob' && toks.slice(Math.max(0, k - 4), k).map((x) => x.v).join(' ') === 'Uint8Array . from (') return false;
    // .reverse() on an array is everyday code; only a string's ('…'.split('').reverse()) makes names
    if (t.v === 'reverse') return toks.slice(Math.max(0, k - 8), k).some((x, i, a) => x.v === 'split' && a[i + 2]?.t === 'str' && a[i + 2].v === '');
    return true;
  });
  const could = (re) => decodes || [...cands].some((c) => re.test(c));
  const RISKY_NAMES = new RegExp(`^(${[...SENDS, ...ACTS, ...HIDDEN, 'eval', 'open', 'location', 'innerHTML', 'outerHTML', 'insertAdjacentHTML', 'src', 'href', 'action', 'srcdoc', 'setAttribute', 'createElement', 'write'].join('|')})$`);

  const isName = (t) => t && (t.t === 'id' || ((t.t === 'str' || (t.t === 'tpl' && !t.interp))));
  const nameOf = (t) => (t.t === 'id' ? t.v : t.v);
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k], prev = toks[k - 1], next = toks[k + 1];
    const afterDot = prev && prev.t === 'p' && (prev.v === '.' || prev.v === '?.');
    // a computed member: x[ … ]
    if (t.t === 'p' && t.v === '[' && prev && ((prev.t === 'id' && !KEYWORDS_BEFORE_REGEX.has(prev.v) && !/^(of|in|const|let|var|yield|else|do|case)$/.test(prev.v)) || (prev.t === 'p' && (prev.v === ')' || prev.v === ']')))) {
      // find the closing ]
      let depth = 0, j = k;
      for (; j < toks.length; j++) {
        if (toks[j].t === 'p' && (toks[j].v === '[' || toks[j].v === '(' || toks[j].v === '{' || toks[j].v === '${')) depth++;
        if (toks[j].t === 'p' && (toks[j].v === ']' || toks[j].v === ')' || toks[j].v === '}' || toks[j].v === '}$')) { depth--; if (!depth) break; }
      }
      const inner = toks.slice(k + 1, j);
      const literal = inner.length === 1 && (inner[0].t === 'num' || inner[0].t === 'str' || (inner[0].t === 'tpl' && !inner[0].interp));
      if (literal && inner[0].t !== 'num') {
        classifyName(inner[0].v, inner[0].line, true, toks, j);
      } else if (!literal) {
        // x[k](…), x[k] = …, window[k]: harmless unless k could be a risky name (the code has such a
        // string, or makes strings TRIF can't read)
        const after = toks[j + 1];
        const callAfter = after && after.t === 'p' && (after.v === '(' || after.v === '`');
        const assignAfter = after && after.t === 'p' && after.v === '=';
        const onGlobal = prev.t === 'id' && GLOBALS.has(prev.v) && !(toks[k - 2] && toks[k - 2].t === 'p' && toks[k - 2].v === '.');
        if ((callAfter || onGlobal) && could(RISKY_NAMES)) add('hidden', onGlobal ? `${prev.v}[…] with a name worked out at run time` : 'x[…]() with a name worked out at run time', t.line);
        else if (assignAfter) {
          // (el[k] = fn for an onclick is ordinary code: a handler property only takes functions)
          if (could(/^(innerHTML|outerHTML|srcdoc)$/)) add('hidden', 'x[…] = with a name worked out at run time', t.line);
          else if (could(/^(src|srcset|href|action|formAction|poster|ping)$/)) add('loads', 'x[…] = with a name worked out at run time', t.line);
        }
      }
      continue;
    }
    if (t.t === 'id') {
      const v = t.v;
      classifyName(v, t.line, afterDot, toks, k);
      continue;
    }
    if (t.t === 'str' || t.t === 'tpl') {
      const text = t.v;
      for (const h of hostsIn(text)) if (!ownHost(h, site) && !NOT_SITES.has(h)) add(`site:${h}`, h, t.line);
      if (/javascript:/i.test(text)) add('hidden', 'a javascript: URL', t.line);
      if (/<\s*(script|iframe|object|embed|frame|base|meta)\b/i.test(text)) add('hidden', `HTML with <${/<\s*(\w+)/.exec(text)[1].toLowerCase()}>`, t.line);
      if (/<[a-z][^>]*\son[a-z]+\s*=/i.test(text)) add('hidden', 'an inline event handler', t.line);
      if (t.t === 'tpl' && t.interp && /url\(\s*['"]?\u0000|(?:src|href|action|srcset|poster|data)\s*=\s*['"]?\u0000/i.test(text)) add('loads', 'an address built into HTML or CSS', t.line);
      if (t.t === 'tpl' && t.interp && /(?:https?:|wss?:)?\/\/[^\u0000\s'"]*\u0000/i.test(text)) add('loads', 'an address built at run time', t.line);
    }
  }
  return finish(found);

  // what a name means where it's used
  function classifyName(v, line, member, ts, k) {
    const nx = ts[k + 1];
    const called = nx && nx.t === 'p' && nx.v === '(';
    const assigned = nx && nx.t === 'p' && /^(=|\+=)$/.test(nx.v);
    if (SENDS.has(v)) {
      if ((v === 'submit' || v === 'requestSubmit' || v === 'postMessage') && !member) return; // (a function of its own called submit)
      add('sends', v, line);
      return;
    }
    if (ACTS.has(v)) {
      if (v === 'click' && !member) return;
      if (v === 'showModal') return;
      if (v === 'dispatchEvent') { if (!dispatchIsHarmless(ts, k)) add('acts', 'dispatchEvent', line); return; }
      add('acts', v === 'click' ? '.click()' : v, line);
      return;
    }
    if (UI_EVENT_CLASSES.has(v) && ts[k - 1] && ts[k - 1].t === 'id' && ts[k - 1].v === 'new') { add('acts', `new ${v}`, line); return; }
    if (v === 'location' && (assigned || (nx && nx.t === 'p' && nx.v === '.' && ts[k + 2] && /^(href|assign|replace|pathname|search|hash|host|hostname|protocol|port)$/.test(ts[k + 2].v) && ts[k + 3] && ts[k + 3].t === 'p' && /^(=|\(|\+=)$/.test(ts[k + 3].v)))) {
      add('navigates', 'location', line);
      return;
    }
    if (v === 'open' && called && (!member || (ts[k - 2] && ts[k - 2].t === 'id' && /^(window|self|globalThis)$/.test(ts[k - 2].v)))) { add('navigates', 'window.open', line); return; }
    if (v === 'navigate' && member && called && ts[k - 2] && ts[k - 2].v === 'navigation') { add('navigates', 'navigation.navigate', line); return; }
    if (HIDDEN.has(v)) {
      if (v === 'constructor' && !member) return;
      if (v === 'constructor' && !called && !(nx && nx.t === 'p' && nx.v === '.')) return; // (reading .constructor to compare classes)
      add('hidden', v === 'Function' ? 'Function' : v, line);
      return;
    }
    if (TIMERS.has(v) && called) {
      const arg = ts[k + 2];
      if (arg && (arg.t === 'str' || arg.t === 'tpl')) add('hidden', `${v} with a string`, line);
      return;
    }
    if (v === 'import' && called) { add('hidden', 'import()', line); return; }
    if (v === 'createElement' && called) {
      const arg = ts[k + 2], close = ts[k + 3];
      const tag = arg && (arg.t === 'str' || (arg.t === 'tpl' && !arg.interp)) && close && close.v === ')' ? arg.v.toLowerCase() : null;
      if (tag === null) { if (could(DANGER_TAGS)) add('hidden', 'createElement with a tag worked out at run time', line); }
      else if (DANGER_TAGS.test(tag)) add('hidden', `a <${tag}> element`, line);
      return;
    }
    if (v === 'setAttribute' && called) {
      const arg = ts[k + 2], comma = ts[k + 3];
      const name = arg && (arg.t === 'str' || (arg.t === 'tpl' && !arg.interp)) && comma && comma.v === ',' ? arg.v.toLowerCase() : null;
      if (name === null) {
        if (could(HANDLER_ATTR)) add('hidden', 'setAttribute with a name worked out at run time', line);
        else if (could(/^(src|srcset|href|xlink:href|action|formaction|poster|ping|style)$/i)) add('loads', 'setAttribute with a name worked out at run time', line);
      }
      else if (/^on/.test(name)) add('hidden', 'an inline event handler', line);
      else if (LOAD_PROPS.has(name) || name === 'style' || name === 'srcdoc') {
        if (!literalValue(ts, k + 4)) add('loads', `setAttribute('${name}', …)`, line);
      }
      return;
    }
    if (member && LOAD_PROPS.has(v) && assigned && !literalValue(ts, k + 2)) { add('loads', `.${v} = …`, line); return; }
    if (member && (v === 'cssText' || v === 'backgroundImage' || v === 'background' || v === 'content' || v === 'listStyleImage' || v === 'borderImage' || v === 'cursor' || v === 'mask' || v === 'maskImage') && assigned && !literalValue(ts, k + 2)) {
      if (exprHasUrl(ts, k + 2)) add('loads', `style.${v} with url(…)`, line);
      return;
    }
    if (member && v === 'setProperty' && called && exprHasUrl(ts, k + 2)) { add('loads', 'style.setProperty with url(…)', line); return; }
    if (HTML_SINKS.has(v) && member && (assigned || called)) {
      if (v === 'write' || v === 'writeln') { if (ts[k - 2] && ts[k - 2].v === 'document') add('hidden', `document.${v}`, line); return; }
      // HTML from pieces worked out while running could hold an inline handler TRIF can't see
      const start = assigned ? k + 2 : k + 2;
      if (!htmlIsSafe(ts, start)) add('hidden', `${v} with HTML built at run time`, line);
    }
  }
}

// dispatchEvent(new CustomEvent('my-event')) / new Event('tss-test-boss'): the mod's own events, not a
// click or key press on the page. Anything else (an event object from elsewhere, a UI event type) acts.
function dispatchIsHarmless(ts, k) {
  const a = ts[k + 2], b = ts[k + 3], c = ts[k + 4], d = ts[k + 5];
  if (!(ts[k + 1] && ts[k + 1].v === '(' && a && a.t === 'id' && a.v === 'new' && b && (b.v === 'CustomEvent' || b.v === 'Event') && c && c.v === '(')) return false;
  if (!(d && (d.t === 'str' || (d.t === 'tpl' && !d.interp)))) return false;
  return !UI_EVENTS.test(d.v);
}

// The value after `=` up to the end of the expression is one literal (a string, a template without ${}, a number)
function literalValue(ts, k) {
  const v = ts[k], after = ts[k + 1];
  if (!v) return false;
  const lit = v.t === 'str' || v.t === 'num' || (v.t === 'tpl' && !v.interp) || (v.t === 'id' && (v.v === 'null' || v.v === 'undefined'));
  if (!lit) return false;
  return !after || (after.t === 'p' && [';', ',', ')', '}', ']'].includes(after.v)) || after.t === 'id';
}

// Within the expression starting at k (to the next ; at depth 0), any url( in a string or template
function exprHasUrl(ts, k) {
  let depth = 0;
  for (let j = k; j < ts.length; j++) {
    const t = ts[j];
    if (t.t === 'p' && ['(', '[', '{', '${'].includes(t.v)) depth++;
    if (t.t === 'p' && [')', ']', '}', '}$'].includes(t.v)) { if (!depth) return false; depth--; }
    if (!depth && t.t === 'p' && (t.v === ';' || t.v === ',')) return false;
    if ((t.t === 'str' || t.t === 'tpl') && /url\(|image-set\(|@import/i.test(t.v)) return true;
  }
  return false;
}

// HTML assigned or inserted: safe when it's only literals (and +), or a template whose pieces don't open
// an attribute right where a ${} goes (`<b>${name}</b>` is fine; `<img src=${x}>` or `<a ${attr}>` isn't)
function htmlIsSafe(ts, k) {
  let depth = 0;
  for (let j = k; j < ts.length; j++) {
    const t = ts[j];
    if (t.t === 'p' && ['(', '[', '{'].includes(t.v)) depth++;
    if (t.t === 'p' && [')', ']', '}'].includes(t.v)) { if (!depth) return true; depth--; }
    if (!depth && t.t === 'p' && (t.v === ';' || t.v === ',')) return true;
    if (t.t === 'tpl' && t.interp) {
      const pieces = t.v.split('\u0000');
      for (let p = 0; p < pieces.length - 1; p++) {
        // inside a tag (an unclosed <) at the point of a ${}: an attribute could be anything
        const before = pieces.slice(0, p + 1).join('');
        const lastOpen = before.lastIndexOf('<'), lastClose = before.lastIndexOf('>');
        if (lastOpen > lastClose) return false;
      }
    }
    if (t.t === 'p' && t.v === '+' ) {
      // literal + something worked out: only safe if the literal before isn't inside a tag
      const s = ts[j - 1];
      if (s && (s.t === 'str' || s.t === 'tpl')) {
        const lastOpen = s.v.lastIndexOf('<'), lastClose = s.v.lastIndexOf('>');
        if (lastOpen > lastClose) return false;
      }
    }
  }
  return true;
}

const ORDER = ['sends', 'acts', 'navigates', 'loads', 'hidden'];
function finish(found) {
  const keys = [...found.keys()].sort((a, b) => {
    const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  return keys.map((key) => {
    const { names, line, lines } = found.get(key);
    const list = [...names].slice(0, 4);
    const f = list.join(', ') + (names.size > 4 ? '…' : '');
    return { key, fact: key.startsWith('site:') ? siteFact(key.slice(5)) : FACTS[key](f), found: [...names], line, lines: [...lines].sort((a, b) => a - b) };
  });
}

/** The hosts a mod is for: its folder's site and its @match patterns' hosts. */
function modSites(mod) {
  const out = new Set();
  const folder = String(mod.id || '').split('/')[0];
  if (folder && folder !== 'all-sites') out.add(folder.toLowerCase().replace(/^www\./, ''));
  for (const m of mod.matches || []) {
    const h = /^[^:]+:\/\/([^/]+)/.exec(m);
    if (h && h[1] !== '*') out.add(h[1].replace(/^\*\./, '').replace(/^www\./, '').toLowerCase());
  }
  return [...out];
}

module.exports = { powersOf, modSites, tokenize, blanked };
