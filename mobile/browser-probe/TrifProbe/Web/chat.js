// TRIF in the chat (proof of concept, branch ios-poc; Tim, 11-13 and 11-15): a small mod for claude.ai and
// chatgpt.com, run in a world of its own beside their page (ClaudePane.chatWorld), so their code can't reach
// it. What it does, and nothing else:
//   - an "Add to TRIF" button under each code block that holds a whole mod file (==WebMod== … ==/WebMod==):
//     a tap hands the block's text to the app, which shows its Add this mod? sheet;
//   - fill(text, png): puts text (and a picture) into the message box, as a paste, for the person to send;
//   - the person's send (the send button, or Return in the message box) told to the app, which goes back to
//     the tab; then the reply watched until it's done, and the mod files in it (code blocks that weren't there
//     before the send) handed to the app, which asks Add this mod? about each (Tim, 11-15).
// It never sends a message, never reads the conversation except code blocks and whether a reply is still
// being written, and keeps nothing.
(() => {
  if (globalThis.__trifChat) return;
  const post = (m) => { try { return window.webkit.messageHandlers.trif.postMessage(m); } catch (e) { return null; } };
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 20 && r.height > 10; };

  /** The message box: Claude's and ChatGPT's are ProseMirror editors; else the last visible editable thing. */
  function editor() {
    const list = [...document.querySelectorAll('div.ProseMirror[contenteditable="true"], #prompt-textarea, [contenteditable="true"], textarea')].filter(visible);
    return list[list.length - 1] || null;
  }

  /** One paste into the message box: true if the page took it (its paste handler cancelled the event). */
  function paste(ed, dt) {
    let ev;
    try { ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }); } catch (e) { return false; }
    ed.dispatchEvent(ev);
    return ev.defaultPrevented;
  }

  /**
   * Puts `text` (and a PNG, base64) into the message box, as the person's own pastes would go: the picture
   * first, on its own (a page takes a picture and drops text pasted with it), then the text; typed in if
   * the page doesn't take a pasted text. `name`: the text as an attached file of that name instead (the report
   * after a mod is added: Tim, 11-13), so the person's own words stay theirs.
   */
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let pdfPastedAt = 0;
  // (each attachment's own tile: never the row they sit in, Claude's [data-cds="MessageAttachments"], whose label
  // would cover every tile in it: Tim, 11-14, saw the instruction labelled "TRIF screenshot", the row marked
  // while only the picture was in it)
  const TILES = '[data-testid="file-thumbnail"], [data-cds^="MessageAttachments"]:not([data-cds="MessageAttachments"]), span[class*="group/composer-attachment"]';
  /** How many attachment tiles in the message box carry this name (in their text, a picture's alt or a label). */
  function tiles(label) {
    return [...document.querySelectorAll(TILES)].filter((t) => `${t.textContent || ''} ${[...t.querySelectorAll('img[alt], [aria-label]')]
      .map((i) => i.alt || i.getAttribute('aria-label')).join(' ')}`.includes(label)).length;
  }

  async function fill(text, png, name, pdf, picture) {
    // (a chat that has only just loaded isn't ready for a paste: its page finished, then a moment)
    if (document.readyState !== 'complete') { await new Promise((r) => addEventListener('load', r, { once: true })); await wait(800); }
    // (a chat that has only just loaded draws its message box a moment later: up to 10 s)
    let ed = editor();
    for (let i = 0; !ed && i < 50; i++) { await wait(200); ed = editor(); }
    if (!ed) return 'no message box';
    ed.focus();
    const said = [];
    if (png) {
      const dt = new DataTransfer();
      const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
      dt.items.add(new File([bytes], picture || 'TRIF screenshot.png', { type: 'image/png' }));
      said.push(paste(ed, dt) ? 'picture pasted' : 'picture not taken');
      await wait(300);
    }
    if (pdf) {
      // (the whole page, after the screenshot of the screen, on its own as the picture is)
      const dt = new DataTransfer();
      const bytes = Uint8Array.from(atob(pdf), (c) => c.charCodeAt(0));
      dt.items.add(new File([bytes], 'TRIF full page.pdf', { type: 'application/pdf' }));
      pdfPastedAt = Date.now();
      said.push(paste(editor() || ed, dt) ? 'PDF pasted' : 'PDF not taken');
      await wait(300);
    }
    if (text && name) {
      // (a chat that has only just loaded may take the file late, without saying so at the paste: Tim, 11-14,
      // got the attachment and the whole text typed in too. So: its tile looked for, and one more try, before
      // the text goes in as text)
      const label = name.replace(/\.[^.]*$/, '');
      for (let tryNo = 1; tryNo <= 2; tryNo++) {
        const before = tiles(label);
        const dt = new DataTransfer();
        dt.items.add(new File([text], name, { type: 'text/plain' }));
        const took = paste(editor() || ed, dt);
        for (let i = 0; i < 25 && !took && tiles(label) <= before; i++) await wait(100);
        if (took || tiles(label) > before) { said.push(took ? 'text attached' : 'text attached (late)'); return said.join(', '); }
        said.push(`file not taken (try ${tryNo})`);
        await wait(1000);
      }
      said.push('so as text');
    }
    if (text) {
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      if (paste(ed, dt)) said.push('text pasted');
      else {
        if (ed.localName === 'textarea') { ed.value += text; ed.dispatchEvent(new Event('input', { bubbles: true })); }
        else document.execCommand('insertText', false, text);
        said.push('text typed');
      }
    }
    return said.join(', ') || 'nothing';
  }

  /** Under each finished mod file in a code block, an Add to TRIF button (once). */
  function mark() {
    // (what TRIF attached, by its file's name: its tile marked for the small pill above, the label its name)
    // (Claude's tiles, then ChatGPT's: a span of the group/composer-attachment class; a picture's name only in
    // its alt or its remove button's label)
    for (const row of document.querySelectorAll('[data-cds="MessageAttachments"][data-trif-chip]')) row.removeAttribute('data-trif-chip');
    for (const tile of document.querySelectorAll(TILES)) {
      if (tile.querySelector(TILES)) continue; // (a tile around tiles: a row by another name)
      const names = `${tile.textContent || ''} ${tile.getAttribute('aria-label') || ''} ${tile.title || ''} ${[...tile.querySelectorAll('img[alt], [aria-label], [title]')]
        .map((i) => i.alt || i.getAttribute('aria-label') || i.title).join(' ')}`;
      let label = ['TRIF instruction', 'TRIF follow-up', 'TRIF screenshot', 'TRIF full page', 'TRIF pointer'].find((l) => names.includes(l));
      // (Claude's PDF tile shows only "PDF", its name nowhere: the one TRIF pasted in the last few minutes)
      if (!label && /^\s*PDF\s*$/.test(tile.textContent || '') && Date.now() - pdfPastedAt < 300000) label = 'TRIF full page';
      if (label && tile.getAttribute('data-trif-chip') !== label) tile.setAttribute('data-trif-chip', label);
      else if (!label && tile.hasAttribute('data-trif-chip')) tile.removeAttribute('data-trif-chip');
    }
    // (no button while a reply is being written: a mod's header comes before its code, so a button then would
    // hand over half a mod)
    if (replying()) return;
    for (const pre of document.querySelectorAll('pre')) {
      if (pre.nextElementSibling && pre.nextElementSibling.classList.contains('trif-add')) continue;
      const t = pre.textContent || '';
      if (!t.includes('==WebMod==') || !t.includes('==/WebMod==')) continue;
      const b = document.createElement('button');
      b.className = 'trif-add';
      b.type = 'button';
      b.textContent = 'Add to TRIF';
      b.setAttribute('style', 'all:initial;display:inline-block;margin:6px 0 10px;padding:6px 14px;border-radius:999px;' +
        'background:#34d399;color:#04291c;font:600 14px -apple-system,system-ui,sans-serif;cursor:pointer;');
      b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); post({ type: 'mod', text: pre.innerText || '' }); });
      pre.after(b);
    }
  }
  // The send button in TRIF's green (Tim, 11-14): Claude paints it on a layer inside the button
  // ([data-cds-part=paint]); ChatGPT on the button. And what TRIF attaches (the page, "TRIF instruction"; after a
  // mod is added, "TRIF follow-up", "TRIF screenshot" and "TRIF full page") as small pills saying so, not big tiles
  // (data-trif-chip, set by mark below); their remove buttons stay.
  const style = document.createElement('style');
  style.textContent = `
    button[data-testid="chat-input-send"]:not(:disabled) [data-cds-part="paint"],
    button[data-testid="send-button"]:not(:disabled), #composer-submit-button:not(:disabled),
    button[aria-label="Send"]:not(:disabled), button[data-testid="composer-speech-button"], button[aria-label*="voice" i] {
      background: #34d399 !important; background-color: #34d399 !important; border-color: transparent !important;
    }
    button[data-testid="chat-input-send"]:not(:disabled), button[data-testid="send-button"]:not(:disabled),
    #composer-submit-button:not(:disabled), button[aria-label="Send"]:not(:disabled), button[data-testid="composer-speech-button"],
    button[aria-label*="voice" i] { color: #04291c !important; }
    :is(button[aria-label="Send"], button[data-testid="composer-speech-button"], button[aria-label*="voice" i]) svg { color: #04291c !important; }
    /* (ChatGPT's tile: its picture and name hidden, the label before them, its remove button kept) */
    span[data-trif-chip][class*="composer-attachment"] { width: auto !important; height: auto !important; }
    span[data-trif-chip][class*="composer-attachment"] > .composer-attachment-surface.flex { display: none !important; }
    span[data-trif-chip][class*="composer-attachment"]::before {
      display: inline-block; padding: 7px 16px; border-radius: 999px; background: #e3f7ee; color: #0f6b4a;
      font: 600 13px/1.2 -apple-system, system-ui, sans-serif; white-space: nowrap;
    }
    span[data-trif-chip="TRIF instruction"][class*="composer-attachment"]::before { content: "TRIF instruction"; }
    span[data-trif-chip="TRIF follow-up"][class*="composer-attachment"]::before { content: "TRIF follow-up"; }
    span[data-trif-chip="TRIF screenshot"][class*="composer-attachment"]::before { content: "TRIF screenshot"; }
    span[data-trif-chip="TRIF full page"][class*="composer-attachment"]::before { content: "TRIF full page"; }
    span[data-trif-chip="TRIF pointer"][class*="composer-attachment"]::before { content: "TRIF pointer"; }
    [data-trif-chip] { width: auto !important; height: auto !important; min-width: 0 !important; align-self: flex-start; }
    [data-trif-chip] [data-cds-card-body] { padding: 6px 14px !important; flex-direction: row !important; align-items: center !important; }
    [data-trif-chip] [data-cds-card-body] > div, [data-trif-chip] img, [data-trif-chip] picture { display: none !important; }
    [data-trif-chip] [data-cds-card-body]::after {
      font: 600 13px/1.2 -apple-system, system-ui, sans-serif; color: #0f6b4a; white-space: nowrap;
    }
    [data-trif-chip] .cds-card-fill { background: #e3f7ee !important; }
    [data-trif-chip="TRIF instruction"] [data-cds-card-body]::after { content: "TRIF instruction"; }
    [data-trif-chip="TRIF follow-up"] [data-cds-card-body]::after { content: "TRIF follow-up"; }
    [data-trif-chip="TRIF screenshot"] [data-cds-card-body]::after { content: "TRIF screenshot"; }
    [data-trif-chip="TRIF full page"] [data-cds-card-body]::after { content: "TRIF full page"; }
    [data-trif-chip="TRIF pointer"] [data-cds-card-body]::after { content: "TRIF pointer"; }
    /* (Claude's picture-preview tile, a PDF's: a fixed box with the preview and "pdf" in it; the box made a pill,
       its insides hidden, the remove button kept: Tim, 11-14) */
    [data-trif-chip][class*="group/thumbnail"] > div:first-child {
      width: auto !important; height: auto !important; min-width: 0 !important; min-height: 0 !important;
      border-radius: 999px !important; border: 0 !important; box-shadow: none !important; background: #e3f7ee !important;
      padding: 7px 16px !important; font: 600 13px/1.2 -apple-system, system-ui, sans-serif; color: #0f6b4a; white-space: nowrap;
    }
    [data-trif-chip][class*="group/thumbnail"] > div:first-child > * { display: none !important; }
    [data-trif-chip="TRIF instruction"][class*="group/thumbnail"] > div:first-child::before { content: "TRIF instruction"; }
    [data-trif-chip="TRIF follow-up"][class*="group/thumbnail"] > div:first-child::before { content: "TRIF follow-up"; }
    [data-trif-chip="TRIF screenshot"][class*="group/thumbnail"] > div:first-child::before { content: "TRIF screenshot"; }
    [data-trif-chip="TRIF full page"][class*="group/thumbnail"] > div:first-child::before { content: "TRIF full page"; }
    [data-trif-chip="TRIF pointer"][class*="group/thumbnail"] > div:first-child::before { content: "TRIF pointer"; }
    @media (prefers-color-scheme: dark) {
      [data-trif-chip] .cds-card-fill { background: rgba(52, 211, 153, 0.16) !important; }
      [data-trif-chip] [data-cds-card-body]::after { color: #34d399; }
      span[data-trif-chip][class*="composer-attachment"]::before { background: rgba(52, 211, 153, 0.16); color: #34d399; }
      [data-trif-chip][class*="group/thumbnail"] > div:first-child { background: rgba(52, 211, 153, 0.16) !important; color: #34d399; }
    }`;
  (document.head || document.documentElement).append(style);

  // The send, and the reply after it (Tim, 11-15: "the moment you hit send, trif pops you back over to your
  // tab … when claude is done, TRIF just goes and gets the code").
  //   Sent: a tap on the send button, Return in the message box, or the composer's form submitted, and then,
  //   within 2.5 s, the page showing it went: a new message of the person's, a stop button, or the message box
  //   emptied. (Return that only made a new line, or a send the page refused, isn't a send.)
  //   Still working: Claude's stop button ("Stop response") or its reply marked data-is-streaming="true";
  //   ChatGPT's stop button (data-testid="stop-button", "Stop streaming"). Done: that's gone, and the last reply
  //   hasn't changed for 1.2 s. If neither was ever seen (a chat that changed its page), done is the last reply
  //   unchanged for 6 s with the message box there and no stop button.
  //   Watched with a MutationObserver, its checks at most every half second and once more after the page goes
  //   quiet; it stops when the reply is done (or after 15 minutes).
  const STOP = 'button[aria-label="Stop response"], button[aria-label="Stop streaming"], button[aria-label="Stop generating"], button[data-testid="stop-button"], [data-is-streaming="true"]';
  const SEND = 'button[data-testid="send-button"], #composer-submit-button, button[aria-label="Send message"], button[aria-label="Send prompt"], button[aria-label="Send"], button[data-testid="chat-input-send"]';
  const USER = '[data-testid="user-message"], [data-message-author-role="user"]';
  const REPLY = '[data-is-streaming], .font-claude-response, [data-message-author-role="assistant"]';
  const replying = () => !!document.querySelector(STOP);

  /** The message box's surroundings (where what's attached shows): its widest ancestor, up to eight levels, that
   *  holds none of the conversation's messages. */
  function composerBox() {
    const ed = editor();
    if (!ed) return null;
    let n = ed;
    for (let i = 0; i < 8; i++) {
      const p = n.parentElement;
      if (!p || p === document.body || p === document.documentElement || p.querySelector(USER) || p.querySelector(REPLY)) break;
      n = p;
    }
    return n;
  }
  function composerText() {
    const ed = editor();
    return ed ? String(ed.localName === 'textarea' ? ed.value : ed.textContent || '').trim() : '';
  }
  /** What's in the message box now: its text, and the names of what's attached. */
  function composer() {
    const box = composerBox();
    const names = box ? [...box.querySelectorAll(TILES)].filter((t) => !t.querySelector(TILES))
      .map((t) => `${t.textContent || ''} ${t.getAttribute('data-trif-chip') || ''} ${[...t.querySelectorAll('img[alt], [aria-label]')].map((i) => i.alt || i.getAttribute('aria-label')).join(' ')}`) : [];
    return { text: composerText(), names };
  }

  /** The mod files in code blocks: [{ key: its header, text }], in page order. */
  function modBlocks(onlyAfter) {
    const out = [];
    for (const pre of document.querySelectorAll('pre')) {
      if (onlyAfter && !(onlyAfter.compareDocumentPosition(pre) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
      const raw = pre.textContent || '';
      const end = raw.search(/==\/WebMod==/);
      if (raw.indexOf('==WebMod==') === -1 || end === -1) continue;
      out.push({ key: raw.slice(0, end), raw, pre });
    }
    return out;
  }
  /** What tells a reply is still changing: the last reply's text (or, without one, how much text the page has). */
  function signature() {
    const all = document.querySelectorAll(REPLY);
    const last = all[all.length - 1];
    return last ? `${all.length}:${last.textContent || ''}` : `page:${document.body ? document.body.textContent.length : 0}`;
  }

  let sending = false;
  let watch = null;
  let last = null; // after a reply: { seen: the mod files known, path } (a mod that turns up late is still offered)
  function maybeSent(how) {
    if (sending || watch) return;
    const c = composer();
    if (!c.text && !c.names.length) return;
    const withInstructions = c.names.some((n) => n.includes('TRIF instruction')) || c.text.includes('--- How TRIF mods are written ---');
    const users = document.querySelectorAll(USER).length;
    const seen = new Set(modBlocks().map((b) => b.raw));
    sending = true;
    const t0 = Date.now();
    const check = () => {
      const now = composer();
      const went = document.querySelectorAll(USER).length > users || replying() || (!now.text && !now.names.length);
      if (went) {
        sending = false;
        post({ type: 'sent', how, withInstructions });
        startWatch(seen);
      } else if (Date.now() - t0 > 2500) sending = false;
      else setTimeout(check, 150);
    };
    setTimeout(check, 100);
  }
  document.addEventListener('click', (e) => {
    const b = e.target && e.target.closest && e.target.closest(SEND);
    if (b && !b.disabled && b.getAttribute('aria-disabled') !== 'true') maybeSent('button');
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    const ed = editor();
    if (ed && (ed === e.target || ed.contains(e.target))) maybeSent('return');
  }, true);
  document.addEventListener('submit', (e) => { const ed = editor(); if (ed && e.target && e.target.contains && e.target.contains(ed)) maybeSent('form'); }, true);

  function startWatch(seen) {
    stopWatch();
    const w = { seen, saw: false, sig: null, at: Date.now(), started: Date.now(), timer: 0, queued: false, mo: null };
    watch = w;
    w.mo = new MutationObserver(() => {
      if (w.queued) return;
      w.queued = true;
      setTimeout(() => { w.queued = false; settle(w); }, 500);
    });
    w.mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-is-streaming', 'aria-label', 'disabled'] });
    settle(w);
  }
  function stopWatch() {
    if (!watch) return;
    watch.mo.disconnect();
    clearTimeout(watch.timer);
    watch = null;
  }
  function settle(w) {
    if (watch !== w) return;
    clearTimeout(w.timer);
    const now = Date.now();
    const busy = replying();
    if (busy) w.saw = true;
    const sig = signature();
    if (sig !== w.sig) { w.sig = sig; w.at = now; }
    const quiet = now - w.at;
    const done = !busy && !!editor() && (w.saw ? quiet >= 1200 : quiet >= 6000);
    if (done) return finish(w, w.saw ? 'done' : 'quiet');
    if (now - w.started > 15 * 60000) return finish(w, 'timed out');
    // (one more look once the page has gone quiet: nothing else wakes this up when nothing changes)
    w.timer = setTimeout(() => settle(w), !busy && w.saw ? 1300 : busy ? 4000 : 6100);
  }
  /** The reply's done: the mod files that weren't there before the send, the latest of each (by its header). */
  function finish(w, why) {
    stopWatch();
    const byKey = new Map();
    for (const b of modBlocks()) if (!w.seen.has(b.raw)) byKey.set(b.key, b);
    const mods = [...byKey.values()].map((b) => (b.pre.querySelector('code') || b.pre).innerText || b.raw);
    for (const b of modBlocks()) w.seen.add(b.raw);
    last = { seen: w.seen, path: location.pathname };
    post({ type: 'done', why, mods, stop: w.saw });
  }
  /** After a reply, a mod file that turns up later on the same conversation (a chat that paused, a revised block). */
  let lateSig = '';
  let lateTimer = 0;
  function late() {
    if (!last || watch || sending || replying() || location.pathname !== last.path) return;
    const fresh = modBlocks().filter((b) => !last.seen.has(b.raw));
    const sig = fresh.map((b) => b.raw).join('\n');
    // (offered once it's the same on two looks, the second a moment later even if nothing else changes)
    if (!fresh.length || sig !== lateSig) { lateSig = sig; if (fresh.length) { clearTimeout(lateTimer); lateTimer = setTimeout(late, 1500); } return; }
    lateSig = '';
    const byKey = new Map();
    for (const b of fresh) { byKey.set(b.key, b); last.seen.add(b.raw); }
    post({ type: 'done', why: 'late', mods: [...byKey.values()].map((b) => (b.pre.querySelector('code') || b.pre).innerText || b.raw), stop: false });
  }

  /** Whether this conversation already has TRIF's instructions in it (sent before, outside the message box). */
  function hasContext() {
    const count = (t) => (t.match(/TRIF instruction|--- How TRIF mods are written ---/g) || []).length;
    const box = composerBox();
    return count(document.body ? document.body.textContent || '' : '') > count(box ? box.textContent || '' : '');
  }
  /** For the app: is there a message box, is anything in it, does the chat have TRIF's instructions, is it replying. */
  function state() {
    const c = composer();
    return JSON.stringify({ editor: !!editor(), has: !!(c.text || c.names.length), context: hasContext(), working: replying() || !!watch });
  }
  /** The app's chat page loaded again while a reply was being written: watched again, from the person's last message. */
  function resume() {
    const users = document.querySelectorAll(USER);
    const lastUser = users[users.length - 1];
    const seen = new Set(modBlocks().filter((b) => !lastUser || !(lastUser.compareDocumentPosition(b.pre) & Node.DOCUMENT_POSITION_FOLLOWING)).map((b) => b.raw));
    startWatch(seen);
    return 'watching';
  }
  /** Opened at the reply: the person's last message at the top, the reply under it. */
  function showReply() {
    const users = document.querySelectorAll(USER);
    const lastUser = users[users.length - 1];
    if (lastUser) lastUser.scrollIntoView({ block: 'start' });
    return lastUser ? 'shown' : 'no message';
  }

  // The reply kept in view (Tim, 11-14): after a send, Claude scrolls the new message to the top of the
  // conversation, with room below it for the reply; in a pane this short that left only the empty room in view,
  // the reply and its "working" line above it. So: when the conversation's last message is wholly above what
  // shows (nothing but space below everything), it's brought back to sit 60% of the way down. Never when the
  // person has scrolled up to read (then the last message is below the view, not above it).
  const MSGS = '[data-testid="user-message"], [data-is-streaming], .font-claude-response, [data-message-author-role]';
  function scrollerOf(el) {
    for (let n = el && el.parentElement; n && n !== document.documentElement; n = n.parentElement) {
      if (/(auto|scroll)/.test(getComputedStyle(n).overflowY) && n.scrollHeight > n.clientHeight + 4) return n;
    }
    return null;
  }
  function reveal() {
    const all = document.querySelectorAll(MSGS);
    const last = all[all.length - 1];
    const sc = last && scrollerOf(last);
    if (!sc) return;
    const box = sc.getBoundingClientRect(), r = last.getBoundingClientRect();
    if (r.height > 0 && r.bottom < box.top + 24) sc.scrollTop -= box.top + box.height * 0.6 - r.bottom;
  }

  /** (development) Where things are: each scrolling element, the last message, the window. */
  function metrics() {
    const desc = (n) => n ? `${n.localName}${n.id ? `#${n.id}` : ''}${n.getAttribute('data-testid') ? `[data-testid=${n.getAttribute('data-testid')}]` : ''}.${String(n.className && n.className.baseVal !== undefined ? n.className.baseVal : n.className).split(/\s+/).slice(0, 4).join('.')}` : null;
    const rect = (n) => { const r = n.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom), Math.round(r.height)]; };
    const scrollers = [...document.querySelectorAll('*')].filter((n) => /(auto|scroll)/.test(getComputedStyle(n).overflowY) && n.scrollHeight > n.clientHeight + 4)
      .map((n) => ({ el: desc(n), rect: rect(n), scrollTop: Math.round(n.scrollTop), scrollHeight: n.scrollHeight, clientHeight: n.clientHeight }));
    const all = document.querySelectorAll(MSGS);
    const last = all[all.length - 1];
    return JSON.stringify({ innerHeight, visual: window.visualViewport && Math.round(visualViewport.height), docScroll: Math.round((document.scrollingElement || document.documentElement).scrollTop),
      messages: all.length, last: last && { el: desc(last), rect: rect(last), scroller: desc(scrollerOf(last)) }, scrollers }, null, 1);
  }

  let queued = false;
  // (one observer for the buttons, the pills, keeping the reply in view and a mod that turns up late: at most
  // every 400 ms, only when the page changes)
  new MutationObserver(() => { if (!queued) { queued = true; setTimeout(() => { queued = false; mark(); reveal(); late(); }, 400); } })
    .observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  mark();

  /** (development) The message box's surroundings, as HTML, to see how a chat builds its chips and buttons. */
  function dump() {
    try { var m = metrics(); } catch (e) { m = String(e); }
    return `<!-- ${m} -->\n` + dumpBox();
  }
  function dumpBox() {
    const ed = editor();
    let box = ed;
    for (let i = 0; box && i < 8; i++) box = box.parentElement;
    return (box || document.body).outerHTML.slice(0, 60000);
  }

  globalThis.__trifChat = { fill, editor, dump, state, resume, showReply };
})();
