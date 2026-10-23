// How close the game review comes to a deep reference analysis.
//   node tools/engine-check/review.mjs <games.json> <count> <ref> <config> [<config> ...]
// games.json is the out file of match.mjs; the first <count> games of 60 to 120 plies are used.
// Each config is name=engine.js:depth:movetime[:scale], e.g.
//   ref=stockfish-19-single.js:20:6000  lite=stockfish-19-lite-single.js:18:1700:1.2
// The scale multiplies centipawns before grading, as EVAL_SCALE does in front/app.html. Every move is
// graded like classifyAll there (without brilliant and great), and each config is compared with the first.
import fs from 'node:fs';
import { Engine, Chess, clamp } from './lib.mjs';
const [file, count, ...specs] = process.argv.slice(2);
if (specs.length < 2) { console.error('usage: review.mjs <games.json> <count> <ref config> <config> ...'); process.exit(1); }
const cfgs = specs.map(s => { const [name, rest] = s.split('='); const [f, d, ms, k] = rest.split(':'); return { name, file: f, depth: +d, movetime: +ms, scale: +(k || 1) }; });
const games = JSON.parse(fs.readFileSync(file, 'utf8')).filter(g => g.plies >= 60 && g.plies <= 120).slice(0, +count);
const jobs = []; games.forEach((g, gi) => g.fens.forEach((fen, pi) => jobs.push({ gi, pi, fen })));
const an = {};
for (const c of cfgs) {
  an[c.name] = games.map(() => []); let next = 0; const t0 = Date.now();
  await Promise.all(Array.from({ length: +process.env.WORKERS || 2 }, async () => {
    const e = new Engine(c.file); await e.ready;
    while (next < jobs.length) {
      const j = jobs[next++]; const res = await e.search({ fen: j.fen, depth: c.depth, movetime: c.movetime, multipv: 2 });
      const stm = j.fen.split(' ')[1] === 'w' ? 1 : -1; const x = res.info;
      an[c.name][j.gi][j.pi] = { ev: x ? (x.mate != null ? { mate: x.mate * stm } : { cp: Math.round(x.cp * c.scale) * stm }) : null, best: res.bestmove, depth: res.depth, ms: res.ms };
    }
    e.quit();
  }));
  console.error(`${c.name}: ${jobs.length} positions in ${Math.round((Date.now() - t0) / 1000)} s`);
}
// ---- grading, as in front/app.html
const winPct = (cp) => 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * clamp(cp, -1000, 1000))) - 1);
const scoreOf = (ev) => (!ev ? 0 : ev.mated ? (ev.mated === 'b' ? 10000 : -10000) : ev.mate != null ? Math.sign(ev.mate) * (10000 - Math.abs(ev.mate) * 10) : ev.cp || 0);
const term = (f) => { const x = new Chess(f); if (x.in_checkmate()) return { mated: x.turn() }; if (x.in_stalemate() || x.insufficient_material()) return { cp: 0 }; return null; };
function grade(fens, a) {
  const out = [];
  for (let i = 0; i + 1 < fens.length; i++) {
    const c = new Chess(fens[i]); const sgn = c.turn() === 'w' ? 1 : -1; const legal = c.moves({ verbose: true }); let uci = null;
    for (const m of legal) { const d = new Chess(fens[i]); d.move(m); if (d.fen() === fens[i + 1]) { uci = m.from + m.to + (m.promotion || ''); break; } }
    const e0 = term(fens[i]) || a[i].ev, e1 = term(fens[i + 1]) || a[i + 1].ev;
    const loss = Math.max(0, winPct(scoreOf(e0) * sgn) - winPct(scoreOf(e1) * sgn));
    let cls = legal.length === 1 ? 'forced' : a[i].best === uci ? 'best' : loss < 2 ? 'excellent' : loss < 5 ? 'good' : loss < 10 ? 'inaccuracy' : loss < 20 ? 'mistake' : 'blunder';
    if (i < 10 && cls === 'mistake' && Math.abs(scoreOf(e1)) <= 100) cls = 'inaccuracy';
    if (i < 10 && cls === 'inaccuracy') cls = 'good';
    out.push({ color: c.turn(), cls, acc: clamp(103.1668 * Math.exp(-0.04354 * loss) - 3.1669, 0, 100) });
  }
  return out;
}
function accuracy(gr, color) {
  const xs = gr.filter(g => g.color === color && g.cls !== 'forced').map(g => g.acc); if (!xs.length) return null;
  return (xs.reduce((a, b) => a + b, 0) / xs.length + xs.length / xs.reduce((a, b) => a + 1 / Math.max(b, 1), 0)) / 2;
}
const ref = cfgs[0].name;
for (const c of cfgs.slice(1)) {
  let n = 0, same = 0, refBl = 0, missed = 0, accErr = 0, accN = 0, ds = [], ms = 0, sxy = 0, sxx = 0;
  games.forEach((g, gi) => {
    const gr = grade(g.fens, an[c.name][gi]), rf = grade(g.fens, an[ref][gi]);
    gr.forEach((x, k) => { if (x.cls === 'forced') return; n++; if (x.cls === rf[k].cls) same++; if (rf[k].cls === 'blunder') { refBl++; if (x.cls !== 'blunder') missed++; } });
    for (const col of ['w', 'b']) { const a = accuracy(gr, col), b = accuracy(rf, col); if (a != null && b != null) { accErr += Math.abs(a - b); accN++; } }
    an[c.name][gi].forEach((x, k) => { const r = an[ref][gi][k]; if (x && x.depth) { ds.push(x.depth); ms += x.ms; }
      if (x && r && x.ev && r.ev && x.ev.cp != null && r.ev.cp != null && Math.abs(r.ev.cp) <= 800) { sxy += r.ev.cp * x.ev.cp / c.scale; sxx += r.ev.cp * r.ev.cp; } });
  });
  console.log(`${c.name}: same grade as ${ref} on ${(same / n * 100).toFixed(1)}% of ${n} moves, ${missed} of ${refBl} blunders missed, accuracy off by ${(accErr / accN).toFixed(1)} on average, average depth ${(ds.reduce((a, b) => a + b, 0) / ds.length).toFixed(1)}, ${Math.round(ms / ds.length)} ms per position; unscaled evaluations are ${(sxy / sxx).toFixed(2)}× the reference's (1 / that is the scale to use)`);
}
process.exit(0);
