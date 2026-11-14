// TRIF in the chat pane (proof of concept, branch ios-poc; Tim, 11-13): a small mod for claude.ai and
// chatgpt.com, run in a world of its own beside their page (ClaudePane.chatWorld), so their code can't reach
// it. It does two things and nothing else:
//   - an "Add to TRIF" button under each code block that holds a whole mod file (==WebMod== … ==/WebMod==):
//     a tap hands the block's text to the app, which shows its Add this mod? sheet;
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
  async function fill(text, png, name) {
    const ed = editor();
    if (!ed) return 'no message box';
    ed.focus();
    const said = [];
    if (png) {
      const dt = new DataTransfer();
      const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
      dt.items.add(new File([bytes], 'page.png', { type: 'image/png' }));
      said.push(paste(ed, dt) ? 'picture pasted' : 'picture not taken');
      await new Promise((r) => setTimeout(r, 300));
    }
    if (text && name) {
      const dt = new DataTransfer();
      dt.items.add(new File([text], name, { type: 'text/plain' }));
      if (paste(ed, dt)) { said.push('text attached'); return said.join(', '); }
      said.push('file not taken, so as text');
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
    // (the page TRIF sent, as a file named "TRIF instruction": its tile marked for the small pill above)
    for (const tile of document.querySelectorAll('[data-testid="file-thumbnail"], [data-cds^="MessageAttachments"]')) {
      if (!tile.hasAttribute('data-trif-chip') && /TRIF instruction/.test(tile.textContent || '')) tile.setAttribute('data-trif-chip', 'instruction');
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
  // ([data-cds-part=paint]); ChatGPT on the button. And the page TRIF sent (Send page: a file named
  // "TRIF instruction") as a small pill saying so, not a big tile (data-trif-chip, set by mark below); its
  // remove button stays.
  const style = document.createElement('style');
  style.textContent = `
    button[data-testid="chat-input-send"]:not(:disabled) [data-cds-part="paint"],
    button[data-testid="send-button"]:not(:disabled), #composer-submit-button:not(:disabled) {
      background: #34d399 !important; background-color: #34d399 !important; border-color: transparent !important;
    }
    button[data-testid="chat-input-send"]:not(:disabled), button[data-testid="send-button"]:not(:disabled),
    #composer-submit-button:not(:disabled) { color: #04291c !important; }
    [data-trif-chip] { width: auto !important; height: auto !important; min-width: 0 !important; align-self: flex-start; }
    [data-trif-chip] [data-cds-card-body] { padding: 6px 14px !important; flex-direction: row !important; align-items: center !important; }
    [data-trif-chip] [data-cds-card-body] > div { display: none !important; }
    [data-trif-chip] [data-cds-card-body]::after {
      content: "TRIF instruction"; font: 600 13px/1.2 -apple-system, system-ui, sans-serif; color: #0f6b4a; white-space: nowrap;
    }
    [data-trif-chip] .cds-card-fill { background: #e3f7ee !important; }`;
  (document.head || document.documentElement).append(style);

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
