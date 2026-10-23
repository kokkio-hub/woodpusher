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
