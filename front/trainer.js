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
