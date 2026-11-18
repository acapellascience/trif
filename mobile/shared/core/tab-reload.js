// Which tabs load again when the mods change (docs/MOBILE-BEHAVIOUR.md, Tabs; Tim 11-18: "when you successfully add
// the mod to the other tab, your tab reloads. That's quite annoying for watching videos"). After a change to the mods
// the scripts every page gets are made again; the shown page loads again only if what runs on it changed, and never
// while it plays (unless the person's own act asks for it: Pause all); tabs behind load again when they're next shown.
// What runs on a page is a signature each app makes (iPhone: Hasher, per launch); only its equality matters here. The
// reload itself, the playing check and the scripts stay each app's. Both phone apps run this (mobile/shared/gen/core.js:
// TrifCore.tabReload); tab-reload-cases.json holds the answers the iPhone's Swift gave.

'use strict';

/** The signature a page keeps as it commits while a change isn't in the scripts yet: it counts as stale. */
const PENDING = 'pending';

/**
 * A tab shown: its first load (what was kept of it) or a look at whether its mods changed.
 * @param {{started: boolean, waitingForFront: boolean}} f waitingForFront: the app isn't in front yet (it starts then)
 * @returns {'start' | 'refresh'}
 */
function shown(f) {
  return !f.started && !f.waitingForFront ? 'start' : 'refresh';
}

/**
 * The signature a page keeps as it commits.
 * @param {{pending: boolean, signature: string}} f pending: a change to the mods isn't in the scripts yet
 */
function loaded(f) {
  return f.pending ? PENDING : String(f.signature);
}

/**
 * Whether the mods running on a page changed since it loaded (null: it hasn't loaded).
 * @param {string|null} kept what loaded() gave as it committed
 * @param {string} now the signature for its address now
 */
function stale(kept, now) {
  return kept == null ? null : String(now) !== String(kept);
}

/**
 * The shown tab looked at after a change (or as it's shown again).
 * @param {{pending: boolean, started: boolean, hasPage: boolean, reloading: boolean, loaded: string|null, now: string,
 *   evenPlaying: boolean}} f hasPage: it has an address; reloading: a reload of it is under way; evenPlaying: Pause all
 * @returns {'later' | 'keep' | 'ask' | 'next'} later: once the scripts are in, look again (if it's still the tab
 *   shown); ask: find out whether it plays, then recheck; next: recheck (on the next turn) without asking
 */
function refresh(f) {
  if (f.pending) return 'later';
  if (!f.started || !f.hasPage || f.reloading || !stale(f.loaded, f.now)) return 'keep';
  return f.evenPlaying ? 'next' : 'ask';
}

/**
 * After refresh's ask (or next): whether it loads again now.
 * @param {{playing: boolean, shown: boolean, reloading: boolean, pending: boolean, loaded: string|null, now: string}} f
 *   playing: it plays sound or video (false when not asked); shown: it's still the tab shown
 * @returns {'playing' | 'keep' | 'reload'} playing: it keeps going as it is, and loads again the next time it's shown
 *   not playing
 */
function recheck(f) {
  if (f.playing) return 'playing';
  if (!f.shown || f.reloading || f.pending || !stale(f.loaded, f.now)) return 'keep';
  return 'reload';
}

module.exports = { PENDING, shown, loaded, stale, refresh, recheck };
