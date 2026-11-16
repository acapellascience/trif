// ==WebMod==
// @name        AI Banisher
// @description robots, begone!
// @match       https://www.google.com/
// @match       https://www.google.com/?*
// @match       https://www.google.com/webhp*
// @match       https://www.google.com/search*
// @run-at      document-start
// @risk        0 render-only
// @source      webmods
// @version     5
// @style
// ==/WebMod==
{
  "css": "/* AI Mode. In the search box it's a button (jsname B6rgad). On results pages it's also a tab in the\n   tab row, whose link carries udm=50 (Google's AI Mode URL parameter, which is language-neutral):\n   hide the tab's listitem and any other link to it. */\nbutton[jsname=B6rgad] { display: none !important; }\n[role=listitem]:has(a[href*=\"udm=50&\"], a[href$=\"udm=50\"]),\na[href*=\"udm=50&\"], a[href$=\"udm=50\"] { display: none !important; }\n/* The promo line under the search box's buttons (currently a Gemini ad), and its jsslot wrapper so\n   no empty gap is left. */\npromo-middle-slot,\n[jsslot]:has(> div > promo-middle-slot) { display: none !important; }\n/* AI Overview at the top of results, including its sticky \"Ask anything\" follow-up box: both live\n   in #m-x-content. Google serves several layouts: the overview in its own block in #rcnt next to\n   #center_col; both of those inside a [role=main] wrapper (display: contents) in #rcnt (Nov 2026);\n   or as the first block inside #rso with the results. Never hide #center_col, #rso, or anything\n   that contains them. */\n#rcnt > :not(#center_col):has(#m-x-content):not(:has(#center_col)),\n#rcnt > [role=main] > :not(#center_col):has(#m-x-content):not(:has(#center_col)),\n#rso > :has(#m-x-content):not(:has(a h3)),\n[data-lhcontainer]:has(#m-x-content):not(:has(#center_col)),\n#m-x-content { display: none !important; }"
}
