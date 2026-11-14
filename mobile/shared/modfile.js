// A whole mod file, as a chat hands it over (proof of concept, branch ios-poc): its header read, its tier
// worked out the way the helper does (helper/lib/mods.js), and the code each world runs made ready. Wrapped
// into shared/gen/mods.js by prepare.js, after helper/lib/rules.js (as `rules`). Ends by defining `api`.

/** The header's lines: `// @key value`, between ==WebMod== and ==/WebMod==; each key's values in order. */
function readHeader(text) {
  const t = String(text).replace(/^﻿/, '');
  const start = t.search(/^\s*\/\/\s*==WebMod==\s*$/m);
  const end = t.search(/^\s*\/\/\s*==\/WebMod==\s*$/m);
  if (start === -1 || end === -1 || end < start) throw new Error('no ==WebMod== header');
  const keys = {};
  for (const line of t.slice(start, end).split('\n')) {
    const m = /^\s*\/\/\s*@([\w-]+)(?:\s+(.*))?$/.exec(line);
    if (m) (keys[m[1].toLowerCase()] = keys[m[1].toLowerCase()] || []).push((m[2] || '').trim());
  }
  return keys;
}

/** A Chrome-style match pattern (https://x.com/*, *://*.x.com/*, <all_urls>) as a test of an address. */
function matchesUrl(url, patterns) {
  let u;
  try { u = new URL(url); } catch (e) { return false; }
  return patterns.some((p) => {
    if (p === '<all_urls>') return /^https?:$/.test(u.protocol);
    const m = /^(\*|https?):\/\/(\*|\*\.[^/*]+|[^/*]+)(\/.*)$/.exec(p);
    if (!m) return false;
    if (m[1] !== '*' && u.protocol !== `${m[1]}:`) return false;
    if (m[1] === '*' && !/^https?:$/.test(u.protocol)) return false;
    const host = m[2];
    if (host !== '*') {
      if (host.startsWith('*.')) { const base = host.slice(2); if (u.hostname !== base && !u.hostname.endsWith(`.${base}`)) return false; }
      else if (u.hostname !== host) return false;
    }
    const path = new RegExp(`^${m[3].replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
    return path.test(u.pathname + u.search);
  });
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'mod';

/**
 * A mod file -> {id, name, description, tier: 'style'|'boxed'|'free', matches, sites, runAt, powers, code,
 * script, world: 'trif'|'box'|'page', at: 'start'|'end'}, or {error}. `script` is what the app installs:
 * the mod behind a check of the page's address.
 */
function parseMod(text) {
  try {
    const h = readHeader(text);
    const name = (h.name && h.name[0]) || 'Untitled mod';
    const matches = (h.match || []).concat(h.include || []).filter(Boolean);
    if (!matches.length) throw new Error('the header needs at least one @match line');
    const style = !!(h.style || h.rules), boxed = !!(h.boxed || h.sandboxed);
    if (style && boxed) throw new Error('a mod is either a style mod (@style) or a boxed mod (@boxed), not both');
    const tier = style ? 'style' : boxed ? 'boxed' : 'free';
    const id = slug(name);
    const powers = (h.powers || []).join(' ').split(/[\s,]+/).filter(Boolean);
    const runAt = (h['run-at'] && h['run-at'][0]) || '';
    const sites = [...new Set(matches.map((p) => (/^[^:]+:\/\/([^/]+)/.exec(p) || [])[1] || p))];
    const guard = `if (!(${matchesUrl.toString()})(location.href, ${JSON.stringify(matches)})) return;`;
    let script, world, at;
    if (tier === 'style') {
      const code = rules.rulesCode(rules.parseRules(text), id);
      script = `(function () { ${guard}\n${code}\n})();`;
      world = 'trif'; at = 'start';
    } else if (tier === 'boxed') {
      script = `(function () { ${guard}\n` +
        'if (!globalThis.__trifSandbox) { if (typeof globalThis.__trifStartSandbox !== "function") return; globalThis.__trifStartSandbox(); }\n' +
        `globalThis.__trifSandbox.run(${JSON.stringify(id)}, ${JSON.stringify(String(text))}, { powers: ${JSON.stringify(powers)}, args: {} });\n})();`;
      world = 'box'; at = 'end';
    } else {
      // (its errors kept on the page, for the report to the chat: Browser.reportToChat)
      script = `(async function () { ${guard}\n${String(text)}\n})().catch((e) => { (window.__trifModErrors = window.__trifModErrors || []).push(${JSON.stringify(id)} + ": " + ((e && e.message) || e)); console.error("TRIF mod ${id}:", e); });`;
      world = 'page'; at = runAt === 'document-start' ? 'start' : 'end';
    }
    const description = (h.description && h.description[0]) || '';
    return { id, name, description, tier, matches, sites, runAt, powers, code: String(text), script, world, at };
  } catch (e) {
    return { error: String((e && e.message) || e) };
  }
}

/** The first mod file in a chat's reply: a ```js block holding ==WebMod==, or the text itself. */
function findMod(text) {
  const t = String(text);
  for (const m of t.matchAll(/```[\w-]*\n([\s\S]*?)```/g)) if (/==WebMod==/.test(m[1])) return m[1];
  const at = t.search(/^\s*\/\/\s*==WebMod==/m);
  return at === -1 ? null : t.slice(at);
}

const api = { parseMod, findMod, matchesUrl, readHeader };
