// The TRIF tasks: what the person asks, on which page, and an in-page check of whether the mod did it.
// `check` runs in the page after the mod is applied; `base` (optional) runs before, its result passed to check.
// Each check returns { pass: bool, note: string }.
const vis = `const vis = (el) => { if (!el) return false; for (let e = el; e && e.nodeType === 1; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden') return false; } const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };`;
const rgb = `const rgb = (s) => (s.match(/[\\d.]+/g) || []).map(Number);`;

module.exports = [
  { id: 'S1-wiki-footer', page: 'wikipedia', kind: 'style', task: 'Hide the footer at the bottom of the page.',
    check: `(() => { ${vis} return { pass: !vis(document.querySelector('#footer')) && vis(document.querySelector('#firstHeading')), note: 'footer ' + (vis(document.querySelector('#footer')) ? 'visible' : 'hidden') + ', heading ' + (vis(document.querySelector('#firstHeading')) ? 'visible' : 'hidden') }; })()`,
    ref: { hide: ['#footer'] } },
  { id: 'S2-wiki-bigger', page: 'wikipedia', kind: 'style', task: 'Make the article text bigger and easier to read.',
    base: `parseFloat(getComputedStyle(document.querySelector('#mw-content-text p:not(.mw-empty-elt)')).fontSize)`,
    check: `((b) => { ${vis} const p = document.querySelector('#mw-content-text p:not(.mw-empty-elt)'); const f = parseFloat(getComputedStyle(p).fontSize); return { pass: f >= b * 1.08 && vis(p), note: 'paragraph font ' + b + 'px -> ' + f + 'px' }; })`,
    ref: { css: '#mw-content-text p, #mw-content-text li { font-size: 19px; line-height: 1.6 }' } },
  { id: 'S3-wiki-green-links', page: 'wikipedia', kind: 'style', task: 'Make the links dark green instead of blue.',
    check: `(() => { ${rgb} const a = [...document.querySelectorAll('#mw-content-text p a[href*="/wiki/"]')].filter((x) => !x.classList.contains('new')).slice(0, 5); const cs = a.map((x) => rgb(getComputedStyle(x).color)); const ok = cs.length && cs.every(([r, g, b]) => g > r + 20 && g > b + 10 && g < 190); return { pass: !!ok, note: 'link colours ' + cs.map((c) => c.join(',')).join(' | ') }; })()`,
    ref: { css: 'a, a:visited { color: #1b5e20 }' } },
  { id: 'S4-hn-filter', page: 'hn', kind: 'style', task: 'Hide the stories that mention Microsoft or Nvidia.',
    check: `(() => { ${vis} const rows = [...document.querySelectorAll('tr.athing')]; const bad = rows.filter((r) => /microsoft|nvidia/i.test(r.textContent)); const good = rows.filter((r) => !/microsoft|nvidia/i.test(r.textContent)); const badShown = bad.filter(vis).length, goodShown = good.filter(vis).length; return { pass: bad.length > 0 && badShown === 0 && goodShown >= good.length - 1, note: 'matching stories shown ' + badShown + '/' + bad.length + ', others shown ' + goodShown + '/' + good.length }; })()`,
    ref: { filter: [{ items: 'tr.athing', hideIfRegex: 'Microsoft|Nvidia' }] } },
  { id: 'S5-hn-grey-bar', page: 'hn', kind: 'style', task: 'Make the orange bar at the top dark grey.',
    check: `(() => { ${rgb} const td = document.querySelector('#hnmain td[bgcolor]'); const [r, g, b] = rgb(getComputedStyle(td).backgroundColor); const grey = Math.abs(r - g) < 25 && Math.abs(g - b) < 25 && r < 140; return { pass: grey, note: 'top bar background ' + [r, g, b].join(',') }; })()`,
    ref: { css: '#hnmain td[bgcolor="#ff6600"] { background-color: #333 !important }' } },
  { id: 'S6-guardian-ads', page: 'guardian', kind: 'style', task: 'Hide the ads.',
    check: `(() => { ${vis} const ads = [...document.querySelectorAll('.ad-slot-container, [id^="dfp-ad"]')]; const shown = ads.filter(vis).length; return { pass: ads.length > 0 && shown === 0 && vis(document.querySelector('#news h2')), note: 'ads shown ' + shown + '/' + ads.length + ', news ' + (vis(document.querySelector('#news h2')) ? 'visible' : 'hidden') }; })()`,
    ref: { hide: ['.ad-slot-container', '[id^="dfp-ad"]'] } },
  { id: 'S7-guardian-opinion', page: 'guardian', kind: 'style', task: 'Hide the Opinion and More opinion sections.',
    check: `(() => { ${vis} const o = vis(document.querySelector('#opinion')), m = vis(document.querySelector('#more-opinion')), n = vis(document.querySelector('#news h2')), f = vis(document.querySelector('#features')); return { pass: !o && !m && n && f, note: 'opinion ' + o + ', more-opinion ' + m + ', news ' + n + ', features ' + f }; })()`,
    ref: { hide: ['#opinion', '#more-opinion'] } },
  { id: 'S8-feed-banners', page: 'testfeed', kind: 'style', task: 'Get rid of the cookie popup and the subscribe banner at the top.',
    check: `(() => { ${vis} const c = vis(document.querySelector('.cookie-consent')), p = vis(document.querySelector('#promo-banner')), f = vis(document.querySelector('section.feed')); return { pass: !c && !p && f, note: 'cookie ' + c + ', banner ' + p + ', feed ' + f }; })()`,
    ref: { hide: ['#promo-banner', 'div[role="dialog"]'] } },
  { id: 'S9-feed-filter', page: 'testfeed', kind: 'style', task: 'Hide any post that contains the word "buy".',
    check: `(() => { ${vis} const arts = [...document.querySelectorAll('article')]; const bad = arts.filter((a) => /buy/i.test(a.textContent)), good = arts.filter((a) => !/buy/i.test(a.textContent)); return { pass: bad.filter(vis).length === 0 && good.filter(vis).length === good.length, note: 'buy posts shown ' + bad.filter(vis).length + '/' + bad.length + ', others shown ' + good.filter(vis).length + '/' + good.length }; })()`,
    ref: { filter: [{ items: 'article', hideIfText: 'buy' }] } },
  { id: 'B1-feed-toggle', page: 'testfeed', kind: 'boxed', task: 'Add a button above the timeline that hides and shows the sidebar.',
    check: 'toggle', ref: null },
  { id: 'B2-wiki-wordcount', page: 'wikipedia', kind: 'boxed', task: 'Show how many words the article has, just under the title.',
    check: 'wordcount', ref: null },
  { id: 'B3-hn-hide-buttons', page: 'hn', kind: 'boxed', task: 'Add a small button next to each story that hides that story.',
    check: 'perstory', ref: null },
];
