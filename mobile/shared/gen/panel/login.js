// Logging the user's coding agent in from a TRIF page: the side panel (its login notice) and the setup
// page (its "Log in to <agent>" step). agent.login starts the agent's own login through the helper
// (Claude Code: `claude auth login`), which relays its output as agentEvents on the page's `panel` port:
// a sign-in link (opened in a tab, only if it's on Anthropic's sites), then the code the user pastes back
// here, then whether it worked. One login at a time per page.
//
// createLogin({ request, changed, succeeded }): request is the page's port request(); changed() after
// every change (the page re-renders); succeeded() once the agent is logged in (the page reloads the
// agent list). The page passes each agentEvent to onAgentEvent and shows nodes() while `current` is set.

import { isLoginUrl, PANEL } from './lib.js';
import { setMarkdown } from './markdown.js';

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(label, className, onClick) {
  const b = el('button', className ? `btn ${className}` : 'btn', label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

function actions(...children) {
  const p = el('p', 'actions');
  p.append(...children.filter(Boolean));
  return p;
}

function markdownBlock(className, text) {
  const d = el('div', `md ${className || ''}`.trim());
  setMarkdown(d, text);
  return d;
}

export function createLogin({ request, changed = () => {}, succeeded = () => {} }) {
  let L = null; // {loginId, agent, name, fix, phase, url, error, early}

  async function start(agent, name, fix) {
    const me = { loginId: null, agent, name, fix, phase: 'starting', url: null, error: null, early: [] };
    L = me;
    changed();
    let loginId;
    try {
      ({ loginId } = await request({ type: 'agent.login', agent: agent || undefined }));
    } catch (e) {
      if (L === me) failed(me, String(e?.message ?? e));
      return;
    }
    if (L !== me) { // cancelled meanwhile
      request({ type: 'agent.loginCancel', loginId }).catch(() => {});
      return;
    }
    me.loginId = loginId;
    const early = me.early.filter((m) => m.runId === loginId);
    me.early = [];
    for (const m of early) onEvent(me, m.event);
  }

  function onEvent(me, event) {
    if (L !== me || !event) return;
    switch (event.kind) {
      case 'login': {
        if (me.url) return;
        if (!isLoginUrl(event.url)) {
          request({ type: 'agent.loginCancel', loginId: me.loginId }).catch(() => {});
          failed(me, `${me.name} gave a sign-in link that isn’t on claude.com, claude.ai or anthropic.com, so TRIF didn’t open it.`);
          return;
        }
        me.url = event.url;
        me.phase = 'code';
        chrome.tabs.create({ url: me.url, active: true }).catch((e) => console.warn('[TRIF] could not open the sign-in page', e));
        break;
      }
      case 'text':
        // A complaint about the code while it's being checked: let the user paste it again.
        if (me.phase === 'checking' && /invalid|error|fail|expired|try again/i.test(String(event.text))) {
          me.phase = 'code';
          me.error = String(event.text);
        }
        break;
      case 'error':
        me.error = String(event.message || '');
        break;
      case 'done':
        if (event.ok) {
          me.phase = 'success';
          me.error = null;
          succeeded();
          setTimeout(() => { if (L === me) { L = null; changed(); } }, 2500);
        } else if (event.cancelled) {
          L = null;
        } else {
          failed(me, me.error || 'The login didn’t finish.');
          return;
        }
        break;
      default:
        return;
    }
    changed();
  }

  function failed(me, message) {
    me.phase = 'failed';
    me.error = message;
    changed();
  }

  async function submitCode(value) {
    const me = L;
    const code = String(value ?? '').trim();
    if (!me || me.phase !== 'code' || !code) return;
    me.phase = 'checking';
    me.error = null;
    changed();
    try {
      await request({ type: 'agent.loginCode', loginId: me.loginId, code });
    } catch (e) {
      if (L === me && me.phase === 'checking') { me.phase = 'code'; me.error = String(e?.message ?? e); changed(); }
    }
  }

  function cancel() {
    const me = L;
    if (!me) return;
    L = null;
    if (me.loginId) request({ type: 'agent.loginCancel', loginId: me.loginId }).catch(() => {});
    changed();
  }

  /**
   * An agentEvent from the port: true if it was the login's. `ours(runId)`: whether the page started that
   * run itself (an agent run, not the login), for events that arrive before agent.login has answered.
   */
  function onAgentEvent(msg, ours = () => false) {
    if (L && L.loginId && msg.runId === L.loginId) { onEvent(L, msg.event); return true; }
    if (L && !L.loginId && !ours(msg.runId) && L.early.length < 50) L.early.push(msg); // before agent.login's reply
    return false;
  }

  /**
   * The login's contents: {nodes, tone: ''|'bad'|'ok'}. Not started: "<name> isn't logged in", with Log
   * in (`intro` the line above it) or the agent's own way to log in, and after it `more` (the side panel's
   * Switch to <agent> and Use robotless buttons).
   */
  function nodes(agentInfo, { intro = `Log in with your account to use it from this ${PANEL}.`, more = [] } = {}) {
    const name = L?.name || agentInfo?.name || 'The agent';
    const fix = L?.fix || agentInfo?.loginFix || '';
    const fallback = () => (fix ? markdownBlock('note', `Or ${fix}.`) : null);
    const cancelButton = () => button('Cancel', '', cancel);
    const out = [];
    let tone = '';
    switch (L?.phase) {
      case 'starting':
        out.push(el('p', 'title', `Logging in to ${name}…`), el('p', null, 'Opening the sign-in page…'), actions(cancelButton()));
        break;
      case 'code': {
        out.push(el('p', 'title', `Logging in to ${name}`),
          el('p', null, 'Finish signing in in the tab that opened, then paste the code it shows here:'));
        const form = el('form', 'login-form');
        const input = el('input');
        Object.assign(input, { type: 'text', name: 'code', placeholder: 'Code', autocomplete: 'off', spellcheck: false, required: true });
        input.setAttribute('aria-label', 'Login code');
        form.append(input, Object.assign(el('button', 'btn primary', 'Submit'), { type: 'submit' }));
        form.addEventListener('submit', (e) => { e.preventDefault(); submitCode(input.value); });
        out.push(form);
        if (L.error) out.push(el('p', 'note', L.error));
        const again = el('a', null, 'Open the sign-in page again');
        again.href = '#';
        const url = L.url;
        again.addEventListener('click', (e) => { e.preventDefault(); if (isLoginUrl(url)) chrome.tabs.create({ url, active: true }); });
        out.push(actions(cancelButton(), again));
        break;
      }
      case 'checking':
        out.push(el('p', 'title', `Logging in to ${name}`), el('p', null, 'Checking the code…'), actions(cancelButton()));
        break;
      case 'success':
        tone = 'ok';
        out.push(el('p', 'title', 'Logged in'), el('p', null, `${name} is ready.`));
        break;
      case 'failed': {
        tone = 'bad';
        const agent = L.agent;
        out.push(el('p', 'title', `Couldn’t log in to ${name}`));
        if (L.error) out.push(markdownBlock('', L.error));
        out.push(actions(button('Try again', 'primary', () => start(agent, name, fix))));
        out.push(fallback());
        break;
      }
      default: // not started
        out.push(el('p', 'title', `${name} isn’t logged in`));
        if (agentInfo?.canLogin) {
          out.push(el('p', null, intro));
          out.push(actions(button('Log in', 'primary', () => start(agentInfo.id, name, fix)), ...more));
          out.push(fallback());
        } else {
          if (fix) out.push(markdownBlock('', `To log in, ${fix}.`));
          if (more.length) out.push(actions(...more));
        }
    }
    return { nodes: out.filter(Boolean), tone };
  }

  return { get current() { return L; }, start, cancel, submitCode, onAgentEvent, nodes };
}
