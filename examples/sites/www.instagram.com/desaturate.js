// ==WebMod==
// @name        Desaturate
// @description Turns Instagram's colours down to 35% saturation
// @match       https://www.instagram.com/*
// @run-at      document-start
// @risk        0 render-only
// @source      webmods
// @version     3
// @style
// ==/WebMod==
{
  "css": "html { filter: saturate(0.35) !important; }"
}
