// Reads an X article out of its page, for site/notes/<slug>/article.json (build-notes.js):
//   node helper/cli.js run --tab <id> --timeout 30000 -f site/notes/extract.js > site/notes/<slug>/article.json
// on the article's page or its preview (x.com/…/articles/edit/<id>/preview), in the browser you read X in.
// It only reads the page. Each block in order: paragraphs, headings and list items as html (each piece of text
// wrapped in the <a> <s> <i> <b> it has), pictures (at name=large), videos (their mp4 and playlist
// addresses, from the player's React props; the page's own <video> plays a blob), their captions, and
// embedded posts (their addresses and their card's text).
const comp = document.querySelector('[data-testid=longformRichTextComponent]');
const title = document.querySelector('[data-testid=twitter-article-title]')?.textContent.trim();
const big = (u) => u && u.includes('pbs.twimg.com/media/') ? u.replace(/name=[^&]+/, 'name=large') : u;
const fiberOf = (el) => { const k = Object.keys(el).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactProps$')); return k ? el[k] : null; };
function findVideoUrls(el) {
  const found = new Set(); const seen = new Set();
  const scan = (o, d) => { if (!o || typeof o !== 'object' || d > 6 || seen.has(o)) return; seen.add(o);
    for (const [k, v] of Object.entries(o)) { if (k === 'return' || k === 'child' || k === 'sibling' || k === '_owner' || k === 'stateNode') continue;
      if (typeof v === 'string' && /video\.twimg\.com\/.+\.(mp4|m3u8)/.test(v)) found.add(v); else if (typeof v === 'object') scan(v, d + 1); } };
  for (let n = el, i = 0; n && i < 12; n = n.parentElement, i++) { const f = fiberOf(n); for (let fb = f, j = 0; fb && j < 20; fb = fb.return, j++) scan(fb.memoizedProps, 0); if (found.size) break; }
  return [...found];
}
function inline(node) {
  let html = '';
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const w = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  for (let t; (t = w.nextNode());) {
    if (!t.data) continue;
    const p = t.parentElement, cs = getComputedStyle(p);
    let s = esc(t.data);
    if (+cs.fontWeight >= 600) s = `<b>${s}</b>`;
    if (cs.fontStyle === 'italic') s = `<i>${s}</i>`;
    if (cs.textDecorationLine.includes('line-through')) s = `<s>${s}</s>`;
    const a = p.closest('a[href]');
    if (a) s = `<a href="${a.href}" data-text="${esc(a.textContent)}">${s}</a>`;
    html += s;
  }
  return html; // (each piece on its own: build-notes.js joins them)
}
const out = [];
// (the article's own blocks: not ones inside another block of it; on the published page the whole article sits
// inside the conversation's <section>, which doesn't count)
const top = [...comp.querySelectorAll('[data-block], section')].filter((b) => { const up = b.parentElement.closest('section, [data-block]'); return !up || !comp.contains(up); });
for (const b of top) {
  if (b.tagName === 'SECTION') {
    const tweet = b.querySelector('[data-testid=simpleTweet], [data-testid=tweet]');
    if (tweet) {
      const links = [...tweet.querySelectorAll('a[href*="/status/"]')].map((a) => a.href.replace(/\/(photo|video|analytics).*$/, ''));
      out.push({ type: 'tweet', urls: [...new Set(links)], text: tweet.querySelector('[data-testid=tweetText]')?.innerText, all: tweet.innerText.slice(0, 600) });
      continue;
    }
    const imgs = [...b.querySelectorAll('img')].map((i) => big(i.src));
    const vids = [...b.querySelectorAll('video')].map((v) => ({ poster: v.poster, src: v.src, urls: findVideoUrls(v) }));
    // (the caption only: not the video player's own text, its times and buttons)
    const capWalk = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
    let cap = '';
    for (let t; (t = capWalk.nextNode());) if (!t.parentElement.closest('[data-testid=videoPlayer], [data-testid=videoComponent], video, button, [role=button], [role=slider]')) cap += t.data;
    cap = cap.trim();
    out.push({ type: vids.length ? 'video' : 'image', imgs, vids, caption: cap, h: b.querySelector('img,video')?.getBoundingClientRect().height | 0, w: b.querySelector('img,video')?.getBoundingClientRect().width | 0 });
  } else {
    const kind = [...b.classList].find((c) => c.startsWith('longform-')) || b.tagName.toLowerCase();
    out.push({ type: 'text', kind, tag: b.tagName.toLowerCase(), html: inline(b) });
  }
}
// (the author: the article's own name line, not an embedded post's)
const byline = [...document.querySelectorAll('[data-testid=User-Name]')].find((e) => !comp.contains(e))?.innerText;
return JSON.stringify({ title, byline, url: location.href, at: new Date().toISOString(), n: out.length, blocks: out });
