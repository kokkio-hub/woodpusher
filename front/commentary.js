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
// Which colour is "you" in this game, if any (your games against Stockfish and your online games).
function youColor() {
  const L = S.line, g = S.game; if (!L) return null;
  if (L.source === 'play' && g) return g.playerColor;
  if (L.source === 'online' && g && g.you) return g.you;
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
