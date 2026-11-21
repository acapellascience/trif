# Using TRIF on your iPhone with your computer

TRIF on your iPhone can use the coding agent on your Mac to make mods for you. The agent is the same one TRIF's chat uses there. It works over your Wi-Fi, so you need no API key and no extra subscription.

Phone mods are also kept the same on both devices. Start a mod on your phone, then sit down at the computer and keep working on it there. The changes go back to your phone.

*(Draft for new users. The wording on screen is still draft too, so a label may differ slightly.)*

---

## What you need

- **TRIF on your Mac**, in Chrome, with a coding agent set up. If you can chat with TRIF in its side panel, you're set.
- **The TRIF app on your iPhone.**
- **Both on the same Wi-Fi.** It doesn't work over mobile data or from somewhere else yet.
- **The Mac awake, with Chrome open.** TRIF on the Mac only answers while Chrome is running.

---

## 1. Connect your iPhone (once)

**On the Mac**
1. Open the TRIF side panel and go to **Settings**.
2. Scroll to the bottom, to **Connect a phone**.
3. Click **Connect a phone**. A square code appears. It works for 5 minutes, for one phone.
4. If the Mac asks whether to let `node` accept incoming network connections, click **Allow**. That's TRIF's helper. You'll only see this if your Mac's firewall is on.

**On the iPhone**
1. Open TRIF and tap the robot (🤖) to open the chat.
2. Switch the chat to **More**. In its Settings, under **My computer**, tap **Pair with my computer…**
3. Check the name for this iPhone (it's what your Mac will call it), then tap **Scan the code**.
4. Allow the camera when asked, and point it at the code on your Mac. You can also scan the code with the iPhone's own Camera app, which opens TRIF.
5. When iOS asks to let TRIF find devices on your local network, tap **Allow**. TRIF needs this to find your Mac.

The phone says **Connected to *your Mac*.** The Mac says ***your iPhone* is connected.** You're done. You won't need to scan again.

---

## 2. Ask your computer for a mod, from your phone

1. On the iPhone, open the site you want to fix.
2. Tap 🤖, switch to **More**, and choose **My computer** as the engine.
3. Say what you want, just as you would in any TRIF chat: "hide the Shorts row", "make the text bigger".
4. The phone shows **Asking *your Mac*…** while the agent on your Mac works. This can take a minute or two.
5. The mod comes back with an **Approve** button above its code. Tap it and the mod runs.

You can leave the app while it works. The Mac carries on, and the result is waiting when you come back.

---

## 3. Keep working on it at your computer

Sync is on as soon as a phone is connected. On the Mac, the switch is in Settings under Connect a phone: **Keep phone mods the same here and on connected phones**.

1. On the Mac, open the same site in Chrome.
2. In the TRIF side panel, click **Edit for mobile**. The tab moves into a phone-sized window, and the site thinks it's on an iPhone.
3. The panel now lists your **phone mods**, including the ones you made on the iPhone. Chat with TRIF as usual. Here you can see the page full-size, run tests and go as deep as you like.
4. When you're done, click **Back to desktop**.

**Getting the changes back onto your iPhone:** bring the TRIF app to the front. If it's already open, go to the **Mods** tab and tap **Sync now**. The Mods tab says what came over, e.g. **Synced with *your Mac*: 1 changed here.**

The Mac's Settings show the same for each phone: **Synced *time*: 2 from this phone.**

### What waits for your OK

TRIF's usual approval rules apply on whichever device receives a mod:
- **Look-only changes** (colours, hiding things, layout) apply straight away.
- **Mods that can send, click or load things** wait on the receiving device until you approve them. On the Mac, the approval card says **From *your iPhone***.

Sync never lets a mod skip your approval.

---

## 4. When both sides changed the same mod

If you edited a mod on the phone *and* on the Mac before they synced, TRIF keeps both. You'll see the mod plus a copy named ***mod name* (from your computer)**, and a note saying so. Keep the one you like and delete the other.

## 5. Deleting

Deleting a phone mod on one device deletes it on the other, but nothing is lost:
- on the **iPhone**, it goes to **Recently deleted** in the Mods tab, with **Restore**;
- on the **Mac**, it goes to TRIF's trash.

If one side deleted a mod while the other edited it, the edit wins and the mod comes back, with a note saying so.

## What doesn't sync (yet)

- **Desktop mods** stay on the computer. Only phone mods sync.
- **On/off switches** are per device. Turning a mod off on the phone doesn't turn it off on the Mac.

---

## If something goes wrong

| The phone says | What to do |
|---|---|
| **Can't find *your Mac*…** | Check that the Mac is awake, on the same Wi-Fi, and has Chrome open. If you removed this iPhone on the Mac, pair again. |
| **TRIF needs Local Network access…** | Tap **Open Settings** and turn on **Local Network** for TRIF. |
| **TRIF can't use the camera…** | Tap **Open Settings** and turn on **Camera** for TRIF. |
| **That code didn't work…** | The code was already used or is over 5 minutes old. On the Mac, click **Connect a phone** again for a new one. |
| ***your Mac* has no coding agent set up for TRIF yet.** | Set up a coding agent in TRIF's side panel on the Mac. If the chat works there, the phone will work too. |
| ***your Mac*'s coding agent isn't logged in.** | Log in to it in TRIF on the Mac, then ask again. |
| ***your Mac* is already working on this site.** | Wait for the current request to finish. |
| A change made on the Mac doesn't show on the phone | Open the Mods tab and tap **Sync now**. The phone only checks with the Mac when the app comes to the front, so a change made while the app is already open waits for that or for Sync now. |

## Disconnecting

- **On the Mac:** Settings → Connect a phone → **Remove** next to the phone. It can't reach the Mac any more.
- **On the iPhone:** More → Settings → My computer → **Forget *your Mac***. The Mac still lists the phone until you remove it there too.
- **To pause it without unpairing:** on the Mac, turn off **Let connected phones reach this computer**.

## Is it safe?

- **Only paired phones can connect.** Everything between them is encrypted with keys made during pairing.
- **The Mac listens only while a phone is paired** (or a code is showing) and the switch is on.
- **The agent on your Mac works inside TRIF's sandbox** and writes phone mods only. It can't touch your desktop mods.
