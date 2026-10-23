// Progress that follows an account between devices: puzzle rating and streaks, the opening lines
// practised, and the games against Stockfish behind the estimated Elo. Each browser keeps a copy and
// sends it here; the server merges it with what it has, so nothing is lost when two devices both
// changed something, and sends the merged copy back.
import express from 'express';
import { withTx, q } from './db.js';

const HIST_MAX = 120;
const int = (v, lo, hi, d = 0) => (Number.isFinite(+v) && v !== null && v !== '' ? Math.max(lo, Math.min(hi, Math.round(+v))) : d);
const str = (v, max) => (typeof v === 'string' && v.length <= max ? v : null);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

function cleanPz(p) {
  p = obj(p); const seen = {}; let n = 0;
  for (const [k, v] of Object.entries(obj(p.seen))) { if (++n > 20000) break; if (/^[\w-]{1,40}$/.test(k)) seen[k] = v ? 1 : 0; }
  return { rating: int(p.rating, 100, 4000, 1200), solved: int(p.solved, 0, 1e7), tried: int(p.tried, 0, 1e7), streak: int(p.streak, 0, 1e7), best: int(p.best, 0, 1e7), seen };
}
function cleanLines(l) {
  const out = {}; let n = 0;
  for (const [k, v] of Object.entries(obj(l))) { if (++n > 5000) break; if (/^[\w:.-]{1,100}$/.test(k) && v) out[k] = { done: true, perfect: !!v.perfect }; }
  return out;
}
function cleanRecord(x) {
  x = obj(x);
  const id = str(x.id, 40); if (!id || !/^[\w-]+$/.test(id)) return null;
  const kind = x.kind === 'sf' || x.kind === 'online' ? x.kind : null; if (!kind) return null;
  const score = [0, 0.5, 1].includes(x.score) ? x.score : null;
  const acc = Number.isFinite(x.acc) ? Math.max(0, Math.min(100, Math.round(x.acc * 10) / 10)) : null;
  return {
    id, at: int(x.at, 0, 4102444800000), kind, elo: x.elo == null ? null : int(x.elo, 100, 3500), opp: str(x.opp, 40),
    color: x.color === 'b' ? 'b' : 'w', score, tc: str(x.tc, 12), plies: int(x.plies, 0, 2000), takebacks: int(x.takebacks, 0, 1000),
    key: str(x.key, 6000), acc,
  };
}
function cleanHist(h) { return (Array.isArray(h) ? h.slice(0, 1000) : []).map(cleanRecord).filter(Boolean); }
export function cleanProgress(d) { d = obj(d); return { lines: cleanLines(d.lines), pz: cleanPz(d.pz), hist: cleanHist(d.hist) }; }

// sum: the incoming copy is progress made before logging in, so its puzzle counts are added on top.
// Otherwise the copy with more puzzle attempts is the more recent one for the counters, and solved
// puzzles, practised lines and Stockfish games are combined from both.
export function mergeProgress(current, incoming, { sum = false } = {}) {
  const a = cleanProgress(current), b = cleanProgress(incoming);
  const lines = { ...a.lines };
  for (const [k, v] of Object.entries(b.lines)) lines[k] = { done: true, perfect: !!(lines[k] && lines[k].perfect) || v.perfect };
  const seen = { ...a.pz.seen };
  for (const [k, v] of Object.entries(b.pz.seen)) seen[k] = Math.max(seen[k] ?? 0, v);
  const newer = b.pz.tried >= a.pz.tried ? b.pz : a.pz;
  const pz = sum
    ? { rating: newer.rating, solved: a.pz.solved + b.pz.solved, tried: a.pz.tried + b.pz.tried, streak: newer.streak, best: Math.max(a.pz.best, b.pz.best), seen }
    : { rating: newer.rating, solved: newer.solved, tried: newer.tried, streak: newer.streak, best: Math.max(a.pz.best, b.pz.best), seen };
  const byId = new Map();
  for (const x of [...a.hist, ...b.hist]) {
    const old = byId.get(x.id);
    if (!old) { byId.set(x.id, x); continue; }
    const m = x.at >= old.at ? { ...old, ...x } : { ...x, ...old };
    if (m.acc == null) m.acc = x.acc ?? old.acc;
    byId.set(x.id, m);
  }
  const hist = [...byId.values()].sort((x, y) => y.at - x.at).slice(0, HIST_MAX);
  return { lines, pz, hist };
}

export function progressRouter() {
  const r = express.Router();
  const auth = (req, res, next) => (req.session.userId ? next() : res.status(401).json({ error: 'Log in first.' }));
  r.get('/progress', auth, async (req, res) => {
    const { rows } = await q('SELECT data, updated_at FROM progress WHERE user_id = $1', [req.session.userId]);
    res.json({ progress: rows.length ? cleanProgress(rows[0].data) : null, updatedAt: rows.length ? rows[0].updated_at : null });
  });
  // Body: { progress, guest, mergeId }. guest: progress made on this device before logging in; mergeId
  // makes sure a retried request doesn't add those counts twice.
  r.put('/progress', auth, async (req, res) => {
    if (!req.is('application/json')) return res.status(415).json({ error: 'Send JSON.' });
    const uid = req.session.userId;
    const mergeId = typeof req.body?.mergeId === 'string' && /^[\w-]{6,40}$/.test(req.body.mergeId) ? req.body.mergeId : null;
    const merged = await withTx(async (cx) => {
      const { rows } = await cx.query('SELECT data FROM progress WHERE user_id = $1 FOR UPDATE', [uid]);
      const cur = rows.length ? rows[0].data : null;
      const merges = Array.isArray(cur?.merges) ? cur.merges.filter(x => typeof x === 'string') : [];
      const sum = req.body?.guest === true && !!mergeId && !merges.includes(mergeId);
      const out = mergeProgress(cur, req.body?.progress, { sum });
      const row = { ...out, merges: sum ? [...merges, mergeId].slice(-20) : merges };
      await cx.query(`INSERT INTO progress (user_id, data, updated_at) VALUES ($1, $2, now())
                      ON CONFLICT (user_id) DO UPDATE SET data = $2, updated_at = now()`, [uid, JSON.stringify(row)]);
      return out;
    });
    res.json({ progress: merged });
  });
  return r;
}
