# webmods.dev

The report form's website: a Cloudflare Worker that serves `webmods.dev` (a home page) and
`webmods.dev/report` (the form), and emails each report to the maintainer from `reports@webmods.dev`.

- `src/index.js`: routes. `GET /`, `GET /report`, `GET /report.js`, and `POST /report` (JSON: `what`,
  `site`, `email`, `details`, plus `website`, a hidden field only bots fill in).
- `src/pages.js`: the pages and the form's script. Nothing is loaded from anywhere else.
- `src/report.js`: checking a report and writing its email (tested in `tests/site.test.js`).

The side panel's "Report a problem" (and `webmods report --open`) opens `/report#r=<report>&s=<site>`.
Browsers never send what's after the `#` to the server, so nothing leaves the computer until Send.

Reports are limited to 5 a minute per address, 64 KB each.

## Try it locally

```sh
node site/dev.js
```

Then open http://127.0.0.1:8787/report. Reports are printed in the terminal instead of emailed.

## Deploy

Needs a Cloudflare account with `webmods.dev`, Email Routing on for it, and the maintainer's address
verified as an Email Routing destination address.

```sh
cd site
npx wrangler login
npx wrangler deploy
npx wrangler secret put REPORT_TO     # the verified address reports go to (kept out of the repo)
```

Then send a test report from https://webmods.dev/report.

If sending fails with "Domain not onboarded to Email Service" (`E_SENDER_DOMAIN_NOT_AVAILABLE` in
`npx wrangler tail`), open the Cloudflare dashboard → Email Service → Email Sending and add
`webmods.dev` there.
