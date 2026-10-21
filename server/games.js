// Live games, matchmaking and friend challenges. The server is the authority on moves and clocks.
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { q, withTx } from './db.js';
import * as glicko from './glicko.js';

const require = createRequire(import.meta.url);
const { Chess } = require('./vendor/chess.cjs');

export const TIME_CONTROLS = {
  '1+0': [60, 0], '3+0': [180, 0], '3+2': [180, 2], '5+0': [300, 0], '5+3': [300, 3],
  '10+0': [600, 0], '10+5': [600, 5], '15+10': [900, 10], '30+0': [1800, 0],
};
export function categoryOf(tc) {
  const [base, inc] = TIME_CONTROLS[tc];
  const est = base + 40 * inc;
  return est < 180 ? 'bullet' : est < 480 ? 'blitz' : est < 1500 ? 'rapid' : 'classical';
}
const FIRST_MOVE_MS = 30000;      // time to make the first move before the game is aborted
const ABANDON_MS = 30000;         // opponent offline this long: you may claim the win
const UCI_RE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const newId = (n = 8) => crypto.randomBytes(n).toString('base64url').replace(/[-_]/g, '').slice(0, n);
const opp = (c) => (c === 'w' ? 'b' : 'w');

export class Lobby {
  constructor(io) {
    this.io = io;
    this.games = new Map();       // id -> game
    this.byUser = new Map();      // userId -> active game id
    this.queues = new Map();      // tc -> Map(userId -> seeker)
    this.challenges = new Map();  // code -> challenge
    this.sockets = new Map();     // userId -> Set(socket.id)
    for (const tc of Object.keys(TIME_CONTROLS)) this.queues.set(tc, new Map());
    setInterval(() => this.pairAll(), 1000).unref();
    setInterval(() => this.broadcastStats(), 3000).unref();
    setInterval(() => this.expireChallenges(), 60000).unref();
  }

  // ---------------- connections ----------------
  attach(socket) {
    const sess = socket.request.session || {};
    const user = sess.userId ? { id: sess.userId, name: sess.username } : null;
    socket.data.user = user;
    if (user) {
      if (!this.sockets.has(user.id)) this.sockets.set(user.id, new Set());
      this.sockets.get(user.id).add(socket.id);
      const gid = this.byUser.get(user.id);
      if (gid) { const g = this.games.get(gid); if (g) this.presence(g); }
    }
    socket.emit('lobby:stats', this.stats());
    if (user && this.byUser.has(user.id)) socket.emit('game:current', { id: this.byUser.get(user.id) });

    const on = (ev, fn) => socket.on(ev, async (data, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try { reply(await fn(data || {}) || { ok: true }); } catch (e) { console.error(ev, e); reply({ error: 'Something went wrong on the server.' }); }
    });
    const needUser = () => { if (!user) throw Object.assign(new Error('login'), { public: true }); };

    on('seek', (d) => { if (!user) return { error: 'Log in to play online.' }; return this.seek(user, socket, d.tc); });
    on('seek:cancel', () => { if (user) this.cancelSeek(user.id); return { ok: true }; });
    on('challenge:create', (d) => { if (!user) return { error: 'Log in to play online.' }; return this.createChallenge(user, socket, d.tc, d.color); });
    on('challenge:info', (d) => this.challengeInfo(d.code));
    on('challenge:accept', (d) => { if (!user) return { error: 'Log in to accept the challenge.' }; return this.acceptChallenge(user, socket, d.code); });
    on('challenge:cancel', (d) => { if (user) this.cancelChallenge(user.id, d.code); return { ok: true }; });
    on('game:join', (d) => this.join(socket, d.id));
    on('game:leave', (d) => { socket.leave('g:' + d.id); return { ok: true }; });
    on('game:move', (d) => { if (!user) return { error: 'Log in first.' }; return this.move(user, d.id, d.uci, d.ply); });
    on('game:resign', (d) => { if (!user) return { error: 'Log in first.' }; return this.resign(user, d.id); });
    on('game:abort', (d) => { if (!user) return { error: 'Log in first.' }; return this.abort(user, d.id); });
    on('game:draw', (d) => { if (!user) return { error: 'Log in first.' }; return this.draw(user, d.id, d.action); });
    on('game:claim', (d) => { if (!user) return { error: 'Log in first.' }; return this.claim(user, d.id); });
    on('game:rematch', (d) => { if (!user) return { error: 'Log in first.' }; return this.rematch(user, d.id, d.action); });
    void needUser;

    socket.on('disconnect', () => {
      if (!user) return;
      const set = this.sockets.get(user.id);
      if (set) { set.delete(socket.id); if (!set.size) this.sockets.delete(user.id); }
      for (const queue of this.queues.values()) { const s = queue.get(user.id); if (s && s.socketId === socket.id) queue.delete(user.id); }
      const gid = this.byUser.get(user.id); if (gid) { const g = this.games.get(gid); if (g) this.presence(g); }
    });
  }
  online(userId) { return this.sockets.has(userId); }
  emitUser(userId, ev, data) { const set = this.sockets.get(userId); if (set) for (const sid of set) this.io.to(sid).emit(ev, data); }
  isPlaying(userId) { return this.byUser.has(userId); }

  stats() {
    const seeking = {}; for (const [tc, m] of this.queues) seeking[tc] = m.size;
    let playing = 0; for (const g of this.games.values()) if (g.status === 'active') playing++;
    return { online: this.io.engine.clientsCount, seeking, games: playing };
  }
  broadcastStats() { this.io.emit('lobby:stats', this.stats()); }

  async ratingOf(userId, category) {
    const { rows } = await q('SELECT rating, rd, vol, games FROM ratings WHERE user_id = $1 AND category = $2', [userId, category]);
    return rows.length ? { rating: rows[0].rating, rd: rows[0].rd, vol: rows[0].vol, games: rows[0].games } : { ...glicko.DEFAULT, games: 0 };
  }

  // ---------------- matchmaking ----------------
  async seek(user, socket, tc) {
    if (!TIME_CONTROLS[tc]) return { error: 'Unknown time control.' };
    if (this.byUser.has(user.id)) return { error: 'You are already in a game.', gameId: this.byUser.get(user.id) };
    this.cancelSeek(user.id);
    const r = await this.ratingOf(user.id, categoryOf(tc));
    this.queues.get(tc).set(user.id, { user, socketId: socket.id, rating: r.rating, rd: r.rd, since: Date.now() });
    this.broadcastStats();
    this.pairAll();
    return { ok: true, tc, rating: Math.round(r.rating) };
  }
  cancelSeek(userId) { for (const m of this.queues.values()) m.delete(userId); }
  window(seeker, now) { return Math.min(800, 100 + Math.floor((now - seeker.since) / 5000) * 50); }
  pairAll() {
    const now = Date.now();
    for (const [tc, queue] of this.queues) {
      if (queue.size < 2) continue;
      const list = [...queue.values()].sort((a, b) => a.since - b.since);
      const used = new Set();
      for (const a of list) {
        if (used.has(a.user.id)) continue;
        let best = null, bestDiff = Infinity;
        for (const b of list) {
          if (b === a || used.has(b.user.id) || b.user.id === a.user.id) continue;
          const diff = Math.abs(a.rating - b.rating);
          if (diff <= Math.min(this.window(a, now), this.window(b, now)) && diff < bestDiff) { best = b; bestDiff = diff; }
        }
        if (best) {
          used.add(a.user.id); used.add(best.user.id);
          queue.delete(a.user.id); queue.delete(best.user.id);
          this.cancelSeek(a.user.id); this.cancelSeek(best.user.id);
          const flip = Math.random() < 0.5;
          this.startGame({ white: flip ? a.user : best.user, black: flip ? best.user : a.user, tc, rated: true })
            .catch((e) => console.error('start game', e));
        }
      }
    }
  }

  // ---------------- friend challenges ----------------
  createChallenge(user, socket, tc, color) {
    if (!TIME_CONTROLS[tc]) return { error: 'Unknown time control.' };
    if (this.byUser.has(user.id)) return { error: 'You are already in a game.' };
    for (const [code, c] of this.challenges) if (c.user.id === user.id) this.challenges.delete(code);
    const code = newId(8);
    this.challenges.set(code, { code, user, tc, color: ['w', 'b'].includes(color) ? color : 'r', created: Date.now() });
    return { ok: true, code };
  }
  challengeInfo(code) {
    const c = this.challenges.get(String(code));
    return c ? { ok: true, from: c.user.name, tc: c.tc, color: c.color } : { error: 'This challenge has expired or was cancelled.' };
  }
  cancelChallenge(userId, code) { const c = this.challenges.get(String(code)); if (c && c.user.id === userId) this.challenges.delete(c.code); }
  expireChallenges() { const now = Date.now(); for (const [code, c] of this.challenges) if (now - c.created > 60 * 60 * 1000) this.challenges.delete(code); }
  async acceptChallenge(user, socket, code) {
    const c = this.challenges.get(String(code));
    if (!c) return { error: 'This challenge has expired or was cancelled.' };
    if (c.user.id === user.id) return { error: 'Send this link to a friend. You can’t accept your own challenge.' };
    if (this.byUser.has(user.id)) return { error: 'You are already in a game.' };
    if (this.byUser.has(c.user.id)) return { error: `${c.user.name} is busy in another game.` };
    this.challenges.delete(c.code);
    this.cancelSeek(user.id); this.cancelSeek(c.user.id);
    const creatorWhite = c.color === 'w' ? true : c.color === 'b' ? false : Math.random() < 0.5;
    const g = await this.startGame({ white: creatorWhite ? c.user : user, black: creatorWhite ? user : c.user, tc: c.tc, rated: false });
    return { ok: true, gameId: g.id };
  }

  // ---------------- games ----------------
  async startGame({ white, black, tc, rated }) {
    const [base, inc] = TIME_CONTROLS[tc];
    const category = categoryOf(tc);
    const [rw, rb] = await Promise.all([this.ratingOf(white.id, category), this.ratingOf(black.id, category)]);
    const g = {
      id: newId(8), tc, base, inc, category, rated,
      white: { id: white.id, name: white.name, ...rw }, black: { id: black.id, name: black.name, ...rb },
      chess: new Chess(), moves: [], clocks: { w: base * 1000, b: base * 1000 }, clockRunning: false, turnStart: Date.now(),
      status: 'active', result: null, reason: null, drawOffer: null, rematch: null, timers: {}, offline: { w: null, b: null }, diff: null,
    };
    await q(`INSERT INTO games (id, white_id, black_id, white_name, black_name, tc, category, rated, status, white_ms, black_ms, white_rating, black_rating)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active',$9,$9,$10,$11)`,
    [g.id, white.id, black.id, white.name, black.name, tc, category, rated, base * 1000, Math.round(rw.rating), Math.round(rb.rating)]);
    this.games.set(g.id, g);
    this.byUser.set(white.id, g.id); this.byUser.set(black.id, g.id);
    this.armTimers(g);
    this.emitUser(white.id, 'match', { gameId: g.id });
    this.emitUser(black.id, 'match', { gameId: g.id });
    this.broadcastStats();
    return g;
  }
  colorOf(g, userId) { return g.white.id === userId ? 'w' : g.black.id === userId ? 'b' : null; }
  clockNow(g) {
    const c = { ...g.clocks };
    if (g.status === 'active' && g.clockRunning) { const t = g.chess.turn(); c[t] = Math.max(0, c[t] - (Date.now() - g.turnStart)); }
    return c;
  }
  state(g, forUser) {
    const pub = (p) => ({ name: p.name, rating: Math.round(p.rating), provisional: glicko.provisional(p.rd), online: this.online(p.id) });
    return {
      id: g.id, tc: g.tc, category: g.category, rated: g.rated, moves: g.moves, clocks: this.clockNow(g), clockRunning: g.clockRunning,
      turn: g.chess.turn(), status: g.status, result: g.result, reason: g.reason, drawOffer: g.drawOffer, rematch: g.rematch,
      white: pub(g.white), black: pub(g.black), you: forUser ? this.colorOf(g, forUser.id) : null, diff: g.diff,
      firstMoveDeadline: g.moves.length < 2 && g.status === 'active' ? FIRST_MOVE_MS - (Date.now() - g.turnStart) : null,
    };
  }
  async join(socket, id) {
    let g = this.games.get(String(id));
    if (!g) {
      const { rows } = await q('SELECT * FROM games WHERE id = $1', [String(id)]);
      if (!rows.length) return { error: 'Game not found.' };
      return { ok: true, finished: true, game: rowToState(rows[0], socket.data.user) };
    }
    socket.join('g:' + g.id);
    return { ok: true, game: this.state(g, socket.data.user) };
  }
  presence(g) {
    const now = Date.now();
    for (const c of ['w', 'b']) {
      const p = c === 'w' ? g.white : g.black; const on = this.online(p.id);
      g.offline[c] = on ? null : (g.offline[c] || now);
    }
    this.io.to('g:' + g.id).emit('game:presence', { id: g.id, white: this.online(g.white.id), black: this.online(g.black.id), offlineSince: g.offline });
  }

  armTimers(g) {
    clearTimeout(g.timers.flag); clearTimeout(g.timers.first);
    if (g.status !== 'active') return;
    if (g.moves.length < 2) {
      const left = FIRST_MOVE_MS - (Date.now() - g.turnStart);
      g.timers.first = setTimeout(() => this.finish(g, null, 'aborted').catch(console.error), Math.max(0, left));
    } else if (g.clockRunning) {
      const t = g.chess.turn(); const left = g.clocks[t] - (Date.now() - g.turnStart);
      g.timers.flag = setTimeout(() => this.checkFlag(g).catch(console.error), Math.max(0, left) + 25);
    }
  }
  async checkFlag(g) {
    if (g.status !== 'active' || !g.clockRunning) return;
    const t = g.chess.turn(); const left = g.clocks[t] - (Date.now() - g.turnStart);
    if (left > 0) { this.armTimers(g); return; }
    g.clocks[t] = 0;
    if (!canMate(g.chess, opp(t))) await this.finish(g, '1/2-1/2', 'timeout vs insufficient material');
    else await this.finish(g, t === 'w' ? '0-1' : '1-0', 'on time');
  }

  async move(user, id, uci, ply) {
    const g = this.games.get(String(id));
    if (!g || g.status !== 'active') return { error: 'This game is over.' };
    const color = this.colorOf(g, user.id);
    if (!color) return { error: 'You are not playing in this game.' };
    if (g.chess.turn() !== color) return { error: 'It is not your turn.', resync: true };
    if (ply !== g.moves.length) return { error: 'Out of sync.', resync: true };
    if (typeof uci !== 'string' || !UCI_RE.test(uci)) return { error: 'That is not a valid move.' };
    const now = Date.now();
    let left = g.clocks[color];
    if (g.clockRunning) {
      left -= now - g.turnStart;
      if (left <= 0) { await this.checkFlag(g); return { error: 'Your time ran out.' }; }
    }
    const mv = g.chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    if (!mv) return { error: 'That move is not legal.', resync: true };
    g.moves.push(uci);
    if (g.clockRunning) g.clocks[color] = left + g.inc * 1000;
    if (!g.clockRunning && g.moves.length >= 2) g.clockRunning = true;
    g.turnStart = now;
    if (g.drawOffer === opp(color)) g.drawOffer = null; // moving declines the opponent's offer
    this.armTimers(g);
    this.io.to('g:' + g.id).emit('game:move', { id: g.id, uci, san: mv.san, ply: g.moves.length - 1, clocks: { ...g.clocks }, clockRunning: g.clockRunning, turn: g.chess.turn(), drawOffer: g.drawOffer });
    q('UPDATE games SET moves = $1, white_ms = $2, black_ms = $3 WHERE id = $4', [g.moves.join(' '), Math.round(g.clocks.w), Math.round(g.clocks.b), g.id]).catch(console.error);
    const c = g.chess;
    if (c.in_checkmate()) await this.finish(g, color === 'w' ? '1-0' : '0-1', 'checkmate');
    else if (c.in_stalemate()) await this.finish(g, '1/2-1/2', 'stalemate');
    else if (c.insufficient_material()) await this.finish(g, '1/2-1/2', 'insufficient material');
    else if (c.in_threefold_repetition()) await this.finish(g, '1/2-1/2', 'threefold repetition');
    else if (c.in_draw()) await this.finish(g, '1/2-1/2', 'the 50-move rule');
    return { ok: true };
  }
  async resign(user, id) {
    const g = this.games.get(String(id)); const color = g && this.colorOf(g, user.id);
    if (!g || !color || g.status !== 'active') return { error: 'There is no game to resign.' };
    if (g.moves.length < 2) return this.abort(user, id);
    await this.finish(g, color === 'w' ? '0-1' : '1-0', 'resignation');
    return { ok: true };
  }
  async abort(user, id) {
    const g = this.games.get(String(id)); const color = g && this.colorOf(g, user.id);
    if (!g || !color || g.status !== 'active') return { error: 'There is no game to abort.' };
    if (g.moves.length >= 2) return { error: 'Both players have moved. Resign instead.' };
    await this.finish(g, null, 'aborted');
    return { ok: true };
  }
  async draw(user, id, action) {
    const g = this.games.get(String(id)); const color = g && this.colorOf(g, user.id);
    if (!g || !color || g.status !== 'active') return { error: 'There is no game in progress.' };
    if (action === 'offer') {
      if (g.moves.length < 2) return { error: 'You can offer a draw once both players have moved.' };
      if (g.drawOffer === opp(color)) { await this.finish(g, '1/2-1/2', 'agreement'); return { ok: true }; }
      g.drawOffer = color;
    } else if (action === 'accept') {
      if (g.drawOffer !== opp(color)) return { error: 'There is no draw offer to accept.' };
      await this.finish(g, '1/2-1/2', 'agreement'); return { ok: true };
    } else if (action === 'decline') {
      if (g.drawOffer === opp(color)) g.drawOffer = null;
    } else return { error: 'Unknown action.' };
    this.io.to('g:' + g.id).emit('game:offer', { id: g.id, drawOffer: g.drawOffer });
    return { ok: true };
  }
  async claim(user, id) {
    const g = this.games.get(String(id)); const color = g && this.colorOf(g, user.id);
    if (!g || !color || g.status !== 'active') return { error: 'There is no game in progress.' };
    const o = opp(color); const since = g.offline[o];
    if (!since || Date.now() - since < ABANDON_MS || this.online(o === 'w' ? g.white.id : g.black.id)) return { error: 'Your opponent is still connected or has only just left.' };
    if (g.moves.length < 2) { await this.finish(g, null, 'aborted'); return { ok: true }; }
    await this.finish(g, color === 'w' ? '1-0' : '0-1', 'abandonment');
    return { ok: true };
  }
  async rematch(user, id, action) {
    const g = this.games.get(String(id)); const color = g && this.colorOf(g, user.id);
    if (!g || !color || g.status === 'active') return { error: 'You can ask for a rematch once the game is over.' };
    if (action === 'decline') { g.rematch = null; this.io.to('g:' + g.id).emit('game:rematch', { id: g.id, rematch: null }); return { ok: true }; }
    if (this.byUser.has(g.white.id) || this.byUser.has(g.black.id)) return { error: 'One of you is already in another game.' };
    if (g.rematch === opp(color)) {
      g.rematch = null;
      const ng = await this.startGame({ white: { id: g.black.id, name: g.black.name }, black: { id: g.white.id, name: g.white.name }, tc: g.tc, rated: g.rated });
      this.io.to('g:' + g.id).emit('game:rematch', { id: g.id, rematch: null, newGameId: ng.id });
      return { ok: true, gameId: ng.id };
    }
    g.rematch = color;
    this.io.to('g:' + g.id).emit('game:rematch', { id: g.id, rematch: color });
    return { ok: true };
  }

  async finish(g, result, reason) {
    if (g.status !== 'active') return;
    clearTimeout(g.timers.flag); clearTimeout(g.timers.first);
    if (g.clockRunning) { const t = g.chess.turn(); g.clocks[t] = Math.max(0, g.clocks[t] - (Date.now() - g.turnStart)); }
    g.status = reason === 'aborted' ? 'aborted' : 'finished'; g.result = result; g.reason = reason; g.drawOffer = null;
    this.byUser.delete(g.white.id); this.byUser.delete(g.black.id);
    let diff = null;
    if (g.rated && g.status === 'finished') {
      const sw = result === '1-0' ? 1 : result === '0-1' ? 0 : 0.5;
      diff = await withTx(async (cx) => {
        const read = async (uid) => {
          const { rows } = await cx.query('SELECT rating, rd, vol FROM ratings WHERE user_id = $1 AND category = $2 FOR UPDATE', [uid, g.category]);
          return rows.length ? rows[0] : { ...glicko.DEFAULT };
        };
        const [w, b] = [await read(g.white.id), await read(g.black.id)];
        const nw = glicko.update(w, b, sw), nb = glicko.update(b, w, 1 - sw);
        const up = (uid, r) => cx.query(
          `INSERT INTO ratings (user_id, category, rating, rd, vol, games, updated_at) VALUES ($1,$2,$3,$4,$5,1,now())
           ON CONFLICT (user_id, category) DO UPDATE SET rating = $3, rd = $4, vol = $5, games = ratings.games + 1, updated_at = now()`,
          [uid, g.category, r.rating, r.rd, r.vol]);
        await up(g.white.id, nw); await up(g.black.id, nb);
        return { w: Math.round(nw.rating) - Math.round(w.rating), b: Math.round(nb.rating) - Math.round(b.rating), wNew: Math.round(nw.rating), bNew: Math.round(nb.rating) };
      });
    }
    g.diff = diff;
    await q(`UPDATE games SET status = $1, result = $2, reason = $3, moves = $4, white_ms = $5, black_ms = $6, white_diff = $7, black_diff = $8, ended_at = now() WHERE id = $9`,
      [g.status, result, reason, g.moves.join(' '), Math.round(g.clocks.w), Math.round(g.clocks.b), diff ? diff.w : null, diff ? diff.b : null, g.id]);
    this.io.to('g:' + g.id).emit('game:end', { id: g.id, status: g.status, result, reason, diff, clocks: { ...g.clocks } });
    this.broadcastStats();
    // keep finished games in memory a while for rematches, then drop them
    setTimeout(() => { if (this.games.get(g.id) === g) this.games.delete(g.id); }, 10 * 60 * 1000).unref();
  }

  // After a restart: bring active games back, without charging anyone for the downtime
  async restore() {
    const { rows } = await q("SELECT * FROM games WHERE status = 'active'");
    for (const r of rows) {
      if (!r.white_id || !r.black_id) { await q("UPDATE games SET status = 'aborted', reason = 'aborted', ended_at = now() WHERE id = $1", [r.id]); continue; }
      const [base, inc] = TIME_CONTROLS[r.tc] || [180, 0];
      const chess = new Chess(); const moves = r.moves ? r.moves.split(' ') : [];
      let ok = true; for (const u of moves) if (!chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] })) { ok = false; break; }
      if (!ok) { await q("UPDATE games SET status = 'aborted', reason = 'aborted', ended_at = now() WHERE id = $1", [r.id]); continue; }
      const [rw, rb] = await Promise.all([this.ratingOf(r.white_id, r.category), this.ratingOf(r.black_id, r.category)]);
      const g = {
        id: r.id, tc: r.tc, base, inc, category: r.category, rated: r.rated,
        white: { id: r.white_id, name: r.white_name, ...rw }, black: { id: r.black_id, name: r.black_name, ...rb },
        chess, moves, clocks: { w: r.white_ms ?? base * 1000, b: r.black_ms ?? base * 1000 }, clockRunning: moves.length >= 2, turnStart: Date.now(),
        status: 'active', result: null, reason: null, drawOffer: null, rematch: null, timers: {}, offline: { w: Date.now(), b: Date.now() }, diff: null,
      };
      this.games.set(g.id, g); this.byUser.set(g.white.id, g.id); this.byUser.set(g.black.id, g.id);
      this.armTimers(g);
    }
    if (rows.length) console.log(`Restored ${this.games.size} active game(s).`);
  }
}

function canMate(chess, color) {
  const pieces = [];
  for (const row of chess.board()) for (const p of row) if (p && p.color === color && p.type !== 'k') pieces.push(p.type);
  if (!pieces.length) return false;
  if (pieces.length === 1 && (pieces[0] === 'b' || pieces[0] === 'n')) return false;
  return true;
}

function rowToState(r, user) {
  return {
    id: r.id, tc: r.tc, category: r.category, rated: r.rated, moves: r.moves ? r.moves.split(' ') : [],
    clocks: { w: r.white_ms, b: r.black_ms }, clockRunning: false, turn: null, status: r.status, result: r.result, reason: r.reason,
    drawOffer: null, rematch: null, white: { name: r.white_name, rating: r.white_rating }, black: { name: r.black_name, rating: r.black_rating },
    you: user ? (r.white_id === user.id ? 'w' : r.black_id === user.id ? 'b' : null) : null,
    diff: r.white_diff != null ? { w: r.white_diff, b: r.black_diff } : null,
  };
}
