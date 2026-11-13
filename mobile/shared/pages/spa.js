// A page that keeps changing: more posts arrive after a moment, and "Explore" swaps the feed without a
// page load (history.pushState), the way most sites people want fixed work.
(() => {
  const feed = document.querySelector('.feed');
  const post = (title, promoted) => {
    const a = document.createElement('article');
    a.className = promoted ? 'feed-item promoted' : 'feed-item';
    a.setAttribute('data-testid', promoted ? 'promoted-post' : 'post');
    const h = document.createElement('h2'); h.textContent = title;
    const p = document.createElement('p'); p.textContent = promoted ? 'Buy the other thing too.' : 'Arrived after the page loaded.';
    a.append(h, p);
    return a;
  };
  setTimeout(() => { feed.append(post('Late post 1'), post('Another product', true), post('Late post 2')); window.__probeLateAdded = performance.now(); }, 1500);
  document.querySelector('a[href="#explore"]').addEventListener('click', (e) => {
    e.preventDefault();
    history.pushState({ view: 'explore' }, '', 'spa.html?view=explore');
    feed.replaceChildren(post('Explore: post A'), post('Explore: a product', true), post('Explore: post B'));
  });
})();
