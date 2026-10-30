import crypto from 'node:crypto';
import express from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { q } from './db.js';
import { provisional } from './glicko.js';
import { recordsFor, gameRow } from './players.js';
import { isAdmin } from './moderation.js';

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

// A recovery code replaces a forgotten password. Woodpusher keeps no email addresses, so the code is shown
// once (at sign-up, or when asked for in Settings) and only its bcrypt hash is stored. 20 characters from a
// 32-letter alphabet without 0/O and 1/I: 100 bits, written in groups of five.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newRecoveryCode() { const b = crypto.randomBytes(20); let s = ''; for (const x of b) s += CODE_ALPHABET[x % 32]; return s.match(/.{5}/g).join('-'); }
const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const hashCode = (c) => bcrypt.hash(normCode(c), 11);
// After a password change every other login of that account ends (connect-pg-simple's "session" table)
const endOtherSessions = (userId, keepSid) => q(`DELETE FROM "session" WHERE sess->>'userId' = $1::text AND sid <> $2`, [String(userId), keepSid || '']).catch(() => {});

async function meJson(req) {
  if (!req.session.userId) return { user: null };
  const { rows } = await q('SELECT id, username, created_at, closed_at, closed_reason, recovery_hash IS NOT NULL AS has_recovery FROM users WHERE id = $1', [req.session.userId]);
  if (!rows.length) { req.session.userId = null; return { user: null }; }
  const u = rows[0];
  const admin = isAdmin(u.username);
  const openReports = admin ? (await q(`SELECT COUNT(*)::int AS n FROM reports WHERE status = 'open'`)).rows[0].n : undefined;
  return { user: { id: u.id, username: u.username, createdAt: u.created_at, ratings: await ratingsFor(u.id), admin, openReports, closed: u.closed_at ? u.closed_reason || 'closed' : null, hasRecovery: u.has_recovery } };
}

// "Remember me" ticked: the login cookie lasts a year and is renewed on every visit, so someone who
// keeps coming back stays logged in on that device. Not ticked: a cookie the browser forgets when it
// closes, and the server forgets the session after a day without activity (see the store in index.js).
export const REMEMBER_MS = 365 * 24 * 60 * 60 * 1000;

function login(req, user, remember) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = user.id;
      req.session.username = user.username;
      // Stored with the session, so every later visit keeps the choice made at login
      req.session.cookie.maxAge = remember ? REMEMBER_MS : null;
      req.session.save((e) => (e ? reject(e) : resolve()));
    });
  });
}

export function authRouter({ isPlaying }) {
  const r = express.Router();
  const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many attempts. Wait a few minutes and try again.' } });
  // Guessing recovery codes is hopeless at 100 bits, but it is still kept slow
  const recoverLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many attempts. Wait an hour and try again.' } });
  const goodPassword = (p) => p.length >= 8 && p.length <= 200;
  const json = (req, res, next) => (req.is('application/json') ? next() : res.status(415).json({ error: 'Send JSON.' }));

  r.get('/me', async (req, res) => res.json(await meJson(req)));

  r.post('/register', limiter, json, async (req, res) => {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    if (!USERNAME_RE.test(username)) return res.status(400).json({ error: 'Usernames are 3 to 20 characters: letters, digits, _ or -, starting with a letter or digit.' });
    if (RESERVED.has(username.toLowerCase())) return res.status(400).json({ error: 'That username is reserved. Pick another one.' });
    if (password.length < 8 || password.length > 200) return res.status(400).json({ error: 'Passwords need at least 8 characters.' });
    const hash = await bcrypt.hash(password, 11);
    const code = newRecoveryCode();
    const { rows } = await q(
      'INSERT INTO users (username, username_lower, pass_hash, recovery_hash) VALUES ($1, $2, $3, $4) ON CONFLICT (username_lower) DO NOTHING RETURNING id, username',
      [username, username.toLowerCase(), hash, await hashCode(code)],
    );
    if (!rows.length) return res.status(409).json({ error: 'That username is taken. Pick another one.' });
    await login(req, rows[0], req.body?.remember === true);
    res.status(201).json({ ...(await meJson(req)), recoveryCode: code });
  });

  r.post('/login', limiter, json, async (req, res) => {
    const username = String(req.body?.username || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const { rows } = await q('SELECT id, username, pass_hash FROM users WHERE username_lower = $1', [username]);
    const ok = rows.length && (await bcrypt.compare(password, rows[0].pass_hash));
    if (!ok) return res.status(401).json({ error: 'Wrong username or password.' });
    await login(req, rows[0], req.body?.remember === true);
    res.json(await meJson(req));
  });

  // Change the password: the current one first. Other devices are logged out.
  r.post('/password', limiter, json, async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Log in first.' });
    const current = String(req.body?.current || ''), next = String(req.body?.password || '');
    const { rows } = await q('SELECT pass_hash FROM users WHERE id = $1', [req.session.userId]);
    if (!rows.length || !(await bcrypt.compare(current, rows[0].pass_hash))) return res.status(401).json({ error: 'Your current password is not correct.' });
    if (!goodPassword(next)) return res.status(400).json({ error: 'Passwords need at least 8 characters.' });
    await q('UPDATE users SET pass_hash = $2 WHERE id = $1', [req.session.userId, await bcrypt.hash(next, 11)]);
    await endOtherSessions(req.session.userId, req.sessionID);
    res.json({ ok: true });
  });

  // A new recovery code, which replaces the old one. Asks for the password.
  r.post('/recovery-code', limiter, json, async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Log in first.' });
    const { rows } = await q('SELECT pass_hash FROM users WHERE id = $1', [req.session.userId]);
    if (!rows.length || !(await bcrypt.compare(String(req.body?.password || ''), rows[0].pass_hash))) return res.status(401).json({ error: 'That password is not correct.' });
    const code = newRecoveryCode();
    await q('UPDATE users SET recovery_hash = $2 WHERE id = $1', [req.session.userId, await hashCode(code)]);
    res.json({ recoveryCode: code });
  });

  // Forgot the password: username, recovery code and a new password. The code is used up and a new one is
  // handed out; every login of the account ends and this browser is logged in.
  r.post('/recover', recoverLimiter, json, async (req, res) => {
    const username = String(req.body?.username || '').trim().toLowerCase();
    const next = String(req.body?.password || '');
    const { rows } = await q('SELECT id, username, recovery_hash FROM users WHERE username_lower = $1', [username]);
    const ok = rows.length && rows[0].recovery_hash && (await bcrypt.compare(normCode(req.body?.code), rows[0].recovery_hash));
    if (!ok) return res.status(401).json({ error: 'That username and recovery code don’t belong together.' });
    if (!goodPassword(next)) return res.status(400).json({ error: 'Passwords need at least 8 characters.' });
    const code = newRecoveryCode();
    await q('UPDATE users SET pass_hash = $2, recovery_hash = $3 WHERE id = $1', [rows[0].id, await bcrypt.hash(next, 11), await hashCode(code)]);
    await endOtherSessions(rows[0].id, '');
    await login(req, rows[0], req.body?.remember === true);
    res.json({ ...(await meJson(req)), recoveryCode: code });
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
    const { rows } = await q('SELECT id, username, created_at, closed_at, closed_reason FROM users WHERE username_lower = $1', [String(req.params.name).toLowerCase()]);
    if (!rows.length) return res.status(404).json({ error: 'No player with that name.' });
    const u = rows[0];
    const games = await q(
      `SELECT id, white_id, black_id, white_name, black_name, white_rating, black_rating, tc, category, rated, status, result, reason, white_diff, black_diff, moves, ended_at
         FROM games WHERE (white_id = $1 OR black_id = $1) AND status = 'finished' ORDER BY created_at DESC LIMIT 20`, [u.id]);
    res.json({
      username: u.username, createdAt: u.created_at, ratings: await ratingsFor(u.id), records: await recordsFor(u.id), closed: u.closed_at ? u.closed_reason || 'closed' : null,
      games: games.rows.map((g) => gameRow(g, u.id)),
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
