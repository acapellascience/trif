// The on/off switch shown for each mod in the side panel and on the setup page: a small pill
// `<button role="switch" aria-checked>` labelled by the mod's visible name. Clicking (or Enter/Space)
// shows the new state right away, asks the background to apply it, and flips back with a short error
// if that fails. Pages render switches with modSwitch(), keep them current with syncSwitches() (e.g.
// when chrome.storage.local `disabled` changes because an agent or the CLI flipped one), and re-render
// when onSwitchChange's callback fires. Styles: switch.css.

const pending = new Map();   // mod id → the state being applied (shown until the background answers)
const errors = new Map();    // mod id → {message, timer}: why the last switch failed, shown for a while
const ERROR_MS = 8000;
let changed = () => {};

/** Call `fn` whenever a switch starts or finishes applying, or an error appears or expires. */
export function onSwitchChange(fn) {
  changed = typeof fn === 'function' ? fn : () => {};
}

/** The state to show for a mod: the one being applied while a switch is in flight, else `enabled`. */
export function shownEnabled(id, enabled) {
  return pending.has(id) ? pending.get(id) : !!enabled;
}

/** The short error from the mod's last failed switch, or null. */
export function switchError(id) {
  return errors.get(id)?.message ?? null;
}

/** "x.com/a" is on unless chrome.storage.local `disabled` has it. */
export function enabledIn(disabled, id) {
  return !(disabled && typeof disabled === 'object' && disabled[id] === true);
}

/**
 * A switch for mod `id`, labelled by the element with id `labelId` (the mod's visible name).
 * `apply(id, enabled)` returns a promise that rejects when the change couldn't be applied.
 */
export function modSwitch(doc, { id, enabled, labelId, apply }) {
  const b = doc.createElement('button');
  b.type = 'button';
  b.className = 'switch';
  b.setAttribute('role', 'switch');
  b.dataset.mod = id;
  if (labelId) b.setAttribute('aria-labelledby', labelId);
  const knob = doc.createElement('span');
  knob.className = 'knob';
  knob.setAttribute('aria-hidden', 'true');
  b.append(knob);
  setSwitch(b, shownEnabled(id, enabled));
  b.addEventListener('click', () => toggle(b, apply));
  return b;
}

/** Show `on` on switch `b` (without applying anything). */
export function setSwitch(b, on) {
  b.setAttribute('aria-checked', String(!!on));
  b.title = on ? 'On: click to switch this mod off' : 'Off: click to switch this mod on';
  if (pending.has(b.dataset.mod)) b.setAttribute('aria-busy', 'true');
  else b.removeAttribute('aria-busy');
}

/** Update every switch under `root` in place from `isEnabled(id)` (keeps focus; in-flight switches keep their new state). */
export function syncSwitches(root, isEnabled) {
  for (const b of root.querySelectorAll('[role="switch"][data-mod]')) {
    setSwitch(b, shownEnabled(b.dataset.mod, isEnabled(b.dataset.mod)));
  }
}

async function toggle(b, apply) {
  const id = b.dataset.mod;
  if (pending.has(id)) return; // one change at a time per mod
  const next = b.getAttribute('aria-checked') !== 'true';
  pending.set(id, next);
  clearError(id);
  setSwitch(b, next);
  changed();
  try {
    await apply(id, next);
    pending.delete(id);
    setSwitch(b, next);
  } catch (e) {
    pending.delete(id);
    setSwitch(b, !next);
    setError(id, shortError(e, next));
  }
  changed();
}

function shortError(e, next) {
  let m = String(e?.message ?? e ?? '').replace(/\s+/g, ' ').trim();
  m = m.replace(/^couldn['’]t turn \S+ (on|off): /i, '');
  if (m.length > 140) m = m.slice(0, 139) + '…';
  return `Couldn’t switch it ${next ? 'on' : 'off'}${m ? `: ${m}` : '.'}`;
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
