// Profile pages and the leaderboard: game history page by page, rating history per time control,
// win/draw/loss records, and the top players per time control.
import express from 'express';
import { q } from './db.js';
import { provisional } from './glicko.js';

const CATEGORIES = ['bullet', 'blitz', 'rapid', 'classical'];
const userByName = async (name) => (await q('SELECT id, username, created_at FROM users WHERE username_lower = $1', [String(name).toLowerCase()])).rows[0] || null;
// Microseconds since 1970, as text: an exact place in the game list to continue from
const CURSOR = "((extract(epoch FROM ended_at) * 1000000)::bigint)";

export async function recordsFor(userId) {
  const { rows } = await q(`
    SELECT category,
      COUNT(*) FILTER (WHERE (white_id = $1 AND result = '1-0') OR (black_id = $1 AND result = '0-1'))::int AS w,
      COUNT(*) FILTER (WHERE result = '1/2-1/2')::int AS d,
      COUNT(*) FILTER (WHERE (white_id = $1 AND result = '0-1') OR (black_id = $1 AND result = '1-0'))::int AS l
    FROM games WHERE (white_id = $1 OR black_id = $1) AND status = 'finished' GROUP BY category`, [userId]);
  const out = {}; for (const c of CATEGORIES) out[c] = { w: 0, d: 0, l: 0 };
  for (const r of rows) if (out[r.category]) out[r.category] = { w: r.w, d: r.d, l: r.l };
  return out;
}
export function gameRow(g, userId) {
  const color = g.white_id === userId ? 'w' : 'b';
  return {
    id: g.id, color, opponent: color === 'w' ? g.black_name : g.white_name, oppRating: color === 'w' ? g.black_rating : g.white_rating,
    tc: g.tc, category: g.category, rated: g.rated, result: g.result, reason: g.reason, diff: color === 'w' ? g.white_diff : g.black_diff,
    plies: g.moves ? g.moves.split(' ').length : 0, endedAt: g.ended_at,
  };
}

export function playersRouter() {
  const r = express.Router();

  // ?cat=blitz (or all) &before=<cursor> &limit=20
  r.get('/users/:name/games', async (req, res) => {
    const u = await userByName(req.params.name); if (!u) return res.status(404).json({ error: 'No player with that name.' });
    const cat = CATEGORIES.includes(req.query.cat) ? req.query.cat : null;
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const before = /^\d{1,19}:[A-Za-z0-9]{1,16}$/.test(String(req.query.before || '')) ? String(req.query.before).split(':') : null;
    const params = [u.id]; let where = "(white_id = $1 OR black_id = $1) AND status = 'finished' AND ended_at IS NOT NULL";
    if (cat) { params.push(cat); where += ` AND category = $${params.length}`; }
    if (before) { params.push(before[0], before[1]); where += ` AND (${CURSOR} < $${params.length - 1}::bigint OR (${CURSOR} = $${params.length - 1}::bigint AND id < $${params.length}))`; }
    params.push(limit + 1);
    const { rows } = await q(`SELECT id, white_id, black_id, white_name, black_name, white_rating, black_rating, tc, category, rated, result, reason, white_diff, black_diff, moves, ended_at, ${CURSOR}::text AS cur
      FROM games WHERE ${where} ORDER BY ended_at DESC, id DESC LIMIT $${params.length}`, params);
    const more = rows.length > limit; const page = rows.slice(0, limit);
    res.json({ games: page.map(g => gameRow(g, u.id)), next: more ? `${page[page.length - 1].cur}:${page[page.length - 1].id}` : null });
  });

  // Rating after every rated game, per time control (the latest 500), plus the rating before the first
  r.get('/users/:name/ratings', async (req, res) => {
    const u = await userByName(req.params.name); if (!u) return res.status(404).json({ error: 'No player with that name.' });
    const { rows } = await q(`
      SELECT category, ended_at,
        CASE WHEN white_id = $1 THEN white_rating ELSE black_rating END AS before,
        CASE WHEN white_id = $1 THEN white_rating + white_diff ELSE black_rating + black_diff END AS after
      FROM games WHERE (white_id = $1 OR black_id = $1) AND status = 'finished' AND rated AND white_diff IS NOT NULL AND ended_at IS NOT NULL
      ORDER BY ended_at ASC`, [u.id]);
    const out = {}; for (const c of CATEGORIES) out[c] = { start: null, points: [] };
    for (const g of rows) {
      const s = out[g.category]; if (!s) continue;
      if (s.start == null) s.start = g.before;
      s.points.push([new Date(g.ended_at).getTime(), g.after]);
    }
    for (const c of CATEGORIES) { const s = out[c]; if (s.points.length > 500) { s.start = s.points[s.points.length - 501][1]; s.points = s.points.slice(-500); } }
    res.json({ ratings: out });
  });

  // ?cat=blitz: the top 50 by rating among players with at least one rated game in it
  r.get('/leaderboard', async (req, res) => {
    const cat = CATEGORIES.includes(req.query.cat) ? req.query.cat : 'blitz';
    const { rows } = await q(`SELECT u.username, r.rating, r.rd, r.games FROM ratings r JOIN users u ON u.id = r.user_id
      WHERE r.category = $1 AND r.games > 0 AND u.closed_at IS NULL ORDER BY r.rating DESC, r.games DESC, u.username_lower LIMIT 50`, [cat]);
    const total = (await q('SELECT COUNT(*)::int AS n FROM ratings r JOIN users u ON u.id = r.user_id WHERE r.category = $1 AND r.games > 0 AND u.closed_at IS NULL', [cat])).rows[0].n;
    let you = null;
    if (req.session.userId) {
      const mine = (await q('SELECT rating, rd, games FROM ratings WHERE user_id = $1 AND category = $2 AND games > 0', [req.session.userId, cat])).rows[0];
      if (mine) {
        const ahead = (await q('SELECT COUNT(*)::int AS n FROM ratings r JOIN users u ON u.id = r.user_id WHERE r.category = $1 AND r.games > 0 AND r.rating > $2 AND u.closed_at IS NULL', [cat, mine.rating])).rows[0].n;
        you = { rank: ahead + 1, rating: Math.round(mine.rating), provisional: provisional(mine.rd), games: mine.games };
      }
    }
    res.json({
      category: cat, total, you,
      // Equal ratings share a place, as in the "you" line
      players: rows.map((p, i) => ({ rank: rows.findIndex(x => x.rating === p.rating) + 1, username: p.username, rating: Math.round(p.rating), provisional: provisional(p.rd), games: p.games })),
    });
  });
  return r;
}
