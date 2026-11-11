// The on/off switch shown for each mod in the side panel and on the setup page: a small pill
// `<button role="switch" aria-checked>` labelled by the mod's visible name. Clicking (or Enter/Space)
// shows the new state right away, asks the background to apply it, and flips back with a short error
// if that fails. Pages render switches with modSwitch(), keep them current with syncSwitches() (e.g.
// when chrome.storage.local `disabled` changes because an agent or the CLI flipped one), and re-render
// when onSwitchChange's callback fires. A switch can also be for one site of a mod (`site`: chrome.storage
// .local `offSites`); its state and errors are kept apart from the whole mod's. Styles: switch.css.

const pending = new Map();   // switch key → the state being applied (shown until the background answers)
const errors = new Map();    // switch key → {message, timer}: why the last switch failed, shown for a while
const ERROR_MS = 8000;
let changed = () => {};

/** Call `fn` whenever a switch starts or finishes applying, or an error appears or expires. */
export function onSwitchChange(fn) {
  changed = typeof fn === 'function' ? fn : () => {};
}

// "x.com/a" for the whole mod, "x.com/a twitter.com" for its switch on one site (ids have no spaces).
const keyOf = (id, site) => (site ? `${id} ${site}` : id);

/** The state to show for a mod (or its switch on `site`): the one being applied while a switch is in flight, else `enabled`. */
export function shownEnabled(id, enabled, site) {
  const key = keyOf(id, site);
  return pending.has(key) ? pending.get(key) : !!enabled;
}

/** The short error from the mod's (or its `site` switch's) last failed switch, or null. */
export function switchError(id, site) {
  return errors.get(keyOf(id, site))?.message ?? null;
}

/** "x.com/a" is on unless chrome.storage.local `disabled` has it. */
export function enabledIn(disabled, id) {
  return !(disabled && typeof disabled === 'object' && disabled[id] === true);
}

/**
 * A switch for mod `id` (on `site` only, when given), labelled by the element with id `labelId`.
 * `apply(id, enabled, site)` returns a promise that rejects when the change couldn't be applied.
 */
export function modSwitch(doc, { id, site, enabled, labelId, apply }) {
  const b = doc.createElement('button');
  b.type = 'button';
  b.className = 'switch';
  b.setAttribute('role', 'switch');
  b.dataset.mod = id;
  if (site) b.dataset.site = site;
  if (labelId) b.setAttribute('aria-labelledby', labelId);
  const knob = doc.createElement('span');
  knob.className = 'knob';
  knob.setAttribute('aria-hidden', 'true');
  b.append(knob);
  setSwitch(b, shownEnabled(id, enabled, site));
  b.addEventListener('click', () => toggle(b, apply));
  return b;
}

/** Show `on` on switch `b` (without applying anything). */
export function setSwitch(b, on) {
  b.setAttribute('aria-checked', String(!!on));
  const site = b.dataset.site;
  b.title = site
    ? (on ? `On on ${site}: click to switch it off there` : `Off on ${site}: click to switch it on there`)
    : (on ? 'On: click to switch this mod off' : 'Off: click to switch this mod on');
  if (pending.has(keyOf(b.dataset.mod, site))) b.setAttribute('aria-busy', 'true');
  else b.removeAttribute('aria-busy');
}

/** Update every switch under `root` in place from `isEnabled(id, site)` (keeps focus; in-flight switches keep their new state). */
export function syncSwitches(root, isEnabled) {
  for (const b of root.querySelectorAll('[role="switch"][data-mod]')) {
    const { mod, site } = b.dataset;
    setSwitch(b, shownEnabled(mod, isEnabled(mod, site), site));
  }
}

async function toggle(b, apply) {
  const { mod: id, site } = b.dataset;
  const key = keyOf(id, site);
  if (pending.has(key)) return; // one change at a time per switch
  const next = b.getAttribute('aria-checked') !== 'true';
  pending.set(key, next);
  clearError(key);
  setSwitch(b, next);
  changed();
  try {
    await apply(id, next, site);
    pending.delete(key);
    setSwitch(b, next);
  } catch (e) {
    pending.delete(key);
    setSwitch(b, !next);
    setError(key, shortError(e, next, site));
  }
  changed();
}

function shortError(e, next, site) {
  let m = String(e?.message ?? e ?? '').replace(/\s+/g, ' ').trim();
  m = m.replace(/^couldn['’]t turn \S+ (on|off)( on \S+)?: /i, '');
  if (m.length > 140) m = m.slice(0, 139) + '…';
  return `Couldn’t switch it ${next ? 'on' : 'off'}${site ? ` on ${site}` : ''}${m ? `: ${m}` : '.'}`;
}

function setError(id, message) {
  clearError(id);
  const timer = setTimeout(() => { errors.delete(id); changed(); }, ERROR_MS);
  timer?.unref?.(); // (Node, in tests)
  errors.set(id, { message, timer });
}

function clearError(id) {
  const e = errors.get(id);
  if (e) { clearTimeout(e.timer); errors.delete(id); }
}
