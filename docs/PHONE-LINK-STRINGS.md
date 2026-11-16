# Phone link: the new strings (branch phone-link)

Every string people see that this branch adds, exact, for Tim's OK. **None is approved yet**: they are drafts,
used meanwhile. `{computer}`, `{phone}` and the like are filled in. How it works: docs/PHONE-LINK.md.

Nothing is built that shows these yet (round 1 wrote the design; round 2's store only makes three error texts). Each round adds the strings its step shows.

## Desktop: Settings in the side panel (not built)

| Where | String | Notes |
|---|---|---|
| The section's name | Connect a phone | |
| The line under it, link off | TRIF on your iPhone can ask your coding agent on this computer to make phone mods, over your Wi-Fi. Off until you connect a phone. | |
| The button | Connect a phone | opens the pairing window and shows the QR code |
| Over the QR code | Scan this with TRIF on your iPhone: More, then My computer. | |
| Under it | Good for 5 minutes, for one phone. | |
| A paired phone's row | {phone} · connected {date} | |
| Its button | Remove | |
| After Remove | {phone} can't reach this computer any more. | |
| The switch | Let connected phones reach this computer | off: no listener; the phones stay listed |
| Turning on fails: no keyring (Linux without one; not the Mac) | the phone link needs a system keyring to keep this computer's key in (the macOS Keychain, or a Secret Service on Linux) | built in round 2 (`store.js`); the panel that shows it isn't |
| Turning on fails: the keyring refused | couldn't keep this computer's phone link key: {what the keyring said} | the same; the second half is `keyring.js`'s existing text. Both as the helper's other errors are written (the panel puts them in its own sentence, step 9) |
| Turning on fails: the keyring can't be read just now (locked) | couldn't read this computer's phone link key: {what the keyring said} | the same; nothing changes (no new key, the phones stay) |

## iPhone: More (not built; needs branch ios-poc)

| Where | String | Notes |
|---|---|---|
| The engine's name | My computer | beside the API engines and On this iPhone |
| Before pairing | Your coding agent on your computer makes the mod. In TRIF on your computer, open Settings, choose Connect a phone, and scan the code. | |
| The button | Scan the code | |
| Local Network permission (Info.plist) | TRIF looks for your computer on your Wi-Fi when you choose My computer. | |
| Camera permission (Info.plist) | TRIF uses the camera to scan the code your computer shows. | |
| Not found | Can't find {computer}. It may be asleep, on another Wi-Fi, or have no browser with TRIF open. | one state for both causes: see "For Tim" in the progress file |
| Removed | This iPhone isn't connected to {computer} any more. Connect it again from TRIF's Settings there. | |
| The link drops in a run | Still working on {computer}. | |
| A run kept from before | {computer} finished this while TRIF was closed. | |
