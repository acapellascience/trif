'use strict';
// The load power (extension/loadpower.js, background.js loadForMod): a boxed mod's data from the addresses its header
// lists, fetched by TRIF outside the page. The exfiltration guard (nothing the mod reads can go into an address as
// text), the caps, the request TRIF makes (GET, no cookies), the header's checks in the helper (the same as the
// extension's), the hold's words and its combination warning, the page-wide rule, Safari's wait, and the lint.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const bp = require('../helper/lib/boxpowers');
const C = require('../helper/lib/combinations');
const { sandboxLint } = require('../helper/lib/sandboxlint');

const L = () => import('../extension/loadpower.js');
const FEED = 'https://tweetstack.app/api/feed?cursor={next_cursor}&limit=[20|50]&page={1-50}&lang=en';

test('the header\'s addresses: what TRIF takes, and the helper and the extension agree on every one', async () => {
  const { parseLoadAddress, parseLoadAddresses } = await L();
  const good = [
    'https://tweetstack.app/api/feed', FEED, 'https://tweetstack.app/', 'https://tweetstack.app', 'https://api.example.com:8443/v1/items/{id}',
    'https://example.com/a/[top|latest]/list', 'http://localhost:3000/feed', 'http://127.0.0.1/x', 'http://feed.test:9000/api/feed', 'http://[::1]/x',
    'https://example.com/search?q=cats', 'https://example.com/x?a=&b=~ok', 'https://example.com/{0-1000}', 'https://example.com/p%20q',
  ];
  const bad = [
    ['http://tweetstack.app/api/feed', /needs https/], ['https://tweetstack.app/api/feed#top', /isn't an address TRIF takes/],
    ['https://user:pw@tweetstack.app/x', /isn't an address TRIF takes/], ['ftp://tweetstack.app/x', /isn't an address TRIF takes/],
    ['https://tweetstack.app/api/*', /no wildcards/], ['https://tweetstack.app/api/../admin', /\.\. part/],
    ['https://tweetstack.app//x', /empty/], ['https://tweetstack.app/x?q={0-5000}', /isn't a range TRIF takes/],
    ['https://tweetstack.app/x?q={5-1}', /isn't a range/], ['https://tweetstack.app/x?q={bad key}', /isn't an address|isn't a key's name/],
    ['https://tweetstack.app/x?q=a{b}', /whole/], ['https://tweetstack.app/x?q=[a|b c]', /isn't an address|plain words/],
    ['https://tweetstack.app/x?q=1&q=2', /twice/], ['https://tweetstack.app/x?q=a%20b', /fixed value/], ['https://tweetstack.app/x?q=a+b', /fixed value/],
    ['https://tweetstack.app/pre{id}', /whole/], ['https://intranet/x', /isn't a host name/], ['https://exa_mple.com/x', /isn't an address|host name/],
    ['https://tweetstack.app:99999/x', /isn't a port/], ['https://tweetstack.app/x y', /isn't an address/], [`https://tweetstack.app/${'a'.repeat(600)}`, /at most 500/],
  ];
  for (const a of good) {
    assert.doesNotThrow(() => parseLoadAddress(a), a);
    assert.equal(bp.checkLoad(a), a, `the helper takes ${a}`);
  }
  for (const [a, why] of bad) {
    assert.throws(() => parseLoadAddress(a), why, a);
    assert.throws(() => bp.checkLoad(a), bp.PowersError, `the helper refuses ${a}`);
  }
  // (a header with it: the args, once each, at most 10, and the power needs one)
  const r = bp.parsePowersWithArgs([`load ${FEED} https://tweetstack.app/api/tweet/{id}`]);
  assert.deepEqual(r.names, ['load']);
  assert.deepEqual(r.args.load, [FEED, 'https://tweetstack.app/api/tweet/{id}']);
  assert.throws(() => bp.parsePowersWithArgs(['load']), /the load power needs the addresses it loads/);
  assert.throws(() => bp.parsePowersWithArgs([`load ${FEED} ${FEED}`]), /listed twice/);
  assert.throws(() => bp.parsePowersWithArgs([`load ${Array.from({ length: 11 }, (_, i) => `https://e.com/${i}`).join(' ')}`]), /at most 10/);
  assert.throws(() => parseLoadAddresses([]), /needs the addresses/);
});

test('the exfiltration guard: only the header\'s addresses, and nothing of the mod\'s own in them', async () => {
  const { parseLoadAddresses, matchLoad, harvest } = await L();
  const parsed = parseLoadAddresses([FEED, 'https://tweetstack.app/api/tweet/{id}', 'https://tweetstack.app/api/[top|latest]']);
  const returned = new Map();
  const ok = (u) => { const r = matchLoad(u, parsed, returned); assert.ok(r.ok, `${u}: ${r.error}`); return r.url; };
  const no = (u, why) => { const r = matchLoad(u, parsed, returned); assert.equal(r.ok, false, `${u} was let through as ${r.url}`); if (why) assert.match(r.error, why, u); };
  // what it may load, built again in the header's order, values encoded
  assert.equal(ok('https://tweetstack.app/api/feed'), 'https://tweetstack.app/api/feed');
  assert.equal(ok('https://TweetStack.app/api/feed?page=3&limit=50'), 'https://tweetstack.app/api/feed?limit=50&page=3');
  assert.equal(ok('https://tweetstack.app:443/api/feed?lang=en'), 'https://tweetstack.app/api/feed?lang=en');
  assert.equal(ok('https://tweetstack.app/api/latest'), 'https://tweetstack.app/api/latest');
  // page text in a parameter, whatever the encoding: refused (a returned-value slot takes only what the server sent)
  const secret = 'Tim wrote: my bank PIN is 1234';
  no(`https://tweetstack.app/api/feed?cursor=${encodeURIComponent(secret)}`, /can only be what tweetstack\.app sent back as next_cursor, and it hasn't sent one yet/);
  no(`https://tweetstack.app/api/tweet/${encodeURIComponent(secret)}`, /part 3 of its path/);
  no('https://tweetstack.app/api/feed?lang=fr', /isn't "en", as the header has it/);
  no('https://tweetstack.app/api/feed?limit=21', /isn't one of the header's words \(20, 50\)/);
  for (const p of ['0', '51', '01', '3.0', '1e1', '-1', ' 3', '3 ', '0x3', '+3', '99999999']) no(`https://tweetstack.app/api/feed?page=${encodeURIComponent(p)}`, /isn't a whole number from 1 to 50/);
  // extra parameters, the same one twice, an encoded name
  no(`https://tweetstack.app/api/feed?page=2&q=${encodeURIComponent(secret)}`, /"q" isn't a parameter/);
  no('https://tweetstack.app/api/feed?page=2&page=3', /twice/);
  // (an encoded name is the name: built again, it's the header's own spelling)
  assert.equal(ok('https://tweetstack.app/api/feed?pag%65=2&&'), 'https://tweetstack.app/api/feed?page=2');
  // other paths, origins, schemes, ports, subdomains, look-alikes, userinfo, fragments, backslashes
  for (const u of ['https://tweetstack.app/api/feed/extra', 'https://tweetstack.app/api/feeds', 'https://tweetstack.app/api/FEED', 'https://tweetstack.app/api/fe%65d',
    'https://tweetstack.app/api/./feed/../../admin', 'https://evil.example/api/feed', 'https://tweetstack.app.evil.example/api/feed', 'https://api.tweetstack.app/api/feed',
    'http://tweetstack.app/api/feed', 'https://tweetstack.app:8443/api/feed', 'https://xn--tweetstack-xyz.app/api/feed']) no(u);
  no('https://me:pw@tweetstack.app/api/feed', /user name or password/);
  no(`https://tweetstack.app/api/feed#${encodeURIComponent(secret)}`, /#/);
  no('https://tweetstack.app/api/feed#', /#/);
  no('https:\\\\evil.example/api/feed', /\\/);
  no('/api/feed', /isn't a whole address/);
  no(42, /as text/);
  no(`https://tweetstack.app/api/feed?page=1&${'a'.repeat(5000)}=1`, /longer than/);
  // what the server sent back: the latest value under that key, in that server's JSON, and nothing else
  harvest({ data: [{ text: secret, id: 'post-1', next_cursor: 'nested-first' }], meta: { next_cursor: 'later' } }, new Set(['next_cursor', 'id']), 'https://tweetstack.app', returned);
  assert.equal(ok('https://tweetstack.app/api/feed?cursor=nested-first&page=2'), 'https://tweetstack.app/api/feed?cursor=nested-first&page=2');
  assert.equal(ok('https://tweetstack.app/api/tweet/post-1'), 'https://tweetstack.app/api/tweet/post-1');
  no('https://tweetstack.app/api/feed?cursor=later', /isn't what tweetstack\.app last sent back as next_cursor/);
  no(`https://tweetstack.app/api/feed?cursor=nested-first${encodeURIComponent(' ' + secret)}`, /isn't what tweetstack\.app last sent back/);
  // (another server's value doesn't count for this one)
  harvest({ next_cursor: 'from-elsewhere' }, new Set(['next_cursor']), 'https://evil.example', returned);
  no('https://tweetstack.app/api/feed?cursor=from-elsewhere', /isn't what tweetstack\.app last sent back/);
  // the next answer: its value replaces the last; a null ends it (the last page); a key it doesn't have keeps it
  harvest({ next_cursor: 'c2' }, new Set(['next_cursor']), 'https://tweetstack.app', returned);
  no('https://tweetstack.app/api/feed?cursor=nested-first', /last sent back/);
  ok('https://tweetstack.app/api/feed?cursor=c2');
  harvest({ items: [] }, new Set(['next_cursor']), 'https://tweetstack.app', returned);
  ok('https://tweetstack.app/api/feed?cursor=c2');
  harvest({ next_cursor: null }, new Set(['next_cursor']), 'https://tweetstack.app', returned);
  no('https://tweetstack.app/api/feed?cursor=c2', /hasn't sent one yet/);
  // (values it can't carry: too long, an object, empty)
  harvest({ next_cursor: 'x'.repeat(501) }, new Set(['next_cursor']), 'https://tweetstack.app', returned);
  no(`https://tweetstack.app/api/feed?cursor=${'x'.repeat(501)}`);
  harvest({ next_cursor: { deep: 'obj' }, other: { next_cursor: 7 } }, new Set(['next_cursor']), 'https://tweetstack.app', returned);
  assert.equal(ok('https://tweetstack.app/api/feed?cursor=7'), 'https://tweetstack.app/api/feed?cursor=7');
});

test('the request TRIF makes: GET, no body, only Accept, no cookies or referrer; the options take nothing else', async () => {
  const { loadRequest, loadOptions } = await L();
  for (const as of [null, 'json', 'text']) {
    const r = loadRequest(as);
    assert.equal(r.method, 'GET');
    assert.equal(r.credentials, 'omit');
    assert.equal(r.referrerPolicy, 'no-referrer');
    assert.equal(r.body, undefined);
    assert.deepEqual(Object.keys(r.headers), ['Accept']);
  }
  assert.equal(loadOptions(undefined), null);
  assert.equal(loadOptions({ as: 'text' }), 'text');
  for (const o of [{ method: 'POST' }, { headers: { Cookie: 'a=b' } }, { body: 'x' }, { credentials: 'include' }, { as: 'blob' }, 'json', [1]]) assert.throws(() => loadOptions(o), /trif\.load/, JSON.stringify(o));
});

// (a fetch Response, as much of one as readLoad reads)
const response = ({ url = 'https://tweetstack.app/api/feed', status = 200, type = 'application/json', length = null, chunks = ['{"ok":true}'], hang = false } = {}) => {
  const enc = new TextEncoder();
  let i = 0, cancelled = false;
  return {
    url, status, ok: status >= 200 && status < 300,
    headers: { get: (h) => (h === 'content-type' ? type : h === 'content-length' ? length : null) },
    body: {
      cancel: async () => { cancelled = true; },
      getReader: () => ({ read: () => (hang ? new Promise(() => {}) : Promise.resolve(i < chunks.length ? { done: false, value: typeof chunks[i] === 'string' ? enc.encode(chunks[i++]) : chunks[i++] } : { done: true })), cancel: async () => { cancelled = true; } }),
    },
    get cancelled() { return cancelled; },
  };
};

test('the answer: JSON or text only, up to 2 MB (said or streamed), and never one a redirect took to another site', async () => {
  const { readLoad, LOAD_MAX_BYTES } = await L();
  const o = { origin: 'https://tweetstack.app', as: null, host: 'tweetstack.app' };
  assert.deepEqual(await readLoad(response(), o), { status: 200, ok: true, type: 'json', data: { ok: true } });
  assert.deepEqual(await readLoad(response({ type: 'text/plain; charset=utf-8', chunks: ['hé', 'llo'] }), o), { status: 200, ok: true, type: 'text', data: 'héllo' });
  assert.deepEqual(await readLoad(response({ type: 'text/plain', chunks: ['{"a":1}'] }), { ...o, as: 'json' }), { status: 200, ok: true, type: 'json', data: { a: 1 } });
  assert.deepEqual(await readLoad(response({ status: 404, type: 'text/html', chunks: ['<p>no</p>'] }), o), { status: 404, ok: false, type: 'text', data: '<p>no</p>' });
  await assert.rejects(readLoad(response({ chunks: ['not json'] }), o), /isn't JSON/);
  // (another site, after a redirect: refused, the answer thrown away; the same site's other path is fine)
  const away = response({ url: 'https://evil.example/steal' });
  await assert.rejects(readLoad(away, o), /sent it on to another site \(https:\/\/evil\.example\)/);
  assert.ok(away.cancelled, 'its body isn\'t read');
  await assert.rejects(readLoad(response({ url: 'http://tweetstack.app/api/feed' }), o), /another site/);
  assert.equal((await readLoad(response({ url: 'https://tweetstack.app/api/feed/' }), o)).ok, true);
  // (pictures and the like: not this power's)
  await assert.rejects(readLoad(response({ type: 'image/png' }), o), /answered with image\/png, and trif\.load takes text or JSON only/);
  await assert.rejects(readLoad(response({ type: 'application/octet-stream' }), o), /text or JSON only/);
  // (the size cap: said up front, or as it streams)
  await assert.rejects(readLoad(response({ length: String(LOAD_MAX_BYTES + 1) }), o), /over 2 MB/);
  const big = response({ type: 'text/plain', chunks: [new Uint8Array(LOAD_MAX_BYTES), new Uint8Array(10)] });
  await assert.rejects(readLoad(big, o), /over 2 MB/);
  assert.ok(big.cancelled, 'it stops reading');
  assert.equal((await readLoad(response({ type: 'text/plain', chunks: [new Uint8Array(LOAD_MAX_BYTES)] }), o)).data.length, LOAD_MAX_BYTES);
});

test('the time cap: a server that doesn\'t answer, or stops halfway, is given up on', async () => {
  const { fetchLoad } = await L();
  const hit = { url: 'https://tweetstack.app/api/feed', origin: 'https://tweetstack.app' };
  let seen = null;
  const never = (url, init) => { seen = init; return new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted')))); };
  const t0 = Date.now();
  await assert.rejects(fetchLoad(never, hit, null, { timeoutMs: 150 }), /tweetstack\.app didn't answer within 0\.15 s/);
  assert.ok(Date.now() - t0 < 2000);
  assert.equal(seen.credentials, 'omit', 'no cookies');
  assert.equal(seen.method, 'GET');
  // (headers, then a body that never ends: the reader is cancelled with the request)
  const halfway = (url, init) => Promise.resolve(response({ hang: true }));
  await assert.rejects(Promise.race([fetchLoad(halfway, hit, null, { timeoutMs: 150 }), new Promise((_, rej) => setTimeout(() => rej(new Error('kept waiting')), 3000))]), /didn't answer within|kept waiting/);
  await assert.rejects(fetchLoad(() => Promise.reject(new TypeError('Failed to fetch')), hit, null), /couldn't reach tweetstack\.app \(Failed to fetch\)/);
  assert.deepEqual(await fetchLoad(() => Promise.resolve(response()), hit, null), { status: 200, ok: true, type: 'json', data: { ok: true } });
});

test('the rate caps: 3 at once and 30 a minute, for a mod in a tab', async () => {
  const { loadStart, loadDone } = await L();
  const st = {};
  for (let i = 0; i < 3; i++) assert.equal(loadStart(st, 1000), null);
  assert.match(loadStart(st, 1000), /at most 3 loads at once/);
  for (let i = 0; i < 3; i++) loadDone(st);
  for (let i = 3; i < 30; i++) { assert.equal(loadStart(st, 1000 + i), null); loadDone(st); }
  assert.match(loadStart(st, 2000), /at most 30 loads a minute/);
  assert.equal(loadStart(st, 61500), null, 'a minute later');
});

test('the hold: the power\'s line names the addresses; with a read it warns "Together, it could put what it reads into an address it loads"', () => {
  const needs = (powers, args = { load: [FEED] }) => bp.powerNeeds({ site: 'x.com', powers, powerArgs: args });
  const own = needs(['load']);
  assert.deepEqual(own.map((n) => [n.key, n.soft]), [[`power:load:${FEED}`, false]], 'it holds, by its addresses (another address asks again)');
  assert.equal(own[0].fact, 'can load data from tweetstack.app (/api/feed), without your cookies, and can\'t put what\'s on this page into those addresses');
  assert.equal(needs(['load'], { load: ['https://a.example/x', 'https://a.example/y?p={1-5}', 'https://www.b.example/'] })[0].fact, 'can load data from a.example (/x, /y), b.example (/), without your cookies, and can\'t put what\'s on this page into those addresses');
  for (const r of C.READS) {
    const ws = needs([r, 'load']).filter((n) => n.power === 'together');
    assert.deepEqual(ws.map((n) => n.key), [`power:together:${C.keyOf([r, 'load'])}`], r);
    assert.equal(bp.factLine(ws[0].key, ws[0].fact), 'together, it could put what it reads into an address it loads', r);
  }
  // (with a power that doesn't read: nothing to put in, so no warning; the reason is in the table)
  for (const p of C.POWERS.filter((x) => !C.READS.includes(x) && x !== 'load')) {
    assert.deepEqual(needs([p, 'load']).filter((n) => n.power === 'together'), [], p);
    assert.equal(typeof C.COMBINATIONS[C.keyOf([p, 'load'])], 'string', p);
  }
  const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'POWER-COMBINATIONS.md'), 'utf8');
  assert.match(doc, /\| `read-drafts` \+ `load` \| \*\*Together, it could put what it reads into an address it loads\.\*\* \|/);
  assert.match(doc, /\| 8 \| Together, it could put what it reads into an address it loads\. \| a read \+ `load` \(5\); `site-storage` \+ `load`; `image-variants` \+ `load`; `load` \+ `edit-uploads` \|/);
  // (the panel: a power, with its icon and words; the row's level stays as it is: the site can't tell)
  return import('../extension/modlevel.js').then(({ ICON_LABELS, modLevel }) => {
    assert.equal(ICON_LABELS.load, 'Loads data from other sites');
    assert.equal(modLevel({ sandboxed: true, powers: ['load'] }), 0);
    return import('../extension/icons.js').then(({ ICONS }) => assert.ok(ICONS.load));
  });
});

test('across mods: trif.load is refused while another boxed mod on the page has a read this one doesn\'t', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'extension', 'sandbox.js'), 'utf8');
  const from = src.indexOf('  const ACT_PARTNERS = pageWide.actPartners;'), to = src.indexOf('  // go-to across a page load');
  const PAGE_WIDE = require('../helper/lib/sitecombos').PAGE_WIDE;
  assert.deepEqual(PAGE_WIDE.actPartners.load, C.READS);
  const page = () => vm.runInNewContext(`const pageWide = ${JSON.stringify(PAGE_WIDE)}; const fail = (why) => { throw new TypeError('TRIF sandbox: ' + why); }; const report = () => {}; const channels = new Map(), apis = new Map();\n${src.slice(from, to)}\n({ partnersOk, inPlay, apis })`);
  const api = (mod, powers, site = []) => ({ mod, powers: new Set(powers), combo: new Set(powers), site: new Set(site) });
  const p = page();
  p.apis.set('reader', api('reader', ['read-drafts'])); p.inPlay.add('read-drafts');
  assert.throws(() => p.partnersOk(api('feed', ['load']), 'load'), /loading data from other sites is off on this page while another boxed mod here has the read-drafts power: with both, what one reads could decide which address the other loads, and when, which that site sees/);
  assert.doesNotThrow(() => p.partnersOk(api('feed', ['load', 'read-drafts']), 'load'), 'one that asked for both: its own hold warned');
  assert.doesNotThrow(() => p.partnersOk(api('feed', ['load'], ['load', 'read-drafts']), 'load'), 'the site approved both');
  const q = page();
  q.apis.set('beeper', api('beeper', ['sound'])); q.inPlay.add('sound');
  assert.doesNotThrow(() => q.partnersOk(api('feed', ['load']), 'load'), 'beside a mod that doesn\'t read');
  // (the sandbox asks: the power, the page-wide rule, then TRIF's background with the address)
  assert.match(src, /const load = async \(url, o\) => \{\n\s+needs\('load'\);\n\s+notLeaving\(\);/);
  assert.match(src, /partnersOk\(self, 'load'\);\n\s+if \(!SANDBOX \|\| !send\) fail/);
  assert.match(src, /send\(\{ trifSandbox: 'load', mod: modId, key: 'load', url, as \}\)/);
});

test('the background decides with its own copy of the header, never the message\'s; Safari keeps such a mod waiting, with no Allow', async () => {
  const bg = fs.readFileSync(path.join(__dirname, '..', 'extension', 'background.js'), 'utf8');
  assert.match(bg, /if \(msg\.trifSandbox === 'load'\) return loadForMod\(mod, msg, sender\);/);
  assert.match(bg, /parsed = parseLoadAddresses\(m\.powerArgs && m\.powerArgs\.load\)/);
  assert.match(bg, /if \(!m \|\| m\.held \|\| m\.unsandboxed \|\| !\(m\.powers \|\| \[\]\)\.includes\('load'\)\)/);
  assert.match(bg, /tabLocks\.isLocked\(tab\)/);
  assert.match(bg, /chrome\.permissions\.contains\(\{ origins: \[`\$\{u\.protocol\}\/\/\$\{host\}\/\*`\] \}\)/);
  assert.match(bg, /if \(sbx\.held\.cant\) throw new Error\(sbx\.held\.reason\);/);
  const { sandboxFallback } = await import('../extension/lib.js');
  const mods = [{ id: 'x.com/feed', sandboxed: true, powers: ['load'], powerArgs: { load: [FEED] }, hash: 'h1' }, { id: 'x.com/calm', sandboxed: true, powers: [], hash: 'h2' }];
  const [feed, calm] = sandboxFallback(mods, { canSandbox: false, allowed: { 'x.com/feed': 'h1', 'x.com/calm': 'h2' }, browser: 'Safari' });
  assert.equal(feed.held.by, 'sandbox');
  assert.equal(feed.held.cant, true, 'even a version allowed before');
  assert.equal(feed.held.reason, 'Safari can\'t load data from other sites for a boxed mod yet (the load power), so this mod waits until a version of TRIF here can');
  assert.equal(calm.held, undefined, 'a boxed mod without it runs as before, once allowed');
  assert.equal(sandboxFallback(mods, { canSandbox: true })[0].held, undefined, 'where the sandbox is (Chrome, Firefox), nothing changes');
  const panel = fs.readFileSync(path.join(__dirname, '..', 'extension', 'sidepanel.js'), 'utf8');
  assert.match(panel, /P\.allow\.hidden = kind === 'sandbox' && !!info\.cant;/);
  // (the browser's access, asked for in Allow's own click, before anything is awaited)
  assert.match(panel, /const loading = type === 'mod\.approve' \? loadAccessAsk\(m\.group \|\| \[m\]\) : null;\n\s+P\.allow\.disabled/);
});

test('trif check names what it loads; the lint knows trif.load needs the power, and an address the header doesn\'t list', () => {
  const lint = (code, powers, loadAddresses) => sandboxLint(code, { powers, loadAddresses }).map((f) => `${f.what}: ${f.why}`);
  assert.match(lint('await trif.load("https://tweetstack.app/api/feed");', [], []).join('\n'), /trif\.load: needs the load power/);
  assert.deepEqual(lint('await trif.load("https://tweetstack.app/api/feed?page=2");', ['load'], [FEED]), []);
  assert.match(lint('await trif.load("https://evil.example/x");', ['load'], [FEED]).join('\n'), /that address isn't one the header lists/);
  assert.match(lint('const r = await fetch("https://tweetstack.app/api/feed");', [], []).join('\n'), /fetch: not there in a boxed mod.*use trif\.load\(url\) with the load power/);
  // (a free mod that fetches isn't "boxable" on its own: that's a power, the user's call)
  assert.equal(require('../helper/lib/sandboxlint').boxable('fetch("/x").then((r) => r.json());').boxable, false);
});

test('trif check on a mod with load: its hold, the rules, and the warning with a read', async () => {
  const { tempDir, runCli, writeMod } = require('./fake-extension');
  const home = tempDir();
  const head = (powers) => `// ==WebMod==\n// @name        Feed\n// @match       https://x.com/*\n// @boxed\n// @powers      ${powers}\n// ==/WebMod==\n`;
  const f = writeMod(home, 'x.com', 'feed.js', `${head(`load ${FEED}`)}const r = await trif.load('https://tweetstack.app/api/feed?page=1');\ntrif.log(r.status);\n`);
  let r = await runCli(['check', f], { home });
  assert.equal(r.code, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /^- it can load data from tweetstack\.app \(\/api\/feed\), without your cookies, and can't put what's on this page into those addresses$/m);
  assert.match(r.stdout, /trif\.load\(url\) reaches only these, read only \(GET, no cookies\), fetched by TRIF outside the page, so the page's Content Security Policy doesn't apply/);
  assert.match(r.stdout, /TRIF finds nothing in it that the sandbox would refuse/);
  const g = writeMod(home, 'x.com', 'feed2.js', `${head(`load ${FEED}, read-drafts`)}await trif.load('https://tweetstack.app/api/feed');\n`);
  r = await runCli(['check', g], { home });
  assert.match(r.stdout, /^- together, it could put what it reads into an address it loads$/m);
  const bad = writeMod(home, 'x.com', 'feed3.js', `${head('load http://tweetstack.app/api/feed')}\n`);
  r = await runCli(['check', bad], { home });
  assert.equal(r.code, 1);
  assert.match(r.stdout, /load: tweetstack\.app needs https:\/\//);
});
