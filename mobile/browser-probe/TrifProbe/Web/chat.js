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
   * the page doesn't take a pasted text.
   */
  async function fill(text, png) {
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
  let queued = false;
  new MutationObserver(() => { if (!queued) { queued = true; setTimeout(() => { queued = false; mark(); }, 400); } })
    .observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  mark();

  globalThis.__trifChat = { fill, editor };
})();
