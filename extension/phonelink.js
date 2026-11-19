// Settings' "Connect a phone" (docs/PHONE-LINK.md section 7): the switch, the button that opens a pairing
// window and shows its QR code, the paired phones with Remove. The helper does the work (helper/lib/phonelink/
// link.js, `phone.*`, the side panel's alone: background.js passes `phoneLink.*` from this page only); this is
// the section's state (createPhoneLink), what it shows (phoneLinkView, plain data: tests/phone-link-panel.test.js)
// and its elements (renderPhoneLink).
//
// The QR's text holds the one-time secret. It lives in this module's state while the code is on screen and
// nowhere else: never stored, never logged, dropped when the window ends (a phone paired, the 5 minutes are
// up, Cancel, Settings closed, the link turned off).
//
// The words are drafts until Tim approves them: docs/PHONE-LINK-STRINGS.md. The label, the line and the
// explanation behind "more" are the three layers of TRIF's terms (extension/explain.js's `moreText` reads
// them here as it reads the table's).

import { qrMatrix, qrPath } from './qr.js';

export const TEXT = {
  label: 'Connect a phone',
  line: 'Your iPhone asks this computer’s agent for mods.',
  explanation: 'Your iPhone asks this computer’s agent for mods. TRIF on your iPhone sends the page you’re on to your coding agent here, over your Wi-Fi, and gets a phone mod back to approve there. The agent works inside TRIF’s sandbox, as in this chat, and writes phone mods only. Nothing here answers the network until you connect a phone.',
  button: 'Connect a phone',
  over: 'Scan this with TRIF on your iPhone: More, then My computer.',
  under: 'Good for 5 minutes, for one phone.',
  cancel: 'Cancel',
  qrAlt: 'The code to scan',
  row: '{phone} · connected {date}',
  remove: 'Remove',
  removed: '{phone} can’t reach this computer any more.',
  added: '{phone} is connected.',
  toggle: 'Let connected phones reach this computer',
  elsewhere: 'Another browser’s TRIF is handling phones just now. Connect a phone from there.',
  announce: 'Your phone may not find this computer just now.',
  tooLong: 'This computer’s name is too long for the code. Shorten it in System Settings, then try again.',
  // Phone sync (docs/PHONE-SYNC.md; D11: on for a paired phone, the user can turn it off here)
  syncToggle: 'Keep phone mods the same here and on connected phones',
  synced: 'Synced {time}: {n} from this phone.',
  syncedWaiting: 'Synced {time}: {n} from this phone, {k} waiting for your OK.',
  notSynced: 'Not synced yet.',
  conflict: '{name} changed on both: both are kept.',
  // (no relay to the browser that has the link: a helper from before it. Its name, when its helper says it)
  elsewhereNamed: 'TRIF in {browser} is handling phones: connect from there, or quit {browser}.',
  // The phone line (phoneSyncView): in the phone view's banner, and under the bar after the phone menu's Sync with phone
  connectLink: 'Connect a phone',
  syncing: 'Syncing with {phone}.',
  syncingOff: 'Syncing with {phone} is off.',
  syncNow: 'Sync now',
  asking: 'Asking {phone} to sync…',
  notOnline: '{phone} isn’t connected just now. It syncs when TRIF is open on it.',
  syncResult: 'Synced with {phone}: {n} from the phone, {m} to it.',
  syncResultWaiting: 'Synced with {phone}: {n} from the phone, {m} to it, {k} waiting for your OK.',
  phoneSettings: 'Phone settings',
  // (in the phone view's line, once a phone has synced since the helper started: phoneSyncView)
  syncingLast: 'Syncing with {phone} · last synced {ago}.',
  justNow: 'just now',
  minutesAgo: '{n} min ago',
  atTime: 'at {time}',
  // The toast when a sync with a phone is done, whoever started it (syncToast): every open panel shows it;
  // "nothing new" only after a sync started here
  toastSynced: 'Synced with {phone} · {n} from the phone, {m} to it',
  toastSyncedWaiting: 'Synced with {phone} · {n} from the phone, {m} to it, {k} waiting for your OK',
  toastNothing: 'Synced with {phone} · nothing new',
  twoPhones: '{phone} and {other}',
  morePhones: '{phone} and {n} more',
};

const fill = (s, values) => s.replace(/\{(\w+)\}/g, (m, k) => (k in values ? String(values[k]) : m));
/** The helper's own words for what went wrong ("this computer couldn't open a port…"), as a sentence. */
export const sentence = (e) => {
  const s = String(e?.message ?? e ?? '').trim();
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1) + (/[.!?…]$/.test(s) ? '' : '.');
};
const shortDate = (t) => {
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(d.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }) });
};
const shortTime = (t) => {
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
};
/** A phone's sync line and its conflicts, while syncing is on (null: off, or a helper from before the sync). */
function syncOf(st, p, time) {
  if (st.sync !== true) return { sync: null, conflicts: [] };
  const r = p.synced;
  if (!r || typeof r !== 'object') return { sync: TEXT.notSynced, conflicts: [] };
  const n = Number.isInteger(r.fromPhone) ? r.fromPhone : 0;
  const k = Number.isInteger(r.waiting) ? r.waiting : 0;
  return {
    sync: fill(k > 0 ? TEXT.syncedWaiting : TEXT.synced, { time: time(r.at), n, k }),
    conflicts: (Array.isArray(r.conflicts) ? r.conflicts : []).slice(0, 20).map((name) => fill(TEXT.conflict, { name: String(name) })),
  };
}

/**
 * What the section shows, from its state: {hidden} alone while the helper hasn't said how the link is (no
 * helper, or one from before the link), else {label, line, explanation, toggle: {label, on} | null, phones:
 * [{id, label, remove, sync, conflicts}], syncToggle: {label, on, disabled} | null, qr: {text, over, under, cancel}
 * | null, button: {label, disabled} | null, elsewhere, notes: [{text, error}]}. One of qr, elsewhere and button is
 * there. `sync` (a phone's line) and `syncToggle` only from a helper that has the phone sync (its status has `sync`).
 */
export function phoneLinkView(state, now = Date.now(), date = shortDate, time = shortTime) {
  const st = state?.status;
  if (!st || typeof st !== 'object') return { hidden: true };
  const phones = Array.isArray(st.phones) ? st.phones : [];
  const pairing = state.pairing && state.pairing.expires > now && st.on ? state.pairing : null;
  const notes = [];
  if (state.added) notes.push({ text: fill(TEXT.added, { phone: state.added }), error: false });
  if (state.removed) notes.push({ text: fill(TEXT.removed, { phone: state.removed }), error: false });
  if (st.on && (st.announce === 'missing' || st.announce === 'failing')) notes.push({ text: TEXT.announce, error: false });
  if (state.error) notes.push({ text: state.error, error: true });
  return {
    hidden: false,
    label: TEXT.label,
    line: TEXT.line,
    explanation: TEXT.explanation,
    // (the switch once there is something to switch: the link on, or phones kept from when it was)
    toggle: st.on || phones.length ? { label: TEXT.toggle, on: !!st.on, disabled: !!state.busy } : null,
    // (syncing phone mods: its own switch, under the link's, while the link is on)
    syncToggle: st.on && typeof st.sync === 'boolean' ? { label: TEXT.syncToggle, on: st.sync, disabled: !!state.busy } : null,
    phones: phones.map((p) => ({ id: p.id, label: fill(TEXT.row, { phone: p.name, date: date(p.pairedAt) }), remove: TEXT.remove, ...syncOf(st, p, time) })),
    qr: pairing ? { text: pairing.qr, over: TEXT.over, under: TEXT.under, cancel: TEXT.cancel } : null,
    elsewhere: !pairing && st.here === false ? (typeof st.browser === 'string' && st.browser ? fill(TEXT.elsewhereNamed, { browser: st.browser.slice(0, 40) }) : TEXT.elsewhere) : null,
    button: !pairing && st.here !== false ? { label: TEXT.button, disabled: !!state.busy } : null,
    notes,
  };
}

/** The paired phones as one name: "Tim’s iPhone", "Tim’s iPhone and iPad", "Tim’s iPhone and 2 more". */
function phonesName(phones) {
  const [first, second] = phones.map((p) => String(p.name || 'iPhone'));
  if (phones.length === 1) return first;
  return phones.length === 2 ? fill(TEXT.twoPhones, { phone: first, other: second }) : fill(TEXT.morePhones, { phone: first, n: phones.length - 1 });
}

/**
 * The phone line (the phone view's banner, and under the bar after the phone menu's Sync with phone), from the
 * section's state: null while the helper hasn't said how the link is (or another browser has it and can't be
 * reached), else {text, actions: ['connect' | 'syncNow' | 'settings'], busy}.
 *   no phone paired: no text, the Connect a phone link (it opens the pairing code);
 *   paired: "Syncing with {phone}." and Sync now; after Sync now, "Asking {phone} to sync…", then what that sync
 *   did ("Synced with {phone}: …"), or that the phone isn't connected just now; syncing off: says so, and the
 *   phone settings.
 */
export const ASK_MS = 30000; // (a phone told to sync that hasn't in this long: as if it weren't connected)
export function phoneSyncView(state, now = Date.now()) {
  const st = state?.status;
  if (!st || typeof st !== 'object' || st.here === false) return null;
  const phones = Array.isArray(st.phones) ? st.phones : [];
  // (none paired: Connect a phone; while its code is on screen, nothing: the code is the next step)
  if (!phones.length) return state.pairing ? null : { text: null, actions: ['connect'], busy: !!state.busy };
  const asked = state.asked && typeof state.asked === 'object' ? state.asked : null;
  const told = asked ? phones.filter((p) => asked.told.includes(p.id)) : [];
  const name = phonesName(told.length ? told : phones);
  if (st.on === false || st.sync === false) return { text: fill(TEXT.syncingOff, { phone: name }), actions: ['settings'], busy: !!state.busy };
  if (asked && asked.pending) return { text: fill(TEXT.asking, { phone: name }), actions: [], busy: true };
  if (asked && asked.error) return { text: asked.error, actions: ['syncNow', 'settings'], busy: !!state.busy, error: true };
  if (asked && !told.length) return { text: fill(TEXT.notOnline, { phone: name }), actions: ['syncNow', 'settings'], busy: !!state.busy };
  if (asked) {
    // (the sync each phone told has ended since: what it did, summed)
    const done = told.map((p) => p.synced).filter((r) => r && typeof r === 'object' && r.at >= asked.at);
    if (done.length < told.length) {
      if (now - asked.at < ASK_MS) return { text: fill(TEXT.asking, { phone: name }), actions: [], busy: true };
      if (!done.length) return { text: fill(TEXT.notOnline, { phone: name }), actions: ['syncNow', 'settings'], busy: !!state.busy };
    }
    const sum = (k) => done.reduce((n, r) => n + (Number.isInteger(r[k]) ? r[k] : 0), 0);
    const k = sum('waiting');
    return { text: fill(k > 0 ? TEXT.syncResultWaiting : TEXT.syncResult, { phone: name, n: sum('fromPhone'), m: sum('toPhone'), k }), actions: ['settings'], busy: false };
  }
  // (when it last synced, if it has since the helper started)
  const last = Math.max(0, ...phones.map((p) => (p.synced && Number.isFinite(p.synced.at) ? p.synced.at : 0)));
  if (last > 0) return { text: fill(TEXT.syncingLast, { phone: name, ago: ago(last, now) }), actions: ['syncNow'], busy: !!state.busy };
  return { text: fill(TEXT.syncing, { phone: name }), actions: ['syncNow'], busy: !!state.busy };
}

/** How long ago `at` was, in the phone line's words: just now, 5 min ago, at 14:05. */
export function ago(at, now = Date.now(), time = shortTime) {
  const s = Math.max(0, now - at) / 1000;
  if (s < 60) return TEXT.justNow;
  if (s < 3600) return fill(TEXT.minutesAgo, { n: Math.floor(s / 60) });
  return fill(TEXT.atTime, { time: time(at) });
}

/**
 * The toast for syncs that just ended (`done`: [{phone: its name, synced: the helper's record}]), or '' for none:
 * what came from the phones and went to them, summed; "nothing new" when nothing moved, but only after a sync the
 * person started here (`asked`: Sync now, Sync with phone). Automatic syncs nothing moved in say nothing (Tim,
 * 2026-11-18: the phone syncs every time it comes to the front, so "nothing new" would show all the time).
 */
export function syncToast(done, { asked = false } = {}) {
  const list = (Array.isArray(done) ? done : []).filter((d) => d && d.synced && typeof d.synced === 'object');
  if (!list.length) return '';
  const name = phonesName(list.map((d) => ({ name: String(d.phone || '') })));
  const sum = (k) => list.reduce((n, d) => n + (Number.isInteger(d.synced[k]) ? d.synced[k] : 0), 0);
  const n = sum('fromPhone'); const m = sum('toPhone'); const k = sum('waiting');
  if (!n && !m && !k) return asked ? fill(TEXT.toastNothing, { phone: name }) : '';
  return fill(k > 0 ? TEXT.toastSyncedWaiting : TEXT.toastSynced, { phone: name, n, m, k });
}

/**
 * The section's state and what its controls do. `request` is the panel's (to background.js); `changed` is
 * called whenever what the section shows may have changed. Settings tells it `open(helperConnected)` and
 * `close()`; the background's `phoneLink` messages go to `onMessage(status)`.
 */
export function createPhoneLink({ request, changed = () => {}, synced = () => {}, now = () => Date.now(), setTimer = (f, ms) => setTimeout(f, ms), clearTimer = (t) => clearTimeout(t) }) {
  // (asked: the last Sync now, {at, told: [phone ids], error}, for the phone line: phoneSyncView)
  const state = { status: null, pairing: null, busy: false, error: '', removed: '', added: '', asked: null };
  let opened = false;
  let timer = null;
  let asked = 0; // (an answer to an older question never replaces a newer one's)

  const dropPairing = () => {
    if (timer !== null) { clearTimer(timer); timer = null; }
    state.pairing = null;
  };
  // (a status from an answer or a message: never the QR's text, which stays in `pairing` alone)
  const take = (r) => {
    if (!r || typeof r !== 'object') return;
    const { qr, expires, removed, ...status } = r;
    const before = new Set((state.status?.phones || []).map((p) => p.id));
    // (a sync that ended since the last status this panel had, whoever started it: `synced`, the toast; none for
    // the first status a panel gets, which only says how things were)
    if (state.status) {
      const was = new Map((state.status.phones || []).map((p) => [p.id, p.synced && Number.isFinite(p.synced.at) ? p.synced.at : 0]));
      const done = (Array.isArray(status.phones) ? status.phones : [])
        .filter((p) => p && p.synced && Number.isFinite(p.synced.at) && p.synced.at > (was.get(p.id) ?? 0))
        .map((p) => ({ id: p.id, phone: p.name, synced: p.synced }));
      // (one the person asked for: a sync of a phone Sync now told, ended after it was pressed and within the wait)
      const a = state.asked;
      const asked = !!a && !a.error && done.some((d) => d.synced.at >= a.at && d.synced.at - a.at <= ASK_MS + 5000
        && (a.pending || (a.told || []).includes(d.id)));
      if (done.length) { try { const text = syncToast(done, { asked }); if (text) synced(text, done); } catch { /* the panel's toast, no more */ } }
    }
    const fresh = (Array.isArray(status.phones) ? status.phones : []).filter((p) => !before.has(p.id));
    // The window closed on the helper's side: a phone took it (say which), or its time was up
    if (state.pairing && !status.pairing) {
      if (state.status && fresh.length) { state.added = fresh[0].name; state.removed = ''; }
      dropPairing();
    }
    if (!status.on) dropPairing();
    state.status = status;
  };
  const act = async (fn) => {
    if (state.busy) return;
    state.busy = true;
    state.error = '';
    changed();
    try { await fn(); } catch (e) { state.error = sentence(e); }
    state.busy = false;
    changed();
  };
  const stopPairing = async () => {
    if (!state.pairing) return;
    dropPairing();
    changed();
    try { take(await request({ type: 'phoneLink.pair.stop' })); } catch { /* the window ends by itself */ }
    changed();
  };

  return {
    state,
    view: (date, time) => phoneLinkView(state, now(), date, time),
    syncView: () => phoneSyncView(state, now()),
    /**
     * How the link is, for the phone line and the phone menu, without opening Settings (its messages are taken
     * from then on). A helper from before the link: nothing.
     */
    async peek(helper = true) {
      if (!helper) { if (!opened) { state.status = null; changed(); } return; }
      const mine = ++asked;
      try {
        const r = await request({ type: 'phoneLink.status' });
        if (mine === asked) take(r);
      } catch { /* (no phone line) */ }
      changed();
    },
    /** Sync now: the phones are asked to sync; the phone line follows that sync (phoneSyncView). */
    syncNow: async () => {
      if (state.busy) return;
      state.busy = true;
      const at = now(); // (a sync that ends after this is the one asked for: the helper's clock is this computer's)
      state.asked = { at, told: [], pending: true };
      changed();
      try {
        const r = await request({ type: 'phoneLink.syncNow' });
        const told = Array.isArray(r?.told) ? r.told.filter((x) => typeof x === 'string') : [];
        state.asked = { at, told };
        take(r);
        if (told.length) setTimer(changed, ASK_MS + 100); // (no answer by then: said so)
      } catch (e) { state.asked = { at, told: [], error: sentence(e) }; }
      state.busy = false;
      changed();
    },
    /** The phone line's result is read: back to its usual words. */
    forgetAsked() { if (state.asked) { state.asked = null; changed(); } },
    /** Settings opened (or the helper came back while they are open): how the link is. */
    async open(helper = true) {
      opened = true;
      if (!helper) { state.status = null; dropPairing(); changed(); return; }
      const mine = ++asked;
      try {
        const r = await request({ type: 'phoneLink.status' });
        if (mine === asked) take(r);
      } catch { if (mine === asked) state.status = null; } // (a helper from before the link: no section)
      changed();
    },
    /** Settings closed: the code goes, and its window with it. */
    async close() {
      opened = false;
      state.error = ''; state.removed = ''; state.added = '';
      await stopPairing();
    },
    onMessage(status) {
      if (!opened && !state.status) return;
      take(status);
      changed();
    },
    /** The button: the link on if it wasn't, a pairing window, its code. */
    connect: () => act(async () => {
      state.removed = ''; state.added = '';
      if (!state.status?.on) take(await request({ type: 'phoneLink.on' }));
      const r = await request({ type: 'phoneLink.pair.start' });
      take(r);
      if (!opened || typeof r?.qr !== 'string' || !(r.expires > now())) { // (Settings closed meanwhile)
        if (!opened) request({ type: 'phoneLink.pair.stop' }).catch(() => {});
        return;
      }
      try { qrMatrix(r.qr); } catch {
        request({ type: 'phoneLink.pair.stop' }).then(take, () => {});
        throw new Error(TEXT.tooLong);
      }
      state.pairing = { qr: r.qr, expires: r.expires };
      timer = setTimer(() => { timer = null; stopPairing(); }, Math.max(0, r.expires - now()));
    }),
    cancel: stopPairing,
    toggle: (on) => act(async () => {
      state.removed = ''; state.added = '';
      if (!on) dropPairing();
      take(await request({ type: on ? 'phoneLink.on' : 'phoneLink.off' }));
    }),
    syncToggle: (on) => act(async () => {
      state.removed = ''; state.added = '';
      take(await request({ type: 'phoneLink.sync', on: on !== false }));
    }),
    remove: (id) => act(async () => {
      const r = await request({ type: 'phoneLink.remove', id });
      take(r);
      state.added = '';
      state.removed = r?.removed?.name || '';
    }),
  };
}

const SVG = 'http://www.w3.org/2000/svg';

/** The code as an SVG: dark on white whatever the theme, so a camera reads it. */
function qrSvg(doc, text, label) {
  const { d, size } = qrPath(qrMatrix(text));
  const svg = doc.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('class', 'pl-qr');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  svg.setAttribute('shape-rendering', 'crispEdges');
  const bg = doc.createElementNS(SVG, 'rect');
  bg.setAttribute('width', String(size)); bg.setAttribute('height', String(size)); bg.setAttribute('fill', '#fff');
  const path = doc.createElementNS(SVG, 'path');
  path.setAttribute('d', d); path.setAttribute('fill', '#000');
  // (the panel's icons are drawn as lines, sidepanel.css `svg`: this is filled squares, never outlined, or
  // the outlines run the modules together and no camera reads it)
  path.setAttribute('stroke', 'none');
  svg.append(bg, path);
  return svg;
}

/**
 * Draws the section into `root` (hidden while there is nothing to show). `link` is createPhoneLink's;
 * `addMore(host, term)` is the panel's "i" that unfolds an explanation (sidepanel.js).
 */
export function renderPhoneLink(root, link, { doc = document, addMore = (host) => host } = {}) {
  const v = link.view();
  root.hidden = !!v.hidden;
  if (v.hidden) { root.replaceChildren(); return; }
  const el = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const btn = (label, cls, onClick) => { const b = el('button', `btn${cls ? ` ${cls}` : ''}`, label); b.type = 'button'; b.addEventListener('click', onClick); return b; };
  // (the "i" keeps its place, open or not, when the section is drawn again)
  const wasOpen = !!root.querySelector('.more-btn.open');
  const out = [el('p', 'sites-title', v.label)];
  const line = addMore(el('p', 'note', v.line), { line: v.line, explanation: v.explanation });
  if (wasOpen) line.querySelector('.more-btn')?.click();
  out.push(line);

  const toggle = (t, id, onClick) => {
    const row = el('div', 'pl-toggle');
    const name = el('span', null, t.label);
    name.id = id;
    const sw = el('button', 'switch');
    sw.type = 'button';
    sw.setAttribute('role', 'switch');
    sw.setAttribute('aria-checked', String(t.on));
    sw.setAttribute('aria-labelledby', name.id);
    if (t.disabled) sw.setAttribute('aria-busy', 'true');
    const knob = el('span', 'knob');
    knob.setAttribute('aria-hidden', 'true');
    sw.append(knob);
    sw.addEventListener('click', onClick);
    row.append(sw, name);
    return row;
  };
  if (v.toggle) out.push(toggle(v.toggle, 'pl-toggle-label', () => link.toggle(!v.toggle.on)));
  if (v.syncToggle) out.push(toggle(v.syncToggle, 'pl-sync-label', () => link.syncToggle(!v.syncToggle.on)));
  if (v.phones.length) {
    const ul = el('ul', 'blocked-list pl-phones');
    for (const p of v.phones) {
      const li = el('li');
      const remove = btn(p.remove, '', () => link.remove(p.id));
      remove.setAttribute('aria-label', `${p.remove}: ${p.label}`);
      const who = el('span', 'pl-phone', p.label);
      // (its last sync, under its name: the line, then each conflict)
      for (const line of p.sync ? [p.sync, ...p.conflicts] : []) { who.append(doc.createElement('br'), el('span', 'pl-sync', line)); }
      li.append(who, remove);
      ul.append(li);
    }
    out.push(ul);
  }
  if (v.qr) {
    const box = el('div', 'pl-pair');
    box.append(el('p', 'note', v.qr.over), qrSvg(doc, v.qr.text, TEXT.qrAlt), el('p', 'note', v.qr.under), btn(v.qr.cancel, '', () => link.cancel()));
    out.push(box);
  } else if (v.elsewhere) {
    out.push(el('p', 'note', v.elsewhere));
  } else if (v.button) {
    const b = btn(v.button.label, 'pl-connect', () => link.connect());
    b.disabled = v.button.disabled;
    out.push(b);
  }
  for (const n of v.notes) {
    const p = el('p', `note${n.error ? ' error' : ''}`, n.text);
    p.setAttribute('role', 'status');
    out.push(p);
  }
  root.replaceChildren(...out);
}
