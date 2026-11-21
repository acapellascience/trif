// The message box's microphone (dictation): what's said, as text, into the panel's box. Chrome, Edge and Safari,
// through the browser's own speech recognition (SpeechRecognition / webkitSpeechRecognition); not Firefox, which has
// none (later: local transcription through the helper). docs/DICTATION-STRINGS.md has the words, and why.
//
// Tim's rules for voice input (11-18, the iPhone app's; 11-20 for the panel):
//   - It never stops by itself: no silence stop, no time limit. When the browser's recogniser ends (Chrome's does
//     after a pause or a minute or so, and on a network hiccup), a new one starts at once while the person hasn't
//     stopped.
//   - The words only accumulate: what's in the box is never replaced or dropped. The words being heard show under
//     the box's top edge (interim); only finished ones (final) go into the box, at its end. A stretch the recogniser
//     never finished before it ended is kept as heard (never lost).
//   - Only the person's own stop ends it (the button, the shortcut, Escape in the box), and stopping never sends.
//     Sending (Send or Enter) while it listens stops it too: the words still being heard are sent with the rest.
//   - It never says it's listening unless it is: "listening" only from the recogniser's own start event; while it
//     starts, asks for the microphone or reconnects, the button says so instead.
//   - Errors: the microphone blocked ('not-allowed'), none found ('audio-capture'), the service turned off
//     ('service-not-allowed'), a language it can't do: it stops, with a plain red note saying how to fix it.
//     'no-speech' (a long pause) and 'aborted': nothing, it goes on. 'network' and anything else: it goes on, starting
//     again after a growing pause (up to 10 s); from the second miss in a row a quiet note says it's reconnecting.
//
// The microphone's permission: the browser asks once, for TRIF's own origin. Chrome (and Edge) can't ask inside the
// side panel, so there the first time opens mic.html in a tab beside the page, which asks, says what happened and
// closes itself (askPage); from then on the panel's button works. A panel in a window (Safari's, the fallback in
// Arc and others) asks the browser's own way, and only if that fails with the question never shown opens mic.html.

/** The words people see (drafts: docs/DICTATION-STRINGS.md). {key}: the shortcut; {browser}: the browser's name. */
export const DICTATION_WORDS = {
  start: 'Dictate',
  startTitle: 'Dictate ({key})',
  stop: 'Stop dictating',
  stopTitle: 'Stop dictating ({key}). Your words stay in the box.',
  starting: 'Starting the microphone…',
  asking: 'Allow the microphone in the tab that just opened.',
  reconnecting: 'Can’t reach the speech service. Still trying…',
  heard: 'Hearing',
  firstUse: {
    Chrome: 'Chrome sends what you say to Google to turn it into text.',
    Edge: 'Edge sends what you say to Microsoft to turn it into text.',
    Safari: 'Safari turns what you say into text with Apple’s speech recognition.',
    other: '{browser} sends what you say to its speech service to turn it into text.',
  },
  blocked: {
    Safari: 'The microphone is blocked for TRIF. In Safari’s Settings, Websites, Microphone, allow TRIF, then press the mic again.',
    other: 'The microphone is blocked for TRIF. Allow it in {browser}’s settings, then press the mic again.',
  },
  openSettings: 'Open microphone settings',
  noMic: 'No microphone found. Connect one, or pick one in your computer’s sound settings, then press the mic again.',
  serviceOff: {
    Safari: 'Dictation is off on this Mac. Turn it on in System Settings, Keyboard, Dictation, then press the mic again.',
    other: '{browser}’s speech recognition isn’t available right now.',
  },
  language: 'Dictation can’t understand {lang} here yet.',
};

/** The shortcut that starts and stops it, as shown, and its test (Ctrl+Shift+Space, on a Mac too). */
export const DICTATION_KEY = 'Ctrl+Shift+Space';
export const isDictationKey = (e) => !!e && e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && (e.code === 'Space' || e.key === ' ');

/** The browser's speech recogniser, or null (Firefox has none). */
export function recognitionClass(win = globalThis) {
  return win?.SpeechRecognition || win?.webkitSpeechRecognition || null;
}

/** Whether the panel offers dictation in this browser: one whose recogniser works (Chromium browsers without
 * Google's or Microsoft's service have the class, and every attempt fails), and never Firefox for now. */
export function dictationOffered(browser, Recognition) {
  if (!Recognition) return false;
  return ['Chrome', 'Edge', 'Safari', 'Arc'].includes(String(browser || ''));
}

/** The words people see, for this browser: `table` is a string or {Chrome, Edge, Safari, other}. */
export function wordsFor(table, browser, vars = {}) {
  const s = typeof table === 'string' ? table : (table[browser] ?? table.other);
  return s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? (k === 'browser' ? browser : m)));
}

/** `text` with `words` after it: what's there is never changed, a space between when needed. */
export function appendWords(text, words) {
  const w = String(words ?? '').replace(/\s+/g, ' ').trim();
  text = String(text ?? '');
  if (!w) return text;
  if (!text || /\s$/.test(text)) return text + w;
  return `${text} ${w}`;
}

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** What a final result adds when the same result was final before: only its new words when it starts with the old
 * ones, nothing when it's the same, all of it otherwise (another stretch said: never dropped). */
function finalAdds(prev, next) {
  if (prev === undefined) return next;
  const a = norm(prev), b = norm(next);
  if (a === b) return '';
  const pw = String(prev).trim().split(/\s+/).filter(Boolean), nw = String(next).trim().split(/\s+/).filter(Boolean);
  if (a && (b === a || b.startsWith(`${a} `))) return nw.slice(pw.length).join(' ');
  return next;
}

/** Whether `next` (the words being heard) is a new transcription rather than a revision of `prev`: shorter, and
 * starting with other words or much shorter (Safari starts over after a pause within one session). */
function isFresh(prev, next) {
  const p = norm(prev).split(' ').filter(Boolean), n = norm(next).split(' ').filter(Boolean);
  if (p.length < 2 || n.length >= p.length) return false;
  if (!n.length) return true;
  for (let i = 0; i < Math.min(2, n.length); i++) if (n[i] !== p[i]) return true;
  return n.length * 3 <= p.length * 2;
}

const RETRY_MS = [250, 1000, 2000, 5000, 10000];
const SETTLE_MS = 3000; // after misses: a session this long without one is listening again
const STOP_GRACE_MS = 2500; // after the person's stop: the last words' time to come in

/**
 * The dictation's state and its recogniser sessions; the panel draws it (view) and gives it the box.
 * deps: {
 *   Recognition: the recogniser's class;
 *   lang: its language ('' for the browser's own);
 *   browser: 'Chrome' | 'Edge' | 'Safari' | …, for the words;
 *   getText(), setText(text): the box;
 *   changed(): something shown changed;
 *   permission(): Promise<'granted'|'denied'|'prompt'|'unknown'>: the microphone's, for TRIF;
 *   askPage(): Promise<'granted'|'denied'|'nomic'|'closed'> or null: mic.html's question (null: none here);
 *   canPrompt: whether the browser can ask in this page (false in Chrome's and Edge's side panel);
 *   setTimer(fn, ms), clearTimer(t), now(): for the tests.
 * }
 * Returns { view(), start(), stop(), toggle(), granted(), dispose() }.
 */
export function createDictation(deps) {
  const setTimer = deps.setTimer || ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer || ((t) => clearTimeout(t));
  const now = deps.now || (() => Date.now());
  const browser = () => (typeof deps.browser === 'function' ? deps.browser() : deps.browser) || 'Chrome';
  let lang = deps.lang || '';
  let triedDefaultLang = false;

  let active = false;     // the person wants it listening (from their start to their stop)
  let phase = 'off';      // 'off' | 'starting' | 'asking' | 'listening' | 'retrying'
  let interim = '';
  let note = null;        // {kind: 'bad'|'quiet', text, fix?: 'settings'}
  let rec = null;         // the session's recogniser
  let session = 0;        // the session's number: events of older ones are ignored
  let misses = 0;         // sessions in a row that failed
  let retryTimer = null, settleTimer = null, stopTimer = null;
  let asked = false;      // mic.html already opened for this press
  let live = new Map();   // this session's results being heard: index -> text
  let finals = new Map(); // this session's finished results: index -> text

  const show = () => { try { deps.changed?.(); } catch { /* the panel's */ } };
  const commit = (words) => {
    const w = String(words ?? '').trim();
    if (w) deps.setText(appendWords(deps.getText(), w));
  };
  const bad = (table, vars) => ({ kind: 'bad', text: wordsFor(table, browser(), vars) });
  const clearTimers = () => { for (const t of [retryTimer, settleTimer, stopTimer]) if (t) clearTimer(t); retryTimer = settleTimer = stopTimer = null; };

  /** The words heard but not finished, into the box: the session ended or was dropped. */
  function keepLive() {
    for (const [, t] of [...live.entries()].sort((a, b) => a[0] - b[0])) commit(t);
    live = new Map();
    interim = '';
  }

  /** Ends the session going (its later events ignored), keeping every word. */
  function drop() {
    session++;
    const r = rec;
    rec = null;
    if (r) { r.onstart = r.onresult = r.onerror = r.onend = null; try { r.abort(); } catch { /* ended */ } }
    keepLive();
  }

  /** It can't go on (blocked, no microphone…): stopped, every word kept, the note shown. */
  function fail(n) {
    active = false;
    clearTimers();
    drop();
    phase = 'off';
    note = n;
    show();
  }

  function begin() {
    if (!active) return;
    retryTimer = null;
    let r;
    try {
      r = new deps.Recognition();
      r.continuous = true;
      r.interimResults = true;
      r.maxAlternatives = 1;
      if (lang) r.lang = lang;
    } catch {
      fail(bad(DICTATION_WORDS.serviceOff));
      return;
    }
    const id = ++session;
    rec = r;
    live = new Map();
    finals = new Map();
    let started = false, heard = false, errored = null;
    const begunAt = now();
    const mine = () => id === session && rec === r;

    r.onstart = () => {
      if (!mine()) return;
      started = true;
      if (!misses) { phase = 'listening'; show(); return; }
      // (after misses: listening again only once a session holds, or words come)
      if (settleTimer) clearTimer(settleTimer);
      settleTimer = setTimer(() => { settleTimer = null; if (mine() && active) settled(); }, SETTLE_MS);
    };
    const settled = () => {
      misses = 0;
      if (note?.kind === 'quiet' && note.text === DICTATION_WORDS.reconnecting) note = null;
      if (active) phase = 'listening';
      show();
    };
    r.onresult = (e) => {
      if (id !== session) return;
      const results = e?.results || [];
      let heardNow = '';
      for (let i = 0; i < results.length; i++) {
        const res = results[i];
        const t = String(res?.[0]?.transcript ?? '');
        if (res?.isFinal) {
          const add = finalAdds(finals.get(i), t);
          finals.set(i, t);
          live.delete(i);
          commit(add);
        } else {
          // Safari: a result that starts over after a pause within the session: the words it dropped are kept
          const before = live.get(i);
          if (browser() === 'Safari' && before && isFresh(before, t)) commit(before);
          live.set(i, t);
          heardNow = appendWords(heardNow, t);
        }
      }
      interim = heardNow;
      if (results.length) heard = true;
      if (misses && active) settled();
      else show();
    };
    r.onerror = (e) => {
      if (!mine()) return;
      const code = String(e?.error || 'unknown');
      errored = code;
      if (code === 'not-allowed') { notAllowed(); return; }
      if (code === 'service-not-allowed') { fail(bad(DICTATION_WORDS.serviceOff)); return; }
      if (code === 'audio-capture') { fail(bad(DICTATION_WORDS.noMic)); return; }
      if (code === 'language-not-supported') {
        if (lang && !triedDefaultLang) { triedDefaultLang = true; lang = ''; return; } // (the browser's own, at the restart)
        fail(bad(DICTATION_WORDS.language, { lang: deps.lang || navigatorLanguage() }));
        return;
      }
      // 'no-speech', 'aborted': nothing; 'network' and the rest: a miss (onend starts again)
    };
    r.onend = () => {
      if (!mine()) return;
      rec = null;
      keepLive();
      if (settleTimer) { clearTimer(settleTimer); settleTimer = null; }
      if (!active) { if (stopTimer) { clearTimer(stopTimer); stopTimer = null; } phase = 'off'; show(); return; }
      // A miss: an error other than a pause, or a session that never started or ended at once with nothing heard.
      const quiet = errored === 'no-speech' || errored === 'aborted';
      const missed = (errored && !quiet) || !started || (!heard && !errored && now() - begunAt < 1000);
      if (!missed) {
        if (misses) settled();
        retryTimer = setTimer(begin, 0);
        return;
      }
      misses++;
      if (misses >= 2) note = { kind: 'quiet', text: DICTATION_WORDS.reconnecting };
      phase = 'retrying';
      show();
      retryTimer = setTimer(begin, RETRY_MS[Math.min(misses - 1, RETRY_MS.length - 1)]);
    };
    try {
      r.start();
    } catch {
      // (a recogniser that won't start: a miss, tried again)
      session++;
      rec = null;
      misses++;
      phase = 'retrying';
      if (misses >= 2) note = { kind: 'quiet', text: DICTATION_WORDS.reconnecting };
      show();
      retryTimer = setTimer(begin, RETRY_MS[Math.min(misses - 1, RETRY_MS.length - 1)]);
    }
  }

  /** The recogniser wasn't allowed the microphone: mic.html's question when the browser never asked, else the note. */
  async function notAllowed() {
    drop();
    const p = await permissionNow();
    if (!active) return;
    if (p !== 'denied' && !asked && deps.askPage) { await ask(); return; }
    fail({ ...bad(DICTATION_WORDS.blocked), fix: 'settings' });
  }

  async function permissionNow() {
    try { return (await deps.permission?.()) || 'unknown'; } catch { return 'unknown'; }
  }

  async function ask() {
    asked = true;
    phase = 'asking';
    note = { kind: 'quiet', text: DICTATION_WORDS.asking };
    show();
    let answer = 'closed';
    try { answer = (await deps.askPage()) || 'closed'; } catch { answer = 'closed'; }
    if (!active || phase !== 'asking') return; // (stopped meanwhile, or granted() went first)
    if (answer === 'granted') { note = null; phase = 'starting'; show(); begin(); return; }
    if (answer === 'denied') { fail({ ...bad(DICTATION_WORDS.blocked), fix: 'settings' }); return; }
    if (answer === 'nomic') { fail(bad(DICTATION_WORDS.noMic)); return; }
    fail(null); // (the tab closed without an answer: back to how it was)
  }

  /** The person's start. */
  async function start() {
    if (active) return;
    // (the last stop's session still finishing: its words so far kept, and a new one)
    clearTimers();
    if (rec) drop();
    active = true;
    asked = false;
    misses = 0;
    triedDefaultLang = false;
    lang = deps.lang || '';
    note = null;
    phase = 'starting';
    show();
    const p = await permissionNow();
    if (!active || phase !== 'starting' || rec) return;
    if (p === 'denied') { fail({ ...bad(DICTATION_WORDS.blocked), fix: 'settings' }); return; }
    if (p === 'prompt' && !deps.canPrompt && deps.askPage) { await ask(); return; }
    begin();
  }

  /** The person's stop: never sends. The last words still come in, for a moment. */
  function stop() {
    if (!active) return;
    active = false;
    clearTimers();
    if (note?.kind === 'quiet') note = null;
    phase = 'off';
    const r = rec;
    if (r) {
      try { r.stop(); } catch { drop(); }
      if (rec) stopTimer = setTimer(() => { stopTimer = null; if (rec === r) drop(); show(); }, STOP_GRACE_MS);
    } else {
      drop();
    }
    show();
  }

  /** Sending while it listens (Tim 11-21): it stops at once, the words still being heard go into the box first
   *  (so they're sent), and anything the recogniser says afterwards is ignored (it would land in the emptied box). */
  function endForSend() {
    if (!active && !rec) return;
    active = false;
    clearTimers();
    if (note?.kind === 'quiet') note = null;
    phase = 'off';
    drop();
    show();
  }

  /** The microphone was allowed (mic.html said so): a blocked note goes. */
  function granted() {
    if (note?.fix === 'settings') { note = null; show(); }
    if (active && phase === 'asking') { note = null; phase = 'starting'; show(); begin(); }
  }

  return {
    view: () => ({ active, phase, listening: phase === 'listening', interim, note }),
    start,
    stop,
    toggle: () => (active ? stop() : start()),
    endForSend,
    granted,
    dismissNote: () => { if (note) { note = null; show(); } },
    dispose: () => { active = false; clearTimers(); drop(); phase = 'off'; },
  };
}

const navigatorLanguage = () => globalThis.navigator?.language || '';

/** The recogniser's language: the browser's interface language. */
export function dictationLang() {
  try { const l = globalThis.chrome?.i18n?.getUILanguage?.(); if (l) return l; } catch { /* none */ }
  return navigatorLanguage();
}

/** The words on mic.html, the page that asks for the microphone (drafts: docs/DICTATION-STRINGS.md). */
export const MIC_PAGE_WORDS = {
  title: 'Allow the microphone',
  lead: 'So you can talk to TRIF’s message box instead of typing.',
  asking: 'Choose Allow when {browser} asks.',
  granted: 'Microphone allowed. Taking you back…',
  dismissed: 'You closed the question without answering.',
  askAgain: 'Ask again',
  closeTab: 'Close this tab',
};

/** The browser's own settings page for TRIF's microphone, or null (Safari has none to open). */
export function micSettingsUrl(browser, origin) {
  if (browser === 'Safari' || browser === 'Firefox') return null;
  const scheme = browser === 'Edge' ? 'edge' : 'chrome';
  return `${scheme}://settings/content/siteDetails?site=${encodeURIComponent(String(origin).replace(/\/$/, ''))}`;
}

/** The microphone's permission for this page's origin: 'granted' | 'denied' | 'prompt' | 'unknown'. */
export async function micPermission() {
  try { return (await navigator.permissions.query({ name: 'microphone' })).state || 'unknown'; } catch { return 'unknown'; }
}

/** mic.html and the panels talk on this (the extension's own pages only: one origin). */
export const MIC_CHANNEL = 'trif-mic';

const MIC_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5.75" y="1.75" width="4.5" height="8" rx="2.25"/><path d="M3.25 7.5a4.75 4.75 0 0 0 9.5 0M8 12.25v2"/></svg>';

/**
 * The panel's side: the mic button in the message box, the words being heard under the box’s text, the note above it, the
 * shortcut. opts: { composer, input, browser() (the name, live: the helper may name it later), canPrompt,
 * openNear(url) (a tab beside the page the panel shows; resolves to the tab), storage (chrome.storage.local) }.
 */
export function mountDictation(opts) {
  const { composer, input } = opts;
  const Recognition = recognitionClass(globalThis);
  const browser = () => opts.browser() || 'Chrome';
  const button = document.createElement('button');
  button.id = 'mic';
  button.type = 'button';
  button.className = 'send mic';
  button.hidden = true;
  button.setAttribute('aria-pressed', 'false');
  button.innerHTML = MIC_SVG;
  composer.querySelector('.send')?.before(button);
  const liveLine = document.createElement('p');
  liveLine.className = 'dictation-live';
  liveLine.hidden = true;
  liveLine.setAttribute('aria-hidden', 'true');
  input.after(liveLine); // (under the box's text, where the words will go)
  const noteLine = document.createElement('div');
  noteLine.className = 'dictation-note';
  noteLine.setAttribute('role', 'status');
  noteLine.hidden = true;
  composer.before(noteLine);

  let firstUse = null; // the one-time line about where the audio goes: shown during the first listen
  let noteSeen = true;
  opts.storage?.get('dictationNoteSeen').then((r) => { noteSeen = !!r?.dictationNoteSeen; }, () => {});

  // mic.html's answer: by the channel (its question's id), or the tab closing first
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(MIC_CHANNEL) : null;
  let waiting = null; // {id, tabId, resolve}
  channel?.addEventListener('message', (e) => {
    const m = e.data;
    if (!m || m.type !== 'mic') return;
    if (waiting && m.ask === waiting.id) { const w = waiting; waiting = null; w.resolve(m.result); }
    if (m.result === 'granted') dictation.granted();
  });
  globalThis.chrome?.tabs?.onRemoved?.addListener((tabId) => {
    if (waiting && waiting.tabId === tabId) { const w = waiting; waiting = null; w.resolve('closed'); }
  });
  const askPage = async () => {
    const id = Math.random().toString(36).slice(2);
    const answer = new Promise((resolve) => { waiting = { id, tabId: null, resolve }; });
    try {
      const tab = await opts.openNear(globalThis.chrome.runtime.getURL(`mic.html?ask=${id}`));
      if (waiting?.id === id) waiting.tabId = tab?.id ?? null;
    } catch { if (waiting?.id === id) { waiting = null; return 'closed'; } }
    return answer;
  };

  const dictation = createDictation({
    Recognition,
    lang: dictationLang(),
    browser,
    getText: () => input.value,
    setText: (t) => {
      input.value = t;
      input.dispatchEvent(new Event('input', { bubbles: true })); // (the panel keeps drafts from it)
    },
    changed: render,
    permission: micPermission,
    askPage,
    canPrompt: opts.canPrompt,
  });

  function render() {
    const v = dictation.view();
    const offered = dictationOffered(browser(), Recognition);
    button.hidden = !offered;
    composer.classList.toggle('has-mic', offered);
    if (!offered) { liveLine.hidden = true; noteLine.hidden = true; return; }
    button.disabled = input.disabled && !v.active;
    button.classList.toggle('on', v.active);
    button.classList.toggle('listening', v.listening);
    button.setAttribute('aria-pressed', String(v.active));
    const label = v.active ? DICTATION_WORDS.stop : DICTATION_WORDS.start;
    button.setAttribute('aria-label', label);
    button.title = v.active && !v.listening ? DICTATION_WORDS.starting
      : wordsFor(v.active ? DICTATION_WORDS.stopTitle : DICTATION_WORDS.startTitle, browser(), { key: DICTATION_KEY });
    button.setAttribute('aria-keyshortcuts', 'Control+Shift+Space');
    composer.classList.toggle('dictating', v.active);
    liveLine.textContent = v.interim;
    liveLine.hidden = !v.interim;
    // The note: the dictation's own, else the first listen's line about where the audio goes
    if (v.listening && !noteSeen && !firstUse) {
      firstUse = wordsFor(DICTATION_WORDS.firstUse, browser());
      noteSeen = true;
      opts.storage?.set({ dictationNoteSeen: true }).catch?.(() => {});
    }
    if (!v.active && firstUse) firstUse = null;
    const n = v.note || (firstUse ? { kind: 'quiet', text: firstUse } : null);
    const key = n ? JSON.stringify([n.kind, n.text, n.fix || '']) : '';
    if (noteLine.dataset.key !== key) {
      noteLine.dataset.key = key;
      noteLine.hidden = !n;
      noteLine.classList.toggle('bad', n?.kind === 'bad');
      noteLine.setAttribute('role', n?.kind === 'bad' ? 'alert' : 'status');
      const parts = [];
      if (n) {
        const text = document.createElement('span');
        text.textContent = n.text;
        parts.push(text);
        const url = n.fix === 'settings' && micSettingsUrl(browser(), location.origin);
        if (url) {
          const fix = document.createElement('button');
          fix.type = 'button';
          fix.className = 'btn dictation-fix';
          fix.textContent = DICTATION_WORDS.openSettings;
          fix.addEventListener('click', () => { opts.openNear(url).catch(() => {}); });
          parts.push(fix);
        }
      }
      noteLine.replaceChildren(...parts);
    }
  }

  button.addEventListener('click', () => dictation.toggle());
  document.addEventListener('keydown', (e) => {
    if (button.hidden || button.disabled) return;
    if (isDictationKey(e)) { e.preventDefault(); e.stopPropagation(); dictation.toggle(); return; }
    // (Escape in the box stops it too, keeping the words; never sends)
    if (e.key === 'Escape' && e.target === input && dictation.view().active) { e.preventDefault(); e.stopPropagation(); dictation.stop(); }
  }, true);
  addEventListener('pagehide', () => dictation.dispose());
  render();
  return { render, dictation };
}
