// Point at it: after "Pick something to hide" in the popup, the next tap chooses an element instead of
// reaching the page. A bar at the bottom says what was chosen and offers to hide it. No AI anywhere: the
// selector comes from gen/kit.js. Styled through style objects only, which no page policy refuses.
(() => {
  'use strict';
  if (window.top !== window) return;
  const api = globalThis.browser ?? globalThis.chrome;
  let picking = false, bar = null, line = null, buttons = null, current = null;
  const css = (el, text) => { el.style.cssText = text; return el; };
  const inBar = (e) => bar && e.composedPath().includes(bar);

  function build() {
    bar = css(document.createElement('trif-probe-bar'), 'all: initial; position: fixed; left: 8px; right: 8px; bottom: 8px; z-index: 2147483647; display: block;');
    const root = bar.attachShadow({ mode: 'closed' });
    const box = css(document.createElement('div'), 'font: 15px/1.35 -apple-system, system-ui, sans-serif; color: #fff; background: #1c1c1e; border-radius: 14px; padding: 12px; box-shadow: 0 4px 24px rgba(0,0,0,.4);');
    line = css(document.createElement('div'), 'margin-bottom: 10px; word-break: break-word;');
    buttons = css(document.createElement('div'), 'display: flex; flex-wrap: wrap; gap: 8px;');
    box.append(line, buttons);
    root.append(box);
    document.documentElement.append(bar);
  }
  const button = (text, primary, fn) => {
    const b = css(document.createElement('button'), `font: inherit; border: 0; border-radius: 10px; padding: 9px 13px; color: #fff; background: ${primary ? '#e5484d' : '#3a3a3c'};`);
    b.type = 'button'; b.textContent = text;
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); fn(); });
    return b;
  };
  function show(d) {
    current = d;
    buttons.replaceChildren();
    if (!d) { line.textContent = 'Tap the thing you want gone.'; buttons.append(button('Cancel', false, stop)); return; }
    line.textContent = `${d.text ? `“${d.text}” ` : ''}${d.selector} (named by ${d.how}${d.matches === 1 ? '' : `, finds ${d.matches}`})`;
    buttons.append(button('Hide this', true, () => save(d.selector, d.how, d.matches, d.text)));
    if (d.similar) buttons.append(button(`Hide all ${d.similar.matches} like it`, false, () => save(d.similar.selector, d.similar.how, d.similar.matches, d.text)));
    buttons.append(button('Wider', false, () => show(globalThis.__trifKit.wider())), button('Cancel', false, stop));
  }
  async function save(selector, how, matches, text) {
    const rules = await api.runtime.sendMessage({ type: 'saveRule', host: location.hostname, rule: { selector, how, matches, text, at: Date.now() } });
    if (Array.isArray(rules) && globalThis.__trifProbeRules) globalThis.__trifProbeRules(rules.map((r) => r.selector));
    stop();
  }
  // In pick mode the page doesn't hear the tap: its handlers on touch, pointer and mouse events are skipped
  // (not cancelled: scrolling still works), and the click itself is cancelled and read here.
  const QUIET = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend'];
  const quiet = (e) => { if (picking && !inBar(e)) e.stopImmediatePropagation(); };
  const onClick = (e) => {
    if (!picking || inBar(e)) return;
    e.preventDefault(); e.stopImmediatePropagation();
    show(globalThis.__trifKit.at(e.clientX, e.clientY));
  };
  function start() {
    if (picking || !globalThis.__trifKit) return;
    picking = true;
    if (!bar) build(); else document.documentElement.append(bar);
    show(null);
    for (const t of QUIET) window.addEventListener(t, quiet, true);
    window.addEventListener('click', onClick, true);
  }
  function stop() {
    picking = false;
    for (const t of QUIET) window.removeEventListener(t, quiet, true);
    window.removeEventListener('click', onClick, true);
    if (globalThis.__trifKit) globalThis.__trifKit.unmark();
    if (bar) bar.remove();
  }
  api.runtime.onMessage.addListener((m) => { if (m && m.type === 'pick') start(); });
})();
