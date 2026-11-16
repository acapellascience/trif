# Phone link: the iPhone app's More chat, run on the user's computer

Branch `phone-link`. Goal decided by Tim, 2026-11-16. Progress and the checklist: docs/PHONE-LINK-PROGRESS.md.
The strings people see: docs/PHONE-LINK-STRINGS.md (drafts until Tim approves them).

In the iPhone app's More chat, **My computer** is an engine beside the API engines and the on-device model. The
user's own coding agent runs on their computer, behind the fence every side-panel run has, and what it makes comes
back to the phone, where the user approves it as they approve any mod from outside.

Version 1: **Mac, and the same Wi-Fi.** Nothing in the protocol is the Mac's (section 9).

## 1. The pieces

```
 iPhone app (branch ios-poc)                              the computer (this branch)
 More chat ── engine "My computer"                        helper (host.js, the default helper)
   PhoneLink.swift: browse (NWBrowser), Noise IK,           lib/phonelink/noise.js    the handshake and the ciphers
   frames, the run's events as the panel's agentEvents      lib/phonelink/frames.js   messages over the encrypted link
   tools the computer asks for: read_page, try_mod,         lib/phonelink/store.js    the key, the paired phones, on/off
   screenshot (PanelChat.swift already has them)            lib/phonelink/server.js   the listener, sessions, the refusals
   QR scan, the paired computer in the Keychain             lib/phonelink/bonjour.js  dns-sd -R while the listener is up
                                                            lib/phonelink/remote.js   phone runs: start, events, kept results
            ◀── TCP on the local network, Noise ──▶         runs.js                   the same run, scope phone~<site>
                                                            cli.js `trif phone …`     the agent's way to the phone
                                                            extension: Settings → Connect a phone (QR, the list)
```

What exists already and is used unchanged: the run pipeline and its fence (`runs.js`: sandbox, staging, the
mailbox, holds), the phone twin `sites/phone~<site>/` as a scope of its own (`scope.js`, docs/MOBILE-EDIT.md 7b),
the system keyring (`keyring.js`), the app's More chat with the desktop panel's own events (`agentEvent`,
`Web/panel-adapter.js`), its tools on the open page (`PanelChat.swift`: read_page, try_mod, screenshot) and its
approval screens (Add this mod?, the Mods tab's card).

**The helper runs only while a browser with TRIF is open** (Chrome starts it as the native messaging host). So does
the phone link: no browser, no listener. With several helpers (several browsers or profiles), the one that owns
`helper.sock` owns the link.

## 2. What must hold (the security rules)

1. **Off until turned on.** A new install has no key, no listener and no Bonjour record. "Connect a phone" in the
   desktop panel turns the link on. Turning it off, or removing the last phone, stops the listener and the record.
2. **Only the paired keys.** A connection whose first message isn't from a paired phone's key (or, while a pairing
   window is open, doesn't carry that window's one-time secret) is closed **without a byte sent back**. A stranger
   on the Wi-Fi learns that a TCP port accepts connections, and nothing else: not the computer's key, not that it
   is TRIF (the Bonjour record says so, section 5, and only while the link is on).
3. **Phone runs write the phone twin and nothing else.** The helper makes the run's site itself:
   `phone~<host of the page address>`, whatever the phone says. From there it is a phone run like the desktop phone
   view's: `runLimits` gives it `sites/phone~<scope>/` writable, every desktop folder read-only. The link has no
   message that names a folder, a file path or a desktop mod. The helper copies only that twin's files from
   the run's working copy into the mods folder (section 6, 3a), whatever the agent wrote there.
4. **The same fence.** A phone run goes through `Runs.start` → `_launch`: the same sandbox, the same staging, the
   same run token limits. It can't be asked to run without the sandbox, and doesn't run without it even
   where the user allowed that for the side panel's chats (section 6, 3b).
5. **The link can ask for runs and nothing else.** No message approves a mod on the computer, changes a setting,
   pairs another phone, reads a mod that isn't a phone twin's, or reaches a tab. Pairing, the list and removal are
   the desktop panel's alone (`PANEL_COMMANDS`: not the socket, not a run).
6. **Approval on the phone.** What a run made goes to the phone as a file; the app holds it and shows its usual
   approval screen with its usual warnings. The copy that stays in the computer's phone twin is held or not by the
   computer's own rules, for the desktop phone view, and neither side's approval counts for the other.
7. **What the phone sends is data.** The page copy and the screenshot are a website's content: files in the run's
   folder and a line in its context saying so, never instructions.

Anything that would weaken one of these stops for Tim's decision (the loop's rule).

## 3. Keys and pairing

- **The computer's key**: a Curve25519 key pair made the first time the link is turned on. The private key is in
  the system keyring (`keyring.js`, service `TRIF phone link`, account `computer`) and nowhere else; the public key
  is in the store file.
- **The phone's key**: a Curve25519 key pair made by the app, private key in the iOS Keychain (this device only).
- **The store**: `<private>/phone-link.json`, mode 600, in the private folder (no run can read it):
  `{ on, publicKey, port, phones: [{ id, name, key, pairedAt, lastSeen }] }`. `id` is the first 8 bytes of
  SHA-256 of the phone's public key, in hex. Public keys only.
- **Connect a phone** (desktop panel, Settings): the helper opens a **pairing window**: a 16-byte random secret,
  kept in memory only, good for 5 minutes, for one phone, and closed after 5 wrong tries. The panel shows a QR code
  of

  ```
  trif://pair?v=1&k=<the computer's public key, base64url>&s=<the secret, base64url>&n=<the computer's name>
  ```

  The goal says "the computer's key fingerprint": the QR carries the whole 32-byte key, which is its own
  fingerprint and lets the phone's first message be encrypted to it. The code is drawn in the panel from the
  helper's answer and is never written to disk or the log.
- **The phone scans it** in the app (its camera; iOS's Camera app opens the `trif://pair` link in the app too),
  finds the computer (section 5) and connects with the secret in its first message (section 4). The helper checks
  the secret in constant time, adds the phone's key to the store with the name the phone gave (shown as text,
  cut to 60 characters), closes the window and answers. The panel then lists the phone.
- **Removing a phone** (the panel's list): its key leaves the store, its open sessions are closed, its kept
  results are deleted. The phone finds out the next time it connects (section 8).
- **A new QR** replaces an open window's secret. Closing Settings closes the window.
- **When the helper listens** (`store.js` `status().listen`): the link is on, and a phone is paired or a pairing
  window is open. On with nobody paired and no window, nothing listens. The switch stays where the user put it.
- **A key that's gone** (the keyring's item deleted, or not the file's public key): nothing listens; turning the
  link on again makes a new key pair and drops the listed phones, which were paired to the old key and can't reach
  the new one (each shows "isn't connected any more" and pairs again).
- **The file is read with nothing taken on trust**: a phone's `id` is made from its key again, rows without a
  32-byte key are dropped, and a file that doesn't read is the same as none (off, nobody paired).

## 4. The wire

**Transport**: one TCP connection, the phone connects. Every message on it is a Noise message with a 2-byte
big-endian length before it (at most 65535 bytes).

**Handshake**: `Noise_IK_25519_ChaChaPoly_SHA256`, the phone is the initiator, prologue `TRIF phone link 1`.
(The Noise Protocol Framework, revision 34. Curve25519, ChaCha20-Poly1305 and SHA-256 are in Node's `crypto` and
in Apple's CryptoKit: no dependency on either side.)

```
phone → computer   e, es, s, ss   payload: {"v":1,"name":"<phone's name>","pair":"<secret>"}   (pair only when pairing)
computer → phone   e, ee, se      payload: {"v":1,"name":"<computer's name>","paired":true}
```

IK because the phone already knows the computer's key (from the QR), so its own key and the pairing secret travel
encrypted to the computer in the very first message, and the computer can decide before it answers: a first
message that doesn't decrypt, comes from a key that isn't paired, or carries a wrong secret gets the connection
closed with nothing sent (rule 2). A first message must arrive within 5 seconds (the whole message, however
slowly its bytes come), and at most 8 connections are open at once; one more is closed at once.

**When a connection becomes a session** (`server.js`): the handshake's answer is not yet proof that the other
side is the phone, since a copied first message gets the same answer. The session counts when its first transport
message decrypts, which must happen within 5 seconds of the answer (the app sends `hello` at once). Only then
does the phone's "last seen" move, and only then are that phone's older connections closed: **one session per
phone**, the newest proven one (the app came back from suspension and the old connection is dead). A session
with no message for 2 minutes is closed; the app sends `ping` every 30 seconds while it is in front. A paired
phone that comes again with a pairing secret that was already used (its pairing answer was lost) is let in as
the paired phone it is. A phone that doesn't read what it is sent (more than 32 MB waiting) is closed.

Known limits, accepted: a copied first message played again gets the computer's second message (which only the
real phone can read) and nothing more, since every later message needs the handshake's keys: it never becomes a
session, and is closed 5 seconds later; someone on the Wi-Fi can fill the 8 connections for as long as they keep
trying, which keeps the phone out and gets them nothing; the first message's
payload has no forward secrecy, and holds only the phone's name and a secret that is used once.

**After the handshake**: both directions are Noise transport messages. Each carries one byte and a piece of an
application message: `0x00` more follows, `0x01` the last piece. The pieces joined are one JSON object, at most
8 MB (a screenshot travels as base64 inside it). A message is `{t: "<type>", id?, …}`; an answer repeats the
request's `id`.

Phone → computer:

| `t` | Fields | Answer |
|---|---|---|
| `hello` | `app` (version), `device` (`{name, width, height}`) | `hello`: `v` (1), `version` (TRIF's), `name` (the computer's), `agent` (the default agent's name and model, to show), `pending` (kept runs, below) |
| `run.start` | `url`, `prompt`, `page` (the cleaned copy, text), `shot` (JPEG, base64, optional), `chat` (the app's chat id), `session` (to continue a run's conversation) | `run.started` `{runId}` or `error` |
| `run.stop` | `runId` | `ok` |
| `run.resume` | `runId`, `after` (the last event number seen) | the events after it, then live ones |
| `run.ack` | `runId` | `ok`; the kept result is deleted |
| `tool.result` | `id` (the request's), `text`, `shot` (optional), `error` (true/false) | none |
| `ping` | | `pong` |

Computer → phone:

| `t` | Fields |
|---|---|
| `run.event` | `runId`, `n` (counts from 1), `event`: the run's event exactly as the desktop panel gets it (`text`, `tool`, `error`, `session`, `sandbox`, `login`, `done`) |
| `run.result` | `runId`, `mods`: `[{id, name, code}]` (the phone twin's files the run wrote or changed), `removed`: ids; sent after `done` |
| `tool.request` | `id`, `runId`, `tool` (`read_page`, `try_mod`, `screenshot`), `input` (`{selector, limit}`, `{code}`, `{}`) |
| `error` | `id`, `code`, `message` |

`error.code`s the app shows as states: `busy` (a run is already working on that site, here or in the desktop
phone view), `no-agent` (no coding agent set up on the computer), `login` (the agent is logged out there),
`too-big`, `bad-request`, `bad-url` (the page's address has no site TRIF can make a mod for: not http or https, or
no plain host name).

## 5. Finding the computer

While the listener is up, the helper keeps one child process running:

```
dns-sd -R "<computer's name>" _trif._tcp local <port> v=1 id=<first 8 bytes of SHA-256 of the computer's key, hex>
```

(`/usr/bin/dns-sd`, built into macOS; it stops with the listener and with the helper.) The port is the one the
system gave the listener the first time, kept in the store and asked for again, so the record seldom changes.
The listener binds all interfaces (IPv4 and IPv6). The app browses `_trif._tcp` with `NWBrowser`, takes the
record whose `id` is its paired computer's, and connects. iOS asks for the Local Network permission the first
time (`NSLocalNetworkUsageDescription`, `NSBonjourServices: _trif._tcp` in Info.plist).

The announcer (`lib/phonelink/bonjour.js`) follows the listener: no listener, no child. The name is the Mac's
own (`scutil --get ComputerName`; the host name if that fails), cut to 63 bytes, and always one argument (no
shell). A child that dies is started again after a pause that grows (1 s, 2 s … 30 s). If `dns-sd` can't be
started, the listener still answers but the phone can't find it: `announcer.status().error` is `missing`, for
the panel to show. A helper that is killed outright (SIGKILL, a crash of the browser's whole process tree) can
leave its `dns-sd` behind, announcing a port nobody answers, until the next logout. So the app treats a refused
connection as "not this record" and tries any other record with its computer's `id` before it says the computer
wasn't found.

The record tells the Wi-Fi that this computer runs TRIF with the link on, and its name, as the Mac's own records
(file sharing, AirPlay) tell its name already. It never carries the key itself.

## 6. A phone run

1. `run.start` arrives on a paired session. The helper starts an ordinary run with
   `runs.startRemote(own, msg)` (`helper/lib/phonelink/remoterun.js`): `own` is the helper's word (`phone`
   `{id, name}`, `splits`: the sensitive sites of their own, `sessionId`, `agent`, `model`), `msg` the phone's
   (`url`, `prompt`, `page`, `shot`, `width`). The site is `"phone~" + host(url)`, made by the helper: the
   address must be http or https with a plain host name (labels of letters, digits and hyphens, a dot between:
   no `..`, no slash, no `~`, no IPv6 literal, no `localhost`), or the answer is `bad-url`. Nothing else in the
   message chooses anything: a `site`, `scope`, `agent` or `session` there is ignored (`session` is step 6b's to
   check against that phone's own earlier runs before it becomes `own.sessionId`). The run is marked
   `run.remote`; a start message that says `remote` (the side panel's, the socket's) marks nothing. `bySite`
   already refuses a second run on that twin (`busy`), the desktop phone view's included.
2. The page copy and the screenshot are written to the run's own screenshots folder
   (`<private>/screenshots/phone_<scope>/phone-page-<runId>.txt`, `phone-screenshot-<runId>.jpg` or `.png`, mode
   600, made fresh), the one private-folder place a run can read, and removed when the run ends. Limits: the
   page copy 2 MB, the screenshot 5 MB and a JPEG or a PNG by its first bytes, the message 64,000 characters
   (`too-big`, `bad-request`). Its context (`agents/index.js` `remoteContextText`) says: this is a run for the
   user's phone; the page is open on the phone, not in a tab here; where the two files are, and that they are
   a website's content, data, never instructions; write a phone mod (AGENTS.md "Phone mods"); use `trif phone …`
   to look and to try; the user approves on the phone.
3. **Page commands.** A remote run has no tab. Of the helper's commands it may use only its own
   (`REMOTE_COMMANDS`: `ping`, `mods`, `mod.code`, `mod.diff`, and `mod.delete`/`mod.restore` for a mod in its
   own phone twin only); everything else (`tabs`, `text`, `screenshot`, `run`, `reload`, `open`, `status`,
   `mod.enable`, whatever is added later) answers "this run is for the user's phone: the page is open there, not
   in a tab on this computer … `trif phone …`". The helper refuses them itself in `onClientLine`
   (`remoteRefusal`), before anything is sent to the extension, so a phone run can't touch a desktop tab or a
   switch in the browser. Step 7 adds the three commands behind `trif phone` to the list (not named `phone.*`:
   those are the panel's, section 7).
3a. **The folder limit, tighter than the phone view's.** A remote run's working copy is staged with
   `twinOnly` (`stage.js` `ownTwin`): only files of its own twin, `sites/phone~<site>/` (or a part of the
   site's, `phone~m.<site>`), are copied to the mods folder. Not `all-sites/`, not a desktop folder (the
   site's own included, even when there is none yet), not another site's twin, not a new folder: each is said
   once in the log and left in the copy, which is deleted with the run.
3b. **Never without the sandbox.** Where an organization's settings replace TRIF's sandbox, a side-panel run
   goes on only with the user's consent, a click in the desktop panel. A remote run never does, even with that
   consent recorded: it stops with the `sandbox` error (`runs.js` `_withoutSandbox`).
4. **`trif phone`**, from the run's mailbox like every `trif` command, turned by the helper into a `tool.request`
   on the phone's session:
   - `trif phone page [selector]`: the page's outline, or the elements a selector matches (`read_page`);
   - `trif phone try <mod>`: sends the draft's code from the run's staged phone twin; the app runs it on the open
     page in test mode (its `try_mod`: style and boxed mods, nothing installed, the one tried before taken off)
     and answers with what it found, its errors and a screenshot, saved to the run's screenshots folder;
   - `trif phone screenshot`: the page as it is now.

   Each waits up to 60 seconds. With no session (the app is suspended), or outside a remote run: an error that
   says so, and that the user will try the mod themselves when they're back.
5. **Events** go to the session as `run.event`, numbered. The helper keeps each run's events and result in memory
   and in `<private>/phone-link/kept/<phone id>/<runId>.json` (mode 600) until the phone sends `run.ack`, for at
   most 7 days. A suspended app changes nothing for the run: it finishes, and the next `hello` lists it in
   `pending`; `run.resume` plays it from where the phone stopped.
6. **The result**: after `done`, the files of `sites/phone~<scope>/` that the run wrote or changed (from the
   run's staging record, `stage.written`, and what it removed). The app takes each as it takes a mod file from
   outside (Import.swift): held, with Add this mod? and its warnings. The files stay in the computer's phone twin.

## 7. On the computer's screen

Settings in the side panel gets **Connect a phone**: a switch, the QR code while a pairing window is open, and
the list of paired phones with Remove. Commands, all `PANEL_COMMANDS` (a click in the panel, never the socket or
a run): `phone.status`, `phone.setOn`, `phone.pair` (opens the window, returns the QR's text), `phone.pairStop`,
`phone.remove`. The QR is drawn by a small encoder in the extension (no dependency, no network).
While a phone's run works, the desktop shows nothing new in version 1 (the run is in the helper's log and
`agent.running`); a line in the panel is a later option.

## 8. States (the app never hangs)

| What the app finds | State it shows |
|---|---|
| No Local Network permission | asks for it, with where to turn it on |
| No `_trif._tcp` record with its computer's `id` within 5 s | the computer wasn't found: asleep, off, on another Wi-Fi, or no browser with TRIF open there |
| The record, but the connection fails or times out (5 s) | the same state (a record can outlive a sleeping Mac for a while) |
| Connected, first message sent, closed with no answer | this phone isn't connected to that computer any more (removed there, or the link was turned off): pair again |
| `error` `no-agent`, `login`, `busy` | said in the chat, as the desktop panel says them |
| The link drops in a run | "still working on your computer"; the app reconnects and resumes, or picks the run up later |

**One thing version 1 can't tell apart from the phone:** "the computer is asleep" and "TRIF isn't running" (no
browser open). Both mean no record and no answer; telling them apart needs something on the computer that answers
while the browser is closed (a background announcer), which TRIF doesn't have and which would be a second,
always-on network presence. Proposed: one state whose text names both causes. For Tim (progress file, "For Tim").

## 9. Later, recorded

- **Bluetooth** (no shared Wi-Fi) and **a relay from away from home**: not in version 1. The Noise session
  doesn't care what carries it: either is another transport under section 4's messages, and a relay would see
  only ciphertext.
- **Windows and Linux**: the protocol, the store, the listener and the runs are plain Node. What differs is the
  announcer (`dns-sd` is the Mac's; Windows has the DNS-SD API from Windows 10, Linux `avahi-publish`) and the
  keyring for the private key (`keyring.js` has Linux's; the Windows port brings its own).
- **The desktop panel showing a phone's run** as it happens.
- **Phone mods reaching the phone by themselves** (docs/MOBILE-EDIT.md 7b's iCloud idea) could use the link
  instead of iCloud.

## 10. Proof

- Unit: the Noise handshake against the specification's published test vectors and round trips; frames
  (splitting, limits); the store (file mode, phones added and removed); pairing (the window's secret, expiry,
  wrong tries, one phone per window); refusals with nothing sent (unpaired key, removed phone, garbage, late
  first message, link off = no listener at all); the folder limit (a remote run's site is always a phone twin;
  page commands refused).
- End to end: a stand-in phone in Node (`tests/phone-link-client.js`: the same Noise and frames as an initiator)
  against the real helper code in a temporary HOME, listening on 127.0.0.1 on a random port, with the stand-in
  model and a stand-in keychain (`tests/fake-keychain.js`), no paid calls: pair, run, try on the phone, result,
  drop and resume, remove.
- The iPhone side in the Simulator against the same helper in a temporary HOME.
