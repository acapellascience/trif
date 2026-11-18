// The All mods page (allmods.html): every mod, grouped by site, with its switch, its status and what can be done
// with it, so a user who has built up mods on many sites can see where they're running. The model (grouping,
// search, filters) is allmods-model.js; this draws it and does what its buttons say.
//
// A component: mountAllMods(root, api) builds the whole page inside `root` and talks only to `api`, so the phone's
// All mods list can mount it with an api of its own. The extension's (allmods-page.js) is the background's port:
//   api.request(msg)        the background's messages, as the side panel sends them (status, mod.enable, mod.delete,
//                           mod.restore, mod.trash, mod.export, mod.exportMany, mods.search, mod.code, mod.localCode,
//                           mod.reveal, and the approval card's mod.approve, mod.reject, mod.diff)
//   api.switches()          a promise of {disabled, offSites} (chrome.storage.local's)
//   api.onChange(fn)        fn({status: true}) when the background says something changed, fn({switches}) when the
//                           switches did
//   api.openSite(site)      the site in a tab
//   api.favicons()          a promise of a Map site -> icon address, from what the browser already has (open tabs);
//                           nothing is fetched for it
//   api.sensitive(status)   lib.js sensitiveSites for the status (a sensitive host's own site), optional
//
// Nothing here can get round a hold: a held mod's switch opens the approval card (approval.js, the panel's own),
// and a mod switched on here that then waits for an OK (it adds to what its site's boxed mods can do together)
// opens it too. Switching is the background's mod.enable, with the panel's rules; deleting goes to the trash,
// with Undo, and Recently deleted brings any of the last 30 days' back.

import { el, button, cardRobot, renderCode } from './cards.js';
import { createApproval } from './approval.js';
import { modIcons } from './modlevel.js';
import { iconSvg } from './icons.js';
import { modSwitch, syncSwitches, shownEnabled, switchError, enabledIn, onSwitchChange } from './modswitch.js';
import { GROUP_NAMES } from './lib.js';
import {
  EVERY_SITE, entriesOf, groupEntries, siteStateOf, visibleSections, filterCounts, normalizeFilters, filterCount, NO_FILTERS,
  statusTags, changedWords, siteOfMod,
} from './allmods-model.js';

const CODE_ICON = '<svg class="code-glyph" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.7 4 .9 8l3.8 4M11.3 4l3.8 4-3.8 4M9.3 2.3 6.7 13.7"/></svg>';
const BIN_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 4.5h11M6.5 4.5V2.75h3V4.5M4 4.5l.7 8.75h6.6L12 4.5M6.75 7v4M9.25 7v4"/></svg>';
const EXPORT_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 10V2.5M5 5.2 8 2.2l3 3M3 9.5v3.25c0 .4.3.75.75.75h8.5c.4 0 .75-.35.75-.75V9.5"/></svg>';
const OPEN_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9.5 2.5h4v4M13.5 2.5 7.5 8.5M12 9.5v3.25c0 .4-.35.75-.75.75h-7.5a.75.75 0 0 1-.75-.75v-7.5c0-.4.35-.75.75-.75H7"/></svg>';
const TIER_WORDS = { style: GROUP_NAMES.rules, boxed: GROUP_NAMES.sandboxed, free: GROUP_NAMES.page };
// (one mod's: the approval and code cards' words)
const TIER_ONE = { style: 'Style mod', boxed: 'Boxed mod', free: 'Free mod' };
const STATE_WORDS = { on: 'TRIF on', off: 'TRIF off', blocked: 'Blocked', disconnected: 'Disconnected' };
const STATE_TITLES = {
  on: 'TRIF is on here: its mods that are switched on run.',
  off: 'TRIF is off here: none of these run until you turn it on in the side panel on this site.',
  blocked: 'Blocked in TRIF: none of these run here, and nothing from TRIF touches the site.',
  disconnected: 'TRIF isn\'t connected to this site: none of these run until you connect it in the side panel there.',
};
const HELPER_AWAY = 'TRIF\'s helper isn\'t connected, so it can\'t do this';
const UNDO_MS = 15000;
const POLL_MS = 5000;
const STORE_KEY = 'allmods.filters';

export function mountAllMods(root, api) {
  const doc = root.ownerDocument || document;
  const S = {
    status: null, disabled: {}, offSites: {}, favicons: new Map(),
    query: '', filters: { ...NO_FILTERS }, codeIds: null, codeFor: '',
    selected: new Set(), rows: new Map(), groups: new Map(), sections: [], visible: null,
    trash: null, trashError: null, undo: null, justOn: new Map(), busy: new Set(),
  };
  try { const kept = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); if (kept) { S.filters = normalizeFilters(kept.filters); S.query = String(kept.query || '').slice(0, 200); } } catch { /* none kept */ }
  let labelSeq = 0;
  const connected = () => !!S.status?.helper?.connected;

  // ---- the page's parts ------------------------------------------------------------------------------------
  const bar = el('header', 'am-bar');
  const robot = el('span', 'am-robot');
  robot.id = 'bar-robot'; // (cardRobot copies his frame from here for the cards' headers)
  robot.innerHTML = ROBOT_SVG;
  const title = el('h1', 'am-title', 'All mods');
  const total = el('span', 'am-total');
  bar.append(robot, title, total);

  const away = el('p', 'am-away');
  away.hidden = true;
  away.setAttribute('role', 'status');

  const tools = el('div', 'am-tools');
  tools.setAttribute('role', 'search');
  const search = el('input', 'am-search');
  search.type = 'search';
  search.placeholder = 'Search names, descriptions, sites and code';
  search.setAttribute('aria-label', 'Search mods');
  search.setAttribute('aria-keyshortcuts', '/');
  search.spellcheck = false;
  search.autocomplete = 'off';
  search.value = S.query;
  const filters = el('div', 'am-filters');
  filters.setAttribute('role', 'group');
  filters.setAttribute('aria-label', 'Filters');
  const select = (label, options, value, onChange) => {
    const s = el('select', 'am-select');
    s.setAttribute('aria-label', label);
    for (const [v, text] of options) { const o = el('option', null, text); o.value = v; s.append(o); }
    s.value = value;
    s.addEventListener('change', () => onChange(s.value));
    return s;
  };
  const stateSel = select('On or off', [['all', 'On and off'], ['on', 'On'], ['off', 'Off']], S.filters.state, (v) => setFilter({ state: v }));
  const tierSel = select('Kind', [['all', 'Every kind'], ['style', TIER_WORDS.style], ['boxed', TIER_WORDS.boxed], ['free', TIER_WORDS.free]], S.filters.tier, (v) => setFilter({ tier: v }));
  const toggle = (key, text, hint) => {
    const b = el('button', 'am-chip');
    b.type = 'button';
    b.dataset.filter = key;
    b.title = hint;
    b.append(el('span', 'am-chip-text', text), el('span', 'am-chip-n'));
    b.addEventListener('click', () => setFilter({ [key]: !S.filters[key] }));
    return b;
  };
  const fWaiting = toggle('waiting', 'Waiting for your OK', 'Mods that wait for your OK before they run, or a change to them does');
  const fErrors = toggle('errors', 'Has errors', 'Mods with a recent error, or that may be broken');
  const fSiteOff = toggle('siteOff', 'TRIF off on the site', 'Mods for sites where TRIF is off, blocked or not connected: they don\'t run there');
  const clear = el('button', 'link-btn am-clear', 'Clear filters');
  clear.type = 'button';
  clear.addEventListener('click', () => { S.filters = { ...NO_FILTERS }; stateSel.value = 'all'; tierSel.value = 'all'; S.query = ''; search.value = ''; S.codeIds = null; keep(); render(); });
  filters.append(stateSel, tierSel, fWaiting, fErrors, fSiteOff, clear);
  tools.append(search, filters);

  const selBar = el('div', 'am-selbar');
  selBar.setAttribute('role', 'region');
  selBar.setAttribute('aria-label', 'Selected mods');
  selBar.hidden = true;
  const selCount = el('span', 'am-sel-count');
  const bOff = button('Turn off', 'am-bulk-off', () => bulkOff());
  const bExport = button('Export', 'am-bulk-export', () => bulkExport());
  const bDelete = button('Delete', 'am-bulk-delete', () => bulkDelete());
  const bNone = el('button', 'link-btn am-sel-none', 'Select none');
  bNone.type = 'button';
  bNone.addEventListener('click', () => { S.selected.clear(); render(); });
  selBar.append(selCount, bOff, bExport, bDelete, bNone);

  const line = el('p', 'am-line');
  const shownText = el('span', 'am-shown');
  shownText.setAttribute('role', 'status');
  const selAll = el('button', 'link-btn am-sel-all');
  selAll.type = 'button';
  selAll.addEventListener('click', () => { for (const e of visibleEntries()) S.selected.add(e.id); render(); });
  line.append(shownText, selAll);

  const msg = el('p', 'am-msg');
  msg.hidden = true;
  msg.setAttribute('role', 'status');

  const list = el('div', 'am-sections');
  const empty = el('p', 'am-empty');
  empty.hidden = true;
  const loading = el('p', 'am-empty', 'Loading mods…');

  const deleted = el('details', 'am-deleted');
  const delSummary = el('summary', 'am-deleted-head');
  delSummary.append(el('span', null, 'Recently deleted'), el('span', 'count am-deleted-n'));
  const trashList = el('ul', 'am-trash');
  const trashNote = el('p', 'note am-trash-note', 'Deleted mods stay here for 30 days.');
  deleted.append(delSummary, trashList, trashNote);
  deleted.addEventListener('toggle', () => { if (deleted.open) loadTrash(); });

  const toast = el('div', 'am-toast');
  toast.hidden = true;
  toast.setAttribute('role', 'status');
  const toastText = el('span', 'am-toast-text');
  const toastUndo = button('Undo', 'am-undo', () => runUndo());
  toast.append(toastText, toastUndo);

  const live = el('p', 'visually-hidden');
  live.setAttribute('aria-live', 'polite');

  const main = el('main', 'am-main');
  main.append(away, tools, selBar, line, msg, loading, empty, list, deleted);
  root.replaceChildren(bar, main, toast, live);

  // ---- the approval card (approval.js): the panel's, for every hold on the page --------------------------
  const holds = createApproval({
    request: api.request,
    openCode: (id) => openCode(id),
    tabId: () => undefined,
    site: (m) => siteOfMod(m),
    changed: () => {},
  });

  // ---- data ------------------------------------------------------------------------------------------------
  async function refresh() {
    try {
      const [status, sw] = await Promise.all([api.request({ type: 'status' }), api.switches()]);
      S.status = status;
      S.disabled = status?.storageBroken ? status.disabled || {} : sw?.disabled || {};
      S.offSites = status?.storageBroken ? status.offSites || {} : sw?.offSites || {};
      loading.hidden = true;
    } catch (e) {
      loading.textContent = `Couldn’t load the mods: ${e?.message ?? e}`;
      return;
    }
    render();
    if (deleted.open || S.trash === null) loadTrash();
  }
  let refreshTimer = null;
  const refreshSoon = () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 150); };

  async function loadTrash() {
    if (!connected()) { S.trash = []; S.trashError = HELPER_AWAY; renderTrash(); return; }
    try { S.trash = (await api.request({ type: 'mod.trash' }))?.trash || []; S.trashError = null; } catch (e) { S.trash = S.trash || []; S.trashError = String(e?.message ?? e); }
    renderTrash();
  }

  // The code search: the background has the code (mods.search), asked once the typing stops.
  let searchTimer = null;
  search.addEventListener('input', () => {
    S.query = search.value.slice(0, 200);
    keep();
    render();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(searchCode, 200);
  });
  search.addEventListener('keydown', (e) => { if (e.key === 'Escape' && search.value) { e.preventDefault(); e.stopPropagation(); search.value = ''; search.dispatchEvent(new Event('input')); } });
  async function searchCode() {
    const q = S.query.trim();
    if (!q) { S.codeIds = null; S.codeFor = ''; render(); return; }
    if (S.codeFor === q) return;
    try {
      const r = await api.request({ type: 'mods.search', text: q });
      if (S.query.trim() !== q) return;
      S.codeIds = new Set(r?.ids || []);
      S.codeFor = q;
      render();
    } catch { /* the names and descriptions still match */ }
  }
  doc.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (doc.querySelector('dialog[open]')) return;
    e.preventDefault();
    search.focus();
    search.select();
  });

  function setFilter(patch) {
    S.filters = normalizeFilters({ ...S.filters, ...patch });
    keep();
    render();
  }
  function keep() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ filters: S.filters, query: S.query })); } catch { /* this time only */ }
  }

  // ---- rendering -------------------------------------------------------------------------------------------
  const sens = () => { try { return api.sensitive ? api.sensitive(S.status) : null; } catch { return null; } };
  const siteName = (site) => (S.status?.starter?.sites || []).find((x) => x.site === site)?.name || '';
  const isOn = (id) => enabledIn(S.disabled, id);
  const visibleEntries = () => (S.visible?.sections || []).flatMap((s) => s.groups.flatMap((g) => g.entries));

  function render() {
    if (!S.status) return;
    const model = sens();
    const stateOf = (site) => siteStateOf(site, S.status, model ? (s) => model.scopeOf(s) : undefined);
    const entries = entriesOf(S.status.mods, { disabled: S.disabled, offSites: S.offSites });
    const byId = new Map(entries.map((e) => [e.id, e]));
    for (const id of [...S.selected]) if (!byId.has(id)) S.selected.delete(id);
    S.sections = groupEntries(entries, { stateOf });
    S.visible = visibleSections(S.sections, { query: S.query, filters: S.filters, siteName, codeIds: S.codeIds });
    const shown = new Set(visibleEntries().map((e) => e.id));

    // the approval card: every hold, in the page's order; one opens by itself only for a mod switched on here
    const order = S.sections.flatMap((s) => s.groups.flatMap((g) => g.entries));
    const now = Date.now();
    for (const [id, at] of S.justOn) if (now - at > 60000) S.justOn.delete(id);
    holds.updateApprovals(order.filter((e) => e.waiting).map((e) => e.mod), { opens: (m) => (m.group || [m]).some((x) => S.justOn.has(x.id)) });

    // the head: how many mods, on how many sites
    const sites = new Set(entries.filter((e) => !e.every).map((e) => e.site));
    total.textContent = entries.length ? `${entries.length} ${entries.length === 1 ? 'mod' : 'mods'} · ${sites.size} ${sites.size === 1 ? 'site' : 'sites'}` : '';
    away.hidden = connected();
    away.textContent = 'TRIF’s helper isn’t connected: switches work, but deleting, exporting and Recently deleted wait for it.';

    // the filters' counts and states
    const counts = filterCounts(S.sections);
    for (const [b, key] of [[fWaiting, 'waiting'], [fErrors, 'errors'], [fSiteOff, 'siteOff']]) {
      b.setAttribute('aria-pressed', String(!!S.filters[key]));
      b.querySelector('.am-chip-n').textContent = String(counts[key]);
      b.classList.toggle('none', !counts[key] && !S.filters[key]);
    }
    clear.hidden = !filterCount(S.filters) && !S.query;

    // the sections, groups and rows: each built once, rebuilt only when what it shows changes
    const want = [];
    const keepRows = new Map();
    for (const s of S.sections) {
      if (s.key === 'phone') want.push(sectionHead());
      for (const g of s.groups) {
        const gel = groupEl(g);
        want.push(gel);
        const rowsWant = [];
        for (const e of g.entries) {
          const key = rowKey(e, g);
          const old = S.rows.get(e.id);
          const row = old && old.key === key ? old : { key, li: rowEl(e, g) };
          keepRows.set(e.id, row);
          row.li.hidden = !shown.has(e.id);
          updateRow(row.li, e);
          rowsWant.push(row.li);
        }
        const ul = gel.querySelector('.am-list');
        rowsWant.forEach((li, i) => { if (ul.children[i] !== li) ul.insertBefore(li, ul.children[i] || null); });
        while (ul.children.length > rowsWant.length) ul.lastElementChild.remove();
        updateGroup(gel, g, shown);
      }
    }
    S.rows = keepRows;
    want.forEach((n, i) => { if (list.children[i] !== n) list.insertBefore(n, list.children[i] || null); });
    while (list.children.length > want.length) list.lastElementChild.remove();
    for (const k of [...S.groups.keys()]) if (!S.sections.some((s) => s.groups.some((g) => g.key === k))) S.groups.delete(k);
    syncSwitches(list, (id) => isOn(id));

    const n = S.visible.shown;
    const filtered = filterCount(S.filters) || S.query.trim();
    empty.hidden = !!n || !S.status;
    empty.textContent = entries.length ? 'No mods match. Clear the filters to see them all.' : 'No mods yet. Open a site and tell your coding agent what to fix: its mods show up here.';
    shownText.textContent = filtered ? `Showing ${n} of ${entries.length}` : entries.length ? `${entries.length} ${entries.length === 1 ? 'mod' : 'mods'}` : '';
    const unpicked = visibleEntries().filter((e) => !S.selected.has(e.id)).length;
    selAll.hidden = !n || !unpicked;
    selAll.textContent = filtered ? `Select these ${n}` : 'Select all';
    renderSelection();
  }

  let phoneHead = null;
  function sectionHead() {
    if (phoneHead) return phoneHead;
    phoneHead = el('div', 'am-section-head');
    const h = el('h2', 'am-section-title', 'Phone mods');
    phoneHead.append(h, el('p', 'note', 'These run only in the phone view (Edit for mobile in the side panel), on the site they’re for.'));
    return phoneHead;
  }

  function groupEl(g) {
    let sec = S.groups.get(g.key);
    if (sec) return sec;
    sec = el('section', 'am-group');
    sec.dataset.key = g.key;
    const id = `am-g-${++labelSeq}`;
    sec.setAttribute('aria-labelledby', id);
    const head = el('div', 'am-ghead');
    const check = el('input', 'am-check am-gcheck');
    check.type = 'checkbox';
    check.addEventListener('change', () => {
      const ids = (S.visible?.sections || []).flatMap((s) => s.groups).find((x) => x.key === g.key)?.entries.map((e) => e.id) || [];
      for (const x of ids) { if (check.checked) S.selected.add(x); else S.selected.delete(x); }
      render();
    });
    const fav = el('span', 'am-fav');
    fav.setAttribute('aria-hidden', 'true');
    const name = el('h2', 'am-gname');
    name.id = id;
    const state = el('span', 'am-state');
    const count = el('span', 'am-gcount');
    head.append(check, fav, name, state, count);
    if (!g.every) {
      const open = el('button', 'btn am-open');
      open.type = 'button';
      open.innerHTML = OPEN_ICON;
      open.append(el('span', null, `Open ${g.site}`));
      open.addEventListener('click', () => api.openSite(g.site));
      head.append(open);
    }
    const ul = el('ul', 'mod-list am-list');
    sec.append(head, ul);
    S.groups.set(g.key, sec);
    return sec;
  }

  function updateGroup(sec, g, shown) {
    const visible = g.entries.filter((e) => shown.has(e.id));
    sec.hidden = !visible.length;
    const name = sec.querySelector('.am-gname');
    const friendly = g.every ? 'Every site' : siteName(g.site);
    const nameKey = `${friendly}|${g.site}`;
    if (name.dataset.k !== nameKey) {
      name.dataset.k = nameKey;
      name.replaceChildren(el('span', 'am-gname-text', friendly || g.site));
      if (friendly && !g.every && friendly.toLowerCase() !== g.site) name.append(el('span', 'am-host', g.site));
    }
    const fav = sec.querySelector('.am-fav');
    const icon = g.every ? null : S.favicons.get(g.site);
    if (fav.dataset.src !== (icon || '')) {
      fav.dataset.src = icon || '';
      fav.replaceChildren();
      fav.classList.toggle('every', g.every);
      if (g.every) fav.innerHTML = '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c1.8 1.7 2.6 3.7 2.6 6S9.8 12.3 8 14C6.2 12.3 5.4 10.3 5.4 8S6.2 3.7 8 2z"/></svg>';
      else if (icon) {
        const img = el('img');
        img.alt = '';
        img.referrerPolicy = 'no-referrer';
        img.decoding = 'async';
        img.addEventListener('error', () => { fav.replaceChildren(letterOf(g.site)); fav.dataset.src = 'failed'; });
        img.src = icon;
        fav.append(img);
      } else fav.append(letterOf(g.site));
    }
    const state = sec.querySelector('.am-state');
    state.hidden = !g.state;
    if (g.state) {
      state.className = `am-state ${g.state}`;
      state.textContent = STATE_WORDS[g.state] || g.state;
      state.title = STATE_TITLES[g.state] || '';
    }
    sec.classList.toggle('site-off', !!g.state && g.state !== 'on');
    const on = g.entries.filter((e) => e.on).length;
    sec.querySelector('.am-gcount').textContent = `${on} of ${g.entries.length} on`;
    const check = sec.querySelector('.am-gcheck');
    const picked = visible.filter((e) => S.selected.has(e.id)).length;
    check.checked = !!visible.length && picked === visible.length;
    check.indeterminate = picked > 0 && picked < visible.length;
    check.setAttribute('aria-label', `Select the ${visible.length === 1 ? 'mod' : `${visible.length} mods`} for ${g.every ? 'every site' : g.site}${g.phone ? ' (phone)' : ''}`);
  }

  const letterOf = (site) => {
    const s = el('span', 'am-letter', (String(site).replace(/^www\./, '')[0] || '?').toUpperCase());
    return s;
  };

  // A row's structure changes only with these; everything else (its switch, selection, hidden) updates in place.
  const rowKey = (e, g) => JSON.stringify([e.name, e.description, e.tier, e.held, e.mod.held?.by || null, e.pending, e.errors, e.quiet, e.clickjack, e.updated, e.update, e.isNew,
    e.changedAt, e.offOn, e.mod.powers || null, e.mod.found || null, e.mod.risk || null, g.state, connected(), e.mod.broken?.[0]?.message || null]);

  function rowEl(e, g) {
    const li = el('li', 'am-row');
    li.dataset.mod = e.id;
    const labelId = `am-m-${++labelSeq}`;
    const row = el('div', 'am-mod');
    const check = el('input', 'am-check');
    check.type = 'checkbox';
    check.setAttribute('aria-label', `Select ${e.name}`);
    check.addEventListener('change', () => { if (check.checked) S.selected.add(e.id); else S.selected.delete(e.id); render(); });

    const mainBox = el('div', 'mod-main am-main-col');
    const light = el('span', 'light');
    const name = el('h3', 'mod-name');
    const label = el('span', 'am-name', e.name);
    label.id = labelId;
    name.append(label);
    // the icons, as the panel's row has them (modlevel.js modIcons): a click shows the code
    const icons = modIcons(e.mod, g.every ? 'the site' : g.site);
    if (icons.length) {
      const box = el('button', 'mod-icons');
      box.type = 'button';
      box.setAttribute('aria-label', [TIER_ONE[e.tier], ...icons.map((i) => i.title)].join('\n'));
      box.setAttribute('aria-describedby', labelId);
      icons.forEach((i, n) => {
        if (n && i.level && !icons[n - 1].level) box.append(el('span', 'mod-ic-sep'));
        const ic = el('span', `mod-ic ${i.tone}`);
        ic.title = i.title;
        const svgs = (i.keys || [i.key]).map(iconSvg).filter(Boolean);
        if (svgs.length) ic.append(...svgs); else ic.textContent = i.key;
        box.append(ic);
      });
      box.addEventListener('click', () => openCode(e.id));
      name.append(box);
    }
    // the tier, in words (the panel's rows sit under their tier's heading; these don't)
    const tier = el('span', `am-tier ${e.tier}`, TIER_ONE[e.tier]);
    name.append(tier);
    for (const t of statusTags(e)) {
      if (t.key === 'waiting') { const b = holds.holdTag(e.mod, t.text, labelId); b.classList.add('am-tag'); name.append(b); continue; }
      if (t.key === 'errors') {
        const first = (e.mod.broken || []).filter((b) => !b.quiet)[0] || e.mod.broken?.[0];
        const b = el('button', 'tag err-badge am-tag', t.text);
        b.type = 'button';
        b.title = first?.quiet ? 'May be broken: nothing it looks for is on the page any more.' : first?.clickjack ? String(first.message || '') : `New error${first?.line ? ` at line ${first.line}` : ''}: ${first?.message || ''}`;
        b.setAttribute('aria-describedby', labelId);
        b.addEventListener('click', () => openCode(e.id, { error: first }));
        name.append(b);
        continue;
      }
      const tag = el('span', `tag am-tag am-tag-${t.key}`, t.text);
      if (t.key === 'updated') tag.title = 'TRIF updated it from Tim’s mods and switched it off: switch it on once you’ve looked at it.';
      if (t.key === 'update') tag.title = 'A new version from TRIF is waiting: the side panel on its site offers it.';
      if (t.key === 'new') tag.title = 'It came from outside your chat, so TRIF switched it off: switch it on once you’ve looked at it.';
      name.append(tag);
    }
    mainBox.append(light, name);

    const desc = el('div', 'mod-desc am-desc', e.description);
    if (e.description) desc.title = e.description;
    const meta = el('div', 'am-meta');
    const when = changedWords(e.changedAt);
    if (when) {
      const t = el('time', 'am-when', `Changed ${when}`);
      t.dateTime = new Date(e.changedAt).toISOString();
      t.title = new Date(e.changedAt).toLocaleString();
      meta.append(t);
    }
    if (e.offOn.length) meta.append(el('span', 'am-offon', `off on ${e.offOn.slice(0, 2).join(', ')}${e.offOn.length > 2 ? ` and ${e.offOn.length - 2} more` : ''}`));

    const right = el('div', 'am-right');
    right.append(switchFor(e, labelId));

    const acts = el('div', 'mod-tools am-acts');
    const iconBtn = (cls, svg, text, fn, needsHelper = false) => {
      const b = el('button', `icon-btn ${cls}`);
      b.type = 'button';
      b.innerHTML = svg;
      b.title = needsHelper && !connected() ? HELPER_AWAY : text;
      b.setAttribute('aria-label', text);
      b.setAttribute('aria-describedby', labelId);
      b.disabled = needsHelper && !connected();
      b.addEventListener('click', fn);
      return b;
    };
    acts.append(
      iconBtn('mod-code', CODE_ICON, 'Show code', () => openCode(e.id)),
      iconBtn('am-export', EXPORT_ICON, 'Export', () => exportOne(e), true),
      iconBtn('mod-delete', BIN_ICON, 'Delete', () => deleteMods([e.id]), true),
    );
    const err = el('div', 'mod-err am-err');
    err.hidden = true;
    row.append(check, mainBox, desc, meta, acts, right);
    li.append(row, err);
    return li;
  }

  function switchFor(e, labelId) {
    // Held (not for being switched on): the switch shows off, as it isn't running, and opens the approval card.
    if (e.held && e.mod.held?.by !== 'switch') {
      const b = el('button', 'switch am-held-switch');
      b.type = 'button';
      b.setAttribute('role', 'switch');
      b.setAttribute('aria-checked', 'false');
      b.setAttribute('aria-labelledby', labelId);
      b.setAttribute('aria-haspopup', 'dialog');
      b.title = 'Waiting for your OK: switch it on to see what it can do, and allow it';
      const knob = el('span', 'knob');
      knob.setAttribute('aria-hidden', 'true');
      b.append(knob);
      b.addEventListener('click', () => holds.openApproval(e.id));
      return b;
    }
    return modSwitch(doc, {
      id: e.id, enabled: isOn(e.id), labelId,
      apply: async (id, enabled) => {
        if (enabled) S.justOn.set(id, Date.now());
        const r = await api.request({ type: 'mod.enable', id, enabled });
        refreshSoon();
        return r;
      },
    });
  }

  function updateRow(li, e) {
    const on = shownEnabled(e.id, isOn(e.id)) && !e.held;
    li.classList.toggle('off', !on);
    li.classList.toggle('held', e.held);
    li.classList.toggle('picked', S.selected.has(e.id));
    li.querySelector('.light').classList.toggle('on', on);
    const check = li.querySelector('.am-check');
    check.checked = S.selected.has(e.id);
    const err = li.querySelector('.am-err');
    const why = switchError(e.id) || rowErrors.get(e.id)?.message || '';
    err.textContent = why;
    err.hidden = !why;
    const busy = S.busy.has(e.id);
    li.classList.toggle('busy', busy);
    for (const b of li.querySelectorAll('.am-acts button')) if (b.classList.contains('am-export') || b.classList.contains('mod-delete')) b.disabled = busy || !connected();
  }

  const rowErrors = new Map();
  function rowError(id, message) {
    const old = rowErrors.get(id);
    if (old) clearTimeout(old.timer);
    rowErrors.set(id, { message, timer: setTimeout(() => { rowErrors.delete(id); render(); }, 10000) });
    render();
  }
  onSwitchChange(() => render());

  function renderSelection() {
    const n = S.selected.size;
    selBar.hidden = !n;
    selCount.textContent = `${n} selected`;
    const anyOn = [...S.selected].some((id) => isOn(id));
    bOff.disabled = !anyOn;
    bOff.title = anyOn ? '' : 'None of them is on';
    for (const b of [bExport, bDelete]) { b.disabled = !n || !connected(); b.title = connected() ? '' : HELPER_AWAY; }
  }

  function say(text, { error = false } = {}) {
    msg.textContent = text;
    msg.classList.toggle('error', error);
    msg.hidden = !text;
    live.textContent = text;
  }

  // ---- actions ---------------------------------------------------------------------------------------------
  function showUndo(text, undo) {
    clearTimeout(S.undo?.timer);
    S.undo = { undo, timer: setTimeout(hideUndo, UNDO_MS) };
    toastText.textContent = text;
    toast.hidden = false;
    toastUndo.disabled = false;
    live.textContent = `${text} Undo is in the bar at the bottom.`;
  }
  function hideUndo() { clearTimeout(S.undo?.timer); S.undo = null; toast.hidden = true; }
  async function runUndo() {
    const u = S.undo;
    if (!u) return;
    toastUndo.disabled = true;
    try { await u.undo(); hideUndo(); } catch (e) { toastText.textContent = `Couldn’t undo it: ${e?.message ?? e}`; toastUndo.disabled = false; }
  }

  const nameOf = (id) => S.status?.mods?.find((m) => m.id === id)?.name || id;
  const plural = (n, one, many) => (n === 1 ? one : many.replace('{n}', n));

  async function deleteMods(ids) {
    const done = [];
    const names0 = new Map(ids.map((id) => [id, nameOf(id)])); // (before they're gone from the status)
    say('');
    for (const id of ids) {
      S.busy.add(id);
      render();
      try { await api.request({ type: 'mod.delete', id }); done.push(id); S.selected.delete(id); } catch (e) { rowError(id, `Couldn’t delete it: ${e?.message ?? e}`); }
      S.busy.delete(id);
    }
    await refresh();
    loadTrash();
    if (!done.length) return;
    const names = done.map((id) => names0.get(id));
    showUndo(done.length === 1 ? `Deleted ${names[0]}.` : `Deleted ${done.length} mods.`, async () => {
      const failed = [];
      for (const id of done) { try { await api.request({ type: 'mod.restore', id }); } catch (e) { failed.push(`${id}: ${e?.message ?? e}`); } }
      await refresh();
      loadTrash();
      if (failed.length) throw new Error(failed.join('; '));
      say(done.length === 1 ? `${names[0]} is back.` : `${done.length} mods are back.`);
    });
  }

  async function bulkOff() {
    const ids = [...S.selected].filter((id) => isOn(id));
    const done = [];
    for (const id of ids) {
      try { await api.request({ type: 'mod.enable', id, enabled: false }); done.push(id); } catch (e) { rowError(id, `Couldn’t switch it off: ${e?.message ?? e}`); }
    }
    await refresh();
    if (!done.length) return;
    showUndo(plural(done.length, `Turned off ${nameOf(done[0])}.`, 'Turned off {n} mods.'), async () => {
      for (const id of done) { S.justOn.set(id, Date.now()); await api.request({ type: 'mod.enable', id, enabled: true }); }
      await refresh();
    });
  }

  async function exportOne(e) {
    say('');
    S.busy.add(e.id);
    render();
    try {
      const r = await api.request({ type: 'mod.export', id: e.id });
      if (!r?.cancelled) say(`Exported ${e.name} to ${r.where} as ${r.file}.`);
    } catch (x) { say(`Couldn’t export ${e.name}: ${x?.message ?? x}`, { error: true }); }
    S.busy.delete(e.id);
    render();
  }

  async function bulkExport() {
    const ids = [...S.selected];
    if (!ids.length) return;
    say('');
    bExport.disabled = true;
    try {
      const r = await api.request({ type: 'mod.exportMany', ids });
      if (!r?.cancelled) say(`Exported ${plural(r.ids.length, 'one mod', '{n} mods')} to ${r.where}, in the folder ${r.dir}.`);
    } catch (x) { say(`Couldn’t export them: ${x?.message ?? x}`, { error: true }); }
    renderSelection();
  }

  async function bulkDelete() {
    const ids = [...S.selected];
    if (ids.length) await deleteMods(ids);
  }

  // ---- Recently deleted ------------------------------------------------------------------------------------
  function renderTrash() {
    const items = S.trash || [];
    deleted.querySelector('.am-deleted-n').textContent = items.length ? `(${items.length})` : '';
    deleted.hidden = !connected() && !items.length;
    const rows = items.map((t) => {
      const li = el('li', 'am-trash-row');
      li.dataset.mod = t.id;
      const words = el('div', 'am-trash-words');
      const nm = el('span', 'am-trash-name', t.name || t.id);
      words.append(nm, el('span', 'am-trash-where', `${t.id.split('/')[0] === EVERY_SITE ? 'Every site' : t.id.split('/')[0]} · deleted ${changedWords(t.deletedAt)}`));
      if (t.description) words.append(el('span', 'am-trash-desc', t.description));
      const b = button('Restore', 'am-restore', async () => {
        b.disabled = true;
        try {
          await api.request({ type: 'mod.restore', id: t.id });
          say(`${t.name || t.id} is back.`);
          await refresh();
          loadTrash();
        } catch (e) { b.disabled = false; say(`Couldn’t restore ${t.name || t.id}: ${e?.message ?? e}`, { error: true }); }
      });
      b.setAttribute('aria-label', `Restore ${t.name || t.id}`);
      if (t.exists) { b.disabled = true; b.title = 'A mod with this name is in its folder again: rename or delete that one first'; }
      li.append(words, b);
      return li;
    });
    if (S.trashError && connected()) rows.unshift(el('li', 'mod-err', S.trashError));
    if (!rows.length) rows.push(el('li', 'note', 'Nothing deleted lately.'));
    trashList.replaceChildren(...rows);
  }

  // ---- the code, read-only (the side panel's code card has the rest: Edit, History) --------------------------
  const code = { dialog: null, parts: null, id: null };
  function codeDialog() {
    if (code.dialog) return code.parts;
    const d = el('dialog', 'approval code-view am-code');
    d.id = 'am-code';
    d.setAttribute('aria-labelledby', 'am-code-name');
    const top = el('div', 'ap-top');
    const x = el('button', 'ap-x', '×');
    x.type = 'button';
    x.title = 'Close';
    x.setAttribute('aria-label', 'Close');
    x.addEventListener('click', () => d.close());
    top.append(el('span', 'ap-count', 'Code'), x);
    const who = el('div', 'ap-who');
    const r = el('span', 'ap-robot');
    r.append(cardRobot('code'));
    const nameBox = el('div');
    const name = el('h2', 'ap-name');
    name.id = 'am-code-name';
    const where = el('div', 'ap-meta');
    nameBox.append(name, where);
    who.append(r, nameBox);
    const errorBox = el('div', 'ap-together cv-error');
    errorBox.hidden = true;
    const box = el('pre', 'cv-code wrap');
    box.tabIndex = 0;
    box.setAttribute('aria-label', 'The mod\'s code');
    const note = el('p', 'ap-note cv-note');
    note.hidden = true;
    const err = el('p', 'ap-err');
    err.setAttribute('role', 'alert');
    err.hidden = true;
    const copy = button('Copy', 'cv-copy', async () => {
      try { await navigator.clipboard.writeText(code.text || ''); copy.textContent = 'Copied'; setTimeout(() => { copy.textContent = 'Copy'; }, 1500); } catch (e) { err.textContent = String(e?.message ?? e); err.hidden = false; }
    });
    const reveal = button(/Mac/i.test(navigator.userAgentData?.platform || navigator.platform || '') ? 'Show in Finder' : 'Show in folder', 'cv-reveal', () => revealCode('folder'));
    const editor = button('Open in editor', 'cv-editor', () => revealCode('editor'));
    const close = button('Close', 'text', () => d.close());
    const acts = el('div', 'ap-actions');
    acts.append(copy, reveal, editor, close);
    d.append(top, who, errorBox, box, note, err, acts);
    d.addEventListener('click', (ev) => { if (ev.target === d) d.close(); });
    doc.body.append(d);
    code.dialog = d;
    code.parts = { name, where, errorBox, box, note, err, copy, reveal, editor };
    return code.parts;
  }
  async function revealCode(how) {
    const P = code.parts;
    P.err.hidden = true;
    try { await api.request({ type: 'mod.reveal', id: code.id, how }); } catch (e) { P.err.textContent = String(e?.message ?? e); P.err.hidden = false; }
  }
  async function openCode(id, { error = null } = {}) {
    const m = S.status?.mods?.find((x) => x.id === id);
    if (!m) return;
    const P = codeDialog();
    code.id = id;
    code.text = '';
    code.dialog.dataset.group = m.rules ? 'rules' : m.sandboxed ? 'sandboxed' : 'page';
    P.name.textContent = m.name || m.id;
    const file = String(m.file || '').split(/[\\/]/).pop() || `${id.split('/').pop()}.js`;
    const site = id.split('/')[0];
    P.where.replaceChildren(`${site === EVERY_SITE ? 'Every site' : site} · ${file}`);
    P.errorBox.hidden = !error;
    P.errorBox.replaceChildren();
    if (error) P.errorBox.append(el('b', null, error.quiet ? 'May be broken: ' : `New error${error.line ? ` at line ${error.line}` : ''}: `), error.quiet ? 'nothing it looks for is on the page any more.' : String(error.message || ''));
    for (const b of [P.reveal, P.editor]) { b.disabled = !connected(); b.title = connected() ? '' : HELPER_AWAY; }
    P.box.replaceChildren();
    P.note.hidden = true;
    P.err.hidden = true;
    if (!code.dialog.open) code.dialog.showModal();
    let r;
    try { r = await api.request({ type: 'mod.code', id }); } catch (e) {
      try { r = await api.request({ type: 'mod.localCode', id }); } catch { r = null; }
      if (!r) { P.err.textContent = String(e?.message ?? e); P.err.hidden = false; return; }
    }
    if (code.id !== id) return;
    code.text = String(r.code ?? '');
    renderCode(P.box, code.text);
    const at = error?.line ? P.box.children[error.line - 1] : null;
    if (at) { at.classList.add('hl'); at.scrollIntoView({ block: 'center' }); }
    if (r.truncated || r.local) { P.note.textContent = r.truncated ? 'Showing the first 200,000 characters.' : 'From the browser: TRIF\'s helper isn\'t connected.'; P.note.hidden = false; }
  }

  // ---- start -----------------------------------------------------------------------------------------------
  api.onChange?.((what) => {
    if (what?.switches) {
      if ('disabled' in what.switches) S.disabled = what.switches.disabled || {};
      if ('offSites' in what.switches) S.offSites = what.switches.offSites || {};
      render();
    } else refreshSoon();
  });
  api.favicons?.().then((m) => { if (m instanceof Map) { S.favicons = m; render(); } }).catch(() => {});
  const poll = setInterval(() => { if (!doc.hidden) refresh(); }, POLL_MS);
  doc.addEventListener('visibilitychange', () => { if (!doc.hidden) refresh(); });
  refresh();
  return { refresh, state: S, stop: () => clearInterval(poll), openCode };
}

// The robot (sidepanel.html's #bar-robot), his frame, face and eyes: the page's mark, and what cardRobot copies.
const ROBOT_SVG = '<svg viewBox="0 0 128 128" aria-hidden="true"><polygon class="rim" points="120,64 119.8,75.9 119.3,82.8 118.4,88.6 117.1,93.5 115.5,97.9 113.5,101.8 111.2,105.3 108.4,108.4 105.3,111.2 101.8,113.5 97.9,115.5 93.5,117.1 88.6,118.4 82.8,119.3 75.9,119.8 64,120 52.1,119.8 45.2,119.3 39.4,118.4 34.5,117.1 30.1,115.5 26.2,113.5 22.7,111.2 19.6,108.4 16.8,105.3 14.5,101.8 12.5,97.9 10.9,93.5 9.6,88.6 8.7,82.8 8.2,75.9 8,64 8.2,52.1 8.7,45.2 9.6,39.4 10.9,34.5 12.5,30.1 14.5,26.2 16.8,22.7 19.6,19.6 22.7,16.8 26.2,14.5 30.1,12.5 34.5,10.9 39.4,9.6 45.2,8.7 52.1,8.2 64,8 75.9,8.2 82.8,8.7 88.6,9.6 93.5,10.9 97.9,12.5 101.8,14.5 105.3,16.8 108.4,19.6 111.2,22.7 113.5,26.2 115.5,30.1 117.1,34.5 118.4,39.4 119.3,45.2 119.8,52.1"/><polygon class="face" points="110,64 109.9,73.8 109.4,79.5 108.7,84.2 107.6,88.2 106.3,91.9 104.7,95.1 102.7,98 100.5,100.5 98,102.7 95.1,104.7 91.9,106.3 88.2,107.6 84.2,108.7 79.5,109.4 73.8,109.9 64,110 54.2,109.9 48.5,109.4 43.8,108.7 39.8,107.6 36.1,106.3 32.9,104.7 30,102.7 27.5,100.5 25.3,98 23.3,95.1 21.7,91.9 20.4,88.2 19.3,84.2 18.6,79.5 18.1,73.8 18,64 18.1,54.2 18.6,48.5 19.3,43.8 20.4,39.8 21.7,36.1 23.3,32.9 25.3,30 27.5,27.5 30,25.3 32.9,23.3 36.1,21.7 39.8,20.4 43.8,19.3 48.5,18.6 54.2,18.1 64,18 73.8,18.1 79.5,18.6 84.2,19.3 88.2,20.4 91.9,21.7 95.1,23.3 98,25.3 100.5,27.5 102.7,30 104.7,32.9 106.3,36.1 107.6,39.8 108.7,43.8 109.4,48.5 109.9,54.2"/><polygon class="eye" points="57.4,63 57.3,64.8 57.1,66.2 56.9,67.5 56.5,68.8 56.1,69.9 55.5,71 54.9,72 54.1,72.8 53.3,73.6 52.4,74.3 51.4,74.9 50.4,75.4 49.2,75.8 48,76.1 46.6,76.2 45,76.3 43.4,76.2 42,76.1 40.8,75.8 39.6,75.4 38.6,74.9 37.6,74.3 36.7,73.6 35.9,72.8 35.1,72 34.5,71 33.9,69.9 33.5,68.8 33.1,67.5 32.9,66.2 32.7,64.8 32.6,63 32.7,61.2 32.9,59.8 33.1,58.5 33.5,57.2 33.9,56.1 34.5,55 35.1,54 35.9,53.2 36.7,52.4 37.6,51.7 38.6,51.1 39.6,50.6 40.8,50.2 42,49.9 43.4,49.8 45,49.7 46.6,49.8 48,49.9 49.2,50.2 50.4,50.6 51.4,51.1 52.4,51.7 53.3,52.4 54.1,53.2 54.9,54 55.5,55 56.1,56.1 56.5,57.2 56.9,58.5 57.1,59.8 57.3,61.2"/><polygon class="eye" points="95.3,63 95.3,64.8 95.1,66.2 94.9,67.5 94.5,68.8 94.1,69.9 93.5,71 92.9,72 92.1,72.8 91.3,73.6 90.4,74.3 89.4,74.9 88.4,75.4 87.2,75.8 86,76.1 84.6,76.2 83,76.3 81.4,76.2 80,76.1 78.8,75.8 77.6,75.4 76.6,74.9 75.6,74.3 74.7,73.6 73.9,72.8 73.1,72 72.5,71 71.9,69.9 71.5,68.8 71.1,67.5 70.9,66.2 70.7,64.8 70.7,63 70.7,61.2 70.9,59.8 71.1,58.5 71.5,57.2 71.9,56.1 72.5,55 73.1,54 73.9,53.2 74.7,52.4 75.6,51.7 76.6,51.1 77.6,50.6 78.8,50.2 80,49.9 81.4,49.8 83,49.7 84.6,49.8 86,49.9 87.2,50.2 88.4,50.6 89.4,51.1 90.4,51.7 91.3,52.4 92.1,53.2 92.9,54 93.5,55 94.1,56.1 94.5,57.2 94.9,58.5 95.1,59.8 95.3,61.2"/></svg>';
