/* Awalé — the 30-second promo film.

   render(ctx, t) draws the frame at t seconds and carries no state from one
   frame to the next: the camera, every seed, every word and every glow is a
   function of time. That is what lets the studio scrub, loop and export at any
   size and frame rate, and get the same film every time.

   The soundtrack is built the same way — a list of timed cues rendered in an
   OfflineAudioContext — so picture and sound cannot drift apart.

   Classic script (no modules) so the page also works opened from disk. */
(function (global) {
  'use strict';

  const DURATION = 30;

  /* ================================================================ math */
  const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
  const lerp = (a, b, t) => a + (b - a) * t;
  const prog = (t, a, b) => clamp((t - a) / (b - a));
  const TAU = Math.PI * 2;
  const E = {
    lin: x => x,
    inQuad: x => x * x,
    outQuad: x => 1 - (1 - x) * (1 - x),
    inCubic: x => x * x * x,
    outCubic: x => 1 - Math.pow(1 - x, 3),
    inOutCubic: x => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
    outQuint: x => 1 - Math.pow(1 - x, 5),
    inOutQuint: x => (x < 0.5 ? 16 * Math.pow(x, 5) : 1 - Math.pow(-2 * x + 2, 5) / 2),
    outExpo: x => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)),
    inOutSine: x => -(Math.cos(Math.PI * x) - 1) / 2,
    outBack: x => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); },
  };
  /** 0 before a, eases to 1 over `fi`, holds, eases back to 0 over `fo` ending at b. */
  function env(t, a, b, fi = 0.3, fo = 0.3) {
    if (t <= a || t >= b) return 0;
    return Math.min(E.outCubic(prog(t, a, a + fi)), fo > 0 ? 1 - E.inCubic(prog(t, b - fo, b)) : 1);
  }
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // Same mixer as src/components/Seeds.tsx, so stones get the app's colours.
  function hash(n) {
    let x = (n ^ 0x9e3779b9) >>> 0;
    x = Math.imul(x ^ (x >>> 15), 0x85ebca6b) >>> 0;
    x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
    return (x ^ (x >>> 16)) >>> 0;
  }
  const h01 = n => hash(n) / 4294967296;

  function mkCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }
  function rrect(g, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  /* ============================================================= palette */
  // The app's own wood theme (src/styles.css), so the film and the game match.
  const C = {
    gold: '#d4a845', goldSoft: '#e6c988', ivory: '#f4ead2', title: '#efe4cd',
    pit: '#3a2110', green: '#4e7a3a', greenHi: '#8fd08a',
  };
  const STONES = {
    green: ['#a7d288', '#6e9a54', '#3f6030'],
    ivory: ['#fbf4e2', '#e5d4b0', '#b39d74'],
    gold: ['#f4d488', '#d4a845', '#98701f'],
    brown: ['#9a6b44', '#6d4423', '#3f2612'],
  };
  const STONE_NAMES = ['green', 'ivory', 'gold', 'brown'];
  const FONT = {
    serif: '"Cormorant Garamond", "Iowan Old Style", "Palatino Linotype", Georgia, serif',
    sans: '"Manrope", "Segoe UI", "Helvetica Neue", Arial, sans-serif',
  };

  /* ================================================================ copy */
  const COPY = {
    en: {
      hook: [['48', ' seeds.'], ['12', ' pits.'], ['One', ' winner.']],
      tagline: 'The strategy. The culture. The legacy.',
      sow: 'Sow.', sowSub: 'Pick a pit. Its seeds go one by one, counterclockwise.',
      ff: 'Fast-forward',
      capture: 'Capture.', captureSub: 'End on 2 or 3 in their row and take them, chain and all.',
      win: 'First to 25 wins.', winSub: 'Pure strategy. No luck.',
      ai: ['PLAY VS AI', 'Challenge the AI', 'Four levels, from Novice to Master.'],
      levels: ['Novice', 'Skilled', 'Expert', 'Master'],
      online: ['PLAY ONLINE', 'Play the world', 'Invite a friend by link, or get a quick match.'],
      nation: ['NATIONS', 'Win for your country', 'Every rated win abroad scores 3 points for your nation.'],
      h2h: 'Head to head', ci: 'Côte d’Ivoire', fr: 'France',
      ranks: ['LEADERBOARD', 'Climb the ranks', 'Rated online games. Public profiles.'],
      you: 'You', rating: 'Rating',
      learn: ['LEARN', 'Learn in minutes', 'Guided tutorial, move preview, hints.'],
      lands: 'Lands here', hint: 'Hint', puzzles: '12 challenges',
      anywhere: ['NO DOWNLOAD NEEDED', 'Play anywhere', 'In your browser. Installable. Works offline.'],
      langs: 'English · Français',
      menu: [['QUICK MATCH', 'Instant game at your level'], ['PLAY ONLINE', 'A real opponent, anywhere'], ['PLAY VS AI', 'Choose difficulty'], ['LEARN', 'Interactive tutorial']],
      cta: 'Play now',
    },
    fr: {
      hook: [['48', ' graines.'], ['12', ' trous.'], ['Un seul', ' vainqueur.']],
      tagline: 'La stratégie. La culture. L’héritage.',
      sow: 'Semez.', sowSub: 'Choisissez un trou : ses graines partent une à une, dans le sens antihoraire.',
      ff: 'Accéléré',
      capture: 'Capturez.', captureSub: 'Finissez sur 2 ou 3 chez l’adversaire et prenez-les, en chaîne.',
      win: '25 graines pour gagner.', winSub: 'Stratégie pure. Aucun hasard.',
      ai: ['JOUER CONTRE L’IA', 'Défiez l’IA', 'Quatre niveaux, de Novice à Maître.'],
      levels: ['Novice', 'Confirmé', 'Expert', 'Maître'],
      online: ['JOUER EN LIGNE', 'Jouez avec le monde', 'Invitez un ami par lien, ou lancez une partie rapide.'],
      nation: ['NATIONS', 'Gagnez pour votre pays', 'Chaque victoire classée à l’étranger rapporte 3 points à votre nation.'],
      h2h: 'Face-à-face', ci: 'Côte d’Ivoire', fr: 'France',
      ranks: ['CLASSEMENT', 'Grimpez au classement', 'Parties en ligne classées. Profils publics.'],
      you: 'Vous', rating: 'Classement',
      learn: ['APPRENDRE', 'Apprenez en quelques minutes', 'Tutoriel guidé, aperçu des coups, indices.'],
      lands: 'Arrive ici', hint: 'Indice', puzzles: '12 défis',
      anywhere: ['SANS TÉLÉCHARGEMENT', 'Jouez partout', 'Dans le navigateur. Installable. Hors ligne.'],
      langs: 'English · Français',
      menu: [['PARTIE RAPIDE', 'Une partie à votre niveau'], ['JOUER EN LIGNE', 'Un vrai adversaire, où qu’il soit'], ['JOUER CONTRE L’IA', 'Choisir la difficulté'], ['APPRENDRE', 'Tutoriel interactif']],
      cta: 'Jouez maintenant',
    },
  };

  /* ============================================================ timeline */
  const CHAPTERS = [
    { id: 'hook', label: 'Hook', at: 0 },
    { id: 'title', label: 'Title', at: 4 },
    { id: 'rules', label: 'Rules', at: 7 },
    { id: 'ai', label: 'AI', at: 14 },
    { id: 'online', label: 'Online', at: 16 },
    { id: 'ranks', label: 'Ranks', at: 19 },
    { id: 'learn', label: 'Learn', at: 21 },
    { id: 'anywhere', label: 'Anywhere', at: 23 },
    { id: 'play', label: 'Play', at: 26 },
  ];
  const T = {
    heroLand: 1.0, title: 4.0, rules: 7.0, ai: 14.0, online: 16.0, nation: 17.5,
    ranks: 19.0, learn: 21.0, anywhere: 23.0, cta: 26.0,
  };

  /* ============================================================ geometry */
  // World units: one pit spacing = 1. x runs along the board, y across it
  // (South's row at -y, North's at +y), z up. Pit indices 0 → 11 run
  // counterclockwise seen from above, exactly as src/lib/layout.ts requires.
  const PIT_R = 0.4;
  const SEED_R = 0.078;
  const BOARD = { hw: 4.18, hh: 1.28, r: 1.02, thick: 0.3 };
  const STORE = [{ x: -3.56, y: 0 }, { x: 3.56, y: 0 }];   // South's store left, North's right
  const STORE_HW = 0.33, STORE_HH = 1.0;
  const pitPos = i => (i < 6 ? { x: -2.5 + i, y: -0.56 } : { x: 2.5 - (i - 6), y: 0.56 });

  function pitSlot(p, k, n) {
    const c = pitPos(p);
    const layer = Math.floor(k / 9), kk = k % 9, nn = Math.min(9, n - layer * 9);
    const a = kk * 2.399963 + layer * 1.3 + p * 0.9;
    const r = nn <= 1 ? 0 : 0.205 * Math.sqrt((kk + 0.5) / nn);
    const h = hash(p * 131 + k * 17);
    const jx = ((h % 100) / 100 - 0.5) * 0.03, jy = ((hash(h) % 100) / 100 - 0.5) * 0.03;
    return { x: c.x + Math.cos(a) * r + jx, y: c.y + Math.sin(a) * r + jy, z: SEED_R * 0.75 + layer * SEED_R * 1.05 };
  }
  function storeSlot(side, k) {
    const s = STORE[side];
    const layer = Math.floor(k / 33), kk = k % 33;
    const col = kk % 3, row = Math.floor(kk / 3);
    const h = hash(side * 977 + k * 29);
    const jx = ((h % 100) / 100 - 0.5) * 0.025, jy = ((hash(h) % 100) / 100 - 0.5) * 0.025;
    return { x: s.x + (col - 1) * 0.165 + jx, y: -0.84 + row * 0.168 + jy, z: SEED_R * 0.75 + layer * SEED_R };
  }

  /* ========================================================== the game */
  // A real game, found with the app's own engine (src/lib/engine.ts + ai.ts)
  // and replayed below with the same sowing and capture rules: South wins
  // 26–0 in 13 moves, the last one a five-pit chain capture.
  const GAME = [5, 10, 0, 9, 4, 8, 2, 7, 1, 11, 4, 6, 5];

  /* ======================================================== choreography */
  // Every seed gets a list of keyframes; seedPos(seed, t) interpolates them.
  function compile() {
    const seeds = [];
    for (let id = 0; id < 48; id++) seeds.push({ id, color: STONE_NAMES[hash(id * 7 + 3) % 4], kf: [] });
    const pits = Array.from({ length: 12 }, () => []);
    const stores = [[], []];
    const ev = [];
    const last = s => s.kf[s.kf.length - 1];
    function key(s, t, p, m, h, sp) {
      const l = last(s);
      if (l && t < l.t) t = l.t;
      s.kf.push({ t, x: p.x, y: p.y, z: p.z, m: m || 'lin', h: h || 0, sp: sp || 0 });
    }
    function move(s, t0, t1, p, m, h, sp) {
      const l = last(s);
      if (l) {
        if (t0 < l.t) { const d = l.t - t0; t0 += d; t1 += d; }
        if (t0 > l.t) key(s, t0, l);
      }
      key(s, t1, p, m, h, sp);
    }
    function relayout(p, t, dur) {
      const list = pits[p], n = list.length;
      list.forEach((id, k) => move(seeds[id], t, t + (dur || 0.16), pitSlot(p, k, n), 'lin'));
    }

    // ---- hook: one seed falls, then the other 47 pour in -----------------
    const HERO = 3;
    const heroId = HERO * 4;
    const hc = pitPos(HERO);
    {
      const s = seeds[heroId];
      key(s, 0, { x: hc.x + 0.04, y: hc.y + 0.06, z: 2.4 });
      key(s, 0.25, last(s));
      pits[HERO].push(heroId);
      // contact at 1.0, then a small bounce that settles by 1.22
      key(s, 1.22, pitSlot(HERO, 0, 1), 'drop', 0.13, 0.75 / 0.97);
      ev.push({ type: 'hero', t: T.heroLand, p: HERO });
    }
    const rest = [];
    for (let id = 0; id < 48; id++) {
      if (id === heroId) continue;
      const p = id >> 2, c = pitPos(p);
      const d = Math.hypot(c.x - hc.x, (c.y - hc.y) * 1.5);
      rest.push({ id, p, order: d * 0.3 + h01(id * 13 + 5) * 0.85 });
    }
    rest.sort((a, b) => a.order - b.order);
    rest.forEach((a, i) => { a.t = 1.36 + (i / (rest.length - 1)) * 1.86 + (h01(a.id * 3 + 1) - 0.5) * 0.06; });
    rest.sort((a, b) => a.t - b.t);
    for (const a of rest) {
      const s = seeds[a.id];
      pits[a.p].push(a.id);
      const n = pits[a.p].length;
      const slot = pitSlot(a.p, n - 1, n);
      const fall = 0.5 + h01(a.id * 5) * 0.12, bounce = 0.14;
      const sky = { x: slot.x + (h01(a.id * 7) - 0.5) * 0.5, y: slot.y + (h01(a.id * 11) - 0.5) * 0.5, z: 4.2 + h01(a.id * 17) * 2.2 };
      key(s, 0, sky);
      key(s, a.t - fall, sky);
      key(s, a.t + bounce, slot, 'drop', 0.05 + h01(a.id) * 0.05, fall / (fall + bounce));
      relayout(a.p, a.t + 0.02);
      ev.push({ type: 'rain', t: a.t, p: a.p, n });
    }

    // ---- the game ---------------------------------------------------------
    function ply(src, T0, o) {
      const me = src < 6 ? 0 : 1, other = 1 - me;
      const list = pits[src].splice(0), n = list.length;
      const c = pitPos(src);
      ev.push({ type: 'lift', t: T0, p: src, n, fast: o.fast, who: me });
      list.forEach((id, k) => {
        const a = k * 2.4, r = 0.04 + 0.022 * k;
        move(seeds[id], T0, T0 + o.lift, { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r, z: 0.42 + k * 0.045 }, 'lin');
      });
      let j = src;
      for (let k = 0; k < n; k++) {
        j = (j + 1) % 12;
        if (j === src) j = (j + 1) % 12;
        const id = list[k];
        const land = T0 + o.lift + (k + 1) * o.dt;
        const fl = Math.min(o.flight, o.lift * 0.6 + (k + 1) * o.dt);
        pits[j].push(id);
        const nn = pits[j].length;
        const to = pitSlot(j, nn - 1, nn);
        const from = last(seeds[id]);
        const dist = Math.hypot(to.x - from.x, to.y - from.y);
        move(seeds[id], land - fl, land, to, 'arc', 0.3 + dist * 0.16);
        relayout(j, land, o.fast ? 0.08 : 0.16);
        ev.push({ type: 'drop', t: land, p: j, n: nn, fast: o.fast, who: me, k });
      }
      let end = T0 + o.lift + n * o.dt + (o.fast ? 0.02 : 0.16);
      const lastPit = j;
      let jj = lastPit, attacked = 0;
      const cnt = p => pits[p].length;
      while (jj >= 0 && Math.floor(jj / 6) === other && (cnt(jj) === 2 || cnt(jj) === 3)) { jj--; attacked++; }
      const firstKept = lastPit - attacked;
      let left = 0;
      for (let k = other * 6; k < other * 6 + 6; k++) if (k <= firstKept || k > lastPit) left += cnt(k);
      if (attacked && left > 0) {
        let tc = T0 + o.lift + n * o.dt + o.capPause;
        let chain = 0;
        for (let k = lastPit; k > firstKept; k--) {
          const taken = pits[k].splice(0);
          ev.push({ type: 'capture', t: tc, p: k, n: taken.length, who: me, fast: o.fast, chain: chain++ });
          taken.forEach((id, m) => {
            const tl = tc + o.capDelay + m * o.capStagger + o.capFlight;
            stores[me].push(id);
            move(seeds[id], tl - o.capFlight, tl, storeSlot(me, stores[me].length - 1), 'arc', 0.8);
            ev.push({ type: 'store', t: tl, who: me, total: stores[me].length, fast: o.fast });
            end = Math.max(end, tl);
          });
          tc += o.capStep;
        }
      }
      return end;
    }
    const SLOW = { lift: 0.25, dt: 0.25, flight: 0.42, capPause: 0.18, capDelay: 0.1, capStagger: 0.05, capFlight: 0.45, capStep: 0.12, fast: false };
    const FAST = { lift: 0.015, dt: 0.01, flight: 0.08, capPause: 0.02, capDelay: 0.015, capStagger: 0.008, capFlight: 0.12, capStep: 0.03, fast: true };
    const FINAL = { lift: 0.2, dt: 0.15, flight: 0.34, capPause: 0.15, capDelay: 0.1, capStagger: 0.04, capFlight: 0.42, capStep: 0.12, fast: false };
    ev.push({ type: 'legal', t: 7.0, t1: 7.25, p: GAME[0] });
    let tt = ply(GAME[0], 7.25, SLOW);
    const ffStart = Math.max(tt + 0.02, 8.6);
    tt = ffStart;
    for (let i = 1; i < GAME.length - 1; i++) tt = ply(GAME[i], tt, FAST);
    const ffEnd = tt;
    const finalStart = Math.max(ffEnd + 0.22, 10.4);
    ev.push({ type: 'legal', t: finalStart - 0.3, t1: finalStart, p: GAME[GAME.length - 1] });
    const gameEnd = ply(GAME[GAME.length - 1], finalStart, FINAL);

    // ---- a fresh board behind the feature montage -------------------------
    const RESET = 14.05;
    for (let id = 0; id < 48; id++) {
      const s = seeds[id], p = id >> 2, k = id & 3;
      const t0 = RESET + h01(id * 31) * 0.55;
      move(s, t0, t0 + 0.62, pitSlot(p, k, 4), 'arc', 1.1);
    }
    for (let p = 0; p < 12; p++) pits[p] = [p * 4, p * 4 + 1, p * 4 + 2, p * 4 + 3];
    stores[0] = []; stores[1] = [];

    ev.sort((a, b) => a.t - b.t);
    const storeTimes = [[], []];
    for (const e of ev) if (e.type === 'store') storeTimes[e.who].push(e.t);
    const win = ev.find(e => e.type === 'store' && e.who === 0 && e.total === 25);
    return { seeds, ev, storeTimes, ffStart, ffEnd, finalStart, gameEnd, winT: win ? win.t : 13, reset: RESET };
  }

  function seedPos(s, t) {
    const kf = s.kf;
    if (t <= kf[0].t) return kf[0];
    let lo = 0, hi = kf.length - 1;
    if (t >= kf[hi].t) return kf[hi];
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (kf[mid].t <= t) lo = mid; else hi = mid; }
    const a = kf[lo], b = kf[hi];
    const dur = b.t - a.t;
    if (dur <= 1e-6) return b;
    const u = (t - a.t) / dur;
    if (b.m === 'arc') {
      const e = E.inOutSine(u);
      return { x: lerp(a.x, b.x, e), y: lerp(a.y, b.y, e), z: lerp(a.z, b.z, u) + b.h * 4 * u * (1 - u) };
    }
    if (b.m === 'drop') {
      const sp = b.sp || 0.8;
      if (u < sp) { const v = u / sp; return { x: lerp(a.x, b.x, v), y: lerp(a.y, b.y, v), z: lerp(a.z, b.z, v * v) }; }
      const v = (u - sp) / (1 - sp);
      return { x: b.x, y: b.y, z: b.z + b.h * 4 * v * (1 - v) };
    }
    const e = E.inOutCubic(u);
    return { x: lerp(a.x, b.x, e), y: lerp(a.y, b.y, e), z: lerp(a.z, b.z, e) };
  }

  /* ============================================================== camera */
  function makeCam(v, vp) {
    const refW = Math.min(vp.w, vp.h * 16 / 9);
    const focal = 0.92 * refW * v.zoom;
    const cp = Math.cos(v.pitch), sp = Math.sin(v.pitch), cy = Math.cos(v.yaw), sy = Math.sin(v.yaw);
    const px = v.tx + v.dist * cp * sy, py = v.ty - v.dist * cp * cy, pz = (v.tz || 0) + v.dist * sp;
    const fx = -cp * sy, fy = cp * cy, fz = -sp;
    const rx = cy, ry = sy;
    const ux = -sy * sp, uy = cy * sp, uz = cp;
    const ox = vp.x + vp.w * v.ax, oy = vp.y + vp.h * v.ay;
    return {
      vp, focal,
      project(x, y, z) {
        const dx = x - px, dy = y - py, dz = z - pz;
        const cz = dx * fx + dy * fy + dz * fz;
        const k = focal / Math.max(cz, 0.05);
        return { x: ox + (dx * rx + dy * ry) * k, y: oy - (dx * ux + dy * uy + dz * uz) * k, s: k, d: cz };
      },
    };
  }

  function viewAt(t, L) {
    const d2r = Math.PI / 180;
    const P = L.portrait;
    const base = P ? 90 : 0;
    const z = L.zoom;
    const hc = pitPos(3);
    const V = (tx, ty, yaw, pitch, dist, ax, ay, zm) => ({ tx, ty, yaw: (base + yaw) * d2r, pitch: pitch * d2r, dist, ax, ay, zoom: z * (zm || 1) });
    const K = P ? [
      [0.0, V(hc.x, hc.y, -8, 66, 2.9, 0.5, 0.6), 'lin'],
      [1.2, V(hc.x, hc.y, -4, 64, 2.6, 0.5, 0.6), 'inOutSine'],
      [3.7, V(0, 0, 0, 62, 11.6, 0.5, 0.6), 'inOutCubic'],
      [4.0, V(0, 0, 0, 62, 11.6, 0.5, 0.6), 'lin'],
      [6.5, V(0, 0, 6, 26, 13.2, 0.5, 0.76), 'inOutSine'],
      [7.2, V(0, 0, 0, 68, 11.2, 0.5, 0.58), 'inOutCubic'],
      [11.0, V(0, 0, 0, 70, 11.0, 0.5, 0.58), 'inOutSine'],
      [11.9, V(-0.9, 0.2, 3, 70, 9.4, 0.5, 0.58), 'inOutSine'],
      [12.9, V(-0.9, 0.2, 2, 70, 9.2, 0.5, 0.58), 'lin'],
      [13.8, V(0, 0, 0, 68, 11.2, 0.5, 0.58), 'inOutSine'],
      [14.0, V(0, 0, 0, 68, 11.2, 0.5, 0.58), 'lin'],
      [14.6, V(0, 0, -16, 42, 11.5, 0.5, 0.6), 'inOutCubic'],
      [20.8, V(0, 0, 16, 42, 11.5, 0.5, 0.6), 'lin'],
      [21.3, V(1.0, 0, 0, 66, 8.6, 0.5, 0.68), 'inOutCubic'],
      [23.0, V(1.0, 0, 5, 68, 8.2, 0.5, 0.68), 'lin'],
    ] : [
      [0.0, V(hc.x, hc.y, -8, 64, 2.7, 0.5, 0.64), 'lin'],
      [1.2, V(hc.x, hc.y, -4, 62, 2.4, 0.5, 0.64), 'inOutSine'],
      [3.7, V(0, 0, 0, 56, 11.4, 0.5, 0.62), 'inOutCubic'],
      [4.0, V(0, 0, 0, 56, 11.4, 0.5, 0.62), 'lin'],
      [6.5, V(0, 0.3, 7, 20, 12.6, 0.5, 0.82), 'inOutSine'],
      [7.2, V(0, 0, 0, 58, 9.6, 0.5, 0.63), 'inOutCubic'],
      [11.0, V(0, 0, 0, 60, 9.4, 0.5, 0.63), 'inOutSine'],
      [11.9, V(-0.5, 0.15, 3, 60, 8.7, 0.5, 0.63), 'inOutSine'],
      [12.9, V(-0.5, 0.15, 2, 60, 8.6, 0.5, 0.63), 'lin'],
      [13.8, V(0, 0, 0, 58, 9.6, 0.5, 0.63), 'inOutSine'],
      [14.0, V(0, 0, 0, 58, 9.6, 0.5, 0.63), 'lin'],
      [14.6, V(0, 0, -18, 36, 11.4, 0.5, 0.56), 'inOutCubic'],
      [20.8, V(0, 0, 18, 36, 11.4, 0.5, 0.56), 'lin'],
      [21.3, V(1.0, -0.05, 0, 58, L.wide ? 7.9 : 8.4, L.wide ? 0.74 : 0.5, L.wide ? 0.68 : 0.7), 'inOutCubic'],
      [23.0, V(1.0, -0.05, 5, 60, L.wide ? 7.5 : 8.0, L.wide ? 0.74 : 0.5, L.wide ? 0.68 : 0.7), 'lin'],
    ];
    if (t <= K[0][0]) return K[0][1];
    for (let i = 1; i < K.length; i++) {
      if (t <= K[i][0]) {
        const a = K[i - 1], b = K[i];
        const u = E[b[2]](prog(t, a[0], b[0]));
        const out = {};
        for (const k in a[1]) out[k] = lerp(a[1][k], b[1][k], u);
        return out;
      }
    }
    return K[K.length - 1][1];
  }

  /* ============================================================ textures */
  function makeNoise(seed) {
    const r = rng(seed);
    const P = new Float32Array(256 * 256);
    for (let i = 0; i < P.length; i++) P[i] = r();
    return (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
      const x0 = xi & 255, x1 = (xi + 1) & 255, y0 = (yi & 255) << 8, y1 = ((yi + 1) & 255) << 8;
      const a = P[y0 | x0], b = P[y0 | x1], c = P[y1 | x0], d = P[y1 | x1];
      const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    };
  }

  // Wood figure: long wavy streaks along the board, plus fine fibre.
  function woodGrain(w, h, ppu, seed) {
    const gw = Math.ceil(w), gh = Math.ceil(h);
    const c = mkCanvas(gw, gh), g = c.getContext('2d');
    const img = g.createImageData(gw, gh), d = img.data;
    const N = makeNoise(seed), F = makeNoise(seed + 7);
    const k = 100 / ppu;   // noise is laid out in "100 px per unit" space
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const X = x * k, Y = y * k;
        const warp = N(X * 0.004, Y * 0.02) * 26 + N(X * 0.012, Y * 0.05) * 6;
        const s = Math.sin((Y * 0.62 + warp) * 0.55);
        const fib = F(X * 0.02, Y * 0.9) - 0.5;
        let v = (s > 0.55 ? (s - 0.55) * 1.6 : 0) + fib * 0.35;
        const i = (y * gw + x) * 4;
        if (v > 0) { d[i] = 0; d[i + 1] = 0; d[i + 2] = 0; d[i + 3] = Math.min(255, v * 120); }
        else { d[i] = 255; d[i + 1] = 226; d[i + 2] = 180; d[i + 3] = Math.min(255, -v * 60); }
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  function filmNoise(size, seed) {
    const c = mkCanvas(size, size), g = c.getContext('2d');
    const img = g.createImageData(size, size), d = img.data, r = rng(seed);
    for (let i = 0; i < d.length; i += 4) { const v = r() * 255; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
    g.putImageData(img, 0, 0);
    return c;
  }

  function spriteSeed(cols, S) {
    const c = mkCanvas(S, S), g = c.getContext('2d');
    const r = S / 2 - 1, m = S / 2;
    g.beginPath(); g.arc(m, m, r, 0, TAU);
    const base = g.createRadialGradient(S * 0.36, S * 0.32, 0, m, m, r * 1.08);
    base.addColorStop(0, cols[0]); base.addColorStop(0.46, cols[1]); base.addColorStop(1, cols[2]);
    g.fillStyle = base; g.fill();
    const rim = g.createRadialGradient(S * 0.44, S * 0.4, r * 0.5, m, m, r);
    rim.addColorStop(0, 'rgba(0,0,0,0)'); rim.addColorStop(1, 'rgba(0,0,0,0.42)');
    g.fillStyle = rim; g.fill();
    const spec = g.createRadialGradient(S * 0.35, S * 0.29, 0, S * 0.35, S * 0.29, r * 0.46);
    spec.addColorStop(0, 'rgba(255,255,255,0.8)'); spec.addColorStop(0.35, 'rgba(255,255,255,0.25)'); spec.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = spec; g.fill();
    const bounce = g.createRadialGradient(S * 0.64, S * 0.78, 0, S * 0.64, S * 0.78, r * 0.5);
    bounce.addColorStop(0, 'rgba(255,190,120,0.22)'); bounce.addColorStop(1, 'rgba(255,190,120,0)');
    g.fillStyle = bounce; g.fill();
    return c;
  }
  function spriteRadial(S, stops) {
    const c = mkCanvas(S, S), g = c.getContext('2d');
    const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    stops.forEach(([o, col]) => gr.addColorStop(o, col));
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
    return c;
  }

  const TEX = { X0: -BOARD.hw - 0.08, Y1: BOARD.hh + 0.08 };
  TEX.X1 = -TEX.X0; TEX.Y0 = -TEX.Y1;

  function boardTexture(ppu) {
    const w = Math.ceil((TEX.X1 - TEX.X0) * ppu), h = Math.ceil((TEX.Y1 - TEX.Y0) * ppu);
    const c = mkCanvas(w, h), g = c.getContext('2d');
    const tx = x => (x - TEX.X0) * ppu, ty = y => (TEX.Y1 - y) * ppu;
    const bx = tx(-BOARD.hw), by = ty(BOARD.hh), bw = BOARD.hw * 2 * ppu, bh = BOARD.hh * 2 * ppu;

    g.save();
    rrect(g, bx, by, bw, bh, BOARD.r * ppu);
    g.clip();
    const body = g.createLinearGradient(bx, by, bx + bw * 0.06, by + bh);
    body.addColorStop(0, '#8e5d33'); body.addColorStop(0.46, '#6b3f21'); body.addColorStop(1, '#43240f');
    g.fillStyle = body; g.fillRect(bx, by, bw, bh);
    const gp = Math.min(ppu, 150);
    const grain = woodGrain(w * gp / ppu, h * gp / ppu, gp, 11);
    g.globalAlpha = 0.9; g.drawImage(grain, 0, 0, w, h); g.globalAlpha = 1;
    // warm pool of light across the top of the board
    g.save();
    g.translate(w / 2, by - bh * 0.1); g.scale(1, (bh / bw) * 2.4);
    const sheen = g.createRadialGradient(0, 0, 0, 0, 0, bw * 0.62);
    sheen.addColorStop(0, 'rgba(255,214,160,0.2)'); sheen.addColorStop(1, 'rgba(255,214,160,0)');
    g.fillStyle = sheen; g.fillRect(-bw, -bw, bw * 2, bw * 2);
    g.restore();
    // rim: light along the top edge, shade along the bottom
    const edge = g.createLinearGradient(0, by, 0, by + bh);
    edge.addColorStop(0, 'rgba(255,220,170,0.2)'); edge.addColorStop(0.06, 'rgba(255,220,170,0)');
    edge.addColorStop(0.8, 'rgba(0,0,0,0)'); edge.addColorStop(1, 'rgba(0,0,0,0.45)');
    g.fillStyle = edge; g.fillRect(bx, by, bw, bh);
    g.restore();

    // thin gilt inlay along the rim
    g.save();
    const ins = 0.085 * ppu;
    rrect(g, bx + ins, by + ins, bw - ins * 2, bh - ins * 2, (BOARD.r - 0.085) * ppu);
    g.strokeStyle = 'rgba(212,168,69,0.28)'; g.lineWidth = Math.max(1, 0.012 * ppu); g.stroke();
    g.restore();

    // the groove between the two rows
    const mid = g.createLinearGradient(tx(-2.95), 0, tx(2.95), 0);
    mid.addColorStop(0, 'rgba(0,0,0,0)'); mid.addColorStop(0.2, 'rgba(0,0,0,0.42)'); mid.addColorStop(0.8, 'rgba(0,0,0,0.42)'); mid.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = mid; g.fillRect(tx(-2.95), ty(0) - 0.006 * ppu, 5.9 * ppu, Math.max(1, 0.012 * ppu));
    const midHi = g.createLinearGradient(tx(-2.95), 0, tx(2.95), 0);
    midHi.addColorStop(0, 'rgba(255,220,170,0)'); midHi.addColorStop(0.5, 'rgba(255,220,170,0.1)'); midHi.addColorStop(1, 'rgba(255,220,170,0)');
    g.fillStyle = midHi; g.fillRect(tx(-2.95), ty(0) + 0.006 * ppu, 5.9 * ppu, Math.max(1, 0.008 * ppu));

    // a hollow: the pits and the two stores share the same carving
    function hollow(path, cx, cy, rw, rh) {
      g.save();
      // lip: dark above, catching light below
      g.save();
      path(0.035 * ppu);
      const lip = g.createLinearGradient(0, cy - rh, 0, cy + rh);
      lip.addColorStop(0, 'rgba(0,0,0,0.3)'); lip.addColorStop(0.55, 'rgba(0,0,0,0)'); lip.addColorStop(1, 'rgba(255,205,150,0.22)');
      g.fillStyle = lip; g.fill();
      g.restore();
      path(0);
      g.fillStyle = C.pit; g.fill();
      g.clip();
      const top = g.createRadialGradient(cx, cy - rh * 0.36, 0, cx, cy - rh * 0.36, Math.max(rw, rh) * 1.1);
      top.addColorStop(0, 'rgba(0,0,0,0.5)'); top.addColorStop(0.4, 'rgba(0,0,0,0.26)'); top.addColorStop(0.62, 'rgba(0,0,0,0)');
      g.fillStyle = top; g.fillRect(cx - rw * 2, cy - rh * 2, rw * 4, rh * 4);
      const bot = g.createRadialGradient(cx, cy + rh, 0, cx, cy + rh, Math.max(rw, rh) * 1.2);
      bot.addColorStop(0, 'rgba(120,78,42,0.5)'); bot.addColorStop(0.6, 'rgba(120,78,42,0)');
      g.fillStyle = bot; g.fillRect(cx - rw * 2, cy - rh * 2, rw * 4, rh * 4);
      // inner shadow under the top rim, and a warm catch-light on the lower rim
      g.shadowColor = 'rgba(0,0,0,0.78)'; g.shadowBlur = 0.12 * ppu; g.shadowOffsetY = 0.07 * ppu;
      g.lineWidth = 0.2 * ppu; g.strokeStyle = '#000';
      path(0.1 * ppu); g.stroke();
      g.shadowColor = 'rgba(190,130,80,0.35)'; g.shadowBlur = 0.04 * ppu; g.shadowOffsetY = -0.025 * ppu;
      path(0.1 * ppu); g.stroke();
      g.restore();
    }
    for (let i = 0; i < 12; i++) {
      const p = pitPos(i), cx = tx(p.x), cy = ty(p.y), r = PIT_R * ppu;
      hollow(grow => { g.beginPath(); g.arc(cx, cy, r + grow, 0, TAU); }, cx, cy, r, r);
    }
    for (const s of STORE) {
      const cx = tx(s.x), cy = ty(s.y), rw = STORE_HW * ppu, rh = STORE_HH * ppu;
      hollow(grow => rrect(g, cx - rw - grow, cy - rh - grow, (rw + grow) * 2, (rh + grow) * 2, rw + grow), cx, cy, rw, rh);
    }
    return c;
  }

  // Draw a texture lying on the plane z, through the camera. The plane is cut
  // into cells and each cell is drawn with its own affine transform, which is
  // how a 2D canvas gets a true perspective board.
  function drawPlane(ctx, cam, tex, x0, x1, y0, y1, z, nu, nv) {
    const P = [];
    for (let j = 0; j <= nv; j++) {
      const row = [];
      const y = lerp(y1, y0, j / nv);
      for (let i = 0; i <= nu; i++) row.push(cam.project(lerp(x0, x1, i / nu), y, z));
      P.push(row);
    }
    const tw = tex.width, th = tex.height, cw = tw / nu, ch = th / nv;
    const vp = cam.vp;
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const A = P[j][i], B = P[j][i + 1], Cc = P[j + 1][i], D = P[j + 1][i + 1];
        const minX = Math.min(A.x, B.x, Cc.x, D.x), maxX = Math.max(A.x, B.x, Cc.x, D.x);
        const minY = Math.min(A.y, B.y, Cc.y, D.y), maxY = Math.max(A.y, B.y, Cc.y, D.y);
        if (maxX < vp.x || minX > vp.x + vp.w || maxY < vp.y || minY > vp.y + vp.h) continue;
        // average the two triangles so the error is shared by all four corners
        const ax = (B.x - A.x + D.x - Cc.x) / 2 / cw, ay = (B.y - A.y + D.y - Cc.y) / 2 / cw;
        const bx = (Cc.x - A.x + D.x - B.x) / 2 / ch, by = (Cc.y - A.y + D.y - B.y) / 2 / ch;
        const ox = (A.x + B.x + Cc.x + D.x) / 4 - ax * cw / 2 - bx * ch / 2;
        const oy = (A.y + B.y + Cc.y + D.y) / 4 - ay * cw / 2 - by * ch / 2;
        const pad = 0.75;
        const sx = Math.max(0, i * cw - pad), sy = Math.max(0, j * ch - pad);
        const ex = Math.min(tw, (i + 1) * cw + pad), ey = Math.min(th, (j + 1) * ch + pad);
        ctx.setTransform(ax, ay, bx, by, ox, oy);
        ctx.drawImage(tex, sx, sy, ex - sx, ey - sy, sx - i * cw, sy - j * ch, ex - sx, ey - sy);
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function outline(z, grow) {
    const pts = [], hw = BOARD.hw + grow, hh = BOARD.hh + grow, r = BOARD.r + grow;
    const corners = [[hw - r, hh - r, 0], [-hw + r, hh - r, 90], [-hw + r, -hh + r, 180], [hw - r, -hh + r, 270]];
    for (const [cx, cy, a0] of corners) {
      for (let k = 0; k <= 10; k++) {
        const a = (a0 + k * 9) * Math.PI / 180;
        pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r, z]);
      }
    }
    return pts;
  }
  function pathOf(ctx, cam, pts) {
    ctx.beginPath();
    pts.forEach(([x, y, z], i) => { const p = cam.project(x, y, z); if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); });
    ctx.closePath();
  }
  function ringPath(ctx, cam, cx, cy, r, z) {
    ctx.beginPath();
    for (let k = 0; k <= 48; k++) {
      const a = (k / 48) * TAU;
      const p = cam.project(cx + Math.cos(a) * r, cy + Math.sin(a) * r, z);
      if (k) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y);
    }
    ctx.closePath();
  }

  /* ============================================================== world */
  const WORLD_CITIES = {
    CI: [5.35, -4.0], FR: [48.86, 2.35], SN: [14.7, -17.45], US: [40.7, -74.0], CM: [4.05, 9.7],
    BE: [50.85, 4.35], MA: [33.57, -7.59], CA: [45.5, -73.57], GH: [5.6, -0.19], GB: [51.5, -0.13],
    NG: [6.52, 3.38], BR: [-23.55, -46.63],
  };
  const ROUTES = [['SN', 'US', 16.25], ['CM', 'BE', 16.45], ['MA', 'CA', 16.65], ['GH', 'GB', 16.85], ['NG', 'BR', 17.05], ['CI', 'FR', 17.3]];
  function unit(lat, lon) {
    const a = lat * Math.PI / 180, b = lon * Math.PI / 180;
    return [Math.cos(a) * Math.sin(b), Math.sin(a), Math.cos(a) * Math.cos(b)];
  }
  function landPoints() {
    const b64 = global.AWALE_PROMO_WORLD;
    if (!b64) return [];
    const bin = atob(b64);
    const pts = [];
    for (let r = 0; r < 90; r++) {
      const lat = 89 - r * 2;
      const step = Math.max(1, Math.round(1 / Math.cos(lat * Math.PI / 180)));
      for (let c = 0; c < 180; c += step) {
        const k = r * 180 + c;
        if (bin.charCodeAt(k >> 3) & (1 << (k & 7))) pts.push(unit(lat, -179 + c * 2));
      }
    }
    return pts;
  }

  /* ======================================================== the renderer */
  function create(opts) {
    opts = opts || {};
    const state = { lang: opts.lang || 'en', url: opts.url || 'awale-web.vercel.app' };
    const plan = compile();
    const land = landPoints();
    const cache = { W: 0, H: 0 };

    function ensure(W, H) {
      if (cache.W === W && cache.H === H) return;
      cache.W = W; cache.H = H;
      const m = Math.min(W, H);
      const ppu = clamp(Math.round(m / 3.4), 110, 560);
      cache.board = boardTexture(ppu);
      const S = clamp(Math.round(m / 9), 48, 256);
      cache.stones = {};
      for (const k of STONE_NAMES) cache.stones[k] = spriteSeed(STONES[k], S);
      cache.shadowDot = spriteRadial(64, [[0, 'rgba(0,0,0,0.62)'], [0.55, 'rgba(0,0,0,0.3)'], [1, 'rgba(0,0,0,0)']]);
      cache.glow = spriteRadial(128, [[0, 'rgba(255,226,160,1)'], [0.25, 'rgba(255,200,110,0.55)'], [1, 'rgba(255,170,80,0)']]);
      cache.greenGlow = spriteRadial(128, [[0, 'rgba(170,240,160,1)'], [0.3, 'rgba(110,200,110,0.5)'], [1, 'rgba(110,200,110,0)']]);
      cache.grain = filmNoise(256, 5);
      cache.wood = woodGrain(1024, 320, 150, 23);
      cache.layer = mkCanvas(W, H);
      cache.small = [mkCanvas(W / 2, H / 2), mkCanvas(W / 4, H / 4), mkCanvas(W / 8, H / 8), mkCanvas(W / 16, H / 16)];
      cache.bloom = mkCanvas(W / 8, H / 8);
    }

    function layout(W, H) {
      const r = W / H, m = Math.min(W, H);
      const portrait = r < 0.8, wide = r >= 1.3;
      return {
        W, H, m, portrait, wide, square: !portrait && !wide,
        textX: wide ? W * 0.075 : W * 0.08,
        textY: wide ? H * 0.15 : portrait ? H * 0.1 : H * 0.085,
        textW: wide ? W * 0.4 : W * 0.84,
        vis: wide ? { x: W * 0.7, y: H * 0.53, s: Math.min(W * 0.44, H * 0.78) }
          : portrait ? { x: W * 0.5, y: H * 0.6, s: Math.min(W * 0.9, H * 0.52) }
            : { x: W * 0.5, y: H * 0.66, s: Math.min(W * 0.8, H * 0.52) },
        zoom: portrait ? 1.5 : 1,
      };
    }

    /* -------------------------------------------------------- text kit */
    function font(ctx, px, fam, weight, style) { ctx.font = `${style || 'normal'} ${weight || 400} ${Math.max(1, px).toFixed(1)}px ${fam}`; }
    function tracked(ctx, text, x, y, track, align) {
      const chars = Array.from(text);
      const widths = chars.map(ch => ctx.measureText(ch).width);
      const total = widths.reduce((a, b) => a + b, 0) + track * (chars.length - 1);
      let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
      ctx.textAlign = 'left';
      chars.forEach((ch, i) => { ctx.fillText(ch, cx, y); cx += widths[i] + track; });
      return total;
    }
    function trackedWidth(ctx, text, track) {
      const chars = Array.from(text);
      return chars.reduce((a, ch) => a + ctx.measureText(ch).width, 0) + track * (chars.length - 1);
    }
    function wrap(ctx, text, maxW) {
      const words = text.split(' '), lines = [];
      let line = '';
      for (const w of words) {
        const test = line ? line + ' ' + w : w;
        if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
      }
      if (line) lines.push(line);
      return lines;
    }
    // A line that rises into place from behind its own baseline.
    function reveal(ctx, p, x, y, size, draw) {
      if (p <= 0) return;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x - size * 40, y - size * 1.05, size * 80, size * 1.45);
      ctx.clip();
      ctx.translate(0, (1 - E.outExpo(p)) * size * 1.15);
      draw();
      ctx.restore();
    }

    /* ------------------------------------------------------ background */
    function background(ctx, L, t) {
      const { W, H } = L;
      ctx.fillStyle = '#070302';
      ctx.fillRect(0, 0, W, H);
      const g = ctx.createRadialGradient(W * 0.5, H * 0.46, 0, W * 0.5, H * 0.46, Math.hypot(W, H) * 0.62);
      const warm = 0.55 + 0.45 * clamp((t - 0.6) / 2.6);
      g.addColorStop(0, `rgba(58,32,15,${warm})`);
      g.addColorStop(0.45, `rgba(30,16,7,${warm})`);
      g.addColorStop(1, 'rgba(7,3,2,1)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }

    function dust(ctx, L, t, alpha, n) {
      if (alpha <= 0) return;
      const r = rng(99);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < n; i++) {
        const x0 = r(), y0 = r(), sz = 0.3 + r() * 1.4, sp = 0.01 + r() * 0.03, ph = r() * TAU, depth = r();
        const x = (x0 + Math.sin(t * 0.3 + ph) * 0.015) * L.W;
        const y = (((y0 - t * sp) % 1.1) + 1.1) % 1.1 * L.H - L.H * 0.05;
        const s = sz * L.m * 0.012 * (0.5 + depth);
        ctx.globalAlpha = alpha * (0.08 + 0.22 * depth) * (0.6 + 0.4 * Math.sin(t * 1.3 + ph));
        ctx.drawImage(cache.glow, x - s, y - s, s * 2, s * 2);
      }
      ctx.restore();
    }

    function rays(ctx, L, cx, cy, alpha, t) {
      if (alpha <= 0) return;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const len = L.m * 1.4;
      for (let i = 0; i < 9; i++) {
        const a = Math.PI / 2 + (i - 4) * 0.16 + Math.sin(t * 0.35 + i) * 0.03;
        const w = 0.028 + (i % 3) * 0.012;
        const g = ctx.createLinearGradient(cx, cy, cx + Math.cos(a) * len, cy + Math.sin(a) * len);
        g.addColorStop(0, `rgba(255,214,150,${0.1 * alpha})`);
        g.addColorStop(1, 'rgba(255,214,150,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a - w) * len, cy + Math.sin(a - w) * len);
        ctx.lineTo(cx + Math.cos(a + w) * len, cy + Math.sin(a + w) * len);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    /* ------------------------------------------------------------ board */
    function storeCount(side, t) {
      const a = plan.storeTimes[side];
      if (t >= plan.reset) return 0;
      let n = 0;
      for (const x of a) if (x <= t) n++;
      return n;
    }

    function drawSeed(ctx, cam, s, p, t, shutter) {
      const pr = cam.project(p.x, p.y, p.z);
      const r = SEED_R * pr.s;
      const img = cache.stones[s.color];
      if (shutter > 0) {
        const q = seedPos(s, t - shutter);
        const pq = cam.project(q.x, q.y, q.z);
        const dx = pr.x - pq.x, dy = pr.y - pq.y;
        const len = Math.hypot(dx, dy);
        if (len > r * 0.35) {
          const n = Math.min(7, 2 + Math.floor(len / (r * 0.5)));
          const a0 = ctx.globalAlpha;
          for (let i = n; i >= 1; i--) {
            const u = i / (n + 1);
            ctx.globalAlpha = a0 * 0.42 * (1 - u);
            ctx.drawImage(img, pr.x - dx * u - r, pr.y - dy * u - r, r * 2, r * 2);
          }
          ctx.globalAlpha = a0;
        }
      }
      ctx.drawImage(img, pr.x - r, pr.y - r, r * 2, r * 2);
    }

    function drawBoard(ctx, L, cam, t, o) {
      o = o || {};
      // shadow on the ground
      const c0 = cam.project(0, 0, -BOARD.thick);
      ctx.save();
      const off = 100000;
      ctx.translate(-off, 0);
      ctx.shadowColor = 'rgba(0,0,0,0.8)';
      ctx.shadowBlur = c0.s * 0.5;
      ctx.shadowOffsetX = off;
      ctx.shadowOffsetY = c0.s * 0.12;
      pathOf(ctx, cam, outline(-BOARD.thick - 0.2, 0.05));
      ctx.fillStyle = '#000';
      ctx.fill();
      ctx.restore();
      // sides: the board is a solid block, stacked in thin slices
      const layers = 7;
      for (let k = 0; k <= layers; k++) {
        const z = -BOARD.thick * (1 - k / layers);
        pathOf(ctx, cam, outline(z, -0.02 * (1 - k / layers)));
        const f = k / layers;
        ctx.fillStyle = `rgb(${Math.round(lerp(20, 58, f))},${Math.round(lerp(10, 32, f))},${Math.round(lerp(4, 14, f))})`;
        ctx.fill();
      }
      // top
      const pr = cam.project(0, 0, 0);
      const cells = pr.s * BOARD.hw * 2 > 1400 ? [36, 12] : [28, 10];
      drawPlane(ctx, cam, cache.board, TEX.X0, TEX.X1, TEX.Y0, TEX.Y1, 0, cells[0], cells[1]);
      // polished edge
      pathOf(ctx, cam, outline(0, -0.004));
      ctx.strokeStyle = 'rgba(255,214,160,0.2)';
      ctx.lineWidth = Math.max(1, pr.s * 0.012);
      ctx.stroke();

      highlights(ctx, cam, t, o);
      seedsLayer(ctx, cam, t, o);
      storePills(ctx, L, cam, t, o);
    }

    function highlights(ctx, cam, t, o) {
      const pr = cam.project(0, 0, 0);
      ctx.save();
      // a playable pit, as the app draws it: a gold ring and glow
      for (const e of plan.ev) {
        if (e.type !== 'legal') continue;
        const a = env(t, e.t - 0.05, e.t1 + 0.35, 0.18, 0.3);
        if (a <= 0) continue;
        const c = pitPos(e.p);
        ringPath(ctx, cam, c.x, c.y, PIT_R + 0.035, 0.005);
        ctx.strokeStyle = `rgba(230,201,136,${0.9 * a})`;
        ctx.lineWidth = pr.s * 0.03;
        ctx.shadowColor = `rgba(230,201,136,${0.8 * a})`;
        ctx.shadowBlur = pr.s * 0.22;
        ctx.stroke();
        ctx.shadowBlur = 0;
        // the tap
        const tp = prog(t, e.t1 - 0.05, e.t1 + 0.45);
        if (tp > 0 && tp < 1) {
          ringPath(ctx, cam, c.x, c.y, PIT_R * (0.3 + tp * 1.1), 0.01);
          ctx.strokeStyle = `rgba(255,240,210,${0.7 * (1 - tp)})`;
          ctx.lineWidth = pr.s * 0.025 * (1 - tp) + 1;
          ctx.stroke();
        }
      }
      // the pit being sown from
      for (const e of plan.ev) {
        if (e.type !== 'lift') continue;
        const a = env(t, e.t, e.t + (e.fast ? 0.12 : 0.9), 0.06, e.fast ? 0.06 : 0.35);
        if (a <= 0) continue;
        const c = pitPos(e.p);
        ringPath(ctx, cam, c.x, c.y, PIT_R + 0.02, 0.005);
        ctx.strokeStyle = `rgba(230,201,136,${(e.fast ? 0.45 : 0.75) * a})`;
        ctx.lineWidth = pr.s * 0.022;
        ctx.stroke();
      }
      // captures: the pit flashes gold and a ring bursts out of it
      ctx.globalCompositeOperation = 'lighter';
      for (const e of plan.ev) {
        if (e.type !== 'capture') continue;
        const dur = e.fast ? 0.25 : 0.7;
        if (t < e.t || t > e.t + dur) continue;
        const u = (t - e.t) / dur;
        const c = pitPos(e.p);
        const q = cam.project(c.x, c.y, 0.02);
        const s = q.s * PIT_R * (2.4 + u * 1.2);
        ctx.globalAlpha = (1 - u) * (e.fast ? 0.5 : 0.9);
        ctx.drawImage(cache.glow, q.x - s, q.y - s * 0.8, s * 2, s * 1.6);
        ringPath(ctx, cam, c.x, c.y, PIT_R * (1 + E.outCubic(u) * 0.9), 0.01);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = `rgba(255,226,160,${(1 - u) * 0.9})`;
        ctx.lineWidth = pr.s * 0.03 * (1 - u) + 1;
        ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
      if (o.extra) o.extra(ctx, cam, pr.s);
      ctx.restore();
    }

    function seedsLayer(ctx, cam, t, o) {
      const ffWide = t > plan.ffStart - 0.05 && t < plan.ffEnd + 0.05;
      const shutter = o.noBlur ? 0 : ffWide ? 1 / 22 : 1 / 50;
      const list = plan.seeds.map(s => {
        const p = seedPos(s, t);
        return { s, p, d: cam.project(p.x, p.y, p.z).d };
      }).sort((a, b) => b.d - a.d);
      // shadows first: they lie on the board, under every seed
      for (const it of list) {
        const p = it.p;
        const lift = Math.max(0, p.z - SEED_R * 0.75);
        const q = cam.project(p.x + lift * 0.18, p.y - lift * 0.22, 0.004);
        const r = SEED_R * q.s * (1.25 + lift * 1.1);
        ctx.globalAlpha = 0.75 / (1 + lift * 3);
        const k = cam.project(p.x, p.y + 0.1, 0.004);
        const squash = clamp(Math.abs(k.y - q.y) / (0.1 * q.s) + 0.15, 0.3, 1);
        ctx.drawImage(cache.shadowDot, q.x - r, q.y - r * squash + r * 0.15, r * 2, r * 2 * squash);
      }
      ctx.globalAlpha = 1;
      for (const it of list) drawSeed(ctx, cam, it.s, it.p, t, shutter);
    }

    function storePills(ctx, L, cam, t, o) {
      const a = o.pills === undefined ? env(t, 7.0, 14.1, 0.4, 0.3) : o.pills;
      if (a <= 0) return;
      for (let side = 0; side < 2; side++) {
        const n = storeCount(side, t);
        const s = STORE[side];
        const end = side === 0 ? -1 : 1;
        const along = L.portrait ? { x: s.x + end * 0.0, y: -STORE_HH - 0.2 } : { x: s.x, y: -STORE_HH - 0.2 };
        const q = cam.project(along.x, along.y, 0.02);
        let size = Math.max(10, q.s * 0.2);
        let pop = 0;
        const lastT = plan.storeTimes[side].filter(x => x <= t).pop();
        if (lastT !== undefined) pop = Math.max(0, 1 - (t - lastT) / 0.25);
        const win = side === 0 ? env(t, plan.winT, 14.2, 0.2, 0.4) : 0;
        size *= 1 + pop * 0.18 + win * 0.35;
        ctx.save();
        ctx.globalAlpha = a;
        font(ctx, size, FONT.sans, 800);
        const label = String(n);
        const w = Math.max(ctx.measureText(label).width + size * 0.9, size * 1.5), h = size * 1.35;
        ctx.fillStyle = win > 0 ? `rgba(60,36,10,${0.9})` : 'rgba(20,12,6,0.88)';
        rrect(ctx, q.x - w / 2, q.y - h / 2, w, h, h / 2);
        ctx.fill();
        ctx.strokeStyle = win > 0 ? `rgba(244,212,136,${0.5 + 0.5 * win})` : 'rgba(212,168,69,0.4)';
        ctx.lineWidth = Math.max(1, size * 0.07);
        ctx.stroke();
        if (win > 0) {
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = a * win * 0.7;
          const gs = h * 2.6;
          ctx.drawImage(cache.glow, q.x - gs, q.y - gs * 0.7, gs * 2, gs * 1.4);
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = a;
        }
        ctx.fillStyle = win > 0 ? '#fff3d6' : C.goldSoft;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, q.x, q.y + size * 0.04);
        ctx.restore();
      }
    }

    // Draw the board into a layer, then blur it for the montage behind the
    // feature cards: a downsample chain and back up, which every browser can
    // do quickly and identically.
    function boardWithFocus(ctx, L, cam, t, blur, alpha, o) {
      if (alpha <= 0) return;
      if (blur <= 0.001) {
        ctx.save(); ctx.globalAlpha = alpha; drawBoard(ctx, L, cam, t, o); ctx.restore();
        return;
      }
      const layer = cache.layer, lg = layer.getContext('2d');
      lg.setTransform(1, 0, 0, 1, 0, 0);
      lg.clearRect(0, 0, layer.width, layer.height);
      drawBoard(lg, L, cam, t, o);
      const sm = cache.small;
      let src = layer;
      for (const c of sm) {
        const g = c.getContext('2d');
        g.clearRect(0, 0, c.width, c.height);
        g.imageSmoothingQuality = 'high';
        g.drawImage(src, 0, 0, c.width, c.height);
        src = c;
      }
      for (let i = sm.length - 2; i >= 1; i--) {
        const c = sm[i], g = c.getContext('2d');
        g.clearRect(0, 0, c.width, c.height);
        g.drawImage(sm[i + 1], 0, 0, c.width, c.height);
      }
      ctx.save();
      ctx.imageSmoothingQuality = 'high';
      ctx.globalAlpha = alpha * (1 - blur);
      ctx.drawImage(layer, 0, 0, L.W, L.H);
      ctx.globalAlpha = alpha * blur;
      ctx.drawImage(sm[1], 0, 0, L.W, L.H);
      ctx.restore();
    }

    /* -------------------------------------------------------- scenes */
    function hookScene(ctx, L, t, copy) {
      if (t > 4.2) return;
      // a single warm spotlight that opens as the board fills
      const open = E.inOutCubic(prog(t, 0.9, 3.6));
      const c3 = pitPos(3);
      const q = cam0.project(c3.x, c3.y, 0);
      const r0 = L.m * (0.3 + open * 1.6);
      const g = ctx.createRadialGradient(q.x, q.y, r0 * 0.15, q.x, q.y, r0);
      g.addColorStop(0, 'rgba(7,3,2,0)');
      g.addColorStop(1, `rgba(7,3,2,${0.88 * (1 - open)})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, L.W, L.H);
      // the first seed's impact: two rings and a brief glow
      const it = prog(t, T.heroLand, T.heroLand + 0.9);
      if (it > 0 && it < 1) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (let k = 0; k < 2; k++) {
          const u = clamp(it * 1.25 - k * 0.25);
          if (u <= 0 || u >= 1) continue;
          ringPath(ctx, cam0, c3.x, c3.y, PIT_R * (0.3 + E.outCubic(u) * (1.2 + k * 0.7)), 0.01);
          ctx.strokeStyle = `rgba(255,222,160,${(1 - u) * 0.6})`;
          ctx.lineWidth = q.s * 0.012 * (1 - u) + 1;
          ctx.stroke();
        }
        const s = q.s * PIT_R * 1.3;
        ctx.globalAlpha = (1 - it) * 0.45;
        ctx.drawImage(cache.glow, q.x - s, q.y - s * 0.75, s * 2, s * 1.5);
        ctx.restore();
      }
      const times = [1.0, 2.0, 3.0];
      const size = L.m * (L.portrait ? 0.105 : 0.1);
      const x = L.textX, y = L.textY + size * 0.95;
      copy.hook.forEach((pair, i) => {
        const t0 = times[i], t1 = i < 2 ? times[i + 1] : 4.0;
        const pin = prog(t, t0, t0 + 0.55);
        const pout = prog(t, t1 - 0.12, t1 + 0.1);
        if (pin <= 0 || pout >= 1) return;
        ctx.save();
        ctx.globalAlpha = 1 - pout;
        ctx.translate(0, -pout * size * 0.5);
        reveal(ctx, pin, x, y, size, () => {
          font(ctx, size, FONT.serif, 700, 'italic');
          ctx.textBaseline = 'alphabetic';
          ctx.textAlign = 'left';
          const gold = ctx.createLinearGradient(0, y - size, 0, y);
          gold.addColorStop(0, '#f6dd9c'); gold.addColorStop(1, '#c9953a');
          ctx.fillStyle = gold;
          ctx.fillText(pair[0], x, y);
          const w0 = ctx.measureText(pair[0]).width;
          font(ctx, size, FONT.serif, 600);
          ctx.fillStyle = C.ivory;
          ctx.fillText(pair[1], x + w0, y);
        });
        ctx.restore();
      });
    }

    function goldText(ctx, x, y, size) {
      const g = ctx.createLinearGradient(x, y - size, x, y + size * 0.1);
      g.addColorStop(0, '#fbeabf'); g.addColorStop(0.45, '#e8c577'); g.addColorStop(0.75, '#c8913a'); g.addColorStop(1, '#8e5f1f');
      return g;
    }

    function wordmark(ctx, L, t, t0, cx, cy, size, withShine) {
      const letters = Array.from('AWALÉ');
      font(ctx, size, FONT.serif, 700);
      const track = size * 0.14;
      const total = trackedWidth(ctx, 'AWALÉ', track);
      let x = cx - total / 2;
      letters.forEach((ch, i) => {
        const w = ctx.measureText(ch).width;
        const p = prog(t, t0 + i * 0.07, t0 + i * 0.07 + 0.7);
        if (p > 0) {
          ctx.save();
          const e = E.outExpo(p);
          ctx.globalAlpha *= clamp(p * 2.2);
          ctx.translate(x + w / 2, cy + (1 - e) * size * 0.35);
          ctx.scale(1 + (1 - e) * 0.25, 1 + (1 - e) * 0.25);
          ctx.fillStyle = 'rgba(0,0,0,0.45)';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'alphabetic';
          ctx.fillText(ch, 0, size * 0.03);
          ctx.fillStyle = goldText(ctx, 0, 0, size);
          ctx.fillText(ch, 0, 0);
          ctx.restore();
        }
        x += w + track;
      });
      if (withShine) {
        const sp = prog(t, withShine, withShine + 0.9);
        if (sp > 0 && sp < 1) {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.beginPath();
          x = cx - total / 2;
          font(ctx, size, FONT.serif, 700);
          ctx.textAlign = 'left';
          const sx = cx - total / 2 - size + sp * (total + size * 2);
          const g = ctx.createLinearGradient(sx - size * 0.5, 0, sx + size * 0.5, 0);
          g.addColorStop(0, 'rgba(255,245,220,0)'); g.addColorStop(0.5, 'rgba(255,245,220,0.75)'); g.addColorStop(1, 'rgba(255,245,220,0)');
          ctx.fillStyle = g;
          tracked(ctx, 'AWALÉ', cx - total / 2, cy, track, 'left');
          ctx.restore();
        }
      }
      return total;
    }

    function ornament(ctx, cx, cy, size, p) {
      if (p <= 0) return;
      const e = E.outCubic(p);
      const len = size * 1.6 * e;
      ctx.save();
      ctx.strokeStyle = C.gold;
      ctx.fillStyle = C.gold;
      ctx.globalAlpha *= e;
      for (const dir of [-1, 1]) {
        const g = ctx.createLinearGradient(cx + dir * size * 0.5, 0, cx + dir * (size * 0.5 + len), 0);
        g.addColorStop(0, 'rgba(212,168,69,0.9)'); g.addColorStop(1, 'rgba(212,168,69,0)');
        ctx.fillStyle = g;
        ctx.fillRect(Math.min(cx + dir * size * 0.5, cx + dir * (size * 0.5 + len)), cy - Math.max(0.6, size * 0.012), len, Math.max(1.2, size * 0.024));
        const dx = cx + dir * size * 0.3, d = size * 0.09;
        ctx.beginPath();
        ctx.moveTo(dx, cy - d); ctx.lineTo(dx + d, cy); ctx.lineTo(dx, cy + d); ctx.lineTo(dx - d, cy); ctx.closePath();
        ctx.lineWidth = Math.max(1, size * 0.02);
        ctx.strokeStyle = C.gold;
        ctx.stroke();
      }
      ctx.restore();
    }

    function titleScene(ctx, L, t, copy) {
      if (t < 3.9 || t > 7.3) return;
      const out = prog(t, 6.45, 7.0);
      const a = 1 - E.inCubic(out);
      if (a <= 0) return;
      const size = L.m * (L.portrait ? 0.19 : 0.2);
      const cx = L.W / 2, cy = L.portrait ? L.H * 0.36 : L.H * 0.4;
      // light breaking in from above as the title lands
      rays(ctx, L, cx, cy - size * 2.2, env(t, 3.95, 7.0, 0.6, 0.5), t);
      const flash = Math.max(0, 1 - Math.abs(t - T.title) / 0.22);
      if (flash > 0) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = `rgba(255,220,160,${0.12 * flash})`;
        ctx.fillRect(0, 0, L.W, L.H);
        ctx.restore();
      }
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(0, -out * size * 0.6);
      ornament(ctx, cx, cy - size * 1.05, size * 0.55, prog(t, 4.15, 4.8));
      wordmark(ctx, L, t, 4.0, cx, cy, size, 4.75);
      const tp = prog(t, 4.75, 5.6);
      if (tp > 0) {
        const ts = size * 0.12;
        font(ctx, ts, FONT.sans, 700);
        ctx.fillStyle = C.gold;
        ctx.globalAlpha = a * clamp(tp * 1.6);
        ctx.textBaseline = 'alphabetic';
        const track = ts * lerp(0.9, 0.3, E.outCubic(tp));
        const txt = copy.tagline.toUpperCase();
        const maxW = L.W * 0.88;
        let w = trackedWidth(ctx, txt, track);
        if (w > maxW) { font(ctx, ts * maxW / w, FONT.sans, 700); }
        tracked(ctx, txt, cx, cy + size * 0.52, track * (w > maxW ? maxW / w : 1), 'center');
      }
      ctx.restore();
    }

    function caption(ctx, L, t, t0, t1, big, sub) {
      if (t < t0 || t > t1) return;
      const pout = prog(t, t1 - 0.3, t1);
      const size = L.m * (L.portrait ? 0.1 : 0.095);
      const x = L.textX, y = L.textY + size * 0.8;
      ctx.save();
      ctx.globalAlpha = 1 - pout;
      ctx.translate(-pout * size * 0.4, 0);
      reveal(ctx, prog(t, t0, t0 + 0.6), x, y, size, () => {
        font(ctx, size, FONT.serif, 600, 'italic');
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = C.title;
        ctx.fillText(big, x, y);
      });
      if (sub) {
        const ss = size * 0.33;
        font(ctx, ss, FONT.sans, 500);
        const lines = wrap(ctx, sub, L.wide ? L.W * 0.5 : L.W * 0.84);
        lines.forEach((ln, i) => {
          const yy = y + size * 0.62 + i * ss * 1.45;
          reveal(ctx, prog(t, t0 + 0.12 + i * 0.05, t0 + 0.75 + i * 0.05), x, yy, ss, () => {
            font(ctx, ss, FONT.sans, 500);
            ctx.fillStyle = 'rgba(244,234,210,0.78)';
            ctx.textAlign = 'left';
            ctx.fillText(ln, x, yy);
          });
        });
      }
      ctx.restore();
    }

    function rulesScene(ctx, L, t, copy) {
      if (t < 6.8 || t > 14.3) return;
      caption(ctx, L, t, 6.95, plan.ffStart + 0.05, copy.sow, copy.sowSub);
      caption(ctx, L, t, plan.finalStart - 0.35, plan.winT - 0.05, copy.capture, copy.captureSub);
      caption(ctx, L, t, plan.winT, 14.15, copy.win, copy.winSub);
      // fast-forward chip
      const fa = env(t, plan.ffStart - 0.05, plan.ffEnd + 0.1, 0.12, 0.15);
      if (fa > 0) {
        const s = L.m * 0.026;
        font(ctx, s, FONT.sans, 800);
        const label = copy.ff.toUpperCase();
        const w = trackedWidth(ctx, label, s * 0.18) + s * 3.6, h = s * 2.2;
        const x = L.portrait ? L.textX : L.W - L.textX - w, y = L.portrait ? L.H * 0.92 - h : L.textY;
        ctx.save();
        ctx.globalAlpha = fa;
        ctx.fillStyle = 'rgba(20,12,6,0.8)';
        rrect(ctx, x, y, w, h, h / 2); ctx.fill();
        ctx.strokeStyle = 'rgba(212,168,69,0.55)'; ctx.lineWidth = Math.max(1, s * 0.08); ctx.stroke();
        ctx.fillStyle = C.goldSoft;
        const ph = (t * 6) % 1;
        for (let k = 0; k < 2; k++) {
          const ax = x + s * 0.9 + k * s * 0.75, ay = y + h / 2;
          ctx.globalAlpha = fa * (0.55 + 0.45 * Math.sin((ph + k * 0.5) * TAU));
          ctx.beginPath(); ctx.moveTo(ax, ay - s * 0.45); ctx.lineTo(ax + s * 0.7, ay); ctx.lineTo(ax, ay + s * 0.45); ctx.closePath(); ctx.fill();
        }
        ctx.globalAlpha = fa;
        ctx.textBaseline = 'middle';
        tracked(ctx, label, x + s * 2.7, y + h / 2 + s * 0.05, s * 0.18, 'left');
        ctx.restore();
      }
      // "+N" rising out of each slow capture
      for (const e of plan.ev) {
        if (e.type !== 'capture' || e.fast) continue;
        const u = prog(t, e.t + 0.05, e.t + 1.0);
        if (u <= 0 || u >= 1) continue;
        const c = pitPos(e.p);
        const q = camNow.project(c.x, c.y, 0.3 + u * 0.8);
        const s = q.s * 0.36;
        ctx.save();
        ctx.globalAlpha = env(u, 0, 1, 0.15, 0.4);
        font(ctx, s, FONT.serif, 700, 'italic');
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = goldText(ctx, q.x, q.y + s * 0.4, s);
        ctx.fillText('+' + e.n, q.x, q.y);
        ctx.restore();
      }
      // the win: a burst from South's store
      const wu = prog(t, plan.winT, plan.winT + 1.1);
      if (wu > 0 && wu < 1) {
        const q = camNow.project(STORE[0].x, STORE[0].y, 0.1);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 18; i++) {
          const a = (i / 18) * TAU + 0.2;
          const d = E.outCubic(wu) * q.s * (0.9 + (i % 3) * 0.25);
          const px = q.x + Math.cos(a) * d, py = q.y + Math.sin(a) * d * 0.75;
          const s = q.s * 0.12 * (1 - wu);
          ctx.globalAlpha = (1 - wu);
          ctx.drawImage(cache.glow, px - s, py - s, s * 2, s * 2);
        }
        ringPath(ctx, camNow, STORE[0].x, STORE[0].y, 0.5 + E.outCubic(wu) * 1.3, 0.02);
        ctx.strokeStyle = `rgba(255,226,160,${(1 - wu) * 0.8})`;
        ctx.lineWidth = q.s * 0.03 * (1 - wu) + 1;
        ctx.stroke();
        ctx.restore();
      }
    }

    function headline(ctx, L, t, t0, t1, lines3) {
      if (t < t0 || t > t1) return;
      const [over, title, sub] = lines3;
      const pout = prog(t, t1 - 0.28, t1);
      const size = L.m * (L.portrait ? 0.088 : 0.08);
      const x = L.textX;
      let y = L.textY;
      ctx.save();
      ctx.globalAlpha = 1 - E.inCubic(pout);
      ctx.translate(-E.inCubic(pout) * size * 0.8, 0);
      const os = size * 0.25;
      font(ctx, os, FONT.sans, 800);
      y += os;
      reveal(ctx, prog(t, t0 + 0.05, t0 + 0.6), x, y, os, () => {
        font(ctx, os, FONT.sans, 800);
        ctx.fillStyle = C.gold; ctx.textBaseline = 'alphabetic';
        const w = tracked(ctx, over, x + os * 2.2, y, os * 0.28, 'left');
        ctx.fillRect(x, y - os * 0.42, os * 1.6, Math.max(1, os * 0.1));
        return w;
      });
      y += size * 0.35;
      font(ctx, size, FONT.serif, 600);
      const lines = wrap(ctx, title, L.textW);
      lines.forEach((ln, i) => {
        y += size * (i ? 1.0 : 0.95);
        const yy = y;
        reveal(ctx, prog(t, t0 + 0.1 + i * 0.07, t0 + 0.75 + i * 0.07), x, yy, size, () => {
          font(ctx, size, FONT.serif, 600);
          ctx.fillStyle = C.title; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
          ctx.fillText(ln, x, yy);
        });
      });
      if (sub) {
        const ss = size * 0.3;
        font(ctx, ss, FONT.sans, 500);
        const sl = wrap(ctx, sub, L.textW);
        y += size * 0.25;
        sl.forEach((ln, i) => {
          y += ss * 1.5;
          const yy = y;
          reveal(ctx, prog(t, t0 + 0.25 + i * 0.05, t0 + 0.85 + i * 0.05), x, yy, ss, () => {
            font(ctx, ss, FONT.sans, 500);
            ctx.fillStyle = 'rgba(244,234,210,0.76)'; ctx.textAlign = 'left';
            ctx.fillText(ln, x, yy);
          });
        });
      }
      ctx.restore();
      return y;
    }

    // Enter from the right, leave to the left: one gesture for the montage.
    function visIn(t, t0, t1) {
      const a = E.outExpo(prog(t, t0, t0 + 0.6));
      const b = E.inCubic(prog(t, t1 - 0.3, t1));
      return { a: a * (1 - b), dx: (1 - a) * 0.12 - b * 0.12 };
    }

    function pitDisc(ctx, x, y, r, glow, glowColor) {
      ctx.save();
      if (glow > 0) {
        ctx.globalCompositeOperation = 'lighter';
        const s = r * 2.6;
        ctx.globalAlpha *= glow;
        ctx.drawImage(glowColor === 'green' ? cache.greenGlow : cache.glow, x - s, y - s, s * 2, s * 2);
        ctx.restore();
        ctx.save();
      }
      ctx.beginPath(); ctx.arc(x, y, r * 1.08, 0, TAU);
      const lip = ctx.createLinearGradient(0, y - r, 0, y + r);
      lip.addColorStop(0, 'rgba(0,0,0,0.35)'); lip.addColorStop(1, 'rgba(255,205,150,0.25)');
      ctx.fillStyle = lip; ctx.fill();
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU);
      ctx.fillStyle = C.pit; ctx.fill();
      const g = ctx.createRadialGradient(x, y - r * 0.35, 0, x, y - r * 0.35, r * 1.2);
      g.addColorStop(0, 'rgba(0,0,0,0.5)'); g.addColorStop(0.62, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fill();
      const b = ctx.createRadialGradient(x, y + r, 0, x, y + r, r * 1.1);
      b.addColorStop(0, 'rgba(120,78,42,0.5)'); b.addColorStop(0.6, 'rgba(120,78,42,0)');
      ctx.fillStyle = b; ctx.fill();
      if (glow > 0) {
        ctx.beginPath(); ctx.arc(x, y, r * 1.1, 0, TAU);
        ctx.strokeStyle = glowColor === 'green' ? `rgba(140,230,140,${glow})` : `rgba(230,201,136,${glow})`;
        ctx.lineWidth = r * 0.07;
        ctx.stroke();
      }
      ctx.restore();
    }

    function woodPanel(ctx, x, y, w, h, r) {
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = h * 0.25; ctx.shadowOffsetY = h * 0.1;
      rrect(ctx, x, y, w, h, r);
      const g = ctx.createLinearGradient(x, y, x + w * 0.05, y + h);
      g.addColorStop(0, '#8e5d33'); g.addColorStop(0.46, '#6b3f21'); g.addColorStop(1, '#43240f');
      ctx.fillStyle = g; ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.clip();
      ctx.globalAlpha = 0.9;
      ctx.drawImage(cache.wood, 0, 0, cache.wood.width, cache.wood.width * h / w, x, y, w, h);
      ctx.globalAlpha = 1;
      const e = ctx.createLinearGradient(0, y, 0, y + h);
      e.addColorStop(0, 'rgba(255,220,170,0.22)'); e.addColorStop(0.08, 'rgba(255,220,170,0)'); e.addColorStop(0.8, 'rgba(0,0,0,0)'); e.addColorStop(1, 'rgba(0,0,0,0.4)');
      ctx.fillStyle = e; ctx.fillRect(x, y, w, h);
      ctx.restore();
      ctx.save();
      rrect(ctx, x + h * 0.06, y + h * 0.06, w - h * 0.12, h - h * 0.12, r - h * 0.06);
      ctx.strokeStyle = 'rgba(212,168,69,0.3)'; ctx.lineWidth = Math.max(1, h * 0.012); ctx.stroke();
      ctx.restore();
    }

    function aiScene(ctx, L, t, copy) {
      if (t < T.ai - 0.05 || t > T.online + 0.05) return;
      headline(ctx, L, t, T.ai, T.online, copy.ai);
      const v = visIn(t, T.ai + 0.05, T.online);
      if (v.a <= 0) return;
      const S = L.vis.s * (L.portrait ? 1 : 0.95);
      const cx = L.vis.x + v.dx * L.W, cy = L.vis.y;
      const pw = S, ph = S * 0.34;
      ctx.save();
      ctx.globalAlpha = v.a;
      woodPanel(ctx, cx - pw / 2, cy - ph / 2, pw, ph, ph / 2);
      const r = ph * 0.3;
      const gap = (pw - ph * 0.5) / 4;
      for (let i = 0; i < 4; i++) {
        const x = cx - pw / 2 + ph * 0.25 + gap * (i + 0.5), y = cy - ph * 0.02;
        const on = prog(t, 14.3 + i * 0.25, 14.42 + i * 0.25);
        const master = i === 3;
        const glow = on * (master ? 0.8 + 0.2 * Math.sin(t * 9) : 0.55);
        pitDisc(ctx, x, y, r, glow);
        // i + 1 seeds: the level, counted the way this game counts
        for (let k = 0; k <= i; k++) {
          const land = 14.3 + i * 0.25 + k * 0.05;
          const u = prog(t, land - 0.22, land);
          if (u <= 0) continue;
          const a = k * 2.4 + i, rr = i === 0 ? 0 : r * 0.36 * Math.sqrt((k + 0.5) / (i + 1));
          const sx = x + Math.cos(a) * rr, sy = y + Math.sin(a) * rr - (1 - E.inQuad(u)) * r * 2.2;
          const s = r * 0.34;
          ctx.globalAlpha = v.a * clamp(u * 3);
          ctx.drawImage(cache.stones[STONE_NAMES[(i + k * 3) % 4]], sx - s, sy - s, s * 2, s * 2);
        }
        ctx.globalAlpha = v.a;
        let ls = ph * 0.1;
        font(ctx, ls, FONT.sans, 800);
        const longest = Math.max(...copy.levels.map(l => trackedWidth(ctx, l.toUpperCase(), ls * 0.16)));
        if (longest > gap * 0.88) { ls *= (gap * 0.88) / longest; font(ctx, ls, FONT.sans, 800); }
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = master ? `rgba(244,212,136,${0.5 + 0.5 * on})` : `rgba(244,234,210,${0.45 + 0.4 * on})`;
        tracked(ctx, copy.levels[i].toUpperCase(), x, cy + ph / 2 + ph * 0.24, ls * 0.16, 'center');
      }
      // difficulty rises: a thin gold meter under the four pits
      const mp = E.outCubic(prog(t, 14.3, 15.2));
      const my = cy + ph / 2 + ph * 0.52;
      ctx.fillStyle = 'rgba(244,234,210,0.12)';
      ctx.fillRect(cx - pw * 0.4, my, pw * 0.8, Math.max(1.5, ph * 0.015));
      const mg = ctx.createLinearGradient(cx - pw * 0.4, 0, cx + pw * 0.4, 0);
      mg.addColorStop(0, '#6e9a54'); mg.addColorStop(1, '#f4d488');
      ctx.fillStyle = mg;
      ctx.fillRect(cx - pw * 0.4, my, pw * 0.8 * mp, Math.max(1.5, ph * 0.015));
      ctx.restore();
    }

    function flag(ctx, code, x, y, w, h) {
      ctx.save();
      rrect(ctx, x, y, w, h, Math.min(w, h) * 0.16);
      ctx.clip();
      const v3 = cols => cols.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(x + (w / 3) * i, y, w / 3 + 0.5, h); });
      const h3 = cols => cols.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(x, y + (h / 3) * i, w, h / 3 + 0.5); });
      const star = (cx, cy, r, col) => {
        ctx.fillStyle = col; ctx.beginPath();
        for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? r * 0.42 : r; ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
        ctx.closePath(); ctx.fill();
      };
      if (code === 'CI') v3(['#f77f00', '#ffffff', '#009e60']);
      else if (code === 'FR') v3(['#0055a4', '#ffffff', '#ef4135']);
      else if (code === 'SN') { v3(['#00853f', '#fdef42', '#e31b23']); star(x + w / 2, y + h / 2, h * 0.2, '#00853f'); }
      else if (code === 'CM') { v3(['#007a5e', '#ce1126', '#fcd116']); star(x + w / 2, y + h / 2, h * 0.2, '#fcd116'); }
      else if (code === 'GH') { h3(['#ce1126', '#fcd116', '#006b3f']); star(x + w / 2, y + h / 2, h * 0.17, '#000000'); }
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(x, y, w, h * 0.5);
      ctx.restore();
      ctx.save();
      rrect(ctx, x, y, w, h, Math.min(w, h) * 0.16);
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = Math.max(1, h * 0.04); ctx.stroke();
      ctx.restore();
    }

    function card(ctx, x, y, w, h, r, hi) {
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = h * 0.3; ctx.shadowOffsetY = h * 0.08;
      rrect(ctx, x, y, w, h, r);
      const g = ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, 'rgba(60,40,22,0.92)'); g.addColorStop(1, 'rgba(30,19,11,0.95)');
      ctx.fillStyle = g; ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = hi ? `rgba(230,201,136,${0.35 + 0.55 * hi})` : 'rgba(212,168,69,0.28)';
      ctx.lineWidth = Math.max(1, h * (hi ? 0.022 : 0.012));
      ctx.stroke();
      ctx.restore();
    }

    function globeScene(ctx, L, t, copy) {
      if (t < T.online - 0.05 || t > T.ranks + 0.05) return;
      headline(ctx, L, t, T.online, T.nation, copy.online);
      headline(ctx, L, t, T.nation, T.ranks, copy.nation);
      const v = visIn(t, T.online + 0.05, T.ranks);
      if (v.a <= 0) return;
      const R = L.vis.s * (L.portrait ? 0.4 : 0.42);
      const cx = L.vis.x + v.dx * L.W, cy = L.vis.y - (L.portrait ? R * 0.12 : 0);
      const lon0 = lerp(-2, -34, E.inOutSine(prog(t, T.online, T.ranks)));
      const lat0 = 18;
      const cl = Math.cos(-lon0 * Math.PI / 180), sl = Math.sin(-lon0 * Math.PI / 180);
      const ca = Math.cos(lat0 * Math.PI / 180), sa = Math.sin(lat0 * Math.PI / 180);
      const rot = ([x, y, z]) => {
        const x1 = x * cl + z * sl, z1 = -x * sl + z * cl;
        const y2 = y * ca - z1 * sa, z2 = y * sa + z1 * ca;
        return [x1, y2, z2];
      };
      const grow = E.outBack(prog(t, T.online, T.online + 0.7));
      const RR = R * (0.7 + 0.3 * grow);
      ctx.save();
      ctx.globalAlpha = v.a;
      // atmosphere
      ctx.globalCompositeOperation = 'lighter';
      const atm = ctx.createRadialGradient(cx, cy, RR * 0.92, cx, cy, RR * 1.3);
      atm.addColorStop(0, 'rgba(230,180,100,0.22)'); atm.addColorStop(1, 'rgba(230,180,100,0)');
      ctx.fillStyle = atm; ctx.fillRect(cx - RR * 1.4, cy - RR * 1.4, RR * 2.8, RR * 2.8);
      ctx.globalCompositeOperation = 'source-over';
      const body = ctx.createRadialGradient(cx - RR * 0.3, cy - RR * 0.35, 0, cx, cy, RR);
      body.addColorStop(0, '#3a2412'); body.addColorStop(0.7, '#1a0f07'); body.addColorStop(1, '#0c0603');
      ctx.fillStyle = body;
      ctx.beginPath(); ctx.arc(cx, cy, RR, 0, TAU); ctx.fill();
      // land, as a field of seeds
      const dotR = RR * 0.0115;
      const buckets = [[], [], [], []];
      for (const p of land) {
        const [x, y, z] = rot(p);
        if (z <= 0.02) continue;
        buckets[Math.min(3, Math.floor(z * 4))].push(cx + x * RR, cy - y * RR);
      }
      buckets.forEach((b, i) => {
        ctx.fillStyle = `rgba(230,201,136,${0.22 + i * 0.2})`;
        ctx.beginPath();
        for (let k = 0; k < b.length; k += 2) { ctx.moveTo(b[k] + dotR, b[k + 1]); ctx.arc(b[k], b[k + 1], dotR, 0, TAU); }
        ctx.fill();
      });
      // rim light
      const rim = ctx.createRadialGradient(cx, cy, RR * 0.8, cx, cy, RR);
      rim.addColorStop(0, 'rgba(255,214,150,0)'); rim.addColorStop(1, 'rgba(255,214,150,0.28)');
      ctx.fillStyle = rim;
      ctx.beginPath(); ctx.arc(cx, cy, RR, 0, TAU); ctx.fill();
      // matches in flight: a seed crossing the world, leaving a gold trail
      const P3 = (a, b, u, lift) => {
        const dot = clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1, 1);
        const om = Math.acos(dot), so = Math.sin(om) || 1;
        const k1 = Math.sin((1 - u) * om) / so, k2 = Math.sin(u * om) / so;
        const h = 1 + lift * Math.sin(Math.PI * u) * (0.12 + om * 0.18);
        return rot([(a[0] * k1 + b[0] * k2) * h, (a[1] * k1 + b[1] * k2) * h, (a[2] * k1 + b[2] * k2) * h]);
      };
      ctx.lineCap = 'round';
      for (const [from, to, t0] of ROUTES) {
        const a = unit(...WORLD_CITIES[from]), b = unit(...WORLD_CITIES[to]);
        const u = E.inOutSine(prog(t, t0, t0 + 0.9));
        if (u <= 0) continue;
        const hero = from === 'CI';
        const N = 40;
        for (let k = 0; k < N; k++) {
          const u0 = (k / N) * u, u1 = ((k + 1) / N) * u;
          const p0 = P3(a, b, u0, 1), p1 = P3(a, b, u1, 1);
          const behind = Math.hypot(p0[0], p0[1]) < 1 && p0[2] < 0;
          if (behind) continue;
          const tail = (k + 1) / N;
          ctx.strokeStyle = hero ? `rgba(255,226,160,${0.25 + 0.7 * tail})` : `rgba(230,201,136,${0.12 + 0.5 * tail})`;
          ctx.lineWidth = RR * (hero ? 0.012 : 0.007);
          ctx.beginPath(); ctx.moveTo(cx + p0[0] * RR, cy - p0[1] * RR); ctx.lineTo(cx + p1[0] * RR, cy - p1[1] * RR); ctx.stroke();
        }
        const head = P3(a, b, u, 1);
        if (u < 1) {
          const s = RR * (hero ? 0.05 : 0.035);
          ctx.globalCompositeOperation = 'lighter';
          ctx.drawImage(cache.glow, cx + head[0] * RR - s * 2, cy - head[1] * RR - s * 2, s * 4, s * 4);
          ctx.globalCompositeOperation = 'source-over';
          ctx.drawImage(cache.stones[hero ? 'gold' : 'ivory'], cx + head[0] * RR - s * 0.5, cy - head[1] * RR - s * 0.5, s, s);
        }
        for (const [code, pnt, when] of [[from, a, t0], [to, b, t0 + 0.9]]) {
          const q = rot(pnt);
          if (q[2] <= 0) continue;
          const pu = prog(t, when, when + 0.6);
          if (pu <= 0) continue;
          const px = cx + q[0] * RR, py = cy - q[1] * RR;
          ctx.beginPath(); ctx.arc(px, py, RR * 0.014, 0, TAU);
          ctx.fillStyle = hero ? '#fff1cf' : C.goldSoft; ctx.fill();
          if (pu < 1) {
            ctx.beginPath(); ctx.arc(px, py, RR * (0.015 + pu * 0.07), 0, TAU);
            ctx.strokeStyle = `rgba(255,226,160,${1 - pu})`; ctx.lineWidth = RR * 0.006; ctx.stroke();
          }
          const fs = RR * (hero ? 0.058 : 0.045);
          font(ctx, fs, FONT.sans, 800);
          ctx.fillStyle = hero ? `rgba(255,241,207,${clamp(pu * 2)})` : `rgba(244,234,210,${0.7 * clamp(pu * 2)})`;
          ctx.textBaseline = 'middle';
          tracked(ctx, code, px + RR * 0.035, py - RR * 0.035, fs * 0.1, 'left');
        }
      }
      ctx.restore();

      // head to head
      const hp = prog(t, T.nation + 0.15, T.nation + 0.75);
      const hv = visIn(t, T.nation + 0.15, T.ranks);
      if (hp > 0 && hv.a > 0) {
        const w = L.portrait ? L.W * 0.78 : Math.min(L.vis.s * 0.9, L.W * 0.36), h = w * 0.34;
        const x = L.portrait ? L.W / 2 - w / 2 : cx - w / 2 - R * 0.35;
        const y = L.portrait ? cy + R * 1.08 : cy + R * 0.5;
        ctx.save();
        ctx.globalAlpha = hv.a;
        ctx.translate(hv.dx * L.W * 0.5, (1 - E.outBack(hp)) * h * 0.5);
        card(ctx, x, y, w, h, h * 0.2, 0.4);
        const fh = h * 0.26, fw = fh * 1.5;
        const lx = x + w * 0.2, rx = x + w * 0.8;
        flag(ctx, 'CI', lx - fw / 2, y + h * 0.3, fw, fh);
        flag(ctx, 'FR', rx - fw / 2, y + h * 0.3, fw, fh);
        const ns = h * 0.1;
        font(ctx, ns, FONT.sans, 700);
        ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(244,234,210,0.82)';
        ctx.fillText(copy.ci, lx, y + h * 0.82);
        ctx.fillText(copy.fr, rx, y + h * 0.82);
        const sc = h * 0.36;
        font(ctx, sc, FONT.serif, 700);
        const ci = t >= T.nation + 0.8 ? 2 : 1;
        ctx.fillStyle = goldText(ctx, x + w / 2, y + h * 0.66, sc);
        ctx.fillText(`${ci} – 1`, x + w / 2, y + h * 0.66);
        if (t >= T.nation + 0.8 && t < T.nation + 1.3) {
          const u = prog(t, T.nation + 0.8, T.nation + 1.3);
          ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = hv.a * (1 - u) * 0.8;
          ctx.drawImage(cache.glow, x + w / 2 - sc * 1.2, y + h * 0.5 - sc * 0.8, sc * 2.4, sc * 1.6);
          ctx.restore();
        }
        const ls = h * 0.085;
        font(ctx, ls, FONT.sans, 800);
        ctx.fillStyle = C.gold;
        tracked(ctx, copy.h2h.toUpperCase(), x + w / 2, y + h * 0.2, ls * 0.25, 'center');
        ctx.restore();
      }
    }

    function ranksScene(ctx, L, t, copy) {
      if (t < T.ranks - 0.05 || t > T.learn + 0.05) return;
      headline(ctx, L, t, T.ranks, T.learn, copy.ranks);
      const v = visIn(t, T.ranks + 0.05, T.learn);
      if (v.a <= 0) return;
      const w = L.portrait ? L.W * 0.84 : L.vis.s * 1.0;
      const rh = w * (L.portrait ? 0.15 : 0.13);
      const rows = [
        { name: 'Aminata', cc: 'SN', r: 1642 },
        { name: 'Kwame', cc: 'GH', r: 1618 },
        { name: 'Léa', cc: 'FR', r: 1597 },
        { name: copy.you, cc: 'CI', r: 1571, you: true },
        { name: 'Moussa', cc: 'CM', r: 1540 },
      ];
      const cx = L.vis.x + v.dx * L.W;
      const top = L.vis.y - rh * 2.5 - rh * 0.1 * 2;
      const climb = E.inOutCubic(prog(t, 19.95, 20.55));
      const youR = Math.round(lerp(1571, 1655, E.outCubic(prog(t, 19.55, 20.45))));
      const x = cx - w / 2;
      ctx.save();
      ctx.globalAlpha = v.a;
      // fixed rank column
      rows.forEach((_, i) => {
        const y = top + i * rh * 1.1;
        const ap = E.outExpo(prog(t, 19.1 + i * 0.06, 19.7 + i * 0.06));
        ctx.globalAlpha = v.a * ap;
        const rs = rh * 0.36;
        font(ctx, rs, FONT.serif, 700);
        ctx.fillStyle = i === 0 ? C.gold : 'rgba(244,234,210,0.5)';
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        ctx.fillText(String(i + 1), x + rh * 0.55, y + rh / 2);
      });
      const order = rows.map((r, i) => {
        let slot = i;
        if (r.you) slot = lerp(3, 0, climb);
        else if (i < 3) slot = i + climb;
        return { ...r, slot, i };
      }).sort((a, b) => (a.you ? 1 : 0) - (b.you ? 1 : 0));
      for (const r of order) {
        const y = top + r.slot * rh * 1.1;
        const ap = E.outExpo(prog(t, 19.1 + r.i * 0.06, 19.7 + r.i * 0.06));
        ctx.save();
        ctx.globalAlpha = v.a * ap;
        ctx.translate((1 - ap) * w * 0.15, 0);
        const rx = x + rh * 0.75, rw = w - rh * 0.75;
        const hi = r.you ? 0.6 + 0.4 * climb : 0;
        if (r.you) {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = v.a * ap * 0.35 * climb;
          ctx.drawImage(cache.glow, rx - rw * 0.1, y - rh * 0.6, rw * 1.2, rh * 2.2);
          ctx.restore();
        }
        card(ctx, rx, y, rw, rh, rh * 0.28, hi);
        const fh = rh * 0.36, fw = fh * 1.5;
        flag(ctx, r.cc, rx + rh * 0.3, y + rh / 2 - fh / 2, fw, fh);
        const ns = rh * 0.3;
        font(ctx, ns, FONT.sans, r.you ? 800 : 700);
        ctx.fillStyle = r.you ? '#fff1cf' : 'rgba(244,234,210,0.88)';
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText(r.name, rx + rh * 0.3 + fw + rh * 0.25, y + rh / 2);
        const val = r.you ? youR : r.r;
        font(ctx, ns, FONT.sans, 800);
        ctx.textAlign = 'right';
        ctx.fillStyle = r.you ? C.goldSoft : 'rgba(244,234,210,0.7)';
        // digits on a fixed grid so the counter does not wobble
        const digits = String(val), dw = ns * 0.62;
        for (let k = 0; k < digits.length; k++) {
          ctx.textAlign = 'center';
          ctx.fillText(digits[k], rx + rw - rh * 0.35 - (digits.length - k - 0.5) * dw, y + rh / 2);
        }
        if (r.you) {
          const cp = prog(t, 20.45, 20.75);
          if (cp > 0) {
            const cs = rh * 0.2;
            font(ctx, cs, FONT.sans, 800);
            const label = '▲ 3  +84';
            const cw = ctx.measureText(label).width + cs * 1.2, ch = cs * 1.6;
            const bx = rx + rw - rh * 0.35 - 4 * dw - cw - rh * 0.25, by = y + rh / 2 - ch / 2;
            ctx.globalAlpha = v.a * ap * cp;
            ctx.fillStyle = 'rgba(78,122,58,0.9)';
            rrect(ctx, bx, by, cw, ch, ch / 2); ctx.fill();
            ctx.fillStyle = '#e8f6dc';
            ctx.textAlign = 'center';
            ctx.fillText(label, bx + cw / 2, by + ch / 2 + cs * 0.05);
          }
        }
        ctx.restore();
      }
      ctx.restore();
    }

    function learnScene(ctx, L, t, copy) {
      if (t < T.learn - 0.05 || t > T.anywhere + 0.1) return;
      const y = headline(ctx, L, t, T.learn, T.anywhere, copy.learn);
      // the twelve challenges, filling in
      const a = env(t, T.learn + 0.4, T.anywhere, 0.3, 0.28);
      if (a > 0 && y) {
        const s = L.m * 0.017, gap = s * 1.25;
        const x0 = L.textX + s;
        const yy = y + s * 3.4;
        ctx.save();
        ctx.globalAlpha = a;
        for (let i = 0; i < 12; i++) {
          const on = prog(t, 21.9 + i * 0.07, 22.0 + i * 0.07);
          ctx.beginPath(); ctx.arc(x0 + i * (s * 2 + gap * 0.4), yy, s, 0, TAU);
          ctx.fillStyle = on > 0 ? `rgba(212,168,69,${0.25 + 0.75 * on})` : 'rgba(244,234,210,0.12)';
          ctx.fill();
        }
        font(ctx, s * 1.5, FONT.sans, 800);
        ctx.fillStyle = C.goldSoft; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
        tracked(ctx, copy.puzzles.toUpperCase(), x0 + 12 * (s * 2 + gap * 0.4) + s * 0.6, yy + s * 0.08, s * 0.25, 'left');
        ctx.restore();
      }
    }

    function learnOverlay(t, copy) {
      // move preview: hover a pit, the pit its last seed reaches lights up
      return (ctx, cam, S) => {
        if (t < T.learn || t > T.anywhere + 0.2) return;
        const src = 2, dst = 6;
        const hp = env(t, 21.35, 22.2, 0.15, 0.2);
        if (hp > 0) {
          const d = pitPos(dst);
          ringPath(ctx, cam, d.x, d.y, PIT_R + 0.035, 0.005);
          ctx.strokeStyle = `rgba(230,201,136,${0.95 * hp})`;
          ctx.lineWidth = S * 0.035;
          ctx.shadowColor = `rgba(230,201,136,${0.6 * hp})`; ctx.shadowBlur = S * 0.3;
          ctx.stroke(); ctx.shadowBlur = 0;
          const q = cam.project(d.x, d.y, 0.05), qr = cam.project(d.x + PIT_R, d.y, 0.05);
          const rad = Math.hypot(qr.x - q.x, qr.y - q.y);
          const ls = S * 0.12;
          font(ctx, ls, FONT.sans, 800);
          ctx.fillStyle = `rgba(244,212,136,${hp})`;
          ctx.textBaseline = 'alphabetic';
          tracked(ctx, copy.lands.toUpperCase(), q.x, q.y - rad * 1.25, ls * 0.2, 'center');
          const sp = pitPos(src);
          ringPath(ctx, cam, sp.x, sp.y, PIT_R + 0.02, 0.005);
          ctx.strokeStyle = `rgba(244,234,210,${0.5 * hp})`;
          ctx.lineWidth = S * 0.02;
          ctx.stroke();
        }
        const hh = env(t, 22.15, 23.0, 0.1, 0.2);
        if (hh > 0) {
          const hpit = 4, c = pitPos(hpit);
          const pulse = 0.5 + 0.5 * Math.sin((t - 22.15) * TAU / 0.7);
          ringPath(ctx, cam, c.x, c.y, PIT_R + 0.035, 0.005);
          ctx.strokeStyle = `rgba(140,230,140,${hh * (0.6 + 0.4 * pulse)})`;
          ctx.lineWidth = S * (0.03 + 0.015 * pulse);
          ctx.shadowColor = `rgba(140,230,140,${0.75 * hh * pulse})`; ctx.shadowBlur = S * 0.3;
          ctx.stroke(); ctx.shadowBlur = 0;
          const q = cam.project(c.x, c.y, 0.05), qr = cam.project(c.x + PIT_R, c.y, 0.05);
          const rad = Math.hypot(qr.x - q.x, qr.y - q.y);
          const ls = S * 0.12;
          font(ctx, ls, FONT.sans, 800);
          ctx.fillStyle = `rgba(170,240,160,${hh})`;
          ctx.textBaseline = 'top';
          tracked(ctx, copy.hint.toUpperCase(), q.x, q.y + rad * 1.25, ls * 0.2, 'center');
        }
        // the pointer
        const pa = env(t, 21.05, 22.25, 0.2, 0.2);
        if (pa > 0) {
          const sp = pitPos(src);
          const mv = E.inOutCubic(prog(t, 21.05, 21.4));
          const from = { x: sp.x + 1.4, y: sp.y - 1.2 }, to = { x: sp.x + 0.08, y: sp.y - 0.1 };
          const q = cam.project(lerp(from.x, to.x, mv), lerp(from.y, to.y, mv), 0.35);
          const s = S * 0.34;
          ctx.save();
          ctx.globalAlpha *= pa;
          ctx.translate(q.x, q.y);
          ctx.beginPath();
          ctx.moveTo(0, 0); ctx.lineTo(0, s); ctx.lineTo(s * 0.27, s * 0.76); ctx.lineTo(s * 0.46, s * 1.12);
          ctx.lineTo(s * 0.6, s * 1.05); ctx.lineTo(s * 0.42, s * 0.7); ctx.lineTo(s * 0.74, s * 0.7); ctx.closePath();
          ctx.fillStyle = '#fbf6ea'; ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = s * 0.2; ctx.shadowOffsetY = s * 0.08;
          ctx.fill();
          ctx.shadowColor = 'transparent';
          ctx.strokeStyle = '#1a0f06'; ctx.lineWidth = s * 0.05; ctx.stroke();
          ctx.restore();
        }
      };
    }

    function laptop(ctx, x, y, w) {
      const sh = w * 0.62;
      const bez = w * 0.022;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = w * 0.08; ctx.shadowOffsetY = w * 0.03;
      rrect(ctx, x, y, w, sh, w * 0.028);
      ctx.fillStyle = '#121214'; ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = Math.max(1, w * 0.002); ctx.stroke();
      ctx.restore();
      const scr = { x: x + bez, y: y + bez, w: w - bez * 2, h: sh - bez * 2 };
      // base
      ctx.save();
      const by = y + sh;
      ctx.beginPath();
      ctx.moveTo(x - w * 0.07, by + w * 0.005);
      ctx.lineTo(x + w * 1.07, by + w * 0.005);
      ctx.lineTo(x + w * 1.05, by + w * 0.035);
      ctx.lineTo(x - w * 0.05, by + w * 0.035);
      ctx.closePath();
      const bg = ctx.createLinearGradient(0, by, 0, by + w * 0.035);
      bg.addColorStop(0, '#4a4a52'); bg.addColorStop(0.3, '#2b2b31'); bg.addColorStop(1, '#141417');
      ctx.fillStyle = bg; ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(x + w * 0.42, by + w * 0.005, w * 0.16, w * 0.008);
      ctx.restore();
      return scr;
    }

    function phone(ctx, x, y, h) {
      const w = h * 0.49;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.65)'; ctx.shadowBlur = h * 0.1; ctx.shadowOffsetY = h * 0.03;
      rrect(ctx, x, y, w, h, w * 0.16);
      ctx.fillStyle = '#0f0f12'; ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = Math.max(1, w * 0.008); ctx.stroke();
      ctx.restore();
      const b = w * 0.045;
      return { x: x + b, y: y + b, w: w - b * 2, h: h - b * 2, r: w * 0.12 };
    }

    function menuScreen(ctx, s, t, copy) {
      ctx.save();
      rrect(ctx, s.x, s.y, s.w, s.h, s.r);
      ctx.clip();
      const g = ctx.createLinearGradient(0, s.y, 0, s.y + s.h);
      g.addColorStop(0, '#6b4024'); g.addColorStop(0.35, '#472711'); g.addColorStop(0.75, '#2a160a'); g.addColorStop(1, '#1a0f06');
      ctx.fillStyle = g; ctx.fillRect(s.x, s.y, s.w, s.h);
      ctx.globalAlpha = 0.5;
      ctx.save();
      ctx.translate(s.x + s.w, s.y); ctx.rotate(Math.PI / 2);
      ctx.drawImage(cache.wood, 0, 0, cache.wood.width, cache.wood.height, 0, 0, s.h, s.w);
      ctx.restore();
      ctx.globalAlpha = 1;
      const vg = ctx.createRadialGradient(s.x + s.w / 2, s.y + s.h * 0.35, s.w * 0.2, s.x + s.w / 2, s.y + s.h / 2, s.h * 0.75);
      vg.addColorStop(0, 'rgba(8,3,0,0)'); vg.addColorStop(1, 'rgba(8,3,0,0.6)');
      ctx.fillStyle = vg; ctx.fillRect(s.x, s.y, s.w, s.h);
      // island
      ctx.fillStyle = '#000';
      rrect(ctx, s.x + s.w * 0.36, s.y + s.w * 0.035, s.w * 0.28, s.w * 0.075, s.w * 0.04); ctx.fill();
      const cx = s.x + s.w / 2;
      // chip row
      ctx.fillStyle = 'rgba(52,34,20,0.85)';
      rrect(ctx, s.x + s.w * 0.06, s.y + s.h * 0.075, s.w * 0.42, s.w * 0.1, s.w * 0.05); ctx.fill();
      ctx.beginPath(); ctx.arc(s.x + s.w * 0.11, s.y + s.h * 0.075 + s.w * 0.05, s.w * 0.033, 0, TAU); ctx.fillStyle = '#caa06e'; ctx.fill();
      for (let i = 0; i < 3; i++) {
        ctx.beginPath(); ctx.arc(s.x + s.w * (0.94 - i * 0.12), s.y + s.h * 0.075 + s.w * 0.05, s.w * 0.045, 0, TAU);
        ctx.fillStyle = 'rgba(52,34,20,0.85)'; ctx.fill();
        ctx.strokeStyle = 'rgba(212,168,69,0.35)'; ctx.lineWidth = s.w * 0.004; ctx.stroke();
      }
      // hero
      const ts = s.w * 0.17;
      ornament(ctx, cx, s.y + s.h * 0.2, ts * 0.5, 1);
      font(ctx, ts, FONT.serif, 700);
      ctx.fillStyle = C.title; ctx.textBaseline = 'alphabetic';
      tracked(ctx, 'AWALÉ', cx, s.y + s.h * 0.29, ts * 0.08, 'center');
      const tg = s.w * 0.028;
      font(ctx, tg, FONT.sans, 700);
      ctx.fillStyle = C.gold;
      const tl = copy.tagline.toUpperCase();
      const tw = trackedWidth(ctx, tl, tg * 0.22);
      if (tw > s.w * 0.9) font(ctx, tg * s.w * 0.9 / tw, FONT.sans, 700);
      tracked(ctx, tl, cx, s.y + s.h * 0.33, tg * 0.22 * Math.min(1, s.w * 0.9 / tw), 'center');
      // the four menu entries
      copy.menu.forEach(([title, sub], i) => {
        const ph = s.h * 0.085, py = s.y + s.h * 0.42 + i * ph * 1.22, px = s.x + s.w * 0.07, pw = s.w * 0.86;
        const ap = E.outExpo(prog(t, 23.35 + i * 0.08, 23.9 + i * 0.08));
        ctx.save();
        ctx.globalAlpha *= ap;
        ctx.translate(0, (1 - ap) * ph * 0.6);
        rrect(ctx, px, py, pw, ph, ph * 0.3);
        const pg = ctx.createLinearGradient(0, py, 0, py + ph);
        if (i === 0) { pg.addColorStop(0, '#4e7a3a'); pg.addColorStop(1, '#366026'); } else { pg.addColorStop(0, 'rgba(52,34,20,0.9)'); pg.addColorStop(1, 'rgba(30,19,11,0.92)'); }
        ctx.fillStyle = pg; ctx.fill();
        ctx.strokeStyle = 'rgba(212,168,69,0.3)'; ctx.lineWidth = s.w * 0.004; ctx.stroke();
        ctx.beginPath(); ctx.arc(px + ph * 0.52, py + ph / 2, ph * 0.26, 0, TAU);
        ctx.fillStyle = i === 0 ? 'rgba(255,255,255,0.18)' : 'rgba(212,168,69,0.18)'; ctx.fill();
        const fs = ph * 0.26;
        font(ctx, fs, FONT.sans, 800);
        ctx.fillStyle = '#fbf3e0'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        const tx = px + ph * 0.98;
        let tt = title;
        const maxW = pw - ph * 1.15;
        let fsz = fs;
        if (ctx.measureText(tt).width > maxW) { fsz = fs * maxW / ctx.measureText(tt).width; font(ctx, fsz, FONT.sans, 800); }
        ctx.fillText(tt, tx, py + ph * 0.46);
        font(ctx, fs * 0.72, FONT.sans, 500);
        ctx.fillStyle = 'rgba(244,234,210,0.66)';
        let st = sub;
        while (ctx.measureText(st).width > maxW && st.length > 4) st = st.slice(0, -2) + '…';
        ctx.fillText(st, tx, py + ph * 0.78);
        ctx.restore();
      });
      ctx.restore();
    }

    function anywhereScene(ctx, L, t, copy) {
      if (t < T.anywhere - 0.3 || t > T.cta + 0.6) return;
      const out = E.inCubic(prog(t, T.cta - 0.1, T.cta + 0.45));
      const a = 1 - out;
      if (a <= 0) { headline(ctx, L, t, T.anywhere + 0.05, T.cta, copy.anywhere); return; }
      const lw = L.wide ? L.W * 0.44 : L.portrait ? L.W * 0.8 : L.W * 0.66;
      const lcx = L.wide ? L.W * 0.66 : L.portrait ? L.W * 0.44 : L.W * 0.46;
      const lcy = L.wide ? L.H * 0.47 : L.portrait ? L.H * 0.47 : L.H * 0.62;
      // the laptop grows out of the full-frame board, then settles
      const zin = E.inOutCubic(prog(t, T.anywhere - 0.2, T.anywhere + 0.55));
      const k = lerp(L.W / (lw * 0.956), 1, zin);
      const w = lw * k;
      const sh = w * 0.62;
      const x = lerp(L.W / 2, lcx, zin) - w / 2;
      const y = lerp(L.H / 2, lcy, zin) - sh / 2 + out * L.H * 0.3;
      ctx.save();
      ctx.globalAlpha = a * clamp(prog(t, T.anywhere - 0.3, T.anywhere - 0.05) * 1.0);
      const scr = laptop(ctx, x, y, w);
      ctx.save();
      ctx.beginPath(); ctx.rect(scr.x, scr.y, scr.w, scr.h); ctx.clip();
      const tg = ctx.createLinearGradient(0, scr.y, 0, scr.y + scr.h);
      tg.addColorStop(0, '#6b4024'); tg.addColorStop(0.5, '#472711'); tg.addColorStop(1, '#1a0f06');
      ctx.fillStyle = tg; ctx.fillRect(scr.x, scr.y, scr.w, scr.h);
      const cam = makeCam({ tx: 0, ty: 0, yaw: 0, pitch: 80 * Math.PI / 180, dist: 11, zoom: 1.05, ax: 0.5, ay: 0.54 }, scr);
      drawBoard(ctx, L, cam, t, {
        pills: 0, noBlur: true,
        extra: (c2, cm, S) => {
          const pp = pitPos(2 + (Math.floor((t - 23) * 1.2) % 4));
          ringPath(c2, cm, pp.x, pp.y, PIT_R + 0.035, 0.005);
          c2.strokeStyle = 'rgba(230,201,136,0.85)'; c2.lineWidth = S * 0.03; c2.stroke();
        },
      });
      ctx.restore();
      // glare
      ctx.save();
      ctx.beginPath(); ctx.rect(scr.x, scr.y, scr.w, scr.h); ctx.clip();
      const gl = ctx.createLinearGradient(scr.x, scr.y, scr.x + scr.w, scr.y + scr.h);
      gl.addColorStop(0, 'rgba(255,255,255,0.07)'); gl.addColorStop(0.45, 'rgba(255,255,255,0)');
      ctx.fillStyle = gl; ctx.fillRect(scr.x, scr.y, scr.w, scr.h);
      ctx.restore();
      ctx.restore();

      // the phone slides in front
      const pin = E.outExpo(prog(t, T.anywhere + 0.3, T.anywhere + 1.0));
      if (pin > 0) {
        const ph = L.wide ? L.H * 0.66 : L.portrait ? L.H * 0.42 : L.H * 0.54;
        const px = (L.wide ? L.W * 0.84 : L.portrait ? L.W * 0.76 : L.W * 0.78) - ph * 0.245 + (1 - pin) * L.W * 0.3;
        const py = (L.wide ? L.H * 0.55 : L.portrait ? L.H * 0.66 : L.H * 0.66) - ph / 2 + Math.sin(t * 1.4) * ph * 0.006 + out * L.H * 0.4;
        ctx.save();
        ctx.globalAlpha = a * clamp(pin * 1.5);
        const s = phone(ctx, px, py, ph);
        menuScreen(ctx, s, t, copy);
        ctx.restore();
      }
      headline(ctx, L, t, T.anywhere + 0.05, T.cta, copy.anywhere);
      // languages
      const la = env(t, T.anywhere + 0.7, T.cta, 0.4, 0.3);
      if (la > 0) {
        const fs = L.m * 0.022;
        font(ctx, fs, FONT.sans, 800);
        const label = copy.langs.toUpperCase();
        const lwid = trackedWidth(ctx, label, fs * 0.22) + fs * 2.4, h = fs * 2.3;
        const bx = L.textX, by = L.portrait ? L.H * 0.91 - h : L.wide ? L.H * 0.84 - h : L.H * 0.93 - h;
        ctx.save();
        ctx.globalAlpha = la;
        ctx.fillStyle = 'rgba(20,12,6,0.75)';
        rrect(ctx, bx, by, lwid, h, h / 2); ctx.fill();
        ctx.strokeStyle = 'rgba(212,168,69,0.45)'; ctx.lineWidth = Math.max(1, fs * 0.08); ctx.stroke();
        ctx.fillStyle = C.goldSoft; ctx.textBaseline = 'middle';
        tracked(ctx, label, bx + fs * 1.2, by + h / 2 + fs * 0.05, fs * 0.22, 'left');
        ctx.restore();
      }
    }

    function ctaScene(ctx, L, t, copy) {
      if (t < T.cta - 0.1) return;
      const cx = L.W / 2;
      const m = L.m;
      const ys = L.portrait
        ? { logo: 0.3, title: 0.47, tag: 0.52, pill: 0.63, url: 0.705 }
        : { logo: 0.26, title: 0.53, tag: 0.605, pill: 0.73, url: 0.83 };
      rays(ctx, L, cx, L.H * ys.logo - m * 0.4, env(t, 26.6, 31, 0.8, 0.1) * 0.8, t);
      dust(ctx, L, t, env(t, 26.2, 31, 1.0, 0.1), 46);
      // the mark: a pit holding three seeds, as in the app's icon
      const lr = m * 0.085;
      const lx = cx, ly = L.H * ys.logo;
      const bowl = E.outBack(prog(t, 26.55, 27.05));
      if (bowl > 0) {
        ctx.save();
        ctx.translate(lx, ly); ctx.scale(bowl, bowl);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.45 * clamp(bowl);
        ctx.drawImage(cache.glow, -lr * 2.6, -lr * 2.6, lr * 5.2, lr * 5.2);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.arc(0, 0, lr * 1.08, 0, TAU);
        ctx.fillStyle = '#7a4a26'; ctx.fill();
        ctx.strokeStyle = 'rgba(212,168,69,0.6)'; ctx.lineWidth = lr * 0.04; ctx.stroke();
        pitDisc(ctx, 0, 0, lr * 0.92, 0);
        ctx.restore();
      }
      // three seeds spiral in and land in the bowl
      const marks = [['ivory', -0.24, -0.16, 26.35], ['green', 0.24, -0.12, 26.45], ['gold', 0.0, 0.26, 26.55]];
      marks.forEach(([col, ox, oy, t0], i) => {
        const land = t0 + 0.75;
        const u = prog(t, t0, land);
        if (u <= 0) return;
        const e = E.inOutCubic(u);
        const ang = (1 - e) * (2.4 + i * 0.6) + i * 2.1;
        const rad = (1 - e) * m * 0.75;
        const tx = lx + ox * lr * 1.6, ty = ly + oy * lr * 1.6;
        const x = tx + Math.cos(ang) * rad, y = ty + Math.sin(ang) * rad * 0.7 - Math.sin(Math.PI * e) * m * 0.05;
        const s = lr * 0.34 * (1 + (1 - e) * 0.6);
        if (u < 1) {
          ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.5 * (1 - e);
          ctx.drawImage(cache.glow, x - s * 3, y - s * 3, s * 6, s * 6); ctx.restore();
        }
        const b = t > land ? Math.max(0, Math.sin((t - land) * 18) * Math.exp(-(t - land) * 9)) * s * 0.3 : 0;
        ctx.drawImage(cache.stones[col], x - s, y - s - b, s * 2, s * 2);
      });
      const tsize = m * (L.portrait ? 0.17 : 0.16);
      wordmark(ctx, L, t, 27.0, cx, L.H * ys.title, tsize, 28.3);
      const tp = prog(t, 27.35, 27.9);
      if (tp > 0) {
        const ts = tsize * 0.12;
        font(ctx, ts, FONT.sans, 700);
        ctx.save();
        ctx.globalAlpha = clamp(tp * 1.5);
        ctx.fillStyle = C.gold; ctx.textBaseline = 'alphabetic';
        const txt = copy.tagline.toUpperCase();
        let track = ts * lerp(0.7, 0.3, E.outCubic(tp));
        const w = trackedWidth(ctx, txt, track);
        if (w > L.W * 0.88) { const k = L.W * 0.88 / w; font(ctx, ts * k, FONT.sans, 700); track *= k; }
        tracked(ctx, txt, cx, L.H * ys.tag, track, 'center');
        ctx.restore();
      }
      // call to action
      const pp = prog(t, 27.7, 28.25);
      if (pp > 0) {
        const ps = m * 0.04;
        font(ctx, ps, FONT.sans, 800);
        const label = copy.cta.toUpperCase();
        const lw = trackedWidth(ctx, label, ps * 0.14);
        const pw = lw + ps * 3.6, ph = ps * 2.4;
        const e = E.outBack(pp);
        ctx.save();
        ctx.translate(cx, L.H * ys.pill);
        ctx.scale(lerp(0.85, 1, e), lerp(0.85, 1, e));
        ctx.globalAlpha = clamp(pp * 2);
        ctx.shadowColor = 'rgba(212,168,69,0.5)'; ctx.shadowBlur = ph * 0.6;
        rrect(ctx, -pw / 2, -ph / 2, pw, ph, ph / 2);
        const g = ctx.createLinearGradient(0, -ph / 2, 0, ph / 2);
        g.addColorStop(0, '#f1d68f'); g.addColorStop(1, '#c9953a');
        ctx.fillStyle = g; ctx.fill();
        ctx.shadowColor = 'transparent';
        // light glancing across the button
        const gp = ((t - 28.3) % 1.6) / 1.6;
        if (t > 28.3) {
          ctx.save(); ctx.clip();
          const gx = -pw / 2 - ph + gp * (pw + ph * 2);
          const sg = ctx.createLinearGradient(gx - ph, 0, gx + ph, 0);
          sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(0.5, 'rgba(255,255,255,0.45)'); sg.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = sg; ctx.fillRect(-pw / 2, -ph / 2, pw, ph);
          ctx.restore();
        }
        ctx.fillStyle = '#2a1a0e'; ctx.textBaseline = 'middle';
        tracked(ctx, label, -ps * 0.55, ps * 0.06, ps * 0.14, 'center');
        // arrow
        const ax = lw / 2 + ps * 0.3;
        ctx.strokeStyle = '#2a1a0e'; ctx.lineWidth = ps * 0.13; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath(); ctx.moveTo(ax, 0); ctx.lineTo(ax + ps * 0.8, 0); ctx.moveTo(ax + ps * 0.45, -ps * 0.35); ctx.lineTo(ax + ps * 0.8, 0); ctx.lineTo(ax + ps * 0.45, ps * 0.35);
        ctx.stroke();
        ctx.restore();
      }
      const up = prog(t, 27.95, 28.5);
      if (up > 0 && state.url) {
        const us = m * 0.034;
        font(ctx, us, FONT.sans, 600);
        ctx.save();
        ctx.globalAlpha = clamp(up * 1.5);
        ctx.fillStyle = C.ivory; ctx.textBaseline = 'alphabetic';
        let size = us;
        const w = ctx.measureText(state.url).width;
        if (w > L.W * 0.86) { size = us * L.W * 0.86 / w; font(ctx, size, FONT.sans, 600); }
        reveal(ctx, up, cx, L.H * ys.url, size, () => {
          ctx.textAlign = 'center';
          ctx.fillText(state.url, cx, L.H * ys.url);
        });
        ctx.restore();
      }
    }

    function post(ctx, L, t) {
      const { W, H } = L;
      // bloom: a soft copy of the frame, screened back over itself
      const b = cache.bloom, bg = b.getContext('2d');
      bg.globalCompositeOperation = 'copy';
      bg.imageSmoothingQuality = 'high';
      bg.drawImage(ctx.canvas, 0, 0, b.width, b.height);
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = 0.16;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(b, 0, 0, W, H);
      ctx.restore();
      // vignette
      const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.62);
      v.addColorStop(0, 'rgba(8,3,0,0)');
      v.addColorStop(1, 'rgba(8,3,0,0.62)');
      ctx.fillStyle = v;
      ctx.fillRect(0, 0, W, H);
      // film grain, re-dealt 24 times a second whatever the export rate
      const f = Math.floor(t * 24);
      const r = rng(f + 1);
      const tile = cache.grain;
      const scale = Math.max(1, Math.round(L.m / 900));
      const ts = tile.width * scale;
      ctx.save();
      ctx.globalCompositeOperation = 'overlay';
      ctx.globalAlpha = 0.07;
      const ox = -r() * ts, oy = -r() * ts;
      for (let y = oy; y < H; y += ts) for (let x = ox; x < W; x += ts) ctx.drawImage(tile, x, y, ts, ts);
      ctx.restore();
      // fade in from black
      const fin = 1 - prog(t, 0, 0.35);
      if (fin > 0) { ctx.fillStyle = `rgba(0,0,0,${fin})`; ctx.fillRect(0, 0, W, H); }
    }

    let cam0 = null, camNow = null;

    function render(ctx, t) {
      const W = ctx.canvas.width, H = ctx.canvas.height;
      t = clamp(t, 0, DURATION);
      ensure(W, H);
      const L = layout(W, H);
      const copy = COPY[state.lang] || COPY.en;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.imageSmoothingEnabled = true;
      background(ctx, L, t);
      const vp = { x: 0, y: 0, w: W, h: H };
      camNow = makeCam(viewAt(t, L), vp);
      cam0 = camNow;
      // the board: sharp for the rules, out of focus behind the montage,
      // sharp again for Learn, then handed over to the laptop's screen
      const blur = t < 13.9 ? 0 : t < 14.5 ? E.inOutSine(prog(t, 13.9, 14.5)) : t < 20.9 ? 1 : 1 - E.inOutSine(prog(t, 20.9, 21.35));
      const alpha = t < 22.85 ? 1 : 1 - prog(t, 22.85, 23.15);
      if (t < 23.2) {
        dust(ctx, L, t, env(t, 3.8, 7.3, 0.8, 0.6) * 1.0, 36);
        boardWithFocus(ctx, L, camNow, t, blur, alpha, { extra: learnOverlay(t, copy) });
        // montage: dim the board so the cards read
        const dim = t < 14 ? 0 : t < 14.5 ? prog(t, 14, 14.5) : t < 20.9 ? 1 : 1 - prog(t, 20.9, 21.3);
        if (dim > 0) {
          ctx.fillStyle = `rgba(8,4,2,${0.55 * dim})`;
          ctx.fillRect(0, 0, W, H);
          if (L.wide) {
            const lg = ctx.createLinearGradient(0, 0, W * 0.55, 0);
            lg.addColorStop(0, `rgba(8,4,2,${0.5 * dim})`); lg.addColorStop(1, 'rgba(8,4,2,0)');
            ctx.fillStyle = lg; ctx.fillRect(0, 0, W, H);
          }
        }
        if (t > 20.9 && t < 23.2 && L.wide) {
          const lg = ctx.createLinearGradient(0, 0, W * 0.5, 0);
          const a2 = env(t, 20.9, 23.2, 0.4, 0.3);
          lg.addColorStop(0, `rgba(8,4,2,${0.75 * a2})`); lg.addColorStop(1, 'rgba(8,4,2,0)');
          ctx.fillStyle = lg; ctx.fillRect(0, 0, W, H);
        }
        if (t > 20.9 && t < 23.2 && !L.wide) {
          const lg = ctx.createLinearGradient(0, 0, 0, H * 0.45);
          const a2 = env(t, 20.9, 23.2, 0.4, 0.3);
          lg.addColorStop(0, `rgba(8,4,2,${0.8 * a2})`); lg.addColorStop(1, 'rgba(8,4,2,0)');
          ctx.fillStyle = lg; ctx.fillRect(0, 0, W, H);
        }
      }
      hookScene(ctx, L, t, copy);
      titleScene(ctx, L, t, copy);
      rulesScene(ctx, L, t, copy);
      aiScene(ctx, L, t, copy);
      globeScene(ctx, L, t, copy);
      ranksScene(ctx, L, t, copy);
      learnScene(ctx, L, t, copy);
      anywhereScene(ctx, L, t, copy);
      ctaScene(ctx, L, t, copy);
      post(ctx, L, t);
      ctx.restore();
    }

    return {
      render,
      set(o) { if (o.lang) state.lang = o.lang; if (o.url !== undefined) state.url = o.url; },
      get options() { return { ...state }; },
      plan,
    };
  }

  /* ========================================================== soundtrack */
  function b64ToBuf(dataUri) {
    const b64 = dataUri.slice(dataUri.indexOf(',') + 1);
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  }

  async function buildSoundtrack(plan, opts) {
    opts = opts || {};
    const SR = opts.sampleRate || 48000;
    const Ctx = global.OfflineAudioContext || global.webkitOfflineAudioContext;
    const ac = new Ctx(2, Math.ceil(SR * DURATION), SR);
    const pack = global.AWALE_PROMO_SOUNDS || {};
    const buf = {};
    await Promise.all(Object.keys(pack).map(async name => {
      try {
        buf[name] = await new Promise((res, rej) => {
          const p = ac.decodeAudioData(b64ToBuf(pack[name]), res, rej);
          if (p && p.then) p.then(res, rej);
        });
      } catch { /* a clip that will not decode falls back to synthesis */ }
    }));
    const R = rng(4242);
    const rnd = (a, b) => a + (b - a) * R();

    const master = ac.createGain(); master.gain.value = 1.12;
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 10; comp.ratio.value = 3.2; comp.attack.value = 0.004; comp.release.value = 0.22;
    // a brick wall after the glue compressor, so the louder mix never clips
    const limit = ac.createDynamicsCompressor();
    limit.threshold.value = -2.5; limit.knee.value = 0; limit.ratio.value = 20; limit.attack.value = 0.001; limit.release.value = 0.08;
    master.connect(comp).connect(limit).connect(ac.destination);
    // a synthetic room: stereo noise, decaying
    const verb = ac.createConvolver();
    {
      const len = Math.floor(SR * 2.4), ir = ac.createBuffer(2, len, SR), r2 = rng(77);
      for (let ch = 0; ch < 2; ch++) {
        const d = ir.getChannelData(ch);
        for (let i = 0; i < len; i++) d[i] = (r2() * 2 - 1) * Math.pow(1 - i / len, 3.2) * (i < SR * 0.012 ? i / (SR * 0.012) : 1);
      }
      verb.buffer = ir;
    }
    const verbOut = ac.createGain(); verbOut.gain.value = 0.3;
    verb.connect(verbOut).connect(master);
    const sfx = ac.createGain(); sfx.gain.value = 1;
    sfx.connect(master);
    const send = ac.createGain(); send.gain.value = 0.45;
    sfx.connect(send).connect(verb);

    function out(pan) {
      if (!pan || !ac.createStereoPanner) return sfx;
      const p = ac.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); p.connect(sfx); return p;
    }
    function clip(name, t, gain, rate, pan) {
      const b = buf[name];
      if (!b || t < 0 || t > DURATION) return false;
      const s = ac.createBufferSource(); s.buffer = b; s.playbackRate.value = rate || 1;
      const g = ac.createGain(); g.gain.value = gain;
      s.connect(g).connect(out(pan));
      s.start(t);
      return true;
    }
    let noiseBuf = null;
    function noise() {
      if (noiseBuf) return noiseBuf;
      noiseBuf = ac.createBuffer(1, SR * 2, SR);
      const d = noiseBuf.getChannelData(0), r3 = rng(9);
      for (let i = 0; i < d.length; i++) d[i] = r3() * 2 - 1;
      return noiseBuf;
    }
    function tone(t, f, g, decay, type, pan, f2) {
      const o = ac.createOscillator(); o.type = type || 'sine';
      o.frequency.setValueAtTime(f, t);
      if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + decay * 0.5);
      const a = ac.createGain();
      a.gain.setValueAtTime(0.0001, t);
      a.gain.exponentialRampToValueAtTime(g, t + 0.006);
      a.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      o.connect(a).connect(out(pan));
      o.start(t); o.stop(t + decay + 0.05);
    }
    // kalimba-ish: a sine, a quick inharmonic tine, a click
    function pluck(t, f, g, pan) {
      tone(t, f, g, 1.3, 'sine', pan);
      tone(t, f * 5.95, g * 0.18, 0.12, 'sine', pan);
      tone(t, f * 2, g * 0.12, 0.5, 'triangle', pan);
    }
    function boom(t, g) {
      tone(t, 92, g, 1.3, 'sine', 0, 36);
      const n = ac.createBufferSource(); n.buffer = noise();
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260;
      const a = ac.createGain();
      a.gain.setValueAtTime(g * 0.5, t); a.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      n.connect(lp).connect(a).connect(sfx); n.start(t); n.stop(t + 0.4);
    }
    function whoosh(t, dur, g) {
      const t0 = t - dur;
      if (t0 < 0) return;
      const n = ac.createBufferSource(); n.buffer = noise();
      const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.9;
      bp.frequency.setValueAtTime(260, t0); bp.frequency.exponentialRampToValueAtTime(3200, t);
      const a = ac.createGain();
      a.gain.setValueAtTime(0.0001, t0); a.gain.exponentialRampToValueAtTime(g, t - dur * 0.15); a.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      n.connect(bp).connect(a).connect(out(0)); n.start(t0); n.stop(t + 0.15);
    }
    function shimmer(t, g, dur) {
      const n = ac.createBufferSource(); n.buffer = noise(); n.loop = true;
      const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 6500;
      const a = ac.createGain();
      a.gain.setValueAtTime(0.0001, t); a.gain.exponentialRampToValueAtTime(g, t + 0.02); a.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      n.connect(hp).connect(a).connect(send); n.start(t); n.stop(t + dur + 0.05);
    }
    function drop(t, n, g, rate, pan) {
      const name = n <= 1 ? 'drop-' + (1 + Math.floor(R() * 6)) : 'drop-seeds-' + (1 + Math.floor(R() * 4));
      if (!clip(name, t, g, rate, pan)) tone(t, rnd(700, 950), g * 0.4, 0.08, 'sine', pan, 300);
    }
    const panOf = p => (pitPos(p).x / 4) * 0.6;

    // ---- music: the app's own djembe loop, 120 bpm ------------------------
    const dj = buf['djembe-loop'];
    if (dj) {
      const s = ac.createBufferSource(); s.buffer = dj; s.loop = true; s.loopStart = 0.055; s.loopEnd = 8.055;
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.8;
      lp.frequency.setValueAtTime(300, 0);
      lp.frequency.setValueAtTime(300, 3.0);
      lp.frequency.exponentialRampToValueAtTime(18000, 4.0);
      lp.frequency.setValueAtTime(18000, 25.5);
      lp.frequency.exponentialRampToValueAtTime(650, 26.3);
      lp.frequency.setValueAtTime(650, 26.95);
      lp.frequency.exponentialRampToValueAtTime(18000, 27.05);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, 0);
      g.gain.setValueAtTime(0.0001, 2.0);
      g.gain.exponentialRampToValueAtTime(0.55, 2.6);
      g.gain.linearRampToValueAtTime(0.8, 4.0);
      g.gain.setValueAtTime(0.8, 25.5);
      g.gain.linearRampToValueAtTime(0.5, 26.4);
      g.gain.setValueAtTime(0.5, 26.95);
      g.gain.linearRampToValueAtTime(0.85, 27.05);
      g.gain.setValueAtTime(0.85, 27.98);
      g.gain.linearRampToValueAtTime(0.0001, 28.06);
      s.connect(lp).connect(g).connect(master);
      s.start(2.0, 0.055);
      s.stop(28.2);
    }
    // a low bed under the opening, before the drums
    {
      const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = 55;
      const o2 = ac.createOscillator(); o2.type = 'sine'; o2.frequency.value = 82.4;
      const a = ac.createGain();
      a.gain.setValueAtTime(0.0001, 0); a.gain.exponentialRampToValueAtTime(0.12, 1.0); a.gain.setValueAtTime(0.12, 3.2); a.gain.exponentialRampToValueAtTime(0.0001, 4.2);
      o.connect(a); o2.connect(a); a.connect(master);
      o.start(0); o2.start(0); o.stop(4.3); o2.stop(4.3);
    }

    // ---- hook ---------------------------------------------------------------
    for (const e of plan.ev) {
      if (e.type === 'hero') { clip('drop-6', e.t, 1.0, 0.9, 0) || tone(e.t, 800, 0.4, 0.1); boom(e.t, 0.55); pluck(e.t, 440, 0.12, 0); }
      if (e.type === 'rain') drop(e.t, e.n, rnd(0.18, 0.34), rnd(0.9, 1.15), panOf(e.p));
    }
    pluck(2.0, 523.25, 0.1, -0.3);
    pluck(3.0, 587.33, 0.1, 0.3);
    // ---- title --------------------------------------------------------------
    boom(4.0, 0.8);
    shimmer(4.0, 0.12, 1.8);
    [220, 329.63, 440, 523.25].forEach((f, i) => pluck(4.0 + i * 0.03, f, 0.14, (i - 1.5) * 0.3));
    whoosh(7.05, 0.5, 0.18);
    // ---- the game -----------------------------------------------------------
    const scale = [440, 523.25, 587.33, 659.25, 783.99, 880];
    for (const e of plan.ev) {
      if (e.type === 'legal') clip('tap-1', e.t1, 0.5, 1, panOf(e.p)) || tone(e.t1, 1400, 0.2, 0.05);
      if (e.type === 'drop' && e.t > 6) drop(e.t, e.n, e.fast ? 0.12 : 0.55, e.fast ? rnd(1.15, 1.35) : rnd(0.95, 1.08), panOf(e.p));
      if (e.type === 'capture') {
        if (e.fast) { clip('scoop-2', e.t, 0.18, 1.3, panOf(e.p)); pluck(e.t, scale[Math.min(5, e.chain)] * 2, 0.05, panOf(e.p)); }
        else { clip('scoop-2', e.t, 0.45, rnd(0.95, 1.05), panOf(e.p)); pluck(e.t, scale[Math.min(5, e.chain)], 0.2, panOf(e.p)); }
      }
      if (e.type === 'store' && !e.fast) clip('drop-2', e.t, 0.1, 1.4, -0.4);
    }
    clip('victory-1', plan.winT, 0.7, 1, 0) || [523.25, 659.25, 783.99].forEach((f, i) => pluck(plan.winT + i * 0.08, f, 0.2, 0));
    // ---- montage ------------------------------------------------------------
    whoosh(14.0, 0.45, 0.2);
    clip('drop-many', 14.2, 0.18, 1.1, 0);
    [329.63, 392, 440, 523.25].forEach((f, i) => { pluck(14.3 + i * 0.25, f, 0.16, (i - 1.5) * 0.25); drop(14.3 + i * 0.25, 1, 0.25, 1.1, (i - 1.5) * 0.25); });
    whoosh(16.0, 0.45, 0.2);
    ROUTES.forEach(([, , t0], i) => pluck(t0 + 0.9, [587.33, 659.25, 783.99, 880, 987.77, 1046.5][i], 0.07, (i % 2 ? 0.4 : -0.4)));
    whoosh(17.5, 0.35, 0.12);
    boom(17.5, 0.25);
    whoosh(19.0, 0.45, 0.2);
    for (let i = 0; i < 12; i++) tone(19.6 + i * 0.07, 1800 + i * 40, 0.025, 0.04, 'sine', 0.3);
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => pluck(20.0 + i * 0.12, f, 0.13, 0.2));
    whoosh(21.0, 0.45, 0.2);
    clip('tap-1', 21.4, 0.35, 1.1, 0.2) || tone(21.4, 1400, 0.15, 0.05);
    pluck(21.5, 659.25, 0.12, 0.3);
    pluck(22.15, 523.25, 0.08, 0.1); pluck(22.5, 523.25, 0.06, 0.1);
    for (let i = 0; i < 12; i++) tone(21.95 + i * 0.07, 1200 + i * 60, 0.02, 0.05, 'sine', -0.3);
    whoosh(23.0, 0.5, 0.22);
    clip('tap-1', 23.6, 0.3, 1.2, 0.4);
    // ---- end card -----------------------------------------------------------
    whoosh(26.0, 0.6, 0.22);
    [26.35, 26.45, 26.55].forEach((t0, i) => drop(t0 + 0.75, 1, 0.5, 1 + i * 0.05, (i - 1) * 0.3));
    boom(27.0, 0.7);
    [220, 329.63, 440, 523.25, 659.25].forEach((f, i) => pluck(27.0 + i * 0.045, f, 0.13, (i - 2) * 0.25));
    shimmer(27.0, 0.08, 2.0);
    boom(28.0, 0.5);
    clip('drop-many', 28.0, 0.4, 1, 0);
    [440, 659.25].forEach((f, i) => pluck(28.0 + i * 0.05, f, 0.1, 0));
    shimmer(28.3, 0.05, 1.6);
    // a low chord that holds under the end card instead of dead air
    [110, 164.81, 220].forEach((f, i) => {
      const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const a = ac.createGain();
      a.gain.setValueAtTime(0.0001, 27.0); a.gain.exponentialRampToValueAtTime(0.05 - i * 0.012, 27.6); a.gain.setValueAtTime(0.05 - i * 0.012, 28.6); a.gain.exponentialRampToValueAtTime(0.0001, 29.95);
      o.connect(a).connect(send); o.connect(a).connect(master);
      o.start(27.0); o.stop(30);
    });

    return ac.startRendering();
  }

  global.AwaleFilm = { DURATION, CHAPTERS, COPY, create, buildSoundtrack, FONT };
})(typeof window !== 'undefined' ? window : globalThis);
