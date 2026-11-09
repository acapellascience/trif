'use strict';
// A line diff for the panel's "Show what changed" on a waiting change to a mod: hunks of changed lines with
// a little context, as [{t: ' ' | '-' | '+', s: line}], '…' lines between hunks. Common lines at both
// ends are trimmed first; the middle is diffed by longest common subsequence while that's cheap, and
// otherwise shown as all removed then all added (still correct, just coarse).

const MAX_CELLS = 4e6; // the middle's lines before x after (the LCS table)

function lineDiff(before, after, { context = 3, maxLines = 4000 } = {}) {
  const a = String(before ?? '').split('\n'), b = String(after ?? '').split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const midA = a.slice(start, endA), midB = b.slice(start, endB);
  const ops = []; // full sequence: [t, s]
  for (let i = 0; i < start; i++) ops.push([' ', a[i]]);
  if (midA.length * midB.length <= MAX_CELLS) {
    // LCS table, from the end
    const n = midA.length, m = midB.length;
    const W = m + 1;
    const L = new Uint32Array((n + 1) * W);
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
      L[i * W + j] = midA[i] === midB[j] ? L[(i + 1) * W + j + 1] + 1 : Math.max(L[(i + 1) * W + j], L[i * W + j + 1]);
    }
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) { ops.push([' ', midA[i]]); i++; j++; }
      else if (L[(i + 1) * W + j] >= L[i * W + j + 1]) ops.push(['-', midA[i++]]);
      else ops.push(['+', midB[j++]]);
    }
    while (i < n) ops.push(['-', midA[i++]]);
    while (j < m) ops.push(['+', midB[j++]]);
  } else {
    for (const s of midA) ops.push(['-', s]);
    for (const s of midB) ops.push(['+', s]);
  }
  for (let i = endA; i < a.length; i++) ops.push([' ', a[i]]);
  // keep changed lines and `context` lines around them
  const keep = new Uint8Array(ops.length);
  ops.forEach(([t], k) => { if (t !== ' ') for (let d = -context; d <= context; d++) if (k + d >= 0 && k + d < ops.length) keep[k + d] = 1; });
  const out = [];
  let gap = false;
  for (let k = 0; k < ops.length; k++) {
    if (!keep[k]) { gap = true; continue; }
    if (gap && out.length) out.push({ t: '…', s: '' });
    gap = false;
    out.push({ t: ops[k][0], s: ops[k][1].length > 400 ? `${ops[k][1].slice(0, 400)}…` : ops[k][1] });
    if (out.length >= maxLines) { out.push({ t: '…', s: '(more changes not shown)' }); break; }
  }
  return out;
}

module.exports = { lineDiff };
