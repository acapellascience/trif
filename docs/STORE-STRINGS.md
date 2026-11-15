# Chrome Web Store: strings (branch store)

Every string people see that this branch adds or changes, exact, old → new. **Awaiting Tim** (2026-11-15).
They're in the code meanwhile. Agent-only text (code comments, test names, `trif doctor`'s internal wording
for agents) isn't listed; doctor's and setup's lines are, since people read them in a terminal.

## How it works (decisions to check)

- **One place for the store ID:** `helper/lib/paths.js` `STORE_EXTENSION_ID` ('' until the first upload) and
  `STORE_LISTED` (false until the listing is public). With the ID, setup writes it into every native host
  manifest (the store's TRIF can reach the helper). Only with both does anything point people at the store:
  setup's steps, doctor's fix lines, the site's "Add to Chrome" button and `timsrobot.com/chrome`. Until then
  everything says Load unpacked, as today. A checkout (`trif setup` linked) always says Load unpacked.
- **Two TRIFs in one Chrome profile** (the unpacked one and the store's, while someone moves): each asks the
  other (only the TRIF IDs the helper names) where it runs mods; the unpacked one stops running mods on the
  sites the store's runs them on, and keeps the rest, so nothing runs twice and nothing stops before the
  store's TRIF has it. Both panels say to remove the unpacked one. Switches and chats don't carry over (Chrome
  keeps each extension's apart); carrying them is a possible follow-up.
- **Updates for store users:** Update in the panel updates the helper; the store's extension updates from the
  store after Google's review. The panel, `trif update` and `trif doctor` say so instead of "TRIF updated".

## Side panel (new)

The "installed twice" notice (red, above the other notices):

| Where | Words |
|---|---|
| Title (both) | **TRIF is installed twice** |
| In the unpacked TRIF | You also have TRIF from the Chrome Web Store. It runs your mods on the sites you’ve turned on there, and this copy (loaded unpacked) runs them on the rest. Turn your sites on there, then remove this copy. |
| Its button | **Remove this copy** (Chrome then asks to confirm) |
| In the store's TRIF, the unpacked one still running some sites | TRIF is also loaded unpacked in Chrome. It runs your mods on the sites you haven’t turned on here yet. Once they’re on here, remove it. |
| In the store's TRIF, the unpacked one running nothing | TRIF is also loaded unpacked in Chrome. It doesn’t run any mods now: remove it. |
| Its button | **Show it** (opens chrome://extensions at the unpacked TRIF) |

Updates, only for the store's TRIF:

| Where | Old | New |
|---|---|---|
| After Update | TRIF updated to 0.3.2 | **TRIF’s helper updated to 0.3.2** + note (while the extension is older): The extension itself updates from the Chrome Web Store. |
| Settings, the update line | TRIF 0.3.2, up to date. | TRIF 0.3.2, up to date. **The extension updates from the Chrome Web Store.** (added to every form of the line) |
| The update card when the extension is behind (`why`, from the helper; as Firefox's) | (none for Chrome) | The extension is still 0.3.1 (the helper is 0.3.2). Chrome updates it from the Chrome Web Store by itself, usually within a day or two of a release. |
| A command the extension doesn't know yet (agent/CLI error tail) | …: reload TRIF on chrome://extensions | …: Chrome updates it from the Chrome Web Store by itself, usually within a day or two of a release |

## Terminal

`trif setup`, next steps, **once the store is listed** (copy installs; the URL is the listing's):

```
  1. Install the extension from the Chrome Web Store (it just opened in Chrome): click "Add to Chrome".
       https://chromewebstore.google.com/detail/<id>
     Already have TRIF loaded unpacked? Install this one too, turn your sites on in it, then remove
     the unpacked one (its side panel says when). Or, to keep loading it unpacked: on chrome://extensions,
     turn on "Developer mode", click "Load unpacked" and choose <folder>
  2. Turn on "Allow User Scripts": … (unchanged)
  3. Check everything with: trif doctor
```

("(it just opened in Chrome)" only when it did: a Mac, at a terminal, Chrome installed.) Unlisted: unchanged.
From a checkout, step 1's first line: old **Install the extension. Until TRIF is on the Chrome Web Store, load
it unpacked:** → new **Install the extension. From a checkout, load it unpacked:**

Setup's wait line: old `Waiting for Chrome: drag the folder onto chrome://extensions…` → with the store:
`Waiting for Chrome: add TRIF from the Chrome Web Store…`

`trif update --install`, when a store TRIF is connected, after "updated TRIF a -> b…":
> The extension from the Chrome Web Store isn't updated here: Chrome updates it by itself once Google has reviewed the new version, usually within a day or two.

`trif doctor`:

| Check | Words |
|---|---|
| The extension line | `extension v0.3.1 on Chrome 142 (from the Chrome Web Store)` / `(loaded unpacked)` / `(loaded unpacked, a test build)` added |
| Install fix (helper not running), once listed | install the TRIF extension and turn it on at chrome://extensions/?id=… (from the Chrome Web Store, <url> (or Load unpacked from <folder>; its ID must be …)) |
| warn: installed twice | TRIF is installed twice in this Chrome profile: from the Chrome Web Store and loaded unpacked (the unpacked one leaves the sites the Web Store's runs mods on to it) · fix: turn your sites on in the Web Store's TRIF (its side panel), then remove the unpacked one: open chrome://extensions/?id=… and click Remove |
| warn: both connected, neither knows (an unpacked one older than 0.3.1) | Chrome has the unpacked TRIF (v…) and the Web Store's (v…) connected: if they're in the same profile, both run your mods · fix: remove the unpacked one in that profile: open chrome://extensions/?id=… and click Remove (turn your sites on in the Web Store's TRIF first) |
| info: store extension behind | the extension is v0.3.1 and the helper v0.3.2: Chrome updates the extension from the Chrome Web Store by itself, usually within a day or two of a release · fix: until it does, anything new in this release that needs the new extension waits (the helper's side works with the older one) |
| Mods too big for the extension, store | wait for Chrome to update TRIF from the Chrome Web Store (it does by itself, usually within a day or two of a release) |
| "Allow User Scripts" off / `trif status` | now opens the connected extension's own chrome://extensions page (the store's ID when it's the store's) |

## README

- Install step 1's last sentence: now "On a Mac it then opens TRIF's page on the Chrome Web Store in Chrome
  (or, to load it unpacked, shows the extension folder in Finder and opens `chrome://extensions`), and waits…"
- Step 2: **Add the extension to Chrome** from the Chrome Web Store: [Add TRIF to Chrome](https://timsrobot.com/chrome).
  (Until the listing is public, that link comes back here: load it unpacked, below.) — then the old Load
  unpacked text as **Or load it unpacked** (from a checkout, or if you'd rather), ending "TRIF's updates
  update this one too."
- New paragraph: **Moving from the unpacked TRIF to the Web Store's** (install it, turn your sites on, remove
  the unpacked one; nothing runs twice meanwhile; switches and chats stay with each).
- Updates: added "That updates the helper and, if you loaded the extension unpacked, the extension too. The
  Chrome Web Store's extension updates from the store, by itself, once Google has reviewed the new version
  (usually within a day or two), so for a while it can be a version behind the helper; the panel says so."
- After go-live: remove the "(Until the listing is public…)" sentence.

## timsrobot.com

- New pages: **/privacy** (store/PRIVACY.md as a page: "Privacy policy", "Last updated: …") and **/support**
  (Installing / If something's wrong / Asking for help: all the words in `site/src/pages.js` SUPPORT).
- New: **/chrome** redirects to the listing once it's public, else to the README's install steps.
- Home page footer: **Privacy** now links /privacy (was the GitHub file); new **Support** link.
- Home page button, once listed: **Add to Chrome** (to the listing) in place of **Get it**.

## The privacy policy (store/PRIVACY.md), brought up to 0.3.0

Changed: the date ("November 15, 2026 (TRIF 0.3.0)"); "or mods you add yourself"; "what the extension and its
helper do". Added: the Web Store's own updates; **Mods do what their code does** (style and boxed can't send;
free mods wait for OK; Tim's mods load only from their site, Profile Styler's pictures from X's image server);
rows **Tim's mods**, **Files you drop on the panel**, **Errors from mods**, **Another TRIF in the same
browser**; history and trash (30 days) in Your mods and in Keeping and deleting; the agent's per-site levels and
sensitive sites in Page content; screenshots in Chrome are of the tab you're on (copy windows only with every
site given in Chrome's settings); allowed.json and boxed mods' powers in Settings; **Robotless mode**.

## The store listing

All of `CHROMEWEBSTORE.md`'s Description, single purpose, permission justifications and test instructions
(new, for 0.3.x), in the old listing's voice. The images in `store/images/` (made-up site "The Daily Example",
a sample chat).
