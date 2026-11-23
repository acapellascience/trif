# The load power: strings (branch load-power, off phone-link)

Every string people see that the `load` power adds, exact. **Drafts for Tim (2026-11-21): nothing here is
approved yet.** Agent-facing text (BOXED.md, TECHNIQUES.md, `trif check`'s notes, `trif explain`'s agent notes,
header errors) is Claude's call and isn't listed, except where it also shows in the panel (a mod's errors do).

## How it works (decisions to check)

- **What it is.** A boxed mod lists the exact addresses it may load: `// @powers load
  https://tweetstack.app/api/feed?cursor={next_cursor}&limit=[20|50]`. Its code calls `trif.load(url)`; TRIF's
  background fetches it, outside the page, so the page's Content Security Policy doesn't apply (x.com's blocks
  a free mod's `fetch` to other servers). The answer comes back as `{ok, status, type, data}`.
- **Read only.** GET, no body, no headers of the mod's (TRIF sends only `Accept`), no cookies or other
  credentials (`credentials: 'omit'`), no referrer. So it can't act as the person on that site, nor tell the
  site which page they're on.
- **The exfiltration guard.** An address must be one of the header's: scheme, host, port and path as written
  (https; http only for localhost, 127.0.0.1, `*.localhost`, `*.test`); no `#`, no user name or password; no
  wildcards. A part that changes is a whole path segment or a query value, and only one of: the header's own
  text; one of its words `[top|latest]`; a whole number in its range `{1-50}` (ranges at most 1000 wide); or
  `{key}`: the value under that key in the latest JSON answer that same server sent this mod on this page (the
  first one in the answer; `null` there ends it). Only the parameters the header names, each once; all
  optional. TRIF builds the address again from the header and those values, so nothing else the mod wrote
  rides along. So no text the mod read on the page can go into an address. What's left: which of the header's
  addresses it loads, with which allowed value, and when; the server sees that.
  - *Chose:* `{key}` takes only the latest value (not any value the server ever sent): that's what cursors
    need, and a list of many values to pick from would be a wider channel. So "details of item {id}" works
    only for the first item of the latest answer; a feed with paging works fully.
  - *Chose:* no free path prefixes (`/api/*`): the rest of a path could carry anything. A part of the path
    that changes is a slot, as above.
- **Caps.** 2 MB an answer (said or streamed), 15 s a request (headers and body), 3 at once and 30 a minute per
  mod in a tab. Text (`text/*`) or JSON only: pictures from another server aren't this power's (none of the
  existing powers covers them either: `image-variants` is other sizes of the page's own pictures, `embeds`
  videos a link names). Redirects only within the same origin; an answer from anywhere else is refused unread.
- **Access.** The browser's access to each site it loads from is the usual per-site one (`*://*.<site>/*`, as
  Connect asks), requested when the user clicks Allow on the mod (in that click; nothing's asked if TRIF has it).
  Declined: the mod stays waiting, with the error below. Taken away later: the row shows **needs access**.
- **The hold.** The power holds on its own (not quiet), keyed by its addresses: a version with another address
  asks again. Beside any read power (`read-drafts`, `keys`, `site-data`, `page-data`, `site-storage`,
  `local-fonts`, `image-variants`, `edit-uploads`) it warns, even with the guard, ranked 8th of 21 (after "keep
  what it reads where this site's own code … can find it"). Across mods: trif.load is refused while another
  boxed mod on the page has a read power this one doesn't, unless the site's mods together were approved.
- **Row level.** Not "noticeable": the site the mod runs on can't tell (the load isn't from its page).
- **Also off:** in a tab an agent's code ran in (the tab lock), until the page reloads.
- **Safari:** not supported. A boxed mod with `load` waits there, with no Allow (Safari runs boxed mods as page
  scripts, where the page could ask in the mod's place). **Phone apps:** not yet (mobile/README.md).

## New

- The hold's line for the power (after "It"), the addresses grouped by host, `www.` dropped, their paths as the
  header writes them: **It can load data from tweetstack.app (/api/feed), without your cookies, and can't put
  what's on this page into those addresses.**
- Its "more" (explain.json): **TRIF fetches each one itself, outside the page, so the page's own security rules
  don't get in the way, and with no cookies the mod can't act as you on that site. An address carries only the
  header's own values, a small number, or a value that site sent back (a next-page token), never text from the
  page. That site still sees which of them the mod loads, and when.**
- The combination warning (Tim's words): **Together, it could put what it reads into an address it loads.**
  Label: **Reads into addresses**. Its "more": **TRIF builds every address from the header and values that site
  sent back, so nothing it reads goes in as text. But which address it loads, with which allowed value, and
  when, could still pass a little of what it read to that site.**
- The row icon's hover (a cloud with a down arrow): **Loads data from other sites**
- The site's list "It could end up in:" (a site's boxed mods together): **which addresses they load**
- The approval card when the browser declines access: **Your browser didn't give TRIF tweetstack.app, which
  this mod loads from. Click Allow again to be asked again.**
- The row's tag when access is missing: **needs access**, its hover: **This mod loads data from tweetstack.app.
  Click to give TRIF that site (your browser asks).**
- Safari's hold, as the reason (no Allow button): **Safari can't load data from other sites for a boxed mod yet
  (the load power), so this mod waits until a version of TRIF here can** and the note under it: **It runs once
  a version of TRIF here can do that.**
- The page-wide refusal, in the mod's errors: **loading data from other sites is off on this page while another
  boxed mod here has the read-drafts power: with both, what one reads could decide which address the other
  loads, and when, which that site sees (the user's OK for this site's mods together lifts it: …)**

## The mod's errors (the panel's error badge and `trif errors` show these)

Each starts `TRIF sandbox: trif.load: `.

- **<url> isn't one of the addresses this mod's header lists (<the header's addresses>)**
- **<url>: its <name> ("<value>") isn't one of the header's words (top, latest)** · **… isn't a whole number from
  1 to 50** · **… isn't "en", as the header has it** · **… can only be what tweetstack.app sent back as
  next_cursor, and it hasn't sent one yet** · **… isn't what tweetstack.app last sent back as next_cursor (only
  that value: an address can't carry text of the mod's)** · **"<name>" isn't a parameter <address> names** ·
  **<name> is in it twice** · **part 3 of its path ("…") …**
- **<url> has a #, a \ or a space: TRIF loads only the header's addresses (…)** · **<url> has a user name or
  password in it** · **<url> isn't a whole address (https://…): …** · **that address is longer than 4000
  characters**
- **TRIF doesn't have your browser's access to tweetstack.app yet, so it can't load from there: click "needs
  access" on the mod's row in TRIF's panel**
- **at most 30 loads a minute for a mod in a tab** · **at most 3 loads at once for a mod in a tab**
- **tweetstack.app didn't answer within 15 s** · **couldn't reach tweetstack.app (<the browser's words>)**
- **tweetstack.app sent it on to another site (<origin>), and TRIF only loads from the header's own addresses**
- **tweetstack.app answered with image/png, and trif.load takes text or JSON only** · **tweetstack.app's answer
  is over 2 MB, the most trif.load takes** · **tweetstack.app's answer isn't JSON: load it with { as: 'text' }**
- **trif.load is off in a tab where an agent's code ran (the tab is paused): it's back when the page reloads**
- **trif.load only works in TRIF's sandbox (Chrome and Firefox): this browser can't load outside the page for a
  boxed mod** · **trif.load isn't in this version of TRIF here** (a phone app)
- **trif.load takes only { as }: it always loads with GET, with no body, headers or cookies of the mod's (<key>
  isn't an option)**

## Unchanged

- The other powers' lines and warnings; the counts in docs/POWER-COMBINATIONS.md and SAFE-MODS.md grow (22
  powers: 231 pairs, 1540 triples; 99 pairs warn), and the warnings after the 7th move down one rank.
