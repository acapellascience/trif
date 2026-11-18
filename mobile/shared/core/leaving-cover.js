// The leaving cover's "icon use" decision (docs/MOBILE-BEHAVIOUR.md, Icons and full screen; Tim 11-18): as the app
// leaves while it's used through Home Screen icons, a plain cover goes up so the OS's picture of the app is never
// another page. The cover itself, its timing and the OS's hooks stay each app's. Both phone apps run this
// (mobile/shared/gen/core.js: TrifCore.leavingCover); leaving-cover-cases.json holds the answers the iPhone's Swift gave.

'use strict';

const site = require('./site.js');

/** Seconds after an icon's link within which coming to the front counts as by an icon (a warm return's link comes
 * just after the app comes to the front; a cold launch's just before). */
const ICON_WINDOW = 3;

/**
 * Whether the app is in icon use as it leaves (null: it isn't, the real picture stays). Two signs: the shown tab is
 * an icon's own tab, on its site, in full screen (how an icon lands); or the app last came to the front by an icon's
 * link. A tab put in full screen by the two-finger hold, with no icon, is neither.
 * @param {{fullScreen: boolean, host: string, tab: string, iconTabs: Object<string,string>|null, arrivedByIcon: boolean}} f
 *   host: the shown tab's; tab: its id; iconTabs: each icon's site → its own tab's id
 * @returns {null | {iconTab: string} | {arrived: true}} iconTab: the icon's site
 */
function reason(f) {
  const s = site.of(String(f.host || ''));
  const tabs = f.iconTabs && typeof f.iconTabs === 'object' ? f.iconTabs : {};
  if (f.fullScreen && s && Object.prototype.hasOwnProperty.call(tabs, s) && tabs[s] === f.tab) return { iconTab: s };
  if (f.arrivedByIcon) return { arrived: true };
  return null;
}

/**
 * Coming to the front counts as by an icon: its link came less than ICON_WINDOW seconds ago (or later: a clock
 * turned back).
 * @param {number} since seconds since the icon's last link
 */
function arrived(since) {
  return Number(since) < ICON_WINDOW;
}

module.exports = { ICON_WINDOW, reason, arrived };
