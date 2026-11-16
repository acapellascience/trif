# Phone link: progress

The loop's file: read this first, every round. The design: docs/PHONE-LINK.md. Strings: docs/PHONE-LINK-STRINGS.md.
Branch `phone-link` (worktree ~/WebMods-worktrees/phone-link). iPhone work is on `ios-poc` and only when the
round's brief says it is free.

## Checklist

Computer side:
- [x] 1. Design and wire protocol (docs/PHONE-LINK.md), the strings file
- [x] 2. `helper/lib/phonelink/noise.js` (Noise IK, ciphers) and `frames.js` (packets, pieces), unit tests with
      the published vector
- [ ] 3. `store.js`: the computer's key (keyring, service `TRIF phone link`), `<private>/phone-link.json`
      (on/off, port, paired phones), the pairing window (secret, 5 minutes, 5 tries, one phone), remove. Unit tests
      with `tests/fake-keychain.js`
- [ ] 4. `server.js`: the listener (none while off; silent refusal of unpaired, removed, garbage, late), sessions,
      `hello`/`ping`. Tests on 127.0.0.1, a random port
- [ ] 5. `bonjour.js`: `dns-sd -R` while the listener is up (a stand-in binary in tests, `TRIF_DNS_SD`)
- [ ] 6. Remote runs: `remote.js` and the `remote` mark in `runs.js` (site forced to `phone~<host>`, page copy and
      screenshot into the run's screenshots folder, context, page commands refused), events numbered, kept
      results, `run.resume`/`run.ack`, `run.result`
- [ ] 7. `trif phone page|try|screenshot` (cli.js, the mailbox, `tool.request` round trip), AGENTS.md
- [ ] 8. `host.js`: the helper that owns `helper.sock` owns the link; `phone.*` as `PANEL_COMMANDS`
- [ ] 9. Desktop panel: Connect a phone (QR encoder in the extension, the list, Remove, the switch), strings
- [ ] 10. End to end: `tests/phone-link-client.js` (a stand-in phone) against the real helper in a temp HOME, the
      stand-in model: pair, run, try on the phone, result, drop and resume, remove
- [ ] 11. Pointers in docs/PROTOCOL.md and docs/SECURITY.md

iPhone side (needs ios-poc free):
- [ ] 12. `PhoneLink.swift`: Noise IK in CryptoKit (the same published vector as a self-test), frames, NWBrowser
- [ ] 13. QR scan, pairing, the computer's key and the phone's key in the Keychain; Info.plist (Local Network,
      Bonjour service, camera)
- [ ] 14. "My computer" engine in More: `run.start` with the page copy and screenshot, events as `agentEvent`s,
      `tool.request` → read_page / try_mod / screenshot, resume after suspension
- [ ] 15. The result to Add this mod? / the approval card; the states of PHONE-LINK.md section 8
- [ ] 16. Simulator proof against the helper in a temp HOME

## Done this round (round 1, 2026-11-16)

- Surveyed runs.js, scope.js, host.js, keyring.js, tophone.js and (read only) ios-poc's More chat. Wrote
  docs/PHONE-LINK.md (design, security rules, wire protocol, states, proof) and docs/PHONE-LINK-STRINGS.md (drafts).
- Built step 2: `helper/lib/phonelink/noise.js` and `frames.js`, Node's crypto only. `tests/phone-link-noise.test.js`:
  18 tests pass locally, among them the published cacophony vector for `Noise_IK_25519_ChaChaPoly_SHA256`
  (handshake bytes, handshake hash and four transport messages match), RFC 7748's X25519 example, every flipped
  byte of message 1 refused, replay, wrong key, wrong prologue, frames up to a screenshot's size and the limits.
- CI green for c8898a4 (the whole suite on macOS): https://github.com/acapellascience/trif/actions/runs/43959884729

## CI

- Round 1, c8898a4: success, https://github.com/acapellascience/trif/actions/runs/43959884729 (the commit after it only edits this file)

## Next step

Step 3: `helper/lib/phonelink/store.js` with its unit tests. The key pair made on first turn-on (private key
through `keyring.js` setKey/getKey with `{service: 'TRIF phone link'}`, account `computer`, stored as base64url:
check it against `KEY_RE`), `<private>/phone-link.json` written whole with mode 600 (write a temp file, rename),
`pairStart()` → `{secret, qr, expires}`, `pairTry(phoneKey, secret, name)` (constant-time compare with
`crypto.timingSafeEqual`, 5 minutes, 5 wrong tries close the window, the window closes on success), `isPaired(key)`,
`remove(id)`, `list()`. No network in this step.

## Notes for next round

- Tests: `node --test tests/phone-link-noise.test.js` (half a second). The whole suite is `npm test`; the browser
  tests need `TRIF_BROWSER_TESTS=1` and are CI's job (don't run them locally without the lock and the watchdog).
- `noise.js` API: `new Handshake({initiator, s: {publicKey, privateKey}, rs, prologue, e})`, `writeMessage`,
  `readMessage`, `split() → {send, receive}`; the responder reads `hs.rs` (the phone's key) after message 1 and
  decides before `writeMessage`: that is where server.js refuses with nothing sent. `keyId(publicKey)` is the
  8-byte id. `frames.js`: `packet`, `PacketReader`, `seal(cipher, obj) → [packets]`, `Assembler(cipher).push(msg)`.
- The published vector is in the test file: the Swift side (step 12) should run the same one.
- The helper lives only while a browser with TRIF is open (native messaging host); several helpers can run, the
  one owning `helper.sock` should own the link (step 8: read host.js around `listen()` and how `helper.sock`
  changes hands).
- ios-poc's More chat already speaks the desktop panel's `agentEvent`s (`Web/panel-adapter.js` startRun) and has
  the tools the computer will ask for (`PanelChat.swift`: read_page, try_mod, screenshot). The new engine can sit
  in the adapter's `agent.start` beside the API engines.
- macOS's firewall, when the user has it on, may ask "accept incoming connections?" for `node` the first time the
  listener binds. Step 4 should bind only when the link is on, and step 9's strings may need a line about it.
- Commits end with the Co-Authored-By line the loop prompt gives (Tim's rule), by path, never `-a`.

## For Tim (decisions)

1. **"Asleep" and "TRIF isn't running" look the same from the phone** in version 1 (PHONE-LINK.md section 8):
   the helper runs only while a browser with TRIF is open, so in both cases nothing announces or answers. Proposed:
   one state whose text names both ("It may be asleep, on another Wi-Fi, or have no browser with TRIF open").
   Telling them apart needs an always-on background announcer on the computer; not built, not recommended.
2. **The QR carries the computer's whole public key** (32 bytes), not a shorter fingerprint: the key is its own
   fingerprint, and having it lets the phone's first message be encrypted, so the computer can refuse strangers
   without sending a byte.
3. **Agent and model**: a phone run uses the computer's default agent and model in version 1; the phone shows
   which. Choosing from the phone could come later.
4. **Strings**: docs/PHONE-LINK-STRINGS.md, all drafts.
