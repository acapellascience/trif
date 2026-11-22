# Phone link: the new strings (branch phone-link)

Every string people see that this branch adds, exact, for Tim's OK. **None is approved yet**: they are drafts,
used meanwhile. `{computer}`, `{phone}` and the like are filled in. How it works: docs/PHONE-LINK.md.

The desktop's section is built (round 9). Nothing on the iPhone shows its strings yet. Helper-made error texts: round 2's store makes three; round 5's remote run makes short ones for a bad page address, a missing page copy and things too big, which the app turns into its own words; round 6's `remote.js` adds four more of that kind, for `busy`, `no-agent`, `no-run` and a run that is still working, also the app's to put in its own words by their codes. Each round adds the strings its step shows.

## Desktop: Settings in the side panel (built in round 9: extension/phonelink.js)

The section is at the end of Settings (it scrolls with them), shown when the helper has the phone link.
`tests/phone-link-panel.test.js` checks that every string the panel shows (`TEXT` in phonelink.js) is in this
table, so a change here needs the same change there. The first three rows are the section's three layers
(label, line, explanation behind the "i"), as TRIF's other terms have them; they live in phonelink.js until
approved, then can move into extension/explain.json so that `trif explain` knows them too.

| Where | String | Notes |
|---|---|---|
| The section's name (the label) | Connect a phone | |
| The line under it | Your iPhone asks this computer's agent for mods. | new in round 9 (draft): the 6 to 9 word line. Always shown, on or off |
| Behind the line's "i" (the explanation; "more" shows what follows the line) | Your iPhone asks this computer's agent for mods. TRIF on your iPhone sends the page you're on to your coding agent here, over your Wi-Fi, and gets a phone mod back to approve there. The agent works inside TRIF's sandbox, as in this chat, and writes phone mods only. Nothing here answers the network until you connect a phone. | new in round 9 (draft). It replaces round 1's draft for the line under the name: "TRIF on your iPhone can ask your coding agent on this computer to make phone mods, over your Wi-Fi. Off until you connect a phone." |
| The button | Connect a phone | turns the link on if it was off, opens the pairing window and shows the QR code |
| Over the QR code | Scan this with TRIF on your iPhone: More, then My computer. | |
| Under it | Good for 5 minutes, for one phone. | |
| The button under the code | Cancel | new in round 9 (draft): closes the pairing window. Closing Settings or the panel does the same |
| The QR code's name for a screen reader | The code to scan | new in round 9 (draft) |
| A paired phone's row | {phone} · connected {date} | the date as "Nov 16" (the year added when it isn't this one) |
| Its button | Remove | |
| After Remove | {phone} can't reach this computer any more. | |
| After a phone scanned the code | {phone} is connected. | new in round 9 (draft) |
| The switch | Let connected phones reach this computer | off: no listener; the phones stay listed. Shown once the link is on or a phone is listed |
| Turning on fails: no keyring (Linux without one; not the Mac) | the phone link needs a system keyring to keep this computer's key in (the macOS Keychain, or a Secret Service on Linux) | built in round 2 (`store.js`). The panel shows the helper's words as a sentence (a capital, a full stop), in red under the section: so for the next two rows and the last |
| Turning on fails: the keyring refused | couldn't keep this computer's phone link key: {what the keyring said} | the same; the second half is `keyring.js`'s existing text |
| Turning on fails: the keyring can't be read just now (locked) | couldn't read this computer's phone link key: {what the keyring said} | the same; nothing changes (no new key, the phones stay) |
| Instead of the button, in a browser whose TRIF doesn't have the link (`here: false`: another browser's does) | Another browser's TRIF is handling phones just now. Connect a phone from there. | round 8 (draft). Since 11-18 every browser's panel reaches the link through the helper that has it (helper/lib/phonelink/relay.js), so this shows only when that helper can't relay (one from before the relay) and doesn't say its browser. The helper's own error for a `phone.pair.start` there is agent-style text, not shown |
| The same, when that browser's name is known | TRIF in {browser} is handling phones: connect from there, or quit {browser}. | new 11-18 (draft, Tim's brief): {browser} as that browser's TRIF says it ("Firefox") |
| Under the section, when the link is on and the phone can't find the computer (`announce`: `missing` or `failing`) | Your phone may not find this computer just now. | round 8 (draft); `unsupported` (not a Mac) shouldn't be reachable in version 1 |
| Connect a phone fails: no port could be opened | This computer couldn't open a port for the phone to reach. | round 8 (draft; the helper's words, as a sentence) |
| Connect a phone fails: the computer's name makes the code's text longer than the code holds (about 270 bytes; a name of some 30 emoji) | This computer's name is too long for the code. Shorten it in System Settings, then try again. | new in round 9 (draft); the pairing window is closed again. Since round 11 the helper cuts a long name in the code (whole characters, then "…"), so this line is a backstop the user shouldn't meet: Tim may drop it |

## Desktop: the phone menu and the phone line (11-18, drafts: extension/sidepanel.js, phonelink.js `phoneSyncView`)

The bar's phone button opens a small menu; the phone line is under the phone view's banner, and under the bar
after the menu's Sync with phone (with a × to close it there). Its words are in phonelink.js `TEXT`, so the
test above checks them here too; the menu's are in sidepanel.js `PHONE_MENU`.

| Where | String | Notes |
|---|---|---|
| The phone button's tooltip and name for a screen reader | Phone view and sync with phone | it opens the menu |
| The menu's first item | Switch to phone view | Tim's words. What the button did before (the old tooltip was "Edit for mobile") |
| The same, in the phone view | Back to desktop | as the banner's link |
| The menu's second item | Sync with phone | Tim's words. No phone paired: Settings open at Connect a phone, with the code on screen. Paired: Sync now, and the phone line shows how it went |
| The phone line, no phone paired (phone view only) | Connect a phone | a link: Settings open with the code, as the menu's item |
| The phone line, paired | Syncing with {phone}. · Sync now | {phone}: its name; two: "{phone} and {other}"; more: "{phone} and {n} more" |
| Two phones, three or more | {phone} and {other} · {phone} and {n} more | |
| After Sync now | Asking {phone} to sync… | until that sync ends (the phone starts every sync: it's told to, PHONE-SYNC.md section 8) |
| What it did | Synced with {phone}: {n} from the phone, {m} to it. · Synced with {phone}: {n} from the phone, {m} to it, {k} waiting for your OK. · Phone settings | the link opens Settings at Connect a phone |
| No phone connected just now (or no sync within 30 s) | {phone} isn't connected just now. It syncs when TRIF is open on it. · Sync now · Phone settings | |
| Syncing turned off in Settings | Syncing with {phone} is off. · Phone settings | |
| The phone view's navigation bar | Back · Forward · Reload · Address or search | the buttons' names and the field's placeholder. Not an address: searched on Google, Safari's default on an iPhone. **Since 11-18 (branch phone-view2) only in the popup route** (a browser without a side panel, as Arc): the phone view's ordinary window has the browser's own address bar |
| The phone line in the phone view, once a phone has synced (new 11-18, draft) | Syncing with {phone} · last synced {ago}. · Sync now | {ago}: "just now" (under a minute), "{n} min ago" (under an hour), else "at {time}" ("at 2:05 PM"). Before any sync since the helper started: "Syncing with {phone}." as before |
| The same, its {ago} | just now · {n} min ago · at {time} | new 11-18 (draft) |

## Desktop: a sync done, and the phone view's window (11-18, branch phone-view2, drafts)

Tim, 11-18: "it should have some kind of visible 'successfully synced' message"; 11-19: "they happen every time you
hit a switch … either way they're just noise". Every open TRIF panel (the side panel, the phone view's, a panel
window) shows a toast for a few seconds when a sync started on this computer ends (Sync now, the 📱 menu's Sync with
phone); not when the phone line under the bar already says what that sync did (after Sync now there). A sync the
phone starts (it comes to the front, a switch, a change, its own Sync now) shows no toast, even when it moved mods:
the phone view's line and Settings' Synced row still say when it last synced. A click on the toast closes it. The toast's words are in phonelink.js `TEXT`; the phone
view's are in sidepanel.js `PHONE_VIEW_TEXT`.

| Where | String | Notes |
|---|---|---|
| The toast, after a sync started here that moved something | Synced with {phone} · {n} from the phone, {m} to it | {phone} as the phone line's (two: "{phone} and {other}"). No full stop: it's a passing line |
| The same, with mods waiting for an OK | Synced with {phone} · {n} from the phone, {m} to it, {k} waiting for your OK | |
| The same, nothing moved (11-19: no toast at all after a sync the phone started) | Synced with {phone} · nothing new | |
| The phone view just opened without TRIF's panel beside it (Firefox always; Chrome if the side panel couldn't open): in the panel the phone view was opened from, with a × | The phone view is in a window of its own. Click TRIF's button there to open TRIF beside the phone. | until TRIF's panel is open in the phone window, or the phone view ends. Firefox can't open its sidebar in another window from a click in this one (sidebarAction.open has no window, and only works inside the click itself) |
| The phone view's banner, when the page is wider than the phone's because the browser won't make the window narrower | This page is {w} px wide, wider than an iPhone's 390. Make this panel wider (drag its edge) and the page narrows to fit. | APPROVED by Tim 11-22 (his B). {w}: the page's width in CSS px. Chrome keeps a window with its side panel open at 792 px or wider (headless 156 and Tim's), so a 406 px page; dragging the panel wider works (Tim 11-22) and TRIF then grows the window on the page's side. Not shown at 390 (± 2) |
| The popup route's address field, when going there failed (a toast) | Couldn't go there: {error} | {error}: the browser's words, as they come. Before 11-18 the failure went to the console only |

## iPhone: More and My computer (pairing built in round 15 on ios-poc, 85166ad; the engine in More in round 16, step 14)

The pairing screen, PhoneLinkView.swift on ios-poc: from More (Settings' My computer block, and the engine's
notices; the ⋯ menu's "My computer…" is gone since round 16) and from a `trif://pair` link (iOS's Camera app
scanning the code). The same lines are in ios-poc's
docs/IOS-APP-STRINGS.md ("My computer").

| Where | String | Notes |
|---|---|---|
| The engine's name | My computer | beside the API engines and On this iPhone; also the pairing screen's title (the ⋯ menu's "My computer…" removed, round 16) |
| This iPhone's name, before pairing | This iPhone's name · (the field, prefilled) iPhone · What TRIF on your computer calls this iPhone. | new round 16 (draft): "For Tim" 17. What the computer lists the phone as |
| The agent's note | paired: Your coding agent on {computer} makes the mod, inside TRIF's safeguards there. Same Wi-Fi only. · not paired: Your coding agent on your computer makes the mod. Same Wi-Fi only. | new round 16 (draft) |
| Not paired (the panel's own "My computer isn't logged in. To log in, …") | pair this iPhone with TRIF on your computer: Pair with my computer | new round 16 (draft); the words after the colon are a link to the pairing screen |
| More's Settings block | My computer · paired: Paired with {computer}. Its coding agent makes the mod. · My computer… · not paired: Your coding agent on your computer can make mods here. Pair this iPhone with TRIF on your computer first. · Pair with my computer… | new round 16 (draft) |
| A request sent before pairing | This iPhone isn't paired with a computer yet: in Settings, choose Pair with my computer. | new round 16 (draft) |
| The first step line of a request | Asking {computer}… | new round 16 (draft) |
| Lost touch, given up | Lost touch with {computer}. It may be asleep, on another Wi-Fi, or have no browser with TRIF open. What it was doing finishes there. | new round 16 (draft): after the reconnection's waits (about 90 s of the app in front) |
| The computer's errors in the chat | {computer} is already working on this site. Try again when it's done. · {computer} has no coding agent set up for TRIF yet. · TRIF can't make a mod for this page's address. · This page is too big to send to {computer}. · {computer} doesn't have that request any more. · Too big to bring over: {names}. It stays in TRIF on your computer. · {computer} couldn't start it: {the computer's words} | new round 16 (drafts): `busy`, `no-agent`, `bad-url`, `too-big`, `no-run`, a mod over 1 MB, anything else |
| Before pairing | Your coding agent on your computer makes the mod. In TRIF on your computer, open Settings, choose Connect a phone, and scan the code. | built round 15 |
| The button | Scan the code | built round 15; once paired: "Scan a new code" |
| Local Network permission (Info.plist) | TRIF looks for your computer on your Wi-Fi when you choose My computer. | built round 15 |
| Camera permission (Info.plist) | To scan the code TRIF shows on your computer. Websites you visit can also ask to use the camera, for a photo or a video call. | built round 15. One key serves both uses: the app already asked with "Websites you visit can ask to use the camera, for a photo or a video call." (11-16); round 1's draft here was "TRIF uses the camera to scan the code your computer shows." |
| Under the camera | Scan the code in TRIF's Settings on your computer: Connect a phone. | new round 15 (draft) |
| The camera, for a screen reader | The camera, to scan the code | new round 15 (draft) |
| A code that isn't TRIF's | That isn't a code from TRIF on your computer. | new round 15 (draft) |
| No camera | This iPhone has no camera to scan with. | new round 15 (draft) |
| Camera access off | TRIF can't use the camera. Turn it on in Settings, then TRIF Probe, then Camera. · Open Settings | new round 15 (draft); "TRIF Probe" is the app's name for now |
| Looking | Looking for {computer} on your Wi-Fi… | new round 15 (draft) |
| Connecting | Connecting to {computer}… | new round 15 (draft) |
| Paired | Connected to {computer}. | new round 15 (draft) |
| Paired, later | Connected to {computer} since {date}. | new round 15 (draft) |
| The code was used, cancelled or is over 5 minutes old (closed with no answer while pairing) | That code didn't work: it may have been used already or be more than 5 minutes old. Show a new one on {computer} and scan it again. | new round 15 (draft) |
| Local Network access off | TRIF needs Local Network access to find {computer}. Turn it on in Settings, then TRIF Probe, then Local Network. · Open Settings | new round 15 (draft) |
| An answer that doesn't decrypt | Something on your Wi-Fi answered as {computer} but isn't it. TRIF didn't connect. | new round 15 (draft) |
| The Keychain refused | This iPhone couldn't keep the connection's key. Try again. | new round 15 (draft) |
| The encryption's self-test failed | TRIF's encryption didn't pass its check on this iPhone, so TRIF won't connect. | new round 15 (draft) |
| Forgetting on the phone | Forget {computer} | new round 15 (draft) |
| Under it | Your computer still lists this iPhone until you remove it there. | new round 15 (draft) |
| Not found | Can't find {computer}. It may be asleep, on another Wi-Fi, or have no browser with TRIF open. If this iPhone was removed there, pair it again: Pair with my computer. | **changed round 17 (draft, for Tim):** was the same without its last sentence. A phone removed as the computer's last one can't be told from "not found" (with no phone paired the computer stops listening), so the line covers both; "Pair with my computer" is a link to the pairing screen. One state for asleep and no browser too: see "For Tim" in the progress file |
| Removed | This iPhone isn't connected to {computer} any more. Connect it again from TRIF's Settings there. | built round 16, followed by ": Pair with my computer" (a link) |
| The link drops in a run | Still working on {computer}. | built round 16 as a step line, with " Reconnecting…" after it |
| A run kept from before | {computer} finished this while TRIF was closed. | built round 17: a step line at the top of what the computer kept, then its steps and the result (Add this mod?) |
| A run kept from before that is still going | Still working on {computer}. | new round 17 (draft): the line above's twin when the app opens again before the computer has finished (the drop's line without " Reconnecting…") |
| The computer's agent can't run inside TRIF's sandbox (an organization's settings replace it) | {computer}'s coding agent can't work inside TRIF's sandbox there, so it can't make mods for this iPhone. Chats in TRIF on the computer still can. | round 5: a phone run never goes on without the sandbox, even if that was allowed on the computer (the progress file, "For Tim" 6). Built round 17, in place of the computer's own words |
| The computer's agent isn't logged in | {computer}'s coding agent isn't logged in. Log in to it in TRIF on {computer}, then ask again. | new round 17 (draft), in place of the computer's own words (which name the agent) |
| A run was going when the browser on the computer closed (a line in the chat, as the run's other errors are) | TRIF on the computer stopped before the agent finished | round 6 (`remote.js`): said when the next helper reads the kept run. The desktop's own text for the same moment is "the helper shut down (Chrome closed?) before the agent finished" |

## Phone sync (docs/PHONE-SYNC.md; drafts from sync round 1; the desktop's built in sync round 3, extension/phonelink.js and sidepanel.js)

Phone mods kept the same on the iPhone and the computer. The phone's rows go into docs/IOS-APP-STRINGS.md on
ios-poc when the iPhone steps build them.

| Where | String | Notes |
|---|---|---|
| Desktop, Settings → Connect a phone, the switch under the link's (D11: on for a paired phone, the user can turn it off) | Keep phone mods the same here and on connected phones | draft, round 3. Shown while the link is on |
| Desktop, Settings → Connect a phone, under a phone, while syncing is on | Synced {time}: {n} from this phone, {k} waiting for your OK. | draft. When k is 0: "Synced {time}: {n} from this phone." Nothing synced since the helper started: "Not synced yet." |
| Desktop, the hold card of a mod a sync brought | From {phone}. | draft, in place of "It's new or changed since TRIF last let it run." (the generic reason for a change from outside) |
| Desktop, a mod's History, a version kept before a sync replaced it | before a sync from your phone | draft, as the other sources' ("before an import replaced it") |
| Desktop, the sync line, a conflict | {name} changed on both: both are kept. | draft |
| Phone, Mods tab, after a sync that changed something | Synced with {computer}: {n} changed here, {k} waiting for your OK. | draft |
| Phone, a conflict | {name} changed on both. Both are kept: “{name} (from your computer)” is beside it. | draft. The sibling's own name: "{name} (from your computer)" |
| Phone, an edit beat a delete | {name} came back: it was changed on {computer}. | draft |
| Computer, the same | {name} came back: it was changed on {phone}. | draft |
| Phone, a mod new from the computer (the mark, as an import's "New") | From your computer | draft |
| Phone, a file the app couldn't read | {name} on {computer} has an error, so it isn't on this iPhone yet. | draft |
| Phone, a mod too big to sync (over 1 MB) | {name} is too big to sync. | draft |
| Phone, Mods tab button | Sync now | draft |
| Phone, Mods tab, the deleted list | Recently deleted | draft. Each row: the name, "Restore" |
| Phone, every-site mods if the computer can't take them (D10) | (dropped 11-18) | every-site mods sync since 11-18 (D10): never shown |
| Desktop, the hold card of a mod a sync brought, when that phone allowed this very version (the approval hint, D13) | You allowed this on {phone}. | draft (Tim, 11-18: "You allowed this on {your iPhone}"), in place of "From {phone}."; {phone} is the name it was paired under. The card's Allow is the same Allow: one tap. Only when the code is the very revision allowed there and asks for nothing beyond it; else "From {phone}." |
| Phone, the approval card of a synced mod, when the computer allowed this very version (D13) | You allowed this on {computer}. | draft (Tim, 11-18: "You allowed this on {your Mac}"), in place of "It's new or changed since TRIF last let it run."; {computer} is the paired computer's name. Same conditions; Allow is the same Allow |
| Phone, a mod new from the computer that arrives switched on (D8 as changed 11-18) | From your computer | the same mark as before, now shown on such a mod while it's on too, until its switch is first tapped here |

## Desktop: renaming a mod (11-18, drafts: extension/sidepanel.js `nameRow`, helper/lib/rename.js; docs/PHONE-SYNC.md 2a)

The code card's Details tab, first line: the mod's name with Rename. The iPhone's words: docs/IOS-APP-STRINGS.md on ios-poc.

| Where | Text | Notes |
|---|---|---|
| Details, the first line's label | Name | draft; the name follows in bold |
| Details, the button after the name | Rename | draft; opens a text field with the name in it |
| The field's buttons | Save · Cancel | the code card's own words for its Edit |
| Rename's tooltip, the helper not connected | TRIF's helper isn't connected, so it can't rename the file | as the code card's other buttons' ("…, so it can't open the file") |
| Saved with no name | Give it a name. | draft |
| The helper refuses (the name) | A name can't be empty · A name is one line · A name can be up to 80 characters | draft (helper/lib/rename.js, from modid.js checkName) |
| The helper refuses (the file) | there's no mod {id} · {id} isn't a plain file: rename it where it is · {id} has no ==WebMod== header to keep a name in | agent-ish, shown as is; draft |
| Phone sync, two different mods with one name (D17 "apart") | (the computer's) “{name} (from your computer)” | the conflict copy's existing name, reused; the phone's notice is in IOS-APP-STRINGS.md |

## The update card's Not now (11-20, APPROVED by Tim 11-20)

- **Not now**: a button on "TRIF {version} is available", after What's new. It puts that version's card away
  (kept in chrome.storage.local `updateLater`); a newer version brings the card back, and Settings' update line
  still says the version is available. Tim, 11-20: "how does a person get rid of that box if they don't want to
  install the update right now". - The notes toggle: **What's new** / **Hide what's new** (was "Hide"; APPROVED by Tim 11-20).
