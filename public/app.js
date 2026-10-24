"use strict";
/* =====================================================================
   Constants
   ===================================================================== */
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
// Woodpusher weakens Stockfish itself: shallower search, less time, a softmax choice among the best
// few moves whose "temperature" rises as the rating falls, and random moves at the lowest ratings.
// The numbers are estimates, not an official calibration.
const ELO_MIN = 400, ELO_MAX = 2800, ELO_STEP = 50, ELO_DEFAULT = 1200;
const LEVEL_TO_ELO = { 1: 600, 2: 800, 3: 1000, 4: 1200, 5: 1500, 6: 1800, 7: 2100, 8: 2600 };
const ELO_BANDS = [
  [700, 'Novice', 'Hangs pieces and misses simple threats. A gentle start.'],
  [1000, 'Beginner', 'Knows how the pieces move but drops material often.'],
  [1300, 'Casual', 'Plays sensible moves and slips under pressure.'],
  [1600, 'Club player', 'Solid and steady. Punishes loose pieces.'],
  [1900, 'Strong club player', 'Sees short combinations and rarely gives things away.'],
  [2200, 'Expert', 'Calculates well and grinds out endgames.'],
  [2500, 'Master level', 'Deep tactics and precise technique.'],
  [Infinity, 'Grandmaster level', 'Calculates deeply and rarely slips. The top of the scale.'],
];
const eloBand = (e) => ELO_BANDS.find(x => e < x[0]);
const eloLabel = (e) => `≈${e} · ${eloBand(e)[1]}`;
// The recipe was written for Stockfish 10. Stockfish 19 plays the same recipe much stronger (about
// 340 Elo at the 2000 setting), so each Elo setting now uses the notch of the recipe that scored even
// against Stockfish 10 at that setting, in bot-against-bot matches from 16 openings with colours swapped.
const ELO_RECIPE = [[400, 480], [800, 790], [1200, 1100], [1600, 1500], [2000, 1740], [2400, 2050], [2800, 2350]];
function eloParams(e) {
  const T = ELO_RECIPE; let x = T[T.length - 1][1];
  if (e <= T[0][0]) x = T[0][1];
  else for (let i = 1; i < T.length; i++) if (e <= T[i][0]) { const [e0, x0] = T[i - 1], [e1, x1] = T[i]; x = x0 + (x1 - x0) * (e - e0) / (e1 - e0); break; }
  return eloRecipe(Math.round(x));
}
function eloRecipe(e) {
  const t = clamp((e - ELO_MIN) / (ELO_MAX - ELO_MIN), 0, 1);
  return {
    depth: Math.round(1 + 17 * t),                       // 1 at 400, 18 at 2800
    movetime: Math.round(60 + 1440 * t * t),             // 60 ms up to 1.5 s
    multipv: e >= 2600 ? 1 : 4,                          // the strongest settings always play the top move
    temp: 3 + 300 * Math.pow(1 - t, 2.4),                // centipawns; ~300 at 400, ~60 at 1600, ~6 at 2400
    blunder: e < 1100 ? 0.25 * Math.pow((1100 - e) / 700, 1.3) : 0, // random move chance for the lowest ratings
  };
}
const lineScore = (l) => (l.mate != null ? (l.mate > 0 ? 10000 - l.mate : -10000 - l.mate) : l.cp);
function pickByTemperature(lines, temp) {
  const ls = lines.filter(l => l && l.pv && l.pv.length); if (!ls.length) return null;
  const sc = ls.map(lineScore); const best = Math.max(...sc);
  const w = sc.map(x => Math.exp(-(best - x) / temp)); let r = Math.random() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < ls.length; i++) { r -= w[i]; if (r <= 0) return ls[i]; }
  return ls[0];
}
const TCS = [
  { id: '1+0', base: 60, inc: 0, kind: 'Bullet' },
  { id: '3+0', base: 180, inc: 0, kind: 'Blitz' },
  { id: '3+2', base: 180, inc: 2, kind: 'Blitz' },
  { id: '5+0', base: 300, inc: 0, kind: 'Blitz' },
  { id: '5+3', base: 300, inc: 3, kind: 'Blitz' },
  { id: '10+0', base: 600, inc: 0, kind: 'Rapid' },
  { id: '10+5', base: 600, inc: 5, kind: 'Rapid' },
  { id: '15+10', base: 900, inc: 10, kind: 'Rapid' },
  { id: '30+0', base: 1800, inc: 0, kind: 'Classical' },
  { id: 'none', base: 0, inc: 0, kind: 'Untimed' },
];
const THUMB_SVG = '<svg class="sym-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 10h4.5v11H2zM8.5 10.2 12.6 2c1.6.1 2.6 1.3 2.4 2.9L14.4 9H20a2 2 0 0 1 2 2.4l-1.5 7.6a2.5 2.5 0 0 1-2.5 2H8.5z"/></svg>';
const CLS = {
  brilliant:  { label: 'Brilliant',  sym: '!!' },
  great:      { label: 'Great',      sym: '!' },
  best:       { label: 'Best',       sym: '★' },
  excellent:  { label: 'Excellent',  sym: THUMB_SVG },
  good:       { label: 'Good',       sym: '✓' },
  inaccuracy: { label: 'Inaccuracy', sym: '?!' },
  mistake:    { label: 'Mistake',    sym: '?' },
  blunder:    { label: 'Blunder',    sym: '??' },
  forced:     { label: 'Forced',     sym: '□' },
};
const CLS_ORDER = ['brilliant', 'great', 'best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder'];
// The moments "Play through" stops at in a review.
const AP_STOPS = ['brilliant', 'great', 'mistake', 'blunder'];
const OPERA_PGN = `[Event "Opera Game, Paris Opera"]
[Site "Paris FRA"]
[Date "1858.??.??"]
[White "Paul Morphy"]
[Black "Duke Karl / Count Isouard"]
[Result "1-0"]

1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7
8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7
14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0`;

const $ = (s) => document.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const MINUS = '\u2212';

/* =====================================================================
   Procedural textures: wood for board, frame and clock; leather; paper
   ===================================================================== */
function makeNoise(seed) {
  let s = (seed >>> 0) || 1;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
  const vals = new Float32Array(256); for (let i = 0; i < 256; i++) vals[i] = rnd();
  const h = (x, y) => vals[(p[(p[x & 255] + y) & 255])];
  function n2(x, y, P) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    let x0 = xi, y0 = yi, x1 = xi + 1, y1 = yi + 1;
    if (P) { x0 = ((x0 % P) + P) % P; x1 = ((x1 % P) + P) % P; y0 = ((y0 % P) + P) % P; y1 = ((y1 % P) + P) % P; }
    const a = h(x0, y0), b = h(x1, y0), c = h(x0, y1), d = h(x1, y1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y, oct, P) {
    let sum = 0, amp = .5, f = 1, norm = 0;
    for (let i = 0; i < oct; i++) { sum += amp * n2(x * f, y * f, P ? P * f : 0); norm += amp; amp *= .5; f *= 2; }
    return sum / norm;
  }
  return { n2, fbm, rnd };
}
function mixRGB(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
// Wood with detail down to single device pixels. x runs along the grain, y across it.
// `scale` is device pixels per board square: the figure (rings, streaks) keeps its size on every screen,
// while pores, fibres and rays are sized in pixels, so a sharper screen gets finer detail, like a photo.
// Smooth fields are worked out on a coarse grid and interpolated; the fine detail is computed per pixel.
function woodPixels(w, h, sp, seed, scale) {
  const N = makeNoise(seed); const px = new Uint8ClampedArray(w * h * 4);
  const hs = (a, b) => { let n = Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(seed, -2048144777); n = Math.imul(n ^ (n >>> 13), 1274126177); n ^= n >>> 16; return (n >>> 0) / 4294967296; };
  const pal = sp.pal, np = pal.length - 1;
  const R = sp.ring, F = sp.fib, P = sp.pore, Y = sp.ray, C = sp.curl, E = sp.eye, S = sp.streak;
  const k = Math.max(.6, scale / 150);
  const vc = (N.rnd() - .5) * 3, uc = N.rnd() * (w / scale), d0 = R.d0 * (.8 + N.rnd() * .4);
  const pw = P ? P.w * k : 1, pl = P ? P.len * k : 1, rw = Y ? Y.w * k : 1, rl = Y ? Y.len * k : 1, fpx = F.px * k;
  const ec = E ? E.cell * scale : 1, er = E ? E.r * k : 1;
  // ---- coarse grid: grain bend, ring position and its rate of change, broad tone and figure, colour streaks
  const G = 4, gw = Math.ceil(w / G) + 2, gh = Math.ceil(h / G) + 2, gn = gw * gh;
  const cB = new Float32Array(gn), cR = new Float32Array(gn), cD = new Float32Array(gn), cT = new Float32Array(gn), cS = new Float32Array(gn);
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    const u = gx * G / scale, v = gy * G / scale, j = gy * gw + gx;
    const bend = (N.fbm(u * .22 + 11, v * .5 + 3, 3) - .5) * sp.bend + (N.n2(u * 1.6 + 5, v * 1.1) - .5) * sp.bend * .12;
    const vb = v + bend; cB[j] = bend;
    // growth rings: a log sawn lengthwise, so the rings show as stripes and arches
    const dd = d0 + (u - uc) * R.tilt, dv = vb - vc, rr = Math.sqrt(dv * dv + dd * dd) || 1e-6;
    const fm = R.freq * (1 + (N.fbm(vb * .9 + 4, u * .15, 2) - .5) * .5);
    cR[j] = rr * fm + (N.fbm(u * .35 + 2, vb * 1.3, 3) - .5) * R.noise + (N.n2(u * 3 + 9, vb * 9) - .5) * .12;
    cD[j] = fm / scale * Math.sqrt((dv / rr) * (dv / rr) + (dd * R.tilt / rr) * (dd * R.tilt / rr)) + R.noise * .08 / scale;
    let t = (N.fbm(u * .45 + 60, vb * .55 + 9, 3) - .5) * sp.tone;
    if (C) t += Math.sin((u * C.freq + N.fbm(u * .7, vb * .9 + 50, 2) * C.warp) * 6.2832) * C.amt * (.6 + .4 * N.n2(u * .5, vb * 1.3 + 7));
    cT[j] = t;
    if (S) {
      const sn = N.fbm(u * S.along + 80, vb * S.across + 21, 3);
      let m; if (S.ridge) m = Math.pow(1 - Math.abs(sn * 2 - 1), S.ridge); else { const q = sn <= .5 ? 0 : sn >= .75 ? 1 : (sn - .5) * 4; m = q * q * (3 - 2 * q); }
      cS[j] = m * S.amt;
    }
  }
  let a0 = 0, a1 = 0, b0 = 0, b1 = 0, w00 = 0, w10 = 0, w01 = 0, w11 = 0;
  const lerp = (A) => A[a0] * w00 + A[a1] * w10 + A[b0] * w01 + A[b1] * w11;
  for (let y = 0; y < h; y++) {
    const gyf = y / G, gy0 = Math.floor(gyf), fy0 = gyf - gy0, row0 = gy0 * gw, row1 = row0 + gw;
    for (let x = 0; x < w; x++) {
      const gxf = x / G, gx0 = Math.floor(gxf), fx0 = gxf - gx0;
      a0 = row0 + gx0; a1 = a0 + 1; b0 = row1 + gx0; b1 = b0 + 1;
      w00 = (1 - fx0) * (1 - fy0); w10 = fx0 * (1 - fy0); w01 = (1 - fx0) * fy0; w11 = fx0 * fy0;
      const u = x / scale, vb = y / scale + lerp(cB), yb = vb * scale;
      let ring = lerp(cR), gr = lerp(cD);
      // bird's-eye figure: small eyes with a dark centre; the rings swirl round them
      let eyeDot = 0, eyeIn = 0;
      if (E) {
        const ex0 = Math.floor(x / ec), ey0 = Math.floor(y / ec);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const gx = ex0 + dx, gy = ey0 + dy; if (hs(gx * 7 + 3, gy * 13 + 5) >= E.dens) continue;
          const r = er * (.7 + hs(gx + 9, gy + 4) * .6), ex = x - (gx + .15 + hs(gx, gy * 3 + 1) * .7) * ec, ey = (y - (gy + .15 + hs(gx * 5 + 2, gy) * .7) * ec) * 1.25;
          const d = Math.sqrt(ex * ex + ey * ey); if (d > r * 5) continue;
          const e = E.swirl * Math.exp(-(d / r) * (d / r) * E.fall); ring += e; gr += e * 2 * E.fall * d / (r * r);
          const q = d / (.9 * k); eyeDot = Math.max(eyeDot, Math.exp(-q * q)); if (d < r * 2.2) eyeIn = Math.max(eyeIn, 1 - d / (r * 2.2));
        }
      }
      const ph = ring - Math.floor(ring), aw = gr < .002 ? .002 : gr > .5 ? .5 : gr * 1.15;
      // the late wood darkens slowly, then ends in a crisp, anti-aliased edge where the next ring starts
      let late = Math.pow(ph, R.sharp); if (ph > 1 - aw) { const q = (ph - 1 + aw) / aw; late *= 1 - q * q * (3 - 2 * q); }
      const edge = R.line ? Math.exp(-((ph > .5 ? 1 - ph : ph * 4) / gr) / (1.3 * k)) * R.line : 0;
      // fibres: fine lines down to 1-2 px, plus wider streaks
      const fib = N.n2(x / (fpx * 26), yb / fpx), fib2 = N.n2(x / (fpx * 60) + 40, yb / (fpx * 2.3) + 17);
      const mid = (N.n2(u * .8 + 30, vb * F.mid) * 2 + N.n2(u * 1.6 + 31, vb * F.mid * 2)) / 3;
      let t = sp.bias + late * R.w + (fib - .5) * F.w + (fib2 - .5) * F.w * .9 + (mid - .5) * F.mw + edge + lerp(cT);
      // pores: short dark dashes along the grain; ring-porous woods have most of them in the early wood
      let dark = 0;
      if (P) {
        const ry = yb / pw, row = Math.floor(ry), fy = ry - row;
        const lr = pl * (.6 + hs(row, 1) * .9), rx = (x + hs(row, 2) * lr * 9) / lr, col = Math.floor(rx), fx = rx - col;
        const dens = P.dens * (P.early ? (ph < P.early ? 2.6 : .35) : 1);
        if (hs(row, col * 3 + 7) < dens) {
          const off = (hs(col, row * 5 + 3) - .5) * .4, a = 1 - Math.abs(fy - .5 - off) * 2 / P.fill;
          if (a > 0) dark = Math.pow(Math.sin(fx * Math.PI), .7) * Math.min(1, a * 1.6) * P.dark * (.55 + hs(col + 3, row) * .45);
        }
      }
      // rays: tiny flecks across the grain (maple fleck, oak flake)
      let fleck = 0;
      if (Y) {
        const cx = x / rw, cxi = Math.floor(cx), fx = cx - cxi;
        const lr = rl * (.5 + hs(cxi, 11) * 1.2), cy = (yb + hs(cxi, 12) * lr * 7) / lr, cyi = Math.floor(cy), fy = cy - cyi;
        if (hs(cxi * 3 + 1, cyi) < Y.dens) { const a = 1 - Math.abs(fx - .5) * 2; if (a > 0) fleck = Math.pow(Math.sin(fy * Math.PI), .8) * Math.min(1, a * 1.5) * Y.amt; }
      }
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ft = t * np, i0 = ft >= np ? np - 1 : Math.floor(ft), f = ft - i0, A = pal[i0], B = pal[i0 + 1];
      let r = A[0] + (B[0] - A[0]) * f, g = A[1] + (B[1] - A[1]) * f, b = A[2] + (B[2] - A[2]) * f;
      if (S) { const m = lerp(cS); r += (S.col[0] - r) * m; g += (S.col[1] - g) * m; b += (S.col[2] - b) * m; }
      if (eyeIn) { const m = eyeIn * E.light; r += (255 - r) * m; g += (248 - g) * m; b += (225 - b) * m; }
      if (eyeDot) { const m = eyeDot * E.dark; r *= 1 - m; g *= 1 - m * 1.06; b *= 1 - m * 1.18; }
      if (dark) { const m = 1 - dark; r *= m; g *= m; b *= m * .96; }
      if (fleck) { const c = sp.rayCol; r += (c[0] - r) * fleck; g += (c[1] - g) * fleck; b += (c[2] - b) * fleck; }
      const i = (y * w + x) * 4;
      px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
    }
  }
  return px;
}
// Wood species. pal runs light to dark; ring, fib (fibres), pore, ray, streak, curl (figure) and eye (bird's-eye) shape the grain.
const WOOD = {
  maple: { seed: 11, pal: [[243, 224, 182], [235, 209, 161], [221, 187, 135], [194, 152, 98]], bias: .2, bend: .25, tone: .16,
    ring: { freq: 8, d0: 1.3, tilt: .35, noise: .54, sharp: 4.5, w: .28, line: .09 },
    fib: { px: 2.2, w: .14, mid: 7, mw: .12 }, pore: { w: 1.4, len: 4, dens: .035, dark: .1, fill: .7 },
    ray: { w: 1.4, len: 5, dens: .035, amt: .22 }, rayCol: [206, 160, 108], curl: { freq: 6, amt: .025, warp: 1.2 } },
  walnut: { seed: 23, pal: [[166, 114, 74], [134, 88, 54], [102, 63, 37], [64, 37, 21]], bias: .2, bend: .35, tone: .24,
    ring: { freq: 7, d0: .9, tilt: .5, noise: .72, sharp: 3.5, w: .4, line: .1 },
    fib: { px: 2, w: .2, mid: 5, mw: .18 }, pore: { w: 1.8, len: 9, dens: .22, dark: .45, fill: .8 },
    streak: { col: [74, 56, 52], along: .35, across: 1.6, amt: .35 } },
  walnutFrame: { seed: 37, pal: [[122, 60, 35], [94, 43, 25], [68, 29, 16], [40, 16, 8]], bias: .22, bend: .30, tone: .22,
    ring: { freq: 6, d0: 4, tilt: .06, noise: .72, sharp: 3, w: .4, line: .1 },
    fib: { px: 2, w: .2, mid: 5, mw: .16 }, pore: { w: 1.8, len: 11, dens: .24, dark: .5, fill: .8 } },
  boxwood: { seed: 41, pal: [[242, 225, 174], [234, 211, 153], [220, 192, 130], [192, 160, 98]], bias: .2, bend: .23, tone: .18,
    ring: { freq: 14, d0: 2, tilt: .25, noise: .45, sharp: 7, w: .24, line: .07 },
    fib: { px: 1.8, w: .1, mid: 8, mw: .08 }, pore: { w: 1.4, len: 4, dens: .03, dark: .12, fill: .7 } },
  rosewood: { seed: 47, pal: [[150, 80, 58], [114, 54, 38], [80, 34, 25], [42, 18, 14]], bias: .2, bend: .40, tone: .28,
    ring: { freq: 8, d0: 1, tilt: .5, noise: .81, sharp: 3, w: .35, line: .08 },
    fib: { px: 2, w: .2, mid: 5, mw: .16 }, pore: { w: 2, len: 10, dens: .2, dark: .5, fill: .8 },
    streak: { col: [30, 14, 16], along: .5, across: 4, ridge: 6, amt: .6 } },
  rosewoodFrame: { seed: 53, pal: [[108, 58, 42], [82, 39, 27], [58, 24, 18], [30, 13, 10]], bias: .2, bend: .40, tone: .26,
    ring: { freq: 7, d0: 4, tilt: .06, noise: .81, sharp: 3, w: .35, line: .08 },
    fib: { px: 2, w: .2, mid: 5, mw: .16 }, pore: { w: 2, len: 12, dens: .2, dark: .5, fill: .8 },
    streak: { col: [18, 8, 9], along: .5, across: 4, ridge: 6, amt: .6 } },
  mahogany: { seed: 59, pal: [[164, 82, 52], [138, 63, 38], [108, 45, 27], [74, 29, 16]], bias: .22, bend: .15, tone: .18,
    ring: { freq: 6, d0: 5, tilt: .08, noise: .54, sharp: 3, w: .3, line: .06 },
    fib: { px: 2, w: .18, mid: 6, mw: .14 }, pore: { w: 2, len: 12, dens: .25, dark: .45, fill: .8 },
    streak: { col: [184, 100, 64], along: .12, across: 3.5, amt: .32 } },
  mahoganyFrame: { seed: 61, pal: [[117, 62, 40], [100, 49, 30], [79, 35, 20], [55, 22, 12]], bias: .22, bend: .20, tone: .2,
    ring: { freq: 6, d0: 4, tilt: .06, noise: .54, sharp: 3, w: .3, line: .06 },
    fib: { px: 2, w: .18, mid: 6, mw: .14 }, pore: { w: 2, len: 13, dens: .25, dark: .45, fill: .8 },
    streak: { col: [150, 80, 50], along: .12, across: 3.5, amt: .3 } },
  birdseye: { seed: 67, pal: [[246, 230, 194], [238, 216, 172], [224, 194, 144], [196, 158, 106]], bias: .2, bend: .25, tone: .16,
    ring: { freq: 9, d0: 1.6, tilt: .3, noise: .54, sharp: 6, w: .3, line: .1 },
    fib: { px: 2.2, w: .13, mid: 7, mw: .12 }, pore: { w: 1.4, len: 4, dens: .035, dark: .1, fill: .7 },
    ray: { w: 1.6, len: 6, dens: .04, amt: .3 }, rayCol: [200, 150, 98],
    eye: { cell: .11, dens: .34, r: 2.4, swirl: 2.6, fall: .22, dark: .45, light: .06 } },
  oak: { seed: 71, pal: [[152, 120, 90], [126, 97, 70], [98, 74, 52], [62, 45, 31]], bias: .2, bend: .25, tone: .2,
    ring: { freq: 6, d0: .75, tilt: .3, noise: .38, sharp: 2.6, w: .4, line: .1 },
    fib: { px: 2, w: .18, mid: 5, mw: .14 }, pore: { w: 1.8, len: 6, dens: .2, dark: .38, fill: .75, early: .3 },
    ray: { w: 2, len: 9, dens: .015, amt: .18 }, rayCol: [176, 146, 112] },
  oakFrame: { seed: 73, pal: [[91, 72, 54], [76, 58, 42], [59, 44, 31], [37, 27, 19]], bias: .2, bend: .25, tone: .2,
    ring: { freq: 5, d0: 4, tilt: .06, noise: .63, sharp: 2.5, w: .4, line: .04 },
    fib: { px: 2, w: .18, mid: 5, mw: .14 }, pore: { w: 1.8, len: 7, dens: .2, dark: .4, fill: .75, early: .3 },
    ray: { w: 2, len: 9, dens: .015, amt: .15 }, rayCol: [120, 98, 74] },
  ash: { seed: 79, pal: [[240, 225, 196], [228, 209, 174], [208, 183, 143], [172, 142, 102]], bias: .18, bend: .23, tone: .14,
    ring: { freq: 5, d0: 1.3, tilt: .4, noise: .59, sharp: 2.2, w: .45, line: .04 },
    fib: { px: 2, w: .14, mid: 6, mw: .1 }, pore: { w: 1.7, len: 6, dens: .18, dark: .3, fill: .75, early: .28 },
    ray: { w: 1.4, len: 5, dens: .012, amt: .15 }, rayCol: [196, 168, 128] },
};
// Wooden boards: light squares, dark squares and frame. 'wood' keeps its old id so saved settings still work.
const WOOD_BOARDS = {
  wood:     { light: 'maple', dark: 'walnut', frame: 'walnutFrame' },
  rosewood: { light: 'boxwood', dark: 'rosewood', frame: 'rosewoodFrame' },
  mahogany: { light: 'birdseye', dark: 'mahogany', frame: 'mahoganyFrame' },
  oak:      { light: 'ash', dark: 'oak', frame: 'oakFrame' },
};
const TEXGEN = { worker: null, seq: 0, pending: new Map() };
function texWorker() {
  if (TEXGEN.worker !== null) return TEXGEN.worker;
  try {
    const src = `${makeNoise.toString()}\n${woodPixels.toString()}\n${stonePixels.toString()}\nonmessage = (e) => { const d = e.data; const px = d.gen === 'stone' ? stonePixels(d.w, d.h, d.pal, d.seed, d.o, d.unit) : woodPixels(d.w, d.h, d.sp, d.seed, d.scale); postMessage({ id: d.id, w: d.w, h: d.h, px }, [px.buffer]); };`;
    const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    w.onmessage = (e) => { const r = TEXGEN.pending.get(e.data.id); if (r) { TEXGEN.pending.delete(e.data.id); r.resolve(e.data); } };
    w.onerror = (e) => { if (e && e.preventDefault) e.preventDefault(); for (const r of TEXGEN.pending.values()) r.reject(); TEXGEN.pending.clear(); TEXGEN.worker = false; };
    TEXGEN.worker = w;
  } catch (e) { TEXGEN.worker = false; }
  return TEXGEN.worker;
}
function pxToCanvas(w, h, px) { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; cv.getContext('2d').putImageData(new ImageData(px, w, h), 0, 0); return cv; }
// scale = device pixels per board square that the texture is made for
function woodSync(kind, w, h, scale) { const W = WOOD[kind]; const cv = pxToCanvas(w, h, woodPixels(w, h, W, W.seed, scale)); cv.scale = scale; return cv; }
function woodAsync(kind, w, h, scale) {
  const wk = texWorker(); const W = WOOD[kind];
  if (!wk) return new Promise(res => setTimeout(() => res(woodSync(kind, w, h, scale)), 0));
  return new Promise((resolve) => {
    const id = ++TEXGEN.seq;
    TEXGEN.pending.set(id, { resolve: (d) => { const cv = pxToCanvas(d.w, d.h, new Uint8ClampedArray(d.px)); cv.scale = scale; resolve(cv); }, reject: () => resolve(woodSync(kind, w, h, scale)) });
    wk.postMessage({ id, w, h, sp: W, seed: W.seed, scale });
  });
}
function overlayTile(size, seed, fn) {
  const N = makeNoise(seed);
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const ctx = cv.getContext('2d'); const img = ctx.createImageData(size, size); const d = img.data;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const c = fn(N, x / size, y / size); const i = (y * size + x) * 4;
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = c[3];
  }
  ctx.putImageData(img, 0, 0);
  return cv.toDataURL('image/png');
}
const DPR = () => Math.min(3, window.devicePixelRatio || 1);
// TEX.wood[kind] holds one canvas per wood species; canvas.scale says which square size it was made for.
const TEX = { wood: {}, busy: false, again: false, ready: false };
const roundUp = (v, step) => Math.ceil(v / step) * step;
const SQ_PICK = .36;                                  // each square shows a random 36% window of its texture
const texForSquare = (sq) => roundUp(sq / SQ_PICK, 32);
const woodSet = () => WOOD_BOARDS[curBoard()] || null;
// Sizes the current layout needs, in device pixels: one board square, and the whole frame
function textureNeeds() {
  const dpr = DPR(); const inner = boardEl().getBoundingClientRect().width || boardPx * .9; const wrap = $('#boardWrap').getBoundingClientRect().width || boardPx;
  return { sq: clamp(Math.ceil(Math.round(inner * dpr) / 8), 24, 480), frame: clamp(Math.round(wrap * dpr), 256, 4096) };
}
function frameStrip(cvW) { const band = Math.ceil(cvW * .048) + 2, gap = 14; return { h: band * 4 + gap * 5, band, gap }; }
function buildOverlays() {
  const leather = overlayTile(384, 5, (N, x, y) => {
    const m = N.fbm(x * 6, y * 6, 4, 6); const f = N.n2(x * 96, y * 96, 96); const g = N.n2(x * 192, y * 192, 192);
    const a = clamp((m - .5) * 120 + (f - .5) * 24 + (g - .5) * 12, -60, 60);
    return a < 0 ? [0, 0, 0, -a * .8] : [240, 214, 186, a * .2];
  });
  const paper = overlayTile(384, 9, (N, x, y) => {
    const m = N.fbm(x * 4, y * 4, 3, 4); const f = N.n2(x * 64, y * 128, 64); const g = N.n2(x * 160, y * 320, 160);
    const a = clamp((m - .5) * 50 + (f - .5) * 20 + (g - .5) * 10, 0, 40);
    return [120, 95, 55, a];
  });
  document.documentElement.style.setProperty('--leather-tex', `url(${leather})`);
  document.documentElement.style.setProperty('--paper-tex', `url(${paper})`);
}
// Quick small pass for the first paint (and when switching to a wooden board that hasn't been made yet)
function ensureWood() {
  const set = woodSet(); if (!set) return;
  for (const k of [set.light, set.dark]) if (!TEX.wood[k]) TEX.wood[k] = woodSync(k, 128, 128, 46);
  if (!TEX.wood[set.frame]) { const fw = 384; TEX.wood[set.frame] = woodSync(set.frame, fw, frameStrip(fw).h, fw * .113); TEX.wood[set.frame].fw = fw; }
}
function buildQuickTextures() { ensureWood(); TEX.ready = true; drawFrame(); drawBoardCanvas(); }
// Sharp pass in the background, made for the exact square and frame size on screen, so it is drawn pixel for pixel.
// Runs again when the board changes size, the zoom changes or another wooden board is picked.
async function upgradeTextures() {
  if (TEX.busy) { TEX.again = true; return; }
  const set = woodSet(); if (!set) return;
  const need = textureNeeds(); const jobs = [];
  TEX.busy = true;
  try {
    for (const k of [set.light, set.dark]) {
      const cur = TEX.wood[k];
      if (!cur || cur.scale !== need.sq) { const T = texForSquare(need.sq); jobs.push(woodAsync(k, T, T, need.sq).then(cv => { TEX.wood[k] = cv; if (woodSet() === set) drawBoardCanvas(); })); }
    }
    const fc = TEX.wood[set.frame];
    if (!fc || fc.fw !== need.frame) { const fw = need.frame; jobs.push(woodAsync(set.frame, fw, frameStrip(fw).h, fw * .113).then(cv => { cv.fw = fw; TEX.wood[set.frame] = cv; if (woodSet() === set) drawFrame(); })); }
    await Promise.all(jobs);
  } finally { TEX.busy = false; }
  if (TEX.again) { TEX.again = false; upgradeTextures(); }
}
let texTimer = null;
function scheduleTextureUpgrade() { clearTimeout(texTimer); texTimer = setTimeout(upgradeTextures, 120); }
function watchZoom() {
  try { const mq = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`); mq.addEventListener('change', () => { layoutBoard(); watchZoom(); }, { once: true }); } catch (e) {}
}

/* =====================================================================
   Pieces: original turned-wood Staunton designs, drawn as SVG
   ===================================================================== */
function ell(cx, cy, rx, ry) { return `M${cx - rx},${cy} A${rx},${ry} 0 1,0 ${cx + rx},${cy} A${rx},${ry} 0 1,0 ${cx - rx},${cy} Z`; }
const circ = (cx, cy, r) => ell(cx, cy, r, r);
const SHAPES = {
  base: [
    ['c', 'M20,92 L80,92 Q82.5,92 82.5,89.5 L82.5,87.5 Q82.5,84 78,83.5 L22,83.5 Q17.5,84 17.5,87.5 L17.5,89.5 Q17.5,92 20,92 Z'],
    ['c', 'M24.5,83.6 C23.6,80.6 25,78.3 28.5,78 L71.5,78 C75,78.3 76.4,80.6 75.5,83.6 Z'],
  ],
  baseLines: 'M19.4,87.7 L80.6,87.7 M19.2,90 L80.8,90 M25.4,80.8 L74.6,80.8',
  p: {
    parts: [
      ['c', 'M31.5,78 C33,72.5 40,70 41.2,63.5 C42,60 43.2,57.5 43.8,55.5 L56.2,55.5 C56.8,57.5 58,60 58.8,63.5 C60,70 67,72.5 68.5,78 Z'],
      ['c', ell(50, 55, 14.5, 3.8)],
      ['c', 'M44.5,52.6 L55.5,52.6 L54.6,49 L45.4,49 Z'],
      ['b', circ(50, 38.5, 13.2)],
    ], lines: 'M43.4,60.4 L56.6,60.4',
  },
  r: {
    parts: [
      ['c', 'M30.5,78 C32.5,73 35.5,70 36,64 L37.5,43 L62.5,43 L64,64 C64.5,70 67.5,73 69.5,78 Z'],
      ['c', 'M34.2,66.2 L65.8,66.2 Q67,66.2 66.8,64.6 L66.6,63 Q66.5,61.5 65.2,61.5 L34.8,61.5 Q33.5,61.5 33.4,63 L33.2,64.6 Q33,66.2 34.2,66.2 Z'],
      ['c', 'M33,44.6 L67,44.6 L67.6,40 L32.4,40 Z'],
      ['c', 'M33.4,40 L31.4,22.5 L40,22.5 L40,28.6 L46,28.6 L46,22.5 L54,22.5 L54,28.6 L60,28.6 L60,22.5 L68.6,22.5 L66.6,40 Z'],
    ], lines: 'M32.7,34 L67.3,34',
  },
  n: {
    parts: [
      ['c', 'M30,78 C31.5,74.5 33,72.6 34.5,71 L66,71 C67.5,72.6 69,74.5 70,78 Z'],
      ['k', 'M66,71.4 C68.6,59 70.6,45 66.6,33 C63.8,25 58.6,19.6 52.8,17.4 L50.2,9.6 L45.2,17.8 C39.2,19.6 33.2,24.6 29.4,31 C25.4,37.8 21.6,45.4 20.2,50.6 C19.2,54.6 20.8,58.2 24.8,58.8 C27.6,59.2 30.4,58.6 32.8,57.6 C35.4,56.4 37.6,55.2 40,54.6 C42.6,54 45,54.2 46.8,55.2 C43.2,59 38.4,64.4 35.2,71.4 Z'],
    ],
    lines: 'M23.4,52 C24.6,50.6 26.4,50.8 27.1,52.2 M24.6,56.7 C27,56.5 29,55.9 31,55.1 M46.4,55 C49.6,49 49,42.4 45,37.4 M57.2,22.4 L54,26.6 M61.6,28.4 L57.4,31.6 M65,35.4 L60.4,37.6 M66.8,43.4 L62,44.6 M67.3,52 L62.4,52.3 M67,60.6 L62.2,60.2 M49.9,12.8 L47.6,17.6',
    eye: true,
  },
  b: {
    parts: [
      ['c', 'M32,78 C35,72.5 41,69.5 42,63 L44,55 L56,55 L58,63 C59,69.5 65,72.5 68,78 Z'],
      ['c', ell(50, 55, 13, 3.4)],
      ['c', ell(50, 51, 10, 2.8)],
      ['c', 'M50,18 C58.5,24.5 63.5,33 63,40.5 C62.6,46.4 57.2,49.6 50,49.6 C42.8,49.6 37.4,46.4 37,40.5 C36.5,33 41.5,24.5 50,18 Z'],
      ['s', 'M55.8,26.8 L58.3,29.4 L47.7,40.6 L45,38 Z'],
      ['c', 'M47.4,19.8 L52.6,19.8 L51.6,16.6 L48.4,16.6 Z'],
      ['b', circ(50, 13.6, 4.4)],
    ], lines: 'M41.6,66 L58.4,66 M39.8,45 Q50,48.4 60.2,45',
  },
  q: {
    parts: [
      ['c', 'M32,78 C35,71.5 41,67.5 42,60.5 L44.5,47 L55.5,47 L58,60.5 C59,67.5 65,71.5 68,78 Z'],
      ['c', ell(50, 62, 11.8, 3)],
      ['c', ell(50, 46.6, 12.8, 3.3)],
      ['c', 'M38.5,44.6 C37.5,38.5 35,32.5 32.5,26.6 L67.5,26.6 C65,32.5 62.5,38.5 61.5,44.6 Z'],
      ['c', 'M38,26.9 C38.6,19.4 61.4,19.4 62,26.9 Z'],
      ['c', 'M32.4,26.9 L33.2,19.8 L39.8,24.6 L44.8,18.6 L50,24 L55.2,18.6 L60.2,24.6 L66.8,19.8 L67.6,26.9 Z'],
      ['b', circ(33.2, 19, 2.5)], ['b', circ(44.8, 17.8, 2.5)], ['b', circ(55.2, 17.8, 2.5)], ['b', circ(66.8, 19, 2.5)],
      ['c', 'M47.8,21.8 L52.2,21.8 L51.4,17.2 L48.6,17.2 Z'],
      ['b', circ(50, 13, 4.6)],
    ], lines: 'M34.4,31.4 L65.6,31.4',
  },
  k: {
    parts: [
      ['c', 'M31,78 C34,71.5 40.5,67.5 41.5,60.5 L44,47 L56,47 L58.5,60.5 C59.5,67.5 66,71.5 69,78 Z'],
      ['c', ell(50, 62, 12.3, 3.1)],
      ['c', ell(50, 46.6, 13.3, 3.4)],
      ['c', 'M38.2,44.6 C37.2,38.6 35.6,33.2 34.6,28.6 L65.4,28.6 C64.4,33.2 62.8,38.6 61.8,44.6 Z'],
      ['c', 'M34.6,28.9 C35,23.6 41.2,20.8 50,20.8 C58.8,20.8 65,23.6 65.4,28.9 Z'],
      ['c', 'M34.4,30.8 L65.6,30.8 Q66.8,30.8 66.6,29.4 Q66.4,27.2 65.2,27.2 L34.8,27.2 Q33.6,27.2 33.4,29.4 Q33.2,30.8 34.4,30.8 Z'],
      ['c', 'M47.6,21.6 L47.6,13.4 L42.6,13.4 L42.6,9.2 L47.6,9.2 L47.6,4.2 L52.4,4.2 L52.4,9.2 L57.4,9.2 L57.4,13.4 L52.4,13.4 L52.4,21.6 Z'],
    ], lines: 'M43.2,55 L56.8,55 M37,24.8 Q50,21.9 63,24.8',
  },
};
const PIECE_CACHE = {};
function pieceSVG(code) { return pieceSVGStyled(code, typeof S !== 'undefined' ? curStyle() : 'wood'); }
function buildDefs() {
  let grainW = '', grainB = '';
  const N = makeNoise(77);
  for (let i = 0; i < 40; i++) {
    const x = 3 + i * 2.4 + (N.rnd() - .5) * 1.8, a = (N.rnd() - .5) * 5, b = (N.rnd() - .5) * 5;
    const d = `M${x.toFixed(1)},0 C${(x + a).toFixed(1)},33 ${(x - a).toFixed(1)},66 ${(x + b).toFixed(1)},100`;
    const w = (.18 + N.rnd() * .5).toFixed(2), o1 = (.1 + N.rnd() * .22).toFixed(2), o2 = (.05 + N.rnd() * .12).toFixed(2);
    grainW += `<path d="${d}" stroke="#7a4b1f" stroke-opacity="${o1}" stroke-width="${w}" fill="none"/>`;
    grainB += `<path d="${d}" stroke="#c39672" stroke-opacity="${o2}" stroke-width="${w}" fill="none"/>`;
  }
  const figs = `<mask id="figBmask" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100"><rect width="100" height="100" fill="#fff"/><path d="M56.6,24.8 L60.4,28.6 L47.8,42.4 L43.8,38.8 Z" fill="#000"/></mask>` +
    ['k', 'q', 'r', 'b', 'n', 'p'].map(t => `<symbol id="fig-${t}" viewBox="14 2 72 92"><g${t === 'b' ? ' mask="url(#figBmask)"' : ''}>${[...SHAPES.base, ...SHAPES[t].parts].filter(p => p[0] !== 's').map(p => `<path d="${p[1]}"/>`).join('')}</g></symbol>`).join('');
  $('#pieceDefs').innerHTML = `<defs>
    <linearGradient id="cylW" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#b98950"/><stop offset=".17" stop-color="#f4e1b9"/><stop offset=".33" stop-color="#f7e8c8"/><stop offset=".63" stop-color="#ddb37b"/><stop offset=".87" stop-color="#b4834b"/><stop offset="1" stop-color="#8a5e31"/></linearGradient>
    <linearGradient id="cylB" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#2a1a10"/><stop offset=".16" stop-color="#76503a"/><stop offset=".3" stop-color="#5a3a26"/><stop offset=".62" stop-color="#2f1d12"/><stop offset=".86" stop-color="#1c110a"/><stop offset="1" stop-color="#0e0805"/></linearGradient>
    <radialGradient id="ballW" cx=".36" cy=".3" r=".8"><stop offset="0" stop-color="#fdf3dc"/><stop offset=".45" stop-color="#e8c792"/><stop offset=".85" stop-color="#b98a52"/><stop offset="1" stop-color="#8f6334"/></radialGradient>
    <radialGradient id="ballB" cx=".36" cy=".3" r=".8"><stop offset="0" stop-color="#93694d"/><stop offset=".4" stop-color="#4c3020"/><stop offset=".85" stop-color="#1f130b"/><stop offset="1" stop-color="#0d0704"/></radialGradient>
    <linearGradient id="knW" x1=".1" y1=".05" x2=".9" y2=".95"><stop offset="0" stop-color="#f8e9cb"/><stop offset=".45" stop-color="#e3bb84"/><stop offset="1" stop-color="#a57441"/></linearGradient>
    <linearGradient id="knB" x1=".1" y1=".05" x2=".9" y2=".95"><stop offset="0" stop-color="#7a5339"/><stop offset=".45" stop-color="#3c2618"/><stop offset="1" stop-color="#120b06"/></linearGradient>
    <radialGradient id="pcShadow"><stop offset="0" stop-color="#000" stop-opacity=".55"/><stop offset=".7" stop-color="#000" stop-opacity=".18"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
    <pattern id="grainW" patternUnits="userSpaceOnUse" width="100" height="100">${grainW}</pattern>
    <pattern id="grainB" patternUnits="userSpaceOnUse" width="100" height="100">${grainB}</pattern>
  ${styleDefs()}</defs>${figs}`;
}
// The figure is drawn; the letter is there for screen readers (and for copying text out of a review note).
const figSVG = (t) => `<svg class="fig" aria-hidden="true"><use href="#fig-${t}"/></svg><span class="sr-only">${t.toUpperCase()}</span>`;
function sanHTML(san) {
  let s = san.replace(/=([QRBN])/, (_, p) => '=' + '\u0001' + p.toLowerCase());
  s = s.replace(/^([KQRBN])/, (_, p) => '\u0001' + p.toLowerCase());
  return s.split('\u0001').map((part, i) => i === 0 ? esc(part) : figSVG(part[0]) + esc(part.slice(1))).join('');
}
function esc(t) { return String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

/* =====================================================================
   Piece styles and boards (Settings), from classic wood to modern glass
   ===================================================================== */
// Geometric shapes for the modern sets (Bauhaus, Modern glass)
const GEO = {
  base: [['c', 'M27,92 L73,92 Q77,92 77,88 L77,85.5 Q77,81 72.5,81 L27.5,81 Q23,81 23,85.5 L23,88 Q23,92 27,92 Z']],
  p: [['c', 'M37,81 L41.5,61 L58.5,61 L63,81 Z'], ['c', 'M39,62 L61,62 L61,57.5 L39,57.5 Z'], ['b', circ(50, 45.5, 11.5)]],
  r: [['c', 'M34,81 L36.5,45 L63.5,45 L66,81 Z'], ['c', 'M31,46 L69,46 L69,23 L61,23 L61,30.5 L54,30.5 L54,23 L46,23 L46,30.5 L39,30.5 L39,23 L31,23 Z']],
  b: [['c', 'M37,81 L43,57 L57,57 L63,81 Z'], ['c', 'M40,58 L60,58 L60,54 L40,54 Z'], ['c', 'M50,17 C61,25 64.5,36 61.5,45.5 C59.6,51 55.4,54.5 50,54.5 C44.6,54.5 40.4,51 38.5,45.5 C35.5,36 39,25 50,17 Z'], ['s', 'M55.8,26 L58.8,29 L48.2,41 L45.2,38 Z'], ['b', circ(50, 13, 3.8)]],
  n: [['k', 'M33,81 L67,81 L66,57 L63,39 L56.5,27 L52.5,23.5 L49.5,13.5 L45,22.5 L38,27.5 L28,42.5 L25.5,49.5 L29,53.5 L36.5,53.5 L44.5,47.5 L45.5,53 L37,66.5 Z']],
  q: [['c', 'M36,81 L42,53 L58,53 L64,81 Z'], ['c', 'M33,54 L67,54 L64.5,47 L35.5,47 Z'], ['c', 'M35.5,47 L30.5,24.5 L41,35 L50,19.5 L59,35 L69.5,24.5 L64.5,47 Z'], ['b', circ(30.5, 22, 3.6)], ['b', circ(50, 16.5, 3.8)], ['b', circ(69.5, 22, 3.6)]],
  k: [['c', 'M36,81 L42,51 L58,51 L64,81 Z'], ['c', 'M34.5,52 L65.5,52 L65.5,45.5 L34.5,45.5 Z'], ['c', 'M38,45.5 L36,29 L64,29 L62,45.5 Z'], ['c', 'M46.5,29.5 L46.5,20.5 L39.5,20.5 L39.5,14 L46.5,14 L46.5,6.5 L53.5,6.5 L53.5,14 L60.5,14 L60.5,20.5 L53.5,20.5 L53.5,29.5 Z']],
};
const ACCENTS = { k: '<rect x="45.5" y="33" width="9" height="9" fill="#d0482f"/>', q: '<circle cx="50" cy="37.5" r="4.4" fill="#e2b33c"/>' };

const PIECE_STYLES = {
  wood: { name: 'Club wood', note: 'Boxwood and ebony', shapes: 'staunton', board: 'wood',
    W: { cyl: 'url(#cylW)', ball: 'url(#ballW)', kn: 'url(#knW)', slit: '#6a4521', slitStroke: '#4a2e12', stroke: '#5a391b', overlay: 'grainW', det: 'rgba(96,60,28,.7)', eye: '#3b240f' },
    B: { cyl: 'url(#cylB)', ball: 'url(#ballB)', kn: 'url(#knB)', slit: '#000', slitStroke: '#7a5a42', stroke: '#050302', overlay: 'grainB', det: 'rgba(176,134,98,.55)', eye: '#0a0604', eyeStroke: '#a07a5a' } },
  ivory: { name: 'Antique ivory', note: 'Bone and polished ebony', shapes: 'staunton', board: 'wood',
    W: { cyl: 'url(#ivCylW)', ball: 'url(#ivBallW)', kn: 'url(#ivKnW)', slit: '#8a7650', slitStroke: '#6b5a3a', stroke: '#76633f', overlay: 'ivStriae', det: 'rgba(120,98,60,.5)', eye: '#4a3a22' },
    B: { cyl: 'url(#ivCylB)', ball: 'url(#ivBallB)', kn: 'url(#ivKnB)', slit: '#000', slitStroke: '#70707a', stroke: '#000', det: 'rgba(205,205,215,.32)', eye: '#000', eyeStroke: '#8a8a94' } },
  metal: { name: 'Brass & pewter', note: 'Polished metal', shapes: 'staunton', board: 'slate',
    W: { cyl: 'url(#brCyl)', ball: 'url(#brBall)', kn: 'url(#brKn)', slit: '#5c3f0f', slitStroke: '#3a2706', stroke: '#4a3208', det: 'rgba(90,60,10,.55)', eye: '#3a2706' },
    B: { cyl: 'url(#peCyl)', ball: 'url(#peBall)', kn: 'url(#peKn)', slit: '#0d0f12', slitStroke: '#9aa2ab', stroke: '#0d0f12', det: 'rgba(220,226,232,.32)', eye: '#0d0f12', eyeStroke: '#aab2ba' } },
  marble: { name: 'Marble', note: 'Carrara and nero marble', shapes: 'staunton', board: 'marble',
    W: { cyl: 'url(#mbCylW)', ball: 'url(#mbBallW)', kn: 'url(#mbKnW)', slit: '#8e8a83', slitStroke: '#6e6a64', stroke: '#7d7a74', overlay: 'mbVeinW', det: 'rgba(110,106,100,.45)', eye: '#4a4743' },
    B: { cyl: 'url(#mbCylB)', ball: 'url(#mbBallB)', kn: 'url(#mbKnB)', slit: '#030303', slitStroke: '#9a9a9a', stroke: '#020202', overlay: 'mbVeinB', det: 'rgba(230,230,230,.3)', eye: '#030303', eyeStroke: '#a0a0a0' } },
  diagram: { name: 'Diagram', note: 'Crisp print, like a chess book', shapes: 'staunton', board: 'paper', shadow: false,
    W: { cyl: '#ffffff', ball: '#ffffff', kn: '#ffffff', slit: '#111', stroke: '#111', sw: 2.8, det: '#111', detW: 1.7, eye: '#111' },
    B: { cyl: '#151515', ball: '#151515', kn: '#151515', slit: '#ffffff', stroke: '#111', sw: 2.8, det: '#f2f2f2', detW: 1.7, eye: '#ffffff' } },
  bauhaus: { name: 'Bauhaus', note: 'Geometric shapes, flat colour', shapes: 'geo', board: 'flat', accents: true,
    W: { cyl: '#f1ebdf', ball: '#f1ebdf', kn: '#f1ebdf', slit: '#2f5aa8', stroke: '#2b2b2e', sw: 2.2, eye: '#2b2b2e' },
    B: { cyl: '#2b2b2e', ball: '#2b2b2e', kn: '#2b2b2e', slit: '#3d6cc4', stroke: '#141416', sw: 2.2, eye: '#f1ebdf' } },
  frost: { name: 'Frosted glass', note: 'Classic shapes in glass', shapes: 'staunton', board: 'glass', glass: true,
    W: { cyl: 'url(#frCylW)', ball: 'url(#frBallW)', kn: 'url(#frKnW)', slit: '#7d8c9a', alpha: .8, sheen: .9, rim: 'rgba(255,255,255,.95)', det: 'rgba(255,255,255,.55)', eye: '#4a5d70' },
    B: { cyl: 'url(#frCylB)', ball: 'url(#frBallB)', kn: 'url(#frKnB)', slit: '#000', alpha: .9, sheen: .65, rim: 'rgba(222,236,250,.95)', det: 'rgba(200,220,240,.4)', eye: '#dfeaf5' } },
  crystal: { name: 'Modern glass', note: 'Geometric crystal and smoke', shapes: 'geo', board: 'glass', glass: true,
    W: { cyl: 'url(#crCylW)', ball: 'url(#crBallW)', kn: 'url(#crKnW)', slit: '#5b8fbd', alpha: .74, sheen: 1, rim: 'rgba(255,255,255,.95)', eye: '#3d6f99' },
    B: { cyl: 'url(#crCylB)', ball: 'url(#crBallB)', kn: 'url(#crKnB)', slit: '#d9ccff', alpha: .9, sheen: .7, rim: 'rgba(222,210,255,.95)', eye: '#ece6ff' } },
};
const STYLE_ORDER = ['wood', 'ivory', 'metal', 'marble', 'diagram', 'bauhaus', 'frost', 'crystal'];

const BOARDS = {
  wood:     { name: 'Walnut & maple', swatch: ['#edd5a6', '#865937'] },
  rosewood: { name: 'Rosewood & boxwood', swatch: ['#edd8a1', '#663325'] },
  mahogany: { name: 'Mahogany & bird\u2019s-eye maple', swatch: ['#efdab0', '#8b4128'] },
  oak:      { name: 'Smoked oak & ash', swatch: ['#e0ceab', '#7f6247'] },
  marble: { name: 'Marble', swatch: ['#f1efea', '#3d6458'] },
  slate:  { name: 'Slate', swatch: ['#b3bbc1', '#414a54'] },
  paper:  { name: 'Diagram', swatch: ['#f6f1e6', '#cbbfa8'] },
  flat:   { name: 'Bauhaus', swatch: ['#ece6da', '#7d978f'] },
  glass:  { name: 'Glass', swatch: ['#8ea2b8', '#34475f'] },
};
const BOARD_ORDER = ['wood', 'rosewood', 'mahogany', 'oak', 'marble', 'slate', 'paper', 'flat', 'glass'];
const curStyle = () => (PIECE_STYLES[S.settings.pieces] ? S.settings.pieces : 'wood');
const curBoard = () => (BOARDS[S.settings.board] ? S.settings.board : 'wood');

function pieceSVGStyled(code, styleId) {
  const st = PIECE_STYLES[styleId] || PIECE_STYLES.wood; const key = styleId + code;
  if (PIECE_CACHE[key]) return PIECE_CACHE[key];
  const white = code[0] === 'w', type = code[1].toLowerCase(); const m = white ? st.W : st.B;
  const geo = st.shapes === 'geo';
  const parts = geo ? [...GEO.base, ...GEO[type]] : [...SHAPES.base, ...SHAPES[type].parts];
  const fillOf = (kind) => (kind === 'b' ? m.ball || m.cyl : kind === 'k' ? m.kn || m.cyl : m.cyl);
  let s = '<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">';
  if (st.shadow !== false) s += `<ellipse cx="51" cy="91.6" rx="34" ry="5.6" fill="url(#pcShadow)"${st.glass ? ' opacity=".5"' : ''}/>`;
  const body = parts.map(([kind, d]) => {
    if (kind === 's') return `<path d="${d}" fill="${m.slit}"${m.slitStroke ? ` stroke="${m.slitStroke}" stroke-width=".8"` : ''} stroke-linejoin="round"/>`;
    const stroke = st.glass ? '' : ` stroke="${m.stroke}" stroke-width="${m.sw || 1.5}" stroke-linejoin="round"`;
    return `<path d="${d}" fill="${fillOf(kind)}"${stroke}/>` + (m.overlay ? `<path d="${d}" fill="url(#${m.overlay})"/>` : '');
  }).join('');
  if (st.glass) {
    // One translucent layer, so overlapping parts don't get darker where they meet
    s += `<g opacity="${m.alpha}">${body}</g>`;
    s += parts.filter(p => p[0] !== 's').map(([, d]) => `<path d="${d}" fill="url(#glSheen)" opacity="${m.sheen}"/>`).join('');
    s += parts.map(([, d]) => `<path d="${d}" fill="none" stroke="${m.rim}" stroke-width="1.1" stroke-linejoin="round"/>`).join('');
  } else s += body;
  const lines = geo ? '' : `${SHAPES.baseLines} ${SHAPES[type].lines}`.trim();
  if (lines && m.det) s += `<path d="${lines}" fill="none" stroke="${m.det}" stroke-width="${m.detW || 1.1}" stroke-linecap="round"/>`;
  if (type === 'n') s += geo ? `<circle cx="40.5" cy="33" r="2.5" fill="${m.eye}"/>`
    : `<ellipse cx="38.2" cy="31.8" rx="2.7" ry="1.75" transform="rotate(-24 38.2 31.8)" fill="${m.eye}"${m.eyeStroke ? ` stroke="${m.eyeStroke}" stroke-width=".6"` : ''}/>`;
  if (st.accents && ACCENTS[type]) s += ACCENTS[type];
  s += '</svg>';
  return (PIECE_CACHE[key] = s);
}

function styleDefs() {
  const lin = (id, stops, x2 = 1, y2 = 0, x1 = 0, y1 = 0) => `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops.map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}"${a != null ? ` stop-opacity="${a}"` : ''}/>`).join('')}</linearGradient>`;
  const rad = (id, stops) => `<radialGradient id="${id}" cx=".36" cy=".3" r=".8">${stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</radialGradient>`;
  const diag = (id, stops) => lin(id, stops, .9, .95, .1, .05);
  const N = makeNoise(91); let striae = '', veinW = '', veinB = '';
  for (let i = 0; i < 26; i++) {
    const x = 2 + i * 3.8 + (N.rnd() - .5) * 2; striae += `<path d="M${x.toFixed(1)},0 C${(x + (N.rnd() - .5) * 3).toFixed(1)},40 ${(x + (N.rnd() - .5) * 3).toFixed(1)},70 ${(x + (N.rnd() - .5) * 2).toFixed(1)},100" stroke="#b49c70" stroke-opacity="${(.06 + N.rnd() * .1).toFixed(2)}" stroke-width="${(.3 + N.rnd() * .5).toFixed(2)}" fill="none"/>`;
  }
  for (let i = 0; i < 7; i++) {
    const y = -10 + i * 18 + N.rnd() * 8; const d = `M-5,${y.toFixed(1)} C25,${(y + 14 + N.rnd() * 10).toFixed(1)} 55,${(y - 8 + N.rnd() * 12).toFixed(1)} 105,${(y + 22 + N.rnd() * 10).toFixed(1)}`;
    const w = (.35 + N.rnd() * .9).toFixed(2);
    veinW += `<path d="${d}" stroke="#8f8b84" stroke-opacity="${(.22 + N.rnd() * .2).toFixed(2)}" stroke-width="${w}" fill="none"/>`;
    veinB += `<path d="${d}" stroke="#ececec" stroke-opacity="${(.18 + N.rnd() * .18).toFixed(2)}" stroke-width="${w}" fill="none"/>`;
  }
  return [
    lin('ivCylW', [[0, '#c9b58f'], [.16, '#fffaf0'], [.32, '#fbf3e2'], [.62, '#e8dabd'], [.86, '#cdb88f'], [1, '#a8926a']]),
    rad('ivBallW', [[0, '#fffef8'], [.45, '#f1e6cc'], [.85, '#cbb68c'], [1, '#9f8962']]),
    diag('ivKnW', [[0, '#fffaf0'], [.5, '#ecdfc3'], [1, '#b9a47b']]),
    lin('ivCylB', [[0, '#050506'], [.14, '#5a5a62'], [.21, '#1d1d21'], [.55, '#0e0e10'], [.85, '#26262b'], [1, '#060607']]),
    rad('ivBallB', [[0, '#7b7b84'], [.4, '#222226'], [.85, '#0a0a0c'], [1, '#050506']]),
    diag('ivKnB', [[0, '#4e4e56'], [.45, '#151518'], [1, '#030304']]),
    lin('brCyl', [[0, '#6a4a14'], [.12, '#f8e6a8'], [.2, '#e0bb5c'], [.45, '#b8862c'], [.62, '#fff3c4'], [.7, '#d4a440'], [1, '#5c3f0f']]),
    rad('brBall', [[0, '#fffbe0'], [.4, '#e6c063'], [.8, '#a87a24'], [1, '#5c3f0f']]),
    diag('brKn', [[0, '#fff0b8'], [.45, '#d6a744'], [1, '#7c5717']]),
    lin('peCyl', [[0, '#1c1f24'], [.12, '#a9b1ba'], [.2, '#6b727b'], [.45, '#3b4048'], [.62, '#c9d0d6'], [.7, '#5a6068'], [1, '#15171b']]),
    rad('peBall', [[0, '#e6ebef'], [.4, '#8c949c'], [.8, '#3b4048'], [1, '#15171b']]),
    diag('peKn', [[0, '#c4cbd2'], [.45, '#5d646c'], [1, '#1c1f24']]),
    lin('mbCylW', [[0, '#bdbab4'], [.18, '#ffffff'], [.35, '#f6f4f0'], [.7, '#e3e0da'], [1, '#b3afa8']]),
    rad('mbBallW', [[0, '#ffffff'], [.5, '#eeebe6'], [1, '#c2beb6']]),
    diag('mbKnW', [[0, '#ffffff'], [.5, '#e9e6e0'], [1, '#b8b3ab']]),
    lin('mbCylB', [[0, '#050505'], [.18, '#5e5e5e'], [.35, '#282828'], [.7, '#131313'], [1, '#030303']]),
    rad('mbBallB', [[0, '#727272'], [.45, '#242424'], [1, '#050505']]),
    diag('mbKnB', [[0, '#606060'], [.45, '#1d1d1d'], [1, '#030303']]),
    lin('frCylW', [[0, '#b8c4cf'], [.2, '#ffffff'], [.4, '#eef3f7'], [.75, '#d3dde6'], [1, '#9fb0bf']]),
    rad('frBallW', [[0, '#ffffff'], [.5, '#e6edf3'], [1, '#a9b9c7']]),
    diag('frKnW', [[0, '#ffffff'], [.5, '#dfe7ee'], [1, '#9fb0bf']]),
    lin('frCylB', [[0, '#05070a'], [.2, '#5b6672'], [.4, '#2a323b'], [.75, '#151a20'], [1, '#030405']]),
    rad('frBallB', [[0, '#6c7884'], [.45, '#252c34'], [1, '#05070a']]),
    diag('frKnB', [[0, '#5d6874'], [.45, '#1e252c'], [1, '#030405']]),
    lin('crCylW', [[0, '#9cc3e3'], [.2, '#f4fbff'], [.4, '#d9ecf9'], [.75, '#a9cde9'], [1, '#6f9fc6']]),
    rad('crBallW', [[0, '#ffffff'], [.5, '#cfe6f7'], [1, '#79a8cf']]),
    diag('crKnW', [[0, '#f4fbff'], [.5, '#bcdcf2'], [1, '#6f9fc6']]),
    lin('crCylB', [[0, '#120b22'], [.2, '#8f78cc'], [.4, '#4d3b7c'], [.75, '#2a2048'], [1, '#0b0716']]),
    rad('crBallB', [[0, '#a590dc'], [.45, '#4d3b7c'], [1, '#0b0716']]),
    diag('crKnB', [[0, '#9984d2'], [.45, '#3c2e6a'], [1, '#0b0716']]),
    lin('glSheen', [[0, '#fff', 0], [.13, '#fff', 0], [.2, '#fff', .8], [.27, '#fff', 0], [.78, '#fff', 0], [.86, '#fff', .3], [.93, '#fff', 0]]),
    `<pattern id="ivStriae" patternUnits="userSpaceOnUse" width="100" height="100">${striae}</pattern>`,
    `<pattern id="mbVeinW" patternUnits="userSpaceOnUse" width="100" height="100">${veinW}</pattern>`,
    `<pattern id="mbVeinB" patternUnits="userSpaceOnUse" width="100" height="100">${veinB}</pattern>`,
  ].join('');
}

/* ---------------- stone textures for the marble and slate boards ---------------- */
function stonePixels(w, h, pal, seed, o, unit) {
  const N = makeNoise(seed); const px = new Uint8ClampedArray(w * h * 4);
  const a = pal[0], b = pal[1], v = pal[2];
  for (let y = 0; y < h; y++) {
    const ny = y / unit;
    for (let x = 0; x < w; x++) {
      const nx = x / unit;
      let t = (N.fbm(nx * o.cloud, ny * o.cloud, 4) - .5) * o.cw + .5;
      t += (N.n2(nx * o.grain, ny * o.grain) - .5) * o.gw;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      let vein = 0;
      if (o.veins) {
        const turb = N.fbm(nx * 2.2 + 5, ny * 2.2 + 9, 5);
        const s1 = Math.sin((nx * o.fx + ny * o.fy + turb * o.warp) * Math.PI);
        const s2 = Math.sin((nx * o.fy * 1.7 - ny * o.fx * .6 + turb * o.warp * 1.3 + 1.7) * Math.PI);
        vein = Math.max(Math.pow(1 - Math.abs(s1), o.sharp), Math.pow(1 - Math.abs(s2), o.sharp * 1.6) * .6) * o.veins;
        if (vein > 1) vein = 1;
      }
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) { const base = a[c] + (b[c] - a[c]) * t; px[i + c] = base + (v[c] - base) * vein; }
      px[i + 3] = 255;
    }
  }
  return px;
}
const STONE = {
  marbleL: { pal: [[247, 245, 241], [228, 225, 219], [140, 136, 130]], seed: 51, o: { cloud: 2.4, cw: .55, grain: 90, gw: .08, veins: .75, fx: 1.2, fy: .8, warp: 3.2, sharp: 14 } },
  marbleD: { pal: [[52, 86, 74], [26, 50, 43], [156, 194, 178]], seed: 63, o: { cloud: 2.4, cw: .85, grain: 90, gw: .12, veins: .7, fx: 1.0, fy: 1.3, warp: 3.6, sharp: 12 } },
  slateL:  { pal: [[184, 192, 198], [152, 160, 168], [212, 218, 224]], seed: 71, o: { cloud: 3.5, cw: .9, grain: 160, gw: .22, veins: .15, fx: .6, fy: 2.2, warp: 1.5, sharp: 20 } },
  slateD:  { pal: [[66, 74, 84], [44, 51, 60], [100, 110, 121]], seed: 83, o: { cloud: 3.5, cw: .9, grain: 160, gw: .22, veins: .15, fx: .6, fy: 2.2, warp: 1.5, sharp: 20 } },
};
function stoneSync(kind, size) { const s = STONE[kind]; return pxToCanvas(size, size, stonePixels(size, size, s.pal, s.seed, s.o, size)); }
function stoneAsync(kind, size) {
  const wk = texWorker(); const s = STONE[kind];
  if (!wk) return new Promise(res => setTimeout(() => res(stoneSync(kind, size)), 0));
  return new Promise((resolve) => {
    const id = ++TEXGEN.seq;
    TEXGEN.pending.set(id, { resolve: (d) => resolve(pxToCanvas(d.w, d.h, new Uint8ClampedArray(d.px))), reject: () => resolve(stoneSync(kind, size)) });
    wk.postMessage({ id, gen: 'stone', w: size, h: size, pal: s.pal, seed: s.seed, o: s.o, unit: size });
  });
}
const STONETEX = {};
// Quick small textures now, sharp ones in the background
function ensureStone(board) {
  if (board !== 'marble' && board !== 'slate') return;
  const L = board + 'L', D = board + 'D';
  if (!STONETEX[L]) { STONETEX[L] = stoneSync(L, 192); STONETEX[D] = stoneSync(D, 192); STONETEX[board] = 192; }
  const want = texForSquare(textureNeeds().sq);
  if ((STONETEX[board] || 0) < want && !STONETEX[board + 'Busy']) {
    STONETEX[board + 'Busy'] = true;
    Promise.all([stoneAsync(L, want), stoneAsync(D, want)]).then(([a, b]) => {
      STONETEX[L] = a; STONETEX[D] = b; STONETEX[board] = want; STONETEX[board + 'Busy'] = false;
      if (curBoard() === board) { drawBoardCanvas(); drawFrame(); }
    });
  }
}

/* ---------------- painting the other boards ---------------- */
function paintTexturedSquares(ctx, W, sq, light, dark, inlay, sheen) {
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const isLight = (r + c) % 2 === 0; const x = c * sq, y = r * sq; const name = crToSq(c, r); const id = (name.charCodeAt(0) - 97) + (+name[1]) * 8;
    const tex = isLight ? light : dark; const src = tex.width * .36;
    const sx = hash32(id * 3 + 1) * (tex.width - src), sy = hash32(id * 7 + 2) * (tex.height - src);
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, sq, sq); ctx.clip(); ctx.imageSmoothingQuality = 'high';
    if (hash32(id * 5 + 3) < .5) { ctx.translate(x + sq / 2, y + sq / 2); ctx.rotate(Math.PI / 2); ctx.drawImage(tex, sx, sy, src, src, -sq / 2, -sq / 2, sq, sq); }
    else ctx.drawImage(tex, sx, sy, src, src, x, y, sq, sq);
    ctx.restore();
  }
  if (inlay) { ctx.strokeStyle = inlay; ctx.lineWidth = Math.max(1, W / 900); ctx.beginPath(); for (let i = 1; i < 8; i++) { ctx.moveTo(i * sq, 0); ctx.lineTo(i * sq, W); ctx.moveTo(0, i * sq); ctx.lineTo(W, i * sq); } ctx.stroke(); }
  if (sheen) { const g = ctx.createLinearGradient(0, 0, W, W); g.addColorStop(0, `rgba(255,255,255,${sheen})`); g.addColorStop(.45, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,.1)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, W); }
}
function paintOtherBoard(ctx, W, sq, dpr) {
  const b = curBoard(); if (WOOD_BOARDS[b]) return false;
  if (b === 'marble' || b === 'slate') {
    ensureStone(b);
    paintTexturedSquares(ctx, W, sq, STONETEX[b + 'L'], STONETEX[b + 'D'], b === 'marble' ? 'rgba(70,66,60,.35)' : 'rgba(0,0,0,.35)', b === 'marble' ? .16 : .08);
    return true;
  }
  if (b === 'paper') {
    ctx.fillStyle = '#f6f1e6'; ctx.fillRect(0, 0, W, W);
    ctx.strokeStyle = 'rgba(70,60,46,.75)'; ctx.lineWidth = Math.max(1, dpr * .9);
    const step = sq / 7;
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      if ((r + c) % 2 === 0) continue;
      const x = c * sq, y = r * sq; ctx.save(); ctx.beginPath(); ctx.rect(x, y, sq, sq); ctx.clip(); ctx.beginPath();
      for (let k = -sq; k < sq * 2; k += step) { ctx.moveTo(x + k, y + sq); ctx.lineTo(x + k + sq, y); }
      ctx.stroke(); ctx.restore();
    }
    ctx.strokeStyle = '#1d1a16'; ctx.lineWidth = Math.max(1.5, dpr * 1.6); ctx.strokeRect(0, 0, W, W);
    return true;
  }
  if (b === 'flat') {
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) { ctx.fillStyle = (r + c) % 2 === 0 ? '#ece6da' : '#7d978f'; ctx.fillRect(c * sq, r * sq, sq + .5, sq + .5); }
    return true;
  }
  if (b === 'glass') {
    const g = ctx.createLinearGradient(0, 0, W, W); g.addColorStop(0, '#4b6380'); g.addColorStop(1, '#283a52'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, W);
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const light = (r + c) % 2 === 0; ctx.fillStyle = light ? 'rgba(228,240,252,.34)' : 'rgba(20,32,48,.22)'; ctx.fillRect(c * sq, r * sq, sq, sq);
    }
    ctx.strokeStyle = 'rgba(225,238,255,.28)'; ctx.lineWidth = Math.max(1, dpr * .8); ctx.beginPath();
    for (let i = 1; i < 8; i++) { ctx.moveTo(i * sq, 0); ctx.lineTo(i * sq, W); ctx.moveTo(0, i * sq); ctx.lineTo(W, i * sq); } ctx.stroke();
    const rg = ctx.createRadialGradient(W * .18, W * .1, 0, W * .18, W * .1, W * .9); rg.addColorStop(0, 'rgba(255,255,255,.16)'); rg.addColorStop(.5, 'rgba(255,255,255,.03)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = rg; ctx.fillRect(0, 0, W, W);
    return true;
  }
  return false;
}
function paintOtherFrame(ctx, W, f, dpr) {
  const b = curBoard(); if (WOOD_BOARDS[b]) return false;
  const sides = [
    [[0, 0], [W, 0], [W - f, f], [f, f]], [[0, W], [W, W], [W - f, W - f], [f, W - f]],
    [[0, 0], [f, f], [f, W - f], [0, W]], [[W, 0], [W, W], [W - f, W - f], [W - f, f]],
  ];
  const poly = (pts) => { ctx.beginPath(); pts.forEach(([x, y], j) => (j ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); };
  if (b === 'marble' || b === 'slate') {
    ensureStone(b); const t = STONETEX[b + 'D'];
    sides.forEach((pts, i) => {
      ctx.save(); poly(pts); ctx.clip(); ctx.imageSmoothingQuality = 'high';
      if (i < 2) ctx.drawImage(t, 0, i * t.height * .3, t.width, t.height * .25, 0, i === 0 ? 0 : W - f, W, f);
      else { ctx.translate(i === 2 ? f : W, 0); ctx.rotate(Math.PI / 2); ctx.drawImage(t, 0, i * t.height * .2, t.width, t.height * .25, 0, 0, W, f); }
      ctx.restore();
    });
  } else {
    const fill = b === 'paper' ? '#f4efe4' : b === 'flat' ? '#2f3a37' : null;
    if (fill) { ctx.fillStyle = fill; ctx.fillRect(0, 0, W, W); }
    else { const g = ctx.createLinearGradient(0, 0, W, W); g.addColorStop(0, '#1b2836'); g.addColorStop(1, '#0a1119'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, W); }
  }
  if (b !== 'paper' && b !== 'flat') {
    const shade = (pts, col) => { poly(pts); ctx.fillStyle = col; ctx.fill(); };
    shade(sides[0], 'rgba(255,255,255,.08)'); shade(sides[2], 'rgba(255,255,255,.05)'); shade(sides[1], 'rgba(0,0,0,.18)'); shade(sides[3], 'rgba(0,0,0,.14)');
  }
  if (b === 'glass') { ctx.strokeStyle = 'rgba(200,225,255,.35)'; ctx.lineWidth = dpr * 1.2; ctx.strokeRect(dpr, dpr, W - 2 * dpr, W - 2 * dpr); }
  if (b === 'paper') { ctx.strokeStyle = '#1d1a16'; ctx.lineWidth = dpr * 1.2; ctx.strokeRect(dpr * .6, dpr * .6, W - dpr * 1.2, W - dpr * 1.2); }
  return true;
}

/* ---------------- real wood in the board previews (Settings) ---------------- */
const BOARD_PREV = {}; let boardPrevBusy = false;
async function makeBoardPreviews() {
  if (boardPrevBusy) return; boardPrevBusy = true;
  try {
    const s = Math.round(56 * DPR());                       // one preview square, in device pixels
    for (const id of BOARD_ORDER) {
      const set = WOOD_BOARDS[id]; if (!set || BOARD_PREV[id]) continue;
      const [L, D] = await Promise.all([woodAsync(set.light, s, s, s), woodAsync(set.dark, s, s, s)]);
      const cv = document.createElement('canvas'); cv.width = cv.height = s * 2; const ctx = cv.getContext('2d');
      [[0, 0, L, 0], [1, 0, D, 1], [0, 1, D, 0], [1, 1, L, 1]].forEach(([c, r, t, rot]) => {
        ctx.save(); if (rot) { ctx.translate(c * s + s, r * s); ctx.rotate(Math.PI / 2); ctx.drawImage(t, 0, 0); } else ctx.drawImage(t, c * s, r * s); ctx.restore();
      });
      ctx.strokeStyle = 'rgba(32,14,4,.5)'; ctx.lineWidth = Math.max(1, DPR() * .7); ctx.beginPath(); ctx.moveTo(s, 0); ctx.lineTo(s, 2 * s); ctx.moveTo(0, s); ctx.lineTo(2 * s, s); ctx.stroke();
      BOARD_PREV[id] = cv.toDataURL('image/jpeg', .92);
      const el = document.querySelector(`#boardGrid .bd-${id}`); if (el) { el.classList.add('has-tex'); el.style.backgroundImage = `url(${BOARD_PREV[id]})`; }
    }
  } finally { boardPrevBusy = false; }
}

/* ---------------- settings menu ---------------- */
// Dark (espresso) or light (walnut on off-white). The board and pieces are drawn the same in both.
function applyTheme() {
  const light = S.settings.look === 'light';
  if (light) document.documentElement.setAttribute('data-look', 'light'); else document.documentElement.removeAttribute('data-look');
  const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.setAttribute('content', light ? '#f3f1ef' : '#17110d');
}
function applyLook() {
  const wrap = $('#boardWrap'); wrap.dataset.board = curBoard();
  pieceEls.forEach(p => { p.el.innerHTML = pieceSVG(p.code); });
  document.querySelectorAll('[data-pc]').forEach(el => { el.innerHTML = pieceSVG(el.dataset.pc); });
  ensureStone(curBoard()); ensureWood(); scheduleTextureUpgrade();
  drawFrame(); drawBoardCanvas(); renderAll();
}
function previewHTML(styleId) {
  const b = BOARDS[PIECE_STYLES[styleId].board]; const sv = (c) => pieceSVGStyled(c, styleId);
  return `<span class="sp-prev" style="--l:${b.swatch[0]};--d:${b.swatch[1]}"><span>${sv('wK')}</span><span>${sv('bN')}</span><span>${sv('wP')}</span><span>${sv('bQ')}</span></span>`;
}
function renderSettings() {
  const st = curStyle(), bd = curBoard();
  $('#styleGrid').innerHTML = STYLE_ORDER.map(id => `<button class="style-card" data-style="${id}" aria-pressed="${id === st}">${previewHTML(id)}<b>${esc(PIECE_STYLES[id].name)}</b><small>${esc(PIECE_STYLES[id].note)}</small></button>`).join('');
  $('#boardGrid').innerHTML = BOARD_ORDER.map(id => `<button class="board-card" data-board="${id}" aria-pressed="${id === bd}"><span class="bd-prev bd-${id}${BOARD_PREV[id] ? ' has-tex' : ''}" style="--l:${BOARDS[id].swatch[0]};--d:${BOARDS[id].swatch[1]}${BOARD_PREV[id] ? `;background-image:url(${BOARD_PREV[id]})` : ''}"></span><span>${esc(BOARDS[id].name)}</span></button>`).join('');
  makeBoardPreviews();
  $('#setSound').checked = Snd.on;
  $('#setPremove').checked = S.settings.premove !== false;
  $('#setChat').checked = S.settings.chat !== false;
  document.querySelectorAll('#lookSeg .seg-btn').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.look === (S.settings.look === 'light' ? 'light' : 'dark'))));
  renderUserSection();
}
function wireSettings() {
  $('#btnSettings').addEventListener('click', () => { renderSettings(); $('#settingsModal').hidden = false; const cur = $('#styleGrid [aria-pressed="true"]'); if (cur) cur.focus({ preventScroll: true }); $('#settingsModal .modal').scrollTop = 0; });
  $('#setDone').addEventListener('click', () => { $('#settingsModal').hidden = true; });
  wireUserSection();
  $('#styleGrid').addEventListener('click', (e) => {
    const b = e.target.closest('.style-card'); if (!b) return;
    S.settings.pieces = b.dataset.style; S.settings.board = PIECE_STYLES[b.dataset.style].board;
    applyLook(); renderSettings(); save(); $(`#styleGrid [data-style="${b.dataset.style}"]`).focus();
  });
  $('#boardGrid').addEventListener('click', (e) => {
    const b = e.target.closest('.board-card'); if (!b) return;
    S.settings.board = b.dataset.board; applyLook(); renderSettings(); save(); $(`#boardGrid [data-board="${b.dataset.board}"]`).focus();
  });
  $('#lookSeg').addEventListener('click', (e) => {
    const b = e.target.closest('.seg-btn'); if (!b) return;
    S.settings.look = b.dataset.look === 'light' ? 'light' : 'dark'; S.settings.lookChosen = true; applyTheme(); renderSettings(); save(); b.focus();
  });
  $('#setSound').addEventListener('change', (e) => { Snd.on = e.target.checked; S.settings.sound = Snd.on; if (Snd.on) Snd.move(); save(); });
  $('#setPremove').addEventListener('change', (e) => { S.settings.premove = e.target.checked; if (!S.settings.premove) clearPremoves(); else renderAll(); save(); });
  $('#setChat').addEventListener('change', (e) => { S.settings.chat = e.target.checked; renderAll(); save(); });
}

/* =====================================================================
   You: an estimated Elo from your games against Stockfish and the accuracy
   of your reviewed games (kept in this browser, and in your account when
   you are logged in, see sync.js), plus your online ratings.
   ===================================================================== */
const HIST_KEY = 'woodpusher.history.v1';
const HIST_MAX = 120;
const HIST = (() => {
  try { const h = JSON.parse(localStorage.getItem(HIST_KEY)); if (h && Array.isArray(h.games)) return h; } catch (e) {}
  return { v: 1, games: [] };            // newest first
})();
function saveHist() { if (HIST.games.length > HIST_MAX) HIST.games.length = HIST_MAX; try { localStorage.setItem(HIST_KEY, JSON.stringify(HIST)); } catch (e) {} if (typeof progressChanged === 'function') progressChanged(); }
const histId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// A finished game against Stockfish: who won, at what strength.
function recordStockfishGame() {
  const L = S.line, g = S.game;
  if (!L || !g || L.source !== 'play' || g.online || !g.elo) return null;
  if (L.result === '*' || L.reason === 'aborted') return null;
  const mine = L.moves.filter(m => m.color === g.playerColor).length;
  if (mine < 5 && L.reason !== 'checkmate') return null;   // a resignation after two moves says nothing about strength
  const w = L.result === '1-0' ? 'w' : L.result === '0-1' ? 'b' : null;
  const score = w ? (w === g.playerColor ? 1 : 0) : 0.5;
  if (!g.histId) g.histId = histId();
  const rec = { id: g.histId, at: Date.now(), kind: 'sf', elo: g.elo, opp: g.opp || null, color: g.playerColor, score, tc: g.tc, plies: L.moves.length, takebacks: g.takebacks || 0, key: lineKey(L), acc: null };
  const old = HIST.games.find(x => x.id === rec.id);
  if (old) Object.assign(old, rec, { acc: old.acc }); else HIST.games.unshift(rec);
  saveHist();
  return old || rec;
}

// A finished review of one of your own games: how accurately you played.
function recordReviewAccuracy() {
  if (typeof collectMistakes === 'function') collectMistakes();   // your mistakes become puzzles (trainer.js)
  const L = S.line, g = S.game, R = S.review;
  if (!L || !g || !R || !R.done) return;
  let color, kind;
  if (L.source === 'play' && !g.online) { color = g.playerColor; kind = 'sf'; }
  else if (L.source === 'online' && g.you) { color = g.you; kind = 'online'; }
  else return;                                                // PGN imports: we don't know which side was you
  const own = L.moves.filter((m, i) => m.color === color && R.cls[i] && R.cls[i] !== 'forced').length;
  if (own < 8) return;
  const acc = accuracyOf(color); if (acc == null) return;
  const key = lineKey(L);
  let rec = HIST.games.find(x => x.key === key && x.kind === kind && x.color === color);
  if (!rec && kind === 'sf') rec = recordStockfishGame();
  if (!rec && kind === 'online') { rec = { id: histId(), at: Date.now(), kind, color, key, acc: null }; HIST.games.unshift(rec); }
  if (!rec) return;
  const a = Math.round(acc * 10) / 10;
  if (rec.acc === a) return;
  rec.acc = a; saveHist();
}

// Rough link between game accuracy and playing strength. Accuracy depends on the opponent and the
// kind of game too, so the model trusts it much less than results.
const ACC_TO_ELO = [[40, 500], [55, 800], [65, 1100], [73, 1400], [80, 1700], [85, 2000], [89, 2300], [93, 2600], [96, 2900]];
function eloFromAccuracy(a) {
  const P = ACC_TO_ELO; if (a <= P[0][0]) return P[0][1]; if (a >= P[P.length - 1][0]) return P[P.length - 1][1];
  for (let i = 1; i < P.length; i++) if (a <= P[i][0]) { const [a0, e0] = P[i - 1], [a1, e1] = P[i]; return e0 + (e1 - e0) * (a - a0) / (a1 - a0); }
  return P[P.length - 1][1];
}

// Bayesian estimate on a grid: a broad prior around 1200, the Elo formula for each result against
// Stockfish, and a weak pull towards what your accuracy suggests. Recent games count more.
function estimateElo() {
  const sf = HIST.games.filter(x => x.kind === 'sf' && x.score != null);
  const accs = HIST.games.filter(x => x.acc != null);
  if (!sf.length && !accs.length) return null;
  const LO = 100, HI = 3200, STEP = 10, N = (HI - LO) / STEP + 1;
  const lp = new Float64Array(N);
  for (let k = 0; k < N; k++) { const r = LO + k * STEP; lp[k] = -0.5 * ((r - 1200) / 500) ** 2; }
  let si = 0, ai = 0;
  for (const x of HIST.games) {
    if (x.kind === 'sf' && x.score != null) {
      const w = Math.pow(0.97, si++) * (x.takebacks ? 0.5 : 1);
      for (let k = 0; k < N; k++) { const p = 1 / (1 + Math.pow(10, (x.elo - (LO + k * STEP)) / 400)); lp[k] += w * (x.score * Math.log(p) + (1 - x.score) * Math.log(1 - p)); }
    }
    if (x.acc != null) {
      const w = Math.pow(0.97, ai++); const m = eloFromAccuracy(x.acc);
      for (let k = 0; k < N; k++) lp[k] -= 0.5 * w * (((LO + k * STEP) - m) / 450) ** 2;
    }
  }
  let mx = -Infinity; for (let k = 0; k < N; k++) mx = Math.max(mx, lp[k]);
  let z = 0, m1 = 0, m2 = 0;
  for (let k = 0; k < N; k++) { const p = Math.exp(lp[k] - mx), r = LO + k * STEP; z += p; m1 += p * r; m2 += p * r * r; }
  const mean = m1 / z, sd = Math.sqrt(Math.max(0, m2 / z - mean * mean));
  const r50 = (v) => Math.round(v / 50) * 50;
  // Only wins (or only losses) say how far you are above (or below) Stockfish, not where you are.
  const oneSided = sf.length > 0 && (sf.every(x => x.score === 1) || sf.every(x => x.score === 0));
  let confidence = sd >= 250 ? 'Rough guess' : sd >= 150 || oneSided ? 'Taking shape' : 'Fairly settled';
  const above = mean > ELO_MAX;           // beating the strongest setting: the scale runs out
  if (above) confidence = 'Off the scale';
  return {
    elo: Math.round(mean / 10) * 10, sd, lo: Math.max(100, r50(mean - sd)), hi: r50(mean + sd), above,
    games: sf.length, reviews: accs.length, confidence,
  };
}

/* ---------------- the user section at the top of Settings ---------------- */
const RATING_CATS = [['bullet', 'Bullet'], ['blitz', 'Blitz'], ['rapid', 'Rapid'], ['classical', 'Classical']];
function sinceText(iso) { const d = new Date(iso); return isNaN(d) ? '' : `Member since ${d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}`; }
function renderUserSection() {
  const el = $('#userSection'); if (!el) return;
  const OW = window.WP_ONLINE; const online = !!(OW && OW.available && OW.available());
  const me = online ? OW.me() : null; const checking = online && !OW.loaded();
  const name = me ? me.username : checking ? 'Checking your account…' : online ? 'Guest' : 'You';
  const sub = me ? sinceText(me.createdAt) : checking ? '' : online ? 'Not logged in' : 'Playing offline';
  const est = estimateElo();
  const games = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  let detail;
  if (!est) detail = 'Play a game against Stockfish and Woodpusher will start guessing your Elo. Reviewing your games afterwards sharpens the guess.';
  else {
    const from = [est.games ? `${games(est.games, 'game')} against Stockfish` : '', est.reviews ? `${games(est.reviews, 'reviewed game')}` : ''].filter(Boolean).join(' and ');
    detail = est.above
      ? `You beat Stockfish even at its strongest setting here (${ELO_MAX}), so Woodpusher can't measure higher. Based on ${from}.`
      : `Likely between ${est.lo} and ${est.hi}, from ${from}. Recent games count more.`;
  }
  let ratings = '';
  if (me) {
    const r = me.ratings || {};
    ratings = `<div class="user-ratings"><span class="field-label">Online ratings</span>
      <div class="ratings-row">${RATING_CATS.map(([k, label]) => { const x = r[k] || { rating: 1500, provisional: true, games: 0 };
        return `<div class="rbox"><small>${label}</small><b>${x.rating}${x.provisional ? '?' : ''}</b><span class="rbox-n">${games(x.games || 0, 'game')}</span></div>`; }).join('')}</div>
      <p class="fine">A <b>?</b> means the rating is still a guess. It settles after a handful of rated games.</p></div>`;
  }
  let action = '';
  if (me) action = `<button class="btn btn-small" data-open-player="${esc(me.username)}">Your profile</button><button class="btn btn-small" data-open-board>Leaderboard</button>${me.admin ? `<button class="btn btn-small" data-open-admin>Reports and fair play${me.openReports ? ` (${me.openReports} open)` : ''}</button>` : ''}<button class="btn btn-small" data-user="logout">Log out</button>`;
  else if (online && !checking) action = `<button class="btn btn-brass btn-small" data-user="login">Log in or create an account</button>`;
  el.innerHTML = `
    <div class="you"><span class="you-ic" aria-hidden="true">${pieceSVG('wK')}</span><span class="you-text"><span class="you-name">${esc(name)}</span>${sub ? `<span class="you-sub">${esc(sub)}</span>` : ''}</span></div>
    <div class="est"><small>Estimated Elo</small><b>${!est ? '–' : est.above ? ELO_MAX + '+' : '≈' + est.elo}</b><span class="chip">${est ? est.confidence : 'No games yet'}</span></div>
    <p class="fine user-detail">${esc(detail)}${online ? '' : ' Accounts and online ratings live on the Woodpusher website.'}</p>
    ${online && !checking ? `<p class="fine user-detail">${me ? 'Your puzzle rating, the opening lines you practised and this Elo estimate are saved to your account, so they follow you to other devices.' : 'Log in and your puzzle rating, opening progress and this Elo estimate are saved to your account.'}</p>` : ''}
    ${ratings}
    ${action ? `<div class="user-actions">${action}</div>` : ''}`;
}
function wireUserSection() {
  $('#userSection').addEventListener('click', (e) => {
    const b = e.target.closest('[data-user]'); if (!b || !window.WP_ONLINE) return;
    if (b.dataset.user === 'login') { $('#settingsModal').hidden = true; window.WP_ONLINE.login(); }
    if (b.dataset.user === 'logout') { if (window.WP_ONLINE.logout()) $('#settingsModal').hidden = true; }
  });
}

/* =====================================================================
   Opening animation. The markup and keyframes live in the page, so the
   espresso screen covers it from the very first paint. The drawing waits
   for startOpening(), which boot calls once the heavy start-up work is
   done, so nothing interrupts the knight mid-stroke. When the wordmark has
   wiped in, the logo flies into the menu while the backdrop fades and
   the room rises into view. A click, tap or key skips it; with reduced
   motion it simply shows the logo and fades. If the script never runs, a
   CSS fallback fades the screen out on its own.
   ===================================================================== */
const OPENING = { leave: null, started: false };
function runOpening() {
  const el = document.getElementById('opening'); if (!el) return;
  const lk = document.getElementById('openingLockup'), target = document.getElementById('brandLockup');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let leaving = false;
  const reveal = (dur) => {
    if (reduce || !document.body.animate) return;
    [...document.querySelectorAll('.topbar > *, .room > *')].forEach((n, i) =>
      n.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: dur, delay: 60 + i * 45, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' }));
  };
  const leave = (fast) => {
    if (leaving) return; leaving = true;
    el.style.animation = 'none'; el.style.pointerEvents = 'none';          // take over from the CSS fallback
    if (target) { target.style.animation = 'none'; target.style.opacity = '0'; }
    const done = () => { if (target) target.style.opacity = ''; el.remove(); };
    const S = lk.getBoundingClientRect(), H = target ? target.getBoundingClientRect() : null;
    const canFly = !fast && !reduce && !!lk.animate && el.classList.contains('go') && H && H.width > 0 && H.bottom > 0 && S.height > 0;
    if (!el.animate) { done(); return; }
    if (!canFly) {
      el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: fast ? 200 : 420, easing: 'ease', fill: 'forwards' }).finished.then(done, done);
      if (!fast) reveal(500);
      return;
    }
    // In the narrow menu column the logo is the knight alone: the knight flies there and the word fades on the way
    const tw = target.querySelector('.lk-word'); const knightOnly = !!tw && getComputedStyle(tw).display === 'none';
    const K = knightOnly ? lk.querySelector('.op-knight').getBoundingClientRect() : S;
    const k = H.height / K.height;
    const ox = (K.left + K.width / 2) - (S.left + S.width / 2), oy = (K.top + K.height / 2) - (S.top + S.height / 2);
    const dx = (H.left + H.width / 2) - (S.left + S.width / 2) - k * ox, dy = (H.top + H.height / 2) - (S.top + S.height / 2) - k * oy;
    el.querySelector('.op-bg').animate([{ opacity: 1 }, { opacity: 0 }], { duration: 520, delay: 80, easing: 'ease-in-out', fill: 'forwards' });
    reveal(620);
    if (knightOnly) lk.querySelector('.op-word').animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, easing: 'ease', fill: 'forwards' });
    lk.animate([{ transform: 'none' }, { transform: `translate(${dx}px, ${dy}px) scale(${k})` }], { duration: 680, easing: 'cubic-bezier(.6,0,.25,1)', fill: 'forwards' }).finished.then(done, done);
  };
  OPENING.leave = leave;
  const skip = () => leave(true);
  el.addEventListener('pointerdown', skip, { once: true });
  window.addEventListener('keydown', skip, { once: true });
  if (reduce) setTimeout(() => leave(false), 700);
}
function startOpening() {
  const el = document.getElementById('opening');
  if (!el || OPENING.started || !OPENING.leave || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  OPENING.started = true;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (!document.getElementById('opening')) return;              // already skipped
    // Centre the knight while the word is hidden: shift it by half the gap plus the word's width.
    const lk = document.getElementById('openingLockup'), word = el.querySelector('.op-word');
    const em = parseFloat(getComputedStyle(lk).fontSize) || 1;
    const shift = (em * .36 + word.getBoundingClientRect().width) / 2 / em;
    if (shift > 0 && shift < 8) lk.style.setProperty('--op-shift', shift.toFixed(3));
    el.style.animation = 'none';                                      // the script will see it out from here
    const target = document.getElementById('brandLockup');
    if (target) { target.style.animation = 'none'; target.style.opacity = '0'; }
    el.classList.add('go');
    const anim = word.getAnimations ? word.getAnimations()[0] : null;
    if (anim && anim.finished) anim.finished.then(() => setTimeout(() => OPENING.leave(false), 220), () => OPENING.leave(false));
    else setTimeout(() => OPENING.leave(false), 2000);
  }));
}

/* =====================================================================
   Opponents in the style of the world's top players. Each bot plays the
   player's own openings first: a book built from their real games, picked
   in the same proportions they played them. Out of the book, Stockfish
   chooses among its best few moves with a nudge towards that player's
   habits: how sharp, how keen on trading queens, how willing to give
   material for play, how hard they push against a draw. They are computer
   imitations, not the players.
   ===================================================================== */
const PERSONA_LIST = typeof PERSONAS !== 'undefined' ? PERSONAS : [];
const BOOK_BASE = '/books/';
const BOOK_QS = '?v=1ea82a7d3f';   // the website build adds ?v=<build> so a new build never reuses old books from the browser cache
const BOOKS = {};
const personaById = (id) => PERSONA_LIST.find(p => p.id === id) || null;
const curPersona = () => personaById(S.settings.opp);
const botName = (p) => (p ? `${p.short} style` : 'Stockfish');

// The same key the book builder uses: piece placement, side to move and castling rights, hashed with FNV-1a.
function bookKey(fen) {
  const p = fen.split(' '); const s = p[0] + ' ' + p[1] + ' ' + p[2];
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}
function loadBook(id) {
  if (!BOOKS[id]) BOOKS[id] = fetch(BOOK_BASE + id + '.json' + BOOK_QS).then(r => (r.ok ? r.json() : null)).catch(() => null);
  return BOOKS[id];
}
// Stronger settings stay in the book longer: 8 plies at 1000, the full 30 from about 2650.
const bookPlies = (elo) => clamp(Math.round(8 + (elo - 1000) / 75), 8, 30);
// Book entries are [uci, games, weight]; weight counts classical games fully, rapid and blitz less.
async function bookMove(p, fen, ply, elo) {
  if (ply >= Math.min(bookPlies(elo), p.bookPlies || 30)) return null;
  const book = await loadBook(p.id); if (!book) return null;
  const side = fen.split(' ')[1];
  const entry = (book[side] || {})[bookKey(fen)]; if (!entry) return null;
  const legal = new Set(chessAt(fen).moves({ verbose: true }).map(m => m.from + m.to + (m.promotion || '')));
  const opts = entry.filter(([u]) => legal.has(u)); if (!opts.length) return null;
  const games = opts.reduce((a, o) => a + o[1], 0);
  let r = Math.random() * opts.reduce((a, o) => a + Math.pow(o[2], .85), 0);
  for (const o of opts) { r -= Math.pow(o[2], .85); if (r <= 0) return { uci: o[0], n: o[1], games }; }
  return { uci: opts[0][0], n: opts[0][1], games };
}

/* ---------------- the style nudge ---------------- */
const PVAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
function materialOf(fen, color) { let s = 0; for (const c of Object.values(boardMap(fen))) s += (c[0] === color ? 1 : -1) * PVAL[c[1].toLowerCase()]; return s; }
// Extra centipawns a candidate move earns for fitting the player's habits. Capped, and only ever used
// between moves Stockfish already rates close to the best, so the style never costs a whole piece.
function styleBonus(p, fen, line) {
  const w = p.w; const pv = line.pv || []; if (!pv.length) return 0;
  const c = chessAt(fen); const me = c.turn(); const before = materialOf(fen, me);
  const u = pv[0]; const mv = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || undefined }); if (!mv) return 0;
  let b = 0;
  if (/[+#]/.test(mv.san)) b += 8 * w.tactic;
  if (mv.captured) b += 4 * w.tactic;
  if (mv.piece === 'q' && mv.captured === 'q') b += 22 * w.trade;
  else if (mv.captured && mv.piece !== 'p' && PVAL[mv.captured] === PVAL[mv.piece]) b += 8 * w.trade;
  if (mv.piece === 'p') {
    const map = boardMap(c.fen()); const ksq = Object.keys(map).find(s => map[s] === (me === 'w' ? 'bK' : 'wK'));
    const f = mv.to.charCodeAt(0) - 97, kf = ksq ? ksq.charCodeAt(0) - 97 : 4, rank = +mv.to[1];
    const advanced = me === 'w' ? rank >= 4 : rank <= 5;
    if (advanced && Math.abs(f - kf) <= 1 && (kf >= 5 || kf <= 2)) b += 9 * w.storm;
  }
  // A sacrifice: two plies later in Stockfish's own line we are at least two points down, yet it still likes the move.
  const n = pv.length >= 4 ? 4 : pv.length >= 2 ? 2 : 0;
  for (let i = 1; i < n; i++) { const x = pv[i]; if (!c.move({ from: x.slice(0, 2), to: x.slice(2, 4), promotion: x[4] || undefined })) break; }
  if (n && materialOf(c.fen(), me) - before <= -2) b += 18 * w.sac;
  return clamp(b, -30, 30);
}
// How hard the player plays on against a draw. Stockfish 10 had a Contempt option for this; modern
// Stockfish scores a draw as a draw, so the bot does it here: a move Stockfish rates a dead draw (0.00),
// or one that repeats a position from the game, counts `contempt` centipawns less. Between moves about
// as good as each other the bot then keeps the game going, and it still takes a draw when the
// alternatives are clearly worse than that.
const positionKey = (fen) => fen.split(' ').slice(0, 4).join(' ');
function drawishLine(fen, line, seen) {
  if (line.mate == null && line.cp === 0) return true;
  const c = chessAt(fen); const u = line.pv[0];
  return !!c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || undefined }) && seen.has(positionKey(c.fen()));
}
function pickPersonaLine(p, fen, lines, P, history) {
  const ls = lines.filter(l => l && l.pv && l.pv.length); if (!ls.length) return null;
  const contempt = clamp(p.w.contempt || 0, 0, 60);
  const seen = new Set((history || []).map(positionKey));
  const drawish = ls.map(l => contempt > 0 && drawishLine(fen, l, seen));
  const sc = ls.map(lineScore); const best = Math.max(...sc);
  // A drawn best line widens the choice by the contempt, so a keen player looks further for a way to play on
  const window = Math.max(30, P.temp * 1.5) + (drawish[sc.indexOf(best)] ? contempt : 0);
  const cand = ls.map((l, i) => ({ l, s: sc[i], d: drawish[i] })).filter(x => x.s >= best - window);
  const T = Math.max(P.temp, 8);
  const ut = cand.map(x => x.s - (x.d ? contempt : 0) + (Math.abs(x.s) < 5000 ? styleBonus(p, fen, x.l) : 0));
  const top = Math.max(...ut); const wts = ut.map(v => Math.exp(-(top - v) / T));
  let r = Math.random() * wts.reduce((a, b) => a + b, 0);
  for (let i = 0; i < cand.length; i++) { r -= wts[i]; if (r <= 0) return cand[i].l; }
  return cand[0].l;
}

/* ---------------- choosing an opponent ---------------- */
const initials = (name) => name.split(/\s+/).map(x => x[0]).join('').slice(0, 2).toUpperCase();
function meter(label, v) {
  const pct = Math.round(clamp(v, 0, 1) * 100);
  return `<span class="om"><span class="om-l">${label}</span><span class="om-bar" role="img" aria-label="${label}: ${pct} out of 100"><i style="width:${Math.max(4, pct)}%"></i></span></span>`;
}
function firstMovesText(p) {
  const f = (arr) => arr.slice(0, 3).map(([m, s]) => `${m} ${Math.round(s * 100)}%`).join(' · ');
  return p.first ? `As White: ${f(p.first.w)}. Against 1.e4: ${f(p.first.e4)}. Against 1.d4: ${f(p.first.d4)}.` : '';
}
function oppCardHTML(p, sel) {
  if (!p) return `<button class="opp-card" data-opp="" aria-pressed="${sel}"><span class="opp-av opp-sf" aria-hidden="true">${pieceSVG('bN')}</span>
    <span class="opp-main"><b>Stockfish</b><small>The classic engine, from 400 to 2800 Elo</small><span class="opp-blurb">Plays its own best moves, weakened to the strength you pick. No opening book, no habits.</span></span></button>`;
  return `<button class="opp-card" data-opp="${p.id}" aria-pressed="${sel}"><span class="opp-av" aria-hidden="true">${initials(p.name)}</span>
    <span class="opp-main"><b>${esc(p.name)}</b><small>#${p.rank} · ${esc(p.fed)} · ${p.rating} FIDE · ${p.games.total} games</small>
    <span class="opp-meters">${meter('Sharp', p.axes.sharp)}${meter('Trades queens', p.axes.trades)}${meter('Long games', p.axes.long)}</span>
    <span class="opp-blurb">${esc(firstMovesText(p))}</span></span></button>`;
}
function renderOppPicker() {
  const p = curPersona();
  $('#oppPick').innerHTML = `<span class="opp-av${p ? '' : ' opp-sf'}" aria-hidden="true">${p ? initials(p.name) : pieceSVG('bN')}</span>
    <span class="opp-now"><b>${esc(p ? `${p.name} style` : 'Stockfish')}</b><small>${p ? `#${p.rank} in the world · ${p.rating} FIDE` : 'The classic engine'}</small></span><span class="opp-change">Change</span>`;
  $('#setupTitle').textContent = p ? `Play ${p.short} style` : 'Play Stockfish';
}
function renderOppModal() {
  const id = S.settings.opp || '';
  $('#oppGrid').innerHTML = oppCardHTML(null, !id) + PERSONA_LIST.map(p => oppCardHTML(p, p.id === id)).join('');
  const src = PERSONA_LIST[0];
  $('#oppSource').textContent = src ? `Built from ${(src.games.source || 0).toLocaleString('en-GB')} over-the-board games published in The Week in Chess, ${src.games.from} to ${src.games.to}. Online games are left out. Ratings: FIDE list of ${src.list}. Style bars compare the ten with each other.` : '';
}
function wireOpponents() {
  $('#oppPick').addEventListener('click', () => { renderOppModal(); $('#oppModal').hidden = false; const cur = $('#oppGrid [aria-pressed="true"]'); if (cur) cur.focus({ preventScroll: true }); });
  $('#oppClose').addEventListener('click', () => { $('#oppModal').hidden = true; });
  $('#oppGrid').addEventListener('click', (e) => {
    const b = e.target.closest('.opp-card'); if (!b) return;
    const p = personaById(b.dataset.opp);
    S.settings.opp = p ? p.id : null;
    if (p) { S.settings.elo = clamp(Math.round(Math.min(p.rating, ELO_MAX) / ELO_STEP) * ELO_STEP, ELO_MIN, ELO_MAX); loadBook(p.id); }
    $('#oppModal').hidden = true; renderSetup(); renderPlates(); renderSheet(); save(); $('#oppPick').focus();
  });
  if (!personaById(S.settings.opp)) S.settings.opp = null; else loadBook(S.settings.opp);
}

/* =====================================================================
   Review commentary: plain-language notes on brilliant and great moves,
   mistakes and blunders. Everything is worked out from Stockfish's lines
   plus a small exchange counter, so a note only names a hanging piece, a
   fork or a missed mate when the engine's line actually shows it.
   Also the tests that decide when a move counts as great or brilliant.
   (PVAL, the piece values, comes from personas.js.)
   ===================================================================== */
const PNAME = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const PNAMES = { p: 'pawns', n: 'knights', b: 'bishops', r: 'rooks', q: 'queens' };
const NUMBER_WORD = ['no', 'a', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
const oppOf = (c) => (c === 'w' ? 'b' : 'w');
const capFirst = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const loadFen = (fen) => { const c = new Chess(); return c.load(fen) ? c : null; };
// The same position with the other side to move: "what could they take if it were their turn?"
function withTurn(fen, color) { const p = fen.split(' '); p[1] = color; p[3] = '-'; return p.join(' '); }

/* ---------------- material: exchanges, threats, forks ---------------- */
// Net material the side to move wins by capturing on `sq` and then swapping off, each side always
// using its cheapest piece and free to stop when going on would cost it. null if nothing can capture there.
function swapOff(c, sq) {
  const caps = c.moves({ verbose: true }).filter(m => m.to === sq && m.captured && !m.flags.includes('e'));
  if (!caps.length) return null;
  const cost = (m) => (m.piece === 'k' ? 99 : PVAL[m.piece]);
  caps.sort((a, b) => cost(a) - cost(b));
  const m = caps[0]; const gain = PVAL[m.captured] + (m.promotion ? PVAL[m.promotion] - 1 : 0);
  c.move(m); const back = swapOff(c, sq); c.undo();
  return gain - Math.max(0, back || 0);
}
// The biggest material grab available to the side to move: { gain, sq, type }.
function bestGrab(c) {
  let best = null; const seen = new Set();
  for (const m of c.moves({ verbose: true })) {
    if (!m.captured || m.flags.includes('e') || seen.has(m.to)) continue;
    seen.add(m.to);
    const g = swapOff(c, m.to);
    if (g != null && (!best || g > best.gain)) best = { gain: g, sq: m.to, type: m.captured };
  }
  return best;
}
// Enemy pieces the piece on `sq` attacks (the king included, when it gives check).
function attackedFrom(fen, sq) {
  const c0 = loadFen(fen); const pc = c0 && c0.get(sq); if (!pc) return [];
  const c = loadFen(withTurn(fen, pc.color)); if (!c) return [];
  const seen = new Set(); const out = [];
  for (const m of c.moves({ square: sq, verbose: true })) if (m.captured && !seen.has(m.to)) { seen.add(m.to); out.push({ sq: m.to, type: m.captured }); }
  return out;
}
// Plays a Stockfish line and keeps track of what each side captures, stopping the count where the
// captures stop (so a line isn't judged halfway through an exchange).
function lineOutcome(fen, pv, maxPlies = 6) {
  const c = loadFen(fen); if (!c || !pv || !pv.length) return null;
  const st = { lost: { w: [], b: [] }, promo: { w: 0, b: 0 } }; const moves = [], fens = [];
  let settled = null;
  const n = Math.min(maxPlies, pv.length);
  for (let k = 0; k < n; k++) {
    const u = pv[k]; const m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || undefined }); if (!m) break;
    moves.push(m); fens.push(c.fen());
    if (m.captured) st.lost[oppOf(m.color)].push({ type: m.captured, sq: m.flags.includes('e') ? m.to[0] + m.from[1] : m.to, ply: k });
    if (m.promotion) st.promo[m.color] += PVAL[m.promotion] - 1;
    let nextTakes = false;
    if (k + 1 < n) { const v = pv[k + 1]; const x = c.move({ from: v.slice(0, 2), to: v.slice(2, 4), promotion: v[4] || undefined }); if (x) { nextTakes = !!(x.captured || x.promotion); c.undo(); } }
    if (!nextTakes) settled = { lost: { w: st.lost.w.slice(), b: st.lost.b.slice() }, promo: { w: st.promo.w, b: st.promo.b }, plies: k + 1 };
  }
  if (!moves.length) return null;
  if (!settled) settled = { lost: st.lost, promo: st.promo, plies: moves.length };
  return Object.assign(settled, { moves, fens, mated: c.in_checkmate() });
}
const sumOf = (xs) => xs.reduce((a, x) => a + PVAL[x.type], 0);
// Material colour c comes out ahead (positive) or behind (negative) over a line.
function netFor(o, c) { return o ? sumOf(o.lost[oppOf(c)]) + o.promo[c] - sumOf(o.lost[c]) - o.promo[oppOf(c)] : 0; }
// "a knight", "two pawns", "the queen", "a rook and a pawn"
function piecesWords(types) {
  const cnt = {}; for (const t of types) cnt[t] = (cnt[t] || 0) + 1;
  const parts = ['q', 'r', 'b', 'n', 'p'].filter(t => cnt[t]).map(t => cnt[t] === 1 ? (t === 'q' ? 'the queen' : `a ${PNAME[t]}`) : `${NUMBER_WORD[cnt[t]] || cnt[t]} ${PNAMES[t]}`);
  return parts.length < 2 ? (parts[0] || '') : parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
}
// What colour c gives up over a line once even trades are taken out: { mine, theirs } as lists of
// captures ({ type, sq, ply }), most valuable first.
function netLosses(o, c) {
  const mine = o.lost[c].slice(), theirs = o.lost[oppOf(c)].slice();
  for (let k = mine.length - 1; k >= 0; k--) { const j = theirs.findIndex(x => x.type === mine[k].type); if (j >= 0) { theirs.splice(j, 1); mine.splice(k, 1); } }
  const byValue = (a, b) => PVAL[b.type] - PVAL[a.type] || a.ply - b.ply;
  return { mine: mine.sort(byValue), theirs: theirs.sort(byValue) };
}
// What colour c loses over a line, as words: "a knight for a pawn". Empty when c doesn't lose anything.
function lossWords(o, c) {
  if (!o) return '';
  const { mine, theirs } = netLosses(o, c);
  if (!mine.length) return '';
  return piecesWords(mine.map(x => x.type)) + (theirs.length ? ' for ' + piecesWords(theirs.map(x => x.type)) : '');
}

/* ---------------- great and brilliant ---------------- */
// A capture anyone would play: taking a piece that has just moved there (taking back, or taking what was
// offered), or a capture that wins material on the spot.
function obviousCapture(i) {
  const L = S.line, m = L.moves[i]; if (!m.captured) return false;
  const prev = L.moves[i - 1]; if (prev && prev.to === m.to) return true;
  const c = loadFen(L.fens[i + 1]); if (!c) return false;
  const back = swapOff(c, m.to); return PVAL[m.captured] - Math.max(0, back || 0) >= 1;
}
// Does move i give material away on purpose? { sq, type, offered, moved } or null.
// The opponent must be able to win at least a piece's worth of material (or a piece for a pawn) right
// after the move, and that material must not have been there for the taking already: leaving a piece
// that was hanging anyway, or a capture that only rescues something lost anyway (a "desperado"), is no sacrifice.
function sacrificeAt(i) {
  const L = S.line, m = L.moves[i];
  const after = loadFen(L.fens[i + 1]); if (!after || after.game_over()) return null;
  const grab = bestGrab(after); if (!grab) return null;
  const took = (m.captured ? PVAL[m.captured] : 0) + (m.promotion ? PVAL[m.promotion] - 1 : 0);
  const offered = grab.gain - took;
  if (!(offered >= 2 || (offered >= 1 && grab.type !== 'p'))) return null;
  const pre = loadFen(withTurn(L.fens[i], oppOf(m.color)));
  if (pre) {
    if (grab.sq !== m.to && pre.get(grab.sq)) { const was = swapOff(pre, grab.sq); if (was != null && was >= grab.gain) return null; }
    if (m.captured) { const g0 = bestGrab(pre); if (g0 && g0.gain >= offered) return null; }
  }
  return { sq: grab.sq, type: grab.type, offered, moved: grab.sq === m.to };
}
// How a position stands for one side, in steps: 3 winning, 2 clearly better, 1 a little better, 0 level,
// down to -3 losing. The same cut-offs as the words in standing() below.
const tierOf = (p) => (p >= 86 ? 3 : p >= 68 ? 2 : p >= 57 ? 1 : p > 43 ? 0 : p > 32 ? -1 : p > 14 ? -2 : -3);
// Called from classifyAll for moves Stockfish rates best (or as good as best). Returns 'brilliant',
// 'great' or null. Results are kept per move: the positions never change during a review.
// Brilliant: a sound sacrifice that leaves the player better off (or mating).
// Great: the only good move, where every other move would have changed how the game stands by at
// least two steps (say from level to clearly worse), and not an obvious capture.
function specialMove(i, ctx) {
  const R = S.review; R.memo = R.memo || {};
  const key = i + ':' + ctx.altKey; if (key in R.memo) return R.memo[key];
  let out = null;
  const L = S.line, m = L.moves[i];
  if (!m.san.includes('#') && (ctx.after >= 55 || ctx.postMate)) {
    const sac = sacrificeAt(i);
    if (sac) { R.sac = R.sac || {}; R.sac[i] = sac; out = 'brilliant'; }
  }
  if (!out && ctx.isBest && i >= 8 && ctx.legal > 2 && ctx.alt && !m.san.includes('#')) {
    const altW = winPct(scoreOf(ctx.alt.ev) * ctx.sgn);
    if (ctx.before - altW >= 15 && tierOf(ctx.after) - tierOf(altW) >= 2 && ctx.after >= 40 && !obviousCapture(i)) out = 'great';
  }
  R.memo[key] = out;
  return out;
}

/* ---------------- words ---------------- */
// Which colour is "you" in this game, if any (your games against Stockfish, your online games and games found by your username).
function youColor() {
  const L = S.line, g = S.game; if (!L) return null;
  if (L.source === 'play' && g) return g.playerColor;
  if (L.source === 'online' && g && g.you) return g.you;
  if (L.source === 'pgn' && L.you) return L.you;      // a game found by the player's username
  return null;
}
function sideWords(c) {
  const you = youColor() === c; const name = c === 'w' ? 'White' : 'Black';
  return { you, Who: you ? 'You' : name, who: you ? 'you' : name, the: you ? 'your' : 'the', s: you ? '' : 's', is: you ? 'are' : 'is', poss: you ? 'your' : name + '’s' };
}
// How the game stands for colour c, from its winning chances: { c, lvl } where c is the side ahead.
function standing(w, c) {
  const lvl = (p) => (p >= 86 ? 'winning' : p >= 68 ? 'clearly better' : p >= 57 ? 'a little better' : null);
  if (lvl(w)) return { c, lvl: lvl(w) };
  if (lvl(100 - w)) return { c: oppOf(c), lvl: lvl(100 - w) };
  return { c: null, lvl: 'about equal' };
}
const standingSentence = (st) => { if (!st.c) return 'the game is about equal'; const P = sideWords(st.c); return `${P.who} ${P.is} ${st.lvl}`; };
const standingLeft = (st) => (st.c ? `${sideWords(st.c).who} ${st.lvl}` : 'the game about equal');
// A move in bold with its piece figure; Black's moves get the "…" in front, as on a score sheet.
const moveWords = (san, color) => (san ? `<b>${color === 'b' ? '…' : ''}${sanHTML(san)}</b>` : '');
const sqWords = (sq) => `<b>${sq}</b>`;
// For colour c, how good the position is (0–100) from an evaluation.
const chancesFor = (ev, c) => winPct(scoreOf(ev) * (c === 'w' ? 1 : -1));

/* ---------------- the notes ---------------- */
function explainBad(i) {
  const R = S.review, L = S.line, m = L.moves[i], c = m.color, o = oppOf(c), M = sideWords(c), O = sideWords(o);
  const sg = c === 'w' ? 1 : -1; const pre = R.evals[i], post = R.evals[i + 1];
  const best = uciToSan(L.fens[i], R.best[i]); const bestH = moveWords(best, c);
  const reply = R.pv[i + 1] || []; const out = [];
  let betterSaid = false, punished = false;
  const missedMate = pre && pre.mate != null && Math.sign(pre.mate) === sg && !(post && post.mate != null && Math.sign(post.mate) === sg);
  const allowsMate = post && post.mate != null && Math.sign(post.mate) === -sg;
  if (missedMate && best) {
    const n = Math.abs(pre.mate);
    out.push(n === 1 ? `${bestH} was checkmate on the spot.` : `${M.Who} could have forced checkmate in ${n} moves here, starting with ${bestH}.`);
    betterSaid = true;
  }
  if (allowsMate) {
    const n = Math.abs(post.mate); const first = reply.length ? moveWords(uciToSan(L.fens[i + 1], reply[0]), o) : '';
    out.push(n === 1 ? `This allows checkmate on the next move${first ? `: ${first}` : ''}.` : `This walks into a forced mate: ${O.who} can checkmate in ${n} moves${first ? `, starting with ${first}` : ''}.`);
    punished = true;
  } else {
    // The line starts with the move itself, so a capture it makes counts too: taking a knight and then
    // losing a pawn is no loss of material, whatever else is wrong with the move.
    const oc = reply.length ? lineOutcome(L.fens[i], [m.uci].concat(reply), 7) : null;
    const lost = oc ? -netFor(oc, c) : 0;
    const key = oc && netLosses(oc, c).mine[0];   // the most valuable thing that really goes
    if (oc && lost >= 1 && key) {
      punished = true;
      const what = PNAME[key.type]; const at = `${M.the} ${what} on ${sqWords(key.sq)}`;
      const taker = moveWords(oc.moves[key.ply].san, o); const words = lossWords(oc, c);
      const plain = words === `a ${what}` || words === 'the queen';   // the loss is just that one piece
      let said = false;
      if (key.ply === 1 && key.sq === m.to) { out.push(`This puts ${at} where it can simply be taken: ${taker}.`); said = plain; }
      else if (key.ply === 1) {
        const before = loadFen(withTurn(L.fens[i], o)); const threat = before && before.get(key.sq) ? swapOff(before, key.sq) : null;
        if (threat > 0) out.push(`${capFirst(at)} was under attack, and this move doesn’t save it. ${O.Who} take${O.s} it with ${taker}.`);
        else out.push(`After this, ${at} is no longer safe: ${O.who} can take it with ${taker}.`);
        said = plain;
      } else {
        const fm = oc.moves[1]; const hits = attackedFrom(oc.fens[1], fm.to);
        const worth = hits.filter(h => h.type === 'k' || PVAL[h.type] > PVAL[fm.piece]);
        if (worth.length >= 2 && hits.some(h => h.sq === key.sq)) {
          const names = worth.sort((a, b) => (b.type === 'k' ? 99 : PVAL[b.type]) - (a.type === 'k' ? 99 : PVAL[a.type])).slice(0, 2).map(h => PNAME[h.type]);
          out.push(`This allows a fork: ${moveWords(fm.san, o)} attacks ${M.the} ${names[0]} and ${names[1]} at the same time.`);
        } else out.push(`This lets ${O.who} win material, starting with ${moveWords(fm.san, o)}.`);
      }
      if (!said && words) out.push(`${M.Who} lose${M.s} ${words}.`);
    } else if (!missedMate && best) {
      // the best move would have won material that the move played doesn't
      const bo = lineOutcome(L.fens[i], R.pv[i] || [], 7); const won = lossWords(bo, o);
      if (bo && won && netFor(bo, c) >= 1 && netFor(bo, c) - (oc ? netFor(oc, c) : 0) >= 1) { out.push(`${M.Who} missed a chance to win ${won} with ${bestH}.`); betterSaid = true; }
    }
  }
  const afterSt = standing(chancesFor(post, c), c);
  if (!out.length) {
    const beforeSt = standing(chancesFor(pre, c), c);
    if (beforeSt.lvl !== afterSt.lvl || beforeSt.c !== afterSt.c) out.push(`Before this move ${standingSentence(beforeSt)}. Now ${standingSentence(afterSt)}.`);
    else if (afterSt.c === c) out.push(`${capFirst(standingSentence(afterSt))}, but this move gives a good part of the advantage away.`);
    else if (afterSt.c === null) out.push(`The game is still roughly level, but this move hands ${O.who} the easier position.`);
    else out.push(`${capFirst(standingSentence(afterSt))}, and this move makes it harder still for ${M.who}.`);
    const r0 = reply.length ? uciToSan(L.fens[i + 1], reply[0]) : null;
    if (r0) out.push(`${capFirst(O.poss)} best answer is ${moveWords(r0, o)}.`);
  } else if (!allowsMate) out.push(`${capFirst(standingSentence(afterSt))} now.`);
  if (!betterSaid && best) out.push(`Better was ${bestH}.`);
  const nx = L.moves[i + 1];
  if (punished && nx && R.best[i + 1] && nx.uci !== R.best[i + 1] && (R.cls[i + 1] === 'mistake' || R.cls[i + 1] === 'blunder'))
    out.push(`${O.Who} didn’t spot it in the game.`);
  return out.join(' ');
}
function explainGreat(i) {
  const R = S.review, L = S.line, m = L.moves[i], c = m.color, o = oppOf(c), M = sideWords(c), O = sideWords(o);
  const sg = c === 'w' ? 1 : -1; const post = R.evals[i + 1]; const prev = i > 0 ? R.cls[i - 1] : null;
  const out = []; const punish = prev === 'mistake' || prev === 'blunder';
  out.push(punish ? `Well spotted! This punishes ${O.poss} mistake.` : 'The only good move in this position.');
  if (post && post.mate != null && Math.sign(post.mate) === sg) { const n = Math.abs(post.mate); out.push(n === 1 ? 'It forces checkmate on the next move.' : `It leads to a forced checkmate in ${n} moves.`); }
  else { const oc = lineOutcome(L.fens[i], R.pv[i] || []); const won = lossWords(oc, o); if (oc && netFor(oc, c) >= 1 && won) out.push(`${M.Who} win${M.s} ${won}.`); }
  const alt = R.alt && R.alt[i];
  if (alt && alt.move) {
    const altSan = uciToSan(L.fens[i], alt.move); const aw = chancesFor(alt.ev, c), now = chancesFor(post, c);
    const ast = standing(aw, c); let what;
    if (punish && aw < 57 && aw > 43) what = `let ${O.who} off the hook`;
    else if (now >= 57 && ast.c === null) what = 'thrown the advantage away';
    else if (now >= 57 && ast.c === c) what = 'given much of the advantage away';
    else what = `left ${standingLeft(ast)}`;
    if (altSan) out.push(`Other moves, like ${moveWords(altSan, c)}, would have ${what}.`);
  }
  return out.join(' ');
}
function explainBrilliant(i) {
  const R = S.review, L = S.line, m = L.moves[i], c = m.color, o = oppOf(c), M = sideWords(c), O = sideWords(o);
  const sg = c === 'w' ? 1 : -1; const post = R.evals[i + 1];
  const sac = (R.sac && R.sac[i]) || sacrificeAt(i); if (!sac) return '';
  const piece = PNAME[sac.type]; const what = `${M.the} ${piece}`; const out = [];
  const nx = L.moves[i + 1]; const taken = !!(nx && nx.captured && nx.to === sac.sq);
  const reply = (R.pv[i + 1] || [])[0]; const replyTakes = !!reply && reply.slice(2, 4) === sac.sq;
  const mates = post && post.mate != null && Math.sign(post.mate) === sg;
  out.push(sac.moved ? `A real sacrifice: ${M.who} give${M.s} up ${what} on ${sqWords(sac.sq)}.`
                     : `A real sacrifice: ${M.who} leave${M.s} ${what} on ${sqWords(sac.sq)} for the taking.`);
  if (mates) {
    const n = Math.abs(post.mate);
    out.push(`${taken ? `${O.Who} took it, but whatever ${O.who} play${O.s}, ` : 'Whatever the reply, '}${n === 1 ? 'checkmate follows on the next move.' : `it ends in checkmate within ${n} moves.`}`);
    return out.join(' ');
  }
  const st = standing(chancesFor(post, c), c);
  if (!replyTakes && reply) {
    out.push(`Taking it would cost ${O.who} more than it wins, so ${O.poss} best answer is ${moveWords(uciToSan(L.fens[i + 1], reply), o)}${st.c === c ? `, and ${standingSentence(st)} after that` : ''}.`);
    if (taken) { const k = R.cls[i + 1]; out.push(`In the game ${O.who} took it anyway${k === 'mistake' || k === 'blunder' ? `, ${k === 'blunder' ? 'a blunder' : 'a mistake'}` : ''}.`); }
  } else {
    const oc = lineOutcome(L.fens[i], R.pv[i] || [], 10); const back = netFor(oc, c) >= 0;
    if (taken) out.push(`${O.Who} took it.`);
    out.push(back ? `${M.Who} win${M.s} the material back a few moves later.` : `The ${piece} is gone for good, but the play ${M.who} get${M.s} for it is worth more.`);
    if (st.c === c) out.push(`Afterwards ${standingSentence(st)}.`);
  }
  return out.join(' ');
}

/* =====================================================================
   Sound: synthesised wooden clacks and a small bell
   ===================================================================== */
const Snd = {
  ctx: null, on: true, buf: null,
  ensure() {
    if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.ctx = null; } }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  },
  clack(vol = 1, freq = 1700, delay = 0) {
    if (!this.on) return; const ctx = this.ensure(); if (!ctx) return;
    const t = ctx.currentTime + delay + .005;
    if (!this.buf) { const len = Math.floor(ctx.sampleRate * .12); const b = ctx.createBuffer(1, len, ctx.sampleRate); const d = b.getChannelData(0); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2); this.buf = b; }
    const src = ctx.createBufferSource(); src.buffer = this.buf;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 1.3;
    const g = ctx.createGain(); g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.8 * vol, t + .003); g.gain.exponentialRampToValueAtTime(.0001, t + .09);
    src.connect(bp).connect(g).connect(ctx.destination); src.start(t); src.stop(t + .13);
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(200, t); o.frequency.exponentialRampToValueAtTime(90, t + .06);
    const g2 = ctx.createGain(); g2.gain.setValueAtTime(.0001, t); g2.gain.exponentialRampToValueAtTime(.32 * vol, t + .004); g2.gain.exponentialRampToValueAtTime(.0001, t + .08);
    o.connect(g2).connect(ctx.destination); o.start(t); o.stop(t + .1);
  },
  bell(f, vol, delay = 0) {
    if (!this.on) return; const ctx = this.ensure(); if (!ctx) return;
    const t = ctx.currentTime + delay + .005;
    [[1, 1], [2.76, .35], [5.4, .12]].forEach(([m, a]) => {
      const o = ctx.createOscillator(); o.frequency.value = f * m;
      const g = ctx.createGain(); g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(vol * a, t + .01); g.gain.exponentialRampToValueAtTime(.0001, t + 1.4 / m);
      o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 1.5);
    });
  },
  move() { this.clack(.8, 1600); },
  capture() { this.clack(1, 1250); this.clack(.65, 2100, .05); },
  check() { this.clack(.9, 1500); this.bell(1046, .05, .04); },
  press() { this.clack(.3, 3300, .07); },
  end() { this.bell(523.25, .14); this.bell(659.25, .11, .14); this.bell(783.99, .1, .28); },
};

/* =====================================================================
   App state
   ===================================================================== */
const S = {
  mode: 'idle',              // idle | play | paused | over | review
  settings: { color: 'w', elo: 1200, opp: null, tc: '3+2', sound: true, premove: true, pieces: 'wood', board: 'wood', look: 'light' },
  line: null,                // { startFen, fens[], moves[], names{w,b}, subs{w,b}, headers, result, reason, source }
  game: null,                // { playerColor, level, tc, clock:{w,b,running,last}, lastEngineScore }
  chess: null,               // live chess.js game
  view: 0,
  orientation: 'w',
  sel: null, legal: [],
  premoves: [],              // [{from, to, promo}] queued while the opponent is to move
  engineToken: 0, thinking: false,
  review: null,
  bannerOpen: false,
};
function newLine(startFen, names, subs, extra = {}) {
  return Object.assign({ startFen, fens: [startFen], moves: [], names, subs, headers: {}, result: '*', reason: '', source: 'play' }, extra);
}
const tcById = (id) => TCS.find(t => t.id === id) || TCS[2];
const chessAt = (fen) => new Chess(fen);
const liveIndex = () => S.line ? S.line.fens.length - 1 : 0;

/* =====================================================================
   Board view
   ===================================================================== */
const boardEl = () => $('#board');
function sqToCR(sq) {
  const f = sq.charCodeAt(0) - 97, r = +sq[1];
  return S.orientation === 'w' ? [f, 8 - r] : [7 - f, r - 1];
}
function crToSq(c, r) {
  const f = S.orientation === 'w' ? c : 7 - c, rank = S.orientation === 'w' ? 8 - r : r + 1;
  return String.fromCharCode(97 + f) + rank;
}
let boardPx = 400;
function layoutBoard() {
  const vw = document.documentElement.clientWidth, vh = window.innerHeight;
  const wide = vw >= 980;
  const evw = S.mode === 'review' ? (wide ? 34 : 28) : 0;
  let size;
  // beside the board: the menu on the left (--navw), the panel (360) and the gap (26); above and below it the player bars
  const navw = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--navw')) || 0;
  if (wide) size = Math.min(vw - navw - 32 - 360 - 26 - evw, vh - 186, 820);
  else size = Math.min(vw - 32 - evw, 620);
  size = Math.max(250, Math.floor(size));
  document.documentElement.style.setProperty('--bw', size + 'px');
  document.documentElement.style.setProperty('--evw', evw + 'px');
  boardPx = size;
  requestAnimationFrame(() => {
    const inner = boardEl().getBoundingClientRect().width;
    boardEl().style.setProperty('--sq', (inner / 8) + 'px');
    drawFrame(); drawBoardCanvas();
    if (TEX.ready) scheduleTextureUpgrade();
  });
}
function hash32(n) { n = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b); n ^= n >>> 13; n = Math.imul(n, 0xc2b2ae35); n ^= n >>> 16; return (n >>> 0) / 4294967296; }
function drawBoardCanvas() {
  const cv = $('#boardCanvas'); const rect = boardEl().getBoundingClientRect();
  const dpr = DPR(); const W = Math.round(rect.width * dpr);
  if (!W) return;
  cv.width = cv.height = W; const ctx = cv.getContext('2d'); const sq = W / 8;
  if (paintOtherBoard(ctx, W, sq, dpr)) return;
  const set = woodSet() || WOOD_BOARDS.wood, sw = BOARDS[curBoard()] ? BOARDS[curBoard()].swatch : BOARDS.wood.swatch;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const light = (r + c) % 2 === 0;
    // whole device pixels, so the wood is copied pixel for pixel instead of being resampled (which blurs it)
    const x = Math.round(c * sq), y = Math.round(r * sq), n = Math.round((c + 1) * sq) - x, m = Math.round((r + 1) * sq) - y, s = Math.max(n, m);
    const name = crToSq(c, r); const id = (name.charCodeAt(0) - 97) + (+name[1]) * 8;
    ctx.save(); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.beginPath(); ctx.rect(x, y, n, m); ctx.clip();
    const tex = TEX.wood[light ? set.light : set.dark];
    if (tex) {
      const src = tex.scale === Math.ceil(sq) ? s : Math.min(tex.width, s * tex.scale / sq);
      const sx = Math.floor(hash32(id * 3 + 1) * (tex.width - src)), sy = Math.floor(hash32(id * 7 + 2) * (tex.height - src));
      const rot = ((+name[1]) + (name.charCodeAt(0) - 97)) % 4 < 2;
      if (rot) { ctx.translate(x + s, y); ctx.rotate(Math.PI / 2); ctx.drawImage(tex, sx, sy, src, src, 0, 0, s, s); }
      else ctx.drawImage(tex, sx, sy, src, src, x, y, s, s);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const tone = (hash32(id * 13 + 5) - .5) * .1;
      ctx.fillStyle = tone > 0 ? `rgba(255,236,200,${tone})` : `rgba(40,18,6,${-tone})`;
      ctx.fillRect(x, y, n, m);
    } else {
      ctx.fillStyle = light ? sw[0] : sw[1]; ctx.fillRect(x, y, n, m);
    }
    ctx.restore();
  }
  ctx.strokeStyle = 'rgba(32,14,4,.5)'; ctx.lineWidth = Math.max(1, dpr * .8);
  ctx.beginPath();
  for (let i = 1; i < 8; i++) { const p = Math.round(i * sq); ctx.moveTo(p, 0); ctx.lineTo(p, W); ctx.moveTo(0, p); ctx.lineTo(W, p); }
  ctx.stroke();
  const g = ctx.createLinearGradient(0, 0, W, W);
  g.addColorStop(0, 'rgba(255,244,222,.13)'); g.addColorStop(.42, 'rgba(255,244,222,0)'); g.addColorStop(1, 'rgba(0,0,0,.12)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, W);
}
function drawFrame() {
  const cv = $('#frameCanvas'); const wrap = $('#boardWrap'); const dpr = DPR();
  const W = Math.round(wrap.getBoundingClientRect().width * dpr); if (!W) return;
  cv.width = cv.height = W; const ctx = cv.getContext('2d'); const f = W * .048;
  if (paintOtherFrame(ctx, W, f, dpr)) return;
  const sides = [
    { pts: [[0, 0], [W, 0], [W - f, f], [f, f]], rot: 0 },
    { pts: [[0, W], [W, W], [W - f, W - f], [f, W - f]], rot: 0 },
    { pts: [[0, 0], [f, f], [f, W - f], [0, W]], rot: 1 },
    { pts: [[W, 0], [W, W], [W - f, W - f], [W - f, f]], rot: 1 },
  ];
  sides.forEach((s, i) => {
    ctx.save(); ctx.beginPath(); s.pts.forEach(([x, y], j) => j ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); ctx.clip();
    const t = TEX.wood[(woodSet() || WOOD_BOARDS.wood).frame];
    if (t) {
      const st = frameStrip(t.width); const sy = st.gap + i * (st.band + st.gap); const sh = t.width * .048;
      ctx.imageSmoothingQuality = 'high';
      if (i === 0) ctx.drawImage(t, 0, sy, t.width, sh, 0, 0, W, f);
      else if (i === 1) ctx.drawImage(t, 0, sy, t.width, sh, 0, W - f, W, f);
      else { ctx.translate(i === 2 ? f : W, 0); ctx.rotate(Math.PI / 2); ctx.drawImage(t, 0, sy, t.width, sh, 0, 0, W, f); }
    } else { ctx.fillStyle = '#4a2214'; ctx.fillRect(0, 0, W, W); }
    ctx.restore();
  });
  // bevel light and shade
  const shade = (pts, col) => { ctx.beginPath(); pts.forEach(([x, y], j) => j ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); ctx.fillStyle = col; ctx.fill(); };
  shade(sides[0].pts, 'rgba(255,225,190,.07)'); shade(sides[2].pts, 'rgba(255,225,190,.04)');
  shade(sides[1].pts, 'rgba(0,0,0,.16)'); shade(sides[3].pts, 'rgba(0,0,0,.12)');
  ctx.strokeStyle = 'rgba(15,5,2,.55)'; ctx.lineWidth = Math.max(1, dpr);
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(f, f); ctx.moveTo(W, 0); ctx.lineTo(W - f, f); ctx.moveTo(0, W); ctx.lineTo(f, W - f); ctx.moveTo(W, W); ctx.lineTo(W - f, W - f); ctx.stroke();
  const edge = ctx.createLinearGradient(0, 0, 0, W); edge.addColorStop(0, 'rgba(255,220,180,.35)'); edge.addColorStop(1, 'rgba(255,220,180,.05)');
  ctx.strokeStyle = edge; ctx.lineWidth = dpr * 1.2; ctx.strokeRect(dpr * .6, dpr * .6, W - dpr * 1.2, W - dpr * 1.2);
}
function renderCoords() {
  const files = 'abcdefgh'.split(''); const ranks = '87654321'.split('');
  if (S.orientation === 'b') { files.reverse(); ranks.reverse(); }
  $('#coordFiles').innerHTML = files.map(f => `<span>${f}</span>`).join('');
  $('#coordRanks').innerHTML = ranks.map(r => `<span>${r}</span>`).join('');
}

// ---- pieces with smooth diffing
let pieceEls = []; // {el, code, sq}
let pieceUid = 0;
function boardMap(fen) {
  const map = {}; const rows = fen.split(' ')[0].split('/');
  rows.forEach((row, ri) => { let f = 0; for (const ch of row) { if (/\d/.test(ch)) f += +ch; else { const sq = String.fromCharCode(97 + f) + (8 - ri); map[sq] = (ch === ch.toUpperCase() ? 'w' : 'b') + ch.toUpperCase(); f++; } } });
  return map;
}
function placeEl(el, sq) { const [c, r] = sqToCR(sq); el.style.setProperty('--x', c); el.style.setProperty('--y', r); }
function renderPieces(fen, animate = true) {
  const layer = $('#pieceLayer'); const map = showsPremoves(fen) ? premoveMap() : boardMap(fen);
  const want = Object.entries(map); const used = new Set(); const keep = [];
  const remaining = [];
  for (const p of pieceEls) {
    if (map[p.sq] === p.code && !used.has(p.sq)) {
      used.add(p.sq); keep.push(p);
      // The board may have turned around since this piece was drawn (e.g. an online game as Black): snap it into place
      const [c, r] = sqToCR(p.sq);
      if (+p.el.style.getPropertyValue('--x') !== c || +p.el.style.getPropertyValue('--y') !== r) { p.el.style.transition = 'none'; placeEl(p.el, p.sq); void p.el.offsetWidth; p.el.style.transition = ''; }
    } else remaining.push(p);
  }
  const unmatched = want.filter(([sq]) => !used.has(sq));
  for (const [sq, code] of unmatched) {
    let bestI = -1, bestD = 99;
    remaining.forEach((p, i) => { if (p && p.code === code) { const a = sqToCR(p.sq), b = sqToCR(sq); const d = Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])); if (d < bestD) { bestD = d; bestI = i; } } });
    if (bestI >= 0) {
      const p = remaining[bestI]; remaining[bestI] = null; p.sq = sq;
      if (!animate) p.el.style.transition = 'none';
      placeEl(p.el, sq); p.el.style.zIndex = 3; keep.push(p);
      if (!animate) { void p.el.offsetWidth; p.el.style.transition = ''; }
      setTimeout(() => { p.el.style.zIndex = ''; }, 230);
    } else {
      const el = document.createElement('div'); el.className = 'pc' + (animate ? ' fresh' : ''); el.innerHTML = pieceSVG(code); el.dataset.id = ++pieceUid;
      placeEl(el, sq); layer.appendChild(el); keep.push({ el, code, sq });
      if (animate) requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('fresh')));
    }
  }
  for (const p of remaining) { if (!p) continue; if (animate) { p.el.classList.add('gone'); setTimeout(() => p.el.remove(), 200); } else p.el.remove(); }
  pieceEls = keep;
}
function repositionAll() { pieceEls.forEach(p => { p.el.style.transition = 'none'; placeEl(p.el, p.sq); void p.el.offsetWidth; p.el.style.transition = ''; }); }

function renderHighlights() {
  const layer = $('#hlLayer'); let h = '';
  const L = S.line; if (!L) { layer.innerHTML = ''; return; }
  const v = S.view; const mv = v > 0 ? L.moves[v - 1] : null;
  const rv = S.mode === 'review' && S.review ? S.review : null;
  const cls = rv && v > 0 ? rv.cls[v - 1] : null;
  const box = (sq, klass, extra = '') => { const [c, r] = sqToCR(sq); return `<div class="hl ${klass}" style="--c:${c};--r:${r};${extra}"></div>`; };
  if (mv) {
    if (cls) { h += box(mv.from, 'hl-cls', `--cc:var(--c-${cls})`) + box(mv.to, 'hl-cls', `--cc:var(--c-${cls})`); }
    else h += box(mv.from, 'hl-last') + box(mv.to, 'hl-last');
  }
  if (S.premoves.length && v === liveIndex()) { const pre = new Set(); for (const pm of S.premoves) { pre.add(pm.from); pre.add(pm.to); } for (const sq of pre) h += box(sq, 'hl-pre'); }
  const pos = chessAt(L.fens[v]);
  if (pos.in_check()) {
    const turn = pos.turn(); const map = boardMap(L.fens[v]);
    const ksq = Object.keys(map).find(s => map[s] === turn + 'K'); if (ksq) h += box(ksq, 'hl-check');
  }
  if (S.sel) {
    h += box(S.sel, 'hl-sel');
    for (const m of S.legal) h += box(m.to, 'hint' + (m.captured || m.flags.includes('e') ? ' cap' : ''));
  }
  if (dragState && dragState.hover && dragState.hover !== dragState.from) h += box(dragState.hover, 'hl-hover');
  h += trainerHighlights(box);
  if (cls && mv) { const [c, r] = sqToCR(mv.to); h += `<div class="badge" style="--c:${c};--r:${r};--cc:var(--c-${cls})" title="${CLS[cls].label}">${CLS[cls].sym}</div>`; }
  layer.innerHTML = h;
  renderArrows();
}
function renderArrows() {
  const svg = $('#arrowLayer'); let out = '';
  const rv = S.mode === 'review' && S.review ? S.review : null;
  if (rv && S.view > 0) {
    const i = S.view - 1; const cls = rv.cls[i]; const best = rv.best[i];
    if (best && cls && !['best', 'forced', 'great', 'brilliant'].includes(cls)) out += arrowPath(best.slice(0, 2), best.slice(2, 4), 'var(--c-best)');
  }
  out += trainerArrows();
  svg.innerHTML = out;
}
function arrowPath(from, to, color) {
  const [c1, r1] = sqToCR(from), [c2, r2] = sqToCR(to);
  const x1 = c1 + .5, y1 = r1 + .5, x2 = c2 + .5, y2 = r2 + .5;
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy); const ux = dx / len, uy = dy / len, px = -uy, py = ux;
  const sw = .085, hw = .25, hl = .38; const sx = x1 + ux * .22, sy = y1 + uy * .22; const ex = x2 - ux * .08, ey = y2 - uy * .08; const bx = ex - ux * hl, by = ey - uy * hl;
  const pts = [[sx + px * sw, sy + py * sw], [bx + px * sw, by + py * sw], [bx + px * hw, by + py * hw], [ex, ey], [bx - px * hw, by - py * hw], [bx - px * sw, by - py * sw], [sx - px * sw, sy - py * sw]];
  return `<path d="M${pts.map(p => p[0].toFixed(3) + ',' + p[1].toFixed(3)).join(' L')} Z" fill="${color}" fill-opacity=".82" stroke="rgba(20,40,10,.5)" stroke-width=".02"/>`;
}

// ---- premoves: queue moves while the opponent is to move; each one plays the instant the turn comes back.
// The queued moves are drawn on the board in red. Clicking an empty square, right-clicking or Esc cancels them all.
function canPremove() {
  if (!S.chess || S.promoPending || S.view !== liveIndex() || S.settings.premove === false) return false;
  if (S.mode === 'play') return !!S.game && S.chess.turn() !== S.game.playerColor;
  if (S.mode === 'online') return !!(window.WP_ONLINE && window.WP_ONLINE.canPremove());
  return false;
}
const myColor = () => (S.game ? S.game.playerColor : 'w');
const isLastRank = (sq) => sq[1] === '8' || sq[1] === '1';
const showsPremoves = (fen) => S.premoves.length > 0 && !!S.line && S.view === liveIndex() && fen === S.line.fens[S.view];
function applyPremove(map, pm) {
  const code = map[pm.from]; const m = Object.assign({}, map); delete m[pm.from];
  const f0 = pm.from.charCodeAt(0), f1 = pm.to.charCodeAt(0);
  if (code[1] === 'K' && pm.from[0] === 'e' && Math.abs(f1 - f0) === 2) {   // castling: bring the rook along
    const rank = pm.from[1]; const [rf, rt] = f1 > f0 ? ['h', 'f'] : ['a', 'd'];
    if (m[rf + rank] === code[0] + 'R') { delete m[rf + rank]; m[rt + rank] = code[0] + 'R'; }
  }
  m[pm.to] = code[1] === 'P' && isLastRank(pm.to) ? code[0] + (pm.promo || 'q').toUpperCase() : code;
  return m;
}
// The board as it will look once the queued premoves have been played
function premoveMap() {
  let map = boardMap(S.line.fens[liveIndex()]); const me = myColor();
  for (const pm of S.premoves) if (map[pm.from] && map[pm.from][0] === me) map = applyPremove(map, pm);
  return map;
}
// Where a piece could go once it is our move. Opponent pieces don't block (they may move away); our own pieces do.
function premoveDests(sq) {
  const map = premoveMap(); const me = myColor(); const code = map[sq];
  if (!code || code[0] !== me) return [];
  const t = code[1], f = sq.charCodeAt(0) - 97, r = +sq[1] - 1; const out = [];
  const name = (x, y) => String.fromCharCode(97 + x) + (y + 1);
  const onBoard = (x, y) => x >= 0 && x < 8 && y >= 0 && y < 8;
  const mine = (x, y) => { const c = map[name(x, y)]; return !!c && c[0] === me; };
  const step = (dx, dy) => { if (onBoard(f + dx, r + dy) && !mine(f + dx, r + dy)) out.push(name(f + dx, r + dy)); };
  const slide = (dx, dy) => { for (let x = f + dx, y = r + dy; onBoard(x, y) && !mine(x, y); x += dx, y += dy) out.push(name(x, y)); };
  if (t === 'P') {
    const d = me === 'w' ? 1 : -1;
    step(0, d); if (r === (me === 'w' ? 1 : 6) && !mine(f, r + d)) step(0, 2 * d);
    step(-1, d); step(1, d);
  } else if (t === 'N') {
    for (const [dx, dy] of [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]]) step(dx, dy);
  } else if (t === 'K') {
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (dx || dy) step(dx, dy);
    const home = me === 'w' ? 0 : 7; const rights = S.chess.fen().split(' ')[2];
    if (f === 4 && r === home) {
      if (rights.includes(me === 'w' ? 'K' : 'k') && map[name(7, home)] === me + 'R' && !mine(5, home) && !mine(6, home)) out.push(name(6, home));
      if (rights.includes(me === 'w' ? 'Q' : 'q') && map[name(0, home)] === me + 'R' && !mine(1, home) && !mine(2, home) && !mine(3, home)) out.push(name(2, home));
    }
  } else {
    const rook = [[1, 0], [-1, 0], [0, 1], [0, -1]], bishop = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (const [dx, dy] of t === 'R' ? rook : t === 'B' ? bishop : rook.concat(bishop)) slide(dx, dy);
  }
  return out.map(to => ({ from: sq, to, flags: '', captured: map[to] ? map[to][1].toLowerCase() : undefined, promotion: t === 'P' && isLastRank(to) ? 'q' : undefined, pre: true }));
}
function queuePremove(from, to, promo) {
  S.sel = null; S.legal = [];
  S.premoves.push({ from, to, promo: promo || null });
  if (canUserMove()) { runPremove(); return; }   // the opponent moved in the meantime: play it right away
  Snd.clack(.35, 2600);
  renderPieces(S.line.fens[S.view]); renderAll();
}
// Plays the first queued premove if it is our turn. An illegal premove cancels the whole queue, as on chess.com.
function runPremove() {
  if (!S.premoves.length || !canUserMove()) return false;
  const pm = S.premoves[0];
  const ok = !S.chess.game_over() && S.chess.moves({ square: pm.from, verbose: true }).some(m => m.to === pm.to);
  if (!ok) { clearPremoves(); return false; }
  S.premoves.shift();
  commitUserMove(pm.from, pm.to, pm.promo);
  return true;
}
// Forget the queue without any fuss (game over, new game, looking back)
function dropPremoves() {
  if (!S.premoves.length) return; S.premoves = [];
  const fen = S.line && S.line.fens[S.view]; if (fen) renderPieces(fen);
}
// The player cancelled: forget the queue and redraw
function clearPremoves() {
  dropPremoves();
  if (!canUserMove()) { S.sel = null; S.legal = []; }
  renderHighlights(); renderNav(); boardEl().classList.toggle('can-move', canUserMove() || canPremove());
}
// After the position changed under a selected piece, keep the selection only if it still makes sense
function refreshSelection() {
  if (!S.sel) return;
  const live = canUserMove(), pre = !live && canPremove();
  const code = pieceCodeAt(S.sel, pre);
  if ((live || pre) && code && code[0] === myColor()) S.legal = live ? S.chess.moves({ square: S.sel, verbose: true }) : premoveDests(S.sel);
  else { S.sel = null; S.legal = []; }
}
function pieceCodeAt(sq, pre) {
  if (pre) return premoveMap()[sq] || null;
  const p = S.chess.get(sq); return p ? p.color + p.type.toUpperCase() : null;
}
function premoveNote() {
  const n = S.premoves.length; const touch = window.matchMedia && matchMedia('(pointer: coarse)').matches;
  return `${n === 1 ? 'Premove' : n + ' premoves'} set. ${touch ? 'Tap an empty square' : 'Right-click or press Esc'} to cancel.`;
}

// ---- input: click and drag
let dragState = null;
let lastPointerType = 'mouse';
function canUserMove() {
  if (!S.chess || S.promoPending || S.view !== liveIndex()) return false;
  if (S.mode === 'play') return !!S.game && S.chess.turn() === S.game.playerColor && !S.thinking;
  if (S.mode === 'puzzle') return T.kind === 'puzzle' && PZ.state === 'solving' && S.chess.turn() === PZ.color;
  if (S.mode === 'lesson') return T.kind === 'lesson' && LS.phase === 'practice' && LS.state === 'await' && S.chess.turn() === LS.color;
  if (S.mode === 'online') return !!(window.WP_ONLINE && window.WP_ONLINE.canMove());
  return false;
}
function sqFromEvent(e) {
  const rect = boardEl().getBoundingClientRect();
  const c = Math.floor((e.clientX - rect.left) / rect.width * 8), r = Math.floor((e.clientY - rect.top) / rect.height * 8);
  if (c < 0 || c > 7 || r < 0 || r > 7) return null; return crToSq(c, r);
}
function selectSq(sq) {
  S.sel = sq; S.legal = !sq ? [] : canUserMove() ? S.chess.moves({ square: sq, verbose: true }) : canPremove() ? premoveDests(sq) : [];
  renderHighlights();
}
function onPointerDown(e) {
  lastPointerType = e.pointerType || 'mouse';
  if (e.button !== undefined && e.button !== 0) return;
  const live = canUserMove(), pre = !live && canPremove();
  if (!live && !pre) { if (S.sel) selectSq(null); return; }
  const sq = sqFromEvent(e); if (!sq) return;
  if (S.sel && S.legal.some(m => m.to === sq)) { tryUserMove(S.sel, sq); return; }
  const code = pieceCodeAt(sq, pre);
  if (code && code[0] === (pre ? myColor() : S.chess.turn())) {
    const wasSel = S.sel === sq; selectSq(sq);
    const p = pieceEls.find(x => x.sq === sq);
    dragState = { from: sq, code, startX: e.clientX, startY: e.clientY, active: false, el: p ? p.el : null, ghost: null, wasSel, hover: null, pid: e.pointerId };
    try { boardEl().setPointerCapture(e.pointerId); } catch (_) {}
    e.preventDefault();
  } else if (pre && S.premoves.length) clearPremoves();   // a click elsewhere on the board cancels the premoves
  else if (S.sel) selectSq(null);
}
function onPointerMove(e) {
  if (!dragState) return;
  if (!dragState.active) {
    if (Math.hypot(e.clientX - dragState.startX, e.clientY - dragState.startY) < 5) return;
    dragState.active = true;
    const g = document.createElement('div'); g.className = 'ghost'; g.innerHTML = pieceSVG(dragState.code);
    boardEl().appendChild(g); dragState.ghost = g; if (dragState.el) dragState.el.classList.add('lift');
  }
  const rect = boardEl().getBoundingClientRect(); const sqpx = rect.width / 8;
  dragState.ghost.style.transform = `translate(${e.clientX - rect.left - sqpx / 2}px, ${e.clientY - rect.top - sqpx * .6}px)`;
  const hv = sqFromEvent(e); if (hv !== dragState.hover) { dragState.hover = hv; renderHighlights(); }
}
function onPointerUp(e) {
  if (!dragState) return; const ds = dragState; dragState = null;
  try { boardEl().releasePointerCapture(ds.pid); } catch (_) {}
  if (ds.ghost) ds.ghost.remove(); if (ds.el) ds.el.classList.remove('lift');
  if (ds.active) {
    const to = sqFromEvent(e);
    if (to && to !== ds.from && S.legal.some(m => m.to === to)) {
      if (ds.el) { ds.el.style.transition = 'none'; placeEl(ds.el, to); void ds.el.offsetWidth; ds.el.style.transition = ''; }
      tryUserMove(ds.from, to, true);
    } else renderHighlights();
  } else if (ds.wasSel) selectSq(null);
  else renderHighlights();
}
function tryUserMove(from, to, dragged) {
  const cands = S.legal.filter(m => m.from === from && m.to === to); if (!cands.length) return;
  const pre = !!cands[0].pre;
  if (cands.some(m => m.promotion)) { openPromo(from, to, pre); return; }
  if (pre) queuePremove(from, to); else commitUserMove(from, to);
}
function openPromo(from, to, pre = false) {
  S.promoPending = true; const el = $('#promo'); const color = pre ? myColor() : S.chess.turn(); const [c, r] = sqToCR(to);
  const top = r === 0; el.style.left = (c * 12.5) + '%'; el.style.top = top ? '0' : 'auto'; el.style.bottom = top ? 'auto' : '0';
  el.innerHTML = ['q', 'r', 'b', 'n'].map(p => `<button data-p="${p}" aria-label="Promote to ${({ q: 'queen', r: 'rook', b: 'bishop', n: 'knight' })[p]}">${pieceSVG(color + p.toUpperCase())}</button>`).join('');
  if (!top) el.style.flexDirection = 'column-reverse'; else el.style.flexDirection = 'column';
  el.hidden = false; el.querySelector('button').focus();
  el.onclick = (ev) => {
    const b = ev.target.closest('button'); if (!b) return; closePromo();
    if (!pre) { commitUserMove(from, to, b.dataset.p); return; }
    runPremove();                      // the opponent may have moved while the picker was open: older premoves go first
    queuePremove(from, to, b.dataset.p);
  };
}
function closePromo() { $('#promo').hidden = true; S.promoPending = false; }
function commitUserMove(from, to, promo) {
  const mv = S.chess.move({ from, to, promotion: promo || 'q' }); if (!mv) return;
  S.sel = null; S.legal = [];
  if (S.mode === 'puzzle') puzzleMove(mv);
  else if (S.mode === 'lesson') lessonMove(mv);
  else if (S.mode === 'online' && window.WP_ONLINE) window.WP_ONLINE.move(mv);
  else afterMove(mv);
}

/* =====================================================================
   The clocks: one in each player bar, next to the player's name (like chess.com)
   ===================================================================== */
function fmtTime(ms, tenths) {
  if (ms <= 0) return '0:00';
  if (tenths && ms < 10000) return (Math.floor(ms / 100) / 10).toFixed(1);
  const s = Math.ceil(ms / 1000); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}
function remaining(color) {
  const g = S.game; if (!g) return 0; const c = g.clock;
  return c.running === color && (S.mode === 'play' || S.mode === 'online') ? c[color] - (performance.now() - c.last) : c[color];
}
function updateClock() {
  const g = S.game; const tc = g ? tcById(g.tc) : tcById(S.mode === 'online' && window.WP_ONLINE ? window.WP_ONLINE.tc() : S.settings.tc);
  const timed = tc.base > 0; const live = S.mode === 'play' || S.mode === 'online';
  document.querySelectorAll('.tchip').forEach(ch => {
    const color = ch.dataset.color; const rem = g ? Math.max(0, remaining(color)) : tc.base * 1000;
    const txt = timed ? fmtTime(rem, true) : '∞'; if (ch.textContent !== txt) ch.textContent = txt;
    const on = g && live && g.clock.running === color; ch.classList.toggle('on', !!on);
    ch.classList.toggle('low', !!(timed && g && rem < 20000 && live));
  });
}

/* =====================================================================
   Engine: Stockfish 19 "lite, single-threaded" (stockfish.js 19.0.1) in a Web Worker.
   WebAssembly first, asm.js as the fallback for browsers without WebAssembly. The lite build
   evaluates with a small neural network (about 1.9 MB in all) and runs on any host, without the
   cross-origin isolation headers the multi-threaded builds need.
   ===================================================================== */
const SF_VERSION = '19';
// Game review: every position is searched to this depth, or for this long, whichever comes first.
// Measured on 400 moves of club-level games against full-size Stockfish 19 at depth 20: depth 18 gave
// the same grade on 70% of moves and accuracy within about 1 point, at roughly 1.2 s per position on one
// core of the test machine (depth 15: 68%, 2-4 points off, 0.5 s; old Stockfish 10 at depth 15: 52%, 12 points off).
const REVIEW_DEPTH = 18, REVIEW_MS = 1700, REVIEW_MS_ASM = 1200;
// The lite network's evaluations run about a fifth smaller than full-size Stockfish 19's, which the
// winning-chances curve and every grade threshold are made for. Review evaluations are scaled up to match.
const EVAL_SCALE = 1.2;
const ENGINE_SOURCES = [
  { url: '/stockfish.js', label: 'WebAssembly' },
  { url: '/stockfish.asm.js', label: 'asm.js' },
];
function spawnWorker(src) {
  if (src.blob) return new Worker(URL.createObjectURL(new Blob([`importScripts(${JSON.stringify(src.url)});`], { type: 'text/javascript' })) + '#' + encodeURIComponent(src.wasm));
  return new Worker(src.url);
}
function bootWorker(src, timeout = 12000) {
  return new Promise(resolve => {
    let w; try { w = spawnWorker(src); } catch (e) { resolve(null); return; }
    let done = false;
    const fail = () => { if (done) return; done = true; try { w.terminate(); } catch (_) {} resolve(null); };
    const to = setTimeout(fail, timeout);
    w.onerror = (e) => { if (e && e.preventDefault) e.preventDefault(); fail(); };
    w.onmessage = (e) => { if (String(e.data).trim() === 'uciok' && !done) { done = true; clearTimeout(to); w.onmessage = null; w.onerror = null; resolve(w); } };
    w.postMessage('uci');
  });
}
function parseInfo(line) {
  const t = line.split(/\s+/); const o = {};
  for (let i = 1; i < t.length; i++) {
    const k = t[i];
    if (k === 'depth') o.depth = +t[++i];
    else if (k === 'multipv') o.multipv = +t[++i];
    else if (k === 'score') { const kind = t[++i]; const v = +t[++i]; if (kind === 'cp') o.cp = v; else o.mate = v; if (t[i + 1] === 'lowerbound' || t[i + 1] === 'upperbound') { o.bound = true; i++; } }
    else if (k === 'pv') { o.pv = t.slice(i + 1); break; }
  }
  return ('cp' in o || 'mate' in o) ? o : null;
}
class Engine {
  constructor(worker) {
    this.w = worker; this.q = []; this.cur = null; this.skill = null; this.mpv = 1;
    worker.onmessage = (e) => this.onLine(String(e.data));
    worker.onerror = (e) => { if (e && e.preventDefault) e.preventDefault(); };
    this.send('setoption name Hash value 16');
  }
  send(c) { this.w.postMessage(c); }
  onLine(line) {
    if (!this.cur) return;
    if (line.startsWith('info ') && line.includes(' score ')) {
      const info = parseInfo(line);
      if (info && !info.bound && info.pv) { const k = info.multipv || 1; this.cur.lines[k - 1] = info; if (k === 1) this.cur.last = info; }
    } else if (line.startsWith('bestmove')) {
      const parts = line.split(/\s+/); const job = this.cur; this.cur = null;
      job.resolve({ bestmove: parts[1] && parts[1] !== '(none)' ? parts[1] : null, info: job.last || null, lines: job.lines });
      this.next();
    }
  }
  search(opts) { return new Promise(resolve => { this.q.push(Object.assign({}, opts, { resolve })); if (!this.cur) this.next(); }); }
  next() {
    const job = this.q.shift(); if (!job) return; this.cur = job; job.lines = [];
    const mpv = job.multipv || 1; if (mpv !== this.mpv) { this.send(`setoption name MultiPV value ${mpv}`); this.mpv = mpv; }
    const sk = job.skill == null ? 20 : job.skill;
    if (sk !== this.skill) { this.send(`setoption name Skill Level value ${sk}`); this.skill = sk; }
    this.send(`position fen ${job.fen}`);
    let go = 'go'; if (job.depth) go += ` depth ${job.depth}`; if (job.movetime) go += ` movetime ${Math.max(20, Math.round(job.movetime))}`;
    this.send(go);
  }
  cancelAll() { for (const j of this.q) j.resolve(null); this.q = []; if (this.cur) this.send('stop'); }
}
const ENG = { main: null, pool: [], source: null, ready: null, status: 'loading' };
function setEngineStatus(text, state) { const el = $('#engineStatus'); el.textContent = text; el.classList.toggle('ok', state === 'ok'); el.classList.toggle('bad', state === 'bad'); }
function bootEngine() {
  ENG.ready = (async () => {
    for (const src of ENGINE_SOURCES) {
      const w = await bootWorker(src, src.label === 'WebAssembly' ? 15000 : 40000);
      if (w) { ENG.source = src; ENG.main = new Engine(w); ENG.pool = [ENG.main]; ENG.status = 'ok'; setEngineStatus(`Stockfish ${SF_VERSION} ready · ${src.label}`, 'ok'); return ENG.main; }
    }
    ENG.status = 'bad'; setEngineStatus('Stockfish could not start in this browser. Reload the page to try again.', 'bad');
    return null;
  })();
  return ENG.ready;
}
async function getPool() {
  await ENG.ready; if (!ENG.main) return [];
  const want = clamp((navigator.hardwareConcurrency || 2) - 1, 1, 3);
  while (ENG.pool.length < want) {
    const w = await bootWorker(ENG.source); if (!w) break; ENG.pool.push(new Engine(w));
  }
  return ENG.pool;
}

/* =====================================================================
   Game flow
   ===================================================================== */
function playerNames(playerColor, level, persona) {
  const eng = botName(persona), you = 'You';
  const names = playerColor === 'w' ? { w: you, b: eng } : { w: eng, b: you };
  const lab = persona ? `Bot · ≈${level}` : eloLabel(level);
  const subs = playerColor === 'w' ? { w: 'White', b: lab } : { w: lab, b: 'Black' };
  return { names, subs };
}
function startGame() {
  Snd.ensure(); trainerStop();
  const st = S.settings; const pc = st.color === 'r' ? (Math.random() < .5 ? 'w' : 'b') : st.color;
  const tc = tcById(st.tc); const persona = curPersona(); const { names, subs } = playerNames(pc, st.elo, persona);
  S.engineToken++; if (ENG.main) ENG.main.cancelAll();
  S.chess = new Chess();
  S.line = newLine(START_FEN, names, subs, { headers: { Date: new Date().toISOString().slice(0, 10).replace(/-/g, '.') } });
  S.game = { playerColor: pc, elo: st.elo, opp: persona ? persona.id : null, tc: tc.id, clock: { w: tc.base * 1000, b: tc.base * 1000, running: null, last: 0 }, lastEngineScore: null };
  S.view = 0; S.sel = null; S.legal = []; S.premoves = []; S.orientation = pc; S.review = null; S.bannerOpen = false;
  if (ENG.main) ENG.main.send('ucinewgame');
  setMode('play');
  renderCoords(); renderPieces(START_FEN, false); renderAll();
  // On a phone, Play sits below the board: bring the board back into view for the first move
  const tl = $('.table-left').getBoundingClientRect(); if (tl.top < 0) $('.table-left').scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  announce(`New game. You play ${pc === 'w' ? 'White' : 'Black'} against ${persona ? `a bot in the style of ${persona.name}` : 'Stockfish'} at about ${st.elo} Elo.`);
  if (pc === 'b') engineMove();
  save();
}
function afterMove(mv) {
  const L = S.line, g = S.game; const now = performance.now();
  mv.uci = mv.from + mv.to + (mv.promotion || '');
  L.fens.push(S.chess.fen()); L.moves.push(mv);
  const tc = tcById(g.tc);
  if (tc.base) {
    if (g.clock.running === mv.color) { g.clock[mv.color] -= (now - g.clock.last); g.clock[mv.color] += tc.inc * 1000; }
    else if (g.clock.running) { /* shouldn't happen */ }
    g.clock.running = mv.color === 'w' ? 'b' : 'w'; g.clock.last = now;
    if (L.moves.length === 1) { g.clock.running = 'b'; }
  }
  S.view = liveIndex(); refreshSelection();
  if (S.chess.in_check()) Snd.check(); else if (mv.captured) Snd.capture(); else Snd.move();
  if (tc.base) Snd.press();
  renderPieces(L.fens[S.view]); renderAll();
  announce(`${mv.color === g.playerColor ? 'You' : botName(personaById(g.opp))} played ${spokenSan(mv.san)}.`);
  const end = checkEnd(mv);
  if (end) { finishGame(end.result, end.reason); return; }
  if (S.chess.turn() !== g.playerColor) engineMove();
  else if (S.premoves.length) setTimeout(runPremove, 0);
  save();
}
function spokenSan(san) { return san.replace(/^K/, 'King ').replace(/^Q/, 'Queen ').replace(/^R/, 'Rook ').replace(/^B/, 'Bishop ').replace(/^N/, 'Knight ').replace('x', ' takes ').replace('+', ' check').replace('#', ' checkmate').replace('O-O-O', 'castles long').replace('O-O', 'castles'); }
function checkEnd(mv) {
  const c = S.chess;
  if (c.in_checkmate()) return { result: mv.color === 'w' ? '1-0' : '0-1', reason: 'checkmate' };
  if (c.in_stalemate()) return { result: '1/2-1/2', reason: 'stalemate' };
  if (c.insufficient_material()) return { result: '1/2-1/2', reason: 'insufficient material' };
  if (c.in_threefold_repetition()) return { result: '1/2-1/2', reason: 'threefold repetition' };
  if (c.in_draw()) return { result: '1/2-1/2', reason: 'the 50-move rule' };
  return null;
}
async function engineMove() {
  const token = ++S.engineToken; const g = S.game; const P = eloParams(g.elo); const persona = personaById(g.opp);
  setThinking(true);
  const t0 = performance.now(); const fen = S.chess.fen();
  let uci = null, fromBook = null;
  if (persona) {
    fromBook = await bookMove(persona, fen, S.line.moves.length, g.elo);
    if (token !== S.engineToken || S.mode !== 'play') return;
    if (fromBook) { uci = fromBook.uci; await sleep(280 + Math.random() * 420); }
  }
  if (uci) { /* book move */ }
  else if (P.blunder && Math.random() < P.blunder) {
    const ms = S.chess.moves({ verbose: true }); const m = ms[Math.floor(Math.random() * ms.length)];
    uci = m.from + m.to + (m.promotion || '');
    await sleep(350 + Math.random() * 500);
  } else {
    const eng = await ENG.ready;
    if (token !== S.engineToken || S.mode !== 'play') return;
    if (!eng) { setThinking(false); toast('Stockfish is not running, so it cannot reply. Reload the page.'); return; }
    let mt = P.movetime; const tc = tcById(g.tc);
    if (tc.base) { const rem = Math.max(0, remaining(S.chess.turn())); mt = Math.min(mt, Math.max(40, rem / 30 + tc.inc * 600)); }
    const res = await eng.search({ fen, depth: P.depth, movetime: mt, skill: 20, multipv: persona ? Math.max(4, P.multipv) : P.multipv });
    if (token !== S.engineToken || S.mode !== 'play') return;
    if (!res || !res.bestmove) { setThinking(false); return; }
    const pick = persona ? pickPersonaLine(persona, fen, res.lines || [], P, S.line.fens) : P.multipv > 1 ? pickByTemperature(res.lines || [], P.temp) : null;
    uci = pick ? pick.pv[0] : res.bestmove; g.lastEngineScore = res.info;
    const minDelay = 260 + Math.random() * 380; const el = performance.now() - t0;
    if (el < minDelay) await sleep(minDelay - el);
  }
  if (token !== S.engineToken || S.mode !== 'play') return;
  setThinking(false);
  const mv = S.chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined });
  if (persona && mv) {
    // A line under the board: where the move comes from
    if (fromBook) { g.inBook = true; g.note = `${persona.short} chose ${mv.san} here in ${fromBook.n} of ${fromBook.games} game${fromBook.games === 1 ? '' : 's'}.`; }
    else if (g.inBook) { g.inBook = false; g.note = `Out of ${persona.short}'s games now. From here the style engine decides.`; }
    else g.note = '';
  }
  if (mv) afterMove(mv);
}
function setThinking(on) { S.thinking = on; renderPlates(); boardEl().classList.toggle('can-move', canUserMove() || canPremove()); }
function finishGame(result, reason) {
  const L = S.line, g = S.game;
  L.result = result; L.reason = reason;
  if (g) { if (g.clock.running && tcById(g.tc).base) { g.clock[g.clock.running] = Math.max(0, remaining(g.clock.running)); } g.clock.running = null; }
  S.engineToken++; if (ENG.main) ENG.main.cancelAll(); S.thinking = false;
  dropPremoves(); S.sel = null; S.legal = []; closePromo();
  setMode('over'); S.bannerOpen = true;
  recordStockfishGame();
  Snd.end(); renderAll(); save();
  announce(resultSentence());
}
function resultSentence() {
  const L = S.line; if (!L) return '';
  if (L.reason === 'aborted') return 'The game was aborted before both players moved.';
  if (L.result === '*') return '';
  const g = S.game; const w = L.result === '1-0' ? 'w' : L.result === '0-1' ? 'b' : null;
  let who;
  if (!w) who = 'Drawn';
  else if (g && L.source === 'play') who = w === g.playerColor ? 'You win' : `${L.names[w]} wins`;
  else if (L.source === 'online' && g && g.you) who = w === g.you ? 'You win' : `${L.names[w]} wins`;
  else if (L.source === 'online') who = `${L.names[w]} wins`;
  else if (L.source === 'pgn' && L.you) who = w === L.you ? 'You win' : `${L.names[w]} wins`;
  else who = (w === 'w' ? 'White' : 'Black') + ' wins';
  const how = { checkmate: 'by checkmate', stalemate: 'by stalemate', 'on time': 'on time', resignation: 'by resignation', agreement: 'by agreement', 'insufficient material': 'by insufficient material', 'threefold repetition': 'by threefold repetition', 'the 50-move rule': 'by the 50-move rule', 'timeout vs insufficient material': 'by timeout against insufficient material', abandonment: 'because the opponent left' }[L.reason] || '';
  return `${who}${how ? ' ' + how : ''}.`;
}
function flagFall(color) {
  const other = color === 'w' ? 'b' : 'w';
  if (!canMate(other)) finishGame('1/2-1/2', 'timeout vs insufficient material');
  else finishGame(other === 'w' ? '1-0' : '0-1', 'on time');
}
function canMate(color) {
  const map = boardMap(S.chess.fen()); const mine = Object.values(map).filter(c => c[0] === color && c[1] !== 'K');
  if (!mine.length) return false;
  if (mine.length === 1 && (mine[0][1] === 'B' || mine[0][1] === 'N')) return false;
  return true;
}
function resign() {
  const g = S.game; if (S.mode !== 'play' || !g) return;
  finishGame(g.playerColor === 'w' ? '0-1' : '1-0', 'resignation');
}
function takeback() {
  if (S.mode !== 'play') return; const L = S.line, g = S.game;
  S.engineToken++; if (ENG.main) ENG.main.cancelAll(); setThinking(false);
  let n = S.chess.turn() === g.playerColor ? 2 : 1;
  n = Math.min(n, L.moves.length);
  if (S.chess.turn() === g.playerColor && L.moves.length === 1 && g.playerColor === 'b') n = 0;
  if (!n) { toast('There is no move of yours to take back yet.'); return; }
  S.premoves = [];
  for (let i = 0; i < n; i++) { S.chess.undo(); L.moves.pop(); L.fens.pop(); }
  g.takebacks = (g.takebacks || 0) + 1;
  if (tcById(g.tc).base) { g.clock.running = L.moves.length ? S.chess.turn() : null; g.clock.last = performance.now(); }
  S.view = liveIndex(); S.sel = null; S.legal = [];
  renderPieces(L.fens[S.view]); renderAll(); save();
  if (S.chess.turn() !== g.playerColor) engineMove();
}
function offerDraw() {
  if (S.mode !== 'play') return; const g = S.game; const L = S.line;
  const sc = g.lastEngineScore; const plies = L.moves.length;
  let engCp = null; if (sc) engCp = sc.mate != null ? (sc.mate > 0 ? 9999 : -9999) : sc.cp;
  const fewPieces = Object.keys(boardMap(S.chess.fen())).length <= 8;
  const op = personaById(g.opp); const need = op ? clamp(15 - (op.w.contempt - 24) / 2, -10, 25) : 15;
  if (engCp != null && (plies >= 40 || fewPieces) && engCp <= need) { finishGame('1/2-1/2', 'agreement'); }
  else toast(plies < 40 && !fewPieces ? 'Stockfish declines. It wants to play on for now.' : 'Stockfish declines. It likes its position.');
}
function abandonGame() {
  if (window.WP_ONLINE) window.WP_ONLINE.leave();
  trainerStop();
  S.engineToken++; if (ENG.main) ENG.main.cancelAll();
  S.game = null; S.chess = null; S.line = null; S.review = null; S.view = 0; S.bannerOpen = false; S.thinking = false; S.premoves = [];
  S.orientation = S.settings.color === 'b' ? 'b' : 'w';
  setMode('idle'); renderCoords(); renderPieces(START_FEN, true); renderAll(); save();
}
function resumeGame() {
  if (S.mode !== 'paused') return; const g = S.game; g.clock.last = performance.now();
  setMode('play'); renderAll(); Snd.ensure();
  if (S.chess.turn() !== g.playerColor) engineMove();
}
function setMode(m) {
  const prev = S.mode; S.mode = m;
  if (m !== 'review') apPause();
  if (m !== 'play' && m !== 'online') S.premoves = [];
  $('#setupCard').hidden = m !== 'idle' && m !== 'over';   // after a game it waits under "New game"
  $('#reviewCta').hidden = m !== 'idle';
  $('#playActions').hidden = m !== 'play';
  $('#pausedActions').hidden = m !== 'paused';
  $('#overActions').hidden = m !== 'over';
  $('#reviewPanel').hidden = m !== 'review';
  $('#puzzlePanel').hidden = m !== 'puzzle';
  $('#lessonPanel').hidden = m !== 'lesson';
  $('#onlinePanel').hidden = m !== 'online';
  const tab = m === 'online' || (m === 'review' && S.line && S.line.source === 'online') ? 'btnOnline' : m === 'puzzle' ? 'btnPuzzles' : m === 'lesson' ? 'btnOpenings' : m === 'review' && S.line && S.line.source === 'pgn' ? 'btnImport' : 'btnNew';
  document.querySelectorAll('.tab').forEach(t => { if (t.id === tab) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current'); });
  $('#evalBar').hidden = m !== 'review';
  $('#overActions').querySelector('#btnRematch').hidden = !(S.line && S.line.source === 'play');
  if ((prev === 'review') !== (m === 'review')) layoutBoard();
  renderSideTabs(prev !== m);
  disarm();
  if (window.WP_ONLINE) window.WP_ONLINE.qbar();   // the matchmaking bar shows everywhere but the lobby
}
/* The tabs at the top of the panel beside the board. Each page has its own set, and a tab shows one or more of
   the panel's sections. The sections keep their own hidden state from setMode; a tab only hides the ones that
   belong to another tab (data-tab-off). With a single tab there is no tab row: the section's heading is the title.
   A new page starts on its first tab; within a page, the tab you picked stays. */
const SIDE = { tab: null, ids: '' };
const SIDE_SECTIONS = ['setupCard', 'reviewCta', 'puzzlePanel', 'lessonPanel', 'reviewPanel', 'sheet', 'onlinePanel'];
function sideTabs() {
  const m = S.mode; const moves = { id: 'moves', label: 'Moves', els: ['sheet'] };
  if (m === 'idle') return [{ id: 'new', label: 'Play Stockfish', els: ['setupCard'] }, { id: 'rv', label: 'Review a game', els: ['reviewCta'] }];
  if (m === 'over') return [moves, { id: 'new', label: 'New game', els: ['setupCard'] }];
  if (m === 'review') return [{ id: 'review', label: 'Review', els: ['reviewPanel'] }, moves];
  if (m === 'puzzle') return [{ id: 'puzzle', label: 'Puzzle', els: ['puzzlePanel'] }, moves];
  if (m === 'lesson') return [{ id: 'lesson', label: 'Lesson', els: ['lessonPanel'] }, moves];
  // an online game keeps its moves, offers and messages together, like chess.com, so an offer can't hide behind a tab
  if (m === 'online') return window.WP_ONLINE && window.WP_ONLINE.inGame() ? [{ id: 'game', label: 'Game', els: ['sheet', 'onlinePanel'] }] : [{ id: 'lobby', label: 'Play online', els: ['onlinePanel'] }];
  return [moves];                                  // a game against Stockfish, playing or paused
}
function renderSideTabs(reset) {
  const tabs = sideTabs(); const ids = tabs.map(t => t.id).join(' ');
  if (reset || !tabs.some(t => t.id === SIDE.tab)) SIDE.tab = tabs[0].id;
  const cur = tabs.find(t => t.id === SIDE.tab);
  for (const id of SIDE_SECTIONS) { const el = $('#' + id); if (el) el.toggleAttribute('data-tab-off', !cur.els.includes(id)); }
  const bar = $('#sideTabs'), many = tabs.length > 1;
  bar.hidden = !many; $('#side').classList.toggle('has-tabs', many);
  if (ids !== SIDE.ids) {
    SIDE.ids = ids;
    bar.innerHTML = many ? tabs.map(t => `<button class="side-tab" data-side-tab="${t.id}" aria-controls="${t.els.join(' ')}">${esc(t.label)}</button>`).join('') : '';
  }
  bar.querySelectorAll('.side-tab').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.sideTab === SIDE.tab)));
}
function pickSideTab(id) {
  if (id === SIDE.tab) return;
  SIDE.tab = id; renderSideTabs(false); $('#sideBody').scrollTop = 0;
  if (id === 'moves') renderSheet();               // now that the list is visible, bring the current move into view
}

/* =====================================================================
   Rendering: plates, score sheet, banner, nav
   ===================================================================== */
function materialCaps(fen) {
  const map = boardMap(fen); const count = { w: {}, b: {} };
  Object.values(map).forEach(c => { count[c[0]][c[1]] = (count[c[0]][c[1]] || 0) + 1; });
  const full = { P: 8, N: 2, B: 2, R: 2, Q: 1 }; const val = { P: 1, N: 3, B: 3, R: 5, Q: 9 };
  const caps = { w: [], b: [] }; let mat = { w: 0, b: 0 };
  for (const col of ['w', 'b']) {
    const opp = col === 'w' ? 'b' : 'w';
    for (const t of ['Q', 'R', 'B', 'N', 'P']) { const missing = Math.max(0, full[t] - (count[opp][t] || 0)); for (let i = 0; i < missing; i++) caps[col].push(opp + t); }
    for (const t of Object.keys(val)) mat[col] += (count[col][t] || 0) * val[t];
  }
  return { caps, diff: mat.w - mat.b };
}
function renderPlates() {
  const L = S.line; const fen = L ? L.fens[S.view] : START_FEN;
  const { caps, diff } = materialCaps(fen);
  const top = S.orientation === 'w' ? 'b' : 'w', bot = S.orientation;
  const nameOf = (c) => {
    if (L) return { n: L.names[c], s: L.subs[c] };
    if (S.mode === 'online' && window.WP_ONLINE) return window.WP_ONLINE.plate(c);
    const pc = S.settings.color === 'b' ? 'b' : 'w';
    const op = curPersona();
    return c === pc ? { n: 'You', s: c === 'w' ? 'White' : 'Black' } : { n: botName(op), s: op ? `Bot · ≈${S.settings.elo}` : eloLabel(S.settings.elo) };
  };
  const plate = (c) => {
    const { n, s } = nameOf(c);
    const engineSide = S.game && S.mode === 'play' && c !== S.game.playerColor && L && L.source === 'play';
    const sub = engineSide && S.thinking ? `<span class="thinking">thinking</span>` : esc(s || '');
    const adv = c === 'w' ? diff : -diff;
    return `<div class="who"><span class="pc-ic">${pieceSVG(c + 'K')}</span><span class="who-text"><span class="who-line"><span class="who-name">${esc(n)}</span><span class="who-sub">${sub}</span></span><span class="caps" aria-label="Captured pieces">${caps[c].map(p => pieceSVG(p)).join('')}${adv > 0 ? `<span class="adv">+${adv}</span>` : ''}</span></span></div>
      <div class="plate-right">${['idle', 'play', 'paused', 'over', 'online'].includes(S.mode) ? `<span class="tchip" data-color="${c}" role="timer" aria-label="${c === 'w' ? 'White' : 'Black'}'s clock"></span>` : ''}</div>`;
  };
  $('#plateTop').innerHTML = plate(top); $('#plateBottom').innerHTML = plate(bot);
  updateClock();
}
function renderSheet() {
  const L = S.line; const list = $('#mlist');
  const tc = S.game ? tcById(S.game.tc) : (L ? null : tcById(S.settings.tc));
  $('#sheetTc').textContent = L && L.source === 'pgn' ? (L.headers.Date || '') : tc ? (tc.base ? `${tc.id} · ${tc.kind}` : 'Untimed') : '';
  const names = L ? L.names : (() => { const pc = S.settings.color === 'b' ? 'b' : 'w'; const bn = botName(curPersona()); return pc === 'w' ? { w: 'You', b: bn } : { w: bn, b: 'You' }; })();
  $('#sheetPlayers').innerHTML = `<dt>White</dt><dd>${esc(names.w)}</dd><dt>Black</dt><dd>${esc(names.b)}</dd>`;
  let html = '';
  const moves = L ? L.moves : [];
  const startFen = L ? L.startFen : START_FEN; const parts = startFen.split(' ');
  const startNo = +parts[5] || 1; const off = parts[1] === 'b' ? 1 : 0;
  const rows = Math.max(Math.ceil((moves.length + off) / 2), 8);
  const rv = S.mode === 'review' ? S.review : null;
  for (let r = 0; r < rows; r++) {
    let cells = '';
    for (let col = 0; col < 2; col++) {
      const i = r * 2 + col - off; const mv = i >= 0 ? moves[i] : null;
      if (mv) {
        const cls = rv ? rv.cls[i] : null;
        cells += `<button class="mv${S.view === i + 1 ? ' cur' : ''}" data-ply="${i + 1}"><span class="san">${sanHTML(mv.san)}</span>${cls ? `<span class="cls-dot" style="--cc:var(--c-${cls})" title="${CLS[cls].label}">${CLS[cls].sym}</span>` : ''}</button>`;
      } else cells += `<span class="mv"></span>`;
    }
    html += `<div class="mrow"><span class="mno">${startNo + r}</span>${cells}</div>`;
  }
  list.innerHTML = html;
  const cur = list.querySelector('.mv.cur');
  if (cur) { const lt = list.getBoundingClientRect(), ct = cur.getBoundingClientRect(); if (ct.bottom > lt.bottom - 4 || ct.top < lt.top + 4) list.scrollTop += (ct.top - lt.top) - lt.height / 2 + ct.height / 2; }
  else if (!moves.length) list.scrollTop = 0;
  if (L && L.source === 'puzzle') $('#sheetTc').textContent = 'Puzzle'; else if (L && L.source === 'lesson') $('#sheetTc').textContent = L.headers.Event || 'Opening';
  if (L && (L.source === 'puzzle' || L.source === 'lesson')) { $('#sheetResult').textContent = L.source === 'puzzle' ? 'Puzzle line' : 'Opening line'; return; }
  $('#sheetResult').innerHTML = L && L.result !== '*' ? `<b>${L.result.replace('1/2-1/2', '½–½').replace('-', '–')}</b>&nbsp; ${esc(resultSentence())}` : L && moves.length ? 'Game in progress' : 'Game not started';
}
function renderBanner() {
  if (S.mode === 'online' && window.WP_ONLINE) { window.WP_ONLINE.banner(); return; }
  const el = $('#banner'); const L = S.line;
  if (!(S.mode === 'over' && S.bannerOpen && L)) { el.hidden = true; return; }
  const g = S.game; const w = L.result === '1-0' ? 'w' : L.result === '0-1' ? 'b' : null;
  const title = !w ? 'Drawn' : (g && w === g.playerColor ? 'You win' : `${L.names[w]} wins`);
  const kicker = { checkmate: 'Checkmate', stalemate: 'Stalemate', 'on time': 'Flag fall', resignation: 'Resigned', agreement: 'Draw agreed' }[L.reason] || 'Game over';
  el.innerHTML = `<div class="banner-card" role="dialog" aria-label="Game result"><button class="banner-close" id="bannerClose" aria-label="Close">×</button>
    <div class="banner-kicker">${kicker}</div><div class="banner-title">${title}</div><p class="banner-sub">${esc(resultSentence())}</p>
    <div class="banner-actions"><button class="btn btn-brass" id="bnReview">Review game</button><button class="btn" id="bnRematch">Rematch</button></div></div>`;
  el.hidden = false;
  $('#bannerClose').onclick = () => { S.bannerOpen = false; renderBanner(); };
  $('#bnReview').onclick = () => startReview();
  $('#bnRematch').onclick = () => startGame();
}
function renderNav() {
  const n = liveIndex();
  $('#navFirst').disabled = $('#navPrev').disabled = S.view <= 0;
  $('#navNext').disabled = $('#navLast').disabled = S.view >= n;
  const note = $('#viewNote');
  if (S.premoves.length && S.view === n && (S.mode === 'play' || S.mode === 'online')) note.textContent = premoveNote();
  else if (S.mode === 'play' && S.view < n) note.textContent = 'Looking back. Press → or End to return to the game.';
  else if (S.mode === 'paused') note.textContent = 'Game paused. Your clocks are stopped.';
  else if (S.mode === 'puzzle' && T.kind === 'puzzle' && PZ.p) note.textContent = ({ intro: 'Watch the opponent\u2019s move…', solving: `Your turn: find the best move for ${colorName(PZ.color)}.`, reply: 'Correct! Keep going…', wrong: 'Not this one. Try again.', solved: 'Solved!', solvedHelp: 'Solved with help.', showing: 'Showing the solution…', shown: 'Solution shown.' })[PZ.state] || '';
  else if (S.mode === 'lesson' && T.kind === 'lesson' && LS.line && LS.phase === 'practice') note.textContent = ({ await: `Your move as ${colorName(LS.color)}.`, reply: 'Opponent to move…', wrong: 'Not the book move. Try again.', done: 'Line complete.' })[LS.state] || '';
  else if (S.mode === 'online' && window.WP_ONLINE) note.textContent = window.WP_ONLINE.note();
  else if (S.mode === 'play' && S.game && S.game.note && S.view === n) note.textContent = S.game.note;
  else if (S.mode === 'idle') note.textContent = '';
  else note.textContent = '';
}
function renderAll() {
  renderPlates(); renderSheet(); renderHighlights(); renderBanner(); renderNav(); updateClock();
  if (S.mode === 'review') renderReview();
  if (S.mode === 'puzzle' || S.mode === 'lesson') renderTrainer();
  if (S.mode === 'online' && window.WP_ONLINE) window.WP_ONLINE.render();
  boardEl().classList.toggle('can-move', canUserMove() || canPremove());
}
function goTo(ply, animate = true) {
  if (!S.line) return; ply = clamp(ply, 0, liveIndex()); if (ply === S.view) return;
  if (!AP.own && (AP.on || AP.stop)) apPause();   // stepping by hand takes over from Play through
  S.view = ply; S.sel = null; S.legal = []; closePromo(); if (ply !== liveIndex()) S.premoves = [];
  renderPieces(S.line.fens[ply], animate); renderAll();
  if ((S.mode === 'review' || S.mode === 'lesson') && ply > 0) { const mv = S.line.moves[ply - 1]; if (mv.captured) Snd.clack(.5, 1300); else Snd.clack(.4, 1600); }
}
function flip() { S.orientation = S.orientation === 'w' ? 'b' : 'w'; renderCoords(); repositionAll(); drawBoardCanvas(); renderAll(); }
function announce(t) { const l = $('#live'); l.textContent = ''; setTimeout(() => { l.textContent = t; }, 30); }
let toastTimer = null;
function toast(msg) { const host = $('#toastHost'); host.innerHTML = `<div class="toast" role="status">${esc(msg)}</div>`; clearTimeout(toastTimer); toastTimer = setTimeout(() => { host.innerHTML = ''; }, 3200); }
let armed = null;
// A menu button keeps its icon: only its name (.lbl) changes to the question
const armText = (btn) => btn.querySelector('.lbl') || btn;
function armOrRun(btn, label, fn) {
  if (armed === btn) { disarm(); fn(); return; }
  disarm(); armed = btn; const t = armText(btn); btn.dataset.label = t.textContent; t.textContent = label; btn.classList.add('armed');
  armed.timer = setTimeout(disarm, 3500);
}
function disarm() { if (!armed) return; clearTimeout(armed.timer); armText(armed).textContent = armed.dataset.label; armed.classList.remove('armed'); armed = null; }

/* =====================================================================
   Review: grade every move with Stockfish
   ===================================================================== */
const winPct = (cp) => 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * clamp(cp, -1000, 1000))) - 1);
function scoreOf(ev) { if (!ev) return 0; if (ev.mated) return ev.mated === 'b' ? 10000 : -10000; if (ev.mate != null) return Math.sign(ev.mate) * (10000 - Math.abs(ev.mate) * 10); return ev.cp || 0; }
const whiteWin = (ev) => winPct(scoreOf(ev));
function fmtEval(ev) {
  if (!ev) return '…'; if (ev.mated) return ev.mated === 'b' ? '1–0' : '0–1'; if (ev.draw) return '½–½';
  if (ev.mate != null) return (ev.mate > 0 ? 'M' : MINUS + 'M') + Math.abs(ev.mate);
  const v = ev.cp / 100; return (v > 0 ? '+' : v < 0 ? MINUS : '') + Math.abs(v).toFixed(1);
}
function terminalEval(fen, isLast, line) {
  const c = chessAt(fen);
  if (c.in_checkmate()) return { mated: c.turn() };
  if (c.in_stalemate() || c.insufficient_material()) return { cp: 0, draw: true };
  if (isLast && line.result === '1/2-1/2' && /repetition|50-move/.test(line.reason)) return { cp: 0, draw: true };
  return null;
}
function lineKey(L) { return L.startFen + '|' + L.moves.map(m => m.uci).join(' '); }
async function startReview() {
  const L = S.line; if (!L || !L.moves.length) { toast('There are no moves to review yet.'); return; }
  S.engineToken++; if (ENG.main) ENG.main.cancelAll();
  const key = lineKey(L);
  if (!S.review || S.review.key !== key) {
    S.review = { key, evals: [], best: [], pv: [], alt: [], depth: [], cls: [], acc: [], token: 0, done: false };
  }
  apPause();
  S.bannerOpen = false; setMode('review'); S.orientation = S.orientation || 'w';
  const firstView = 0; S.view = firstView; S.sel = null; S.legal = [];
  renderPieces(L.fens[S.view], false); renderAll();
  analyse();
}
async function analyse() {
  const R = S.review, L = S.line; const token = ++R.token; const n = L.fens.length;
  classifyAll(); renderReview();
  if (R.evals.filter(Boolean).length === n) { R.done = true; renderReview(); recordReviewAccuracy(); return; }
  const engines = await getPool();
  if (token !== R.token) return;
  if (!engines.length) { $('#rvText').textContent = 'Stockfish is not running, so the game cannot be analysed.'; return; }
  // Two lines per position: the second-best move is what tells an only move (a great move) apart.
  // Each position stops at REVIEW_DEPTH or after the time limit, whichever comes first; a slow device
  // may stop short of the depth, and the progress line says how deep it actually got.
  const fast = ENG.source && ENG.source.label === 'WebAssembly';
  const depth = REVIEW_DEPTH, movetime = fast ? REVIEW_MS : REVIEW_MS_ASM;
  let next = 0;
  const work = async (eng) => {
    while (true) {
      if (token !== R.token || S.mode !== 'review') return;
      const i = next++; if (i >= n) return;
      if (R.evals[i]) continue;
      const term = terminalEval(L.fens[i], i === n - 1, L);
      if (term) { R.evals[i] = term; R.best[i] = null; R.pv[i] = []; R.alt[i] = null; onEval(); continue; }
      const res = await eng.search({ fen: L.fens[i], depth, movetime, skill: 20, multipv: 2 });
      if (token !== R.token) return;
      if (!res) { next = Math.min(next, i); return; }
      const stm = L.fens[i].split(' ')[1] === 'w' ? 1 : -1; const info = res.info || { cp: 0, pv: [] };
      const evOf = (x) => (x.mate != null ? { mate: x.mate * stm } : { cp: Math.round((x.cp || 0) * EVAL_SCALE) * stm });
      R.evals[i] = evOf(info);
      R.best[i] = res.bestmove; R.pv[i] = info.pv || []; (R.depth = R.depth || [])[i] = info.depth || 0;
      const two = res.lines && res.lines[1];
      R.alt[i] = two && two.pv && two.pv.length && two.pv[0] !== res.bestmove ? { ev: evOf(two), move: two.pv[0] } : null;
      onEval();
    }
  };
  await Promise.all(engines.map(work));
  if (token !== R.token) return;
  R.done = R.evals.filter(Boolean).length === n; classifyAll(); renderAll(); save();
  if (R.done) recordReviewAccuracy();
}
let evalRenderPending = false;
function onEval() {
  if (evalRenderPending) return; evalRenderPending = true;
  requestAnimationFrame(() => { evalRenderPending = false; classifyAll(); renderReview(); renderSheet(); renderHighlights(); });
}
function classifyAll() {
  const R = S.review, L = S.line; if (!R) return;
  for (let i = 0; i < L.moves.length; i++) {
    const a = R.evals[i], b = R.evals[i + 1];
    if (!a || !b) { R.cls[i] = null; R.acc[i] = null; continue; }
    const mover = L.moves[i].color; const sgn = mover === 'w' ? 1 : -1;
    const before = winPct(scoreOf(a) * sgn), after = winPct(scoreOf(b) * sgn);
    const loss = Math.max(0, before - after);
    const legalCount = chessAt(L.fens[i]).moves().length;
    let cls;
    if (legalCount === 1) cls = 'forced';
    else if (R.best[i] && R.best[i] === L.moves[i].uci) cls = 'best';
    else if (loss < 2) cls = 'excellent';
    else if (loss < 5) cls = 'good';
    else if (loss < 10) cls = 'inaccuracy';
    else if (loss < 20) cls = 'mistake';
    else cls = 'blunder';
    // Early opening: shallow engine noise shouldn't brand normal theory as inaccurate, nor call a move
    // a mistake when the game is still within a pawn of level afterwards (Play through stops at mistakes)
    if (i < 10 && cls === 'mistake' && Math.abs(scoreOf(b)) <= 100) cls = 'inaccuracy';
    if (i < 10 && cls === 'inaccuracy') cls = 'good';
    if (L.moves[i].san.includes('#')) cls = 'best';
    // Brilliant (a sound sacrifice) and great (the only good move): only for moves Stockfish rates
    // best, or as good as its best. The tests themselves live in commentary.js.
    else if (cls === 'best' || cls === 'excellent') {
      const alt = R.alt ? R.alt[i] : null; const isBest = cls === 'best';
      const preMate = a.mate != null && Math.sign(a.mate) === sgn;
      const asGood = isBest || (!preMate && alt && alt.move === L.moves[i].uci && Math.abs(scoreOf(alt.ev) - scoreOf(a)) <= 25);
      if (asGood) {
        try {
          const postMate = b.mate != null && Math.sign(b.mate) === sgn;
          const sp = specialMove(i, { isBest, alt, sgn, before, after, postMate, legal: legalCount, altKey: alt ? alt.move : '-' });
          if (sp) cls = sp;
        } catch (e) { /* a note is never worth breaking the review for */ }
      }
    }
    R.cls[i] = cls;
    R.acc[i] = clamp(103.1668 * Math.exp(-0.04354 * loss) - 3.1669, 0, 100);
  }
}
function accuracyOf(color) {
  const R = S.review, L = S.line; const xs = [];
  L.moves.forEach((m, i) => { if (m.color === color && R.acc[i] != null && R.cls[i] !== 'forced') xs.push(R.acc[i]); });
  if (!xs.length) return null;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const hmean = xs.length / xs.reduce((a, b) => a + 1 / Math.max(b, 1), 0);
  return (mean + hmean) / 2;
}
function uciToSan(fen, uci) { if (!uci) return null; const c = chessAt(fen); const m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined }); return m ? m.san : null; }
function pvToSan(fen, pv, max = 6) {
  const c = chessAt(fen); const out = []; let no = +fen.split(' ')[5] || 1; let first = true;
  for (const u of pv.slice(0, max)) {
    const turn = c.turn(); const m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || undefined }); if (!m) break;
    if (turn === 'w') out.push(`${no}. ${sanHTML(m.san)}`); else out.push(first ? `${no}… ${sanHTML(m.san)}` : sanHTML(m.san));
    if (turn === 'b') no++; first = false;
  }
  return out.join(' ');
}
function renderReview() {
  const R = S.review, L = S.line; if (!R || !L) return;
  const n = L.fens.length; const got = R.evals.filter(Boolean).length;
  $('#rvBar').style.width = (got / n * 100).toFixed(1) + '%';
  $('#rvText').textContent = (got < n ? `Analysing ${got} of ${n} positions` : `Analysed ${n} positions`) + depthText(R);
  $('#rvProgress').style.opacity = got < n ? 1 : .7;
  // accuracy
  $('#accRow').innerHTML = ['w', 'b'].map(c => {
    const a = accuracyOf(c);
    return `<div class="acc-side"><span class="acc-name">${pieceSVG(c + 'K')}<span>${esc(L.names[c])}</span></span><span class="acc-num">${a == null ? '–' : a.toFixed(1)}</span><span class="acc-lbl">accuracy</span></div>`;
  }).join('');
  // counts
  const cnt = { w: {}, b: {} }; L.moves.forEach((m, i) => { const c = R.cls[i]; if (c) cnt[m.color][c] = (cnt[m.color][c] || 0) + 1; });
  $('#clsTable').innerHTML = `<thead><tr><th>Move quality</th><th>${esc(shortName(L.names.w))}</th><th>${esc(shortName(L.names.b))}</th></tr></thead><tbody>` +
    CLS_ORDER.map(k => { const a = cnt.w[k] || 0, b = cnt.b[k] || 0; return `<tr><td><span class="cls-dot" style="--cc:var(--c-${k})">${CLS[k].sym}</span>${CLS[k].label}</td><td class="${a ? '' : 'zero'}">${a}</td><td class="${b ? '' : 'zero'}">${b}</td></tr>`; }).join('') + '</tbody>';
  renderGraph(); renderAnnot(); renderEvalBar();
  const keys = keyMoments();
  $('#btnPrevKey').disabled = !keys.some(p => p < S.view); $('#btnNextKey').disabled = !keys.some(p => p > S.view);
  renderAutoPlay();
  if (typeof renderMistakeCta === 'function') renderMistakeCta();
}
const shortName = (s) => s.length > 14 ? s.slice(0, 13) + '…' : s;
// The search depth the review actually reached: "depth 18", or a range when some positions stopped earlier.
function depthText(R) {
  const ds = (R.depth || []).filter(d => d > 0); if (!ds.length) return '';
  const lo = Math.min(...ds), hi = Math.max(...ds);
  return lo === hi ? ` · depth ${hi}` : ` · depth ${lo}–${hi}`;
}
function keyMoments() { const R = S.review; if (!R) return []; const out = []; R.cls.forEach((c, i) => { if (c === 'mistake' || c === 'blunder' || c === 'inaccuracy') out.push(i + 1); }); return out; }
function renderEvalBar() {
  const R = S.review; const ev = R.evals[S.view]; const bar = $('#evalBar');
  const pct = ev ? whiteWin(ev) : 50;
  bar.classList.toggle('flip', S.orientation === 'b');
  $('#ebFill').style.height = pct.toFixed(1) + '%';
  const lab = $('#ebLabel'); const txt = ev ? fmtEval(ev).replace('+', '') : '';
  lab.textContent = txt; const whiteAhead = pct >= 50;
  const atBottom = (whiteAhead && S.orientation === 'w') || (!whiteAhead && S.orientation === 'b');
  lab.className = 'eb-label ' + (atBottom ? 'bottom' : 'top');
  lab.style.color = whiteAhead ? '#2a1d10' : '#efe5cc';
}
function renderGraph() {
  const R = S.review, L = S.line; const g = $('#graph'); const n = L.fens.length; const W = 1000, H = 100;
  const pts = []; for (let i = 0; i < n; i++) if (R.evals[i]) pts.push([i / Math.max(1, n - 1) * W, (100 - whiteWin(R.evals[i])) / 100 * H]);
  let area = '', lineP = '';
  if (pts.length) {
    lineP = 'M' + pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(2)).join(' L');
    area = `M${pts[0][0].toFixed(1)},${H} L` + pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(2)).join(' L') + ` L${pts[pts.length - 1][0].toFixed(1)},${H} Z`;
  }
  const cx = S.view / Math.max(1, n - 1) * W;
  let dots = '';
  R.cls.forEach((c, i) => { if (AP_STOPS.includes(c) && R.evals[i + 1]) { const x = (i + 1) / Math.max(1, n - 1) * 100; const y = (100 - whiteWin(R.evals[i + 1])); dots += `<span class="gdot" style="left:${x}%;top:${clamp(y, 4, 96)}%;--cc:var(--c-${c})"></span>`; } });
  g.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    <rect width="${W}" height="${H}" fill="#1d140e"/>
    ${area ? `<path d="${area}" fill="#efe6cf"/>` : ''}
    <line x1="0" y1="50" x2="${W}" y2="50" stroke="#c98b52" stroke-opacity=".55" stroke-dasharray="6 6" vector-effect="non-scaling-stroke"/>
    ${lineP ? `<path d="${lineP}" fill="none" stroke="#b07a47" stroke-width="1.5" vector-effect="non-scaling-stroke"/>` : ''}
    <line x1="${cx}" y1="0" x2="${cx}" y2="${H}" stroke="#d9a531" stroke-width="2" vector-effect="non-scaling-stroke"/>
  </svg>${dots}`;
}
function renderAnnot() {
  const R = S.review, L = S.line; const el = $('#annot'); const v = S.view;
  el.classList.remove('ap-stop');
  const ev = R.evals[v]; const evTxt = fmtEval(ev); const whiteish = ev && whiteWin(ev) >= 50;
  const evChip = `<span class="annot-eval${whiteish ? ' wht' : ''}">${evTxt}</span>`;
  if (v === 0) {
    const keys = keyMoments().length;
    el.style.removeProperty('--cc');
    el.innerHTML = `<div class="annot-top"><span class="annot-badge" style="--cc:var(--ink-soft)">♙</span><span class="annot-title">Starting position</span>${evChip}</div>
      <p class="annot-body">${R.done ? `Step through with →, click the graph or pick a move under Moves, or press <b>Play through</b> to watch the game and stop at the moments that matter. ${keys ? `There ${keys === 1 ? 'is 1 moment' : `are ${keys} moments`} worth a closer look.` : 'A clean game: no inaccuracies at all.'}` : 'Stockfish is working through the game. You can step through the moves, or press Play through, while it runs.'}</p>`;
    return;
  }
  const i = v - 1; const mv = L.moves[i]; const cls = R.cls[i];
  const mover = mv.color === 'w' ? L.names.w : L.names.b;
  if (!cls) {
    el.style.removeProperty('--cc');
    el.innerHTML = `<div class="annot-top"><span class="annot-badge">…</span><span class="annot-title">${moveLabel(i)} ${sanHTML(mv.san)}</span>${evChip}</div><p class="annot-body">Stockfish hasn't reached this move yet.</p>`;
    return;
  }
  el.style.setProperty('--cc', `var(--c-${cls})`);
  const bestSan = uciToSan(L.fens[i], R.best[i]);
  const sanH = `<b>${sanHTML(mv.san)}</b>`, bestH = bestSan ? `<b>${sanHTML(bestSan)}</b>` : '';
  const pre = R.evals[i], post = R.evals[i + 1]; const sgn = mv.color === 'w' ? 1 : -1;
  let text = {
    brilliant: `${sanH} is a brilliant move.`,
    great: `${sanH} is a great move.`,
    best: `${sanH} is the best move.`,
    excellent: `${sanH} is excellent.${bestH ? ` Stockfish slightly preferred ${bestH}.` : ''}`,
    good: `${sanH} is a good move.${bestH ? ` ${bestH} was a little stronger.` : ''}`,
    inaccuracy: `${sanH} is an inaccuracy.${bestH ? ` ${bestH} was better.` : ''}`,
    mistake: `${sanH} is a mistake.${bestH ? ` ${bestH} was the move.` : ''}`,
    blunder: `${sanH} is a blunder.${bestH ? ` ${bestH} was the move.` : ''}`,
    forced: `${sanH} was the only legal move.`,
  }[cls];
  let note = '';
  if (mv.san.includes('#')) { text = `${sanH} is checkmate.`; }
  else if (post && post.mate != null && Math.sign(post.mate) === -sgn) note = `This allows mate in ${Math.abs(post.mate)}.`;
  else if (pre && pre.mate != null && Math.sign(pre.mate) === sgn && !(post && post.mate != null && Math.sign(post.mate) === sgn)) note = `There was a forced mate in ${Math.abs(pre.mate)}.`;
  // Brilliant and great moves, mistakes and blunders get a note in plain words on what actually happens.
  const explain = { brilliant: explainBrilliant, great: explainGreat, mistake: explainBad, blunder: explainBad }[cls];
  if (explain && !mv.san.includes('#')) { try { const t = explain(i); if (t) { text = t; note = ''; } } catch (e) { /* keep the short note */ } }
  const evLine = pre && post && !mv.san.includes('#') ? `Evaluation ${fmtEval(pre)} → ${fmtEval(post)}` : '';
  const showsIdea = cls === 'brilliant' || cls === 'great';
  const pvLine = cls !== 'best' && cls !== 'forced' && R.pv[i] && R.pv[i].length ? `<p class="annot-line">${showsIdea ? 'The idea' : 'Best line'}: ${pvToSan(L.fens[i], R.pv[i])}</p>` : '';
  const stopped = AP.stop === v && AP_STOPS.includes(cls);
  el.classList.toggle('ap-stop', stopped);
  el.innerHTML = `${stopped ? `<p class="annot-kicker">Paused here · ${esc(CLS[cls].label.toLowerCase())}</p>` : ''}<div class="annot-top"><span class="annot-badge" style="--cc:var(--c-${cls})">${CLS[cls].sym}</span><span class="annot-title">${moveLabel(i)} ${sanHTML(mv.san)} · ${esc(CLS[cls].label)}</span>${evChip}</div>
    <p class="annot-body">${text} ${note}</p>${evLine ? `<p class="annot-line">${esc(mover)} · ${evLine}</p>` : ''}${pvLine}`;
}
function moveLabel(i) { const L = S.line; const p = L.startFen.split(' '); const off = p[1] === 'b' ? 1 : 0; const no = (+p[5] || 1) + Math.floor((i + off) / 2); return (i + off) % 2 === 0 ? `${no}.` : `${no}…`; }
/* =====================================================================
   Review: play the game through, stopping at brilliant and great moves,
   mistakes and blunders. Any other way of moving through the game
   (arrows, the score sheet, the graph) takes over from it.
   ===================================================================== */
const AP_SPEEDS = { slow: 1800, normal: 1050, fast: 500 };
const AP = { on: false, timer: null, waiting: false, stop: 0, own: false };
const AP_ICONS = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12-7.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h4.2v14H6zm7.8 0H18v14h-4.2z"/></svg>',
  again: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5V1.5L6.5 6 12 10.5V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z"/></svg>',
};
const apSpeed = () => (AP_SPEEDS[S.settings.apSpeed] ? S.settings.apSpeed : 'normal');
function apStopCount() { const R = S.review; return R ? R.cls.filter(c => AP_STOPS.includes(c)).length : 0; }
function apMove(ply) { AP.own = true; try { goTo(ply); } finally { AP.own = false; } }
function apStart() {
  if (S.mode !== 'review' || !S.line || !S.review) return;
  if (S.view >= liveIndex()) apMove(0);
  AP.on = true; AP.stop = 0; AP.waiting = false;
  clearTimeout(AP.timer); AP.timer = setTimeout(apStep, 350);
  renderAnnot(); renderAutoPlay();
}
function apPause(stopAt = 0) {
  const was = AP.on || AP.stop;
  AP.on = false; AP.waiting = false; AP.stop = stopAt; clearTimeout(AP.timer); AP.timer = null;
  if (was && S.mode === 'review' && S.review) { renderAnnot(); renderAutoPlay(); }
}
function apToggle() { if (AP.on) apPause(); else apStart(); }
function apStep() {
  AP.timer = null; if (!AP.on) return;
  if (S.mode !== 'review' || !S.review) { apPause(); return; }
  if (S.view >= liveIndex()) { apPause(); announce('That was the last move.'); return; }
  apMove(S.view + 1);
  apCheck();
}
// After each move: stop if it is one of the moments, wait if Stockfish hasn't graded it yet, else carry on.
function apCheck() {
  AP.timer = null; if (!AP.on || S.mode !== 'review' || !S.review) return;
  const i = S.view - 1; const cls = S.review.cls[i];
  if (!cls) { if (!AP.waiting) { AP.waiting = true; renderAutoPlay(); } AP.timer = setTimeout(apCheck, 250); return; }
  if (AP.waiting) AP.waiting = false;
  if (AP_STOPS.includes(cls)) {
    apPause(S.view);
    const mv = S.line.moves[i];
    announce(`${moveLabel(i)} ${mv.san}: ${CLS[cls].label.toLowerCase()}. Paused. Press Continue to go on.`);
    return;
  }
  if (S.view >= liveIndex()) { apPause(); announce('That was the last move.'); return; }
  renderAutoPlay();
  AP.timer = setTimeout(apStep, AP_SPEEDS[apSpeed()]);
}
function renderAutoPlay() {
  const R = S.review; const btn = $('#btnAutoPlay'), tool = $('#navPlay'); if (!btn) return;
  const inReview = S.mode === 'review' && !!R && !!S.line;
  tool.hidden = !inReview; if (!inReview) return;
  const atEnd = S.view >= liveIndex();
  const state = AP.on ? 'pause' : AP.stop ? 'continue' : atEnd ? 'again' : S.view > 0 ? 'here' : 'play';
  const label = { pause: 'Pause', continue: 'Continue', again: 'Play again', here: 'Play from here', play: 'Play through' }[state];
  const icon = AP_ICONS[state === 'pause' ? 'pause' : state === 'again' ? 'again' : 'play'];
  btn.innerHTML = `${icon}<span>${label}</span>`;
  tool.innerHTML = `${icon}<span>${state === 'pause' ? 'Pause' : state === 'continue' ? 'Continue' : 'Play'}</span>`;
  tool.setAttribute('aria-label', label); btn.setAttribute('aria-pressed', String(AP.on)); tool.setAttribute('aria-pressed', String(AP.on));
  document.querySelectorAll('#apSpeed .ap-sp').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.sp === apSpeed())));
  const n = apStopCount(); const graded = R.cls.filter(Boolean).length; const total = S.line.moves.length;
  let note;
  if (AP.on && AP.waiting) note = 'Waiting for Stockfish to grade this move…';
  else if (AP.on) note = 'Playing. It stops at brilliant and great moves, mistakes and blunders.';
  else if (AP.stop) { const c = R.cls[AP.stop - 1]; note = `Paused at ${c === 'great' ? 'a great move' : c === 'brilliant' ? 'a brilliant move' : `a ${CLS[c].label.toLowerCase()}`}. Read the note above, then press <b>Continue</b>.`; }
  else if (graded < total) note = 'Replays the game and stops at brilliant and great moves, mistakes and blunders. Moves Stockfish hasn’t graded yet are waited for.';
  else note = n ? `Replays the game and stops at the ${n === 1 ? 'one moment' : `${n} moments`} that matter: brilliant and great moves, mistakes and blunders.` : 'Replays the game. Nothing in it is brilliant, great, a mistake or a blunder, so it plays straight through.';
  $('#apNote').innerHTML = note;
  // under the board too, for phones, where the review panel sits below the board
  $('#viewNote').textContent = AP.on ? (AP.waiting ? 'Waiting for Stockfish to grade this move…' : 'Playing through the game…') : AP.stop ? 'Paused at a key moment. Press Continue to go on.' : '';
}
function exitReview() {
  apPause();
  if (S.review) S.review.token++;
  for (const e of ENG.pool) e.cancelAll();
  if (S.line && S.line.source === 'online' && window.WP_ONLINE) { window.WP_ONLINE.open(); return; }
  if (S.line && S.line.source === 'play' && S.game) { setMode('over'); S.orientation = S.game.playerColor; }
  else { S.line = null; S.game = null; S.chess = null; S.review = null; setMode('idle'); S.orientation = S.settings.color === 'b' ? 'b' : 'w'; }
  S.view = liveIndex(); renderCoords(); renderPieces(S.line ? S.line.fens[S.view] : START_FEN, false); drawBoardCanvas(); renderAll(); save();
}

/* =====================================================================
   PGN in and out
   ===================================================================== */
function parsePGN(text) {
  const headers = {}; text = text.replace(/\r/g, '');
  text.replace(/\[\s*(\w+)\s+"((?:[^"\\]|\\.)*)"\s*\]/g, (_, k, v) => { headers[k] = v.replace(/\\"/g, '"'); return ''; });
  let body = text.replace(/\[\s*\w+\s+"(?:[^"\\]|\\.)*"\s*\]/g, ' ');
  body = body.replace(/\{[^}]*\}/g, ' ').replace(/;[^\n]*/g, ' ');
  let prev; do { prev = body; body = body.replace(/\([^()]*\)/g, ' '); } while (body !== prev);
  body = body.replace(/\$\d+/g, ' ').replace(/\d+\s*\.(\s*\.\.)?/g, ' ').replace(/\.\.\./g, ' ').replace(/…/g, ' ');
  const toks = body.split(/\s+/).filter(Boolean).filter(t => !/^(1-0|0-1|1\/2-1\/2|½-½|\*)$/.test(t));
  let startFen = START_FEN;
  if (headers.FEN) { const v = new Chess().validate_fen(headers.FEN); if (v.valid) startFen = headers.FEN; else throw new Error('The FEN in this PGN is not a valid position.'); }
  const c = new Chess(startFen); const fens = [startFen]; const moves = [];
  for (const raw of toks) {
    const t = raw.replace(/[!?]+$/, '').replace(/^0-0-0/, 'O-O-O').replace(/^0-0/, 'O-O').replace(/[+#]+$/, (m) => m);
    const mv = c.move(t, { sloppy: true });
    if (!mv) { const no = Math.floor(moves.length / 2) + 1; throw new Error(`Move ${no}${moves.length % 2 ? '…' : '.'} ${raw} is not legal in that position. Check the PGN and try again.`); }
    mv.uci = mv.from + mv.to + (mv.promotion || ''); moves.push(mv); fens.push(c.fen());
  }
  if (!moves.length) throw new Error('No moves found. Paste the PGN including the move list.');
  let result = headers.Result && /^(1-0|0-1|1\/2-1\/2)$/.test(headers.Result) ? headers.Result : '*';
  let reason = '';
  if (c.in_checkmate()) { result = moves[moves.length - 1].color === 'w' ? '1-0' : '0-1'; reason = 'checkmate'; }
  else if (c.in_stalemate()) { result = '1/2-1/2'; reason = 'stalemate'; }
  else if (headers.Termination) { const t = headers.Termination.toLowerCase(); reason = t.includes('time') ? 'on time' : t.includes('resign') ? 'resignation' : t.includes('agree') ? 'agreement' : t.includes('repetition') ? 'threefold repetition' : ''; }
  return { headers, startFen, fens, moves, result, reason };
}
// opts.you: the side of the player whose games were looked up by username, so the board turns to
// them and the review notes say "you"; opts.reason: how the game ended, when the site told us.
function loadPGNForReview(text, opts = {}) {
  const p = parsePGN(text); trainerStop();
  const nm = (c) => { const n = p.headers[c === 'w' ? 'White' : 'Black']; return n && n !== '?' ? n : (c === 'w' ? 'White' : 'Black'); };
  const elo = (c) => p.headers[c === 'w' ? 'WhiteElo' : 'BlackElo'];
  S.engineToken++; if (ENG.main) ENG.main.cancelAll();
  S.game = null; S.chess = null;
  const you = opts.you === 'w' || opts.you === 'b' ? opts.you : null;
  S.line = newLine(p.startFen, { w: nm('w'), b: nm('b') }, { w: elo('w') ? `White · ${elo('w')}` : 'White', b: elo('b') ? `Black · ${elo('b')}` : 'Black' }, { headers: p.headers, result: p.result, reason: p.reason || opts.reason || '', source: 'pgn', you });
  S.line.fens = p.fens; S.line.moves = p.moves;
  S.orientation = you || 'w'; S.review = null; renderCoords(); drawBoardCanvas();
  startReview();
}
function buildPGN() {
  const L = S.line; if (!L || !L.moves.length) return '';
  const g = S.game; const tc = g ? tcById(g.tc) : null;
  const h = Object.assign({ Event: L.source === 'play' ? `Woodpusher vs ${g && personaById(g.opp) ? personaById(g.opp).short + '-style bot' : 'Stockfish'}` : 'Casual game', Site: 'Woodpusher', Date: '????.??.??', Round: '-', White: L.names.w, Black: L.names.b, Result: L.result }, L.source === 'pgn' ? L.headers : {});
  h.Result = L.result; if (tc) h.TimeControl = tc.base ? `${tc.base}+${tc.inc}` : '-';
  if (L.source === 'play' && g) { const op = personaById(g.opp); h[g.playerColor === 'w' ? 'Black' : 'White'] = op ? `${op.short}-style bot (Woodpusher, about ${g.elo} Elo)` : `Stockfish (about ${g.elo} Elo)`; }
  if (L.startFen !== START_FEN) { h.SetUp = '1'; h.FEN = L.startFen; }
  let out = Object.entries(h).map(([k, v]) => `[${k} "${String(v).replace(/"/g, '\\"')}"]`).join('\n') + '\n\n';
  const p = L.startFen.split(' '); let no = +p[5] || 1; let body = '';
  L.moves.forEach((m, i) => { if (m.color === 'w') body += `${no}. ${m.san} `; else { if (i === 0) body += `${no}... `; body += `${m.san} `; no++; } });
  body += L.result;
  return out + body.replace(/(.{1,78})(\s|$)/g, '$1\n').trim() + '\n';
}
function copyPGN() {
  const text = buildPGN(); if (!text) { toast('There is no game on the score sheet yet.'); return; }
  const fallback = () => { $('#exportText').value = text; $('#exportModal').hidden = false; $('#exportText').focus(); $('#exportText').select(); };
  try { navigator.clipboard.writeText(text).then(() => toast('PGN copied to the clipboard.'), fallback); } catch (e) { fallback(); }
}

/* =====================================================================
   Persistence (per-browser) and live-update snapshot
   ===================================================================== */
const STORE = 'woodpusher.v1';
function snapshot() {
  if (S.mode === 'puzzle' || S.mode === 'lesson' || S.mode === 'online') return S.parked || { v: 1, settings: S.settings, mode: 'idle', line: null, game: null, review: null };
  const L = S.line, g = S.game;
  return {
    v: 1, settings: S.settings, mode: S.mode, orientation: S.orientation, view: S.view,
    line: L ? { startFen: L.startFen, sans: L.moves.map(m => m.san), names: L.names, subs: L.subs, headers: L.headers, result: L.result, reason: L.reason, source: L.source, you: L.you || null } : null,
    game: g ? { playerColor: g.playerColor, elo: g.elo, opp: g.opp || null, inBook: !!g.inBook, tc: g.tc, histId: g.histId, takebacks: g.takebacks || 0, clock: { w: Math.max(0, remaining('w')), b: Math.max(0, remaining('b')), running: g.clock.running } } : null,
    review: S.review ? { v: 3, key: S.review.key, evals: S.review.evals, best: S.review.best, pv: S.review.pv, alt: S.review.alt, depth: S.review.depth || [] } : null,
  };
}
let saveTimer = null;
function save() { clearTimeout(saveTimer); saveTimer = setTimeout(() => { try { localStorage.setItem(STORE, JSON.stringify(snapshot())); } catch (e) {} }, 150); }
function loadLocal() { try { const t = localStorage.getItem(STORE); return t ? JSON.parse(t) : null; } catch (e) { return null; } }
function restore(d) {
  if (!d || d.v !== 1) return false;
  if (d.settings) Object.assign(S.settings, d.settings);
  Snd.on = S.settings.sound !== false;
  if (!d.line) return false;
  try {
    const c = new Chess(d.line.startFen); const moves = [], fens = [d.line.startFen];
    for (const san of d.line.sans) { const m = c.move(san); if (!m) return false; m.uci = m.from + m.to + (m.promotion || ''); moves.push(m); fens.push(c.fen()); }
    S.line = Object.assign(newLine(d.line.startFen, d.line.names, d.line.subs), { headers: d.line.headers || {}, result: d.line.result, reason: d.line.reason, source: d.line.source, you: d.line.you || null });
    S.line.fens = fens; S.line.moves = moves; S.chess = c;
    if (d.game) S.game = { playerColor: d.game.playerColor, elo: d.game.elo || LEVEL_TO_ELO[d.game.level] || ELO_DEFAULT, opp: personaById(d.game.opp) ? d.game.opp : null, inBook: !!d.game.inBook, tc: d.game.tc, histId: d.game.histId, takebacks: d.game.takebacks || 0, clock: { w: d.game.clock.w, b: d.game.clock.b, running: d.game.clock.running, last: performance.now() }, lastEngineScore: null };
    S.orientation = d.orientation || 'w';
    S.view = clamp(d.view ?? fens.length - 1, 0, fens.length - 1);
    // v3 reviews were made by Stockfish 19. An older one (Stockfish 10) is simply analysed again.
    if (d.review && d.review.key === lineKey(S.line)) S.review = d.review.v === 3
      ? { key: d.review.key, evals: d.review.evals || [], best: d.review.best || [], pv: d.review.pv || [], alt: d.review.alt || [], depth: d.review.depth || [], cls: [], acc: [], token: 0, done: false }
      : { key: d.review.key, evals: [], best: [], pv: [], alt: [], depth: [], cls: [], acc: [], token: 0, done: false };
    let mode = d.mode;
    if (mode === 'play' || mode === 'paused') mode = S.game ? 'paused' : 'idle';
    if (mode === 'paused') S.view = fens.length - 1;
    setMode(mode === 'review' ? 'review' : mode);
    renderCoords(); renderPieces(fens[S.view], false); renderAll();
    if (mode === 'review') analyse();
    return true;
  } catch (e) { S.line = null; S.game = null; S.chess = null; return false; }
}

/* =====================================================================
   Setup controls and wiring
   ===================================================================== */
function renderSetup() {
  const st = S.settings; renderOppPicker();
  document.querySelectorAll('#colorSeg .seg-btn').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.color === st.color)));
  $('#lvl').value = st.elo; $('#lvlOut').textContent = eloLabel(st.elo); $('#lvlBlurb').textContent = eloBand(st.elo)[2];
  $('#lvl').setAttribute('aria-valuetext', `About ${st.elo} Elo, ${eloBand(st.elo)[1]}`);
  $('#tcGrid').innerHTML = TCS.map(t => `<button class="tc-btn" data-tc="${t.id}" aria-pressed="${t.id === st.tc}" aria-label="${t.base ? `${t.base / 60} minutes plus ${t.inc} seconds, ${t.kind}` : 'Untimed'}"><b>${t.base ? t.id : '∞'}</b><small>${t.kind}</small></button>`).join('');
}
function wire() {
  document.querySelectorAll('[data-pc]').forEach(el => { el.innerHTML = pieceSVG(el.dataset.pc); });
  $('#colorSeg').addEventListener('click', e => { const b = e.target.closest('.seg-btn'); if (!b) return; S.settings.color = b.dataset.color; renderSetup(); if (S.mode === 'idle') { S.orientation = S.settings.color === 'b' ? 'b' : 'w'; renderCoords(); repositionAll(); drawBoardCanvas(); renderAll(); } save(); });
  $('#lvl').addEventListener('input', e => { S.settings.elo = +e.target.value; renderSetup(); renderPlates(); save(); });
  $('#tcGrid').addEventListener('click', e => { const b = e.target.closest('.tc-btn'); if (!b) return; S.settings.tc = b.dataset.tc; renderSetup(); renderSheet(); updateClock(); save(); });
  $('#btnPlay').addEventListener('click', startGame);
  $('#sideTabs').addEventListener('click', e => { const b = e.target.closest('[data-side-tab]'); if (b) pickSideTab(b.dataset.sideTab); });
  $('#btnNew').addEventListener('click', (e) => {
    if (S.mode === 'play' && S.line && S.line.moves.length) { armOrRun(e.currentTarget, 'Abandon this game?', abandonGame); return; }
    if (S.mode === 'review') { if (S.review) S.review.token++; ENG.pool.forEach(x => x.cancelAll()); }
    abandonGame();
  });
  // The logo always leads to the Play page. A game against Stockfish that is still going (or paused)
  // already is the Play page, so it stays put rather than being thrown away; a live online game must
  // be finished first, as with the tabs. Ctrl/Cmd-click or middle-click still opens the site in a new tab.
  $('#brandLockup').addEventListener('click', (e) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    if (window.WP_ONLINE && window.WP_ONLINE.active()) { toast('Your online game is still running. Finish or resign it first.'); return; }
    if (S.mode === 'play' || S.mode === 'paused') return;
    if (S.mode === 'review') { if (S.review) S.review.token++; ENG.pool.forEach(x => x.cancelAll()); }
    abandonGame();
  });
  // The dialog finds games by username (on the Woodpusher site, see importer.js) or takes a pasted PGN
  const openImport = (tab) => { $('#pgnErr').hidden = true; $('#pgnModal').hidden = false; if (window.WP_IMPORT) window.WP_IMPORT.open(tab); else $('#pgnInput').focus(); };
  $('#btnImport').addEventListener('click', () => openImport()); $('#btnImport2').addEventListener('click', () => openImport('paste'));
  $('#btnFindGames').addEventListener('click', () => openImport('user'));
  $('#btnSample').addEventListener('click', () => { if (S.mode === 'play') { toast('Finish or abandon your game first.'); return; } loadPGNForReview(OPERA_PGN); });
  $('#pgnSample').addEventListener('click', () => { $('#pgnInput').value = OPERA_PGN; $('#pgnErr').hidden = true; });
  $('#pgnCancel').addEventListener('click', () => { $('#pgnModal').hidden = true; });
  $('#pgnGo').addEventListener('click', () => {
    if (S.mode === 'play') { $('#pgnErr').textContent = 'Finish or abandon your current game first.'; $('#pgnErr').hidden = false; return; }
    try { loadPGNForReview($('#pgnInput').value); $('#pgnModal').hidden = true; }
    catch (err) { $('#pgnErr').textContent = err.message; $('#pgnErr').hidden = false; }
  });
  $('#expClose').addEventListener('click', () => { $('#exportModal').hidden = true; });
  document.querySelectorAll('.modal-back').forEach(m => m.addEventListener('click', e => { if (e.target === m) m.hidden = true; }));
  $('#btnTakeback').addEventListener('click', takeback);
  $('#btnDraw').addEventListener('click', offerDraw);
  $('#btnResign').addEventListener('click', (e) => armOrRun(e.currentTarget, 'Confirm resign', resign));
  $('#btnResume').addEventListener('click', resumeGame);
  $('#btnAbandon').addEventListener('click', (e) => armOrRun(e.currentTarget, 'Abandon for sure?', abandonGame));
  $('#btnReview').addEventListener('click', startReview);
  $('#btnRematch').addEventListener('click', startGame);
  $('#btnExitReview').addEventListener('click', exitReview);
  $('#btnCopyPgn').addEventListener('click', copyPGN);
  $('#btnAutoPlay').addEventListener('click', apToggle);
  $('#navPlay').addEventListener('click', apToggle);
  $('#apSpeed').addEventListener('click', e => { const b = e.target.closest('.ap-sp'); if (!b) return; S.settings.apSpeed = b.dataset.sp; renderAutoPlay(); save(); });
  $('#btnPrevKey').addEventListener('click', () => { const k = keyMoments().filter(p => p < S.view); if (k.length) goTo(k[k.length - 1]); });
  $('#btnNextKey').addEventListener('click', () => { const k = keyMoments().find(p => p > S.view); if (k) goTo(k); });
  $('#navFirst').addEventListener('click', () => goTo(0));
  $('#navPrev').addEventListener('click', () => goTo(S.view - 1));
  $('#navNext').addEventListener('click', () => goTo(S.view + 1));
  $('#navLast').addEventListener('click', () => goTo(liveIndex()));
  $('#navFlip').addEventListener('click', flip);
  $('#mlist').addEventListener('click', e => { const b = e.target.closest('.mv[data-ply]'); if (b) goTo(+b.dataset.ply); });
  const graph = $('#graph');
  const graphJump = (e) => { const r = graph.getBoundingClientRect(); const n = liveIndex(); goTo(Math.round(clamp((e.clientX - r.left) / r.width, 0, 1) * n)); };
  graph.addEventListener('pointerdown', e => { graphJump(e); graph.setPointerCapture(e.pointerId); });
  graph.addEventListener('pointermove', e => { if (e.buttons) graphJump(e); });
  const b = boardEl();
  b.addEventListener('pointerdown', onPointerDown); b.addEventListener('pointermove', onPointerMove);
  b.addEventListener('pointerup', onPointerUp); b.addEventListener('pointercancel', onPointerUp);
  b.addEventListener('contextmenu', e => {
    e.preventDefault(); if (lastPointerType === 'touch') return;
    if (S.premoves.length) clearPremoves(); else if (S.sel && !dragState) selectSq(null);
  });
  document.addEventListener('keydown', e => {
    if (e.target.closest('textarea, input')) return;
    if (e.key === 'Escape') { document.querySelectorAll('.modal-back').forEach(m => m.hidden = true); if (S.promoPending) { closePromo(); renderHighlights(); } if (S.premoves.length) clearPremoves(); if (S.sel) selectSq(null); return; }
    if (!document.querySelectorAll('.modal-back:not([hidden])').length) {
      if (e.key === 'ArrowLeft') { goTo(S.view - 1); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { goTo(S.view + 1); e.preventDefault(); }
      else if (e.key === 'Home') { goTo(0); e.preventDefault(); }
      else if (e.key === 'End') { goTo(liveIndex()); e.preventDefault(); }
      else if (e.key === 'f' || e.key === 'F') flip();
      // Space plays and pauses a review (on a focused button Space already presses that button)
      else if (e.key === ' ' && S.mode === 'review' && !e.target.closest('button, a, select')) { apToggle(); e.preventDefault(); }
    }
  });
  let rz = null; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(layoutBoard, 90); });
  window.addEventListener('pagehide', () => { try { localStorage.setItem(STORE, JSON.stringify(snapshot())); } catch (e) {} });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { try { localStorage.setItem(STORE, JSON.stringify(snapshot())); } catch (e) {} } });
}
/* =====================================================================
   Trainers: opening lessons and puzzles
   ===================================================================== */
const PROG_KEY = 'woodpusher.progress.v1';
const PROG = (() => { try { return JSON.parse(localStorage.getItem(PROG_KEY)) || {}; } catch (e) { return {}; } })();
PROG.lines = PROG.lines || {};
PROG.pz = Object.assign({ rating: 1200, solved: 0, tried: 0, streak: 0, best: 0, seen: {} }, PROG.pz || {});
PROG.mist = Array.isArray(PROG.mist) ? PROG.mist : [];             // positions from your games to practise (see collectMistakes)
PROG.daily = PROG.daily && typeof PROG.daily === 'object' ? PROG.daily : {};   // puzzle of the day: date -> 1 solved, 0 tried
function saveProg() { try { localStorage.setItem(PROG_KEY, JSON.stringify(PROG)); } catch (e) {} if (typeof progressChanged === 'function') progressChanged(); }

const T = { kind: null, timers: [], hint: 0, wrong: null, right: null };
function tLater(fn, ms) { const id = setTimeout(() => { T.timers = T.timers.filter(x => x !== id); fn(); }, ms); T.timers.push(id); }
function trainerStop() { T.timers.forEach(clearTimeout); T.timers = []; T.kind = null; T.hint = 0; T.wrong = null; T.right = null; }
function clearTimers() { T.timers.forEach(clearTimeout); T.timers = []; }
function leaveForTrainer(btn, label, go) {
  if (S.mode === 'play' && S.line && S.line.moves.length) { armOrRun(btn, label, () => { abandonGame(); go(); }); return; }
  if (S.mode !== 'puzzle' && S.mode !== 'lesson') {
    if (S.mode === 'review') { if (S.review) S.review.token++; ENG.pool.forEach(x => x.cancelAll()); }
    S.engineToken++; if (ENG.main) ENG.main.cancelAll();
    if (S.line && S.mode !== 'play') S.parked = snapshot();
  }
  go();
}
function pushTrainerMove(mv) {
  mv.uci = mv.from + mv.to + (mv.promotion || '');
  S.line.fens.push(S.chess.fen()); S.line.moves.push(mv); S.view = liveIndex(); S.sel = null; S.legal = [];
  if (S.chess.in_check()) Snd.check(); else if (mv.captured) Snd.capture(); else Snd.move();
  renderPieces(S.line.fens[S.view]); renderAll();
}
function popTrainerMove() { S.chess.undo(); S.line.moves.pop(); S.line.fens.pop(); S.view = liveIndex(); renderPieces(S.line.fens[S.view]); renderAll(); }
function playUci(uci) { const mv = S.chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined }); if (mv) pushTrainerMove(mv); return mv; }
function sameMove(mv, uci) { return !!uci && mv.from === uci.slice(0, 2) && mv.to === uci.slice(2, 4) && (mv.promotion || '') === (uci[4] || ''); }
function expectedUci() {
  if (T.kind === 'puzzle' && PZ.p) return PZ.p.moves[PZ.step] || null;
  if (T.kind === 'lesson' && LS.ucis) return LS.ucis[LS.step] || null;
  return null;
}
function trainerHighlights(box) {
  if (!T.kind || S.view !== liveIndex()) return '';
  let h = ''; const u = expectedUci();
  if (u && T.hint >= 1 && canUserMove()) h += box(u.slice(0, 2), 'hl-hint');
  if (T.wrong) { const [c, r] = sqToCR(T.wrong); h += `<div class="badge" style="--c:${c};--r:${r};--cc:var(--c-blunder)" aria-hidden="true">✗</div>`; }
  if (T.right) { const [c, r] = sqToCR(T.right); h += `<div class="badge" style="--c:${c};--r:${r};--cc:var(--c-best)" aria-hidden="true">✓</div>`; }
  return h;
}
function trainerArrows() {
  if (!T.kind || S.view !== liveIndex() || T.hint < 2 || !canUserMove()) return '';
  const u = expectedUci(); return u ? arrowPath(u.slice(0, 2), u.slice(2, 4), 'var(--c-best)') : '';
}
function renderTrainer() { if (T.kind === 'puzzle') renderPuzzlePanel(); else if (T.kind === 'lesson') renderLessonPanel(); }
const colorName = (c) => c === 'w' ? 'White' : 'Black';

/* ---------------- Puzzles ---------------- */
// Puzzles come from three places. On the Woodpusher site: the server's selection from the Lichess
// puzzle database (server/puzzles.js), fetched about twenty at a time near your rating and kept in this
// browser, so a batch is there offline too. Your mistakes: positions from your own reviewed games, where
// you find the better move. And the 94 puzzles built into the page, for offline use and as a fallback.
const PZDATA = (typeof PUZZLES !== 'undefined' ? PUZZLES : []).map((x, i) => ({ id: 'p' + i, fen: x[0], moves: x[1].split(' '), rating: x[2], themes: x[3] ? x[3].split(',') : [] }));
const PZ = { p: null, step: 0, color: 'w', state: 'idle', failed: false, usedHint: false, rated: false, delta: null, theme: 'all', check: 0, pick: 0, also: false, run: null };
const PZQ_KEY = 'woodpusher.pzq.v1', DAILY_KEY = 'woodpusher.daily.v1';
const PZS = Object.assign({ theme: 'all', list: [] }, (() => { try { return JSON.parse(localStorage.getItem(PZQ_KEY)) || {}; } catch (e) { return {}; } })(), { themes: null, filling: null, daily: null });
if (!Array.isArray(PZS.list)) PZS.list = [];
function savePzq() { try { localStorage.setItem(PZQ_KEY, JSON.stringify({ theme: PZS.theme, list: PZS.list.slice(0, 40) })); } catch (e) {} }
const pzServer = () => !!(PZS.themes && PZS.themes.total > 0);
const todayUTC = () => new Date().toISOString().slice(0, 10);
function themeOk(p, th) {
  if (th === 'all') return true;
  if (th === 'Mate in 3+') return p.themes.some(t => /^Mate in [3-9]/.test(t));
  return p.themes.includes(th);
}
function pickLocal() {
  const r = PROG.pz.rating;
  let pool = PZDATA.filter(p => themeOk(p, PZ.theme) && !(p.id in PROG.pz.seen) && (!PZ.p || p.id !== PZ.p.id));
  if (!pool.length) pool = PZDATA.filter(p => themeOk(p, PZ.theme) && (!PZ.p || p.id !== PZ.p.id));
  if (!pool.length) pool = PZDATA.slice();
  pool.sort((a, b) => Math.abs(a.rating - r) - Math.abs(b.rating - r));
  const near = pool.slice(0, Math.min(6, pool.length));
  return near[Math.floor(Math.random() * near.length)];
}
// A batch from the server near your rating, leaving out the puzzles you have already done
async function fillQueue() {
  if (PZS.filling) return PZS.filling;
  const theme = PZ.theme === 'all' || PZ.theme === 'mine' ? '' : PZ.theme;
  PZS.filling = (async () => {
    const ex = [...new Set(Object.keys(PROG.pz.seen).filter(k => k[0] === 'l').slice(-300).concat(PZS.list.map(p => p.id)))].join(',');
    try {
      const d = await api(`/puzzles?rating=${PROG.pz.rating}&n=20${theme ? '&theme=' + encodeURIComponent(theme) : ''}&exclude=${encodeURIComponent(ex)}`);
      if (PZS.theme !== PZ.theme) { PZS.list = []; PZS.theme = PZ.theme; }
      for (const p of d.puzzles) if (!(p.id in PROG.pz.seen) && !PZS.list.some(x => x.id === p.id)) PZS.list.push(p);
      savePzq();
    } catch (e) { /* offline: the saved batch, then the built-in puzzles */ }
  })();
  try { await PZS.filling; } finally { PZS.filling = null; }
}
async function takeServerPuzzle() {
  if (PZS.theme !== PZ.theme) { PZS.list = []; PZS.theme = PZ.theme; savePzq(); }
  PZS.list = PZS.list.filter(p => !(p.id in PROG.pz.seen) && (!PZ.p || p.id !== PZ.p.id));
  if (!PZS.list.length) await fillQueue(); else if (PZS.list.length < 6) fillQueue();
  if (!PZS.list.length) return null;
  const r = PROG.pz.rating; PZS.list.sort((a, b) => Math.abs(a.rating - r) - Math.abs(b.rating - r));
  const near = PZS.list.slice(0, Math.min(3, PZS.list.length)); const p = near[Math.floor(Math.random() * near.length)];
  PZS.list = PZS.list.filter(x => x !== p); savePzq();
  return p;
}
async function nextPuzzle() {
  const tk = ++PZ.pick; let p = null;
  if (PZ.theme === 'mine') p = pickMistake();
  else if (pzServer() || PZS.list.length) p = await takeServerPuzzle();
  if (tk !== PZ.pick) return;
  if (!p) p = pickLocal();
  if (p) startPuzzle(p); else toast('No puzzles are available.');
}
function openPuzzles() {
  PZ.run = null; if (PZ.theme === 'mine' && !PROG.mist.length) PZ.theme = 'all';
  buildThemeSelect(); loadDaily().then(() => { if (S.mode === 'puzzle') renderPuzzlePanel(); });
  nextPuzzle();
}

/* ---------------- the puzzle of the day ---------------- */
// The same puzzle for everyone on a date (UTC), from the server; remembered here for the day
async function loadDaily() {
  const day = todayUTC();
  if (PZS.daily && PZS.daily.day === day) return PZS.daily;
  try { const c = JSON.parse(localStorage.getItem(DAILY_KEY)); if (c && c.day === day && c.puzzle) return (PZS.daily = c); } catch (e) {}
  if (typeof io === 'undefined') return null;
  try { const d = await api('/puzzles/daily'); PZS.daily = d; try { localStorage.setItem(DAILY_KEY, JSON.stringify(d)); } catch (e) {} } catch (e) { return null; }
  return PZS.daily;
}
function dailyStreak() {
  let n = 0; const d = new Date(); if (PROG.daily[todayUTC()] !== 1) d.setUTCDate(d.getUTCDate() - 1);
  while (PROG.daily[d.toISOString().slice(0, 10)] === 1) { n++; d.setUTCDate(d.getUTCDate() - 1); }
  return n;
}
function startDaily() { const d = PZS.daily; if (!d || !d.puzzle) return; PZ.run = null; startPuzzle(Object.assign({}, d.puzzle, { daily: d.day })); }

/* ---------------- your mistakes ---------------- */
// After a review of your own game, your mistakes and blunders become puzzles: the board starts one move
// earlier, your opponent plays their move, and you look for a better move than the one you played.
// Stockfish's best move counts, and so does any move that keeps the position about as good.
function hashStr(t) { let h = 2166136261; for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
const mistakeGameKey = (L) => 'g' + hashStr(lineKey(L));
const gameMistakes = (g) => PROG.mist.filter(x => x.g === g).sort((a, b) => a.ply - b.ply);
const mistakePuzzle = (m) => ({ id: m.id, fen: m.fen, moves: m.moves, rating: null, themes: [], mine: m });
function collectMistakes() {
  const R = S.review, L = S.line; const you = typeof youColor === 'function' ? youColor() : null;
  if (!R || !R.done || !L || !you) { renderMistakeCta(); return; }
  const g = mistakeGameKey(L); const vs = L.names[you === 'w' ? 'b' : 'w'] || 'your opponent'; const sgn = you === 'w' ? 1 : -1;
  let added = 0;
  for (let i = 1; i < L.moves.length; i++) {
    const c = R.cls[i]; const mv = L.moves[i];
    if ((c !== 'mistake' && c !== 'blunder') || mv.color !== you || !R.best[i] || R.best[i] === mv.uci || !R.evals[i]) continue;
    const before = winPct(scoreOf(R.evals[i]) * sgn);
    if (before < 15) continue;                     // already lost: there was nothing to find
    const id = 'm' + hashStr(L.fens[i] + R.best[i]);
    if (PROG.mist.some(x => x.id === id)) continue;
    const alt = R.alt[i] && R.alt[i].move && Math.abs(winPct(scoreOf(R.alt[i].ev) * sgn) - before) <= 5 ? [R.alt[i].move] : [];
    PROG.mist.push({ id, g, ply: i, fen: L.fens[i - 1], moves: [L.moves[i - 1].uci, R.best[i]], alt, played: mv.san, label: moveLabel(i), vs: String(vs).slice(0, 40), cls: c, before: Math.round(before), at: Date.now(), solved: 0, tries: 0 });
    added++;
  }
  if (PROG.mist.length > 200) {
    // keep the newest; solved ones go first
    PROG.mist.sort((a, b) => ((b.solved > 0) - (a.solved > 0)) || a.at - b.at);
    PROG.mist = PROG.mist.slice(PROG.mist.length - 200);
  }
  if (added) { saveProg(); buildThemeSelect(); }
  renderMistakeCta();
}
function renderMistakeCta() {
  const el = $('#rvMist'); if (!el) return;
  const R = S.review, L = S.line; const you = typeof youColor === 'function' ? youColor() : null;
  const n = R && R.done && L && you && S.mode === 'review' ? gameMistakes(mistakeGameKey(L)).length : 0;
  if (!n) { el.hidden = true; el.innerHTML = ''; return; }
  const html = `<button class="btn btn-brass" data-mist>Learn from your mistakes (${n})</button><span class="fine">Play ${n === 1 ? 'that position' : 'those positions'} again and find a better move. You'll also find ${n === 1 ? 'it' : 'them'} under Puzzles, in “Your mistakes”.</span>`;
  if (el.innerHTML !== html) el.innerHTML = html; el.hidden = false;
}
function practiseMistakes(g) {
  const ids = gameMistakes(g).map(x => x.id); if (!ids.length) return;
  if (S.mode === 'review') { if (S.review) S.review.token++; ENG.pool.forEach(x => x.cancelAll()); S.parked = snapshot(); }
  S.engineToken++; if (ENG.main) ENG.main.cancelAll();
  PZ.theme = 'mine'; PZ.run = { g, ids, i: 0, found: 0, back: S.mode === 'review' };
  buildThemeSelect(); startPuzzle(pickMistake());
}
function pickMistake() {
  if (PZ.run) { const m = PROG.mist.find(x => x.id === PZ.run.ids[PZ.run.i]); return m ? mistakePuzzle(m) : null; }
  if (!PROG.mist.length) return null;
  // Unsolved ones first, then the ones practised longest ago
  const pool = PROG.mist.filter(x => !PZ.p || x.id !== PZ.p.id); const list = (pool.length ? pool : PROG.mist).slice();
  list.sort((a, b) => ((a.solved > 0) - (b.solved > 0)) || (a.last || 0) - (b.last || 0) || a.at - b.at);
  return mistakePuzzle(list[0]);
}
function nextInRun() {
  const run = PZ.run;
  if (run.i < run.ids.length - 1) { run.i++; startPuzzle(pickMistake()); return; }
  PZ.run = null;
  if (run.back && S.parked && S.parked.mode === 'review') { const d = S.parked; S.parked = null; trainerStop(); restore(d); drawBoardCanvas(); return; }
  PZ.theme = PROG.mist.length ? 'mine' : 'all'; buildThemeSelect(); nextPuzzle();
}
// A move other than the expected one in a mistake puzzle: does it keep the position about as good?
async function checkAlternative(mv) {
  const p = PZ.p; const token = ++PZ.check;
  PZ.state = 'checking'; pushTrainerMove(mv);
  const eng = await ENG.ready;
  const res = eng ? await eng.search({ fen: S.chess.fen(), depth: 14, movetime: 900, skill: 20, multipv: 1 }) : null;
  if (token !== PZ.check || PZ.p !== p || PZ.state !== 'checking') return;
  const info = res && res.info; let good = false;
  if (info) {
    const opp = info.mate != null ? (info.mate > 0 ? 10000 - info.mate * 10 : -10000 - info.mate * 10) : Math.round((info.cp || 0) * EVAL_SCALE);
    good = winPct(-opp) >= (p.mine.before || 50) - 5;
  }
  if (good) { T.wrong = null; T.hint = 0; T.right = mv.to; PZ.step = p.moves.length; PZ.also = true; puzzleDone(); return; }
  T.wrong = mv.to; PZ.failed = true; PZ.state = 'wrong'; renderAll();
  tLater(() => { T.wrong = null; popTrainerMove(); PZ.state = 'solving'; renderAll(); }, 900);
}

/* ---------------- playing a puzzle ---------------- */
function startPuzzle(p, retry = false) {
  clearTimers(); T.kind = 'puzzle'; T.hint = 0; T.wrong = null; T.right = null;
  PZ.p = p; PZ.step = 0; PZ.state = 'intro'; PZ.usedHint = false; PZ.also = false; PZ.check++;
  if (!retry) { PZ.failed = false; PZ.rated = false; PZ.delta = null; }
  const solver = p.fen.split(' ')[1] === 'w' ? 'b' : 'w'; PZ.color = solver;
  S.game = null; S.review = null; S.chess = new Chess(p.fen); S.bannerOpen = false;
  const opp = p.mine ? p.mine.vs : 'Puzzle';
  S.line = newLine(p.fen, { w: 'White', b: 'Black' }, { w: solver === 'w' ? 'You' : opp, b: solver === 'b' ? 'You' : opp }, { source: 'puzzle' });
  S.orientation = solver; S.view = 0; S.sel = null; S.legal = [];
  setMode('puzzle'); renderCoords(); drawBoardCanvas(); renderPieces(p.fen, false); renderAll();
  tLater(() => { playUci(p.moves[0]); PZ.step = 1; PZ.state = 'solving'; renderAll(); }, 700);
}
function puzzleMove(mv) {
  const exp = PZ.p.moves[PZ.step]; const last = PZ.step === PZ.p.moves.length - 1;
  const alt = PZ.p.mine && last && (PZ.p.mine.alt || []).some(u => sameMove(mv, u));
  if (sameMove(mv, exp) || alt || (last && S.chess.in_checkmate())) {
    T.wrong = null; T.hint = 0; T.right = mv.to; PZ.step++; if (alt) PZ.also = true;
    PZ.state = PZ.step >= PZ.p.moves.length || alt ? 'finishing' : 'reply';
    if (alt) PZ.step = PZ.p.moves.length;
    pushTrainerMove(mv);
    if (PZ.state === 'finishing') { puzzleDone(); return; }
    tLater(() => { T.right = null; playUci(PZ.p.moves[PZ.step]); PZ.step++; PZ.state = 'solving'; renderAll(); }, 500);
  } else if (PZ.p.mine && last && ENG.main) {
    checkAlternative(mv);
  } else {
    T.wrong = mv.to; PZ.failed = true; PZ.state = 'wrong'; pushTrainerMove(mv);
    tLater(() => { T.wrong = null; popTrainerMove(); PZ.state = 'solving'; renderAll(); }, 900);
  }
}
function ratePuzzle() {
  if (PZ.rated) return; PZ.rated = true;
  const win = !PZ.failed && !PZ.usedHint; const p = PZ.p;
  if (p.mine) {
    // Your own mistakes don't change your puzzle rating
    const m = PROG.mist.find(x => x.id === p.id);
    if (m) { m.tries = (m.tries || 0) + 1; if (win) m.solved = (m.solved || 0) + 1; m.last = Date.now(); }
    if (PZ.run && win) PZ.run.found++;
    saveProg(); return;
  }
  if (p.daily) PROG.daily[p.daily] = Math.max(PROG.daily[p.daily] || 0, win ? 1 : 0);
  // A Lichess puzzle counts for your rating the first time only
  const counts = !(p.id[0] === 'l' && p.id in PROG.pz.seen);
  if (counts) {
    const r = PROG.pz.rating, pr = p.rating;
    const exp = 1 / (1 + Math.pow(10, (pr - r) / 400)); const K = PROG.pz.tried < 10 ? 40 : 20;
    const d = Math.round(K * ((win ? 1 : 0) - exp));
    PROG.pz.rating = Math.max(400, r + d); PZ.delta = d; PROG.pz.tried++;
    if (win) { PROG.pz.solved++; PROG.pz.streak++; PROG.pz.best = Math.max(PROG.pz.best, PROG.pz.streak); } else PROG.pz.streak = 0;
  }
  PROG.pz.seen[p.id] = win ? 1 : Math.max(0, PROG.pz.seen[p.id] || 0);
  const ks = Object.keys(PROG.pz.seen); if (ks.length > 15000) for (const k of ks.slice(0, ks.length - 15000)) delete PROG.pz.seen[k];
  saveProg();
}
function puzzleDone() {
  ratePuzzle();
  PZ.state = PZ.failed || PZ.usedHint ? 'solvedHelp' : 'solved';
  if (PZ.state === 'solved') Snd.end();
  announce(PZ.state === 'solved' ? (PZ.also ? 'That works too. Solved.' : 'Puzzle solved.') : 'Puzzle finished.');
  renderAll();
}
function puzzleHint() {
  if (T.kind !== 'puzzle' || PZ.state !== 'solving') return;
  if (S.view !== liveIndex()) goTo(liveIndex());
  T.hint = Math.min(2, T.hint + 1); PZ.usedHint = true; renderAll();
}
function puzzleSolution() {
  if (T.kind !== 'puzzle' || !['solving', 'wrong', 'reply', 'checking'].includes(PZ.state)) return;
  clearTimers(); PZ.check++; if (PZ.state === 'wrong' || PZ.state === 'checking') { T.wrong = null; popTrainerMove(); }
  if (PZ.state === 'reply') { T.right = null; playUci(PZ.p.moves[PZ.step]); PZ.step++; }
  if (S.view !== liveIndex()) goTo(liveIndex(), false);
  PZ.failed = true; T.hint = 0; ratePuzzle(); PZ.state = 'showing'; renderAll();
  const step = () => {
    if (PZ.step >= PZ.p.moves.length) { PZ.state = 'shown'; renderAll(); return; }
    playUci(PZ.p.moves[PZ.step]); PZ.step++; tLater(step, 750);
  };
  tLater(step, 250);
}
function renderDaily() {
  const el = $('#pzDaily'); if (!el) return;
  const d = PZS.daily; if (!d || !d.puzzle) { el.hidden = true; return; }
  const done = PROG.daily[d.day]; const on = PZ.p && PZ.p.daily === d.day; const streak = dailyStreak();
  el.innerHTML = `<button class="pz-daily-btn${on ? ' on' : ''}" data-daily ${on ? 'aria-current="true"' : ''}><span class="pz-daily-t">Puzzle of the day</span><span class="pz-daily-s">${done === 1 ? '✓ Solved' : done === 0 ? 'Tried' : on ? 'Playing now' : 'Not tried yet'}${streak > 1 ? ` · ${streak} days in a row` : ''}</span></button>`;
  el.hidden = false;
}
function renderPuzzlePanel() {
  const p = PZ.p; if (!p) return;
  $('#pzRating').textContent = PROG.pz.rating;
  const dl = $('#pzDelta'); if (PZ.delta != null && PZ.rated && !p.mine) { dl.textContent = (PZ.delta >= 0 ? '+' : MINUS) + Math.abs(PZ.delta); dl.className = 'delta ' + (PZ.delta >= 0 ? 'up' : 'down'); } else { dl.textContent = ''; dl.className = 'delta'; }
  const who = colorName(PZ.color); const m = p.mine;
  const findText = m ? `Find a better move for ${who} than ${m.played}.` : `Find the best move for ${who}.`;
  const st = {
    intro: ['', 'Get ready', m ? `${m.vs} plays the move before your mistake.` : `Watch your opponent's move.`],
    solving: ['', 'Your turn', T.hint === 1 ? 'Hint: move the highlighted piece.' : T.hint === 2 ? 'Hint: play the move shown by the arrow.' : findText],
    checking: ['', 'Checking your move', 'Stockfish is looking at it…'],
    reply: ['good', 'Correct', 'Keep going…'],
    wrong: ['bad', 'Not this one', m ? 'That move doesn’t keep the position. Try again.' : 'That move doesn’t work. Try again.'],
    finishing: ['good', 'Solved', ''],
    solved: ['good', PZ.also ? 'That works too!' : 'Solved!', m ? (PZ.also ? `Stockfish's choice was ${bestSan(p)}, but yours keeps the position just as well.` : `${bestSan(p)} was the move. In the game you played ${m.played}.`) : p.moves.length > 2 ? 'You found the whole combination.' : 'Well spotted.'],
    solvedHelp: ['good', 'Solved with help', m ? `${bestSan(p)} was the move.` : PZ.usedHint ? 'You used a hint, so it doesn’t count for your rating.' : 'You got there after a wrong try.'],
    showing: ['bad', 'Solution', 'Watch the winning line.'],
    shown: ['bad', 'Solution shown', 'Retry it from the start or move on to the next one.'],
  }[PZ.state] || ['', '', ''];
  $('#pzStatus').className = 'pz-status' + (st[0] ? ' ' + st[0] : '');
  $('#pzStatus').innerHTML = `<span class="pc-ic">${pieceSVG(PZ.color + 'K')}</span><div><b>${esc(st[1])}</b><span>${esc(st[2])}</span></div>`;
  const done = ['solved', 'solvedHelp', 'shown'].includes(PZ.state);
  let meta;
  if (m) meta = `<span>From your game against ${esc(m.vs)}: you played ${esc(m.label)} ${esc(m.played)}, a ${m.cls === 'blunder' ? 'blunder' : 'mistake'}.</span>${PZ.run ? `<span class="chip">${PZ.run.i + 1} of ${PZ.run.ids.length}</span>` : ''}`;
  else meta = `${p.daily ? '<span class="chip">Puzzle of the day</span>' : ''}<span>Puzzle rating ${p.rating}</span>` + (done ? p.themes.map(t => `<span class="chip">${esc(t)}</span>`).join('') + (p.game ? ` <a href="${esc(p.game)}" target="_blank" rel="noopener">The game on Lichess</a>` : '') : '<span>· themes appear once you’re done</span>');
  $('#pzMeta').innerHTML = meta;
  $('#pzHint').disabled = PZ.state !== 'solving' || T.hint >= 2;
  $('#pzHint').textContent = T.hint === 0 ? 'Hint' : T.hint === 1 ? 'Show move' : 'Hint shown';
  $('#pzSolution').disabled = !['solving', 'wrong', 'reply', 'checking'].includes(PZ.state);
  $('#pzRetry').hidden = !done;
  const next = $('#pzNext'); next.classList.toggle('btn-brass', done);
  next.textContent = PZ.run ? (PZ.run.i < PZ.run.ids.length - 1 ? 'Next mistake' : PZ.run.back ? 'Back to the review' : 'Next puzzle') : 'Next puzzle';
  const s = PROG.pz;
  if (m) { const solved = PROG.mist.filter(x => x.solved > 0).length; $('#pzStats').textContent = `${PROG.mist.length} position${PROG.mist.length === 1 ? '' : 's'} from your games · ${solved} solved · your puzzle rating doesn’t change here`; }
  else $('#pzStats').textContent = `Solved ${s.solved} of ${s.tried} · Streak ${s.streak} · Best streak ${s.best}` + (p.id[0] === 'l' ? ` · ${(PZS.themes && PZS.themes.total ? PZS.themes.total.toLocaleString('en-GB') + ' puzzles' : 'Puzzles')} from the Lichess puzzle database (CC0)` : ` · ${PZDATA.length} puzzles in the set`);
  if ($('#pzTheme').value !== PZ.theme) buildThemeSelect();
  renderDaily();
}
function bestSan(p) { try { const c = new Chess(p.fen); c.move({ from: p.moves[0].slice(0, 2), to: p.moves[0].slice(2, 4), promotion: p.moves[0][4] }); const u = p.moves[1]; const mv = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }); return mv ? mv.san : ''; } catch (e) { return ''; } }
function buildThemeSelect() {
  const opts = [];
  if (pzServer()) {
    opts.push(['all', `All themes (${PZS.themes.total.toLocaleString('en-GB')})`]);
    if (PROG.mist.length) opts.push(['mine', `Your mistakes (${PROG.mist.length})`]);
    PZS.themes.themes.forEach(t => opts.push([t.key, `${t.name} (${t.n.toLocaleString('en-GB')})`]));
  } else {
    const counts = {}; PZDATA.forEach(p => p.themes.forEach(t => { counts[t] = (counts[t] || 0) + 1; }));
    const m3 = PZDATA.filter(p => themeOk(p, 'Mate in 3+')).length;
    const order = ['Mate in 1', 'Mate in 2', 'Mate in 3+', 'Back-rank mate', 'Fork', 'Sacrifice', 'Win material', 'Endgame', 'Promotion', 'Knight mate'];
    opts.push(['all', `All themes (${PZDATA.length})`]);
    if (PROG.mist.length) opts.push(['mine', `Your mistakes (${PROG.mist.length})`]);
    order.forEach(t => { const n = t === 'Mate in 3+' ? m3 : counts[t]; if (n) opts.push([t, `${t} (${n})`]); });
  }
  if (!opts.some(o => o[0] === PZ.theme)) PZ.theme = 'all';
  $('#pzTheme').innerHTML = opts.map(([v, l]) => `<option value="${esc(v)}"${v === PZ.theme ? ' selected' : ''}>${esc(l)}</option>`).join('');
}

/* ---------------- Opening lessons ---------------- */
const COURSE_LIST = typeof COURSES !== 'undefined' ? COURSES : [];
const LS = { course: null, line: null, lineIdx: -1, full: null, ucis: null, phase: 'learn', color: 'w', step: 0, mistakes: 0, state: 'idle', listSide: 'w' };
function parseLessonLine(pgn) {
  const out = []; const re = /\{([^}]*)\}|(\d+\.(?:\.\.)?)|([^\s{}]+)/g; let m;
  while ((m = re.exec(pgn))) { if (m[1] != null) { if (out.length) out[out.length - 1].c = m[1].trim(); } else if (m[3]) out.push({ san: m[3], c: '' }); }
  return out;
}
function lineProgress(lineId, color) { return PROG.lines[lineId + ':' + color] || null; }
function courseProgress(c) { const n = c.lines.filter(l => lineProgress(l.id, c.side)).length; return `${n}/${c.lines.length}`; }
function openCourses() {
  clearTimers(); T.kind = 'lesson'; T.hint = 0; T.wrong = null; T.right = null;
  LS.course = null; LS.line = null; LS.full = null; LS.ucis = null; LS.state = 'idle';
  S.game = null; S.review = null; S.chess = null; S.line = null; S.view = 0; S.bannerOpen = false; S.sel = null; S.legal = [];
  S.orientation = LS.listSide;
  setMode('lesson'); renderCoords(); drawBoardCanvas(); renderPieces(START_FEN, false); renderAll();
}
function openCourse(id) {
  clearTimers(); T.hint = 0; T.wrong = null; T.right = null;
  LS.course = COURSE_LIST.find(c => c.id === id); LS.line = null; LS.full = null; LS.ucis = null; LS.state = 'idle'; LS.color = LS.course.side;
  S.line = null; S.chess = null; S.view = 0; S.orientation = LS.color;
  renderCoords(); drawBoardCanvas(); renderPieces(START_FEN, false); renderAll();
  const panel = $('#lessonPanel'); if (panel.getBoundingClientRect().top < 0) panel.scrollIntoView({ block: 'start' });
}
function openLine(idx, phase) {
  clearTimers(); T.hint = 0; T.wrong = null; T.right = null;
  const c = LS.course; const L = c.lines[idx]; LS.lineIdx = idx; LS.line = L; LS.phase = phase; LS.mistakes = 0; LS.step = 0;
  const ch = new Chess(); LS.full = parseLessonLine(L.pgn).map(x => { const m = ch.move(x.san); m.uci = m.from + m.to + (m.promotion || ''); m.comment = x.c; return m; });
  LS.ucis = LS.full.map(m => m.uci);
  S.orientation = LS.color; S.game = null; S.review = null; S.bannerOpen = false; S.sel = null; S.legal = [];
  const you = LS.color;
  S.line = newLine(START_FEN, { w: 'White', b: 'Black' }, { w: you === 'w' ? 'You' : c.name, b: you === 'b' ? 'You' : c.name }, { source: 'lesson', headers: { Event: c.name } });
  if (phase === 'learn') {
    const c2 = new Chess(); for (const m of LS.full) { c2.move(m.san); S.line.fens.push(c2.fen()); S.line.moves.push(m); }
    S.chess = c2; S.view = 0; LS.state = 'learn';
  } else { S.chess = new Chess(); S.view = 0; LS.state = 'await'; }
  setMode('lesson'); renderCoords(); drawBoardCanvas(); renderPieces(START_FEN, false); renderAll();
  if (phase === 'practice') lessonAuto();
}
function lessonAuto() {
  if (LS.step >= LS.full.length) { lessonDone(); return; }
  if (S.chess.turn() !== LS.color) {
    LS.state = 'reply'; renderTrainer();
    tLater(() => { playUci(LS.ucis[LS.step]); LS.step++; lessonAuto(); }, 550);
  } else { LS.state = 'await'; renderAll(); }
}
function lessonMove(mv) {
  const exp = LS.ucis[LS.step];
  if (sameMove(mv, exp)) {
    T.wrong = null; T.hint = 0; T.right = mv.to; LS.step++; LS.state = 'reply'; pushTrainerMove(mv);
    tLater(() => { T.right = null; renderHighlights(); }, 650);
    lessonAuto();
  } else {
    T.wrong = mv.to; LS.mistakes++; LS.state = 'wrong'; pushTrainerMove(mv);
    tLater(() => { T.wrong = null; popTrainerMove(); LS.state = 'await'; renderAll(); }, 900);
  }
}
function lessonDone() {
  LS.state = 'done';
  const key = LS.line.id + ':' + LS.color; const prev = PROG.lines[key] || {};
  PROG.lines[key] = { done: true, perfect: !!prev.perfect || LS.mistakes === 0 }; saveProg();
  Snd.end(); renderAll();
}
function lessonHint() { if (LS.state !== 'await') return; if (S.view !== liveIndex()) goTo(liveIndex()); T.hint = Math.min(2, T.hint + 1); renderAll(); }
function lineStatus(l, color) {
  const p = lineProgress(l.id, color);
  return p ? (p.perfect ? '<span class="st done">★ Practised without mistakes</span>' : '<span class="st done">✓ Practised</span>') : '<span class="st">Not practised yet</span>';
}
function renderLessonPanel() {
  const el = $('#lessonPanel');
  if (!LS.course) {
    const list = COURSE_LIST.filter(c => c.side === LS.listSide);
    el.innerHTML = `<div><h2>Opening lessons</h2><p class="card-sub" style="margin:4px 0 0">Learn the main lines move by move, then play them from memory.</p></div>
      <div class="seg" role="group" aria-label="Repertoire side" style="grid-template-columns:1fr 1fr">
        <button class="seg-btn" data-side="w" aria-pressed="${LS.listSide === 'w'}"><span class="seg-ic">${pieceSVG('wK')}</span>Openings for White</button>
        <button class="seg-btn" data-side="b" aria-pressed="${LS.listSide === 'b'}"><span class="seg-ic">${pieceSVG('bK')}</span>Openings for Black</button>
      </div>
      <div class="course-list">${list.map(c => `<button class="course-btn" data-course="${c.id}"><span class="pc-ic">${pieceSVG(c.side + (c.side === 'w' ? 'N' : 'B'))}</span><b>${esc(c.name)}</b><small>${esc(c.first)} · ${c.lines.length} lines</small><span class="prog" aria-label="Lines practised">${courseProgress(c)}</span></button>`).join('')}</div>`;
    return;
  }
  const c = LS.course;
  if (!LS.line) {
    el.innerHTML = `<button class="back-link" data-act="courses">← All openings</button>
      <div><h2>${esc(c.name)}</h2><p class="card-sub" style="margin:4px 0 0">${esc(c.first)}</p></div>
      <p class="intro-text">${esc(c.intro)}</p>
      <div><span class="field-label">Practise as</span><div class="seg" role="group" aria-label="Practise as" style="grid-template-columns:1fr 1fr">
        <button class="seg-btn" data-color="w" aria-pressed="${LS.color === 'w'}"><span class="seg-ic">${pieceSVG('wK')}</span>White${c.side === 'w' ? ' · course side' : ''}</button>
        <button class="seg-btn" data-color="b" aria-pressed="${LS.color === 'b'}"><span class="seg-ic">${pieceSVG('bK')}</span>Black${c.side === 'b' ? ' · course side' : ''}</button></div></div>
      <div class="line-list">${c.lines.map((l, i) => `<div class="line-row"><div><span class="ln">${esc(l.name)}</span>${lineStatus(l, LS.color)}</div><div class="line-actions"><button class="btn btn-small" data-learn="${i}">Learn</button><button class="btn btn-small btn-brass" data-practise="${i}">Practise</button></div></div>`).join('')}</div>`;
    return;
  }
  const L = LS.line; const v = S.view; const learn = LS.phase === 'learn';
  const showingWrong = !learn && LS.state === 'wrong' && v === liveIndex();
  const mv = v > 0 ? (learn ? S.line.moves[v - 1] : showingWrong ? S.line.moves[v - 1] : LS.full[v - 1]) : null;
  const comment = mv ? (mv.comment || '') : '';
  let status = '';
  if (!learn) {
    const total = LS.full.length; const you = colorName(LS.color);
    status = {
      await: ['', `Your move. Play the main-line move for ${you}.` + (T.hint === 1 ? ' Hint: the highlighted piece.' : T.hint === 2 ? ' Hint: follow the arrow.' : '')],
      reply: ['good', LS.step > 0 && S.chess.turn() !== LS.color ? 'Correct. Your opponent replies…' : 'Your opponent moves…'],
      wrong: ['bad', 'Not the book move. Try again.'],
      done: ['good', `Line complete${LS.mistakes ? ` with ${LS.mistakes} mistake${LS.mistakes === 1 ? '' : 's'}` : ' without a single mistake'}.`],
    }[LS.state] || ['', ''];
    status = `<p class="status-line ${status[0]}">${esc(status[1])} <span style="font-weight:500;color:var(--ink-soft)">(${Math.min(LS.step, total)}/${total} moves)</span></p>`;
  }
  const atEnd = learn && v === S.line.moves.length;
  const title = mv ? `${moveLabel(v - 1)} ${sanHTML(mv.san)}` : esc(L.name);
  const body = showingWrong ? '<span class="muted">That move isn\u2019t part of this line. It will be taken back.</span>' : mv ? (comment ? esc(comment) : '<span class="muted">A normal developing move in this line.</span>') : learn ? 'Step through the line with Next or the → key. Each move comes with the idea behind it.' : `You play ${colorName(LS.color)}. Your opponent's moves are played for you.`;
  const next = LS.lineIdx + 1 < c.lines.length ? LS.lineIdx + 1 : -1;
  el.innerHTML = `<button class="back-link" data-act="course">← ${esc(c.name)}</button>
    <div><h2>${esc(L.name)}</h2><p class="card-sub" style="margin:4px 0 0">${learn ? 'Learn' : 'Practise'} · you play ${colorName(LS.color)}</p></div>
    <div class="seg" role="group" aria-label="Lesson mode" style="grid-template-columns:1fr 1fr">
      <button class="seg-btn" data-phase="learn" aria-pressed="${learn}">Learn</button>
      <button class="seg-btn" data-phase="practice" aria-pressed="${!learn}">Practise</button>
    </div>
    <div class="annot">${status}<div class="annot-top"><span class="annot-title">${title}</span></div><p class="annot-body">${body}</p></div>
    <div class="actions">${learn
      ? `<button class="btn" data-act="prev" ${v === 0 ? 'disabled' : ''}>← Back</button><button class="btn ${atEnd ? '' : 'btn-brass'}" data-act="next" ${atEnd ? 'disabled' : ''}>Next move →</button>${atEnd ? `<button class="btn btn-brass" data-practise="${LS.lineIdx}">Practise this line</button>` : ''}`
      : LS.state === 'done'
        ? `<button class="btn" data-practise="${LS.lineIdx}">Practise again</button>${next >= 0 ? `<button class="btn btn-brass" data-learn="${next}">Next line →</button>` : `<button class="btn btn-brass" data-act="course">Back to the course</button>`}`
        : `<button class="btn" data-act="hint" ${LS.state !== 'await' || T.hint >= 2 ? 'disabled' : ''}>${T.hint === 0 ? 'Hint' : T.hint === 1 ? 'Show move' : 'Hint shown'}</button><button class="btn" data-practise="${LS.lineIdx}">Restart</button>`}
    </div>`;
}
function wireTrainer() {
  buildThemeSelect();
  $('#btnPuzzles').addEventListener('click', (e) => leaveForTrainer(e.currentTarget, 'Leave this game?', openPuzzles));
  $('#btnOpenings').addEventListener('click', (e) => leaveForTrainer(e.currentTarget, 'Leave this game?', openCourses));
  $('#pzHint').addEventListener('click', puzzleHint);
  $('#pzSolution').addEventListener('click', puzzleSolution);
  $('#pzRetry').addEventListener('click', () => startPuzzle(PZ.p, true));
  $('#pzNext').addEventListener('click', () => { if (PZ.run) nextInRun(); else nextPuzzle(); });
  $('#pzTheme').addEventListener('change', (e) => { PZ.theme = e.target.value; PZ.run = null; nextPuzzle(); });
  $('#pzDaily').addEventListener('click', (e) => { if (e.target.closest('[data-daily]')) startDaily(); });
  $('#rvMist').addEventListener('click', (e) => { if (e.target.closest('[data-mist]') && S.line) practiseMistakes(mistakeGameKey(S.line)); });
  // On the Woodpusher site: the theme list (and so the big puzzle set) from the server
  if (typeof io !== 'undefined') api('/puzzles/themes').then((d) => { PZS.themes = d; buildThemeSelect(); if (S.mode === 'puzzle') renderPuzzlePanel(); }).catch(() => {});
  $('#lessonPanel').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    if (b.dataset.side) { LS.listSide = b.dataset.side; S.orientation = LS.listSide; renderCoords(); drawBoardCanvas(); repositionAll(); renderAll(); return; }
    if (b.dataset.course) { openCourse(b.dataset.course); return; }
    if (b.dataset.color) { LS.color = b.dataset.color; S.orientation = LS.color; renderCoords(); drawBoardCanvas(); repositionAll(); renderAll(); return; }
    if (b.dataset.learn != null) { openLine(+b.dataset.learn, 'learn'); return; }
    if (b.dataset.practise != null) { openLine(+b.dataset.practise, 'practice'); return; }
    if (b.dataset.phase) { if (b.dataset.phase !== LS.phase) openLine(LS.lineIdx, b.dataset.phase); return; }
    const act = b.dataset.act;
    if (act === 'courses') openCourses();
    else if (act === 'course') openCourse(LS.course.id);
    else if (act === 'next') goTo(S.view + 1);
    else if (act === 'prev') goTo(S.view - 1);
    else if (act === 'hint') lessonHint();
  });
}

/* =====================================================================
   Online play: accounts, lobby, matchmaking, live games (needs the Woodpusher server)
   ===================================================================== */
const ONLINE_TCS = TCS.filter(t => t.base > 0);
const ON = {
  me: null, loaded: false, sock: null, connected: false, stats: null, tc: '3+2',
  seeking: null, challenge: null, incoming: null, game: null, games: null, authTab: 'login', authError: '', authMsg: '', busy: false,
  confirmDelete: false, deleteError: '', offlineTick: null, remember: false,
};
async function api(path, opts = {}) {
  const r = await fetch('/api' + path, { method: opts.method || 'GET', headers: opts.body ? { 'Content-Type': 'application/json' } : {}, body: opts.body ? JSON.stringify(opts.body) : undefined, credentials: 'same-origin' });
  let data = {}; try { data = await r.json(); } catch (e) {}
  if (!r.ok) throw new Error(data.error || 'Something went wrong. Try again.');
  return data;
}
function emitOn(ev, d) {
  return new Promise(res => {
    if (!ON.sock || !ON.sock.connected) { res({ error: 'Not connected to the server. Check your connection and try again.' }); return; }
    ON.sock.timeout(8000).emit(ev, d || {}, (err, r) => res(err ? { error: 'The server didn’t answer. Try again.' } : (r || { ok: true })));
  });
}
// Preset messages (server/games.js has the same keys). Which ones are offered depends on the moment.
const SAY_TEXT = { hello: 'Hello!', gl: 'Good luck!', hf: 'Have fun!', nice: 'Nice move!', oops: 'Oops', sorry: 'Sorry!', gg: 'Good game!', wp: 'Well played!', thanks: 'Thanks!' };
const SAY_DURING = ['hello', 'gl', 'hf', 'nice', 'oops', 'sorry'], SAY_AFTER = ['gg', 'wp', 'thanks', 'sorry'];
const chatOn = () => S.settings.chat !== false;
const ratingText = (p) => p ? `${p.rating}${p.provisional ? '?' : ''}` : '';
const myRating = (tcId) => { if (!ON.me) return null; const cat = categoryOfTc(tcId); const r = ON.me.ratings[cat]; return r ? `${r.rating}${r.provisional ? '?' : ''}` : '1500?'; };
function categoryOfTc(id) { const t = tcById(id); const est = t.base + 40 * t.inc; return est < 180 ? 'bullet' : est < 480 ? 'blitz' : est < 1500 ? 'rapid' : 'classical'; }
const onlineActive = () => !!(ON.game && ON.game.status === 'active' && ON.game.you);
// Watching someone else's game (from "Live now" or a game link)
const watching = () => !!(ON.game && !ON.game.you);

function connectSocket() {
  if (ON.sock) { ON.sock.removeAllListeners(); ON.sock.disconnect(); }
  const s = io({ transports: ['websocket', 'polling'] });
  ON.sock = s;
  s.on('connect', () => { ON.connected = true; if (ON.game && ON.game.status === 'active') openGame(ON.game.id, true); else if (ON.seeking) emitOn('seek', { tc: ON.seeking.tc }); renderOnlineIfShown(); });
  s.on('disconnect', () => { ON.connected = false; renderOnlineIfShown(); });
  s.on('lobby:stats', (d) => { ON.stats = d; if (S.mode === 'online' && !ON.game) renderOnlinePanel(); });
  s.on('match', (d) => {
    ON.seeking = null; ON.challenge = null; Snd.bell(659.25, .1);
    if (watching()) emitOn('game:leave', { id: ON.game.id });
    document.querySelectorAll('.modal-back').forEach(m => { m.hidden = true; });
    if (S.mode !== 'online') { const k = parkCurrent(); toast(k === 'bot' ? 'Opponent found! Your bot game is paused. You can resume it after this game.' : 'Opponent found! Your game is starting.'); }
    attention('Opponent found');
    openGame(d.gameId);
  });
  s.on('game:current', (d) => { if (!ON.game || ON.game.id !== d.id) { ON.current = d.id; if (S.mode === 'online' || location.pathname === '/') { if (S.mode !== 'online') parkCurrent(); openOnline(true); openGame(d.id); } } });
  s.on('game:move', onRemoteMove);
  s.on('game:end', onGameEnd);
  s.on('game:offer', (d) => {
    if (!ON.game || d.id !== ON.game.id) return;
    const before = ON.game.drawOffer; ON.game.drawOffer = d.drawOffer;
    if (d.drawOffer && d.drawOffer !== ON.game.you && before !== d.drawOffer) { toast(`${oppName()} offers a draw.`); Snd.bell(880, .06); }
    renderAll();
  });
  s.on('game:rematch', (d) => {
    if (!ON.game || d.id !== ON.game.id) return;
    if (d.newGameId) { openGame(d.newGameId); return; }
    ON.game.rematch = d.rematch;
    if (d.rematch && d.rematch !== ON.game.you) toast(`${oppName()} wants a rematch.`);
    renderAll();
  });
  s.on('game:said', (d) => {
    const g = ON.game; if (!g || d.id !== g.id) return;
    g.said = (g.said || []).concat({ color: d.color, key: d.key, at: d.at }).slice(-30);
    if (chatOn() && d.color !== g.you && SAY_TEXT[d.key]) { const n = S.line ? S.line.names[d.color] : ''; if (g.you) toast(`${n}: ${SAY_TEXT[d.key]}`); }
    renderOnlineIfShown();
  });
  s.on('game:presence', (d) => {
    if (!ON.game || d.id !== ON.game.id) return;
    ON.game.presence = { w: d.white, b: d.black, since: d.offlineSince, at: performance.now() };
    renderOnlineIfShown();
  });
}
function renderOnlineIfShown() { if (S.mode === 'online') renderAll(); }
const oppName = () => { const g = ON.game; if (!g || !S.line) return 'Your opponent'; return S.line.names[g.you === 'w' ? 'b' : 'w']; };

async function loadMe() {
  // A failed request (offline) keeps whoever was logged in; only the server's answer changes it
  let known = false;
  try { const d = await api('/me'); ON.me = d.user; known = true; } catch (e) { ON.me = ON.me || null; }
  ON.loaded = true; renderUserSection();
  if (known && window.WP_SYNC) window.WP_SYNC.onUser(ON.me);
  if (window.WP_PLAYERS) window.WP_PLAYERS.refresh();
}
async function loadMyGames() {
  if (!ON.me) { ON.games = null; return; }
  try { const d = await api('/users/' + encodeURIComponent(ON.me.username)); ON.games = d.games; ON.me.ratings = d.ratings; } catch (e) { ON.games = []; }
  renderUserSection();
  if (S.mode === 'online' && !ON.game) renderOnlinePanel();
}

/* ---------------- entering and leaving ---------------- */
function openOnline(keepGame = false) {
  clearTimers(); T.kind = null;
  if (!keepGame || !ON.game) {
    if (ON.game && (ON.game.status !== 'active' || watching())) { emitOn('game:leave', { id: ON.game.id }); ON.game = null; }
    S.engineToken++; if (ENG.main) ENG.main.cancelAll();
    S.game = null; S.chess = null; S.line = null; S.review = null; S.view = 0; S.bannerOpen = false; S.sel = null; S.legal = []; S.premoves = [];
    S.orientation = 'w';
    setMode('online'); renderCoords(); drawBoardCanvas(); renderPieces(START_FEN, false); renderAll();
    if (location.pathname !== '/' && !location.pathname.startsWith('/c/')) history.replaceState(null, '', '/');
  } else setMode('online');
  loadMyGames();
}
// Leaving the lobby keeps your place in the queue (and a challenge link open): you can play a bot or
// solve puzzles while you wait. cancel: also give those up, for logging out.
function leaveOnline(cancel = false) {
  if (cancel && ON.seeking) { emitOn('seek:cancel'); ON.seeking = null; }
  if (cancel && ON.challenge) { emitOn('challenge:cancel', { code: ON.challenge.code }); ON.challenge = null; }
  if (ON.game && (ON.game.status !== 'active' || watching())) { emitOn('game:leave', { id: ON.game.id }); ON.game = null; }
  if (location.pathname !== '/') history.replaceState(null, '', '/');
}

/* ---------------- waiting for an opponent ---------------- */
// While you wait you can play a bot or solve puzzles and keep your place in the queue. A bar at the
// bottom of the page shows the search. When the opponent is found the online game takes the board;
// a bot game that was still going is paused, and can be resumed after the online game.
const parkedBotGame = () => { const d = S.parked; return d && d.v === 1 && d.line && d.game && d.line.source === 'play' && d.line.result === '*' ? d : null; };
const parkedBotName = (d) => d.line.names[d.game.playerColor === 'w' ? 'b' : 'w'] || 'Stockfish';
function waitHTML() {
  const pk = parkedBotGame();
  return `<div class="wait-do"><span class="field-label">While you wait</span><div class="actions"><button class="btn" data-act="wait-bot">${pk ? 'Resume your bot game' : 'Play a bot'}</button><button class="btn" data-act="wait-puzzles">Solve puzzles</button></div>
    <span class="fine">You keep your place. When ${ON.challenge ? 'your friend joins' : 'an opponent is found'}, the game starts here straight away and a bot game is paused.</span></div>`;
}
// Called when an online game is about to take over the board. Returns 'bot' when a game against a bot was paused.
function parkCurrent() {
  S.engineToken++; if (ENG.main) ENG.main.cancelAll();
  if (S.review) S.review.token++; ENG.pool.forEach(x => x.cancelAll());
  ON.returnTo = S.mode === 'puzzle' || S.mode === 'lesson' ? S.mode : null;
  if (!S.line || !['play', 'paused', 'over', 'review', 'idle'].includes(S.mode)) return null;
  const bot = S.line.source === 'play' && !!S.game && S.line.result === '*' && (S.mode === 'play' || S.mode === 'paused');
  if (!bot && parkedBotGame()) return null;      // keep a paused bot game rather than, say, a review
  S.parked = snapshot();                         // a game in play is saved as paused, its clocks stopped
  return bot ? 'bot' : null;
}
function resumeParked() {
  const d = parkedBotGame(); if (!d) return;
  if (onlineActive()) { toast('Finish or resign your online game first.'); return; }
  S.parked = null; ON.returnTo = null;
  if (ON.game && ON.game.status !== 'active') { emitOn('game:leave', { id: ON.game.id }); ON.game = null; }
  if (location.pathname !== '/') history.replaceState(null, '', '/');
  if (!restore(d)) { toast('That game could not be restored.'); abandonGame(); return; }
  drawBoardCanvas();
  if (S.mode === 'paused') resumeGame();
  renderQueueBar();
}
function backToTrainer() {
  const t = ON.returnTo; ON.returnTo = null;
  if (ON.game && ON.game.status !== 'active') { emitOn('game:leave', { id: ON.game.id }); ON.game = null; }
  if (location.pathname !== '/') history.replaceState(null, '', '/');
  if (t === 'lesson') openCourses(); else openPuzzles();
}
// A tab in the background: say so in its title until someone looks
let titleBase = null;
function attention(text) { if (!document.hidden) return; if (titleBase == null) titleBase = document.title; document.title = '♞ ' + text; }
document.addEventListener('visibilitychange', () => { if (!document.hidden && titleBase != null) { document.title = titleBase; titleBase = null; } });
// Every mode change (app.html's setMode): leaving the online page stops watching a game
function onModeChange() {
  if (S.mode !== 'online' && watching()) { emitOn('game:leave', { id: ON.game.id }); ON.game = null; }
  renderQueueBar();
}
function renderQueueBar() {
  const el = $('#queueBar'); if (!el) return;
  const show = !!(ON.me && (ON.seeking || ON.challenge) && (S.mode !== 'online' || watching()));
  document.body.classList.toggle('has-qbar', show);
  if (!show) { el.hidden = true; ON.qbarHtml = ''; return; }
  // On a phone the start of the sentence drops, so the clock and the timer stay visible
  const text = ON.seeking ? `<span class="q-long">Looking for a </span>${esc(ON.seeking.tc)} opponent · ${mmss(performance.now() - ON.seeking.since)}` : `<span class="q-long">Waiting for your </span>friend · ${esc(ON.challenge.tc)}`;
  const html = `<span class="spinner" aria-hidden="true"></span><span class="qbar-text">${text}</span><button class="btn btn-small" data-q="lobby">Lobby</button><button class="btn btn-small" data-q="cancel">Cancel</button>`;
  if (html !== ON.qbarHtml) { el.innerHTML = html; ON.qbarHtml = html; }
  el.hidden = false;
}

/* ---------------- games ---------------- */
async function openGame(id, quiet = false) {
  const r = await emitOn('game:join', { id });
  if (r.error) { if (!quiet) toast(r.error); return; }
  loadGameState(r.game);
}
function loadGameState(st) {
  clearTimers(); T.kind = null;
  const you = st.you;
  ON.game = { id: st.id, you, status: st.status, result: st.result, reason: st.reason, drawOffer: st.drawOffer, rematch: st.rematch, rated: st.rated, tc: st.tc, diff: st.diff, said: st.said || [],
    white: st.white, black: st.black, presence: { w: st.white.online !== false, b: st.black.online !== false, since: {}, at: performance.now() },
    firstMoveDeadline: st.firstMoveDeadline != null ? performance.now() + st.firstMoveDeadline : null };
  const c = new Chess(); const L = newLine(START_FEN, { w: st.white.name, b: st.black.name }, { w: ratingText(st.white), b: ratingText(st.black) }, { source: 'online', result: st.result || '*', reason: st.reason || '' });
  for (const u of st.moves) { const m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || undefined }); if (!m) break; m.uci = u; L.moves.push(m); L.fens.push(c.fen()); }
  S.chess = c; S.line = L; S.review = null; S.sel = null; S.legal = []; S.premoves = [];
  S.game = { playerColor: you || 'w', you, level: null, tc: st.tc, online: true,
    clock: { w: st.clocks.w, b: st.clocks.b, running: st.status === 'active' && st.clockRunning ? st.turn : null, last: performance.now() } };
  S.orientation = you || 'w'; S.view = liveIndex(); S.bannerOpen = st.status !== 'active' && !!st.result;
  setMode('online'); renderCoords(); drawBoardCanvas(); renderPieces(L.fens[S.view], false); renderAll();
  if (location.pathname !== '/game/' + st.id) history.replaceState(null, '', '/game/' + st.id);
  if (!ON.offlineTick) ON.offlineTick = setInterval(() => { if (S.mode === 'online' && ON.game && ON.game.status === 'active') renderOnlinePanel(); }, 1000);
}
function onRemoteMove(d) {
  const g = ON.game; if (!g || d.id !== g.id) return;
  const L = S.line;
  if (d.ply < L.moves.length) { /* our own move echoed back */ }
  else if (d.ply === L.moves.length) {
    const m = S.chess.move({ from: d.uci.slice(0, 2), to: d.uci.slice(2, 4), promotion: d.uci[4] || undefined });
    if (!m) { openGame(g.id, true); return; }
    m.uci = d.uci; L.moves.push(m); L.fens.push(S.chess.fen());
    const atLive = S.view === L.fens.length - 2; if (atLive) S.view = liveIndex();
    if (S.chess.in_check()) Snd.check(); else if (m.captured) Snd.capture(); else Snd.move();
    if (atLive) renderPieces(L.fens[S.view]);
    refreshSelection();
  } else { openGame(g.id, true); return; }
  S.game.clock.w = d.clocks.w; S.game.clock.b = d.clocks.b; S.game.clock.running = d.clockRunning ? d.turn : null; S.game.clock.last = performance.now();
  g.drawOffer = d.drawOffer; if (L.moves.length >= 2) g.firstMoveDeadline = null; else if (L.moves.length === 1) g.firstMoveDeadline = performance.now() + 30000;
  renderAll();
  runPremove();   // our turn again: a queued premove goes out straight away
}
async function onlineMove(mv) {
  const g = ON.game; if (!g) return;
  mv.uci = mv.from + mv.to + (mv.promotion || '');
  const ply = S.line.moves.length;
  S.line.fens.push(S.chess.fen()); S.line.moves.push(mv); S.view = liveIndex(); S.sel = null; S.legal = [];
  if (S.chess.in_check()) Snd.check(); else if (mv.captured) Snd.capture(); else Snd.move();
  if (tcById(g.tc).base) Snd.press();
  // stop our clock locally right away; the server's reply sets the exact times
  if (S.game.clock.running) { S.game.clock[g.you] = Math.max(0, remaining(g.you)); S.game.clock.running = null; }
  renderPieces(S.line.fens[S.view]); renderAll();
  const r = await emitOn('game:move', { id: g.id, uci: mv.uci, ply });
  if (r.error) { toast(r.error); openGame(g.id, true); }
}
function onGameEnd(d) {
  const g = ON.game; if (!g || d.id !== g.id) return;
  g.status = d.status; g.result = d.result; g.reason = d.reason; g.diff = d.diff; g.drawOffer = null; g.firstMoveDeadline = null;
  S.line.result = d.result || '*'; S.line.reason = d.reason;
  S.game.clock.w = d.clocks.w; S.game.clock.b = d.clocks.b; S.game.clock.running = null;
  dropPremoves(); S.bannerOpen = true; S.sel = null; S.legal = []; closePromo();
  Snd.end(); renderAll(); announce(resultSentence());
  loadMe().then(loadMyGames);
}

/* ---------------- lobby actions ---------------- */
async function findOpponent() {
  if (!ON.me) return;
  ON.busy = true; renderOnlinePanel();
  const r = await emitOn('seek', { tc: ON.tc });
  ON.busy = false;
  if (r.error) { toast(r.error); if (r.gameId) openGame(r.gameId); renderOnlinePanel(); return; }
  ON.seeking = { tc: ON.tc, since: performance.now() }; renderAll(); renderQueueBar();
  announce(`Looking for a ${ON.tc} opponent.`);
}
async function cancelSeek() { await emitOn('seek:cancel'); ON.seeking = null; renderAll(); renderQueueBar(); }
async function createChallenge(color) {
  const r = await emitOn('challenge:create', { tc: ON.tc, color });
  if (r.error) { toast(r.error); return; }
  if (ON.seeking) { emitOn('seek:cancel'); ON.seeking = null; }
  ON.challenge = { code: r.code, tc: ON.tc, url: `${location.origin}/c/${r.code}` }; renderOnlinePanel();
}
async function cancelChallenge() { if (ON.challenge) await emitOn('challenge:cancel', { code: ON.challenge.code }); ON.challenge = null; renderOnlinePanel(); renderQueueBar(); }
async function loadIncoming(code) {
  const r = await emitOn('challenge:info', { code });
  ON.incoming = r.error ? { code, error: r.error } : { code, from: r.from, tc: r.tc, color: r.color };
  renderOnlinePanel();
}
async function acceptIncoming() {
  const r = await emitOn('challenge:accept', { code: ON.incoming.code });
  if (r.error) { ON.incoming.error = r.error; renderOnlinePanel(); return; }
  ON.incoming = null; openGame(r.gameId);
}
// persp: whose side to show the board from when you didn't play in the game (a profile's owner)
async function reviewOnlineGame(id, persp) {
  try {
    const d = await api('/games/' + encodeURIComponent(id));
    const c = new Chess(); const L = newLine(START_FEN, { w: d.white.name, b: d.black.name }, { w: d.white.rating ? String(d.white.rating) : 'White', b: d.black.rating ? String(d.black.rating) : 'Black' }, { source: 'online', result: d.result || '*', reason: d.reason || '' });
    for (const u of d.moves) { const m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || undefined }); if (!m) break; m.uci = u; L.moves.push(m); L.fens.push(c.fen()); }
    if (L.moves.length < 1) { toast('That game has no moves to review.'); return; }
    const you = ON.me && d.white.name === ON.me.username ? 'w' : ON.me && d.black.name === ON.me.username ? 'b' : null;
    S.chess = c; S.line = L; S.game = { playerColor: you || 'w', you, tc: d.tc, online: true, clock: { w: 0, b: 0, running: null, last: 0 } };
    S.orientation = you || (persp && d.black.name.toLowerCase() === String(persp).toLowerCase() ? 'b' : 'w'); S.review = null;
    renderCoords(); drawBoardCanvas();
    startReview();
  } catch (e) { toast(e.message); }
}

/* ---------------- account ---------------- */
async function submitAuth(form) {
  const username = form.querySelector('[name=username]').value.trim(); const password = form.querySelector('[name=password]').value;
  const remember = form.querySelector('[name=remember]').checked; ON.remember = remember;
  ON.authError = ''; ON.busy = true; renderOnlinePanel();
  try {
    const d = await api(ON.authTab === 'login' ? '/login' : '/register', { method: 'POST', body: { username, password, remember } });
    ON.me = d.user; ON.authMsg = '';
    if (window.WP_SYNC) window.WP_SYNC.onUser(ON.me);
    connectSocket(); loadMyGames();
    if (ON.incoming) loadIncoming(ON.incoming.code);
  } catch (e) { ON.authError = e.message; }
  ON.busy = false; renderOnlinePanel();
}
async function logout() {
  if (onlineActive()) { toast('Finish or resign your game first.'); return; }
  leaveOnline(true);
  if (window.WP_SYNC) await window.WP_SYNC.flush();    // send progress not saved yet; this browser then forgets it
  try { await api('/logout', { method: 'POST', body: {} }); } catch (e) {}
  ON.me = null; ON.games = null; ON.game = null; if (window.WP_SYNC) window.WP_SYNC.onUser(null);
  connectSocket(); openOnline();
}
async function deleteAccount(password) {
  try { await api('/me', { method: 'DELETE', body: { password } }); leaveOnline(true); ON.me = null; if (window.WP_SYNC) window.WP_SYNC.onUser(null); ON.games = null; ON.confirmDelete = false; ON.deleteError = ''; connectSocket(); toast('Your account has been deleted.'); openOnline(); }
  catch (e) { ON.deleteError = e.message; renderOnlinePanel(); }
}

/* ---------------- rendering ---------------- */
// How many other players are waiting at each clock right now (the server's count includes your own seek)
function othersWaiting(tc) { const n = (ON.stats && ON.stats.seeking && ON.stats.seeking[tc]) || 0; return Math.max(0, n - (ON.seeking && ON.seeking.tc === tc ? 1 : 0)); }
function tcGridHTML() {
  return `<div class="tc-grid" role="group" aria-label="Time control">${ONLINE_TCS.map(t => { const n = othersWaiting(t.id);
    return `<button class="tc-btn" data-tc="${t.id}" aria-pressed="${t.id === ON.tc}"><b>${t.id}</b><small>${t.kind}</small>${n ? `<i class="tc-wait">${n} waiting</i>` : ''}</button>`; }).join('')}</div>`;
}
function statsLine() {
  const s = ON.stats; if (!s) return '';
  const seekingAll = Object.values(s.seeking || {}).reduce((a, b) => a + b, 0); const here = (s.seeking || {})[ON.tc] || 0;
  return `<p class="stat-line">${s.online} online · ${s.games} game${s.games === 1 ? '' : 's'} in progress · ${seekingAll} looking for a game${here ? ` (${here} at ${ON.tc})` : ''}</p>`;
}
const mmss = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
// The panel is redrawn often: lobby stats arrive every 3 seconds, the seek timer ticks every second.
// A redraw must never cost someone what they are typing, so identical HTML leaves the page alone,
// and a real change carries typed text, focus and cursor position over to the new fields.
const panelKey = (n) => n.id ? '#' + CSS.escape(n.id) : n.name ? `[name="${n.name}"]` : n.dataset && n.dataset.act ? `[data-act="${n.dataset.act}"]` : n.dataset && n.dataset.tc ? `[data-tc="${n.dataset.tc}"]` : n.dataset && n.dataset.auth ? `[data-auth="${n.dataset.auth}"]` : null;
function renderOnlinePanel() {
  const el = $('#onlinePanel'); if (!el || S.mode !== 'online') return;
  const html = !ON.loaded ? '<p class="fine"><span class="spinner"></span>Connecting…</p>' : ON.game ? gameHTML() : !ON.me ? authHTML() : lobbyHTML();
  if (html === ON.panelHtml && el.firstChild) return;
  const typed = [...el.querySelectorAll('input:not([readonly]):not([type=hidden]), textarea')].map(n => [panelKey(n), n.value]).filter(([k, v]) => k && v);
  const a = document.activeElement; const focusKey = a && a !== el && el.contains(a) ? panelKey(a) : null;
  let sel = null; try { if (focusKey && typeof a.selectionStart === 'number') sel = [a.selectionStart, a.selectionEnd]; } catch (e) {}
  el.innerHTML = html; ON.panelHtml = html;
  for (const [k, v] of typed) { const n = el.querySelector(k); if (n && !n.readOnly && !n.value) n.value = v; }
  if (focusKey) { const n = el.querySelector(focusKey); if (n) { n.focus({ preventScroll: true }); if (sel) { try { n.setSelectionRange(sel[0], sel[1]); } catch (e) {} } } }
}
// "Live now": rated games in progress, strongest first (from the lobby stats). Anyone can watch, also without an account.
function liveHTML() {
  const live = (ON.stats && ON.stats.live) || []; if (!live.length) return '';
  return `<div><span class="field-label">Live now</span><div class="game-list">${live.map(g => `<button class="game-row live-row" data-watch="${esc(g.id)}" aria-label="Watch ${esc(g.white.name)} against ${esc(g.black.name)}, ${esc(g.tc)}, move ${Math.max(1, Math.ceil(g.ply / 2))}"><span class="live-dot" aria-hidden="true"></span><span aria-hidden="true"><span>${esc(g.white.name)} <span class="meta">(${g.white.rating})</span> vs ${esc(g.black.name)} <span class="meta">(${g.black.rating})</span></span><br><span class="meta">${esc(g.tc)} · move ${Math.max(1, Math.ceil(g.ply / 2))}${g.watchers ? ` · ${g.watchers} watching` : ''}</span></span><span class="imp-go" aria-hidden="true">Watch</span></button>`).join('')}</div></div>`;
}
async function watchGame(id) {
  if (onlineActive()) return;
  if (ON.game && ON.game.id !== id) { emitOn('game:leave', { id: ON.game.id }); ON.game = null; }
  await openGame(id);
}
function authHTML() {
  const reg = ON.authTab === 'register';
  const inv = ON.incoming && !ON.incoming.error ? `<div class="offer"><b>${esc(ON.incoming.from)} challenges you to a ${esc(ON.incoming.tc)} game.</b><span class="fine">Log in or create an account to accept.</span></div>` : '';
  return `<div><h2>Play online</h2><p class="card-sub" style="margin:4px 0 0">Get paired with someone at your level, or send a friend a link.</p></div>${inv}
    <div class="seg" role="group" aria-label="Account" style="grid-template-columns:1fr 1fr">
      <button class="seg-btn" data-auth="login" aria-pressed="${!reg}">Log in</button>
      <button class="seg-btn" data-auth="register" aria-pressed="${reg}">Create account</button>
    </div>
    <form class="form" id="authForm" novalidate>
      <label>Username<input class="input" name="username" id="authUser" autocomplete="username" maxlength="20" required></label>
      <label>Password<input class="input" name="password" id="authPass" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}" minlength="${reg ? 8 : 1}" required></label>
      <div><label class="check"><input type="checkbox" name="remember" id="authRemember" ${ON.remember ? 'checked' : ''}> Remember me</label><p class="fine" style="margin:4px 0 0 28px">Stay logged in on this device, also after closing the browser. Leave it off on a shared computer.</p></div>
      ${ON.authError ? `<p class="err" role="alert">${esc(ON.authError)}</p>` : ''}
      <button class="btn btn-brass" type="submit" ${ON.busy ? 'disabled' : ''}>${reg ? 'Create account' : 'Log in'}</button>
    </form>
    <p class="fine">${reg ? 'Usernames are public. Woodpusher stores only your username, a hashed password, your ratings and your games. No email address needed. ' : ''}<a href="/privacy.html" target="_blank" rel="noopener">Privacy statement</a></p>${liveHTML()}`;
}
function lobbyHTML() {
  const me = ON.me; const r = me.ratings || {};
  const box = (k, label) => { const x = r[k] || { rating: 1500, provisional: true }; return `<div class="rbox"><small>${label}</small><b>${x.rating}${x.provisional ? '?' : ''}</b></div>`; };
  let action;
  if (ON.incoming) {
    action = ON.incoming.error ? `<div class="offer"><span>${esc(ON.incoming.error)}</span><button class="btn btn-small" data-act="dismiss-incoming">OK</button></div>`
      : `<div class="offer"><b>${esc(ON.incoming.from)} challenges you to a ${esc(ON.incoming.tc)} game${ON.incoming.color === 'r' ? '' : `, and plays ${ON.incoming.color === 'w' ? 'White' : 'Black'}`}.</b><span class="fine">Friend games don't change your rating.</span><div class="actions"><button class="btn btn-brass" data-act="accept-incoming">Accept</button><button class="btn" data-act="dismiss-incoming">Decline</button></div></div>`;
  } else if (ON.seeking) {
    const tc = ON.seeking.tc; const waited = performance.now() - ON.seeking.since; const range = Math.min(800, 100 + Math.floor(waited / 5000) * 50);
    const others = ONLINE_TCS.filter(t => t.id !== tc && othersWaiting(t.id) > 0);
    const alone = othersWaiting(tc) === 0;
    let hint = '';
    if (alone && waited > 15000 && others.length) hint = `<div class="wait-alt"><span class="fine">Nobody else is looking for a ${esc(tc)} game right now. Players are waiting at:</span><div class="actions">${others.map(t => `<button class="btn btn-small" data-switch="${t.id}">${t.id} · ${othersWaiting(t.id)} waiting</button>`).join('')}</div></div>`;
    else if (alone && waited > 30000) hint = '<span class="fine">Nobody else is looking for a game right now. At quiet times it can take a while.</span>';
    action = `<div class="seek-box"><b><span class="spinner"></span>Looking for an opponent</b><span class="fine">${esc(tc)} · rated · waiting ${mmss(waited)} · rating range ±${range}</span>
      ${hint}${waitHTML()}<div class="actions"><button class="btn" data-act="cancel-seek">Cancel</button></div></div>`;
  } else if (ON.challenge) {
    action = `<div class="seek-box"><b>Challenge link ready</b><span class="fine">Send this link to a friend. The game starts as soon as they open it. Friend games are not rated.</span>
      <div class="link-row"><input class="input" id="chalUrl" readonly value="${esc(ON.challenge.url)}"><button class="btn" data-act="copy-link">Copy</button></div>
      <span class="fine"><span class="spinner"></span>Waiting for your friend · ${esc(ON.challenge.tc)}</span>${waitHTML()}<div class="actions"><button class="btn" data-act="cancel-challenge">Cancel</button></div></div>`;
  } else if (me.closed) {
    action = `<div class="offer"><b>Your account is closed${me.closed === 'fairplay' ? ' for breaking the fair-play rules' : ''}.</b><span class="fine">You can still play Stockfish, solve puzzles and review games, but not play online. If you think this is a mistake, email <a href="mailto:contact@woodpusher.org">contact@woodpusher.org</a>.</span></div>`;
  } else {
    action = `<div class="actions"><button class="btn btn-brass" data-act="seek" ${ON.busy || !ON.connected ? 'disabled' : ''}>Find an opponent</button><button class="btn" data-act="challenge" ${!ON.connected ? 'disabled' : ''}>Challenge a friend</button></div>`;
  }
  const games = ON.games ? (ON.games.length ? `<div class="game-list">${ON.games.slice(0, 10).map(gm => {
    const res = gm.result === '1/2-1/2' ? 'draw' : (gm.result === '1-0') === (gm.color === 'w') ? 'win' : 'loss';
    return `<button class="game-row" data-review="${esc(gm.id)}"><span class="res ${res}">${res === 'win' ? 'W' : res === 'loss' ? 'L' : '½'}</span><span><span>vs ${esc(gm.opponent)}</span><br><span class="meta">${esc(gm.tc)} · ${gm.rated ? 'rated' : 'friend game'} · ${esc(gm.reason || '')}</span></span><span class="d ${gm.diff > 0 ? 'up' : gm.diff < 0 ? 'down' : ''}">${gm.diff != null ? (gm.diff > 0 ? '+' : gm.diff < 0 ? MINUS : '±') + Math.abs(gm.diff) : ''}</span></button>`;
  }).join('')}</div>` : '<p class="fine">Your finished games will appear here. Click one to review it.</p>') : '';
  const del = ON.confirmDelete ? `<form class="form" id="delForm"><label>Confirm with your password<input class="input" name="password" type="password" autocomplete="current-password" required></label>${ON.deleteError ? `<p class="err">${esc(ON.deleteError)}</p>` : ''}<div class="actions"><button class="btn armed" type="submit">Delete my account for good</button><button class="btn" type="button" data-act="cancel-delete">Keep my account</button></div></form>` : '';
  const pk = parkedBotGame();
  const paused = pk && !ON.seeking && !ON.challenge ? `<div class="offer"><b>Your game against ${esc(parkedBotName(pk))} is paused.</b><span class="fine">The clocks are stopped where you left off.</span><div class="actions"><button class="btn" data-act="resume-bot">Resume it</button></div></div>` : '';
  return `<div class="who-row"><h2>Play online</h2><button class="user-chip pl-link" data-open-player="${esc(me.username)}" title="Your profile">${esc(me.username)}</button></div>
    <div class="ratings-row">${box('bullet', 'Bullet')}${box('blitz', 'Blitz')}${box('rapid', 'Rapid')}${box('classical', 'Classical')}</div>
    ${!ON.connected ? '<p class="err">Not connected to the server. Reconnecting…</p>' : ''}${paused}
    <div><span class="field-label">Clock · your rating ${esc(myRating(ON.tc) || '')}</span>${tcGridHTML()}</div>
    ${action}${statsLine()}${liveHTML()}
    <div><div class="field-row"><span class="field-label">Your recent games</span>${ON.games && ON.games.length ? `<button class="back-link" data-open-player="${esc(me.username)}">All games and rating graph →</button>` : ''}</div>${games}</div>
    ${me.admin && me.openReports ? `<button class="offer ad-banner" data-open-admin><b>${me.openReports} open report${me.openReports === 1 ? '' : 's'}</b><span class="fine">Look at them under Reports and fair play.</span></button>` : ''}
    <div class="account-row"><button class="back-link" data-open-player="${esc(me.username)}">Your profile</button><button class="back-link" data-open-board>Leaderboard</button>${me.admin ? '<button class="back-link" data-open-admin>Reports and fair play</button>' : ''}<button class="back-link" data-act="logout">Log out</button><button class="danger-link" data-act="delete">Delete account</button></div>${del}`;
}
function gameHTML() {
  const g = ON.game; const L = S.line; const you = g.you; const active = g.status === 'active';
  const oppC = you === 'w' ? 'b' : 'w';
  let body = '';
  if (!you) body += `<p class="fine">You are watching this game.</p>${active ? '<button class="back-link" data-act="lobby">← Back to the lobby</button>' : ''}`;
  if (active && you) {
    const myTurn = S.chess.turn() === you;
    if (g.firstMoveDeadline && L.moves.length < 2) { const left = g.firstMoveDeadline - performance.now(); if (left > 0) body += `<p class="fine">${myTurn ? `Make your first move within ${Math.ceil(left / 1000)} s, or the game is aborted.` : `Waiting for ${esc(oppName())} to make the first move.`}</p>`; }
    if (g.drawOffer && g.drawOffer !== you) body += `<div class="offer"><b>${esc(oppName())} offers a draw.</b><div class="actions"><button class="btn btn-brass" data-act="draw-accept">Accept draw</button><button class="btn" data-act="draw-decline">Decline</button></div></div>`;
    else if (g.drawOffer === you) body += `<p class="fine">Draw offered. Waiting for ${esc(oppName())}.</p>`;
    const pres = g.presence; const oppOnline = pres ? pres[oppC] : true;
    if (!oppOnline) {
      const since = pres.since && pres.since[oppC] ? pres.since[oppC] : null;
      const gone = since ? Date.now() - since : 0;
      body += `<div class="offer"><b>${esc(oppName())} left the game.</b>${gone >= 30000 ? '<div class="actions"><button class="btn btn-brass" data-act="claim">Claim the win</button></div>' : `<span class="fine">If they don't come back within ${Math.max(1, Math.ceil((30000 - gone) / 1000))} s, you can claim the win.</span>`}</div>`;
    }
    const canAbort = L.moves.length < 2;
    body += `<div class="actions">${canAbort ? '<button class="btn" data-act="abort">Abort</button>' : `<button class="btn" data-act="draw-offer" ${g.drawOffer === you ? 'disabled' : ''}>Offer draw</button><button class="btn" data-act="resign">Resign</button>`}</div>`;
  } else if (!active) {
    const diff = g.diff && you ? g.diff[you] : null;
    body += `<p class="annot-body" style="color:var(--ivory)">${esc(resultSentence())}${diff != null ? ` Rating ${diff >= 0 ? '+' : MINUS}${Math.abs(diff)}.` : ''}</p>`;
    if (you) {
      if (g.rematch && g.rematch !== you) body += `<div class="offer"><b>${esc(oppName())} wants a rematch.</b><div class="actions"><button class="btn btn-brass" data-act="rematch">Accept rematch</button><button class="btn" data-act="rematch-decline">Decline</button></div></div>`;
      body += `<div class="actions">${!(g.rematch && g.rematch !== you) ? `<button class="btn" data-act="rematch" ${g.rematch === you ? 'disabled' : ''}>${g.rematch === you ? 'Rematch offered' : 'Rematch'}</button>` : ''}<button class="btn btn-brass" data-act="new-opponent">New opponent</button>${L.moves.length ? '<button class="btn" data-act="review-current">Review game</button>' : ''}</div>`;
      const pk = parkedBotGame();
      if (pk || ON.returnTo) body += `<div class="actions">${pk ? `<button class="btn" data-act="resume-bot">Resume your game against ${esc(parkedBotName(pk))}</button>` : `<button class="btn" data-act="back-trainer">Back to ${ON.returnTo === 'lesson' ? 'the openings' : 'puzzles'}</button>`}</div>`;
    }
    body += `<div class="account-row"><button class="back-link" data-act="lobby">← Back to the lobby</button>${you && g.status === 'finished' ? `<button class="danger-link" data-open-report="${esc(oppName())}" data-game="${esc(g.id)}">Report ${esc(oppName())}</button>` : ''}</div>`;
  }
  body += chatHTML();
  const pname = (n) => `<button class="pl-link" data-open-player="${esc(n)}">${esc(n)}</button>`;
  const head = `${pname(L.names.w)} vs ${pname(L.names.b)}`;
  return `<div><h2>${active ? 'Live game' : 'Game over'}</h2><p class="card-sub" style="margin:4px 0 0">${head} · ${esc(g.tc)} · ${g.rated ? 'rated' : 'friend game'}</p></div>${body}`;
}
// The last few messages, and the ones you can send now. Off in Settings: nothing is shown.
function chatHTML() {
  const g = ON.game; if (!g || !chatOn() || !S.line) return '';
  const said = (g.said || []).slice(-5);
  const log = said.length ? `<ul class="say-log" aria-label="Messages">${said.map(m => `<li class="${m.color === g.you ? 'me' : ''}"><b>${m.color === g.you ? 'You' : esc(S.line.names[m.color])}:</b> ${esc(SAY_TEXT[m.key] || '')}</li>`).join('')}</ul>` : '';
  if (!g.you) return log ? `<div class="say-box">${log}</div>` : '';
  if (g.status === 'aborted') return log ? `<div class="say-box">${log}</div>` : '';
  const keys = g.status === 'active' ? SAY_DURING : SAY_AFTER;
  return `<div class="say-box">${log}<div class="say-row" role="group" aria-label="Send a message">${keys.map(k => `<button class="say-chip" data-say="${k}">${SAY_TEXT[k]}</button>`).join('')}</div></div>`;
}
function onlineBanner() {
  const el = $('#banner'); const g = ON.game; const L = S.line;
  if (!(g && g.status !== 'active' && S.bannerOpen && L)) { el.hidden = true; return; }
  const w = L.result === '1-0' ? 'w' : L.result === '0-1' ? 'b' : null;
  const title = g.status === 'aborted' ? 'Aborted' : !w ? 'Drawn' : g.you ? (w === g.you ? 'You win' : `${L.names[w]} wins`) : `${L.names[w]} wins`;
  const kicker = { checkmate: 'Checkmate', stalemate: 'Stalemate', 'on time': 'Flag fall', resignation: 'Resigned', agreement: 'Draw agreed', abandonment: 'Opponent left', aborted: 'No result' }[L.reason] || 'Game over';
  const diff = g.diff && g.you ? g.diff[g.you] : null;
  el.innerHTML = `<div class="banner-card" role="dialog" aria-label="Game result"><button class="banner-close" id="bannerClose" aria-label="Close">×</button>
    <div class="banner-kicker">${kicker}</div><div class="banner-title">${esc(title)}</div><p class="banner-sub">${esc(resultSentence())}${diff != null ? `<br>Rating ${diff >= 0 ? '+' : MINUS}${Math.abs(diff)}` : ''}</p>
    <div class="banner-actions">${g.you ? '<button class="btn btn-brass" id="bnNewOpp">New opponent</button><button class="btn" id="bnRematchOn">Rematch</button>' : ''}${L.moves.length ? '<button class="btn" id="bnReviewOn">Review</button>' : ''}</div></div>`;
  el.hidden = false;
  $('#bannerClose').onclick = () => { S.bannerOpen = false; onlineBanner(); };
  const nb = $('#bnNewOpp'); if (nb) nb.onclick = () => { S.bannerOpen = false; newOpponent(); };
  const rb = $('#bnRematchOn'); if (rb) rb.onclick = () => { S.bannerOpen = false; onlineBanner(); emitOn('game:rematch', { id: g.id, action: 'offer' }).then(r => { if (r.error) toast(r.error); }); };
  const vb = $('#bnReviewOn'); if (vb) vb.onclick = () => startReview();
}
function newOpponent() { const tc = ON.game ? ON.game.tc : ON.tc; ON.tc = tc; openOnline(); findOpponent(); }
function onlineNote() {
  const g = ON.game; if (!g) return ON.seeking ? 'Looking for an opponent…' : '';
  if (g.status !== 'active') return '';
  if (S.view !== liveIndex()) return 'Looking back. Press → or End to return to the game.';
  if (!g.you) return `${S.chess.turn() === 'w' ? S.line.names.w : S.line.names.b} to move.`;
  return S.chess.turn() === g.you ? 'Your move.' : `Waiting for ${oppName()}…`;
}

/* ---------------- wiring ---------------- */
function wireOnline() {
  $('#btnOnline').hidden = false;
  $('#btnOnline').addEventListener('click', (e) => {
    if (S.mode === 'online' && onlineActive()) return;
    // A bot game is paused (resume it from the lobby) when you are in the queue, or when it already was paused
    if ((S.mode === 'play' && (ON.seeking || ON.challenge)) || S.mode === 'paused') { parkCurrent(); trainerStop(); openOnline(); return; }
    if (S.mode === 'play' && S.line && S.line.moves.length) { armOrRun(e.currentTarget, 'Leave this game?', () => { abandonGame(); openOnline(); }); return; }
    if (S.mode === 'review' && S.review) { S.review.token++; ENG.pool.forEach(x => x.cancelAll()); }
    trainerStop(); openOnline();
  });
  // Don't let other tabs pull you out of a live online game
  document.querySelector('.top-actions').addEventListener('click', (e) => {
    const b = e.target.closest('.tab'); if (!b || b.id === 'btnOnline' || !onlineActive() || S.mode !== 'online') return;
    e.stopImmediatePropagation(); e.preventDefault(); toast('Your online game is still running. Finish or resign it first.');
  }, true);
  const panel = $('#onlinePanel');
  panel.addEventListener('submit', (e) => {
    e.preventDefault();
    if (e.target.id === 'authForm') submitAuth(e.target);
    if (e.target.id === 'delForm') deleteAccount(e.target.querySelector('[name=password]').value);
  });
  // Keep the tick when the panel redraws (an error message, switching between log in and create account)
  panel.addEventListener('change', (e) => { if (e.target.id === 'authRemember') ON.remember = e.target.checked; });
  panel.addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    if (b.dataset.auth) { ON.authTab = b.dataset.auth; ON.authError = ''; renderOnlinePanel(); return; }
    if (b.dataset.tc) { ON.tc = b.dataset.tc; renderAll(); return; }
    if (b.dataset.review) { reviewOnlineGame(b.dataset.review); return; }
    if (b.dataset.switch) { ON.tc = b.dataset.switch; findOpponent(); return; }
    if (b.dataset.watch) { watchGame(b.dataset.watch); return; }
    if (b.dataset.say) { if (ON.game) { const r = await emitOn('game:say', { id: ON.game.id, key: b.dataset.say }); if (r.error) toast(r.error); } return; }
    const g = ON.game; const act = b.dataset.act;
    const send = async (ev, d) => { const r = await emitOn(ev, d); if (r.error) toast(r.error); return r; };
    switch (act) {
      case 'seek': findOpponent(); break;
      case 'cancel-seek': cancelSeek(); break;
      case 'challenge': createChallenge('r'); break;
      case 'cancel-challenge': cancelChallenge(); break;
      case 'copy-link': { const inp = $('#chalUrl'); try { await navigator.clipboard.writeText(inp.value); toast('Link copied.'); } catch (err) { inp.select(); } break; }
      case 'accept-incoming': acceptIncoming(); break;
      case 'dismiss-incoming': ON.incoming = null; history.replaceState(null, '', '/'); renderOnlinePanel(); break;
      case 'wait-bot': if (parkedBotGame()) resumeParked(); else { abandonGame(); toast('Pick a bot and press Play. You stay in the queue.'); } break;
      case 'wait-puzzles': trainerStop(); openPuzzles(); break;
      case 'resume-bot': resumeParked(); break;
      case 'back-trainer': backToTrainer(); break;
      case 'logout': logout(); break;
      case 'delete': ON.confirmDelete = true; ON.deleteError = ''; renderOnlinePanel(); break;
      case 'cancel-delete': ON.confirmDelete = false; renderOnlinePanel(); break;
      case 'abort': send('game:abort', { id: g.id }); break;
      case 'resign': armOrRun(b, 'Confirm resign', () => send('game:resign', { id: g.id })); break;
      case 'draw-offer': await send('game:draw', { id: g.id, action: 'offer' }); g.drawOffer = g.drawOffer || g.you; renderAll(); break;
      case 'draw-accept': send('game:draw', { id: g.id, action: 'accept' }); break;
      case 'draw-decline': await send('game:draw', { id: g.id, action: 'decline' }); g.drawOffer = null; renderAll(); break;
      case 'claim': send('game:claim', { id: g.id }); break;
      case 'rematch': { const r = await send('game:rematch', { id: g.id, action: 'offer' }); if (!r.error && !r.gameId) { g.rematch = g.you; renderAll(); } break; }
      case 'rematch-decline': await send('game:rematch', { id: g.id, action: 'decline' }); g.rematch = null; renderAll(); break;
      case 'new-opponent': newOpponent(); break;
      case 'review-current': startReview(); break;
      case 'lobby': openOnline(); break;
    }
  });
  setInterval(() => { if (S.mode === 'online' && ON.seeking && !ON.game) renderOnlinePanel(); renderQueueBar(); }, 1000);
  $('#queueBar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-q]'); if (!b) return;
    if (b.dataset.q === 'lobby') $('#btnOnline').click();
    else if (ON.seeking) cancelSeek(); else cancelChallenge();
  });
}
async function bootOnline() {
  if (typeof io === 'undefined') return;
  wireOnline();
  await loadMe();
  connectSocket();
  const path = location.pathname;
  const mChal = path.match(/^\/c\/([A-Za-z0-9]+)$/); const mGame = path.match(/^\/game\/([A-Za-z0-9]+)$/);
  if (mChal) { openOnline(); ON.incoming = { code: mChal[1], from: '…', tc: '' }; const wait = () => ON.connected ? loadIncoming(mChal[1]) : setTimeout(wait, 200); wait(); }
  else if (mGame) { openOnline(); const wait = () => ON.connected ? openGame(mGame[1]) : setTimeout(wait, 200); wait(); }
}
window.WP_ONLINE = {
  canMove: () => !!(ON.game && ON.game.status === 'active' && ON.game.you && S.chess && S.chess.turn() === ON.game.you),
  canPremove: () => !!(ON.game && ON.game.status === 'active' && ON.game.you && S.chess && S.chess.turn() !== ON.game.you),
  move: onlineMove, render: renderOnlinePanel, banner: onlineBanner, note: onlineNote, open: () => openOnline(),
  leave: leaveOnline, boot: bootOnline, tc: () => ON.tc, active: () => onlineActive(), qbar: onModeChange,
  inGame: () => !!ON.game,
  available: () => typeof io !== 'undefined', loaded: () => ON.loaded, me: () => ON.me,
  login: () => { ON.authTab = 'login'; ON.authError = ''; $('#btnOnline').click(); },
  logout: () => { if (onlineActive()) { toast('Finish or resign your game first.'); return false; } logout(); return true; },
  plate: (c) => c === S.orientation
    ? { n: ON.me ? ON.me.username : 'You', s: ON.me ? `Rating ${myRating(ON.tc)}` : 'Log in to play' }
    : { n: ON.seeking ? 'Searching…' : 'Opponent', s: ON.seeking ? `${ON.seeking.tc} · rated` : 'Not paired yet' },
};

/* =====================================================================
   Review a game: find your recent games on Lichess or Chess.com by
   username (the Woodpusher server fetches them, see server/import.js),
   or paste a PGN.
   ===================================================================== */
const IMP_KEY = 'woodpusher.import.v1';
const IMP_SITES = { lichess: 'Lichess', chesscom: 'Chess.com' };
const IMP = Object.assign({ tab: 'user', site: 'lichess', name: '' },
  (() => { try { return JSON.parse(localStorage.getItem(IMP_KEY)) || {}; } catch (e) { return {}; } })(),
  { busy: false, error: '', data: null, token: 0, wired: false });
if (!IMP_SITES[IMP.site]) IMP.site = 'lichess';
function saveImp() { try { localStorage.setItem(IMP_KEY, JSON.stringify({ tab: IMP.tab, site: IMP.site, name: IMP.name })); } catch (e) {} }
// The look-up needs the Woodpusher server; a copy of the page without it only offers pasting.
const impAvailable = () => typeof io !== 'undefined';

function impAgo(ms) {
  if (!ms) return '';
  const s = (Date.now() - ms) / 1000;
  if (s < 3600) { const m = Math.max(1, Math.round(s / 60)); return `${m} min ago`; }
  if (s < 86400) { const h = Math.round(s / 3600); return `${h} hour${h === 1 ? '' : 's'} ago`; }
  if (s < 7 * 86400) { const d = Math.round(s / 86400); return d === 1 ? 'yesterday' : `${d} days ago`; }
  const d = new Date(ms); const same = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-GB', same ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
}
const IMP_REASON = { checkmate: 'checkmate', resignation: 'resigned', 'on time': 'on time', abandonment: 'left the game', agreement: 'draw agreed', draw: 'draw', stalemate: 'stalemate', 'threefold repetition': 'repetition', 'insufficient material': 'insufficient material', 'the 50-move rule': '50-move rule', 'timeout vs insufficient material': 'timeout vs insufficient material', 'cheat detected': 'cheat detected' };

function impRow(g, i) {
  const you = g.you; const opp = you === 'b' ? g.white : g.black;
  const res = g.result === '1/2-1/2' ? 'draw' : you ? ((g.result === '1-0') === (you === 'w') ? 'win' : 'loss') : '';
  const badge = res === 'win' ? 'W' : res === 'loss' ? 'L' : res === 'draw' ? '½' : '·';
  const title = you ? `vs ${esc(opp.name)}${opp.rating ? ` <span class="meta">(${opp.rating})</span>` : ''}` : `${esc(g.white.name)} vs ${esc(g.black.name)}`;
  const meta = [g.tc, g.speed, g.rated ? 'rated' : 'casual', IMP_REASON[g.reason] || '', impAgo(g.endedAt)].filter(Boolean).map(esc).join(' · ');
  const label = `${res === 'win' ? 'Win' : res === 'loss' ? 'Loss' : res === 'draw' ? 'Draw' : 'Game'} ${you ? 'against ' + opp.name : g.white.name + ' against ' + g.black.name}, ${[g.tc, g.speed, impAgo(g.endedAt)].filter(Boolean).join(', ')}. Review it.`;
  return `<button class="game-row imp-row" data-imp="${i}" aria-label="${esc(label)}"><span class="res ${res}" aria-hidden="true">${badge}</span><span aria-hidden="true"><span>${title}</span><br><span class="meta">${meta}</span>${g.opening ? `<br><span class="meta">${esc(g.opening)}</span>` : ''}</span><span class="imp-go" aria-hidden="true">Review</span></button>`;
}
function impRender() {
  const can = impAvailable(); const user = can && IMP.tab === 'user';
  $('#impTabs').hidden = !can;
  document.querySelectorAll('#impTabs [data-imptab]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.imptab === (user ? 'user' : 'paste'))));
  $('#impUserPane').hidden = !user; $('#impPastePane').hidden = user;
  $('#pgnSample').hidden = user; $('#pgnGo').hidden = user; $('#pgnCancel').textContent = user ? 'Close' : 'Cancel';
  if (!can) return;
  document.querySelectorAll('#impSite .seg-btn').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.site === IMP.site)));
  const go = $('#impGo'); go.disabled = IMP.busy; go.textContent = IMP.busy ? 'Finding…' : 'Find games';
  const err = $('#impErr'); err.hidden = !IMP.error; err.textContent = IMP.error;
  const list = $('#impList'); const site = IMP_SITES[IMP.site];
  if (IMP.busy) list.innerHTML = `<p class="fine"><span class="spinner"></span>Fetching the games from ${esc(site)}…</p>`;
  else if (IMP.data && IMP.data.site === IMP.site) {
    const d = IMP.data;
    list.innerHTML = d.games.length
      ? `<span class="field-label">Recent games of ${esc(d.username)} on ${esc(IMP_SITES[d.site])}</span><div class="game-list">${d.games.map(impRow).join('')}</div><p class="fine">Standard chess only. Variants such as Chess960 are left out.</p>`
      : `<p class="fine">${esc(d.username)} has no finished games of standard chess on ${esc(IMP_SITES[d.site])} yet.</p>`;
  } else list.innerHTML = '';
}
async function impSearch() {
  const inp = $('#impName'); const name = inp.value.trim();
  if (!name) { IMP.error = 'Type a username first.'; impRender(); inp.focus(); return; }
  IMP.name = name; saveImp();
  IMP.busy = true; IMP.error = ''; const token = ++IMP.token; impRender();
  try {
    const d = await api(`/import/${IMP.site}/${encodeURIComponent(name)}`);
    if (token !== IMP.token) return;
    IMP.data = d;
  } catch (e) {
    if (token !== IMP.token) return;
    IMP.data = null; IMP.error = e instanceof TypeError ? 'No connection. Check your internet and try again.' : e.message;
  }
  IMP.busy = false; impRender();
}
function impReview(i) {
  const g = IMP.data && IMP.data.games[i]; if (!g) return;
  if (S.mode === 'play') { IMP.error = 'Finish or abandon your current game first.'; impRender(); return; }
  try { loadPGNForReview(g.pgn, { you: g.you, reason: g.reason }); $('#pgnModal').hidden = true; }
  catch (e) { IMP.error = e.message; impRender(); }
}
function impOpen(tab) {
  const can = impAvailable();
  if (can && (tab === 'user' || tab === 'paste')) { IMP.tab = tab; saveImp(); }
  impRender();
  if (can && IMP.tab === 'user') {
    const inp = $('#impName'); if (!inp.value) inp.value = IMP.name;
    // A remembered username shows its games straight away
    if (inp.value && !IMP.busy && !(IMP.data && IMP.data.site === IMP.site && IMP.data.username.toLowerCase() === inp.value.trim().toLowerCase())) impSearch();
    if (!inp.value) inp.focus();
  } else $('#pgnInput').focus();
}
function impBoot() {
  if (!impAvailable() || IMP.wired) return; IMP.wired = true;
  $('#btnFindGames').hidden = false;
  $('#ctaSub').textContent = 'Pick one of your games on Lichess or Chess.com by username, or paste a PGN, and get every move graded, from best to blunder.';
  $('#impTabs').addEventListener('click', (e) => { const b = e.target.closest('[data-imptab]'); if (!b) return; IMP.tab = b.dataset.imptab; saveImp(); impOpen(); });
  $('#impSite').addEventListener('click', (e) => { const b = e.target.closest('[data-site]'); if (!b || b.dataset.site === IMP.site) return; IMP.site = b.dataset.site; IMP.error = ''; IMP.token++; IMP.busy = false; saveImp(); impRender(); $('#impName').focus(); });
  $('#impForm').addEventListener('submit', (e) => { e.preventDefault(); impSearch(); });
  $('#impList').addEventListener('click', (e) => { const b = e.target.closest('[data-imp]'); if (b) impReview(+b.dataset.imp); });
}
window.WP_IMPORT = { open: impOpen, boot: impBoot };

/* =====================================================================
   Progress follows your account: your puzzle rating and streaks, the
   opening lines you practised, and your games against Stockfish (behind
   the estimated Elo). This browser keeps a copy, so it works offline too;
   changes go to the server a moment later and are merged there with what
   your other devices sent (server/progress.js).
   ===================================================================== */
const SYNC_KEY = 'woodpusher.sync.v1';
// owner: the account this browser's copy belongs to. mergeId: progress made before logging in that is
// on its way into the account (kept across a reload, so a retry doesn't count it twice).
const SYNC = Object.assign({ owner: null, mergeId: null },
  (() => { try { return JSON.parse(localStorage.getItem(SYNC_KEY)) || {}; } catch (e) { return {}; } })(),
  { user: undefined, rev: 0, timer: null, busy: false, again: false, last: 0, failures: 0, silent: false, wired: false });
function saveSyncState() { try { localStorage.setItem(SYNC_KEY, JSON.stringify({ owner: SYNC.owner, mergeId: SYNC.mergeId })); } catch (e) {} }

const PZ_START = () => ({ rating: 1200, solved: 0, tried: 0, streak: 0, best: 0, seen: {} });
const progressPayload = () => ({ lines: PROG.lines, pz: PROG.pz, hist: HIST.games, mist: PROG.mist, daily: PROG.daily });
const hasLocalProgress = () => PROG.pz.tried > 0 || Object.keys(PROG.lines).length > 0 || HIST.games.length > 0 || PROG.mist.length > 0 || Object.keys(PROG.daily).length > 0;
function setLocalProgress(d) {
  PROG.lines = (d && d.lines) || {}; PROG.pz = Object.assign(PZ_START(), (d && d.pz) || {});
  HIST.games = d && Array.isArray(d.hist) ? d.hist : [];
  PROG.mist = d && Array.isArray(d.mist) ? d.mist : []; PROG.daily = (d && d.daily) || {};
  SYNC.silent = true; try { saveProg(); saveHist(); } finally { SYNC.silent = false; }
  renderUserSection();
  if (S.mode === 'puzzle' || S.mode === 'lesson') renderTrainer();
  if (window.WP_PLAYERS) window.WP_PLAYERS.refresh();
}
// trainer.js and profile.js call this whenever they save
function progressChanged() { if (SYNC.silent) return; SYNC.rev++; schedulePush(1500); }
function schedulePush(ms) {
  if (!SYNC.user || SYNC.owner !== SYNC.user.id) return;
  clearTimeout(SYNC.timer); SYNC.timer = setTimeout(() => pushProgress(), ms);
}
async function pushProgress(extra) {
  if (!SYNC.user) return false;
  if (SYNC.busy) { SYNC.again = true; return false; }
  SYNC.busy = true; const rev = SYNC.rev; const uid = SYNC.user.id; let ok = false;
  try {
    const d = await api('/progress', { method: 'PUT', body: Object.assign({ progress: progressPayload() }, extra || {}) });
    ok = true; SYNC.failures = 0; SYNC.last = Date.now();
    if (SYNC.user && SYNC.user.id === uid) {
      SYNC.owner = uid; if (extra && extra.guest) SYNC.mergeId = null; saveSyncState();
      if (SYNC.rev === rev) setLocalProgress(d.progress); else SYNC.again = true;   // newer changes go up next
    }
  } catch (e) {
    // Offline, or the server is restarting: try again a little later
    SYNC.failures++; clearTimeout(SYNC.timer);
    SYNC.timer = setTimeout(() => pushProgress(extra), Math.min(5 * 60 * 1000, 15000 * SYNC.failures));
  } finally {
    SYNC.busy = false;
    if (SYNC.again) { SYNC.again = false; schedulePush(400); }
  }
  return ok;
}
// online.js calls this when it knows who is logged in (null: nobody), and after logging in or out
async function syncUser(me) {
  const prev = SYNC.user; SYNC.user = me || null;
  if (!me) {
    // Logged out (not just offline): this browser's copy belonged to the account, which keeps it
    if (prev) { clearTimeout(SYNC.timer); SYNC.owner = null; SYNC.mergeId = null; saveSyncState(); setLocalProgress(null); }
    return;
  }
  if (prev && prev.id === me.id) return;
  if (SYNC.owner === me.id) { await pushProgress(); return; }
  if (SYNC.owner == null && hasLocalProgress()) {
    // Progress made here before logging in goes into the account, added to what it already has
    if (!SYNC.mergeId) { SYNC.mergeId = 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); saveSyncState(); }
    if (await pushProgress({ guest: true, mergeId: SYNC.mergeId })) { SYNC.mergeId = null; saveSyncState(); }
    return;
  }
  // Another account's copy, or nothing yet: start from what this account has
  if (SYNC.owner != null && SYNC.owner !== me.id) setLocalProgress(null);
  await pushProgress();
}
// Before logging out: send anything not sent yet
async function flushProgress() { clearTimeout(SYNC.timer); if (SYNC.user && SYNC.owner === SYNC.user.id) await pushProgress(); }
function syncBoot() {
  if (typeof io === 'undefined' || SYNC.wired) return; SYNC.wired = true;
  // Back on the page after a while: pick up what other devices did meanwhile
  document.addEventListener('visibilitychange', () => { if (!document.hidden && SYNC.user && Date.now() - SYNC.last > 60 * 1000) pushProgress(); });
  window.addEventListener('online', () => { if (SYNC.user && SYNC.failures) pushProgress(); });
}
window.WP_SYNC = { boot: syncBoot, onUser: syncUser, flush: flushProgress, synced: () => !!(SYNC.user && SYNC.owner === SYNC.user.id) };

/* =====================================================================
   Profile pages (/@/name) and the leaderboard (/leaderboard): ratings
   per time control, a rating graph, the whole game history, and, on your
   own profile, your puzzle and opening progress. Shown in a large dialog
   over the board, so a game underneath keeps its place.
   ===================================================================== */
const PL = { view: null, name: null, prof: null, hist: null, cat: 'blitz', listAll: false, games: [], next: null, loading: false, error: '',
  board: null, boardCat: 'blitz', pushed: false, ignorePop: false, token: 0, from: null, hover: null };
const PL_CATS = [['bullet', 'Bullet'], ['blitz', 'Blitz'], ['rapid', 'Rapid'], ['classical', 'Classical']];
const plCatLabel = (c) => (PL_CATS.find(x => x[0] === c) || ['', 'All'])[1];
const plAvailable = () => typeof io !== 'undefined';
const plMe = () => (window.WP_ONLINE && window.WP_ONLINE.me()) || null;
const plIsMe = () => { const me = plMe(); return !!(me && PL.prof && me.username.toLowerCase() === PL.prof.username.toLowerCase()); };
function plDate(iso, withYear) { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('en-GB', withYear ? { day: 'numeric', month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short' }); }

/* ---------------- opening and closing ---------------- */
function plSetUrl(url) {
  const modal = $('#playerModal');
  if (modal.hidden) { PL.from = location.pathname; if (location.pathname !== url) { history.pushState({ wp: 'player' }, '', url); PL.pushed = true; } else PL.pushed = false; }
  else if (location.pathname !== url) history.replaceState({ wp: 'player' }, '', url);
}
function plShow() { const m = $('#playerModal'); if (m.hidden) { m.hidden = false; $('#playerBody').scrollTop = 0; } }
function plClose() {
  const m = $('#playerModal'); if (m.hidden) return;
  m.hidden = true; PL.token++;
  if (PL.pushed) { PL.pushed = false; PL.ignorePop = true; history.back(); }
  else if (/^\/(@\/|leaderboard|admin)/.test(location.pathname)) history.replaceState(null, '', PL.from && !/^\/(@\/|leaderboard|admin)/.test(PL.from) ? PL.from : '/');
}
async function plOpenProfile(name) {
  if (!plAvailable()) return;
  plSetUrl('/@/' + encodeURIComponent(name));
  const token = ++PL.token; PL.view = 'profile'; PL.name = name; PL.prof = null; PL.hist = null; PL.games = []; PL.next = null; PL.error = ''; PL.listAll = false; PL.hover = null;
  plShow(); plRender();
  try {
    const [prof, hist] = await Promise.all([api('/users/' + encodeURIComponent(name)), api('/users/' + encodeURIComponent(name) + '/ratings')]);
    if (token !== PL.token) return;
    PL.prof = prof; PL.hist = hist.ratings;
    // Start on the time control with the most games
    const best = PL_CATS.map(([c]) => [c, (prof.ratings[c] && prof.ratings[c].games) || 0]).sort((a, b) => b[1] - a[1])[0];
    PL.cat = best && best[1] ? best[0] : 'blitz';
    plRender(); plLoadGames(true);
  } catch (e) { if (token !== PL.token) return; PL.error = e.message; plRender(); }
}
async function plLoadGames(reset) {
  if (!PL.prof) return;
  const token = PL.token; if (reset) { PL.games = []; PL.next = null; }
  PL.loading = true; plRenderGames();
  try {
    const qs = new URLSearchParams({ cat: PL.listAll ? 'all' : PL.cat, limit: '20' }); if (!reset && PL.next) qs.set('before', PL.next);
    const d = await api(`/users/${encodeURIComponent(PL.prof.username)}/games?${qs}`);
    if (token !== PL.token) return;
    PL.games = reset ? d.games : PL.games.concat(d.games); PL.next = d.next;
  } catch (e) { if (token !== PL.token) return; PL.error = e.message; }
  PL.loading = false; plRenderGames();
}
async function plOpenBoard(cat) {
  if (!plAvailable()) return;
  plSetUrl('/leaderboard');
  if (cat) PL.boardCat = cat;
  const token = ++PL.token; PL.view = 'board'; PL.board = null; PL.error = '';
  plShow(); plRender();
  try { const d = await api('/leaderboard?cat=' + PL.boardCat); if (token !== PL.token) return; PL.board = d; }
  catch (e) { if (token !== PL.token) return; PL.error = e.message; }
  plRender();
}

/* ---------------- the profile ---------------- */
function plRender() {
  const el = $('#playerBody');
  if (PL.view === 'board') { el.innerHTML = plBoardHTML(); return; }
  if (PL.view === 'report') { el.innerHTML = plReportHTML(); return; }
  if (PL.view === 'admin') { el.innerHTML = plAdminHTML(); return; }
  if (!PL.prof) {
    el.innerHTML = `<h2 class="pl-title" id="plTitle">${esc(PL.name || 'Player')}</h2>${PL.error ? `<p class="err">${esc(PL.error)}</p>` : '<p class="fine"><span class="spinner"></span>Loading the profile…</p>'}`;
    return;
  }
  const p = PL.prof; const me = plIsMe();
  const total = PL_CATS.reduce((n, [c]) => { const r = p.records && p.records[c]; return n + (r ? r.w + r.d + r.l : 0); }, 0);
  const boxes = PL_CATS.map(([c, label]) => {
    const x = p.ratings[c] || { rating: 1500, provisional: true, games: 0 }; const rec = (p.records && p.records[c]) || { w: 0, d: 0, l: 0 };
    return `<button class="rbox pl-cat" data-cat="${c}" aria-pressed="${c === PL.cat}"><small>${label}</small><b>${x.rating}${x.provisional ? '?' : ''}</b><span class="rbox-n">${x.games} rated</span><span class="rbox-n pl-rec" title="Wins, draws and losses">${rec.w}–${rec.d}–${rec.l}</span></button>`;
  }).join('');
  el.innerHTML = `
    <div class="pl-head"><span class="you-ic" aria-hidden="true">${pieceSVG('wK')}</span>
      <div class="pl-who"><h2 class="pl-title" id="plTitle">${esc(p.username)}</h2><p class="fine">${esc(sinceText(p.createdAt))} · ${total} game${total === 1 ? '' : 's'}${me ? ' · <b>this is you</b>' : ''}</p></div>
      <div class="pl-head-btns"><button class="btn btn-small" data-pl="board">Leaderboard</button>${plMe() && !me && !p.closed ? '<button class="btn btn-small" data-pl="report">Report</button>' : ''}</div></div>
    ${p.closed ? `<p class="offer">${p.closed === 'fairplay' ? 'This account is closed for breaking Woodpusher’s fair-play rules.' : 'This account is closed.'}</p>` : ''}
    <div class="ratings-row pl-cats" role="group" aria-label="Time control">${boxes}</div>
    <p class="fine">A <b>?</b> means the rating is still settling. The three numbers are wins, draws and losses.</p>
    <section class="pl-sec"><span class="field-label" id="plGraphLbl">${plCatLabel(PL.cat)} rating</span><div class="pl-chart" id="plChart"></div></section>
    ${me ? plProgressHTML() : ''}
    <section class="pl-sec"><div class="pl-list-head"><span class="field-label">Games</span>
      <div class="seg pl-filter" role="group" aria-label="Which games"><button class="seg-btn" data-all="0" aria-pressed="${!PL.listAll}">${plCatLabel(PL.cat)}</button><button class="seg-btn" data-all="1" aria-pressed="${PL.listAll}">All</button></div></div>
      <div id="plGames"></div></section>`;
  plDrawChart(); plRenderGames();
}
function plProgressHTML() {
  const s = PROG.pz; const lines = Object.values(PROG.lines); const perfect = lines.filter(x => x.perfect).length; const est = estimateElo();
  const synced = window.WP_SYNC && window.WP_SYNC.synced();
  return `<section class="pl-sec"><span class="field-label">Your progress${synced ? ' · saved to your account' : ''}</span>
    <div class="pl-prog">
      <div><small>Puzzles</small><b>${s.rating}</b><span class="fine">${s.solved} solved of ${s.tried} · best streak ${s.best}</span></div>
      <div><small>Openings</small><b>${lines.length}</b><span class="fine">line${lines.length === 1 ? '' : 's'} practised${lines.length ? `, ${perfect} without mistakes` : ''}</span></div>
      <div><small>Elo vs Stockfish</small><b>${!est ? '–' : est.above ? ELO_MAX + '+' : '≈' + est.elo}</b><span class="fine">${est ? esc(est.confidence) : 'Play Stockfish to get one'}</span></div>
    </div><p class="fine">Only you see this part.</p></section>`;
}
function plGameRowHTML(gm) {
  const res = gm.result === '1/2-1/2' ? 'draw' : (gm.result === '1-0') === (gm.color === 'w') ? 'win' : 'loss';
  const diff = gm.diff != null ? `<span class="d ${gm.diff > 0 ? 'up' : gm.diff < 0 ? 'down' : ''}">${gm.diff > 0 ? '+' : gm.diff < 0 ? MINUS : '±'}${Math.abs(gm.diff)}</span>` : '<span class="d"></span>';
  const moves = gm.plies ? `${Math.ceil(gm.plies / 2)} moves` : '';
  const meta = [gm.tc, gm.rated ? 'rated' : 'friend game', gm.reason || '', moves, plDate(gm.endedAt, new Date(gm.endedAt).getFullYear() !== new Date().getFullYear())].filter(Boolean).map(esc).join(' · ');
  const opp = gm.opponent === 'Deleted player' ? '<span>vs Deleted player</span>' : `<button class="pl-link" data-player="${esc(gm.opponent)}">vs ${esc(gm.opponent)}</button>`;
  return `<div class="game-row pl-game"><span class="res ${res}" aria-label="${res === 'win' ? 'Win' : res === 'loss' ? 'Loss' : 'Draw'}">${res === 'win' ? 'W' : res === 'loss' ? 'L' : '½'}</span>
    <span>${opp}${gm.oppRating ? ` <span class="meta">(${gm.oppRating})</span>` : ''}<br><span class="meta">${meta}</span></span>
    <span class="pl-row-end">${diff}<button class="btn btn-small" data-review="${esc(gm.id)}" ${gm.plies ? '' : 'disabled'}>Review</button></span></div>`;
}
function plRenderGames() {
  const el = $('#plGames'); if (!el) return;
  const what = PL.listAll ? '' : plCatLabel(PL.cat).toLowerCase() + ' ';
  let html = PL.games.length ? `<div class="game-list">${PL.games.map(plGameRowHTML).join('')}</div>` : PL.loading ? '' : `<p class="fine">No finished ${what}games yet.</p>`;
  if (PL.loading) html += '<p class="fine"><span class="spinner"></span>Loading games…</p>';
  else if (PL.next) html += '<button class="btn btn-small" data-pl="more">Show more games</button>';
  if (PL.error) html += `<p class="err">${esc(PL.error)}</p>`;
  el.innerHTML = html;
}

/* ---------------- the rating graph ---------------- */
// One line: the rating after each rated game, game number along the bottom. Hover, tap or the arrow
// keys show the exact rating, the change and the date; a table under it lists the same numbers.
function plSeries() {
  const h = PL.hist && PL.hist[PL.cat]; if (!h || !h.points.length) return [];
  return [{ n: 0, r: h.start, t: null }].concat(h.points.map((p, i) => ({ n: i + 1, r: p[1], t: p[0] })));
}
function plDrawChart() {
  const box = $('#plChart'); if (!box) return;
  const pts = plSeries(); const label = plCatLabel(PL.cat);
  if (pts.length < 2) { box.innerHTML = `<p class="fine pl-empty">No rated ${label.toLowerCase()} games yet. The graph starts after the first one.</p>`; return; }
  const W = Math.max(280, Math.round(box.clientWidth || 520)), H = 190, L = 44, R = 12, T = 12, B = 26;
  const rs = pts.map(p => p.r); let lo = Math.min(...rs), hi = Math.max(...rs);
  const pad = Math.max(20, (hi - lo) * 0.12); lo = Math.floor((lo - pad) / 25) * 25; hi = Math.ceil((hi + pad) / 25) * 25;
  const span = hi - lo; const step = [25, 50, 100, 200, 250, 500].find(s => span / s <= 4) || 1000;
  const x = (n) => L + (W - L - R) * (n / (pts.length - 1)); const y = (r) => T + (H - T - B) * (1 - (r - lo) / (hi - lo));
  let grid = '';
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) grid += `<line class="pl-grid" x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text class="pl-ax" x="${L - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${v}</text>`;
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.n).toFixed(1)},${y(p.r).toFixed(1)}`).join('');
  const area = `${d}L${x(pts[pts.length - 1].n).toFixed(1)},${H - B}L${x(0).toFixed(1)},${H - B}Z`;
  const last = pts[pts.length - 1];
  const ticks = `<text class="pl-ax" x="${L}" y="${H - 8}" text-anchor="start">Start</text><text class="pl-ax" x="${W - R}" y="${H - 8}" text-anchor="end">Game ${pts.length - 1}</text>`;
  const rows = pts.slice(1).slice(-30).reverse().map(p => `<tr><td>${p.n}</td><td>${p.r}</td><td>${p.t ? plDate(p.t, true) : ''}</td></tr>`).join('');
  box.innerHTML = `<div class="pl-plot" tabindex="0" role="img" aria-label="${esc(label)} rating over ${pts.length - 1} rated games, from ${pts[0].r} to ${last.r}, lowest ${Math.min(...rs)}, highest ${Math.max(...rs)}. Use the arrow keys to read each game.">
      <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">${grid}
        <path class="pl-area" d="${area}"/><path class="pl-line" d="${d}"/>
        <circle class="pl-end" cx="${x(last.n).toFixed(1)}" cy="${y(last.r).toFixed(1)}" r="4"/>${ticks}
        <g class="pl-cross" hidden><line class="pl-hair" y1="${T}" y2="${H - B}"/><circle class="pl-dot" r="5"/></g></svg>
      <div class="pl-tip" hidden></div></div>
    <details class="pl-table"><summary>Show as a table</summary><table><thead><tr><th>Game</th><th>Rating after</th><th>Date</th></tr></thead><tbody>${rows}</tbody></table>${pts.length > 31 ? '<p class="fine">The latest 30 games.</p>' : ''}</details>`;
  const plot = box.querySelector('.pl-plot'); const svg = plot.querySelector('svg'); const cross = svg.querySelector('.pl-cross'); const tip = plot.querySelector('.pl-tip');
  const show = (i) => {
    if (i == null) { cross.setAttribute('hidden', ''); tip.hidden = true; PL.hover = null; return; }
    i = clamp(i, 0, pts.length - 1); PL.hover = i; const p = pts[i]; const cx = x(p.n), cy = y(p.r);
    cross.removeAttribute('hidden'); cross.querySelector('.pl-hair').setAttribute('x1', cx); cross.querySelector('.pl-hair').setAttribute('x2', cx);
    cross.querySelector('.pl-dot').setAttribute('cx', cx); cross.querySelector('.pl-dot').setAttribute('cy', cy);
    const prev = i > 0 ? pts[i - 1].r : null; const ch = prev == null ? '' : p.r - prev;
    tip.textContent = '';
    const b = document.createElement('b'); b.textContent = String(p.r); tip.appendChild(b);
    const s = document.createElement('span'); s.textContent = i === 0 ? 'Before the first rated game' : `After game ${p.n}${ch !== '' ? ` · ${ch > 0 ? '+' : ch < 0 ? MINUS : '±'}${Math.abs(ch)}` : ''}${p.t ? ' · ' + plDate(p.t, true) : ''}`; tip.appendChild(s);
    tip.hidden = false;
    const scale = svg.getBoundingClientRect().width / W; const left = cx * scale; const tw = tip.offsetWidth;
    tip.style.left = clamp(left - tw / 2, 0, Math.max(0, plot.clientWidth - tw)) + 'px'; tip.style.top = Math.max(0, cy * scale - tip.offsetHeight - 12) + 'px';
  };
  const nearest = (clientX) => { const r = svg.getBoundingClientRect(); const fx = ((clientX - r.left) / r.width) * W; return Math.round(clamp((fx - L) / (W - L - R), 0, 1) * (pts.length - 1)); };
  plot.addEventListener('pointermove', (e) => show(nearest(e.clientX)));
  plot.addEventListener('pointerdown', (e) => show(nearest(e.clientX)));
  plot.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') show(null); });
  plot.addEventListener('blur', () => show(null));
  plot.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); show(PL.hover == null ? pts.length - 1 : PL.hover + (e.key === 'ArrowLeft' ? -1 : 1)); }
    else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); e.stopPropagation(); show(e.key === 'Home' ? 0 : pts.length - 1); }
  });
}

/* ---------------- the leaderboard ---------------- */
function plBoardHTML() {
  const seg = `<div class="seg pl-board-cats" role="group" aria-label="Time control" style="grid-template-columns:repeat(4,1fr)">${PL_CATS.map(([c, l]) => `<button class="seg-btn" data-board="${c}" aria-pressed="${c === PL.boardCat}">${l}</button>`).join('')}</div>`;
  const back = PL.prof ? `<button class="back-link" data-pl="back">← ${esc(PL.prof.username)}</button>` : '';
  const head = `${back}<h2 class="pl-title" id="plTitle">Leaderboard</h2><p class="fine">The highest-rated players per time control, from rated games on Woodpusher.</p>${seg}`;
  if (PL.error) return head + `<p class="err">${esc(PL.error)}</p>`;
  const d = PL.board; if (!d) return head + '<p class="fine"><span class="spinner"></span>Loading…</p>';
  const meName = (plMe() || {}).username;
  if (!d.players.length) return head + `<p class="fine">Nobody has played a rated ${plCatLabel(d.category).toLowerCase()} game yet. Play one from Play online and you're on the board.</p>`;
  const rows = d.players.map(p => `<li class="lb-row${meName && p.username.toLowerCase() === meName.toLowerCase() ? ' me' : ''}"><span class="lb-rank">${p.rank}</span><button class="pl-link lb-name" data-player="${esc(p.username)}">${esc(p.username)}</button><span class="lb-games">${p.games} game${p.games === 1 ? '' : 's'}</span><b class="lb-rating">${p.rating}${p.provisional ? '?' : ''}</b></li>`).join('');
  const inTop = meName && d.players.some(p => p.username.toLowerCase() === meName.toLowerCase());
  const you = d.you ? `<p class="fine lb-you">Your place: <b>${d.you.rank}</b> of ${d.total}, rating ${d.you.rating}${d.you.provisional ? '?' : ''}.</p>` : meName ? `<p class="fine lb-you">Play a rated ${plCatLabel(d.category).toLowerCase()} game to get a place.</p>` : '';
  return head + `<ol class="lb" aria-label="${esc(plCatLabel(d.category))} leaderboard">${rows}</ol>${inTop ? (d.you ? `<p class="fine lb-you">You are number ${d.you.rank} of ${d.total}.</p>` : '') : you}
    <p class="fine">Everyone with at least one rated game is listed. A <b>?</b> means the rating is still settling after only a few games.</p>`;
}

/* ---------------- reporting a player ---------------- */
const PL_REASONS = [['cheating', 'Uses computer help', 'Plays engine moves, gets outside help during games'], ['behaviour', 'Unsportsmanlike behaviour', 'Lets the clock run down on purpose, leaves lost games, abuses the messages'], ['username', 'Offensive username', ''], ['other', 'Something else', '']];
function plOpenReport(name, gameId) {
  if (!plAvailable()) return;
  if (!plMe()) { toast('Log in to report a player.'); return; }
  plSetUrl('/@/' + encodeURIComponent(name));
  PL.token++; PL.view = 'report'; PL.report = { name, gameId: gameId || null, reason: '', note: '', sent: false, busy: false, error: '' };
  plShow(); plRender();
}
function plReportHTML() {
  const R = PL.report;
  const head = `<button class="back-link" data-pl="back-profile">← ${esc(R.name)}</button><h2 class="pl-title" id="plTitle">Report ${esc(R.name)}</h2>`;
  if (R.sent) return head + `<p>Thanks. Your report went to Woodpusher’s admin, who looks at every one. ${esc(R.name)} doesn’t see who sent it.</p><div class="actions"><button class="btn btn-brass" data-pl="back-profile">Back to the profile</button></div>`;
  return head + `<p class="fine">${R.gameId ? 'About your game together. ' : ''}Only Woodpusher’s admin sees this.</p>
    <form class="form" id="plReportForm" novalidate><fieldset class="rp-reasons"><legend class="field-label">What happened?</legend>
      ${PL_REASONS.map(([k, label, sub]) => `<label class="check rp-reason"><input type="radio" name="reason" value="${k}" ${R.reason === k ? 'checked' : ''}><span><b>${esc(label)}</b>${sub ? `<br><span class="fine">${esc(sub)}</span>` : ''}</span></label>`).join('')}</fieldset>
      <label>Anything to add? <span class="fine">(optional)</span><textarea class="input rp-note" name="note" maxlength="500" rows="3" placeholder="For example which move, or what was said">${esc(R.note)}</textarea></label>
      ${R.error ? `<p class="err" role="alert">${esc(R.error)}</p>` : ''}
      <div class="actions"><button class="btn btn-brass" type="submit" ${R.busy ? 'disabled' : ''}>Send report</button><button class="btn" type="button" data-pl="back-profile">Cancel</button></div></form>`;
}
async function plSendReport(form) {
  const R = PL.report; const r = form.querySelector('[name=reason]:checked'); R.note = form.querySelector('[name=note]').value;
  R.reason = r ? r.value : ''; if (!R.reason) { R.error = 'Pick what happened.'; plRender(); return; }
  R.busy = true; R.error = ''; plRender();
  try { await api('/reports', { method: 'POST', body: { username: R.name, gameId: R.gameId, reason: R.reason, note: R.note } }); R.sent = true; }
  catch (e) { R.error = e.message; }
  R.busy = false; plRender();
}

/* ---------------- the admin view: reports and fair play ---------------- */
// Only for the usernames in the server's ADMIN_USERS variable (server/moderation.js)
async function plOpenAdmin() {
  if (!plAvailable()) return;
  plSetUrl('/admin');
  const token = ++PL.token; PL.view = 'admin'; PL.admin = null; PL.error = '';
  plShow(); plRender();
  try { const d = await api('/admin/overview'); if (token !== PL.token) return; PL.admin = d; }
  catch (e) { if (token !== PL.token) return; PL.error = e.message; }
  plRender();
}
const pct = (x) => Math.round((x || 0) * 100) + '%';
function plFpLine(fp, avg) {
  if (!fp) return '<span class="fine">No checked games yet.</span>';
  return `<span class="fine">${fp.games} game${fp.games === 1 ? '' : 's'} checked, ${fp.moves} moves: <b>${pct(fp.rate)}</b> Stockfish’s first choice, average loss <b>${Math.round(fp.acpl)}</b> centipawns${avg && avg.checks ? ` (everyone: ${pct(avg.rate)}, ${Math.round(avg.acpl)})` : ''}.${fp.worst ? ` Most engine-like game: ${pct(fp.worst.top1)}, ${Math.round(fp.worst.acpl)} over ${fp.worst.moves} moves <button class="pl-link" data-review="${esc(fp.worst.id)}">review it</button>.` : ''}</span>${fp.flag ? ' <span class="chip ad-flag">Flagged</span>' : ''}`;
}
function plCloseControls(name) {
  return `<span class="ad-close"><select class="select ad-sel" data-close-reason="${esc(name)}" aria-label="Why"><option value="fairplay">Fair play</option><option value="behaviour">Behaviour</option><option value="username">Username</option></select><button class="btn btn-small armable" data-adm="close" data-user="${esc(name)}">Close account</button></span>`;
}
function plAdminHTML() {
  const head = `<h2 class="pl-title" id="plTitle">Reports and fair play</h2><p class="fine">Only you see this. Nothing happens to an account until you act on it.</p>`;
  if (PL.error) return head + `<p class="err">${esc(PL.error)}</p>`;
  const d = PL.admin; if (!d) return head + '<p class="fine"><span class="spinner"></span>Loading…</p>';
  const open = d.reports.filter(r => r.status === 'open'), done = d.reports.filter(r => r.status !== 'open');
  const card = (r) => `<div class="ad-card${r.status !== 'open' ? ' done' : ''}">
      <div class="ad-top"><button class="pl-link" data-player="${esc(r.reported)}"><b>${esc(r.reported)}</b></button><span class="chip">${esc(d.reasons[r.reason] || r.reason)}</span>${r.closed ? '<span class="chip">closed</span>' : ''}<span class="fine">from ${esc(r.reporter)} · ${plDate(r.at, true)}${r.status !== 'open' ? ` · ${r.status}` : ''}</span></div>
      ${r.note ? `<p class="ad-note">${esc(r.note)}</p>` : ''}
      <div>${plFpLine(r.fp, d.average)}</div>
      <div class="actions">${r.gameId ? `<button class="btn btn-small" data-review="${esc(r.gameId)}">Review the game</button>` : ''}${r.status === 'open' ? `${r.closed ? '' : plCloseControls(r.reported)}<button class="btn btn-small" data-adm="dismiss" data-report="${r.id}">Nothing wrong</button>` : `<button class="btn btn-small" data-adm="reopen-report" data-report="${r.id}">Open again</button>`}</div></div>`;
  return head + `
    <section class="pl-sec"><span class="field-label">Open reports (${open.length})</span>${open.length ? open.map(card).join('') : '<p class="fine">No open reports.</p>'}</section>
    <section class="pl-sec"><span class="field-label">Flagged by the fair-play check (${d.flagged.length})</span>
      ${d.flagged.length ? d.flagged.map(f => `<div class="ad-card"><div class="ad-top"><button class="pl-link" data-player="${esc(f.username)}"><b>${esc(f.username)}</b></button></div><div>${plFpLine(f.fp, d.average)}</div><div class="actions">${plCloseControls(f.username)}<button class="btn btn-small" data-adm="clear" data-user="${esc(f.username)}">Looks fine</button></div></div>`).join('') : '<p class="fine">Nobody is flagged.</p>'}
      <p class="fine">Every finished rated game is checked with Stockfish from move 8 on. A player is flagged when, over their last 20 checked games, at least ${d.flagLines.recent.moves} moves were ${pct(d.flagLines.recent.top1)} or more Stockfish’s first choice with an average loss of ${d.flagLines.recent.acpl} or less; or when one game of ${d.flagLines.single.moves}+ moves reached ${pct(d.flagLines.single.top1)} and ${d.flagLines.single.acpl}. Strong players and short, simple games can come close, so a flag is a reason to look, not proof. “Looks fine” counts only games played after that.</p></section>
    <section class="pl-sec"><span class="field-label">Closed accounts (${d.closed.length})</span>${d.closed.length ? `<div class="game-list">${d.closed.map(c => `<div class="game-row ad-closed"><span></span><span><button class="pl-link" data-player="${esc(c.username)}">${esc(c.username)}</button><br><span class="meta">${esc(c.reason || '')} · ${plDate(c.at, true)}</span></span><button class="btn btn-small" data-adm="reopen" data-user="${esc(c.username)}">Reopen</button></div>`).join('')}</div>` : '<p class="fine">None.</p>'}</section>
    ${done.length ? `<section class="pl-sec"><span class="field-label">Handled in the last 30 days (${done.length})</span>${done.map(card).join('')}</section>` : ''}`;
}
async function plAdminAction(b) {
  const a = b.dataset.adm;
  try {
    if (a === 'dismiss' || a === 'reopen-report') await api('/admin/reports/' + b.dataset.report, { method: 'POST', body: { action: a === 'dismiss' ? 'dismiss' : 'reopen' } });
    else if (a === 'close') {
      const sel = [...document.querySelectorAll('#playerBody [data-close-reason]')].find(x => x.dataset.closeReason === b.dataset.user);
      await api('/admin/users/' + encodeURIComponent(b.dataset.user), { method: 'POST', body: { action: 'close', reason: sel ? sel.value : 'fairplay' } });
      toast(`${b.dataset.user}’s account is closed.`);
    } else await api('/admin/users/' + encodeURIComponent(b.dataset.user), { method: 'POST', body: { action: a } });
  } catch (e) { toast(e.message); return; }
  plOpenAdmin();
}

/* ---------------- wiring ---------------- */
function plReview(id) {
  if (S.mode === 'play') { toast('Finish or abandon your game first.'); return; }
  if (window.WP_ONLINE && window.WP_ONLINE.active()) { toast('Your online game is still running. Finish or resign it first.'); return; }
  const persp = PL.prof ? PL.prof.username : null;
  plClose(); trainerStop(); reviewOnlineGame(id, persp);
}
function plBoot() {
  if (!plAvailable() || PL.wired) return; PL.wired = true;
  const modal = $('#playerModal');
  $('#plClose').addEventListener('click', plClose);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) { plClose(); return; }
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    if (b.dataset.player) { plOpenProfile(b.dataset.player); return; }
    if (b.dataset.review) { plReview(b.dataset.review); return; }
    if (b.dataset.cat) { if (b.dataset.cat !== PL.cat) { PL.cat = b.dataset.cat; PL.hover = null; plRender(); if (!PL.listAll) plLoadGames(true); } return; }
    if (b.dataset.all != null) { const all = b.dataset.all === '1'; if (all !== PL.listAll) { PL.listAll = all; plRender(); plLoadGames(true); } return; }
    if (b.dataset.board) { if (b.dataset.board !== PL.boardCat) plOpenBoard(b.dataset.board); return; }
    if (b.dataset.pl === 'board') { const c = PL.cat; plOpenBoard(c); return; }
    if (b.dataset.pl === 'back' && PL.prof) { plOpenProfile(PL.prof.username); return; }
    if (b.dataset.pl === 'more') { plLoadGames(false); return; }
    if (b.dataset.pl === 'report' && PL.prof) { plOpenReport(PL.prof.username); return; }
    if (b.dataset.pl === 'back-profile' && PL.report) { plOpenProfile(PL.report.name); return; }
    if (b.dataset.adm) { if (b.dataset.adm === 'close') armOrRun(b, 'Close for sure?', () => plAdminAction(b)); else plAdminAction(b); return; }
  });
  modal.addEventListener('submit', (e) => { if (e.target.id === 'plReportForm') { e.preventDefault(); plSendReport(e.target); } });
  // Escape closes the dialog (and restores the address) before the page's own Escape handling
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) { e.stopImmediatePropagation(); plClose(); } }, true);
  // Back button closes it
  window.addEventListener('popstate', () => { if (PL.ignorePop) { PL.ignorePop = false; return; } if (!modal.hidden) { PL.pushed = false; modal.hidden = true; PL.token++; } });
  // Links anywhere on the page: the footer's Leaderboard, and profile links
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="/@/"], a[href="/leaderboard"]'); if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault(); const h = a.getAttribute('href');
    if (h === '/leaderboard') plOpenBoard(); else plOpenProfile(decodeURIComponent(h.slice(3)));
  });
  // Buttons elsewhere on the page (lobby, Settings, the online game) that open a profile or the leaderboard
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-open-player], [data-open-board], [data-open-report], [data-open-admin]'); if (!b) return;
    document.querySelectorAll('.modal-back').forEach(m => { if (m.id !== 'playerModal') m.hidden = true; });
    if (b.dataset.openBoard != null) plOpenBoard(); else if (b.dataset.openAdmin != null) plOpenAdmin();
    else if (b.dataset.openReport) plOpenReport(b.dataset.openReport, b.dataset.game); else plOpenProfile(b.dataset.openPlayer);
  });
  let rz = null; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (!modal.hidden && PL.view === 'profile' && PL.prof) plDrawChart(); }, 120); });
  // Arriving on a profile or leaderboard address
  const m = location.pathname.match(/^\/@\/([A-Za-z0-9_-]{1,30})\/?$/);
  if (m) { PL.from = '/'; plOpenProfile(m[1]); PL.pushed = false; }
  else if (location.pathname === '/leaderboard') { PL.from = '/'; plOpenBoard(); PL.pushed = false; }
  else if (location.pathname === '/admin') { PL.from = '/'; plOpenAdmin(); PL.pushed = false; }
}
window.WP_PLAYERS = { boot: plBoot, profile: plOpenProfile, board: plOpenBoard, report: plOpenReport, admin: plOpenAdmin, refresh: () => { if (!$('#playerModal').hidden && PL.view === 'profile' && PL.prof) plRender(); } };

/* =====================================================================
   Woodpusher as an app: registers the service worker (sw.js), which lets
   the site be installed and open without a connection, and offers to
   install it in Settings and the footer.
   ===================================================================== */
const INS = { prompt: null, installed: false, wired: false };
const insStandalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
const insIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function renderInstall() {
  const sec = $('#installSection'); if (!sec) return;
  const foot = $('#footInstall');
  let html;
  if (insStandalone() || INS.installed) html = '<p class="fine">Woodpusher is installed. It opens from your home screen or app list, and games against Stockfish, puzzles, openings and reviews work without a connection too.</p>';
  else if (INS.prompt) html = '<p class="fine">Put Woodpusher on your home screen or desktop. It opens in its own window, and games against Stockfish, puzzles, openings and reviews also work without a connection.</p><div class="user-actions"><button class="btn btn-brass btn-small" data-install>Install Woodpusher</button></div>';
  else if (insIOS()) html = '<p class="fine">On iPhone and iPad: open Woodpusher in Safari, tap the Share button, then <b>Add to Home Screen</b>. It then opens like an app and also works without a connection.</p>';
  else html = '<p class="fine">To install Woodpusher as an app, open your browser’s menu and choose <b>Install app</b> or <b>Add to Home screen</b>. Chrome, Edge and Samsung Internet can, and Safari on iPhone and iPad (Share, then Add to Home Screen).</p>';
  sec.querySelector('.ins-body').innerHTML = html; sec.hidden = false;
  if (foot) foot.hidden = !(INS.prompt && !INS.installed && !insStandalone());
}
async function runInstall() {
  const p = INS.prompt; if (!p) return;
  INS.prompt = null;
  try { p.prompt(); const r = await p.userChoice; if (r && r.outcome === 'accepted') INS.installed = true; } catch (e) {}
  renderInstall();
}
// The browser's title bar follows the light or dark look
function syncThemeColor() {
  const m = document.querySelector('meta[name="theme-color"]'); if (!m) return;
  const c = getComputedStyle(document.documentElement).getPropertyValue('--leather').trim(); if (c) m.setAttribute('content', c);
}
function installBoot() {
  if (INS.wired) return; INS.wired = true;
  // Only on the Woodpusher site itself (the built page links the manifest)
  if (!document.querySelector('link[rel="manifest"]')) return;
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    const reg = () => navigator.serviceWorker.register('/sw.js').catch(() => {});
    if (document.readyState === 'complete') reg(); else window.addEventListener('load', reg);
  }
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); INS.prompt = e; renderInstall(); });
  window.addEventListener('appinstalled', () => { INS.installed = true; INS.prompt = null; renderInstall(); toast('Woodpusher is installed.'); });
  document.addEventListener('click', (e) => { if (e.target.closest('[data-install]')) { e.preventDefault(); runInstall(); } });
  syncThemeColor(); new MutationObserver(syncThemeColor).observe(document.documentElement, { attributes: true, attributeFilter: ['data-look'] });
  renderInstall();
}
window.WP_INSTALL = { boot: installBoot };

function tick() {
  const g = S.game;
  if (g && S.mode === 'play' && g.clock.running && tcById(g.tc).base) {
    if (remaining(g.clock.running) <= 0) { const c = g.clock.running; g.clock[c] = 0; flagFall(c); }
  }
  updateClock();
  requestAnimationFrame(tick);
}
function boot(hot) {
  runOpening();
  buildDefs(); wire();
  const data = (hot && hot.state) || loadLocal();
  if (data && data.settings) { Object.assign(S.settings, data.settings); Snd.on = S.settings.sound !== false; }
  if (!S.settings.elo) S.settings.elo = LEVEL_TO_ELO[S.settings.level] || ELO_DEFAULT;
  S.settings.elo = clamp(Math.round(S.settings.elo / ELO_STEP) * ELO_STEP, ELO_MIN, ELO_MAX); delete S.settings.level;
  if (!S.settings.lookChosen) S.settings.look = 'light';   // light is the default; dark only when someone picked it
  wireOpponents(); applyTheme();
  renderSetup();
  $('#boardWrap').dataset.board = curBoard();
  S.orientation = S.settings.color === 'b' ? 'b' : 'w';
  layoutBoard(); renderCoords();
  const ok = restore(data);
  if (!S.settings.lookChosen) S.settings.look = 'light'; applyTheme();   // restore() re-reads the saved settings
  if (!ok) { setMode('idle'); renderPieces(START_FEN, false); renderAll(); }
  requestAnimationFrame(tick);
  setTimeout(() => { buildOverlays(); buildQuickTextures(); scheduleTextureUpgrade(); watchZoom(); startOpening(); }, 0);
  bootEngine(); wireTrainer(); wireSettings();
  if (window.WP_ONLINE) window.WP_ONLINE.boot();
  for (const k of ['WP_IMPORT', 'WP_SYNC', 'WP_PLAYERS', 'WP_INSTALL']) if (window[k] && window[k].boot) window[k].boot();
  if (window.claude && window.claude.hot && window.claude.hot.snapshot) window.claude.hot.snapshot(() => ({ state: snapshot() }));
}
function startApp(hot) {
  if (typeof Chess === 'undefined') {
    const s = document.createElement('script'); s.src = '/chess.js'; s.onload = () => boot(hot);
    s.onerror = () => { document.querySelector('.room').insertAdjacentHTML('afterbegin', '<p style="grid-column:1/-1">The chess rules library failed to load. Reload the page to try again.</p>'); };
    document.head.appendChild(s); return;
  }
  boot(hot);
}
const startWith = (d) => startApp(d || {});
window.claude?.hot?.ready ? window.claude.hot.ready(startWith) : startWith(window.claude?.hot?.data ?? {});
