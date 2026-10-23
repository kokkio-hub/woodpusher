// Fair-play checks: every finished rated game (from move 8 on) is checked with Stockfish in a separate,
// low-priority process, one position after another, so live games never wait for it. For each player
// it stores how many moves were checked, how many were Stockfish's own first choice, and the average
// loss in centipawns (ACPL). Players whose games look like engine play are flagged for the admin, who
// decides; nothing happens to an account automatically.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { q } from './db.js';

const require = createRequire(import.meta.url);
const { Chess } = require('./vendor/chess.cjs');
const ENGINE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'stockfish.js');
const MOVETIME = 150, DEPTH = 14;      // per position; about 10 seconds for a 40-move game
const SKIP_PLIES = 16;                 // the first eight moves are mostly opening theory
const DECIDED = 600;                   // positions this far ahead or behind say little about fair play
// Over a player's recent checked games, or in one game. Calibrated on bot games checked the same way
// (tools/engine-check style, 2 games a side, from move 8): Woodpusher's 1200 bot lost 43 centipawns a
// move on average with 37% first choices, the 1800 bot 21 and 48%, the 2400 bot 6 and 47%. The first-
// choice share hardly separates strong play from weak (two engines often disagree on equal moves); the
// average loss does. So the flag needs a very low loss, with at least half the moves first choices.
export const FLAG = {
  recent: { moves: 80, top1: 0.5, acpl: 12 },
  single: { moves: 30, top1: 0.55, acpl: 6 },
};

class UciEngine {
  constructor(file) {
    // stockfish.js is CommonJS and this package is "type": "module", so it runs from a .cjs copy with its .wasm next to it
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-fairplay-'));
    fs.copyFileSync(file, path.join(dir, 'engine.cjs'));
    const wasm = file.replace(/\.js$/, '.wasm');
    for (const n of ['engine.wasm', 'stockfish.wasm']) fs.copyFileSync(wasm, path.join(dir, n));
    this.dir = dir; this.buf = ''; this.cur = null; this.waiters = [];
    this.p = spawn(process.execPath, [path.join(dir, 'engine.cjs')], { stdio: ['pipe', 'pipe', 'ignore'] });
    try { os.setPriority(this.p.pid, 19); } catch (e) { /* not allowed everywhere */ }
    // A stream or process error here must never become an unhandled error that stops the game server
    this.p.on('error', (e) => { console.error('Fair play engine:', e.message); this.dead = true; });
    this.p.stdin.on('error', () => { this.dead = true; }); this.p.stdout.on('error', () => {});
    this.p.on('exit', () => { this.dead = true; for (const w of this.waiters) w.res(null); this.waiters = []; if (this.cur) { this.cur.res(null); this.cur = null; } });
    this.p.stdout.on('data', (d) => { this.buf += d; let i; while ((i = this.buf.indexOf('\n')) >= 0) { const l = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1); this.line(l); } });
    this.ready = (async () => { this.send('uci'); await this.wait(l => l === 'uciok'); this.send('setoption name Hash value 16'); this.send('isready'); await this.wait(l => l === 'readyok'); })();
  }
  send(c) { if (!this.dead) this.p.stdin.write(c + '\n'); }
  wait(pred) { return new Promise(res => this.waiters.push({ pred, res })); }
  line(l) {
    for (let k = 0; k < this.waiters.length; k++) if (this.waiters[k].pred(l)) { this.waiters.splice(k, 1)[0].res(l); k--; }
    if (!this.cur) return;
    if (l.startsWith('info ') && l.includes(' score ') && !/ (lower|upper)bound/.test(l)) {
      const t = l.split(/\s+/); const s = t.indexOf('score'); const pv = t.indexOf('pv');
      if (s > 0 && pv > 0) this.cur.info = { [t[s + 1] === 'mate' ? 'mate' : 'cp']: +t[s + 2], move: t[pv + 1] };
    } else if (l.startsWith('bestmove')) { const job = this.cur; this.cur = null; job.res({ best: l.split(/\s+/)[1], info: job.info }); }
  }
  async search(fen) {
    await this.ready; if (this.dead) return null;
    this.send(`position fen ${fen}`);
    return new Promise(res => { this.cur = { res, info: null }; this.send(`go depth ${DEPTH} movetime ${MOVETIME}`); });
  }
  quit() { try { this.send('quit'); } catch (e) {} setTimeout(() => { try { this.p.kill(); } catch (e) {} fs.rmSync(this.dir, { recursive: true, force: true }); }, 500).unref(); }
}

const score = (x) => (!x ? 0 : x.mate != null ? (x.mate > 0 ? 10000 - x.mate * 10 : -10000 - x.mate * 10) : x.cp);

// What the check found in one game: per colour { moves, top1, acpl }
export async function checkGame(engine, movesUci) {
  const c = new Chess(); const evals = []; const best = []; const legal = [];
  const fens = [c.fen()];
  for (const u of movesUci) { if (!c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || undefined })) break; fens.push(c.fen()); }
  for (let i = SKIP_PLIES; i < fens.length; i++) {
    const pos = new Chess(fens[i]); legal[i] = pos.moves().length;
    if (pos.game_over()) { evals[i] = { cp: pos.in_checkmate() ? -10000 : 0 }; continue; }
    const r = await engine.search(fens[i]); if (!r) return null;
    evals[i] = r.info || { cp: 0 }; best[i] = r.best;
  }
  const out = { w: { moves: 0, top1: 0, loss: 0 }, b: { moves: 0, top1: 0, loss: 0 } };
  for (let i = SKIP_PLIES; i < fens.length - 1; i++) {
    const color = i % 2 === 0 ? 'w' : 'b';
    if (legal[i] <= 1 || !evals[i] || !evals[i + 1]) continue;
    const before = score(evals[i]); if (Math.abs(before) > DECIDED) continue;
    const after = -score(evals[i + 1]);       // the next position is from the opponent's side
    const o = out[color]; o.moves++;
    if (best[i] === movesUci[i]) o.top1++;
    o.loss += Math.min(1000, Math.max(0, before - after));
  }
  for (const k of ['w', 'b']) { const o = out[k]; o.acpl = o.moves ? o.loss / o.moves : 0; delete o.loss; }
  return out;
}

export class FairPlay {
  constructor() { this.queue = []; this.busy = false; this.engine = null; this.off = process.env.FAIRPLAY === 'off'; this.idle = null; }
  enqueue(gameId) { if (this.off || this.queue.includes(gameId)) return; this.queue.push(gameId); this.run(); }
  // After a restart: rated games of the last three days that were not checked yet
  async backlog() {
    if (this.off) return;
    const { rows } = await q(`SELECT g.id FROM games g WHERE g.rated AND g.status = 'finished' AND g.ended_at > now() - interval '3 days'
      AND length(g.moves) > 0 AND NOT EXISTS (SELECT 1 FROM game_checks c WHERE c.game_id = g.id) ORDER BY g.ended_at`);
    for (const r of rows) this.enqueue(r.id);
  }
  async run() {
    if (this.busy) return; this.busy = true; clearTimeout(this.idle);
    try {
      while (this.queue.length) {
        const id = this.queue.shift();
        try {
          const { rows } = await q(`SELECT id, moves, white_id, black_id FROM games WHERE id = $1 AND rated AND status = 'finished'`, [id]);
          if (!rows.length || !rows[0].moves) continue;
          const moves = rows[0].moves.split(' '); if (moves.length < SKIP_PLIES + 14) continue;   // too short to say anything
          if (!fs.existsSync(ENGINE)) { console.warn('Fair play: no engine at', ENGINE); this.off = true; return; }
          if (!this.engine || this.engine.dead) this.engine = new UciEngine(ENGINE);
          const res = await checkGame(this.engine, moves); if (!res) { this.engine = null; continue; }
          for (const [color, uid] of [['w', rows[0].white_id], ['b', rows[0].black_id]]) {
            const r = res[color]; if (!uid || !r.moves) continue;
            await q(`INSERT INTO game_checks (game_id, color, user_id, moves, top1, acpl) VALUES ($1, $2, $3, $4, $5, $6)
              ON CONFLICT (game_id, color) DO UPDATE SET moves = $4, top1 = $5, acpl = $6, checked_at = now()`, [id, color, uid, r.moves, r.top1, r.acpl]);
          }
        } catch (e) { console.error('Fair play check', id, e.message); }
      }
    } finally {
      this.busy = false;
      // No work for five minutes: stop the engine process until the next game
      this.idle = setTimeout(() => { if (this.engine && !this.busy) { this.engine.quit(); this.engine = null; } }, 5 * 60 * 1000); this.idle.unref();
    }
  }
}

// Per player over their last 20 checked games: totals, the most engine-like single game, and whether that
// crosses the flag lines. Games checked before the admin last cleared the player don't count.
export async function fairPlaySummary(userIds) {
  if (!userIds.length) return new Map();
  const { rows } = await q(`
    SELECT c.user_id, c.game_id, c.moves, c.top1, c.acpl FROM (
      SELECT c.*, row_number() OVER (PARTITION BY c.user_id ORDER BY c.checked_at DESC) AS rn
      FROM game_checks c JOIN users u ON u.id = c.user_id
      WHERE c.user_id = ANY($1) AND (u.fp_cleared_at IS NULL OR c.checked_at > u.fp_cleared_at)) c
    WHERE c.rn <= 20`, [userIds]);
  const by = new Map();
  for (const r of rows) {
    const s = by.get(r.user_id) || { games: 0, moves: 0, top1: 0, loss: 0, worst: null };
    s.games++; s.moves += r.moves; s.top1 += r.top1; s.loss += r.acpl * r.moves;
    const g = { id: r.game_id, moves: r.moves, top1: r.moves ? r.top1 / r.moves : 0, acpl: r.acpl };
    if (r.moves >= FLAG.single.moves && (!s.worst || g.top1 - g.acpl / 100 > s.worst.top1 - s.worst.acpl / 100)) s.worst = g;
    by.set(r.user_id, s);
  }
  for (const s of by.values()) {
    s.rate = s.moves ? s.top1 / s.moves : 0; s.acpl = s.moves ? s.loss / s.moves : 0; delete s.loss; delete s.top1;
    const R = FLAG.recent, G = FLAG.single;
    s.flag = (s.moves >= R.moves && s.rate >= R.top1 && s.acpl <= R.acpl) || !!(s.worst && s.worst.top1 >= G.top1 && s.worst.acpl <= G.acpl);
  }
  return by;
}
