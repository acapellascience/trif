# Strings added by the review fixes (branch fable)

New text a person or an agent can see. None of it has been approved; the drafts are in the code as below.

## The panel

- Code card, beside "Tim's mod, v3" when the file isn't a version TRIF shipped: **Tim's mod, v3, changed**
  (extension/sidepanel.js).
- A hold's fact, when a side-panel run changed a free mod that runs on every site after the user allowed it
  (helper/lib/held.js): **runs on <all_urls>, outside x.com: your agent changed it since you allowed that**
- A hold's fact, when TRIF couldn't work out the holds (helper/lib/held.js heldOnError): **couldn't be
  checked (something went wrong in TRIF), so it waits**
- A hold's fact for a `click` line whose words are in quotes (helper/lib/boxpowers.js): **can click these for
  you: only what says "Show more" (button.more)**; a line without quotes reads as before, "the play button
  (button.play)".

## What agents read (errors from `trif`, and from the sandbox in `trif errors`)

- navigate, open: **x.com sent the tab on to elsewhere.example, which is outside x.com: TRIF stopped it there
  (an agent's navigation stays on its site, since an address can carry what the agent read)**
- navigate, open, where the rule can't be set: **TRIF couldn't keep tab 5's page loads to x.com (…), so it
  won't send the tab anywhere for an agent**
- screenshot: **tab 5 stopped being the one showing in its window while TRIF took the picture, so there's no
  picture: try again, or use `trif sweep` or `trif text`**
- delete, restore: **sites/m.x.com is a link, not m.x.com's own folder: ask the user to do it from their
  terminal**
- `trif mods`, `trif doctor`, the log, for a skipped file or folder: **ignored: the file has a line break, a
  control character or a hidden direction mark in its name**
- write-drafts: **a draft isn't changed while the user is pressing a button or Enter (it may be on its way
  out): change it as they type, or a moment later**
- click: **the header lets this mod click what says "Show more", and this says "delete"**; **…and a boxed mod
  changed what this says, so TRIF can't tell**
- style mods (`trif check`): **a quoted string that isn't closed on its line**; **a url() whose address has a
  quote, a space, a bracket, a backslash or /* in it (put the address in quotes)**; **image-set(), image(),
  cross-fade(), element() and src() can load from an address**; **a selector can't name the value attribute or
  :autofill (it would read what's typed in a field)**
- rewrite-requests: **"variables.__proto__.x" names __proto__, prototype or constructor, which aren't a
  request's own fields**
- an agent that's too old, at a run's start: the adapter's existing "is too old for TRIF" sentence, now shown
  there too.
