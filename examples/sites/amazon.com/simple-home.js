// ==WebMod==
// @name        Simple Home
// @description Just search, nothing else
// @match       https://www.amazon.com/*
// @run-at      document-start
// @risk        1 covers the whole home page, ads included, so their impressions never report
// @source      webmods
// @version     3
// ==/WebMod==

(() => {
  // Home page only: "/" (often with ?ref_=...) or "/ref=nav_logo"-style paths.
  if (!/^\/(ref=[^/]*)?$/.test(location.pathname)) return;

  const root = document.documentElement;
  root.setAttribute('data-ash-on', '');

  const style = document.createElement('style');
  style.textContent = `
    html[data-ash-on], html[data-ash-on] body { background: #131921 !important; overflow: hidden !important; }
    html[data-ash-on] body > *:not(#ash-home) { display: none !important; }
    #ash-home { position: fixed; inset: 0; z-index: 2147483647; display: flex; flex-direction: column;
      align-items: center; justify-content: center; gap: 28px; background: #131921; color: #fff;
      font-family: "Amazon Ember", Arial, sans-serif; margin-top: -8vh; }
    #ash-home .ash-logo { display: block; line-height: 0; }
    /* Smooth the upscaled sprite's edges: see the filter below */
    #ash-home .ash-logo-img { display: block; filter: url(#ash-logo-crisp); }
    #ash-home .ash-logo-text { font-size: 60px; font-weight: 700; line-height: 1; }
    #ash-home .ash-logo-filter { position: absolute; width: 0; height: 0; }
    #ash-home h1 { margin: 0; font-size: 22px; font-weight: 400; color: #fff; }
    #ash-home form { display: flex; width: min(640px, 90vw); height: 46px; border-radius: 8px; overflow: hidden; }
    #ash-home input { flex: 1; height: 100% !important; margin: 0 !important; border: 0 !important; border-radius: 0 !important; box-shadow: none !important; padding: 0 14px; font-size: 16px; outline: none; color: #111; background: #fff; }
    #ash-home form:focus-within { box-shadow: 0 0 0 3px #f90; }
    #ash-home button { border: 0; width: 56px; background: #febd69; cursor: pointer; font-size: 20px; }
    #ash-home button:hover { background: #f3a847; }
  `;
  root.append(style);

  // Same width as the traced logo in simple-home-svg.js, so the page looks the same with either.
  const LOGO_WIDTH = 220;

  // Amazon's logo sprite is small (98x34 at 1x), so at this size the browser's upscaling leaves soft,
  // blurry edges. This filter smooths the jaggies (a slight blur) and then steepens the alpha
  // ramp, so the edges come out crisp and anti-aliased. The logo is flat colour on transparent,
  // so working on alpha alone sharpens it without halos.
  const crispFilter = () => {
    const NS = 'http://www.w3.org/2000/svg';
    const holder = document.createElementNS(NS, 'svg');
    holder.setAttribute('class', 'ash-logo-filter');
    holder.setAttribute('aria-hidden', 'true');
    const filter = document.createElementNS(NS, 'filter');
    filter.setAttribute('id', 'ash-logo-crisp');
    filter.setAttribute('color-interpolation-filters', 'sRGB');
    filter.setAttribute('x', '-5%');
    filter.setAttribute('y', '-5%');
    filter.setAttribute('width', '110%');
    filter.setAttribute('height', '110%');
    const blur = document.createElementNS(NS, 'feGaussianBlur');
    blur.setAttribute('stdDeviation', '0.45');
    const transfer = document.createElementNS(NS, 'feComponentTransfer');
    const alpha = document.createElementNS(NS, 'feFuncA');
    alpha.setAttribute('type', 'linear');
    alpha.setAttribute('slope', '3');
    alpha.setAttribute('intercept', '-1');
    transfer.append(alpha);
    filter.append(blur, transfer);
    holder.append(filter);
    return holder;
  };

  const navLogoStyle = () => {
    const base = document.querySelector('#nav-logo-sprites .nav-logo-base');
    const cs = base && getComputedStyle(base);
    return cs && cs.backgroundImage !== 'none' && parseFloat(cs.width) > 0 ? cs : null;
  };

  // Copy the nav logo's sprite styles as they are, and enlarge with `zoom` (unlike a transform, zoom
  // also enlarges the space the logo takes in the layout). Copied once, when the page is built: at
  // that point the nav uses the 1x sprite. Amazon swaps in a 2x sprite later in loading, but its
  // crop lines up a little differently, so following it made the logo shift; with the crisp filter
  // the 1x one looks good, so we keep it.
  const syncLogo = (img) => {
    const cs = navLogoStyle();
    if (!cs) return;
    img.style.backgroundImage = cs.backgroundImage;
    img.style.backgroundRepeat = cs.backgroundRepeat;
    img.style.backgroundPosition = cs.backgroundPosition;
    img.style.backgroundSize = cs.backgroundSize;
    img.style.width = cs.width;
    img.style.height = cs.height;
    img.style.zoom = String(LOGO_WIDTH / parseFloat(cs.width));
  };

  const build = () => {
    try {
      if (!document.body || document.getElementById('ash-home')) return;
      const home = document.createElement('div');
      home.id = 'ash-home';

      // Logo: reuse the sprite Amazon's own nav logo uses (the URL has a cache-busting hash, so read it live).
      // Unlike amazon.ca, the .com logo has no locale suffix next to it.
      const logo = document.createElement('a');
      logo.className = 'ash-logo';
      logo.href = '/';
      logo.setAttribute('aria-label', 'Amazon.com');
      if (navLogoStyle()) {
        const img = document.createElement('span');
        img.className = 'ash-logo-img';
        logo.append(img, crispFilter());
        syncLogo(img);
      } else {
        const t = document.createElement('span');
        t.className = 'ash-logo-text';
        t.textContent = 'amazon';
        logo.append(t);
      }

      const h1 = document.createElement('h1');
      h1.textContent = 'Welcome to Amazon. What would you like to buy?';

      // Plain GET to Amazon's own search page.
      const form = document.createElement('form');
      form.action = '/s';
      form.method = 'get';
      form.setAttribute('role', 'search');
      const input = document.createElement('input');
      input.type = 'search';
      input.name = 'k';
      input.placeholder = 'Search Amazon.com';
      input.setAttribute('aria-label', 'Search Amazon.com');
      input.autocomplete = 'off';
      const button = document.createElement('button');
      button.type = 'submit';
      button.setAttribute('aria-label', 'Search');
      button.textContent = '🔍';
      form.append(input, button);

      home.append(logo, h1, form);
      document.body.append(home);
      input.focus();
    } catch (e) { window.webmods?.warn('simple home failed', String(e)); }
  };

  // Wait for the nav logo so we can borrow its sprite.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
  // The page may come back from the back/forward cache, or something may remove our node.
  addEventListener('pageshow', build);
})();
