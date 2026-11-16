'use strict';
// The browser probe's checks that are JavaScript: each is a list of steps, and each step runs in one of the
// app's three worlds: 'page' (the page's own), 'own' (TRIF's world: where the kit lives and the only place
// the app's message handler exists) or 'box' (a third world, where SES locks the language down). A step gets
// what the step before returned as `prev`; the last step returns { answer, detail }.
//
// mobile/prepare.js turns this file into mobile/shared/gen/browser-checks.json, which the app reads: the
// steps are kept as functions here so mobile/test/smoke.js can run them in a browser too.
// (Checks that need the app itself, such as loading SES, the content blocker and the on-device model, are
// in Checks.swift.)

module.exports = [
  {
    id: 'worlds.separate', group: 'Worlds', title: "TRIF's world and the page's can't see each other's things",
    steps: [
      ['page', async () => {
        window.__trifProbePageMark = 'set';
        return {
          kit: typeof globalThis.__trifKit, box: typeof globalThis.__trifSandbox,
          handler: typeof (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.trif),
          page: window.__probePage || null,
        };
      }],
      ['own', async (prev) => {
        // (a page that has changed JSON answers with something else: then only this world's view counts)
        const p = prev && typeof prev === 'object' ? prev : { kit: 'undefined', handler: 'undefined', note: 'the page answered with something else' };
        const mark = typeof globalThis.__trifProbePageMark;
        const ok = mark === 'undefined' && p.kit === 'undefined' && p.handler === 'undefined' && typeof globalThis.__trifKit === 'object';
        return { answer: ok ? 'yes' : 'no', detail: { whatThePageSees: prev, pagesMarkSeenFromTrifsWorld: mark, kitInTrifsWorld: typeof globalThis.__trifKit } };
      }],
    ],
  },
  {
    id: 'worlds.clean', group: 'Worlds', title: "A page that has changed the built-ins hasn't changed them for TRIF's world",
    steps: [
      ['page', async () => ({ pageChangedThings: !!window.__probeTampered, mapInPage: (() => { try { return String([1, 2].map((x) => x * 2)); } catch (e) { return `threw: ${e.message}`; } })() })],
      ['own', async (prev) => {
        const d = {
          map: String([1, 2].map((x) => x * 2)) === '2,4',
          native: Function.prototype.toString.call(Array.prototype.map).includes('[native code]'),
          find: !!document.querySelector('body'),
          rect: document.body.getBoundingClientRect().width > 0,
          json: JSON.stringify({ a: 1 }) === '{"a":1}',
          outlineLines: globalThis.__trifKit ? globalThis.__trifKit.outline(6000).lines : 0,
        };
        return { answer: d.map && d.native && d.find && d.rect && d.json && d.outlineLines > 3 ? 'yes' : 'no', detail: { inThePage: prev, inTrifsWorld: d } };
      }],
    ],
  },
  {
    id: 'page.eval', group: 'Running code', title: "eval and new Function in the page's world (the page's policy decides)",
    steps: [['page', async () => {
      const out = {};
      try { out.eval = String((0, eval)('20 + 22')); } catch (e) { out.eval = `refused: ${e.message}`; }
      try { out.Function = String(new Function('return (20 + 22);')()); } catch (e) { out.Function = `refused: ${e.message}`; }
      return { answer: out.eval === '42' && out.Function === '42' ? 'yes' : 'no', detail: out };
    }]],
  },
  {
    id: 'own.eval', group: 'Running code', title: "eval and new Function in TRIF's world (what a box needs)",
    steps: [['own', async () => {
      const out = {};
      try { out.eval = String((0, eval)('20 + 22')); } catch (e) { out.eval = `refused: ${e.message}`; }
      try { out.Function = String(new Function('return (20 + 22);')()); } catch (e) { out.Function = `refused: ${e.message}`; }
      return { answer: out.eval === '42' && out.Function === '42' ? 'yes' : 'no', detail: out };
    }]],
  },
  {
    id: 'timing.own', group: 'Timing', title: "TRIF's script ran before anything of the page's, with the hide rules already in",
    steps: [['own', async () => {
      const r = globalThis.__trifProbeStart;
      if (!r) return { answer: 'no', detail: 'the start script left nothing on this page' };
      return { answer: r.start.readyState === 'loading' && !r.start.pageRan ? 'yes' : 'no', detail: r };
    }]],
  },
  {
    id: 'timing.page', group: 'Timing', title: "A script put in the page's own world ran before the page's first script",
    steps: [['page', async () => {
      const r = window.__trifProbePageStart;
      if (!r) return { answer: 'no', detail: 'the start script left nothing on this page' };
      return { answer: r.readyState === 'loading' && !r.pageRan ? 'yes' : 'no', detail: r };
    }]],
  },
  {
    id: 'messaging', group: 'The app', title: "A message from TRIF's world to the app and back",
    steps: [['own', async () => {
      const h = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.trif;
      if (!h) return { answer: 'no', detail: "no handler in TRIF's world" };
      const out = {};
      for (const [name, size] of [['small', 16], ['100 KB', 100 * 1024], ['1 MB', 1024 * 1024], ['8 MB', 8 * 1024 * 1024]]) {
        const t0 = performance.now();
        try { const r = await h.postMessage({ type: 'ping', pad: 'x'.repeat(size) }); out[name] = { ms: Math.round(performance.now() - t0), received: r && r.received }; } catch (e) { out[name] = { ms: Math.round(performance.now() - t0), error: String(e && e.message) }; }
      }
      return { answer: out.small.received === 16 ? 'yes' : 'no', detail: out };
    }]],
  },
  {
    id: 'styles.own', group: 'Styling', title: "Ways to add a style rule from TRIF's world, on this page",
    steps: [['own', async () => {
      const root = document.documentElement;
      const read = (name) => getComputedStyle(root).getPropertyValue(name).trim() === '1';
      const out = {};
      try { const st = document.createElement('style'); st.textContent = ':root { --trif-probe-tag: 1 }'; (document.head || root).append(st); out.styleElement = read('--trif-probe-tag'); st.remove(); } catch (e) { out.styleElement = `error: ${e.message}`; }
      try {
        const sheet = new CSSStyleSheet(); sheet.replaceSync(':root { --trif-probe-adopted: 1 }');
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
        out.adoptedSheet = read('--trif-probe-adopted');
        document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== sheet);
      } catch (e) { out.adoptedSheet = `error: ${e.message}`; }
      try {
        const d = document.createElement('trif-probe-el'); d.setAttribute('style', '--trif-probe-attr: 1'); root.append(d);
        out.styleAttribute = getComputedStyle(d).getPropertyValue('--trif-probe-attr').trim() === '1';
        d.removeAttribute('style'); d.style.setProperty('--trif-probe-om', '1');
        out.styleObject = getComputedStyle(d).getPropertyValue('--trif-probe-om').trim() === '1';
        d.remove();
      } catch (e) { out.styleAttribute = `error: ${e.message}`; }
      const all = Object.values(out).every((v) => v === true);
      return { answer: all ? 'yes' : out.adoptedSheet === true || out.styleElement === true ? 'some' : 'no', detail: out };
    }]],
  },
  {
    id: 'styles.seen', group: 'Styling', title: "What the page can see of TRIF's styling",
    steps: [
      ['own', async () => {
        const sheet = new CSSStyleSheet(); sheet.replaceSync(':root { --trif-probe-seen: 1 }');
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
        globalThis.__trifProbeSeenSheet = sheet;
        return { sheetsFromTrifsWorld: document.adoptedStyleSheets.length };
      }],
      ['page', async (prev) => ({ ...prev, sheetsFromThePage: document.adoptedStyleSheets.length, valueFromThePage: getComputedStyle(document.documentElement).getPropertyValue('--trif-probe-seen').trim() })],
      ['own', async (prev) => {
        document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== globalThis.__trifProbeSeenSheet);
        return { answer: 'info', detail: prev };
      }],
    ],
  },
  {
    id: 'kit', group: 'Styling', title: 'The picker\'s code can name what it sees, and outline the page',
    steps: [['own', async () => {
      const k = globalThis.__trifKit;
      if (!k) return { answer: 'no', detail: "no kit in TRIF's world" };
      const t0 = performance.now();
      const o = k.outline(6000);
      const ms = Math.round(performance.now() - t0);
      const first = document.querySelector('article, [role="dialog"], aside, nav, header');
      return { answer: 'yes', detail: { outlineMs: ms, outlineChars: o.chars, outlineLines: o.lines, outlineTokens: o.tokens, cut: o.cut, sample: first ? k.describe(first) : null } };
    }]],
  },
  {
    id: 'page.features', group: 'The page', title: 'What web pages get in this app',
    steps: [['page', async () => ({
      answer: 'info',
      detail: {
        secureContext: typeof isSecureContext === 'boolean' ? isSecureContext : null,
        serviceWorker: 'serviceWorker' in navigator, passkeys: typeof PublicKeyCredential, share: typeof navigator.share,
        clipboard: !!navigator.clipboard, notifications: typeof Notification, storage: (() => { try { localStorage.setItem('trif-probe', '1'); localStorage.removeItem('trif-probe'); return true; } catch (e) { return e.message; } })(),
        userAgent: navigator.userAgent,
      },
    })]],
  },

  // ---- the box: these run after the app has loaded SES and the runtime's file into the box world ----
  {
    id: 'box.start', group: 'The box', title: "TRIF's sandbox runtime starts in the box world (it locks the language down)",
    steps: [['box', async () => {
      if (typeof lockdown !== 'function') return { answer: 'no', detail: 'SES is not in this world' };
      if (globalThis.__trifSandbox) return { answer: 'yes', detail: { already: true, lockdownMs: globalThis.__trifSandbox.stats.lockdownMs } };
      if (typeof globalThis.__trifStartSandbox !== 'function') return { answer: 'no', detail: "the runtime's file is not in this world" };
      const t0 = performance.now();
      try { globalThis.__trifStartSandbox(); } catch (e) { return { answer: 'no', detail: { error: String((e && e.message) || e).slice(0, 600) } }; }
      const s = globalThis.__trifSandbox;
      return s ? { answer: 'yes', detail: { lockdownMs: Math.round(s.stats.lockdownMs * 10) / 10, wholeStartMs: Math.round((performance.now() - t0) * 10) / 10 } } : { answer: 'no', detail: 'the runtime ran and left nothing' };
    }]],
  },
  {
    id: 'box.compartment', group: 'The box', title: 'A compartment evaluates code',
    steps: [['box', async () => {
      try { const v = String(new Compartment().evaluate('20 + 22')); return { answer: v === '42' ? 'yes' : 'no', detail: `returned ${v}` }; } catch (e) { return { answer: 'no', detail: `refused: ${e.message}` }; }
    }]],
  },
  {
    id: 'box.run', group: 'The box', title: 'A boxed run reads the page (trif run in the box)',
    steps: [['box', async () => {
      if (!globalThis.__trifSandbox) return { answer: 'no', detail: 'the runtime did not start' };
      const t0 = performance.now();
      const text = await Promise.race([
        globalThis.__trifSandbox.evaluate('probe-1', '({ links: page.findAll("a").length, title: page.title })', true, { powers: ['page-data', 'read-drafts'], args: {} }),
        new Promise((r) => setTimeout(() => r(JSON.stringify({ ok: false, error: 'no answer in 8 seconds' })), 8000)),
      ]);
      const env = JSON.parse(text);
      return { answer: env.ok ? 'yes' : 'no', detail: { ms: Math.round(performance.now() - t0), result: env.ok ? env.json : env.error } };
    }]],
  },
  {
    id: 'box.confined', group: 'The box', title: "Inside it there's no document, fetch or way to the app",
    steps: [['box', async () => {
      if (!globalThis.__trifSandbox) return { answer: 'no', detail: 'the runtime did not start' };
      const text = await Promise.race([
        globalThis.__trifSandbox.evaluate('probe-2', '[typeof document, typeof window, typeof fetch, typeof XMLHttpRequest, typeof webkit, typeof __trifSandbox, typeof __trifKit, typeof globalThis.webkit].join(",")', true, { powers: ['page-data', 'read-drafts'], args: {} }),
        new Promise((r) => setTimeout(() => r(JSON.stringify({ ok: false, error: 'no answer in 8 seconds' })), 8000)),
      ]);
      const env = JSON.parse(text);
      const types = env.ok ? JSON.parse(env.json) : null;
      return { answer: types && types.split(',').every((t) => t === 'undefined') ? 'yes' : 'no', detail: env.ok ? types : env.error };
    }]],
  },
  {
    id: 'box.mod', group: 'The box', title: 'A boxed mod runs and changes the page',
    steps: [['box', async () => {
      const s = globalThis.__trifSandbox;
      if (!s) return { answer: 'no', detail: 'the runtime did not start' };
      const id = 'probe.test/boxed';
      const t0 = performance.now();
      s.run(id, 'const out = page.find("#out"); if (out) out.setText("a boxed mod wrote this"); trif.log("boxed mod ran", out ? "and wrote to #out" : "(no #out on this page)");', { powers: [], args: {} });
      await new Promise((r) => setTimeout(r, 500));
      const out = document.querySelector('#out');
      const d = { logs: s.logs.filter((l) => l.mod === id).map((l) => l.args.join(' ')), errors: s.errors.filter((e) => e.mod === id).map((e) => e.message), out: out ? out.textContent : null, firstRunMs: s.stats.mods && s.stats.mods[id] ? s.stats.mods[id] : Math.round(performance.now() - t0) };
      return { answer: d.logs.length > 0 && !d.errors.length ? 'yes' : 'no', detail: d };
    }]],
  },
  {
    id: 'box.hidden', group: 'The box', title: "Neither the page nor TRIF's own world can reach into the box",
    steps: [
      ['page', async () => ({ page: typeof globalThis.__trifSandbox, pageLockdown: typeof globalThis.lockdown, pageFrozen: Object.isFrozen(Array.prototype) })],
      ['own', async (prev) => {
        const p = prev && typeof prev === 'object' ? prev : { page: 'undefined', pageFrozen: false, note: 'the page answered with something else' };
        const d = { ...p, own: typeof globalThis.__trifSandbox, ownFrozen: Object.isFrozen(Array.prototype) };
        return { answer: d.page === 'undefined' && d.own === 'undefined' && !d.pageFrozen && !d.ownFrozen ? 'yes' : 'no', detail: d };
      }],
    ],
  },
];
