# The iPhone app's new strings (branch ios-poc): awaiting Tim

**Awaiting Tim** (written 2026-11-15). Every string below is new or changed in the iPhone app (mobile/browser-probe)
and is already in the build so it can be tried; nothing here is approved yet. Where the app shows the same thing
as the desktop panel, it uses the panel's approved words unchanged (listed at the end, not for review). The
proof of concept's own strings (the probe's checks, report, point-and-hide bar) aren't listed: they're unchanged.

## Tabs

| Where | Old | New |
|---|---|---|
| Address bar, empty | Address | Search or type an address |
| Toolbar, accessibility labels | (icons only) | Back · Forward · Chat · Mods · Mods, {n} waiting for your OK · Tabs, {n} open · More · Reload · Stop |
| Tab switcher's title | — | 1 tab · {n} tabs |
| Tab switcher, a tab with no page | — | New tab |
| Tab switcher, a tab never pictured yet, or on a page never pictured (sensitive sites, sign-in pages, a password field) | its site's letter, and the site under it | a grey card with the site's letter in a circle (an empty tab: a globe); under every card its title, then its site (no new words; 11-18) |
| Tab switcher, + and × (accessibility) | — | New tab · Close {tab's title} |
| A new tab's page, its list | — | Visited lately |
| A new tab's page, nothing visited yet | — | Type an address or a search above. |
| The ⋯ menu | (wand menu, pages menu, checks and report buttons) | New tab · History · Import… · then the wand's four items as before · then **The probe** (Checks, Report, the test pages, the real sites) |

## History

| Where | New |
|---|---|
| Title, search field | History · Search history |
| Empty | No history yet. The pages you visit are kept here, on this phone only. |
| Search finds nothing | Nothing in your history matches. |
| A visit's long-press menu | Open in New Tab (approved by Tim 11-18, was "Open in a new tab") · Copy address |
| Clear button, its question | Clear… · **Clear history** — The last hour · Today · All history — Your history is kept only on this phone. Cleared, it's gone. |
| After importing a browser's history | Added {n} visit(s) to your history. |

## The Mods tab

The tab is the desktop panel's mods list (tiers, rows, icons, the approval and code cards) with the panel's words.
New or changed:

| Where | Desktop | iPhone |
|---|---|---|
| The sheet's title | (Mods on this site) | Mods on {site} (Mods when no site) |
| No mods for the site | (the section is hidden) | No mods for {site} yet. Open the chat, say what to fix, and add the mod it writes. |
| No site (a new tab) | — | Open a site to see its mods. |
| A tap on a row's icons (no hover on a phone) | each icon's words on hover; a click opens Details | a small card: each icon with its words (the panel's ICON_LABELS), and **Details** |
| After the bin | (moves to TRIF's trash, `trif restore`) | Deleted {name}. **Undo** (this launch only; there's no trash on the phone) |
| A tier's On / Off, its tooltip | …Click to switch them on here. / …click to stop all of these… | …Tap to switch them on here. / …tap to stop all of these running here (each mod's own switch is kept). |
| A tier's On / Off failing | — | Couldn't switch {Style mods} {on/off}: {why} |
| A free mod that should run here and didn't start | — | Can't run here on iPhone: this page didn't let it start. (under its row, and in Details) |
| "updated" tag's tooltip (an import replaced it) | TRIF updated it and switched it off: switch it on once you've looked at it. (a shipped mod's update) | You imported a new version of it, so TRIF switched it off: switch it on once you've looked at it. |
| History, nothing kept | No earlier versions kept. TRIF keeps the version before each change your agent makes, a fix, a restore or an import, for 30 days. | No earlier versions kept. TRIF keeps the version before each change your chat makes, a restore or an import, for 30 days. |
| Don't allow's tooltip | The version before stays; the change is kept in its history (trif history). | The version before stays; the change is kept in its history. |
| Things hidden by long-pressing, under the mods | — | **Hidden by pointing**, each selector with **Show again** |
| Under the list | (⋯ menu) Import mod… | **Import mod…** as a button; the sheet's ⋯ has Import mod… and Export all mods for {site} |

The mod switches' tooltips still say "click" (they come from extension/modswitch.js, shared with desktop): screen
readers read them on the phone. Worth a phone wording, or leave.

## Editing a mod's code (the code card's Code tab; added 11-15)

| Where | New |
|---|---|
| Code tab's button | Edit |
| While editing | Undo · Redo · Cancel · Save |
| Save refused | **Not saved:** TRIF found a problem in it. — then up to eight lines, each **Line {n}** (tap: the editor selects that line) and what's wrong, in `trif check`'s own words (helper and sandbox lint, as agents see them) |
| Saved, runs | Saved. It runs from this page load. **Undo** |
| Saved, needs an OK | Saved. It waits for your OK: the version before keeps running until you decide. **Undo** |
| After Undo | Put back the version from before your edit. Your edit is in History. |
| History, a version an edit replaced | before you edited it |
| The approval card's note for an edit | You edited it. (then desktop's "The version before keeps running until you decide.") |
| An edit's own holds, on the card | runs on {pattern}, outside {site} (desktop's held.js words) · is now a free mod, so it can do anything the page can do (new) |
| Editor (accessibility) | The mod's code (desktop's) |

## Getting out of a mod that wrecks a page, and diagnostics (added 11-15)

| Where | New |
|---|---|
| The Mods tab before its list arrives | Loading mods… |
| Mods tab's ⋯ | Pause all mods · Resume mods · Send diagnostics… |
| The app icon's long-press menu | Pause all mods |
| Mods tab, all paused | **All mods are paused:** none runs on any site. **Resume mods** |
| Toolbar's Mods button while paused (accessibility; its robot shows two bars for eyes, STYLE.md's paused face) | Mods, all paused |
| Over the page after safe mode | The app quit while mods were running on {site}, so TRIF switched it/them off. Switch them back on one at a time in Mods. **Mods** · **OK** |
| Over the page after a runaway offer was taken | TRIF switched off a mod / {n} mods on {site} that kept this iPhone busy. Switch them back on one at a time in Mods. **Mods** · **OK** |
| Mods tab, after safe mode | The app quit while these were running on {site}, so TRIF switched them off: **{names}**. Switch each back on to try it. **OK** |
| Mods tab, after a runaway offer | These kept this iPhone busy on {site}, so TRIF switched them off: … / The page on {site} stopped twice while these ran, so TRIF switched them off: … |
| The runaway offer (an alert) | **{site} keeps this iPhone busy** — Its page has been busy most of the time for 40 seconds while mods ran on it. Switch them off? {name} changed most recently. / Its page stopped twice in three minutes while mods ran on it. Switch them off? — **Switch off its mods** · **Not now** |
| Status strip, a page's process ended | This page stopped (iPhone ended it, often for memory), so it was loaded again. |
| The diagnostics file's name | TRIF diagnostics.txt (its lines are for whoever reads the log: not reviewed here) |

## Adding and importing

| Where | New |
|---|---|
| Status strip, a mod added that needs an OK (the Mods tab opens on its card) | {name} waits for your OK. |
| Status strip after an import (one) | Imported 1 mod: {name}. Like any mod from outside, it starts off, and waits for your OK if its code can do more than change the page. |
| … (several) | Imported {n} mods: {names}. Like any mod from outside, they start off, and each waits for your OK if its own code can do more than change the page. |
| … an error (desktop's words) | Couldn't import {file}: {why} |
| … nothing usable | Nothing to import there. · Nothing TRIF can import there: {files}. |
| The share sheet / AirDrop's "Open in" name for the app's files | TRIF mod (the document type's name, Info.plist) |
| The "Add this mod?" sheet's free-mod warning | unchanged words, now in the panel's coral |

## The chat, full screen (added 11-15, replacing the pane from the bottom)

| Where | Old | New |
|---|---|---|
| The chat's top bar, the way back | (the pane closed with the chat button) | **‹ {site}** (**‹ Tab** on a tab with no site); accessibility: Back to {site} |
| The chat's top bar, Start over | Start over (text) | a new-chat icon; accessibility: Start over |
| The chat's top bar | Send page · Paste | (gone: the tab's data goes into the message box when the chat opens, and a reply's mod comes to the app by itself) |
| The pane's grip (accessibility) | Chat height | (gone) |
| Toolbar's chat button (accessibility) | Chat | Chat · Chat, writing a reply (animated dots on the bubble) · Chat, replied (a small green mark: a reply with no mod in it) |
| The Add this mod? sheet, a reply with several mods (offered in turn) | — | {n} of {m} mods in the reply |
| Status strip, a reply whose mod can't be read | — | The reply's mod can't be added: {why}. |
| Status strip after a mod from the chat is added | Added {name}. What it did is attached in the chat's message box: send it, with what to fix, if it needs fixing. | (gone: what it did goes into the message box the next time the chat opens) · Added {name}. It runs on {sites}. (unchanged) |

What's attached in the message box keeps its names: TRIF instruction (a chat without TRIF's instructions yet),
TRIF follow-up (one that has them), TRIF screenshot, TRIF pointer. (Their pills read "From TRIF: …" since 11-16: see TRIF's look in
the Claude and ChatGPT pages.)

## TRIF's look in the Claude and ChatGPT pages (added 11-16, Tim: "make it clear … hello this is trif, those are attachments")

Drawn by TRIF over the chat's page (Web/chat.js look); nothing it adds is sent. Drafts for Tim.

| Where | Old | New |
|---|---|---|
| A new, empty conversation: TRIF's greeting, in the chat's own greeting's place (theirs hidden), or above the message box | (the chat's own: How can I help you today? · What are you working on?) | TRIF's robot, then **Hello, this is TRIF** · **What would you like to fix on {site}?** ({site} in TRIF's green; without a site: What would you like to fix on this site?) · once TRIF's attachments are in the box: TRIF has attached the page below. Say what bothers you, then send. With little room (the keyboard up on the SE): the robot beside the first two lines only |
| What TRIF attached, as pills in the message box (the robot before the words) | TRIF instruction · TRIF follow-up · TRIF screenshot · TRIF full page · TRIF pointer | From TRIF: page & guide · From TRIF: the page now · From TRIF: screenshot · From TRIF: full page · From TRIF: your pick (the files keep their names, which the chat and the model see) |
| An attachment of TRIF's in markup TRIF doesn't know | its tile as the chat draws it | the same, on TRIF's green tint with the robot before its name |
| The chats' upsells | Upgrade · Upgrade plan · Get Plus · Try Go… · See plans and pricing | (hidden: only buttons and links with exactly such words; their names, logos, Log in, terms, privacy and "can make mistakes" lines stay) |

## Notes that go by themselves (added 11-15)

| Where | Old | New |
|---|---|---|
| The notes at the foot of the page (status, Hidden: … Undo) | a × to close each (accessibility: Dismiss) | no ×: each fades out after 2 s, or 5 s with Undo; a tap sends it sooner (10 s with VoiceOver on). No new words |
| The Mods tab's note (Deleted {name}. Undo · Couldn't switch …) | stayed until the next change | the same: 5 s with Undo, 2 s without |
| Status strip, a load that was cancelled or interrupted (another navigation replaced it, the page stopped itself: amazon.com) | The operation couldn't be completed. (NSURLErrorDomain error -999.) | (nothing, as in Safari); real failures (offline, an unknown host, a certificate) still show |

## The bars as the page scrolls, and the toolbar's icons (added 11-15)

| Where | Old | New |
|---|---|---|
| The address bar, scrolled down (compact) | — | the site without www. (a small lock on https; **New tab** on an empty tab); accessibility hint: Shows the address bar. The chat's robot sits at its right while a reply is being written or waits (accessibility: Chat, writing a reply · Chat, replied) |
| Toolbar, the Mods button | the robot (paused: bars for eyes) | a switch (paused: off); accessibility unchanged: Mods · Mods, all paused · Mods, {n} waiting for your OK |
| Toolbar, the chat button | a speech bubble (dots while writing, a green mark when replied) | the robot (three moving dots for eyes while writing, the green mark when replied), shown selected while the chat is open; a second tap goes back to the tab. Accessibility unchanged: Chat · Chat, writing a reply · Chat, replied |
| The chat, full screen | covered the toolbar | the toolbar stays under it; back and forward only close the chat (back to the page as it was), the other buttons go back to the tab and do their job there |
| Toolbar, back and forward while the chat is open (accessibility) | Back · Forward | Back to {site} (Back to Tab on a tab with no site), as the chat's own ‹ {site} |

## Notifications when a reply is done in the background (added 11-15)

Asked for at the first send (iOS's own question; the app adds no words to it). Posted only while the app is in the
background, within the ~30 s iOS gives it there.

| When | Title | Body |
|---|---|---|
| The reply has one mod | Your mod is ready | {mod's name} for {site}: tap to add it. |
| Several mods | Your mods are ready | {n} mods for {site}: tap to add them. |
| No mod | Claude replied (ChatGPT replied) | On {site}: tap to read the reply. |
| iOS's background time ran out first (quiet: no sound or banner, only in the list; removed when the app opens) | Still writing | Claude is still writing for {site}. Open TRIF to get your mod when it's done. |

A tap opens the app on the tab the message was sent from, with Add this mod? (or the chat at the reply).

## The chat's message box filling faster (added 11-15)

| Where | Old | New |
|---|---|---|
| Over the chat while the tab's data goes into its box (a moment; it was 10 to 15 s on Instagram) | — | Adding the page… |
| The screenshot attached in the message box | TRIF screenshot.png | TRIF screenshot.jpg |

## The address bar and the address screen, like Chrome's (added 11-15)

| Where | Old | New |
|---|---|---|
| The address bar, not being typed in (full and small) | the whole address in a field | only the site, centred: x.com (no www. or m., no scheme or path), with the lock on https; a tab with no page: Search or type URL |
| The address bar, accessibility | — | Address, {site} |
| The full address bar's share button (iOS's share sheet; Copy is first there) | — | an icon; accessibility: Share |
| The address screen, the field's placeholder | Search or type an address | Search or type URL |
| The address screen, beside the field | — | Cancel |
| The address screen, the current page's row: its buttons (accessibility) | — | Copy link (then Copied) · Edit link |
| The address screen, over the history | — | History |
| Typing something that isn't an address | (searched DuckDuckGo) | searches Google (no new words) |

## The toolbar's page button (added 11-15)

| Where | New |
|---|---|
| The toolbar's middle button (a page in a soft green circle): back to the page from the chat, the tabs, Mods or the address screen; on the page already, only a light tap | accessibility: Back to {site} (Back to Tab with no site), the string the chat's ‹ {site} uses |
| Back and forward while any of those cover the page | close it, as they did for the chat; accessibility: Back to {site} |
| The same button on the page itself (changed 11-16): a + that opens a new tab, onto the address screen; the glyph turns between + and the page as the view changes | accessibility: New Tab |
| The page glyph (over the chat, Mods, the tabs, the address screen; changed 11-16) | no soft circle behind it (the circle means "you're here"); the + keeps its circle | (no words) |

The tabs and the Mods tab now open over the page with the toolbar showing under them (they were sheets over it).

## iOS's permission questions (added 11-16)

A page asking for the camera or microphone (x.com's compose, for a photo) ended the app: iOS requires these words.
iOS shows them under its own "“TRIF Probe” Would Like to Access the Camera" question.

| Key | New |
|---|---|
| Camera | To scan the code TRIF shows on your computer. Websites you visit can also ask to use the camera, for a photo or a video call. (changed 11-17, draft, the phone link: was "Websites you visit can ask to use the camera, for a photo or a video call.") |
| Local Network (added 11-17, draft, the phone link) | TRIF looks for your computer on your Wi-Fi when you choose My computer. |
| Microphone | To hear what you'd like changed while you hold the microphone in TRIF. Websites you visit can also ask to use the microphone, for a voice or video call. (changed 11-18, draft, quick ask: was "Websites you visit can ask to use the microphone, for a voice or video call.") |
| Speech Recognition (added 11-18, draft, quick ask) | To turn what you say into text, on this iPhone, while you hold the microphone in TRIF. (iOS puts its own fixed lines above it: "Speech data from this app will be sent to Apple to process your requests…". TRIF asks for on-device recognition only, but that system text can't be changed.) |
| Saving to Photos | To save pictures from websites to your photos. |

## Pulling the page down (added 11-16, as Chrome's)

| Where | Old | New |
|---|---|---|
| The address bar | Reload (accessibility) | (gone: pull the page down) |
| The address bar while a page loads | Stop (accessibility) | a small × after Share; accessibility: Stop loading |
| Pulling the page down past its top: three choices, the chosen one's name under it | — | New Tab · Reload · Close Tab |

## The chat's top bar (changed 11-16)

| Where | Old | New |
|---|---|---|
| Top left | ‹ {site} (back to the tab; accessibility Back to {site}) | ‹ alone, back in the chat's own pages (from a file, a link, a sign-in page), hidden when there's nothing to go back to; accessibility: Back |
| Beside new chat | (a spinner while loading) | a reload arrow; accessibility: Reload the chat. While loading: × ; accessibility: Stop loading |
| The toolbar's back and forward while the chat shows | closed the chat | the chat's own back and forward (Back · Forward); the page button goes back to the tab |
| When the page's data couldn't go in (diagnostics only) | — | (no words shown) |

## Home Screen icons (added 11-16; the sheet's steps changed 11-16, Tim; the icon's look and name, and the [+], 11-16, Tim's design)

Tim's own labels, approved as he wrote them: the name choices **{Site} on TRIF** · **{user}'s {Site}** (only when the
person's name on the site is known) · **fixed {Site}** · **Custom…**. The rest of this table awaits Tim.

| Where | Old | New |
|---|---|---|
| The toolbar's last button | ⋯ (accessibility: More), a menu | + (accessibility: Add to Home Screen; greyed on a page that isn't a website) |
| The ⋯ menu | in the toolbar's last button; had Add to Home Screen | at the address bar's left (accessibility: More); the same items, without Add to Home Screen (the + has it) |
| The sheet's icon preview | the site's icon (accessibility: none) | the icon as it will look, its label under it as the Home Screen shows it (cut short with … where iOS would); accessibility: The icon |
| The sheet's name (replaces the Name field) | Name (a text field, filled with the site's short name) | **Name** with a menu: Tim's choices above; Custom… shows a text field (placeholder: the site's name), filled with the name that was chosen, up to 60 characters |
| Under the name | — | iOS can't rename the icon once it's on your Home Screen. |
| The outline switch | — | TRIF outline (on: TRIF's outline round a black screen with the picture on it; off: just the picture) |
| The outline's colours (accessibility) | — | TRIF green · Blue · Purple · Pink · Orange · Graphite · Other colour (iOS's colour picker) |
| The picture row | — | Picture · Choose… (Photos, which shows only what the person picks) · once chosen: Use the site's icon · Change… |
| The badge switch | — | Fixed badge, with the line: A green checkmark: this site has been fixed. |
| The sheet's title | — | Add to Home Screen |
| Its top-left button | — | Cancel; once started: Done (top right) |
| The sheet's name field (placeholder) | — | Name (filled in with the site's own short name, e.g. X) |
| Steps, the Safari route (shown before anything happens; the step they're on marked) | — | 1. Safari opens and asks to download a profile: tap Allow. · 2. Open the Settings app and tap Profile Downloaded near the top (or General → VPN & Device Management). · 3. Tap Install, enter your passcode, then Install again. · 4. The icon appears on your Home Screen. |
| Steps, the Files route | — | 1. Choose where to save the file (On My iPhone is fine), then tap Save. · 2. Open the Files app and tap “{Site} for TRIF”. · then Settings' three steps as above (was “{Name} for TRIF”: the file is now named after the site, whatever the icon's name) |
| Why (always shown) | — | iOS only lets an icon that opens an app be added this way, with a small profile. It adds just this one icon, and you can remove it in Settings → General → VPN & Device Management. |
| Once started (Safari route) | — | A downloaded profile waits about 8 minutes. If it's gone from Settings, tap Download it again here. |
| Once started (Files route) | — | A profile waits about 8 minutes in Settings. If it's gone, tap the file in Files again. |
| Where they are (a line over the steps) | — | Opening Safari… · Safari is open: tap Allow there, then come back here. · Safari downloaded it: next, Settings. · If Safari asked and you tapped Allow: next, Settings. · Saved to Files: next, open the Files app and tap it. · Done: the icon is on your Home Screen. (TRIF was opened from the new icon) |
| When Safari didn't get it | — | Safari didn't get the icon. Save it to Files instead. · {Chrome} opened instead of Safari, and only Safari can add the icon. Save it to Files instead. |
| Buttons | — | Add to Home Screen; then Download it again · Save to Files instead (after a start, or when Safari didn't get it) · Files route: Save to Files, then Save it again · Use Safari instead |
| If the page's icon and name couldn't be read | — | Couldn't make the icon for this page. |
| The profile in Settings (name) | {Name} for TRIF | {Site} for TRIF (the publisher line shows TRIF) |
| The profile in Settings (description) | Adds {a/an} {Name} icon to your Home Screen that opens {Name} in TRIF. | the same when the name is the site's own; else: Adds an icon, “{Name}”, to your Home Screen that opens {Site} in TRIF. |
| The icon's label on the Home Screen | {Name}, as typed in the sheet | {Name}, as chosen in the sheet |

## Several Home Screen icons in one install (added 11-17, Tim: "have a queue of unexported and then you could batch it")

| Where | Old | New |
|---|---|---|
| The [+] sheet, under its main button (before anything starts) | — | **Add to Home Screen later**; when the site is on the list already: **Update it in the list** (its choices load into the sheet) |
| …when the list is full | — | The list holds up to 20 icons. |
| The note after Add to Home Screen later | — | Saved for later: {n} icon(s) waiting, in ⋯ → Home Screen icons to add. |
| The [+] sheet, when icons wait (a card) | — | **Waiting to be added** · {Site, Site, …} · **Add them all…** (closes the sheet, opens the list) |
| The [+] sheet, when the site went in another profile before | — | You added {Site} with other icons before. If that icon is still on your Home Screen, this adds a second one: press and hold the old one, then Delete Bookmark. |
| The ⋯ menu (only while icons wait) | — | Home Screen icons to add ({n})… |
| The list's title / its top-right button | — | Home Screen icons to add · Done |
| Each row (tap: edit; the red minus: take it off) | — | the icon, its label, its site · accessibility: Edit {label} · Take {label} off the list |
| Empty list | — | No icons waiting. On a site, tap + and then Add to Home Screen later. |
| Before the install (2 or more) | — | They go in one profile: one download and one Install in Settings. Removing that profile removes all {n} icons together; you can still delete any one of them from the Home Screen (press and hold it, then Delete Bookmark). |
| Sites added before | — | Added before: {Site, Site}. If an earlier icon is still on your Home Screen, this adds a second one: press and hold the old one, then Delete Bookmark. |
| The list's main button | — | Add all {n} to Home Screen (one icon: Add to Home Screen); then Download it again, Save to Files etc. as the [+] sheet |
| Its steps (as the [+] sheet's, plural) | — | the last step: The icons appear on your Home Screen. · Files route step 2: Open the Files app and tap “TRIF icons”. |
| Where they are, plural | — | Done: the icons are on your Home Screen. · Safari didn't get the icons. Save them to Files instead. · {Chrome} opened instead of Safari, and only Safari can add icons. Save them to Files instead. · Couldn't make the icons. |
| Clear | — | **Clear the list** (red), asks: Clear all {n} icons from the list? (one: Clear the icon from the list?) · Clear the list · Cancel |
| Editing one (a sheet over the list) | — | title Edit icon · Cancel · Save (the same choices as the [+] sheet, no steps) |
| The profile in Settings (name) | — | TRIF icons: {Site}, {Site}, {Site} (more than four: the first three and “and {n} more”) |
| The profile in Settings (description) | — | Adds {n} icons to your Home Screen that open their sites in TRIF: “{label}”, “{label}”, …. Removing this profile removes all {n}. |
| The file on the Files route | — | TRIF icons |

## The toolbar's Home Screen button and the tabs button (changed 11-17, Tim)

| Where | Old | New |
|---|---|---|
| The toolbar's last button (Add to Home Screen) | + | an A in a rounded square, like the App Store's (SF Symbol a.square); accessibility unchanged: Add to Home Screen |
| The toolbar's order (Tim, 11-17) | back, forward, chat, [page / +], Mods, tabs, Home Screen | back, forward, chat, [page / +], tabs, Mods, Home Screen (no new words) |
| The toolbar's order (Tim, 11-17, later: "the old order") | back, forward, chat, [page / +], tabs, Mods, Home Screen | back, forward, chat, [page / +], Mods, tabs, Home Screen again (no new words) |

## The full screen exit button (moved 11-17, Tim: "can we move it up?")

No new words: the same button (accessibility: Switch to TRIF view), now beside the clock at the foot of the status bar.

## Long press on a link or a picture (added 11-18, Tim: "normal iphone behaviour")

The system's own menu and preview, as in Safari. Its items are iOS's own words (link: Open · Add to Reading List ·
Copy Link · Share…; picture: Share… · Save to Photos · Copy · Copy Subject · Look Up); Save to Photos asks with the
Photos permission line already listed above ("To save pictures from websites to your photos.", unchanged).

| Where | Old | New |
|---|---|---|
| A link's long-press menu, first item (Safari's own words; approved by Tim 11-18) | (no menu) | Open in New Tab |
| History, a visit's long-press menu, first item (approved by Tim 11-18, to match) | Open in a new tab | Open in New Tab |

## Add this mod?: what TRIF found, and a mod for another site (added 11-17, Tim approved a stronger out-of-site warning)

The findings reuse the Mods tab's approval card's words unchanged: **TRIF found that this mod:** (boxed: **It asks for these powers. TRIF holds it to them:**, each line “It {finding}.”) and **Together,** it {warning}. New, at the top in coral with a warning sign, when the mod runs on a site other than the one it came from (the chat's site, or the page it was pasted on; not for a file or a code):

| Where | Old | New |
|---|---|---|
| Title | — | It runs on another site · It runs on other sites · It runs on every site |
| Line (one or more other sites) | — | It came from {site}, but it (also) runs on {other sites}. Add it only if you meant it to change that site / those sites. |
| Line (every site) | — | It came from {site}, but it runs on every site you visit, not just {site}. Add it only if you meant it to. |

## Full screen (added 11-16 as "the app view"; renamed and changed 11-16, Tim)

| Where | Old | New |
|---|---|---|
| A tab in full screen | — | its page with no address bar, toolbar or tabs; mods run as usual. Each tab's own, remembered |
| Two fingers held still on the page for a moment (any tab, either way) | a "Switch to TRIF view" control at the top, in the app view only | switches at once; a note at the top, fading after 2 s: Switched to full screen · Switched to TRIF view |
| The first time in full screen (once) | — | Hold two fingers on the page to switch views (fades after 4 s) |
| The ⋯ menu | — | **Full screen**, with the line under it: Or hold two fingers on the page |
| The ⋯ menu (a switch, off at first) | — | Hide the full screen button |
| Full screen's button (a small round one at the top right, below a site's own top bar; bright for 3 s on entering, and for a moment when the page is scrolled back up or the app comes back; otherwise faint) | — | (a picture only: the exit full screen glyph) accessibility: Switch to TRIF view |
| With the button hidden, for VoiceOver | Switch to TRIF view (an action) | Switch to TRIF view (a button of its own) |
| A Home Screen icon made from 11-16 (its address has app=1) | opened the app view | its tab starts in full screen; each icon keeps its own tab |
| A link tapped in full screen to another site | opens in TRIF's own view, in a new tab | opens in TRIF view, in a new tab |

## Mods that arrive by themselves (added 11-16, Tim approved)

| Where | Old | New |
|---|---|---|
| The ⋯ menu | — | Watch a folder for mods… · once one is watched: Mods folder: {folder}… and Stop watching {folder} |
| After picking a folder | — | TRIF looks in {folder} for new mods each time you open it. |
| Each new .js file there, and a mod in a QR code's link | — | the usual Add this mod? sheet, one at a time |
| A file there that isn't a mod | — | Couldn't read a mod from {folder}: {file}: {why}. (Couldn't read {n} mods … for several) |
| A QR code's link that can't be read | — | That code's mod couldn't be read: it may be cut short or damaged. |
| If the folder can't be kept | — | TRIF couldn't keep that folder. |

## TRIF chats in a project (added 11-16)

| Where | Old | New |
|---|---|---|
| The ⋯ menu | — | Keep TRIF chats in a project… · once one is used: TRIF chats' project… |
| Its question, before a project is used | — | **Keep TRIF chats in a project** In {Claude/ChatGPT}, make a new project and paste TRIF's instructions as its instructions (they're copied when you tap Copy and go). Then, on the project's page, tap Use this project for TRIF chats. New TRIF chats then start in it. · Copy and go · Cancel |
| Its question, once one is used | — | **TRIF chats' project** New TRIF chats in {service} start in your project[, which has TRIF's instructions]. Project chats may still show in {service}'s recent chats. · Make another · Stop using it · Cancel |
| Over a project's page in the chat (one TRIF isn't using yet) | — | Use this project for TRIF chats |
| Tapping it | — | **Use this project for TRIF chats?** New TRIF chats start in this project. If you pasted TRIF's instructions into it, each chat gets just the page. · Use it: TRIF's instructions are in it · Use it: they aren't in it · Cancel |
| What's copied for the project's instructions | — | agent-facing (TRIF's how-to-reply note and the mod guide), not for review |

## More: the side panel's chat on an API key, or on this iPhone (added 11-16)

The desktop side panel itself runs here (mobile/prepare.js copies it): every word it already has carries over unchanged
and isn't listed. Only what's new or reads differently on the phone:

| Where | Old | New |
|---|---|---|
| The robot view's switch | Claude · ChatGPT | Claude · ChatGPT · **More** |
| The panel's agent picker (Settings → Agent) | the coding agents | On this iPhone · Claude API · OpenAI API · OpenRouter (and the panel's own None (robotless)) |
| On this iPhone's note under the agent | — | A stand-in for now: no model runs on this iPhone yet. |
| Its one model | — | Stand-in · No model runs on this iPhone yet: a canned reply, to try the chat end to end. |
| OpenRouter's default model | — | Auto (OpenRouter picks) |
| Settings, under the effort: a block of its own | — | **API keys** · one row each: Anthropic / OpenAI / OpenRouter, a field (Paste your key) and Save; once saved: ✓ Saved · Replace · Remove key (Cancel while replacing). Under each: Sent only to {host}. At the end: Each key is kept in this iPhone’s Keychain, only on this iPhone, and only sent to its own service. |
| Saving or removing a key | — | Saving… · Removing… · Couldn’t save the key: {why} · Couldn’t remove the key: {why} (the Keychain's own refusal: the Keychain said no ({code})) |
| An engine without its key (the panel's login notice, its own words) | {agent} isn’t logged in. | {Claude API} isn’t logged in. To log in, add your {Anthropic} API key in Settings, under API keys. (Send's tooltip: Log in to {Claude API} first) |
| The run's steps, one line each (the panel's tool lines) | — | Read the page's outline · Looked for `{selector}`: {n} match / matches · Looked for `{selector}`: not a valid selector · Couldn't look for `{selector}` · Tried {mod} (style mod): {x} of {y} selectors matched[, {n} errors] · Tried {mod} (boxed mod): no errors / {n} errors · Tried {mod} (style mod): it failed to start · Couldn't try it: {why} · Couldn't try {mod}: free mods can't be tried here · Couldn't try {mod}: its @match doesn't cover this page · Took a screenshot · Couldn't take a screenshot · Couldn't use the tab: it was closed · Couldn't read a tool call (its arguments weren't JSON) · Asked for a tool TRIF doesn't have ({name}) |
| A run's errors (the panel's error lines) | — | {Claude API}: {the service's own message} ({status}) · Stopped after 15 steps. Say “go on” to let it continue. · The reply was cut off: it reached the model's length limit. · {Claude API}: the model declined this request · No {Anthropic} API key yet: add it in Settings, under API keys. |
| Something of desktop's panel the phone doesn't have | — | This isn’t in the iPhone app yet. |
| On this iPhone's reply (the stand-in, until a model runs on the phone) | — | This is a stand-in: no model runs on this iPhone yet. When one does, it answers here, with the page in hand. / Meanwhile, here's a small style mod for this site, to try Add this mod?: it underlines the links. (the mod: Underlined links · Underlines every link (from the stand-in on this iPhone)) |
| Not shown on the phone (panel-phone.css) | the robot's power switch, the mods list, the agent level menu, Settings' instructions, updates, Tim's mods, sites, sensitive sites, Report a problem · Setup and status | — (the Mods tab has the mods; the app's tools are fixed) |

## More than one chat at a time (added 11-16, Tim approved)

| Where | Old | New |
|---|---|---|
| The chat's top bar, with two or three chats open | — | a button (two stacked squares) with a small green dot while another chat is writing a reply; accessibility: Chats, {n} open |
| Its list, one line per chat | — | {site} · {the conversation's title} (No site for a new tab), with Writing a reply or Replied under the one that is; a check on the one shown |
| The robot button | opened the one chat | opens the shown tab's own chat (a new one if it has none), never another tab's working one; its dots show while any chat writes |

## On this iPhone: the model on the phone (added 11-16, from the research)

| Where | Old | New |
|---|---|---|
| On this iPhone's note under the agent | A stand-in for now: no model runs on this iPhone yet. | Runs on this iPhone: free, and nothing leaves it. Style mods, about half a minute each. |
| No model downloaded yet (the panel's login notice, its own words) | — | On this iPhone isn’t logged in. To log in, download a model in Settings, under Model on this iPhone. |
| Its models (Settings → Model) | Stand-in | MiniCPM5 2B · Qwen3.5 2B · Qwen3.5 4B, each: Style mods. The best of the small ones in TRIF's tests. / Style mods. Reads pages about twice as fast; gets fewer right. / Style mods, and boxed mods (experimental). Needs 6 GB of memory. (then its size). In the Simulator only, the stand-in too: No model runs in the Simulator: a canned reply, to try the chat end to end. |
| Settings, a block of its own under API keys | — | **Model on this iPhone** · This iPhone has {n} GB of memory; {size} free for files. · one per model: {name} · {size}[ · suggested for this iPhone], its note[ This iPhone has too little memory for it.] |
| A model's state and buttons (changed 11-16: a real bar, numbers, Cancel) | — | Download → Download {size}? Best on Wi-Fi; it goes on in the background. Download · Cancel · a bar, then {MB} of {MB} · {MB}/s · {time} left, then Downloading… {n}% Pause · Cancel · Paused[: {why}] Resume · Cancel · Checking it… · ✓ On this iPhone Delete · Couldn’t download it: {why}. Try again · Couldn’t start it: {why} |
| Over the chat, while On this iPhone is its agent and a model is on its way (in place of the "isn't logged in" notice; added 11-16) | — | Downloading {model} to this iPhone (Checking {model}… / Paused: {model}…) · the same bar, numbers and buttons |
| A download that's stopped coming in (Settings and the chat's bar) | — | Nothing new for {time}: it goes on by itself when the network is back. · Nothing has come in yet[ ({why})]. It may be waiting for a network connection. · It hadn’t started, so it was started again. · Waiting for a network connection. |
| When it ends (Settings and the chat's bar, for a moment) | — | Model ready: {model}. · Couldn’t download {model}: {why}. · {model}’s download is paused: {why}. Resume it in Settings. |
| A notification, when it ends with the app away | — | **Model ready** {model} is on this iPhone: the More chat can use it. · **Model download stopped** {model}: {why}. |
| Why a download failed or paused | — | it didn't match its checksum, so it was deleted · the server answered {code} · the download couldn't be kept · this iPhone ran out of space · the network connection was lost · it stopped when the app was swiped away · Background App Refresh is off for TRIF · iOS stopped it to save resources · it stopped while the app was closed · it couldn't be paused; start it again · There isn't room for it: it needs {size}, and {size} is free. |
| Settings, Model on this iPhone: where it runs (added 11-16, after Tim's SE froze) | — | Runs on: Processor (smoother) · Graphics chip (faster, may stutter) — the processor by default |
| Settings, a 4 GB phone only (added 11-16) | — | ☐ Show bigger models (may be slow on this iPhone) — then Qwen3.5 4B · 2.74 GB, its note: Style mods (boxed mods too, if you pick them). Slower on this iPhone: about 1–3 minutes a mod, and other apps may close in the background. |
| Settings, when the 4B model is listed (added 11-16) | — | ☐ Qwen3.5 4B: boxed mods too (experimental) — off by default on a 4 GB phone, on with 6 GB and up |
| A request about one part of a page whose parts have made-up names (Google's search page say; added 11-16) | — | {host} names its parts with codes that mean nothing (and change), so the model on this iPhone is unlikely to find the one you mean. Claude can work it out from the page. Ask Claude |
| Stop during a request | — | (the panel's own "stopped" line, within a second) |
| The run's steps (the panel's tool lines) | — | Reading the page… (about half a minute on this iPhone) · Writing… |
| Its reply | — | Here's a {style/boxed} mod for {host}, written on this iPhone: (the mod) · Not right? Ask Claude (a link: the same request in Claude's chat, with the page) |
| When it couldn't | — | The model on this iPhone couldn't write a mod for that ({the reply isn't JSON / the reply has no rules / no mod in the reply}). Not right? Ask Claude |
| Its errors (the panel's error lines, after "On this iPhone: ") | — | {model} isn't on this iPhone yet: download it in Settings, under Model on this iPhone. · the model on this iPhone needs a real iPhone: the Simulator can't run it · the model couldn't be loaded ({file}) · the model stopped while reading ({code}) · the reply's shape couldn't be set up · the page is too long for the model ({n} tokens) |
| The stand-in's reply (the Simulator only now) | This is a stand-in: no model runs on this iPhone yet. When one does, it answers here, with the page in hand. | This is a stand-in: no model runs in the Simulator. On an iPhone, the model on it answers here, with the page in hand. |

## The desktop panel's words, reused unchanged (not for review)

Style mods / Boxed mods / Free mods and their lines; On / Off; the row tags (new, updated, on hold, change on hold,
error, N errors); the light's tooltips; Show code; Delete; N more for other {site} pages; the approval card (Waiting
for your OK, N of M waiting for your OK, It asks for these powers. TRIF holds it to them:, TRIF found that this
mod:, A change to it is waiting. TRIF found that the new version:, Together, …, the free-mod warning, You imported it
from a file., An agent wrote / changed it in your chat on {site}., Updates that ask for the same powers won't ask
again., The version before keeps running until you decide., Allow, Show code / Hide code, Show what changed, Don't
allow, Not now); the code card (Code, Details, History, Running now, Waiting for your OK, the Details lines, See
differences, Restore, the History sources, The version from {date}., What changed since the version from {date} (-
then, + now)., Restored the version from {date}. The one before is in History., Copy, Copied, Export); every power's
and warning's "i" (explain.json); Import mod…; Export all mods for {site}; Couldn't export: {why}.

## My computer: pairing with TRIF on the computer (added 11-17, drafts; the phone link, step 13)

The phone link's pairing screen (PhoneLinkView.swift). It opens from More (Settings' My computer block, and the My
computer engine's notices; since 11-17, step 14, in place of the ⋯ menu's "My computer…", now gone) and from a
`trif://pair` link (iOS's Camera app scanning the code in desktop TRIF's Settings). The same lines are in
docs/PHONE-LINK-STRINGS.md on branch phone-link.

| Where | New |
|---|---|
| ~~The ⋯ menu~~ (removed 11-17: More opens it) | ~~My computer…~~ |
| The screen's title | My computer |
| Before pairing | Your coding agent on your computer makes the mod. In TRIF on your computer, open Settings, choose Connect a phone, and scan the code. |
| The button | Scan the code (once paired: Scan a new code) |
| Under the camera | Scan the code in TRIF's Settings on your computer: Connect a phone. |
| The camera, for a screen reader | The camera, to scan the code |
| A QR code (or link) that isn't TRIF's pairing code | That isn't a code from TRIF on your computer. |
| No camera | This iPhone has no camera to scan with. |
| Camera access off | TRIF can't use the camera. Turn it on in Settings, then TRIF Probe, then Camera. · Open Settings |
| Looking | Looking for {computer} on your Wi-Fi… |
| Connecting | Connecting to {computer}… |
| Done | Connected to {computer}. |
| Paired, later | Connected to {computer} since {date}. |
| Not found | Can't find {computer}. It may be asleep, on another Wi-Fi, or have no browser with TRIF open. |
| The code was used, cancelled or is over 5 minutes old | That code didn't work: it may have been used already or be more than 5 minutes old. Show a new one on {computer} and scan it again. |
| Local Network access off | TRIF needs Local Network access to find {computer}. Turn it on in Settings, then TRIF Probe, then Local Network. · Open Settings |
| An answer that doesn't decrypt (not the code's computer) | Something on your Wi-Fi answered as {computer} but isn't it. TRIF didn't connect. |
| The Keychain refused | This iPhone couldn't keep the connection's key. Try again. |
| The encryption's self-test failed | TRIF's encryption didn't pass its check on this iPhone, so TRIF won't connect. |
| Forgetting | Forget {computer} |
| Under it | Your computer still lists this iPhone until you remove it there. |
| The button at the top | Done |

| This iPhone's name, the field's heading (before pairing; added 11-17, step 14, default 17) | This iPhone's name |
| The field (prefilled, editable) | iPhone |
| Under it | What TRIF on your computer calls this iPhone. |

{computer} is the name in the code until the computer's own `hello` names it ("your computer" if the code has none).

## My computer in More (added 11-17, drafts; the phone link, step 14)

More's engine that hands the request to the person's own coding agent on their computer (PanelChat.swift,
Web/panel-adapter.js). The same lines are in docs/PHONE-LINK-STRINGS.md on branch phone-link.

| Where | New |
|---|---|
| The agent menu | My computer |
| The agent's note, paired | Your coding agent on {computer} makes the mod, inside TRIF's safeguards there. Same Wi-Fi only. |
| The agent's note, not paired | Your coding agent on your computer makes the mod. Same Wi-Fi only. |
| Not paired (the panel's own notice: "My computer isn't logged in. To log in, …") | pair this iPhone with TRIF on your computer: Pair with my computer (a link: opens the pairing screen) |
| Settings, the block's heading | My computer |
| Settings, paired | Paired with {computer}. Its coding agent makes the mod. · My computer… |
| Settings, not paired | Your coding agent on your computer can make mods here. Pair this iPhone with TRIF on your computer first. · Pair with my computer… |
| A request sent before pairing | This iPhone isn't paired with a computer yet: in Settings, choose Pair with my computer. |
| The first step line of a request | Asking {computer}… |
| The link drops in a request (a step line) | Still working on {computer}. Reconnecting… |
| Not found (also a phone removed as the computer's last one: the two can't be told apart) | Can't find {computer}. It may be asleep, on another Wi-Fi, or have no browser with TRIF open. If this iPhone was removed there, pair it again: Pair with my computer. (changed 11-17, draft: the last sentence added) |
| A request the computer kept while TRIF was closed, picked up (a step line; added 11-17, draft) | {computer} finished this while TRIF was closed. |
| The same, still going there (a step line; added 11-17, draft) | Still working on {computer}. |
| Its agent can't work in TRIF's sandbox there (added 11-17, draft) | {computer}'s coding agent can't work inside TRIF's sandbox there, so it can't make mods for this iPhone. Chats in TRIF on the computer still can. |
| Its agent isn't logged in (added 11-17, draft) | {computer}'s coding agent isn't logged in. Log in to it in TRIF on {computer}, then ask again. |
| Lost touch, given up (or no answer in 20 s) | Lost touch with {computer}. It may be asleep, on another Wi-Fi, or have no browser with TRIF open. What it was doing finishes there. |
| Removed there, or its link turned off | This iPhone isn't connected to {computer} any more. Connect it again from TRIF's Settings there: Pair with my computer. |
| Local Network off | TRIF needs Local Network access to find {computer}. Turn it on in Settings, then TRIF Probe, then Local Network. |
| Already working on the site | {computer} is already working on this site. Try again when it's done. |
| No agent there | {computer} has no coding agent set up for TRIF yet. |
| Not a page TRIF makes mods for | TRIF can't make a mod for this page's address. |
| Page too big | This page is too big to send to {computer}. |
| A request the computer no longer has | {computer} doesn't have that request any more. |
| A mod over the size limit | Too big to bring over: {names}. It stays in TRIF on your computer. |
| Anything else | {computer} couldn't start it: {the computer's words} |


## Phone sync in the Mods tab (added 11-17, drafts; phone sync step S7)

Phone mods kept the same here and in TRIF on the paired computer (docs/PHONE-SYNC.md on branch phone-link; the
computer's lines are in docs/PHONE-LINK-STRINGS.md there, "Phone sync"). PhoneLinkView.swift (PhoneSyncModel),
ModsPanel.swift, Web/mods-page.js. The line and Sync now show only while paired; Recently deleted whenever it has
something.

| Where | New |
|---|---|
| The line, while it syncs | Syncing with {computer}… |
| The line, after a sync | Synced with {computer} at {time}: {parts}. (parts, each only when not 0, joined by ", ": "{n} changed here", "{k} waiting for your OK", "{s} sent to {computer}", "{w} waiting for your OK there"; nothing to say: "Synced with {computer} at {time}."; {time} gets the date when it isn't today) |
| The line, before the first sync since TRIF opened | Not synced with {computer} yet. |
| The line, syncing is off on the computer | Not synced: syncing phone mods is off on {computer}. |
| The line, the computer can't be found | Not synced: can't find {computer} right now. TRIF tries again when it's back. |
| The line, this iPhone removed there | Not synced: this iPhone isn't connected to {computer} any more. |
| The line, Local Network off | Not synced: TRIF needs Local Network access to find {computer}. |
| The line, anything else | Not synced with {computer} this time. TRIF tries again. |
| The button | Sync now |
| A notice at the top (until OK), a conflict | {name} changed on both. Both are kept: “{name} (from your computer)” is beside it. |
| A notice, an edit beat a delete | {name} came back: it was changed on {computer}. |
| A notice, a file this iPhone couldn't read | {name} on {computer} has an error, so it isn't on this iPhone yet. |
| A notice, the computer couldn't read this iPhone's | {name} didn't go to {computer}: TRIF there can't read it. |
| A notice, over 1 MB | {name} is too big to sync. |
| The notices' button | OK |
| A mod new from the computer (the row's mark, as an import's "new") | from your computer |
| Its explanation (the mark's tip) | It came from TRIF on your computer, so TRIF switched it off: switch it on once you've looked at it. |
| The list under the mods (folded) | Recently deleted (each row: the name, its site or "every site", Restore) |
| Restore, the mod is gone from the list meanwhile | It isn't in Recently deleted any more. |
| Restore, one with the same name is here | A mod with the same name is here now. Delete or rename it first. |

## Copy diagnostics, point-and-hide taken out, and offers from a chat (changed 11-17, Tim)

| Where | Old | New (drafts for Tim) |
|---|---|---|
| The ⋯ menu at the address bar's left, after Import… (shows without scrolling on an SE) | — | **Copy diagnostics** (the same text as the Mods tab's Send diagnostics…, which stays); the note after: **Copied.** |
| Add a mod from the clipboard, with no whole mod on it | The clipboard has no mod link or selector. | The clipboard has no mod. |
| Add this mod? from a chat | (an old version, a declined or deleted one, offered again when the chat was opened) | no new words: code a chat offered before, an installed mod's earlier version or one in Recently deleted isn't offered again (Add to TRIF under the block still offers it) |

Removed with point-and-hide (Tim, 11-17: a resting thumb set it off; with many nested elements the right layer
can't be picked, and hiding one element is fragile). What it hid stays hidden; each still has **Show again** under
**Hidden by pointing** in the Mods tab (unchanged).

- The long press's bar: **Hide this** · **All {n} like it** · **Wider** · **Cancel** · **Point TRIF at this** ·
  **Everywhere on {site} ({n} here)** · **Hide them**; its error "Couldn't look: {why}".
- The note after hiding: **Hidden: {selector}** with **Undo**.
- The ⋯ menu: **Ask the phone's own model…** (its question "What bothers you on this page?", the field's "the
  cookie notice", **Ask the phone**, Cancel, "The phone's own model gets the page's outline and your words, and picks
  a part. Nothing leaves the phone.", and its notes "Asking the phone's own model…", "The phone's model chose this,
  in {n} ms.", "The phone's model answered "{reply}" ({n} ms), which finds nothing on this page.", "The phone's
  model didn't answer: {why}"), and **Show everything hidden on this site again**.
- The mod link sheet (a /trif-install#hide= or trif: link): Add this mod? · "A mod, from {source}" · "It would hide,
  on {site}" · **Show me first** · **Add it** · **Don't** · "This link carries nothing the probe knows how to add.
  (It reads #hide=selector.)". Such links are now just not followed (a line in the report).
- The Probe menu's test page item **a mod link**.


## Request Desktop Website (added 11-18, Tim: "a desktop mode like safari has")

| Where | Old | New (drafts for Tim: Safari's own words) |
|---|---|---|
| The ⋯ menu at the address bar's left, after Keep TRIF chats in a project…, before Full screen (a website's page only) | — | **Desktop Website** (a computer screen glyph); on a site asked for as a computer's: **Mobile Website** (a phone glyph). APPROVED by Tim 11-18 (was the draft "Request Desktop Website" / "Request Mobile Website") |

No note after it: the page loads again in the other mode, as in Safari. The choice is the site's, in every tab, kept
across launches (Safari's per-website setting).

## The toolbar's buttons tapped again (changed 11-18, Tim: "re-tapped on the tabs menu, it should bring you back")

No new words. The tabs button and the Mods switch, tapped again while their screen is open, close it: back to the
page as it was. The [+], tapped again on the new tab's address screen before anything was opened there, closes that
empty tab and goes back to the tab it came from. Since 11-18 (Tim, "like Safari") the address screen's **Cancel**
does the same for any empty new tab (the toolbar's +, ⋯ → New tab, the tabs' +, a pull); never the last tab (it
stays, with its start page).

## Chats and their tabs, both ways (added 11-18, Tim: "the site is lost in the tabs")

All drafts for Tim. {Service} is Claude or ChatGPT, as the app already names them; {site} the chat's site
(facebook.com).

| Where | Old | New (drafts for Tim) |
|---|---|---|
| The done banner (slides down over the tab, the tab list, Mods or another chat when a chat not being looked at finishes a reply), with one mod | — | **{Service} made a mod for {site}** · **Add** · **Go to {site}** |
| The same, with several mods | — | **{Service} made {n} mods for {site}** · **Add** · **Go to {site}** |
| The same, a reply with no mod | — | **{Service} replied about {site}** (no site: **{Service} replied**) · **Open chat** · **Go to {site}** |
| The banner's ✕ (VoiceOver) | — | **Close** |
| The banner's words (VoiceOver; Tim 11-18: a tap anywhere on the banner, outside its buttons, opens the chat) | — | hint **Opens the chat** (the chats' list rows' hint), read as a button |
| The chat's top bar, under the Claude · ChatGPT · More switch | — | **← {site}** (VoiceOver: **Go to {site}**) |
| The note after a mod is added on another tab than its chat's site | Added {name}. It runs on {sites}. | Added {name}. It runs on {sites}. **Go to {site}** |
| The tab list: a tab's robot badge (VoiceOver) | — | **Chat, working** · **Chat, reply waiting** · **Chat** |
| The robot's long press: the chats' list | — | title **Chats**, **Done**; each row: {site}, the tab's title, **{Service} · Working…** / **Reply waiting** / **Mod added** / **Read**; its arrow (VoiceOver **Go to {site}**); VoiceOver hint on a row **Opens the chat** |
| The same, empty | — | **No chats yet. Tap the robot on a page to start one.** |
| The toolbar robot's VoiceOver action | — | **Chats** |


## Quick ask (added 11-18, Tim: "stay on the page, long-press, say or type what to change")

All drafts for Tim. {Service} is Claude or ChatGPT, as the app already names them.

| Where | Old | New (drafts for Tim) |
|---|---|---|
| The robot's long press: the chats' list, its top | — | the box's placeholder **What should change?**; its send arrow (VoiceOver **Ask**); the microphone (VoiceOver **Hold to talk**, hint **Hold, say what should change, then let go**) |
| While the microphone is held: the glowing pill | — | **Listening…**, then the words as they're heard (VoiceOver **Listening** / **Heard: {words}**) |
| Under the box, the first time the microphone is held (iOS's two questions up) | — | **Allow TRIF to hear you, then hold the microphone and speak.** |
| Under the box, the microphone or speech recognition refused (the box still takes typing) | — | **TRIF can't hear you: allow the Microphone and Speech Recognition for TRIF Probe in Settings. You can still type.** |
| Under the box, where this iPhone can't recognise speech itself (TRIF never sends audio to a server) | — | **This iPhone can't recognise speech in {language} by itself, so TRIF doesn't listen. Type instead, or use the keyboard's dictation.** |
| Under the box, rarer | — | **Speech recognition isn't available right now. Type instead.** · **The microphone can't be used right now. Type instead.** · **This iPhone has no microphone to use. Type instead.** |
| The strip (Claude's or ChatGPT's own message box and Send, over the tab), its header | — | **Check it, then tap Send in {Service}**; its buttons (VoiceOver) **Open the whole chat** · **Cancel** |
| The pill above the toolbar | — | **Working: {request}…** (the request cut at about 36 characters) |
| The same, a look-only mod added | — | **Done · Undo** (then **Undone**) |
| The same, a reply with no mod | — | **Replied: {request}** |
| The same, not sent (More) | — | **Open a website first, then ask.** · **Still working on this site. Ask again when it's done.** · **More can't ask yet: open the chat to set it up.** · **Not done: open the chat to see why.** |
| The pill (VoiceOver) | — | hint **Opens the chat**; action **Close** |

No new words for mods that can click, send or load: they get Add this mod? or the approval card, as ever (through
the done banner when the person is on another tab).
