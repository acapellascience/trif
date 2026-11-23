// Capture grants (extension/capturegrant.js): which tabs the browser lets TRIF take screenshots of without access
// to every site, by the browser's rules for taking activeTab back; and a screenshot waiting for the user's click.
const assert = require('node:assert');
const { test, before } = require('node:test');

let G;
before(async () => { G = await import('../extension/capturegrant.js'); });

/** Fake timers: `run(ms)` fires what's due after ms more. */
function clock() {
  let t = 1000;
  const timers = new Set();
  return {
    now: () => t,
    setTimer: (fn, ms) => { const x = { at: t + ms, fn }; timers.add(x); return x; },
    clearTimer: (x) => { timers.delete(x); },
    run(ms) { t += ms; for (const x of [...timers]) if (x.at <= t) { timers.delete(x); x.fn(); } },
    pending: () => timers.size,
  };
}
const tick = () => new Promise((r) => setImmediate(r));

test('grants are per tab; Chrome and Edge keep one across a reload and the same origin, and drop it for another origin or a closed tab', () => {
  const saved = [];
  const g = G.createCaptureGrants({ family: 'chromium', save: (d) => saved.push(d) });
  assert.strictEqual(g.has(5), false);
  assert.strictEqual(g.grant({ id: 5, windowId: 1, url: 'https://x.com/home' }, 'click'), 0, 'nothing was waiting');
  assert.strictEqual(g.has(5), true);
  assert.strictEqual(g.has(5, 'https://x.com/notifications'), true);
  assert.strictEqual(g.has(5, 'https://www.x.com/'), false, 'another origin is another grant');
  assert.strictEqual(g.has(6), false, 'only that tab');
  assert.deepStrictEqual(Object.keys(saved.at(-1)), ['5']);
  // reload, a single-page site's own moves, another page of the origin: kept
  g.updated(5, { status: 'loading' }, { url: 'https://x.com/home' });
  g.updated(5, { url: 'https://x.com/explore' });
  g.updated(5, { status: 'complete' });
  assert.strictEqual(g.has(5), true);
  // another origin (www. too): gone, and coming back doesn't bring it back
  g.updated(5, { url: 'https://www.x.com/' });
  assert.strictEqual(g.has(5), false);
  g.updated(5, { url: 'https://x.com/home' });
  assert.strictEqual(g.has(5), false);
  // a loading event carrying only the tab: its address counts
  g.grant({ id: 5, url: 'https://x.com/home' });
  g.updated(5, { status: 'loading' }, { url: 'https://news.example/' });
  assert.strictEqual(g.has(5), false);
  // closed: gone
  g.grant({ id: 7, url: 'https://x.com/' });
  g.removed(7);
  assert.strictEqual(g.has(7), false);
  assert.deepStrictEqual(saved.at(-1), {});
  // refused by the browser (it knows better): gone
  g.grant({ id: 8, url: 'https://x.com/' }, 'shortcut');
  g.refused(8);
  assert.strictEqual(g.has(8), false);
  // (no id: nothing)
  assert.strictEqual(g.grant(null), 0);
  assert.strictEqual(g.grant({ url: 'https://x.com/' }), 0);
});

test('Firefox drops a grant with any new document in the tab (a reload too), not with a single-page site\'s own moves', () => {
  const g = G.createCaptureGrants({ family: 'firefox' });
  g.grant({ id: 5, url: 'https://x.com/home' });
  g.updated(5, { url: 'https://x.com/explore' });
  assert.strictEqual(g.has(5), true, 'history.pushState: kept');
  g.updated(5, { status: 'loading' });
  assert.strictEqual(g.has(5), false, 'a reload: gone');
});

test('the record, kept in session storage and back (a restarted service worker); a click before it loads wins', () => {
  const g = G.createCaptureGrants();
  g.grant({ id: 5, url: 'https://x.com/' }, 'click');
  const dump = JSON.parse(JSON.stringify(g.dump()));
  const h = G.createCaptureGrants();
  h.grant({ id: 6, url: 'https://y.com/' }, 'shortcut');
  h.load({ ...dump, 6: { origin: 'https://old.example', at: 1, how: 'click' }, nope: {}, 9: null });
  assert.strictEqual(h.has(5, 'https://x.com/a'), true);
  assert.strictEqual(h.has(6, 'https://y.com/'), true, 'not replaced by the older record');
  assert.strictEqual(h.has(9), false);
  h.load(null);
  h.load('junk');
});

test('a screenshot waits for the grant: the click on that tab ends the wait at once; another tab\'s doesn\'t; no click, a timeout', async () => {
  const c = clock();
  const g = G.createCaptureGrants({ now: c.now, setTimer: c.setTimer, clearTimer: c.clearTimer });
  const tab = { id: 5, windowId: 1, url: 'https://x.com/home' };
  let result = null;
  g.wait(tab, { ms: G.GRANT_WAIT_MS, site: 'x.com', shortcut: '⌥⇧S' }).then((r) => { result = r; });
  assert.strictEqual(g.isWaiting(5), true);
  assert.deepStrictEqual(g.waiting(), [{ tabId: 5, windowId: 1, site: 'x.com', shortcut: '⌥⇧S', since: 1000, until: 1000 + G.GRANT_WAIT_MS }]);
  g.grant({ id: 6, url: 'https://x.com/home' });
  c.run(30000);
  await tick();
  assert.strictEqual(result, null, 'another tab\'s click: still waiting');
  assert.strictEqual(g.grant(tab, 'click'), 1, 'the click let one screenshot go on');
  await tick();
  assert.strictEqual(result, 'granted');
  assert.strictEqual(g.isWaiting(5), false);
  assert.strictEqual(c.pending(), 0, 'its timer cleared');
  // no click: after the wait, a timeout, and nothing left waiting
  let late = null;
  g.wait(tab, { ms: G.GRANT_WAIT_MS }).then((r) => { late = r; });
  c.run(G.GRANT_WAIT_MS - 1);
  await tick();
  assert.strictEqual(late, null);
  c.run(1);
  await tick();
  assert.strictEqual(late, 'timeout');
  assert.deepStrictEqual(g.waiting(), []);
  // two at once on a tab: one click lets both go; the tab closing ends a wait
  const r2 = [];
  g.wait(tab, { ms: 1000 }).then((r) => r2.push(r));
  g.wait(tab, { ms: 5000 }).then((r) => r2.push(r));
  assert.strictEqual(g.waiting()[0].until, c.now() + 5000);
  assert.strictEqual(g.grant(tab), 2);
  await tick();
  assert.deepStrictEqual(r2, ['granted', 'granted']);
  let closed = null;
  g.wait(tab, { ms: 1000 }).then((r) => { closed = r; });
  g.removed(5);
  await tick();
  assert.strictEqual(closed, 'closed');
  let cancelled = null;
  g.wait(tab, { ms: 1000 }).then((r) => { cancelled = r; });
  g.cancel(5);
  await tick();
  assert.strictEqual(cancelled, 'cancelled');
  assert.strictEqual(c.pending(), 0);
});

test('the shortcut as the user\'s keyboard says it, and where the robot is', () => {
  assert.strictEqual(G.shortcutText('Alt+Shift+S', true), '⌥⇧S');
  assert.strictEqual(G.shortcutText('Alt+Shift+S', false), 'Alt+Shift+S');
  assert.strictEqual(G.shortcutText('⌥⇧S', true), '⌥⇧S', 'Chrome on a Mac gives it so already');
  assert.strictEqual(G.shortcutText('Ctrl+Shift+Y', true), '⌘⇧Y');
  assert.strictEqual(G.shortcutText('', true), '');
  assert.strictEqual(G.seeTabWhere('Chrome', '⌥⇧S'), "It's at the top right of Chrome, next to the address bar (or in the puzzle-piece menu). Or press ⌥⇧S.");
  assert.strictEqual(G.seeTabWhere('Edge', ''), "It's at the top right of Edge, next to the address bar (or in the puzzle-piece menu).");
  assert.strictEqual(G.originOf('chrome://newtab/'), '');
  assert.strictEqual(G.originOf('https://x.com/a?b'), 'https://x.com');
});
