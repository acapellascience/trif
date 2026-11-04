// The pages timsrobot.com serves. Plain HTML and a few small scripts (the report and waitlist forms', and the
// home page's demo tab: demo.js); nothing loaded from anywhere else.

// The colours: dark only, whatever the visitor's system is set to. The home page's mods (neon, the rave, the
// robot's glow) are made for a dark page, and the demo's panel matches it (demo/panel.css).
export const TOKENS = `
:root { color-scheme: dark; --bg: #18181a; --card: #222225; --fg: #ececea; --muted: #a2a29d;
  --line: #3a3a3e; --accent: #43c98d; --on-accent: #04291c; --bad: #ff8a80; }
* { box-sizing: border-box; }`;

const STYLE = `${TOKENS}
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.5 -apple-system, system-ui, "Segoe UI", sans-serif; }
main { max-width: 640px; margin: 0 auto; padding: 48px 16px 64px; }
h1 { font-size: 28px; margin: 0 0 4px; letter-spacing: -0.01em; }
.lead { color: var(--muted); margin: 0 0 28px; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 20px; }
label { display: block; font-weight: 600; margin: 0 0 6px; }
.hint { font-weight: 400; color: var(--muted); }
textarea, input[type=text], input[type=email] { width: 100%; font: inherit; color: inherit; background: var(--bg);
  border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; }
textarea:focus, input:focus { outline: 2px solid var(--accent); outline-offset: -1px; border-color: transparent; }
.field { margin: 0 0 18px; }
pre { margin: 8px 0 0; max-height: 260px; overflow: auto; background: var(--bg); border: 1px solid var(--line);
  border-radius: 8px; padding: 10px 12px; font: 12px/1.45 ui-monospace, Menlo, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
details summary { cursor: pointer; color: var(--muted); }
.check { display: flex; gap: 8px; align-items: center; font-weight: 400; }
button { font: inherit; font-weight: 600; border: 0; border-radius: 8px; padding: 10px 20px; background: var(--accent);
  color: var(--on-accent); cursor: pointer; }
button:disabled { opacity: .6; cursor: default; }
.note { color: var(--muted); font-size: 13px; margin: 12px 0 0; }
.error { color: var(--bad); }
.done h2 { margin: 0 0 6px; font-size: 20px; }
.trap { position: absolute; left: -10000px; width: 1px; height: 1px; overflow: hidden; }
a { color: var(--accent); }
code { font: 13px ui-monospace, Menlo, monospace; }
`;

function page(title, body, { script = '', style = '', after = '', head = '' } = {}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${STYLE}${style}</style>${head}
</head>
<body>
<main>
${body}
</main>${after}${script ? `\n<script src="${script}"></script>` : ''}
</body>
</html>
`;
}

// The side panel's big shaded robot (extension/icons/robot-shaded.svg, drawn by scripts/render-icon.js),
// inline so the page loads nothing else; tests/site.test.js checks it still matches the extension's.
export const ROBOT_SVG = `<svg class="robot" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="r" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#44e0a8"/><stop offset="1" stop-color="#1e9a6c"/></linearGradient>
    <radialGradient id="e" cx="50%" cy="50%" r="55%"><stop offset="0" stop-color="#a7f3d0"/><stop offset="1" stop-color="#2fc58d"/></radialGradient>
    <filter id="h" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur in="SourceGraphic" stdDeviation="1.5" result="b"/><feColorMatrix in="b" type="matrix" values="0 0 0 0 0.204  0 0 0 0 0.827  0 0 0 0 0.6  0 0 0 0.5 0" result="g"/><feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <polygon points="115,64 115,64.89 115,65.78 115,66.67 114.99,67.57 114.99,68.46 114.98,69.36 114.97,70.26 114.95,71.16 114.93,72.07 114.91,72.98 114.88,73.89 114.84,74.81 114.79,75.73 114.74,76.65 114.68,77.58 114.61,78.51 114.52,79.45 114.43,80.39 114.32,81.33 114.21,82.27 114.07,83.22 113.93,84.17 113.76,85.12 113.58,86.08 113.38,87.03 113.17,87.98 112.93,88.93 112.67,89.88 112.4,90.83 112.09,91.77 111.77,92.7 111.42,93.63 111.05,94.55 110.65,95.46 110.22,96.36 109.77,97.25 109.29,98.13 108.78,98.99 108.25,99.83 107.69,100.66 107.1,101.47 106.48,102.25 105.84,103.02 105.17,103.76 104.48,104.48 103.76,105.17 103.02,105.84 102.25,106.48 101.47,107.1 100.66,107.69 99.83,108.25 98.99,108.78 98.13,109.29 97.25,109.77 96.36,110.22 95.46,110.65 94.55,111.05 93.63,111.42 92.7,111.77 91.77,112.09 90.83,112.4 89.88,112.67 88.93,112.93 87.98,113.17 87.03,113.38 86.08,113.58 85.12,113.76 84.17,113.93 83.22,114.07 82.27,114.21 81.33,114.32 80.39,114.43 79.45,114.52 78.51,114.61 77.58,114.68 76.65,114.74 75.73,114.79 74.81,114.84 73.89,114.88 72.98,114.91 72.07,114.93 71.16,114.95 70.26,114.97 69.36,114.98 68.46,114.99 67.57,114.99 66.67,115 65.78,115 64.89,115 64,115 63.11,115 62.22,115 61.33,115 60.43,114.99 59.54,114.99 58.64,114.98 57.74,114.97 56.84,114.95 55.93,114.93 55.02,114.91 54.11,114.88 53.19,114.84 52.27,114.79 51.35,114.74 50.42,114.68 49.49,114.61 48.55,114.52 47.61,114.43 46.67,114.32 45.73,114.21 44.78,114.07 43.83,113.93 42.88,113.76 41.92,113.58 40.97,113.38 40.02,113.17 39.07,112.93 38.12,112.67 37.17,112.4 36.23,112.09 35.3,111.77 34.37,111.42 33.45,111.05 32.54,110.65 31.64,110.22 30.75,109.77 29.87,109.29 29.01,108.78 28.17,108.25 27.34,107.69 26.53,107.1 25.75,106.48 24.98,105.84 24.24,105.17 23.52,104.48 22.83,103.76 22.16,103.02 21.52,102.25 20.9,101.47 20.31,100.66 19.75,99.83 19.22,98.99 18.71,98.13 18.23,97.25 17.78,96.36 17.35,95.46 16.95,94.55 16.58,93.63 16.23,92.7 15.91,91.77 15.6,90.83 15.33,89.88 15.07,88.93 14.83,87.98 14.62,87.03 14.42,86.08 14.24,85.12 14.07,84.17 13.93,83.22 13.79,82.27 13.68,81.33 13.57,80.39 13.48,79.45 13.39,78.51 13.32,77.58 13.26,76.65 13.21,75.73 13.16,74.81 13.12,73.89 13.09,72.98 13.07,72.07 13.05,71.16 13.03,70.26 13.02,69.36 13.01,68.46 13.01,67.57 13,66.67 13,65.78 13,64.89 13,64 13,63.11 13,62.22 13,61.33 13.01,60.43 13.01,59.54 13.02,58.64 13.03,57.74 13.05,56.84 13.07,55.93 13.09,55.02 13.12,54.11 13.16,53.19 13.21,52.27 13.26,51.35 13.32,50.42 13.39,49.49 13.48,48.55 13.57,47.61 13.68,46.67 13.79,45.73 13.93,44.78 14.07,43.83 14.24,42.88 14.42,41.92 14.62,40.97 14.83,40.02 15.07,39.07 15.33,38.12 15.6,37.17 15.91,36.23 16.23,35.3 16.58,34.37 16.95,33.45 17.35,32.54 17.78,31.64 18.23,30.75 18.71,29.87 19.22,29.01 19.75,28.17 20.31,27.34 20.9,26.53 21.52,25.75 22.16,24.98 22.83,24.24 23.52,23.52 24.24,22.83 24.98,22.16 25.75,21.52 26.53,20.9 27.34,20.31 28.17,19.75 29.01,19.22 29.87,18.71 30.75,18.23 31.64,17.78 32.54,17.35 33.45,16.95 34.37,16.58 35.3,16.23 36.23,15.91 37.17,15.6 38.12,15.33 39.07,15.07 40.02,14.83 40.97,14.62 41.92,14.42 42.88,14.24 43.83,14.07 44.78,13.93 45.73,13.79 46.67,13.68 47.61,13.57 48.55,13.48 49.49,13.39 50.42,13.32 51.35,13.26 52.27,13.21 53.19,13.16 54.11,13.12 55.02,13.09 55.93,13.07 56.84,13.05 57.74,13.03 58.64,13.02 59.54,13.01 60.43,13.01 61.33,13 62.22,13 63.11,13 64,13 64.89,13 65.78,13 66.67,13 67.57,13.01 68.46,13.01 69.36,13.02 70.26,13.03 71.16,13.05 72.07,13.07 72.98,13.09 73.89,13.12 74.81,13.16 75.73,13.21 76.65,13.26 77.58,13.32 78.51,13.39 79.45,13.48 80.39,13.57 81.33,13.68 82.27,13.79 83.22,13.93 84.17,14.07 85.12,14.24 86.08,14.42 87.03,14.62 87.98,14.83 88.93,15.07 89.88,15.33 90.83,15.6 91.77,15.91 92.7,16.23 93.63,16.58 94.55,16.95 95.46,17.35 96.36,17.78 97.25,18.23 98.13,18.71 98.99,19.22 99.83,19.75 100.66,20.31 101.47,20.9 102.25,21.52 103.02,22.16 103.76,22.83 104.48,23.52 105.17,24.24 105.84,24.98 106.48,25.75 107.1,26.53 107.69,27.34 108.25,28.17 108.78,29.01 109.29,29.87 109.77,30.75 110.22,31.64 110.65,32.54 111.05,33.45 111.42,34.37 111.77,35.3 112.09,36.23 112.4,37.17 112.67,38.12 112.93,39.07 113.17,40.02 113.38,40.97 113.58,41.92 113.76,42.88 113.93,43.83 114.07,44.78 114.21,45.73 114.32,46.67 114.43,47.61 114.52,48.55 114.61,49.49 114.68,50.42 114.74,51.35 114.79,52.27 114.84,53.19 114.88,54.11 114.91,55.02 114.93,55.93 114.95,56.84 114.97,57.74 114.98,58.64 114.99,59.54 114.99,60.43 115,61.33 115,62.22 115,63.11" fill="#18181a" stroke="url(#r)" stroke-width="10" stroke-linejoin="round"/>
  <g filter="url(#h)"><polygon points="57.35,63 57.35,63.22 57.35,63.43 57.34,63.65 57.34,63.86 57.33,64.08 57.32,64.3 57.31,64.51 57.3,64.73 57.29,64.95 57.27,65.16 57.25,65.38 57.22,65.6 57.2,65.82 57.17,66.03 57.14,66.25 57.1,66.47 57.06,66.69 57.02,66.91 56.98,67.12 56.93,67.34 56.88,67.56 56.83,67.78 56.77,68 56.71,68.21 56.64,68.43 56.57,68.64 56.5,68.86 56.42,69.07 56.34,69.29 56.25,69.5 56.16,69.71 56.07,69.92 55.97,70.13 55.87,70.33 55.76,70.54 55.65,70.74 55.54,70.94 55.42,71.14 55.3,71.34 55.17,71.53 55.04,71.73 54.9,71.92 54.76,72.1 54.62,72.29 54.47,72.47 54.31,72.64 54.16,72.82 53.99,72.99 53.83,73.16 53.66,73.32 53.49,73.48 53.31,73.64 53.13,73.79 52.94,73.94 52.76,74.08 52.57,74.22 52.37,74.35 52.18,74.48 51.97,74.61 51.77,74.73 51.57,74.85 51.36,74.96 51.15,75.06 50.93,75.17 50.72,75.26 50.5,75.36 50.28,75.44 50.06,75.53 49.84,75.61 49.62,75.68 49.39,75.75 49.16,75.81 48.94,75.87 48.71,75.93 48.48,75.98 48.25,76.03 48.02,76.07 47.79,76.11 47.56,76.14 47.32,76.18 47.09,76.2 46.86,76.23 46.63,76.25 46.39,76.26 46.16,76.27 45.93,76.28 45.7,76.29 45.46,76.3 45.23,76.3 45,76.3 44.77,76.3 44.54,76.3 44.3,76.29 44.07,76.28 43.84,76.27 43.61,76.26 43.37,76.25 43.14,76.23 42.91,76.2 42.68,76.18 42.44,76.14 42.21,76.11 41.98,76.07 41.75,76.03 41.52,75.98 41.29,75.93 41.06,75.87 40.84,75.81 40.61,75.75 40.38,75.68 40.16,75.61 39.94,75.53 39.72,75.44 39.5,75.36 39.28,75.26 39.07,75.17 38.85,75.06 38.64,74.96 38.43,74.85 38.23,74.73 38.03,74.61 37.82,74.48 37.63,74.35 37.43,74.22 37.24,74.08 37.06,73.94 36.87,73.79 36.69,73.64 36.51,73.48 36.34,73.32 36.17,73.16 36.01,72.99 35.84,72.82 35.69,72.64 35.53,72.47 35.38,72.29 35.24,72.1 35.1,71.92 34.96,71.73 34.83,71.53 34.7,71.34 34.58,71.14 34.46,70.94 34.35,70.74 34.24,70.54 34.13,70.33 34.03,70.13 33.93,69.92 33.84,69.71 33.75,69.5 33.66,69.29 33.58,69.07 33.5,68.86 33.43,68.64 33.36,68.43 33.29,68.21 33.23,68 33.17,67.78 33.12,67.56 33.07,67.34 33.02,67.12 32.98,66.91 32.94,66.69 32.9,66.47 32.86,66.25 32.83,66.03 32.8,65.82 32.78,65.6 32.75,65.38 32.73,65.16 32.71,64.95 32.7,64.73 32.69,64.51 32.68,64.3 32.67,64.08 32.66,63.86 32.66,63.65 32.65,63.43 32.65,63.22 32.65,63 32.65,62.78 32.65,62.57 32.66,62.35 32.66,62.14 32.67,61.92 32.68,61.7 32.69,61.49 32.7,61.27 32.71,61.05 32.73,60.84 32.75,60.62 32.78,60.4 32.8,60.18 32.83,59.97 32.86,59.75 32.9,59.53 32.94,59.31 32.98,59.09 33.02,58.88 33.07,58.66 33.12,58.44 33.17,58.22 33.23,58 33.29,57.79 33.36,57.57 33.43,57.36 33.5,57.14 33.58,56.93 33.66,56.71 33.75,56.5 33.84,56.29 33.93,56.08 34.03,55.87 34.13,55.67 34.24,55.46 34.35,55.26 34.46,55.06 34.58,54.86 34.7,54.66 34.83,54.47 34.96,54.27 35.1,54.08 35.24,53.9 35.38,53.71 35.53,53.53 35.69,53.36 35.84,53.18 36.01,53.01 36.17,52.84 36.34,52.68 36.51,52.52 36.69,52.36 36.87,52.21 37.06,52.06 37.24,51.92 37.43,51.78 37.63,51.65 37.82,51.52 38.03,51.39 38.23,51.27 38.43,51.15 38.64,51.04 38.85,50.94 39.07,50.83 39.28,50.74 39.5,50.64 39.72,50.56 39.94,50.47 40.16,50.39 40.38,50.32 40.61,50.25 40.84,50.19 41.06,50.13 41.29,50.07 41.52,50.02 41.75,49.97 41.98,49.93 42.21,49.89 42.44,49.86 42.68,49.82 42.91,49.8 43.14,49.77 43.37,49.75 43.61,49.74 43.84,49.73 44.07,49.72 44.3,49.71 44.54,49.7 44.77,49.7 45,49.7 45.23,49.7 45.46,49.7 45.7,49.71 45.93,49.72 46.16,49.73 46.39,49.74 46.63,49.75 46.86,49.77 47.09,49.8 47.32,49.82 47.56,49.86 47.79,49.89 48.02,49.93 48.25,49.97 48.48,50.02 48.71,50.07 48.94,50.13 49.16,50.19 49.39,50.25 49.62,50.32 49.84,50.39 50.06,50.47 50.28,50.56 50.5,50.64 50.72,50.74 50.93,50.83 51.15,50.94 51.36,51.04 51.57,51.15 51.77,51.27 51.97,51.39 52.18,51.52 52.37,51.65 52.57,51.78 52.76,51.92 52.94,52.06 53.13,52.21 53.31,52.36 53.49,52.52 53.66,52.68 53.83,52.84 53.99,53.01 54.16,53.18 54.31,53.36 54.47,53.53 54.62,53.71 54.76,53.9 54.9,54.08 55.04,54.27 55.17,54.47 55.3,54.66 55.42,54.86 55.54,55.06 55.65,55.26 55.76,55.46 55.87,55.67 55.97,55.87 56.07,56.08 56.16,56.29 56.25,56.5 56.34,56.71 56.42,56.93 56.5,57.14 56.57,57.36 56.64,57.57 56.71,57.79 56.77,58 56.83,58.22 56.88,58.44 56.93,58.66 56.98,58.88 57.02,59.09 57.06,59.31 57.1,59.53 57.14,59.75 57.17,59.97 57.2,60.18 57.22,60.4 57.25,60.62 57.27,60.84 57.29,61.05 57.3,61.27 57.31,61.49 57.32,61.7 57.33,61.92 57.34,62.14 57.34,62.35 57.35,62.57 57.35,62.78" fill="url(#e)"/><polygon points="95.35,63 95.35,63.22 95.35,63.43 95.34,63.65 95.34,63.86 95.33,64.08 95.32,64.3 95.31,64.51 95.3,64.73 95.29,64.95 95.27,65.16 95.25,65.38 95.22,65.6 95.2,65.82 95.17,66.03 95.14,66.25 95.1,66.47 95.06,66.69 95.02,66.91 94.98,67.12 94.93,67.34 94.88,67.56 94.83,67.78 94.77,68 94.71,68.21 94.64,68.43 94.57,68.64 94.5,68.86 94.42,69.07 94.34,69.29 94.25,69.5 94.16,69.71 94.07,69.92 93.97,70.13 93.87,70.33 93.76,70.54 93.65,70.74 93.54,70.94 93.42,71.14 93.3,71.34 93.17,71.53 93.04,71.73 92.9,71.92 92.76,72.1 92.62,72.29 92.47,72.47 92.31,72.64 92.16,72.82 91.99,72.99 91.83,73.16 91.66,73.32 91.49,73.48 91.31,73.64 91.13,73.79 90.94,73.94 90.76,74.08 90.57,74.22 90.37,74.35 90.18,74.48 89.97,74.61 89.77,74.73 89.57,74.85 89.36,74.96 89.15,75.06 88.93,75.17 88.72,75.26 88.5,75.36 88.28,75.44 88.06,75.53 87.84,75.61 87.62,75.68 87.39,75.75 87.16,75.81 86.94,75.87 86.71,75.93 86.48,75.98 86.25,76.03 86.02,76.07 85.79,76.11 85.56,76.14 85.32,76.18 85.09,76.2 84.86,76.23 84.63,76.25 84.39,76.26 84.16,76.27 83.93,76.28 83.7,76.29 83.46,76.3 83.23,76.3 83,76.3 82.77,76.3 82.54,76.3 82.3,76.29 82.07,76.28 81.84,76.27 81.61,76.26 81.37,76.25 81.14,76.23 80.91,76.2 80.68,76.18 80.44,76.14 80.21,76.11 79.98,76.07 79.75,76.03 79.52,75.98 79.29,75.93 79.06,75.87 78.84,75.81 78.61,75.75 78.38,75.68 78.16,75.61 77.94,75.53 77.72,75.44 77.5,75.36 77.28,75.26 77.07,75.17 76.85,75.06 76.64,74.96 76.43,74.85 76.23,74.73 76.03,74.61 75.82,74.48 75.63,74.35 75.43,74.22 75.24,74.08 75.06,73.94 74.87,73.79 74.69,73.64 74.51,73.48 74.34,73.32 74.17,73.16 74.01,72.99 73.84,72.82 73.69,72.64 73.53,72.47 73.38,72.29 73.24,72.1 73.1,71.92 72.96,71.73 72.83,71.53 72.7,71.34 72.58,71.14 72.46,70.94 72.35,70.74 72.24,70.54 72.13,70.33 72.03,70.13 71.93,69.92 71.84,69.71 71.75,69.5 71.66,69.29 71.58,69.07 71.5,68.86 71.43,68.64 71.36,68.43 71.29,68.21 71.23,68 71.17,67.78 71.12,67.56 71.07,67.34 71.02,67.12 70.98,66.91 70.94,66.69 70.9,66.47 70.86,66.25 70.83,66.03 70.8,65.82 70.78,65.6 70.75,65.38 70.73,65.16 70.71,64.95 70.7,64.73 70.69,64.51 70.68,64.3 70.67,64.08 70.66,63.86 70.66,63.65 70.65,63.43 70.65,63.22 70.65,63 70.65,62.78 70.65,62.57 70.66,62.35 70.66,62.14 70.67,61.92 70.68,61.7 70.69,61.49 70.7,61.27 70.71,61.05 70.73,60.84 70.75,60.62 70.78,60.4 70.8,60.18 70.83,59.97 70.86,59.75 70.9,59.53 70.94,59.31 70.98,59.09 71.02,58.88 71.07,58.66 71.12,58.44 71.17,58.22 71.23,58 71.29,57.79 71.36,57.57 71.43,57.36 71.5,57.14 71.58,56.93 71.66,56.71 71.75,56.5 71.84,56.29 71.93,56.08 72.03,55.87 72.13,55.67 72.24,55.46 72.35,55.26 72.46,55.06 72.58,54.86 72.7,54.66 72.83,54.47 72.96,54.27 73.1,54.08 73.24,53.9 73.38,53.71 73.53,53.53 73.69,53.36 73.84,53.18 74.01,53.01 74.17,52.84 74.34,52.68 74.51,52.52 74.69,52.36 74.87,52.21 75.06,52.06 75.24,51.92 75.43,51.78 75.63,51.65 75.82,51.52 76.03,51.39 76.23,51.27 76.43,51.15 76.64,51.04 76.85,50.94 77.07,50.83 77.28,50.74 77.5,50.64 77.72,50.56 77.94,50.47 78.16,50.39 78.38,50.32 78.61,50.25 78.84,50.19 79.06,50.13 79.29,50.07 79.52,50.02 79.75,49.97 79.98,49.93 80.21,49.89 80.44,49.86 80.68,49.82 80.91,49.8 81.14,49.77 81.37,49.75 81.61,49.74 81.84,49.73 82.07,49.72 82.3,49.71 82.54,49.7 82.77,49.7 83,49.7 83.23,49.7 83.46,49.7 83.7,49.71 83.93,49.72 84.16,49.73 84.39,49.74 84.63,49.75 84.86,49.77 85.09,49.8 85.32,49.82 85.56,49.86 85.79,49.89 86.02,49.93 86.25,49.97 86.48,50.02 86.71,50.07 86.94,50.13 87.16,50.19 87.39,50.25 87.62,50.32 87.84,50.39 88.06,50.47 88.28,50.56 88.5,50.64 88.72,50.74 88.93,50.83 89.15,50.94 89.36,51.04 89.57,51.15 89.77,51.27 89.97,51.39 90.18,51.52 90.37,51.65 90.57,51.78 90.76,51.92 90.94,52.06 91.13,52.21 91.31,52.36 91.49,52.52 91.66,52.68 91.83,52.84 91.99,53.01 92.16,53.18 92.31,53.36 92.47,53.53 92.62,53.71 92.76,53.9 92.9,54.08 93.04,54.27 93.17,54.47 93.3,54.66 93.42,54.86 93.54,55.06 93.65,55.26 93.76,55.46 93.87,55.67 93.97,55.87 94.07,56.08 94.16,56.29 94.25,56.5 94.34,56.71 94.42,56.93 94.5,57.14 94.57,57.36 94.64,57.57 94.71,57.79 94.77,58 94.83,58.22 94.88,58.44 94.93,58.66 94.98,58.88 95.02,59.09 95.06,59.31 95.1,59.53 95.14,59.75 95.17,59.97 95.2,60.18 95.22,60.4 95.25,60.62 95.27,60.84 95.29,61.05 95.3,61.27 95.31,61.49 95.32,61.7 95.33,61.92 95.34,62.14 95.34,62.35 95.35,62.57 95.35,62.78" fill="url(#e)"/></g>
</svg>`;

const REPO = 'https://github.com/acapellascience/trif';

// The home page: the robot, the name and what it does, two links, what you need. Wider than the form.
const HOME_STYLE = `
main.home { max-width: 920px; padding-top: 56px; display: grid; gap: 56px; }
.hero { display: grid; justify-items: center; text-align: center; gap: 12px; }
.robot { width: 112px; height: 112px; }
.hero h1 { font-size: clamp(30px, 5vw, 44px); line-height: 1.1; margin: 6px 0 0; letter-spacing: -0.02em; }
.tagline { font-size: clamp(18px, 2.4vw, 22px); margin: 0; }
.small { color: var(--muted); margin: 0; font-size: 14px; }
.links { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; margin-top: 8px; }
.btn { font-weight: 600; text-decoration: none; border-radius: 9px; padding: 10px 20px; background: var(--accent); color: var(--on-accent); }
.btn.plain { background: var(--card); color: var(--fg); border: 1px solid var(--line); }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; }
.two h2 { font-size: 22px; margin: 0 0 14px; letter-spacing: -0.01em; }
.two ul { margin: 0; padding-left: 18px; color: var(--muted); display: grid; gap: 6px; }
.two ul b { color: var(--fg); font-weight: 600; }
.two p { margin: 0; color: var(--muted); }
.two code { background: var(--card); border: 1px solid var(--line); padding: 1px 6px; border-radius: 5px; }
footer { max-width: 920px; margin: 0 auto; padding: 22px 16px 40px; border-top: 1px solid var(--line); color: var(--muted); font-size: 14px; display: flex; gap: 18px; flex-wrap: wrap; }
footer a { color: var(--muted); }
@media (max-width: 720px) { .two { grid-template-columns: 1fr; } }
`;

// The demo: a tab on the right edge, shown by demo.js (site/demo/tab.js), opens the real side panel docked
// to the right of the page (in the top layer, above mods' full-window layers); the page moves over to make
// room. At phone width the panel is a sheet over the bottom of the page.
const DEMO_STYLE = `
/* (The tab and the panel are moved out of <body> by demo.js, into the top layer where there is one: mods
   that take the page apart leave them alone. Their own styles say everything, so page-wide ones don't.) */
.demo-tab { position: fixed; z-index: 2147483646; inset: 50% 0 auto auto; margin: 0; transform: translateY(-50%); writing-mode: vertical-rl;
  padding: 14px 7px; background: var(--card); color: var(--fg); border: 1px solid var(--line); border-right: 0;
  border-radius: 8px 0 0 8px; font: 600 13px/1 -apple-system, system-ui, "Segoe UI", sans-serif; cursor: pointer; overflow: visible; }
.demo-tab:hover { color: var(--accent); }
.demo-tab[hidden] { display: none; }
.demo-panel { position: fixed; z-index: 2147483647; inset: 0 0 0 auto; width: 360px; height: auto; max-width: 100%; max-height: none;
  margin: 0; padding: 0; border: 0; border-left: 1px solid var(--line); background: var(--card); color: var(--fg);
  font: 13px/1.4 -apple-system, system-ui, "Segoe UI", sans-serif; display: none; flex-direction: column; overflow: hidden; }
.demo-panel:popover-open { display: flex; }
.demo-panel:not([popover]):not([hidden]) { display: flex; }
.demo-panel-top { display: flex; align-items: center; justify-content: space-between; padding: 3px 6px 3px 12px;
  border-bottom: 1px solid var(--line); color: var(--muted); font-size: 12px; }
.demo-close { padding: 2px 8px; background: none; color: var(--muted); font-size: 18px; font-weight: 400; line-height: 1.2; border-radius: 6px; }
.demo-close:hover { background: var(--bg); color: var(--fg); }
.demo-panel iframe { flex: 1; min-height: 0; width: 100%; border: 0; display: block; }
.demo-panel-note { margin: 0; padding: 6px 12px; border-top: 1px solid var(--line); color: var(--muted); font-size: 11px; line-height: 1.4; }
@media (min-width: 701px) { html.demo-open body { margin-right: 360px; } }
/* (Mods' full-window layers, the shooter's banner among them, size and place themselves by the window as
   innerWidth / innerHeight measure it, which demo.js narrows to the part beside the panel or above the sheet.) */
@media (max-width: 700px) {
  .demo-panel { inset: auto 0 0 0; width: auto; height: 72vh; height: 72dvh; border-left: 0; border-top: 1px solid var(--line);
    border-radius: 12px 12px 0 0; box-shadow: 0 -6px 24px rgb(0 0 0 / 0.15); transition: height .25s ease; }
  /* the top bar is the handle: swipe it down to tuck the sheet away, up (or tap it) to bring it back (demo.js) */
  .demo-panel-top { position: relative; height: 44px; flex: none; padding: 0 6px 0 14px; touch-action: none; cursor: grab; user-select: none; -webkit-user-select: none; }
  .demo-panel-top::before { content: ''; position: absolute; left: 50%; top: 6px; width: 36px; height: 4px; margin-left: -18px;
    border-radius: 2px; background: var(--line); }
  .demo-close { font-size: 22px; padding: 4px 12px; }
  html.demo-min .demo-panel { height: 45px; }
  /* (no room for it on a phone: the page says what the demo is) */
  .demo-panel-note { display: none; }
}
`;

/** The home page, with the demo's tab, and `head` and `tail` (the mods the demo switched on: demo.js). */
export function homePage({ head = '', tail = '' } = {}) {
  return page("Tim's Robot Internet Fixer", `
<section class="hero">
  ${ROBOT_SVG}
  <h1>Tim's Robot Internet Fixer</h1>
  <p class="tagline">Fix any website with your own coding agent.</p>
  <p class="small">Free and open source. In beta, for Mac.</p>
  <p class="links"><a class="btn" href="${REPO}#install" target="_blank" rel="noopener">Get it</a><a class="btn plain" href="${REPO}" target="_blank" rel="noopener">GitHub</a></p>
</section>
<section class="two">
  <div>
    <h2>What you need</h2>
    <ul>
      <li><b>A Mac</b> (Linux works too; not Windows yet)</li>
      <li><b>Chrome</b> 138 or newer, or <b>Firefox</b></li>
      <li><b>Node</b> 18 or newer</li>
      <li><b>A coding agent:</b> Claude Code or Codex, on your own account, or an open model (experimental)</li>
    </ul>
  </div>
  <div>
    <h2>Yours, on your computer</h2>
    <p>Mods are plain JavaScript files in <code>~/.trif</code>: you can read them, edit them, share them, or switch them off. TRIF collects nothing. The only thing that ever reaches me is a problem report, if you choose to send one.</p>
  </div>
</section>`, {
    style: HOME_STYLE + DEMO_STYLE,
    head,
    after: `\n<footer><a href="${REPO}">GitHub</a><a href="/report">Report a problem</a><a href="/windows">Windows waitlist</a><a href="${REPO}/blob/main/store/PRIVACY.md">Privacy</a></footer>` +
      '\n<button type="button" class="demo-tab" hidden>Try the demo</button>\n<script src="/demo.js" defer></script>' + tail,
  }).replace('<main>', '<main class="home">');
}

export const HOME = homePage();

export const REPORT = page('Report a problem · TRIF', `
<h1>Report a problem</h1>
<p class="lead">Tell the TRIF developer what went wrong.</p>
<form id="form" class="card" novalidate>
  <div class="field">
    <label for="what">What went wrong?</label>
    <textarea id="what" rows="6" maxlength="5000" required
      placeholder="What you did, what you expected, and what happened instead."></textarea>
  </div>
  <div class="field">
    <label for="site">Which site? <span class="hint">(optional)</span></label>
    <input id="site" type="text" maxlength="200" placeholder="e.g. x.com" autocomplete="off">
  </div>
  <div class="field">
    <label for="email">Your email <span class="hint">(optional, if you'd like a reply)</span></label>
    <input id="email" type="email" maxlength="200" autocomplete="email">
  </div>
  <div class="field" id="details-field" hidden>
    <label class="check"><input id="include" type="checkbox" checked> Include details from TRIF</label>
    <details>
      <summary>What's included</summary>
      <pre id="details"></pre>
    </details>
  </div>
  <div class="field" id="paste-field">
    <label for="pasted">Details from TRIF <span class="hint">(optional)</span></label>
    <textarea id="pasted" rows="4" maxlength="30000"
      placeholder="If you can, paste what this Terminal command prints: ~/.trif/bin/trif report"></textarea>
  </div>
  <div class="trap" aria-hidden="true"><label for="website">Website</label><input id="website" type="text" tabindex="-1" autocomplete="off"></div>
  <button id="send" type="submit">Send report</button>
  <p id="status" class="note" role="status">The report goes to the TRIF developer and nowhere else. The details list
    versions, setup checks, the site's mods and recent errors, without your name or full page addresses.</p>
</form>
<div id="done" class="card done" hidden>
  <h2>Thanks, it's sent.</h2>
  <p style="margin:0">Thanks for helping make TRIF better. If you left your email, you may hear back.</p>
</div>`, { script: '/report.js' });

// The form's script. Details from TRIF arrive after the # (r=<report>&s=<site>): browsers never send
// that part to a server, so nothing leaves the computer until the person presses Send.
export const REPORT_JS = `(() => {
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.hash.slice(1));
  const details = params.get('r') || '';
  if (params.get('s')) $('site').value = params.get('s');
  if (details) {
    $('details').textContent = details;
    $('details-field').hidden = false;
    $('paste-field').hidden = true;
  }
  if (location.hash) history.replaceState(null, '', location.pathname); // not kept in the address bar or history
  $('what').focus();

  const status = (msg, bad) => { $('status').textContent = msg; $('status').classList.toggle('error', !!bad); };
  $('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if ($('what').value.trim().length < 3) { status('Please say what went wrong.', true); $('what').focus(); return; }
    $('send').disabled = true;
    status('Sending…');
    const body = {
      what: $('what').value, site: $('site').value, email: $('email').value, website: $('website').value,
      details: details ? ($('include').checked ? details : '') : $('pasted').value,
    };
    try {
      const res = await fetch('/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const r = await res.json().catch(() => ({}));
      if (!res.ok || !r.ok) throw new Error(r.error || 'The report couldn’t be sent (' + res.status + ').');
      $('form').hidden = true;
      $('done').hidden = false;
    } catch (err) {
      $('send').disabled = false;
      status(err.message + ' You can also email it to reports@timsrobot.com.', true);
    }
  });
})();
`;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const THANKS = `<h2>Thanks, you're on the list.</h2>
  <p style="margin:0">Tim will email you when TRIF works on Windows.</p>`;

/**
 * The Windows waitlist page. With no options, the form. After a plain form post (no script): { thanks }
 * for the thanks page, or { error, email } for the form again with what was wrong and what was typed.
 */
export function windowsPage({ thanks = false, error = '', email = '' } = {}) {
  const body = thanks ? `<div class="card done">
  ${THANKS}
</div>` : `<form id="form" class="card" method="post" action="/windows">
  <div class="field">
    <label for="email">Your email</label>
    <input id="email" name="email" type="email" maxlength="200" autocomplete="email" required value="${esc(email)}">
  </div>
  <div class="trap" aria-hidden="true"><label for="website">Website</label><input id="website" name="website" type="text" tabindex="-1" autocomplete="off"></div>
  <button id="send" type="submit">Join the waitlist</button>
  <p id="status" class="note error" role="status"${error ? '' : ' hidden'}>${esc(error)}</p>
  <p class="note">Your email is used only to tell you when TRIF is ready for Windows, nothing else.
    To be removed, ask at <a href="mailto:reports@timsrobot.com">reports@timsrobot.com</a>.</p>
</form>
<div id="done" class="card done" hidden>
  ${THANKS}
</div>`;
  return page('Windows waitlist · TRIF', `
<h1>Windows waitlist</h1>
<p class="lead">TRIF works on Mac and Linux for now. Windows is coming.</p>
${body}`, { script: thanks ? '' : '/windows.js' });
}

export const WINDOWS = windowsPage();

// The waitlist form's script: sends the signup without leaving the page. Without it, the form posts and
// the Worker answers with a page.
export const WINDOWS_JS = `(() => {
  const $ = (id) => document.getElementById(id);
  const status = (msg) => { $('status').textContent = msg; $('status').hidden = !msg; };
  $('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('send').disabled = true;
    status('');
    try {
      const res = await fetch('/windows', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: $('email').value, website: $('website').value }) });
      const r = await res.json().catch(() => ({}));
      if (!res.ok || !r.ok) throw new Error(r.error || 'You couldn’t be added just now. Please try again later.');
      $('form').hidden = true;
      $('done').hidden = false;
    } catch (err) {
      $('send').disabled = false;
      status(err instanceof TypeError ? 'You couldn’t be added just now. Please try again later.' : err.message);
    }
  });
})();
`;
