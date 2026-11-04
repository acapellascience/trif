// ==WebMod==
// @name        Living Robot
// @description The robot comes alive
// @match       *://timsrobot.com/*
// @match       *://*.timsrobot.com/*
// @run-at      document-idle
// @risk        0 render-only
// @source      trif
// @version     1
// ==/WebMod==

(() => {
  const MAX_LOOK = 6; // how far the eyes move, in the SVG's 128-unit viewBox

  const style = document.createElement('style');
  style.textContent = `
    svg.robot[data-lr] { cursor: pointer; overflow: visible; pointer-events: auto; position: relative; z-index: 50; }
    svg.robot[data-lr] .lr-leg { transform-box: view-box; }
    /* He walks behind the hero's title, tagline, badges and buttons (as he does under Tilt card, where
       they float at a greater depth) but in front of the rest of the page. */
    main > section.hero:has(> svg.robot[data-lr]) > :not(svg.robot) { position: relative; z-index: 51; }
    /* the walk cycle is driven from JS (legs' transform, the svg's rotate and translate); lean from the feet */
    svg.robot[data-lr] { transform-origin: 50% 100%; }
    svg.robot[data-lr] .lr-look { transition: transform 120ms ease-out; }
    svg.robot[data-lr] .lr-eye { transform-box: fill-box; transform-origin: center; }
    /* the flinch tilt pivots at his feet */
    svg.robot[data-lr] .lr-body { transform-box: view-box; transform-origin: 64px 146px; }
    svg.robot[data-lr].lr-blink .lr-eye { animation: lr-blink 160ms ease-in-out; }
    @keyframes lr-blink { 0%, 100% { transform: scaleY(1); } 50% { transform: scaleY(0.08); } }
    svg.robot[data-lr].lr-hop { animation: lr-hop 600ms cubic-bezier(.3,.7,.4,1); transform-origin: 50% 100%; }
    @keyframes lr-hop {
      0%   { transform: translateY(0) scale(1, 1); }
      15%  { transform: translateY(0) scale(1.12, 0.86); }
      45%  { transform: translateY(-38px) scale(0.94, 1.08); }
      75%  { transform: translateY(0) scale(1.1, 0.9); }
      88%  { transform: translateY(-4px) scale(0.98, 1.02); }
      100% { transform: translateY(0) scale(1, 1); }
    }
  `;
  (document.head || document.documentElement).append(style);

  const setup = () => {
    const svg = document.querySelector('svg.robot');
    if (!svg || svg.hasAttribute('data-lr')) return !!svg;
    const look = svg.querySelector('g[filter]'); // the glowing group holding both eyes
    const eyes = look ? [...look.querySelectorAll('polygon, circle, ellipse, path')] : [];
    if (!look || !eyes.length) { window.trif?.warn('robot shape changed: no eyes found'); return true; }
    svg.setAttribute('data-lr', '');
    eyes.forEach((e) => e.classList.add('lr-eye'));
    // Wrap the filtered group so the glow moves with the eyes.
    const wrap = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    wrap.classList.add('lr-look');
    look.replaceWith(wrap);
    wrap.append(look);

    // Eyes follow the mouse (except while chasing the ship: then they stare at it).
    let pending = null, queued = false, chasing = false;
    addEventListener('pointermove', (ev) => {
      pending = ev;
      if (queued) return;
      queued = true;
      setTimeout(() => {
        queued = false;
        try {
          if (chasing) return;
          const r = svg.getBoundingClientRect();
          if (!r.width) return;
          const dx = pending.clientX - (r.left + r.width / 2);
          const dy = pending.clientY - (r.top + r.height * 0.49);
          const dist = Math.hypot(dx, dy) || 1;
          const k = Math.min(1, dist / 300) * MAX_LOOK / dist;
          wrap.style.transform = `translate(${(dx * k).toFixed(2)}px, ${(dy * k).toFixed(2)}px)`;
        } catch (e) { window.trif?.warn(String(e)); }
      }, 16);
    }, { passive: true });
    document.addEventListener('mouseleave', () => { wrap.style.transform = ''; });

    // Blink every few seconds (sometimes twice).
    const blink = () => {
      svg.classList.remove('lr-blink');
      void svg.getBoundingClientRect();
      svg.classList.add('lr-blink');
    };
    svg.addEventListener('animationend', (e) => { if (e.animationName === 'lr-blink') svg.classList.remove('lr-blink'); });
    const scheduleBlink = () => setTimeout(() => {
      blink();
      if (Math.random() < 0.25) setTimeout(blink, 260);
      scheduleBlink();
    }, 2500 + Math.random() * 3500);
    scheduleBlink();

    // --- Sounds (Web Audio, nothing loaded; they start after your first real click or key press, since
    // browsers only allow sound after one): a dull little tap for each footstep, a boing for each jump.
    const sfx = (() => {
      let ac = null, out = null, noise = null;
      const wake = (e) => {
        if (!e.isTrusted) return;
        try {
          if (!ac) {
            ac = new AudioContext();
            const comp = ac.createDynamicsCompressor();
            out = ac.createGain(); out.gain.value = 0.5;
            // +6 dB (×2) after the compressor, to sit level with Rainbow Rave's music
            const boost = ac.createGain(); boost.gain.value = 2;
            out.connect(comp); comp.connect(boost); boost.connect(ac.destination);
            noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
            const d = noise.getChannelData(0);
            for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
          }
          if (ac.state === 'suspended') ac.resume();
        } catch (err) { window.trif?.warn('robot sound failed', String(err)); }
      };
      addEventListener('pointerdown', wake, true);
      addEventListener('keydown', wake, true);
      const live = () => ac && ac.state === 'running' && !document.hidden;
      const env = (t, peak, attack, decay) => {
        const g = ac.createGain();
        g.gain.value = 0.0001; // silent from the start (a new gain node is at 1 until its schedule takes over)
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(peak, t + attack);
        g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
        g.connect(out);
        return g;
      };
      return {
        // a muffled little foot tap, barely there: a short low tone and a puff of noise, both through a
        // steep low cut-off (most of the high end gone) and with a softened attack (a sharp one clicks)
        // (k: 0–1, how hard he's walking)
        step: (k = 1) => {
          try {
            if (!live()) return;
            const t = ac.currentTime;
            const muffle = ac.createBiquadFilter(), muffle2 = ac.createBiquadFilter();
            muffle.type = muffle2.type = 'lowpass';
            muffle.frequency.value = muffle2.frequency.value = 170; // two in a row: a steep roll-off
            muffle.connect(muffle2); muffle2.connect(env(t, 0.035 * k, 0.008, 0.07));
            const o = ac.createOscillator();
            o.type = 'sine';
            o.frequency.setValueAtTime(120 + Math.random() * 20, t);
            o.frequency.exponentialRampToValueAtTime(65, t + 0.06);
            o.connect(muffle);
            o.start(t); o.stop(t + 0.12);
            const src = ac.createBufferSource(), ng = ac.createGain();
            src.buffer = noise; ng.gain.value = 0.4;
            src.connect(ng); ng.connect(muffle);
            src.start(t, Math.random() * 0.9); src.stop(t + 0.1);
          } catch {}
        },
        // "er-or-o-ee-eh": a little robot voice when he notices you. FM synthesis for the robotic tone: a
        // sine carrier whose frequency is wobbled by a second sine at twice its pitch (a strong wobble:
        // bright, buzzy and a bit metallic), doubled an octave below by a second FM voice for weight. The
        // upper voice goes through a band that moves per syllable, so it reads as vowels.
        // Two lines, in the same voice: 'greet' (the full "er-or-o-ee-eh", for a fresh player) and 'grumble'
        // (a short low "brr-grrp", once he's already blown you up: the long one gets tiring).
        notice: (line = 'greet') => {
          try {
            if (!live()) return;
            const t = ac.currentTime, bp = ac.createBiquadFilter(), g = ac.createGain();
            bp.type = 'bandpass'; bp.Q.value = 1.6;
            g.gain.value = 0.0001; // (silent from the start: see env)
            // The pitch is written once as a list of events, then played on every oscillator that follows
            // it (carriers, modulators, wobble depths), each scaled
            const pitch = [];
            const o = { frequency: {
              setValueAtTime: (v, at) => pitch.push(['set', v, at]),
              exponentialRampToValueAtTime: (v, at) => pitch.push(['exp', v, at]),
            } };
            const follow = (param, k) => {
              for (const [type, v, at] of pitch) {
                if (type === 'set') param.setValueAtTime(v * k, at); else param.exponentialRampToValueAtTime(v * k, at);
              }
            };
            // The tune: A3 → F3 → E3 → A♭3 → D3, each syllable on its note. The "ee" is staccato (cut off
            // clean), then a full note's rest; the last note is held, and slides down to A2 over its last
            // half. The vowel bands are what make it sound like syllables.
            const NOTE = 0.16;
            const LINES = {
              greet: { // [note Hz, length s, vowel band Hz, staccato?]
                syl: [
                  [220.0, NOTE, 700],          // er: A3
                  [174.61, NOTE, 900],         // or: F3
                  [164.81, NOTE, 1100],        // o:  E3
                  [207.65, 0.18, 2400, true],  // ee: A♭3, staccato… (its slot a bit longer, to fit its sound)
                  [0, NOTE],                   // …a full note's rest
                  [146.83, 0.45, 1500],        // eh: D3, held, sliding down
                ],
                slide: [0.5, 110],             // the last note holds for half its length, then slides to A2
              },
              grumble: { // "brr-grrp": two low syllables with a rolled r (a fast flutter), the second dropping
                syl: [
                  [146.83, 0.12, 600],         // brr: D3
                  [110.0, 0.17, 750],          // grrp: A2…
                ],
                slide: [0.6, 82.41],           // …dropping to E2 at the end (the "p")
                flutter: 28,                   // the rolled r: the volume trembles 28 times a second
              },
              // Happy little murmurs while he wanders and stops to consider: short, softer, ending upwards
              hum: { // "mm-hm?": D3, then F3 lifting to A3
                syl: [[146.83, 0.13, 600], [174.61, 0.2, 800]],
                slide: [0.4, 220], vol: 0.6,
              },
              hmhm: { // "hm, hm!": E3, a breath, then A3 lifting a tone
                syl: [[164.81, 0.1, 700], [0, 0.06], [220.0, 0.16, 1000]],
                slide: [0.5, 246.94], vol: 0.55,
              },
              brrup: { // "brr-up?": a happy rolled r, A2 then D3 lifting to E3
                syl: [[110.0, 0.12, 650], [146.83, 0.17, 900]],
                slide: [0.5, 164.81], flutter: 22, vol: 0.6,
              },
            };
            const { syl: SYL, slide, flutter, vol = 1 } = LINES[line] || LINES.greet;
            const PEAK = 0.09 * vol, LOW = 0.06 * vol;
            let s = t;
            g.gain.setValueAtTime(0.0001, s);
            SYL.forEach(([note, len, band, staccato], i) => {
              if (!note) { g.gain.setValueAtTime(0.0001, s); s += len; return; } // rest: silence
              o.frequency.setValueAtTime(note, s);
              if (i === SYL.length - 1) {
                o.frequency.setValueAtTime(note, s + len * slide[0]); // (holds, then slides)
                o.frequency.exponentialRampToValueAtTime(slide[1], s + len);
              }
              bp.frequency.setValueAtTime(band, s);
              if (staccato) { // straight up, a clean cut-off, silent for the rest of its length
                const on = 0.1625; // (sounding for 0.1625 s of its 0.18, then cut off)
                g.gain.setValueAtTime(0.0001, s);
                g.gain.linearRampToValueAtTime(PEAK, s + 0.012);
                g.gain.setValueAtTime(PEAK, s + on - 0.012);
                g.gain.linearRampToValueAtTime(0.0001, s + on);
                g.gain.setValueAtTime(0.0001, s + len);
                s += len;
                return;
              }
              if (!SYL[i - 1]?.[0] && i > 0) g.gain.setValueAtTime(0.0001, s); // after a rest: from silence
              g.gain.linearRampToValueAtTime(PEAK, s + 0.024); // each syllable swells in…
              g.gain.linearRampToValueAtTime(LOW, s + len - 0.03); // …and dips before the next
              s += len;
            });
            g.gain.linearRampToValueAtTime(0.0001, s + 0.08);
            // an FM voice at k × the tune: carrier + modulator at RATIO × its pitch, wobbling it by INDEX × the
            // modulator's frequency
            const RATIO = 2, INDEX = 2.2, end = s + 0.1;
            const fmVoice = (k, dest, level) => {
              const car = ac.createOscillator(), mod = ac.createOscillator(), depth = ac.createGain(), lv = ac.createGain();
              car.type = mod.type = 'sine';
              depth.gain.value = 0;
              follow(car.frequency, k);
              follow(mod.frequency, k * RATIO);
              follow(depth.gain, k * RATIO * INDEX);
              mod.connect(depth); depth.connect(car.frequency);
              lv.gain.value = level;
              car.connect(lv); lv.connect(dest);
              car.start(t); mod.start(t); car.stop(end); mod.stop(end);
            };
            fmVoice(1, bp, 0.5);                        // the voice, through the vowel band
            const sub = ac.createBiquadFilter();        // an octave below, darker, straight in under it
            sub.type = 'lowpass'; sub.frequency.value = 700;
            sub.connect(g);
            fmVoice(0.5, sub, 0.18);
            bp.connect(g);
            if (flutter) { // the rolled r: an LFO trembling the volume between about 30% and 100%
              const trem = ac.createGain(), lfo = ac.createOscillator(), lfoDepth = ac.createGain();
              trem.gain.value = 0.65;
              lfo.frequency.value = flutter; lfoDepth.gain.value = 0.35;
              lfo.connect(lfoDepth); lfoDepth.connect(trem.gain);
              g.connect(trem); trem.connect(out);
              lfo.start(t); lfo.stop(end);
            } else g.connect(out);
          } catch {}
        },
        // boing: a square-wave blip sweeping up, like a platformer jump (higher jumps sweep further)
        boing: (k = 1) => {
          try {
            if (!live()) return;
            const t = ac.currentTime, o = ac.createOscillator(), f = ac.createBiquadFilter();
            o.type = 'square';
            o.frequency.setValueAtTime(260, t);
            o.frequency.exponentialRampToValueAtTime(260 * (2.4 + 0.8 * Math.min(1, k)), t + 0.18);
            f.type = 'lowpass'; f.frequency.value = 2600;
            o.connect(f); f.connect(env(t, 0.05, 0.005, 0.22));
            o.start(t); o.stop(t + 0.26);
          } catch {}
        },
      };
    })();

    // Hop on click.
    let landTimer = 0;
    // what he says on noticing you: the full greeting until he's blown your ship up (Space Shooter's
    // death count, sent with its `tss-ship` event), then just a grumble
    const noticeLine = () => (ship?.deaths > 0 ? 'grumble' : 'greet');
    const hop = (voice) => {
      if (voice === 'notice') sfx.notice(noticeLine()); else sfx.boing();
      svg.classList.remove('lr-hop');
      void svg.getBoundingClientRect(); // restart the animation on rapid clicks
      svg.classList.add('lr-hop');
      blink();
      // he touches down at the hop's 75% keyframe: 450 ms into its 600 (a restarted hop restarts the timer)
      clearTimeout(landTimer);
      landTimer = setTimeout(() => sfx.step(1), 450);
    };
    svg.addEventListener('click', hop);
    svg.addEventListener('animationend', (e) => { if (e.animationName === 'lr-hop') svg.classList.remove('lr-hop'); });

    // Little legs, drawn behind the head so the hips tuck under it.
    const NS = 'http://www.w3.org/2000/svg';
    const el = (tag, attrs) => { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); return n; };
    const legs = el('g', { class: 'lr-legs' });
    for (const x of [46, 82]) {
      const leg = el('g', { class: 'lr-leg' });
      leg.style.transformOrigin = `${x}px 112px`;
      leg.append(
        // Solid colour: a gradient with a zero-width bounding box (a vertical line) doesn't paint.
        el('line', { x1: x, y1: 108, x2: x, y2: 140, stroke: '#2fc58d', 'stroke-width': 7, 'stroke-linecap': 'round' }),
        el('ellipse', { cx: x, cy: 143, rx: 10, ry: 5, fill: '#2fc58d' }),
      );
      legs.append(leg);
    }
    const head = svg.querySelector(':scope > polygon');
    svg.insertBefore(legs, head || look.parentNode.firstChild);
    // Everything but <defs> goes in one group, so he can be tilted from inside the svg: the svg's own
    // transform belongs to the waddle/hop animations, and to Gravity mode while it runs.
    const body = el('g', { class: 'lr-body' });
    for (const n of [...svg.childNodes]) if (n.nodeName.toLowerCase() !== 'defs') body.append(n);
    svg.append(body);

    // --- Walk cycle, driven by how he actually moves (not a timer): the step phase advances with
    // distance covered, so faster = quicker steps. Going sideways, the legs swing towards where he's
    // heading, the feet point that way and he leans into it; going up or down the page (away from /
    // towards you) he marches, lifting his feet. Standing still, everything settles back.
    const legEls = [...legs.children].map((g) => ({ g, foot: g.querySelector('ellipse'), x: +g.querySelector('ellipse').getAttribute('cx') }));
    let phase = 0, vS = { x: 0, y: 0 }, amt = 0, lean = 0, bob = 0;
    const walkCycle = (dx, dy, dt) => { // dx, dy: how far he moved this frame (px)
      if (dt <= 0) return;
      const k = Math.min(1, dt * 10); // smooth the velocity: knockbacks and waypoint turns are jerky
      vS.x += (dx / dt - vS.x) * k; vS.y += (dy / dt - vS.y) * k;
      const speed = Math.hypot(vS.x, vS.y);
      amt += ((speed > 15 ? Math.min(1, speed / 90) : 0) - amt) * Math.min(1, dt * 8);
      const side = speed > 1 ? vS.x / speed : 0, updown = speed > 1 ? Math.abs(vS.y) / speed : 0;
      const stride = 42 + speed * 0.08; // px of travel per full cycle (two steps)
      const before = phase;
      if (amt > 0.02) phase += speed * dt / stride * Math.PI * 2;
      else phase = 0;
      // a foot comes down each time the phase passes π/2 + nπ (where that leg's lift reaches zero)
      if (amt > 0.3 && Math.floor((phase - Math.PI / 2) / Math.PI) > Math.floor((before - Math.PI / 2) / Math.PI)) sfx.step(amt);
      legEls.forEach((leg, i) => {
        const p = phase + i * Math.PI;
        // rotate(+) is clockwise, which moves a foot below the hip to the left: so negative = forward when going right
        const swing = -side * 28 * Math.sin(p) * amt;
        const lift = Math.max(0, Math.cos(p)) * (3 + 7 * updown) * amt; // the swinging leg lifts its foot
        leg.g.style.transform = `translate(0px, ${(-lift).toFixed(2)}px) rotate(${swing.toFixed(2)}deg)`;
        leg.foot.setAttribute('cx', (leg.x + side * 3 * amt).toFixed(2)); // toes point where he's going
      });
      // (no walking lean during a firework flinch: it's the same rotation and would fight the flinch tilt)
      lean += ((flinch ? 0 : side * 7 * amt) - lean) * Math.min(1, dt * (flinch ? 14 : 6));
      bob = Math.abs(Math.sin(phase)) * 3.5 * amt; // up on each step
      svg.style.rotate = `${lean.toFixed(2)}deg`;
    };

    // Wander around the visible page. The walk uses the `translate` property, so it
    // stacks with the hop's `transform` animation instead of fighting it.
    // `pos` is the offset from where the page put him (his "home").
    //
    // Idle: he runs little routines, each a list of steps: { x, y, speed } walks there, { pause } stands
    // still (optionally hopping or looking around).
    // Chase: when the Space shooter mod says its ship is active (a `tss-ship` event every frame), he
    // homes in on it with momentum, so he overshoots and you can dodge him. He gets a bit faster the
    // longer a chase lasts.
    let pos = { x: 0, y: 0 }, vel = { x: 0, y: 0 }, plan = [], waitUntil = 0, scanning = false;
    let hovering = false, lastMouse = 0, last = 0, ship = null, shipAt = 0, chaseStart = 0;
    addEventListener('pointermove', () => { lastMouse = performance.now(); }, { passive: true });
    svg.addEventListener('pointerenter', () => { hovering = true; });
    svg.addEventListener('pointerleave', () => { hovering = false; });
    addEventListener('tss-ship', (e) => { ship = e.detail; shipAt = performance.now(); });

    const bounds = () => { // where pos may go and still keep him on screen
      const r = svg.getBoundingClientRect();
      const homeX = r.left - pos.x, homeY = r.top - pos.y;
      const vw = document.documentElement.clientWidth, vh = innerHeight;
      return { r, minX: 8 - homeX, maxX: vw - r.width - 8 - homeX, minY: 8 - homeY, maxY: vh - r.height - 30 - homeY }; // 30: room for the feet
    };
    const clampPt = (p, b) => b.maxX <= b.minX || b.maxY <= b.minY ? { ...p, x: pos.x, y: pos.y }
      : { ...p, x: Math.max(b.minX, Math.min(b.maxX, p.x)), y: Math.max(b.minY, Math.min(b.maxY, p.y)) };
    const rnd = (a, b) => a + Math.random() * (b - a);
    const pt = (x, y, speed) => ({ x, y, speed });
    const anywhere = (b, speed) => pt(rnd(b.minX, b.maxX), rnd(b.minY, b.maxY), speed);

    const ROUTINES = [ // [weight, make(bounds) → steps]
      [3, (b) => [anywhere(b, rnd(60, 110))]], // stroll
      [1.5, (b) => [{ pause: 250, hop: true }, { pause: 550 }, anywhere(b, 280)]], // hop, then dash
      [2, () => { // loop-the-loop, once or twice
        const R = rnd(50, 130), dir = Math.random() < 0.5 ? 1 : -1, a0 = rnd(0, Math.PI * 2), n = Math.random() < 0.4 ? 48 : 24;
        const cx = pos.x - Math.cos(a0) * R, cy = pos.y - Math.sin(a0) * R;
        return Array.from({ length: n }, (_, i) => { const a = a0 + dir * (i + 1) / 24 * Math.PI * 2; return pt(cx + Math.cos(a) * R, cy + Math.sin(a) * R, 130); });
      }],
      [1.5, () => { // figure eight
        const R = rnd(90, 170), cx = pos.x, cy = pos.y;
        return Array.from({ length: 40 }, (_, i) => { const t = (i + 1) / 40 * Math.PI * 2; return pt(cx + Math.sin(t) * R, cy + Math.sin(2 * t) * R * 0.4, 140); });
      }],
      [1.5, (b) => { // zigzag somewhere
        const to = anywhere(b), dx = to.x - pos.x, dy = to.y - pos.y, d = Math.hypot(dx, dy) || 1, n = 6;
        return Array.from({ length: n }, (_, i) => {
          const f = (i + 1) / n, side = i === n - 1 ? 0 : (i % 2 ? -1 : 1) * rnd(40, 80);
          return pt(pos.x + dx * f - dy / d * side, pos.y + dy * f + dx / d * side, 150);
        });
      }],
      [1.2, () => { // pace back and forth like a sentry
        const w = rnd(80, 160), steps = [];
        for (let i = 0; i < 3; i++) steps.push(pt(pos.x + w, pos.y, 100), { pause: 350 }, pt(pos.x - w, pos.y, 100), { pause: 350 });
        return [...steps, pt(pos.x, pos.y, 100)];
      }],
      [1, (b) => [ // peek: go to a side of the screen and look around
        pt(Math.random() < 0.5 ? b.minX : b.maxX, pos.y, 120), { pause: 2000, scan: true }, anywhere(b, 90)]],
      [1, () => { // spiral outwards
        const dir = Math.random() < 0.5 ? 1 : -1;
        return Array.from({ length: 36 }, (_, i) => { const a = dir * (i + 1) * 0.45, R = (i + 1) * 6; return pt(pos.x + Math.cos(a) * R, pos.y + Math.sin(a) * R, 130); });
      }],
      [1, () => [{ pause: 200, hop: true }, { pause: 650, hop: true }, { pause: 650, hop: true }, { pause: 700 }]], // hop dance
      [0.8, () => [pt(0, 0, 90)]], // go home
    ];
    const nextRoutine = (b) => {
      let w = Math.random() * ROUTINES.reduce((s, [k]) => s + k, 0);
      const [, make] = ROUTINES.find(([k]) => (w -= k) < 0) || ROUTINES[0];
      return [...make(b).map((s) => (s.pause == null ? clampPt(s, b) : s)), { pause: rnd(600, 2500) }];
    };

    const lookAt = (ux, uy, force) => {
      if (force || performance.now() - lastMouse > 1500) // nobody's moving the mouse: look where he's going
        wrap.style.transform = `translate(${(ux * MAX_LOOK * 0.8).toFixed(2)}px, ${(uy * MAX_LOOK * 0.8).toFixed(2)}px)`;
    };

    // Now and then, when he stops to consider (a pause of half a second or more, not a hop), a happy
    // little murmur a moment after he's stopped: about one stop in three, never within 6 s of the last.
    let lastMurmur = 0, murmurTimer = 0, lastSaid = null;
    const murmur = (now) => {
      if (now - lastMurmur < 6000 || Math.random() > 0.35) return;
      lastMurmur = now;
      clearTimeout(murmurTimer);
      murmurTimer = setTimeout(() => {
        if (chasing || svg.hasAttribute('data-tss-dead')) return; // (he's busy, or blown up)
        // never the same one twice in a row: one of the other two
        const choices = ['hum', 'hmhm', 'brrup'].filter((m) => m !== lastSaid);
        lastSaid = choices[Math.floor(Math.random() * choices.length)];
        sfx.notice(lastSaid);
      }, 250 + Math.random() * 300);
    };
    const wander = (now, dt, b) => { // → is he walking?
      if (hovering || svg.classList.contains('lr-hop') || now < waitUntil) {
        if (scanning) lookAt(Math.sin(now / 280), Math.sin(now / 900) * 0.3);
        return false;
      }
      scanning = false;
      if (!plan.length) plan = nextRoutine(b);
      const s = plan[0];
      if (s.pause != null) {
        plan.shift();
        waitUntil = now + s.pause;
        scanning = !!s.scan;
        if (s.hop) hop();
        else if (s.pause >= 500) murmur(now); // stopping to consider
        return false;
      }
      const dx = s.x - pos.x, dy = s.y - pos.y, d = Math.hypot(dx, dy);
      let move = s.speed * dt;
      move *= faster();
      if (d <= move) { pos.x = s.x; pos.y = s.y; plan.shift(); return true; }
      pos.x += dx / d * move; pos.y += dy / d * move;
      lookAt(dx / d, dy / d);
      return true;
    };

    const chase = (now, dt, b) => {
      if (!chasing) { // spotted it: alert hop, then go
        chasing = true; chaseStart = now; plan = []; scanning = false; vel = { x: 0, y: 0 };
        hop('notice'); // (his robot voice instead of the boing)
      }
      const cx = b.r.left + b.r.width / 2, cy = b.r.top + b.r.height / 2;
      const dx = ship.x - cx, dy = ship.y - cy, d = Math.hypot(dx, dy) || 1;
      lookAt(dx / d, dy / d, true);
      if (svg.classList.contains('lr-hop')) return false;
      const max = Math.min(280, 170 + (now - chaseStart) / 1000 * 6) * faster(), ACCEL = 420 * faster(); // px/s, px/s²
      vel.x += dx / d * ACCEL * dt; vel.y += dy / d * ACCEL * dt;
      const sp = Math.hypot(vel.x, vel.y);
      if (sp > max) { vel.x *= max / sp; vel.y *= max / sp; }
      const p = clampPt({ x: pos.x + vel.x * dt, y: pos.y + vel.y * dt }, b);
      if (p.x !== pos.x + vel.x * dt) vel.x = 0; // hit a screen edge
      if (p.y !== pos.y + vel.y * dt) vel.y = 0;
      pos.x = p.x; pos.y = p.y;
      return true;
    };

    // --- Damage is Space shooter's (health, colours, hit flash, the explosion all live there, so they
    // work without this mod). It marks the svg with `data-tss-hp` (0–100) and `data-tss-dead`. Here
    // he just reacts: faster as he's hurt (twice as fast by the end), knocked back by each hit, frozen
    // while destroyed, and back home with a hop when the shooter rebuilds him (`tss-restore`).
    const hpLeft = () => { const hp = parseFloat(svg.getAttribute('data-tss-hp')); return Number.isFinite(hp) ? hp : 100; };
    // How much his damage drives him on. Normal mode: up to 3× his speed near death. Gravity mode: every
    // damage-driven boost (speed, bomb reactions, jump height) tops out at 80% of what it'd be at full rage.
    const HURT_SPEED = 2, GRAVITY_RAGE = 0.8;
    const rage = () => (100 - hpLeft()) / 100 * (inGravity() ? GRAVITY_RAGE : 1);
    const faster = () => 1 + rage() * (inGravity() ? 1 : HURT_SPEED);
    const isDead = () => svg.hasAttribute('data-tss-dead');
    addEventListener('tss-robot-hit', () => { if (!isDead()) pos.y -= 4; }); // knocked back
    addEventListener('tss-restore', (e) => {
      try {
        if (!e.detail?.robotRebuilt) return;
        pos = { x: 0, y: 0 }; vel = { x: 0, y: 0 }; plan = []; chasing = false;
        svg.style.translate = '';
        waitUntil = performance.now() + 800;
        hop();
      } catch (err) { window.trif?.warn(String(err)); }
    });

    // --- Gravity mode (G). The Gravity mode mod turns him into a physics piece that stays upright and
    // that we steer: `lr-walk` { vx, jump } out, `gm-walker` { x, y, vx, supported, … } back each frame.
    // He can only walk left and right; he hops when something blocks him (and now and then for fun),
    // and jumps at the ship when it's just above him. Jumping into words shoves them up.
    let gw = null, gwAt = 0, gTarget = null, gPauseUntil = 0, blockedFor = 0, nextHop = 0, stuckHops = 0, wasGravity = false;
    addEventListener('gm-walker', (e) => { gw = e.detail; gwAt = performance.now(); });
    // when gravity ends, Gravity mode leaves him where he stands and says where that is
    let released = null;
    addEventListener('gm-walker-release', (e) => {
      const { dx, dy } = e.detail || {};
      if (Number.isFinite(dx) && Number.isFinite(dy)) released = { x: dx, y: dy };
    });
    const inGravity = () => document.documentElement.hasAttribute('data-gm-on') && svg.hasAttribute('data-gm-body');
    // The most urgent bomb (from Space shooter's `tss-ship` event) that will come down on his head
    // within his reaction time, and which way to run: { dir: ±1, t } or null.
    const bombThreat = (now, dmg, W) => {
      const bombs = ship && now - shipAt < 300 ? ship.bombs : null;
      if (!bombs?.length) return null;
      const g = ship.bombGravity || 1800, top = gw.y - gw.h / 2;
      const reaction = 0.3 + 0.9 * dmg, margin = gw.w / 2 + 30 + 40 * dmg; // s; px either side of him
      let best = null;
      for (const b of bombs) {
        const c = b.y - top;
        if (c >= 0) continue; // already level with or below his head
        const t = (-b.vy + Math.sqrt(b.vy * b.vy - 2 * g * c)) / g; // when it reaches head height
        if (!(t > 0) || t > reaction) continue;
        const land = b.x + b.vx * t;
        if (Math.abs(land - gw.x) > margin) continue;
        if (best && best.t <= t) continue;
        let dir = Math.sign(gw.x - land) || (gw.x < W / 2 ? 1 : -1);
        if (gw.x + dir * gw.w > W || gw.x + dir * gw.w < 0) dir = -dir; // cornered: dash the other way
        best = { dir, t };
      }
      return best;
    };
    // Gravity mode landings: a footstep when he comes down on something after being in the air a moment,
    // as hard as he was falling
    let airborneSince = 0, fallSpeed = 0;
    const landing = (now) => {
      if (!gw) return;
      if (!gw.supported) {
        if (!airborneSince) airborneSince = now;
        fallSpeed = Math.max(fallSpeed, gw.vy || 0);
      } else {
        if (airborneSince && now - airborneSince > 150 && fallSpeed > 150) sfx.step(Math.min(1, fallSpeed / 900));
        airborneSince = 0; fallSpeed = 0;
      }
    };
    const gravityStep = (now, dt) => {
      landing(now);
      wasGravity = true; plan = [];
      // gravity positions him itself: drop our offset (Gravity mode hands back where he ends up)
      if (pos.x || pos.y) { pos = { x: 0, y: 0 }; svg.style.translate = ''; }
      // Gravity mode isn't driving him: not yet, or it's flying the page home (keep `chasing` as it was)
      if (!gw || now - gwAt > 300) return;
      const shipActive = ship && ship.active && now - shipAt < 500;
      // `chasing` carries over when gravity ends, so a chase in progress continues without the
      // surprised hop (that's only for spotting the ship from a standstill)
      if (shipActive && !chasing) { chaseStart = now; sfx.notice(noticeLine()); } // he's noticed you
      chasing = !!shipActive;
      const W = document.documentElement.clientWidth;
      let want = 0, jump = 0, kick = 0; // kick: set his sideways speed outright, once
      if (gw.held) { /* being dragged around: just dangle */ }
      else if (shipActive) {
        const dx = ship.x - gw.x, dy = ship.y - gw.y, d = Math.hypot(dx, dy) || 1;
        want = Math.abs(dx) > 20 ? Math.sign(dx) * 230 * faster() : 0;
        lookAt(dx / d, dy / d, true);
        if (gw.supported && now > nextHop && dy < -gw.h / 2 - 30 && Math.abs(dx) < 140) jump = 900; // leap at it
      } else {
        if (now < gPauseUntil) want = 0;
        else {
          if (gTarget == null) gTarget = rnd(60, Math.max(61, W - 60));
          const dx = gTarget - gw.x;
          if (Math.abs(dx) < 15) { gTarget = null; gPauseUntil = now + rnd(500, 2500); }
          else want = Math.sign(dx) * 100 * faster();
        }
        if (want) lookAt(Math.sign(want), 0);
        if (gw.supported && now > nextHop && Math.random() < dt * 0.2) jump = 550; // a happy little hop
      }
      // A firework went off near him: run sideways away from it, with a startled hop (bombs still win)
      const gsu = scare ? (now - scare.t0) / 1000 / scare.tau : Infinity;
      if (gsu < 7 && !gw.held) {
        const dir = Math.sign(scare.ux) || (gw.x < W / 2 ? 1 : -1);
        // his sideways speed is set outright to the spring curve every frame (in step with the tilt;
        // steering alone lags, and barely works in the air)
        const v = dir * Math.abs(scare.ux) * scare.D / scare.tau * gsu * Math.exp(-gsu);
        want = v; kick = v || 0.001 * dir;
        lookAt(-dir * 0.8, -0.4, true); // glancing back at it
        if (scare.hop && gw.supported) { jump = scare.hopV; scare.hop = false; }
      }
      // Bombs: run out from under any that will land on him. The more hurt he is, the earlier he
      // reacts and the faster he runs (at full health he only notices at the last moment).
      const dmg = rage(); // (scaled to GRAVITY_RAGE in gravity)
      const threat = gw.held ? null : bombThreat(now, dmg, W);
      if (threat) {
        want = threat.dir * 160 * faster() * (1 + 0.5 * dmg);
        lookAt(-threat.dir * 0.5, -1, true); // eyes up at it
        jump = 0;
      }
      // blocked: trying to walk but not getting anywhere → hop over it; give up after a few tries
      if (gw.supported && Math.abs(want) > 40 && Math.abs(gw.vx) < 20) blockedFor += dt; else blockedFor = 0;
      if (blockedFor > 0.15 && now > nextHop) {
        jump = 650; blockedFor = 0;
        if (++stuckHops > 3 && !shipActive) { gTarget = null; stuckHops = 0; } // turn around and try elsewhere
      } else if (Math.abs(gw.vx) > 60) stuckHops = 0;
      if (jump) nextHop = now + 450;
      jump *= Math.sqrt(1 + 1.5 * dmg); // hurt, he jumps higher (up to 2.5× as high)
      if (jump && gw.supported) sfx.boing(jump / 900); // (Gravity mode only jumps him from something solid)
      if (!gw.held) want += tilt().x * SLIDE_GRAVITY; // the card's tilt pushes him along the floor
      dispatchEvent(new CustomEvent('lr-walk', { detail: { vx: want, jump, kick } }));
      walkCycle(gw.supported ? gw.vx * dt : 0, 0, dt); // legs only move while he's on something
    };

    // --- Fireworks (the Fireworks mod sends `firework-burst` { x, y, radius } in window coordinates).
    // One going off near him makes him flinch: a quick little step away (sideways with a startled hop in
    // gravity mode), a lean away from it, and scared eyes for a moment, all stronger the closer it was.
    // --- Sliding with the Tilt card: it sets --tc-ry / --tc-rx on <html> (the card's tilt, up to ±24°,
    // following the mouse); he slides toward where the card dips, i.e. toward the mouse side.
    const TILT_MAX = 24, SLIDE_ACCEL = 420, SLIDE_FRICTION = 2, SLIDE_GRAVITY = 140; // px/s², 1/s, px/s
    const slide = { x: 0, y: 0 };
    const tilt = () => {
      const s = document.documentElement.style;
      const ry = parseFloat(s.getPropertyValue('--tc-ry')) || 0, rx = parseFloat(s.getPropertyValue('--tc-rx')) || 0;
      const k = (v) => Math.max(-1, Math.min(1, v / TILT_MAX));
      return { x: k(ry), y: k(-rx) };
    };
    const FLINCH_STRENGTH = 1.5; // scales the whole reaction (step, lean, hop, eyes); timing is separate
    let scare = null; // see the listener below
    let flinch = null;
    const eyeEls = [...svg.querySelectorAll('.lr-eye')];
    const updateFlinch = (now) => {
      let a = 0, jolt = 0, fear = 0;
      if (flinch) {
        const t = (now - flinch.t0) / 1000;
        if (t > Math.max(flinch.tau * 9, flinch.dur)) flinch = null;
        else {
          // lean rides the spring's g(t) (see the firework listener): over, a stop at the peak at τ,
          // then easing back, in step with his movement
          const u = t / flinch.tau;
          a = flinch.lean * u * Math.exp(1 - u);
          // the startle jolt: up suddenly (an ease-out to full height in 40 ms, arriving without a snap),
          // then back down along the spring's falling half, the same easing the lean and step settle with
          const RISE = 0.04;
          if (t < RISE) { const p = t / RISE; jolt = flinch.jolt * (1 - (1 - p) * (1 - p)); }
          else { const ud = 1 + (t - RISE) / flinch.tau; jolt = flinch.jolt * ud * Math.exp(1 - ud); }
        }
        // eyes: pop wide in 60 ms, hold briefly, then ease smoothly back (a cosine) by `dur`
        if (flinch && t < flinch.dur) {
          const hold = flinch.dur * 0.18;
          const env = t < 0.06 ? t / 0.06 : t < hold ? 1 : 0.5 + 0.5 * Math.cos(Math.PI * (t - hold) / (flinch.dur - hold));
          fear = flinch.eyes * env;
        }
      }
      const v = Math.abs(a) > 0.01 || jolt > 0.05 ? `translate(0px, ${(-jolt).toFixed(2)}px) rotate(${a.toFixed(2)}deg)` : '';
      if (body.style.transform !== v) body.style.transform = v;
      // wide (tall and narrow) eyes, in proportion to the fear (no random tremble: it read as glitchy)
      const e = fear > 0.005 ? `scale(${(1 - 0.28 * fear).toFixed(3)}, ${(1 + 0.5 * fear).toFixed(3)})` : '';
      for (const el of eyeEls) if (el.style.transform !== e) el.style.transform = e;
    };
    addEventListener('firework-burst', (e) => {
      try {
        if (isDead()) return;
        const { x, y, radius } = e.detail || {};
        if (![x, y, radius].every(Number.isFinite)) return;
        const r = svg.getBoundingClientRect();
        if (!r.width) return;
        const dx = r.left + r.width / 2 - x, dy = r.top + r.height / 2 - y, d = Math.hypot(dx, dy);
        // fear, by the inverse-square law: full (1) within `near` of him, then (near / distance)², so a
        // burst twice as far scares him a quarter as much, and even distant ones get a little twitch.
        // Everything (step, tilt, hop, eyes, how long it lasts) scales with it.
        const near = r.width / 2 + radius * 0.2;
        const k = Math.min(1, (near / Math.max(d, 1)) ** 2);
        if (k < 0.015) return; // too faint to see
        const side = Math.random() < 0.5 ? -1 : 1, now = performance.now();
        // Which way to step: straight away from it, but always with a clear sideways part, so a burst
        // right above or below him (or him being pressed against the top or bottom of the window)
        // still gets a dodge to one side rather than a stalled bob up and down.
        // (the true direction, rx/ry, drives the lean and crouch; the step gets a small sideways floor)
        const rx = d > 1 ? dx / d : 0, ry = d > 1 ? dy / d : 0;
        let ux = rx || side * 0.25, uy = ry;
        if (Math.abs(ux) < 0.25) {
          ux = (Math.sign(ux) || side) * 0.25;
          uy = Math.sign(uy) * Math.sqrt(1 - ux * ux);
        }
        // One motion, one clock: a critically damped spring knocked by the bang. His lean is
        // A·g(t) with g = (t/τ)·e^(1 − t/τ), and his speed away follows the same g (so he's fastest when
        // leaning most, and stops as he comes upright); his distance is its integral,
        // D·(1 − (1 + t/τ)·e^(−t/τ)). Closer bangs: bigger (D up to ~90 px, lean up to ~22°) and a bit longer.
        const tau = 0.09 + 0.05 * k, S = FLINCH_STRENGTH;
        scare = { ux, uy, bx: x, by: y, D: (8 + 85 * k) * S, tau, t0: now, off: 0, hop: k > 0.25, hopV: 380 * k * Math.sqrt(S) };
        // Lean away in proportion to how much the bang is to the side (rx: ±1 level with him, 0 straight
        // above or below). Whatever the direction, a startle: a sudden jolt upward that eases back down.
        // Plus wide, trembling eyes, for a moment.
        flinch = { lean: rx * (4 + 18 * k) * S, jolt: (2 + 10 * k) * S,
          k, eyes: Math.min(1.6, k * S), tau, t0: now, dur: 0.35 + 0.55 * k };
      } catch (err) { window.trif?.warn(String(err)); }
    });

    const step = (t) => {
      try {
        const now = performance.now();
        const dt = Math.min(0.05, (t - (last || t)) / 1000);
        last = t;
        if (isDead()) { // destroyed: stand still (he's hidden) until rebuilt
          chasing = false; plan = [];
          svg.classList.remove('lr-walking');
          requestAnimationFrame(step);
          return;
        }
        updateFlinch(now);
        if (inGravity()) { gravityStep(now, dt); requestAnimationFrame(step); return; }
        if (wasGravity) { // gravity's over: carry on from where it left him (or from home, if it didn't say)
          // still chasing: keep going with the speed he had (no pause, no surprised hop)
          vel = chasing && gw ? { x: gw.vx || 0, y: 0 } : { x: 0, y: 0 };
          if (!chasing) waitUntil = now + 800;
          wasGravity = false; gw = null; gTarget = null;
          pos = released || { x: 0, y: 0 }; released = null;
          plan = [];
        }
        const b = bounds();
        const shipActive = ship && ship.active && now - shipAt < 500; // stale = shooter switched off
        if (!shipActive && chasing) { // lost it: catch his breath, then wander again
          chasing = false; plan = []; waitUntil = now + 1200; blink();
        }
        const before = { x: pos.x, y: pos.y };
        let walking;
        const su = scare ? (now - scare.t0) / 1000 / scare.tau : Infinity;
        if (su < 7) { // flinching away from a firework, on the spring curve (in step with the tilt)
          const off = scare.D * (1 - (1 + su) * Math.exp(-su)), step = off - scare.off;
          scare.off = off;
          const p = clampPt({ x: pos.x + scare.ux * step, y: pos.y + scare.uy * step }, b);
          pos.x = p.x; pos.y = p.y;
          const lx = scare.bx - (b.r.left + b.r.width / 2), ly = scare.by - (b.r.top + b.r.height / 2), ld = Math.hypot(lx, ly) || 1;
          lookAt(lx / ld, ly / ld, true); // wide eyes on the thing that went bang
          plan = [];
          const v = scare.D / scare.tau * su * Math.exp(-su);
          if (chasing) vel = { x: scare.ux * v, y: scare.uy * v }; // the chase picks up from here
          walking = true;
        } else {
          if (scare) { scare = null; if (!chasing) waitUntil = now + 500; } // a moment to collect himself
          walking = shipActive ? chase(now, dt, b) : wander(now, dt, b);
        }
        svg.classList.toggle('lr-walking', walking);
        // sliding down the tilted card (Tilt card): it builds up with the tilt, friction bleeds it off
        const tl = tilt();
        slide.x = (slide.x + tl.x * SLIDE_ACCEL * dt) * Math.exp(-SLIDE_FRICTION * dt);
        slide.y = (slide.y + tl.y * SLIDE_ACCEL * dt) * Math.exp(-SLIDE_FRICTION * dt);
        if (Math.abs(slide.x) + Math.abs(slide.y) > 0.5) {
          const want = { x: pos.x + slide.x * dt, y: pos.y + slide.y * dt }, p = clampPt(want, b);
          if (p.x !== want.x) slide.x = 0; // against the edge of the window: stop sliding that way
          if (p.y !== want.y) slide.y = 0;
          pos.x = p.x; pos.y = p.y;
        }
        // a jump (rebuilt and sent home) isn't a step
        const mx = pos.x - before.x, my = pos.y - before.y, jump = Math.hypot(mx, my) > 60;
        walkCycle(jump ? 0 : mx, jump ? 0 : my, dt);
        svg.style.translate = `${pos.x.toFixed(1)}px ${(pos.y - bob).toFixed(1)}px`;
      } catch (e) { window.trif?.warn(String(e)); plan = []; }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    window.trif?.log('robot is alive');
    return true;
  };

  if (!setup()) {
    const mo = new MutationObserver(() => { if (setup()) mo.disconnect(); });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => mo.disconnect(), 15000);
  }
})();
