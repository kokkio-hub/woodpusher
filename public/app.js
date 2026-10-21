"use strict";
/* =====================================================================
   Constants
   ===================================================================== */
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
// Stockfish 10 has no Elo setting, so Woodpusher weakens it itself: shallower search, less time,
// and a softmax choice among the best few moves whose "temperature" rises as the rating falls.
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
  [Infinity, 'Near full strength', 'Stockfish with almost nothing held back.'],
];
const eloBand = (e) => ELO_BANDS.find(x => e < x[0]);
const eloLabel = (e) => `≈${e} · ${eloBand(e)[1]}`;
function eloParams(e) {
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
const CLS = {
  best:       { label: 'Best',       sym: '★' },
  excellent:  { label: 'Excellent',  sym: '!' },
  good:       { label: 'Good',       sym: '✓' },
  inaccuracy: { label: 'Inaccuracy', sym: '?!' },
  mistake:    { label: 'Mistake',    sym: '?' },
  blunder:    { label: 'Blunder',    sym: '??' },
  forced:     { label: 'Forced',     sym: '□' },
};
const CLS_ORDER = ['best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder'];
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
// Pure pixel generator: runs in a background worker, or on the main thread as a fallback.
function woodPixels(w, h, pal, seed, o, unit) {
  const N = makeNoise(seed); const px = new Uint8ClampedArray(w * h * 4);
  const l = pal[0], m = pal[1], k = pal[2];
  for (let y = 0; y < h; y++) {
    const ny = y / unit;
    for (let x = 0; x < w; x++) {
      const nx = x / unit;
      const warp = N.fbm(nx * 2.4, ny * 5.5, 3);
      const v = ny * o.rings + warp * o.warp + N.fbm(nx * .8 + 3.1, ny * .8, 2) * o.wave;
      const r = v - Math.floor(v);
      const g = Math.pow(Math.abs(Math.sin(r * Math.PI)), o.sharp);
      const fib = N.n2(nx * 6, ny * o.fiber);
      const fine = N.n2(nx * 14 + 9, ny * o.fiber * 2.6);
      const mot = N.fbm(nx * 3 + 7, ny * 3 + 1, 2);
      let t = g * o.gw + fib * o.fw + (fine - .5) * o.fine + (mot - .5) * o.mw + o.bias;
      if (o.pore) { const pn = N.n2(nx * 70 + 31, ny * 900); if (pn > .84) t += (pn - .84) * o.pore * 6; }
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      let a, b, f; if (t < .5) { a = l; b = m; f = t * 2; } else { a = m; b = k; f = (t - .5) * 2; }
      const i = (y * w + x) * 4;
      px[i] = a[0] + (b[0] - a[0]) * f; px[i + 1] = a[1] + (b[1] - a[1]) * f; px[i + 2] = a[2] + (b[2] - a[2]) * f; px[i + 3] = 255;
    }
  }
  return px;
}
const WOOD = {
  maple:  { pal: [[238, 214, 168], [223, 189, 136], [192, 148, 94]], seed: 11, o: { rings: 6, warp: 1.2, wave: .9, sharp: 7, fiber: 300, gw: .5, fw: .24, fine: .08, mw: .45, bias: .05, pore: 0 } },
  walnut: { pal: [[150, 99, 61], [116, 72, 42], [74, 43, 23]], seed: 23, o: { rings: 8, warp: 1.5, wave: 1.1, sharp: 5, fiber: 320, gw: .5, fw: .26, fine: .1, mw: .5, bias: .08, pore: .5 } },
  frame:  { pal: [[112, 52, 30], [84, 37, 20], [46, 19, 10]], seed: 37, o: { rings: 11, warp: 1.6, wave: 1.2, sharp: 4, fiber: 340, gw: .5, fw: .28, fine: .1, mw: .45, bias: .1, pore: .45 } },
};
const TEXGEN = { worker: null, seq: 0, pending: new Map() };
function texWorker() {
  if (TEXGEN.worker !== null) return TEXGEN.worker;
  try {
    const src = `${makeNoise.toString()}\n${woodPixels.toString()}\n${stonePixels.toString()}\nonmessage = (e) => { const d = e.data; const px = (d.gen === 'stone' ? stonePixels : woodPixels)(d.w, d.h, d.pal, d.seed, d.o, d.unit); postMessage({ id: d.id, w: d.w, h: d.h, px }, [px.buffer]); };`;
    const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    w.onmessage = (e) => { const r = TEXGEN.pending.get(e.data.id); if (r) { TEXGEN.pending.delete(e.data.id); r.resolve(e.data); } };
    w.onerror = (e) => { if (e && e.preventDefault) e.preventDefault(); for (const r of TEXGEN.pending.values()) r.reject(); TEXGEN.pending.clear(); TEXGEN.worker = false; };
    TEXGEN.worker = w;
  } catch (e) { TEXGEN.worker = false; }
  return TEXGEN.worker;
}
function pxToCanvas(w, h, px) { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; cv.getContext('2d').putImageData(new ImageData(px, w, h), 0, 0); return cv; }
function woodSync(kind, w, h, unit) { const W = WOOD[kind]; return pxToCanvas(w, h, woodPixels(w, h, W.pal, W.seed, W.o, unit)); }
function woodAsync(kind, w, h, unit) {
  const wk = texWorker(); const W = WOOD[kind];
  if (!wk) return new Promise(res => setTimeout(() => res(woodSync(kind, w, h, unit)), 0));
  return new Promise((resolve) => {
    const id = ++TEXGEN.seq;
    TEXGEN.pending.set(id, { resolve: (d) => resolve(pxToCanvas(d.w, d.h, new Uint8ClampedArray(d.px))), reject: () => resolve(woodSync(kind, w, h, unit)) });
    wk.postMessage({ id, w, h, pal: W.pal, seed: W.seed, o: W.o, unit });
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
const TEX = { level: { sq: 0, frame: 0, clock: 0 }, busy: false, again: false };
const roundUp = (v, step) => Math.ceil(v / step) * step;
// Texture sizes the current layout needs, in device pixels
function textureNeeds() {
  const dpr = DPR(); const inner = boardEl().getBoundingClientRect().width || boardPx * .9; const wrap = $('#boardWrap').getBoundingClientRect().width || boardPx;
  const cw = $('#clockStand').getBoundingClientRect().width || 360;
  return {
    sq: clamp(roundUp(inner * dpr / 8 / .36, 128), 384, 1280),
    frame: clamp(roundUp(wrap * dpr, 128), 512, 2304),
    clock: clamp(Math.ceil(cw * dpr / 400 * 4) / 4, 1, 3),
  };
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
// Quick low-resolution pass for the first paint
function buildQuickTextures() {
  TEX.maple = woodSync('maple', 256, 256, 256); TEX.walnut = woodSync('walnut', 256, 256, 256);
  const fw = 640, st = frameStrip(fw); TEX.frame = woodSync('frame', fw, st.h, fw / 1.6);
  drawFrame(); drawBoardCanvas();
}
// Sharp pass in the background, sized to the screen; re-runs when the board grows or the zoom changes
async function upgradeTextures() {
  if (TEX.busy) { TEX.again = true; return; }
  const need = textureNeeds(); const L = TEX.level; const jobs = [];
  TEX.busy = true;
  try {
    if (need.sq > L.sq) jobs.push(Promise.all([woodAsync('maple', need.sq, need.sq, need.sq), woodAsync('walnut', need.sq, need.sq, need.sq)]).then(([a, b]) => { TEX.maple = a; TEX.walnut = b; L.sq = need.sq; drawBoardCanvas(); }));
    if (need.frame > L.frame) { const st = frameStrip(need.frame); jobs.push(woodAsync('frame', need.frame, st.h, need.frame / 1.6).then(cv => { TEX.frame = cv; L.frame = need.frame; drawFrame(); })); }
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
const figSVG = (t) => `<svg class="fig" aria-hidden="true"><use href="#fig-${t}"/></svg>`;
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
  wood:   { name: 'Walnut & maple', swatch: ['#e3c590', '#8a5a36'] },
  marble: { name: 'Marble', swatch: ['#f1efea', '#3d6458'] },
  slate:  { name: 'Slate', swatch: ['#b3bbc1', '#414a54'] },
  paper:  { name: 'Diagram', swatch: ['#f6f1e6', '#cbbfa8'] },
  flat:   { name: 'Bauhaus', swatch: ['#ece6da', '#7d978f'] },
  glass:  { name: 'Glass', swatch: ['#8ea2b8', '#34475f'] },
};
const BOARD_ORDER = ['wood', 'marble', 'slate', 'paper', 'flat', 'glass'];
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
  const want = textureNeeds().sq;
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
  const b = curBoard(); if (b === 'wood') return false;
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
  const b = curBoard(); if (b === 'wood') return false;
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

/* ---------------- settings menu ---------------- */
function applyLook() {
  const wrap = $('#boardWrap'); wrap.dataset.board = curBoard();
  pieceEls.forEach(p => { p.el.innerHTML = pieceSVG(p.code); });
  document.querySelectorAll('[data-pc]').forEach(el => { el.innerHTML = pieceSVG(el.dataset.pc); });
  ensureStone(curBoard());
  drawFrame(); drawBoardCanvas(); renderAll();
}
function previewHTML(styleId) {
  const b = BOARDS[PIECE_STYLES[styleId].board]; const sv = (c) => pieceSVGStyled(c, styleId);
  return `<span class="sp-prev" style="--l:${b.swatch[0]};--d:${b.swatch[1]}"><span>${sv('wK')}</span><span>${sv('bN')}</span><span>${sv('wP')}</span><span>${sv('bQ')}</span></span>`;
}
function renderSettings() {
  const st = curStyle(), bd = curBoard();
  $('#styleGrid').innerHTML = STYLE_ORDER.map(id => `<button class="style-card" data-style="${id}" aria-pressed="${id === st}">${previewHTML(id)}<b>${esc(PIECE_STYLES[id].name)}</b><small>${esc(PIECE_STYLES[id].note)}</small></button>`).join('');
  $('#boardGrid').innerHTML = BOARD_ORDER.map(id => `<button class="board-card" data-board="${id}" aria-pressed="${id === bd}"><span class="bd-prev bd-${id}" style="--l:${BOARDS[id].swatch[0]};--d:${BOARDS[id].swatch[1]}"></span><span>${esc(BOARDS[id].name)}</span></button>`).join('');
  $('#setSound').checked = Snd.on;
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
  $('#setSound').addEventListener('change', (e) => { Snd.on = e.target.checked; S.settings.sound = Snd.on; if (Snd.on) Snd.move(); save(); });
}

/* =====================================================================
   You: an estimated Elo from your games against Stockfish and the accuracy
   of your reviewed games (kept in this browser only), plus your account
   and online ratings when the Woodpusher server is there.
   ===================================================================== */
const HIST_KEY = 'woodpusher.history.v1';
const HIST_MAX = 120;
const HIST = (() => {
  try { const h = JSON.parse(localStorage.getItem(HIST_KEY)); if (h && Array.isArray(h.games)) return h; } catch (e) {}
  return { v: 1, games: [] };            // newest first
})();
function saveHist() { if (HIST.games.length > HIST_MAX) HIST.games.length = HIST_MAX; try { localStorage.setItem(HIST_KEY, JSON.stringify(HIST)); } catch (e) {} }
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
  if (me) action = `<button class="btn btn-small" data-user="logout">Log out</button>`;
  else if (online && !checking) action = `<button class="btn btn-brass btn-small" data-user="login">Log in or create an account</button>`;
  el.innerHTML = `
    <div class="you"><span class="you-ic" aria-hidden="true">${pieceSVG('wK')}</span><span class="you-text"><span class="you-name">${esc(name)}</span>${sub ? `<span class="you-sub">${esc(sub)}</span>` : ''}</span></div>
    <div class="est"><small>Estimated Elo</small><b>${!est ? '–' : est.above ? ELO_MAX + '+' : '≈' + est.elo}</b><span class="chip">${est ? est.confidence : 'No games yet'}</span></div>
    <p class="fine user-detail">${esc(detail)}${online ? '' : ' Accounts and online ratings live on the Woodpusher website.'}</p>
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
   wiped in, the logo flies into the top bar while the backdrop fades and
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
    const k = H.height / S.height;
    const dx = (H.left + H.width / 2) - (S.left + S.width / 2), dy = (H.top + H.height / 2) - (S.top + S.height / 2);
    el.querySelector('.op-bg').animate([{ opacity: 1 }, { opacity: 0 }], { duration: 520, delay: 80, easing: 'ease-in-out', fill: 'forwards' });
    reveal(620);
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
  if (!BOOKS[id]) BOOKS[id] = fetch(BOOK_BASE + id + '.json').then(r => (r.ok ? r.json() : null)).catch(() => null);
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
function pickPersonaLine(p, fen, lines, P) {
  const ls = lines.filter(l => l && l.pv && l.pv.length); if (!ls.length) return null;
  const sc = ls.map(lineScore); const best = Math.max(...sc);
  const window = Math.max(30, P.temp * 1.5);
  const cand = ls.map((l, i) => ({ l, s: sc[i] })).filter(x => x.s >= best - window);
  const T = Math.max(P.temp, 8);
  const ut = cand.map(x => x.s + (Math.abs(x.s) < 5000 ? styleBonus(p, fen, x.l) : 0));
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
    $('#oppModal').hidden = true; renderSetup(); renderPlates(); renderSheet(); setClockNames(); save(); $('#oppPick').focus();
  });
  if (!personaById(S.settings.opp)) S.settings.opp = null; else loadBook(S.settings.opp);
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
  settings: { color: 'w', elo: 1200, opp: null, tc: '3+2', sound: true, pieces: 'wood', board: 'wood' },
  line: null,                // { startFen, fens[], moves[], names{w,b}, subs{w,b}, headers, result, reason, source }
  game: null,                // { playerColor, level, tc, clock:{w,b,running,last}, lastEngineScore }
  chess: null,               // live chess.js game
  view: 0,
  orientation: 'w',
  sel: null, legal: [],
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
  if (wide) size = Math.min(vw - 32 - 360 - 30 - evw, vh - 190, 700);
  else size = Math.min(vw - 32 - evw, 620);
  size = Math.max(250, Math.floor(size));
  document.documentElement.style.setProperty('--bw', size + 'px');
  document.documentElement.style.setProperty('--evw', evw + 'px');
  boardPx = size;
  requestAnimationFrame(() => {
    const inner = boardEl().getBoundingClientRect().width;
    boardEl().style.setProperty('--sq', (inner / 8) + 'px');
    drawFrame(); drawBoardCanvas();
    if (TEX.maple) scheduleTextureUpgrade();
  });
}
function hash32(n) { n = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b); n ^= n >>> 13; n = Math.imul(n, 0xc2b2ae35); n ^= n >>> 16; return (n >>> 0) / 4294967296; }
function drawBoardCanvas() {
  const cv = $('#boardCanvas'); const rect = boardEl().getBoundingClientRect();
  const dpr = DPR(); const W = Math.round(rect.width * dpr);
  if (!W) return;
  cv.width = cv.height = W; const ctx = cv.getContext('2d'); const sq = W / 8;
  if (paintOtherBoard(ctx, W, sq, dpr)) return;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const light = (r + c) % 2 === 0; const x = c * sq, y = r * sq;
    const name = crToSq(c, r); const id = (name.charCodeAt(0) - 97) + (+name[1]) * 8;
    ctx.save(); ctx.imageSmoothingQuality = 'high'; ctx.beginPath(); ctx.rect(x, y, sq, sq); ctx.clip();
    const tex = light ? TEX.maple : TEX.walnut;
    if (tex) {
      const src = tex.width * .36; const sx = hash32(id * 3 + 1) * (tex.width - src), sy = hash32(id * 7 + 2) * (tex.height - src);
      const rot = ((+name[1]) + (name.charCodeAt(0) - 97)) % 4 < 2;
      if (rot) { ctx.translate(x + sq / 2, y + sq / 2); ctx.rotate(Math.PI / 2); ctx.drawImage(tex, sx, sy, src, src, -sq / 2, -sq / 2, sq, sq); }
      else ctx.drawImage(tex, sx, sy, src, src, x, y, sq, sq);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const tone = (hash32(id * 13 + 5) - .5) * .12;
      ctx.fillStyle = tone > 0 ? `rgba(255,236,200,${tone})` : `rgba(40,18,6,${-tone})`;
      ctx.fillRect(x, y, sq, sq);
    } else {
      ctx.fillStyle = light ? '#e3c590' : '#7a4c2b'; ctx.fillRect(x, y, sq, sq);
    }
    ctx.restore();
  }
  ctx.imageSmoothingQuality = 'high';
  ctx.strokeStyle = 'rgba(32,14,4,.5)'; ctx.lineWidth = Math.max(1, dpr * .8);
  ctx.beginPath();
  for (let i = 1; i < 8; i++) { ctx.moveTo(i * sq, 0); ctx.lineTo(i * sq, W); ctx.moveTo(0, i * sq); ctx.lineTo(W, i * sq); }
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
    if (TEX.frame) {
      const t = TEX.frame; const st = frameStrip(t.width); const sy = st.gap + i * (st.band + st.gap); const sh = t.width * .048;
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
  const layer = $('#pieceLayer'); const map = boardMap(fen);
  const want = Object.entries(map); const used = new Set(); const keep = [];
  const remaining = [];
  for (const p of pieceEls) {
    if (map[p.sq] === p.code && !used.has(p.sq)) { used.add(p.sq); keep.push(p); } else remaining.push(p);
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
    if (best && cls && cls !== 'best' && cls !== 'forced') out += arrowPath(best.slice(0, 2), best.slice(2, 4), 'var(--c-best)');
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

// ---- input: click and drag
let dragState = null;
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
  S.sel = sq; S.legal = sq ? S.chess.moves({ square: sq, verbose: true }) : []; renderHighlights();
}
function onPointerDown(e) {
  if (e.button !== undefined && e.button !== 0) return;
  if (!canUserMove()) { if (S.sel) selectSq(null); return; }
  const sq = sqFromEvent(e); if (!sq) return;
  const piece = S.chess.get(sq);
  if (S.sel && S.legal.some(m => m.to === sq)) { tryUserMove(S.sel, sq); return; }
  if (piece && piece.color === S.chess.turn()) {
    const wasSel = S.sel === sq; selectSq(sq);
    const p = pieceEls.find(x => x.sq === sq);
    dragState = { from: sq, startX: e.clientX, startY: e.clientY, active: false, el: p ? p.el : null, ghost: null, wasSel, hover: null, pid: e.pointerId };
    try { boardEl().setPointerCapture(e.pointerId); } catch (_) {}
    e.preventDefault();
  } else if (S.sel) selectSq(null);
}
function onPointerMove(e) {
  if (!dragState) return;
  if (!dragState.active) {
    if (Math.hypot(e.clientX - dragState.startX, e.clientY - dragState.startY) < 5) return;
    dragState.active = true;
    const g = document.createElement('div'); g.className = 'ghost'; g.innerHTML = pieceSVG(S.chess.get(dragState.from).color + S.chess.get(dragState.from).type.toUpperCase());
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
  if (cands.some(m => m.promotion)) { openPromo(from, to); return; }
  commitUserMove(from, to);
}
function openPromo(from, to) {
  S.promoPending = true; const el = $('#promo'); const color = S.chess.turn(); const [c, r] = sqToCR(to);
  const top = r === 0; el.style.left = (c * 12.5) + '%'; el.style.top = top ? '0' : 'auto'; el.style.bottom = top ? 'auto' : '0';
  el.innerHTML = ['q', 'r', 'b', 'n'].map(p => `<button data-p="${p}" aria-label="Promote to ${({ q: 'queen', r: 'rook', b: 'bishop', n: 'knight' })[p]}">${pieceSVG(color + p.toUpperCase())}</button>`).join('');
  if (!top) el.style.flexDirection = 'column-reverse'; else el.style.flexDirection = 'column';
  el.hidden = false; el.querySelector('button').focus();
  el.onclick = (ev) => { const b = ev.target.closest('button'); if (!b) return; closePromo(); commitUserMove(from, to, b.dataset.p); };
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
   The clock: twin dials in a walnut case, flags rise near twelve
   ===================================================================== */
const CLOCK = { ready: false };
function buildClock() {
  const row = (pos) => `<div class="dc-row" id="dc${pos}"><span class="dc-ic" id="dcIc${pos}" aria-hidden="true"></span><span class="dc-name" id="dcName${pos}"></span><span class="dc-time" id="dcTime${pos}">0:00</span></div>`;
  $('#clockStand').innerHTML = `<div class="dclock" role="group" aria-label="Chess clock">${row('Top')}${row('Bot')}</div>`;
  CLOCK.ready = true;
}
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
let lastClockText = {};
// The clock next to the board mirrors the board: the top row belongs to the player at the top
const clockColors = () => (S.orientation === 'w' ? { Top: 'b', Bot: 'w' } : { Top: 'w', Bot: 'b' });
function updateClock() {
  if (!CLOCK.ready) return;
  const g = S.game; const tc = g ? tcById(g.tc) : tcById(S.mode === 'online' && window.WP_ONLINE ? window.WP_ONLINE.tc() : S.settings.tc);
  const timed = tc.base > 0; const live = S.mode === 'play' || S.mode === 'online';
  const cols = clockColors();
  for (const pos of ['Top', 'Bot']) {
    const color = cols[pos];
    const rem = g ? Math.max(0, remaining(color)) : tc.base * 1000;
    const txt = timed ? fmtTime(rem, true) : '∞';
    if (lastClockText[pos] !== txt) { $('#dcTime' + pos).textContent = txt; lastClockText[pos] = txt; }
    const row = $('#dc' + pos);
    row.classList.toggle('on', !!(g && live && g.clock.running === color));
    row.classList.toggle('low', !!(timed && g && rem > 0 && rem < 20000));
    row.classList.toggle('out', !!(timed && g && rem <= 0));
  }
  // plate chips (phones)
  document.querySelectorAll('.tchip').forEach(ch => {
    const color = ch.dataset.color; const rem = g ? Math.max(0, remaining(color)) : tc.base * 1000;
    const txt = timed ? fmtTime(rem, true) : '∞'; if (ch.textContent !== txt) ch.textContent = txt;
    const on = g && live && g.clock.running === color; ch.classList.toggle('on', !!on);
    ch.classList.toggle('low', !!(timed && g && rem < 20000 && live));
  });
}
function setClockNames() {
  if (!CLOCK.ready) return;
  const L = S.line; const cols = clockColors();
  const nm = (c) => (L ? L.names[c] : S.mode === 'online' ? (c === 'w' ? 'White' : 'Black') : (c === S.settings.color || (S.settings.color === 'r' && c === 'w') ? 'You' : botName(curPersona())));
  for (const pos of ['Top', 'Bot']) {
    const c = cols[pos]; $('#dcName' + pos).textContent = String(nm(c)).replace(/ style$/, '');
    const ic = $('#dcIc' + pos); if (ic.dataset.c !== c) { ic.innerHTML = pieceSVG(c + 'K'); ic.dataset.c = c; }
  }
}

/* =====================================================================
   Engine: Stockfish 10 in a Web Worker (WebAssembly first, asm.js fallback)
   ===================================================================== */
const ENGINE_SOURCES = [
  { url: '/stockfish.js', label: 'WebAssembly' },
  { url: '/stockfish.asm.js', label: 'asm.js' },
  { url: 'https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js', label: 'asm.js', blob: true },
];
function spawnWorker(src) {
  if (src.blob) return new Worker(URL.createObjectURL(new Blob([`importScripts(${JSON.stringify(src.url)});`], { type: 'text/javascript' })));
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
    this.w = worker; this.q = []; this.cur = null; this.skill = null; this.mpv = 1; this.contempt = 24;
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
    const ct = job.contempt == null ? 24 : job.contempt; if (ct !== this.contempt) { this.send(`setoption name Contempt value ${ct}`); this.contempt = ct; }
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
      if (w) { ENG.source = src; ENG.main = new Engine(w); ENG.pool = [ENG.main]; ENG.status = 'ok'; setEngineStatus(`Stockfish 10 ready · ${src.label}`, 'ok'); return ENG.main; }
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
  S.view = 0; S.sel = null; S.legal = []; S.orientation = pc; S.review = null; S.bannerOpen = false;
  if (ENG.main) ENG.main.send('ucinewgame');
  setMode('play');
  renderCoords(); renderPieces(START_FEN, false); renderAll();
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
  S.view = liveIndex();
  if (S.chess.in_check()) Snd.check(); else if (mv.captured) Snd.capture(); else Snd.move();
  if (tc.base) Snd.press();
  renderPieces(L.fens[S.view]); renderAll();
  announce(`${mv.color === g.playerColor ? 'You' : botName(personaById(g.opp))} played ${spokenSan(mv.san)}.`);
  const end = checkEnd(mv);
  if (end) { finishGame(end.result, end.reason); return; }
  if (S.chess.turn() !== g.playerColor) engineMove();
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
    const res = await eng.search({ fen, depth: P.depth, movetime: mt, skill: 20, multipv: persona ? Math.max(4, P.multipv) : P.multipv, contempt: persona ? persona.w.contempt : undefined });
    if (token !== S.engineToken || S.mode !== 'play') return;
    if (!res || !res.bestmove) { setThinking(false); return; }
    const pick = persona ? pickPersonaLine(persona, fen, res.lines || [], P) : P.multipv > 1 ? pickByTemperature(res.lines || [], P.temp) : null;
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
function setThinking(on) { S.thinking = on; renderPlates(); boardEl().classList.toggle('can-move', canUserMove()); }
function finishGame(result, reason) {
  const L = S.line, g = S.game;
  L.result = result; L.reason = reason;
  if (g) { if (g.clock.running && tcById(g.tc).base) { g.clock[g.clock.running] = Math.max(0, remaining(g.clock.running)); } g.clock.running = null; }
  S.engineToken++; if (ENG.main) ENG.main.cancelAll(); S.thinking = false;
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
  S.game = null; S.chess = null; S.line = null; S.review = null; S.view = 0; S.bannerOpen = false; S.thinking = false;
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
  $('#setupCard').hidden = m !== 'idle';
  $('#reviewCta').hidden = m !== 'idle';
  $('#playActions').hidden = m !== 'play';
  $('#pausedActions').hidden = m !== 'paused';
  $('#overActions').hidden = m !== 'over';
  $('#reviewPanel').hidden = m !== 'review';
  $('#clockStand').hidden = m === 'review' || m === 'puzzle' || m === 'lesson';
  $('#puzzlePanel').hidden = m !== 'puzzle';
  $('#lessonPanel').hidden = m !== 'lesson';
  $('#onlinePanel').hidden = m !== 'online';
  const tab = m === 'online' || (m === 'review' && S.line && S.line.source === 'online') ? 'btnOnline' : m === 'puzzle' ? 'btnPuzzles' : m === 'lesson' ? 'btnOpenings' : m === 'review' && S.line && S.line.source === 'pgn' ? 'btnImport' : 'btnNew';
  document.querySelectorAll('.tab').forEach(t => { if (t.id === tab) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current'); });
  $('#evalBar').hidden = m !== 'review';
  $('#overActions').querySelector('#btnRematch').hidden = !(S.line && S.line.source === 'play');
  if ((prev === 'review') !== (m === 'review')) layoutBoard();
  disarm();
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
    return `<div class="who"><span class="pc-ic">${pieceSVG(c + 'K')}</span><span class="who-text"><span class="who-name">${esc(n)}</span><span class="who-sub">${sub}</span></span></div>
      <div class="plate-right"><span class="caps" aria-label="Captured pieces">${caps[c].map(p => pieceSVG(p)).join('')}${adv > 0 ? `<span class="adv">+${adv}</span>` : ''}</span>${['idle', 'play', 'paused', 'over', 'online'].includes(S.mode) ? `<span class="tchip" data-color="${c}"></span>` : ''}</div>`;
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
  if (S.mode === 'play' && S.view < n) note.textContent = 'Looking back. Press → or End to return to the game.';
  else if (S.mode === 'paused') note.textContent = 'Game paused. Your clocks are stopped.';
  else if (S.mode === 'puzzle' && T.kind === 'puzzle' && PZ.p) note.textContent = ({ intro: 'Watch the opponent\u2019s move…', solving: `Your turn: find the best move for ${colorName(PZ.color)}.`, reply: 'Correct! Keep going…', wrong: 'Not this one. Try again.', solved: 'Solved!', solvedHelp: 'Solved with help.', showing: 'Showing the solution…', shown: 'Solution shown.' })[PZ.state] || '';
  else if (S.mode === 'lesson' && T.kind === 'lesson' && LS.line && LS.phase === 'practice') note.textContent = ({ await: `Your move as ${colorName(LS.color)}.`, reply: 'Opponent to move…', wrong: 'Not the book move. Try again.', done: 'Line complete.' })[LS.state] || '';
  else if (S.mode === 'online' && window.WP_ONLINE) note.textContent = window.WP_ONLINE.note();
  else if (S.mode === 'play' && S.game && S.game.note && S.view === n) note.textContent = S.game.note;
  else if (S.mode === 'idle') note.textContent = '';
  else note.textContent = '';
}
function renderAll() {
  renderPlates(); renderSheet(); renderHighlights(); renderBanner(); renderNav(); setClockNames(); updateClock();
  if (S.mode === 'review') renderReview();
  if (S.mode === 'puzzle' || S.mode === 'lesson') renderTrainer();
  if (S.mode === 'online' && window.WP_ONLINE) window.WP_ONLINE.render();
  boardEl().classList.toggle('can-move', canUserMove());
}
function goTo(ply, animate = true) {
  if (!S.line) return; ply = clamp(ply, 0, liveIndex()); if (ply === S.view) return;
  S.view = ply; S.sel = null; S.legal = []; closePromo();
  renderPieces(S.line.fens[ply], animate); renderAll();
  if ((S.mode === 'review' || S.mode === 'lesson') && ply > 0) { const mv = S.line.moves[ply - 1]; if (mv.captured) Snd.clack(.5, 1300); else Snd.clack(.4, 1600); }
}
function flip() { S.orientation = S.orientation === 'w' ? 'b' : 'w'; renderCoords(); repositionAll(); drawBoardCanvas(); renderAll(); }
function announce(t) { const l = $('#live'); l.textContent = ''; setTimeout(() => { l.textContent = t; }, 30); }
let toastTimer = null;
function toast(msg) { const host = $('#toastHost'); host.innerHTML = `<div class="toast" role="status">${esc(msg)}</div>`; clearTimeout(toastTimer); toastTimer = setTimeout(() => { host.innerHTML = ''; }, 3200); }
let armed = null;
function armOrRun(btn, label, fn) {
  if (armed === btn) { disarm(); fn(); return; }
  disarm(); armed = btn; btn.dataset.label = btn.textContent; btn.textContent = label; btn.classList.add('armed');
  armed.timer = setTimeout(disarm, 3500);
}
function disarm() { if (!armed) return; clearTimeout(armed.timer); armed.textContent = armed.dataset.label; armed.classList.remove('armed'); armed = null; }

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
    S.review = { key, evals: [], best: [], pv: [], cls: [], acc: [], token: 0, done: false };
  }
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
  const fast = ENG.source && ENG.source.label === 'WebAssembly';
  const depth = 15, movetime = fast ? 1400 : 1000;
  let next = 0;
  const work = async (eng) => {
    while (true) {
      if (token !== R.token || S.mode !== 'review') return;
      const i = next++; if (i >= n) return;
      if (R.evals[i]) continue;
      const term = terminalEval(L.fens[i], i === n - 1, L);
      if (term) { R.evals[i] = term; R.best[i] = null; R.pv[i] = []; onEval(); continue; }
      const res = await eng.search({ fen: L.fens[i], depth, movetime, skill: 20 });
      if (token !== R.token) return;
      if (!res) { next = Math.min(next, i); return; }
      const stm = L.fens[i].split(' ')[1] === 'w' ? 1 : -1; const info = res.info || { cp: 0, pv: [] };
      R.evals[i] = info.mate != null ? { mate: info.mate * stm } : { cp: (info.cp || 0) * stm };
      R.best[i] = res.bestmove; R.pv[i] = info.pv || [];
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
    // Early opening: shallow engine noise shouldn't brand normal theory as inaccurate
    if (i < 10 && cls === 'inaccuracy') cls = 'good';
    if (L.moves[i].san.includes('#')) cls = 'best';
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
  $('#rvText').textContent = got < n ? `Analysing ${got} of ${n} positions · depth 15` : `Analysed ${n} positions · depth 15`;
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
}
const shortName = (s) => s.length > 14 ? s.slice(0, 13) + '…' : s;
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
  R.cls.forEach((c, i) => { if ((c === 'mistake' || c === 'blunder') && R.evals[i + 1]) { const x = (i + 1) / Math.max(1, n - 1) * 100; const y = (100 - whiteWin(R.evals[i + 1])); dots += `<span class="gdot" style="left:${x}%;top:${clamp(y, 4, 96)}%;--cc:var(--c-${c})"></span>`; } });
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
  const ev = R.evals[v]; const evTxt = fmtEval(ev); const whiteish = ev && whiteWin(ev) >= 50;
  const evChip = `<span class="annot-eval${whiteish ? ' wht' : ''}">${evTxt}</span>`;
  if (v === 0) {
    const keys = keyMoments().length;
    el.style.removeProperty('--cc');
    el.innerHTML = `<div class="annot-top"><span class="annot-badge" style="--cc:var(--ink-soft)">♙</span><span class="annot-title">Starting position</span>${evChip}</div>
      <p class="annot-body">${R.done ? `Step through with → or click any move on the score sheet. ${keys ? `There ${keys === 1 ? 'is 1 moment' : `are ${keys} moments`} worth a closer look.` : 'A clean game: no inaccuracies at all.'}` : 'Stockfish is working through the game. You can step through the moves while it runs.'}</p>`;
    return;
  }
  const i = v - 1; const mv = L.moves[i]; const cls = R.cls[i];
  const mover = mv.color === 'w' ? L.names.w : L.names.b;
  if (!cls) {
    el.innerHTML = `<div class="annot-top"><span class="annot-badge">…</span><span class="annot-title">${moveLabel(i)} ${sanHTML(mv.san)}</span>${evChip}</div><p class="annot-body">Stockfish hasn't reached this move yet.</p>`;
    return;
  }
  const bestSan = uciToSan(L.fens[i], R.best[i]);
  const sanH = `<b>${sanHTML(mv.san)}</b>`, bestH = bestSan ? `<b>${sanHTML(bestSan)}</b>` : '';
  const pre = R.evals[i], post = R.evals[i + 1]; const sgn = mv.color === 'w' ? 1 : -1;
  let text = {
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
  const evLine = pre && post && !mv.san.includes('#') ? `Evaluation ${fmtEval(pre)} → ${fmtEval(post)}` : '';
  const pvLine = cls !== 'best' && cls !== 'forced' && R.pv[i] && R.pv[i].length ? `<p class="annot-line">Best line: ${pvToSan(L.fens[i], R.pv[i])}</p>` : '';
  el.innerHTML = `<div class="annot-top"><span class="annot-badge" style="--cc:var(--c-${cls})">${CLS[cls].sym}</span><span class="annot-title">${moveLabel(i)} ${sanHTML(mv.san)} · ${esc(CLS[cls].label)}</span>${evChip}</div>
    <p class="annot-body">${text} ${note}</p>${evLine ? `<p class="annot-line">${esc(mover)} · ${evLine}</p>` : ''}${pvLine}`;
}
function moveLabel(i) { const L = S.line; const p = L.startFen.split(' '); const off = p[1] === 'b' ? 1 : 0; const no = (+p[5] || 1) + Math.floor((i + off) / 2); return (i + off) % 2 === 0 ? `${no}.` : `${no}…`; }
function exitReview() {
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
function loadPGNForReview(text) {
  const p = parsePGN(text); trainerStop();
  const nm = (c) => { const n = p.headers[c === 'w' ? 'White' : 'Black']; return n && n !== '?' ? n : (c === 'w' ? 'White' : 'Black'); };
  const elo = (c) => p.headers[c === 'w' ? 'WhiteElo' : 'BlackElo'];
  S.engineToken++; if (ENG.main) ENG.main.cancelAll();
  S.game = null; S.chess = null;
  S.line = newLine(p.startFen, { w: nm('w'), b: nm('b') }, { w: elo('w') ? `White · ${elo('w')}` : 'White', b: elo('b') ? `Black · ${elo('b')}` : 'Black' }, { headers: p.headers, result: p.result, reason: p.reason, source: 'pgn' });
  S.line.fens = p.fens; S.line.moves = p.moves;
  S.orientation = 'w'; S.review = null; renderCoords(); drawBoardCanvas();
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
    line: L ? { startFen: L.startFen, sans: L.moves.map(m => m.san), names: L.names, subs: L.subs, headers: L.headers, result: L.result, reason: L.reason, source: L.source } : null,
    game: g ? { playerColor: g.playerColor, elo: g.elo, opp: g.opp || null, inBook: !!g.inBook, tc: g.tc, histId: g.histId, takebacks: g.takebacks || 0, clock: { w: Math.max(0, remaining('w')), b: Math.max(0, remaining('b')), running: g.clock.running } } : null,
    review: S.review ? { key: S.review.key, evals: S.review.evals, best: S.review.best, pv: S.review.pv } : null,
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
    S.line = Object.assign(newLine(d.line.startFen, d.line.names, d.line.subs), { headers: d.line.headers || {}, result: d.line.result, reason: d.line.reason, source: d.line.source });
    S.line.fens = fens; S.line.moves = moves; S.chess = c;
    if (d.game) S.game = { playerColor: d.game.playerColor, elo: d.game.elo || LEVEL_TO_ELO[d.game.level] || ELO_DEFAULT, opp: personaById(d.game.opp) ? d.game.opp : null, inBook: !!d.game.inBook, tc: d.game.tc, histId: d.game.histId, takebacks: d.game.takebacks || 0, clock: { w: d.game.clock.w, b: d.game.clock.b, running: d.game.clock.running, last: performance.now() }, lastEngineScore: null };
    S.orientation = d.orientation || 'w';
    S.view = clamp(d.view ?? fens.length - 1, 0, fens.length - 1);
    if (d.review && d.review.key === lineKey(S.line)) S.review = { key: d.review.key, evals: d.review.evals || [], best: d.review.best || [], pv: d.review.pv || [], cls: [], acc: [], token: 0, done: false };
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
  $('#btnNew').addEventListener('click', (e) => {
    if (S.mode === 'play' && S.line && S.line.moves.length) { armOrRun(e.currentTarget, 'Abandon this game?', abandonGame); return; }
    if (S.mode === 'review') { if (S.review) S.review.token++; ENG.pool.forEach(x => x.cancelAll()); }
    abandonGame();
  });
  const openImport = () => { $('#pgnErr').hidden = true; $('#pgnModal').hidden = false; $('#pgnInput').focus(); };
  $('#btnImport').addEventListener('click', openImport); $('#btnImport2').addEventListener('click', openImport);
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
  b.addEventListener('contextmenu', e => e.preventDefault());
  document.addEventListener('keydown', e => {
    if (e.target.closest('textarea, input')) return;
    if (e.key === 'Escape') { document.querySelectorAll('.modal-back').forEach(m => m.hidden = true); if (S.promoPending) { closePromo(); renderHighlights(); } if (S.sel) selectSq(null); return; }
    if (!document.querySelectorAll('.modal-back:not([hidden])').length) {
      if (e.key === 'ArrowLeft') { goTo(S.view - 1); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { goTo(S.view + 1); e.preventDefault(); }
      else if (e.key === 'Home') { goTo(0); e.preventDefault(); }
      else if (e.key === 'End') { goTo(liveIndex()); e.preventDefault(); }
      else if (e.key === 'f' || e.key === 'F') flip();
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
function saveProg() { try { localStorage.setItem(PROG_KEY, JSON.stringify(PROG)); } catch (e) {} }

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
const PZDATA = (typeof PUZZLES !== 'undefined' ? PUZZLES : []).map((x, i) => ({ id: 'p' + i, fen: x[0], moves: x[1].split(' '), rating: x[2], themes: x[3] ? x[3].split(',') : [] }));
const PZ = { p: null, step: 0, color: 'w', state: 'idle', failed: false, usedHint: false, rated: false, delta: null, theme: 'all' };
function themeOk(p, th) {
  if (th === 'all') return true;
  if (th === 'Mate in 3+') return p.themes.some(t => /^Mate in [3-9]/.test(t));
  return p.themes.includes(th);
}
function pickPuzzle() {
  const r = PROG.pz.rating;
  let pool = PZDATA.filter(p => themeOk(p, PZ.theme) && !(p.id in PROG.pz.seen) && (!PZ.p || p.id !== PZ.p.id));
  if (!pool.length) pool = PZDATA.filter(p => themeOk(p, PZ.theme) && (!PZ.p || p.id !== PZ.p.id));
  if (!pool.length) pool = PZDATA.slice();
  pool.sort((a, b) => Math.abs(a.rating - r) - Math.abs(b.rating - r));
  const near = pool.slice(0, Math.min(6, pool.length));
  return near[Math.floor(Math.random() * near.length)];
}
function openPuzzles() {
  if (!PZDATA.length) { toast('No puzzles are available.'); return; }
  startPuzzle(pickPuzzle());
}
function startPuzzle(p, retry = false) {
  clearTimers(); T.kind = 'puzzle'; T.hint = 0; T.wrong = null; T.right = null;
  PZ.p = p; PZ.step = 0; PZ.state = 'intro'; PZ.usedHint = false;
  if (!retry) { PZ.failed = false; PZ.rated = false; PZ.delta = null; }
  const solver = p.fen.split(' ')[1] === 'w' ? 'b' : 'w'; PZ.color = solver;
  S.game = null; S.review = null; S.chess = new Chess(p.fen); S.bannerOpen = false;
  S.line = newLine(p.fen, { w: 'White', b: 'Black' }, { w: solver === 'w' ? 'You' : 'Puzzle', b: solver === 'b' ? 'You' : 'Puzzle' }, { source: 'puzzle' });
  S.orientation = solver; S.view = 0; S.sel = null; S.legal = [];
  setMode('puzzle'); renderCoords(); drawBoardCanvas(); renderPieces(p.fen, false); renderAll();
  tLater(() => { playUci(p.moves[0]); PZ.step = 1; PZ.state = 'solving'; renderAll(); }, 700);
}
function puzzleMove(mv) {
  const exp = PZ.p.moves[PZ.step]; const last = PZ.step === PZ.p.moves.length - 1;
  if (sameMove(mv, exp) || (last && S.chess.in_checkmate())) {
    T.wrong = null; T.hint = 0; T.right = mv.to; PZ.step++;
    PZ.state = PZ.step >= PZ.p.moves.length ? 'finishing' : 'reply';
    pushTrainerMove(mv);
    if (PZ.state === 'finishing') { puzzleDone(); return; }
    tLater(() => { T.right = null; playUci(PZ.p.moves[PZ.step]); PZ.step++; PZ.state = 'solving'; renderAll(); }, 500);
  } else {
    T.wrong = mv.to; PZ.failed = true; PZ.state = 'wrong'; pushTrainerMove(mv);
    tLater(() => { T.wrong = null; popTrainerMove(); PZ.state = 'solving'; renderAll(); }, 900);
  }
}
function ratePuzzle() {
  if (PZ.rated) return; PZ.rated = true;
  const win = !PZ.failed && !PZ.usedHint; const r = PROG.pz.rating, pr = PZ.p.rating;
  const exp = 1 / (1 + Math.pow(10, (pr - r) / 400)); const K = PROG.pz.tried < 10 ? 40 : 20;
  const d = Math.round(K * ((win ? 1 : 0) - exp));
  PROG.pz.rating = Math.max(400, r + d); PZ.delta = d; PROG.pz.tried++;
  if (win) { PROG.pz.solved++; PROG.pz.streak++; PROG.pz.best = Math.max(PROG.pz.best, PROG.pz.streak); } else PROG.pz.streak = 0;
  PROG.pz.seen[PZ.p.id] = win ? 1 : 0; saveProg();
}
function puzzleDone() {
  ratePuzzle();
  PZ.state = PZ.failed || PZ.usedHint ? 'solvedHelp' : 'solved';
  if (PZ.state === 'solved') Snd.end();
  announce(PZ.state === 'solved' ? 'Puzzle solved.' : 'Puzzle finished.');
  renderAll();
}
function puzzleHint() {
  if (T.kind !== 'puzzle' || PZ.state !== 'solving') return;
  if (S.view !== liveIndex()) goTo(liveIndex());
  T.hint = Math.min(2, T.hint + 1); PZ.usedHint = true; renderAll();
}
function puzzleSolution() {
  if (T.kind !== 'puzzle' || !['solving', 'wrong', 'reply'].includes(PZ.state)) return;
  clearTimers(); if (PZ.state === 'wrong') { T.wrong = null; popTrainerMove(); }
  if (PZ.state === 'reply') { T.right = null; playUci(PZ.p.moves[PZ.step]); PZ.step++; }
  if (S.view !== liveIndex()) goTo(liveIndex(), false);
  PZ.failed = true; T.hint = 0; ratePuzzle(); PZ.state = 'showing'; renderAll();
  const step = () => {
    if (PZ.step >= PZ.p.moves.length) { PZ.state = 'shown'; renderAll(); return; }
    playUci(PZ.p.moves[PZ.step]); PZ.step++; tLater(step, 750);
  };
  tLater(step, 250);
}
function renderPuzzlePanel() {
  const p = PZ.p; if (!p) return;
  $('#pzRating').textContent = PROG.pz.rating;
  const dl = $('#pzDelta'); if (PZ.delta != null && PZ.rated) { dl.textContent = (PZ.delta >= 0 ? '+' : MINUS) + Math.abs(PZ.delta); dl.className = 'delta ' + (PZ.delta >= 0 ? 'up' : 'down'); } else { dl.textContent = ''; dl.className = 'delta'; }
  const who = colorName(PZ.color);
  const st = {
    intro: ['', 'Get ready', `Watch your opponent's move.`],
    solving: ['', 'Your turn', T.hint === 1 ? 'Hint: move the highlighted piece.' : T.hint === 2 ? 'Hint: play the move shown by the arrow.' : `Find the best move for ${who}.`],
    reply: ['good', 'Correct', 'Keep going…'],
    wrong: ['bad', 'Not this one', 'That move doesn’t work. Try again.'],
    finishing: ['good', 'Solved', ''],
    solved: ['good', 'Solved!', PZ.p.moves.length > 2 ? 'You found the whole combination.' : 'Well spotted.'],
    solvedHelp: ['good', 'Solved with help', PZ.usedHint ? 'You used a hint, so it doesn’t count for your rating.' : 'You got there after a wrong try.'],
    showing: ['bad', 'Solution', 'Watch the winning line.'],
    shown: ['bad', 'Solution shown', 'Retry it from the start or move on to the next one.'],
  }[PZ.state] || ['', '', ''];
  $('#pzStatus').className = 'pz-status' + (st[0] ? ' ' + st[0] : '');
  $('#pzStatus').innerHTML = `<span class="pc-ic">${pieceSVG(PZ.color + 'K')}</span><div><b>${esc(st[1])}</b><span>${esc(st[2])}</span></div>`;
  const done = ['solved', 'solvedHelp', 'shown'].includes(PZ.state);
  $('#pzMeta').innerHTML = `<span>Puzzle rating ${p.rating}</span>` + (done ? p.themes.map(t => `<span class="chip">${esc(t)}</span>`).join('') : '<span>· themes appear once you’re done</span>');
  $('#pzHint').disabled = PZ.state !== 'solving' || T.hint >= 2;
  $('#pzHint').textContent = T.hint === 0 ? 'Hint' : T.hint === 1 ? 'Show move' : 'Hint shown';
  $('#pzSolution').disabled = !['solving', 'wrong', 'reply'].includes(PZ.state);
  $('#pzRetry').hidden = !done;
  $('#pzNext').classList.toggle('btn-brass', done);
  const s = PROG.pz; $('#pzStats').textContent = `Solved ${s.solved} of ${s.tried} · Streak ${s.streak} · Best streak ${s.best} · ${PZDATA.length} puzzles in the set`;
}
function buildThemeSelect() {
  const counts = {}; PZDATA.forEach(p => p.themes.forEach(t => { counts[t] = (counts[t] || 0) + 1; }));
  const m3 = PZDATA.filter(p => themeOk(p, 'Mate in 3+')).length;
  const order = ['Mate in 1', 'Mate in 2', 'Mate in 3+', 'Back-rank mate', 'Fork', 'Sacrifice', 'Win material', 'Endgame', 'Promotion', 'Knight mate'];
  const opts = [['all', `All themes (${PZDATA.length})`]];
  order.forEach(t => { const n = t === 'Mate in 3+' ? m3 : counts[t]; if (n) opts.push([t, `${t} (${n})`]); });
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
  $('#pzNext').addEventListener('click', () => startPuzzle(pickPuzzle()));
  $('#pzTheme').addEventListener('change', (e) => { PZ.theme = e.target.value; startPuzzle(pickPuzzle()); });
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
  confirmDelete: false, deleteError: '', offlineTick: null,
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
const ratingText = (p) => p ? `${p.rating}${p.provisional ? '?' : ''}` : '';
const myRating = (tcId) => { if (!ON.me) return null; const cat = categoryOfTc(tcId); const r = ON.me.ratings[cat]; return r ? `${r.rating}${r.provisional ? '?' : ''}` : '1500?'; };
function categoryOfTc(id) { const t = tcById(id); const est = t.base + 40 * t.inc; return est < 180 ? 'bullet' : est < 480 ? 'blitz' : est < 1500 ? 'rapid' : 'classical'; }
const onlineActive = () => !!(ON.game && ON.game.status === 'active' && ON.game.you);

function connectSocket() {
  if (ON.sock) { ON.sock.removeAllListeners(); ON.sock.disconnect(); }
  const s = io({ transports: ['websocket', 'polling'] });
  ON.sock = s;
  s.on('connect', () => { ON.connected = true; if (ON.game && ON.game.status === 'active') openGame(ON.game.id, true); else if (ON.seeking) emitOn('seek', { tc: ON.seeking.tc }); renderOnlineIfShown(); });
  s.on('disconnect', () => { ON.connected = false; renderOnlineIfShown(); });
  s.on('lobby:stats', (d) => { ON.stats = d; if (S.mode === 'online' && !ON.game) renderOnlinePanel(); });
  s.on('match', (d) => { ON.seeking = null; ON.challenge = null; Snd.bell(659.25, .1); openGame(d.gameId); });
  s.on('game:current', (d) => { if (!ON.game || ON.game.id !== d.id) { ON.current = d.id; if (S.mode === 'online' || location.pathname === '/') { openOnline(true); openGame(d.id); } } });
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
  s.on('game:presence', (d) => {
    if (!ON.game || d.id !== ON.game.id) return;
    ON.game.presence = { w: d.white, b: d.black, since: d.offlineSince, at: performance.now() };
    renderOnlineIfShown();
  });
}
function renderOnlineIfShown() { if (S.mode === 'online') renderAll(); }
const oppName = () => { const g = ON.game; if (!g || !S.line) return 'Your opponent'; return S.line.names[g.you === 'w' ? 'b' : 'w']; };

async function loadMe() {
  try { const d = await api('/me'); ON.me = d.user; } catch (e) { ON.me = null; }
  ON.loaded = true; renderUserSection();
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
    if (ON.game && ON.game.status !== 'active') { emitOn('game:leave', { id: ON.game.id }); ON.game = null; }
    S.engineToken++; if (ENG.main) ENG.main.cancelAll();
    S.game = null; S.chess = null; S.line = null; S.review = null; S.view = 0; S.bannerOpen = false; S.sel = null; S.legal = [];
    S.orientation = 'w';
    setMode('online'); renderCoords(); drawBoardCanvas(); renderPieces(START_FEN, false); renderAll();
    if (location.pathname !== '/' && !location.pathname.startsWith('/c/')) history.replaceState(null, '', '/');
  } else setMode('online');
  loadMyGames();
}
function leaveOnline() {
  if (ON.seeking) { emitOn('seek:cancel'); ON.seeking = null; }
  if (ON.challenge) { emitOn('challenge:cancel', { code: ON.challenge.code }); ON.challenge = null; }
  if (ON.game && ON.game.status !== 'active') { emitOn('game:leave', { id: ON.game.id }); ON.game = null; }
  if (location.pathname !== '/') history.replaceState(null, '', '/');
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
  ON.game = { id: st.id, you, status: st.status, result: st.result, reason: st.reason, drawOffer: st.drawOffer, rematch: st.rematch, rated: st.rated, tc: st.tc, diff: st.diff,
    white: st.white, black: st.black, presence: { w: st.white.online !== false, b: st.black.online !== false, since: {}, at: performance.now() },
    firstMoveDeadline: st.firstMoveDeadline != null ? performance.now() + st.firstMoveDeadline : null };
  const c = new Chess(); const L = newLine(START_FEN, { w: st.white.name, b: st.black.name }, { w: ratingText(st.white), b: ratingText(st.black) }, { source: 'online', result: st.result || '*', reason: st.reason || '' });
  for (const u of st.moves) { const m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || undefined }); if (!m) break; m.uci = u; L.moves.push(m); L.fens.push(c.fen()); }
  S.chess = c; S.line = L; S.review = null; S.sel = null; S.legal = [];
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
    S.sel = null; S.legal = [];
  } else { openGame(g.id, true); return; }
  S.game.clock.w = d.clocks.w; S.game.clock.b = d.clocks.b; S.game.clock.running = d.clockRunning ? d.turn : null; S.game.clock.last = performance.now();
  g.drawOffer = d.drawOffer; if (L.moves.length >= 2) g.firstMoveDeadline = null; else if (L.moves.length === 1) g.firstMoveDeadline = performance.now() + 30000;
  renderAll();
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
  S.bannerOpen = true; S.sel = null; S.legal = []; closePromo();
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
  ON.seeking = { tc: ON.tc, since: performance.now() }; renderAll();
}
async function cancelSeek() { await emitOn('seek:cancel'); ON.seeking = null; renderAll(); }
async function createChallenge(color) {
  const r = await emitOn('challenge:create', { tc: ON.tc, color });
  if (r.error) { toast(r.error); return; }
  if (ON.seeking) { emitOn('seek:cancel'); ON.seeking = null; }
  ON.challenge = { code: r.code, tc: ON.tc, url: `${location.origin}/c/${r.code}` }; renderOnlinePanel();
}
async function cancelChallenge() { if (ON.challenge) await emitOn('challenge:cancel', { code: ON.challenge.code }); ON.challenge = null; renderOnlinePanel(); }
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
async function reviewOnlineGame(id) {
  try {
    const d = await api('/games/' + encodeURIComponent(id));
    const c = new Chess(); const L = newLine(START_FEN, { w: d.white.name, b: d.black.name }, { w: d.white.rating ? String(d.white.rating) : 'White', b: d.black.rating ? String(d.black.rating) : 'Black' }, { source: 'online', result: d.result || '*', reason: d.reason || '' });
    for (const u of d.moves) { const m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || undefined }); if (!m) break; m.uci = u; L.moves.push(m); L.fens.push(c.fen()); }
    if (L.moves.length < 1) { toast('That game has no moves to review.'); return; }
    const you = ON.me && d.white.name === ON.me.username ? 'w' : ON.me && d.black.name === ON.me.username ? 'b' : null;
    S.chess = c; S.line = L; S.game = { playerColor: you || 'w', you, tc: d.tc, online: true, clock: { w: 0, b: 0, running: null, last: 0 } };
    S.orientation = you || 'w'; S.review = null;
    startReview();
  } catch (e) { toast(e.message); }
}

/* ---------------- account ---------------- */
async function submitAuth(form) {
  const username = form.querySelector('[name=username]').value.trim(); const password = form.querySelector('[name=password]').value;
  ON.authError = ''; ON.busy = true; renderOnlinePanel();
  try {
    const d = await api(ON.authTab === 'login' ? '/login' : '/register', { method: 'POST', body: { username, password } });
    ON.me = d.user; ON.authMsg = '';
    connectSocket(); loadMyGames();
    if (ON.incoming) loadIncoming(ON.incoming.code);
  } catch (e) { ON.authError = e.message; }
  ON.busy = false; renderOnlinePanel();
}
async function logout() {
  if (onlineActive()) { toast('Finish or resign your game first.'); return; }
  leaveOnline();
  try { await api('/logout', { method: 'POST', body: {} }); } catch (e) {}
  ON.me = null; ON.games = null; ON.game = null; connectSocket(); openOnline();
}
async function deleteAccount(password) {
  try { await api('/me', { method: 'DELETE', body: { password } }); ON.me = null; ON.games = null; ON.confirmDelete = false; ON.deleteError = ''; connectSocket(); toast('Your account has been deleted.'); openOnline(); }
  catch (e) { ON.deleteError = e.message; renderOnlinePanel(); }
}

/* ---------------- rendering ---------------- */
function tcGridHTML() {
  return `<div class="tc-grid" role="group" aria-label="Time control">${ONLINE_TCS.map(t => `<button class="tc-btn" data-tc="${t.id}" aria-pressed="${t.id === ON.tc}"><b>${t.id}</b><small>${t.kind}</small></button>`).join('')}</div>`;
}
function statsLine() {
  const s = ON.stats; if (!s) return '';
  const seekingAll = Object.values(s.seeking || {}).reduce((a, b) => a + b, 0); const here = (s.seeking || {})[ON.tc] || 0;
  return `<p class="stat-line">${s.online} online · ${s.games} game${s.games === 1 ? '' : 's'} in progress · ${seekingAll} looking for a game${here ? ` (${here} at ${ON.tc})` : ''}</p>`;
}
const mmss = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
function renderOnlinePanel() {
  const el = $('#onlinePanel'); if (!el || S.mode !== 'online') return;
  if (!ON.loaded) { el.innerHTML = '<p class="fine"><span class="spinner"></span>Connecting…</p>'; return; }
  if (!ON.me) { el.innerHTML = authHTML(); return; }
  if (ON.game) { el.innerHTML = gameHTML(); return; }
  el.innerHTML = lobbyHTML();
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
      ${ON.authError ? `<p class="err" role="alert">${esc(ON.authError)}</p>` : ''}
      <button class="btn btn-brass" type="submit" ${ON.busy ? 'disabled' : ''}>${reg ? 'Create account' : 'Log in'}</button>
    </form>
    <p class="fine">${reg ? 'Usernames are public. Woodpusher stores only your username, a hashed password, your ratings and your games. No email address needed. ' : ''}<a href="/privacy.html" target="_blank" rel="noopener">Privacy statement</a></p>`;
}
function lobbyHTML() {
  const me = ON.me; const r = me.ratings || {};
  const box = (k, label) => { const x = r[k] || { rating: 1500, provisional: true }; return `<div class="rbox"><small>${label}</small><b>${x.rating}${x.provisional ? '?' : ''}</b></div>`; };
  let action;
  if (ON.incoming) {
    action = ON.incoming.error ? `<div class="offer"><span>${esc(ON.incoming.error)}</span><button class="btn btn-small" data-act="dismiss-incoming">OK</button></div>`
      : `<div class="offer"><b>${esc(ON.incoming.from)} challenges you to a ${esc(ON.incoming.tc)} game${ON.incoming.color === 'r' ? '' : `, and plays ${ON.incoming.color === 'w' ? 'White' : 'Black'}`}.</b><span class="fine">Friend games don't change your rating.</span><div class="actions"><button class="btn btn-brass" data-act="accept-incoming">Accept</button><button class="btn" data-act="dismiss-incoming">Decline</button></div></div>`;
  } else if (ON.seeking) {
    const waited = performance.now() - ON.seeking.since; const range = Math.min(800, 100 + Math.floor(waited / 5000) * 50);
    action = `<div class="seek-box" aria-live="polite"><b><span class="spinner"></span>Looking for an opponent</b><span class="fine">${esc(ON.seeking.tc)} · rated · waiting ${mmss(waited)} · rating range ±${range}</span>
      ${waited > 30000 ? `<span class="fine">Nobody around at this time control right now. Keep waiting, try another clock, or play Stockfish meanwhile.</span>` : ''}
      <div class="actions"><button class="btn" data-act="cancel-seek">Cancel</button>${waited > 30000 ? '<button class="btn" data-act="play-sf">Play Stockfish instead</button>' : ''}</div></div>`;
  } else if (ON.challenge) {
    action = `<div class="seek-box"><b>Challenge link ready</b><span class="fine">Send this link to a friend. The game starts as soon as they open it. Friend games are not rated.</span>
      <div class="link-row"><input class="input" id="chalUrl" readonly value="${esc(ON.challenge.url)}"><button class="btn" data-act="copy-link">Copy</button></div>
      <span class="fine"><span class="spinner"></span>Waiting for your friend · ${esc(ON.challenge.tc)}</span><div class="actions"><button class="btn" data-act="cancel-challenge">Cancel</button></div></div>`;
  } else {
    action = `<div class="actions"><button class="btn btn-brass" data-act="seek" ${ON.busy || !ON.connected ? 'disabled' : ''}>Find an opponent</button><button class="btn" data-act="challenge" ${!ON.connected ? 'disabled' : ''}>Challenge a friend</button></div>`;
  }
  const games = ON.games ? (ON.games.length ? `<div class="game-list">${ON.games.slice(0, 10).map(gm => {
    const res = gm.result === '1/2-1/2' ? 'draw' : (gm.result === '1-0') === (gm.color === 'w') ? 'win' : 'loss';
    return `<button class="game-row" data-review="${esc(gm.id)}"><span class="res ${res}">${res === 'win' ? 'W' : res === 'loss' ? 'L' : '½'}</span><span><span>vs ${esc(gm.opponent)}</span><br><span class="meta">${esc(gm.tc)} · ${gm.rated ? 'rated' : 'friend game'} · ${esc(gm.reason || '')}</span></span><span class="d ${gm.diff > 0 ? 'up' : gm.diff < 0 ? 'down' : ''}">${gm.diff != null ? (gm.diff > 0 ? '+' : gm.diff < 0 ? MINUS : '±') + Math.abs(gm.diff) : ''}</span></button>`;
  }).join('')}</div>` : '<p class="fine">Your finished games will appear here. Click one to review it.</p>') : '';
  const del = ON.confirmDelete ? `<form class="form" id="delForm"><label>Confirm with your password<input class="input" name="password" type="password" autocomplete="current-password" required></label>${ON.deleteError ? `<p class="err">${esc(ON.deleteError)}</p>` : ''}<div class="actions"><button class="btn armed" type="submit">Delete my account for good</button><button class="btn" type="button" data-act="cancel-delete">Keep my account</button></div></form>` : '';
  return `<div class="who-row"><h2>Play online</h2><span class="user-chip">${esc(me.username)}</span></div>
    <div class="ratings-row">${box('bullet', 'Bullet')}${box('blitz', 'Blitz')}${box('rapid', 'Rapid')}${box('classical', 'Classical')}</div>
    ${!ON.connected ? '<p class="err">Not connected to the server. Reconnecting…</p>' : ''}
    <div><span class="field-label">Clock · your rating ${esc(myRating(ON.tc) || '')}</span>${tcGridHTML()}</div>
    ${action}${statsLine()}
    <div><span class="field-label">Your recent games</span>${games}</div>
    <div class="account-row"><button class="back-link" data-act="logout">Log out</button><button class="danger-link" data-act="delete">Delete account</button></div>${del}`;
}
function gameHTML() {
  const g = ON.game; const L = S.line; const you = g.you; const active = g.status === 'active';
  const oppC = you === 'w' ? 'b' : 'w';
  let body = '';
  if (!you) body += `<p class="fine">You are watching this game.</p>`;
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
    }
    body += `<button class="back-link" data-act="lobby">← Back to the lobby</button>`;
  }
  const head = `${esc(L.names.w)} vs ${esc(L.names.b)}`;
  return `<div><h2>${active ? 'Live game' : 'Game over'}</h2><p class="card-sub" style="margin:4px 0 0">${head} · ${esc(g.tc)} · ${g.rated ? 'rated' : 'friend game'}</p></div>${body}`;
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
    if (S.mode === 'online' && ON.game && ON.game.status === 'active') return;
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
  panel.addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    if (b.dataset.auth) { ON.authTab = b.dataset.auth; ON.authError = ''; renderOnlinePanel(); return; }
    if (b.dataset.tc) { ON.tc = b.dataset.tc; renderAll(); return; }
    if (b.dataset.review) { reviewOnlineGame(b.dataset.review); return; }
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
      case 'play-sf': await cancelSeek(); abandonGame(); break;
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
  setInterval(() => { if (S.mode === 'online' && ON.seeking && !ON.game) renderOnlinePanel(); }, 1000);
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
  move: onlineMove, render: renderOnlinePanel, banner: onlineBanner, note: onlineNote, open: () => openOnline(),
  leave: leaveOnline, boot: bootOnline, tc: () => ON.tc,
  available: () => typeof io !== 'undefined', loaded: () => ON.loaded, me: () => ON.me,
  login: () => { ON.authTab = 'login'; ON.authError = ''; $('#btnOnline').click(); },
  logout: () => { if (onlineActive()) { toast('Finish or resign your game first.'); return false; } logout(); return true; },
  plate: (c) => c === S.orientation
    ? { n: ON.me ? ON.me.username : 'You', s: ON.me ? `Rating ${myRating(ON.tc)}` : 'Log in to play' }
    : { n: ON.seeking ? 'Searching…' : 'Opponent', s: ON.seeking ? `${ON.seeking.tc} · rated` : 'Not paired yet' },
};

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
  buildDefs(); buildClock(); wire();
  const data = (hot && hot.state) || loadLocal();
  if (data && data.settings) { Object.assign(S.settings, data.settings); Snd.on = S.settings.sound !== false; }
  if (!S.settings.elo) S.settings.elo = LEVEL_TO_ELO[S.settings.level] || ELO_DEFAULT;
  S.settings.elo = clamp(Math.round(S.settings.elo / ELO_STEP) * ELO_STEP, ELO_MIN, ELO_MAX); delete S.settings.level;
  wireOpponents();
  renderSetup();
  $('#boardWrap').dataset.board = curBoard();
  S.orientation = S.settings.color === 'b' ? 'b' : 'w';
  layoutBoard(); renderCoords();
  const ok = restore(data);
  if (!ok) { setMode('idle'); renderPieces(START_FEN, false); renderAll(); }
  requestAnimationFrame(tick);
  setTimeout(() => { buildOverlays(); buildQuickTextures(); scheduleTextureUpgrade(); watchZoom(); startOpening(); }, 0);
  bootEngine(); wireTrainer(); wireSettings();
  if (window.WP_ONLINE) window.WP_ONLINE.boot();
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
