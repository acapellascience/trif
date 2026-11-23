// The `load` power (docs/POWERS.md, helper/workspace/BOXED.md): a boxed mod loads data from the addresses its
// header lists, and TRIF fetches it in its background, outside the page, so the page's Content Security Policy
// doesn't apply. What makes that safe is here, pure, so the tests can throw every trick at it
// (tests/loadpower.test.js): the background (background.js loadForMod) is the one that decides, with its own copy
// of the mod's header; the sandbox only passes the request on.
//
// The rules:
// - Read only: GET, no body, no headers of the mod's (only TRIF's Accept), no cookies or other credentials
//   (`credentials: 'omit'`), no referrer. So it can't act as the person on that site, nor tell it where they are.
// - Only the header's addresses: `// @powers load https://tweetstack.app/api/feed?cursor={next_cursor}&n=[20|50]`.
//   The scheme, host, port and path as written (https; http only for this computer: localhost, 127.0.0.1, [::1],
//   *.localhost, *.test). No #, no user name or password. Nothing else.
// - The exfiltration guard: nothing the mod picks freely goes into an address, so what it reads on the page can't
//   be put into one. A path segment or a query parameter's value is the header's literal, one of the header's
//   words (`[top|latest]`), a whole number in the header's range (`{1-50}`: at most 1001 numbers), or a value that
//   same server sent back (`{next_cursor}`: the value under that key in the latest JSON it sent this mod on this
//   page, so a cursor or next-page token, never text the mod chose). Only the parameters the header names, each
//   once, all optional; a path's slots are whole segments, all needed. TRIF builds the address it fetches again
//   from the header and those values, so nothing else the mod wrote (encodings, empty pairs, case) rides along.
//   What's left is which of these it loads, and when: the server sees that (the hold says so, and a read power
//   beside it warns: docs/POWER-COMBINATIONS.md).
// - Caps: up to 2 MB a response, 15 s a request, 3 at once and 30 a minute per mod in a tab; text or JSON only.
// - Redirects: followed only within the same origin (scheme, host and port); one to anywhere else is refused, and
//   its answer never reaches the mod.
//
// Everything here is plain functions on plain data: background.js imports it, and so do the tests.

export const LOAD_MAX_BYTES = 2 * 1024 * 1024;
export const LOAD_TIMEOUT_MS = 15000;
export const LOAD_AT_ONCE = 3;
export const LOAD_PER_MINUTE = 30;
export const LOAD_ADDRESSES_MAX = 10; // (addresses one mod's header may list)
export const LOAD_ADDRESS_MAX = 500; // (characters in one, as written)
export const LOAD_URL_MAX = 4000; // (characters in what the mod asks for)
export const LOAD_PARAMS_MAX = 12;
export const LOAD_RANGE_MAX = 1000; // (a range's span: {0-1000} at most)
export const LOAD_NUMBER_MAX = 1000000;
export const LOAD_VALUE_MAX = 500; // (characters in a value the server sent back that an address may carry)

const SLOT_NAME = /^[A-Za-z_][A-Za-z0-9_-]{0,40}$/;
const WORD = /^[A-Za-z0-9_.-]{1,40}$/;
// (literals as written: characters the URL parser leaves as they are, so the header's text is the address's)
const PATH_LITERAL = /^[A-Za-z0-9_.~!$'()=:@%-]{1,200}$/;
const QUERY_LITERAL = /^[A-Za-z0-9_.~!$'()*:@-]{0,200}$/;
const PARAM_NAME = /^[A-Za-z0-9_.-]{1,60}$/;
// (http only for this computer, and for *.test, which never resolves on the internet)
export const localHost = (h) => h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h.endsWith('.localhost') || h.endsWith('.test');

export class LoadError extends Error {}

// (a slot's text, or null when it's a literal)
function slotOf(t, where) {
  let m = /^\{(\d{1,7})-(\d{1,7})\}$/.exec(t);
  if (m) {
    const min = Number(m[1]), max = Number(m[2]);
    if (min > max || max > LOAD_NUMBER_MAX || max - min > LOAD_RANGE_MAX) throw new LoadError(`load: {${m[1]}-${m[2]}} in ${where} isn't a range TRIF takes (whole numbers up to ${LOAD_NUMBER_MAX}, at most ${LOAD_RANGE_MAX} apart: a number the mod picks from a wide range could carry what it read)`);
    return { kind: 'range', min, max };
  }
  m = /^\{([^{}]*)\}$/.exec(t);
  if (m) {
    if (!SLOT_NAME.test(m[1])) throw new LoadError(`load: {${m[1]}} in ${where} isn't a key's name (letters, digits, _ and -) or a range ({1-50})`);
    return { kind: 'returned', key: m[1] };
  }
  m = /^\[([^\]]*)\]$/.exec(t);
  if (m) {
    const values = m[1].split('|');
    if (values.length > 20 || !values.every((v) => WORD.test(v)) || new Set(values).size !== values.length) throw new LoadError(`load: [${m[1]}] in ${where} isn't a list of plain words ([top|latest]: up to 20, letters, digits, _ . -)`);
    return { kind: 'choice', values };
  }
  if (/[{}[\]|]/.test(t)) throw new LoadError(`load: "${t}" in ${where}: a value is the header's own text, [one|other], {1-50} or {a_key}, whole`);
  return null;
}

/**
 * One address as a header writes it, checked: {text, protocol, hostname, port, origin, segments: [{lit} | slot],
 * params: [{name, lit} | {name, ...slot}]}. Throws a LoadError that says what's wrong.
 */
export function parseLoadAddress(text) {
  const t = String(text);
  if (t.length > LOAD_ADDRESS_MAX) throw new LoadError(`load: an address is at most ${LOAD_ADDRESS_MAX} characters`);
  const m = /^(https?):\/\/([A-Za-z0-9.-]+|\[::1\])(?::(\d{1,5}))?(\/[^?#\s]*)?(?:\?([^#\s]*))?$/.exec(t);
  if (!m) throw new LoadError(`load: "${t}" isn't an address TRIF takes: https://host/path, with a query of the header's own (no #, no user name or password, no spaces)`);
  const protocol = `${m[1].toLowerCase()}:`;
  const hostname = m[2].toLowerCase();
  if (hostname !== '[::1]' && (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(hostname) || (!hostname.includes('.') && hostname !== 'localhost'))) throw new LoadError(`load: "${m[2]}" isn't a host name`);
  if (protocol === 'http:' && !localHost(hostname)) throw new LoadError(`load: ${hostname} needs https:// (plain http is only for this computer: localhost, 127.0.0.1, *.localhost, *.test)`);
  let port = m[3] || '';
  if (port && (Number(port) < 1 || Number(port) > 65535)) throw new LoadError(`load: port ${port} isn't a port`);
  if ((protocol === 'https:' && port === '443') || (protocol === 'http:' && port === '80')) port = '';
  const where = `${hostname}${m[4] || '/'}`;
  const segments = (m[4] || '/').split('/').slice(1).map((s, i, all) => {
    if (s === '' && i === all.length - 1) return { lit: '' }; // (a trailing /)
    if (s === '' || s === '.' || s === '..' || /^%2e/i.test(s)) throw new LoadError(`load: "${t}": the path has an empty, . or .. part`);
    const slot = slotOf(s, where);
    if (slot) return slot;
    if (s.includes('*')) throw new LoadError(`load: "${s}" in ${t}: no wildcards; list each address, with [words], {1-50} or {a_key} for a part that changes`);
    if (!PATH_LITERAL.test(s) || /%(?![0-9A-Fa-f]{2})/.test(s)) throw new LoadError(`load: "${s}" in the path of ${t} has characters TRIF doesn't take in an address's path`);
    return { lit: s };
  });
  const params = [];
  if (m[5] !== undefined && m[5] !== '') {
    for (const pair of m[5].split('&')) {
      const i = pair.indexOf('=');
      const name = i < 0 ? pair : pair.slice(0, i);
      const value = i < 0 ? '' : pair.slice(i + 1);
      if (!PARAM_NAME.test(name)) throw new LoadError(`load: "${name}" in ${t} isn't a parameter's name (letters, digits, _ . -)`);
      if (params.some((p) => p.name === name)) throw new LoadError(`load: ${name} is in ${t} twice`);
      const slot = slotOf(value, `${name}=`);
      if (slot) params.push({ name, ...slot });
      else if (!QUERY_LITERAL.test(value)) throw new LoadError(`load: "${value}" (${name} in ${t}) has characters TRIF doesn't take in a fixed value (letters, digits and _ . ~ ! $ ' ( ) * : @ -)`);
      else params.push({ name, lit: value });
    }
    if (params.length > LOAD_PARAMS_MAX) throw new LoadError(`load: ${t} names more than ${LOAD_PARAMS_MAX} parameters`);
  }
  const origin = `${protocol}//${hostname}${port ? `:${port}` : ''}`;
  return { text: t, protocol, hostname, port, origin, segments, params };
}

/** The header's addresses, checked (at most LOAD_ADDRESSES_MAX, none twice). Throws a LoadError. */
export function parseLoadAddresses(list) {
  const all = (list || []).map(String);
  if (!all.length) throw new LoadError('the load power needs the addresses it loads: @powers load https://example.com/api/feed');
  if (all.length > LOAD_ADDRESSES_MAX) throw new LoadError(`load: at most ${LOAD_ADDRESSES_MAX} addresses`);
  if (new Set(all).size !== all.length) throw new LoadError('load: an address is listed twice');
  return all.map(parseLoadAddress);
}

/** The browser permissions a mod's addresses need: one per host, `https://host/*` (match patterns have no port). */
export function loadOrigins(list) {
  const out = [];
  for (const a of list || []) {
    let p;
    try { p = typeof a === 'string' ? parseLoadAddress(a) : a; } catch { continue; }
    const o = `${p.protocol}//${p.hostname}/*`;
    if (!out.includes(o)) out.push(o);
  }
  return out;
}

/** The keys of the values a server sends back that the addresses take ({next_cursor}), per origin: Map origin -> Set. */
export function returnedKeys(parsed) {
  const out = new Map();
  for (const p of parsed || []) {
    for (const s of [...p.segments, ...p.params]) if (s.kind === 'returned') { if (!out.has(p.origin)) out.set(p.origin, new Set()); out.get(p.origin).add(s.key); }
  }
  return out;
}

// (whether `value` fits a slot: null when it does, else why not, in words)
function misfit(slot, value, returned, origin, host) {
  if (slot.lit !== undefined) return value === slot.lit ? null : `isn't ${slot.lit === '' ? 'empty' : `"${slot.lit}"`}, as the header has it`;
  if (slot.kind === 'choice') return slot.values.includes(value) ? null : `isn't one of the header's words (${slot.values.join(', ')})`;
  if (slot.kind === 'range') return /^(0|[1-9]\d{0,6})$/.test(value) && Number(value) >= slot.min && Number(value) <= slot.max ? null : `isn't a whole number from ${slot.min} to ${slot.max}`;
  if (slot.kind === 'returned') {
    const have = returned && returned.get(`${origin} ${slot.key}`);
    if (have === undefined) return `can only be what ${host} sent back as ${slot.key}, and it hasn't sent one yet`;
    return value === have ? null : `isn't what ${host} last sent back as ${slot.key} (only that value: an address can't carry text of the mod's)`;
  }
  return 'isn\'t allowed';
}

const show = (u) => (String(u).length > 120 ? `${String(u).slice(0, 117)}…` : String(u));

/**
 * Whether the mod may load `url`: {ok: true, url: the address TRIF fetches (built again from the header), origin,
 * address: the header's text} or {ok: false, error}. `parsed`: parseLoadAddresses of the header's list; `returned`:
 * Map "<origin> <key>" -> the value the server last sent back under that key (harvest).
 */
export function matchLoad(url, parsed, returned) {
  const listed = (parsed || []).map((p) => p.text).join(', ') || 'none';
  if (typeof url !== 'string') return { ok: false, error: 'trif.load takes an address, as text' };
  if (url.length > LOAD_URL_MAX) return { ok: false, error: `that address is longer than ${LOAD_URL_MAX} characters` };
  if (/[#\\\s]/.test(url) || /[\u0000-\u001f\u007f]/.test(url)) return { ok: false, error: `${show(url)} has a #, a \\ or a space: TRIF loads only the header's addresses (${listed})` };
  let u;
  try { u = new URL(url); } catch { return { ok: false, error: `${show(url)} isn't a whole address (https://…): TRIF loads only the header's addresses (${listed})` }; }
  if (u.username || u.password) return { ok: false, error: `${show(url)} has a user name or password in it` };
  let closest = null;
  for (const p of parsed || []) {
    if (u.protocol !== p.protocol || u.hostname !== p.hostname || u.port !== p.port) continue;
    const segs = u.pathname.split('/').slice(1);
    if (segs.length !== p.segments.length) continue;
    const host = p.hostname;
    let why = null;
    const values = [];
    for (let i = 0; i < segs.length && !why; i++) {
      const s = p.segments[i];
      if (s.lit !== undefined) { if (segs[i] !== s.lit) why = 'path'; continue; }
      let v;
      try { v = decodeURIComponent(segs[i]); } catch { why = `part ${i + 1} of its path isn't text`; break; }
      const no = misfit(s, v, returned, p.origin, host);
      if (no) why = `part ${i + 1} of its path ("${show(v)}") ${no}`;
      values.push(v);
    }
    if (why === 'path') continue; // (another path: not this address)
    const q = [];
    if (!why) {
      const seen = new Set();
      for (const [name, value] of u.searchParams) {
        const slot = p.params.find((x) => x.name === name);
        if (!slot) { why = `"${show(name)}" isn't a parameter ${p.text} names`; break; }
        if (seen.has(name)) { why = `${name} is in it twice`; break; }
        seen.add(name);
        const no = misfit(slot, value, returned, p.origin, host);
        if (no) { why = `its ${name} ("${show(value)}") ${no}`; break; }
        q.push([name, value]);
      }
    }
    if (why) { closest = closest || why; continue; }
    // (built again: the header's literals as written, the values encoded, the parameters in the header's order)
    let i = 0;
    const path = p.segments.map((s) => (s.lit !== undefined ? s.lit : encodeURIComponent(values[i++]))).join('/');
    const ordered = p.params.filter((x) => q.some(([n]) => n === x.name)).map((x) => `${encodeURIComponent(x.name)}=${encodeURIComponent(q.find(([n]) => n === x.name)[1])}`);
    return { ok: true, url: `${p.origin}/${path}${ordered.length ? `?${ordered.join('&')}` : ''}`, origin: p.origin, address: p.text };
  }
  if (closest) return { ok: false, error: `${show(url)}: ${closest}` };
  return { ok: false, error: `${show(url)} isn't one of the addresses this mod's header lists (${listed})` };
}

/**
 * The values a JSON answer from `origin` holds under the keys the addresses take back ({next_cursor}), into
 * `returned` (Map "<origin> <key>" -> text): each key's first value in the answer (depth first), a string up to
 * LOAD_VALUE_MAX characters or a finite number; a key the answer has as null (or false) is taken out (the last
 * page: no next one); a key it doesn't have keeps the value from before. Returns `returned`.
 */
export function harvest(data, keys, origin, returned = new Map()) {
  if (!keys || !keys.size) return returned;
  const found = new Map();
  let nodes = 0;
  const walk = (v, depth) => {
    if (found.size === keys.size || depth > 64 || ++nodes > 200000 || v === null || typeof v !== 'object') return;
    if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return; }
    for (const k of Object.keys(v)) {
      const x = v[k];
      if (keys.has(k) && !found.has(k) && (x === null || x === false || typeof x === 'string' || typeof x === 'number')) found.set(k, x);
      walk(x, depth + 1);
    }
  };
  walk(data, 0);
  for (const [k, x] of found) {
    const id = `${origin} ${k}`;
    if (x === null || x === false || (typeof x === 'string' && (x === '' || x.length > LOAD_VALUE_MAX)) || (typeof x === 'number' && !Number.isFinite(x))) returned.delete(id);
    else returned.set(id, String(x));
  }
  return returned;
}

/** Whether a response's Content-Type is one a mod may have: 'json', 'text', or null (anything else). */
export function loadKind(contentType) {
  const t = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (!t) return 'text';
  if (t === 'application/json' || /^application\/[\w.+-]+\+json$/.test(t) || t === 'text/json') return 'json';
  if (/^text\/[\w.+-]+$/.test(t)) return 'text';
  return null;
}

/** The options trif.load takes: {as: 'json' | 'text'} or nothing. Returns the checked `as`, or throws a LoadError. */
export function loadOptions(o) {
  if (o === undefined || o === null) return null;
  if (typeof o !== 'object' || Array.isArray(o)) throw new LoadError('trif.load\'s options are { as: \'json\' } or { as: \'text\' }');
  for (const k of Object.keys(o)) if (k !== 'as') throw new LoadError(`trif.load takes only { as }: it always loads with GET, with no body, headers or cookies of the mod's (${k} isn't an option)`);
  if (o.as !== undefined && o.as !== 'json' && o.as !== 'text') throw new LoadError('trif.load\'s `as` is \'json\' or \'text\'');
  return o.as || null;
}

/**
 * The request TRIF makes, as fetch() takes it: GET, no body, only Accept, no cookies, no referrer, redirects
 * followed (and checked: readLoad). `signal` is the time cap's.
 */
export function loadRequest(as, signal) {
  return { method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'follow', cache: 'no-store', mode: 'cors', headers: { Accept: as === 'text' ? 'text/plain, text/*;q=0.9, */*;q=0.1' : 'application/json, text/*;q=0.9' }, ...(signal ? { signal } : {}) };
}

/**
 * What a fetch's answer becomes for the mod: reads the body up to LOAD_MAX_BYTES (refusing past it), checks the
 * answer stayed on the origin, its type, and parses JSON. `res` is a fetch Response (or the like). Resolves
 * {status, ok, type, data, text} or throws a LoadError.
 */
export async function readLoad(res, { origin, as, host }) {
  let final = '';
  try { final = new URL(res.url || '').origin; } catch { final = ''; }
  if (res.url && final !== origin) { try { await res.body?.cancel(); } catch { /* gone */ } throw new LoadError(`${host} sent it on to another site (${final || 'somewhere else'}), and TRIF only loads from the header's own addresses`); }
  const kind = loadKind(res.headers && res.headers.get ? res.headers.get('content-type') : '');
  if (!kind) { try { await res.body?.cancel(); } catch { /* gone */ } throw new LoadError(`${host} answered with ${String(res.headers.get('content-type')).split(';')[0]}, and trif.load takes text or JSON only`); }
  const said = Number(res.headers && res.headers.get ? res.headers.get('content-length') : NaN);
  if (Number.isFinite(said) && said > LOAD_MAX_BYTES) { try { await res.body?.cancel(); } catch { /* gone */ } throw new LoadError(`${host}'s answer is over ${LOAD_MAX_BYTES / 1024 / 1024} MB, the most trif.load takes`); }
  const chunks = [];
  let size = 0;
  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > LOAD_MAX_BYTES) { try { await reader.cancel(); } catch { /* gone */ } throw new LoadError(`${host}'s answer is over ${LOAD_MAX_BYTES / 1024 / 1024} MB, the most trif.load takes`); }
      chunks.push(value);
    }
  } else {
    const b = new Uint8Array(await res.arrayBuffer());
    if (b.byteLength > LOAD_MAX_BYTES) throw new LoadError(`${host}'s answer is over ${LOAD_MAX_BYTES / 1024 / 1024} MB, the most trif.load takes`);
    chunks.push(b);
  }
  const all = new Uint8Array(size || chunks.reduce((n, c) => n + c.byteLength, 0));
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.byteLength; }
  const text = new TextDecoder('utf-8').decode(all);
  const asJson = as === 'json' || (!as && kind === 'json');
  let data = text, parsed = false;
  if (asJson) {
    try { data = JSON.parse(text); parsed = true; } catch { if (as === 'json' || res.ok) throw new LoadError(`${host}'s answer isn't JSON${as === 'json' ? '' : ' (though it says it is)'}: load it with { as: 'text' }`); }
  }
  return { status: res.status, ok: !!res.ok, type: parsed ? 'json' : 'text', data };
}

/**
 * The rate caps, per mod in a tab (`st`: {times: [ms], inFlight}): null when a load may start now (and counts it:
 * call loadDone after), else why not.
 */
export function loadStart(st, now = Date.now()) {
  st.times = (st.times || []).filter((t) => now - t < 60000);
  if (st.times.length >= LOAD_PER_MINUTE) return `at most ${LOAD_PER_MINUTE} loads a minute for a mod in a tab`;
  if ((st.inFlight || 0) >= LOAD_AT_ONCE) return `at most ${LOAD_AT_ONCE} loads at once for a mod in a tab`;
  st.times.push(now);
  st.inFlight = (st.inFlight || 0) + 1;
  return null;
}
export function loadDone(st) { st.inFlight = Math.max(0, (st.inFlight || 0) - 1); }

/**
 * The fetch itself, with the time cap: `fetchFn` is fetch (the tests' stand-in otherwise), `hit` matchLoad's.
 * Resolves readLoad's {status, ok, type, data}, or throws a LoadError that says what happened.
 */
export async function fetchLoad(fetchFn, hit, as, { timeoutMs = LOAD_TIMEOUT_MS } = {}) {
  const host = new URL(hit.url).hostname;
  const ctl = new AbortController();
  const late = () => new LoadError(`${host} didn't answer within ${timeoutMs / 1000} s`);
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    let res;
    try { res = await fetchFn(hit.url, loadRequest(as, ctl.signal)); } catch (e) {
      throw ctl.signal.aborted ? late() : new LoadError(`couldn't reach ${host} (${String(e && e.message ? e.message : e).slice(0, 200)})`);
    }
    return await readLoad(res, { origin: hit.origin, as, host });
  } catch (e) {
    if (ctl.signal.aborted) throw late();
    throw e instanceof LoadError ? e : new LoadError(String(e && e.message ? e.message : e).slice(0, 300));
  } finally {
    clearTimeout(timer);
  }
}
