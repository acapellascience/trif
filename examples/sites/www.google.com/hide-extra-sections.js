// ==WebMod==
// @name        Just Results
// @description no sponsors, no mess
// @match       https://www.google.com/search*
// @run-at      document-start
// @risk        1 hides ads, so Google's ad impression reports for them never fire
// @source      webmods
// @version     4
// @style
// ==/WebMod==
{
  "css": "/* Sponsored results: each sponsored block (top and bottom, text ads and the \"Featured products\"\n   carousel) sits in a [data-dsktp-pla-or-su] wrapper, and each text ad carries data-text-ad.\n   #tads/#bottomads/#tvcap are the older ad containers, kept as a backup. */\n[data-dsktp-pla-or-su], [data-text-ad],\n#tads, #bottomads, #tvcap { display: none !important; }\n/* Everything that isn't a plain web result. [data-rpos] is each block in the results list. A plain\n   web result has its title as an <h3> inside a link; carousels and widgets (Short videos, Images,\n   People also ask, Top stories…) don't, so any block without one goes. data-initq (People also ask)\n   and data-iu (Images) are kept as a backup. #bres holds \"People also search for\" / related\n   searches at the bottom. */\n#rso [data-rpos]:not(:has(a h3)),\n[data-rpos]:has([data-initq]), [data-initq],\n[data-rpos]:has([data-iu]),\n#bres { display: none !important; }"
}
