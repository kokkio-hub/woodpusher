// Shared parts of the engine checks: a UCI engine in a child process, and Woodpusher's Stockfish bot
// (eloRecipe, the weighted choice among the best moves, random moves at the lowest ratings) replayed in Node.
// Keep eloRecipe and pickByTemperature in step with front/app.html.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { Chess } = require('../../server/vendor/chess.cjs');
export { Chess };
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export function parseInfo(line) {
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

// stockfish.js engine files are CommonJS, and inside this repository (package.json says "type": "module")
// Node would load them as ES modules. So each runs from a copy in a temporary folder, as .cjs, with its
// .wasm next to it under both names the builds look for (<name>.wasm and stockfish.wasm).
const copies = {};
process.on('exit', () => { for (const f of Object.values(copies)) fs.rmSync(path.dirname(f), { recursive: true, force: true }); });
function runnable(file) {
  if (copies[file]) return copies[file];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-engine-')); const base = path.basename(file).replace(/\.c?js$/, '');
  fs.copyFileSync(file, path.join(dir, 'engine.cjs'));
  const wasm = path.join(path.dirname(file), base + '.wasm');
  if (fs.existsSync(wasm)) for (const n of ['engine.wasm', 'stockfish.wasm']) fs.copyFileSync(wasm, path.join(dir, n));
  return (copies[file] = path.join(dir, 'engine.cjs'));
}
// A stockfish.js engine file (it runs as a UCI program under Node), e.g. bin/stockfish-19-lite-single.js
// from `npm pack stockfish`, or front/vendor/stockfish.js. Hash 16 MB, as in the browser.
export class Engine {
  constructor(file) {
    this.p = spawn(process.execPath, [runnable(file)], { stdio: ['pipe', 'pipe', 'ignore'] });
    this.buf = ''; this.cur = null; this.waiters = []; this.mpv = 1;
    this.p.stdout.on('data', (d) => { this.buf += d; let i; while ((i = this.buf.indexOf('\n')) >= 0) { const l = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1); this.onLine(l); } });
    this.ready = this.init();
  }
  send(c) { this.p.stdin.write(c + '\n'); }
  waitFor(pred) { return new Promise(res => this.waiters.push({ pred, res })); }
  onLine(line) {
    for (let k = 0; k < this.waiters.length; k++) if (this.waiters[k].pred(line)) { this.waiters.splice(k, 1)[0].res(line); k--; }
    if (!this.cur) return;
    if (line.startsWith('info ') && line.includes(' score ')) {
      const info = parseInfo(line);
      if (info && !info.bound && info.pv) { const k = info.multipv || 1; this.cur.lines[k - 1] = info; if (k === 1) this.cur.last = info; }
    } else if (line.startsWith('bestmove')) {
      const parts = line.split(/\s+/); const job = this.cur; this.cur = null;
      job.res({ bestmove: parts[1] && parts[1] !== '(none)' ? parts[1] : null, info: job.last, lines: job.lines, depth: job.last ? job.last.depth : 0, ms: Date.now() - job.t0 });
    }
  }
  async init() {
    this.send('uci'); await this.waitFor(l => l === 'uciok');
    this.send('setoption name Hash value 16'); this.send('isready'); await this.waitFor(l => l === 'readyok');
  }
  async newGame() { this.send('ucinewgame'); this.send('isready'); await this.waitFor(l => l === 'readyok'); }
  async search({ fen, depth, movetime, multipv = 1 }) {
    await this.ready;
    if (multipv !== this.mpv) { this.send(`setoption name MultiPV value ${multipv}`); this.mpv = multipv; }
    this.send(`position fen ${fen}`);
    let go = 'go'; if (depth) go += ` depth ${depth}`; if (movetime) go += ` movetime ${Math.max(20, Math.round(movetime))}`;
    return new Promise(res => { this.cur = { res, lines: [], last: null, t0: Date.now() }; this.send(go); });
  }
  quit() { try { this.send('quit'); } catch (e) {} setTimeout(() => { try { this.p.kill(); } catch (e) {} }, 300); }
}

// ---------- the bot, as in front/app.html ----------
export const ELO_MIN = 400, ELO_MAX = 2800;
export function eloRecipe(e) {
  const t = clamp((e - ELO_MIN) / (ELO_MAX - ELO_MIN), 0, 1);
  return {
    depth: Math.round(1 + 17 * t), movetime: Math.round(60 + 1440 * t * t), multipv: e >= 2600 ? 1 : 4,
    temp: 3 + 300 * Math.pow(1 - t, 2.4), blunder: e < 1100 ? 0.25 * Math.pow((1100 - e) / 700, 1.3) : 0,
  };
}
const lineScore = (l) => (l.mate != null ? (l.mate > 0 ? 10000 - l.mate : -10000 - l.mate) : l.cp);
function pickByTemperature(lines, temp, rnd) {
  const ls = lines.filter(l => l && l.pv && l.pv.length); if (!ls.length) return null;
  const sc = ls.map(lineScore); const best = Math.max(...sc);
  const w = sc.map(x => Math.exp(-(best - x) / temp)); let r = rnd() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < ls.length; i++) { r -= w[i]; if (r <= 0) return ls[i]; }
  return ls[0];
}
async function botMove(eng, chess, P, rnd) {
  if (P.blunder && rnd() < P.blunder) { const ms = chess.moves({ verbose: true }); const m = ms[Math.floor(rnd() * ms.length)]; return m.from + m.to + (m.promotion || ''); }
  const res = await eng.search({ fen: chess.fen(), depth: P.depth, movetime: P.movetime, multipv: P.multipv });
  if (!res || !res.bestmove) return null;
  const pick = P.multipv > 1 ? pickByTemperature(res.lines || [], P.temp, rnd) : null;
  return pick ? pick.pv[0] : res.bestmove;
}
export function mulberry(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// Sixteen common, balanced starts; each is played twice with colours swapped.
export const OPENINGS = [
  'e2e4 e7e5 g1f3 b8c6', 'e2e4 c7c5 g1f3 d7d6', 'e2e4 e7e6 d2d4 d7d5', 'e2e4 c7c6 d2d4 d7d5',
  'd2d4 d7d5 c2c4 e7e6', 'd2d4 g8f6 c2c4 g7g6', 'd2d4 d7d5 c1f4 g8f6', 'c2c4 e7e5 b1c3 g8f6',
  'g1f3 d7d5 g2g3 g8f6', 'e2e4 d7d5 e4d5 d8d5', 'd2d4 g8f6 c2c4 e7e6', 'e2e4 e7e5 f1c4 g8f6',
  'e2e4 g7g6 d2d4 f8g7', 'd2d4 f7f5 g2g3 g8f6', 'e2e4 e7e5 g1f3 g8f6', 'c2c4 c7c5 g1f3 b8c6',
];
const play = (c, u) => c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || undefined });
// One game; white and black are { eng, P }. score is White's: 1, 0.5 or 0. Games longer than 300 plies count as draws.
export async function playGame(white, black, opening, seed, maxPlies = 300) {
  const c = new Chess(); const rnd = mulberry(seed);
  for (const u of opening.split(' ')) play(c, u);
  await white.eng.newGame(); await black.eng.newGame();
  const fens = [c.fen()];
  while (!c.game_over() && c.history().length < maxPlies) {
    const side = c.turn() === 'w' ? white : black;
    const u = await botMove(side.eng, c, side.P, rnd);
    if (!u || !play(c, u)) return { score: c.turn() === 'w' ? 0 : 1, plies: c.history().length, fens };
    fens.push(c.fen());
  }
  return { score: c.in_checkmate() ? (c.turn() === 'w' ? 0 : 1) : 0.5, plies: c.history().length, fens };
}
export const eloDiff = (s) => { s = clamp(s, 0.01, 0.99); return -400 * Math.log10(1 / s - 1); };
