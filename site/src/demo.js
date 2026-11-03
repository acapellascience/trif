// The home page's demo: a browser window (/demo) with the home page in it (/demo/home, with the mods that
// are on) and the real TRIF side panel beside it (the extension's own files, /demo/ext/…, with shim.js
// standing in for the extension's background). The demo's own scripts, the mods and the recorded chats are
// in site/demo/, bundled into demo-files.js by site/build-demo.js.

import { FILES, MODS, CHATS } from './demo-files.js';
import { TOKENS, homePage } from './pages.js';

// The extension files the side panel loads (sidepanel.html's links and scripts, and everything they
// import), served from the extension's folder: nothing else of it is. tests/site.test.js checks this list
// still covers what the panel loads.
export const EXTENSION_FILES = new Set([
  'sidepanel.html', 'sidepanel.css', 'switch.css', 'sidepanel.js', 'lib.js', 'runtime.js', 'markdown.js', 'login.js',
  'modswitch.js', 'openmodel.js', 'manifest.json', 'icons/robot-32.png', 'icons/robot-shaded.svg', 'icons/robot-shaded-red.svg',
]);

const TYPES = { js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8',
  png: 'image/png', svg: 'image/svg+xml', html: 'text/html; charset=utf-8' };
export const typeFor = (file) => TYPES[file.split('.').pop()] || 'application/octet-stream';

// What the demo says itself (the panel's own words are the extension's).
const WORDS = {
  recorded: 'Recorded chats: pick one to replay it',
  replaying: 'Replaying a recording, sped up about {n}×',
  allReplayed: 'Recorded chats',
  allReplayedNote: 'That’s all the recordings. Switch the mods above on and off, or get TRIF and make your own.',
  notLive: 'This demo only replays recorded chats, so nothing reads what you type here: pick one under “Recorded chats”. ' +
    'The real TRIF sends your message to your own coding agent (Claude Code, Codex or an open model) on your computer, and it writes the mod.',
  codexModels: 'In TRIF, this lists the models your Codex account can use.',
  noKeys: 'This demo doesn’t take keys.',
  noLogin: 'This demo is logged in already.',
  notHere: 'That doesn’t work in this demo.',
};

const MOD_BY_SLUG = new Map(MODS.map((m) => [m.slug, m]));

/** A bundled mod's script by file name ("fireworks.js"), or null. */
export function modScript(file) {
  const m = /^([a-z0-9-]+)\.js$/.exec(file);
  return (m && MOD_BY_SLUG.get(m[1])?.code) || null;
}

/** The bundled mods named in `param` ("a,b,c"), in the bundle's order; names it doesn't have are ignored. */
export function modsFrom(param) {
  const want = new Set(String(param || '').split(',').map((s) => s.trim()));
  return MODS.filter((m) => want.has(m.slug));
}

/**
 * The home page inside the demo's window: no demo tab, links open in a new tab (not inside the window),
 * and the mods that are on, as TRIF would run them: document-start ones before the page, the rest after.
 */
export function innerHome(param) {
  const mods = modsFrom(param);
  const tag = (m, defer) => `\n<script src="/demo/mods/${m.slug}.js"${defer ? ' defer' : ''}></script>`;
  return homePage({
    demo: false,
    head: '\n<base target="_blank">' + mods.filter((m) => m.runAt === 'document-start').map((m) => tag(m, false)).join(''),
    tail: mods.filter((m) => m.runAt !== 'document-start').map((m) => tag(m, true)).join(''),
  });
}

/** The extension's sidepanel.html with the demo's stand-in for the extension (and its styles) added. */
export function panelHtml(html) {
  const add = '<link rel="stylesheet" href="/demo/panel.css">\n<script src="/demo/shim.js"></script>\n';
  if (!html.includes('</head>')) throw new Error('sidepanel.html has no </head>');
  return html.replace('</head>', `${add}</head>`);
}

// The data shim.js runs with: the mods as the panel lists them, the recordings, the words above.
const SHIM_DATA = {
  mods: MODS.map(({ slug, id, name, description, matches, risk }) => ({ slug, id, name, description, matches, risk })),
  chats: CHATS,
  words: WORDS,
};
const placeholder = '/*DEMO_DATA*/null';
if (!FILES['shim.js'].includes(placeholder)) throw new Error('shim.js lost its data placeholder');

export const DEMO_FILES = {
  '/demo.js': { body: FILES['tab.js'], type: TYPES.js },
  '/demo/frame.js': { body: FILES['frame.js'], type: TYPES.js },
  '/demo/panel.css': { body: FILES['panel.css'], type: TYPES.css },
  '/demo/shim.js': { body: FILES['shim.js'].replace(placeholder, () => JSON.stringify(SHIM_DATA)), type: TYPES.js },
};

const DEMO_STYLE = `${TOKENS}
html, body { height: 100%; }
body { margin: 0; background: var(--card); color: var(--fg); font: 13px/1.4 -apple-system, system-ui, "Segoe UI", sans-serif; }
.win { height: 100%; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; }
.top { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-bottom: 1px solid var(--line); }
.dots { display: flex; gap: 6px; padding: 0 4px; }
.dots i { width: 10px; height: 10px; border-radius: 50%; background: var(--line); }
.url { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; padding: 5px 12px; border-radius: 999px;
  background: var(--bg); color: var(--fg); white-space: nowrap; overflow: hidden; }
.url svg { flex: none; width: 12px; height: 12px; color: var(--muted); }
.tb { flex: none; display: inline-grid; place-items: center; min-width: 28px; height: 28px; padding: 0 8px; border: 1px solid transparent;
  border-radius: 7px; background: none; color: var(--muted); font: inherit; font-weight: 600; cursor: pointer; text-decoration: none; }
.tb:hover { background: var(--bg); color: var(--fg); }
.tb[hidden] { display: none; }
.tb svg { width: 15px; height: 15px; }
svg { fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.body { display: grid; grid-template-columns: minmax(0, 1fr) 360px; min-height: 0; }
.body iframe { display: block; width: 100%; height: 100%; border: 0; background: var(--bg); }
#panel { border-left: 1px solid var(--line); }
.label { margin: 0; padding: 6px 12px; border-top: 1px solid var(--line); color: var(--muted); font-size: 12px; }
@media (max-width: 860px) { .body { grid-template-columns: minmax(0, 1fr) 320px; } }
@media (max-width: 640px) {
  .body { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) minmax(0, 2fr); }
  #panel { border-left: 0; border-top: 1px solid var(--line); }
  .dots { display: none; }
}
@media (max-width: 700px) { #big { display: none; } }
`;

export const DEMO_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TRIF demo</title>
<style>${DEMO_STYLE}</style>
</head>
<body>
<div class="win">
  <div class="top">
    <span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>
    <button id="reload" class="tb" type="button" title="Reload the page" aria-label="Reload the page"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.5-3.55"/><path d="M13 2.5v3h-3"/></svg></button>
    <div class="url"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/></svg><span>timsrobot.com</span></div>
    <button id="big" class="tb" type="button" aria-pressed="false" hidden>Pop out</button>
    <button id="close" class="tb" type="button" title="Close the demo" aria-label="Close the demo" hidden><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg></button>
    <a id="home" class="tb" href="/" hidden>Back</a>
  </div>
  <div class="body">
    <iframe id="page" src="/demo/home" title="timsrobot.com, the page being fixed"></iframe>
    <iframe id="panel" src="/demo/ext/sidepanel.html" title="The TRIF side panel"></iframe>
  </div>
  <p class="label">Demo: the real TRIF side panel, with recordings of real Claude Code chats, sped up. The switches really run the mods on this page.</p>
</div>
<script src="/demo/frame.js"></script>
</body>
</html>
`;
