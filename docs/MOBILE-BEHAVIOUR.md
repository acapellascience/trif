# TRIF on phones: how it behaves

The behaviour both phone apps (iPhone: `mobile/browser-probe`, branch ios-poc; Android: `mobile/android`, branch
android) must have. Tim's decisions, as rules; dates are 2026, Tim's words in quotes where they matter. How the iPhone
does it is in mobile/IOS-AGENT-NOTES.md; the words people see are in docs/IOS-APP-STRINGS.md (drafts until Tim
approves them). A rule marked **[shared]** is code both apps run: `mobile/shared/` (see "Shared code" at the end), so a
change there is a change on both phones. Change this file whenever a rule changes.

## Sites

- A site is the host without `www.`, cut to its registrable part (`m.facebook.com` → `facebook.com`; two-part
  suffixes such as `co.uk`, `com.au`, `qc.ca` keep three parts; IP addresses and one-word hosts as they are).
  `localhost` and `127.0.0.1` are two sites.
- `phone~<site>` (a phone twin, from the computer's phone view) is `<site>` wherever a site is asked for.
- Lower case, one leading `www.` dropped; empty labels ignore (`a..b.com` → `b.com`); a host that is only digits and
  dots stays whole (any script's digits); `all-sites` is itself. A host is in a site when it is the site or ends in
  `.<site>`.

## Mods and holds

- Nothing is installed without the person's consent: Add this mod? (or the Mods tab's approval card) is the consent
  step. Page text and model replies are untrusted.
- Add this mod? and the approval card: the buttons come right after what they agree to (name, site, summary, powers,
  warnings), before the code (11-16: no scrolling past code to approve).
- A mod that runs beyond the site it came from (the chat's site, or the page it was pasted on; files and codes have
  none) gets the coral "It runs on another site / other sites / every site" box first (11-17): every site when its folder or an
  @match is all sites; else the sites its @match names (as sites) other than that one, sorted, once each, "also" when
  it runs there too; no box when there are none. [shared: core/mod-offer.js elsewhere]
- Full code is first-class; guarantees come from opt-in safe tiers (style, boxed, free); a hold is informed consent: a
  held change keeps running its approved version (with its own style) until the person approves the new one.
- What a hold waits for: each need (a power, a combination, a finding, a change's own ask) until its key is allowed for
  that mod and, for a need tied to lines of code, every one of those lines. A held new mod never runs. [shared:
  core/mod-store.js]
- Allow allows exactly what waits (keys and their lines), so a later version that needs nothing more runs without
  asking; one that needs more waits. Don't allow: the version before comes back (the change kept in History); a new mod
  is deleted (to Recently deleted).
- A change (an edit, a restore, a sync, an update) is judged against the version before and asks only for what it adds:
  becoming a free mod; each @match outside the version before's site, when the mod can act at all (it has needs) and
  the version before wasn't for every site. What the version before did (its @match, being free, what it was asked
  before) counts as allowed, unless it was itself held. [shared: core/mod-store.js]
- While a change waits, the version before keeps running (or the one it was already keeping), whether the change is an
  edit, a sync, an update or a restore: a restore while another change waits keeps the last approved version running
  (Tim, 11-18; before, the mod stopped until the person decided). Allow runs the waiting one; Don't allow puts back the
  one that ran. [shared: core/mod-store.js]
- Adding: a mod added from a chat, a link or pasted is on; an import starts off, marked new (updated, if it replaces
  one); a new one from the computer (phone sync) is first kept off and marked as from the computer, then takes the
  computer's switch (D8, Tim 11-18: it arrives on if it's on there), keeping the mark until its switch is first tapped
  here. A new version keeps what was
  allowed, its per-site switches and when it was first added; an edit or a sync keeps its switch and mark; anything
  else is on, unmarked. [shared: core/mod-store.js]
- History: a new version with different code puts the one before first (as import, edit, computer, else chat); a
  restore puts the current one first (restore, or undo for an edit's Undo), as Don't allow does (undo). On an add,
  History keeps 30 days and at most 30 versions (the iPhone writes at most 10 to its files). A restore and Don't allow
  take the current version's switch, per-site switches, how it came and when it was added (a restore also its mark;
  Don't allow also what was allowed, and asks nothing beyond its code). [shared: core/mod-store.js]
- Recently deleted: every delete, newest first, 30 days and at most 200 entries (pruned again at each start). A delete
  by the person offers Undo (the last one); a sync's doesn't. Restore puts one back unless a mod with its id is here
  now. [shared: core/mod-store.js]
- What runs on a page: nothing while Pause all is on; else each mod switched on (and on the page's site), not held
  unless a version before is kept running (then that version runs), its tier (style, boxed, free) not switched off on
  the page's site, and an @match covering the address with no @exclude covering it. [shared: core/mod-store.js
  running]
- A mod for several sites (two sites or more, or every site) has a switch per site: off on a site lists that site;
  on there takes it off the list and switches the mod on. A mod for one site has one switch. Switching on clears the
  "new, off" mark. A tier's switch is per site. [shared: core/mod-store.js isOn, setOn, setGroup]
- @match (Chrome's patterns, as desktop's matchesUrl): <all_urls> any http(s) page; scheme * http or https only, else
  http or https exactly as written; host * any, *.base base or under it, else exactly (any case; a port or another *
  covers nothing); the path a whole glob (* anything) over the percent-encoded path ("/" if empty) and ?query, no
  fragment. Parsing the address is the platform's. [shared: core/match.js]
- A free mod with a style section gets that CSS at the page's start, as desktop's; its `trif.log/warn/error` and its
  start reach Diagnostics ("mod log", capped 40 a load, 200 characters), never page data.
- Point-and-hide is gone (11-17: "a resting thumb set it off"). Rules it made stay applied, each with Show again in
  the Mods tab.
- Safe mode: an unclean end while mods ran switches that site's mods off (the banner; the Mods tab lists them). An
  unclean end during TRIF's own heavy work (a model's check or run, an import) blames no mod and switches nothing off
  (11-18).
- Safe mode's snapshot (Tim, 11-18: "so … you can turn them all back on exactly as they were"). Before safe mode (or a
  runaway page's offer, taken) changes any switch, the app keeps a snapshot in its own storage (iOS: Application
  Support/safe-mode-snapshots.json): each affected mod by its file id and its stable id (@id), its name, what safe
  mode switched off (its whole switch, or its switch on these sites for a mod on several sites), its switch before
  (on, the sites it's off on, when last switched) and as safe mode left it, and whether it waited for an OK; when,
  why (quit / busy / ended), the sites; the tiers' switches on those sites and Pause all, for the record only (safe
  mode changes neither, so neither is restored). The last 5 are kept, newest first, never just overwritten.
  Restoring a snapshot ("Turn them back on" on safe mode's banner; the Mods tab's ⋯ → Restore switches from before
  safe mode, listing each snapshot by time and sites, offered only when one exists): each mod found by its stable id
  first (a mod renamed since still restores), else its file id; only the switches safe mode changed are put back,
  and only where the mod's switch is still exactly as safe mode left it (on, sites off and its time): a switch
  changed since, here or synced from the computer, is a later choice and stays. Each put back is the person's own
  switch (a fresh time), so it syncs to the computer like any switch, as safe mode's switch-offs did (D15). A
  switch never allows anything: a mod waiting for an OK still waits (its earlier allowed version runs, as for any
  switch). Then the pages' scripts are made again: the shown tab loads again unless it plays; tabs behind when next
  shown. A toast says what happened: how many came back, how many were left as changed since, how many still wait
  for an OK. Desktop TRIF has no automatic switch-off of this kind (new mods from outside start off; nothing is
  switched off after a crash), so nothing to match there.
- The Mods tab never shows an error too early (11-18, "odd flashes of error"): a mod switched on is "starts when this
  page loads again" until the page has loaded with it, "starting" until 2 s after that page finished, and only then an
  error if it never said it started. A late state never shows a switch's old state; a tier's On/Off shows the tap at
  once.
- Phone sync with the computer: a change synced in makes the pages' scripts again; a delete goes to Recently deleted
  (30 days, Restore).
- After a sync, while the app is open, a short toast in front of everything, moving nothing and taking no touches,
  no notification or sound (Tim, 11-18): "Synced with {computer} · {n} from the computer, {m} to it[, {k} waiting for
  your OK]" after any sync that moved something, automatic or not. A sync that moved nothing says "Synced with
  {computer} · nothing new" only when the person started it on the phone (Sync now; the sync that runs right after pairing works); an
  automatic one (the app coming to the front, a change, the computer's nudge) shows no toast (Tim, 11-18: it showed
  all the time). The computer does the same from its side (only its Sync now / Sync with phone says "nothing new"); a
  sync the computer's button started is automatic on the phone. A Sync now pressed during an automatic sync runs
  once after it, as the person's. The counts mean what the computer's own toast
  means from its side: {n} mods taken here (new or changed) plus mods deleted there; {m} mods sent to it; {k} of
  those taken that wait here for an OK. Switches aren't counted (the computer doesn't count them either). A sync that
  didn't happen says why in plain words (syncing off there, the computer not found: asleep, another Wi-Fi, no
  browser with TRIF open; this phone removed there; Local Network off; anything else: TRIF tries again): always
  after a sync the person started; after automatic syncs once, then not again until a sync works or the reason
  changes, across launches too (a computer asleep isn't said each time the app comes to the front). "Last synced" lines update after
  every sync that worked, toast or not. The pairing
  screen and Settings' My computer block say "Last synced just now / {n} min ago / at {time} / {date} at {time}",
  kept across launches.
- Phone sync's switches (Tim, 11-18; docs/PHONE-SYNC.md 4b on branch phone-link): a mod's on/off and its per-site
  switches follow the last change on either side, three-way against the switch both sides last agreed on; changed on
  both since, the later change wins (each side stamps when the person last switched it; the same time: the phone's,
  unless the phone's is only the "new, off" of a mod never switched and the computer's isn't).
  A sync's switch keeps the other side's time. A tier's switch on a site and Pause all stay each device's: Pause all is
  a safety switch for the device in your hand, a tier's is the same kind of brake for a site. Safe mode's switch-offs
  are the mod's own switch, so they sync. An older computer sends no switches: nothing changes.
- Approvals stay each device's (Tim, 11-18). A synced mod that needs an OK waits here whatever the computer allowed;
  when the computer allowed this very version (the same revision, its tier no higher, no power beyond what was allowed
  there), the approval card says "You allowed this on {computer}." and Allow is the same one tap. The computer's
  approval is only a hint for those words: never an approval, never a switch.
- A mod imported from a file keeps the file's name as its name, as the computer keeps sites/<site>/<name>.js (phone
  sync matches mods by it): `<site>-<name>.js` (the computer's copy for the phone, the watched iCloud folder, an
  export) is <name> under <site>; `<name>.js` is <name>; a name the computer couldn't have is cleaned up (lower case,
  dashes). A mod from a chat or pasted is named by its @name, as before. Mods already here keep their names (11-18).

## Mod ids and renames

(Tim, 11-18: "Knowing it's the same mod should use a separate ID, instead of relying on equivalent names"; the design:
docs/PHONE-SYNC.md 2a on branch phone-link, D16, D17.)

- A mod's stable id is its header's `// @id <id>` line (after @name): 8 to 64 lower-case letters, digits and
  hyphens, starting with a letter or digit; TRIF makes a random UUID in lower case. The first @id line counts; one
  that isn't an id is a header warning, left as it is. It's identity only: never part of what a mod can do or of an
  approval, so adding it never makes a mod wait. [shared: core/mod-id.js, the desktop's helper/lib/modid.js
  algorithm, held to its cases]
- One device: a mod is its folder (site) and its id. Two in one folder with one id (a copied file): the first by file
  name keeps it, the others count as having none. A mod without an id is its file id, as before.
- When TRIF gives one: whenever it writes a mod for the person: a chat's add, a paste, a link, an import, an edit
  saved in the code card, a restore, a rename. Never when it copies one from the computer (a sync's copy is the
  other side's bytes), never as a mass rewrite at launch: mods already here get one the next time TRIF writes them.
- The same mod: an offered or imported mod whose id is a mod's on its site is a new version of that mod (whatever
  its name or file: export then import is the same mod); else (a chat's or a paste's code) the mod with its @name on
  that site, as before. An update without @id gets the installed mod's id. A mod whose file id is another's but whose
  id isn't that one's (two mods, one name) goes beside it, `<name>-2`.
- A chat's offer memory and its judge leave the header's @id lines out, so an installed mod with an id is still
  "installed as it is" for the chat's copy without it. Code with no @id keeps the key it had. [shared:
  core/chat-offers.js normalise]
- Renaming (each mod's details, the shared mods page: Name · Rename → a field → Save / Cancel): the header's @name set
  (1 to 80 characters, one line), its @id added if it has none, nothing else in the text changed; the file follows the
  name (`<slug>.js`, `-2`… past another mod's file in the folder, any case; the same slug: the file stays). A rename
  is never held and never marked new: its switches, approvals, History, the version kept running and its marks stay.
  Everything keyed by its id follows (its stored file, its sync hint, safe mode's lists, the tabs' loaded mods, a
  quick ask's Undo, the open code card). Recently deleted keeps old entries as they were. A rename is a change that
  syncs. [shared: core/mod-id.js checkName, withMeta, fileFor]
- Phone sync (docs/PHONE-SYNC.md 3, 4, 7 on branch phone-link): each row carries its id and two part revisions
  (`body`: the text without the header's @name and @id lines; `meta`: `<name>\n<id>`), so the computer can tell a
  rename from an edit and merge one with the other; the computer's renames are applied on the phone first, as moves
  (the text as it is, everything keyed by the mod following). Switches and hints are kept by sync key: `<site>#<id>`
  with an id, else the file id; the wire names mods by file id. Every-site mods sync like any other (D10).

## Every-site mods

- Their own group in the Mods tab, "Every site", on every site's list, after the site's own tiers (Tim, 11-18). A
  tier's collapse doesn't hide them; the group's own does.
- A mod for several sites or every site has a switch per site: the row's switch is its switch on this site (off here
  only: it still runs elsewhere), as on desktop. Its details show both: "On {site}" and "On every site" (several
  sites: "On all its sites"), the whole mod's switch; switching it on here switches the whole mod on too.
- All mods (the Mods tab's ⋯ menu): every mod, by where it runs (Every site first, then each site A to Z), each with
  its whole switch, no page asked; a hold's card opens from its "on hold" only. Closing the tab goes back to the
  site's list.

## Which tabs load again when mods change

- A mod change never reloads a tab whose mods didn't change (11-18: "you're watching a YouTube video, when you
  successfully add the mod to the other tab, your tab reloads"). Each tab keeps the signature it loaded with (every mod
  running there and its version); after a change the shown tab loads again only if its signature changed, and never
  while it plays sound; tabs behind load again when next shown (unless playing then).
- This holds for every path: Add this mod?, a banner's Add, the quick ask's Done and Undo, Allow, the Mods tab's
  switches and edits, safe mode, phone sync, imports (no reload).
- Pause all mods: the shown tab loads again even if playing (the person's own act); tabs behind only when shown.
- Every reload the app makes says why in Diagnostics ("reload <host>: <cause>"), 11-18.
- A page that commits while a change isn't in the pages' scripts yet counts as stale; a tab looked at then is looked
  at again once the scripts are in (if it's still shown); a tab already reloading is left alone. [shared:
  core/tab-reload.js, the decision; the signature, the playing check and the reload are each app's]

## Chat offers (what a chat may hand over)

- Mods from a reply are picked up automatically; Add to TRIF stays under every assistant code block, old ones too (a
  tap is consent). Instructions ask the model for code blocks, never attached files.
- Only the assistant's code, only from a reply TRIF saw arrive (11-18: "When I paste code into Claude in the app, the
  app reads it as a mod"; "opening an old chat gets spurious pickups of old code"). Fail closed: a block counts only
  inside a reply (not the person's message, not the box, nothing editable), from a reply that wasn't on the page at
  the send, came after the person's message, and was seen being written. A watch belongs to its conversation: another
  conversation ends it with nothing offered. A viewer counts only if opened by a tap inside a reply (6 s), or with no
  tap while a live reply is written or ended < 2 min ago. [shared: chat.js]
- A chat never offers the same code twice, whatever came of it (11-17: "spurious asks to add old code when I open
  Claude chat"), nor an installed mod's current or earlier version, nor one in Recently deleted, nor one already
  waiting to be offered. Code is compared after evening out line ends, trailing spaces and blank end lines. Memory:
  the last 500 codes offered, all chats, across launches, with what came of each (offered, added, declined,
  dismissed). Add to TRIF's tap isn't held to this. [shared: core/chat-offers.js]
- A chat's mods belong to the chat's site (11-18, FeedBook from a Facebook chat said "runs on google.com"): a mod with
  no @match is read for the chat's site (phone~<site> → <site>), the shown page only when the chat has none. A mod
  whose own @match names another site still warns. Add to TRIF's tap under a chat's code block the same (11-18; it
  kept phone~<site> as the site until round 8 of the shared core). [shared: core/mod-offer.js from]
- A conversation belongs to the site it started on: no follow-ups across sites.
- Diagnostics "chat offers": one line per hand-over (ids offered, skipped and why, held and why).

## Chats and tabs

- At most 3 chats at once; a working chat is never released; the robot opens the tab's own site's chat.
- A chat not being looked at that finishes shows a done banner (11-18): "{Service} made a mod for {site}" · Add · Go to
  {site}, or "{Service} replied about {site}" · Open chat. Its mods are held (one offer, never lost). On the chat's
  own site's tab with nothing over it, Add this mod? comes up at once instead.
- A tap anywhere on the banner outside its buttons = Open chat (11-18); a mod banner stays over the chat, still
  holding its mods. A plain banner goes after 8 s.
- A reply whose mods TRIF didn't see being written (it finished while the app was in the background, the page
  suspended) is never offered by itself (fail closed, as old chats), but its done banner says "{Service} replied with
  a mod for {site}", stays until closed, and Open chat opens the chat at the first such mod, its Add to TRIF in view
  (11-18, Tim's reuters.com replies).
- Go to {site}: the tab sent from while it's open and on that site; else a new tab at its page if that page is on the
  site, else at https://{site}/ (never a tab navigated elsewhere, nothing rewritten); a chat not sent from yet: its
  site's tab as the tab list picks it [shared: tab-list.js goTo].
- Tab list robot badges show each tab's chat state (its chats sent from it while it's on their site: working, else a
  reply waiting, else plain) [shared: tab-list.js]; a long press on the toolbar's robot lists the chats.
- Chat pages read as TRIF (11-16): the robot in their greeting's place, "From TRIF: …" pills, upsells hidden; never
  their branding, Log in, terms or safety lines. Cosmetic only.
- No private routes or tokens of claude.ai / chatgpt.com; TRIF reads only what their pages show.
- The full chat opens with no keyboard (11-18: "the keyboard flies up and it's disorienting"): filling never leaves
  their box focused.
- Only ever the page in front in the chat's box (11-18, Tim's iPhone: chatgpt.com put back, as its draft, an old TRIF
  fill for YouTube beside x.com's attachments). TRIF's own text starts with its first line ("I'm looking at {address}
  in TRIF…" / "Here's {address} in TRIF now:") and ends with "--- End of what TRIF sent ---"; a fill takes out every
  earlier TRIF tile and TRIF text block (one naming another page is never "already there"), keeps the person's own words
  and files around them and adds this page's. For 8 s after a fill, what the page puts back (its saved draft) is taken
  out again: TRIF text for another page, any TRIF text when this fill's went as a file, a second tile of something TRIF
  attached once; this fill's own text is typed again if the draft replaced it. Switching to Claude or ChatGPT (from
  More too) is opening that chat: its box filled for the tab's page when the chat is idle and the tab's.
- Projects: the person makes the project; TRIF copies its instructions and remembers the page.

## Quick ask

- The robot's tap opens the list: the box "What should change?", the microphone, Go to chat, then the chats (11-18:
  "make that the default tap experience"). Go to chat = the old tap.
- HARD RULE (Claude's and ChatGPT's terms): in their pages TRIF fills the box but NEVER sends: no click, no
  synthesized Enter, no submit. A strip of their real page (the box's text and their own Send) slides up over the tab;
  the person taps Send. More's engines (API keys, My computer, on the phone) have no site page: TRIF sends at once.
- The strip appears once, at its final size, and stays still (11-18: it went "up and down and up and down"; "We don't
  need to see the chips even"): it slides in only after the filled page has settled (0.3 s unchanged, at most 8 s),
  shows only their box's text (at most 112 pt) and Send, never chips, disclaimers or messages; the chat is cropped, not
  resized or restyled.
- The person's software keyboard in the strip's box opens the whole chat.
- Done: a look-only mod is added at once with "Done · Undo" (20 s). Look-only = style tier, no powers, not held, no
  warnings, not everywhere, and every site it runs on is the chat's site. Anything else gets Add this mod? (or the
  done banner holds it).
- Undo puts back the version before (an update) or removes the mod (a new one); it isn't put in Recently deleted.
  Newest first; each undone mod's code is remembered as declined (never offered again). Only from Done.
- The pill: Done when anything was added at once, else the card when there were mods, else Replied.
- One offer per mod; follow-ups continue the same chat; the pill closed while working: the reply is offered as ever.
- The chats' list: top right Send (dimmed when the box is empty), top left Cancel; Cancel, a tap outside and a swipe
  down all keep the box's words.
- Only say Working when it's working (Tim, 11-18). Before sending, the engine is checked: More's (a model chosen, its
  key there, the phone's model downloaded, the computer paired) and the chat page's (a usable message box; a sign-in
  page or no box = not signed in). Not ready: a red pill at once, saying what to do, its tap going there (More's
  Settings at the model / keys / the phone's models, the pairing screen, or the whole chat on its sign-in page).
  The engine's quick refusals (401 key, 402 or "credits", 404 model, 429, 5xx, no network) turn the pill red in plain
  words within seconds. Nothing back at all (no words, no step) for 45 s (API engines), 90 s (the phone's model),
  120 s (My computer), 150 s of no reply text (Claude/ChatGPT): the pill amber, "Still nothing back from {engine}:
  open the chat"; the request is never cancelled by it. A Claude/ChatGPT send after which the page never showed a
  reply is "Nothing back", not "Replied". More's full chat gets the same plain words and a "still nothing back" line.
- Go to chat names what the chat will use: "{model} · {engine} · {site}" (OpenRouter's, the API's, "on this iPhone",
  "My computer (agent · model)"), "Claude · claude.ai · {site}" for the web chats; nothing set up: what's missing, red,
  its tap going to the fix.
- OpenRouter's models (iPhone, 11-18): the key's own list (GET /api/v1/models/user: the account's provider preferences,
  privacy settings and guardrails applied), the public list if that fails; only models fit for writing mods (tools,
  chat completions, text out, 32K context or more, not expired); runs ask for providers that take every parameter
  (provider.require_parameters). The picker: Recommended (a small table), Recent, then All models by maker behind a
  search, Auto first; each with its price per million tokens in and out, and context; free ones marked.

## Voice

- On-device recognition only, always; where it isn't available the microphone says so and records nothing. Refused
  permissions: the box still types.
- The microphone never stops by itself (11-18: "If you pause, it deletes the things you've said so far … Let it keep
  going and have long stretches of silence … The user will know when to stop it"): no silence stop, no time limit.
  Only the person's stop (tap) or letting go (hold) asks.
- The words only grow: what was said before a pause stays; a restarted recognizer's words are added after; a revised
  partial replaces only the words since the last committed ones. A new listen goes on after the box's words. [shared:
  core/speech-text.js]
  - A partial much shorter than the live words, or starting with other words, is a fresh transcription: the live words
    are committed first. A repeat of the segment just ended (the same words, or nearly: a word in five revised) is
    not added twice. Words compare by their letters and numbers, case aside.
- Anything else stopping it (a call, Siri, the app leaving the front, the list closed, an error) keeps every word in
  the box, asks nothing, and says so; a robot hold stopped that way leaves a pill with the words (15 s).
- The box's microphone: a press under 0.3 s is a tap (listens until the next tap, which asks; ✕ keeps the words, not
  asked); longer is a hold. The press is timed by the touch's own times (down to lift), never by when the app got to
  them: a busy moment as the microphone starts must not turn a tap into a short hold (11-18, Tim's SE: it listened a
  moment and stopped). A touch the system takes away mid-press goes on listening as a tap.
- A recognizer that gives no words is replaced, never trusted blindly: 4 s of audio with sound in it (louder than
  −40 dBFS) and no words → the other on-device recognizer, given all the audio from the start (kept until the first
  words), so nothing said is lost; the same at the stop when there was sound and no words; one that breaks → the
  other. Nothing heard by the stop says so under the box ("No words were heard…"); a break with no words says so too. Slid 90 pt away and let go: this listen's words dropped, nothing asked ("Let go to cancel"
  first).
- The robot held still 0.45 s with talking ready = hold to talk (a light haptic, the pill with the words); a finger
  moving 20 pt first is a slide. Not ready: the list opens, saying why. A hold that ends without the finger lifting
  (the touch taken by the system, the app leaving the front, the listening stopped by something else) ends cleanly:
  nothing asked, the words kept in the box, the kept note shown (11-18). The pill takes no touches and goes at once on
  let go: nothing of it may lie over the toolbar (iPhone, 11-18: a pill left in its exit animation took every toolbar
  tap). The best recognizer is looked for as the finger comes down; one found after listening started takes over with
  all the audio from the start, if no words came yet.
- Sound around talking (11-18): as listening starts TRIF pauses what plays; however listening ends, the audio is put
  back exactly as it was and what TRIF paused plays on from its time (never a reload). After a call or Siri it stays
  paused. One that "plays" with no time going by (two looks: 1.2 s, then 0.6 s), or hangs in a seek, gets steps in
  turn, each needing time to go by again: a seek to its own time, pause and play, 0.25 s on, 1 s on, then the media
  element loaded again at its time (never for a blob: source, a player's own stream; never the page). Each step and
  what worked goes to the diagnostics (11-18, Tim's reuters.com: "still stuck (3.6 → 3.6 s)").

## Links

- http/https open where they point, in the tab or a new tab, never redirected or rewritten (default-browser rules).
- Links that aren't web pages go to the phone's OS (11-18): tel:, mailto:, sms:, maps:, another app's scheme. [shared:
  core/app-links.js]
  - Kinds by scheme: http/https web; about, blob, data (and the app's test pages) stay in the page; javascript and file
    never leave; trif and the app's own schemes never leave (mod links: not followed); anything else is another app's.
  - At once only when the person tapped: a link or form with their finger on that page in the last 1.5 s (a script's
    `a.click()` is not a tap), or a long-press menu item.
  - A page or mod doing it by itself gets the OS browser's question ("Open this page in “App”?"): only for the shown
    tab's or chat's main frame, one at a time, once a page load; frames inside the page, tabs behind, the app in the
    background: nothing. More's panel: taps only, never a question.
  - No app for it: "No app on this iPhone can open this link." target=_blank / window.open of such a link: no empty tab.
  - The log keeps the scheme only (an address or number is the person's business).
- Long press on links and pictures = the OS browser's own menu (11-17, "normal iphone behaviour"), with Open in New Tab
  first for links; the preview tapped opens the link in the same tab. Text selection unchanged.
- A page's own window closing itself (window.close(), a sign-in popup) goes back to the tab that opened it, if that's
  still open and the popup was shown (11-18).

## Tabs

- Background tabs are let go after 20 s (and on a memory warning) unless playing sound; a playing tab is kept and let
  go once paused 20 s (11-16). A tab behind whose page process ends is let go and loads when shown.
- The tab list opens at the right card (11-18: "it should snap to the tab that I just left") [shared: tab-list.js]: the shown tab; from the
  chat (or the strip), the chat's own tab (its link's tab while open and on its site, else the shown tab); from Mods, the
  shown tab. That card is centred from the first frame and drawn as the current one.
- Tab pictures as Safari's and Chrome's (11-18): only the shown tab, only once drawn, never mid-scroll, never one of
  one colour; private pages (TRIF's sensitive list, sign-in hosts and paths, a password field) never pictured; else a
  grey card with the site's first letter. Title, then host, under each card.
- Toolbar buttons toggle (11-18): tabs and Mods tapped again close them, the page untouched; [+] again on its empty new
  tab closes it and goes back. The address screen's Cancel does the same; never closes the last tab.
- Toolbar order (11-17, "the old order"): back, forward, chat, page/+ (exactly centred), Mods, tabs, A.
- Unread counts instead of notifications (11-18) [shared: core/unread-count.js]: a site's count from its page title only
  (a count at the very start "(3) …", "(99+) …", "(1,234) …"; "Inbox (N)" anywhere; "(N unread)" anywhere; never a
  year at the start or a bracketed number elsewhere). A grey pill on the card (never red), the count taken out of the
  card's title. The app icon's badge = the sum over Home Screen icon tabs on their sites; badge permission only, asked
  once after TRIF's own words. Setting: Show unread counts (on at first). No background refresh. Diagnostics: numbers
  only, never titles.

## Video

- Sound and video play on with the app in the background or the phone locked; a page that pauses itself as it goes
  hidden is respected.
- A video picks up where it was (11-18) after any reload of the same page within 30 min (a reload, a page process
  ended, a mod applying, back to it, a relaunch). The matching rules are shared (core/video-resume.js); the page's
  own video id (in the page script) gives the same ids.
  - Same page = the same site video id (YouTube's v=, /shorts/, /embed/, /live/, /v/, youtu.be/ on youtube.com,
    youtube-nocookie.com and their subdomains; Vimeo's last all-digit path part), else the address without #. The kept
    page asking its own time too (a reloaded t= link) still resumes.
  - Not resumed: live, ended, a link asking its own time (t=, start=), the first 5 s or the last 10 s.
  - Applied to the video whose duration is within 1 s (same non-blob src): speed, muted, time; playing → played (with
    sound if the OS allows, else muted with "Tap for sound"). A site moving it in the next 6 s gets it put back once
    (not after the person's own touch or key).
  - Kept per tab across launches; older than 30 min dropped; a closed tab's removed.
- Protected (DRM) video plays (Tim 11-18), as in Chrome on Android, whose Site settings → Protected content is
  "Sites can play protected content" by default (no question; per-site exceptions kept until changed). Allowing it can
  let the site identify the device for the licence, so each site can be switched off, and that choice is kept across
  launches.
  - iPhone: nothing to do; WebKit handles FairPlay by itself, with no question.
  - Android: the WebView's protected media ask (RESOURCE_PROTECTED_MEDIA_ID, Widevine) is granted unless the site is
    switched off: the Mods tab's ⋯ "Protected content on {site}" (checked = on; the page loads again to take it).

## Desktop websites

- Request Desktop Website / Request Mobile Website (11-18, "a desktop mode like safari has"): websites only; the label
  follows the shown tab's loaded mode. Kept per host without `www.`, every tab, across launches; picking it reloads the
  shown tab only (others change at their next load). Phone mods run unchanged in it. The chat panes are never desktop.
  The key: the host in lower case, a leading `www.` removed. [shared: core/desktop.js]

## Icons (Home Screen) and full screen

- Full screen: per tab, remembered; a two-finger hold (0.3 s, each finger still: 11-18 "half as long") toggles it with
  a fading note; a faint exit button beside the clock.
- A Home Screen icon ALWAYS lands on its site's own tab in full screen (11-16: "no matter what it was in before"),
  closing covers (Add this mod? stays). An icon's own tab counts only while it's on the icon's site: off-site it's left
  alone and the icon makes a new own tab (11-17); a blank one takes the icon's address. TRIF's own icon opens as left.
- The icon's tab shows from the first frame, with no switch animation (11-17).
- The leaving cover (11-18): as the app leaves in icon use (the shown tab is an icon's own tab, on its site, in full
  screen, or the app came to the front by an icon's link within 3 s of coming back), a black screen with the robot
  covers it so the OS's picture is the robot, never another page; the launch screen the same. Otherwise the OS keeps
  its real picture. Off on return once the icon's tab is drawn (≤ 0.8 s), 0.2 s fade. [shared: core/leaving-cover.js,
  the "icon use" decision]
- Icons' look, names and batches: Tim's design 11-16/11-17 (see the notes); the profile is named "{Site} for TRIF".
- Several icons at once (11-16): "Add to Home Screen later" keeps an icon with its choices on a list (up to 20, across
  launches), added together in one go; the list clears once TRIF is opened from one of them.

## Safety and privacy

- No private APIs (the sites' or the OS's) and no session tokens; the one exception kept on iPhone is WebKit's cookie
  flush, with a public fallback.
- Diagnostics never hold cookie values, API keys, page titles with addresses, or a link's address/number.
- Diagnostics are the person's to send: the Mods tab's Send diagnostics…, and the page menu's Copy diagnostics (11-17,
  the same text, reachable without scrolling on the smallest phone).
- API keys stay on the device (Keychain / Keystore), this device only.
- On-device models download only when asked, with a visible bar; a model runs only after its checksum check.

## Default browser

- TRIF must stay default-browser compatible (11-18, a standing constraint): on launch, an address/search field or a
  usable start page; http/https links open where they point, in a new tab, with no redirecting or rewriting; the
  platform's web engine only; no crash-prone launch paths.

## Wording

- Every word people see is Tim's to approve: new words are drafts in the strings file (old → new). Wording changes only
  where Tim names them; don't sweep.
- Agent-facing text (prompts, logs, errors for agents) is the agents' call.
- Don't name other coding agents in what people see. The app is called TRIF (11-18).
- Panels and dialogs that can outgrow their space scroll.

## Shared code

`mobile/shared/` is run by both apps. The rules (pure decisions, no UI) are in `mobile/shared/core/*.js`, made into
`mobile/shared/gen/core.js` by `node mobile/prepare.js` (global `TrifCore`, one object per module); each has unit tests
in `mobile/test` (`node --test`). The iPhone calls it through JavaScriptCore (Core.swift), keeping a Swift fast path
only where a hot path needs it, held to the same answers by its test. Page-side code (chat.js, the pages' scripts,
mods.js) is shared already. Progress: mobile/SHARED-CORE-PROGRESS.md.

| Rule | Shared file | iPhone | Test |
|---|---|---|---|
| Unread count from a title | shared/core/unread-count.js (TrifCore.unreadCount) | UnreadTitle.swift (a twin, same cases: every title change) | test/unreadcount.test.js |
| Links to other apps | shared/core/app-links.js | AppLinks.swift → TrifCore.appLinks | test/core-applinks.test.js, test/applinks.test.js |
| Mod ids and renames: the @id line, the part revisions' texts, a name's file, a name's check | shared/core/mod-id.js (TrifCore.modId; the desktop's helper/lib/modid.js, its cases copied) | ModID.swift → TrifCore.modId (isId a twin; which mod keeps an id in a folder, stamping, the same mod, a rename's file: Swift decisions held by the Mac check) | test/core-modid.test.js, test/modid.test.js |
| What a chat may offer (memory, key, judge) | shared/core/chat-offers.js | ChatOffers.swift → TrifCore.chatOffers (storage and a key cache stay Swift) | test/core-chatoffers.test.js, test/chatoffers.test.js |
| Sites (a host's site; host in site; a chat's site) | shared/core/site.js | Site.swift (a twin, same cases: every navigation) | test/core-quickask.test.js, test/quickask.test.js |
| Quick ask: look-only, the pill's state, Undo's steps | shared/core/quick-ask.js | QuickAskRules.swift → TrifCore.quickAsk | test/core-quickask.test.js, test/quickask.test.js |
| Mod store, part 1: what a hold waits for, Allow, a change judged, the version kept running | shared/core/mod-store.js | ModHolds.swift → TrifCore.modStore (`waiting` a twin, same cases: every page load) | test/core-modstore.test.js, test/modstore.test.js |
| Mod store, part 2: adding, History, Recently deleted, Undo, Don't allow's and a restore's carry-over | shared/core/mod-store.js | ModChanges.swift → TrifCore.modStore (the records and the code compare stay Swift) | test/core-modstore.test.js, test/modstore.test.js |
| Mod store, part 3: what runs (switches, tiers off, Pause all), @match | shared/core/mod-store.js, shared/core/match.js | ModRuns.swift → TrifCore.modStore setOn / setGroup (`running`, `isOn`, `off` and MatchPattern twins, same cases: every page load) | test/core-modruns.test.js, test/modruns.test.js |
| A chat's offered mod: where it's read, where it came from, the coral box | shared/core/mod-offer.js | ModOfferRules.swift → TrifCore.modOffer (Browser.offerFromChat and the Add to TRIF tap; the words stay ModOfferView's) | test/core-modoffer.test.js, test/modoffer.test.js |
| The leaving cover's "icon use" (an icon's tab in full screen, or arrived by an icon within 3 s) | shared/core/leaving-cover.js | LeavingCoverRules.swift → TrifCore.leavingCover (the cover, its timing and the scene hooks stay LeavingCover.swift) | test/core-leavingcover.test.js, test/leavingcover.test.js |
| Which tabs load again when mods change (started or looked at; stale; later, keep, ask whether playing; reload) | shared/core/tab-reload.js | TabReloadRules.swift → TrifCore.tabReload (Browser.select / refreshIfStale; `loaded` and `stale` twins, same cases: every commit; the signature, the playing check and the reload stay Browser's) | test/core-tabreload.test.js, test/tabreload.test.js |
| A video picked up where it was: which load resumes (30 min, same page, live, ended, own time, first 5 s / last 10 s), the sites' video ids | shared/core/video-resume.js | VideoResume.swift → TrifCore.videoResume (an address as its parts: URLComponents; the page's script, the store and the play stay Swift) | test/core-videoresume.test.js, test/videoresume.test.js |
| Desktop websites' per-site memory (the key, wants, the kept list, can) | shared/core/desktop.js | DesktopRules (TabReloadRules.swift) → TrifCore.desktop `set` (`key`, `wants`, `can` twins, same cases: every page load) | test/core-tabreload.test.js, test/tabreload.test.js |
| The microphone's words only grow (segments, restarts after a pause, revised partials, a repeated segment) | shared/core/speech-text.js | SpeechText.swift → TrifCore.speechText.apply, every recognizer event (the committed words stay Swift and never cross: the answer says what to add; a Swift copy answers only if the shared rule can't) | test/core-speechtext.test.js, test/speechtext.test.js |
| The tab list: the card it opens at (the chat's own tab, else the shown tab), each card's robot badge; Go to {site}'s tab | shared/core/tab-list.js | TabListRules.swift → TrifCore.tabList (ClaudePane.chatTabShown and goToSite, TabsView's badges; `marked`, the card drawn as current, a twin, same cases: every drawing) | test/core-tablist.test.js, test/tablist.test.js |
