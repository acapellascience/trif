// The body every probe page shares, built with DOM calls only (no innerHTML: the Trusted Types page would
// refuse it). It has the things people want gone: a sticky banner, a promoted post in a feed, a sidebar, a
// cookie box. And the things that make hiding hard: build-tool class names, a custom element with a
// shadow root, and a frame.
(() => {
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) { if (k === 'class') n.className = v; else n.setAttribute(k, v); }
    for (const k of kids) n.append(k);
    return n;
  };
  const body = document.body;

  body.append(el('div', { id: 'promo-banner', class: 'site-banner' }, 'Subscribe now for 50% off. ', el('button', { type: 'button', class: 'banner-close' }, 'Close')));
  body.append(el('header', { class: 'site-header' }, el('nav', { class: 'main-nav', 'aria-label': 'Main' },
    el('a', { href: '#home' }, 'Home'), el('a', { href: '#explore' }, 'Explore'), el('a', { href: '#messages' }, 'Messages'), el('a', { href: '#profile' }, 'Profile'))));

  const feed = el('section', { class: 'feed', 'aria-label': 'Timeline' });
  for (let i = 1; i <= 6; i++) {
    const promoted = i === 3;
    feed.append(el('article', { class: promoted ? 'feed-item promoted' : 'feed-item', 'data-testid': promoted ? 'promoted-post' : 'post' },
      el('h2', {}, promoted ? 'A product you did not ask about' : `Post number ${i}`),
      el('p', {}, promoted ? 'Buy the thing. Everyone is buying the thing.' : 'Something a person you follow wrote, at some length, about their day.'),
      promoted ? el('span', { class: 'promoted-label' }, 'Promoted') : el('span', { class: 'post-meta' }, `${i}h`)));
  }
  const sidebar = el('aside', { class: 'sidebar' },
    el('section', { class: 'trending', 'aria-label': 'Trending' }, el('h3', {}, 'Trending now'),
      el('ul', {}, ...['Outrage of the day', 'A celebrity', 'Sports result', 'Something alarming', 'A meme'].map((t) => el('li', {}, t)))),
    el('section', { class: 'who-to-follow' }, el('h3', {}, 'Who to follow'), el('p', {}, 'Three accounts you have never heard of.')));

  // names a build tool made: nothing here can be called anything but its position
  const atomic = el('div', { class: 'css-1dbjc4n r-18u37iz' });
  for (let i = 1; i <= 3; i++) atomic.append(el('div', { class: 'css-1dbjc4n r-1habvwh x1lliihq' }, el('div', { class: 'css-901oao sc-bdVaJa' }, `Block ${i} with made-up class names`)));

  const compose = el('form', { id: 'compose' }, el('input', { id: 'draft', name: 'draft', type: 'text', placeholder: 'Write something' }), el('button', { type: 'button', id: 'post' }, 'Post'));
  const widget = el('x-widget', {});
  try { widget.attachShadow({ mode: 'open' }).append(el('div', { class: 'inner', part: 'inner' }, 'Inside a shadow root')); } catch { /* no shadow DOM here */ }
  const frame = el('iframe', { id: 'inner-frame', title: 'A frame on the same site', src: 'frame.html' });

  body.append(el('main', { id: 'content' }, feed, sidebar, atomic, compose, widget, frame, el('p', { id: 'out' }, '')));
  body.append(el('div', { class: 'cookie-consent', role: 'dialog', 'aria-label': 'Cookie consent' }, el('p', {}, 'We value your privacy, which is why we track you.'),
    el('button', { type: 'button', class: 'accept' }, 'Accept all'), el('button', { type: 'button', class: 'reject' }, 'Manage options')));
  for (let i = 0; i < 12; i++) body.append(el('p', { class: 'filler' }, 'More page below, so there is something to scroll.'));

  window.__probeBodyBuilt = performance.now();
})();
