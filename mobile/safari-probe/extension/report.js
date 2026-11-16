'use strict';
const api = globalThis.browser ?? globalThis.chrome;
const $ = (id) => document.getElementById(id);
const say = (text) => { $('status').textContent = text; };

async function load() {
  const report = await api.runtime.sendMessage({ type: 'report' });
  const text = JSON.stringify(report, null, 1);
  $('json').value = text;
  const sum = $('summary');
  sum.replaceChildren();
  const line = (t) => { const p = document.createElement('p'); p.textContent = t; sum.append(p); };
  const loads = report.loads || [];
  const withRules = loads.filter((l) => l.rules > 0 && l.applied);
  const beat = withRules.filter((l) => l.paintMs === null || l.applied.ms <= l.paintMs).length;
  line(`${(report.runs || []).length} run(s) of the checks, ${loads.length} page load(s) timed, ${(report.picks || []).length} thing(s) hidden by pointing, ${(report.modLinks || []).length} mod link(s) seen.`);
  line(`Background started ${(report.bgStarts || []).length} time(s); its alarm fired ${(report.alarmFires || []).length} time(s).`);
  if (withRules.length) line(`Hide rules were in before the first paint on ${beat} of ${withRules.length} load(s) that had rules.`);
  const stale = loads.filter((l) => l.after && l.after.matches && l.after.matches.some((m) => m.matches === 0)).length;
  if (withRules.length) line(`Loads where a saved rule no longer found anything: ${stale}.`);
  for (const run of (report.runs || []).slice().reverse()) {
    const h = document.createElement('h2'); h.textContent = `Checks on ${run.page ? `the ${run.page} page` : new URL(run.url).hostname}`;
    const box = document.createElement('div');
    sum.append(h, box);
    renderRun(run, box);
  }
  return text;
}

(async () => {
  let text = await load();
  $('copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(text); say('Copied.'); } catch (e) { $('json').select(); say(`Couldn't copy by itself (${e.message}): the text below is selected, copy it by hand.`); }
  });
  $('share').addEventListener('click', async () => {
    try { await navigator.share({ title: 'TRIF Probe report', text }); } catch (e) { say(`No sharing here (${e.message}).`); }
  });
  $('clear').addEventListener('click', async () => { await api.runtime.sendMessage({ type: 'clear' }); text = await load(); say('Cleared.'); });
})();
