// Shared by the popup and the report page: one run of the checks as a list.
'use strict';
function renderRun(run, into) {
  into.replaceChildren();
  if (!run) return;
  if (run.error) { const p = document.createElement('p'); p.textContent = run.error; into.append(p); return; }
  const head = document.createElement('p'); head.className = 'dim';
  head.textContent = `${run.url} · ${run.at}`;
  into.append(head);
  let group = null;
  for (const r of run.results) {
    if (r.group !== group) { group = r.group; const h = document.createElement('h3'); h.textContent = group; into.append(h); }
    const row = document.createElement('div'); row.className = `check ${r.answer}`;
    const b = document.createElement('b'); b.textContent = r.answer;
    const d = document.createElement('div'); d.className = 'detail';
    d.textContent = typeof r.detail === 'string' ? r.detail : JSON.stringify(r.detail, null, 1);
    row.append(b, document.createTextNode(` ${r.title}`), d);
    into.append(row);
  }
}
