# Dictation in the panel's message box: the new strings (branch dictation)

**Drafts for Tim (2026-11-20).** Tim's ask: a microphone button in the side panel's message box, Chrome, Edge and
Safari first; Firefox later. All the words are in `extension/dictation.js` (`DICTATION_WORDS`, `MIC_PAGE_WORDS`:
one table each, so a change is one line). `{browser}` is the browser's name, `{key}` the shortcut.

How it behaves (Tim's rules for voice input, as on the iPhone): it never stops by itself (when the browser's
recogniser ends, after a pause or a minute or so, a new one starts at once); the words only accumulate (what's in the
box stays, new words go at its end; the words being heard show in small italics under the text and only finished ones
go in); only the person's stop ends it (the button, the shortcut, or Escape in the box), and stopping never sends. Sending (Send or Enter) while it listens stops it too (Tim 11-21): the words still being heard go into the message.

## The button (left of Send)

A microphone drawn like the panel's other icons, quiet grey. Pressed and not yet listening (starting, asking for the
microphone, reconnecting): a grey pressed look. Listening (only once the browser says its recogniser started): red,
with a soft ring pulsing (a still ring with reduced motion).

- Its name for screen readers: **Dictate** · while on: **Stop dictating**
- Its tooltip: **Dictate (Ctrl+Shift+Space)** · while on: **Stop dictating (Ctrl+Shift+Space). Your words stay in the box.**
- While it starts (on, not listening yet), the tooltip: **Starting the microphone…**

## Under the box’s text, while it listens

- The words being heard, after an ellipsis, small and italic (not read out: they change as they're heard). No new
  words.

## A line above the box

Quiet (grey) unless it says red.

- The first listen only (where the audio goes), until that first dictation stops:
  - Chrome: **Chrome sends what you say to Google to turn it into text.**
  - Edge: **Edge sends what you say to Microsoft to turn it into text.**
  - Safari: **Safari turns what you say into text with Apple’s speech recognition.**
- While the microphone's tab is open (Chrome and Edge, the first time): **Allow the microphone in the tab that just opened.**
- The speech service unreachable, from the second try in a row (it keeps trying, every 1 to 10 s):
  **Can’t reach the speech service. Still trying…**
- Red, it stops (the words so far stay):
  - Blocked: **The microphone is blocked for TRIF. Allow it in {browser}’s settings, then press the mic again.**
    with a button **Open microphone settings** (opens {browser}'s settings page for TRIF's microphone).
    Safari: **The microphone is blocked for TRIF. In Safari’s Settings, Websites, Microphone, allow TRIF, then press
    the mic again.** (no button: Safari has no page to open)
  - No microphone: **No microphone found. Connect one, or pick one in your computer’s sound settings, then press the mic again.**
  - Safari with Dictation off on the Mac: **Dictation is off on this Mac. Turn it on in System Settings, Keyboard,
    Dictation, then press the mic again.** Elsewhere (rare): **{browser}’s speech recognition isn’t available right now.**
  - A language it can't do (after trying the browser's own): **Dictation can’t understand {lang} here yet.**

## The microphone's page (mic.html: Chrome and Edge the first time)

Chrome can't ask for the microphone inside the side panel, so the first press opens this in a tab beside the page.
It asks at once, and closes itself once allowed (the panel then starts listening).

- Tab title and heading: **Allow the microphone**
- **So you can talk to TRIF’s message box instead of typing.**
- The same where-the-audio-goes line as above (Chrome / Edge).
- While the browser asks: **Choose Allow when {browser} asks.**
- Allowed: **Microphone allowed. Taking you back…**
- The question closed without an answer: **You closed the question without answering.** with **Ask again** and
  **Close this tab**
- Blocked: the red blocked line above, with **Open microphone settings** and **Close this tab**
- No microphone: the red no-microphone line, with **Ask again** and **Close this tab**

## Later (not in this branch)

- **Firefox**: no speech recognition in Firefox, so no button there for now. Later: local transcription through the
  helper (the audio recorded in the panel, turned into text on the computer, e.g. whisper.cpp), which would also keep
  the audio off Google's and Microsoft's servers in the other browsers if Tim wants that as an option.
- Other Chromium browsers (Brave, Opera, Vivaldi, plain Chromium) have the recogniser but no service behind it: no
  button there either. Arc shows it (Chrome's service; unverified).
