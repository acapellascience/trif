# Examples

Ready-made mods. They aren't installed automatically; copy one into your workspace with
`webmods install-example <site>/<mod>`, then reload the site.

| Mod | What it does |
|---|---|
| `x.com/plain-x` | **Plain X.** Home is just the people you follow, sorted Recent, filtered before X sees the data: no ads, no who-to-follow, reposts hidden by default, plus a "Filters" menu (reposts, quotes, replies, conversations, long posts, links, videos, images). Also hides the trends column, widens the timeline, cleans ads and "Discover more" from post pages and profiles, tucks replies from people you don't follow into a collapsed section, turns Explore into a plain search field, and plays YouTube cards in place. |

```sh
webmods install-example x.com/plain-x
webmods reload --url x.com
```

To turn one off, delete `~/.webmods/sites/<site>/<mod>.js` or rename it with a leading underscore
(`_plain-x.js`).

Each example is a single plain JavaScript file with a `// ==WebMod==` header; read it to see how it
works, or ask your coding agent to change it. Plain X's tests live in `tests/plain-x.test.js`
(`node --test tests/`).
