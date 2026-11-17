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
| Instead of the button, in a browser whose TRIF doesn't have the link (`here: false`: another browser's does) | Another browser's TRIF is handling phones just now. Connect a phone from there. | round 8 (draft). The helper's own error for a `phone.pair.start` there is agent-style text, not shown |
| Under the section, when the link is on and the phone can't find the computer (`announce`: `missing` or `failing`) | Your phone may not find this computer just now. | round 8 (draft); `unsupported` (not a Mac) shouldn't be reachable in version 1 |
| Connect a phone fails: no port could be opened | This computer couldn't open a port for the phone to reach. | round 8 (draft; the helper's words, as a sentence) |
| Connect a phone fails: the computer's name makes the code's text longer than the code holds (about 270 bytes; a name of some 30 emoji) | This computer's name is too long for the code. Shorten it in System Settings, then try again. | new in round 9 (draft); the pairing window is closed again. Since round 11 the helper cuts a long name in the code (whole characters, then "…"), so this line is a backstop the user shouldn't meet: Tim may drop it |

## iPhone: More and My computer (pairing built in round 15 on ios-poc, 85166ad; the engine in More is step 14)

The pairing screen, PhoneLinkView.swift on ios-poc: for now from the app's ⋯ menu and from a `trif://pair` link
(iOS's Camera app scanning the code); step 14 opens it from More. The same lines are in ios-poc's
docs/IOS-APP-STRINGS.md ("My computer").

| Where | String | Notes |
|---|---|---|
| The engine's name | My computer | beside the API engines and On this iPhone; also the pairing screen's title and, for now, the ⋯ menu's "My computer…" |
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
| Not found | Can't find {computer}. It may be asleep, on another Wi-Fi, or have no browser with TRIF open. | one state for both causes: see "For Tim" in the progress file |
| Removed | This iPhone isn't connected to {computer} any more. Connect it again from TRIF's Settings there. | |
| The link drops in a run | Still working on {computer}. | |
| A run kept from before | {computer} finished this while TRIF was closed. | |
| The computer's agent can't run inside TRIF's sandbox (an organization's settings replace it) | {computer}'s coding agent can't work inside TRIF's sandbox there, so it can't make mods for this iPhone. Chats in TRIF on the computer still can. | round 5: a phone run never goes on without the sandbox, even if that was allowed on the computer (the progress file, "For Tim" 6) |
| A run was going when the browser on the computer closed (a line in the chat, as the run's other errors are) | TRIF on the computer stopped before the agent finished | round 6 (`remote.js`): said when the next helper reads the kept run. The desktop's own text for the same moment is "the helper shut down (Chrome closed?) before the agent finished" |
