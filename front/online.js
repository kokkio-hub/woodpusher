/* =====================================================================
   Online play: accounts, lobby, matchmaking, live games (needs the Woodpusher server)
   ===================================================================== */
const ONLINE_TCS = TCS.filter(t => t.base > 0);
const ON = {
  me: null, loaded: false, sock: null, connected: false, stats: null, tc: '3+2',
  seeking: null, challenge: null, incoming: null, game: null, games: null, authTab: 'login', authError: '', authMsg: '', busy: false,
  confirmDelete: false, deleteError: '', offlineTick: null,
};
async function api(path, opts = {}) {
  const r = await fetch('/api' + path, { method: opts.method || 'GET', headers: opts.body ? { 'Content-Type': 'application/json' } : {}, body: opts.body ? JSON.stringify(opts.body) : undefined, credentials: 'same-origin' });
  let data = {}; try { data = await r.json(); } catch (e) {}
  if (!r.ok) throw new Error(data.error || 'Something went wrong. Try again.');
  return data;
}
function emitOn(ev, d) {
  return new Promise(res => {
    if (!ON.sock || !ON.sock.connected) { res({ error: 'Not connected to the server. Check your connection and try again.' }); return; }
    ON.sock.timeout(8000).emit(ev, d || {}, (err, r) => res(err ? { error: 'The server didn’t answer. Try again.' } : (r || { ok: true })));
  });
}
const ratingText = (p) => p ? `${p.rating}${p.provisional ? '?' : ''}` : '';
const myRating = (tcId) => { if (!ON.me) return null; const cat = categoryOfTc(tcId); const r = ON.me.ratings[cat]; return r ? `${r.rating}${r.provisional ? '?' : ''}` : '1500?'; };
function categoryOfTc(id) { const t = tcById(id); const est = t.base + 40 * t.inc; return est < 180 ? 'bullet' : est < 480 ? 'blitz' : est < 1500 ? 'rapid' : 'classical'; }
const onlineActive = () => !!(ON.game && ON.game.status === 'active' && ON.game.you);

function connectSocket() {
  if (ON.sock) { ON.sock.removeAllListeners(); ON.sock.disconnect(); }
  const s = io({ transports: ['websocket', 'polling'] });
  ON.sock = s;
  s.on('connect', () => { ON.connected = true; if (ON.game && ON.game.status === 'active') openGame(ON.game.id, true); else if (ON.seeking) emitOn('seek', { tc: ON.seeking.tc }); renderOnlineIfShown(); });
  s.on('disconnect', () => { ON.connected = false; renderOnlineIfShown(); });
  s.on('lobby:stats', (d) => { ON.stats = d; if (S.mode === 'online' && !ON.game) renderOnlinePanel(); });
  s.on('match', (d) => { ON.seeking = null; ON.challenge = null; Snd.bell(659.25, .1); openGame(d.gameId); });
  s.on('game:current', (d) => { if (!ON.game || ON.game.id !== d.id) { ON.current = d.id; if (S.mode === 'online' || location.pathname === '/') { openOnline(true); openGame(d.id); } } });
  s.on('game:move', onRemoteMove);
  s.on('game:end', onGameEnd);
  s.on('game:offer', (d) => {
    if (!ON.game || d.id !== ON.game.id) return;
    const before = ON.game.drawOffer; ON.game.drawOffer = d.drawOffer;
    if (d.drawOffer && d.drawOffer !== ON.game.you && before !== d.drawOffer) { toast(`${oppName()} offers a draw.`); Snd.bell(880, .06); }
    renderAll();
  });
  s.on('game:rematch', (d) => {
    if (!ON.game || d.id !== ON.game.id) return;
    if (d.newGameId) { openGame(d.newGameId); return; }
    ON.game.rematch = d.rematch;
    if (d.rematch && d.rematch !== ON.game.you) toast(`${oppName()} wants a rematch.`);
    renderAll();
  });
  s.on('game:presence', (d) => {
    if (!ON.game || d.id !== ON.game.id) return;
    ON.game.presence = { w: d.white, b: d.black, since: d.offlineSince, at: performance.now() };
    renderOnlineIfShown();
  });
}
function renderOnlineIfShown() { if (S.mode === 'online') renderAll(); }
const oppName = () => { const g = ON.game; if (!g || !S.line) return 'Your opponent'; return S.line.names[g.you === 'w' ? 'b' : 'w']; };

async function loadMe() {
  try { const d = await api('/me'); ON.me = d.user; } catch (e) { ON.me = null; }
  ON.loaded = true; renderUserSection();
}
async function loadMyGames() {
  if (!ON.me) { ON.games = null; return; }
  try { const d = await api('/users/' + encodeURIComponent(ON.me.username)); ON.games = d.games; ON.me.ratings = d.ratings; } catch (e) { ON.games = []; }
  renderUserSection();
  if (S.mode === 'online' && !ON.game) renderOnlinePanel();
}

/* ---------------- entering and leaving ---------------- */
function openOnline(keepGame = false) {
  clearTimers(); T.kind = null;
  if (!keepGame || !ON.game) {
    if (ON.game && ON.game.status !== 'active') { emitOn('game:leave', { id: ON.game.id }); ON.game = null; }
    S.engineToken++; if (ENG.main) ENG.main.cancelAll();
    S.game = null; S.chess = null; S.line = null; S.review = null; S.view = 0; S.bannerOpen = false; S.sel = null; S.legal = [];
    S.orientation = 'w';
    setMode('online'); renderCoords(); drawBoardCanvas(); renderPieces(START_FEN, false); renderAll();
    if (location.pathname !== '/' && !location.pathname.startsWith('/c/')) history.replaceState(null, '', '/');
  } else setMode('online');
  loadMyGames();
}
function leaveOnline() {
  if (ON.seeking) { emitOn('seek:cancel'); ON.seeking = null; }
  if (ON.challenge) { emitOn('challenge:cancel', { code: ON.challenge.code }); ON.challenge = null; }
  if (ON.game && ON.game.status !== 'active') { emitOn('game:leave', { id: ON.game.id }); ON.game = null; }
  if (location.pathname !== '/') history.replaceState(null, '', '/');
}

/* ---------------- games ---------------- */
async function openGame(id, quiet = false) {
  const r = await emitOn('game:join', { id });
  if (r.error) { if (!quiet) toast(r.error); return; }
  loadGameState(r.game);
}
function loadGameState(st) {
  clearTimers(); T.kind = null;
  const you = st.you;
  ON.game = { id: st.id, you, status: st.status, result: st.result, reason: st.reason, drawOffer: st.drawOffer, rematch: st.rematch, rated: st.rated, tc: st.tc, diff: st.diff,
    white: st.white, black: st.black, presence: { w: st.white.online !== false, b: st.black.online !== false, since: {}, at: performance.now() },
    firstMoveDeadline: st.firstMoveDeadline != null ? performance.now() + st.firstMoveDeadline : null };
  const c = new Chess(); const L = newLine(START_FEN, { w: st.white.name, b: st.black.name }, { w: ratingText(st.white), b: ratingText(st.black) }, { source: 'online', result: st.result || '*', reason: st.reason || '' });
  for (const u of st.moves) { const m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || undefined }); if (!m) break; m.uci = u; L.moves.push(m); L.fens.push(c.fen()); }
  S.chess = c; S.line = L; S.review = null; S.sel = null; S.legal = [];
  S.game = { playerColor: you || 'w', you, level: null, tc: st.tc, online: true,
    clock: { w: st.clocks.w, b: st.clocks.b, running: st.status === 'active' && st.clockRunning ? st.turn : null, last: performance.now() } };
  S.orientation = you || 'w'; S.view = liveIndex(); S.bannerOpen = st.status !== 'active' && !!st.result;
  setMode('online'); renderCoords(); drawBoardCanvas(); renderPieces(L.fens[S.view], false); renderAll();
  if (location.pathname !== '/game/' + st.id) history.replaceState(null, '', '/game/' + st.id);
  if (!ON.offlineTick) ON.offlineTick = setInterval(() => { if (S.mode === 'online' && ON.game && ON.game.status === 'active') renderOnlinePanel(); }, 1000);
}
function onRemoteMove(d) {
  const g = ON.game; if (!g || d.id !== g.id) return;
  const L = S.line;
  if (d.ply < L.moves.length) { /* our own move echoed back */ }
  else if (d.ply === L.moves.length) {
    const m = S.chess.move({ from: d.uci.slice(0, 2), to: d.uci.slice(2, 4), promotion: d.uci[4] || undefined });
    if (!m) { openGame(g.id, true); return; }
    m.uci = d.uci; L.moves.push(m); L.fens.push(S.chess.fen());
    const atLive = S.view === L.fens.length - 2; if (atLive) S.view = liveIndex();
    if (S.chess.in_check()) Snd.check(); else if (m.captured) Snd.capture(); else Snd.move();
    if (atLive) renderPieces(L.fens[S.view]);
    S.sel = null; S.legal = [];
  } else { openGame(g.id, true); return; }
  S.game.clock.w = d.clocks.w; S.game.clock.b = d.clocks.b; S.game.clock.running = d.clockRunning ? d.turn : null; S.game.clock.last = performance.now();
  g.drawOffer = d.drawOffer; if (L.moves.length >= 2) g.firstMoveDeadline = null; else if (L.moves.length === 1) g.firstMoveDeadline = performance.now() + 30000;
  renderAll();
}
async function onlineMove(mv) {
  const g = ON.game; if (!g) return;
  mv.uci = mv.from + mv.to + (mv.promotion || '');
  const ply = S.line.moves.length;
  S.line.fens.push(S.chess.fen()); S.line.moves.push(mv); S.view = liveIndex(); S.sel = null; S.legal = [];
  if (S.chess.in_check()) Snd.check(); else if (mv.captured) Snd.capture(); else Snd.move();
  if (tcById(g.tc).base) Snd.press();
  // stop our clock locally right away; the server's reply sets the exact times
  if (S.game.clock.running) { S.game.clock[g.you] = Math.max(0, remaining(g.you)); S.game.clock.running = null; }
  renderPieces(S.line.fens[S.view]); renderAll();
  const r = await emitOn('game:move', { id: g.id, uci: mv.uci, ply });
  if (r.error) { toast(r.error); openGame(g.id, true); }
}
function onGameEnd(d) {
  const g = ON.game; if (!g || d.id !== g.id) return;
  g.status = d.status; g.result = d.result; g.reason = d.reason; g.diff = d.diff; g.drawOffer = null; g.firstMoveDeadline = null;
  S.line.result = d.result || '*'; S.line.reason = d.reason;
  S.game.clock.w = d.clocks.w; S.game.clock.b = d.clocks.b; S.game.clock.running = null;
  S.bannerOpen = true; S.sel = null; S.legal = []; closePromo();
  Snd.end(); renderAll(); announce(resultSentence());
  loadMe().then(loadMyGames);
}

/* ---------------- lobby actions ---------------- */
async function findOpponent() {
  if (!ON.me) return;
  ON.busy = true; renderOnlinePanel();
  const r = await emitOn('seek', { tc: ON.tc });
  ON.busy = false;
  if (r.error) { toast(r.error); if (r.gameId) openGame(r.gameId); renderOnlinePanel(); return; }
  ON.seeking = { tc: ON.tc, since: performance.now() }; renderAll();
}
async function cancelSeek() { await emitOn('seek:cancel'); ON.seeking = null; renderAll(); }
async function createChallenge(color) {
  const r = await emitOn('challenge:create', { tc: ON.tc, color });
  if (r.error) { toast(r.error); return; }
  if (ON.seeking) { emitOn('seek:cancel'); ON.seeking = null; }
  ON.challenge = { code: r.code, tc: ON.tc, url: `${location.origin}/c/${r.code}` }; renderOnlinePanel();
}
async function cancelChallenge() { if (ON.challenge) await emitOn('challenge:cancel', { code: ON.challenge.code }); ON.challenge = null; renderOnlinePanel(); }
async function loadIncoming(code) {
  const r = await emitOn('challenge:info', { code });
  ON.incoming = r.error ? { code, error: r.error } : { code, from: r.from, tc: r.tc, color: r.color };
  renderOnlinePanel();
}
async function acceptIncoming() {
  const r = await emitOn('challenge:accept', { code: ON.incoming.code });
  if (r.error) { ON.incoming.error = r.error; renderOnlinePanel(); return; }
  ON.incoming = null; openGame(r.gameId);
}
async function reviewOnlineGame(id) {
  try {
    const d = await api('/games/' + encodeURIComponent(id));
    const c = new Chess(); const L = newLine(START_FEN, { w: d.white.name, b: d.black.name }, { w: d.white.rating ? String(d.white.rating) : 'White', b: d.black.rating ? String(d.black.rating) : 'Black' }, { source: 'online', result: d.result || '*', reason: d.reason || '' });
    for (const u of d.moves) { const m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || undefined }); if (!m) break; m.uci = u; L.moves.push(m); L.fens.push(c.fen()); }
    if (L.moves.length < 1) { toast('That game has no moves to review.'); return; }
    const you = ON.me && d.white.name === ON.me.username ? 'w' : ON.me && d.black.name === ON.me.username ? 'b' : null;
    S.chess = c; S.line = L; S.game = { playerColor: you || 'w', you, tc: d.tc, online: true, clock: { w: 0, b: 0, running: null, last: 0 } };
    S.orientation = you || 'w'; S.review = null;
    startReview();
  } catch (e) { toast(e.message); }
}

/* ---------------- account ---------------- */
async function submitAuth(form) {
  const username = form.querySelector('[name=username]').value.trim(); const password = form.querySelector('[name=password]').value;
  ON.authError = ''; ON.busy = true; renderOnlinePanel();
  try {
    const d = await api(ON.authTab === 'login' ? '/login' : '/register', { method: 'POST', body: { username, password } });
    ON.me = d.user; ON.authMsg = '';
    connectSocket(); loadMyGames();
    if (ON.incoming) loadIncoming(ON.incoming.code);
  } catch (e) { ON.authError = e.message; }
  ON.busy = false; renderOnlinePanel();
}
async function logout() {
  if (onlineActive()) { toast('Finish or resign your game first.'); return; }
  leaveOnline();
  try { await api('/logout', { method: 'POST', body: {} }); } catch (e) {}
  ON.me = null; ON.games = null; ON.game = null; connectSocket(); openOnline();
}
async function deleteAccount(password) {
  try { await api('/me', { method: 'DELETE', body: { password } }); ON.me = null; ON.games = null; ON.confirmDelete = false; ON.deleteError = ''; connectSocket(); toast('Your account has been deleted.'); openOnline(); }
  catch (e) { ON.deleteError = e.message; renderOnlinePanel(); }
}

/* ---------------- rendering ---------------- */
function tcGridHTML() {
  return `<div class="tc-grid" role="group" aria-label="Time control">${ONLINE_TCS.map(t => `<button class="tc-btn" data-tc="${t.id}" aria-pressed="${t.id === ON.tc}"><b>${t.id}</b><small>${t.kind}</small></button>`).join('')}</div>`;
}
function statsLine() {
  const s = ON.stats; if (!s) return '';
  const seekingAll = Object.values(s.seeking || {}).reduce((a, b) => a + b, 0); const here = (s.seeking || {})[ON.tc] || 0;
  return `<p class="stat-line">${s.online} online · ${s.games} game${s.games === 1 ? '' : 's'} in progress · ${seekingAll} looking for a game${here ? ` (${here} at ${ON.tc})` : ''}</p>`;
}
const mmss = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
// The panel is redrawn often: lobby stats arrive every 3 seconds, the seek timer ticks every second.
// A redraw must never cost someone what they are typing, so identical HTML leaves the page alone,
// and a real change carries typed text, focus and cursor position over to the new fields.
const panelKey = (n) => n.id ? '#' + CSS.escape(n.id) : n.name ? `[name="${n.name}"]` : n.dataset && n.dataset.act ? `[data-act="${n.dataset.act}"]` : n.dataset && n.dataset.tc ? `[data-tc="${n.dataset.tc}"]` : n.dataset && n.dataset.auth ? `[data-auth="${n.dataset.auth}"]` : null;
function renderOnlinePanel() {
  const el = $('#onlinePanel'); if (!el || S.mode !== 'online') return;
  const html = !ON.loaded ? '<p class="fine"><span class="spinner"></span>Connecting…</p>' : !ON.me ? authHTML() : ON.game ? gameHTML() : lobbyHTML();
  if (html === ON.panelHtml && el.firstChild) return;
  const typed = [...el.querySelectorAll('input:not([readonly]):not([type=hidden]), textarea')].map(n => [panelKey(n), n.value]).filter(([k, v]) => k && v);
  const a = document.activeElement; const focusKey = a && a !== el && el.contains(a) ? panelKey(a) : null;
  let sel = null; try { if (focusKey && typeof a.selectionStart === 'number') sel = [a.selectionStart, a.selectionEnd]; } catch (e) {}
  el.innerHTML = html; ON.panelHtml = html;
  for (const [k, v] of typed) { const n = el.querySelector(k); if (n && !n.readOnly && !n.value) n.value = v; }
  if (focusKey) { const n = el.querySelector(focusKey); if (n) { n.focus({ preventScroll: true }); if (sel) { try { n.setSelectionRange(sel[0], sel[1]); } catch (e) {} } } }
}
function authHTML() {
  const reg = ON.authTab === 'register';
  const inv = ON.incoming && !ON.incoming.error ? `<div class="offer"><b>${esc(ON.incoming.from)} challenges you to a ${esc(ON.incoming.tc)} game.</b><span class="fine">Log in or create an account to accept.</span></div>` : '';
  return `<div><h2>Play online</h2><p class="card-sub" style="margin:4px 0 0">Get paired with someone at your level, or send a friend a link.</p></div>${inv}
    <div class="seg" role="group" aria-label="Account" style="grid-template-columns:1fr 1fr">
      <button class="seg-btn" data-auth="login" aria-pressed="${!reg}">Log in</button>
      <button class="seg-btn" data-auth="register" aria-pressed="${reg}">Create account</button>
    </div>
    <form class="form" id="authForm" novalidate>
      <label>Username<input class="input" name="username" id="authUser" autocomplete="username" maxlength="20" required></label>
      <label>Password<input class="input" name="password" id="authPass" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}" minlength="${reg ? 8 : 1}" required></label>
      ${ON.authError ? `<p class="err" role="alert">${esc(ON.authError)}</p>` : ''}
      <button class="btn btn-brass" type="submit" ${ON.busy ? 'disabled' : ''}>${reg ? 'Create account' : 'Log in'}</button>
    </form>
    <p class="fine">${reg ? 'Usernames are public. Woodpusher stores only your username, a hashed password, your ratings and your games. No email address needed. ' : ''}<a href="/privacy.html" target="_blank" rel="noopener">Privacy statement</a></p>`;
}
function lobbyHTML() {
  const me = ON.me; const r = me.ratings || {};
  const box = (k, label) => { const x = r[k] || { rating: 1500, provisional: true }; return `<div class="rbox"><small>${label}</small><b>${x.rating}${x.provisional ? '?' : ''}</b></div>`; };
  let action;
  if (ON.incoming) {
    action = ON.incoming.error ? `<div class="offer"><span>${esc(ON.incoming.error)}</span><button class="btn btn-small" data-act="dismiss-incoming">OK</button></div>`
      : `<div class="offer"><b>${esc(ON.incoming.from)} challenges you to a ${esc(ON.incoming.tc)} game${ON.incoming.color === 'r' ? '' : `, and plays ${ON.incoming.color === 'w' ? 'White' : 'Black'}`}.</b><span class="fine">Friend games don't change your rating.</span><div class="actions"><button class="btn btn-brass" data-act="accept-incoming">Accept</button><button class="btn" data-act="dismiss-incoming">Decline</button></div></div>`;
  } else if (ON.seeking) {
    const waited = performance.now() - ON.seeking.since; const range = Math.min(800, 100 + Math.floor(waited / 5000) * 50);
    action = `<div class="seek-box" aria-live="polite"><b><span class="spinner"></span>Looking for an opponent</b><span class="fine">${esc(ON.seeking.tc)} · rated · waiting ${mmss(waited)} · rating range ±${range}</span>
      ${waited > 30000 ? `<span class="fine">Nobody around at this time control right now. Keep waiting, try another clock, or play Stockfish meanwhile.</span>` : ''}
      <div class="actions"><button class="btn" data-act="cancel-seek">Cancel</button>${waited > 30000 ? '<button class="btn" data-act="play-sf">Play Stockfish instead</button>' : ''}</div></div>`;
  } else if (ON.challenge) {
    action = `<div class="seek-box"><b>Challenge link ready</b><span class="fine">Send this link to a friend. The game starts as soon as they open it. Friend games are not rated.</span>
      <div class="link-row"><input class="input" id="chalUrl" readonly value="${esc(ON.challenge.url)}"><button class="btn" data-act="copy-link">Copy</button></div>
      <span class="fine"><span class="spinner"></span>Waiting for your friend · ${esc(ON.challenge.tc)}</span><div class="actions"><button class="btn" data-act="cancel-challenge">Cancel</button></div></div>`;
  } else {
    action = `<div class="actions"><button class="btn btn-brass" data-act="seek" ${ON.busy || !ON.connected ? 'disabled' : ''}>Find an opponent</button><button class="btn" data-act="challenge" ${!ON.connected ? 'disabled' : ''}>Challenge a friend</button></div>`;
  }
  const games = ON.games ? (ON.games.length ? `<div class="game-list">${ON.games.slice(0, 10).map(gm => {
    const res = gm.result === '1/2-1/2' ? 'draw' : (gm.result === '1-0') === (gm.color === 'w') ? 'win' : 'loss';
    return `<button class="game-row" data-review="${esc(gm.id)}"><span class="res ${res}">${res === 'win' ? 'W' : res === 'loss' ? 'L' : '½'}</span><span><span>vs ${esc(gm.opponent)}</span><br><span class="meta">${esc(gm.tc)} · ${gm.rated ? 'rated' : 'friend game'} · ${esc(gm.reason || '')}</span></span><span class="d ${gm.diff > 0 ? 'up' : gm.diff < 0 ? 'down' : ''}">${gm.diff != null ? (gm.diff > 0 ? '+' : gm.diff < 0 ? MINUS : '±') + Math.abs(gm.diff) : ''}</span></button>`;
  }).join('')}</div>` : '<p class="fine">Your finished games will appear here. Click one to review it.</p>') : '';
  const del = ON.confirmDelete ? `<form class="form" id="delForm"><label>Confirm with your password<input class="input" name="password" type="password" autocomplete="current-password" required></label>${ON.deleteError ? `<p class="err">${esc(ON.deleteError)}</p>` : ''}<div class="actions"><button class="btn armed" type="submit">Delete my account for good</button><button class="btn" type="button" data-act="cancel-delete">Keep my account</button></div></form>` : '';
  return `<div class="who-row"><h2>Play online</h2><span class="user-chip">${esc(me.username)}</span></div>
    <div class="ratings-row">${box('bullet', 'Bullet')}${box('blitz', 'Blitz')}${box('rapid', 'Rapid')}${box('classical', 'Classical')}</div>
    ${!ON.connected ? '<p class="err">Not connected to the server. Reconnecting…</p>' : ''}
    <div><span class="field-label">Clock · your rating ${esc(myRating(ON.tc) || '')}</span>${tcGridHTML()}</div>
    ${action}${statsLine()}
    <div><span class="field-label">Your recent games</span>${games}</div>
    <div class="account-row"><button class="back-link" data-act="logout">Log out</button><button class="danger-link" data-act="delete">Delete account</button></div>${del}`;
}
function gameHTML() {
  const g = ON.game; const L = S.line; const you = g.you; const active = g.status === 'active';
  const oppC = you === 'w' ? 'b' : 'w';
  let body = '';
  if (!you) body += `<p class="fine">You are watching this game.</p>`;
  if (active && you) {
    const myTurn = S.chess.turn() === you;
    if (g.firstMoveDeadline && L.moves.length < 2) { const left = g.firstMoveDeadline - performance.now(); if (left > 0) body += `<p class="fine">${myTurn ? `Make your first move within ${Math.ceil(left / 1000)} s, or the game is aborted.` : `Waiting for ${esc(oppName())} to make the first move.`}</p>`; }
    if (g.drawOffer && g.drawOffer !== you) body += `<div class="offer"><b>${esc(oppName())} offers a draw.</b><div class="actions"><button class="btn btn-brass" data-act="draw-accept">Accept draw</button><button class="btn" data-act="draw-decline">Decline</button></div></div>`;
    else if (g.drawOffer === you) body += `<p class="fine">Draw offered. Waiting for ${esc(oppName())}.</p>`;
    const pres = g.presence; const oppOnline = pres ? pres[oppC] : true;
    if (!oppOnline) {
      const since = pres.since && pres.since[oppC] ? pres.since[oppC] : null;
      const gone = since ? Date.now() - since : 0;
      body += `<div class="offer"><b>${esc(oppName())} left the game.</b>${gone >= 30000 ? '<div class="actions"><button class="btn btn-brass" data-act="claim">Claim the win</button></div>' : `<span class="fine">If they don't come back within ${Math.max(1, Math.ceil((30000 - gone) / 1000))} s, you can claim the win.</span>`}</div>`;
    }
    const canAbort = L.moves.length < 2;
    body += `<div class="actions">${canAbort ? '<button class="btn" data-act="abort">Abort</button>' : `<button class="btn" data-act="draw-offer" ${g.drawOffer === you ? 'disabled' : ''}>Offer draw</button><button class="btn" data-act="resign">Resign</button>`}</div>`;
  } else if (!active) {
    const diff = g.diff && you ? g.diff[you] : null;
    body += `<p class="annot-body" style="color:var(--ivory)">${esc(resultSentence())}${diff != null ? ` Rating ${diff >= 0 ? '+' : MINUS}${Math.abs(diff)}.` : ''}</p>`;
    if (you) {
      if (g.rematch && g.rematch !== you) body += `<div class="offer"><b>${esc(oppName())} wants a rematch.</b><div class="actions"><button class="btn btn-brass" data-act="rematch">Accept rematch</button><button class="btn" data-act="rematch-decline">Decline</button></div></div>`;
      body += `<div class="actions">${!(g.rematch && g.rematch !== you) ? `<button class="btn" data-act="rematch" ${g.rematch === you ? 'disabled' : ''}>${g.rematch === you ? 'Rematch offered' : 'Rematch'}</button>` : ''}<button class="btn btn-brass" data-act="new-opponent">New opponent</button>${L.moves.length ? '<button class="btn" data-act="review-current">Review game</button>' : ''}</div>`;
    }
    body += `<button class="back-link" data-act="lobby">← Back to the lobby</button>`;
  }
  const head = `${esc(L.names.w)} vs ${esc(L.names.b)}`;
  return `<div><h2>${active ? 'Live game' : 'Game over'}</h2><p class="card-sub" style="margin:4px 0 0">${head} · ${esc(g.tc)} · ${g.rated ? 'rated' : 'friend game'}</p></div>${body}`;
}
function onlineBanner() {
  const el = $('#banner'); const g = ON.game; const L = S.line;
  if (!(g && g.status !== 'active' && S.bannerOpen && L)) { el.hidden = true; return; }
  const w = L.result === '1-0' ? 'w' : L.result === '0-1' ? 'b' : null;
  const title = g.status === 'aborted' ? 'Aborted' : !w ? 'Drawn' : g.you ? (w === g.you ? 'You win' : `${L.names[w]} wins`) : `${L.names[w]} wins`;
  const kicker = { checkmate: 'Checkmate', stalemate: 'Stalemate', 'on time': 'Flag fall', resignation: 'Resigned', agreement: 'Draw agreed', abandonment: 'Opponent left', aborted: 'No result' }[L.reason] || 'Game over';
  const diff = g.diff && g.you ? g.diff[g.you] : null;
  el.innerHTML = `<div class="banner-card" role="dialog" aria-label="Game result"><button class="banner-close" id="bannerClose" aria-label="Close">×</button>
    <div class="banner-kicker">${kicker}</div><div class="banner-title">${esc(title)}</div><p class="banner-sub">${esc(resultSentence())}${diff != null ? `<br>Rating ${diff >= 0 ? '+' : MINUS}${Math.abs(diff)}` : ''}</p>
    <div class="banner-actions">${g.you ? '<button class="btn btn-brass" id="bnNewOpp">New opponent</button><button class="btn" id="bnRematchOn">Rematch</button>' : ''}${L.moves.length ? '<button class="btn" id="bnReviewOn">Review</button>' : ''}</div></div>`;
  el.hidden = false;
  $('#bannerClose').onclick = () => { S.bannerOpen = false; onlineBanner(); };
  const nb = $('#bnNewOpp'); if (nb) nb.onclick = () => { S.bannerOpen = false; newOpponent(); };
  const rb = $('#bnRematchOn'); if (rb) rb.onclick = () => { S.bannerOpen = false; onlineBanner(); emitOn('game:rematch', { id: g.id, action: 'offer' }).then(r => { if (r.error) toast(r.error); }); };
  const vb = $('#bnReviewOn'); if (vb) vb.onclick = () => startReview();
}
function newOpponent() { const tc = ON.game ? ON.game.tc : ON.tc; ON.tc = tc; openOnline(); findOpponent(); }
function onlineNote() {
  const g = ON.game; if (!g) return ON.seeking ? 'Looking for an opponent…' : '';
  if (g.status !== 'active') return '';
  if (S.view !== liveIndex()) return 'Looking back. Press → or End to return to the game.';
  if (!g.you) return `${S.chess.turn() === 'w' ? S.line.names.w : S.line.names.b} to move.`;
  return S.chess.turn() === g.you ? 'Your move.' : `Waiting for ${oppName()}…`;
}

/* ---------------- wiring ---------------- */
function wireOnline() {
  $('#btnOnline').hidden = false;
  $('#btnOnline').addEventListener('click', (e) => {
    if (S.mode === 'online' && ON.game && ON.game.status === 'active') return;
    if (S.mode === 'play' && S.line && S.line.moves.length) { armOrRun(e.currentTarget, 'Leave this game?', () => { abandonGame(); openOnline(); }); return; }
    if (S.mode === 'review' && S.review) { S.review.token++; ENG.pool.forEach(x => x.cancelAll()); }
    trainerStop(); openOnline();
  });
  // Don't let other tabs pull you out of a live online game
  document.querySelector('.top-actions').addEventListener('click', (e) => {
    const b = e.target.closest('.tab'); if (!b || b.id === 'btnOnline' || !onlineActive() || S.mode !== 'online') return;
    e.stopImmediatePropagation(); e.preventDefault(); toast('Your online game is still running. Finish or resign it first.');
  }, true);
  const panel = $('#onlinePanel');
  panel.addEventListener('submit', (e) => {
    e.preventDefault();
    if (e.target.id === 'authForm') submitAuth(e.target);
    if (e.target.id === 'delForm') deleteAccount(e.target.querySelector('[name=password]').value);
  });
  panel.addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    if (b.dataset.auth) { ON.authTab = b.dataset.auth; ON.authError = ''; renderOnlinePanel(); return; }
    if (b.dataset.tc) { ON.tc = b.dataset.tc; renderAll(); return; }
    if (b.dataset.review) { reviewOnlineGame(b.dataset.review); return; }
    const g = ON.game; const act = b.dataset.act;
    const send = async (ev, d) => { const r = await emitOn(ev, d); if (r.error) toast(r.error); return r; };
    switch (act) {
      case 'seek': findOpponent(); break;
      case 'cancel-seek': cancelSeek(); break;
      case 'challenge': createChallenge('r'); break;
      case 'cancel-challenge': cancelChallenge(); break;
      case 'copy-link': { const inp = $('#chalUrl'); try { await navigator.clipboard.writeText(inp.value); toast('Link copied.'); } catch (err) { inp.select(); } break; }
      case 'accept-incoming': acceptIncoming(); break;
      case 'dismiss-incoming': ON.incoming = null; history.replaceState(null, '', '/'); renderOnlinePanel(); break;
      case 'play-sf': await cancelSeek(); abandonGame(); break;
      case 'logout': logout(); break;
      case 'delete': ON.confirmDelete = true; ON.deleteError = ''; renderOnlinePanel(); break;
      case 'cancel-delete': ON.confirmDelete = false; renderOnlinePanel(); break;
      case 'abort': send('game:abort', { id: g.id }); break;
      case 'resign': armOrRun(b, 'Confirm resign', () => send('game:resign', { id: g.id })); break;
      case 'draw-offer': await send('game:draw', { id: g.id, action: 'offer' }); g.drawOffer = g.drawOffer || g.you; renderAll(); break;
      case 'draw-accept': send('game:draw', { id: g.id, action: 'accept' }); break;
      case 'draw-decline': await send('game:draw', { id: g.id, action: 'decline' }); g.drawOffer = null; renderAll(); break;
      case 'claim': send('game:claim', { id: g.id }); break;
      case 'rematch': { const r = await send('game:rematch', { id: g.id, action: 'offer' }); if (!r.error && !r.gameId) { g.rematch = g.you; renderAll(); } break; }
      case 'rematch-decline': await send('game:rematch', { id: g.id, action: 'decline' }); g.rematch = null; renderAll(); break;
      case 'new-opponent': newOpponent(); break;
      case 'review-current': startReview(); break;
      case 'lobby': openOnline(); break;
    }
  });
  setInterval(() => { if (S.mode === 'online' && ON.seeking && !ON.game) renderOnlinePanel(); }, 1000);
}
async function bootOnline() {
  if (typeof io === 'undefined') return;
  wireOnline();
  await loadMe();
  connectSocket();
  const path = location.pathname;
  const mChal = path.match(/^\/c\/([A-Za-z0-9]+)$/); const mGame = path.match(/^\/game\/([A-Za-z0-9]+)$/);
  if (mChal) { openOnline(); ON.incoming = { code: mChal[1], from: '…', tc: '' }; const wait = () => ON.connected ? loadIncoming(mChal[1]) : setTimeout(wait, 200); wait(); }
  else if (mGame) { openOnline(); const wait = () => ON.connected ? openGame(mGame[1]) : setTimeout(wait, 200); wait(); }
}
window.WP_ONLINE = {
  canMove: () => !!(ON.game && ON.game.status === 'active' && ON.game.you && S.chess && S.chess.turn() === ON.game.you),
  move: onlineMove, render: renderOnlinePanel, banner: onlineBanner, note: onlineNote, open: () => openOnline(),
  leave: leaveOnline, boot: bootOnline, tc: () => ON.tc,
  available: () => typeof io !== 'undefined', loaded: () => ON.loaded, me: () => ON.me,
  login: () => { ON.authTab = 'login'; ON.authError = ''; $('#btnOnline').click(); },
  logout: () => { if (onlineActive()) { toast('Finish or resign your game first.'); return false; } logout(); return true; },
  plate: (c) => c === S.orientation
    ? { n: ON.me ? ON.me.username : 'You', s: ON.me ? `Rating ${myRating(ON.tc)}` : 'Log in to play' }
    : { n: ON.seeking ? 'Searching…' : 'Opponent', s: ON.seeking ? `${ON.seeking.tc} · rated` : 'Not paired yet' },
};
