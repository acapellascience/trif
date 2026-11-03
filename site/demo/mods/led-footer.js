// ==WebMod==
// @name        LED footer
// @description Turns the footer into a scrolling LED sign; the links scroll through it and stay clickable
// @match       https://timsrobot.com/*
// @match       https://*.timsrobot.com/*
// @run-at      document-start
// @risk        0 render-only
// ==/WebMod==

(() => {
  const addStyle = (css) => {
    const style = document.createElement('style');
    style.textContent = css;
    (document.head || document.documentElement).append(style);
  };

  // Hide the plain footer until it's been turned into a sign, so there's no flash.
  addStyle(`
    footer:not([data-led-done]) { visibility: hidden; }
    footer[data-led-done] {
      display: block !important;
      flex-wrap: nowrap !important;
      padding: 22px 16px 40px !important;
    }
    .led-sign {
      position: relative;
      overflow: hidden;
      background: #0b0503;
      border: 6px solid #222;
      border-radius: 10px;
      box-shadow: inset 0 0 18px #000, 0 0 0 1px #444, 0 6px 18px rgba(0,0,0,.5);
      padding: 10px 0;
    }
    /* Dot-matrix grid laid over the text; clicks pass through it. */
    .led-sign::after {
      content: '';
      position: absolute; inset: 0;
      pointer-events: none;
      background: radial-gradient(circle, transparent 1.4px, rgba(11,5,3,.8) 1.9px) 0 0 / 4px 4px;
    }
    .led-track {
      display: flex;
      width: max-content;
      animation: led-scroll var(--led-dur, 18s) linear infinite;
    }
    .led-sign:hover .led-track, .led-sign:focus-within .led-track { animation-play-state: paused; }
    .led-group {
      display: flex; flex: none;
      justify-content: space-around;
      gap: 56px;
      padding-right: 56px;
      min-width: var(--led-w, 900px);
      box-sizing: border-box;
    }
    .led-group a {
      font: bold 26px/1.2 "Courier New", ui-monospace, monospace !important;
      letter-spacing: 3px;
      text-transform: uppercase;
      white-space: nowrap;
      text-decoration: none !important;
      color: #ffb020 !important;
      text-shadow: 0 0 4px #ff9000, 0 0 10px #ff6a00, 0 0 20px rgba(255,90,0,.6);
    }
    .led-group a::before { content: '\\2605  '; color: #ff3b1f; text-shadow: 0 0 6px #ff2000; }
    .led-group a:hover, .led-group a:focus-visible {
      color: #fff3c4 !important;
      text-shadow: 0 0 4px #fff, 0 0 12px #ffcc33, 0 0 24px #ff9000;
      outline: none;
    }
    @keyframes led-scroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
    @media (prefers-reduced-motion: reduce) { .led-track { animation: none; } }
  `);

  const build = () => {
    const footer = document.querySelector('footer');
    if (!footer || footer.hasAttribute('data-led-done')) return;
    const links = [...footer.querySelectorAll('a[href]')];
    if (!links.length) { footer.setAttribute('data-led-done', ''); return; }

    const sign = document.createElement('div');
    sign.className = 'led-sign';
    const track = document.createElement('div');
    track.className = 'led-track';
    const group = document.createElement('div');
    group.className = 'led-group';
    links.forEach((a) => group.append(a));   // the real links, moved in
    // A copy follows so the loop is seamless; it's hidden from screen readers and tabbing.
    const copy = group.cloneNode(true);
    copy.setAttribute('aria-hidden', 'true');
    copy.querySelectorAll('a').forEach((a) => a.setAttribute('tabindex', '-1'));
    track.append(group, copy);
    sign.append(track);
    footer.textContent = '';
    footer.append(sign);
    footer.setAttribute('data-led-done', '');

    const size = () => {
      const w = sign.clientWidth || 900;
      sign.style.setProperty('--led-w', w + 'px');
      // Keep a steady speed (~90px/s) whatever the width.
      sign.style.setProperty('--led-dur', Math.max(8, group.offsetWidth / 90) + 's');
    };
    size();
    addEventListener('resize', size);
    window.trif?.log('LED footer built with', links.length, 'links');
  };

  const run = () => { try { build(); } catch (e) { window.trif?.warn('led-footer failed', String(e)); const f = document.querySelector('footer'); f && f.setAttribute('data-led-done', ''); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
})();
