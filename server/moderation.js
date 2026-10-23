// Reports and the admin view. Players report others from a profile or after a game; the admin (the
// usernames in the ADMIN_USERS variable) sees open reports and the fair-play flags, and can close an
// account or reopen it. A closed account can still log in and look around, but can't play online.
import express from 'express';
import rateLimit from 'express-rate-limit';
import { q } from './db.js';
import { fairPlaySummary, FLAG } from './fairplay.js';

export const REASONS = { cheating: 'Uses computer help', behaviour: 'Unsportsmanlike behaviour', username: 'Offensive username', other: 'Something else' };
const CLOSE_REASONS = ['fairplay', 'behaviour', 'username'];
const admins = () => new Set(String(process.env.ADMIN_USERS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
export const isAdmin = (username) => !!username && admins().has(String(username).toLowerCase());

export function moderationRouter() {
  const r = express.Router();
  const auth = (req, res, next) => (req.session.userId ? next() : res.status(401).json({ error: 'Log in first.' }));
  const admin = (req, res, next) => (req.session.userId && isAdmin(req.session.username) ? next() : res.status(403).json({ error: 'Only for the admin.' }));
  const reportLimit = rateLimit({ windowMs: 24 * 60 * 60 * 1000, limit: 20, keyGenerator: (req) => 'u' + req.session.userId, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'You have sent a lot of reports today. Try again tomorrow.' } });

  r.post('/reports', auth, reportLimit, async (req, res) => {
    const reason = String(req.body?.reason || ''); const note = String(req.body?.note || '').trim().slice(0, 500);
    const gameId = /^[A-Za-z0-9]{4,16}$/.test(String(req.body?.gameId || '')) ? String(req.body.gameId) : null;
    if (!REASONS[reason]) return res.status(400).json({ error: 'Pick a reason.' });
    const { rows } = await q('SELECT id FROM users WHERE username_lower = $1', [String(req.body?.username || '').toLowerCase()]);
    if (!rows.length) return res.status(404).json({ error: 'No player with that name.' });
    const reported = rows[0].id;
    if (reported === req.session.userId) return res.status(400).json({ error: 'You can’t report yourself.' });
    if (gameId) {
      const g = await q('SELECT 1 FROM games WHERE id = $1 AND (white_id = $2 OR black_id = $2)', [gameId, reported]);
      if (!g.rows.length) return res.status(400).json({ error: 'That game is not one of theirs.' });
    }
    // One open report per player and reason is enough; a second one adds its note to the first
    const dup = await q(`SELECT id, note FROM reports WHERE reporter_id = $1 AND reported_id = $2 AND reason = $3 AND status = 'open'`, [req.session.userId, reported, reason]);
    if (dup.rows.length) {
      if (note) await q('UPDATE reports SET note = left(concat_ws(E\'\\n\', note, $2::text), 1500), game_id = COALESCE($3, game_id) WHERE id = $1', [dup.rows[0].id, note, gameId]);
    } else {
      await q('INSERT INTO reports (reporter_id, reported_id, game_id, reason, note) VALUES ($1, $2, $3, $4, $5)', [req.session.userId, reported, gameId, reason, note || null]);
    }
    res.json({ ok: true });
  });

  r.get('/admin/overview', admin, async (req, res) => {
    const reports = (await q(`
      SELECT r.id, r.reason, r.note, r.game_id, r.status, r.created_at, r.handled_at, rep.username AS reporter, u.id AS uid, u.username AS reported, u.closed_at, u.closed_reason
      FROM reports r JOIN users u ON u.id = r.reported_id LEFT JOIN users rep ON rep.id = r.reporter_id
      WHERE r.status = 'open' OR r.handled_at > now() - interval '30 days'
      ORDER BY (r.status = 'open') DESC, r.created_at DESC LIMIT 200`)).rows;
    const recent = (await q(`SELECT DISTINCT user_id FROM game_checks WHERE checked_at > now() - interval '60 days' LIMIT 2000`)).rows.map(x => x.user_id);
    const ids = [...new Set(recent.concat(reports.map(x => x.uid)))];
    const fp = await fairPlaySummary(ids);
    const names = new Map((await q('SELECT id, username, closed_at, closed_reason FROM users WHERE id = ANY($1)', [ids])).rows.map(u => [u.id, u]));
    const avg = (await q(`SELECT COALESCE(SUM(top1)::float / NULLIF(SUM(moves), 0), 0) AS rate, COALESCE(SUM(acpl * moves) / NULLIF(SUM(moves), 0), 0) AS acpl, COUNT(DISTINCT user_id)::int AS players, COUNT(*)::int AS checks
      FROM game_checks WHERE checked_at > now() - interval '60 days'`)).rows[0];
    const fpOut = (id) => { const s = fp.get(id); return s ? { games: s.games, moves: s.moves, rate: s.rate, acpl: s.acpl, worst: s.worst, flag: s.flag } : null; };
    const flagged = [...fp.entries()].filter(([id, s]) => s.flag && names.get(id) && !names.get(id).closed_at).map(([id]) => ({ username: names.get(id).username, fp: fpOut(id) }));
    const closed = (await q('SELECT username, closed_at, closed_reason FROM users WHERE closed_at IS NOT NULL ORDER BY closed_at DESC LIMIT 100')).rows;
    res.json({
      reasons: REASONS, flagLines: FLAG, average: avg,
      reports: reports.map(x => ({ id: x.id, reason: x.reason, note: x.note, gameId: x.game_id, status: x.status, at: x.created_at, reporter: x.reporter || 'Deleted player', reported: x.reported, closed: x.closed_at ? x.closed_reason : null, fp: fpOut(x.uid) })),
      flagged, closed: closed.map(c => ({ username: c.username, at: c.closed_at, reason: c.closed_reason })),
    });
  });
  r.post('/admin/reports/:id', admin, async (req, res) => {
    const action = req.body?.action; if (!['dismiss', 'done', 'reopen'].includes(action)) return res.status(400).json({ error: 'Unknown action.' });
    await q('UPDATE reports SET status = $2, handled_at = CASE WHEN $2 = \'open\' THEN NULL ELSE now() END WHERE id = $1', [Number(req.params.id) || 0, action === 'dismiss' ? 'dismissed' : action === 'done' ? 'done' : 'open']);
    res.json({ ok: true });
  });
  // close: close the account (reason fairplay | behaviour | username) and mark its open reports done.
  // reopen: open it again. clear: the fair-play flag was looked at; only later games count from now on.
  r.post('/admin/users/:name', admin, async (req, res) => {
    const action = req.body?.action; const { rows } = await q('SELECT id, username FROM users WHERE username_lower = $1', [String(req.params.name).toLowerCase()]);
    if (!rows.length) return res.status(404).json({ error: 'No player with that name.' });
    const u = rows[0];
    if (isAdmin(u.username) && action === 'close') return res.status(400).json({ error: 'That is an admin account.' });
    if (action === 'close') {
      const reason = CLOSE_REASONS.includes(req.body?.reason) ? req.body.reason : 'fairplay';
      await q('UPDATE users SET closed_at = now(), closed_reason = $2 WHERE id = $1', [u.id, reason]);
      await q(`UPDATE reports SET status = 'done', handled_at = now() WHERE reported_id = $1 AND status = 'open'`, [u.id]);
    } else if (action === 'reopen') await q('UPDATE users SET closed_at = NULL, closed_reason = NULL, fp_cleared_at = now() WHERE id = $1', [u.id]);
    else if (action === 'clear') await q('UPDATE users SET fp_cleared_at = now() WHERE id = $1', [u.id]);
    else return res.status(400).json({ error: 'Unknown action.' });
    res.json({ ok: true });
  });
  return r;
}

// Handled reports are deleted six months later (as the privacy statement says); run daily
export async function pruneReports() {
  const { rowCount } = await q(`DELETE FROM reports WHERE status <> 'open' AND handled_at < now() - interval '6 months'`);
  if (rowCount) console.log(`Reports: deleted ${rowCount} handled more than six months ago`);
}

// Used by matchmaking and challenges: a closed account can't start online games
export async function isClosed(userId) {
  const { rows } = await q('SELECT closed_at FROM users WHERE id = $1', [userId]);
  return !!(rows.length && rows[0].closed_at);
}
