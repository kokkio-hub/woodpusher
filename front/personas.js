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
const BOOK_BASE = 'books/';
const BOOK_QS = '';   // the website build adds ?v=<build> so a new build never reuses old books from the browser cache
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
