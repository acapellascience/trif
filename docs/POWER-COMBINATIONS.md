# Power combinations

Written out from `helper/lib/combinations.js` (the table the hold reads); don't edit by hand. Every pair
(66) and triple (220) of the twelve powers, with the warning a hold shows for it, or why it adds no risk.

"Adds risk" means: together, the powers can carry what a mod reads off the page, or act as you, in a way
none of them (for a triple: none of its pairs) can alone. Reads (`read-drafts`, `keys`, `site-data`,
`page-data`) see more than the page shows; nothing else does. The ways out of the page are what you post
(`write-drafts`, `click`), what the mod clicks (`click`, and `go-to` to get to a page), how the page's
media plays (the host of a video sees its requests: `media`) and sound in the room (`sound`). Everything a
boxed mod reaches otherwise stays on the site it came from, which already has it. Across mods on one page
(they see each other's elements, and `mods` gives them a channel), the sandbox's page-wide rules stop a
combination split between mods from slipping past the hold: docs/SAFE-MODS.md, "Combinations".

Counts: 18 of 66 pairs carry a warning; 5 of 220 triples carry one of their own, and
118 more show their pairs' warnings.

## The warnings, strongest first

A hold lists each warning its mod's powers make, one line each, in this order (the same sentence once).

| | warning | combinations |
|---|---|---|
| 1 | Together, it could put what it reads into a post and send it for you. | a read + `click` + `write-drafts` (4) |
| 2 | Together, it could go to a page, write a post there and send it for you. | `go-to` + `click` + `write-drafts` |
| 3 | Together, it could write a post and send it for you. | `click` + `write-drafts` |
| 4 | Together, it could put what it reads into something you post. | a read + `write-drafts` (4) |
| 5 | Together, it could take you to a page and click things there for you. | `go-to` + `click` |
| 6 | Together, it could let what it reads decide what it clicks for you. | a read + `click` (4) |
| 7 | Together, it could pass what it reads to the site a video or sound comes from, by how it plays it. | a read + `media` (4) |
| 8 | Together, it could turn what it reads into sounds that a device nearby could pick up. | a read + `sound` (4) |

A mod with more than 3 powers gets, in place of these lines: **Mods with many powers can act in unspecific or powerful ways. Treat this with caution.** (keyed by its exact set of powers; its
combinations are still needs of their own, so a later version with fewer of them doesn't ask again for what was allowed).

## Pairs (66)

Grouped by their first power, in the menu's order.

### Pairs starting with `read-drafts`

| combination | the hold |
|---|---|
| `read-drafts` + `keys` | No added risk: both only read: nothing they read can leave the page without something that acts. |
| `read-drafts` + `site-data` | No added risk: both only read: nothing they read can leave the page without something that acts. |
| `read-drafts` + `page-data` | No added risk: both only read: nothing they read can leave the page without something that acts. |
| `read-drafts` + `sound` | **Together, it could turn what it reads into sounds that a device nearby could pick up.** |
| `read-drafts` + `controls` | No added risk: its own controls only take what you give the mod on purpose, and show nothing it couldn't show in its own elements. |
| `read-drafts` + `mods` | No added risk: a channel only reaches its other boxed mods, and the page-wide rules treat the boxed mods on a page as one. |
| `read-drafts` + `media` | **Together, it could pass what it reads to the site a video or sound comes from, by how it plays it.** |
| `read-drafts` + `search-box` | No added risk: the search box only takes what you type, and the mod can't fill or read it. |
| `read-drafts` + `go-to` | No added risk: it only goes to this site's own pages (fixed paths, or links the page shows), and that site can already see what it reads. |
| `read-drafts` + `click` | **Together, it could let what it reads decide what it clicks for you.** |
| `read-drafts` + `write-drafts` | **Together, it could put what it reads into something you post.** |

### Pairs starting with `keys`

| combination | the hold |
|---|---|
| `keys` + `site-data` | No added risk: both only read: nothing they read can leave the page without something that acts. |
| `keys` + `page-data` | No added risk: both only read: nothing they read can leave the page without something that acts. |
| `keys` + `sound` | **Together, it could turn what it reads into sounds that a device nearby could pick up.** |
| `keys` + `controls` | No added risk: its own controls only take what you give the mod on purpose, and show nothing it couldn't show in its own elements. |
| `keys` + `mods` | No added risk: a channel only reaches its other boxed mods, and the page-wide rules treat the boxed mods on a page as one. |
| `keys` + `media` | **Together, it could pass what it reads to the site a video or sound comes from, by how it plays it.** |
| `keys` + `search-box` | No added risk: the search box only takes what you type, and the mod can't fill or read it. |
| `keys` + `go-to` | No added risk: it only goes to this site's own pages (fixed paths, or links the page shows), and that site can already see what it reads. |
| `keys` + `click` | **Together, it could let what it reads decide what it clicks for you.** |
| `keys` + `write-drafts` | **Together, it could put what it reads into something you post.** |

### Pairs starting with `site-data`

| combination | the hold |
|---|---|
| `site-data` + `page-data` | No added risk: both only read: nothing they read can leave the page without something that acts. |
| `site-data` + `sound` | **Together, it could turn what it reads into sounds that a device nearby could pick up.** |
| `site-data` + `controls` | No added risk: its own controls only take what you give the mod on purpose, and show nothing it couldn't show in its own elements. |
| `site-data` + `mods` | No added risk: a channel only reaches its other boxed mods, and the page-wide rules treat the boxed mods on a page as one. |
| `site-data` + `media` | **Together, it could pass what it reads to the site a video or sound comes from, by how it plays it.** |
| `site-data` + `search-box` | No added risk: the search box only takes what you type, and the mod can't fill or read it. |
| `site-data` + `go-to` | No added risk: it only goes to this site's own pages (fixed paths, or links the page shows), and that site can already see what it reads. |
| `site-data` + `click` | **Together, it could let what it reads decide what it clicks for you.** |
| `site-data` + `write-drafts` | **Together, it could put what it reads into something you post.** |

### Pairs starting with `page-data`

| combination | the hold |
|---|---|
| `page-data` + `sound` | **Together, it could turn what it reads into sounds that a device nearby could pick up.** |
| `page-data` + `controls` | No added risk: its own controls only take what you give the mod on purpose, and show nothing it couldn't show in its own elements. |
| `page-data` + `mods` | No added risk: a channel only reaches its other boxed mods, and the page-wide rules treat the boxed mods on a page as one. |
| `page-data` + `media` | **Together, it could pass what it reads to the site a video or sound comes from, by how it plays it.** |
| `page-data` + `search-box` | No added risk: the search box only takes what you type, and the mod can't fill or read it. |
| `page-data` + `go-to` | No added risk: it only goes to this site's own pages (fixed paths, or links the page shows), and that site can already see what it reads. |
| `page-data` + `click` | **Together, it could let what it reads decide what it clicks for you.** |
| `page-data` + `write-drafts` | **Together, it could put what it reads into something you post.** |

### Pairs starting with `sound`

| combination | the hold |
|---|---|
| `sound` + `controls` | No added risk: its own controls only take what you give the mod on purpose, and show nothing it couldn't show in its own elements. |
| `sound` + `mods` | No added risk: a channel only reaches its other boxed mods, and the page-wide rules treat the boxed mods on a page as one. |
| `sound` + `media` | No added risk: neither reads more than the page shows, and together they don't post, send or act for you beyond what each does alone. |
| `sound` + `search-box` | No added risk: the search box only takes what you type, and the mod can't fill or read it. |
| `sound` + `go-to` | No added risk: neither reads more than the page shows, and together they don't post, send or act for you beyond what each does alone. |
| `sound` + `click` | No added risk: neither reads more than the page shows, and together they don't post, send or act for you beyond what each does alone. |
| `sound` + `write-drafts` | No added risk: a draft it changes still waits for you to post it, and the other power carries nothing into it or sends it. |

### Pairs starting with `controls`

| combination | the hold |
|---|---|
| `controls` + `mods` | No added risk: a channel only reaches its other boxed mods, and the page-wide rules treat the boxed mods on a page as one. |
| `controls` + `media` | No added risk: its own controls only take what you give the mod on purpose, and show nothing it couldn't show in its own elements. |
| `controls` + `search-box` | No added risk: its own controls only take what you give the mod on purpose, and show nothing it couldn't show in its own elements. |
| `controls` + `go-to` | No added risk: its own controls only take what you give the mod on purpose, and show nothing it couldn't show in its own elements. |
| `controls` + `click` | No added risk: its own controls only take what you give the mod on purpose, and show nothing it couldn't show in its own elements. |
| `controls` + `write-drafts` | No added risk: its own controls only take what you give the mod on purpose, and show nothing it couldn't show in its own elements. |

### Pairs starting with `mods`

| combination | the hold |
|---|---|
| `mods` + `media` | No added risk: a channel only reaches its other boxed mods, and the page-wide rules treat the boxed mods on a page as one. |
| `mods` + `search-box` | No added risk: a channel only reaches its other boxed mods, and the page-wide rules treat the boxed mods on a page as one. |
| `mods` + `go-to` | No added risk: a channel only reaches its other boxed mods, and the page-wide rules treat the boxed mods on a page as one. |
| `mods` + `click` | No added risk: a channel only reaches its other boxed mods, and the page-wide rules treat the boxed mods on a page as one. |
| `mods` + `write-drafts` | No added risk: a channel only reaches its other boxed mods, and the page-wide rules treat the boxed mods on a page as one. |

### Pairs starting with `media`

| combination | the hold |
|---|---|
| `media` + `search-box` | No added risk: the search box only takes what you type, and the mod can't fill or read it. |
| `media` + `go-to` | No added risk: neither reads more than the page shows, and together they don't post, send or act for you beyond what each does alone. |
| `media` + `click` | No added risk: neither reads more than the page shows, and together they don't post, send or act for you beyond what each does alone. |
| `media` + `write-drafts` | No added risk: a draft it changes still waits for you to post it, and the other power carries nothing into it or sends it. |

### Pairs starting with `search-box`

| combination | the hold |
|---|---|
| `search-box` + `go-to` | No added risk: the search box only takes what you type, and the mod can't fill or read it. |
| `search-box` + `click` | No added risk: the search box only takes what you type, and the mod can't fill or read it. |
| `search-box` + `write-drafts` | No added risk: the search box only takes what you type, and the mod can't fill or read it. |

### Pairs starting with `go-to`

| combination | the hold |
|---|---|
| `go-to` + `click` | **Together, it could take you to a page and click things there for you.** |
| `go-to` + `write-drafts` | No added risk: a draft it changes still waits for you to post it, and the other power carries nothing into it or sends it. |

### Pairs starting with `click`

| combination | the hold |
|---|---|
| `click` + `write-drafts` | **Together, it could write a post and send it for you.** |

## Triples (220)

Grouped by their first power, in the menu's order.

### Triples starting with `read-drafts`

| combination | the hold |
|---|---|
| `read-drafts` + `keys` + `site-data` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `read-drafts` + `keys` + `page-data` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `read-drafts` + `keys` + `sound` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `read-drafts` + `keys` + `controls` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `read-drafts` + `keys` + `mods` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `read-drafts` + `keys` + `media` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `read-drafts` + `keys` + `search-box` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `read-drafts` + `keys` + `go-to` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `read-drafts` + `keys` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you". |
| `read-drafts` + `keys` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `read-drafts` + `site-data` + `page-data` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `read-drafts` + `site-data` + `sound` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `read-drafts` + `site-data` + `controls` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `read-drafts` + `site-data` + `mods` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `read-drafts` + `site-data` + `media` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `read-drafts` + `site-data` + `search-box` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `read-drafts` + `site-data` + `go-to` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `read-drafts` + `site-data` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you". |
| `read-drafts` + `site-data` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `read-drafts` + `page-data` + `sound` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `read-drafts` + `page-data` + `controls` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `read-drafts` + `page-data` + `mods` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `read-drafts` + `page-data` + `media` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `read-drafts` + `page-data` + `search-box` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `read-drafts` + `page-data` + `go-to` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `read-drafts` + `page-data` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you". |
| `read-drafts` + `page-data` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `read-drafts` + `sound` + `controls` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `read-drafts` + `sound` + `mods` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `read-drafts` + `sound` + `media` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it"; "could turn what it reads into sounds that a device nearby could pick up". |
| `read-drafts` + `sound` + `search-box` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `read-drafts` + `sound` + `go-to` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `read-drafts` + `sound` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you"; "could turn what it reads into sounds that a device nearby could pick up". |
| `read-drafts` + `sound` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could turn what it reads into sounds that a device nearby could pick up". |
| `read-drafts` + `controls` + `mods` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `read-drafts` + `controls` + `media` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `read-drafts` + `controls` + `search-box` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `read-drafts` + `controls` + `go-to` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `read-drafts` + `controls` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you". |
| `read-drafts` + `controls` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `read-drafts` + `mods` + `media` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `read-drafts` + `mods` + `search-box` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `read-drafts` + `mods` + `go-to` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `read-drafts` + `mods` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you". |
| `read-drafts` + `mods` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `read-drafts` + `media` + `search-box` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `read-drafts` + `media` + `go-to` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `read-drafts` + `media` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you"; "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `read-drafts` + `media` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `read-drafts` + `search-box` + `go-to` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `read-drafts` + `search-box` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you". |
| `read-drafts` + `search-box` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `read-drafts` + `go-to` + `click` | No more than its pairs, whose warnings show: "could take you to a page and click things there for you"; "could let what it reads decide what it clicks for you". |
| `read-drafts` + `go-to` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `read-drafts` + `click` + `write-drafts` | **Together, it could put what it reads into a post and send it for you.** |

### Triples starting with `keys`

| combination | the hold |
|---|---|
| `keys` + `site-data` + `page-data` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `keys` + `site-data` + `sound` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `keys` + `site-data` + `controls` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `keys` + `site-data` + `mods` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `keys` + `site-data` + `media` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `keys` + `site-data` + `search-box` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `keys` + `site-data` + `go-to` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `keys` + `site-data` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you". |
| `keys` + `site-data` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `keys` + `page-data` + `sound` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `keys` + `page-data` + `controls` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `keys` + `page-data` + `mods` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `keys` + `page-data` + `media` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `keys` + `page-data` + `search-box` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `keys` + `page-data` + `go-to` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `keys` + `page-data` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you". |
| `keys` + `page-data` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `keys` + `sound` + `controls` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `keys` + `sound` + `mods` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `keys` + `sound` + `media` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it"; "could turn what it reads into sounds that a device nearby could pick up". |
| `keys` + `sound` + `search-box` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `keys` + `sound` + `go-to` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `keys` + `sound` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you"; "could turn what it reads into sounds that a device nearby could pick up". |
| `keys` + `sound` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could turn what it reads into sounds that a device nearby could pick up". |
| `keys` + `controls` + `mods` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `keys` + `controls` + `media` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `keys` + `controls` + `search-box` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `keys` + `controls` + `go-to` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `keys` + `controls` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you". |
| `keys` + `controls` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `keys` + `mods` + `media` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `keys` + `mods` + `search-box` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `keys` + `mods` + `go-to` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `keys` + `mods` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you". |
| `keys` + `mods` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `keys` + `media` + `search-box` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `keys` + `media` + `go-to` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `keys` + `media` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you"; "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `keys` + `media` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `keys` + `search-box` + `go-to` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `keys` + `search-box` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you". |
| `keys` + `search-box` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `keys` + `go-to` + `click` | No more than its pairs, whose warnings show: "could take you to a page and click things there for you"; "could let what it reads decide what it clicks for you". |
| `keys` + `go-to` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `keys` + `click` + `write-drafts` | **Together, it could put what it reads into a post and send it for you.** |

### Triples starting with `site-data`

| combination | the hold |
|---|---|
| `site-data` + `page-data` + `sound` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `site-data` + `page-data` + `controls` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `site-data` + `page-data` + `mods` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `site-data` + `page-data` + `media` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `site-data` + `page-data` + `search-box` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `site-data` + `page-data` + `go-to` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `site-data` + `page-data` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you". |
| `site-data` + `page-data` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `site-data` + `sound` + `controls` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `site-data` + `sound` + `mods` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `site-data` + `sound` + `media` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it"; "could turn what it reads into sounds that a device nearby could pick up". |
| `site-data` + `sound` + `search-box` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `site-data` + `sound` + `go-to` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `site-data` + `sound` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you"; "could turn what it reads into sounds that a device nearby could pick up". |
| `site-data` + `sound` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could turn what it reads into sounds that a device nearby could pick up". |
| `site-data` + `controls` + `mods` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `site-data` + `controls` + `media` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `site-data` + `controls` + `search-box` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `site-data` + `controls` + `go-to` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `site-data` + `controls` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you". |
| `site-data` + `controls` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `site-data` + `mods` + `media` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `site-data` + `mods` + `search-box` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `site-data` + `mods` + `go-to` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `site-data` + `mods` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you". |
| `site-data` + `mods` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `site-data` + `media` + `search-box` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `site-data` + `media` + `go-to` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `site-data` + `media` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you"; "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `site-data` + `media` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `site-data` + `search-box` + `go-to` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `site-data` + `search-box` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you". |
| `site-data` + `search-box` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `site-data` + `go-to` + `click` | No more than its pairs, whose warnings show: "could take you to a page and click things there for you"; "could let what it reads decide what it clicks for you". |
| `site-data` + `go-to` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `site-data` + `click` + `write-drafts` | **Together, it could put what it reads into a post and send it for you.** |

### Triples starting with `page-data`

| combination | the hold |
|---|---|
| `page-data` + `sound` + `controls` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `page-data` + `sound` + `mods` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `page-data` + `sound` + `media` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it"; "could turn what it reads into sounds that a device nearby could pick up". |
| `page-data` + `sound` + `search-box` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `page-data` + `sound` + `go-to` | No more than its pairs, whose warnings show: "could turn what it reads into sounds that a device nearby could pick up". |
| `page-data` + `sound` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you"; "could turn what it reads into sounds that a device nearby could pick up". |
| `page-data` + `sound` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could turn what it reads into sounds that a device nearby could pick up". |
| `page-data` + `controls` + `mods` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `page-data` + `controls` + `media` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `page-data` + `controls` + `search-box` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `page-data` + `controls` + `go-to` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `page-data` + `controls` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you". |
| `page-data` + `controls` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `page-data` + `mods` + `media` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `page-data` + `mods` + `search-box` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `page-data` + `mods` + `go-to` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `page-data` + `mods` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you". |
| `page-data` + `mods` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `page-data` + `media` + `search-box` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `page-data` + `media` + `go-to` | No more than its pairs, whose warnings show: "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `page-data` + `media` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you"; "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `page-data` + `media` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post"; "could pass what it reads to the site a video or sound comes from, by how it plays it". |
| `page-data` + `search-box` + `go-to` | No added risk: it can read, but nothing in it carries what it reads off the page or acts on it. |
| `page-data` + `search-box` + `click` | No more than its pairs, whose warnings show: "could let what it reads decide what it clicks for you". |
| `page-data` + `search-box` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `page-data` + `go-to` + `click` | No more than its pairs, whose warnings show: "could take you to a page and click things there for you"; "could let what it reads decide what it clicks for you". |
| `page-data` + `go-to` + `write-drafts` | No more than its pairs, whose warnings show: "could put what it reads into something you post". |
| `page-data` + `click` + `write-drafts` | **Together, it could put what it reads into a post and send it for you.** |

### Triples starting with `sound`

| combination | the hold |
|---|---|
| `sound` + `controls` + `mods` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `controls` + `media` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `controls` + `search-box` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `controls` + `go-to` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `controls` + `click` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `controls` + `write-drafts` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `mods` + `media` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `mods` + `search-box` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `mods` + `go-to` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `mods` + `click` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `mods` + `write-drafts` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `media` + `search-box` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `media` + `go-to` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `media` + `click` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `media` + `write-drafts` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `search-box` + `go-to` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `search-box` + `click` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `search-box` + `write-drafts` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `go-to` + `click` | No more than its pairs, whose warnings show: "could take you to a page and click things there for you". |
| `sound` + `go-to` + `write-drafts` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `sound` + `click` + `write-drafts` | No more than its pairs, whose warnings show: "could write a post and send it for you". |

### Triples starting with `controls`

| combination | the hold |
|---|---|
| `controls` + `mods` + `media` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `controls` + `mods` + `search-box` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `controls` + `mods` + `go-to` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `controls` + `mods` + `click` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `controls` + `mods` + `write-drafts` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `controls` + `media` + `search-box` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `controls` + `media` + `go-to` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `controls` + `media` + `click` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `controls` + `media` + `write-drafts` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `controls` + `search-box` + `go-to` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `controls` + `search-box` + `click` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `controls` + `search-box` + `write-drafts` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `controls` + `go-to` + `click` | No more than its pairs, whose warnings show: "could take you to a page and click things there for you". |
| `controls` + `go-to` + `write-drafts` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `controls` + `click` + `write-drafts` | No more than its pairs, whose warnings show: "could write a post and send it for you". |

### Triples starting with `mods`

| combination | the hold |
|---|---|
| `mods` + `media` + `search-box` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `mods` + `media` + `go-to` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `mods` + `media` + `click` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `mods` + `media` + `write-drafts` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `mods` + `search-box` + `go-to` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `mods` + `search-box` + `click` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `mods` + `search-box` + `write-drafts` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `mods` + `go-to` + `click` | No more than its pairs, whose warnings show: "could take you to a page and click things there for you". |
| `mods` + `go-to` + `write-drafts` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `mods` + `click` + `write-drafts` | No more than its pairs, whose warnings show: "could write a post and send it for you". |

### Triples starting with `media`

| combination | the hold |
|---|---|
| `media` + `search-box` + `go-to` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `media` + `search-box` + `click` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `media` + `search-box` + `write-drafts` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `media` + `go-to` + `click` | No more than its pairs, whose warnings show: "could take you to a page and click things there for you". |
| `media` + `go-to` + `write-drafts` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `media` + `click` + `write-drafts` | No more than its pairs, whose warnings show: "could write a post and send it for you". |

### Triples starting with `search-box`

| combination | the hold |
|---|---|
| `search-box` + `go-to` + `click` | No more than its pairs, whose warnings show: "could take you to a page and click things there for you". |
| `search-box` + `go-to` + `write-drafts` | No added risk: it reads nothing but the page, and its acts don't combine into posting or acting for you. |
| `search-box` + `click` + `write-drafts` | No more than its pairs, whose warnings show: "could write a post and send it for you". |

### Triples starting with `go-to`

| combination | the hold |
|---|---|
| `go-to` + `click` + `write-drafts` | **Together, it could go to a page, write a post there and send it for you.** |
