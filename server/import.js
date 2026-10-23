// A player's recent games from Lichess or Chess.com, ready to review on Woodpusher.
// The server fetches them rather than the browser: both sites ask apps to send one request at a
// time with a recognisable User-Agent, and the page's security policy only lets it talk to Woodpusher.
import express from 'express';
import rateLimit from 'express-rate-limit';

const UA = 'Woodpusher/1.0 (+https://woodpusher.org; contact@woodpusher.org)';
// The test suite points these at a local stand-in for the two sites.
const BASE = {
  lichess: process.env.IMPORT_LICHESS_BASE || 'https://lichess.org',
  chesscom: process.env.IMPORT_CHESSCOM_BASE || 'https://api.chess.com',
};
const LABEL = { lichess: 'Lichess', chesscom: 'Chess.com' };
const NAME_RE = { lichess: /^[A-Za-z0-9][A-Za-z0-9_-]{1,29}$/, chesscom: /^[A-Za-z0-9][A-Za-z0-9_-]{1,24}$/ };
const MAX_GAMES = 25;
const CACHE_MS = 2 * 60 * 1000;
const cache = new Map();            // "site:name" -> { at, data }
const cooldown = { lichess: 0, chesscom: 0 };

class ImportError extends Error { constructor(status, message) { super(message); this.status = status; } }

// One request at a time per site, as both sites ask
const chains = { lichess: Promise.resolve(), chesscom: Promise.resolve() };
function serial(site, fn) { const p = chains[site].then(fn, fn); chains[site] = p.catch(() => {}); return p; }

async function get(site, url, accept) {
  if (Date.now() < cooldown[site]) throw new ImportError(503, `${LABEL[site]} is busy right now. Try again in a minute.`);
  let r;
  try { r = await serial(site, () => fetch(url, { headers: { 'User-Agent': UA, Accept: accept }, signal: AbortSignal.timeout(20000) })); }
  catch (e) { throw new ImportError(502, `Couldn't reach ${LABEL[site]}. Try again in a moment.`); }
  if (r.status === 429) { cooldown[site] = Date.now() + 60 * 1000; throw new ImportError(503, `${LABEL[site]} is busy right now. Try again in a minute.`); }
  return r;
}
const notFound = (site, name) => new ImportError(404, `There is no player called “${name}” on ${LABEL[site]}. Check the spelling.`);
const failed = (site) => new ImportError(502, `${LABEL[site]} didn't send the games. Try again in a moment.`);

function clockText(base, inc) {
  const b = base >= 60 ? (base % 60 ? (base / 60).toFixed(1).replace(/\.0$/, '') : String(base / 60)) : base === 30 ? '½' : base === 15 ? '¼' : `${base}s`;
  return `${b}+${inc || 0}`;
}
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');

/* ---------------- Lichess ---------------- */
const LI_REASON = { mate: 'checkmate', resign: 'resignation', stalemate: 'stalemate', outoftime: 'on time', timeout: 'abandonment', draw: 'draw', cheat: 'cheat detected' };
const LI_SKIP = new Set(['created', 'started', 'aborted', 'noStart', 'unknownFinish']);
async function lichessGames(name) {
  const site = 'lichess';
  const url = `${BASE.lichess}/api/games/user/${encodeURIComponent(name)}?max=${MAX_GAMES + 15}&pgnInJson=true&clocks=false&evals=false&opening=true&moves=true&tags=true&sort=dateDesc`;
  const r = await get(site, url, 'application/x-ndjson');
  if (r.status === 404) throw notFound(site, name);
  if (!r.ok) throw failed(site);
  const text = await r.text();
  const lower = name.toLowerCase(); let canonical = name; const games = [];
  for (const line of text.split('\n')) {
    if (!line.trim() || games.length >= MAX_GAMES) continue;
    let g; try { g = JSON.parse(line); } catch (e) { continue; }
    if (!g || !g.pgn || !g.players || LI_SKIP.has(g.status)) continue;
    if (g.variant !== 'standard' && g.variant !== 'fromPosition') continue;
    const side = (c) => { const p = g.players[c] || {}; return { name: p.user ? p.user.name : p.aiLevel ? `Stockfish level ${p.aiLevel}` : 'Anonymous', id: p.user ? String(p.user.id || p.user.name).toLowerCase() : null, rating: p.rating || null }; };
    const w = side('white'), b = side('black');
    const you = w.id === lower ? 'w' : b.id === lower ? 'b' : null;
    if (you) canonical = you === 'w' ? w.name : b.name;
    const result = g.winner === 'white' ? '1-0' : g.winner === 'black' ? '0-1' : '1/2-1/2';
    const tc = g.clock ? clockText(g.clock.initial, g.clock.increment) : g.daysPerTurn ? `${g.daysPerTurn} day${g.daysPerTurn === 1 ? '' : 's'}` : '';
    games.push({
      id: String(g.id), url: `https://lichess.org/${g.id}`, white: { name: w.name, rating: w.rating }, black: { name: b.name, rating: b.rating },
      you, result, reason: LI_REASON[g.status] || '', tc, speed: g.speed === 'ultraBullet' ? 'UltraBullet' : cap(g.speed), rated: !!g.rated,
      endedAt: g.lastMoveAt || g.createdAt || null, opening: g.opening && g.opening.name ? g.opening.name : '', pgn: g.pgn,
    });
  }
  return { username: canonical, games };
}

/* ---------------- Chess.com ---------------- */
const CC_REASON = { checkmated: 'checkmate', resigned: 'resignation', timeout: 'on time', abandoned: 'abandonment', agreed: 'agreement', repetition: 'threefold repetition', stalemate: 'stalemate', insufficient: 'insufficient material', '50move': 'the 50-move rule', timevsinsufficient: 'timeout vs insufficient material' };
async function chesscomGames(name) {
  const site = 'chesscom'; const lower = name.toLowerCase();
  const r = await get(site, `${BASE.chesscom}/pub/player/${lower}/games/archives`, 'application/json');
  if (r.status === 404 || r.status === 410) throw notFound(site, name);
  if (!r.ok) throw failed(site);
  let archives = [];
  try { archives = ((await r.json()).archives || []).filter(u => typeof u === 'string'); } catch (e) { throw failed(site); }
  let canonical = name; const games = [];
  // Newest month first. Only the year and month are taken from the list, so requests never leave Chess.com.
  for (const u of archives.slice(-3).reverse()) {
    const m = u.match(/\/games\/(\d{4})\/(\d{2})\/?$/); if (!m) continue;
    // A month that fails (very active players have months of many megabytes) ends the list early
    // when there are games already, rather than failing the whole look-up
    let list = [];
    try {
      const r2 = await get(site, `${BASE.chesscom}/pub/player/${lower}/games/${m[1]}/${m[2]}`, 'application/json');
      if (!r2.ok) throw failed(site);
      list = (await r2.json()).games || [];
      if (!Array.isArray(list)) throw failed(site);
    } catch (e) { if (games.length) break; throw e instanceof ImportError ? e : failed(site); }
    for (const g of list.slice().reverse()) {
      if (games.length >= MAX_GAMES) break;
      if (!g || g.rules !== 'chess' || !g.pgn || !g.white || !g.black) continue;
      const wn = String(g.white.username || 'White'), bn = String(g.black.username || 'Black');
      const you = wn.toLowerCase() === lower ? 'w' : bn.toLowerCase() === lower ? 'b' : null;
      if (you) canonical = you === 'w' ? wn : bn;
      const result = g.white.result === 'win' ? '1-0' : g.black.result === 'win' ? '0-1' : '1/2-1/2';
      const code = g.white.result === 'win' ? g.black.result : g.black.result === 'win' ? g.white.result : g.white.result;
      let tc = '';
      const t = String(g.time_control || '');
      if (t.includes('/')) { const d = Math.round(+t.split('/')[1] / 86400); tc = d ? `${d} day${d === 1 ? '' : 's'}` : 'Daily'; }
      else if (t) { const [base, inc] = t.split('+').map(Number); if (base) tc = clockText(base, inc); }
      const id = (String(g.url || '').match(/\/(\d+)\/?$/) || [])[1] || String(g.uuid || g.end_time);
      games.push({
        id, url: String(g.url || ''), white: { name: wn, rating: g.white.rating || null }, black: { name: bn, rating: g.black.rating || null },
        you, result, reason: CC_REASON[code] || '', tc, speed: cap(g.time_class), rated: g.rated !== false,
        endedAt: g.end_time ? g.end_time * 1000 : null, opening: '', pgn: g.pgn,
      });
    }
    if (games.length >= MAX_GAMES) break;
  }
  return { username: canonical, games };
}

export function importRouter() {
  const r = express.Router();
  const limiter = rateLimit({ windowMs: 5 * 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many look-ups in a short time. Wait a few minutes and try again.' } });
  r.get('/import/:site/:name', limiter, async (req, res) => {
    const site = String(req.params.site); const name = String(req.params.name || '').trim();
    if (!NAME_RE[site]) return res.status(404).json({ error: 'Not found.' });
    if (!NAME_RE[site].test(name)) return res.status(400).json({ error: `That doesn't look like a ${LABEL[site]} username.` });
    const key = site + ':' + name.toLowerCase(); const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return res.json(hit.data);
    try {
      const out = site === 'lichess' ? await lichessGames(name) : await chesscomGames(name);
      const data = { site, username: out.username, games: out.games };
      cache.set(key, { at: Date.now(), data });
      if (cache.size > 300) cache.delete(cache.keys().next().value);
      res.json(data);
    } catch (e) {
      if (e instanceof ImportError) return res.status(e.status).json({ error: e.message });
      throw e;
    }
  });
  return r;
}
