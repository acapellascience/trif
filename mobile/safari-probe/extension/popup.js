'use strict';
const api = globalThis.browser ?? globalThis.chrome;
const $ = (id) => document.getElementById(id);
const say = (text) => { $('status').textContent = text; };
const send = (m) => api.runtime.sendMessage(m);
const activeTab = async () => (await api.tabs.query({ active: true, currentWindow: true }))[0];

(async () => {
  const tab = await activeTab();
  $('where').textContent = tab && tab.url ? tab.url : 'This page isn\'t open to the extension yet: allow it for this site first.';

  $('run').addEventListener('click', async () => {
    say('Running: about ten seconds…');
    const run = await send({ type: 'runSuite', tabId: tab.id });
    say('');
    renderRun(run, $('results'));
  });
  $('pick').addEventListener('click', async () => {
    try { await api.tabs.sendMessage(tab.id, { type: 'pick' }); window.close(); } catch (e) { say(`The page didn't hear it (reload the page once): ${e.message}`); }
  });
  $('outline').addEventListener('click', async () => {
    const note = { at: Date.now() };
    try {
      const r = await api.scripting.executeScript({ target: { tabId: tab.id }, world: 'ISOLATED', func: () => (globalThis.__trifKit ? globalThis.__trifKit.outline(6000) : null) });
      const o = r && r[0] && r[0].result;
      if (!o) throw new Error('the page has no kit (reload it once)');
      note.chars = o.chars; note.tokens = o.tokens;
      await navigator.clipboard.writeText(o.text);
      note.copied = true;
      say(`Copied: ${o.lines} lines, ${o.chars} characters, about ${o.tokens} tokens.`);
    } catch (e) { note.error = e.message; say(`Couldn't copy: ${e.message}`); }
    send({ type: 'note', key: 'outlineCopy', value: note });
  });
  $('report').addEventListener('click', () => { api.tabs.create({ url: api.runtime.getURL('report.html') }); });
  $('forget').addEventListener('click', async () => {
    try { await send({ type: 'forgetRules', host: new URL(tab.url).hostname }); say('Forgotten. Reload the page to see it all again.'); } catch (e) { say(e.message); }
  });
})();
