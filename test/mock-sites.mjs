// A stand-in for the Lichess and Chess.com APIs, for testing the username import offline.
// Start it, then start the server with IMPORT_LICHESS_BASE and IMPORT_CHESSCOM_BASE pointing here:
//   node test/mock-sites.mjs &   (port 3199)
//   IMPORT_LICHESS_BASE=http://localhost:3199 IMPORT_CHESSCOM_BASE=http://localhost:3199 npm start
// Users: "Oscar_K" has games; "nobody" doesn't exist; "busy" is rate-limited; "empty" has no games;
// "halfway" gets an error for its older month.
import http from 'node:http';
import fs from 'node:fs';
const PORT = Number(process.env.MOCK_PORT) || 3199;
const OPERA = `[Event "Rated blitz game"]\n[Site "https://lichess.org/abcd1234"]\n[White "Oscar_K"]\n[Black "Duke"]\n[Result "1-0"]\n[WhiteElo "1510"]\n[BlackElo "1495"]\n[Termination "Normal"]\n\n1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7 8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7 14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0\n`;
const LONDON = (w, b, res) => `[Event "Live Chess"]\n[Site "Chess.com"]\n[White "${w}"]\n[Black "${b}"]\n[Result "${res}"]\n[TimeControl "180+2"]\n[Termination "${b} won by resignation"]\n\n1. d4 {[%clk 0:03:01.9]} 1... d5 {[%clk 0:03:01]} 2. Bf4 {[%clk 0:03:02]} 2... c5 3. e3 Nc6 4. c3 Qb6 5. Qb3 c4 6. Qc2 Bf5 7. Qxf5 e6 8. Qc2 Qxb2 9. Qxb2 Nf6 ${res}\n`;
const DRAW = `[Event "Rated rapid game"]\n[White "Somebody"]\n[Black "oscar_k"]\n[Result "1/2-1/2"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 1/2-1/2\n`;
const now = Date.now();
const lichess = [
  { id: 'abcd1234', rated: true, variant: 'standard', speed: 'blitz', perf: 'blitz', createdAt: now - 7200000, lastMoveAt: now - 7000000, status: 'mate', players: { white: { user: { name: 'Oscar_K', id: 'oscar_k' }, rating: 1510 }, black: { user: { name: 'Duke', id: 'duke' }, rating: 1495 } }, winner: 'white', opening: { name: 'Philidor Defense' }, pgn: OPERA, clock: { initial: 180, increment: 2 } },
  { id: 'x960aaaa', rated: true, variant: 'chess960', speed: 'blitz', status: 'resign', players: { white: { user: { name: 'Oscar_K', id: 'oscar_k' } }, black: { user: { name: 'Z', id: 'z' } } }, winner: 'black', pgn: OPERA, clock: { initial: 180, increment: 0 } },
  { id: 'abort111', rated: true, variant: 'standard', speed: 'blitz', status: 'aborted', players: { white: { user: { name: 'Oscar_K', id: 'oscar_k' } }, black: { user: { name: 'Z', id: 'z' } } }, pgn: '1. e4 *', clock: { initial: 180, increment: 0 } },
  { id: 'draw2222', rated: false, variant: 'standard', speed: 'rapid', createdAt: now - 3 * 86400000, lastMoveAt: now - 3 * 86400000, status: 'draw', players: { white: { user: { name: 'Somebody', id: 'somebody' }, rating: 1600 }, black: { user: { name: 'Oscar_K', id: 'oscar_k' }, rating: 1550 } }, pgn: DRAW, clock: { initial: 600, increment: 0 } },
  { id: 'ai333333', rated: false, variant: 'standard', speed: 'bullet', createdAt: now - 9 * 86400000, status: 'outoftime', players: { white: { aiLevel: 3 }, black: { user: { name: 'Oscar_K', id: 'oscar_k' }, rating: 1500 } }, winner: 'white', pgn: LONDON('lichess AI level 3', 'Oscar_K', '1-0'), clock: { initial: 60, increment: 0 } },
];
const cc = (w, b, wr, br, pgn, end, tc = '180+2', cls = 'blitz', rules = 'chess') => ({ url: `https://www.chess.com/game/live/${end}`, pgn, time_control: tc, end_time: Math.floor(end / 1000), rated: true, time_class: cls, rules, white: { username: w, rating: 1400, result: wr }, black: { username: b, rating: 1420, result: br } });
const months = {
  '2026/10': [cc('oscar_k', 'Hans', 'resigned', 'win', LONDON('oscar_k', 'Hans', '0-1'), now - 86400000), cc('oscar_k', 'Kid', 'win', 'checkmated', OPERA.replace('Oscar_K', 'oscar_k'), now - 3600000, '600', 'rapid')],
  '2026/09': [cc('Other', 'oscar_k', 'agreed', 'agreed', DRAW, now - 30 * 86400000, '1/259200', 'daily'), cc('oscar_k', 'X', 'win', 'timeout', OPERA, now - 31 * 86400000, '180', 'blitz', 'chess960')],
};
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); let m;
  const send = (code, body, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
  if (!/^Woodpusher\//.test(req.headers['user-agent'] || '')) return send(403, { error: 'no user agent' });
  // The Lichess puzzle database, when MOCK_PUZZLES names a file made by test/make-puzzle-sample.mjs
  if (u.pathname === '/lichess_db_puzzle.csv.zst' && process.env.MOCK_PUZZLES) { res.writeHead(200, { 'Content-Type': 'application/zstd' }); fs.createReadStream(process.env.MOCK_PUZZLES).pipe(res); return; }
  if ((m = u.pathname.match(/^\/api\/games\/user\/([^/]+)$/))) {
    const n = decodeURIComponent(m[1]).toLowerCase();
    if (n === 'nobody') return send(404, { error: 'Not found' });
    if (n === 'busy') return send(429, { error: 'Too many requests' });
    if (n === 'empty') return send(200, '', 'application/x-ndjson');
    return send(200, lichess.map(g => JSON.stringify(g)).join('\n') + '\n', 'application/x-ndjson');
  }
  if ((m = u.pathname.match(/^\/pub\/player\/([^/]+)\/games\/archives$/))) {
    const n = m[1]; if (n !== n.toLowerCase()) return send(400, { error: 'lowercase please' });
    if (n === 'nobody') return send(404, { code: 0, message: 'User "nobody" not found.' });
    if (n === 'empty') return send(200, { archives: [] });
    return send(200, { archives: ['https://api.chess.com/pub/player/' + n + '/games/2026/09', 'https://api.chess.com/pub/player/' + n + '/games/2026/10'] });
  }
  // "halfway": the older month fails, so only the newest month's games come back
  if ((m = u.pathname.match(/^\/pub\/player\/([^/]+)\/games\/(\d{4})\/(\d{2})$/))) return m[1] === 'halfway' && m[3] === '09' ? send(500, { error: 'boom' }) : send(200, { games: months[`${m[2]}/${m[3]}`] || [] });
  send(404, { error: 'mock: unknown path ' + u.pathname });
}).listen(PORT, () => console.log('mock sites on', PORT));
