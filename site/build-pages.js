// timsrobot.com's pages made from files elsewhere in the repo, as one module the Worker imports:
// site/src/pages-data.js. Run by node site/build-demo.js (which wrangler.toml [build] runs before every
// deploy); tests/site.test.js checks the module is up to date.
//
// - The privacy policy (/privacy) is store/PRIVACY.md, the one copy, as HTML: the Chrome Web Store
//   listing links to it, so it must say what the code does (store/REVIEW_RISKS.md).
// - The Chrome Web Store listing's address (/chrome redirects there, the home page's button, /support), from
//   helper/lib/paths.js: null until the listing is public (STORE_LISTED), and then those point at the
//   README's Load unpacked steps instead.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
export const PRIVACY_MD = path.join(REPO, 'store', 'PRIVACY.md');
export const OUT = path.join(HERE, 'src', 'pages-data.js');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** One line's markdown: `code`, **bold**, *italic*, [text](url), bare https:// links and email addresses. */
export function inline(text) {
  const out = [];
  // (code first: nothing inside it is markdown)
  const parts = String(text).split(/(`[^`]*`)/);
  for (const part of parts) {
    if (/^`[^`]*`$/.test(part)) { out.push(`<code>${esc(part.slice(1, -1))}</code>`); continue; }
    let h = esc(part);
    h = h.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|\/[^)\s]*)\)/g, (m, t, u) => `<a href="${u}">${t}</a>`);
    h = h.replace(/(^|[\s(])(https:\/\/[^\s<)]+[^\s<).,;:])/g, (m, pre, u) => `${pre}<a href="${u}">${u}</a>`);
    h = h.replace(/(^|[\s(])([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g, (m, pre, e) => `${pre}<a href="mailto:${e}">${e}</a>`);
    h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/(^|[^\w*])\*([^*\s][^*]*)\*(?![\w*])/g, '$1<em>$2</em>');
    out.push(h);
  }
  return out.join('');
}

/**
 * The markdown store/PRIVACY.md is written in, as HTML: headings, paragraphs, lists (items continued by
 * indented lines), tables. Nothing else is needed there; anything else is a paragraph.
 */
export function markdownToHtml(md) {
  const lines = String(md).replace(/\r\n/g, '\n').split('\n');
  const html = [];
  let i = 0;
  const isList = (l) => /^(\s*)([-*]|\d+\.)\s+/.test(l);
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const id = h[2].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      html.push(`<h${level} id="${id}">${inline(h[2])}</h${level}>`);
      i++;
      continue;
    }
    if (/^\|/.test(line)) {
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]);
      const cells = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const body = rows.filter((r, n) => !(n === 1 && /^\|[\s:|-]+\|$/.test(r)));
      const [head, ...rest] = body;
      html.push('<div class="table"><table>');
      html.push(`<thead><tr>${cells(head).map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead>`);
      html.push(`<tbody>${rest.map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody>`);
      html.push('</table></div>');
      continue;
    }
    if (isList(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items = [];
      while (i < lines.length && lines[i].trim()) {
        const m = /^\s*(?:[-*]|\d+\.)\s+(.*)$/.exec(lines[i]);
        if (m && isList(lines[i])) items.push(m[1]);
        else if (items.length && /^\s+/.test(lines[i])) items[items.length - 1] += ` ${lines[i].trim()}`;
        else break;
        i++;
      }
      const tag = ordered ? 'ol' : 'ul';
      html.push(`<${tag}>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</${tag}>`);
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4})\s/.test(lines[i]) && !/^\|/.test(lines[i]) && !isList(lines[i])) para.push(lines[i++].trim());
    html.push(`<p>${inline(para.join(' '))}</p>`);
  }
  return html.join('\n');
}

/** The listing's address, from helper/lib/paths.js (null until it's public). */
export function storeUrl() {
  const require = createRequire(import.meta.url);
  return require('../helper/lib/paths.js').storeListingUrl();
}

export function pagesModule() {
  const md = fs.readFileSync(PRIVACY_MD, 'utf8');
  // (the title is the page's own: the policy's "# …" line becomes the page's h1 there)
  const [, title = 'TRIF privacy policy'] = /^#\s+(.*)$/m.exec(md) || [];
  const body = md.replace(/^#\s+.*\n/m, '');
  const updated = /^Last updated:\s*(.*)$/m.exec(md)?.[1] || '';
  return `// Made by node site/build-pages.js (via site/build-demo.js) from store/PRIVACY.md and helper/lib/paths.js. Don't edit.
export const PRIVACY_TITLE = ${JSON.stringify(title)};
export const PRIVACY_UPDATED = ${JSON.stringify(updated)};
export const PRIVACY_HTML = ${JSON.stringify(markdownToHtml(body.replace(/^Last updated:.*\n/m, '')))};
export const STORE_URL = ${JSON.stringify(storeUrl())};
`;
}

export function writePagesModule() {
  const text = pagesModule();
  const old = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;
  if (old !== text) fs.writeFileSync(OUT, text);
  return old !== text;
}
