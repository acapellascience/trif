# The iPhone app's mod matrix

Tim (11-19): "try a range of behaviours: making mods from the chat screens, making mods from the page screens, being
on another page when a mod comes in … be systematic." One row per case. Run in the iOS Simulator (iPhone SE, iOS 26.3)
against the stand-in chats: TRIF never sends on claude.ai or chatgpt.com, so what needs a real reply is on Tim's list,
mobile/TIM-SENDS.md.

Re-run: `node mobile/test/ios-matrix.js` (Node 22; `--only A1,B3`, `--list`, `--shots <dir>`): see
mobile/IOS-AGENT-NOTES.md, "THE MOD MATRIX". Rows marked *by hand* were done with the iOS Simulator tool (LOCK/HOME,
dark mode, the software keyboard, rotation). Screenshots: mobile/browser-probe/shots/530-549 (not committed).

Before the matrix, the stand-ins were brought up to the real signed-in pages (Tim's accounts in the Simulator, nothing
sent, only new chats): claude.ai's composer, Send, file cards, upload input and model selector; its greeting; chatgpt.com's
signed-in composer (a form's submit "Send", "Attach files" for any file, its file tile, "Select ChatGPT model"). Not
comparable without a send: reply and streaming markers, code blocks, a sent message's attachments (Tim's list).

11-20, a reply picked up after TRIF wasn't running (SentNotes): B11 changed, B12-B15 added; with A1, A3, B3, B9, C8,
D1 on that build: 11 PASS. B10 (the phone locked, by hand) not run again.

**Totals: 52 rows: 49 PASS, 2 FAIL → fixed (now PASS), 1 BLOCKED.** 11-20, projects: P1-P6 added, PASS. 11-19, edit blocks: F1-F8 added, and A1, A2, A3,
A6, B3, C2, C4, C5, C6, C7 run again on that build: all PASS (A6 after a test fix, below). The script's last run (merged with origin/ios-poc
784a3e9): 32 cases, 31 PASS, 1 BLOCKED (A5); the rest by hand.

11-20, ChatGPT redesigned (Tim's real send: nothing seen, no offer, no Add to TRIF): chat.js fixed and a stand-in made
from the saved real pages (`chat.html?thread`). ChatGPT's rows on it, `--gpt thread --only A2,B4,C9,F1,F2`: 5 PASS
(A2, B4, C9 again after a Swift change: PASS); on the old `?gptin` stand-in, A2, F1, F2: PASS. The real thing still
needs Tim's send (TIM-SENDS 6-8, 13).

| # | Case | Result | What was seen |
|---|---|---|---|
| | **Where the request starts** | | |
| A1 | Claude: Go to chat on the page, sent, mod offered on its own tab, added, runs | PASS | offered for localhost, came from localhost; the page reloaded and runs it; the chat link "added", tab 0 |
| A2 | ChatGPT (signed-in stand-in `?gptin`): the same | PASS | |
| A3 | The quick ask (the robot's box): the strip filled, the person's Send in the strip, the style mod added at once, Undo | PASS | Done · Undo; Undo took the mod away |
| A4 | Voice: the robot held, a recording as the microphone (`-speechfile`): the strip has the words heard, Send, added | PASS | "Make the headings green ask voice 271" in Claude's box (shot 549) |
| A5 | The Mods sheet's "make a mod" | BLOCKED | no such entry in the Mods tab (its empty state says to open the chat); the robot's list is the page's way in |
| A6 | More (Claude API engine, mock-api.js): a quick ask sent directly, added | PASS | engine "Claude Opus 5.5 · Claude API"; Done; the mod runs (mock-api.js now puts the message's "ask" words in its CSS, so a run's mod is new code) |
| A8 | A chat on the computer (the stand-in computer's desktop phone-view chat edits the phone's mod): arrives by sync while the phone is on another site; that page left alone; runs on its site | PASS | after merging origin/ios-poc 784a3e9 too |
| | **Where the person is when it arrives** | | |
| B2 | Another tab of the same site | PASS | Add this mod? there at once |
| B3 | Another site | PASS | no sheet over that site; the banner "Claude made a mod for localhost"; Go to localhost → its tab and the offer (shot 542) |
| B4 | The robot view on another service's chat for another site | PASS | the banner over the chat; Add → Add this mod? over the chat; the note "Added … It runs on localhost." (shot 543) |
| B5 | The robot view on the same service's chat for another site | PASS | banner; Go to localhost closes the chat |
| B6 | Its own tab, the Mods sheet open | PASS | the banner (no sheet over the sheet); after closing it, Add → the offer, once |
| B6b | …and the banner's Add tapped with the Mods sheet still open | PASS | Add this mod? comes up (shot 544) |
| B7 | Its own tab, the tabs sheet open | PASS | as B6 |
| B8 | Its own tab, the history sheet open | PASS | as B6 |
| B9 | The app in the background (Settings in front 14 s) | PASS | offered once on return |
| B10 | The phone locked mid-reply, unlocked 30 s later (*by hand*) | PASS | the reply finished in background time ("background time given back after 23 s"); Add this mod? waiting on return, once. A 6 s main-thread hang was logged while locked (open, below) |
| B11 | The app killed mid-reply and launched again | PASS (11-20: picked up now) | 1.5 s after the launch the conversation loads behind the tab from the send's note; the reply after the noted message read though TRIF never saw it written: the done banner "Claude made a mod for localhost" · Add (shot 559), the chats' list "waiting", Add → Add this mod? once; an older mod earlier in that conversation never handed over; relaunched again: nothing. (Before 11-20: left in the chat with Add to TRIF, shot 547) |
| B12 | Away past the background time (iOS's time ran out after 26 s), the chat page's WebKit process ended meanwhile, back after ~45 s | PASS | the page loaded again on return, picked up from the note: the banner once (shot 560), note gone |
| B13 | A note whose reply was offered already (its mod added), TRIF stopping again before it saw the end | PASS | the pickup finds the mod installed: nothing shown, Diagnostics "offered before: nothing again" |
| B14 | A note over an hour old | PASS | dropped at launch ("older than an hour"), no chat page loaded, nothing shown |
| B15 | A quick ask killed mid-reply and launched again | PASS | its pill back "Working", then Done · Undo with the look-only mod added (shot 561); Undo removes it |
| | **What arrives** | | |
| C2 | Full code (a free mod) | PASS | offered as free; added; runs |
| C3 | An every-site mod | PASS | the offer says every site; runs on 127.0.0.1 too (shot 545) |
| C4 | An update of an added mod (same @id) | PASS | offered under the same id; one mod of that name, its history 1; the new version runs |
| C5 | Two mods in one reply | PASS | one after the other (the second queued), both added |
| C6 | A mod that needs an OK (powers) | PASS | added on hold, the approval card (shot 546); Allow → not held |
| C7 | Broken code | FAIL → fixed in f034043 and b20935f | before: a 2 s note only, and from another tab "Claude replied about localhost": nothing said it failed. Now the banner says "Claude's mod for localhost can't be added", stays until closed (draft words in IOS-APP-STRINGS.md; shot 536) |
| C8 | A long reply written slowly (40 s) | PASS | the tab's badge "working" meanwhile; nothing early; offered once at the end |
| C9 | Two chats replying at once (Claude for localhost, ChatGPT for 127.0.0.1) | PASS | each for its own site: the shown tab's as Add this mod?, the other as its banner (shot 548) |
| | **After it arrives** | | |
| D1 | Shown once: a dismissed banner stays dismissed; the chat opened again (its conversation drawn again) offers nothing | PASS | |
| D2 | The banner names the right site | PASS | B3, B4, C9 |
| D3 | Added on its own tab: the page loads again and runs it | PASS | |
| D4 | Added while the page plays sound: not loaded again | PASS | runs from the next load |
| D5 | Switched off and on again (Mods tab) | PASS | the page follows both ways |
| D6 | Badges: the tab sent from shows working, then plain; another tab of the site none | PASS | |
| D7 | It syncs to the computer (the stand-in computer, paired over -linkhost) | PASS | the computer's phone~example.com twin has it; re-run after merging origin/ios-poc 784a3e9 |
| D8 | The chat remembers its site: the same conversation from the site's tab, another for another site | PASS | |
| | **Edit blocks** (11-19: a chat changes a mod by SEARCH/REPLACE blocks, not its whole file; script rows) | | |
| F1 | Claude: the run's mod, then changed by an edit block: "Change this mod?" with 1 change, added, the new code runs, its History has the old | PASS | edits 1; runs; history 1 (shot 551) |
| F2 | ChatGPT (`?gptin`): two edit blocks in two code blocks of one reply: one offer, 2 changes | PASS | edits 2; both in; runs (shot 550) |
| F3 | A stale version: nothing applied; the note; the can't-be-added banner; Claude's box asks again with the mod's code now and its new edit line, never sent | PASS (after a script fix: the note is gone in 2 s, the banner keeps its words) | shots 552-553 |
| F4 | A shortened whole file ("// ... rest unchanged ..."): refused; the note; the box asks for the whole file | PASS | shots 554-555 |
| F5 | An edit block whose SEARCH isn't in the mod: nothing applied; the box asks again ("Change 1 … doesn't match") | PASS | shot 556 |
| F6 | Pasted edit blocks (the clipboard path, the dev step `offer`): offered with 1 change; pasted stale ones: "… is copied", nothing offered | PASS | |
| F7 | More (Claude API, mock-api.js "mock edit"): a quick ask's reply is an edit block: applied, added at once (look-only), Done | PASS | |
| F8 | More: a stale edit: nothing changed; the message in the panel's own box (never sent) | PASS | shot 557 |
| | **Looks** (*by hand*) | | |
| E1 | Dark mode: the banner, Add this mod?, the added note, the can't-be-added banner | PASS | shots 533-536 |
| E2 | The keyboard up in another chat when a mod arrives | PASS | the banner over the chat, the keyboard left alone (shot 537) |
| E3 | Rotation with Add this mod? up | PASS (note) | landscape on the SE: the sheet is all there, but Add it is below the fold (scroll) (shot 538) |
| E4 | claude.ai's own greeting, signed in | FAIL → fixed in 8cc1965 | TRIF's greeting sat above "Hello, night owl"; now in its place, Claude's hidden, light and dark (shots 530-532) |

**TRIF's chats in a project of their own (11-20, Tim: "set up in one tap").** Stand-ins: claude.ai's /projects/create
(mobile/shared/pages/projects.html, from the real signed-in dialog), chatgpt.com's side bar + "Create project" (chat.html
`?gptin`/`?thread`, from the real one), project pages with their instructions (claude.ai's "Set project instructions";
chatgpt.com's ••• → Project settings: from the help pages, not seen signed in), serve.js keeping projects
(/standin-project). The person's Create and Save are the stand-in's buttons clicked by the script, as the person's taps.

| Row | Case | Result | Seen |
|---|---|---|---|
| P1 | Claude: the card on the first new chat; Not now: gone at once, never again | PASS | offer shown (once in view 2 s) → declined; a new chat: no card (shot 562) |
| P2 | ChatGPT: Set it up: the side bar opened, "Create project" filled (TRIF), the person's Create, the project noticed by /g/g-p-<id>-trif/project, ••• → Project settings opened and filled, the person's Save, a new chat in the project with the page only; a send: its /g/…/c/<id> conversation kept, the reply's mod offered, and the next new chat on the project again | PASS (after a script fix: the person's Create was looked for as the page's first form's submit, the composer's Send) | shot 568 |
| P3 | Claude: ⋯ Set it up: /projects/create filled (name, description), the person's Create, "Set project instructions" opened and filled, the person's Save, a new chat on /project/<id> with the page only ("From TRIF: the page"); a send → /chat/<id>; the next new chat on the project | PASS | shots 563-565 |
| P4 | The project gone (deleted on the stand-in after P3; its page 404s): the next new chat is ordinary, with the full instructions; the project forgotten; no card | PASS | |
| P5 | Claude: sent past the card without an answer: never again | PASS | offer ignored |
| P6 | Claude: Set it up, then the form's Cancel: nothing kept, ordinary chats, no card again | PASS | setup over at the page's leaving |

With P1-P6 the same build ran A1, A2, A3, B11 and F1: PASS. On the signed-in Simulator (Tim's accounts, nothing
created or sent): Set it up filled claude.ai's real "New project" (name, description, Create enabled; shot 566) and
chatgpt.com's real "Create project" through its side bar (name, Create enabled); the card on ChatGPT's real new chat
(shot 567); on claude.ai's new chat its own "Auto is now the default" notice took the card's room (no card, rightly).

## What broke and what was fixed

- **A6 on a re-run** (11-19, the edit-blocks batch): the panel keeps its More chat across launches, so mock-api.js
  read the ask words from an old first message and the mod was the earlier run's code (skipped: in Recently deleted);
  with a new chat, the mock's @match kept the page's port (http://localhost:8377/*: two sites, so not look-only).
  Test-only: A6 clicks #new-chat, the mock drops the port as the stand-in chat does.

- **claude.ai's greeting** (E4, 8cc1965): its "Hello, night owl" is no heading; chat.js now finds a greeting in display
  type and stands in for it.
- **A broken mod said nothing** (C7, f034043 and b20935f): the done banner says the mod can't be added.
- Stand-in, not the app: ChatGPT's signed-in composer and file tile, Claude's tiles and composer, conversations kept by
  the server (B11 needed a conversation that survives the app being killed, as a real one does).
- Test-only: C5 failed once because C4's words said "two" (the stand-in's two-mod word); fixed in the script.

## Still open

- B10's log: "the app's main thread was blocked 5988 ms (last: opening the chat: the chat's page)" while the phone was
  locked, and several 0.6-1.1 s blocks marked "opening the chat" in the Simulator. Possibly the watchdog counting a
  suspended app; not looked into here.
- E3: on the SE in landscape, Add it is below the fold of Add this mod? (as in portrait for a long code view: the
  buttons come before the code, not before the name and sites).
- Everything that needs a real reply: mobile/TIM-SENDS.md.
