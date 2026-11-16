// Runs every task x variant against a llama-server on PORT and saves the replies with timings.
// usage: node gen.js <modelLabel> [port] [variants comma list] [extra JSON for the request]
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const tasks = require('./tasks');
const [label, port = '8090', variantsArg = 'full,short,json', extraArg = '{}'] = process.argv.slice(2);
const extra = JSON.parse(extraArg);
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const GUIDE = { full: read('prompts/guide-full.txt'), short: read('prompts/guide-short.txt'), local: read('prompts/guide-local.txt'), local2: read('prompts/guide-local2.txt') };
// (the local guide without its boxed parts, for the JSON-only style variant)
const styleOf = (g) => g.replace(/\*\*Boxed mod\*\*[\s\S]*?(?=Tips:|Selectors:)/, '').replace(/"Add a button[\s\S]*$/, '');
const LOCAL_STYLE = styleOf(GUIDE.local), LOCAL2_STYLE = styleOf(GUIDE.local2);
const STYLE_ONLY = GUIDE.short.split('## Boxed mods')[0];
const site = (host) => host.split('.').slice(-2).join('.');

function messages(variant, t) {
  const url = read(`outlines/${t.page}.url`).trim();
  const u = new URL(url);
  const origin = u.protocol === 'file:' ? 'https://feed.example' : u.origin;
  const shownUrl = u.protocol === 'file:' ? 'https://feed.example/home' : url;
  const host = u.protocol === 'file:' ? 'feed.example' : u.hostname;
  const outline = read(`outlines/${t.page}.txt`).replace(/^(.*?) \| .*$/m, (m, title) => `${title} | ${host}${u.protocol === 'file:' ? '/home' : u.pathname}`);
  const user = `I'm looking at ${shownUrl}. Its @match must cover ${origin}/*; when I mean the whole site, match all of its subdomains too (https://*.${site(host)}/*).\n\n--- The page: ${shownUrl} (an outline: each line starts with a CSS selector for a part of it, then its size and first words) ---\n${outline}\n\nWhat I want: ${t.task}`;
  let system;
  if (/json/.test(variant)) {
    system = `You write style mods for TRIF, an app that changes websites. The user is looking at a page on their phone. Below is how TRIF style mods work. The user's message has an outline of the page and what they want changed.\n\nReply with one JSON object only: "name" (a short name for the mod), "description" (one sentence), and the style mod's rules: "css" (a string, "" if none), "hide", "filter" and "replace" (lists, [] if none). Use selectors from the outline where you can.\n\n--- How TRIF style mods are written ---\n${variant === 'json' ? STYLE_ONLY : variant === 'local2json' ? LOCAL2_STYLE : LOCAL_STYLE}`;
  } else {
    system = `You write mods for TRIF, an app that changes websites with small mods. The user is looking at a page in TRIF on their phone. Below is how TRIF mods are written. The user's message has an outline of the page and what they want changed.\n\nReply with the whole mod file in one code block, nothing to fill in: a style mod if it can do the job, otherwise a boxed mod. Don't write a free mod. In a boxed mod, don't use trif.settings or a style section (this app doesn't have them yet).\n\n--- How TRIF mods are written ---\n${GUIDE[variant === 'localgbnf' ? 'local' : variant === 'local2gbnf' ? 'local2' : variant]}`;
  }
  return { system, user, origin };
}

const SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    name: { type: 'string', maxLength: 60 }, description: { type: 'string', maxLength: 160 },
    css: { type: 'string', maxLength: 2000 },
    hide: { type: 'array', maxItems: 12, items: { type: 'string', maxLength: 200 } },
    filter: { type: 'array', maxItems: 6, items: { type: 'object', additionalProperties: false, properties: { items: { type: 'string', maxLength: 200 }, hideIfText: { type: 'string', maxLength: 100 }, hideIfRegex: { type: 'string', maxLength: 200 } }, required: ['items'] } },
    replace: { type: 'array', maxItems: 6, items: { type: 'object', additionalProperties: false, properties: { in: { type: 'string', maxLength: 200 }, find: { type: 'string', maxLength: 100 }, with: { type: 'string', maxLength: 100 } }, required: ['find', 'with'] } },
  },
  required: ['name', 'description', 'css', 'hide', 'filter', 'replace'],
};

(async () => {
  for (const variant of variantsArg.split(',')) {
    const dir = path.join(ROOT, 'results', label, variant);
    fs.mkdirSync(dir, { recursive: true });
    for (const t of tasks) {
      if (/json/.test(variant) && t.kind !== 'style') continue;
      const out = path.join(dir, `${t.id}.json`);
      if (fs.existsSync(out)) continue;
      const { system, user, origin } = messages(variant, t);
      const body = {
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        temperature: 0.2, top_p: 0.9, seed: 7, max_tokens: 900, cache_prompt: true,
        chat_template_kwargs: { enable_thinking: false }, ...extra,
      };
      // (the whole reply as one mod file: the header's shape and @match fixed by the app, the body free, no ``` inside)
      if (/gbnf/.test(variant)) body.grammar = `root ::= "\`\`\`js\\n// ==WebMod==\\n// @name        " line "\\n// @description " line "\\n// @match       ${origin}/*\\n// @" tier "\\n// ==/WebMod==\\n" body "\`\`\`"\nline ::= [^\\n]{1,100}\ntier ::= "style" | "boxed"\nbody ::= ([^\`] | "\`" [^\`] | "\`\`" [^\`])*\n`;
      if (/json/.test(variant)) body.response_format = { type: 'json_schema', json_schema: { name: 'style_mod', schema: SCHEMA } };
      const t0 = Date.now();
      let r;
      try {
        const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(600000) });
        r = await res.json();
      } catch (e) { r = { error: String(e) }; }
      const wall = Date.now() - t0;
      const msg = r.choices && r.choices[0] && r.choices[0].message;
      const rec = { label, variant, task: t.id, origin, wallMs: wall, content: msg ? msg.content : null, reasoning: msg && msg.reasoning_content, finish: r.choices && r.choices[0].finish_reason, timings: r.timings, usage: r.usage, error: r.error || null };
      fs.writeFileSync(out, JSON.stringify(rec, null, 1));
      const tm = r.timings || {};
      console.log(`${variant} ${t.id}: ${wall} ms, prompt ${tm.prompt_n} tok in ${Math.round(tm.prompt_ms)} ms, gen ${tm.predicted_n} tok at ${Math.round(tm.predicted_per_second)} tok/s, cached ${(r.usage && r.usage.prompt_tokens_details && r.usage.prompt_tokens_details.cached_tokens) || '?'}${r.error ? ' ERROR ' + JSON.stringify(r.error).slice(0, 200) : ''}`);
    }
  }
})();
