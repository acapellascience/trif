// Made by mobile/prepare.js from mobile/shared/core/*.js: don't edit. The phone apps' shared rules (docs/MOBILE-BEHAVIOUR.md).
var TrifCore = (function () {
'use strict';
const TrifCore = {};
TrifCore.appLinks = (function () {
const module = { exports: {} };
// Links that aren't web pages (tel:, mailto:, sms:, maps:, an app's own scheme such as fb-messenger:): handed to the
// phone's OS, as Safari does (Tim, 11-18). Only at once when the person tapped; a page (or a mod) trying it by itself
// gets the OS browser's question instead, at most one at a time and one a page load; never from a frame inside the
// page unless tapped. http/https always stay in TRIF (the default-browser rules). docs/MOBILE-BEHAVIOUR.md, Links.
// Both phone apps run this (mobile/shared/gen/core.js: TrifCore.appLinks); app-links-cases.json holds the answers.

'use strict';

/** The schemes that stay in the web view: about:, blob:, data:, and the iPhone app's test pages. */
const STAY = ['about', 'blob', 'data', 'trifprobe'];

/** (a tap's link comes ~0–0.4 s after the finger lifts: WebKit waits for a double tap on pages without a phone viewport) */
const TAP_WINDOW = 1.5;

/**
 * What a link's scheme is: 'web' (http/https: TRIF's own business), 'stay' (about, blob, data: in the web view),
 * 'never' (javascript: runs in its page only, file: is never opened; also no scheme), 'own' (trif: and the app's other
 * schemes: never handed to the OS, that would be the page opening TRIF itself), 'other' (another app's).
 * @param {string} scheme the URL's scheme, any case, without the colon
 * @param {string[]} own the app's own schemes (lower case)
 */
function kind(scheme, own) {
  const s = String(scheme || '').toLowerCase();
  if (!s) return 'never';
  if (s === 'http' || s === 'https') return 'web';
  if (STAY.includes(s)) return 'stay';
  if (s === 'javascript' || s === 'file') return 'never';
  if ((own || []).includes(s)) return 'own';
  return 'other';
}

/**
 * What to do with another app's link: 'open' (to the OS now), 'ask' (the question first) or 'drop:<why>' (nothing; why
 * is for the log).
 * @param {{tapped: boolean, mainFrame: boolean, askedThisLoad: boolean, asking: boolean, mayAsk?: boolean}} a
 *   tapped: the person tapped it (isTap); mainFrame: the page itself or a new window, not a frame inside it;
 *   askedThisLoad: the question was already put for this page's load (answered either way); asking: a question is up
 *   now; mayAsk: where it came from can ask at all (More's panel can't: its own page, only taps). Default true.
 */
function decide(a) {
  if (a.tapped) return 'open';
  if (a.mayAsk === false) return 'drop:not tapped';
  if (!a.mainFrame) return 'drop:a frame inside the page, not tapped';
  if (a.asking) return 'drop:a question is already up';
  if (a.askedThisLoad) return 'drop:asked once on this page already';
  return 'ask';
}

/**
 * A link or form counts as tapped when the person's finger was on the page just now (WebKit calls a script's
 * a.click() a link too), or a long-press menu's item was chosen.
 * @param {{linkOrForm: boolean, sinceTouch: number|null, touching: boolean, menu: boolean}} a sinceTouch: seconds since
 *   the finger last lifted (null: never)
 */
function isTap(a) {
  if (!a.linkOrForm) return false;
  if (a.menu || a.touching) return true;
  return typeof a.sinceTouch === 'number' && a.sinceTouch >= 0 && a.sinceTouch < TAP_WINDOW;
}

/** What the log may say about it: the scheme only (a mailto:'s address or a tel:'s number is the person's business). */
function logged(scheme) {
  return `${String(scheme || '?').toLowerCase() || '?'}:`;
}

module.exports = { kind, decide, isTap, logged, TAP_WINDOW, STAY };

return module.exports;
})();
// name "module.fn", args a JSON array; the answer as JSON (null for undefined)
TrifCore.call = function (name, argsJSON) {
  const dot = name.indexOf('.');
  const r = TrifCore[name.slice(0, dot)][name.slice(dot + 1)].apply(null, JSON.parse(argsJSON));
  return JSON.stringify(r === undefined ? null : r);
};
return TrifCore;
})();
if (typeof module === 'object' && module && module.exports) module.exports = TrifCore;
