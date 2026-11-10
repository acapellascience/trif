// timsrobot.com/notes/<slug>: Tim's longer posts, ported from X (site/build-notes.js writes NOTES from
// site/notes/*/). Plain HTML: no script, nothing from X or anywhere else. The pictures, videos and the
// pictures of embedded posts are this site's own files (/notes/<slug>/<file>: site/public/, served by the
// Worker from its assets binding).
import { NOTES } from './notes-data.js';
import { SITE, TOKENS, ROBOT_SVG } from './pages.js';

export { NOTES };

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const STYLE = `${TOKENS}
html { background: #000; }
body { margin: 0; background: #000; color: var(--fg); font: 18px/1.6 -apple-system, system-ui, "Segoe UI", sans-serif; }
main { max-width: 680px; margin: 0 auto; padding: 32px 16px 80px; }
.top { display: flex; align-items: center; gap: 10px; margin: 0 0 40px; font-size: 15px; }
.top a { color: var(--fg); text-decoration: none; font-weight: 600; display: inline-flex; align-items: center; gap: 8px; }
.top .robot { width: 32px; height: 32px; }
h1 { font-size: clamp(30px, 6vw, 42px); line-height: 1.15; margin: 0 0 12px; letter-spacing: -0.02em; }
.byline { color: var(--muted); font-size: 15px; margin: 0 0 36px; }
.byline a { color: var(--muted); }
.origin { margin: -28px 0 36px; font-size: 15px; }
.origin a { color: var(--muted); }
h2 { font-size: 26px; line-height: 1.25; margin: 48px 0 12px; letter-spacing: -0.01em; }
p { margin: 0 0 20px; overflow-wrap: anywhere; }
ul { margin: 0 0 20px; padding-left: 26px; }
li { margin: 0 0 6px; }
a { color: var(--accent); }
figure { margin: 28px 0 32px; }
figure img, figure video { display: block; width: 100%; height: auto; border-radius: 10px; background: var(--card); }
figcaption { color: var(--muted); font-size: 15px; line-height: 1.45; margin: 10px 2px 0; text-align: center; }
/* embedded posts: a picture of the post, in TRIF's green frame, linking to it on X */
.post { display: block; width: fit-content; max-width: 100%; margin: 0 auto; padding: 3.5px; border-radius: 15.5px;
  background: linear-gradient(135deg, #6ee7b7, #34d399 50%, #059669); }
.post img { display: block; max-width: 100%; height: auto; border-radius: 12px; background: #15202b; }
.post:focus-visible { outline: 2px solid var(--fg); outline-offset: 3px; }
.source { color: var(--muted); font-size: 15px; border-top: 1px solid var(--line); margin: 56px 0 0; padding: 20px 0 0; }
@media (max-width: 520px) { body { font-size: 17px; } main { padding-top: 20px; } h2 { font-size: 23px; margin-top: 40px; }
  figure:not(.post-fig) { margin: 22px -16px 26px; } figure:not(.post-fig) :is(img, video) { border-radius: 0; } figcaption { margin: 8px 16px 0; } }
`;

function block(b, slug) {
  const file = (f) => `/notes/${slug}/${f}`;
  switch (b.t) {
    case 'h2': return `<h2>${b.html}</h2>`;
    case 'quote': return `<blockquote><p>${b.html}</p></blockquote>`;
    case 'p': return `<p>${b.html}</p>`;
    case 'img': return `<figure><img src="${file(b.src)}" width="${b.w}" height="${b.h}" alt="${esc(b.caption)}" loading="lazy" decoding="async">${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ''}</figure>`;
    case 'video': return `<figure><video controls playsinline preload="metadata" poster="${file(b.poster)}" width="${b.w}" height="${b.h}"><source src="${file(b.src)}" type="video/mp4"></video>${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ''}</figure>`;
    case 'post': return `<figure class="post-fig"><a class="post" href="${esc(b.href)}" title="See the post on X"><img src="${file(b.src)}" width="${b.w}" height="${b.h}" alt="${esc(b.alt)}" loading="lazy" decoding="async"></a>${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ''}</figure>`;
    default: return '';
  }
}

/** The page for a note (NOTES[slug]), or null. */
export function notePage(slug) {
  const n = Object.hasOwn(NOTES, slug) ? NOTES[slug] : null;
  if (!n) return null;
  // (list items next to each other make one list)
  const parts = [];
  for (let i = 0; i < n.blocks.length; i++) {
    if (n.blocks[i].t === 'li') {
      const items = [];
      for (; i < n.blocks.length && n.blocks[i].t === 'li'; i++) items.push(`<li>${n.blocks[i].html}</li>`);
      i--;
      parts.push(`<ul>\n${items.join('\n')}\n</ul>`);
    } else parts.push(block(n.blocks[i], slug));
  }
  const url = `${SITE}/notes/${slug}`;
  const image = n.image ? `${SITE}/notes/${slug}/${n.image.src}` : `${SITE}/og.png`;
  const date = n.date ? new Date(`${n.date}T12:00:00Z`).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }) : '';
  const onX = n.x ? `<a href="${esc(n.x)}">on X</a>` : 'on X';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(n.title)} · Tim's Robot Internet Fixer</title>
<meta name="description" content="${esc(n.description)}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="canonical" href="${url}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Tim's Robot Internet Fixer">
<meta property="og:title" content="${esc(n.title)}">
<meta property="og:description" content="${esc(n.description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${image}">${n.image ? `
<meta property="og:image:width" content="${n.image.w}">
<meta property="og:image:height" content="${n.image.h}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${image}">
<style>${STYLE}</style>
</head>
<body>
<main>
<div class="top"><a href="/">${ROBOT_SVG.replace('class="robot"', 'class="robot" width="32" height="32"').replace(/ width="128" height="128"/, '')}Tim's Robot Internet Fixer</a></div>
<article>
<h1>${esc(n.title)}</h1>
<p class="byline">Tim Blais (<a href="https://x.com/MasterTimBlais">@MasterTimBlais</a>)</p>
<p class="origin">${n.x ? `<a href="${esc(n.x)}">` : ''}Originally published on X${date ? `, ${date}` : ''}${n.x ? '</a>' : ''}</p>
${parts.join('\n')}
</article>
<p class="source">First posted ${onX}${n.x ? '' : ' (link coming)'}. Embedded posts are pictures; click one to see it on X.</p>
</main>
</body>
</html>
`;
}

/** Whether a note has a file of that name (its pictures, videos and posts: the only files /notes/ serves). */
export const noteHasFile = (slug, file) => Object.hasOwn(NOTES, slug) && NOTES[slug].files.includes(file);
