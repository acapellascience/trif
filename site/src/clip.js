// timsrobot.com/clip: the iPhone app's Home Screen icon, handed to Safari (TRIF's ⋯ menu: Add to Home Screen).
// The app opens x-safari-https://timsrobot.com/clip#<profile> (x-safari-https: Safari whatever the default browser
// is; only Safari installs a profile). The profile, a configuration profile with one Web Clip, travels in the
// address's # part, which a browser never sends to a server: this site never sees it. The page reads it, takes it
// out of the address bar (so it isn't left in the history), checks it is a TRIF Home Screen icon and nothing else
// (one com.apple.webClip.managed payload opening trif://open?url=https://…), and only then hands it to Safari as a
// download (a Blob), which offers "Profile Downloaded". Anything else: an error, and nothing made. No requests,
// no cookies, nothing stored, nothing logged.

import { page } from './pages.js';

// The keys a TRIF icon's profile may have (WebClip.swift `profile`): anything else and it isn't one.
const TOP_KEYS = ['PayloadType', 'PayloadVersion', 'PayloadIdentifier', 'PayloadUUID', 'PayloadDisplayName', 'PayloadDescription',
  'PayloadOrganization', 'PayloadRemovalDisallowed', 'PayloadContent'];
const CLIP_KEYS = ['PayloadType', 'PayloadVersion', 'PayloadIdentifier', 'PayloadUUID', 'PayloadDisplayName', 'Label', 'URL', 'Icon',
  'IsRemovable', 'FullScreen', 'Precomposed', 'IgnoreManifestScope'];

/**
 * Whether a profile (as plain values: dict → object, array → array, data → { data: base64 }) is a TRIF Home Screen
 * icon: '' if it is, else what's wrong. Kept as source text, which the page runs as it is and the tests run through
 * new Function (not the Worker: Cloudflare doesn't allow code from strings): never Function.prototype.toString, which the Worker's bundler changes (11-16: wrangler's keep_names
 * wrapped the inner arrow in __name(), a helper the page doesn't have, so the deployed page threw before showing
 * anything and was left on its "opened without an icon" line, on Tim's phone).
 */
const CHECK_SRC = String.raw`function checkClip(p, topKeys, clipKeys) {
  var isDict = function (x) { return !!x && typeof x === 'object' && !Array.isArray(x) && !('data' in x && Object.keys(x).length === 1); };
  if (!isDict(p)) return 'not a profile';
  if (p.PayloadType !== 'Configuration') return 'not a configuration profile';
  for (var k of Object.keys(p)) if (topKeys.indexOf(k) === -1) return 'an unexpected key: ' + k;
  if (typeof p.PayloadIdentifier !== 'string' || p.PayloadIdentifier.indexOf('com.timsrobot.trif.webclip.') !== 0) return 'not a TRIF icon’s identifier';
  if (!Array.isArray(p.PayloadContent) || p.PayloadContent.length !== 1) return 'not exactly one payload';
  var c = p.PayloadContent[0];
  if (!isDict(c) || c.PayloadType !== 'com.apple.webClip.managed') return 'not a Web Clip';
  for (var k2 of Object.keys(c)) if (clipKeys.indexOf(k2) === -1) return 'an unexpected key in the Web Clip: ' + k2;
  if (typeof c.URL !== 'string' || c.URL.indexOf('trif://open?url=https://') !== 0) return 'not an icon that opens TRIF';
  if (/[\s<>"]/.test(c.URL)) return 'an odd address';
  if (typeof c.Label !== 'string' || !c.Label.trim() || c.Label.length > 60) return 'no name';
  if (c.Icon !== undefined && !(c.Icon && typeof c.Icon.data === 'string')) return 'an icon that isn’t a picture';
  return '';
}`;
export { CHECK_SRC, TOP_KEYS, CLIP_KEYS };

// The words (docs/CLIP-PAGE-STRINGS.md, for Tim).
export const CLIP_WORDS = {
  title: 'Add to Home Screen · TRIF',
  heading: 'Add to Home Screen',
  ready: 'Safari asks to download a profile: tap Allow. Then open Settings, tap Profile Downloaded near the top, and Install.',
  again: 'Download it again',
  none: 'The icon didn’t come through to this page. Go back to TRIF and tap Add to Home Screen again, or use Save to Files there.',
  bad: 'This link doesn’t hold a TRIF Home Screen icon, so nothing was made.',
};

export const CLIP = page(CLIP_WORDS.title, `
<h1>${CLIP_WORDS.heading}</h1>
<div class="card">
  <p id="ready" class="clip-line" hidden>${CLIP_WORDS.ready}</p>
  <p id="none" class="clip-line">${CLIP_WORDS.none}</p>
  <p id="bad" class="clip-line error" hidden>${CLIP_WORDS.bad}</p>
  <button id="again" type="button" hidden>${CLIP_WORDS.again}</button>
  <p id="debug" class="note" hidden></p>
</div>`, { script: '/clip.js', style: '.clip-line { margin: 0 0 14px; } .clip-line:last-of-type { margin-bottom: 0; } #again { margin-top: 6px; }' });

// The page's script: the # part read and cleared, the profile parsed (DOMParser: XML only) and checked, then the
// download. checkClip's own source, so the page and the tests check the same way.
export const CLIP_JS = `(() => {
  const $ = (id) => document.getElementById(id);
  const show = (id) => { for (const x of ['ready', 'none', 'bad']) $(x).hidden = x !== id; };
  const TOP_KEYS = ${JSON.stringify(TOP_KEYS)};
  const CLIP_KEYS = ${JSON.stringify(CLIP_KEYS)};
  ${CHECK_SRC}
  const raw = location.hash.slice(1);
  // (?debug: how much arrived after the #, for testing how the app's handover carries it)
  if (/[?&]debug\b/.test(location.search)) { $('debug').hidden = false; $('debug').textContent = 'location.hash.length ' + location.hash.length; }
  // (out of the address bar and the history at once: the profile isn't left behind)
  if (raw) history.replaceState(null, '', location.pathname);
  if (!raw) return show('none');
  let bytes;
  try {
    const b64 = decodeURIComponent(raw).replace(/-/g, '+').replace(/_/g, '/');
    bytes = Uint8Array.from(atob(b64 + '==='.slice((b64.length + 3) % 4)), (c) => c.charCodeAt(0));
  } catch (e) { return show('bad'); }
  if (bytes.length > 400000) return show('bad');
  // (an XML property list only: a binary one isn't read)
  const doc = new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'application/xml');
  if (doc.querySelector('parsererror') || !doc.documentElement || doc.documentElement.nodeName !== 'plist') return show('bad');
  const value = (n) => {
    switch (n.nodeName) {
      case 'dict': {
        const o = {};
        const kids = [...n.children];
        for (let i = 0; i < kids.length; i += 2) {
          if (kids[i].nodeName !== 'key' || !kids[i + 1]) throw new Error('a dict without its value');
          o[kids[i].textContent] = value(kids[i + 1]);
        }
        return o;
      }
      case 'array': return [...n.children].map(value);
      case 'string': return n.textContent;
      case 'integer': case 'real': return Number(n.textContent);
      case 'true': return true;
      case 'false': return false;
      case 'data': return { data: n.textContent.replace(/\\s+/g, '') };
      case 'date': return n.textContent;
      default: throw new Error('an unknown element');
    }
  };
  let profile;
  try { profile = doc.documentElement.children.length === 1 ? value(doc.documentElement.children[0]) : null; } catch (e) { return show('bad'); }
  if (checkClip(profile, TOP_KEYS, CLIP_KEYS)) return show('bad');
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/x-apple-aspen-config' }));
  const hand = () => { location.href = url; };
  show('ready');
  $('again').hidden = false;
  $('again').addEventListener('click', hand);
  hand();
})();
`;
