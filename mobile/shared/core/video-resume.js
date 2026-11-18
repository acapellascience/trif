// A video picks up where it was after its page loads again (docs/MOBILE-BEHAVIOUR.md, Video; Tim 11-18): which load
// resumes the video kept for its tab (the same page within 30 minutes, not live, not ended, not another video, not the
// first 5 s or the last 10 s, not a link asking for its own time), and the sites' video ids. What the page reports,
// where it's kept and how it's put back stay each app's (and the page's). Both phone apps run this
// (mobile/shared/gen/core.js: TrifCore.videoResume); video-resume-cases.json holds the answers the iPhone's Swift gave.
//
// An address crosses in as its parts, as the platform's parser gives them (a bare JavaScriptCore has no URL):
// {host, path (percent escapes decoded), query: [[name, value or null]] or null, fragment or null}, or null when it
// isn't an address. The iPhone's Swift compared text as Characters (a mark after "/" or "#" belongs to it, a number is
// a Character whose first scalar is one) and by canonical equivalence; so does this. (Its Character.isNumber also
// counts Han numerals such as 一; JS's \p{N} doesn't. Addresses are punycode and percent escapes in practice.)

'use strict';

const WINDOW = 30 * 60, SKIP_START = 5, SKIP_END = 10;

/** what joins the Character before it (marks, joiners, emoji modifiers, tags): nearly Unicode's Extend + SpacingMark */
const JOINS = '\\p{M}\\u200C\\u200D\\uFF9E\\uFF9F\\u{1F3FB}-\\u{1F3FF}\\u{E0020}-\\u{E007F}';
const SLASH = new RegExp(`/(?![${JOINS}])`, 'u');
const HASH = new RegExp(`#(?![${JOINS}])`, 'u');
const NUMBER = new RegExp(`^(?:\\p{N}[${JOINS}]*)+$`, 'u');
const T_IS = new RegExp(`^t=(?![${JOINS}])`, 'u');

const same = (a, b) => a === b || (a != null && b != null && String(a).normalize('NFC') === String(b).normalize('NFC'));

/**
 * The site's own id for the video at an address, where it has one: YouTube's watch?v=, /shorts/, /embed/, /live/,
 * /v/, youtu.be/; Vimeo's number (the last one in the path). null elsewhere (the address itself is the page then).
 * @param {{host: ?string, path: string, query: ?Array, fragment: ?string}|null} p
 */
function videoID(p) {
  if (!p || p.host == null) return null;
  const host = String(p.host).toLowerCase().normalize('NFC');
  const parts = String(p.path || '').split(SLASH).filter((s) => s !== '');
  const is = (h) => host === h || host.endsWith('.' + h);
  if (host === 'youtu.be') return parts.length ? 'yt:' + parts[0] : null;
  if (is('youtube.com') || is('youtube-nocookie.com')) {
    const v = (p.query || []).find(([name]) => same(name, 'v'));
    if (v && v[1] != null && v[1] !== '') return 'yt:' + v[1];
    if (parts.length >= 2 && ['shorts', 'embed', 'live', 'v'].some((k) => same(parts[0], k))) return 'yt:' + parts[1];
    return null;
  }
  if (is('vimeo.com')) {
    const n = [...parts].reverse().find((s) => NUMBER.test(s));
    return n ? 'vimeo:' + n : null;
  }
  return null;
}

/** The address asks for its own time (a shared link's t=, start=, time_continue=, a #t=): the person chose it. */
function asksForTime(p) {
  if (!p) return false;
  if ((p.query || []).some(([name]) => ['t', 'start', 'time_continue'].some((k) => same(name, k)))) return true;
  return T_IS.test(p.fragment || '');
}

/** An address without its #part. */
const bare = (url) => String(url).split(HASH)[0];

/**
 * The same page: the same video id when the site has one, else the same address (its #part aside).
 * @param {{url: string, parts: object|null}} a
 * @param {{url: string, parts: object|null}} b
 */
function samePage(a, b) {
  const va = videoID(a.parts), vb = videoID(b.parts);
  if (va != null || vb != null) return same(va, vb);
  return same(bare(a.url), bare(b.url));
}

/**
 * Whether the page loading `address` in this tab picks up the video kept for it, and why (Diagnostics only).
 * @param {{saved: ?{url: string, parts: object|null, time: number, duration: number, live: boolean, ended: boolean, age: number}, address: {url: string, parts: object|null}}} f
 *   duration: -1 when live or not known; age: seconds since it was kept
 * @returns {{plan: boolean, why: string}}
 */
function decide(f) {
  const s = f.saved;
  const no = (why) => ({ plan: false, why });
  if (!s) return no('nothing kept');
  if (s.age > WINDOW) return no('kept more than 30 minutes ago');
  if (s.live) return no('a live stream');
  if (s.ended) return no('it had ended');
  if (!samePage(s, f.address)) return no('another page or video');
  if (asksForTime(f.address.parts) && !asksForTime(s.parts)) return no('the address asks for its own time');
  if (s.time < SKIP_START) return no(`in its first ${SKIP_START} s`);
  if (s.duration > 0 && s.time > s.duration - SKIP_END) return no(`in its last ${SKIP_END} s`);
  return { plan: true, why: 'resume' };
}

module.exports = { videoID, asksForTime, samePage, decide, WINDOW, SKIP_START, SKIP_END };
