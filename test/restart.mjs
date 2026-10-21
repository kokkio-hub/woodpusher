// A deploy restarts the server mid-game: the game must survive with the same moves and clocks.
import { spawn } from 'node:child_process';
import { io } from 'socket.io-client';
const PORT = 3101, BASE = `http://localhost:${PORT}`;
const env = { ...process.env, PORT: String(PORT), DATABASE_URL: 'postgres://wp:wp@127.0.0.1:5432/woodpusher', SESSION_SECRET: 'test-secret-test-secret-test-secret' };
const start = () => new Promise(res => { const p = spawn('node', ['server/index.js'], { env }); p.stdout.on('data', d => { if (String(d).includes('listening')) res(p); }); p.stderr.on('data', d => process.stderr.write(d)); });
async function account(name) {
  let r = await fetch(BASE + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: name, password: 'password123' }) });
  return r.headers.get('set-cookie').split(';')[0];
}
const sock = async (cookie) => { const s = io(BASE, { extraHeaders: { Cookie: cookie }, transports: ['websocket'] }); await new Promise(r => s.on('connect', r)); return { s, emit: (e, d) => new Promise(r => s.emit(e, d, r)) }; };
let srv = await start();
const tag = Date.now() % 100000; const ca = await account('rsA' + tag), cb = await account('rsB' + tag);
let A = await sock(ca), B = await sock(cb);
const m = new Promise(r => A.s.once('match', r)); await A.emit('seek', { tc: '5+0' }); await B.emit('seek', { tc: '5+0' }); const { gameId } = await m;
const st = (await A.emit('game:join', { id: gameId })).game; const W = st.you === 'w' ? A : B, Bk = W === A ? B : A;
for (const [P, u, i] of [[W, 'e2e4', 0], [Bk, 'c7c5', 1], [W, 'g1f3', 2]]) { const r = await P.emit('game:move', { id: gameId, uci: u, ply: i }); if (!r.ok) console.log('fail', r); }
const before = (await A.emit('game:join', { id: gameId })).game;
console.log('before restart: moves', before.moves.join(' '), 'clocks', before.clocks);
A.s.close(); B.s.close(); srv.kill('SIGTERM'); await new Promise(r => setTimeout(r, 800));
srv = await start();
A = await sock(ca); B = await sock(cb);
const after = (await A.emit('game:join', { id: gameId })).game; await B.emit('game:join', { id: gameId });
console.log('after restart:  moves', after.moves.join(' '), 'clocks', after.clocks, 'status', after.status);
const r = await Bk.emit === undefined ? null : null;
const Bk2 = (before.you === 'w') ? (W === A ? B : A) : (W === A ? B : A);
const mv = await (W === A ? B : A).emit('game:move', { id: gameId, uci: 'd7d6', ply: 3 });
console.log('next move after restart:', mv);
srv.kill('SIGTERM'); process.exit(0);
