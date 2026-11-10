// ==WebMod==
// @name        E2E Sandboxed mod
// @match       *://127.0.0.1/sandbox.html*
// @sandboxed
// @run-at      document-idle
// ==/WebMod==

// What a sandboxed mod can do (tests/e2e/scenario.js sandboxedCheck): restyle, hide, add elements, change
// text (also what appears later), draw on a canvas, use timers and frames, keep settings, watch for elements,
// listen to the page, copy an image the page shows, log; and the names its global has. Outcomes go on the
// page as data.
const out = { names: Object.getOwnPropertyNames(globalThis).sort() };
trif.css('#title { color: rgb(1, 2, 3) }');
trif.hide('.sbx-hide');
const made = page.create('div');
made.setAttr('id', 'sbx-made');
made.setText('made in the sandbox');
page.body.append(made);
trif.text('#txt, #box', (text) => text.replace(/Grok/g, 'the robot'));
trif.observe('.later', (el) => el.setAttr('data-seen', 'yes'));
const cv = page.create('canvas');
cv.setAttr('id', 'sbx-canvas'); cv.setAttr('width', '10'); cv.setAttr('height', '10');
const g = cv.canvas();
g.set({ fillStyle: 'rgb(7, 8, 9)' });
g.fillRect(0, 0, 10, 10);
page.body.append(cv);
setTimeout(() => page.root.setAttr('data-sbx-timer', 'ran'), 30);
let n = 0;
const iv = setInterval(() => { if (++n === 3) { clearInterval(iv); page.root.setAttr('data-sbx-interval', String(n)); } }, 10);
requestAnimationFrame((ts) => page.root.setAttr('data-sbx-frame', typeof ts));
const copy = page.find('#pimg').clone();
copy.setAttr('id', 'sbx-copy');
page.body.append(copy);
page.find('#target-click').on('click', (e) => {
  page.root.setAttr('data-sbx-clicked', `${e.type}:${e.target ? e.target.attr('id') : 'none'}:${Object.getPrototypeOf(e.target) === Object.getPrototypeOf(page.root) ? 'stand-in' : 'other'}`);
});
trif.log('hello from the sandbox', { n: 1 });
console.warn('a warning from the sandbox');
(async () => {
  const s = await trif.settings('prefs', { visits: 0 });
  await s.save({ visits: s.value.visits + 1 });
  page.root.setAttr('data-sbx-visits', String(s.value.visits));
})();
const cells = page.findAll('.cell');
const t0 = Date.now();
for (const c of cells) c.style('color', 'rgb(1, 2, 3)');
out.ms = Date.now() - t0;
out.cells = cells.length;
page.root.setAttr('data-sbx-good', JSON.stringify(out));
setTimeout(() => { throw new Error('thrown later by the sandboxed mod'); }, 50);
