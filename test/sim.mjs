// Two simulated players: register, matchmaking, a full game, ratings; then a friend challenge with draw and rematch.
import { io } from 'socket.io-client';
const BASE = process.env.BASE || 'http://localhost:3100';
async function account(name) {
  let r = await fetch(BASE + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: name, password: 'password123' }) });
  if (r.status === 409) r = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: name, password: 'password123' }) });
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const sock = io(BASE, { extraHeaders: { Cookie: cookie }, transports: ['websocket'] });
  await new Promise(res => sock.on('connect', res));
  return { name, cookie, sock, emit: (ev, d) => new Promise(res => sock.emit(ev, d, res)), wait: (ev, pred = () => true, ms = 8000) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout ' + ev)), ms); const h = (d) => { if (pred(d)) { clearTimeout(t); sock.off(ev, h); res(d); } }; sock.on(ev, h); }) };
}
const A = await account('alice' + (Date.now() % 10000)), B = await account('bob' + (Date.now() % 10000));
const mA = A.wait('match'), mB = B.wait('match');
console.log('seek A', await A.emit('seek', { tc: '3+2' }), 'seek B', await B.emit('seek', { tc: '3+2' }));
const { gameId } = await mA; await mB;
const jA = await A.emit('game:join', { id: gameId }), jB = await B.emit('game:join', { id: gameId });
const W = jA.game.you === 'w' ? A : B, Bl = W === A ? B : A;
console.log('matched', gameId, 'white', W.name, 'clocks', jA.game.clocks, 'rated', jA.game.rated);
const line = ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7'];
console.log('wrong turn ->', (await Bl.emit('game:move', { id: gameId, uci: 'e7e5', ply: 0 })).error);
console.log('illegal ->', (await W.emit('game:move', { id: gameId, uci: 'e2e5', ply: 0 })).error);
const end = W.wait('game:end');
for (let i = 0; i < line.length; i++) { const P = i % 2 ? Bl : W; const r = await P.emit('game:move', { id: gameId, uci: line[i], ply: i }); if (!r.ok) console.log('move fail', i, r); await new Promise(r => setTimeout(r, 150)); }
const e = await end; console.log('end:', e.result, e.reason, 'diff', e.diff);
const g = await (await fetch(BASE + '/api/games/' + gameId)).json(); console.log('stored:', g.status, g.result, g.moves.join(' '), g.white, g.black);
const prof = await (await fetch(BASE + '/api/users/' + W.name)).json(); console.log('profile blitz', prof.ratings.blitz, 'games', prof.games.length);
// friend challenge + draw + rematch
const ch = await A.emit('challenge:create', { tc: '5+0', color: 'w' }); console.log('challenge', ch, await B.emit('challenge:info', { code: ch.code }));
const acc = await B.emit('challenge:accept', { code: ch.code }); const gid2 = acc.gameId; await A.emit('game:join', { id: gid2 }); await B.emit('game:join', { id: gid2 });
await A.emit('game:move', { id: gid2, uci: 'd2d4', ply: 0 }); await B.emit('game:move', { id: gid2, uci: 'd7d5', ply: 1 });
await new Promise(r => setTimeout(r, 300));
const st = await A.emit('game:join', { id: gid2 }); console.log('clock running after 2 moves:', st.game.clockRunning, 'rated:', st.game.rated);
console.log('draw offer', await A.emit('game:draw', { id: gid2, action: 'offer' }));
const end2 = A.wait('game:end'); console.log('draw accept', await B.emit('game:draw', { id: gid2, action: 'accept' })); console.log('end2', (await end2).reason);
const rm = A.wait('game:rematch', d => d.newGameId); await A.emit('game:rematch', { id: gid2, action: 'offer' }); await B.emit('game:rematch', { id: gid2, action: 'offer' });
const r3 = await rm; const s3 = await A.emit('game:join', { id: r3.newGameId }); console.log('rematch game', r3.newGameId, 'A is now', s3.game.you);
console.log('abort', await A.emit('game:abort', { id: r3.newGameId }));
console.log('stats', await new Promise(res => A.sock.once('lobby:stats', res)));
A.sock.close(); B.sock.close(); process.exit(0);
