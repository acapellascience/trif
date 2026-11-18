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
  none) gets the coral "It runs on another site / other sites / every site" box first (11-17).
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
- While a change waits, the version before keeps running (or the one it was already keeping); a restored version that
  waits keeps the version before running only if that one wasn't waiting itself. [shared: core/mod-store.js]
- Adding: a mod added from a chat, a link or pasted is on; an import starts off, marked new (updated, if it replaces
  one); a new one from the computer (phone sync) starts off, marked as from the computer. A new version keeps what was
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
- A free mod with a style section gets that CSS at the page's start, as desktop's; its `trif.log/warn/error` and its
  start reach Diagnostics ("mod log", capped 40 a load, 200 characters), never page data.
- Point-and-hide is gone (11-17: "a resting thumb set it off"). Rules it made stay applied, each with Show again in
  the Mods tab.
- Safe mode: an unclean end while mods ran switches that site's mods off (the banner; the Mods tab lists them). An
  unclean end during TRIF's own heavy work (a model's check or run, an import) blames no mod and switches nothing off
  (11-18).
- The Mods tab never shows an error too early (11-18, "odd flashes of error"): a mod switched on is "starts when this
  page loads again" until the page has loaded with it, "starting" until 2 s after that page finished, and only then an
  error if it never said it started. A late state never shows a switch's old state; a tier's On/Off shows the tap at
  once.
- Phone sync with the computer: a change synced in makes the pages' scripts again; a delete goes to Recently deleted
  (30 days, Restore).

## Which tabs load again when mods change

- A mod change never reloads a tab whose mods didn't change (11-18: "you're watching a YouTube video, when you
  successfully add the mod to the other tab, your tab reloads"). Each tab keeps the signature it loaded with (every mod
  running there and its version); after a change the shown tab loads again only if its signature changed, and never
  while it plays sound; tabs behind load again when next shown (unless playing then).
- This holds for every path: Add this mod?, a banner's Add, the quick ask's Done and Undo, Allow, the Mods tab's
  switches and edits, safe mode, phone sync, imports (no reload).
- Pause all mods: the shown tab loads again even if playing (the person's own act); tabs behind only when shown.
- Every reload the app makes says why in Diagnostics ("reload <host>: <cause>"), 11-18.

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
  whose own @match names another site still warns.
- A conversation belongs to the site it started on: no follow-ups across sites.
- Diagnostics "chat offers": one line per hand-over (ids offered, skipped and why, held and why).

## Chats and tabs

- At most 3 chats at once; a working chat is never released; the robot opens the tab's own site's chat.
- A chat not being looked at that finishes shows a done banner (11-18): "{Service} made a mod for {site}" · Add · Go to
  {site}, or "{Service} replied about {site}" · Open chat. Its mods are held (one offer, never lost). On the chat's
  own site's tab with nothing over it, Add this mod? comes up at once instead.
- A tap anywhere on the banner outside its buttons = Open chat (11-18); a mod banner stays over the chat, still
  holding its mods. A plain banner goes after 8 s.
- Go to {site}: the tab sent from while it's open and on that site; else a new tab at its page (never a tab navigated
  elsewhere, nothing rewritten).
- Tab list robot badges show each tab's chat state; a long press on the toolbar's robot lists the chats.
- Chat pages read as TRIF (11-16): the robot in their greeting's place, "From TRIF: …" pills, upsells hidden; never
  their branding, Log in, terms or safety lines. Cosmetic only.
- No private routes or tokens of claude.ai / chatgpt.com; TRIF reads only what their pages show.
- The full chat opens with no keyboard (11-18: "the keyboard flies up and it's disorienting"): filling never leaves
  their box focused.
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

## Voice

- On-device recognition only, always; where it isn't available the microphone says so and records nothing. Refused
  permissions: the box still types.
- The microphone never stops by itself (11-18: "If you pause, it deletes the things you've said so far … Let it keep
  going and have long stretches of silence … The user will know when to stop it"): no silence stop, no time limit.
  Only the person's stop (tap) or letting go (hold) asks.
- The words only grow: what was said before a pause stays; a restarted recognizer's words are added after; a revised
  partial replaces only the words since the last committed ones. A new listen goes on after the box's words. [the
  accumulator: to be shared]
- Anything else stopping it (a call, Siri, the app leaving the front, the list closed, an error) keeps every word in
  the box, asks nothing, and says so; a robot hold stopped that way leaves a pill with the words (15 s).
- The box's microphone: a press under 0.3 s is a tap (listens until the next tap, which asks; ✕ keeps the words, not
  asked); longer is a hold. Slid 90 pt away and let go: this listen's words dropped, nothing asked ("Let go to cancel"
  first).
- The robot held still 0.45 s with talking ready = hold to talk (a light haptic, the pill with the words); a finger
  moving 20 pt first is a slide. Not ready: the list opens, saying why.
- Sound around talking (11-18): as listening starts TRIF pauses what plays; however listening ends, the audio is put
  back exactly as it was and what TRIF paused plays on from its time (never a reload). After a call or Siri it stays
  paused.

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
- The tab list opens at the right card (11-18: "it should snap to the tab that I just left"): the shown tab; from the
  chat (or the strip), the chat's own tab (its link's tab while open and on its site, else the shown tab); from Mods, the
  shown tab. That card is centred from the first frame and drawn as the current one.
- Tab pictures as Safari's and Chrome's (11-18): only the shown tab, only once drawn, never mid-scroll, never one of
  one colour; private pages (TRIF's sensitive list, sign-in hosts and paths, a password field) never pictured; else a
  grey card with the site's first letter. Title, then host, under each card.
- Toolbar buttons toggle (11-18): tabs and Mods tapped again close them, the page untouched; [+] again on its empty new
  tab closes it and goes back. The address screen's Cancel does the same; never closes the last tab.
- Toolbar order (11-17, "the old order"): back, forward, chat, page/+ (exactly centred), Mods, tabs, A.
- Unread counts instead of notifications (11-18) [shared: unread-count.js]: a site's count from its page title only
  (a count at the very start "(3) …", "(99+) …", "(1,234) …"; "Inbox (N)" anywhere; "(N unread)" anywhere; never a
  year at the start or a bracketed number elsewhere). A grey pill on the card (never red), the count taken out of the
  card's title. The app icon's badge = the sum over Home Screen icon tabs on their sites; badge permission only, asked
  once after TRIF's own words. Setting: Show unread counts (on at first). No background refresh. Diagnostics: numbers
  only, never titles.

## Video

- Sound and video play on with the app in the background or the phone locked; a page that pauses itself as it goes
  hidden is respected.
- A video picks up where it was (11-18) after any reload of the same page within 30 min (a reload, a page process
  ended, a mod applying, back to it, a relaunch). [the matching rules: to be shared; the page's video id already is in
  the page script]
  - Same page = the same site video id (YouTube v=/shorts/embed/live/youtu.be, Vimeo), else the address without #.
  - Not resumed: live, ended, a link asking its own time (t=, start=), the first 5 s or the last 10 s.
  - Applied to the video whose duration is within 1 s (same non-blob src): speed, muted, time; playing → played (with
    sound if the OS allows, else muted with "Tap for sound"). A site moving it in the next 6 s gets it put back once
    (not after the person's own touch or key).
  - Kept per tab across launches; older than 30 min dropped; a closed tab's removed.

## Desktop websites

- Request Desktop Website / Request Mobile Website (11-18, "a desktop mode like safari has"): websites only; the label
  follows the shown tab's loaded mode. Kept per host without `www.`, every tab, across launches; picking it reloads the
  shown tab only (others change at their next load). Phone mods run unchanged in it. The chat panes are never desktop.

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
  its real picture. Off on return once the icon's tab is drawn (≤ 0.8 s), 0.2 s fade. [to be shared: the "icon use"
  decision]
- Icons' look, names and batches: Tim's design 11-16/11-17 (see the notes); the profile is named "{Site} for TRIF".

## Safety and privacy

- No private APIs (the sites' or the OS's) and no session tokens; the one exception kept on iPhone is WebKit's cookie
  flush, with a public fallback.
- Diagnostics never hold cookie values, API keys, page titles with addresses, or a link's address/number.
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
| Unread count from a title | shared/unread-count.js | UnreadTitle.swift (a twin, same cases) | test/unreadcount.test.js |
| Links to other apps | shared/core/app-links.js | AppLinks.swift → TrifCore.appLinks | test/core-applinks.test.js, test/applinks.test.js |
| What a chat may offer (memory, key, judge) | shared/core/chat-offers.js | ChatOffers.swift → TrifCore.chatOffers (storage and a key cache stay Swift) | test/core-chatoffers.test.js, test/chatoffers.test.js |
| Sites (a host's site; host in site; a chat's site) | shared/core/site.js | Site.swift (a twin, same cases: every navigation) | test/core-quickask.test.js, test/quickask.test.js |
| Quick ask: look-only, the pill's state, Undo's steps | shared/core/quick-ask.js | QuickAskRules.swift → TrifCore.quickAsk | test/core-quickask.test.js, test/quickask.test.js |
| Mod store, part 1: what a hold waits for, Allow, a change judged, the version kept running | shared/core/mod-store.js | ModHolds.swift → TrifCore.modStore (`waiting` a twin, same cases: every page load) | test/core-modstore.test.js, test/modstore.test.js |
| Mod store, part 2: adding, History, Recently deleted, Undo, Don't allow's and a restore's carry-over | shared/core/mod-store.js | ModChanges.swift → TrifCore.modStore (the records and the code compare stay Swift) | test/core-modstore.test.js, test/modstore.test.js |
