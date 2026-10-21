import express from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { q } from './db.js';
import { provisional } from './glicko.js';

const USERNAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{2,19}$/;
const RESERVED = new Set(['stockfish', 'admin', 'administrator', 'woodpusher', 'anonymous', 'guest', 'system', 'moderator', 'support', 'root', 'null', 'undefined']);
const CATEGORIES = ['bullet', 'blitz', 'rapid', 'classical'];

export async function ratingsFor(userId) {
  const { rows } = await q('SELECT category, rating, rd, games FROM ratings WHERE user_id = $1', [userId]);
  const out = {};
  for (const c of CATEGORIES) out[c] = { rating: 1500, rd: 350, games: 0, provisional: true };
  for (const r of rows) out[r.category] = { rating: Math.round(r.rating), rd: Math.round(r.rd), games: r.games, provisional: provisional(r.rd) };
  return out;
}

async function meJson(req) {
  if (!req.session.userId) return { user: null };
  const { rows } = await q('SELECT id, username, created_at FROM users WHERE id = $1', [req.session.userId]);
  if (!rows.length) { req.session.userId = null; return { user: null }; }
  return { user: { id: rows[0].id, username: rows[0].username, createdAt: rows[0].created_at, ratings: await ratingsFor(rows[0].id) } };
}

function login(req, user) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = user.id;
      req.session.username = user.username;
      req.session.save((e) => (e ? reject(e) : resolve()));
    });
  });
}

export function authRouter({ isPlaying }) {
  const r = express.Router();
  const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many attempts. Wait a few minutes and try again.' } });
  const json = (req, res, next) => (req.is('application/json') ? next() : res.status(415).json({ error: 'Send JSON.' }));

  r.get('/me', async (req, res) => res.json(await meJson(req)));

  r.post('/register', limiter, json, async (req, res) => {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    if (!USERNAME_RE.test(username)) return res.status(400).json({ error: 'Usernames are 3 to 20 characters: letters, digits, _ or -, starting with a letter or digit.' });
    if (RESERVED.has(username.toLowerCase())) return res.status(400).json({ error: 'That username is reserved. Pick another one.' });
    if (password.length < 8 || password.length > 200) return res.status(400).json({ error: 'Passwords need at least 8 characters.' });
    const hash = await bcrypt.hash(password, 11);
    const { rows } = await q(
      'INSERT INTO users (username, username_lower, pass_hash) VALUES ($1, $2, $3) ON CONFLICT (username_lower) DO NOTHING RETURNING id, username',
      [username, username.toLowerCase(), hash],
    );
    if (!rows.length) return res.status(409).json({ error: 'That username is taken. Pick another one.' });
    await login(req, rows[0]);
    res.status(201).json(await meJson(req));
  });

  r.post('/login', limiter, json, async (req, res) => {
    const username = String(req.body?.username || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const { rows } = await q('SELECT id, username, pass_hash FROM users WHERE username_lower = $1', [username]);
    const ok = rows.length && (await bcrypt.compare(password, rows[0].pass_hash));
    if (!ok) return res.status(401).json({ error: 'Wrong username or password.' });
    await login(req, rows[0]);
    res.json(await meJson(req));
  });

  r.post('/logout', json, (req, res) => {
    req.session.destroy(() => { res.clearCookie('wp.sid'); res.json({ user: null }); });
  });

  // Right to erasure: removes the account and ratings, and takes the name out of past games.
  r.delete('/me', limiter, json, async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Log in first.' });
    if (isPlaying(req.session.userId)) return res.status(409).json({ error: 'Finish or resign your current game first.' });
    const { rows } = await q('SELECT pass_hash FROM users WHERE id = $1', [req.session.userId]);
    if (!rows.length || !(await bcrypt.compare(String(req.body?.password || ''), rows[0].pass_hash))) return res.status(401).json({ error: 'That password is not correct.' });
    // Past games stay for the opponents' history, but without the deleted player's name
    await q("UPDATE games SET white_name = 'Deleted player' WHERE white_id = $1", [req.session.userId]);
    await q("UPDATE games SET black_name = 'Deleted player' WHERE black_id = $1", [req.session.userId]);
    await q('DELETE FROM users WHERE id = $1', [req.session.userId]);
    req.session.destroy(() => { res.clearCookie('wp.sid'); res.json({ deleted: true }); });
  });

  return r;
}

export function publicRouter() {
  const r = express.Router();
  r.get('/users/:name', async (req, res) => {
    const { rows } = await q('SELECT id, username, created_at FROM users WHERE username_lower = $1', [String(req.params.name).toLowerCase()]);
    if (!rows.length) return res.status(404).json({ error: 'No player with that name.' });
    const u = rows[0];
    const games = await q(
      `SELECT id, white_id, black_id, white_name, black_name, tc, category, rated, status, result, reason, white_diff, black_diff, ended_at
         FROM games WHERE (white_id = $1 OR black_id = $1) AND status = 'finished' ORDER BY created_at DESC LIMIT 20`, [u.id]);
    res.json({
      username: u.username, createdAt: u.created_at, ratings: await ratingsFor(u.id),
      games: games.rows.map((g) => {
        const color = g.white_id === u.id ? 'w' : 'b';
        return { id: g.id, color, opponent: color === 'w' ? g.black_name : g.white_name, tc: g.tc, category: g.category, rated: g.rated, result: g.result, reason: g.reason, diff: color === 'w' ? g.white_diff : g.black_diff, endedAt: g.ended_at };
      }),
    });
  });
  r.get('/games/:id', async (req, res) => {
    const { rows } = await q('SELECT * FROM games WHERE id = $1', [String(req.params.id)]);
    if (!rows.length) return res.status(404).json({ error: 'Game not found.' });
    const g = rows[0];
    res.json({
      id: g.id, tc: g.tc, category: g.category, rated: g.rated, status: g.status, result: g.result, reason: g.reason,
      moves: g.moves ? g.moves.split(' ') : [], createdAt: g.created_at, endedAt: g.ended_at,
      white: { name: g.white_name, rating: g.white_rating, diff: g.white_diff },
      black: { name: g.black_name, rating: g.black_rating, diff: g.black_diff },
    });
  });
  return r;
}
