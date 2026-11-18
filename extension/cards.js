// The pieces TRIF's cards and mod rows are made of, shared by the side panel (sidepanel.js), the approval card
// (approval.js) and the All mods page (allmods.js): elements and buttons, "more" (explain.js), the robot in a
// card's header, a hold's lines and its site's boxes, file links, and the code with its line numbers and colours.
// DOM only: no chrome.* here, so a page outside the extension (the phone's) can use them as they are.

import { iconSvg } from './icons.js';
import { term, warningByLine, moreText } from './explain.js';

export function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

// "more": a line's explanation (explain.js), shown in place under it; "less" folds it again. Nothing for a
// term the table doesn't have (its line alone).
let moreSeq = 0;

export function addMore(host, t) {
  const text = moreText(t);
  if (!text) return host;
  const box = el('span', 'more-text', text);
  box.id = `more-${++moreSeq}`;
  box.hidden = true;
  // (an "i" in place of the word "more": Tim, 11-13. It unfolds the explanation in place, and lights while open)
  const btn = el('button', 'more-btn');
  btn.type = 'button';
  btn.append(iconSvg('info'));
  btn.title = 'More';
  btn.setAttribute('aria-label', 'More');
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-controls', box.id);
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    box.hidden = !box.hidden;
    btn.classList.toggle('open', !box.hidden);
    btn.title = box.hidden ? 'More' : 'Less';
    btn.setAttribute('aria-label', btn.title);
    btn.setAttribute('aria-expanded', String(!box.hidden));
  });
  host.append(' ', btn, box);
  return host;
}
// (the term behind a hold's line: a power by its need's key, power:<name>[:its values])
export const powerTerm = (key) => { const p = /^power:([\w-]+)/.exec(String(key || '')); return p && p[1] !== 'together' ? term('powers', p[1]) : null; };
// (a combination warning by its sentence: the hold's "together, it …", or the many-powers one)
export const warningTerm = (s) => { const t = String(s || '').trim(); const u = t.charAt(0).toUpperCase() + t.slice(1); return warningByLine(u) || warningByLine(`${u}.`); };

export function button(label, className, onClick) {
  const b = el('button', className ? `btn ${className}` : 'btn', label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

export function actions(...children) {
  const p = el('p', 'actions');
  p.append(...children.filter(Boolean));
  return p;
}

// What a mod adds to its site's boxed mods together (site:<site>:<powers>): the site, else null.
export function siteOf(key) {
  const w = /^site:(.+):[a-z+-]+$/.exec(String(key || ''));
  return w ? w[1] : null;
}
// The site's lists (helper/lib/sitecombos.js reach): what the site's boxed mods can do as you ("Your {site} mods
// can:"), see, and where it could end up, each list's items on one line (" · "), those this mod adds marked new;
// then the flag lines.
export function siteBoxes(reach) {
  return (Array.isArray(reach) ? reach : []).map((r) => {
    const box = el('div', 'ap-site');
    for (const k of r.order || ['act', 'see', 'go']) {
      if (!r[k] || !r[k].length) continue;
      box.append(el('p', k === (r.order || ['act'])[0] ? 'ap-site-head ap-site-first' : 'ap-site-head', r.heads[k]));
      const line = el('p', 'ap-site-items');
      r[k].forEach((x, i) => {
        if (i) line.append(' · ');
        const item = el('span', 'ap-site-item', x.t);
        if (x.new) item.append(' ', el('span', 'ap-new', 'new'));
        line.append(item);
      });
      box.append(line);
    }
    for (const f of r.flags || []) { const p = el('p', 'ap-site-flag', f.t); if (f.new) p.append(' ', el('span', 'ap-new', 'new')); box.append(p); }
    return box;
  });
}

// ---- the robot on TRIF's cards --------------------------------------------------------------------------
/**
 * The robot for a card's header (the approval, Ask, import and code cards), built afresh: his frame and
 * either his eyes or the code card's face, </> in his green. (Not a copy of the bar's robot, which carries
 * every face it can show: the pause bars, the cross, the broken link, hidden only there.)
 */
export function cardRobot(face = 'eyes') {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 128 128');
  svg.setAttribute('aria-hidden', 'true');
  for (const cls of ['rim', 'face', ...(face === 'eyes' ? ['eye'] : [])]) {
    for (const p of document.querySelectorAll(`#bar-robot svg polygon.${cls}`)) svg.append(p.cloneNode(false));
  }
  if (face === 'code') {
    const code = document.createElementNS(NS, 'path');
    code.setAttribute('class', 'code');
    code.setAttribute('d', 'M48 47 L31 64 L48 81 M80 47 L97 64 L80 81 M71 40 L57 88');
    svg.append(code);
  }
  return svg;
}

// (the icon beside each line: by what it is)
export const FACT_ICONS = {
  'read-drafts': '✎', keys: '⌨', 'site-data': '⇣', 'page-data': '◫', sound: '♪', controls: '◐', mods: '⇆', media: '▶',
  'search-box': '⌕', 'go-to': '↪', click: '◉', 'write-drafts': '⇄',
  'site-storage': '▤', 'local-fonts': 'Aa', 'image-variants': '▣', preload: '⇡', embeds: '▷', 'rewrite-requests': '⇌', 'block-events': '⊘', 'page-events': '↯', 'edit-uploads': '⧉', migrate: '⇢',
  sends: '↗', loads: '↗', site: '↗', acts: '◉', navigates: '↪', hidden: '?', match: '◎', risk2: '⚠', tier: '⚠',
};
export const iconOf = (key) => {
  const k = String(key || '');
  const p = /^power:([\w-]+)/.exec(k);
  return FACT_ICONS[p ? p[1] : k.split(':')[0]] || '•';
};

// A file name as a quiet link (a button): the code card, or in the code card, the file in its folder
export function fileLink(text, title, onClick, cls = '') {
  const b = el('button', `file-link ${cls}`.trim(), text);
  b.type = 'button';
  b.title = title;
  b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return b;
}

// Light colouring, no library: comments, strings, keywords and numbers, by one pattern (a long file: plain).
const CODE_TOKENS = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|('(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\[\s\S]|[^`\\])*`)|\b(const|let|var|function|return|if|else|for|while|do|of|in|new|class|extends|async|await|try|catch|finally|throw|true|false|null|undefined|this|typeof|instanceof|switch|case|break|continue|default|delete|void|yield)\b|\b(\d+(?:\.\d+)?)\b/g;
export function renderCode(box, text) {
  const pieces = [];
  if (text.length <= 300000) {
    let at = 0;
    for (const t of text.matchAll(CODE_TOKENS)) {
      if (t.index > at) pieces.push([text.slice(at, t.index), null]);
      pieces.push([t[0], t[1] ? 'c' : t[2] ? 's' : t[3] ? 'k' : 'n']);
      at = t.index + t[0].length;
    }
    if (at < text.length) pieces.push([text.slice(at), null]);
  } else pieces.push([text, null]);
  // one element per line (CSS numbers them), each piece split at its line breaks; the line's text in an
  // inner span, so a wrapped line's continuations hang at its own indentation (codeLine)
  const source = text.split('\n');
  let line = codeLine('l', '', source[0]);
  const lines = [line];
  for (const [t, cls] of pieces) {
    const parts = t.split('\n');
    parts.forEach((part, i) => {
      if (i > 0) { line = codeLine('l', '', source[lines.length]); lines.push(line); }
      if (part) line.firstChild.append(cls ? el('span', `t${cls}`, part) : document.createTextNode(part));
    });
  }
  box.replaceChildren(...lines);
}

/**
 * A line of code: span.l (numbered by CSS, once per source line) holding span.lc with `text`; --ind, the
 * line's own indentation (tabs as 2), plus `extra` characters, is where its wrapped continuations start.
 */
export function codeLine(cls, text, source = text, extra = 0) {
  const line = el('span', cls);
  const lead = /^[ \t]*/.exec(source || '')[0];
  line.style.setProperty('--ind', `${[...lead].reduce((n, c) => n + (c === '\t' ? 2 : 1), 0) + extra}ch`);
  line.append(el('span', 'lc', text));
  return line;
}

// A free mod's warning on the approval card: its first words (and their comma, as "Together," has it) in coral
// (Tim, 11-13)
export const freeWarning = () => [el('b', null, 'A free mod can do anything the page can do,'), ' including posting or sending as you. Only enable free mods that you trust.'];
