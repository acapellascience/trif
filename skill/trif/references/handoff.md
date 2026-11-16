# Handing the mod to TRIF

You can't add a mod to TRIF yourself, and you shouldn't try: no other program can reach into TRIF, and the user
is the one who decides what runs on their sites. You give them **one file**, and they add it in TRIF's side panel
in a couple of clicks.

## The file

- One mod, complete: header first. Named `<what-it-does>.js` in kebab-case (`calmer-timeline.js`): TRIF names the
  mod after the file (a site in front, like `x.com-calmer-timeline.js`, ends up in the mod's name).
- Its `@match` lines name one site (or several domains of one site): TRIF files it under that site. A mod for many
  sites: `@match *://*/*` (TRIF asks the user where to file it, and offers "all-sites").
- Checked (`scripts/check-mod.js`, or by hand against references/checks.md).
- Keep the text exactly as you tested it; don't retype it from memory.

## Getting the file to the user

Use the first of these you can:

1. **TRIF's workspace, directly** (Claude Code or Cowork on the user's computer, with access to `~/.trif/sites/`):
   save it as `~/.trif/sites/<site>/<mod>.js`. TRIF picks it up at once; it arrives switched off. Don't touch
   anything else in `~/.trif` (`held.json`, `allowed.json` and the like are TRIF's). With the `trif` command,
   `trif import <file>` does the same from anywhere.
2. **A file you save for the user**: your own outputs or files folder, a file the chat offers for download
   (claude.ai, Cowork, and Claude in Chrome when its session can save files). Say its name.
3. **From the page** (Claude in Chrome, when you can't save files any other way): paste
   `scripts/page/download.js`, then `__trifDownload('calmer-timeline.js', MOD_TEXT)` with the whole file's text.
   The browser saves it in the user's downloads (it may ask them first). This passes through the page's own
   world: on a site the user doesn't trust, prefer 2 or 4.
4. **In the chat**, as one code block, when nothing above works: the user saves it as a `.js` file (any text
   editor), then adds it as below. Keep it short enough to copy in one go.

## What to tell the user

In a few plain lines (adapt, don't paste):

- what the mod does, as they'd say it;
- how to add it: "Open TRIF's side panel on the site (the robot button in the toolbar, or in the puzzle-piece Extensions menu). If TRIF isn't on for the
  site yet, click Fix <site> first. Then click ⋯ next to *Mods on this site* → *Import mod…* and choose the file;
  or drag the file onto TRIF's panel." In Claude in Chrome: your panel and TRIF's share Chrome's side panel, so
  they switch to TRIF's with its toolbar button, and back to yours the same way;
- that it arrives **switched off**: they turn it on with its switch in TRIF's panel, and the page reloads;
- if TRIF will **hold** it (a free mod that can send, click, navigate or load; a boxed mod with powers that ask),
  what it can do and why it needs to, in a sentence, and that TRIF will show them what it found and ask. It's
  their call: don't tell them to allow it;
- if a mod of the same name is there already, TRIF asks whether to add a copy or replace it (the old one is
  kept in its history);
- what you couldn't test.

After they've added it: if they're on the page with you, look again (a count, a screenshot) to confirm it works
as TRIF runs it, now that your preview is gone. If something's off, fix the file and hand it over again; TRIF
asks whether to replace the one they have.
