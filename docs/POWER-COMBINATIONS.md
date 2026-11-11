# Power combinations

Written out from `helper/lib/combinations.js` (the table the hold reads); don't edit by hand. Every pair
(210) and triple (1330) of the 21 powers, with the warning a hold shows for it, or why it adds no risk.

"Adds risk" means: together, the powers can carry what a mod reads off the page, or act as you, in a way
none of them (for a triple: none of its pairs) can alone. Reads (`read-drafts`, `keys`, `site-data`,
`page-data`, `site-storage`, `local-fonts`, `image-variants` for the pixels it reads, and `edit-uploads` for
the pictures you attach) see more than the page shows; nothing else does. The ways out of the page are what
you post (`write-drafts`, `click`, a picture you attach: `edit-uploads`), what the mod clicks (`click`, and
`go-to` to get to a page), what the page's own code is told or sees (`page-events`, and which of your actions
`block-events` keeps from it), what the site keeps (`site-storage`: the site's own code reads it, and so can
a boxed mod on a later page), how the page's media plays (the host of a video sees its requests: `media`),
which of the page's pictures load (their hosts see that: `image-variants`, `preload`), which video it offers
you (the player's host sees it once you click: `embeds`) and sound in the room (`sound`).
`rewrite-requests` changes what the site receives, but only as its header says, by TRIF: nothing the mod
reads rides on it, but beside an act (`click`, `page-events`) it changes what that act sends. Everything a
boxed mod reaches otherwise stays on the site it came from, which already has it. Across mods on one page
(they see each other's elements, and `mods` gives them a channel), the sandbox's page-wide rules stop a
combination split between mods from slipping past the hold: docs/SAFE-MODS.md, "Combinations".

Counts: 91 of 210 pairs carry a warning; 32 of 1330 triples carry one of their own, and
952 more show their pairs' warnings.

## The warnings, strongest first

A hold lists each warning its mod's powers make, one line each, in this order (the same sentence once).

| | warning | combinations |
|---|---|---|
| 1 | Together, it could put what it reads into a post and send it for you. | a read + `page-events` + `write-drafts` (5); a read + `page-events` + `edit-uploads` (5); a read + `click` + `write-drafts` (5); a read + `click` + `edit-uploads` (5); `site-storage` + `page-events` + `write-drafts`; `site-storage` + `page-events` + `edit-uploads`; `site-storage` + `click` + `write-drafts`; `site-storage` + `click` + `edit-uploads`; `image-variants` + `page-events` + `write-drafts`; `image-variants` + `page-events` + `edit-uploads`; `image-variants` + `click` + `write-drafts`; `image-variants` + `click` + `edit-uploads`; `page-events` + `write-drafts` + `edit-uploads`; `click` + `write-drafts` + `edit-uploads` |
| 2 | Together, it could go to a page, write a post there and send it for you. | `go-to` + `page-events` + `write-drafts`; `go-to` + `click` + `write-drafts` |
| 3 | Together, it could write a post and send it for you. | `page-events` + `write-drafts`; `page-events` + `edit-uploads`; `click` + `write-drafts`; `click` + `edit-uploads` |
| 4 | Together, it could put what it reads into something you post. | a read + `write-drafts` (5); `site-storage` + `write-drafts`; `image-variants` + `write-drafts`; `write-drafts` + `edit-uploads` |
| 5 | Together, it could put what it reads into a picture you post. | a read + `edit-uploads` (5); `site-storage` + `edit-uploads`; `image-variants` + `edit-uploads` |
| 6 | Together, it could hand what it reads to this page's own code, which may post or send it. | a read + `page-events` (5); `site-storage` + `page-events`; `image-variants` + `page-events` |
| 7 | Together, it could keep what it reads where this site's own code, and your other boxed mods, can find it later. | a read + `site-storage` (4); `site-storage` + a read |
| 8 | Together, it could take you to a page and click things there for you. | `go-to` + `click` |
| 9 | Together, it could take you to a page and set off that page's own actions there. | `site-storage` + `go-to`; `go-to` + `page-events` |
| 10 | Together, it could click things for you and change what the site receives from those clicks. | `rewrite-requests` + `click` |
| 11 | Together, it could set off this page's own actions and change what the site receives from them. | `rewrite-requests` + `page-events` |
| 12 | Together, it could let what it reads decide what it clicks for you. | a read + `click` (5); `site-storage` + `click`; `image-variants` + `click` |
| 13 | Together, it could keep your clicks from reaching the page and click in their place. | `block-events` + `click` |
| 14 | Together, it could keep your clicks from reaching the page and set off the page's own actions in their place. | `block-events` + `page-events` |
| 15 | Together, it could keep your clicks from reaching the page and take you to another page in their place. | `go-to` + `block-events` |
| 16 | Together, it could let what it reads decide which of your actions this page sees, and the page's code may send that on. | a read + `block-events` (5); `site-storage` + `block-events`; `image-variants` + `block-events`; `block-events` + `edit-uploads` |
| 17 | Together, it could pass what it reads to the site a video or sound comes from, by how it plays it. | a read + `media` (5); `site-storage` + `media`; `image-variants` + `media`; `media` + `edit-uploads` |
| 18 | Together, it could pass what it reads to the sites this page's pictures come from, by which ones it loads. | a read + `image-variants` (5); a read + `preload` (5); `site-storage` + `image-variants`; `site-storage` + `preload`; `preload` + `edit-uploads` |
| 19 | Together, it could pass what it reads to the site a video comes from, by which video it offers you. | a read + `embeds` (5); `site-storage` + `embeds`; `image-variants` + `embeds`; `embeds` + `edit-uploads` |
| 20 | Together, it could turn what it reads into sounds that a device nearby could pick up. | a read + `sound` (5); `site-storage` + `sound`; `image-variants` + `sound`; `sound` + `edit-uploads` |

A mod with more than 3 powers gets, in place of these lines: **Mods with many powers can act in unspecific or powerful ways. Treat this with caution.** (keyed by its exact set of powers; its
combinations are still needs of their own, so a later version with fewer of them doesn't ask again for what was allowed).

## Pairs (210)

Grouped by their first power, in the menu's order.

### Pairs starting with `read-drafts`

| combination | the hold |
|---|---|
| `read-drafts` + `keys` | No added risk: both only read: nothing they read can leave the page without something that acts. |
| `read-drafts` + `site-data` | No added risk: both only read: nothing they read can leave the page without something that acts. |
| `read-drafts` + `page-data` | No added risk: both only read: nothing they read can leave the page without something that acts. |
| `read-drafts` + `site-storage` | **Together, it could keep what it reads where this site's own code, and your other boxed mods, can find it later.** |
| `read-drafts` + `local-fonts` | No added risk: both only read: nothing they read can leave the page without something that acts. |
| `read-drafts` + `image-variants` | **Together, it could pass what it reads to the sites this page's pictures come from, by which ones it loads.** |
| `read-drafts` + `sound` | **Together, it could turn what it reads into sounds that a device nearby could pick up.** |
| `read-drafts` + `controls` | No added risk: its own controls only take what you give the mod on purpose, and show nothing it couldn't show in its own elements. |
| `read-drafts` + `mods` | No added risk: a channel only reaches its other boxed mods, and the page-wide rules treat the boxed mods on a page as one. |
| `read-drafts` + `preload` | **Together, it could pass what it reads to the sites this page's pictures come from, by which ones it loads.** |
| `read-drafts` + `media` | **Together, it could pass what it reads to the site a video or sound comes from, by how it plays it.** |
| `read-drafts` + `search-box` | No added risk: the search box only takes what you type, and the mod can't fill or read it. |
| `read-drafts` + `go-to` | No added risk: it only goes to this site's own pages (the header's, with the header's words in a query, or links the page shows), and that site can already see what it reads. |
| `read-drafts` + `embeds` | **Together, it could pass what it reads to the site a video comes from, by which video it offers you.** |
| `read-drafts` + `rewrite-requests` | No added risk: its change to what the site receives is fixed in the header and made by TRIF, so nothing the mod reads or does rides on it. |
| `read-drafts` + `block-events` | **Together, it could let what it reads decide which of your actions this page sees, and the page's code may send that on.** |
| `read-drafts` + `page-events` | **Together, it could hand what it reads to this page's own code, which may post or send it.** |
| `read-drafts` + `click` | **Together, it could let what it reads decide what it clicks for you.** |
| `read-drafts` + `write-drafts` | **Together, it could put what it reads into something you post.** |
| `read-drafts` + `edit-uploads` | **Together, it could put what it reads into a picture you post.** |

### Pairs starting with `keys`

| combination | the hold |
|---|---|
| `keys` + `site-data` | No added risk: both only read: nothing they read can leave the page without something that acts. |
| `keys` + `page-data` | No added risk: both only read: nothing they read can leave the page without something that acts. |
| `keys` + `site-storage` | **Together, it could keep what it reads where this site's own code, and your other boxed mods, can find it later.** |
| `keys` + `local-fonts` | No added risk: both only read: nothing they read can leave the page without something that acts. |
| `keys` + `image-variants` | **Together, it could pass what it reads to the sites this page's pictures come from, by which ones it loads.** |
| `keys` + `sound` | **Together, it could turn what it reads into sounds that a device nearby could pick up.** |
| `keys` + `controls` | No added risk: its own controls only take what you give the mod on purpose, and show nothing it couldn't show in its own elements. |
| `keys` + `mods` | No added risk: a channel only reaches its other boxed mods, and the page-wide rules treat the boxed mods on a page as one. |
| `keys` + `preload` | **Together, it could pass what it reads to the sites this page's pictures come from, by which ones it loads.** |
| `keys` + `media` | **Together, it could pass what it reads to the site a video or sound comes from, by how it plays it.** |
| `keys` + `search-box` | No added risk: the search box only takes what you type, and the mod can't fill or read it. |
| `keys` + `go-to` | No added risk: it only goes to this site's own pages (the header's, with the header's words in a query, or links the page shows), and that site can already see what it reads. |
| `keys` + `embeds` | **Together, it could pass what it reads to the site a video comes from, by which video it offers you.** |
| `keys` + `rewrite-requests` | No added risk: its change to what the site receives is fixed in the header and made by TRIF, so nothing the mod reads or does rides on it. |
| `keys` + `block-events` | **Together, it could let what it reads decide which of your actions this page sees, and the page's code may send that on.** |
| `keys` + `page-events` | **Together, it could hand what it reads to this page's own code, which may post or send it.** |
| `keys` + `click` | **Together, it could let what it reads decide what it clicks for you.** |
| `keys` + `write-drafts` | **Together, it could put what it reads into something you post.** |
| `keys` + `edit-uploads` | **Together, it could put what it reads into a picture you post.** |

### Pairs starting with `site-data`

| combination | the hold |
|---|---|
| `site-data` + `page-data` | No added risk: both only read: nothing they read can leave the page without something that acts. |
| `site-data` + `site-storage` | **Together, it could keep what it reads where this site's own code, and your other boxed mods, can find it later.** |
| `site-data` + `local-fonts` | No added risk: both only read: nothing they read can leave the page without something that acts. |
| `site-data` + `image-variants` | **Together, it could pass what it reads to the sites this page's pictures come from, by which ones it loads.** |
| `site-data` + `sound` | **Together, it could turn what it reads into sounds that a device nearby could pick up.** |
| `site-data` + `controls` | No added risk: its own controls only take what you give the mod on purpose, and show nothing it couldn't show in its own elements. |
| `site-data` + `mods` | No added risk: a channel only reaches its other boxed mods, and the page-wide rules treat the boxed mods on a page as one. |
| `site-data` + `preload` | **Together, it could pass what it reads to the sites this page's pictures come from, by which ones it loads.** |
| `site-data` + `media` | **Together, it could pass what it reads to the site a video or sound comes from, by how it plays it.** |
| `site-data` + `search-box` | No added risk: the search box only takes what you type, and the mod can't fill or read it. |
| `site-data` + `go-to` | No added risk: it only goes to this site's own pages (the header's, with the header's words in a query, or links the page shows), and that site can already see what it reads. |
| `site-data` + `embeds` | **Together, it could pass what it reads to the site a video comes from, by which video it offers you.** |
| `site-data` + `rewrite-requests` | No added risk: its change to what the site receives is fixed in the header and made by TRIF, so nothing the mod reads or does rides on it. |
| `site-data` + `block-events` | **Together, it could let what it reads decide which of your actions this page sees, and the page's code may send that on.** |
| `site-data` + `page-events` | **Together, it could hand what it reads to this page's own code, which may post or send it.** |
| `site-data` + `click` | **Together, it could let what it reads decide what it clicks for you.** |
| `site-data` + `write-drafts` | **Together, it could put what it reads into something you post.** |
| `site-data` + `edit-uploads` | **Together, it could put what it reads into a picture you post.** |

### Pairs starting with `page-data`

| combination | the hold |
|---|---|
| `page-data` + `site-storage` | **Together, it could keep what it reads where this site's own code, and your other boxed mods, can find it later.** |
| `page-data` + `local-fonts` | No added risk: both only read: nothing they read can leave the page without something that acts. |
| `page-data` + `image-variants` | **Together, it could pass what it reads to the sites this page's pictures come from, by which ones it loads.** |
| `page-data` + `sound` | **Together, it could turn what it reads into sounds that a device nearby could pick up.** |
| `page-data` + `controls` | No added risk: its own controls only take what you give the mod on purpose, and show nothing it couldn't show in its own elements. |
| `page-data` + `mods` | No added risk: a channel only reaches its other boxed mods, and the page-wide rules treat the boxed mods on a page as one. |
| `page-data` + `preload` | **Together, it could pass what it reads to the sites this page's pictures come from, by which ones it loads.** |
| `page-data` + `media` | **Together, it could pass what it reads to the site a video or sound comes from, by how it plays it.** |
| `page-data` + `search-box` | No added risk: the search box only takes what you type, and the mod can't fill or read it. |
| `page-data` + `go-to` | No added risk: it only goes to this site's own pages (the header's, with the header's words in a query, or links the page shows), and that site can already see what it reads. |
| `page-data` + `embeds` | **Together, it could pass what it reads to the site a video comes from, by which video it offers you.** |
| `page-data` + `rewrite-requests` | No added risk: its change to what the site receives is fixed in the header and made by TRIF, so nothing the mod reads or does rides on it. |
| `page-data` + `block-events` | **Together, it could let what it reads decide which of your actions this page sees, and the page's code may send that on.** |
| `page-data` + `page-events` | **Together, it could hand what it reads to this page's own code, which may post or send it.** |
| `page-data` + `click` | **Together, it could let what it reads decide what it clicks for you.** |
| `page-data` + `write-drafts` | **Together, it could put what it reads into something you post.** |
| `page-data` + `edit-uploads` | **Together, it could put what it reads into a picture you post.** |

### Pairs starting with `site-storage`

| combination | the hold |
|---|---|
| `site-storage` + `local-fonts` | **Together, it could keep what it reads where this site's own code, and your other boxed mods, can find it later.** |
| `site-storage` + `image-variants` | **Together, it could pass what it reads to the sites this page's pictures come from, by which ones it loads.** |
| `site-storage` + `sound` | **Together, it could turn what it reads into sounds that a device nearby could pick up.** |
| `site-storage` + `controls` | No added risk: its own controls only take what you give the mod on purpose, and show nothing it couldn't show in its own elements. |
| `site-storage` + `mods` | No added risk: a channel only reaches its other boxed mods, and the page-wide rules treat the boxed mods on a page as one. |
| `site-storage` + `preload` | **Together, it could pass what it reads to the sites this page's pictures come from, by which ones it loads.** |
| `site-storage` + `media` | **Together, it could pass what it reads to the site a video or sound comes from, by how it plays it.** |
| `site-storage` + `search-box` | No added risk: the search box only takes what you type, and the mod can't fill or read it. |
| `site-storage` + `go-to` | **Together, it could take you to a page and set off that page's own actions there.** |
| `site-storage` + `embeds` | **Together, it could pass what it reads to the site a video comes from, by which video it offers you.** |
| `site-storage` + `rewrite-requests` | No added risk: its change to what the site receives is fixed in the header and made by TRIF, so nothing the mod reads or does rides on it. |
| `site-storage` + `block-events` | **Together, it could let what it reads decide which of your actions this page sees, and the page's code may send that on.** |
| `site-storage` + `page-events` | **Together, it could hand what it reads to this page's own code, which may post or send it.** |
| `site-storage` + `click` | **Together, it could let what it reads decide what it clicks for you.** |
| `site-storage` + `write-drafts` | **Together, it could put what it reads into something you post.** |
| `site-storage` + `edit-uploads` | **Together, it could put what it reads into a picture you post.** |

### Pairs starting with `local-fonts`

| combination | the hold |
|---|---|
| `local-fonts` + `image-variants` | **Together, it could pass what it reads to the sites this page's pictures come from, by which ones it loads.** |
| `local-fonts` + `sound` | **Together, it could turn what it reads into sounds that a device nearby could pick up.** |
| `local-fonts` + `controls` | No added risk: its own controls only take what you give the mod on purpose, and show nothing it couldn't show in its own elements. |
| `local-fonts` + `mods` | No added risk: a channel only reaches its other boxed mods, and the page-wide rules treat the boxed mods on a page as one. |
| `local-fonts` + `preload` | **Together, it could pass what it reads to the sites this page's pictures come from, by which ones it loads.** |
| `local-fonts` + `media` | **Together, it could pass what it reads to the site a video or sound comes from, by how it plays it.** |
| `local-fonts` + `search-box` | No added risk: the search box only takes what you type, and the mod can't fill or read it. |
| `local-fonts` + `go-to` | No added risk: it only goes to this site's own pages (the header's, with the header's words in a query, or links the page shows), and that site can already see what it reads. |
| `local-fonts` + `embeds` | **Together, it could pass what it reads to the site a video comes from, by which video it offers you.** |
| `local-fonts` + `rewrite-requests` | No added risk: its change to what the site receives is fixed in the header and made by TRIF, so nothing the mod reads or does rides on it. |
| `local-fonts` + `block-events` | **Together, it could let what it reads decide which of your actions this page sees, and the page's code may send that on.** |
| `local-fonts` + `page-events` | **Together, it could hand what it reads to this page's own code, which may post or send it.** |
| `local-fonts` + `click` | **Together, it could let what it reads decide what it clicks for you.** |
| `local-fonts` + `write-drafts` | **Together, it could put what it reads into something you post.** |
| `local-fonts` + `edit-uploads` | **Together, it could put what it reads into a picture you post.** |

### Pairs starting with `image-variants`

| combination | the hold |
|---|---|
| `image-variants` + `sound` | **Together, it could turn what it reads into sounds that a device nearby could pick up.** |
| `image-variants` + `controls` | No added risk: its own controls only take what you give the mod on purpose, and show nothing it couldn't show in its own elements. |
| `image-variants` + `mods` | No added risk: a channel only reaches its other boxed mods, and the page-wide rules treat the boxed mods on a page as one. |
| `image-variants` + `preload` | No added risk: both only load the page's own pictures, from where the page gets them. |
| `image-variants` + `media` | **Together, it could pass what it reads to the site a video or sound comes from, by how it plays it.** |
| `image-variants` + `search-box` | No added risk: the search box only takes what you type, and the mod can't fill or read it. |
| `image-variants` + `go-to` | No added risk: it only goes to this site's own pages (the header's, with the header's words in a query, or links the page shows), and that site can already see what it reads. |
| `image-variants` + `embeds` | **Together, it could pass what it reads to the site a video comes from, by which video it offers you.** |
| `image-variants` + `rewrite-requests` | No added risk: its change to what the site receives is fixed in the header and made by TRIF, so nothing the mod reads or does rides on it. |
| `image-variants` + `block-events` | **Together, it could let what it reads decide which of your actions this page sees, and the page's code may send that on.** |
| `image-variants` + `page-events` | **Together, it could hand what it reads to this page's own code, which may post or send it.** |
| `image-variants` + `click` | **Together, it could let what it reads decide what it clicks for you.** |
| `image-variants` + `write-drafts` | **Together, it could put what it reads into something you post.** |
| `image-variants` + `edit-uploads` | **Together, it could put what it reads into a picture you post.** |

### Pairs starting with `sound`

| combination | the hold |
|---|---|
| `sound` + `controls` | No added risk: its own controls only take what you give the mod on purpose, and show nothing it couldn't show in its own elements. |
| `sound` + `mods` | No added risk: a channel only reaches its other boxed mods, and the page-wide rules treat the boxed mods on a page as one. |
| `sound` + `preload` | No added risk: it only makes the page load its own pictures sooner, as it would when you scroll to them. |
| `sound` + `media` | No added risk: neither reads more than the page shows, and together they don't post, send or act for you beyond what each does alone. |
| `sound` + `search-box` | No added risk: the search box only takes what you type, and the mod can't fill or read it. |
| `sound` + `go-to` | No added risk: neither reads more than the page shows, and together they don't post, send or act for you beyond what each does alone. |
| `sound` + `embeds` | No added risk: it plays only a video a link on the page names, after you click, so nothing the mod reads rides on it. |
| `sound` + `rewrite-requests` | No added risk: its change to what the site receives is fixed in the header and made by TRIF, so nothing the mod reads or does rides on it. |
| `sound` + `block-events` | No added risk: keeping some of what you do from the page only lets the page learn less, and your typing always reaches its fields. |
| `sound` + `page-events` | No added risk: neither reads more than the page shows, and together they don't post, send or act for you beyond what each does alone. |
| `sound` + `click` | No added risk: neither reads more than the page shows, and together they don't post, send or act for you beyond what each does alone. |
| `sound` + `write-drafts` | No added risk: a draft it changes still waits for you to post it, and the other power carries nothing into it or sends it. |
| `sound` + `edit-uploads` | **Together, it could turn what it reads into sounds that a device nearby could pick up.** |

### Pairs starting with `controls`

| combination | the hold |
|---|---|
| `controls` + `mods` | No added risk: a channel only reaches its other boxed mods, and the page-wide rules treat the boxed mods on a page as one. |
| `controls` + `preload` | No added risk: its own controls only take what you give the mod on purpose, and show nothing it couldn't show in its own elements. |
| `controls` + `media` | No added risk: its own controls only take what you give the mod on purpose, and show nothing it couldn't show in its own elements. |
| `controls` + `search-box` | No added risk: its own controls only take what you give the mod on purpose, and show nothing it couldn't show in its own elements. |
| `controls` + `go-to` | No added risk: its own controls only take what you give the mod on purpose, and show nothing it couldn't show in its own elements. |
| `controls` + `embeds` | No added risk: its own controls only take what you give the mod on purpose, and show nothing it couldn't show in its own elements. |
| `controls` + `rewrite-requests` | No added risk: its own controls only take what you give the mod on purpose, and show nothing it couldn't show in its own elements. |
| `controls` + `block-events` | No added risk: its own controls only take what you give the mod on purpose, and show nothing it couldn't show in its own elements. |
| `controls` + `page-events` | No added risk: its own controls only take what you give the mod on purpose, and show nothing it couldn't show in its own elements. |
| `controls` + `click` | No added risk: its own controls only take what you give the mod on purpose, and show nothing it couldn't show in its own elements. |
| `controls` + `write-drafts` | No added risk: its own controls only take what you give the mod on purpose, and show nothing it couldn't show in its own elements. |
| `controls` + `edit-uploads` | No added risk: its own controls only take what you give the mod on purpose, and show nothing it couldn't show in its own elements. |

### Pairs starting with `mods`

| combination | the hold |
|---|---|
| `mods` + `preload` | No added risk: a channel only reaches its other boxed mods, and the page-wide rules treat the boxed mods on a page as one. |
| `mods` + `media` | No added risk: a channel only reaches its other boxed mods, and the page-wide rules treat the boxed mods on a page as one. |
| `mods` + `search-box` | No added risk: a channel only reaches its other boxed mods, and the page-wide rules treat the boxed mods on a page as one. |
| `mods` + `go-to` | No added risk: a channel only reaches its other boxed mods, and the page-wide rules treat the boxed mods on a page as one. |
| `mods` + `embeds` | No added risk: a channel only reaches its other boxed mods, and the page-wide rules treat the boxed mods on a page as one. |
| `mods` + `rewrite-requests` | No added risk: a channel only reaches its other boxed mods, and the page-wide rules treat the boxed mods on a page as one. |
| `mods` + `block-events` | No added risk: a channel only reaches its other boxed mods, and the page-wide rules treat the boxed mods on a page as one. |
| `mods` + `page-events` | No added risk: a channel only reaches its other boxed mods, and the page-wide rules treat the boxed mods on a page as one. |
| `mods` + `click` | No added risk: a channel only reaches its other boxed mods, and the page-wide rules treat the boxed mods on a page as one. |
| `mods` + `write-drafts` | No added risk: a channel only reaches its other boxed mods, and the page-wide rules treat the boxed mods on a page as one. |
| `mods` + `edit-uploads` | No added risk: a channel only reaches its other boxed mods, and the page-wide rules treat the boxed mods on a page as one. |

### Pairs starting with `preload`

| combination | the hold |
|---|---|
| `preload` + `media` | No added risk: it only makes the page load its own pictures sooner, as it would when you scroll to them. |
| `preload` + `search-box` | No added risk: the search box only takes what you type, and the mod can't fill or read it. |
| `preload` + `go-to` | No added risk: it only makes the page load its own pictures sooner, as it would when you scroll to them. |
| `preload` + `embeds` | No added risk: it plays only a video a link on the page names, after you click, so nothing the mod reads rides on it. |
| `preload` + `rewrite-requests` | No added risk: its change to what the site receives is fixed in the header and made by TRIF, so nothing the mod reads or does rides on it. |
| `preload` + `block-events` | No added risk: keeping some of what you do from the page only lets the page learn less, and your typing always reaches its fields. |
| `preload` + `page-events` | No added risk: it only makes the page load its own pictures sooner, as it would when you scroll to them. |
| `preload` + `click` | No added risk: it only makes the page load its own pictures sooner, as it would when you scroll to them. |
| `preload` + `write-drafts` | No added risk: it only makes the page load its own pictures sooner, as it would when you scroll to them. |
| `preload` + `edit-uploads` | **Together, it could pass what it reads to the sites this page's pictures come from, by which ones it loads.** |

### Pairs starting with `media`

| combination | the hold |
|---|---|
| `media` + `search-box` | No added risk: the search box only takes what you type, and the mod can't fill or read it. |
| `media` + `go-to` | No added risk: neither reads more than the page shows, and together they don't post, send or act for you beyond what each does alone. |
| `media` + `embeds` | No added risk: it plays only a video a link on the page names, after you click, so nothing the mod reads rides on it. |
| `media` + `rewrite-requests` | No added risk: its change to what the site receives is fixed in the header and made by TRIF, so nothing the mod reads or does rides on it. |
| `media` + `block-events` | No added risk: keeping some of what you do from the page only lets the page learn less, and your typing always reaches its fields. |
| `media` + `page-events` | No added risk: neither reads more than the page shows, and together they don't post, send or act for you beyond what each does alone. |
| `media` + `click` | No added risk: neither reads more than the page shows, and together they don't post, send or act for you beyond what each does alone. |
| `media` + `write-drafts` | No added risk: a draft it changes still waits for you to post it, and the other power carries nothing into it or sends it. |
| `media` + `edit-uploads` | **Together, it could pass what it reads to the site a video or sound comes from, by how it plays it.** |

### Pairs starting with `search-box`

| combination | the hold |
|---|---|
| `search-box` + `go-to` | No added risk: the search box only takes what you type, and the mod can't fill or read it. |
| `search-box` + `embeds` | No added risk: the search box only takes what you type, and the mod can't fill or read it. |
| `search-box` + `rewrite-requests` | No added risk: the search box only takes what you type, and the mod can't fill or read it. |
| `search-box` + `block-events` | No added risk: the search box only takes what you type, and the mod can't fill or read it. |
| `search-box` + `page-events` | No added risk: the search box only takes what you type, and the mod can't fill or read it. |
| `search-box` + `click` | No added risk: the search box only takes what you type, and the mod can't fill or read it. |
| `search-box` + `write-drafts` | No added risk: the search box only takes what you type, and the mod can't fill or read it. |
| `search-box` + `edit-uploads` | No added risk: the search box only takes what you type, and the mod can't fill or read it. |

### Pairs starting with `go-to`

| combination | the hold |
|---|---|
| `go-to` + `embeds` | No added risk: it plays only a video a link on the page names, after you click, so nothing the mod reads rides on it. |
| `go-to` + `rewrite-requests` | No added risk: its change to what the site receives is fixed in the header and made by TRIF, so nothing the mod reads or does rides on it. |
| `go-to` + `block-events` | **Together, it could keep your clicks from reaching the page and take you to another page in their place.** |
| `go-to` + `page-events` | **Together, it could take you to a page and set off that page's own actions there.** |
| `go-to` + `click` | **Together, it could take you to a page and click things there for you.** |
| `go-to` + `write-drafts` | No added risk: a draft it changes still waits for you to post it, and the other power carries nothing into it or sends it. |
| `go-to` + `edit-uploads` | No added risk: it only goes to this site's own pages (the header's, with the header's words in a query, or links the page shows), and that site can already see what it reads. |

### Pairs starting with `embeds`

| combination | the hold |
|---|---|
| `embeds` + `rewrite-requests` | No added risk: its change to what the site receives is fixed in the header and made by TRIF, so nothing the mod reads or does rides on it. |
| `embeds` + `block-events` | No added risk: it plays only a video a link on the page names, after you click, so nothing the mod reads rides on it. |
| `embeds` + `page-events` | No added risk: it plays only a video a link on the page names, after you click, so nothing the mod reads rides on it. |
| `embeds` + `click` | No added risk: it plays only a video a link on the page names, after you click, so nothing the mod reads rides on it. |
| `embeds` + `write-drafts` | No added risk: it plays only a video a link on the page names, after you click, so nothing the mod reads rides on it. |
| `embeds` + `edit-uploads` | **Together, it could pass what it reads to the site a video comes from, by which video it offers you.** |

### Pairs starting with `rewrite-requests`

| combination | the hold |
|---|---|
| `rewrite-requests` + `block-events` | No added risk: its change to what the site receives is fixed in the header and made by TRIF, so nothing the mod reads or does rides on it. |
| `rewrite-requests` + `page-events` | **Together, it could set off this page's own actions and change what the site receives from them.** |
| `rewrite-requests` + `click` | **Together, it could click things for you and change what the site receives from those clicks.** |
| `rewrite-requests` + `write-drafts` | No added risk: its change to what the site receives is fixed in the header and made by TRIF, so nothing the mod reads or does rides on it. |
| `rewrite-requests` + `edit-uploads` | No added risk: its change to what the site receives is fixed in the header and made by TRIF, so nothing the mod reads or does rides on it. |

### Pairs starting with `block-events`

| combination | the hold |
|---|---|
| `block-events` + `page-events` | **Together, it could keep your clicks from reaching the page and set off the page's own actions in their place.** |
| `block-events` + `click` | **Together, it could keep your clicks from reaching the page and click in their place.** |
| `block-events` + `write-drafts` | No added risk: keeping some of what you do from the page only lets the page learn less, and your typing always reaches its fields. |
| `block-events` + `edit-uploads` | **Together, it could let what it reads decide which of your actions this page sees, and the page's code may send that on.** |

### Pairs starting with `page-events`

| combination | the hold |
|---|---|
| `page-events` + `click` | No added risk: neither reads more than the page shows, and together they don't post, send or act for you beyond what each does alone. |
| `page-events` + `write-drafts` | **Together, it could write a post and send it for you.** |
| `page-events` + `edit-uploads` | **Together, it could write a post and send it for you.** |

### Pairs starting with `click`

| combination | the hold |
|---|---|
| `click` + `write-drafts` | **Together, it could write a post and send it for you.** |
| `click` + `edit-uploads` | **Together, it could write a post and send it for you.** |

### Pairs starting with `write-drafts`

| combination | the hold |
|---|---|
| `write-drafts` + `edit-uploads` | **Together, it could put what it reads into something you post.** |

## Triples (1330)

Grouped by their first power, in the menu's order.

### Triples starting with `read-drafts`

| combination | the hold |
|---|---|
| `read-drafts` + `keys` + `site-data` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `read-drafts` + `keys` + `page-data` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `read-drafts` + `keys` + `site-storage` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later". |
| `read-drafts` + `keys` + `local-fonts` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `read-drafts` + `keys` + `image-variants` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `read-drafts` + `keys` + `sound` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `read-drafts` + `keys` + `controls` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `read-drafts` + `keys` + `mods` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `read-drafts` + `keys` + `preload` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `read-drafts` + `keys` + `media` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `read-drafts` + `keys` + `search-box` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `read-drafts` + `keys` + `go-to` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `read-drafts` + `keys` + `embeds` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video comes from, by which video it offers you". |
| `read-drafts` + `keys` + `rewrite-requests` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `read-drafts` + `keys` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `read-drafts` + `keys` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it". |
| `read-drafts` + `keys` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you". |
| `read-drafts` + `keys` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `read-drafts` + `keys` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post". |
| `read-drafts` + `site-data` + `page-data` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `read-drafts` + `site-data` + `site-storage` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later". |
| `read-drafts` + `site-data` + `local-fonts` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `read-drafts` + `site-data` + `image-variants` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `read-drafts` + `site-data` + `sound` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `read-drafts` + `site-data` + `controls` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `read-drafts` + `site-data` + `mods` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `read-drafts` + `site-data` + `preload` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `read-drafts` + `site-data` + `media` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `read-drafts` + `site-data` + `search-box` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `read-drafts` + `site-data` + `go-to` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `read-drafts` + `site-data` + `embeds` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video comes from, by which video it offers you". |
| `read-drafts` + `site-data` + `rewrite-requests` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `read-drafts` + `site-data` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `read-drafts` + `site-data` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it". |
| `read-drafts` + `site-data` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you". |
| `read-drafts` + `site-data` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `read-drafts` + `site-data` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post". |
| `read-drafts` + `page-data` + `site-storage` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later". |
| `read-drafts` + `page-data` + `local-fonts` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `read-drafts` + `page-data` + `image-variants` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `read-drafts` + `page-data` + `sound` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `read-drafts` + `page-data` + `controls` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `read-drafts` + `page-data` + `mods` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `read-drafts` + `page-data` + `preload` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `read-drafts` + `page-data` + `media` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `read-drafts` + `page-data` + `search-box` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `read-drafts` + `page-data` + `go-to` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `read-drafts` + `page-data` + `embeds` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video comes from, by which video it offers you". |
| `read-drafts` + `page-data` + `rewrite-requests` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `read-drafts` + `page-data` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `read-drafts` + `page-data` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it". |
| `read-drafts` + `page-data` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you". |
| `read-drafts` + `page-data` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `read-drafts` + `page-data` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post". |
| `read-drafts` + `site-storage` + `local-fonts` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later". |
| `read-drafts` + `site-storage` + `image-variants` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `read-drafts` + `site-storage` + `sound` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later"; "could turn what it reads into sounds that a device nearby could pick up". |
| `read-drafts` + `site-storage` + `controls` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later". |
| `read-drafts` + `site-storage` + `mods` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later". |
| `read-drafts` + `site-storage` + `preload` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `read-drafts` + `site-storage` + `media` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later"; "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `read-drafts` + `site-storage` + `search-box` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later". |
| `read-drafts` + `site-storage` + `go-to` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later"; "could take you to a page and set off that page's own actions there". |
| `read-drafts` + `site-storage` + `embeds` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later"; "could pass what it reads to the site a video comes from, by which video it offers you". |
| `read-drafts` + `site-storage` + `rewrite-requests` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later". |
| `read-drafts` + `site-storage` + `block-events` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later"; "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `read-drafts` + `site-storage` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could keep what it reads where this site's own code, and your other boxed mods, can find it later". |
| `read-drafts` + `site-storage` + `click` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later"; "could let what it reads decide what it clicks for you". |
| `read-drafts` + `site-storage` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could keep what it reads where this site's own code, and your other boxed mods, can find it later". |
| `read-drafts` + `site-storage` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post"; "could keep what it reads where this site's own code, and your other boxed mods, can find it later". |
| `read-drafts` + `local-fonts` + `image-variants` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `read-drafts` + `local-fonts` + `sound` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `read-drafts` + `local-fonts` + `controls` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `read-drafts` + `local-fonts` + `mods` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `read-drafts` + `local-fonts` + `preload` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `read-drafts` + `local-fonts` + `media` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `read-drafts` + `local-fonts` + `search-box` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `read-drafts` + `local-fonts` + `go-to` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `read-drafts` + `local-fonts` + `embeds` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video comes from, by which video it offers you". |
| `read-drafts` + `local-fonts` + `rewrite-requests` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `read-drafts` + `local-fonts` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `read-drafts` + `local-fonts` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it". |
| `read-drafts` + `local-fonts` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you". |
| `read-drafts` + `local-fonts` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `read-drafts` + `local-fonts` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post". |
| `read-drafts` + `image-variants` + `sound` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads"; "could turn what it reads into sounds that a device nearby could pick up". |
| `read-drafts` + `image-variants` + `controls` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `read-drafts` + `image-variants` + `mods` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `read-drafts` + `image-variants` + `preload` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `read-drafts` + `image-variants` + `media` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `read-drafts` + `image-variants` + `search-box` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `read-drafts` + `image-variants` + `go-to` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `read-drafts` + `image-variants` + `embeds` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads"; "could pass what it reads to the site a video comes from, by which video it offers you". |
| `read-drafts` + `image-variants` + `rewrite-requests` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `read-drafts` + `image-variants` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `read-drafts` + `image-variants` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `read-drafts` + `image-variants` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `read-drafts` + `image-variants` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `read-drafts` + `image-variants` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `read-drafts` + `sound` + `controls` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `read-drafts` + `sound` + `mods` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `read-drafts` + `sound` + `preload` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads"; "could turn what it reads into sounds that a device nearby could pick up". |
| `read-drafts` + `sound` + `media` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it"; "could turn what it reads into sounds that a device nearby could pick up". |
| `read-drafts` + `sound` + `search-box` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `read-drafts` + `sound` + `go-to` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `read-drafts` + `sound` + `embeds` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video comes from, by which video it offers you"; "could turn what it reads into sounds that a device nearby could pick up". |
| `read-drafts` + `sound` + `rewrite-requests` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `read-drafts` + `sound` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on"; "could turn what it reads into sounds that a device nearby could pick up". |
| `read-drafts` + `sound` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could turn what it reads into sounds that a device nearby could pick up". |
| `read-drafts` + `sound` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you"; "could turn what it reads into sounds that a device nearby could pick up". |
| `read-drafts` + `sound` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could turn what it reads into sounds that a device nearby could pick up". |
| `read-drafts` + `sound` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post"; "could turn what it reads into sounds that a device nearby could pick up". |
| `read-drafts` + `controls` + `mods` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `read-drafts` + `controls` + `preload` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `read-drafts` + `controls` + `media` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `read-drafts` + `controls` + `search-box` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `read-drafts` + `controls` + `go-to` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `read-drafts` + `controls` + `embeds` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video comes from, by which video it offers you". |
| `read-drafts` + `controls` + `rewrite-requests` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `read-drafts` + `controls` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `read-drafts` + `controls` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it". |
| `read-drafts` + `controls` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you". |
| `read-drafts` + `controls` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `read-drafts` + `controls` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post". |
| `read-drafts` + `mods` + `preload` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `read-drafts` + `mods` + `media` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `read-drafts` + `mods` + `search-box` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `read-drafts` + `mods` + `go-to` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `read-drafts` + `mods` + `embeds` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video comes from, by which video it offers you". |
| `read-drafts` + `mods` + `rewrite-requests` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `read-drafts` + `mods` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `read-drafts` + `mods` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it". |
| `read-drafts` + `mods` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you". |
| `read-drafts` + `mods` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `read-drafts` + `mods` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post". |
| `read-drafts` + `preload` + `media` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `read-drafts` + `preload` + `search-box` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `read-drafts` + `preload` + `go-to` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `read-drafts` + `preload` + `embeds` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads"; "could pass what it reads to the site a video comes from, by which video it offers you". |
| `read-drafts` + `preload` + `rewrite-requests` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `read-drafts` + `preload` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `read-drafts` + `preload` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `read-drafts` + `preload` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `read-drafts` + `preload` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `read-drafts` + `preload` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `read-drafts` + `media` + `search-box` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `read-drafts` + `media` + `go-to` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `read-drafts` + `media` + `embeds` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it"; "could pass what it reads to the site a video comes from, by which video it offers you". |
| `read-drafts` + `media` + `rewrite-requests` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `read-drafts` + `media` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on"; "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `read-drafts` + `media` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `read-drafts` + `media` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you"; "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `read-drafts` + `media` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `read-drafts` + `media` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post"; "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `read-drafts` + `search-box` + `go-to` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `read-drafts` + `search-box` + `embeds` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video comes from, by which video it offers you". |
| `read-drafts` + `search-box` + `rewrite-requests` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `read-drafts` + `search-box` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `read-drafts` + `search-box` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it". |
| `read-drafts` + `search-box` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you". |
| `read-drafts` + `search-box` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `read-drafts` + `search-box` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post". |
| `read-drafts` + `go-to` + `embeds` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video comes from, by which video it offers you". |
| `read-drafts` + `go-to` + `rewrite-requests` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `read-drafts` + `go-to` + `block-events` | No more than its pairs, whose warnings show: "could keep your clicks from reaching the page and take you to another page in their place"; "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `read-drafts` + `go-to` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could take you to a page and set off that page's own actions there". |
| `read-drafts` + `go-to` + `click` | No more than its pairs, whose warnings show: "could take you to a page and click things there for you"; "could let what it reads decide what it clicks for you". |
| `read-drafts` + `go-to` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `read-drafts` + `go-to` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post". |
| `read-drafts` + `embeds` + `rewrite-requests` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video comes from, by which video it offers you". |
| `read-drafts` + `embeds` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on"; "could pass what it reads to the site a video comes from, by which video it offers you". |
| `read-drafts` + `embeds` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could pass what it reads to the site a video comes from, by which video it offers you". |
| `read-drafts` + `embeds` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you"; "could pass what it reads to the site a video comes from, by which video it offers you". |
| `read-drafts` + `embeds` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could pass what it reads to the site a video comes from, by which video it offers you". |
| `read-drafts` + `embeds` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post"; "could pass what it reads to the site a video comes from, by which video it offers you". |
| `read-drafts` + `rewrite-requests` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `read-drafts` + `rewrite-requests` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could set off this page's own actions and change what the site receives from them". |
| `read-drafts` + `rewrite-requests` + `click` | No more than its pairs, whose warnings show: "could click things for you and change what the site receives from those clicks"; "could let what it reads decide what it clicks for you". |
| `read-drafts` + `rewrite-requests` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `read-drafts` + `rewrite-requests` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post". |
| `read-drafts` + `block-events` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could keep your clicks from reaching the page and set off the page's own actions in their place"; "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `read-drafts` + `block-events` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you"; "could keep your clicks from reaching the page and click in their place"; "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `read-drafts` + `block-events` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `read-drafts` + `block-events` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post"; "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `read-drafts` + `page-events` + `click` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could let what it reads decide what it clicks for you". |
| `read-drafts` + `page-events` + `write-drafts` | **Together, it could put what it reads into a post and send it for you.** |
| `read-drafts` + `page-events` + `edit-uploads` | **Together, it could put what it reads into a post and send it for you.** |
| `read-drafts` + `click` + `write-drafts` | **Together, it could put what it reads into a post and send it for you.** |
| `read-drafts` + `click` + `edit-uploads` | **Together, it could put what it reads into a post and send it for you.** |
| `read-drafts` + `write-drafts` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could put what it reads into a picture you post". |

### Triples starting with `keys`

| combination | the hold |
|---|---|
| `keys` + `site-data` + `page-data` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `keys` + `site-data` + `site-storage` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later". |
| `keys` + `site-data` + `local-fonts` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `keys` + `site-data` + `image-variants` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `keys` + `site-data` + `sound` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `keys` + `site-data` + `controls` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `keys` + `site-data` + `mods` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `keys` + `site-data` + `preload` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `keys` + `site-data` + `media` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `keys` + `site-data` + `search-box` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `keys` + `site-data` + `go-to` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `keys` + `site-data` + `embeds` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video comes from, by which video it offers you". |
| `keys` + `site-data` + `rewrite-requests` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `keys` + `site-data` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `keys` + `site-data` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it". |
| `keys` + `site-data` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you". |
| `keys` + `site-data` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `keys` + `site-data` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post". |
| `keys` + `page-data` + `site-storage` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later". |
| `keys` + `page-data` + `local-fonts` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `keys` + `page-data` + `image-variants` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `keys` + `page-data` + `sound` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `keys` + `page-data` + `controls` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `keys` + `page-data` + `mods` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `keys` + `page-data` + `preload` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `keys` + `page-data` + `media` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `keys` + `page-data` + `search-box` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `keys` + `page-data` + `go-to` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `keys` + `page-data` + `embeds` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video comes from, by which video it offers you". |
| `keys` + `page-data` + `rewrite-requests` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `keys` + `page-data` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `keys` + `page-data` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it". |
| `keys` + `page-data` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you". |
| `keys` + `page-data` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `keys` + `page-data` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post". |
| `keys` + `site-storage` + `local-fonts` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later". |
| `keys` + `site-storage` + `image-variants` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `keys` + `site-storage` + `sound` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later"; "could turn what it reads into sounds that a device nearby could pick up". |
| `keys` + `site-storage` + `controls` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later". |
| `keys` + `site-storage` + `mods` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later". |
| `keys` + `site-storage` + `preload` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `keys` + `site-storage` + `media` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later"; "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `keys` + `site-storage` + `search-box` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later". |
| `keys` + `site-storage` + `go-to` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later"; "could take you to a page and set off that page's own actions there". |
| `keys` + `site-storage` + `embeds` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later"; "could pass what it reads to the site a video comes from, by which video it offers you". |
| `keys` + `site-storage` + `rewrite-requests` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later". |
| `keys` + `site-storage` + `block-events` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later"; "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `keys` + `site-storage` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could keep what it reads where this site's own code, and your other boxed mods, can find it later". |
| `keys` + `site-storage` + `click` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later"; "could let what it reads decide what it clicks for you". |
| `keys` + `site-storage` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could keep what it reads where this site's own code, and your other boxed mods, can find it later". |
| `keys` + `site-storage` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post"; "could keep what it reads where this site's own code, and your other boxed mods, can find it later". |
| `keys` + `local-fonts` + `image-variants` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `keys` + `local-fonts` + `sound` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `keys` + `local-fonts` + `controls` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `keys` + `local-fonts` + `mods` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `keys` + `local-fonts` + `preload` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `keys` + `local-fonts` + `media` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `keys` + `local-fonts` + `search-box` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `keys` + `local-fonts` + `go-to` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `keys` + `local-fonts` + `embeds` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video comes from, by which video it offers you". |
| `keys` + `local-fonts` + `rewrite-requests` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `keys` + `local-fonts` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `keys` + `local-fonts` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it". |
| `keys` + `local-fonts` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you". |
| `keys` + `local-fonts` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `keys` + `local-fonts` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post". |
| `keys` + `image-variants` + `sound` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads"; "could turn what it reads into sounds that a device nearby could pick up". |
| `keys` + `image-variants` + `controls` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `keys` + `image-variants` + `mods` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `keys` + `image-variants` + `preload` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `keys` + `image-variants` + `media` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `keys` + `image-variants` + `search-box` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `keys` + `image-variants` + `go-to` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `keys` + `image-variants` + `embeds` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads"; "could pass what it reads to the site a video comes from, by which video it offers you". |
| `keys` + `image-variants` + `rewrite-requests` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `keys` + `image-variants` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `keys` + `image-variants` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `keys` + `image-variants` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `keys` + `image-variants` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `keys` + `image-variants` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `keys` + `sound` + `controls` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `keys` + `sound` + `mods` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `keys` + `sound` + `preload` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads"; "could turn what it reads into sounds that a device nearby could pick up". |
| `keys` + `sound` + `media` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it"; "could turn what it reads into sounds that a device nearby could pick up". |
| `keys` + `sound` + `search-box` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `keys` + `sound` + `go-to` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `keys` + `sound` + `embeds` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video comes from, by which video it offers you"; "could turn what it reads into sounds that a device nearby could pick up". |
| `keys` + `sound` + `rewrite-requests` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `keys` + `sound` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on"; "could turn what it reads into sounds that a device nearby could pick up". |
| `keys` + `sound` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could turn what it reads into sounds that a device nearby could pick up". |
| `keys` + `sound` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you"; "could turn what it reads into sounds that a device nearby could pick up". |
| `keys` + `sound` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could turn what it reads into sounds that a device nearby could pick up". |
| `keys` + `sound` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post"; "could turn what it reads into sounds that a device nearby could pick up". |
| `keys` + `controls` + `mods` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `keys` + `controls` + `preload` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `keys` + `controls` + `media` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `keys` + `controls` + `search-box` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `keys` + `controls` + `go-to` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `keys` + `controls` + `embeds` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video comes from, by which video it offers you". |
| `keys` + `controls` + `rewrite-requests` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `keys` + `controls` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `keys` + `controls` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it". |
| `keys` + `controls` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you". |
| `keys` + `controls` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `keys` + `controls` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post". |
| `keys` + `mods` + `preload` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `keys` + `mods` + `media` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `keys` + `mods` + `search-box` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `keys` + `mods` + `go-to` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `keys` + `mods` + `embeds` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video comes from, by which video it offers you". |
| `keys` + `mods` + `rewrite-requests` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `keys` + `mods` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `keys` + `mods` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it". |
| `keys` + `mods` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you". |
| `keys` + `mods` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `keys` + `mods` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post". |
| `keys` + `preload` + `media` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `keys` + `preload` + `search-box` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `keys` + `preload` + `go-to` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `keys` + `preload` + `embeds` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads"; "could pass what it reads to the site a video comes from, by which video it offers you". |
| `keys` + `preload` + `rewrite-requests` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `keys` + `preload` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `keys` + `preload` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `keys` + `preload` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `keys` + `preload` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `keys` + `preload` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `keys` + `media` + `search-box` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `keys` + `media` + `go-to` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `keys` + `media` + `embeds` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it"; "could pass what it reads to the site a video comes from, by which video it offers you". |
| `keys` + `media` + `rewrite-requests` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `keys` + `media` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on"; "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `keys` + `media` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `keys` + `media` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you"; "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `keys` + `media` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `keys` + `media` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post"; "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `keys` + `search-box` + `go-to` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `keys` + `search-box` + `embeds` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video comes from, by which video it offers you". |
| `keys` + `search-box` + `rewrite-requests` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `keys` + `search-box` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `keys` + `search-box` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it". |
| `keys` + `search-box` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you". |
| `keys` + `search-box` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `keys` + `search-box` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post". |
| `keys` + `go-to` + `embeds` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video comes from, by which video it offers you". |
| `keys` + `go-to` + `rewrite-requests` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `keys` + `go-to` + `block-events` | No more than its pairs, whose warnings show: "could keep your clicks from reaching the page and take you to another page in their place"; "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `keys` + `go-to` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could take you to a page and set off that page's own actions there". |
| `keys` + `go-to` + `click` | No more than its pairs, whose warnings show: "could take you to a page and click things there for you"; "could let what it reads decide what it clicks for you". |
| `keys` + `go-to` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `keys` + `go-to` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post". |
| `keys` + `embeds` + `rewrite-requests` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video comes from, by which video it offers you". |
| `keys` + `embeds` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on"; "could pass what it reads to the site a video comes from, by which video it offers you". |
| `keys` + `embeds` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could pass what it reads to the site a video comes from, by which video it offers you". |
| `keys` + `embeds` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you"; "could pass what it reads to the site a video comes from, by which video it offers you". |
| `keys` + `embeds` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could pass what it reads to the site a video comes from, by which video it offers you". |
| `keys` + `embeds` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post"; "could pass what it reads to the site a video comes from, by which video it offers you". |
| `keys` + `rewrite-requests` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `keys` + `rewrite-requests` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could set off this page's own actions and change what the site receives from them". |
| `keys` + `rewrite-requests` + `click` | No more than its pairs, whose warnings show: "could click things for you and change what the site receives from those clicks"; "could let what it reads decide what it clicks for you". |
| `keys` + `rewrite-requests` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `keys` + `rewrite-requests` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post". |
| `keys` + `block-events` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could keep your clicks from reaching the page and set off the page's own actions in their place"; "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `keys` + `block-events` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you"; "could keep your clicks from reaching the page and click in their place"; "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `keys` + `block-events` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `keys` + `block-events` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post"; "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `keys` + `page-events` + `click` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could let what it reads decide what it clicks for you". |
| `keys` + `page-events` + `write-drafts` | **Together, it could put what it reads into a post and send it for you.** |
| `keys` + `page-events` + `edit-uploads` | **Together, it could put what it reads into a post and send it for you.** |
| `keys` + `click` + `write-drafts` | **Together, it could put what it reads into a post and send it for you.** |
| `keys` + `click` + `edit-uploads` | **Together, it could put what it reads into a post and send it for you.** |
| `keys` + `write-drafts` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could put what it reads into a picture you post". |

### Triples starting with `site-data`

| combination | the hold |
|---|---|
| `site-data` + `page-data` + `site-storage` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later". |
| `site-data` + `page-data` + `local-fonts` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `site-data` + `page-data` + `image-variants` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `site-data` + `page-data` + `sound` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `site-data` + `page-data` + `controls` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `site-data` + `page-data` + `mods` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `site-data` + `page-data` + `preload` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `site-data` + `page-data` + `media` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `site-data` + `page-data` + `search-box` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `site-data` + `page-data` + `go-to` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `site-data` + `page-data` + `embeds` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video comes from, by which video it offers you". |
| `site-data` + `page-data` + `rewrite-requests` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `site-data` + `page-data` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `site-data` + `page-data` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it". |
| `site-data` + `page-data` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you". |
| `site-data` + `page-data` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `site-data` + `page-data` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post". |
| `site-data` + `site-storage` + `local-fonts` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later". |
| `site-data` + `site-storage` + `image-variants` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `site-data` + `site-storage` + `sound` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later"; "could turn what it reads into sounds that a device nearby could pick up". |
| `site-data` + `site-storage` + `controls` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later". |
| `site-data` + `site-storage` + `mods` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later". |
| `site-data` + `site-storage` + `preload` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `site-data` + `site-storage` + `media` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later"; "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `site-data` + `site-storage` + `search-box` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later". |
| `site-data` + `site-storage` + `go-to` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later"; "could take you to a page and set off that page's own actions there". |
| `site-data` + `site-storage` + `embeds` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later"; "could pass what it reads to the site a video comes from, by which video it offers you". |
| `site-data` + `site-storage` + `rewrite-requests` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later". |
| `site-data` + `site-storage` + `block-events` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later"; "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `site-data` + `site-storage` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could keep what it reads where this site's own code, and your other boxed mods, can find it later". |
| `site-data` + `site-storage` + `click` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later"; "could let what it reads decide what it clicks for you". |
| `site-data` + `site-storage` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could keep what it reads where this site's own code, and your other boxed mods, can find it later". |
| `site-data` + `site-storage` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post"; "could keep what it reads where this site's own code, and your other boxed mods, can find it later". |
| `site-data` + `local-fonts` + `image-variants` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `site-data` + `local-fonts` + `sound` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `site-data` + `local-fonts` + `controls` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `site-data` + `local-fonts` + `mods` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `site-data` + `local-fonts` + `preload` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `site-data` + `local-fonts` + `media` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `site-data` + `local-fonts` + `search-box` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `site-data` + `local-fonts` + `go-to` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `site-data` + `local-fonts` + `embeds` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video comes from, by which video it offers you". |
| `site-data` + `local-fonts` + `rewrite-requests` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `site-data` + `local-fonts` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `site-data` + `local-fonts` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it". |
| `site-data` + `local-fonts` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you". |
| `site-data` + `local-fonts` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `site-data` + `local-fonts` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post". |
| `site-data` + `image-variants` + `sound` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads"; "could turn what it reads into sounds that a device nearby could pick up". |
| `site-data` + `image-variants` + `controls` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `site-data` + `image-variants` + `mods` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `site-data` + `image-variants` + `preload` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `site-data` + `image-variants` + `media` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `site-data` + `image-variants` + `search-box` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `site-data` + `image-variants` + `go-to` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `site-data` + `image-variants` + `embeds` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads"; "could pass what it reads to the site a video comes from, by which video it offers you". |
| `site-data` + `image-variants` + `rewrite-requests` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `site-data` + `image-variants` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `site-data` + `image-variants` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `site-data` + `image-variants` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `site-data` + `image-variants` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `site-data` + `image-variants` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `site-data` + `sound` + `controls` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `site-data` + `sound` + `mods` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `site-data` + `sound` + `preload` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads"; "could turn what it reads into sounds that a device nearby could pick up". |
| `site-data` + `sound` + `media` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it"; "could turn what it reads into sounds that a device nearby could pick up". |
| `site-data` + `sound` + `search-box` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `site-data` + `sound` + `go-to` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `site-data` + `sound` + `embeds` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video comes from, by which video it offers you"; "could turn what it reads into sounds that a device nearby could pick up". |
| `site-data` + `sound` + `rewrite-requests` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `site-data` + `sound` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on"; "could turn what it reads into sounds that a device nearby could pick up". |
| `site-data` + `sound` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could turn what it reads into sounds that a device nearby could pick up". |
| `site-data` + `sound` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you"; "could turn what it reads into sounds that a device nearby could pick up". |
| `site-data` + `sound` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could turn what it reads into sounds that a device nearby could pick up". |
| `site-data` + `sound` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post"; "could turn what it reads into sounds that a device nearby could pick up". |
| `site-data` + `controls` + `mods` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `site-data` + `controls` + `preload` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `site-data` + `controls` + `media` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `site-data` + `controls` + `search-box` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `site-data` + `controls` + `go-to` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `site-data` + `controls` + `embeds` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video comes from, by which video it offers you". |
| `site-data` + `controls` + `rewrite-requests` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `site-data` + `controls` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `site-data` + `controls` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it". |
| `site-data` + `controls` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you". |
| `site-data` + `controls` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `site-data` + `controls` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post". |
| `site-data` + `mods` + `preload` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `site-data` + `mods` + `media` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `site-data` + `mods` + `search-box` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `site-data` + `mods` + `go-to` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `site-data` + `mods` + `embeds` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video comes from, by which video it offers you". |
| `site-data` + `mods` + `rewrite-requests` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `site-data` + `mods` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `site-data` + `mods` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it". |
| `site-data` + `mods` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you". |
| `site-data` + `mods` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `site-data` + `mods` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post". |
| `site-data` + `preload` + `media` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `site-data` + `preload` + `search-box` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `site-data` + `preload` + `go-to` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `site-data` + `preload` + `embeds` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads"; "could pass what it reads to the site a video comes from, by which video it offers you". |
| `site-data` + `preload` + `rewrite-requests` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `site-data` + `preload` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `site-data` + `preload` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `site-data` + `preload` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `site-data` + `preload` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `site-data` + `preload` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `site-data` + `media` + `search-box` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `site-data` + `media` + `go-to` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `site-data` + `media` + `embeds` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it"; "could pass what it reads to the site a video comes from, by which video it offers you". |
| `site-data` + `media` + `rewrite-requests` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `site-data` + `media` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on"; "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `site-data` + `media` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `site-data` + `media` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you"; "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `site-data` + `media` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `site-data` + `media` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post"; "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `site-data` + `search-box` + `go-to` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `site-data` + `search-box` + `embeds` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video comes from, by which video it offers you". |
| `site-data` + `search-box` + `rewrite-requests` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `site-data` + `search-box` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `site-data` + `search-box` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it". |
| `site-data` + `search-box` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you". |
| `site-data` + `search-box` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `site-data` + `search-box` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post". |
| `site-data` + `go-to` + `embeds` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video comes from, by which video it offers you". |
| `site-data` + `go-to` + `rewrite-requests` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `site-data` + `go-to` + `block-events` | No more than its pairs, whose warnings show: "could keep your clicks from reaching the page and take you to another page in their place"; "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `site-data` + `go-to` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could take you to a page and set off that page's own actions there". |
| `site-data` + `go-to` + `click` | No more than its pairs, whose warnings show: "could take you to a page and click things there for you"; "could let what it reads decide what it clicks for you". |
| `site-data` + `go-to` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `site-data` + `go-to` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post". |
| `site-data` + `embeds` + `rewrite-requests` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video comes from, by which video it offers you". |
| `site-data` + `embeds` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on"; "could pass what it reads to the site a video comes from, by which video it offers you". |
| `site-data` + `embeds` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could pass what it reads to the site a video comes from, by which video it offers you". |
| `site-data` + `embeds` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you"; "could pass what it reads to the site a video comes from, by which video it offers you". |
| `site-data` + `embeds` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could pass what it reads to the site a video comes from, by which video it offers you". |
| `site-data` + `embeds` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post"; "could pass what it reads to the site a video comes from, by which video it offers you". |
| `site-data` + `rewrite-requests` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `site-data` + `rewrite-requests` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could set off this page's own actions and change what the site receives from them". |
| `site-data` + `rewrite-requests` + `click` | No more than its pairs, whose warnings show: "could click things for you and change what the site receives from those clicks"; "could let what it reads decide what it clicks for you". |
| `site-data` + `rewrite-requests` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `site-data` + `rewrite-requests` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post". |
| `site-data` + `block-events` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could keep your clicks from reaching the page and set off the page's own actions in their place"; "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `site-data` + `block-events` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you"; "could keep your clicks from reaching the page and click in their place"; "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `site-data` + `block-events` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `site-data` + `block-events` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post"; "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `site-data` + `page-events` + `click` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could let what it reads decide what it clicks for you". |
| `site-data` + `page-events` + `write-drafts` | **Together, it could put what it reads into a post and send it for you.** |
| `site-data` + `page-events` + `edit-uploads` | **Together, it could put what it reads into a post and send it for you.** |
| `site-data` + `click` + `write-drafts` | **Together, it could put what it reads into a post and send it for you.** |
| `site-data` + `click` + `edit-uploads` | **Together, it could put what it reads into a post and send it for you.** |
| `site-data` + `write-drafts` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could put what it reads into a picture you post". |

### Triples starting with `page-data`

| combination | the hold |
|---|---|
| `page-data` + `site-storage` + `local-fonts` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later". |
| `page-data` + `site-storage` + `image-variants` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `page-data` + `site-storage` + `sound` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later"; "could turn what it reads into sounds that a device nearby could pick up". |
| `page-data` + `site-storage` + `controls` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later". |
| `page-data` + `site-storage` + `mods` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later". |
| `page-data` + `site-storage` + `preload` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `page-data` + `site-storage` + `media` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later"; "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `page-data` + `site-storage` + `search-box` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later". |
| `page-data` + `site-storage` + `go-to` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later"; "could take you to a page and set off that page's own actions there". |
| `page-data` + `site-storage` + `embeds` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later"; "could pass what it reads to the site a video comes from, by which video it offers you". |
| `page-data` + `site-storage` + `rewrite-requests` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later". |
| `page-data` + `site-storage` + `block-events` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later"; "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `page-data` + `site-storage` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could keep what it reads where this site's own code, and your other boxed mods, can find it later". |
| `page-data` + `site-storage` + `click` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later"; "could let what it reads decide what it clicks for you". |
| `page-data` + `site-storage` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could keep what it reads where this site's own code, and your other boxed mods, can find it later". |
| `page-data` + `site-storage` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post"; "could keep what it reads where this site's own code, and your other boxed mods, can find it later". |
| `page-data` + `local-fonts` + `image-variants` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `page-data` + `local-fonts` + `sound` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `page-data` + `local-fonts` + `controls` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `page-data` + `local-fonts` + `mods` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `page-data` + `local-fonts` + `preload` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `page-data` + `local-fonts` + `media` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `page-data` + `local-fonts` + `search-box` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `page-data` + `local-fonts` + `go-to` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `page-data` + `local-fonts` + `embeds` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video comes from, by which video it offers you". |
| `page-data` + `local-fonts` + `rewrite-requests` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `page-data` + `local-fonts` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `page-data` + `local-fonts` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it". |
| `page-data` + `local-fonts` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you". |
| `page-data` + `local-fonts` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `page-data` + `local-fonts` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post". |
| `page-data` + `image-variants` + `sound` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads"; "could turn what it reads into sounds that a device nearby could pick up". |
| `page-data` + `image-variants` + `controls` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `page-data` + `image-variants` + `mods` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `page-data` + `image-variants` + `preload` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `page-data` + `image-variants` + `media` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `page-data` + `image-variants` + `search-box` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `page-data` + `image-variants` + `go-to` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `page-data` + `image-variants` + `embeds` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads"; "could pass what it reads to the site a video comes from, by which video it offers you". |
| `page-data` + `image-variants` + `rewrite-requests` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `page-data` + `image-variants` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `page-data` + `image-variants` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `page-data` + `image-variants` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `page-data` + `image-variants` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `page-data` + `image-variants` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `page-data` + `sound` + `controls` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `page-data` + `sound` + `mods` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `page-data` + `sound` + `preload` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads"; "could turn what it reads into sounds that a device nearby could pick up". |
| `page-data` + `sound` + `media` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it"; "could turn what it reads into sounds that a device nearby could pick up". |
| `page-data` + `sound` + `search-box` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `page-data` + `sound` + `go-to` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `page-data` + `sound` + `embeds` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video comes from, by which video it offers you"; "could turn what it reads into sounds that a device nearby could pick up". |
| `page-data` + `sound` + `rewrite-requests` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `page-data` + `sound` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on"; "could turn what it reads into sounds that a device nearby could pick up". |
| `page-data` + `sound` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could turn what it reads into sounds that a device nearby could pick up". |
| `page-data` + `sound` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you"; "could turn what it reads into sounds that a device nearby could pick up". |
| `page-data` + `sound` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could turn what it reads into sounds that a device nearby could pick up". |
| `page-data` + `sound` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post"; "could turn what it reads into sounds that a device nearby could pick up". |
| `page-data` + `controls` + `mods` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `page-data` + `controls` + `preload` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `page-data` + `controls` + `media` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `page-data` + `controls` + `search-box` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `page-data` + `controls` + `go-to` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `page-data` + `controls` + `embeds` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video comes from, by which video it offers you". |
| `page-data` + `controls` + `rewrite-requests` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `page-data` + `controls` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `page-data` + `controls` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it". |
| `page-data` + `controls` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you". |
| `page-data` + `controls` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `page-data` + `controls` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post". |
| `page-data` + `mods` + `preload` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `page-data` + `mods` + `media` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `page-data` + `mods` + `search-box` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `page-data` + `mods` + `go-to` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `page-data` + `mods` + `embeds` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video comes from, by which video it offers you". |
| `page-data` + `mods` + `rewrite-requests` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `page-data` + `mods` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `page-data` + `mods` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it". |
| `page-data` + `mods` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you". |
| `page-data` + `mods` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `page-data` + `mods` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post". |
| `page-data` + `preload` + `media` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `page-data` + `preload` + `search-box` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `page-data` + `preload` + `go-to` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `page-data` + `preload` + `embeds` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads"; "could pass what it reads to the site a video comes from, by which video it offers you". |
| `page-data` + `preload` + `rewrite-requests` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `page-data` + `preload` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `page-data` + `preload` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `page-data` + `preload` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `page-data` + `preload` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `page-data` + `preload` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `page-data` + `media` + `search-box` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `page-data` + `media` + `go-to` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `page-data` + `media` + `embeds` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it"; "could pass what it reads to the site a video comes from, by which video it offers you". |
| `page-data` + `media` + `rewrite-requests` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `page-data` + `media` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on"; "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `page-data` + `media` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `page-data` + `media` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you"; "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `page-data` + `media` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `page-data` + `media` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post"; "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `page-data` + `search-box` + `go-to` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `page-data` + `search-box` + `embeds` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video comes from, by which video it offers you". |
| `page-data` + `search-box` + `rewrite-requests` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `page-data` + `search-box` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `page-data` + `search-box` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it". |
| `page-data` + `search-box` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you". |
| `page-data` + `search-box` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `page-data` + `search-box` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post". |
| `page-data` + `go-to` + `embeds` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video comes from, by which video it offers you". |
| `page-data` + `go-to` + `rewrite-requests` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `page-data` + `go-to` + `block-events` | No more than its pairs, whose warnings show: "could keep your clicks from reaching the page and take you to another page in their place"; "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `page-data` + `go-to` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could take you to a page and set off that page's own actions there". |
| `page-data` + `go-to` + `click` | No more than its pairs, whose warnings show: "could take you to a page and click things there for you"; "could let what it reads decide what it clicks for you". |
| `page-data` + `go-to` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `page-data` + `go-to` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post". |
| `page-data` + `embeds` + `rewrite-requests` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video comes from, by which video it offers you". |
| `page-data` + `embeds` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on"; "could pass what it reads to the site a video comes from, by which video it offers you". |
| `page-data` + `embeds` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could pass what it reads to the site a video comes from, by which video it offers you". |
| `page-data` + `embeds` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you"; "could pass what it reads to the site a video comes from, by which video it offers you". |
| `page-data` + `embeds` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could pass what it reads to the site a video comes from, by which video it offers you". |
| `page-data` + `embeds` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post"; "could pass what it reads to the site a video comes from, by which video it offers you". |
| `page-data` + `rewrite-requests` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `page-data` + `rewrite-requests` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could set off this page's own actions and change what the site receives from them". |
| `page-data` + `rewrite-requests` + `click` | No more than its pairs, whose warnings show: "could click things for you and change what the site receives from those clicks"; "could let what it reads decide what it clicks for you". |
| `page-data` + `rewrite-requests` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `page-data` + `rewrite-requests` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post". |
| `page-data` + `block-events` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could keep your clicks from reaching the page and set off the page's own actions in their place"; "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `page-data` + `block-events` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you"; "could keep your clicks from reaching the page and click in their place"; "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `page-data` + `block-events` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `page-data` + `block-events` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post"; "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `page-data` + `page-events` + `click` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could let what it reads decide what it clicks for you". |
| `page-data` + `page-events` + `write-drafts` | **Together, it could put what it reads into a post and send it for you.** |
| `page-data` + `page-events` + `edit-uploads` | **Together, it could put what it reads into a post and send it for you.** |
| `page-data` + `click` + `write-drafts` | **Together, it could put what it reads into a post and send it for you.** |
| `page-data` + `click` + `edit-uploads` | **Together, it could put what it reads into a post and send it for you.** |
| `page-data` + `write-drafts` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could put what it reads into a picture you post". |

### Triples starting with `site-storage`

| combination | the hold |
|---|---|
| `site-storage` + `local-fonts` + `image-variants` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `site-storage` + `local-fonts` + `sound` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later"; "could turn what it reads into sounds that a device nearby could pick up". |
| `site-storage` + `local-fonts` + `controls` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later". |
| `site-storage` + `local-fonts` + `mods` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later". |
| `site-storage` + `local-fonts` + `preload` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `site-storage` + `local-fonts` + `media` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later"; "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `site-storage` + `local-fonts` + `search-box` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later". |
| `site-storage` + `local-fonts` + `go-to` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later"; "could take you to a page and set off that page's own actions there". |
| `site-storage` + `local-fonts` + `embeds` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later"; "could pass what it reads to the site a video comes from, by which video it offers you". |
| `site-storage` + `local-fonts` + `rewrite-requests` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later". |
| `site-storage` + `local-fonts` + `block-events` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later"; "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `site-storage` + `local-fonts` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could keep what it reads where this site's own code, and your other boxed mods, can find it later". |
| `site-storage` + `local-fonts` + `click` | No more than its pairs, whose warnings show: "could keep what it reads where this site's own code, and your other boxed mods, can find it later"; "could let what it reads decide what it clicks for you". |
| `site-storage` + `local-fonts` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could keep what it reads where this site's own code, and your other boxed mods, can find it later". |
| `site-storage` + `local-fonts` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post"; "could keep what it reads where this site's own code, and your other boxed mods, can find it later". |
| `site-storage` + `image-variants` + `sound` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads"; "could turn what it reads into sounds that a device nearby could pick up". |
| `site-storage` + `image-variants` + `controls` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `site-storage` + `image-variants` + `mods` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `site-storage` + `image-variants` + `preload` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `site-storage` + `image-variants` + `media` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `site-storage` + `image-variants` + `search-box` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `site-storage` + `image-variants` + `go-to` | No more than its pairs, whose warnings show: "could take you to a page and set off that page's own actions there"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `site-storage` + `image-variants` + `embeds` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads"; "could pass what it reads to the site a video comes from, by which video it offers you". |
| `site-storage` + `image-variants` + `rewrite-requests` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `site-storage` + `image-variants` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `site-storage` + `image-variants` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `site-storage` + `image-variants` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `site-storage` + `image-variants` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `site-storage` + `image-variants` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `site-storage` + `sound` + `controls` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `site-storage` + `sound` + `mods` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `site-storage` + `sound` + `preload` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads"; "could turn what it reads into sounds that a device nearby could pick up". |
| `site-storage` + `sound` + `media` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it"; "could turn what it reads into sounds that a device nearby could pick up". |
| `site-storage` + `sound` + `search-box` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `site-storage` + `sound` + `go-to` | No more than its pairs, whose warnings show: "could take you to a page and set off that page's own actions there"; "could turn what it reads into sounds that a device nearby could pick up". |
| `site-storage` + `sound` + `embeds` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video comes from, by which video it offers you"; "could turn what it reads into sounds that a device nearby could pick up". |
| `site-storage` + `sound` + `rewrite-requests` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `site-storage` + `sound` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on"; "could turn what it reads into sounds that a device nearby could pick up". |
| `site-storage` + `sound` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could turn what it reads into sounds that a device nearby could pick up". |
| `site-storage` + `sound` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you"; "could turn what it reads into sounds that a device nearby could pick up". |
| `site-storage` + `sound` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could turn what it reads into sounds that a device nearby could pick up". |
| `site-storage` + `sound` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post"; "could turn what it reads into sounds that a device nearby could pick up". |
| `site-storage` + `controls` + `mods` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `site-storage` + `controls` + `preload` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `site-storage` + `controls` + `media` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `site-storage` + `controls` + `search-box` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `site-storage` + `controls` + `go-to` | No more than its pairs, whose warnings show: "could take you to a page and set off that page's own actions there". |
| `site-storage` + `controls` + `embeds` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video comes from, by which video it offers you". |
| `site-storage` + `controls` + `rewrite-requests` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `site-storage` + `controls` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `site-storage` + `controls` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it". |
| `site-storage` + `controls` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you". |
| `site-storage` + `controls` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `site-storage` + `controls` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post". |
| `site-storage` + `mods` + `preload` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `site-storage` + `mods` + `media` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `site-storage` + `mods` + `search-box` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `site-storage` + `mods` + `go-to` | No more than its pairs, whose warnings show: "could take you to a page and set off that page's own actions there". |
| `site-storage` + `mods` + `embeds` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video comes from, by which video it offers you". |
| `site-storage` + `mods` + `rewrite-requests` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `site-storage` + `mods` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `site-storage` + `mods` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it". |
| `site-storage` + `mods` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you". |
| `site-storage` + `mods` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `site-storage` + `mods` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post". |
| `site-storage` + `preload` + `media` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `site-storage` + `preload` + `search-box` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `site-storage` + `preload` + `go-to` | No more than its pairs, whose warnings show: "could take you to a page and set off that page's own actions there"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `site-storage` + `preload` + `embeds` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads"; "could pass what it reads to the site a video comes from, by which video it offers you". |
| `site-storage` + `preload` + `rewrite-requests` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `site-storage` + `preload` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `site-storage` + `preload` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `site-storage` + `preload` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `site-storage` + `preload` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `site-storage` + `preload` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `site-storage` + `media` + `search-box` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `site-storage` + `media` + `go-to` | No more than its pairs, whose warnings show: "could take you to a page and set off that page's own actions there"; "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `site-storage` + `media` + `embeds` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it"; "could pass what it reads to the site a video comes from, by which video it offers you". |
| `site-storage` + `media` + `rewrite-requests` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `site-storage` + `media` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on"; "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `site-storage` + `media` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `site-storage` + `media` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you"; "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `site-storage` + `media` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `site-storage` + `media` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post"; "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `site-storage` + `search-box` + `go-to` | No more than its pairs, whose warnings show: "could take you to a page and set off that page's own actions there". |
| `site-storage` + `search-box` + `embeds` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video comes from, by which video it offers you". |
| `site-storage` + `search-box` + `rewrite-requests` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `site-storage` + `search-box` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `site-storage` + `search-box` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it". |
| `site-storage` + `search-box` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you". |
| `site-storage` + `search-box` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `site-storage` + `search-box` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post". |
| `site-storage` + `go-to` + `embeds` | No more than its pairs, whose warnings show: "could take you to a page and set off that page's own actions there"; "could pass what it reads to the site a video comes from, by which video it offers you". |
| `site-storage` + `go-to` + `rewrite-requests` | No more than its pairs, whose warnings show: "could take you to a page and set off that page's own actions there". |
| `site-storage` + `go-to` + `block-events` | No more than its pairs, whose warnings show: "could take you to a page and set off that page's own actions there"; "could keep your clicks from reaching the page and take you to another page in their place"; "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `site-storage` + `go-to` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could take you to a page and set off that page's own actions there". |
| `site-storage` + `go-to` + `click` | No more than its pairs, whose warnings show: "could take you to a page and click things there for you"; "could take you to a page and set off that page's own actions there"; "could let what it reads decide what it clicks for you". |
| `site-storage` + `go-to` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could take you to a page and set off that page's own actions there". |
| `site-storage` + `go-to` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post"; "could take you to a page and set off that page's own actions there". |
| `site-storage` + `embeds` + `rewrite-requests` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video comes from, by which video it offers you". |
| `site-storage` + `embeds` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on"; "could pass what it reads to the site a video comes from, by which video it offers you". |
| `site-storage` + `embeds` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could pass what it reads to the site a video comes from, by which video it offers you". |
| `site-storage` + `embeds` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you"; "could pass what it reads to the site a video comes from, by which video it offers you". |
| `site-storage` + `embeds` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could pass what it reads to the site a video comes from, by which video it offers you". |
| `site-storage` + `embeds` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post"; "could pass what it reads to the site a video comes from, by which video it offers you". |
| `site-storage` + `rewrite-requests` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `site-storage` + `rewrite-requests` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could set off this page's own actions and change what the site receives from them". |
| `site-storage` + `rewrite-requests` + `click` | No more than its pairs, whose warnings show: "could click things for you and change what the site receives from those clicks"; "could let what it reads decide what it clicks for you". |
| `site-storage` + `rewrite-requests` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `site-storage` + `rewrite-requests` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post". |
| `site-storage` + `block-events` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could keep your clicks from reaching the page and set off the page's own actions in their place"; "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `site-storage` + `block-events` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you"; "could keep your clicks from reaching the page and click in their place"; "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `site-storage` + `block-events` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `site-storage` + `block-events` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post"; "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `site-storage` + `page-events` + `click` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could let what it reads decide what it clicks for you". |
| `site-storage` + `page-events` + `write-drafts` | **Together, it could put what it reads into a post and send it for you.** |
| `site-storage` + `page-events` + `edit-uploads` | **Together, it could put what it reads into a post and send it for you.** |
| `site-storage` + `click` + `write-drafts` | **Together, it could put what it reads into a post and send it for you.** |
| `site-storage` + `click` + `edit-uploads` | **Together, it could put what it reads into a post and send it for you.** |
| `site-storage` + `write-drafts` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could put what it reads into a picture you post". |

### Triples starting with `local-fonts`

| combination | the hold |
|---|---|
| `local-fonts` + `image-variants` + `sound` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads"; "could turn what it reads into sounds that a device nearby could pick up". |
| `local-fonts` + `image-variants` + `controls` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `local-fonts` + `image-variants` + `mods` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `local-fonts` + `image-variants` + `preload` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `local-fonts` + `image-variants` + `media` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `local-fonts` + `image-variants` + `search-box` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `local-fonts` + `image-variants` + `go-to` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `local-fonts` + `image-variants` + `embeds` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads"; "could pass what it reads to the site a video comes from, by which video it offers you". |
| `local-fonts` + `image-variants` + `rewrite-requests` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `local-fonts` + `image-variants` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `local-fonts` + `image-variants` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `local-fonts` + `image-variants` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `local-fonts` + `image-variants` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `local-fonts` + `image-variants` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `local-fonts` + `sound` + `controls` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `local-fonts` + `sound` + `mods` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `local-fonts` + `sound` + `preload` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads"; "could turn what it reads into sounds that a device nearby could pick up". |
| `local-fonts` + `sound` + `media` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it"; "could turn what it reads into sounds that a device nearby could pick up". |
| `local-fonts` + `sound` + `search-box` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `local-fonts` + `sound` + `go-to` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `local-fonts` + `sound` + `embeds` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video comes from, by which video it offers you"; "could turn what it reads into sounds that a device nearby could pick up". |
| `local-fonts` + `sound` + `rewrite-requests` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `local-fonts` + `sound` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on"; "could turn what it reads into sounds that a device nearby could pick up". |
| `local-fonts` + `sound` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could turn what it reads into sounds that a device nearby could pick up". |
| `local-fonts` + `sound` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you"; "could turn what it reads into sounds that a device nearby could pick up". |
| `local-fonts` + `sound` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could turn what it reads into sounds that a device nearby could pick up". |
| `local-fonts` + `sound` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post"; "could turn what it reads into sounds that a device nearby could pick up". |
| `local-fonts` + `controls` + `mods` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `local-fonts` + `controls` + `preload` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `local-fonts` + `controls` + `media` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `local-fonts` + `controls` + `search-box` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `local-fonts` + `controls` + `go-to` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `local-fonts` + `controls` + `embeds` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video comes from, by which video it offers you". |
| `local-fonts` + `controls` + `rewrite-requests` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `local-fonts` + `controls` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `local-fonts` + `controls` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it". |
| `local-fonts` + `controls` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you". |
| `local-fonts` + `controls` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `local-fonts` + `controls` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post". |
| `local-fonts` + `mods` + `preload` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `local-fonts` + `mods` + `media` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `local-fonts` + `mods` + `search-box` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `local-fonts` + `mods` + `go-to` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `local-fonts` + `mods` + `embeds` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video comes from, by which video it offers you". |
| `local-fonts` + `mods` + `rewrite-requests` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `local-fonts` + `mods` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `local-fonts` + `mods` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it". |
| `local-fonts` + `mods` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you". |
| `local-fonts` + `mods` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `local-fonts` + `mods` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post". |
| `local-fonts` + `preload` + `media` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `local-fonts` + `preload` + `search-box` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `local-fonts` + `preload` + `go-to` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `local-fonts` + `preload` + `embeds` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads"; "could pass what it reads to the site a video comes from, by which video it offers you". |
| `local-fonts` + `preload` + `rewrite-requests` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `local-fonts` + `preload` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `local-fonts` + `preload` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `local-fonts` + `preload` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `local-fonts` + `preload` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `local-fonts` + `preload` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `local-fonts` + `media` + `search-box` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `local-fonts` + `media` + `go-to` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `local-fonts` + `media` + `embeds` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it"; "could pass what it reads to the site a video comes from, by which video it offers you". |
| `local-fonts` + `media` + `rewrite-requests` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `local-fonts` + `media` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on"; "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `local-fonts` + `media` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `local-fonts` + `media` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you"; "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `local-fonts` + `media` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `local-fonts` + `media` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post"; "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `local-fonts` + `search-box` + `go-to` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `local-fonts` + `search-box` + `embeds` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video comes from, by which video it offers you". |
| `local-fonts` + `search-box` + `rewrite-requests` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `local-fonts` + `search-box` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `local-fonts` + `search-box` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it". |
| `local-fonts` + `search-box` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you". |
| `local-fonts` + `search-box` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `local-fonts` + `search-box` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post". |
| `local-fonts` + `go-to` + `embeds` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video comes from, by which video it offers you". |
| `local-fonts` + `go-to` + `rewrite-requests` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `local-fonts` + `go-to` + `block-events` | No more than its pairs, whose warnings show: "could keep your clicks from reaching the page and take you to another page in their place"; "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `local-fonts` + `go-to` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could take you to a page and set off that page's own actions there". |
| `local-fonts` + `go-to` + `click` | No more than its pairs, whose warnings show: "could take you to a page and click things there for you"; "could let what it reads decide what it clicks for you". |
| `local-fonts` + `go-to` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `local-fonts` + `go-to` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post". |
| `local-fonts` + `embeds` + `rewrite-requests` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video comes from, by which video it offers you". |
| `local-fonts` + `embeds` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on"; "could pass what it reads to the site a video comes from, by which video it offers you". |
| `local-fonts` + `embeds` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could pass what it reads to the site a video comes from, by which video it offers you". |
| `local-fonts` + `embeds` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you"; "could pass what it reads to the site a video comes from, by which video it offers you". |
| `local-fonts` + `embeds` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could pass what it reads to the site a video comes from, by which video it offers you". |
| `local-fonts` + `embeds` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post"; "could pass what it reads to the site a video comes from, by which video it offers you". |
| `local-fonts` + `rewrite-requests` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `local-fonts` + `rewrite-requests` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could set off this page's own actions and change what the site receives from them". |
| `local-fonts` + `rewrite-requests` + `click` | No more than its pairs, whose warnings show: "could click things for you and change what the site receives from those clicks"; "could let what it reads decide what it clicks for you". |
| `local-fonts` + `rewrite-requests` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `local-fonts` + `rewrite-requests` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post". |
| `local-fonts` + `block-events` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could keep your clicks from reaching the page and set off the page's own actions in their place"; "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `local-fonts` + `block-events` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you"; "could keep your clicks from reaching the page and click in their place"; "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `local-fonts` + `block-events` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `local-fonts` + `block-events` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post"; "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `local-fonts` + `page-events` + `click` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could let what it reads decide what it clicks for you". |
| `local-fonts` + `page-events` + `write-drafts` | **Together, it could put what it reads into a post and send it for you.** |
| `local-fonts` + `page-events` + `edit-uploads` | **Together, it could put what it reads into a post and send it for you.** |
| `local-fonts` + `click` + `write-drafts` | **Together, it could put what it reads into a post and send it for you.** |
| `local-fonts` + `click` + `edit-uploads` | **Together, it could put what it reads into a post and send it for you.** |
| `local-fonts` + `write-drafts` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could put what it reads into a picture you post". |

### Triples starting with `image-variants`

| combination | the hold |
|---|---|
| `image-variants` + `sound` + `controls` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `image-variants` + `sound` + `mods` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `image-variants` + `sound` + `preload` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `image-variants` + `sound` + `media` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it"; "could turn what it reads into sounds that a device nearby could pick up". |
| `image-variants` + `sound` + `search-box` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `image-variants` + `sound` + `go-to` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `image-variants` + `sound` + `embeds` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video comes from, by which video it offers you"; "could turn what it reads into sounds that a device nearby could pick up". |
| `image-variants` + `sound` + `rewrite-requests` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `image-variants` + `sound` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on"; "could turn what it reads into sounds that a device nearby could pick up". |
| `image-variants` + `sound` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could turn what it reads into sounds that a device nearby could pick up". |
| `image-variants` + `sound` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you"; "could turn what it reads into sounds that a device nearby could pick up". |
| `image-variants` + `sound` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could turn what it reads into sounds that a device nearby could pick up". |
| `image-variants` + `sound` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post"; "could turn what it reads into sounds that a device nearby could pick up". |
| `image-variants` + `controls` + `mods` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `image-variants` + `controls` + `preload` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `image-variants` + `controls` + `media` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `image-variants` + `controls` + `search-box` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `image-variants` + `controls` + `go-to` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `image-variants` + `controls` + `embeds` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video comes from, by which video it offers you". |
| `image-variants` + `controls` + `rewrite-requests` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `image-variants` + `controls` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `image-variants` + `controls` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it". |
| `image-variants` + `controls` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you". |
| `image-variants` + `controls` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `image-variants` + `controls` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post". |
| `image-variants` + `mods` + `preload` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `image-variants` + `mods` + `media` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `image-variants` + `mods` + `search-box` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `image-variants` + `mods` + `go-to` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `image-variants` + `mods` + `embeds` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video comes from, by which video it offers you". |
| `image-variants` + `mods` + `rewrite-requests` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `image-variants` + `mods` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `image-variants` + `mods` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it". |
| `image-variants` + `mods` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you". |
| `image-variants` + `mods` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `image-variants` + `mods` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post". |
| `image-variants` + `preload` + `media` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `image-variants` + `preload` + `search-box` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `image-variants` + `preload` + `go-to` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `image-variants` + `preload` + `embeds` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video comes from, by which video it offers you". |
| `image-variants` + `preload` + `rewrite-requests` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `image-variants` + `preload` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `image-variants` + `preload` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it". |
| `image-variants` + `preload` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you". |
| `image-variants` + `preload` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `image-variants` + `preload` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `image-variants` + `media` + `search-box` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `image-variants` + `media` + `go-to` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `image-variants` + `media` + `embeds` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it"; "could pass what it reads to the site a video comes from, by which video it offers you". |
| `image-variants` + `media` + `rewrite-requests` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `image-variants` + `media` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on"; "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `image-variants` + `media` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `image-variants` + `media` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you"; "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `image-variants` + `media` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `image-variants` + `media` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post"; "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `image-variants` + `search-box` + `go-to` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `image-variants` + `search-box` + `embeds` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video comes from, by which video it offers you". |
| `image-variants` + `search-box` + `rewrite-requests` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `image-variants` + `search-box` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `image-variants` + `search-box` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it". |
| `image-variants` + `search-box` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you". |
| `image-variants` + `search-box` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `image-variants` + `search-box` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post". |
| `image-variants` + `go-to` + `embeds` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video comes from, by which video it offers you". |
| `image-variants` + `go-to` + `rewrite-requests` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `image-variants` + `go-to` + `block-events` | No more than its pairs, whose warnings show: "could keep your clicks from reaching the page and take you to another page in their place"; "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `image-variants` + `go-to` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could take you to a page and set off that page's own actions there". |
| `image-variants` + `go-to` + `click` | No more than its pairs, whose warnings show: "could take you to a page and click things there for you"; "could let what it reads decide what it clicks for you". |
| `image-variants` + `go-to` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `image-variants` + `go-to` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post". |
| `image-variants` + `embeds` + `rewrite-requests` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video comes from, by which video it offers you". |
| `image-variants` + `embeds` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on"; "could pass what it reads to the site a video comes from, by which video it offers you". |
| `image-variants` + `embeds` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could pass what it reads to the site a video comes from, by which video it offers you". |
| `image-variants` + `embeds` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you"; "could pass what it reads to the site a video comes from, by which video it offers you". |
| `image-variants` + `embeds` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could pass what it reads to the site a video comes from, by which video it offers you". |
| `image-variants` + `embeds` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post"; "could pass what it reads to the site a video comes from, by which video it offers you". |
| `image-variants` + `rewrite-requests` + `block-events` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `image-variants` + `rewrite-requests` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could set off this page's own actions and change what the site receives from them". |
| `image-variants` + `rewrite-requests` + `click` | No more than its pairs, whose warnings show: "could click things for you and change what the site receives from those clicks"; "could let what it reads decide what it clicks for you". |
| `image-variants` + `rewrite-requests` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `image-variants` + `rewrite-requests` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post". |
| `image-variants` + `block-events` + `page-events` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could keep your clicks from reaching the page and set off the page's own actions in their place"; "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `image-variants` + `block-events` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you"; "could keep your clicks from reaching the page and click in their place"; "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `image-variants` + `block-events` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `image-variants` + `block-events` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into a picture you post"; "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `image-variants` + `page-events` + `click` | No more than its pairs, whose warnings show: "could hand what it reads to this page's own code, which may post or send it"; "could let what it reads decide what it clicks for you". |
| `image-variants` + `page-events` + `write-drafts` | **Together, it could put what it reads into a post and send it for you.** |
| `image-variants` + `page-events` + `edit-uploads` | **Together, it could put what it reads into a post and send it for you.** |
| `image-variants` + `click` + `write-drafts` | **Together, it could put what it reads into a post and send it for you.** |
| `image-variants` + `click` + `edit-uploads` | **Together, it could put what it reads into a post and send it for you.** |
| `image-variants` + `write-drafts` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could put what it reads into a picture you post". |

### Triples starting with `sound`

| combination | the hold |
|---|---|
| `sound` + `controls` + `mods` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `controls` + `preload` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `controls` + `media` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `controls` + `search-box` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `controls` + `go-to` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `controls` + `embeds` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `controls` + `rewrite-requests` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `controls` + `block-events` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `controls` + `page-events` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `controls` + `click` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `controls` + `write-drafts` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `controls` + `edit-uploads` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `sound` + `mods` + `preload` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `mods` + `media` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `mods` + `search-box` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `mods` + `go-to` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `mods` + `embeds` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `mods` + `rewrite-requests` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `mods` + `block-events` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `mods` + `page-events` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `mods` + `click` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `mods` + `write-drafts` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `mods` + `edit-uploads` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `sound` + `preload` + `media` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `preload` + `search-box` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `preload` + `go-to` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `preload` + `embeds` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `preload` + `rewrite-requests` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `preload` + `block-events` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `preload` + `page-events` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `preload` + `click` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `preload` + `write-drafts` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `preload` + `edit-uploads` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads"; "could turn what it reads into sounds that a device nearby could pick up". |
| `sound` + `media` + `search-box` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `media` + `go-to` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `media` + `embeds` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `media` + `rewrite-requests` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `media` + `block-events` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `media` + `page-events` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `media` + `click` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `media` + `write-drafts` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `media` + `edit-uploads` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it"; "could turn what it reads into sounds that a device nearby could pick up". |
| `sound` + `search-box` + `go-to` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `search-box` + `embeds` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `search-box` + `rewrite-requests` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `search-box` + `block-events` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `search-box` + `page-events` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `search-box` + `click` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `search-box` + `write-drafts` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `search-box` + `edit-uploads` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `sound` + `go-to` + `embeds` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `go-to` + `rewrite-requests` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `go-to` + `block-events` | No more than its pairs, whose warnings show: "could keep your clicks from reaching the page and take you to another page in their place". |
| `sound` + `go-to` + `page-events` | No more than its pairs, whose warnings show: "could take you to a page and set off that page's own actions there". |
| `sound` + `go-to` + `click` | No more than its pairs, whose warnings show: "could take you to a page and click things there for you". |
| `sound` + `go-to` + `write-drafts` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `go-to` + `edit-uploads` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `sound` + `embeds` + `rewrite-requests` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `embeds` + `block-events` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `embeds` + `page-events` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `embeds` + `click` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `embeds` + `write-drafts` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `embeds` + `edit-uploads` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video comes from, by which video it offers you"; "could turn what it reads into sounds that a device nearby could pick up". |
| `sound` + `rewrite-requests` + `block-events` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `rewrite-requests` + `page-events` | No more than its pairs, whose warnings show: "could set off this page's own actions and change what the site receives from them". |
| `sound` + `rewrite-requests` + `click` | No more than its pairs, whose warnings show: "could click things for you and change what the site receives from those clicks". |
| `sound` + `rewrite-requests` + `write-drafts` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `rewrite-requests` + `edit-uploads` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `sound` + `block-events` + `page-events` | No more than its pairs, whose warnings show: "could keep your clicks from reaching the page and set off the page's own actions in their place". |
| `sound` + `block-events` + `click` | No more than its pairs, whose warnings show: "could keep your clicks from reaching the page and click in their place". |
| `sound` + `block-events` + `write-drafts` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `block-events` + `edit-uploads` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on"; "could turn what it reads into sounds that a device nearby could pick up". |
| `sound` + `page-events` + `click` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `page-events` + `write-drafts` | No more than its pairs, whose warnings show: "could write a post and send it for you". |
| `sound` + `page-events` + `edit-uploads` | No more than its pairs, whose warnings show: "could write a post and send it for you"; "could turn what it reads into sounds that a device nearby could pick up". |
| `sound` + `click` + `write-drafts` | No more than its pairs, whose warnings show: "could write a post and send it for you". |
| `sound` + `click` + `edit-uploads` | No more than its pairs, whose warnings show: "could write a post and send it for you"; "could turn what it reads into sounds that a device nearby could pick up". |
| `sound` + `write-drafts` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could turn what it reads into sounds that a device nearby could pick up". |

### Triples starting with `controls`

| combination | the hold |
|---|---|
| `controls` + `mods` + `preload` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `controls` + `mods` + `media` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `controls` + `mods` + `search-box` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `controls` + `mods` + `go-to` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `controls` + `mods` + `embeds` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `controls` + `mods` + `rewrite-requests` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `controls` + `mods` + `block-events` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `controls` + `mods` + `page-events` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `controls` + `mods` + `click` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `controls` + `mods` + `write-drafts` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `controls` + `mods` + `edit-uploads` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `controls` + `preload` + `media` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `controls` + `preload` + `search-box` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `controls` + `preload` + `go-to` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `controls` + `preload` + `embeds` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `controls` + `preload` + `rewrite-requests` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `controls` + `preload` + `block-events` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `controls` + `preload` + `page-events` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `controls` + `preload` + `click` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `controls` + `preload` + `write-drafts` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `controls` + `preload` + `edit-uploads` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `controls` + `media` + `search-box` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `controls` + `media` + `go-to` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `controls` + `media` + `embeds` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `controls` + `media` + `rewrite-requests` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `controls` + `media` + `block-events` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `controls` + `media` + `page-events` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `controls` + `media` + `click` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `controls` + `media` + `write-drafts` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `controls` + `media` + `edit-uploads` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `controls` + `search-box` + `go-to` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `controls` + `search-box` + `embeds` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `controls` + `search-box` + `rewrite-requests` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `controls` + `search-box` + `block-events` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `controls` + `search-box` + `page-events` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `controls` + `search-box` + `click` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `controls` + `search-box` + `write-drafts` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `controls` + `search-box` + `edit-uploads` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `controls` + `go-to` + `embeds` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `controls` + `go-to` + `rewrite-requests` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `controls` + `go-to` + `block-events` | No more than its pairs, whose warnings show: "could keep your clicks from reaching the page and take you to another page in their place". |
| `controls` + `go-to` + `page-events` | No more than its pairs, whose warnings show: "could take you to a page and set off that page's own actions there". |
| `controls` + `go-to` + `click` | No more than its pairs, whose warnings show: "could take you to a page and click things there for you". |
| `controls` + `go-to` + `write-drafts` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `controls` + `go-to` + `edit-uploads` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `controls` + `embeds` + `rewrite-requests` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `controls` + `embeds` + `block-events` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `controls` + `embeds` + `page-events` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `controls` + `embeds` + `click` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `controls` + `embeds` + `write-drafts` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `controls` + `embeds` + `edit-uploads` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video comes from, by which video it offers you". |
| `controls` + `rewrite-requests` + `block-events` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `controls` + `rewrite-requests` + `page-events` | No more than its pairs, whose warnings show: "could set off this page's own actions and change what the site receives from them". |
| `controls` + `rewrite-requests` + `click` | No more than its pairs, whose warnings show: "could click things for you and change what the site receives from those clicks". |
| `controls` + `rewrite-requests` + `write-drafts` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `controls` + `rewrite-requests` + `edit-uploads` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `controls` + `block-events` + `page-events` | No more than its pairs, whose warnings show: "could keep your clicks from reaching the page and set off the page's own actions in their place". |
| `controls` + `block-events` + `click` | No more than its pairs, whose warnings show: "could keep your clicks from reaching the page and click in their place". |
| `controls` + `block-events` + `write-drafts` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `controls` + `block-events` + `edit-uploads` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `controls` + `page-events` + `click` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `controls` + `page-events` + `write-drafts` | No more than its pairs, whose warnings show: "could write a post and send it for you". |
| `controls` + `page-events` + `edit-uploads` | No more than its pairs, whose warnings show: "could write a post and send it for you". |
| `controls` + `click` + `write-drafts` | No more than its pairs, whose warnings show: "could write a post and send it for you". |
| `controls` + `click` + `edit-uploads` | No more than its pairs, whose warnings show: "could write a post and send it for you". |
| `controls` + `write-drafts` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |

### Triples starting with `mods`

| combination | the hold |
|---|---|
| `mods` + `preload` + `media` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `mods` + `preload` + `search-box` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `mods` + `preload` + `go-to` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `mods` + `preload` + `embeds` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `mods` + `preload` + `rewrite-requests` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `mods` + `preload` + `block-events` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `mods` + `preload` + `page-events` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `mods` + `preload` + `click` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `mods` + `preload` + `write-drafts` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `mods` + `preload` + `edit-uploads` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `mods` + `media` + `search-box` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `mods` + `media` + `go-to` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `mods` + `media` + `embeds` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `mods` + `media` + `rewrite-requests` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `mods` + `media` + `block-events` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `mods` + `media` + `page-events` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `mods` + `media` + `click` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `mods` + `media` + `write-drafts` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `mods` + `media` + `edit-uploads` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `mods` + `search-box` + `go-to` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `mods` + `search-box` + `embeds` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `mods` + `search-box` + `rewrite-requests` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `mods` + `search-box` + `block-events` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `mods` + `search-box` + `page-events` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `mods` + `search-box` + `click` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `mods` + `search-box` + `write-drafts` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `mods` + `search-box` + `edit-uploads` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `mods` + `go-to` + `embeds` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `mods` + `go-to` + `rewrite-requests` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `mods` + `go-to` + `block-events` | No more than its pairs, whose warnings show: "could keep your clicks from reaching the page and take you to another page in their place". |
| `mods` + `go-to` + `page-events` | No more than its pairs, whose warnings show: "could take you to a page and set off that page's own actions there". |
| `mods` + `go-to` + `click` | No more than its pairs, whose warnings show: "could take you to a page and click things there for you". |
| `mods` + `go-to` + `write-drafts` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `mods` + `go-to` + `edit-uploads` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `mods` + `embeds` + `rewrite-requests` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `mods` + `embeds` + `block-events` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `mods` + `embeds` + `page-events` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `mods` + `embeds` + `click` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `mods` + `embeds` + `write-drafts` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `mods` + `embeds` + `edit-uploads` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video comes from, by which video it offers you". |
| `mods` + `rewrite-requests` + `block-events` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `mods` + `rewrite-requests` + `page-events` | No more than its pairs, whose warnings show: "could set off this page's own actions and change what the site receives from them". |
| `mods` + `rewrite-requests` + `click` | No more than its pairs, whose warnings show: "could click things for you and change what the site receives from those clicks". |
| `mods` + `rewrite-requests` + `write-drafts` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `mods` + `rewrite-requests` + `edit-uploads` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `mods` + `block-events` + `page-events` | No more than its pairs, whose warnings show: "could keep your clicks from reaching the page and set off the page's own actions in their place". |
| `mods` + `block-events` + `click` | No more than its pairs, whose warnings show: "could keep your clicks from reaching the page and click in their place". |
| `mods` + `block-events` + `write-drafts` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `mods` + `block-events` + `edit-uploads` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `mods` + `page-events` + `click` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `mods` + `page-events` + `write-drafts` | No more than its pairs, whose warnings show: "could write a post and send it for you". |
| `mods` + `page-events` + `edit-uploads` | No more than its pairs, whose warnings show: "could write a post and send it for you". |
| `mods` + `click` + `write-drafts` | No more than its pairs, whose warnings show: "could write a post and send it for you". |
| `mods` + `click` + `edit-uploads` | No more than its pairs, whose warnings show: "could write a post and send it for you". |
| `mods` + `write-drafts` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |

### Triples starting with `preload`

| combination | the hold |
|---|---|
| `preload` + `media` + `search-box` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `preload` + `media` + `go-to` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `preload` + `media` + `embeds` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `preload` + `media` + `rewrite-requests` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `preload` + `media` + `block-events` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `preload` + `media` + `page-events` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `preload` + `media` + `click` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `preload` + `media` + `write-drafts` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `preload` + `media` + `edit-uploads` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `preload` + `search-box` + `go-to` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `preload` + `search-box` + `embeds` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `preload` + `search-box` + `rewrite-requests` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `preload` + `search-box` + `block-events` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `preload` + `search-box` + `page-events` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `preload` + `search-box` + `click` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `preload` + `search-box` + `write-drafts` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `preload` + `search-box` + `edit-uploads` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `preload` + `go-to` + `embeds` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `preload` + `go-to` + `rewrite-requests` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `preload` + `go-to` + `block-events` | No more than its pairs, whose warnings show: "could keep your clicks from reaching the page and take you to another page in their place". |
| `preload` + `go-to` + `page-events` | No more than its pairs, whose warnings show: "could take you to a page and set off that page's own actions there". |
| `preload` + `go-to` + `click` | No more than its pairs, whose warnings show: "could take you to a page and click things there for you". |
| `preload` + `go-to` + `write-drafts` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `preload` + `go-to` + `edit-uploads` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `preload` + `embeds` + `rewrite-requests` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `preload` + `embeds` + `block-events` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `preload` + `embeds` + `page-events` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `preload` + `embeds` + `click` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `preload` + `embeds` + `write-drafts` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `preload` + `embeds` + `edit-uploads` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads"; "could pass what it reads to the site a video comes from, by which video it offers you". |
| `preload` + `rewrite-requests` + `block-events` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `preload` + `rewrite-requests` + `page-events` | No more than its pairs, whose warnings show: "could set off this page's own actions and change what the site receives from them". |
| `preload` + `rewrite-requests` + `click` | No more than its pairs, whose warnings show: "could click things for you and change what the site receives from those clicks". |
| `preload` + `rewrite-requests` + `write-drafts` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `preload` + `rewrite-requests` + `edit-uploads` | No more than its pairs, whose warnings show: "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `preload` + `block-events` + `page-events` | No more than its pairs, whose warnings show: "could keep your clicks from reaching the page and set off the page's own actions in their place". |
| `preload` + `block-events` + `click` | No more than its pairs, whose warnings show: "could keep your clicks from reaching the page and click in their place". |
| `preload` + `block-events` + `write-drafts` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `preload` + `block-events` + `edit-uploads` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `preload` + `page-events` + `click` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `preload` + `page-events` + `write-drafts` | No more than its pairs, whose warnings show: "could write a post and send it for you". |
| `preload` + `page-events` + `edit-uploads` | No more than its pairs, whose warnings show: "could write a post and send it for you"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `preload` + `click` + `write-drafts` | No more than its pairs, whose warnings show: "could write a post and send it for you". |
| `preload` + `click` + `edit-uploads` | No more than its pairs, whose warnings show: "could write a post and send it for you"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |
| `preload` + `write-drafts` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could pass what it reads to the sites this page's pictures come from, by which ones it loads". |

### Triples starting with `media`

| combination | the hold |
|---|---|
| `media` + `search-box` + `go-to` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `media` + `search-box` + `embeds` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `media` + `search-box` + `rewrite-requests` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `media` + `search-box` + `block-events` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `media` + `search-box` + `page-events` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `media` + `search-box` + `click` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `media` + `search-box` + `write-drafts` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `media` + `search-box` + `edit-uploads` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `media` + `go-to` + `embeds` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `media` + `go-to` + `rewrite-requests` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `media` + `go-to` + `block-events` | No more than its pairs, whose warnings show: "could keep your clicks from reaching the page and take you to another page in their place". |
| `media` + `go-to` + `page-events` | No more than its pairs, whose warnings show: "could take you to a page and set off that page's own actions there". |
| `media` + `go-to` + `click` | No more than its pairs, whose warnings show: "could take you to a page and click things there for you". |
| `media` + `go-to` + `write-drafts` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `media` + `go-to` + `edit-uploads` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `media` + `embeds` + `rewrite-requests` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `media` + `embeds` + `block-events` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `media` + `embeds` + `page-events` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `media` + `embeds` + `click` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `media` + `embeds` + `write-drafts` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `media` + `embeds` + `edit-uploads` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it"; "could pass what it reads to the site a video comes from, by which video it offers you". |
| `media` + `rewrite-requests` + `block-events` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `media` + `rewrite-requests` + `page-events` | No more than its pairs, whose warnings show: "could set off this page's own actions and change what the site receives from them". |
| `media` + `rewrite-requests` + `click` | No more than its pairs, whose warnings show: "could click things for you and change what the site receives from those clicks". |
| `media` + `rewrite-requests` + `write-drafts` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `media` + `rewrite-requests` + `edit-uploads` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `media` + `block-events` + `page-events` | No more than its pairs, whose warnings show: "could keep your clicks from reaching the page and set off the page's own actions in their place". |
| `media` + `block-events` + `click` | No more than its pairs, whose warnings show: "could keep your clicks from reaching the page and click in their place". |
| `media` + `block-events` + `write-drafts` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `media` + `block-events` + `edit-uploads` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on"; "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `media` + `page-events` + `click` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `media` + `page-events` + `write-drafts` | No more than its pairs, whose warnings show: "could write a post and send it for you". |
| `media` + `page-events` + `edit-uploads` | No more than its pairs, whose warnings show: "could write a post and send it for you"; "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `media` + `click` + `write-drafts` | No more than its pairs, whose warnings show: "could write a post and send it for you". |
| `media` + `click` + `edit-uploads` | No more than its pairs, whose warnings show: "could write a post and send it for you"; "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `media` + `write-drafts` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could pass what it reads to the site a video or sound comes from, by how it plays it". |

### Triples starting with `search-box`

| combination | the hold |
|---|---|
| `search-box` + `go-to` + `embeds` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `search-box` + `go-to` + `rewrite-requests` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `search-box` + `go-to` + `block-events` | No more than its pairs, whose warnings show: "could keep your clicks from reaching the page and take you to another page in their place". |
| `search-box` + `go-to` + `page-events` | No more than its pairs, whose warnings show: "could take you to a page and set off that page's own actions there". |
| `search-box` + `go-to` + `click` | No more than its pairs, whose warnings show: "could take you to a page and click things there for you". |
| `search-box` + `go-to` + `write-drafts` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `search-box` + `go-to` + `edit-uploads` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `search-box` + `embeds` + `rewrite-requests` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `search-box` + `embeds` + `block-events` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `search-box` + `embeds` + `page-events` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `search-box` + `embeds` + `click` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `search-box` + `embeds` + `write-drafts` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `search-box` + `embeds` + `edit-uploads` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video comes from, by which video it offers you". |
| `search-box` + `rewrite-requests` + `block-events` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `search-box` + `rewrite-requests` + `page-events` | No more than its pairs, whose warnings show: "could set off this page's own actions and change what the site receives from them". |
| `search-box` + `rewrite-requests` + `click` | No more than its pairs, whose warnings show: "could click things for you and change what the site receives from those clicks". |
| `search-box` + `rewrite-requests` + `write-drafts` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `search-box` + `rewrite-requests` + `edit-uploads` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `search-box` + `block-events` + `page-events` | No more than its pairs, whose warnings show: "could keep your clicks from reaching the page and set off the page's own actions in their place". |
| `search-box` + `block-events` + `click` | No more than its pairs, whose warnings show: "could keep your clicks from reaching the page and click in their place". |
| `search-box` + `block-events` + `write-drafts` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `search-box` + `block-events` + `edit-uploads` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `search-box` + `page-events` + `click` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `search-box` + `page-events` + `write-drafts` | No more than its pairs, whose warnings show: "could write a post and send it for you". |
| `search-box` + `page-events` + `edit-uploads` | No more than its pairs, whose warnings show: "could write a post and send it for you". |
| `search-box` + `click` + `write-drafts` | No more than its pairs, whose warnings show: "could write a post and send it for you". |
| `search-box` + `click` + `edit-uploads` | No more than its pairs, whose warnings show: "could write a post and send it for you". |
| `search-box` + `write-drafts` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |

### Triples starting with `go-to`

| combination | the hold |
|---|---|
| `go-to` + `embeds` + `rewrite-requests` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `go-to` + `embeds` + `block-events` | No more than its pairs, whose warnings show: "could keep your clicks from reaching the page and take you to another page in their place". |
| `go-to` + `embeds` + `page-events` | No more than its pairs, whose warnings show: "could take you to a page and set off that page's own actions there". |
| `go-to` + `embeds` + `click` | No more than its pairs, whose warnings show: "could take you to a page and click things there for you". |
| `go-to` + `embeds` + `write-drafts` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `go-to` + `embeds` + `edit-uploads` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video comes from, by which video it offers you". |
| `go-to` + `rewrite-requests` + `block-events` | No more than its pairs, whose warnings show: "could keep your clicks from reaching the page and take you to another page in their place". |
| `go-to` + `rewrite-requests` + `page-events` | No more than its pairs, whose warnings show: "could take you to a page and set off that page's own actions there"; "could set off this page's own actions and change what the site receives from them". |
| `go-to` + `rewrite-requests` + `click` | No more than its pairs, whose warnings show: "could take you to a page and click things there for you"; "could click things for you and change what the site receives from those clicks". |
| `go-to` + `rewrite-requests` + `write-drafts` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `go-to` + `rewrite-requests` + `edit-uploads` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `go-to` + `block-events` + `page-events` | No more than its pairs, whose warnings show: "could take you to a page and set off that page's own actions there"; "could keep your clicks from reaching the page and set off the page's own actions in their place"; "could keep your clicks from reaching the page and take you to another page in their place". |
| `go-to` + `block-events` + `click` | No more than its pairs, whose warnings show: "could take you to a page and click things there for you"; "could keep your clicks from reaching the page and click in their place"; "could keep your clicks from reaching the page and take you to another page in their place". |
| `go-to` + `block-events` + `write-drafts` | No more than its pairs, whose warnings show: "could keep your clicks from reaching the page and take you to another page in their place". |
| `go-to` + `block-events` + `edit-uploads` | No more than its pairs, whose warnings show: "could keep your clicks from reaching the page and take you to another page in their place"; "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `go-to` + `page-events` + `click` | No more than its pairs, whose warnings show: "could take you to a page and click things there for you"; "could take you to a page and set off that page's own actions there". |
| `go-to` + `page-events` + `write-drafts` | **Together, it could go to a page, write a post there and send it for you.** |
| `go-to` + `page-events` + `edit-uploads` | No more than its pairs, whose warnings show: "could write a post and send it for you"; "could take you to a page and set off that page's own actions there". |
| `go-to` + `click` + `write-drafts` | **Together, it could go to a page, write a post there and send it for you.** |
| `go-to` + `click` + `edit-uploads` | No more than its pairs, whose warnings show: "could write a post and send it for you"; "could take you to a page and click things there for you". |
| `go-to` + `write-drafts` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |

### Triples starting with `embeds`

| combination | the hold |
|---|---|
| `embeds` + `rewrite-requests` + `block-events` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `embeds` + `rewrite-requests` + `page-events` | No more than its pairs, whose warnings show: "could set off this page's own actions and change what the site receives from them". |
| `embeds` + `rewrite-requests` + `click` | No more than its pairs, whose warnings show: "could click things for you and change what the site receives from those clicks". |
| `embeds` + `rewrite-requests` + `write-drafts` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `embeds` + `rewrite-requests` + `edit-uploads` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video comes from, by which video it offers you". |
| `embeds` + `block-events` + `page-events` | No more than its pairs, whose warnings show: "could keep your clicks from reaching the page and set off the page's own actions in their place". |
| `embeds` + `block-events` + `click` | No more than its pairs, whose warnings show: "could keep your clicks from reaching the page and click in their place". |
| `embeds` + `block-events` + `write-drafts` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `embeds` + `block-events` + `edit-uploads` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on"; "could pass what it reads to the site a video comes from, by which video it offers you". |
| `embeds` + `page-events` + `click` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `embeds` + `page-events` + `write-drafts` | No more than its pairs, whose warnings show: "could write a post and send it for you". |
| `embeds` + `page-events` + `edit-uploads` | No more than its pairs, whose warnings show: "could write a post and send it for you"; "could pass what it reads to the site a video comes from, by which video it offers you". |
| `embeds` + `click` + `write-drafts` | No more than its pairs, whose warnings show: "could write a post and send it for you". |
| `embeds` + `click` + `edit-uploads` | No more than its pairs, whose warnings show: "could write a post and send it for you"; "could pass what it reads to the site a video comes from, by which video it offers you". |
| `embeds` + `write-drafts` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could pass what it reads to the site a video comes from, by which video it offers you". |

### Triples starting with `rewrite-requests`

| combination | the hold |
|---|---|
| `rewrite-requests` + `block-events` + `page-events` | No more than its pairs, whose warnings show: "could set off this page's own actions and change what the site receives from them"; "could keep your clicks from reaching the page and set off the page's own actions in their place". |
| `rewrite-requests` + `block-events` + `click` | No more than its pairs, whose warnings show: "could click things for you and change what the site receives from those clicks"; "could keep your clicks from reaching the page and click in their place". |
| `rewrite-requests` + `block-events` + `write-drafts` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `rewrite-requests` + `block-events` + `edit-uploads` | No more than its pairs, whose warnings show: "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `rewrite-requests` + `page-events` + `click` | No more than its pairs, whose warnings show: "could click things for you and change what the site receives from those clicks"; "could set off this page's own actions and change what the site receives from them". |
| `rewrite-requests` + `page-events` + `write-drafts` | No more than its pairs, whose warnings show: "could write a post and send it for you"; "could set off this page's own actions and change what the site receives from them". |
| `rewrite-requests` + `page-events` + `edit-uploads` | No more than its pairs, whose warnings show: "could write a post and send it for you"; "could set off this page's own actions and change what the site receives from them". |
| `rewrite-requests` + `click` + `write-drafts` | No more than its pairs, whose warnings show: "could write a post and send it for you"; "could click things for you and change what the site receives from those clicks". |
| `rewrite-requests` + `click` + `edit-uploads` | No more than its pairs, whose warnings show: "could write a post and send it for you"; "could click things for you and change what the site receives from those clicks". |
| `rewrite-requests` + `write-drafts` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |

### Triples starting with `block-events`

| combination | the hold |
|---|---|
| `block-events` + `page-events` + `click` | No more than its pairs, whose warnings show: "could keep your clicks from reaching the page and click in their place"; "could keep your clicks from reaching the page and set off the page's own actions in their place". |
| `block-events` + `page-events` + `write-drafts` | No more than its pairs, whose warnings show: "could write a post and send it for you"; "could keep your clicks from reaching the page and set off the page's own actions in their place". |
| `block-events` + `page-events` + `edit-uploads` | No more than its pairs, whose warnings show: "could write a post and send it for you"; "could keep your clicks from reaching the page and set off the page's own actions in their place"; "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `block-events` + `click` + `write-drafts` | No more than its pairs, whose warnings show: "could write a post and send it for you"; "could keep your clicks from reaching the page and click in their place". |
| `block-events` + `click` + `edit-uploads` | No more than its pairs, whose warnings show: "could write a post and send it for you"; "could keep your clicks from reaching the page and click in their place"; "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |
| `block-events` + `write-drafts` + `edit-uploads` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could let what it reads decide which of your actions this page sees, and the page's code may send that on". |

### Triples starting with `page-events`

| combination | the hold |
|---|---|
| `page-events` + `click` + `write-drafts` | No more than its pairs, whose warnings show: "could write a post and send it for you". |
| `page-events` + `click` + `edit-uploads` | No more than its pairs, whose warnings show: "could write a post and send it for you". |
| `page-events` + `write-drafts` + `edit-uploads` | **Together, it could put what it reads into a post and send it for you.** |

### Triples starting with `click`

| combination | the hold |
|---|---|
| `click` + `write-drafts` + `edit-uploads` | **Together, it could put what it reads into a post and send it for you.** |
