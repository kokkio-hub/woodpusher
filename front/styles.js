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
    S.settings.look = b.dataset.look === 'light' ? 'light' : 'dark'; applyTheme(); renderSettings(); save(); b.focus();
  });
  $('#setSound').addEventListener('change', (e) => { Snd.on = e.target.checked; S.settings.sound = Snd.on; if (Snd.on) Snd.move(); save(); });
}
