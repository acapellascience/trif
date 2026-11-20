# Real sends for Tim (one sitting, ~45 minutes)

The mod matrix (docs/IOS-MOD-MATRIX.md) ran against stand-in chats in the Simulator: TRIF never presses send on
claude.ai or chatgpt.com, so these need your own Send. Use the new build on your iPhone, signed in to both. Any site
works; the steps say x.com and YouTube, swap in your own. Ask for small, harmless mods ("make the side bar narrower").
At the end: ⋯ → Copy diagnostics and paste it to me. A follow-up agent checks the results against the list.

For each: do the steps, then note what you saw against "Look for" (a word is enough: yes / no / what happened).

1. **Claude, on its own tab.** On x.com tap the robot → Go to chat (Claude). Type "make the side bar narrower" and
   press send in Claude.
   Look for: the chat closes back to x.com as soon as you send; the robot shows it's working; when the reply ends,
   "Add this mod?" comes up on x.com, saying it runs on x.com. Tap Add it: x.com reloads with the change.

2. **Claude, nothing twice.** Right after 1, tap the robot → Go to chat again.
   Look for: the same conversation; nothing is offered again; an "Add to TRIF" button under the reply's code.

3. **Claude, an update.** In that same chat type "make it a bit wider again" and press send.
   Look for: "Add this mod?" for the same mod (its name kept), and after Add it, still one mod of that name in the
   Mods tab (the earlier one in its history).

4. **Claude, you've moved on.** On x.com, Go to chat, ask for another small change, press send, and at once switch to
   your YouTube tab (or any other site).
   Look for: no sheet over YouTube; a banner "Claude replied with a mod for x.com". Tap Go to x.com: the x.com tab
   and "Add this mod?" there. (If a video was playing, it isn't reloaded.)

5. **Claude, app in the background.** Go to chat on any site, ask for a change, press send, then go to the Home
   Screen for about a minute (or lock the phone), then come back to TRIF.
   Look for: a notification when it's done (if you allowed them); back in TRIF, the mod offered once (sheet or banner),
   not twice, and nothing left spinning.

6. **ChatGPT, on its own tab.** On another site, robot → Go to chat → ChatGPT. Ask for a small change, press send.
   Look for: the chat closes back to the tab at once; when the reply ends (TRIF goes by ChatGPT's Stop button, else
   waits for the reply to stop growing), "Add this mod?" comes up, naming that site. (11-20: ChatGPT's redesigned page;
   if the chat doesn't close, wait 5 s before anything else: TRIF then notes what it saw in the diagnostics.)

7. **ChatGPT, the sent message and a follow-up.** Right after 6, Go to chat again.
   Look for: the same conversation; in YOUR sent message, TRIF's screenshot shows as ChatGPT's picture (fine either way:
   just say how it looks); nothing offered again. Then ask "now make it a little bigger" and send: the update offered.

8. **ChatGPT in the background.** As 5, but with ChatGPT.
   Look for: the same as 5. (A reply that finished while the phone slept may be left in the chat with its "Add to TRIF"
   instead of offered: that's by design; say which you got.)

9. **Quick ask on the real page.** On a site, hold the robot (or tap it and type in the box at the top) "make the
   text bigger", and press send in the small Claude strip that slides in.
   Look for: the strip shows your words and Claude's send button, nothing else jumping; after send it slides away,
   the pill says it's working, then Done · Undo with the change on the page. Tap Undo: the change goes.

10. **Two chats at once.** On x.com send a request in Claude; straight away switch to another site's tab and send a
    request there in ChatGPT.
    Look for: each mod offered for its own site: the one for the tab you're on as "Add this mod?", the other as a
    banner naming its site.

11. **Killed mid-reply.** Send a request in Claude, and while it's still writing, swipe TRIF away in the app
    switcher. Wait 30 seconds (the reply finishes on Claude's side meanwhile), then open TRIF and don't touch anything.
    Look for (11-20: picked up by itself now): within about 10 seconds, without opening the chat, a banner "Claude made
    a mod for {site}" with Add and Go to {site}; the robot's list shows that chat as "Reply waiting"; Add brings up
    "Add this mod?" once, for the new mod only (not an older one from that conversation). Then swipe TRIF away again
    and reopen it: nothing comes up again. (If no banner: the robot's list, Go to chat, the reply's "Add to TRIF" as
    before, and Copy diagnostics: its "pickup" lines say why.)
    Also (optional): the same with the phone locked for 2 minutes instead of swiping TRIF away: on unlock, the
    same banner (or "Add this mod?" if TRIF saw it end), once.

12. **Claude, changes not the whole file (edit blocks, 11-19).** On a site where a mod of yours runs (a long one if
    you have one), tap the robot → Go to chat (Claude, a new chat). Ask for a small change to that mod by its name
    ("in <mod name>, make the buttons a bit smaller") and press send.
    Look for: the reply starts a code block with "TRIF edit <site>/<name> <8 letters and digits>" and has
    "<<<<<<< SEARCH … ======= … >>>>>>> REPLACE" (not the whole file again); under its last code block the button
    says "Add 1 change to TRIF" (or N changes); "Change this mod?" comes up with the change (− the old line, + the new),
    and "Add 1 change"; after it, the mod has the change and its History the old version. Say if Claude wrote the
    whole file instead, or left parts out ("// rest unchanged").

13. **ChatGPT, the same.** As 12 with ChatGPT.
    Look for: the same; ChatGPT often splits changes into several code blocks: still one "Add N changes to TRIF",
    after the last.

14. **A stale edit.** After 12, change that mod in the Mods tab (switch it off and on is not enough: edit a line, or
    let a sync from the computer change it), then in the chat from 12 press the "Add 1 change to TRIF" button again.
    Look for: nothing changed; the note "Those changes don't fit … as it is now"; Claude's message box now has a
    message asking for the changes again, with the mod's code in it. Don't send it unless you want to; if you do,
    the new reply's changes should apply.

15. **Claude: TRIF's project, set up (11-20).** On a fresh install's first Claude chat (or after an agent clears
    `chatProjectOffer.Claude` and `chatProject.Claude` from the app's prefs), open a new chat: under TRIF's greeting a
    card "Keep TRIF chats in their own project?". Tap **Set it up**. Look for: claude.ai's "New project" form with the
    name TRIF and the description filled in, and the green line "Tap Create project to make it…"; nothing pressed by
    TRIF. Tap **Create project** yourself. Look for: the new project's page, and TRIF opening its instructions
    ("Set project instructions") with TRIF's instructions filled in and the line "… Tap Save instructions to finish."
    (if no instructions box comes up, say what the page shows: its markup is unverified). Tap **Save**. Look for: a new
    chat on the project's page with the page attached ("From TRIF: the page", no guide).
16. **Claude: a send in the project.** Right after 15, type a small request and press send. Look for: the reply and
    "Add this mod?" as usual; the conversation listed under the TRIF project in Claude (and in Recents). Then the robot
    → Go to chat on another site → a new chat starts on the TRIF project's page again.
17. **ChatGPT: the same, and Not now.** As 15-16 with ChatGPT: its card → Set it up → TRIF opens the side bar's
    "Create project" (name TRIF) → you tap Create project → TRIF opens the project's ••• → Project settings and fills
    the instructions (unverified markup: say what you see) → you tap Save → a new chat in the project; send one.
    Look for: the conversation's address /g/g-p-…/c/… and the reply picked up. (To try Not now instead: on a fresh
    service's card tap Not now: the card never comes back for that service; ⋯ → Keep TRIF chats in a project… still
    sets it up.)

18. **Diagnostics.** ⋯ → Copy diagnostics, paste it to me. (Its "chat offers", "chats" and "project" lines say what TRIF
    saw for each of the above.)
