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
| Tab switcher, a tab never pictured yet (rare now: every tab's picture is kept between launches) | its site's letter | its site's letter, and the site under it (no new words) |
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
| A visit's long-press menu | Open in a new tab · Copy address |
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
TRIF follow-up (one that has them), TRIF screenshot, TRIF pointer.

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
| Camera | Websites you visit can ask to use the camera, for a photo or a video call. |
| Microphone | Websites you visit can ask to use the microphone, for a voice or video call. |
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

## Home Screen icons (added 11-16; the sheet's steps changed 11-16, Tim)

| Where | Old | New |
|---|---|---|
| The ⋯ menu | — | Add to Home Screen (greyed on a page that isn't a website) |
| The sheet's title | — | Add to Home Screen |
| Its top-left button | — | Cancel; once started: Done (top right) |
| The sheet's name field (placeholder) | — | Name (filled in with the site's own short name, e.g. X) |
| Steps, the Safari route (shown before anything happens; the step they're on marked) | — | 1. Safari opens and asks to download a profile: tap Allow. · 2. Open the Settings app and tap Profile Downloaded near the top (or General → VPN & Device Management). · 3. Tap Install, enter your passcode, then Install again. · 4. The icon appears on your Home Screen. |
| Steps, the Files route | — | 1. Choose where to save the file (On My iPhone is fine), then tap Save. · 2. Open the Files app and tap “{Name} for TRIF”. · then Settings' three steps as above |
| Why (always shown) | — | iOS only lets an icon that opens an app be added this way, with a small profile. It adds just this one icon, and you can remove it in Settings → General → VPN & Device Management. |
| Once started (Safari route) | — | A downloaded profile waits about 8 minutes. If it's gone from Settings, tap Download it again here. |
| Once started (Files route) | — | A profile waits about 8 minutes in Settings. If it's gone, tap the file in Files again. |
| Where they are (a line over the steps) | — | Opening Safari… · Safari is open: tap Allow there, then come back here. · Safari downloaded it: next, Settings. · If Safari asked and you tapped Allow: next, Settings. · Saved to Files: next, open the Files app and tap it. · Done: the icon is on your Home Screen. (TRIF was opened from the new icon) |
| When Safari didn't get it | — | Safari didn't get the icon. Save it to Files instead. · {Chrome} opened instead of Safari, and only Safari can add the icon. Save it to Files instead. |
| Buttons | — | Add to Home Screen; then Download it again · Save to Files instead (after a start, or when Safari didn't get it) · Files route: Save to Files, then Save it again · Use Safari instead |
| If the page's icon and name couldn't be read | — | Couldn't make the icon for this page. |
| The profile in Settings (name) | — | {Name} for TRIF (the publisher line shows TRIF) |
| The profile in Settings (description) | — | Adds {a/an} {Name} icon to your Home Screen that opens {Name} in TRIF. |
| The icon's label on the Home Screen | — | {Name}, as typed in the sheet |

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
