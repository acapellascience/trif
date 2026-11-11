// A small, safe markdown renderer for agent replies in the side panel. The input is escaped FIRST;
// only then are a few constructs turned into tags this file writes itself: paragraphs, line breaks,
// lists, headings (as <h4>), block quotes, tables, `code`, fenced code blocks, **bold**, *italic*, and links
// (http/https/mailto only, opening in a new tab). Nothing from the input ever becomes raw HTML.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
}

// Placeholders use characters stripped from the input, so input can't forge them.
const PH_OPEN = '\u0001';
const PH_CLOSE = '\u0002';

function link(href, html) {
  return `<a href="${href}" target="_blank" rel="noopener noreferrer">${html}</a>`;
}

function emphasis(s) {
  return s
    .replace(/\*\*(?=\S)([^*\n]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/__(?=\S)([^_\n]*?\S)__/g, '<strong>$1</strong>')
    .replace(/(^|[^\w*])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![\w*])/g, '$1<em>$2</em>');
}

/** Inline formatting for one block of already-escaped text. */
function inline(esc) {
  const saved = [];
  const keep = (html) => `${PH_OPEN}${saved.push(html) - 1}${PH_CLOSE}`;
  let s = esc.replace(/`([^`\n]+)`/g, (_, c) => keep(`<code>${c}</code>`));
  // [text](url): the URL is already escaped (no quotes or angle brackets can survive), and only
  // http(s)/mailto schemes are linked.
  s = s.replace(/\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^\s()]+)\)/gi, (_, text, href) => keep(link(href, emphasis(text))));
  // Bare URLs end at whitespace or an escaped quote/angle bracket.
  s = s.replace(/\bhttps?:\/\/(?:(?!&quot;|&#39;|&lt;|&gt;)[^\s\u0001\u0002])+/gi, (url) => {
    const trail = /[.,;:!?)\]]+$/.exec(url)?.[0] ?? '';
    const href = url.slice(0, url.length - trail.length);
    return keep(link(href, href)) + trail;
  });
  s = emphasis(s);
  return s.replace(/\u0001(\d+)\u0002/g, (_, i) => saved[Number(i)]);
}

const LIST_ITEM = /^\s{0,6}([-*+]|\d{1,9}[.)])\s+(.*)$/;
// A table: a `| a | b |` row followed by a `|---|---|` separator row (Claude Code's /context prints these).
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => inline(escapeHtml(c.trim())));

/** Render markdown text to an HTML string that is safe to insert. */
export function renderMarkdown(text) {
  const lines = String(text ?? '').replace(/[\u0000-\u0002]/g, '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let para = [];
  let list = null; // {ordered, start, items: [[lines]]}
  let quote = [];

  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map((l) => inline(escapeHtml(l))).join('<br>')}</p>`);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const tag = list.ordered ? 'ol' : 'ul';
    const start = list.ordered && list.start !== 1 ? ` start="${list.start}"` : '';
    out.push(`<${tag}${start}>${list.items.map((it) => `<li>${it.map((l) => inline(escapeHtml(l))).join('<br>')}</li>`).join('')}</${tag}>`);
    list = null;
  };
  const flushQuote = () => {
    if (quote.length) out.push(`<blockquote>${quote.map((l) => inline(escapeHtml(l))).join('<br>')}</blockquote>`);
    quote = [];
  };
  const flushAll = () => { flushPara(); flushList(); flushQuote(); };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = /^\s*(```+|~~~+)\s*([\w+#.-]*)\s*$/.exec(line);
    if (fence) {
      flushAll();
      const code = [];
      const close = new RegExp(`^\\s*${fence[1][0] === '`' ? '`' : '~'}{${fence[1].length},}\\s*$`);
      for (i++; i < lines.length && !close.test(lines[i]); i++) code.push(lines[i]);
      // An unclosed fence (mid-stream) still renders as code.
      out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }
    if (!line.trim()) { flushAll(); continue; }
    const heading = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) { flushAll(); out.push(`<h4>${inline(escapeHtml(heading[1]))}</h4>`); continue; }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) { flushAll(); out.push('<hr>'); continue; }
    if (TABLE_ROW.test(line) && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
      flushAll();
      const head = cells(line);
      const rows = [];
      for (i += 2; i < lines.length && TABLE_ROW.test(lines[i]); i++) rows.push(cells(lines[i]));
      i--;
      out.push(`<table><thead><tr>${head.map((c) => `<th>${c}</th>`).join('')}</tr></thead>` +
        `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    const q = /^\s{0,3}>\s?(.*)$/.exec(line);
    if (q) { flushPara(); flushList(); quote.push(q[1]); continue; }
    const item = LIST_ITEM.exec(line);
    if (item) {
      flushPara(); flushQuote();
      const ordered = /\d/.test(item[1]);
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, start: ordered ? parseInt(item[1], 10) : 1, items: [] };
      }
      list.items.push([item[2]]);
      continue;
    }
    if (list && /^\s+\S/.test(line)) { list.items[list.items.length - 1].push(line.trim()); continue; }
    flushList(); flushQuote();
    para.push(line);
  }
  flushAll();
  return out.join('');
}

/** The tags and attributes renderMarkdown can produce (used as a Sanitizer allowlist in the panel). */
export const MARKDOWN_ELEMENTS = ['p', 'br', 'ul', 'ol', 'li', 'h4', 'hr', 'blockquote', 'pre', 'code', 'strong', 'em', 'a',
  'table', 'thead', 'tbody', 'tr', 'th', 'td'];
export const MARKDOWN_ATTRIBUTES = ['href', 'target', 'rel', 'start'];

/** Put renderMarkdown output (already safe by construction) into `node`, through the Sanitizer as a second fence. */
export function setMarkdown(node, text) {
  const html = renderMarkdown(text);
  if (typeof node.setHTML === 'function') {
    try {
      node.setHTML(html, { sanitizer: { elements: MARKDOWN_ELEMENTS, attributes: MARKDOWN_ATTRIBUTES } });
      return;
    } catch { /* older Sanitizer API shape: fall through */ }
  }
  node.innerHTML = html;
}
