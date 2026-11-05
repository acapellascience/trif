# Examples

Ready-made mods. `trif setup` adds all of them to a new workspace once, **switched off**: turn one on
with its switch in the side panel (`--no-examples` skips them). Or copy one in yourself with
`trif install-example <site>/<mod>`, then reload the site.

| Mod | What it does |
|---|---|
| `x.com/detox-timeline` | **Detox Timeline.** Home is just the people you follow, sorted Recent, filtered before X sees the data: no ads, no who-to-follow, and every kind of post off to start (the plainest timeline: original text posts from people who follow you back), with a "Filters" menu to turn each back on (reposts, quotes, replies, conversations, long posts, links, videos, images, non-mutuals). Also hides the trends column, widens the timeline, cleans ads and "Discover more" from post pages and profiles, tucks replies from people you don't follow into a collapsed section, turns Explore into a plain search field, and plays YouTube cards in place. |
| `x.com/follow-status` | **Follow status.** Marks the people who follow you back. |
| `x.com/space-shooter` | **X-Flyer.** Shift+S (or the rocket button) flies a fighter over X: blast the words. |
| `www.instagram.com/three-column-feed` | **Three-Column Feed.** The home feed three posts wide, still scrolling. |
| `www.instagram.com/following-only-feed` | Home feed shows only people you follow: suggested posts, suggested accounts and ads are removed from the feed data. |
| `www.instagram.com/hide-reposts` | Removes reposts (posts shown because someone you follow reposted them), unless you follow the author too. |
| `www.instagram.com/hide-ai-content` | Removes posts labeled "AI content", and posts by accounts labeled as AI, from feeds and grids. |
| `www.instagram.com/desaturate` | Turns Instagram's colour down to 35% saturation. |

```sh
trif install-example x.com/detox-timeline
trif reload --url x.com
```

To turn one off, use its switch in the side panel (or `trif disable x.com/detox-timeline`); to remove it,
delete `~/.trif/sites/<site>/<mod>.js`.

Each example is a single plain JavaScript file with a `// ==WebMod==` header; read it to see how it
works, or ask your coding agent to change it. Timeline Detox's tests live in `tests/detox-timeline.test.js`
(`node --test tests/`).

Their headers say `// @source webmods` and `// @version <n>`: that marks them as shipped by TRIF.
When a new TRIF version brings a changed example, setup replaces your copy if you never changed it,
and otherwise leaves it alone and offers the new version in the side panel (use it, keep yours, or have
your agent merge the two). Changing an example here: raise its `@version`, commit, then run
`node scripts/shipped-history.js` (releases do this too) so setup can recognise every version it shipped.
Folding one example into another: keep the id that fits best, raise its `@version`, delete the other
file and add it to `RETIRED` in `helper/lib/preinstalled.js` (unchanged copies then go to the trash,
edited ones stay; see docs/PROTOCOL.md, "Retired mods").
