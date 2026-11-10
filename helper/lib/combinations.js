'use strict';
// Power combinations (docs/POWER-COMBINATIONS.md is this table, written out; docs/SAFE-MODS.md says why).
// Every pair and every triple of the twelve powers, each with a warning the hold shows, or why it adds
// nothing to what its powers do alone. "Adds" means: together they can carry what a mod reads off the page,
// or act as you, in a way none of them (or, for a triple, none of its pairs) can. Within one mod, and across
// the boxed mods on a page, which see each other's elements and can talk over `mods`: the sandbox's
// page-wide rules (extension/sandbox.js ACT_PARTNERS) keep a combination split across mods from slipping
// past the hold.
//
// The hold (boxpowers.js powerNeeds): each warned combination a mod has is a need of its own, keyed by its
// powers (`power:together:a+b[+c]`), so approving a pair doesn't cover a triple; the panel shows them in the
// red box, the strongest first, one line each ("Together, it …"). A mod with more than three powers gets
// MANY instead (its combinations are still needs, keyed, without lines of their own).

// The order the table is written in (boxpowers.js NAMES; tests/combinations.test.js checks they match).
const POWERS = ['read-drafts', 'keys', 'site-data', 'page-data', 'sound', 'controls', 'mods', 'media', 'search-box', 'go-to', 'click', 'write-drafts'];
const READS = ['read-drafts', 'keys', 'site-data', 'page-data'];

// The warnings, strongest first (rank). Each is a fact after "it", like the powers' own.
const WARNINGS = {
  'read-post-for-you': { rank: 1, fact: 'could put what it reads into a post and send it for you' },
  'go-post-for-you': { rank: 2, fact: 'could go to a page, write a post there and send it for you' },
  'post-for-you': { rank: 3, fact: 'could write a post and send it for you' },
  'read-into-post': { rank: 4, fact: 'could put what it reads into something you post' },
  'go-and-click': { rank: 5, fact: 'could take you to a page and click things there for you' },
  'read-decides-click': { rank: 6, fact: 'could let what it reads decide what it clicks for you' },
  'read-through-media': { rank: 7, fact: 'could pass what it reads to the site a video or sound comes from, by how it plays it' },
  'read-into-sound': { rank: 8, fact: 'could turn what it reads into sounds that a device nearby could pick up' },
};
// (Tim's words, for a mod with more than three powers, in place of the lines above)
const MANY = 'Mods with many powers can act in unspecific or powerful ways. Treat this with caution.';
const MANY_OVER = 3;

// Every pair (66) and triple (220), in POWERS order: { warn: <WARNINGS key> }, or why it adds no risk.
const COMBINATIONS = {
  'read-drafts+keys': 'both only read: nothing they read can leave the page without something that acts',
  'read-drafts+site-data': 'both only read: nothing they read can leave the page without something that acts',
  'read-drafts+page-data': 'both only read: nothing they read can leave the page without something that acts',
  'read-drafts+sound': { warn: 'read-into-sound' },
  'read-drafts+controls': 'its own controls only take what you give the mod on purpose, and show nothing it couldn\'t show in its own elements',
  'read-drafts+mods': 'a channel only reaches its other boxed mods, and the page-wide rules treat the boxed mods on a page as one',
  'read-drafts+media': { warn: 'read-through-media' },
  'read-drafts+search-box': 'the search box only takes what you type, and the mod can\'t fill or read it',
  'read-drafts+go-to': 'it only goes to this site\'s own pages (fixed paths, or links the page shows), and that site can already see what it reads',
  'read-drafts+click': { warn: 'read-decides-click' },
  'read-drafts+write-drafts': { warn: 'read-into-post' },
  'keys+site-data': 'both only read: nothing they read can leave the page without something that acts',
  'keys+page-data': 'both only read: nothing they read can leave the page without something that acts',
  'keys+sound': { warn: 'read-into-sound' },
  'keys+controls': 'its own controls only take what you give the mod on purpose, and show nothing it couldn\'t show in its own elements',
  'keys+mods': 'a channel only reaches its other boxed mods, and the page-wide rules treat the boxed mods on a page as one',
  'keys+media': { warn: 'read-through-media' },
  'keys+search-box': 'the search box only takes what you type, and the mod can\'t fill or read it',
  'keys+go-to': 'it only goes to this site\'s own pages (fixed paths, or links the page shows), and that site can already see what it reads',
  'keys+click': { warn: 'read-decides-click' },
  'keys+write-drafts': { warn: 'read-into-post' },
  'site-data+page-data': 'both only read: nothing they read can leave the page without something that acts',
  'site-data+sound': { warn: 'read-into-sound' },
  'site-data+controls': 'its own controls only take what you give the mod on purpose, and show nothing it couldn\'t show in its own elements',
  'site-data+mods': 'a channel only reaches its other boxed mods, and the page-wide rules treat the boxed mods on a page as one',
  'site-data+media': { warn: 'read-through-media' },
  'site-data+search-box': 'the search box only takes what you type, and the mod can\'t fill or read it',
  'site-data+go-to': 'it only goes to this site\'s own pages (fixed paths, or links the page shows), and that site can already see what it reads',
  'site-data+click': { warn: 'read-decides-click' },
  'site-data+write-drafts': { warn: 'read-into-post' },
  'page-data+sound': { warn: 'read-into-sound' },
  'page-data+controls': 'its own controls only take what you give the mod on purpose, and show nothing it couldn\'t show in its own elements',
  'page-data+mods': 'a channel only reaches its other boxed mods, and the page-wide rules treat the boxed mods on a page as one',
  'page-data+media': { warn: 'read-through-media' },
  'page-data+search-box': 'the search box only takes what you type, and the mod can\'t fill or read it',
  'page-data+go-to': 'it only goes to this site\'s own pages (fixed paths, or links the page shows), and that site can already see what it reads',
  'page-data+click': { warn: 'read-decides-click' },
  'page-data+write-drafts': { warn: 'read-into-post' },
  'sound+controls': 'its own controls only take what you give the mod on purpose, and show nothing it couldn\'t show in its own elements',
  'sound+mods': 'a channel only reaches its other boxed mods, and the page-wide rules treat the boxed mods on a page as one',
  'sound+media': 'neither reads more than the page shows, and together they don\'t post, send or act for you beyond what each does alone',
  'sound+search-box': 'the search box only takes what you type, and the mod can\'t fill or read it',
  'sound+go-to': 'neither reads more than the page shows, and together they don\'t post, send or act for you beyond what each does alone',
  'sound+click': 'neither reads more than the page shows, and together they don\'t post, send or act for you beyond what each does alone',
  'sound+write-drafts': 'a draft it changes still waits for you to post it, and the other power carries nothing into it or sends it',
  'controls+mods': 'a channel only reaches its other boxed mods, and the page-wide rules treat the boxed mods on a page as one',
  'controls+media': 'its own controls only take what you give the mod on purpose, and show nothing it couldn\'t show in its own elements',
  'controls+search-box': 'its own controls only take what you give the mod on purpose, and show nothing it couldn\'t show in its own elements',
  'controls+go-to': 'its own controls only take what you give the mod on purpose, and show nothing it couldn\'t show in its own elements',
  'controls+click': 'its own controls only take what you give the mod on purpose, and show nothing it couldn\'t show in its own elements',
  'controls+write-drafts': 'its own controls only take what you give the mod on purpose, and show nothing it couldn\'t show in its own elements',
  'mods+media': 'a channel only reaches its other boxed mods, and the page-wide rules treat the boxed mods on a page as one',
  'mods+search-box': 'a channel only reaches its other boxed mods, and the page-wide rules treat the boxed mods on a page as one',
  'mods+go-to': 'a channel only reaches its other boxed mods, and the page-wide rules treat the boxed mods on a page as one',
  'mods+click': 'a channel only reaches its other boxed mods, and the page-wide rules treat the boxed mods on a page as one',
  'mods+write-drafts': 'a channel only reaches its other boxed mods, and the page-wide rules treat the boxed mods on a page as one',
  'media+search-box': 'the search box only takes what you type, and the mod can\'t fill or read it',
  'media+go-to': 'neither reads more than the page shows, and together they don\'t post, send or act for you beyond what each does alone',
  'media+click': 'neither reads more than the page shows, and together they don\'t post, send or act for you beyond what each does alone',
  'media+write-drafts': 'a draft it changes still waits for you to post it, and the other power carries nothing into it or sends it',
  'search-box+go-to': 'the search box only takes what you type, and the mod can\'t fill or read it',
  'search-box+click': 'the search box only takes what you type, and the mod can\'t fill or read it',
  'search-box+write-drafts': 'the search box only takes what you type, and the mod can\'t fill or read it',
  'go-to+click': { warn: 'go-and-click' },
  'go-to+write-drafts': 'a draft it changes still waits for you to post it, and the other power carries nothing into it or sends it',
  'click+write-drafts': { warn: 'post-for-you' },
  'read-drafts+keys+site-data': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'read-drafts+keys+page-data': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'read-drafts+keys+sound': 'no more than its pairs: their warnings show',
  'read-drafts+keys+controls': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'read-drafts+keys+mods': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'read-drafts+keys+media': 'no more than its pairs: their warnings show',
  'read-drafts+keys+search-box': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'read-drafts+keys+go-to': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'read-drafts+keys+click': 'no more than its pairs: their warnings show',
  'read-drafts+keys+write-drafts': 'no more than its pairs: their warnings show',
  'read-drafts+site-data+page-data': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'read-drafts+site-data+sound': 'no more than its pairs: their warnings show',
  'read-drafts+site-data+controls': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'read-drafts+site-data+mods': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'read-drafts+site-data+media': 'no more than its pairs: their warnings show',
  'read-drafts+site-data+search-box': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'read-drafts+site-data+go-to': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'read-drafts+site-data+click': 'no more than its pairs: their warnings show',
  'read-drafts+site-data+write-drafts': 'no more than its pairs: their warnings show',
  'read-drafts+page-data+sound': 'no more than its pairs: their warnings show',
  'read-drafts+page-data+controls': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'read-drafts+page-data+mods': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'read-drafts+page-data+media': 'no more than its pairs: their warnings show',
  'read-drafts+page-data+search-box': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'read-drafts+page-data+go-to': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'read-drafts+page-data+click': 'no more than its pairs: their warnings show',
  'read-drafts+page-data+write-drafts': 'no more than its pairs: their warnings show',
  'read-drafts+sound+controls': 'no more than its pairs: their warnings show',
  'read-drafts+sound+mods': 'no more than its pairs: their warnings show',
  'read-drafts+sound+media': 'no more than its pairs: their warnings show',
  'read-drafts+sound+search-box': 'no more than its pairs: their warnings show',
  'read-drafts+sound+go-to': 'no more than its pairs: their warnings show',
  'read-drafts+sound+click': 'no more than its pairs: their warnings show',
  'read-drafts+sound+write-drafts': 'no more than its pairs: their warnings show',
  'read-drafts+controls+mods': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'read-drafts+controls+media': 'no more than its pairs: their warnings show',
  'read-drafts+controls+search-box': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'read-drafts+controls+go-to': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'read-drafts+controls+click': 'no more than its pairs: their warnings show',
  'read-drafts+controls+write-drafts': 'no more than its pairs: their warnings show',
  'read-drafts+mods+media': 'no more than its pairs: their warnings show',
  'read-drafts+mods+search-box': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'read-drafts+mods+go-to': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'read-drafts+mods+click': 'no more than its pairs: their warnings show',
  'read-drafts+mods+write-drafts': 'no more than its pairs: their warnings show',
  'read-drafts+media+search-box': 'no more than its pairs: their warnings show',
  'read-drafts+media+go-to': 'no more than its pairs: their warnings show',
  'read-drafts+media+click': 'no more than its pairs: their warnings show',
  'read-drafts+media+write-drafts': 'no more than its pairs: their warnings show',
  'read-drafts+search-box+go-to': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'read-drafts+search-box+click': 'no more than its pairs: their warnings show',
  'read-drafts+search-box+write-drafts': 'no more than its pairs: their warnings show',
  'read-drafts+go-to+click': 'no more than its pairs: their warnings show',
  'read-drafts+go-to+write-drafts': 'no more than its pairs: their warnings show',
  'read-drafts+click+write-drafts': { warn: 'read-post-for-you' },
  'keys+site-data+page-data': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'keys+site-data+sound': 'no more than its pairs: their warnings show',
  'keys+site-data+controls': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'keys+site-data+mods': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'keys+site-data+media': 'no more than its pairs: their warnings show',
  'keys+site-data+search-box': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'keys+site-data+go-to': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'keys+site-data+click': 'no more than its pairs: their warnings show',
  'keys+site-data+write-drafts': 'no more than its pairs: their warnings show',
  'keys+page-data+sound': 'no more than its pairs: their warnings show',
  'keys+page-data+controls': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'keys+page-data+mods': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'keys+page-data+media': 'no more than its pairs: their warnings show',
  'keys+page-data+search-box': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'keys+page-data+go-to': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'keys+page-data+click': 'no more than its pairs: their warnings show',
  'keys+page-data+write-drafts': 'no more than its pairs: their warnings show',
  'keys+sound+controls': 'no more than its pairs: their warnings show',
  'keys+sound+mods': 'no more than its pairs: their warnings show',
  'keys+sound+media': 'no more than its pairs: their warnings show',
  'keys+sound+search-box': 'no more than its pairs: their warnings show',
  'keys+sound+go-to': 'no more than its pairs: their warnings show',
  'keys+sound+click': 'no more than its pairs: their warnings show',
  'keys+sound+write-drafts': 'no more than its pairs: their warnings show',
  'keys+controls+mods': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'keys+controls+media': 'no more than its pairs: their warnings show',
  'keys+controls+search-box': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'keys+controls+go-to': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'keys+controls+click': 'no more than its pairs: their warnings show',
  'keys+controls+write-drafts': 'no more than its pairs: their warnings show',
  'keys+mods+media': 'no more than its pairs: their warnings show',
  'keys+mods+search-box': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'keys+mods+go-to': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'keys+mods+click': 'no more than its pairs: their warnings show',
  'keys+mods+write-drafts': 'no more than its pairs: their warnings show',
  'keys+media+search-box': 'no more than its pairs: their warnings show',
  'keys+media+go-to': 'no more than its pairs: their warnings show',
  'keys+media+click': 'no more than its pairs: their warnings show',
  'keys+media+write-drafts': 'no more than its pairs: their warnings show',
  'keys+search-box+go-to': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'keys+search-box+click': 'no more than its pairs: their warnings show',
  'keys+search-box+write-drafts': 'no more than its pairs: their warnings show',
  'keys+go-to+click': 'no more than its pairs: their warnings show',
  'keys+go-to+write-drafts': 'no more than its pairs: their warnings show',
  'keys+click+write-drafts': { warn: 'read-post-for-you' },
  'site-data+page-data+sound': 'no more than its pairs: their warnings show',
  'site-data+page-data+controls': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'site-data+page-data+mods': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'site-data+page-data+media': 'no more than its pairs: their warnings show',
  'site-data+page-data+search-box': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'site-data+page-data+go-to': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'site-data+page-data+click': 'no more than its pairs: their warnings show',
  'site-data+page-data+write-drafts': 'no more than its pairs: their warnings show',
  'site-data+sound+controls': 'no more than its pairs: their warnings show',
  'site-data+sound+mods': 'no more than its pairs: their warnings show',
  'site-data+sound+media': 'no more than its pairs: their warnings show',
  'site-data+sound+search-box': 'no more than its pairs: their warnings show',
  'site-data+sound+go-to': 'no more than its pairs: their warnings show',
  'site-data+sound+click': 'no more than its pairs: their warnings show',
  'site-data+sound+write-drafts': 'no more than its pairs: their warnings show',
  'site-data+controls+mods': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'site-data+controls+media': 'no more than its pairs: their warnings show',
  'site-data+controls+search-box': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'site-data+controls+go-to': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'site-data+controls+click': 'no more than its pairs: their warnings show',
  'site-data+controls+write-drafts': 'no more than its pairs: their warnings show',
  'site-data+mods+media': 'no more than its pairs: their warnings show',
  'site-data+mods+search-box': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'site-data+mods+go-to': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'site-data+mods+click': 'no more than its pairs: their warnings show',
  'site-data+mods+write-drafts': 'no more than its pairs: their warnings show',
  'site-data+media+search-box': 'no more than its pairs: their warnings show',
  'site-data+media+go-to': 'no more than its pairs: their warnings show',
  'site-data+media+click': 'no more than its pairs: their warnings show',
  'site-data+media+write-drafts': 'no more than its pairs: their warnings show',
  'site-data+search-box+go-to': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'site-data+search-box+click': 'no more than its pairs: their warnings show',
  'site-data+search-box+write-drafts': 'no more than its pairs: their warnings show',
  'site-data+go-to+click': 'no more than its pairs: their warnings show',
  'site-data+go-to+write-drafts': 'no more than its pairs: their warnings show',
  'site-data+click+write-drafts': { warn: 'read-post-for-you' },
  'page-data+sound+controls': 'no more than its pairs: their warnings show',
  'page-data+sound+mods': 'no more than its pairs: their warnings show',
  'page-data+sound+media': 'no more than its pairs: their warnings show',
  'page-data+sound+search-box': 'no more than its pairs: their warnings show',
  'page-data+sound+go-to': 'no more than its pairs: their warnings show',
  'page-data+sound+click': 'no more than its pairs: their warnings show',
  'page-data+sound+write-drafts': 'no more than its pairs: their warnings show',
  'page-data+controls+mods': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'page-data+controls+media': 'no more than its pairs: their warnings show',
  'page-data+controls+search-box': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'page-data+controls+go-to': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'page-data+controls+click': 'no more than its pairs: their warnings show',
  'page-data+controls+write-drafts': 'no more than its pairs: their warnings show',
  'page-data+mods+media': 'no more than its pairs: their warnings show',
  'page-data+mods+search-box': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'page-data+mods+go-to': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'page-data+mods+click': 'no more than its pairs: their warnings show',
  'page-data+mods+write-drafts': 'no more than its pairs: their warnings show',
  'page-data+media+search-box': 'no more than its pairs: their warnings show',
  'page-data+media+go-to': 'no more than its pairs: their warnings show',
  'page-data+media+click': 'no more than its pairs: their warnings show',
  'page-data+media+write-drafts': 'no more than its pairs: their warnings show',
  'page-data+search-box+go-to': 'it can read, but nothing in it carries what it reads off the page or acts on it',
  'page-data+search-box+click': 'no more than its pairs: their warnings show',
  'page-data+search-box+write-drafts': 'no more than its pairs: their warnings show',
  'page-data+go-to+click': 'no more than its pairs: their warnings show',
  'page-data+go-to+write-drafts': 'no more than its pairs: their warnings show',
  'page-data+click+write-drafts': { warn: 'read-post-for-you' },
  'sound+controls+mods': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'sound+controls+media': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'sound+controls+search-box': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'sound+controls+go-to': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'sound+controls+click': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'sound+controls+write-drafts': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'sound+mods+media': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'sound+mods+search-box': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'sound+mods+go-to': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'sound+mods+click': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'sound+mods+write-drafts': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'sound+media+search-box': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'sound+media+go-to': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'sound+media+click': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'sound+media+write-drafts': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'sound+search-box+go-to': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'sound+search-box+click': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'sound+search-box+write-drafts': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'sound+go-to+click': 'no more than its pairs: their warnings show',
  'sound+go-to+write-drafts': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'sound+click+write-drafts': 'no more than its pairs: their warnings show',
  'controls+mods+media': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'controls+mods+search-box': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'controls+mods+go-to': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'controls+mods+click': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'controls+mods+write-drafts': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'controls+media+search-box': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'controls+media+go-to': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'controls+media+click': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'controls+media+write-drafts': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'controls+search-box+go-to': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'controls+search-box+click': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'controls+search-box+write-drafts': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'controls+go-to+click': 'no more than its pairs: their warnings show',
  'controls+go-to+write-drafts': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'controls+click+write-drafts': 'no more than its pairs: their warnings show',
  'mods+media+search-box': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'mods+media+go-to': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'mods+media+click': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'mods+media+write-drafts': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'mods+search-box+go-to': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'mods+search-box+click': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'mods+search-box+write-drafts': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'mods+go-to+click': 'no more than its pairs: their warnings show',
  'mods+go-to+write-drafts': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'mods+click+write-drafts': 'no more than its pairs: their warnings show',
  'media+search-box+go-to': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'media+search-box+click': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'media+search-box+write-drafts': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'media+go-to+click': 'no more than its pairs: their warnings show',
  'media+go-to+write-drafts': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'media+click+write-drafts': 'no more than its pairs: their warnings show',
  'search-box+go-to+click': 'no more than its pairs: their warnings show',
  'search-box+go-to+write-drafts': 'it reads nothing but the page, and its acts don\'t combine into posting or acting for you',
  'search-box+click+write-drafts': 'no more than its pairs: their warnings show',
  'go-to+click+write-drafts': { warn: 'go-post-for-you' },
};

const keyOf = (list) => POWERS.filter((p) => list.includes(p)).join('+');

/** The warned combinations among a set of powers: [{key, combo, warn, rank, fact}], the strongest first. */
function warningsFor(powers) {
  const list = POWERS.filter((p) => (powers || []).includes(p));
  const out = [];
  const add = (c) => { const e = COMBINATIONS[keyOf(c)]; if (e && typeof e === 'object') out.push({ key: `power:together:${keyOf(c)}`, combo: keyOf(c), warn: e.warn, ...WARNINGS[e.warn] }); };
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    add([list[i], list[j]]);
    for (let k = j + 1; k < list.length; k++) add([list[i], list[j], list[k]]);
  }
  return out.sort((a, b) => a.rank - b.rank || POWERS.indexOf(a.combo.split('+')[0]) - POWERS.indexOf(b.combo.split('+')[0]));
}

/**
 * docs/POWER-COMBINATIONS.md, written out from the table (tests/combinations.test.js checks the file is this):
 * node -e "process.stdout.write(require('./helper/lib/combinations').toMarkdown())" > docs/POWER-COMBINATIONS.md
 */
function toMarkdown() {
  const entries = Object.entries(COMBINATIONS);
  const warned = (n) => entries.filter(([k, v]) => k.split('+').length === n && typeof v === 'object');
  const show = (k) => k.split('+').map((p) => `\`${p}\``).join(' + ');
  const cell = (v, k) => {
    if (typeof v === 'object') return `**Together, it ${WARNINGS[v.warn].fact}.**`;
    if (!/^no more than its pairs/.test(v)) return `No added risk: ${v}.`;
    const ws = [...new Set(warningsFor(k.split('+')).filter((w) => w.combo !== k).map((w) => w.fact))];
    return `No more than its pairs, whose warnings show: ${ws.map((f) => `"${f}"`).join('; ')}.`;
  };
  const L = [];
  L.push('# Power combinations', '');
  L.push('Written out from `helper/lib/combinations.js` (the table the hold reads); don\'t edit by hand. Every pair');
  L.push('(66) and triple (220) of the twelve powers, with the warning a hold shows for it, or why it adds no risk.', '');
  L.push('"Adds risk" means: together, the powers can carry what a mod reads off the page, or act as you, in a way');
  L.push('none of them (for a triple: none of its pairs) can alone. Reads (`read-drafts`, `keys`, `site-data`,');
  L.push('`page-data`) see more than the page shows; nothing else does. The ways out of the page are what you post');
  L.push('(`write-drafts`, `click`), what the mod clicks (`click`, and `go-to` to get to a page), how the page\'s');
  L.push('media plays (the host of a video sees its requests: `media`) and sound in the room (`sound`). Everything a');
  L.push('boxed mod reaches otherwise stays on the site it came from, which already has it. Across mods on one page');
  L.push('(they see each other\'s elements, and `mods` gives them a channel), the sandbox\'s page-wide rules stop a');
  L.push('combination split between mods from slipping past the hold: docs/SAFE-MODS.md, "Combinations".', '');
  L.push(`Counts: ${warned(2).length} of 66 pairs carry a warning; ${warned(3).length} of 220 triples carry one of their own, and`);
  L.push(`${entries.filter(([k, v]) => k.split('+').length === 3 && /^no more than its pairs/.test(v)).length} more show their pairs' warnings.`, '');
  L.push('## The warnings, strongest first', '');
  L.push('A hold lists each warning its mod\'s powers make, one line each, in this order (the same sentence once).', '');
  L.push('| | warning | combinations |', '|---|---|---|');
  for (const [id, w] of Object.entries(WARNINGS).sort((a, b) => a[1].rank - b[1].rank)) {
    const cs = entries.filter(([, v]) => typeof v === 'object' && v.warn === id).map(([k]) => k);
    const byShape = {};
    for (const k of cs) { const shape = k.split('+').map((p) => (READS.includes(p) ? 'a read' : `\`${p}\``)).join(' + '); byShape[shape] = (byShape[shape] || 0) + 1; }
    L.push(`| ${w.rank} | Together, it ${w.fact}. | ${Object.entries(byShape).map(([sh, n]) => `${sh}${n > 1 ? ` (${n})` : ''}`).join('; ')} |`);
  }
  L.push('', `A mod with more than ${MANY_OVER} powers gets, in place of these lines: **${MANY}** (keyed by its exact set of powers; its`);
  L.push('combinations are still needs of their own, so a later version with fewer of them doesn\'t ask again for what was allowed).', '');
  for (const n of [2, 3]) {
    L.push(`## ${n === 2 ? 'Pairs (66)' : 'Triples (220)'}`, '');
    L.push(`Grouped by their first power, in the menu's order.`, '');
    for (const first of POWERS) {
      const rows = entries.filter(([k]) => k.split('+').length === n && k.split('+')[0] === first);
      if (!rows.length) continue;
      L.push(`### ${n === 2 ? 'Pairs' : 'Triples'} starting with \`${first}\``, '', '| combination | the hold |', '|---|---|');
      for (const [k, v] of rows) L.push(`| ${show(k)} | ${cell(v, k)} |`);
      L.push('');
    }
  }
  return `${L.join('\n').replace(/\n+$/, '')}\n`;
}

module.exports = { POWERS, READS, WARNINGS, MANY, MANY_OVER, COMBINATIONS, warningsFor, keyOf, toMarkdown };
