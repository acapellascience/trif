const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const tasks = require('./tasks');
const origins = { wikipedia: 'https://en.wikipedia.org', hn: 'https://news.ycombinator.com', guardian: 'https://www.theguardian.com', testfeed: 'https://feed.example' };
const boxed = {
  'B1-feed-toggle': `const bar = page.find('aside.sidebar');
if (!bar) return;
const btn = page.create('button');
btn.setText('Hide sidebar');
btn.on('click', () => { if (bar.style('display') === 'none') { bar.show(); btn.setText('Hide sidebar'); } else { bar.hide(); btn.setText('Show sidebar'); } });
page.find('section[aria-label="Timeline"]').before(btn);`,
  'B2-wiki-wordcount': `const body = page.find('#mw-content-text');
const n = body.text.trim().split(/\\s+/).length;
const p = page.create('p');
p.setText(n.toLocaleString() + ' words');
page.find('#firstHeading').after(p);`,
  'B3-hn-hide-buttons': `trif.observe('tr.athing', (row) => {
  const b = page.create('button');
  b.setText('hide');
  b.on('click', () => { row.hide(); const n = row.next(); if (n) n.hide(); });
  const t = row.find('td.title:last-child') || row.find('td.title');
  t.append(b);
});`,
};
const dir = path.join(ROOT, 'results', 'ref', 'full'); fs.mkdirSync(dir, { recursive: true });
for (const t of tasks) {
  const origin = origins[t.page];
  const body = t.kind === 'style' ? `// @style\n// ==/WebMod==\n${JSON.stringify(t.ref, null, 2)}` : `// @boxed\n// ==/WebMod==\n${boxed[t.id]}`;
  const content = '```js\n// ==WebMod==\n// @name        Ref ' + t.id + '\n// @description reference\n// @match       ' + origin + '/*\n' + body + '\n```';
  fs.writeFileSync(path.join(dir, t.id + '.json'), JSON.stringify({ label: 'ref', variant: 'full', task: t.id, origin, wallMs: 0, content }));
}
