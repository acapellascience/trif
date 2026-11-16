// ==WebMod==
// @name        E2E Boxed mod with phase-2 powers
// @match       *://127.0.0.1/sandbox.html*
// @boxed
// @powers      site-data, page-data, search-box __SEARCH__
// @run-at      document-start
// ==/WebMod==

// site-data, page-data and search-box (tests/e2e/scenario.js powers2Check). Outcomes: "ok" or "refused".
const R = {};
const out = () => { if (page.root) page.root.setAttr('data-trif-box-pw2', JSON.stringify(R)); };
const t = (name, fn) => { try { const v = fn(); R[name] = 'ok: ' + (typeof v === 'string' ? v : JSON.stringify(v)).slice(0, 120); } catch (e) { R[name] = 'refused: ' + String(e && e.message).slice(0, 160); } out(); };

// site-data: remove (fine), reorder (fine); invent a string, a number, a key, or a string twice (each refused:
// TRIF keeps what the site sent, and says why in trif errors)
trif.filterResponse('*/e2e-api/feed.json*', (d) => { d.items = d.items.filter((i) => !/Promoted/.test(i.text)); return d; });
trif.filterResponse('*/e2e-api/order.json*', (d) => { d.items.reverse(); });
trif.filterResponse('*/e2e-api/invent.json*', (d) => { d.items.push({ id: '9', text: 'invented', url: 'http://localhost:1/e2e-pw-leak' }); return d; });
trif.filterResponse('*/e2e-api/number.json*', (d) => { d.count = 424242; return d; });
trif.filterResponse('*/e2e-api/key.json*', (d) => { d.media_url = d.cursor; return d; });
trif.filterResponse('*/e2e-api/twice.json*', (d) => { d.items.push(d.items[0]); return d; });
trif.filterResponse('*/e2e-api/truncate.json*', (d) => { d.cursor = d.cursor.slice(0, 3); return d; });

const later = () => {
  // page-data
  t('page-data: props', () => page.find('#rx').pageData('props.post'));
  t('page-data: a parent\'s props', () => page.find('#rx').pageData('fiber.return.memoizedProps.user'));
  t('page-data: a bad path (refused)', () => page.find('#rx').pageData('props["post"]'));
  // search-box
  const box = trif.searchBox({ placeholder: 'Search the test site' });
  box.setAttr('id', 'trif-box-pw-search');
  box.style('display', 'block');
  box.style('width', '240px');
  page.find('#title').after(box);
  t('search-box: what\'s inside it', () => box.find('input'));
  t('search-box: its text', () => JSON.stringify(box.text));
  t('search-box: its value (refused)', () => box.value);
  t('search-box: its children', () => box.children.length);
};
let once = false;
trif.observe('#cells', () => { if (!once) { once = true; later(); } });
