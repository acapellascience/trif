// ==WebMod==
// @name        LED Footer
// @description The footer becomes a scrolling LED sign
// @match       https://timsrobot.com/*
// @match       https://*.timsrobot.com/*
// @run-at      document-start
// @risk        0 render-only
// @source      trif
// @version     1
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
      box-shadow: inset 0 0 18px #000, 0 0 0 1px #444, 0 6px 18px rgba(0,0,0,.5), 0 0 28px rgba(255,110,0,.22);
      padding: 10px 0;
    }
    /* The unlit LEDs: a faint dot grid behind the text; clicks pass through it. */
    .led-sign::after {
      content: '';
      position: absolute; inset: 0;
      pointer-events: none;
      background: radial-gradient(circle, rgba(255,120,30,.09) 1.4px, transparent 1.9px) 0 0 / 4px 4px;
    }
    /* The glow sits on the whole scrolling strip, after the letters are cut into dots (below), so it
       blooms out over the panel instead of being chopped up by the grid: tight, medium, wide. */
    .led-track {
      position: relative; z-index: 1;
      display: flex;
      width: max-content;
      animation: led-scroll var(--led-dur, 18s) linear infinite;
      filter: drop-shadow(0 0 2px rgba(255,170,40,.95)) drop-shadow(0 0 7px rgba(255,120,0,.8)) drop-shadow(0 0 18px rgba(255,80,0,.55));
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
      text-shadow: none;
      /* each letter is cut into LED dots */
      -webkit-mask: radial-gradient(circle, #000 1.5px, transparent 2px) 0 0 / 4px 4px;
      mask: radial-gradient(circle, #000 1.5px, transparent 2px) 0 0 / 4px 4px;
    }
    .led-group a::before { content: '\\2605  '; color: #ff3b1f; }
    .led-group a:hover, .led-group a:focus-visible {
      color: #fff3c4 !important;
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

    // The loop is seamless only while the two copies match. Space Shooter blasts words (and whole links)
    // one at a time, marking each [data-tss-dead], and its R brings them back: whatever happens to a part
    // of one copy happens to the same part of the other, or each wrap-around would jump-cut between them.
    const twin = (el) => {
      const from = group.contains(el) ? group : copy.contains(el) ? copy : null;
      if (!from) return null;
      const all = [...from.querySelectorAll('*')];
      const i = all.indexOf(el);
      return i < 0 ? null : ((from === group ? copy : group).querySelectorAll('*')[i] || null);
    };
    new MutationObserver((records) => {
      for (const r of records) {
        const el = r.target, other = twin(el);
        if (!other) continue;
        const v = el.getAttribute('data-tss-dead');
        if (v === other.getAttribute('data-tss-dead')) continue;
        if (v === null) other.removeAttribute('data-tss-dead'); else other.setAttribute('data-tss-dead', v);
      }
    }).observe(track, { subtree: true, attributes: true, attributeFilter: ['data-tss-dead'] });
    window.trif?.log('LED footer built with', links.length, 'links');
  };

  const run = () => { try { build(); } catch (e) { window.trif?.warn('led failed', String(e)); const f = document.querySelector('footer'); f && f.setAttribute('data-led-done', ''); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
})();
