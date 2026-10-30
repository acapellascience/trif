// ==WebMod==
// @name        Simple Home
// @description Replaces the amazon.com home page with just the logo, a greeting and a centered search box
// @match       https://www.amazon.com/*
// @run-at      document-start
// @risk        1 covers the whole home page, ads included, so their impressions never report
// ==/WebMod==

(() => {
  // Home page only: "/" (often with ?ref_=...) or "/ref=nav_logo"-style paths.
  if (!/^\/(ref=[^/]*)?$/.test(location.pathname)) return;

  const root = document.documentElement;
  root.setAttribute('data-ash-on', '');

  const style = document.createElement('style');
  style.textContent = `
    html[data-ash-on], html[data-ash-on] body { background: #131921 !important; overflow: hidden !important; }
    html[data-ash-on] body > *:not(#ash-home) { display: none !important; }
    #ash-home { position: fixed; inset: 0; z-index: 2147483647; display: flex; flex-direction: column;
      align-items: center; justify-content: center; gap: 28px; background: #131921; color: #fff;
      font-family: "Amazon Ember", Arial, sans-serif; margin-top: -8vh; }
    #ash-home .ash-logo { display: block; line-height: 0; }
    #ash-home .ash-logo svg { display: block; width: 220px; height: auto; }
    #ash-home h1 { margin: 0; font-size: 22px; font-weight: 400; color: #fff; }
    #ash-home form { display: flex; width: min(640px, 90vw); height: 46px; border-radius: 8px; overflow: hidden; }
    #ash-home input { flex: 1; height: 100% !important; margin: 0 !important; border: 0 !important; border-radius: 0 !important; box-shadow: none !important; padding: 0 14px; font-size: 16px; outline: none; color: #111; background: #fff; }
    #ash-home form:focus-within { box-shadow: 0 0 0 3px #f90; }
    #ash-home button { border: 0; width: 56px; background: #febd69; cursor: pointer; font-size: 20px; }
    #ash-home button:hover { background: #f3a847; }
  `;
  root.append(style);

  const LOGO_WORD = 'M27.5 34.53L21.5 34.82L19.5 30.35Q15.5 34.61 13 35.02Q10.5 35.42 9 35.14Q7.5 34.85 6.5 34.26Q5.5 33.67 4.26 32.08Q3.02 30.5 2.55 29Q2.08 27.5 2.08 25.5Q2.08 23.5 2.56 22Q3.03 20.5 4.11 19Q5.19 17.5 6.85 16.37Q8.5 15.25 10 14.74Q11.5 14.23 15.55 13.86L19.61 13.5Q18.91 9.5 18.21 8.73Q17.5 7.96 16.5 7.61Q15.5 7.26 14 7.67Q12.5 8.07 11 10.06L9.5 12.06L3.02 10.5Q3.27 8.5 4.39 6.69Q5.5 4.87 6.5 3.97Q7.5 3.07 9.42 2.28Q11.34 1.5 14.42 1.26Q17.5 1.03 19.5 1.51Q21.5 2 23 2.97Q24.5 3.94 25.72 5.72Q26.94 7.5 27.45 10Q27.96 12.5 27.73 23.52L27.5 34.53ZM57.5 6.74Q60.5 3.09 62.5 2.09Q64.5 1.08 66.5 1.12Q68.5 1.16 70.5 2.45Q72.5 3.73 73.66 5.61Q74.82 7.5 75.23 9.5Q75.64 11.5 75.73 22.5Q75.82 33.5 75.48 34Q75.14 34.5 71.82 34.68Q68.5 34.87 67.86 34.18Q67.23 33.5 67.15 23Q67.06 12.5 66.28 11.05Q65.5 9.6 64.5 9.23Q63.5 8.87 62.5 8.95Q61.5 9.03 60.3 10.27Q59.1 11.5 58.76 13.5Q58.42 15.5 58.17 25L57.92 34.5L50.5 34.53Q49.9 12.5 49 11Q48.1 9.5 46.8 9.18Q45.5 8.85 44.5 9.11Q43.5 9.37 42.94 9.94Q42.37 10.5 41.82 12Q41.26 13.5 41 24L40.73 34.5L33.2 34.5Q32.9 2.5 33.2 2.18Q33.5 1.86 36.5 1.89L39.5 1.91L41.5 5.88Q43.5 3.04 44.76 2.27Q46.03 1.5 48.26 1.28Q50.5 1.06 52 1.6Q53.5 2.15 55.5 4.44L57.5 6.74ZM97.5 30.39Q94.5 33.86 93.5 34.4Q92.5 34.95 91 35.21Q89.5 35.47 87.5 35.19Q85.5 34.91 83.79 33.7Q82.08 32.5 81.19 31Q80.31 29.5 80.19 26Q80.07 22.5 81.55 20Q83.02 17.5 84.76 16.32Q86.5 15.15 88 14.66Q89.5 14.18 93.37 13.84L97.25 13.5Q96.7 9.5 96.1 8.78Q95.5 8.06 94.5 7.67Q93.5 7.28 92 7.630Q90.5 7.99 89 10.01L87.5 12.03L80.88 10.5Q81.5 7.51 82.5 6.08Q83.5 4.65 85 3.52Q86.5 2.39 87.81 1.94Q89.11 1.5 92.31 1.27Q95.5 1.04 97.5 1.55Q99.5 2.05 101.2 3.28Q102.9 4.5 103.82 6Q104.75 7.5 105.28 10.5Q105.82 13.5 105.83 23Q105.84 32.5 105.67 33.31Q105.5 34.12 105 34.49Q104.5 34.87 102 34.86Q99.5 34.85 98.86 34.18Q98.23 33.5 97.86 31.95L97.5 30.39ZM143.29 3Q145.87 1.5 148.68 1.29Q151.5 1.08 154 2.07Q156.5 3.05 158.68 5.28Q160.85 7.5 161.92 10Q162.98 12.5 163.36 16Q163.75 19.5 162.71 23.5Q161.67 27.5 160.08 29.66Q158.5 31.83 156 33.37Q153.5 34.91 151.5 35.21Q149.5 35.5 146.5 34.76Q143.5 34.01 141.35 32.26Q139.2 30.5 137.66 27.5Q136.11 24.5 135.69 20.5Q135.27 16.5 136.16 13Q137.05 9.5 138.88 7Q140.7 4.5 143.29 3ZM193.64 34.5L186.12 34.5Q185.61 13.5 185.13 12Q184.65 10.5 184.07 9.93Q183.5 9.35 182.5 9.1Q181.5 8.85 180 9.26Q178.5 9.67 177.48 11.58Q176.47 13.5 176.15 24L175.83 34.5L168.5 34.7Q167.94 33.5 167.96 18L167.97 2.5Q169.5 1.77 172 1.82L174.5 1.87L176.5 6.07Q178.5 3.17 179.87 2.33Q181.25 1.5 182.87 1.25Q184.5 1 185.97 1.25Q187.44 1.5 188.97 2.43Q190.5 3.36 191.58 4.93Q192.67 6.5 193.32 9.5Q193.97 12.5 193.81 23.5L193.64 34.5ZM110.22 2.5Q111.5 1.77 121.5 1.77Q131.5 1.77 132.23 2.14L132.96 2.5Q132.87 8.5 126.93 17L120.99 25.5Q127.5 26.12 130 26.99Q132.5 27.86 133.1 28.68Q133.7 29.5 133.7 31.5Q133.7 33.5 133.38 34L133.07 34.5Q122.5 32.75 119.5 32.95Q116.5 33.14 113.37 33.82L110.25 34.5Q110.25 27.5 116.63 18.5Q123.01 9.5 122.75 8.95L122.5 8.39Q111.5 8.37 111 8.12L110.5 7.87L110.22 2.5ZM146.26 9.5Q147.14 8.5 148.32 8.2Q149.5 7.9 150.5 8.07Q151.5 8.25 152.52 9.37Q153.53 10.5 154.17 12.5Q154.81 14.5 154.84 18Q154.87 21.5 154.35 23.5Q153.84 25.5 153.08 26.5Q152.33 27.5 150.91 28.11Q149.5 28.72 148.5 28.42Q147.5 28.12 146.65 27.31Q145.81 26.5 144.97 24Q144.13 21.5 144.25 17.5Q144.37 13.5 144.87 12Q145.37 10.5 146.26 9.5ZM14.9 18.89Q16.3 18.5 17.4 18.46Q18.5 18.42 19.05 18.96Q19.61 19.5 19.28 22.5Q18.94 25.5 17.72 27.13Q16.5 28.75 15 28.88Q13.5 29 12.43 28.25Q11.35 27.5 11.16 25Q10.96 22.5 12.23 20.89Q13.5 19.28 14.9 18.89ZM92.79 18.83Q94.09 18.5 95.29 18.47Q96.5 18.44 96.9 18.97Q97.3 19.5 97.03 22.5Q96.75 25.5 95.63 27.05Q94.5 28.61 92.5 28.7Q90.5 28.78 89.81 28.14Q89.11 27.5 88.76 26.5Q88.42 25.5 88.76 23.5Q89.1 21.5 90.3 20.33Q91.5 19.16 92.79 18.83Z';
  const LOGO_SMILE = 'M110.66 42.5Q112.5 40.13 116.09 38.82Q119.68 37.5 121.59 37.32Q123.5 37.13 126 37.56Q128.5 37.99 129.5 38.46Q130.5 38.92 131.18 39.71Q131.87 40.5 131.87 43Q131.87 45.5 130.83 48.5Q129.8 51.5 128.15 53.7Q126.5 55.9 124.5 57.35Q122.5 58.8 122 58.62Q121.5 58.44 121.32 57.47Q121.13 56.5 122.97 53Q124.82 49.5 125.36 47.5Q125.9 45.5 125.7 44.69Q125.5 43.88 125 43.51Q124.5 43.14 123 43Q121.5 42.87 117 43.37Q112.5 43.87 112 43.8Q111.5 43.73 111.08 43.11L110.66 42.5ZM120.44 48.5Q118.66 51.5 116.08 53.55Q113.5 55.6 110 57.56Q106.5 59.52 102.5 61.09Q98.5 62.66 91 64.19Q83.5 65.73 76 65.76Q68.5 65.8 61 64.33Q53.5 62.87 49.5 61.37Q45.5 59.87 42.5 58.3Q39.5 56.73 36 54.23Q32.5 51.73 29.81 49.11Q27.11 46.5 25.57 44.5Q24.02 42.5 23.65 41.5Q23.27 40.5 23.52 40Q23.78 39.5 24.64 39.32Q25.5 39.13 29.5 42.02Q33.5 44.9 39.5 47.9Q45.5 50.9 50 52.32Q54.5 53.75 60.5 54.8Q66.5 55.86 77.5 55.84Q88.5 55.82 96.5 54.24Q104.5 52.66 111.5 49.83Q118.5 47 119 47.02Q119.5 47.04 119.97 47.77L120.44 48.5Z';

  const build = () => {
    try {
      if (!document.body || document.getElementById('ash-home')) return;
      const home = document.createElement('div');
      home.id = 'ash-home';

      // Logo: vector paths traced from Amazon's own nav logo (the 98x34 sprite at 2x; there's no
      // larger version on its CDN, so scaling it up went blurry). Traced from the original;
      // colours are the sprite's own.
      const logo = document.createElement('a');
      logo.className = 'ash-logo';
      logo.href = '/';
      logo.setAttribute('aria-label', 'Amazon.com');
      const NS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 196 68');
      svg.setAttribute('aria-hidden', 'true');
      for (const [d, fill] of [[LOGO_WORD, '#fff'], [LOGO_SMILE, '#ff6200']]) {
        const p = document.createElementNS(NS, 'path');
        p.setAttribute('d', d);
        p.setAttribute('fill', fill);
        p.setAttribute('fill-rule', 'evenodd');   // the counters of "a", "o" are separate inner loops
        svg.append(p);
      }
      logo.append(svg);

      const h1 = document.createElement('h1');
      h1.textContent = 'Welcome to Amazon. What would you like to buy?';

      // Plain GET to Amazon's own search page.
      const form = document.createElement('form');
      form.action = '/s';
      form.method = 'get';
      form.setAttribute('role', 'search');
      const input = document.createElement('input');
      input.type = 'search';
      input.name = 'k';
      input.placeholder = 'Search Amazon.com';
      input.setAttribute('aria-label', 'Search Amazon.com');
      input.autocomplete = 'off';
      const button = document.createElement('button');
      button.type = 'submit';
      button.setAttribute('aria-label', 'Search');
      button.textContent = '🔍';
      form.append(input, button);

      home.append(logo, h1, form);
      document.body.append(home);
      input.focus();
    } catch (e) { window.webmods?.warn('simple home failed', String(e)); }
  };

  // Wait for the nav logo so we can borrow its sprite.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
  // The page may come back from the back/forward cache, or something may remove our node.
  addEventListener('pageshow', build);
})();
