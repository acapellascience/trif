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

/**
 * What the section shows, from its state: {hidden} alone while the helper hasn't said how the link is (no
 * helper, or one from before the link), else {label, line, explanation, toggle: {label, on} | null, phones:
 * [{id, label, remove}], qr: {text, over, under, cancel} | null, button: {label, disabled} | null, elsewhere,
 * notes: [{text, error}]}. One of qr, elsewhere and button is there.
 */
export function phoneLinkView(state, now = Date.now(), date = shortDate) {
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
    phones: phones.map((p) => ({ id: p.id, label: fill(TEXT.row, { phone: p.name, date: date(p.pairedAt) }), remove: TEXT.remove })),
    qr: pairing ? { text: pairing.qr, over: TEXT.over, under: TEXT.under, cancel: TEXT.cancel } : null,
    elsewhere: !pairing && st.here === false ? TEXT.elsewhere : null,
    button: !pairing && st.here !== false ? { label: TEXT.button, disabled: !!state.busy } : null,
    notes,
  };
}

/**
 * The section's state and what its controls do. `request` is the panel's (to background.js); `changed` is
 * called whenever what the section shows may have changed. Settings tells it `open(helperConnected)` and
 * `close()`; the background's `phoneLink` messages go to `onMessage(status)`.
 */
export function createPhoneLink({ request, changed = () => {}, now = () => Date.now(), setTimer = (f, ms) => setTimeout(f, ms), clearTimer = (t) => clearTimeout(t) }) {
  const state = { status: null, pairing: null, busy: false, error: '', removed: '', added: '' };
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
    view: (date) => phoneLinkView(state, now(), date),
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

  if (v.toggle) {
    const row = el('div', 'pl-toggle');
    const name = el('span', null, v.toggle.label);
    name.id = 'pl-toggle-label';
    const sw = el('button', 'switch');
    sw.type = 'button';
    sw.setAttribute('role', 'switch');
    sw.setAttribute('aria-checked', String(v.toggle.on));
    sw.setAttribute('aria-labelledby', name.id);
    if (v.toggle.disabled) sw.setAttribute('aria-busy', 'true');
    const knob = el('span', 'knob');
    knob.setAttribute('aria-hidden', 'true');
    sw.append(knob);
    sw.addEventListener('click', () => link.toggle(!v.toggle.on));
    row.append(sw, name);
    out.push(row);
  }
  if (v.phones.length) {
    const ul = el('ul', 'blocked-list pl-phones');
    for (const p of v.phones) {
      const li = el('li');
      const remove = btn(p.remove, '', () => link.remove(p.id));
      remove.setAttribute('aria-label', `${p.remove}: ${p.label}`);
      li.append(el('span', 'pl-phone', p.label), remove);
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
