# Phone link: progress

The loop's file: read this first, every round. The design: docs/PHONE-LINK.md. Strings: docs/PHONE-LINK-STRINGS.md.
Branch `phone-link` (worktree ~/WebMods-worktrees/phone-link). iPhone work is on `ios-poc` and only when the
round's brief says it is free.

## Checklist

Computer side:
- [x] 1. Design and wire protocol (docs/PHONE-LINK.md), the strings file
- [x] 2. `helper/lib/phonelink/noise.js` (Noise IK, ciphers) and `frames.js` (packets, pieces), unit tests with
      the published vector
- [x] 3. `store.js`: the computer's key (keyring, service `TRIF phone link`), `<private>/phone-link.json`
      (on/off, port, paired phones), the pairing window (secret, 5 minutes, 5 tries, one phone), remove. Unit tests
      with `tests/fake-keychain.js`
- [x] 4. `server.js`: the listener (none while off; silent refusal of unpaired, removed, garbage, late), sessions,
      `hello`/`ping`. Tests on 127.0.0.1, a random port. `tests/phone-link-client.js` (the stand-in phone) begun
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

## Done this round (round 3, 2026-11-16)

- Built step 4: `helper/lib/phonelink/server.js` (class `Server`, class `Session`). It follows the store's
  `'change'`: a listener only while `status().listen` and the key is there; sessions of removed phones, and
  everything when the link goes off, are closed. Not wired into host.js yet (step 8), so nothing listens for real.
- Refusals write nothing: garbage, a browser's GET, silence, a slow drip, an unpaired key, a wrong secret, a bad
  payload, the ninth connection. Five wrong secrets close the window and, with nobody paired, the listener.
- Three rules the server settles, now in PHONE-LINK.md section 4 ("When a connection becomes a session"): a
  session counts only once its first transport message decrypts (a replayed first message never becomes one and
  can't touch the real phone's session); one session per phone, the newest proven one; a 2-minute idle limit
  (the app pings every 30 s). None weakens section 2.
- `tests/phone-link-client.js`: the stand-in phone (`PhoneClient.connect`, `request`, `next`, `raw`,
  `firstMessage`), for step 10 to grow. `tests/phone-link-server.test.js`: 13 tests pass locally, three runs in a
  row (7 s each); the store and noise tests still pass (36).
- CI green for 8a04fa2 on the second attempt (one unrelated browser test flaked on the first): see CI below.

## Earlier rounds

- Round 2: step 3, `store.js` (the computer's key in the keyring, `phone-link.json`, the pairing window, remove),
  18 tests. CI green for 7dcd239 on the second attempt.
- Round 1: the survey, docs/PHONE-LINK.md, docs/PHONE-LINK-STRINGS.md, step 2 (`noise.js`, `frames.js`, 18 tests
  with the published cacophony vector). CI green for c8898a4:
  https://github.com/acapellascience/trif/actions/runs/43959884729

## CI

- Round 3, 8a04fa2: success on the second attempt, https://github.com/acapellascience/trif/actions/runs/43965527256
  (attempt 1: 873 passed, 1 failed, the clickjacking guard's timing check again, this time "the second look:
  19.40 ms at most"; all 13 server tests passed in both attempts; `gh run rerun <id> --failed` cleared it)
- Round 2, 7dcd239: success on the second attempt, https://github.com/acapellascience/trif/actions/runs/43961575804
  (attempt 1 failed on two browser tests this branch's work doesn't touch: the clickjacking guard's timing check,
  "a press: 5.58 ms on average", and the phone view's "desktop mods never run in the phone view", `window.__ask is
  not a function`; every phone-link test passed in both attempts; `gh run rerun <id> --failed` cleared it)
- Round 1, c8898a4: success, https://github.com/acapellascience/trif/actions/runs/43959884729

## Next step

Step 5: `helper/lib/phonelink/bonjour.js` with its tests (a stand-in binary through `TRIF_DNS_SD`, never the real
`dns-sd` in a test: it would announce on Tim's Wi-Fi). `new Announcer(store, server, {env, log})`: on the
server's `'listening'` (port) start one child, `dns-sd -R "<store.name>" _trif._tcp local <port> v=1 id=<id>`
(`id` = `store.status().id`; argv as an array, no shell); on `'stopped'` kill it; a port that changes means kill
and start again; a child that exits while the listener is up is started again after a pause that grows (1 s, 2 s,
… 30 s), and not at all when the binary isn't there (ENOENT: log once; the phone then can't find the computer, a
state the panel should be able to show, so keep `announcer.status()` → `{running, error}`). `stop()` kills the
child; make sure the child can't outlive the helper (kill on `process.on('exit')` too; check how host.js ends its
other children). Not macOS: no announcer, `status().error = 'unsupported'` (PHONE-LINK.md section 9). The stand-in
binary: a small script in the test's temp folder that writes its argv and pid to a file and sleeps (see how
`tests/fake-keychain.js` makes its stand-in). Tests: no child while not listening; the exact argv; killed on
stop, on link off, on the last phone removed; restarted when it dies; nothing started when `TRIF_DNS_SD` points
nowhere; the name passed as one argument whatever characters it has. Optionally the Mac's friendlier name
(`scutil --get ComputerName`) for `computerName()` in store.js, with the host name as the fallback.

## Notes for next round

- Tests: `node --test tests/phone-link-store.test.js tests/phone-link-noise.test.js` (3 seconds). The whole suite
  is `npm test`; the browser tests need `TRIF_BROWSER_TESTS=1` and are CI's job (don't run them locally without
  the lock and the watchdog).
- Tests now: `node --test tests/phone-link-server.test.js tests/phone-link-store.test.js
  tests/phone-link-noise.test.js` (10 seconds).
- `server.js` API: `new Server(store, {version, log, host, port, hello, firstMessageMs, idleMs, maxConnections})`
  (an EventEmitter: `'session'` (a proven Session), `'listening'` (port), `'stopped'`); `await start()` → the port
  or 0; `await sync()` → the port or 0 (queued behind any change being handled: tests call it after touching the
  store); `await stop()`; `address()`; `handle(type, fn(session, msg) → answer | nothing | a promise)` (the
  answer gets `t: 'ok'` unless it has a `t`, and the request's `id`; a throw becomes `error` with `e.code` or
  `bad-request`); `sessions` (a Set), `stats` (`refused`, `sessions`). `Session`: `phone` `{id, name}`, `key`,
  `hello` (`{app, device}` after the app's `hello`), `send(obj)` → false when closed (throws only "message too
  big"), `close()`, `'close'`. The `hello` option gives the `hello` answer's `agent` and `pending` (step 6).
  Without `host` it binds every interface: always pass `host: '127.0.0.1'` in tests.
- For step 6: push to a phone with `session.send({t: 'run.event', …})`; find a phone's live session by
  `[...server.sessions].find((s) => s.phone.id === id)`; on `'session'`, send what was kept for that phone.
  Removal already closes the session; remote.js deletes the kept results on the store's `'change'`.
- For the iPhone side (step 12): after the handshake's answer the app must send `hello` within 5 seconds, then a
  `ping` every 30 seconds while in front (the computer closes a session that is quiet for 2 minutes); a silent
  close before any answer = "isn't connected any more".
- Test timings: the tests use `firstMessageMs: 500`; the `pair()` helper in the server test sends a ping right
  after the handshake (so its ids start at q2). The stand-in clients treat ECONNRESET as a close.
- `store.js` API: `new Store(home, {env, now, name})` (an EventEmitter, `'change'`); `await setOn(true|false)` →
  `{on, created}`; `await keys()` → `{publicKey, privateKey}` Buffers or null (off, or the keyring's key isn't the
  file's); `status()` → `{on, id, name, port, phones, pairing, listen}` (no secret, no keys: safe for the panel);
  `pairStart()` → `{secret, qr, expires}` (throws while off); `pairStop()`; `pairing()`; `pairTry(phoneKey Buffer,
  secret string, name)` → the phone's row or null; `isPaired(phoneKey Buffer)` → row or null (null while off);
  `seen(id)`; `remove(id)` → `{id, name}` or null; `list()`; `setPort(port)`. Everything but `setOn`/`keys` is
  synchronous and reads the file again each time (two helpers agree); the window is the opening helper's alone.
- Test setup to copy: `setup()` in the store test (temp workspace through `tempDir`, `makeFakeKeychain`, env
  `{TRIF_KEYCHAIN_BIN}`, a clock the test moves; the private folder is `<home>-private`). The stand-in keychain
  takes about 0.2 s per `setOn(true)`.
- The store's expiry timer is unref'd and cleared by `pairStop()`; tests call `store.pairStop()` at the end.
- Writing a file with the Write tool turned `\u2028` escapes into the real characters (a syntax error inside a
  regex): check with `cat -v` after writing such escapes.
- `noise.js` API: `new Handshake({initiator, s: {publicKey, privateKey}, rs, prologue, e})`, `writeMessage`,
  `readMessage`, `split() → {send, receive}`; the responder reads `hs.rs` (the phone's key) after message 1 and
  decides before `writeMessage`: that is where server.js refuses with nothing sent. `keyId(publicKey)` is the
  8-byte id. `frames.js`: `packet`, `PacketReader`, `seal(cipher, obj) → [packets]`, `Assembler(cipher).push(msg)`.
- The published vector is in the noise test file: the Swift side (step 12) should run the same one.
- The computer's name is `os.hostname()` without `.local` for now (`computerName()` in store.js); the Mac's
  friendlier name (`scutil --get ComputerName`) could replace it in step 5, where `dns-sd` needs a name anyway.
- The sandbox keeps runs away from the Keychain already (agents/codex-oss.js's note: the home folder is denied),
  so a run can't read the computer's key; step 6 should have a test line for the private folder's
  `phone-link.json` and `phone-link/` being unreadable from a run.
- The helper lives only while a browser with TRIF is open (native messaging host); several helpers can run, the
  one owning `helper.sock` should own the link (step 8: read host.js around `listen()` and how `helper.sock`
  changes hands).
- ios-poc's More chat already speaks the desktop panel's `agentEvent`s (`Web/panel-adapter.js` startRun) and has
  the tools the computer will ask for (`PanelChat.swift`: read_page, try_mod, screenshot). The new engine can sit
  in the adapter's `agent.start` beside the API engines.
- macOS's firewall, when the user has it on, may ask "accept incoming connections?" for `node` the first time the
  listener binds. Step 4 should bind only when the link is on, and step 9's strings may need a line about it.
- The clickjacking guard's timing check (`tests/clickjack-browser.test.js`) has now flaked in CI in rounds 2 and
  3, on runs that don't touch it: not this branch's to fix, worth a mention to Tim (main has the same test).
- CI takes about 9 minutes. If it fails on browser tests only (not `phone-link-*`), look at the names with
  `gh run view <id> --log-failed | grep "not ok"` and rerun with `gh run rerun <id> --failed` before digging.
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

Items 1 to 3 stand as defaults (the main session's brief, round 2) until Tim says otherwise. New in round 2,
small, also a default unless Tim objects:

5. **A lost key drops the listed phones.** If the computer's key is gone from the Keychain (deleted by hand, a
   new Mac restored without it), turning the link on makes a new key, and the phones listed before are removed
   from the list, since they can't reach the new key and must scan a new code anyway.
