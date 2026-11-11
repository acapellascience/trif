# Tier names: the strings that changed (branch tier-names)

**Approved by Tim, 2026-11-10** (the Boxed line ⚑ in the wording he chose: "Run in TRIF's sandbox: they change what the page shows, and do only what you've allowed.", in extension/sidepanel.js).

Rules → **Style mods**, Sandboxed → **Boxed mods**, Page scripts → **Free mods**. Only what people (and
agents) read changed: stored values, message types, identifiers and file formats keep rules / sandboxed /
page, so nobody's switches move. Headers: `@style` and `@boxed` are new; `@rules` and `@sandboxed` work
for good. Flags: `--style` and `--boxed` are new; `--rules` and `--sandboxed` still work.

**Awaiting Tim's OK**: the two group lines marked ⚑ (they replace "can't send, click or load anything",
which the red team showed overstated).

## Side panel

| where | before | after |
|---|---|---|
| group heading (shown in capitals) | Rules | Style mods |
| | Sandboxed | Boxed mods |
| | Page scripts | Free mods |
| ⚑ Style line | Run by TRIF from data: they can't send, click or load anything. | Run by TRIF from data: they change how the page looks, and can't send, load or click anything themselves. |
| ⚑ Boxed line | Run in TRIF's sandbox: they can't send, click or load anything. | Run in TRIF's sandbox: they change what the page shows, and can't send, load or click anything themselves. |
| Free line | Run in the page with everything it has. | (unchanged) |
| group switch error, in the chat | Couldn't switch Rules / Sandboxed / Page scripts on: … | Couldn't switch Style mods / Boxed mods / Free mods on: … |

## Settings

| where | before | after |
|---|---|---|
| New mods start, rows | Rules · Sandboxed · Page scripts | Style mods · Boxed mods · Free mods |

## Holds and tooltips

| where | before | after |
|---|---|---|
| "new" tag tooltip | New rules / sandboxed mods / page scripts start off (Settings): switch it on once you've looked at it. | New style mods / boxed mods / free mods start off (Settings): … |
| hold without the sandbox (Safari), first fact | Safari can't run sandboxed mods, so here it would run as a page script, with everything the page has | Safari can't run boxed mods, so here it would run as a free mod, with everything the page has |
| same, each further fact | as a page script, it … | as a free mod, it … |
| same, note | Allow runs this version as a page script, in this browser only. | Allow runs this version as a free mod, in this browser only. |
| agent switching on a new mod (error) | …(their setting: new rules / sandboxed mods / page scripts start off)… | …(their setting: new style mods / boxed mods / free mods start off)… |
| background warnings (helper.log) | …(sandboxed mods wait for your OK to run as page scripts) · …so sandboxed mods' settings can't be kept… · sandboxed mods' errors/logs: … | …(boxed mods wait for your OK to run as free mods) · …so boxed mods' settings… · boxed mods' errors/logs: … |
| a mod's error with no mod to name | (a sandboxed mod) | (a boxed mod) |

## CLI (trif)

| where | before | after |
|---|---|---|
| status `GROUPS OFF` / `NEW MODS` | rules · sandboxed mods · page scripts | style mods · boxed mods · free mods |
| status `NO SANDBOX` | …can't run sandboxed mods: each waits for the user's OK (in the side panel) to run as a page script instead | …can't run boxed mods: …to run as a free mod instead |
| status, after `registered` | (sandboxed) · (sandboxed mod, run as a page script: the user allowed it, as this browser has no sandbox) | (boxed) · (boxed mod, run as a free mod: …) |
| mods, kind line | kind: rules (data TRIF runs; …) · kind: sandboxed (runs in TRIF's sandbox…) | kind: style mod (…) · kind: boxed mod (…) |
| check | …is a rules mod and its rules check out · …is a sandboxed mod and parses | …is a style mod and its rules check out · …is a boxed mod and parses |
| check, lint intro | …see "Sandboxed mods" in TECHNIQUES.md, or make it a page script if it really needs them | …see "Boxed mods" in TECHNIQUES.md, or make it a free mod if… |
| check, lint lines | not there in a sandboxed mod · a sandboxed mod can't click for the user / act for the user / submit · not offered in a sandboxed mod | …boxed mod… (same sentences) |
| both headers (check, and NOT SENT) | a mod is either @rules (data) or @sandboxed (JavaScript in TRIF's sandbox), not both | a mod is either a style mod (@style) or a boxed mod (@boxed), not both |
| style mod errors (NOT SENT, check) | a @rules mod needs a JSON object after its header · …(rules mods have css, …) · …only data: is allowed in a rules mod | a style mod needs… · …(style mods have …) · …in a style mod |
| new, usage | trif new <site> <mod> [--rules \| --sandboxed] | trif new <site> <mod> [--style \| --boxed] |
| new, summary | …(--rules: a rules mod, data instead of code; --sandboxed: JavaScript in TRIF's sandbox) | …(--style: a style mod, data instead of code; --boxed: a boxed mod, JavaScript in TRIF's sandbox) |
| new, details | …--rules makes a rules mod … --sandboxed makes a sandboxed mod … rules, then sandboxed, then a page script. | …--style makes a style mod … --boxed makes a boxed mod … Without either, a free mod … style, then boxed, then free. (--rules and --sandboxed are the old names…) |
| new, examples | …--rules · …--sandboxed | …--style · …--boxed |
| new, usage error | --rules or --sandboxed, not both | --style or --boxed, not both |
| check, help | A rules mod: its rules checked. A sandboxed mod (@sandboxed): … | A style mod: its rules checked. A boxed mod (@boxed): … |

## Templates (`trif new`)

| template | before | after |
|---|---|---|
| style | `// @rules` | `// @style` |
| boxed | `// @sandboxed` | `// @boxed` |
| boxed, comment | A sandboxed mod: this runs in TRIF's sandbox… So it can't send, click, navigate or load anything, and it never waits for the user's OK. … See "Sandboxed mods" in TECHNIQUES.md. | A boxed mod: this runs in TRIF's sandbox… It changes what the page shows, and can't send, load or click anything itself, so it never waits for the user's OK. … See "Boxed mods" in TECHNIQUES.md. |
| free, first comment | This file runs in the page itself… | A free mod: this file runs in the page itself… |

## For agents and in the docs (prose; listed, not quoted)

- AGENTS.md: the group names, "Write the lowest kind of mod" (style, boxed, free; old names still work),
  `--style` / `--boxed`.
- TECHNIQUES.md: "Rules mods: start here" → "Style mods: start here"; "Sandboxed mods: when rules aren't
  enough" → "Boxed mods: when a style mod isn't enough"; examples use `@style` / `@boxed`.
- CHANGELOG Unreleased: summary "two groups, Rules and Page scripts" → "three groups, Style, Boxed and Free
  mods"; "set Page scripts to start off" → "set Free mods to start off"; the `### More` group and New mods
  start bullets (the Boxed one now says "changes what the page shows but can't send, load or click anything
  itself"). Still under release.js's limits (summary passes; section 3887 of 3900 bytes).
- examples/sandboxed → examples/boxed; the ports are "Simple Shopping (boxed)", "DVD Logo (boxed)".
- docs: SAFE-MODS, PROTOCOL, SANDBOX-TIER-NOTES (prose renamed; a names note at the top of each design doc).


## Tier lines, shortened (Tim, 2026-11-11)

One line each in the mods box; the longer wording is behind "more" (extension/explain.json):
- Style mods: **Only change how the page looks.**
- Boxed mods: **Do only what you've allowed.**
- Free mods: unchanged, **Run in the page with everything it has.**
