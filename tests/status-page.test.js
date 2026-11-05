// `trif status --url`: the mods running on a tab's page, from the extension's status answer.
const assert = require('node:assert');
const { test, after } = require('node:test');
const { FakeExtension, runCli, tempDir } = require('./fake-extension');

let ext;
after(() => ext && ext.close());

test('trif status --url lists the mods that run on that page; without it, nothing about pages', async () => {
  const home = tempDir();
  ext = new FakeExtension({ home, env: { TRIF_TIMEOUT_GRACE: '300' } });
  ext.hello();
  let last = null;
  ext.handlers = {
    status: (args) => {
      last = args;
      const base = { userScripts: true, chrome: '140.0.0.0', version: '0.1.0', mods: [], recording: [], sitesOn: ['x.com'] };
      if (args.url === 'nomods.example') return { ...base, page: { tab: 3, url: 'https://x.com/settings', mods: [] } };
      return args.url ? { ...base, page: { tab: 12, url: 'https://x.com/home', mods: [{ id: 'x.com/detox-timeline', name: 'Detox Timeline' }, { id: 'all-sites/dark', name: 'Dark' }] } } : base;
    },
  };
  await ext.waitForSocket();
  let r = await runCli(['status', '--url', 'x.com'], { home });
  assert.strictEqual(r.code, 0, r.stderr);
  assert.strictEqual(last.url, 'x.com');
  assert.match(r.stdout, /this page {5}https:\/\/x\.com\/home \(tab 12\)\n {2}2 running here: x\.com\/detox-timeline, all-sites\/dark/);
  r = await runCli(['status', '--url', 'nomods.example'], { home });
  assert.match(r.stdout, /no mods run here/);
  r = await runCli(['status'], { home });
  assert.doesNotMatch(r.stdout, /this page/);
  r = await runCli(['status', '--url', 'x.com', '--json'], { home });
  assert.deepStrictEqual(JSON.parse(r.stdout).extension.page.mods.map((m) => m.id), ['x.com/detox-timeline', 'all-sites/dark']);
});
