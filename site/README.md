# timsrobot.com

The report form's website: a Cloudflare Worker that serves `timsrobot.com` (a home page) and
`timsrobot.com/report` (the form), and emails each report to the maintainer from `reports@timsrobot.com`.
It also answers for `webmods.dev`, the address from before 0.2.0 (when TRIF was called WebMods), redirecting
every request there to the same path on `timsrobot.com`, so older installs' "Report a problem" still works.

- `src/index.js`: routes. `GET /`, `GET /report`, `GET /report.js`, and `POST /report` (JSON: `what`,
  `site`, `email`, `details`, plus `website`, a hidden field only bots fill in).
- `src/pages.js`: the pages and the form's script. Nothing is loaded from anywhere else.
- `src/report.js`: checking a report and writing its email (tested in `tests/site.test.js`).

The side panel's "Report a problem" (and `trif report --open`) opens `/report#r=<report>&s=<site>`.
Browsers never send what's after the `#` to the server, so nothing leaves the computer until Send.

Reports are limited to 5 a minute per address, 64 KB each.

## Try it locally

```sh
node site/dev.js
```

Then open http://127.0.0.1:8787/report. Reports are printed in the terminal instead of emailed.

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
