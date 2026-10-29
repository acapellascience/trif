# Examples

Ready-made mods. `webmods setup` adds all of them to a new workspace once, **switched off**: turn one on
with its switch in the side panel (`--no-examples` skips them). Or copy one in yourself with
`webmods install-example <site>/<mod>`, then reload the site.

| Mod | What it does |
|---|---|
| `x.com/plain-x` | **Plain X.** Home is just the people you follow, sorted Recent, filtered before X sees the data: no ads, no who-to-follow, reposts hidden by default, plus a "Filters" menu (reposts, quotes, replies, conversations, long posts, links, videos, images, non-mutuals). Also hides the trends column, widens the timeline, cleans ads and "Discover more" from post pages and profiles, tucks replies from people you don't follow into a collapsed section, turns Explore into a plain search field, and plays YouTube cards in place. |
| `www.instagram.com/following-only-feed` | Home feed shows only people you follow: suggested posts, suggested accounts and ads are removed from the feed data. |
| `www.instagram.com/hide-reposts` | Removes reposts (posts shown because someone you follow reposted them), unless you follow the author too. |
| `www.instagram.com/hide-ai-content` | Removes posts labeled "AI content", and posts by accounts labeled as AI, from feeds and grids. |
| `www.instagram.com/desaturate` | Turns Instagram's colour down to 35% saturation. |

```sh
webmods install-example x.com/plain-x
webmods reload --url x.com
```

To turn one off, use its switch in the side panel (or `webmods disable x.com/plain-x`); to remove it,
delete `~/.webmods/sites/<site>/<mod>.js`.

Each example is a single plain JavaScript file with a `// ==WebMod==` header; read it to see how it
works, or ask your coding agent to change it. Plain X's tests live in `tests/plain-x.test.js`
(`node --test tests/`).
