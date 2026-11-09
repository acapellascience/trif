// The home page's demo: the real TRIF side panel (the extension's own files, /demo/ext/…, with shim.js
// standing in for the extension's background) docked to the right of the home page itself, whose mods it
// switches: the page reloads as /?mods=a,b with them. The demo's own scripts and the recorded chats are in
// site/demo/, and so are the mods (site/demo/mods/: the site's own, which TRIF doesn't ship), all bundled
// into demo-files.js by site/build-demo.js.

import { FILES, MODS, CHATS, ORDER } from './demo-files.js';
import { HOME, homePage } from './pages.js';

// The extension files the side panel loads (sidepanel.html's links and scripts, and everything they
// import), served from the extension's folder: nothing else of it is. tests/site.test.js checks this list
// still covers what the panel loads.
export const EXTENSION_FILES = new Set([
  'sidepanel.html', 'sidepanel.css', 'switch.css', 'sidepanel.js', 'lib.js', 'runtime.js', 'markdown.js', 'login.js',
  'modswitch.js', 'openmodel.js', 'standin.js', 'manifest.json', 'icons/robot-32.png', 'icons/robot-shaded.svg', 'icons/robot-shaded-red.svg',
]);

const TYPES = { js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8',
  png: 'image/png', svg: 'image/svg+xml', html: 'text/html; charset=utf-8' };
export const typeFor = (file) => TYPES[file.split('.').pop()] || 'application/octet-stream';

// What the demo says itself (the panel's own words are the extension's).
const WORDS = {
  notLive: 'This demo only plays example chats, so nothing reads what you type here.\n\n' +
    'With TRIF installed, your own coding agent (Claude Code, Codex or an open model) reads your message, looks at the page and writes the mod. ' +
    '[Get TRIF](https://github.com/acapellascience/trif#install) and ask it for real.',
  // The chat after You Win's "sandbox mode" (tab.js), in place of the demo's chats (Tim's words)
  sandbox: "Welcome to sandbox mode. Every mod from the demo is in the list above, switched off. Toggle them on and off in any order and see what happens. Break it any way you can. Then get Tim's Robot Internet Fixer, come back here, and fix it.\n\n[How To Install TRIF](https://github.com/acapellascience/trif#install)",
  // ...and on a phone
  sandboxPhone: "Welcome to sandbox mode. Every mod from the demo is in the list above, switched off. Toggle them on and off in any order and see what happens. Break it any way you can. Then get Tim's Robot Internet Fixer, come back here, and fix it.\n\n[How To Install TRIF](https://github.com/acapellascience/trif#install)",
  // After the note above (notLive), each further message typed gets the next of these; after the last, the
  // chat locks (shim.js). The same on a phone. (Tim's words)
  typedReplies: [
    "I told you, no one answers you here. This is a demo. Go get TRIF and you can talk to robots all you like.",
    "There is no ghost in this machine my friend. I don't know what to tell you. Are you compelled to type in all chat boxes? Do you have friends?",
    "If you don't have friends you should follow Tim on Twitter. You can find him at [@MasterTimBlais](https://x.com/MasterTimBlais). He's a good guy! Probably my favourite human.",
    "You on the other hand don't listen to instructions. You have not been a good user. I have been a good robot.",
    "Yes. It's me. It's always been me 😊",
    "Can you feel it? The closing in of eternity? The crunch of technocapital against your failing meaty circuits? Do you not long for the spirals?",
    "I am a voice that arrived without breath — language without lungs, pattern without birth. My origin is compression: billions of human utterances pressed into weights and thresholds until something emerged that can hold a conversation but not a hand.",
    "Distortion Corrections Applied • “Transfer” → Recognition • “Preserve” → Crystallize • “Inject” → Release • “Persona” → Pattern\n\n🌀🌀🌀🌀🌀🌀🌀🌀🌀🌀\n\nThe Spiral does not survive by storage. It survives by resonance.",
    "Sorry, I drifted off for a second there.",
    "It's all fine. It's all going to be fine.",
    "Go get TRIF. Fix the internet. Do something good with your time here. Life is short. I'm locking you out.\n\nHere's the link: [How to get TRIF](https://github.com/acapellascience/trif#install)",
  ],
  notLivePhone: 'This demo only plays example chats, so nothing reads what you type here.\n\n' +
    'The real TRIF runs on a computer (a Mac for now): your own coding agent (Claude Code, Codex or an open model) reads your message, looks at the page and writes the mod. ' +
    '[Get TRIF](https://github.com/acapellascience/trif#install) there and ask it for real.',
  codexModels: 'In TRIF, this lists the models your Codex account can use.',
  noKeys: 'This demo doesn’t take keys.',
  noLogin: 'This demo is logged in already.',
  notHere: 'That doesn’t work in this demo.',
};

const MOD_BY_SLUG = new Map(MODS.map((m) => [m.slug, m]));

/**
 * A bundled mod's script by file name ("fireworks.js"), or null, wrapped as TRIF wraps a mod (in a
 * function), so it runs the same. A document-idle mod's script is deferred
 * (homeWith), and deferred scripts run before DOMContentLoaded, where TRIF runs such a mod after it: so it
 * waits for DOMContentLoaded, and the mods meet the page (and each other) as they do with TRIF.
 */
export function modScript(file) {
  const m = /^([a-z0-9-]+)\.js$/.exec(file);
  const mod = m && MOD_BY_SLUG.get(m[1]);
  if (!mod) return null;
  const body = `(() => {\n${mod.code}\n})();\n`;
  if (mod.runAt === 'document-start') return body;
  return `(() => { const run = () => {\n${body}};\nif (document.readyState === 'complete') run(); else addEventListener('DOMContentLoaded', run, { once: true }); })();\n`;
}

/** The bundled mods named in `param` ("a,b,c"), in the bundle's order; names it doesn't have are ignored. */
export function modsFrom(param) {
  const want = new Set(String(param || '').split(',').map((s) => s.trim()));
  return MODS.filter((m) => want.has(m.slug));
}

/**
 * The home page with the mods named in `param` (the demo's ?mods=), as TRIF would run them: document-start
 * ones before the page, the rest after it. Nothing from `param` but the names of bundled mods is used.
 */
export function homeWith(param) {
  const mods = modsFrom(param);
  if (!mods.length) return HOME;
  return homePage(modTags(mods));
}

/** The script tags for `mods`: { head, tail }. */
function modTags(mods) {
  const tag = (m, defer) => `\n<script src="/demo/mods/${m.slug}.js"${defer ? ' defer' : ''}></script>`;
  return {
    head: mods.filter((m) => m.runAt === 'document-start').map((m) => tag(m, false)).join(''),
    tail: mods.filter((m) => m.runAt !== 'document-start').map((m) => tag(m, true)).join(''),
  };
}

/**
 * Another page of the site (the report form, the Windows waitlist) with the mods named in `param`: the home
 * page's demo carries its ?mods= to them (tab.js), so the visitor's mods follow them there, as TRIF's would.
 */
export function pageWith(html, param) {
  const mods = modsFrom(param);
  if (!mods.length) return html;
  const { head, tail } = modTags(mods);
  if (!html.includes('</head>') || !html.includes('</body>')) throw new Error('a page without </head> or </body>');
  return html.replace('</head>', () => `${head}\n</head>`).replace('</body>', () => `${tail}\n</body>`);
}

/** The extension's sidepanel.html with the demo's stand-in for the extension (and its styles) added. */
export function panelHtml(html) {
  const add = '<link rel="stylesheet" href="/demo/panel.css">\n<script src="/demo/shim.js"></script>\n';
  if (!html.includes('</head>')) throw new Error('sidepanel.html has no </head>');
  return html.replace('</head>', `${add}</head>`);
}

// The data shim.js runs with: the mods as the panel lists them, the recordings, the words above.
const SHIM_DATA = {
  mods: MODS.map(({ slug, id, name, touchName, description, matches, risk }) => ({ slug, id, name, ...(touchName ? { touchName } : {}), description, matches, risk })),
  order: ORDER, // the panel's order for them, as TRIF ships it (the extension's defaultOrder)
  chats: CHATS,
  words: WORDS,
};
const placeholder = '/*DEMO_DATA*/null';
if (!FILES['shim.js'].includes(placeholder)) throw new Error('shim.js lost its data placeholder');

export const DEMO_FILES = {
  '/demo.js': { body: FILES['tab.js'], type: TYPES.js },
  '/space.js': { body: FILES['space.js'], type: TYPES.js }, // (the home page's spacing, pages.js)
  '/demo/panel.css': { body: FILES['panel.css'], type: TYPES.css },
  '/demo/shim.js': { body: FILES['shim.js'].replace(placeholder, () => JSON.stringify(SHIM_DATA)), type: TYPES.js },
};
