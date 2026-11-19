# The mod file

<!-- Cut from TRIF's agent guide (AGENTS.md in helper/workspace/) by skill/build.js: don't edit here. -->

> From TRIF's own guide for coding agents. Where it says `trif <command>`, that's TRIF's command line on the
> user's computer: use it if you have it (Claude Code with TRIF installed). If you don't, do the same with your own
> tools: references/live-test.md says how. "The side panel" is TRIF's, and "a side-panel run" is TRIF's own chat,
> not you.

One file per customization: a header, then the mod.

## Mod files

```js
// ==WebMod==
// @name        Hide reposts
// @description Removes reposts from the X home timeline
// @match       https://x.com/*
// @match       https://twitter.com/*
// @run-at      document-start
// @risk        1 hides promoted posts, so their ad impressions never report
// ==/WebMod==

(() => {
  // ...
})();
```

- **One mod per customization**, in `sites/<site>/<mod>.js`, named in kebab-case for what it does
  (`hide-reposts.js`, `dark-wide.js`). The mod's id is `<site>/<mod>` (`x.com/hide-reposts`). Separate
  mods can be switched off separately (see "Switching mods off and on"); that is the point.
- The header is optional. Defaults: `@match` = `*://<site>/*` and `*://*.<site>/*` (the folder name and
  its subdomains); `@exclude` none; `@run-at document-start`; `@name` = file name; `@description` empty.
  `@match`/`@exclude` repeat and take Chrome match patterns. Add `@match` lines when a site has several
  domains (x.com and twitter.com).
- `@id <id>` is the mod's stable id: TRIF adds it when it writes a mod (an edit or a rename in the panel, an
  import, the phone). Keep that line exactly as it is when you edit a mod; never write one yourself, and never copy
  it into a new mod (a copy with the same id is taken for the same mod). To rename a mod, change its `@name` and
  leave the file name: the user's Rename in the mod's details moves the file.
- `@description` is **4 to 9 words**, in plain words, saying what the user will see ("Buttons wobble like
  jelly when you hover them"), not how the code does it; the side panel shows it under the mod's name.
  Not a sentence about every feature: keys, modes and details go in a comment in the file. Always
  include it, in every mod you write or edit, and update it when you change what the mod does (shorten
  a longer one when you edit that mod).
- `@risk <0|1|2> <why>` says how noticeable the mod is to the site (see "Account safety"). Always
  include it; the side panel shows a badge for 1 and 2.
- Wrap the body in an IIFE as above: early `return`s work, nothing leaks into the page's globals, and
  `trif check` can parse the file.
- Write a new mod's file directly, with the Write tool: the header, then the body. (`trif new <site>
  <mod>`, with `--style` or `--boxed`, writes a template instead, if you'd rather start from one; it's an
  extra step.)
- **Keep mods small.** A mod can be up to **4 MB**, and all mods together up to **16 MB**; past that it
  isn't sent to the browser (`trif status` says NOT SENT and why, `trif doctor` says what to do). Every
  mod's code is held by the browser several times over and handed to each page it matches, and every
  change to a mod sends all of it again, so size costs memory even when it's only data. Big media
  doesn't belong in a mod's code: make sounds with Web Audio and pictures with CSS, SVG or a canvas; if
  something must be embedded, compress it (a short Opus or MP3 clip, a small WebP) and keep it to a few
  hundred KB. Something big the user wants (a long track, a video) is loaded from where it lives, with
  their OK (see "Mods never send data anywhere"). Don't paste in libraries the mod doesn't need.

### Mods for several sites

A mod runs wherever its `@match` lines say, whatever its folder; the folder is its home (its id, and
where the user finds it on the TRIF setup page).

- **One site with several domains** (x.com and twitter.com, a site's country domains): the site's
  folder, with a `@match` per domain. The setup page lists it under that site, with a switch per domain.
- **Every site, or several unrelated sites** (dark mode everywhere, hide cookie banners on a few news
  sites): `sites/all-sites/` (`trif new all-sites <mod>`). Its default `@match` is `*://*/*`;
  narrow it to the sites that need it, and `@exclude` sites it breaks. The setup page groups these
  under "Every site" or "Several sites".
- The user can switch a mod off on one site and keep it on elsewhere (the side panel's switch on a
  multi-site mod is for the site it's on; see "Switching mods off and on"), so one mod for several
  sites is fine. Write separate mods when the change itself differs between sites.
- A mod that runs everywhere runs on the user's bank, email and work tools too: keep it render-only
  (`@risk 0`) unless they asked for more, cheap on pages it doesn't apply to, and quick to bail out
  (check `location.hostname` or for the elements it needs, and return).

### Phone mods

The panel's "Edit for mobile" opens TRIF's phone view: the user's tab in a window as wide as a phone, where the
site sees an iPhone (Safari's user agent, touch, no hover) and shows its mobile layout. It's a TRIF of its own:

- Phone mods live in the site's phone twin, `sites/phone~<site>/` (`trif new phone~x.com <name>`): a chat in
  the phone view can write there and nowhere else. Only phone mods run in the phone view, and they never run in
  a desktop tab. Their `@match` is the site's own (`*://x.com/*`). A phone mod for every site lives in
  `sites/phone~all-sites/` (its default `@match` is `*://*/*`).
- The site's desktop mods (`sites/<site>/`) are there to read, never to change, from the phone view. Asked to
  bring one to the phone ("the hide-reposts filter from the desktop"), read it for the idea, then build it again
  for the mobile page: look at the phone tab (`trif tabs` marks it `phone`; `--tab`), and assume nothing about
  its selectors, elements, routes or data: the mobile layout is a different page.
- Style sheets in the phone view still see a mouse (`@media (hover: hover)` matches there and not on the phone):
  don't key a mod on hover or pointer media queries.

### Sensitive sites

A host on the sensitive list (email, banking, password managers, chats: the user can edit it) is a site of
its own in TRIF, even under a bigger domain: mail.google.com isn't part of google.com. Its mods go in its
own folder (`trif new mail.google.com <mod>`, `sites/mail.google.com/`); google.com's mods and mods for all
sites don't run there, and its own mods run only there. TRIF starts each one blocked ("mail.google.com is
blocked in TRIF"): only the user can unblock it, in the side panel there. A side-panel run on such a host
is limited to it: its folder is the host's, and google.com's folder and tabs are another site's. Every mod
there starts off until the user switches it on, yours too, whatever "Mods your chat makes" says, and a change
you make to one that's on waits for them (the version before keeps running): when you finish, tell them it's
waiting and that they turn it on in the side panel.
