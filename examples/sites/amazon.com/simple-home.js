// ==WebMod==
// @name        Simple Home
// @description Just search, nothing else
// @match       https://www.amazon.com/*
// @run-at      document-start
// @risk        1 covers the whole home page, ads included, so their impressions never report
// @source      webmods
// @version     4
// @boxed
// @powers      search-box https://www.amazon.com/s?k={query}
// ==/WebMod==

// Home page only: "/" (often with ?ref_=...) or "/ref=nav_logo"-style paths.
if (!/^\/(ref=[^/]*)?$/.test(new URL(page.url).pathname)) return;

const root = page.root;
root.setAttr('data-trif-box-ash-on', '');

// (the search field is TRIF's own box (search-box): it searches www.amazon.com/s?k=… on Enter or the button,
// as the original's GET form did; the mod places and styles it, and can't fill or read it)
trif.css(`
  html[data-trif-box-ash-on], html[data-trif-box-ash-on] body { background: #131921 !important; overflow: hidden !important; }
  html[data-trif-box-ash-on] body > *:not(#trif-box-ash-home) { display: none !important; }
  #trif-box-ash-home { position: fixed; inset: 0; z-index: 2147483647; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 28px; background: #131921; color: #fff;
    font-family: "Amazon Ember", Arial, sans-serif; margin-top: -8vh; }
  #trif-box-ash-home .trif-box-ash-logo { display: block; line-height: 0; }
  #trif-box-ash-home .trif-box-ash-logo-img { display: block; }
  #trif-box-ash-home .trif-box-ash-logo-text { font-size: 60px; font-weight: 700; line-height: 1; }
  #trif-box-ash-home h1 { margin: 0; font-size: 22px; font-weight: 400; color: #fff; }
  #trif-box-ash-home .trif-box-ash-form { display: flex; width: min(640px, 90vw); height: 46px; border-radius: 8px; overflow: hidden; }
  #trif-box-ash-home .trif-box-ash-input { flex: 1; display: flex; align-items: center; height: 100%; margin: 0; padding: 0 8px; font-size: 16px; color: #111; background: #fff; box-sizing: border-box; }
  #trif-box-ash-home .trif-box-ash-form:focus-within { box-shadow: 0 0 0 3px #f90; }
  #trif-box-ash-home button { border: 0; width: 56px; background: #febd69; cursor: pointer; font-size: 20px; }
  #trif-box-ash-home button:hover { background: #f3a847; }
`);

// Logo: reuse the sprite Amazon's own nav logo uses (the URL has a cache-busting hash, so read it live;
// the box takes it in CSS because Amazon's own style sheet uses that address).
// Same width as the traced logo in simple-home-svg.js, so the page looks the same with either.
const LOGO_WIDTH = 220;
const navLogo = () => {
  const base = page.find('#nav-logo-sprites .nav-logo-base');
  if (!base) return null;
  const cs = {};
  for (const k of ['background-image', 'background-repeat', 'background-position', 'background-size', 'width', 'height']) cs[k] = base.style(k);
  return cs['background-image'] !== 'none' && parseFloat(cs.width) > 0 ? cs : null;
};

// A link to the home page: "/" when a link on the page has it (a link may only carry an address the page's
// links have), else Amazon's own logo link (/ref=nav_logo).
const homeLink = (a) => {
  try { a.setAttr('href', '/'); return; } catch { /* no link to "/" on the page */ }
  const nav = page.find('#nav-logo-sprites');
  try { if (nav && nav.attr('href')) a.setAttr('href', nav.attr('href')); } catch { /* none */ }
};

const build = () => {
  if (!page.body || page.find('#trif-box-ash-home')) return;
  const home = page.create('div');
  home.setAttr('id', 'trif-box-ash-home');

  const logo = page.create('a');
  logo.classes.add('trif-box-ash-logo');
  homeLink(logo);
  logo.setAttr('aria-label', 'Amazon.com');
  // Unlike amazon.ca, the .com logo has no locale suffix next to it.
  const cs = navLogo();
  if (cs) {
    const img = page.create('span');
    img.classes.add('trif-box-ash-logo-img');
    // Copy the nav logo's sprite styles as they are, and enlarge with `zoom` (unlike a transform, zoom
    // also enlarges the space the logo takes in the layout). Copied once, when the page is built: at that
    // point the nav uses the 1x sprite. (The original also smoothed the upscaled sprite with an SVG
    // feGaussianBlur/feComponentTransfer filter: the box draws no SVG filters, so its edges are the
    // browser's own upscaling.)
    for (const k of ['background-image', 'background-repeat', 'background-position', 'background-size', 'width', 'height']) img.style(k, cs[k]);
    img.style('zoom', String(LOGO_WIDTH / parseFloat(cs.width)));
    logo.append(img);
  } else {
    const t = page.create('span');
    t.classes.add('trif-box-ash-logo-text');
    t.setText('amazon');
    logo.append(t);
  }

  const h1 = page.create('h1');
  h1.setText('Welcome to Amazon. What would you like to buy?');

  // Amazon's own search page, as the original's plain GET form (/s?k=…, spaces as +, an empty search too).
  const form = page.create('div');
  form.classes.add('trif-box-ash-form');
  form.setAttr('role', 'search');
  const button = page.create('button');
  button.setAttr('aria-label', 'Search');
  button.setText('🔍');
  const input = trif.searchBox({ placeholder: 'Search Amazon.com', autofocus: true, spaces: '+', emptyOk: true, button });
  input.classes.add('trif-box-ash-input');
  form.append(input, button);

  home.append(logo, h1, form);
  page.body.append(home);
};

// Wait for the nav logo so we can borrow its sprite (the document parsed, as the original's DOMContentLoaded).
await trif.ready;
build();
