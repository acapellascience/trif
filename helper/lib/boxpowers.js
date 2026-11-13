'use strict';
// Powers: the named exceptions a boxed mod can ask for (docs/POWERS.md). A boxed mod declares them in its
// header, `// @powers sound, read-drafts`; TRIF holds it until the user approves that set, and the sandbox
// (extension/sandbox.js) gives it those and nothing more. None of them sends anything the mod makes up:
// go-to and click go only where the header or the page's own links say, write-drafts changes only what the
// user is about to post, and write-drafts with a read power is a combination the hold names on its own.
//
// The approval is for the set, not the code: each power is allowed for the mod by its key (`power:<name>`,
// held.js allowed.json), so an update with the same powers runs without asking again, and one that adds a
// power waits for that one. The quiet powers (`soft`: sound, controls, mods, preload, embeds, media) read nothing
// beyond the page and act as nobody: they're listed on a hold, but don't make one on their own; a warned
// combination one of them makes still does (its own need), in the mod or in its site's mods together.

// The menu, in the order a hold lists them. `hold`: the fact a hold shows (after "it", like the classifier's
// facts: held.js, the panel, trif status); `site` in it is the mod's site. `built`: in this version.
const MENU = {
  'read-drafts': { hold: () => 'can read what you type on this site, but can\'t send it anywhere', built: true },
  keys: { hold: () => 'can see the keys you press (not in text fields), so it can have shortcuts', built: true },
  'site-data': { hold: (site) => `can see and filter what ${site} sends this page (posts, profiles), but can't send anything`, built: true },
  'page-data': { hold: (site) => `can read the data ${site} keeps behind what's on the page`, built: true },
  // (0.3: WIDEN.md class B)
  'site-storage': { hold: (site, args) => `can read and change what this site keeps under: ${storageWords(args)}`, built: true },
  'local-fonts': { hold: () => 'can see which fonts are installed on this computer (and this site could see that too)', built: true },
  'image-variants': { hold: (site, args) => `can load other sizes of pictures this page shows (from ${[...new Set((args || []).map((a) => a.split(' ')[0]))].join(', ')})`, built: true },
  sound: { hold: () => 'can play sounds', built: true, soft: true },
  controls: { hold: () => 'can add its own controls (sliders, pickers)', built: true, soft: true },
  mods: { hold: () => 'can talk to your other boxed mods on this page', built: true, soft: true },
  preload: { hold: () => 'can make this page load its pictures sooner', built: true, soft: true },
  media: { hold: () => 'can play and pause video and audio on this page', built: true, soft: true },
  'search-box': { hold: (site, args) => `adds a search box that searches ${args && args[0] ? hostOf(args[0].replace('{link}', 'l')) : site}${args && args[0] && args[0].includes('{link}') ? ' (in the place a link on the page names)' : ''}`, built: true, args: 'one' },
  'go-to': { hold: (site, args) => goToWords(site, args), built: true },
  embeds: { hold: (site, args) => `can play videos this page links to, inside the page (from ${(args || []).map((a) => a.split('/')[0].replace(/^www\./, '')).join(', ')})`, built: true, soft: true },
  'rewrite-requests': { hold: (site, args) => `changes what ${site} receives from this page: ${(args || []).map(rewriteWords).join('; ')}`, built: true },
  'block-events': { hold: (site, args) => `can keep this site from seeing some of what you do here (${blockWords(args)}), so the site doesn't react to it`, built: true },
  'page-events': { hold: (site, args) => `can send this page's own code these signals: ${(args || []).join(', ')}`, built: true },
  click: { hold: (site, args) => `can click these for you: ${(args || []).map((c) => { const i = c.indexOf(':'); return `${c.slice(0, i).trim()} (${c.slice(i + 1).trim()})`; }).join(', ')}`, built: true },
  'write-drafts': { hold: () => 'can change what you type and paste on this site before you post it', built: true },
  'edit-uploads': { hold: () => 'can change pictures you attach on this site before you post them', built: true },
};
// (the words a hold says for some powers' header values)
const storageWords = (args) => (args || []).map((a) => { const [area, ...k] = a.split(':'); const key = k.join(':'); return area === 'cookie' ? `${key} (a cookie: only read)` : key; }).join(', ');
const rewriteWords = (rule) => {
  const [op, ...sets] = String(rule).split(' ');
  return `${sets.map((x) => { const i = x.indexOf('='); return `${x.slice(0, i).split('.').pop()} set to ${x.slice(i + 1)}`; }).join(', ')} (in ${op} requests)`;
};
const BLOCK_WORDS = [[/^(mouse|pointer)(over|out|enter|leave|move)$/, 'the mouse moving over things'], [/^key/, 'keys'], [/^(click|dblclick|auxclick|contextmenu|mousedown|mouseup|pointerdown|pointerup)$/, 'clicks'],
  [/^(wheel|scroll)$/, 'scrolling'], [/^touch/, 'touches'], [/^(drag|drop)/, 'dragging']];
const blockWords = (args) => {
  const out = [];
  for (const a of args || []) {
    const m = /^([a-z]+)(?:\((.+)\))?$/.exec(a);
    if (!m) continue;
    const w = (BLOCK_WORDS.find(([re]) => re.test(m[1])) || [null, m[1]])[1] + (m[2] ? ` on ${m[2]}` : '');
    if (!out.includes(w)) out.push(w);
  }
  return out.join(', ');
};
const goToWords = (site, args) => {
  const list = (args || []).filter((a) => a !== 'reload');
  const reload = (args || []).includes('reload') ? 'can reload this page; it ' : '';
  return `${reload}${list.length ? `can take you to these pages on ${site}: ${list.map((p) => p.replace(/\[([^\]]+)\]/, (m, v) => `one of ${v.split('|').join(', ')}`)).join(', ')}, or to a link the page shows` : `can take you to a link a page on ${site} shows`}`;
};
const NAMES = Object.keys(MENU);

class PowersError extends Error {}

// ---- the header values of the 0.3 powers (WIDEN.md class B), each checked here and again by the sandbox
// (events a mod may keep from the site: never submit, leaving, visibility, focus or what a field takes in;
// a click-like one only on a selector, as the click power's)
const BLOCKABLE = /^(mouse(over|out|enter|leave|move|down|up)|pointer(over|out|enter|leave|move|down|up)|click|dblclick|auxclick|contextmenu|key(down|up|press)|wheel|scroll|touch(start|move|end)|drag(start|over|enter|leave|end)?|drop)$/;
const CLICKISH = /^(click|dblclick|auxclick|contextmenu|mousedown|mouseup|pointerdown|pointerup)$/;
function checkBlock(a) {
  const m = /^([a-z]+)(?:\(([^()\s,\\{};]{1,200})\))?$/.exec(a);
  if (!m || !BLOCKABLE.test(m[1])) throw new PowersError(`block-events: "${a}" isn't an event it may keep from the site (mouse, pointer, key, wheel, scroll, touch and drag events, and clicks on a selector; never submit, focus, input or leaving the page)`);
  if (CLICKISH.test(m[1]) && !m[2]) throw new PowersError(`block-events: ${m[1]} only on what it names: ${m[1]}(button.cancel)`);
  if (m[2] && /\[\s*(?:[\w*-]*\|)?value\b|:(?:-webkit-)?autofill\b/i.test(m[2])) throw new PowersError(`block-events: "${m[2]}" can't name the value attribute or :autofill`);
  return a;
}
// (a page's own event's name: with a - or a :, never a browser event's, TRIF's own, or a framework's that
// the page's code acts on by its name)
const FRAMEWORK_EVENTS = /^(htmx|hx|turbo|turbolinks|alpine|livewire|stimulus|phx|phoenix|react|vue|svelte|ng|ember)[:-]/i;
function checkEventName(n, what) {
  if (!/^[a-z][\w.]*[-:][\w.:-]*$/i.test(n) || n.length > 100) throw new PowersError(`${what}: "${n}" isn't a page's own event's name (one with a - or a : in it: no browser event has either)`);
  if (/^trif:/i.test(n)) throw new PowersError(`${what}: trif: events are TRIF's own`);
  if (what === 'page-events' && FRAMEWORK_EVENTS.test(n)) throw new PowersError(`page-events: "${n}" is named like a framework's own event (htmx:, turbo:, alpine:, …), which the page's code acts on`);
  return n;
}
// (a key of the site's storage: local:, session: or cookie:, the name literal or a prefix with * at the end;
// never everything, nor one named like a login)
const TOKENISH = /(^|[^a-z])(auth|token|session|sess|sid|secret|passw|pwd|jwt|csrf|xsrf|credential|api[-_]?key|bearer|login|oauth)/i;
function checkStorageKey(a) {
  const m = /^(local|session|cookie):([\w.:$@!~+/-]{1,100}?)(\*)?$/.exec(a);
  if (!m) throw new PowersError(`site-storage: "${a}" isn't a key: local:name, session:name or cookie:name (a prefix may end with *)`);
  if (m[3] && m[2].length < 3) throw new PowersError(`site-storage: "${a}": a prefix is at least 3 characters before the *`);
  if (TOKENISH.test(m[2])) throw new PowersError(`site-storage: "${m[2]}" is named like a login (token, session, auth…): a boxed mod doesn't get those`);
  return a;
}
// (a rewrite: the operation's name, then path=value, the values true, false, null, numbers or plain words)
function checkRewrite(rest) {
  const [op, ...sets] = rest;
  if (!op || !/^[A-Za-z][\w]{0,60}$/.test(op) || !sets.length) throw new PowersError('rewrite-requests takes the request\'s name and what to set in it: @powers rewrite-requests HomeTimeline variables.enableRanking=false');
  for (const x of sets) {
    const m = /^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*){0,7})=(.+)$/.exec(x);
    if (!m) throw new PowersError(`rewrite-requests: "${x}" isn't name.path=value`);
    // (a path names the request's own fields: never the names every object has, which lead to its prototype)
    if (/(^|\.)(__proto__|prototype|constructor)(\.|$)/.test(m[1])) throw new PowersError(`rewrite-requests: "${m[1]}" names __proto__, prototype or constructor, which aren't a request's own fields`);
    if (!/^(true|false|null|-?\d{1,15}(\.\d{1,10})?|[A-Za-z][\w-]{0,40})$/.test(m[2])) throw new PowersError(`rewrite-requests: "${m[2]}" isn't true, false, null, a number or a plain word (an address or long text could carry data)`);
  }
  return [op, ...sets].join(' ');
}
// (other sizes of the page's pictures: the host, then each literal change, from→to (or from->to))
function checkVariant(rest) {
  const [host, ...changes] = rest;
  if (!host || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host) || !changes.length) throw new PowersError('image-variants takes the pictures\' host and the change: @powers image-variants pbs.twimg.com _normal.→_400x400.');
  const out = [host.toLowerCase()];
  for (const c of changes) {
    const m = /^([^\s→]+?)(?:→|->)([^\s→]*)$/.exec(c);
    if (!m || m[1].length > 60 || m[2].length > 60 || /\/\/|@|\\/.test(m[1] + m[2])) throw new PowersError(`image-variants: "${c}" isn't a change from→to (up to 60 characters each, no // or @)`);
    out.push(`${m[1]}→${m[2]}`);
  }
  return out.join(' ');
}
// (where embedded videos come from: the players TRIF knows how to make an address for, from a link)
const EMBEDS = ['www.youtube.com/embed', 'www.youtube-nocookie.com/embed', 'player.vimeo.com/video'];
function checkEmbed(a) {
  if (!EMBEDS.includes(a)) throw new PowersError(`embeds: "${a}" isn't a player TRIF makes embeds for (${EMBEDS.join(', ')})`);
  return a;
}
// (site-data: the page's data globals, by name, filtered as they're set: never a browser name or a function's)
const BROWSER_NAMES = /^(window|self|top|parent|frames|document|location|history|navigator|fetch|XMLHttpRequest|WebSocket|eval|Function|Object|Array|JSON|Promise|setTimeout|setInterval|localStorage|sessionStorage|indexedDB|crypto|performance|console|alert|open|close|postMessage|chrome|browser|origin|name|status|opener|customElements|trustedTypes|caches|cookieStore|onload|onerror|onmessage|globalThis)$/;
function checkGlobal(n) {
  if (!/^[A-Za-z_$][\w$]{0,60}$/.test(n) || BROWSER_NAMES.test(n) || /^on/.test(n) || /^(webkit|moz|ms)/i.test(n)) throw new PowersError(`site-data: "${n}" isn't a data global TRIF filters (a name like ytInitialData; never a browser name)`);
  return n;
}
/**
 * `// @migrate localStorage rrRave.zoom` lines: what a boxed mod's free version kept in the site's storage,
 * brought into its own settings once (extension/sandbox.js), listed on the hold. Returns ["local:rrRave.zoom", …].
 */
function parseMigrate(values) {
  const out = [];
  for (const v of values || []) {
    const [area, ...keys] = String(v).trim().split(/\s+/);
    const a = { localStorage: 'local', sessionStorage: 'session', local: 'local', session: 'session' }[area];
    if (!a || !keys.length) throw new PowersError(`@migrate "${v}": say where and which keys: // @migrate localStorage my-key other-key`);
    for (const k of keys) { const key = checkStorageKey(`${a}:${k}`); if (key.endsWith('*')) throw new PowersError(`@migrate "${k}": a key by its whole name`); if (!out.includes(key)) out.push(key); }
  }
  return out;
}

const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ''; } };
// (a host is the mod's site, or one of its subdomains, or a host its @match lines name)
function sameSite(host, mod) {
  const site = String((mod && mod.site) || '').toLowerCase();
  const h = String(host).toLowerCase();
  if (site && site !== 'all-sites' && (h === site || h.endsWith(`.${site}`))) return true;
  return ((mod && mod.matches) || []).some((p) => { const m = /^[^:]+:\/\/([^/]+)\//.exec(String(p)); if (!m) return false; const ph = m[1].toLowerCase(); return ph === h || (ph.startsWith('*.') && (h === ph.slice(2) || h.endsWith(ph.slice(1)))); });
}

/**
 * The powers a header's `@powers` lines ask for: `values` are the lines' texts ("sound, search-box
 * https://www.amazon.ca/s?k={query}"). Returns the names, in the menu's order, and what some take after
 * their name (`args`: name -> [values]); throws a PowersError for a name not on the menu, one not built yet,
 * or one whose values don't check out. `mod` ({site, matches}) is for the checks that need its site.
 */
function parsePowersWithArgs(values, mod = {}) {
  const out = new Set();
  const args = {};
  for (const v of values || []) {
    for (const item of String(v).split(',')) {
      const [first, ...rest] = item.trim().split(/\s+/);
      const name = (first || '').toLowerCase();
      if (!name) continue;
      if (!MENU[name]) throw new PowersError(`"${name}" isn't a power (the powers: ${NAMES.join(', ')})`);
      if (!MENU[name].built) throw new PowersError(`the ${name} power isn't in this version of TRIF yet`);
      if (name === 'search-box') {
        const t = rest[0];
        if (!t || rest.length > 1) throw new PowersError('search-box takes the site\'s search address, with {query} where the words go: @powers search-box https://www.example.com/search?q={query}');
        let u;
        // ({link}: the path of a link the page shows, put there by TRIF: a place the site's own link names)
        if ((t.match(/\{link\}/g) || []).length > 1) throw new PowersError('search-box: one {link} at most');
        try { u = new URL(t.replace('{query}', 'q').replace('{link}', 'l')); } catch { throw new PowersError(`search-box: "${t}" isn't an address`); }
        if (!/^https?:$/.test(u.protocol) || !t.includes('{query}')) throw new PowersError(`search-box: "${t}" needs to be an http(s) address with {query} in it`);
        if (!sameSite(u.hostname, mod)) throw new PowersError(`search-box: ${u.hostname} isn't this mod's site: a search box searches the site it's on`);
        args[name] = [t];
      } else if (name === 'go-to') {
        // (literal pages of this site: a path, no query, no wildcard, since a path the mod built could carry data;
        // or `reload`; or a path with one query parameter whose values are listed: /?mods=[red|blue])
        for (const p of rest) {
          if (p === 'reload') continue;
          const q = /^(\/[\w\-./~%@!$&'()+;=]*)\?([\w-]{1,40})=\[([^\]]+)\]$/.exec(p);
          if (q) {
            if (q[1].includes('..')) throw new PowersError(`go-to: "${p}" isn't a page of this site`);
            for (const v of q[3].split('|')) if (!/^[\w-]{1,40}$/.test(v)) throw new PowersError(`go-to: "${v}" in ${p} isn't a plain word (letters, digits, - and _): a value can't be an address`);
            continue;
          }
          if (!/^\/[\w\-./~%@!$&'()+;=]*$/.test(p) || p.includes('..') || /[?#*]/.test(p)) throw new PowersError(`go-to: "${p}" isn't a page of this site: a path starting with /, with no query, # or *; or reload; or /path?name=[one|two]`);
        }
        args[name] = [...new Set([...(args[name] || []), ...rest])];
      } else if (name === 'block-events') args[name] = [...new Set([...(args[name] || []), ...rest.map(checkBlock)])];
      else if (name === 'page-events') args[name] = [...new Set([...(args[name] || []), ...rest.map((n) => checkEventName(n, 'page-events'))])];
      else if (name === 'site-storage') args[name] = [...new Set([...(args[name] || []), ...rest.map(checkStorageKey)])];
      else if (name === 'rewrite-requests') args[name] = [...(args[name] || []), checkRewrite(rest)];
      else if (name === 'image-variants') args[name] = [...(args[name] || []), checkVariant(rest)];
      else if (name === 'embeds') args[name] = [...new Set([...(args[name] || []), ...rest.map(checkEmbed)])];
      else if (name === 'site-data') { if (rest.length) args[name] = [...new Set([...(args[name] || []), ...rest.map(checkGlobal)])]; }
      else if (rest.length) throw new PowersError(`the ${name} power takes nothing after its name`);
      if (['block-events', 'page-events', 'site-storage', 'embeds'].includes(name) && !(args[name] || []).length) throw new PowersError(`the ${name} power needs ${({ 'block-events': 'the events it keeps from the site: @powers block-events mouseover keydown click(button.cancel)', 'page-events': 'the signals it sends: @powers page-events my-app-reset', 'site-storage': 'the keys: @powers site-storage local:my-key session:other-key cookie:name', embeds: 'where its videos come from: @powers embeds www.youtube.com/embed' })[name]}`);
      out.add(name);
    }
  }
  return { names: NAMES.filter((n) => out.has(n)), args };
}

/**
 * `// @click words: selector` lines: what a mod with the click power may click, named in words the hold
 * shows, with the selector. Returns ["words: selector", …]; throws for one without words or with a selector
 * TRIF wouldn't take (escapes, the value attribute: as everywhere in the sandbox).
 */
function parseClicks(values) {
  return (values || []).map((v) => {
    const m = /^(.+?):\s+(.+)$/.exec(String(v).trim());
    if (!m || !m[1].trim() || !m[2].trim()) throw new PowersError(`@click "${v}": say what it is, then a colon and its selector: // @click the play button: button.play`);
    const sel = m[2].trim();
    if (sel.includes('\\') || /\[\s*(?:[\w*-]*\|)?value\b|:(?:-webkit-)?autofill\b|[{};]/i.test(sel) || sel.length > 500) throw new PowersError(`@click "${v}": that selector isn't one TRIF takes (no \\ escapes, value attribute, :autofill, braces or semicolons)`);
    return `${m[1].trim()}: ${sel}`;
  });
}

/**
 * `// @events trif-endscreen-switch, my-app:ready` lines: the page's own custom events a boxed mod listens
 * for (page.on(name, fn); extension/sandbox.js). Names with a - or a : in them (no browser event has either),
 * never TRIF's own (trif:…). Not a power: hearing a signal the page sends tells the mod nothing the page
 * couldn't put on the page.
 */
function parseEvents(values) {
  const out = [];
  for (const v of values || []) {
    for (const item of String(v).split(/[\s,]+/)) {
      const n = item.trim();
      if (!n) continue;
      if (!/^[a-z][\w.]*[-:][\w.:-]*$/i.test(n) || n.length > 100) throw new PowersError(`@events "${n}": a page's own event's name has a - or a : in it (no browser event has either)`);
      if (/^trif:/i.test(n)) throw new PowersError(`@events "${n}": trif: events are TRIF's own`);
      if (!out.includes(n)) out.push(n);
    }
  }
  return out;
}

// The combinations: helper/lib/combinations.js, every pair and triple, with the warnings a hold shows.
const combos = require('./combinations');
const READS = combos.READS;
function togetherNeeds(list, declared = list) {
  const warns = combos.warningsFor(list);
  const need = (key, fact) => ({ key, fact, power: 'together', soft: false, lines: [] });
  // (more than three powers: one general warning, for that exact set; its combinations are still needs, so
  // a version with fewer powers that the user allowed in this one doesn't ask again; counted by the powers
  // the header declares, @migrate not among them)
  if (declared.length > combos.MANY_OVER) return [need(`power:together:many:${combos.keyOf(list)}`, combos.MANY), ...warns.map((w) => need(w.key, ''))];
  return warns.map((w) => need(w.key, w.fact));
}
/**
 * A hold's lines, from its needs' keys and facts (aligned): "it <fact>", "together, it <fact>", or the
 * many-powers sentence; none for a need without a fact, and a sentence once (two reads with write-drafts
 * are two needs with one warning).
 */
// (what a mod adds to its site's boxed mods together, site:<site>:…, comes after the mod's own)
function factLines(needs, facts) {
  const seen = new Set();
  const own = [], site = [];
  (facts || []).forEach((f, i) => {
    const k = (needs || [])[i] || '';
    const l = factLine(k, f);
    if (l && !seen.has(l)) { seen.add(l); (/^site:/.test(String(k)) ? site : own).push(l); }
  });
  return own.concat(site);
}

/**
 * A need's words after the mod's name: "it <fact>", for a combination "together, it <fact>" (a site's union:
 * "it adds to what your <site> mods can do together", with the site's lists: siteLines); '' for none.
 */
function factLine(key, fact) {
  if (!fact) return '';
  const k = String(key);
  if (/^power:together:many:/.test(k)) return fact;
  if (/^site:/.test(k)) return `it ${fact}`;
  return /^power:together:/.test(k) ? `together, it ${fact}` : `it ${fact}`;
}
/**
 * A site's lists (sitecombos.js reach) for trif status, one line each, as the card has them: ["<site> mods can: …",
 * "they can see: …", "it could end up in: …", then the flag lines].
 */
function siteLines(r) {
  const items = (l) => l.map((x) => `${x.t}${x.new ? ' (new)' : ''}`).join(' · ');
  const label = { act: `${r.site} mods can:`, see: 'they can see:', go: 'it could end up in:' };
  return (r.order || ['act', 'see', 'go']).filter((k) => r[k].length).map((k) => `${label[k]} ${items(r[k])}`)
    .concat(r.flags.map((f) => `${f.t}${f.new ? ' (new)' : ''}`));
}
function parsePowers(values, mod) { return parsePowersWithArgs(values, mod).names; }

// The site a hold names: the mod's folder (x.com), or its sites in general.
function siteOf(mod) {
  const s = String(mod.site || String(mod.id || '').split('/')[0] || '');
  return !s || s === 'all-sites' ? 'the sites it runs on' : s;
}

/**
 * What a boxed mod's powers need allowing: [{key, fact, power, soft}] (held.js needsOf). A power's values
 * are part of its key (a search box's address), so changing them asks again.
 */
function powerNeeds(mod) {
  const site = siteOf(mod);
  const args = (mod && mod.powerArgs) || {};
  const list = Array.isArray(mod.powers) ? mod.powers : [];
  const out = list.filter((n) => MENU[n]).map((n) => ({
    key: `power:${n}${args[n] && args[n].length ? `:${[...args[n]].sort().join(' | ')}` : ''}`, fact: MENU[n].hold(site, args[n]), power: n, soft: !!MENU[n].soft, lines: [],
  }));
  // (@migrate: its old settings brought over from the site's storage once: a need of its own, by its keys)
  if (Array.isArray(args.migrate) && args.migrate.length) {
    out.push({ key: `power:migrate:${[...args.migrate].sort().join(' | ')}`, fact: `brings over its old settings from what this site keeps under: ${args.migrate.map((k) => k.replace(/^\w+:/, '')).join(', ')} (once)`, power: 'migrate', soft: false, lines: [] });
  }
  // the combinations: needs of their own (docs/POWERS.md "Combinations", docs/SAFE-MODS.md); @migrate reads
  // the site's storage, so for them it counts as site-storage (as the sandbox's page-wide rules count it)
  const together = Array.isArray(args.migrate) && args.migrate.length && !list.includes('site-storage') ? NAMES.filter((n) => list.includes(n) || n === 'site-storage') : list;
  return out.concat(togetherNeeds(together, list));
}

/**
 * A boxed mod's powers for the panel's row and code card: each power's words, and the combination warnings
 * as sentences (extension/modlevel.js). A power this version has no entry for has no words here.
 */
function powerInfo(mod) {
  const needs = powerNeeds(mod);
  const together = needs.filter((n) => n.power === 'together');
  return {
    facts: needs.filter((n) => n.power !== 'together').map((n) => ({ power: n.power, fact: n.fact })),
    warnings: factLines(together.map((n) => n.key), together.map((n) => n.fact)),
  };
}

/** Whether a need is a power that doesn't hold on its own (controls, mods). */
function isSoft(key) {
  const m = /^power:([\w-]+)(?::|$)/.exec(String(key)); // (with or without its header values: embeds' players)
  return !!(m && MENU[m[1]] && MENU[m[1]].soft);
}

module.exports = { siteLines, MENU, NAMES, PowersError, parsePowers, parsePowersWithArgs, parseClicks, parseEvents, parseMigrate, EMBEDS, BLOCKABLE, powerNeeds, powerInfo, isSoft, siteOf, sameSite, READS, factLine, factLines };
