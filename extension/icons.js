// Line icons for the panel's mod rows (sidepanel.js, modlevel.js modIcons): one per power, and one each for
// "noticeable" and "changes requests". From Tabler Icons 3.35.0 (outline), MIT License, Copyright (c) 2020-2025
// Paweł Kuna (https://tabler.io/icons): the paths of a 24×24 grid, drawn with stroke="currentColor",
// stroke-width 2, round caps and joins, no fill. Copied in so nothing loads from elsewhere.

export const ICONS = {
  'read-drafts': ['M10 12h4', 'M9 4a3 3 0 0 1 3 3v10a3 3 0 0 1 -3 3', 'M15 4a3 3 0 0 0 -3 3v10a3 3 0 0 0 3 3'], // tabler cursor-text
  'write-drafts': ['M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4', 'M13.5 6.5l4 4'], // tabler pencil
  'keys': ['M2 6m0 2a2 2 0 0 1 2 -2h16a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-16a2 2 0 0 1 -2 -2z', 'M6 10l0 .01', 'M10 10l0 .01', 'M14 10l0 .01', 'M18 10l0 .01', 'M6 14l0 .01', 'M18 14l0 .01', 'M10 14l4 .01'], // tabler keyboard
  'site-data': ['M4 4h16v2.172a2 2 0 0 1 -.586 1.414l-4.414 4.414v7l-6 2v-8.5l-4.48 -4.928a2 2 0 0 1 -.52 -1.345v-2.227z'], // tabler filter
  'page-data': ['M12 6m-8 0a8 3 0 1 0 16 0a8 3 0 1 0 -16 0', 'M4 6v6a8 3 0 0 0 16 0v-6', 'M4 12v6a8 3 0 0 0 16 0v-6'], // tabler database
  'site-storage': ['M3 4m0 2a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v0a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2z', 'M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-10', 'M10 12l4 0'], // tabler archive
  'local-fonts': ['M4 20l3 0', 'M14 20l7 0', 'M6.9 15l6.9 0', 'M10.2 6.3l5.8 13.7', 'M5 20l6 -16l2 0l7 16'], // tabler typography
  'image-variants': ['M15 8h.01', 'M3 6a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v12a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3v-12z', 'M3 16l5 -5c.928 -.893 2.072 -.893 3 0l5 5', 'M14 14l1 -1c.928 -.893 2.072 -.893 3 0l3 3'], // tabler photo
  'sound': ['M15 8a5 5 0 0 1 0 8', 'M17.7 5a9 9 0 0 1 0 14', 'M6 15h-2a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1h2l3.5 -4.5a.8 .8 0 0 1 1.5 .5v14a.8 .8 0 0 1 -1.5 .5l-3.5 -4.5'], // tabler volume
  'controls': ['M14 6m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0', 'M4 6l8 0', 'M16 6l4 0', 'M8 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0', 'M4 12l2 0', 'M10 12l10 0', 'M17 18m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0', 'M4 18l11 0', 'M19 18l1 0'], // tabler adjustments-horizontal
  'mods': ['M7 12l5 5l-1.5 1.5a3.536 3.536 0 1 1 -5 -5l1.5 -1.5z', 'M17 12l-5 -5l1.5 -1.5a3.536 3.536 0 1 1 5 5l-1.5 1.5z', 'M3 21l2.5 -2.5', 'M18.5 5.5l2.5 -2.5', 'M10 11l-2 2', 'M13 14l-2 2'], // tabler plug-connected
  'preload': ['M13 3l0 7l6 0l-8 11l0 -7l-6 0l8 -11'], // tabler bolt
  'media': ['M7 4v16l13 -8z'], // tabler player-play
  'search-box': ['M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0', 'M21 21l-6 -6'], // tabler search
  'go-to': ['M13 12v.01', 'M3 21h18', 'M5 21v-16a2 2 0 0 1 2 -2h6m4 10.5v7.5', 'M21 7h-7m3 -3l-3 3l3 3'], // tabler door-enter
  'embeds': ['M4 4m0 2a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z', 'M8 4l0 16', 'M16 4l0 16', 'M4 8l4 0', 'M4 16l4 0', 'M4 12l16 0', 'M16 8l4 0', 'M16 16l4 0'], // tabler movie
  'rewrite-requests': ['M3 3m0 1a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z', 'M15 15m0 1a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z', 'M21 11v-3a2 2 0 0 0 -2 -2h-6l3 3m0 -6l-3 3', 'M3 13v3a2 2 0 0 0 2 2h6l-3 -3m0 6l3 -3'], // tabler replace
  'block-events': ['M8 13v-7.5a1.5 1.5 0 0 1 3 0v6.5', 'M11 5.5v-2a1.5 1.5 0 1 1 3 0v8.5', 'M14 5.5a1.5 1.5 0 0 1 3 0v6.5', 'M17 7.5a1.5 1.5 0 0 1 3 0v8.5a6 6 0 0 1 -6 6h-2h.208a6 6 0 0 1 -5.012 -2.7a69.74 69.74 0 0 1 -.196 -.3c-.312 -.479 -1.407 -2.388 -3.286 -5.728a1.5 1.5 0 0 1 .536 -2.022a1.867 1.867 0 0 1 2.28 .28l1.47 1.47'], // tabler hand-stop
  'page-events': ['M18.364 19.364a9 9 0 1 0 -12.728 0', 'M15.536 16.536a5 5 0 1 0 -7.072 0', 'M12 13m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0'], // tabler broadcast
  'click': ['M7.904 17.563a1.2 1.2 0 0 0 2.228 .308l2.09 -3.093l4.907 4.907a1.067 1.067 0 0 0 1.509 0l1.047 -1.047a1.067 1.067 0 0 0 0 -1.509l-4.907 -4.907l3.113 -2.09a1.2 1.2 0 0 0 -.309 -2.228l-13.582 -3.904l3.904 13.563z'], // tabler pointer
  'edit-uploads': ['M15 7l-6.5 6.5a1.5 1.5 0 0 0 3 3l6.5 -6.5a3 3 0 0 0 -6 -6l-6.5 6.5a4.5 4.5 0 0 0 9 9l6.5 -6.5'], // tabler paperclip
  '@migrate': ['M14 3v4a1 1 0 0 0 1 1h4', 'M5 13v-8a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2h-5.5m-9.5 -2h7m-3 -3l3 3l-3 3'], // tabler file-import
  'noticeable': ['M10 12a2 2 0 1 0 4 0a2 2 0 0 0 -4 0', 'M21 12c-2.4 4 -5.4 6 -9 6c-3.6 0 -6.6 -2 -9 -6c2.4 -4 5.4 -6 9 -6c3.6 0 6.6 2 9 6'], // tabler eye
  'changes-requests': ['M7 18a4.6 4.4 0 0 1 0 -9a5 4.5 0 0 1 11 2h1a3.5 3.5 0 0 1 0 7h-1', 'M9 15l3 -3l3 3', 'M12 12l0 9'], // tabler cloud-upload
};

const SVG_NS = 'http://www.w3.org/2000/svg';
/** An <svg> of one icon (a key of ICONS), sized by CSS, coloured by the text colour; null for an unknown key. */
export function iconSvg(key) {
  const paths = Object.prototype.hasOwnProperty.call(ICONS, key) ? ICONS[key] : null;
  if (!paths) return null;
  const svg = document.createElementNS(SVG_NS, 'svg');
  for (const [k, v] of [['viewBox', '0 0 24 24'], ['fill', 'none'], ['stroke', 'currentColor'], ['stroke-width', '2'], ['stroke-linecap', 'round'], ['stroke-linejoin', 'round'], ['aria-hidden', 'true'], ['focusable', 'false']]) svg.setAttribute(k, v);
  for (const d of paths) { const p = document.createElementNS(SVG_NS, 'path'); p.setAttribute('d', d); svg.append(p); }
  return svg;
}
