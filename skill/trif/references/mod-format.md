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
// @risk        1 hides promoted posts, so their ad impressions never report
// ==/WebMod==
(() => {
  // ...
})();
```

- **One mod per customization**, `sites/<site>/<mod>.js`, named for what it does. Its id is `<site>/<mod>`.
  Separate mods can be switched off separately.
- Header defaults: `@match` = the folder's site and its subdomains; `@run-at document-start`; `@name` = file
  name. `@match`/`@exclude` repeat (Chrome match patterns).
- `@description`: **4 to 9 plain words** on what the user will see. Always include it; update it when the mod
  changes.
- `@risk <0|1|2> <why>`: see "Account safety". Always include it.
- Free mods: wrap the body in an IIFE.
- Write the file directly. (`trif new <site> <mod> [--style|--boxed]` writes a template, if you want one.)
- **Keep mods small**: 4 MB each, 16 MB in all, or they aren't sent to the browser. No big media in code:
  Web Audio, CSS, SVG, canvas; compress anything embedded to a few hundred KB.

### Mods for several sites

A mod runs wherever its `@match` says; its folder is its home.
- One site, several domains: the site's folder, a `@match` per domain.
- Every site, or several unrelated ones: `sites/all-sites/` (default `@match` `*://*/*`; narrow it, and
  `@exclude` sites it breaks). Keep it render-only (`@risk 0`) unless asked, cheap, and quick to bail out:
  it runs on the user's bank and email too.
- Write separate mods only when the change itself differs between sites.

### Phone mods

The panel's "Edit for mobile" opens TRIF's phone view: a phone-width window where the site sees an iPhone.
- Phone mods live in `sites/phone~<site>/` (`trif new phone~x.com <name>`), the only folder a phone-view
  chat can write. They run only in the phone view; desktop mods never do. Their `@match` is the site's own.
- Desktop mods (`sites/<site>/`) are there to read. Asked to bring one to the phone,
  read it for the idea, then build it again for the mobile page you see (`trif tabs` marks the tab `phone`):
  assume nothing about its selectors or data.
- The phone view's style sheets still see a mouse: don't key on hover or pointer media queries.

### Sensitive sites

Hosts on the sensitive list (email, banking, password managers, chats) are sites of their own:
mail.google.com isn't part of google.com. Mods go in their own folder; other sites' and all-sites mods don't
run there. Each starts blocked until the user unblocks it, and every mod there starts off (yours too, and a
change to one that's on waits): tell the user it's waiting for them in the side panel.
