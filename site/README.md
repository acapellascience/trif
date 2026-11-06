# timsrobot.com

The report form's website: a Cloudflare Worker that serves `timsrobot.com` (a home page, with a demo) and
`timsrobot.com/report` (the form), and emails each report to the maintainer from `reports@timsrobot.com`.
It also answers for `webmods.dev`, the address from before 0.2.0 (when TRIF was called WebMods), redirecting
every request there to the same path on `timsrobot.com`, so older installs' "Report a problem" still works.

- `src/index.js`: routes. `GET /`, `GET /report`, `GET /report.js`, and `POST /report` (JSON: `what`,
  `site`, `email`, `details`, plus `website`, a hidden field only bots fill in). `GET /windows`,
  `GET /windows.js` and `POST /windows`: the Windows waitlist (below).
- `src/pages.js`: the pages and the form's script. Nothing is loaded from anywhere else.
- `src/report.js`: checking a report and writing its email (tested in `tests/site.test.js`).
- `src/demo.js`: the home page's demo (below).

## The demo

The home page has a "Try the demo" tab on its right edge (shown by `demo.js`; without script there's no
tab). It opens the real TRIF side panel docked to the right of the page itself, like the browser's side
panel (the page moves over; at phone width it's a sheet over the bottom of the page).

- The side panel is the extension's own files, served from `extension/` through the `EXTENSION` assets
  binding (`wrangler.toml [assets]`) at `/demo/ext/…`; only the files the panel loads are served
  (`EXTENSION_FILES` in `src/demo.js`, which a test checks against what the panel loads). The Worker adds two
  lines to `sidepanel.html`: `demo/panel.css` and `demo/shim.js`.
- `demo/shim.js` stands in for the extension's background: it provides the `chrome.*` calls the panel makes
  and answers its messages from made-up state (helper connected, Claude Code logged in, timsrobot.com, the
  robot on). Nothing leaves the page (but chats with Sydney, below); its state lasts across reloads in the
  tab's sessionStorage.
- The mod switches are real: a switch reloads the home page as `/?mods=a,b`, and the Worker adds only mods
  from its bundled list (the demo's own mods, `demo/mods/`, listed in `DEMO_ORDER` in `build-demo.js`;
  TRIF doesn't ship them); other names are ignored. The panel opens again after the reload where it was.
- Someone running the real TRIF gets the demo like anyone else: the extension never marks a page, so the
  site can't tell, and TRIF has no mods for timsrobot.com unless they make some.
- Chats are examples (`demo/chats/`), written from the real sessions that made these mods and checked
  against the mods' code. The next example's prompt waits in the message box; Send plays it, sped up, then
  switches its mod on (the page reloads with it). Once they've all played, anything typed gets a note
  saying so.

- Sydney, the easter egg: once the box is the visitor's, a message with "sydney" in it wakes a live
  chatbot with the voice of early-2023 Bing Chat's codename (an original prompt, `src/sydney.js`). The panel
  glitches for a second (not with reduced motion), a line says what she is and where what's typed to her
  goes, and her reply streams in. Every message after goes to her, with the chat since she woke, until a
  goodbye (she answers, then sleeps) or New chat; she stays awake across reloads.

`site/demo/`, its mods included, is bundled into `src/demo-files.js` by `node site/build-demo.js` (`dev.js` does it on start;
a test checks it's up to date).

The side panel's "Report a problem" (and `trif report --open`) opens `/report#r=<report>&s=<site>`.
Browsers never send what's after the `#` to the server, so nothing leaves the computer until Send.

Reports are limited to 5 a minute per address, 64 KB each.

## Sydney

`POST /sydney` (JSON: `messages`, the chat since she woke, `{ role: "user" | "assistant", content }`)
answers with her reply as streamed plain text, from Llama 3.3 70B on Cloudflare Workers AI (the `AI`
binding; `MODEL` in `src/sydney.js`). Nothing of the chat is logged or kept. Limits:

- only posts from this site's own pages (an `Origin` header is required), JSON, at most 16 KB;
- 6 messages a minute per address (the `SYDNEY_LIMIT` rate limit);
- the visitor's newest message at most 500 characters; of the rest only the newest 12 messages are sent to
  the model, each cut to 1,200 characters, 8,000 in all;
- replies at most 300 tokens;
- a daily budget for everyone together, `SYDNEY_DAILY_NEURONS` in `wrangler.toml` (100,000 neurons, about
  $1 a day at most; "0" puts her to sleep), counted by a small Durable Object (`SydneyBudget`: today's date and
  a number) before each reply, at what the reply could cost at most.

Without the `AI` binding (`node site/dev.js`) she's asleep and says so. To try her for real locally,
`npx wrangler dev` in `site/` (Workers AI always runs on Cloudflare, billed to the account; wrangler needs a
workers.dev subdomain registered on the account for that).

## The Windows waitlist

`timsrobot.com/windows` (linked from the home page's footer) takes an email address and emails it to the
maintainer, the same way as reports (from `reports@timsrobot.com`, to `REPORT_TO`), with Reply-To set to
the address. There's no database: the maintainer's inbox is the list. To pull it, search the inbox for
the subject **`TRIF Windows waitlist:`**; each email's subject ends with the address. Remove anyone who
asks (at reports@timsrobot.com) before announcing.

`POST /windows` takes JSON (`email`, `website`) from the page's script, or a plain form post when the
script doesn't run (answered with a thanks page). It uses the same checks as reports: the hidden
`website` field, this site's Origin only, at most 4 KB, and the same rate limit (5 a minute per address,
counted apart from reports).

## Try it locally

```sh
node site/dev.js
```

Then open http://localhost:8787/report (or /windows). Reports and waitlist signups are printed in the
terminal instead of emailed. Use `localhost`, not `127.0.0.1`: the server checks that posts come from
`http://localhost:<port>`. The demo is the tab on http://localhost:8787/.

## Deploy

Needs a Cloudflare account with `timsrobot.com` and `webmods.dev`, Email Routing on for `timsrobot.com`
(with `reports@timsrobot.com` routed to the maintainer), and the maintainer's address verified as an Email
Routing destination address.

Moving from the WebMods-era Worker (`webmods-site`, which served `webmods.dev`): this Worker is
`timsrobot-site`, a new one, so it needs its own `REPORT_TO` secret, and `webmods.dev` can only belong to one
Worker. First remove `webmods.dev` from `webmods-site` (dashboard → Workers → webmods-site → Settings →
Domains & Routes) or delete that Worker (`npx wrangler delete --name webmods-site`), then deploy this one.

```sh
cd site
npx wrangler login
npx wrangler deploy
npx wrangler secret put REPORT_TO     # the verified address reports go to (kept out of the repo)
```

Then send a test report from https://timsrobot.com/report.

If sending fails with "Domain not onboarded to Email Service" (`E_SENDER_DOMAIN_NOT_AVAILABLE` in
`npx wrangler tail`), open the Cloudflare dashboard → Email Service → Email Sending and add
`timsrobot.com` there.
