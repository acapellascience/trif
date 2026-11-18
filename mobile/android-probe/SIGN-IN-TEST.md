# Sign-in test (part A): for Tim

Can people sign in to Google, Claude and ChatGPT inside an Android app built on Android's own web view?
This screen lets you try it. You type your own passwords; nothing here types, reads or keeps them. The log
keeps only what you tap (PASS/FAIL), the step, the user agent and the page's address without its query.

## Start it

In Terminal:

    ~/WebMods-worktrees/android-probe/mobile/android-probe/signin.sh

An Android phone window opens (the first start takes a minute or two) with the probe's sign-in screen:
three rows of buttons above a web page.

## What to tap

Row 1 picks the **user agent** (how the app introduces itself to sites). Row 2 picks a **step**. Row 3 has
**PASS**, **FAIL**, **back** and **clear cookies**.

For each user agent, left to right (`default`, then `no-wv`, then `no-wv+hints`):

1. Tap **clear cookies**, then the user agent's button.
2. **1 Google itself**: sign in to your Google account. Then **1b then YouTube**: are you signed in there?
3. **2 Claude + Google**: tap "Continue with Google".
4. **3 ChatGPT + Google**: tap "Continue with Google".
5. **4 Claude + email code**: "Continue with email". Open the link from the email anywhere (your Mac is
   fine), then type the six-digit code Claude shows into the probe.
6. **5 chat pane**: a second web view opens over the bottom of the screen. Is it already signed in to
   Claude?

After each step, tap **PASS** (signed in) or **FAIL** (not). On a failure, note what Google said, for
example `disallowed_useragent` or "This browser or app may not be secure".

You can stop after the first user agent that passes everything. If `default` fails at step 1, that's the
interesting case: carry on with the other two.

## What to report

Run this and paste the output in the chat, plus what Google said on any failure:

    ~/WebMods-worktrees/android-probe/mobile/android-probe/signin.sh log

When you're done: `~/WebMods-worktrees/android-probe/mobile/android-probe/signin.sh stop`.

Use a Google account you're happy to sign in to on a test device. The emulator keeps the sign-ins until
it's wiped.
