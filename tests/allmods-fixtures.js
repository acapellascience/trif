'use strict';
// Mods for the All mods page's tests (tests/allmods-browser.test.js): about thirty across eight sites, plus
// every site and the phone view, of all three tiers; `extra` more for the page's speed with 200+.

const fs = require('fs');
const path = require('path');

const head = ({ name, description, matches, kind, powers }) => [
  '// ==WebMod==',
  `// @name        ${name}`,
  `// @description ${description}`,
  ...matches.map((m) => `// @match       ${m}`),
  ...(kind === 'style' ? ['// @style'] : kind === 'boxed' ? ['// @boxed', ...(powers ? [`// @powers     ${powers}`] : []), ...(powers === 'click' ? ['// @click      the tab: [role="tab"]'] : [])] : []),
  '// @risk        0 render-only',
  '// ==/WebMod==',
  '',
].join('\n');

const body = (kind, token) => (kind === 'style'
  ? `{\n  "css": "/* ${token} */ body { outline: 0 }",\n  "hide": [],\n  "replace": [],\n  "filter": []\n}\n`
  : kind === 'boxed'
    ? `// ${token}\ntrif.css('body { outline: 0 }');\n`
    : `// ${token}\ndocument.documentElement.dataset.allmodsTest = '1';\n`);

const site = (s) => (s === 'all-sites' ? ['*://*/*'] : [`*://${s}/*`, `*://*.${s}/*`]);
const phoneSite = (s) => site(s.replace(/^phone~/, ''));

// [folder, file, name, description, kind, powers]
const MODS = [
  ['all-sites', 'quiet-autoplay', 'Quiet Autoplay', 'Stops videos playing by themselves', 'boxed', 'media'],
  ['all-sites', 'readable-width', 'Readable Width', 'Keeps long text to a comfortable width', 'style'],
  ['x.com', 'hide-trends', 'Hide Trends', 'No trending box in the sidebar', 'style'],
  ['x.com', 'calm-counts', 'Calm Counts', 'Hides like and repost counts', 'style'],
  ['x.com', 'following-first', 'Following First', 'Opens on the Following tab', 'boxed', 'click'],
  ['x.com', 'mute-words', 'Mute Words', 'Hides posts with words you pick', 'boxed'],
  ['x.com', 'link-cleaner', 'Link Cleaner', 'Takes tracking bits out of links you copy', 'free'],
  ['google.com', 'plain-results', 'Plain Results', 'Only the ten blue links', 'style'],
  ['google.com', 'no-ai-box', 'No AI Box', 'Hides the AI overview', 'style'],
  ['google.com', 'dark-search', 'Dark Search', 'A dark theme for results', 'style'],
  ['google.com', 'search-keys', 'Search Keys', 'Arrow keys move through results', 'boxed', 'keys'],
  ['youtube.com', 'no-shorts', 'No Shorts', 'Hides Shorts everywhere', 'style'],
  ['youtube.com', 'theater-default', 'Theater Default', 'Opens videos in theater mode', 'boxed', 'click'],
  ['youtube.com', 'hide-comments', 'Hide Comments', 'Comments folded until you ask', 'style'],
  ['youtube.com', 'speed-memory', 'Speed Memory', 'Remembers your playback speed', 'free'],
  ['reddit.com', 'old-layout', 'Old Layout', 'Compact posts, like old Reddit', 'style'],
  ['reddit.com', 'no-promoted', 'No Promoted', 'Hides promoted posts', 'style'],
  ['reddit.com', 'collapse-bots', 'Collapse Bots', 'Folds replies from bots', 'boxed'],
  ['github.com', 'wide-diffs', 'Wide Diffs', 'Diffs use the whole window', 'style'],
  ['github.com', 'file-tree', 'File Tree', 'A file tree beside pull requests', 'boxed', 'controls'],
  ['github.com', 'copy-sha', 'Copy SHA', 'One click copies a commit hash', 'free'],
  ['wikipedia.org', 'reading-mode', 'Reading Mode', 'Bigger type, fewer boxes', 'style'],
  ['wikipedia.org', 'no-banners', 'No Banners', 'Hides donation banners', 'style'],
  ['wikipedia.org', 'link-previews', 'Link Previews', 'Shows a summary when you hover a link', 'boxed', 'page-data'],
  ['news.ycombinator.com', 'dark-hn', 'Dark HN', 'A dark orange-free theme', 'style'],
  ['news.ycombinator.com', 'collapse-threads', 'Collapse Threads', 'Folds long threads', 'boxed'],
  ['amazon.com', 'simple-product', 'Simple Product', 'Just the product, price and reviews', 'style'],
  ['amazon.com', 'unit-prices', 'Unit Prices', 'Shows the price per unit first', 'boxed'],
  ['phone~x.com', 'thumb-nav', 'Thumb Nav', 'Moves the tabs within reach', 'style'],
  ['phone~x.com', 'no-app-banner', 'No App Banner', 'Hides "Open in the app"', 'style'],
  ['phone~youtube.com', 'mini-player', 'Mini Player', 'Keeps a small player while you scroll', 'boxed'],
];

/** Writes the mods into `modsDir` (sites/), each with a token in its code only: code-<file>. Returns their ids. */
function writeFixtureMods(modsDir, { extra = 0 } = {}) {
  const ids = [];
  for (const [folder, file, name, description, kind, powers] of MODS) {
    const dir = path.join(modsDir, folder);
    fs.mkdirSync(dir, { recursive: true });
    const matches = folder.startsWith('phone~') ? phoneSite(folder) : site(folder);
    fs.writeFileSync(path.join(dir, `${file}.js`), head({ name, description, matches, kind, powers }) + body(kind, `code-${file}`));
    ids.push(`${folder}/${file}`);
  }
  for (let i = 0; i < extra; i++) {
    const folder = `filler${String(i % 40).padStart(2, '0')}.example`;
    const file = `filler-${i}`;
    fs.mkdirSync(path.join(modsDir, folder), { recursive: true });
    fs.writeFileSync(path.join(modsDir, folder, `${file}.js`), head({ name: `Filler ${i}`, description: `Filler mod number ${i}`, matches: site(folder), kind: i % 3 ? 'style' : 'boxed' }) + body(i % 3 ? 'style' : 'boxed', `code-${file}`));
    ids.push(`${folder}/${file}`);
  }
  return ids;
}

/** A free mod that sends a request: TRIF holds it (new, from outside the chat) until the user allows it. */
function writeHeldMod(modsDir) {
  const dir = path.join(modsDir, 'github.com');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'star-counter.js'), `${head({ name: 'Star Counter', description: 'Shows stars next to repo links', matches: site('github.com'), kind: 'free' })}fetch('https://api.github.com/repos/acapellascience/trif').then((r) => r.json());\n`);
  return 'github.com/star-counter';
}

module.exports = { MODS, writeFixtureMods, writeHeldMod };
