/* =====================================================================
   Profile pages (/@/name) and the leaderboard (/leaderboard): ratings
   per time control, a rating graph, the whole game history, and, on your
   own profile, your puzzle and opening progress. Shown in a large dialog
   over the board, so a game underneath keeps its place.
   ===================================================================== */
const PL = { view: null, name: null, prof: null, hist: null, cat: 'blitz', listAll: false, games: [], next: null, loading: false, error: '',
  board: null, boardCat: 'blitz', pushed: false, ignorePop: false, token: 0, from: null, hover: null };
const PL_CATS = [['bullet', 'Bullet'], ['blitz', 'Blitz'], ['rapid', 'Rapid'], ['classical', 'Classical']];
const plCatLabel = (c) => (PL_CATS.find(x => x[0] === c) || ['', 'All'])[1];
const plAvailable = () => typeof io !== 'undefined';
const plMe = () => (window.WP_ONLINE && window.WP_ONLINE.me()) || null;
const plIsMe = () => { const me = plMe(); return !!(me && PL.prof && me.username.toLowerCase() === PL.prof.username.toLowerCase()); };
function plDate(iso, withYear) { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('en-GB', withYear ? { day: 'numeric', month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short' }); }

/* ---------------- opening and closing ---------------- */
function plSetUrl(url) {
  const modal = $('#playerModal');
  if (modal.hidden) { PL.from = location.pathname; if (location.pathname !== url) { history.pushState({ wp: 'player' }, '', url); PL.pushed = true; } else PL.pushed = false; }
  else if (location.pathname !== url) history.replaceState({ wp: 'player' }, '', url);
}
function plShow() { const m = $('#playerModal'); if (m.hidden) { m.hidden = false; $('#playerBody').scrollTop = 0; } }
function plClose() {
  const m = $('#playerModal'); if (m.hidden) return;
  m.hidden = true; PL.token++;
  if (PL.pushed) { PL.pushed = false; PL.ignorePop = true; history.back(); }
  else if (/^\/(@\/|leaderboard)/.test(location.pathname)) history.replaceState(null, '', PL.from && !/^\/(@\/|leaderboard)/.test(PL.from) ? PL.from : '/');
}
async function plOpenProfile(name) {
  if (!plAvailable()) return;
  plSetUrl('/@/' + encodeURIComponent(name));
  const token = ++PL.token; PL.view = 'profile'; PL.name = name; PL.prof = null; PL.hist = null; PL.games = []; PL.next = null; PL.error = ''; PL.listAll = false; PL.hover = null;
  plShow(); plRender();
  try {
    const [prof, hist] = await Promise.all([api('/users/' + encodeURIComponent(name)), api('/users/' + encodeURIComponent(name) + '/ratings')]);
    if (token !== PL.token) return;
    PL.prof = prof; PL.hist = hist.ratings;
    // Start on the time control with the most games
    const best = PL_CATS.map(([c]) => [c, (prof.ratings[c] && prof.ratings[c].games) || 0]).sort((a, b) => b[1] - a[1])[0];
    PL.cat = best && best[1] ? best[0] : 'blitz';
    plRender(); plLoadGames(true);
  } catch (e) { if (token !== PL.token) return; PL.error = e.message; plRender(); }
}
async function plLoadGames(reset) {
  if (!PL.prof) return;
  const token = PL.token; if (reset) { PL.games = []; PL.next = null; }
  PL.loading = true; plRenderGames();
  try {
    const qs = new URLSearchParams({ cat: PL.listAll ? 'all' : PL.cat, limit: '20' }); if (!reset && PL.next) qs.set('before', PL.next);
    const d = await api(`/users/${encodeURIComponent(PL.prof.username)}/games?${qs}`);
    if (token !== PL.token) return;
    PL.games = reset ? d.games : PL.games.concat(d.games); PL.next = d.next;
  } catch (e) { if (token !== PL.token) return; PL.error = e.message; }
  PL.loading = false; plRenderGames();
}
async function plOpenBoard(cat) {
  if (!plAvailable()) return;
  plSetUrl('/leaderboard');
  if (cat) PL.boardCat = cat;
  const token = ++PL.token; PL.view = 'board'; PL.board = null; PL.error = '';
  plShow(); plRender();
  try { const d = await api('/leaderboard?cat=' + PL.boardCat); if (token !== PL.token) return; PL.board = d; }
  catch (e) { if (token !== PL.token) return; PL.error = e.message; }
  plRender();
}

/* ---------------- the profile ---------------- */
function plRender() {
  const el = $('#playerBody');
  if (PL.view === 'board') { el.innerHTML = plBoardHTML(); return; }
  if (!PL.prof) {
    el.innerHTML = `<h2 class="pl-title" id="plTitle">${esc(PL.name || 'Player')}</h2>${PL.error ? `<p class="err">${esc(PL.error)}</p>` : '<p class="fine"><span class="spinner"></span>Loading the profile…</p>'}`;
    return;
  }
  const p = PL.prof; const me = plIsMe();
  const total = PL_CATS.reduce((n, [c]) => { const r = p.records && p.records[c]; return n + (r ? r.w + r.d + r.l : 0); }, 0);
  const boxes = PL_CATS.map(([c, label]) => {
    const x = p.ratings[c] || { rating: 1500, provisional: true, games: 0 }; const rec = (p.records && p.records[c]) || { w: 0, d: 0, l: 0 };
    return `<button class="rbox pl-cat" data-cat="${c}" aria-pressed="${c === PL.cat}"><small>${label}</small><b>${x.rating}${x.provisional ? '?' : ''}</b><span class="rbox-n">${x.games} rated</span><span class="rbox-n pl-rec" title="Wins, draws and losses">${rec.w}–${rec.d}–${rec.l}</span></button>`;
  }).join('');
  el.innerHTML = `
    <div class="pl-head"><span class="you-ic" aria-hidden="true">${pieceSVG('wK')}</span>
      <div class="pl-who"><h2 class="pl-title" id="plTitle">${esc(p.username)}</h2><p class="fine">${esc(sinceText(p.createdAt))} · ${total} game${total === 1 ? '' : 's'}${me ? ' · <b>this is you</b>' : ''}</p></div>
      <button class="btn btn-small" data-pl="board">Leaderboard</button></div>
    <div class="ratings-row pl-cats" role="group" aria-label="Time control">${boxes}</div>
    <p class="fine">A <b>?</b> means the rating is still settling. The three numbers are wins, draws and losses.</p>
    <section class="pl-sec"><span class="field-label" id="plGraphLbl">${plCatLabel(PL.cat)} rating</span><div class="pl-chart" id="plChart"></div></section>
    ${me ? plProgressHTML() : ''}
    <section class="pl-sec"><div class="pl-list-head"><span class="field-label">Games</span>
      <div class="seg pl-filter" role="group" aria-label="Which games"><button class="seg-btn" data-all="0" aria-pressed="${!PL.listAll}">${plCatLabel(PL.cat)}</button><button class="seg-btn" data-all="1" aria-pressed="${PL.listAll}">All</button></div></div>
      <div id="plGames"></div></section>`;
  plDrawChart(); plRenderGames();
}
function plProgressHTML() {
  const s = PROG.pz; const lines = Object.values(PROG.lines); const perfect = lines.filter(x => x.perfect).length; const est = estimateElo();
  const synced = window.WP_SYNC && window.WP_SYNC.synced();
  return `<section class="pl-sec"><span class="field-label">Your progress${synced ? ' · saved to your account' : ''}</span>
    <div class="pl-prog">
      <div><small>Puzzles</small><b>${s.rating}</b><span class="fine">${s.solved} solved of ${s.tried} · best streak ${s.best}</span></div>
      <div><small>Openings</small><b>${lines.length}</b><span class="fine">line${lines.length === 1 ? '' : 's'} practised${lines.length ? `, ${perfect} without mistakes` : ''}</span></div>
      <div><small>Elo vs Stockfish</small><b>${!est ? '–' : est.above ? ELO_MAX + '+' : '≈' + est.elo}</b><span class="fine">${est ? esc(est.confidence) : 'Play Stockfish to get one'}</span></div>
    </div><p class="fine">Only you see this part.</p></section>`;
}
function plGameRowHTML(gm) {
  const res = gm.result === '1/2-1/2' ? 'draw' : (gm.result === '1-0') === (gm.color === 'w') ? 'win' : 'loss';
  const diff = gm.diff != null ? `<span class="d ${gm.diff > 0 ? 'up' : gm.diff < 0 ? 'down' : ''}">${gm.diff > 0 ? '+' : gm.diff < 0 ? MINUS : '±'}${Math.abs(gm.diff)}</span>` : '<span class="d"></span>';
  const moves = gm.plies ? `${Math.ceil(gm.plies / 2)} moves` : '';
  const meta = [gm.tc, gm.rated ? 'rated' : 'friend game', gm.reason || '', moves, plDate(gm.endedAt, new Date(gm.endedAt).getFullYear() !== new Date().getFullYear())].filter(Boolean).map(esc).join(' · ');
  const opp = gm.opponent === 'Deleted player' ? '<span>vs Deleted player</span>' : `<button class="pl-link" data-player="${esc(gm.opponent)}">vs ${esc(gm.opponent)}</button>`;
  return `<div class="game-row pl-game"><span class="res ${res}" aria-label="${res === 'win' ? 'Win' : res === 'loss' ? 'Loss' : 'Draw'}">${res === 'win' ? 'W' : res === 'loss' ? 'L' : '½'}</span>
    <span>${opp}${gm.oppRating ? ` <span class="meta">(${gm.oppRating})</span>` : ''}<br><span class="meta">${meta}</span></span>
    <span class="pl-row-end">${diff}<button class="btn btn-small" data-review="${esc(gm.id)}" ${gm.plies ? '' : 'disabled'}>Review</button></span></div>`;
}
function plRenderGames() {
  const el = $('#plGames'); if (!el) return;
  const what = PL.listAll ? '' : plCatLabel(PL.cat).toLowerCase() + ' ';
  let html = PL.games.length ? `<div class="game-list">${PL.games.map(plGameRowHTML).join('')}</div>` : PL.loading ? '' : `<p class="fine">No finished ${what}games yet.</p>`;
  if (PL.loading) html += '<p class="fine"><span class="spinner"></span>Loading games…</p>';
  else if (PL.next) html += '<button class="btn btn-small" data-pl="more">Show more games</button>';
  if (PL.error) html += `<p class="err">${esc(PL.error)}</p>`;
  el.innerHTML = html;
}

/* ---------------- the rating graph ---------------- */
// One line: the rating after each rated game, game number along the bottom. Hover, tap or the arrow
// keys show the exact rating, the change and the date; a table under it lists the same numbers.
function plSeries() {
  const h = PL.hist && PL.hist[PL.cat]; if (!h || !h.points.length) return [];
  return [{ n: 0, r: h.start, t: null }].concat(h.points.map((p, i) => ({ n: i + 1, r: p[1], t: p[0] })));
}
function plDrawChart() {
  const box = $('#plChart'); if (!box) return;
  const pts = plSeries(); const label = plCatLabel(PL.cat);
  if (pts.length < 2) { box.innerHTML = `<p class="fine pl-empty">No rated ${label.toLowerCase()} games yet. The graph starts after the first one.</p>`; return; }
  const W = Math.max(280, Math.round(box.clientWidth || 520)), H = 190, L = 44, R = 12, T = 12, B = 26;
  const rs = pts.map(p => p.r); let lo = Math.min(...rs), hi = Math.max(...rs);
  const pad = Math.max(20, (hi - lo) * 0.12); lo = Math.floor((lo - pad) / 25) * 25; hi = Math.ceil((hi + pad) / 25) * 25;
  const span = hi - lo; const step = [25, 50, 100, 200, 250, 500].find(s => span / s <= 4) || 1000;
  const x = (n) => L + (W - L - R) * (n / (pts.length - 1)); const y = (r) => T + (H - T - B) * (1 - (r - lo) / (hi - lo));
  let grid = '';
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) grid += `<line class="pl-grid" x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text class="pl-ax" x="${L - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${v}</text>`;
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.n).toFixed(1)},${y(p.r).toFixed(1)}`).join('');
  const area = `${d}L${x(pts[pts.length - 1].n).toFixed(1)},${H - B}L${x(0).toFixed(1)},${H - B}Z`;
  const last = pts[pts.length - 1];
  const ticks = `<text class="pl-ax" x="${L}" y="${H - 8}" text-anchor="start">Start</text><text class="pl-ax" x="${W - R}" y="${H - 8}" text-anchor="end">Game ${pts.length - 1}</text>`;
  const rows = pts.slice(1).slice(-30).reverse().map(p => `<tr><td>${p.n}</td><td>${p.r}</td><td>${p.t ? plDate(p.t, true) : ''}</td></tr>`).join('');
  box.innerHTML = `<div class="pl-plot" tabindex="0" role="img" aria-label="${esc(label)} rating over ${pts.length - 1} rated games, from ${pts[0].r} to ${last.r}, lowest ${Math.min(...rs)}, highest ${Math.max(...rs)}. Use the arrow keys to read each game.">
      <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">${grid}
        <path class="pl-area" d="${area}"/><path class="pl-line" d="${d}"/>
        <circle class="pl-end" cx="${x(last.n).toFixed(1)}" cy="${y(last.r).toFixed(1)}" r="4"/>${ticks}
        <g class="pl-cross" hidden><line class="pl-hair" y1="${T}" y2="${H - B}"/><circle class="pl-dot" r="5"/></g></svg>
      <div class="pl-tip" hidden></div></div>
    <details class="pl-table"><summary>Show as a table</summary><table><thead><tr><th>Game</th><th>Rating after</th><th>Date</th></tr></thead><tbody>${rows}</tbody></table>${pts.length > 31 ? '<p class="fine">The latest 30 games.</p>' : ''}</details>`;
  const plot = box.querySelector('.pl-plot'); const svg = plot.querySelector('svg'); const cross = svg.querySelector('.pl-cross'); const tip = plot.querySelector('.pl-tip');
  const show = (i) => {
    if (i == null) { cross.setAttribute('hidden', ''); tip.hidden = true; PL.hover = null; return; }
    i = clamp(i, 0, pts.length - 1); PL.hover = i; const p = pts[i]; const cx = x(p.n), cy = y(p.r);
    cross.removeAttribute('hidden'); cross.querySelector('.pl-hair').setAttribute('x1', cx); cross.querySelector('.pl-hair').setAttribute('x2', cx);
    cross.querySelector('.pl-dot').setAttribute('cx', cx); cross.querySelector('.pl-dot').setAttribute('cy', cy);
    const prev = i > 0 ? pts[i - 1].r : null; const ch = prev == null ? '' : p.r - prev;
    tip.textContent = '';
    const b = document.createElement('b'); b.textContent = String(p.r); tip.appendChild(b);
    const s = document.createElement('span'); s.textContent = i === 0 ? 'Before the first rated game' : `After game ${p.n}${ch !== '' ? ` · ${ch > 0 ? '+' : ch < 0 ? MINUS : '±'}${Math.abs(ch)}` : ''}${p.t ? ' · ' + plDate(p.t, true) : ''}`; tip.appendChild(s);
    tip.hidden = false;
    const scale = svg.getBoundingClientRect().width / W; const left = cx * scale; const tw = tip.offsetWidth;
    tip.style.left = clamp(left - tw / 2, 0, Math.max(0, plot.clientWidth - tw)) + 'px'; tip.style.top = Math.max(0, cy * scale - tip.offsetHeight - 12) + 'px';
  };
  const nearest = (clientX) => { const r = svg.getBoundingClientRect(); const fx = ((clientX - r.left) / r.width) * W; return Math.round(clamp((fx - L) / (W - L - R), 0, 1) * (pts.length - 1)); };
  plot.addEventListener('pointermove', (e) => show(nearest(e.clientX)));
  plot.addEventListener('pointerdown', (e) => show(nearest(e.clientX)));
  plot.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') show(null); });
  plot.addEventListener('blur', () => show(null));
  plot.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); show(PL.hover == null ? pts.length - 1 : PL.hover + (e.key === 'ArrowLeft' ? -1 : 1)); }
    else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); e.stopPropagation(); show(e.key === 'Home' ? 0 : pts.length - 1); }
  });
}

/* ---------------- the leaderboard ---------------- */
function plBoardHTML() {
  const seg = `<div class="seg pl-board-cats" role="group" aria-label="Time control" style="grid-template-columns:repeat(4,1fr)">${PL_CATS.map(([c, l]) => `<button class="seg-btn" data-board="${c}" aria-pressed="${c === PL.boardCat}">${l}</button>`).join('')}</div>`;
  const back = PL.prof ? `<button class="back-link" data-pl="back">← ${esc(PL.prof.username)}</button>` : '';
  const head = `${back}<h2 class="pl-title" id="plTitle">Leaderboard</h2><p class="fine">The highest-rated players per time control, from rated games on Woodpusher.</p>${seg}`;
  if (PL.error) return head + `<p class="err">${esc(PL.error)}</p>`;
  const d = PL.board; if (!d) return head + '<p class="fine"><span class="spinner"></span>Loading…</p>';
  const meName = (plMe() || {}).username;
  if (!d.players.length) return head + `<p class="fine">Nobody has played a rated ${plCatLabel(d.category).toLowerCase()} game yet. Play one from Play online and you're on the board.</p>`;
  const rows = d.players.map(p => `<li class="lb-row${meName && p.username.toLowerCase() === meName.toLowerCase() ? ' me' : ''}"><span class="lb-rank">${p.rank}</span><button class="pl-link lb-name" data-player="${esc(p.username)}">${esc(p.username)}</button><span class="lb-games">${p.games} game${p.games === 1 ? '' : 's'}</span><b class="lb-rating">${p.rating}${p.provisional ? '?' : ''}</b></li>`).join('');
  const inTop = meName && d.players.some(p => p.username.toLowerCase() === meName.toLowerCase());
  const you = d.you ? `<p class="fine lb-you">Your place: <b>${d.you.rank}</b> of ${d.total}, rating ${d.you.rating}${d.you.provisional ? '?' : ''}.</p>` : meName ? `<p class="fine lb-you">Play a rated ${plCatLabel(d.category).toLowerCase()} game to get a place.</p>` : '';
  return head + `<ol class="lb" aria-label="${esc(plCatLabel(d.category))} leaderboard">${rows}</ol>${inTop ? (d.you ? `<p class="fine lb-you">You are number ${d.you.rank} of ${d.total}.</p>` : '') : you}
    <p class="fine">Everyone with at least one rated game is listed. A <b>?</b> means the rating is still settling after only a few games.</p>`;
}

/* ---------------- wiring ---------------- */
function plReview(id) {
  if (S.mode === 'play') { toast('Finish or abandon your game first.'); return; }
  if (window.WP_ONLINE && window.WP_ONLINE.active()) { toast('Your online game is still running. Finish or resign it first.'); return; }
  const persp = PL.prof ? PL.prof.username : null;
  plClose(); trainerStop(); reviewOnlineGame(id, persp);
}
function plBoot() {
  if (!plAvailable() || PL.wired) return; PL.wired = true;
  const modal = $('#playerModal');
  $('#plClose').addEventListener('click', plClose);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) { plClose(); return; }
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    if (b.dataset.player) { plOpenProfile(b.dataset.player); return; }
    if (b.dataset.review) { plReview(b.dataset.review); return; }
    if (b.dataset.cat) { if (b.dataset.cat !== PL.cat) { PL.cat = b.dataset.cat; PL.hover = null; plRender(); if (!PL.listAll) plLoadGames(true); } return; }
    if (b.dataset.all != null) { const all = b.dataset.all === '1'; if (all !== PL.listAll) { PL.listAll = all; plRender(); plLoadGames(true); } return; }
    if (b.dataset.board) { if (b.dataset.board !== PL.boardCat) plOpenBoard(b.dataset.board); return; }
    if (b.dataset.pl === 'board') { const c = PL.cat; plOpenBoard(c); return; }
    if (b.dataset.pl === 'back' && PL.prof) { plOpenProfile(PL.prof.username); return; }
    if (b.dataset.pl === 'more') { plLoadGames(false); return; }
  });
  // Escape closes the dialog (and restores the address) before the page's own Escape handling
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) { e.stopImmediatePropagation(); plClose(); } }, true);
  // Back button closes it
  window.addEventListener('popstate', () => { if (PL.ignorePop) { PL.ignorePop = false; return; } if (!modal.hidden) { PL.pushed = false; modal.hidden = true; PL.token++; } });
  // Links anywhere on the page: the footer's Leaderboard, and profile links
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="/@/"], a[href="/leaderboard"]'); if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault(); const h = a.getAttribute('href');
    if (h === '/leaderboard') plOpenBoard(); else plOpenProfile(decodeURIComponent(h.slice(3)));
  });
  // Buttons elsewhere on the page (lobby, Settings, the online game) that open a profile or the leaderboard
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-open-player], [data-open-board]'); if (!b) return;
    document.querySelectorAll('.modal-back').forEach(m => { if (m.id !== 'playerModal') m.hidden = true; });
    if (b.dataset.openBoard != null) plOpenBoard(); else plOpenProfile(b.dataset.openPlayer);
  });
  let rz = null; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (!modal.hidden && PL.view === 'profile' && PL.prof) plDrawChart(); }, 120); });
  // Arriving on a profile or leaderboard address
  const m = location.pathname.match(/^\/@\/([A-Za-z0-9_-]{1,30})\/?$/);
  if (m) { PL.from = '/'; plOpenProfile(m[1]); PL.pushed = false; }
  else if (location.pathname === '/leaderboard') { PL.from = '/'; plOpenBoard(); PL.pushed = false; }
}
window.WP_PLAYERS = { boot: plBoot, profile: plOpenProfile, board: plOpenBoard, refresh: () => { if (!$('#playerModal').hidden && PL.view === 'profile' && PL.prof) plRender(); } };
