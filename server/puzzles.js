// Puzzles from the Lichess puzzle database (database.lichess.org, CC0). On first start the server
// downloads the file, keeps a selection of well-tested, popular puzzles spread over all ratings, and
// stores them in the database; later starts find them there. A puzzle of the day is picked per date.
import express from 'express';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { Readable } from 'node:stream';
import { pool, q } from './db.js';
import { zstdFrames } from './zstd.js';

const SOURCE = process.env.PUZZLE_SOURCE || 'https://database.lichess.org/lichess_db_puzzle.csv.zst';
const BAND = 50, LO = 400, HI = 3000;                         // rating bands of 50 points
const PER_BAND = Number(process.env.PUZZLE_PER_BAND) || 700;  // about 36,000 puzzles in all
const ENOUGH = Math.round(((HI - LO) / BAND) * PER_BAND * 0.9);
const LOCK = 7714;                                            // pg advisory lock: one import at a time
const UA = 'Woodpusher/1.0 (+https://woodpusher.org; contact@woodpusher.org)';

// Lichess theme tags -> the names shown on Woodpusher. Tags not listed here are kept but not shown.
export const THEMES = {
  mateIn1: 'Mate in 1', mateIn2: 'Mate in 2', mateIn3: 'Mate in 3', mateIn4: 'Mate in 4+', mateIn5: 'Mate in 4+',
  fork: 'Fork', pin: 'Pin', skewer: 'Skewer', discoveredAttack: 'Discovered attack', doubleCheck: 'Double check',
  sacrifice: 'Sacrifice', hangingPiece: 'Hanging piece', trappedPiece: 'Trapped piece', deflection: 'Deflection',
  attraction: 'Attraction', clearance: 'Clearance', interference: 'Interference', xRayAttack: 'X-ray attack',
  capturingDefender: 'Remove the defender', backRankMate: 'Back-rank mate', smotheredMate: 'Smothered mate',
  kingsideAttack: 'Kingside attack', exposedKing: 'Exposed king', quietMove: 'Quiet move', defensiveMove: 'Defensive move',
  zugzwang: 'Zugzwang', promotion: 'Promotion', underPromotion: 'Underpromotion', advancedPawn: 'Advanced pawn',
  opening: 'Opening', middlegame: 'Middlegame', endgame: 'Endgame', rookEndgame: 'Rook endgame', pawnEndgame: 'Pawn endgame',
  bishopEndgame: 'Bishop endgame', knightEndgame: 'Knight endgame', queenEndgame: 'Queen endgame',
  oneMove: 'One move', short: 'Short', long: 'Long', veryLong: 'Very long', crushing: 'Crushing', equality: 'Equality',
};
// The themes offered in the theme list, in this order
export const THEME_MENU = ['mateIn1', 'mateIn2', 'mateIn3', 'mateIn4', 'fork', 'pin', 'skewer', 'discoveredAttack', 'sacrifice',
  'hangingPiece', 'trappedPiece', 'deflection', 'attraction', 'capturingDefender', 'backRankMate', 'smotheredMate', 'quietMove',
  'defensiveMove', 'zugzwang', 'promotion', 'opening', 'middlegame', 'endgame', 'rookEndgame', 'pawnEndgame', 'oneMove', 'veryLong'];
const showThemes = (tags) => [...new Set((tags || []).map(t => THEMES[t]).filter(Boolean))].filter(t => !['Short', 'Long', 'One move', 'Crushing', 'Equality'].includes(t));

const status = { count: 0, importing: false, read: 0, kept: 0, error: null, done: false };
let themeCounts = null;

export async function startPuzzleImport() {
  try {
    status.count = (await q('SELECT COUNT(*)::int AS n FROM puzzles')).rows[0].n;
    // Once an import has read the whole file (or filled every band it could), it isn't repeated on the
    // next deploy, even when the rarest bands stayed short. PUZZLE_REIMPORT=1 runs it again.
    // (A marker with nothing stored doesn't count: that import found no puzzles and is tried again.)
    const doneBefore = (await q(`SELECT value FROM app_meta WHERE key = 'puzzles_imported'`)).rows.length > 0 && status.count > 0;
    if ((doneBefore && process.env.PUZZLE_REIMPORT !== '1') || status.count >= ENOUGH || process.env.PUZZLE_IMPORT === 'off') { status.done = status.count > 0; return; }
    if (typeof zlib.createZstdDecompress !== 'function') { status.error = 'This Node.js version cannot read the puzzle file (needs Node 22.15 or newer).'; console.warn('Puzzles:', status.error); return; }
  } catch (e) { status.error = e.message; return; }
  const client = await pool.connect();
  try {
    const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK]);
    if (!rows[0].ok) return;                                 // another instance is importing
    status.importing = true;
    await importPuzzles(client);
  } catch (e) {
    status.error = e.message; console.error('Puzzle import failed:', e.message);
    try { status.count = (await client.query('SELECT COUNT(*)::int AS n FROM puzzles')).rows[0].n; } catch (e2) {}
  } finally {
    status.importing = false;
    try { await client.query('SELECT pg_advisory_unlock($1)', [LOCK]); } catch (e) {}
    client.release();
    themeCounts = null;
  }
}

async function importPuzzles(client) {
  const have = new Map();                                    // band -> count already stored
  for (const r of (await client.query(`SELECT LEAST(${Math.ceil((HI - LO) / BAND) - 1}, GREATEST(0, floor((rating - ${LO}) / ${BAND})::int)) AS b, COUNT(*)::int AS n FROM puzzles GROUP BY b`)).rows) have.set(r.b, r.n);
  const bands = Math.ceil((HI - LO) / BAND);
  const full = () => { let n = 0; for (let b = 0; b < bands; b++) if ((have.get(b) || 0) >= PER_BAND) n++; return n; };
  console.log(`Puzzles: downloading ${SOURCE} (have ${status.count})`);
  const ac = new AbortController();
  const res = await fetch(SOURCE, { headers: { 'User-Agent': UA }, signal: ac.signal });
  if (!res.ok || !res.body) throw new Error(`download failed: HTTP ${res.status}`);
  console.log(`Puzzles: HTTP ${res.status}, ${res.headers.get('content-type') || '?'}, ${res.headers.get('content-length') || '?'} bytes`);
  // The file is many zstd frames (see zstd.js). An error anywhere (the download, the decompression, or
  // our own cancel at the end) is reported once, here, instead of as an unhandled stream error that
  // would stop the whole server.
  // (readline passes an input error on as its own 'error' event, which ends the loop below.)
  let streamErr = null;
  const keep = (e) => { if (e && !ac.signal.aborted && !streamErr) streamErr = e; };
  const body = Readable.fromWeb(res.body); body.on('error', () => {});
  const input = Readable.from(zstdFrames(body, { params: { [zlib.constants.ZSTD_d_windowLogMax]: 31 } }), { objectMode: false });
  input.on('error', keep);
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  rl.on('error', keep);
  let batch = []; let header = true; const t0 = Date.now();
  const flush = async () => {
    if (!batch.length) return;
    const cols = [[], [], [], [], [], [], [], [], []];
    for (const p of batch) p.forEach((v, i) => cols[i].push(v));
    await client.query(`INSERT INTO puzzles (id, fen, moves, rating, popularity, plays, themes, game_url, opening)
      SELECT a, b, c, d, e, f, g::text[], h, i FROM unnest($1::text[], $2::text[], $3::text[], $4::int[], $5::int[], $6::int[], $7::text[], $8::text[], $9::text[]) AS x(a, b, c, d, e, f, g, h, i)
      ON CONFLICT (id) DO NOTHING`, cols);
    status.kept += batch.length; batch = [];
  };
  try {
    for await (const line of rl) {
      if (header) { header = false; if (line.startsWith('PuzzleId')) continue; }
      status.read++;
      if (status.read % 250000 === 0) console.log(`Puzzles: read ${status.read}, kept ${status.kept} (${Math.round((Date.now() - t0) / 1000)} s)`);
      // Every band full (the very lowest and highest may never fill): stop reading the rest of the file
      if (status.read % 5000 === 0 && full() >= bands - 2) break;
      // PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags
      const f = line.split(',');
      if (f.length < 9) continue;
      const rating = +f[3], rd = +f[4], pop = +f[5], plays = +f[6];
      if (!(rating >= LO - 200 && rating < HI + 400) || rd > 85 || pop < 80 || plays < (rating > 2500 ? 150 : 300)) continue;
      const b = Math.max(0, Math.min(bands - 1, Math.floor((rating - LO) / BAND)));
      if ((have.get(b) || 0) >= PER_BAND) continue;
      if (!/^[A-Za-z0-9]{3,10}$/.test(f[0]) || f[2].split(' ').length < 2) continue;
      have.set(b, (have.get(b) || 0) + 1);
      batch.push([f[0], f[1], f[2], rating, pop, plays, `{${f[7].split(' ').filter(t => /^\w+$/.test(t)).join(',')}}`, f[8] || null, (f[9] || '').split(' ')[0] || null]);
      if (batch.length >= 500) {
        await flush();
        if (full() >= bands - 2) break;                      // the very lowest and highest bands may never fill
      }
    }
    await flush();
  } catch (e) {
    if (!streamErr) throw e;                                 // a database error; a stream error is reported below
  } finally {
    rl.close(); ac.abort(); input.destroy();
  }
  if (streamErr) throw new Error(`reading the puzzle file: ${streamErr.message}`);
  status.count = (await client.query('SELECT COUNT(*)::int AS n FROM puzzles')).rows[0].n;
  // Nothing usable in the file: report it, and don't mark the import as done so the next start tries again
  if (!status.kept && !status.count) throw new Error(`no puzzles found after reading ${status.read} lines`);
  status.done = true;
  await client.query(`INSERT INTO app_meta (key, value) VALUES ('puzzles_imported', $1) ON CONFLICT (key) DO UPDATE SET value = $1, at = now()`, [String(status.count)]);
  console.log(`Puzzles: done, ${status.count} stored after reading ${status.read} in ${Math.round((Date.now() - t0) / 1000)} s`);
}

const row = (p) => ({ id: 'l' + p.id, fen: p.fen, moves: p.moves.split(' '), rating: p.rating, themes: showThemes(p.themes), game: p.game_url || null });
const today = () => new Date().toISOString().slice(0, 10);

export function puzzlesRouter() {
  const r = express.Router();
  r.get('/puzzles/status', (req, res) => res.json({ count: status.count, importing: status.importing, read: status.read, kept: status.kept, done: status.done, error: status.error ? 'The puzzle import did not finish.' : null }));
  // The theme list with how many puzzles each has (kept in memory)
  r.get('/puzzles/themes', async (req, res) => {
    if (!themeCounts || status.importing) {
      const { rows } = await q('SELECT t, COUNT(*)::int AS n FROM puzzles, unnest(themes) AS t GROUP BY t');
      const m = Object.fromEntries(rows.map(x => [x.t, x.n]));
      themeCounts = { total: status.count, themes: THEME_MENU.map(t => ({ key: t, name: THEMES[t], n: (m[t] || 0) + (t === 'mateIn4' ? m.mateIn5 || 0 : 0) })).filter(x => x.n > 0) };
    }
    res.json(themeCounts);
  });
  // ?rating=1250&theme=fork&n=20&exclude=l00sHx,l01abc : puzzles near that rating, in random order
  r.get('/puzzles', async (req, res) => {
    const rating = Math.max(LO, Math.min(HI, Number(req.query.rating) || 1500));
    const n = Math.max(1, Math.min(40, Number(req.query.n) || 20));
    const theme = THEMES[req.query.theme] ? String(req.query.theme) : null;
    const ex = String(req.query.exclude || '').split(',').map(s => s.replace(/^l/, '')).filter(s => /^[A-Za-z0-9]{3,10}$/.test(s)).slice(0, 400);
    const tags = theme === 'mateIn4' ? ['mateIn4', 'mateIn5'] : theme ? [theme] : null;
    let out = [];
    for (const spread of [120, 300, 700, 3000]) {
      const params = [rating - spread, rating + spread, ex, n]; let where = 'rating BETWEEN $1 AND $2 AND NOT (id = ANY($3))';
      if (tags) { params.push(tags); where += ` AND themes && $${params.length}::text[]`; }
      out = (await q(`SELECT id, fen, moves, rating, themes, game_url FROM puzzles WHERE ${where} ORDER BY random() LIMIT $4`, params)).rows;
      if (out.length >= Math.min(n, 5)) break;
    }
    res.json({ puzzles: out.map(row), total: status.count });
  });
  // The same puzzle for everyone today: a popular one between 1400 and 2200, not used in the last year
  r.get('/puzzles/daily', async (req, res) => {
    const day = today();
    let { rows } = await q('SELECT p.id, p.fen, p.moves, p.rating, p.themes, p.game_url FROM puzzle_daily d JOIN puzzles p ON p.id = d.puzzle_id WHERE d.day = $1', [day]);
    if (!rows.length) {
      await q(`INSERT INTO puzzle_daily (day, puzzle_id)
        SELECT $1::date, id FROM puzzles WHERE rating BETWEEN 1400 AND 2200 AND popularity >= 90 AND plays >= 2000
          AND id NOT IN (SELECT puzzle_id FROM puzzle_daily WHERE day > $1::date - 365)
        ORDER BY md5(id || $1) LIMIT 1 ON CONFLICT (day) DO NOTHING`, [day]);
      ({ rows } = await q('SELECT p.id, p.fen, p.moves, p.rating, p.themes, p.game_url FROM puzzle_daily d JOIN puzzles p ON p.id = d.puzzle_id WHERE d.day = $1', [day]));
    }
    if (!rows.length) return res.status(404).json({ error: 'There is no puzzle of the day yet.' });
    res.set('Cache-Control', 'public, max-age=300');
    res.json({ day, puzzle: row(rows[0]) });
  });
  return r;
}
