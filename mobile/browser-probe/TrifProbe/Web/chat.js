// TRIF in the chat pane (proof of concept, branch ios-poc; Tim, 11-13): a small mod for claude.ai and
// chatgpt.com, run in a world of its own beside their page (ClaudePane.chatWorld), so their code can't reach
// it. It does two things and nothing else:
//   - an "Add to TRIF" button under each code block that holds a whole mod file (==WebMod== … ==/WebMod==):
//     a tap hands the block's text to the app, which shows its Add this mod? sheet;
//   - a mod just written in a reply, handed to the app by itself once it's finished (watch, below);
//   - fill(text, png): puts text (and a picture) into the message box, as a paste, for the person to send.
// It never sends a message, never reads the conversation except a code block's text when its button is
// tapped, and keeps nothing.
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
  const TILES = '[data-testid="file-thumbnail"], [data-cds^="MessageAttachments"], span[class*="group/composer-attachment"]';
  /** How many attachment tiles in the message box carry this name (in their text, a picture's alt or a label). */
  function tiles(label) {
    return [...document.querySelectorAll(TILES)].filter((t) => `${t.textContent || ''} ${[...t.querySelectorAll('img[alt], [aria-label]')]
      .map((i) => i.alt || i.getAttribute('aria-label')).join(' ')}`.includes(label)).length;
  }

  async function fill(text, png, name, pdf) {
    // (a chat that has only just loaded isn't ready for a paste: its page finished, then a moment)
    if (document.readyState !== 'complete') { await new Promise((r) => addEventListener('load', r, { once: true })); await wait(800); }
    const ed = editor();
    if (!ed) return 'no message box';
    ed.focus();
    const said = [];
    if (png) {
      const dt = new DataTransfer();
      const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
      dt.items.add(new File([bytes], 'TRIF screenshot.png', { type: 'image/png' }));
      said.push(paste(ed, dt) ? 'picture pasted' : 'picture not taken');
      await wait(300);
    }
    if (pdf) {
      // (the whole page, after the screenshot of the screen, on its own as the picture is)
      const dt = new DataTransfer();
      const bytes = Uint8Array.from(atob(pdf), (c) => c.charCodeAt(0));
      dt.items.add(new File([bytes], 'TRIF full page.pdf', { type: 'application/pdf' }));
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
    for (const tile of document.querySelectorAll(TILES)) {
      if (tile.hasAttribute('data-trif-chip')) continue;
      const names = `${tile.textContent || ''} ${[...tile.querySelectorAll('img[alt], [aria-label]')].map((i) => i.alt || i.getAttribute('aria-label')).join(' ')}`;
      const label = ['TRIF instruction', 'TRIF follow-up', 'TRIF screenshot', 'TRIF full page'].find((l) => names.includes(l));
      if (label) tile.setAttribute('data-trif-chip', label);
    }
    for (const pre of document.querySelectorAll('pre')) {
      const t = pre.innerText || '';
      if (!t.includes('==WebMod==') || !t.includes('==/WebMod==')) continue;
      if (pre.nextElementSibling && pre.nextElementSibling.classList.contains('trif-add')) continue;
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
    @media (prefers-color-scheme: dark) {
      [data-trif-chip] .cds-card-fill { background: rgba(52, 211, 153, 0.16) !important; }
      [data-trif-chip] [data-cds-card-body]::after { color: #34d399; }
      span[data-trif-chip][class*="composer-attachment"]::before { background: rgba(52, 211, 153, 0.16); color: #34d399; }
    }`;
  (document.head || document.documentElement).append(style);

  // A mod Claude or ChatGPT has just finished writing, handed to the app by itself (Tim, 11-14: finding the
  // code block between what a chat says before and after it is the fiddly part). Only a block seen being
  // written while the pane watched (an old conversation's mods are left alone), once it has stopped changing
  // and the reply has stopped; a revised mod under the same header is offered again. Keyed by the header, not
  // the element: a chat may redraw its code block when the reply ends.
  const live = new Map();
  const replying = () => !!document.querySelector('button[aria-label="Stop response"], button[aria-label="Stop streaming"], button[data-testid="stop-button"]');
  function watch() {
    const now = Date.now();
    const last = new Map();
    for (const pre of document.querySelectorAll('pre')) {
      const t = pre.innerText || '';
      const end = t.search(/==\/WebMod==/);
      if (t.indexOf('==WebMod==') === -1 || end === -1) continue;
      last.set(t.slice(0, end), t);
    }
    for (const [key, t] of last) {
      const st = live.get(key);
      if (!st) { live.set(key, { text: t, grew: false, at: now, offered: false }); continue; }
      if (st.text !== t) { st.text = t; st.grew = true; st.at = now; st.offered = false; continue; }
      if (st.grew && !st.offered && now - st.at > 1500 && !replying()) { st.offered = true; post({ type: 'mod', text: t, auto: true }); }
    }
  }
  setInterval(watch, 700);

  let queued = false;
  new MutationObserver(() => { if (!queued) { queued = true; setTimeout(() => { queued = false; mark(); }, 400); } })
    .observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  mark();

  /** (development) The message box's surroundings, as HTML, to see how a chat builds its chips and buttons. */
  function dump() {
    const ed = editor();
    let box = ed;
    for (let i = 0; box && i < 8; i++) box = box.parentElement;
    return (box || document.body).outerHTML.slice(0, 60000);
  }

  globalThis.__trifChat = { fill, editor, dump };
})();
