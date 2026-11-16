'use strict';
// Ablations: X-Flyer (or its company) with one feature switched off, to see what that feature costs. Each
// edits the mod's text as it's read for a run (so the live file is never touched), and fails loudly if the
// line it edits isn't there any more (the game changed: update the anchor). Combine with +: no-glow+no-music.
// (These are for measuring only: an ablated game doesn't look or play the same.)

const patch = (find, replace) => ({ find, replace });
const VARIANTS = {
  'no-xlate-scan': { what: "the theme translator's once-a-second re-scan (and re-marking of X's inline colours)", flyer: [patch('setInterval(tick, 1000);', '/* ablated: setInterval(tick, 1000); */')] },
  'no-xlate': { what: 'no recolouring at all: X already in the world\'s theme (dark), so the translator stays idle', page: 'theme=dark' },
  'no-glow': { what: "Rainbow Rave's additive glow layers (paintGlow)", flyer: [patch('const paintGlow = () => {', 'const paintGlow = () => { return;')] },
  'no-wrap': { what: 'words not wrapped into targets (nothing to blast)', flyer: [patch('const wrapWords = () => {', 'const wrapWords = () => { return;')] },
  'no-chase': { what: 'avatars never wake (no chasers, no boss)', flyer: [patch('const wakeAvatar = (word) => {', 'const wakeAvatar = (word) => { return;')] },
  'no-shadows': { what: "the flying things' drop shadows (the shadow layer)", flyer: [patch('const shadowed = (x, y, R, fn) => {', 'const shadowed = (x, y, R, fn) => { fn(); return;'), patch('const castShadows = () => {', 'const castShadows = () => { return;')] },
  'no-timeline': { what: "Home's upside-down Timeline mode", flyer: [patch('const findTimeline = () => {', 'const findTimeline = () => { return null;')] },
  'no-hud': { what: "the panel's re-fitting (placeHud) twice a second", flyer: [patch('const placeHud = (now = performance.now()) => {', 'const placeHud = (now = performance.now()) => { return;')] },
  'no-shake': { what: 'the screen shake (the main column translated each frame)', flyer: [patch('const applyShake = (dt) => {', 'const applyShake = (dt) => { shakeX = 0; shakeY = 0; return;')] },
  'no-shadowblur': { what: 'no canvas shadowBlur anywhere in the game (glows on the ship, avatars, rings, text): attribution only', flyer: [{ re: /\b(ctx|g|glowG|glowZG|shadowG)\.shadowBlur = /g, replace: '$1.shadowBlur = 0 * ' }] },
  // (attribution only: one kind of drawing left out)
  'no-letters': { what: "blasted words' flying letters not drawn", flyer: [patch('ctx.fillText(b.ch, 0, 0);', '/* ablated */')] },
  'no-sparks': { what: 'sparks not drawn', flyer: [patch('ctx.fillRect(b.x - b.size / 2, b.y - b.size / 2, b.size, b.size);', '/* ablated */')] },
  'no-rings': { what: 'shockwave rings not drawn', flyer: [patch('const g = rings[i];', 'const g = rings[i]; if (g) { rings.splice(i, 1); continue; }')] },
  'no-laser-draw': { what: 'laser bolts not drawn (still fired and hitting)', flyer: [patch('const drawLaser = (l) => {', 'const drawLaser = (l) => { return;')] },
  'no-ship-draw': { what: 'the ship not drawn', flyer: [patch('drawShip(now, dt, now >= deadUntil', 'false && drawShip(now, dt, now >= deadUntil')] },
  'no-lives': { what: 'the lives (little ships under the panel) not drawn', flyer: [patch('drawLives(now); drawDied(now);', 'drawDied(now);')] },
  'no-telegraph-blur': { what: "the boss's dive warning line without its glow (shadowBlur)", flyer: [patch("ctx.shadowColor = '#f00'; ctx.shadowBlur = 12;", "ctx.shadowColor = '#f00';")] },
  'no-avatar-glow': { what: "the avatars' and the boss's glow (shadowBlur) left out", flyer: [patch('ctx.shadowBlur = c.boss ? (c.telegraph ? 50 : 30) : 14;', 'ctx.shadowBlur = 0;')] },
  'no-boss-ring': { what: "Rainbow Rave's blurred rainbow ring round the boss (ctx.filter) left out", flyer: [patch('const bossRing = raveBoss ? ctx.createConicGradient(now / 300, c.x, c.y) : null;', 'const bossRing = null;')] },
  'no-music': { what: 'the music switch off (no soundtrack decoded or played; Rainbow Rave\'s music follows it)', prefs: { music: false } },
  'no-sfx': { what: 'the sound-effects switch off', prefs: { sfx: false } },
  'no-rave': { what: 'without Rainbow Rave', drop: ['rainbow-rave'] },
  'no-detox': { what: 'without Detox Timeline', drop: ['detox-timeline'] },
  'no-follow': { what: 'without Follow status', drop: ['follow-status'] },
  'no-punk': { what: 'without Punk Fonts', drop: ['punk-fonts'] },
};

function edit(mod, patches) {
  let code = mod.code;
  for (const { find, replace, re } of patches) {
    if (re) { // (every match of a pattern)
      const n = (code.match(re) || []).length;
      if (!n) throw new Error(`variant: ${re} isn't in ${mod.id} (the mod changed: update tests/perf/lib/variants.js)`);
      code = code.replace(re, replace);
      continue;
    }
    const n = code.split(find).length - 1;
    if (n !== 1) throw new Error(`variant: "${find}" is in ${mod.id} ${n} times, not once (the mod changed: update tests/perf/lib/variants.js)`);
    code = code.replace(find, () => replace);
  }
  return { ...mod, code, patched: true };
}

// Applied to every run (not an ablation): the ship can't be killed by touching the avatars or the boss, so
// every run plays the same game (a death throws the chasers back, a third one is a game over and a restart,
// at random moments). Dying has its own state (gameover, from the game's own test hook). --mortal: without.
const IMMORTAL = patch('if (now > safeUntil && (touchesRobot() || touchesChaser())) blowUpShip(now);', '/* (perf suite: immortal) */');

/** variant ('none' or 'a+b') → {flyer, others, prefs, page} */
function applyVariant(variant, { flyer, others }, { mortal = false } = {}) {
  const out = { flyer: mortal ? flyer : edit(flyer, [IMMORTAL]), others, prefs: {}, page: '' };
  if (!variant || variant === 'none') return out;
  for (const name of variant.split('+')) {
    const v = VARIANTS[name];
    if (!v) throw new Error(`unknown variant ${name}`);
    if (v.flyer) out.flyer = edit(out.flyer, v.flyer);
    if (v.prefs) Object.assign(out.prefs, v.prefs);
    if (v.page) out.page = out.page ? `${out.page}&${v.page}` : v.page;
    if (v.drop) out.others = out.others.filter((m) => !v.drop.some((d) => m.id.endsWith(`/${d}`)));
  }
  return out;
}

module.exports = { VARIANTS, applyVariant };
