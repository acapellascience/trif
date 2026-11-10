// ==WebMod==
// @name        Style Encoder
// @description Stamps your profile style into your new picture
// @match       https://x.com/*
// @run-at      document-start
// @risk        0 render-only: changes the picture you choose before X gets it; sends nothing anywhere
// @source      trif
// @version     1
// ==/WebMod==

// Tim's. Works with Profile Styler (profile-styler.js), which reads the style back out.
//
// When you choose a new profile picture in Edit profile (x.com/settings/profile), the picture is redrawn
// before X sees it: squared (the middle of it) at 400×400, with your style from Profile Styler's panel
// (localStorage STORE) stamped into the bottom-left corner as colour codes, which X's round crop hides. In
// X's crop step, don't zoom or move it: the code is in the corner and must stay there. Anyone with Profile
// Styler then sees your profile in your colours.
//
// The code (4×4-pixel cells, counted from the bottom-left corner, x right and y up; see profile-styler.js):
// six markers on x + y <= 2, (0,0) red, (1,0) magenta, (2,0) yellow, (0,1) blue, (1,1) cyan, (0,2) green;
// then (0,4) background, (1,3) name, (2,2) badge, (3,1) handle, (4,0) text, (0,6) buttons, (1,5) links,
// (2,4) side panels, (3,3) menu icons, (4,2) logo, (5,1) cards, (6,0) lines, (3,7) quoted posts, in any
// colour, exactly (the picture goes up as a PNG: when X keeps it lossless they read back exactly, when it
// makes it a JPEG to the nearest of a 64-colour palette); and rainbow flags in that order, white = rainbow:
// x + y = 8, (0,8) to (8,0), then (0,10), (1,9), (2,8), (4,6).
// Every new profile picture goes up as a 400×400 PNG (which X keeps as a PNG, lossless, so the code reads
// back exactly), with the code when the signed-in account has a saved style, plain otherwise. The banner
// (not square) and anything that isn't a picture pass through untouched.
//
// How: X's file input's change event is caught first (capture phase) and stopped; the picture is redrawn
// (canvas, PNG); then the same event goes out again with the new file, marked so it isn't caught twice.
(() => {
  const STORE = 'trifProfileStyler.mine';
  const MARKERS = [[0, 0, '#ff0000'], [1, 0, '#ff00ff'], [2, 0, '#ffff00'], [0, 1, '#0000ff'], [1, 1, '#00ffff'], [0, 2, '#00ff00']];
  const SIZE = 400, CELL = 4;
  const ENCODED = Symbol('trif-style-encoded');
  const isPicture = (f) => /^image\/(png|jpeg|webp)$/.test(f.type);
  // (the signed-in account's own saved style: STORE:<handle, lower case>, see profile-styler.js; the account
  // from the account button at the bottom of X's menu)
  const style = () => {
    try {
      const t = document.querySelector('[data-testid=SideNav_AccountSwitcher_Button] [data-testid^="UserAvatar-Container-"]')?.dataset.testid || '';
      const me = /^UserAvatar-Container-(\w+)$/.exec(t)?.[1];
      return me ? JSON.parse(localStorage.getItem(`${STORE}:${me.toLowerCase()}`) || 'null') : null;
    } catch { return null; }
  };

  async function encode(file, st) {
    try {
      const bmp = await createImageBitmap(file);
      const w = bmp.width, h = bmp.height;
      if (Math.max(w, h) / Math.min(w, h) > 1.3) { bmp.close?.(); return file; } // (the banner: not ours)
      const side = Math.min(w, h);
      const c = new OffscreenCanvas(SIZE, SIZE), g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(bmp, (w - side) / 2, (h - side) / 2, side, side, 0, 0, SIZE, SIZE); // (the middle square)
      bmp.close?.();
      // (no saved style for this account: just the 400×400 PNG, no code)
      if (!st) {
        const blob = await c.convertToBlob({ type: 'image/png' });
        window.trif?.log('made the picture a 400×400 PNG (no style saved for this account, so no code)');
        return new File([blob], (file.name.replace(/\.[^.]*$/, '') || 'profile') + '-400.png', { type: 'image/png', lastModified: file.lastModified });
      }
      const cell = (x, y, color) => { g.fillStyle = color; g.fillRect(x * CELL, SIZE - (y + 1) * CELL, CELL, CELL); };
      for (const [x, y, color] of MARKERS) cell(x, y, color);
      cell(0, 4, st.bg); cell(1, 3, st.name); cell(2, 2, st.badge); cell(3, 1, st.handle); cell(4, 0, st.text);
      cell(0, 6, st.buttons || '#00aaff'); cell(1, 5, st.links || '#00aaff'); cell(2, 4, st.panel || st.bg);
      cell(3, 3, st.icons || st.text); cell(4, 2, st.logo || st.text); cell(5, 1, st.cards || st.bg); cell(6, 0, st.lines || '#555555'); cell(3, 7, st.quotes || st.cards || st.bg);
      // the rainbow flags, one per colour in the same order: white = rainbow, black = not
      const r = Array.isArray(st.rainbow) ? st.rainbow : [];
      const flag = (x, y, key) => cell(x, y, r.includes(key) ? '#ffffff' : '#000000');
      flag(0, 8, 'bg'); flag(1, 7, 'name'); flag(2, 6, 'badge'); flag(3, 5, 'handle'); flag(4, 4, 'text'); flag(5, 3, 'buttons'); flag(6, 2, 'links'); flag(7, 1, 'panel'); flag(8, 0, 'icons'); flag(0, 10, 'logo'); flag(1, 9, 'cards'); flag(2, 8, 'lines'); flag(4, 6, 'quotes');
      const blob = await c.convertToBlob({ type: 'image/png' });
      const name = (file.name.replace(/\.[^.]*$/, '') || 'profile') + '-styled.png';
      window.trif?.log('stamped your profile style into the picture', JSON.stringify(st));
      return new File([blob], name, { type: 'image/png', lastModified: file.lastModified });
    } catch (e) {
      window.trif?.warn('could not stamp the picture, so it goes as it was', String(e));
      return file;
    }
  }

  addEventListener('change', (e) => {
    const input = e.target;
    if (e[ENCODED] || !(input instanceof HTMLInputElement) || input.type !== 'file' || !input.files?.length) return;
    if (!location.pathname.startsWith('/settings/profile')) return; // (Edit profile only)
    // (every new profile picture goes up as a 400×400 PNG, which X keeps lossless; the code only with a style)
    const saved = style();
    const st = saved && [saved.bg, saved.name, saved.badge, saved.handle, saved.text].every((v) => /^#[0-9a-f]{6}$/i.test(v || '')) ? saved : null;
    const file = input.files[0];
    if (!isPicture(file)) return;
    e.stopImmediatePropagation();
    encode(file, st).then((out) => {
      const dt = new DataTransfer();
      dt.items.add(out);
      for (const f of [...input.files].slice(1)) dt.items.add(f);
      input.files = dt.files;
      const again = new Event('change', { bubbles: true });
      again[ENCODED] = true;
      input.dispatchEvent(again);
    });
  }, true);
})();
