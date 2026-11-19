# Real sends for Tim (one sitting, ~25 minutes)

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
   Look for: the chat closes back to the tab at once; when the reply ends (ChatGPT shows no "writing" mark, so TRIF
   waits for the reply to stop growing), "Add this mod?" comes up, naming that site.

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
    switcher. Wait 30 seconds, open TRIF, tap the robot → Go to chat.
    Look for: nothing stuck "working"; the finished reply in the chat with "Add to TRIF" under its code (TRIF doesn't
    offer a reply it didn't see finish); tapping it brings up "Add this mod?".

12. **Diagnostics.** ⋯ → Copy diagnostics, paste it to me. (Its "chat offers" and "chats" lines say what TRIF saw for
    each of the above.)
