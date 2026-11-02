// The pages timsrobot.com serves. Plain HTML and one small script; nothing loaded from anywhere else.

const STYLE = `
:root { color-scheme: light dark; --bg: #f6f6f4; --card: #fff; --fg: #1b1b1a; --muted: #6a6a66; --line: #ddddd8;
  --accent: #1f9d6b; --on-accent: #fff; --bad: #b3261e; }
@media (prefers-color-scheme: dark) { :root { --bg: #18181a; --card: #222225; --fg: #ececea; --muted: #a2a29d;
  --line: #3a3a3e; --accent: #43c98d; --on-accent: #04291c; --bad: #ff8a80; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.5 -apple-system, system-ui, "Segoe UI", sans-serif; }
main { max-width: 640px; margin: 0 auto; padding: 48px 16px 64px; }
h1 { font-size: 28px; margin: 0 0 4px; letter-spacing: -0.01em; }
.lead { color: var(--muted); margin: 0 0 28px; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 20px; }
label { display: block; font-weight: 600; margin: 0 0 6px; }
.hint { font-weight: 400; color: var(--muted); }
textarea, input[type=text], input[type=email] { width: 100%; font: inherit; color: inherit; background: var(--bg);
  border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; }
textarea:focus, input:focus { outline: 2px solid var(--accent); outline-offset: -1px; border-color: transparent; }
.field { margin: 0 0 18px; }
pre { margin: 8px 0 0; max-height: 260px; overflow: auto; background: var(--bg); border: 1px solid var(--line);
  border-radius: 8px; padding: 10px 12px; font: 12px/1.45 ui-monospace, Menlo, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
details summary { cursor: pointer; color: var(--muted); }
.check { display: flex; gap: 8px; align-items: center; font-weight: 400; }
button { font: inherit; font-weight: 600; border: 0; border-radius: 8px; padding: 10px 20px; background: var(--accent);
  color: var(--on-accent); cursor: pointer; }
button:disabled { opacity: .6; cursor: default; }
.note { color: var(--muted); font-size: 13px; margin: 12px 0 0; }
.error { color: var(--bad); }
.done h2 { margin: 0 0 6px; font-size: 20px; }
.trap { position: absolute; left: -10000px; width: 1px; height: 1px; overflow: hidden; }
a { color: var(--accent); }
code { font: 13px ui-monospace, Menlo, monospace; }
`;

function page(title, body, { script = false } = {}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
${body}
</main>${script ? '\n<script src="/report.js"></script>' : ''}
</body>
</html>
`;
}

export const HOME = page("Tim's Robot Internet Fixer", `
<h1>Tim's Robot Internet Fixer</h1>
<p class="lead">TRIF customizes any website with mods written by your own coding agent. In beta.</p>
<div class="card">
  <p style="margin:0">Something wrong? <a href="/report">Report a problem</a>.</p>
</div>`);

export const REPORT = page('Report a problem · TRIF', `
<h1>Report a problem</h1>
<p class="lead">Tell the TRIF developer what went wrong.</p>
<form id="form" class="card" novalidate>
  <div class="field">
    <label for="what">What went wrong?</label>
    <textarea id="what" rows="6" maxlength="5000" required
      placeholder="What you did, what you expected, and what happened instead."></textarea>
  </div>
  <div class="field">
    <label for="site">Which site? <span class="hint">(optional)</span></label>
    <input id="site" type="text" maxlength="200" placeholder="e.g. x.com" autocomplete="off">
  </div>
  <div class="field">
    <label for="email">Your email <span class="hint">(optional, if you'd like a reply)</span></label>
    <input id="email" type="email" maxlength="200" autocomplete="email">
  </div>
  <div class="field" id="details-field" hidden>
    <label class="check"><input id="include" type="checkbox" checked> Include details from TRIF</label>
    <details>
      <summary>What's included</summary>
      <pre id="details"></pre>
    </details>
  </div>
  <div class="field" id="paste-field">
    <label for="pasted">Details from TRIF <span class="hint">(optional)</span></label>
    <textarea id="pasted" rows="4" maxlength="30000"
      placeholder="If you can, paste what this Terminal command prints: ~/.trif/bin/trif report"></textarea>
  </div>
  <div class="trap" aria-hidden="true"><label for="website">Website</label><input id="website" type="text" tabindex="-1" autocomplete="off"></div>
  <button id="send" type="submit">Send report</button>
  <p id="status" class="note" role="status">The report goes to the TRIF developer and nowhere else. The details list
    versions, setup checks, the site's mods and recent errors, without your name or full page addresses.</p>
</form>
<div id="done" class="card done" hidden>
  <h2>Thanks, it's sent.</h2>
  <p style="margin:0">Thanks for helping make TRIF better. If you left your email, you may hear back.</p>
</div>`, { script: true });

// The form's script. Details from TRIF arrive after the # (r=<report>&s=<site>): browsers never send
// that part to a server, so nothing leaves the computer until the person presses Send.
export const REPORT_JS = `(() => {
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.hash.slice(1));
  const details = params.get('r') || '';
  if (params.get('s')) $('site').value = params.get('s');
  if (details) {
    $('details').textContent = details;
    $('details-field').hidden = false;
    $('paste-field').hidden = true;
  }
  if (location.hash) history.replaceState(null, '', location.pathname); // not kept in the address bar or history
  $('what').focus();

  const status = (msg, bad) => { $('status').textContent = msg; $('status').classList.toggle('error', !!bad); };
  $('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if ($('what').value.trim().length < 3) { status('Please say what went wrong.', true); $('what').focus(); return; }
    $('send').disabled = true;
    status('Sending…');
    const body = {
      what: $('what').value, site: $('site').value, email: $('email').value, website: $('website').value,
      details: details ? ($('include').checked ? details : '') : $('pasted').value,
    };
    try {
      const res = await fetch('/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const r = await res.json().catch(() => ({}));
      if (!res.ok || !r.ok) throw new Error(r.error || 'The report couldn’t be sent (' + res.status + ').');
      $('form').hidden = true;
      $('done').hidden = false;
    } catch (err) {
      $('send').disabled = false;
      status(err.message + ' You can also email it to reports@timsrobot.com.', true);
    }
  });
})();
`;
