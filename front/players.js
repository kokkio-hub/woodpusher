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
  else if (/^\/(@\/|leaderboard|admin)/.test(location.pathname)) history.replaceState(null, '', PL.from && !/^\/(@\/|leaderboard|admin)/.test(PL.from) ? PL.from : '/');
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
  if (PL.view === 'report') { el.innerHTML = plReportHTML(); return; }
  if (PL.view === 'admin') { el.innerHTML = plAdminHTML(); return; }
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
      <div class="pl-head-btns"><button class="btn btn-small" data-pl="board">Leaderboard</button>${plMe() && !me && !p.closed ? '<button class="btn btn-small" data-pl="report">Report</button>' : ''}</div></div>
    ${p.closed ? `<p class="offer">${p.closed === 'fairplay' ? 'This account is closed for breaking Woodpusher’s fair-play rules.' : 'This account is closed.'}</p>` : ''}
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

/* ---------------- reporting a player ---------------- */
const PL_REASONS = [['cheating', 'Uses computer help', 'Plays engine moves, gets outside help during games'], ['behaviour', 'Unsportsmanlike behaviour', 'Lets the clock run down on purpose, leaves lost games, abuses the messages'], ['username', 'Offensive username', ''], ['other', 'Something else', '']];
function plOpenReport(name, gameId) {
  if (!plAvailable()) return;
  if (!plMe()) { toast('Log in to report a player.'); return; }
  plSetUrl('/@/' + encodeURIComponent(name));
  PL.token++; PL.view = 'report'; PL.report = { name, gameId: gameId || null, reason: '', note: '', sent: false, busy: false, error: '' };
  plShow(); plRender();
}
function plReportHTML() {
  const R = PL.report;
  const head = `<button class="back-link" data-pl="back-profile">← ${esc(R.name)}</button><h2 class="pl-title" id="plTitle">Report ${esc(R.name)}</h2>`;
  if (R.sent) return head + `<p>Thanks. Your report went to Woodpusher’s admin, who looks at every one. ${esc(R.name)} doesn’t see who sent it.</p><div class="actions"><button class="btn btn-brass" data-pl="back-profile">Back to the profile</button></div>`;
  return head + `<p class="fine">${R.gameId ? 'About your game together. ' : ''}Only Woodpusher’s admin sees this.</p>
    <form class="form" id="plReportForm" novalidate><fieldset class="rp-reasons"><legend class="field-label">What happened?</legend>
      ${PL_REASONS.map(([k, label, sub]) => `<label class="check rp-reason"><input type="radio" name="reason" value="${k}" ${R.reason === k ? 'checked' : ''}><span><b>${esc(label)}</b>${sub ? `<br><span class="fine">${esc(sub)}</span>` : ''}</span></label>`).join('')}</fieldset>
      <label>Anything to add? <span class="fine">(optional)</span><textarea class="input rp-note" name="note" maxlength="500" rows="3" placeholder="For example which move, or what was said">${esc(R.note)}</textarea></label>
      ${R.error ? `<p class="err" role="alert">${esc(R.error)}</p>` : ''}
      <div class="actions"><button class="btn btn-brass" type="submit" ${R.busy ? 'disabled' : ''}>Send report</button><button class="btn" type="button" data-pl="back-profile">Cancel</button></div></form>`;
}
async function plSendReport(form) {
  const R = PL.report; const r = form.querySelector('[name=reason]:checked'); R.note = form.querySelector('[name=note]').value;
  R.reason = r ? r.value : ''; if (!R.reason) { R.error = 'Pick what happened.'; plRender(); return; }
  R.busy = true; R.error = ''; plRender();
  try { await api('/reports', { method: 'POST', body: { username: R.name, gameId: R.gameId, reason: R.reason, note: R.note } }); R.sent = true; }
  catch (e) { R.error = e.message; }
  R.busy = false; plRender();
}

/* ---------------- the admin view: reports and fair play ---------------- */
// Only for the usernames in the server's ADMIN_USERS variable (server/moderation.js)
async function plOpenAdmin() {
  if (!plAvailable()) return;
  plSetUrl('/admin');
  const token = ++PL.token; PL.view = 'admin'; PL.admin = null; PL.error = '';
  plShow(); plRender();
  try { const d = await api('/admin/overview'); if (token !== PL.token) return; PL.admin = d; }
  catch (e) { if (token !== PL.token) return; PL.error = e.message; }
  plRender();
}
const pct = (x) => Math.round((x || 0) * 100) + '%';
function plFpLine(fp, avg) {
  if (!fp) return '<span class="fine">No checked games yet.</span>';
  return `<span class="fine">${fp.games} game${fp.games === 1 ? '' : 's'} checked, ${fp.moves} moves: <b>${pct(fp.rate)}</b> Stockfish’s first choice, average loss <b>${Math.round(fp.acpl)}</b> centipawns${avg && avg.checks ? ` (everyone: ${pct(avg.rate)}, ${Math.round(avg.acpl)})` : ''}.${fp.worst ? ` Most engine-like game: ${pct(fp.worst.top1)}, ${Math.round(fp.worst.acpl)} over ${fp.worst.moves} moves <button class="pl-link" data-review="${esc(fp.worst.id)}">review it</button>.` : ''}</span>${fp.flag ? ' <span class="chip ad-flag">Flagged</span>' : ''}`;
}
function plCloseControls(name) {
  return `<span class="ad-close"><select class="select ad-sel" data-close-reason="${esc(name)}" aria-label="Why"><option value="fairplay">Fair play</option><option value="behaviour">Behaviour</option><option value="username">Username</option></select><button class="btn btn-small armable" data-adm="close" data-user="${esc(name)}">Close account</button></span>`;
}
function plAdminHTML() {
  const head = `<h2 class="pl-title" id="plTitle">Reports and fair play</h2><p class="fine">Only you see this. Nothing happens to an account until you act on it.</p>`;
  if (PL.error) return head + `<p class="err">${esc(PL.error)}</p>`;
  const d = PL.admin; if (!d) return head + '<p class="fine"><span class="spinner"></span>Loading…</p>';
  const open = d.reports.filter(r => r.status === 'open'), done = d.reports.filter(r => r.status !== 'open');
  const card = (r) => `<div class="ad-card${r.status !== 'open' ? ' done' : ''}">
      <div class="ad-top"><button class="pl-link" data-player="${esc(r.reported)}"><b>${esc(r.reported)}</b></button><span class="chip">${esc(d.reasons[r.reason] || r.reason)}</span>${r.closed ? '<span class="chip">closed</span>' : ''}<span class="fine">from ${esc(r.reporter)} · ${plDate(r.at, true)}${r.status !== 'open' ? ` · ${r.status}` : ''}</span></div>
      ${r.note ? `<p class="ad-note">${esc(r.note)}</p>` : ''}
      <div>${plFpLine(r.fp, d.average)}</div>
      <div class="actions">${r.gameId ? `<button class="btn btn-small" data-review="${esc(r.gameId)}">Review the game</button>` : ''}${r.status === 'open' ? `${r.closed ? '' : plCloseControls(r.reported)}<button class="btn btn-small" data-adm="dismiss" data-report="${r.id}">Nothing wrong</button>` : `<button class="btn btn-small" data-adm="reopen-report" data-report="${r.id}">Open again</button>`}</div></div>`;
  return head + `
    <section class="pl-sec"><span class="field-label">Open reports (${open.length})</span>${open.length ? open.map(card).join('') : '<p class="fine">No open reports.</p>'}</section>
    <section class="pl-sec"><span class="field-label">Flagged by the fair-play check (${d.flagged.length})</span>
      ${d.flagged.length ? d.flagged.map(f => `<div class="ad-card"><div class="ad-top"><button class="pl-link" data-player="${esc(f.username)}"><b>${esc(f.username)}</b></button></div><div>${plFpLine(f.fp, d.average)}</div><div class="actions">${plCloseControls(f.username)}<button class="btn btn-small" data-adm="clear" data-user="${esc(f.username)}">Looks fine</button></div></div>`).join('') : '<p class="fine">Nobody is flagged.</p>'}
      <p class="fine">Every finished rated game is checked with Stockfish from move 8 on. A player is flagged when, over their last 20 checked games, at least ${d.flagLines.recent.moves} moves were ${pct(d.flagLines.recent.top1)} or more Stockfish’s first choice with an average loss of ${d.flagLines.recent.acpl} or less; or when one game of ${d.flagLines.single.moves}+ moves reached ${pct(d.flagLines.single.top1)} and ${d.flagLines.single.acpl}. Strong players and short, simple games can come close, so a flag is a reason to look, not proof. “Looks fine” counts only games played after that.</p></section>
    <section class="pl-sec"><span class="field-label">Closed accounts (${d.closed.length})</span>${d.closed.length ? `<div class="game-list">${d.closed.map(c => `<div class="game-row ad-closed"><span></span><span><button class="pl-link" data-player="${esc(c.username)}">${esc(c.username)}</button><br><span class="meta">${esc(c.reason || '')} · ${plDate(c.at, true)}</span></span><button class="btn btn-small" data-adm="reopen" data-user="${esc(c.username)}">Reopen</button></div>`).join('')}</div>` : '<p class="fine">None.</p>'}</section>
    ${done.length ? `<section class="pl-sec"><span class="field-label">Handled in the last 30 days (${done.length})</span>${done.map(card).join('')}</section>` : ''}`;
}
async function plAdminAction(b) {
  const a = b.dataset.adm;
  try {
    if (a === 'dismiss' || a === 'reopen-report') await api('/admin/reports/' + b.dataset.report, { method: 'POST', body: { action: a === 'dismiss' ? 'dismiss' : 'reopen' } });
    else if (a === 'close') {
      const sel = [...document.querySelectorAll('#playerBody [data-close-reason]')].find(x => x.dataset.closeReason === b.dataset.user);
      await api('/admin/users/' + encodeURIComponent(b.dataset.user), { method: 'POST', body: { action: 'close', reason: sel ? sel.value : 'fairplay' } });
      toast(`${b.dataset.user}’s account is closed.`);
    } else await api('/admin/users/' + encodeURIComponent(b.dataset.user), { method: 'POST', body: { action: a } });
  } catch (e) { toast(e.message); return; }
  plOpenAdmin();
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
    if (b.dataset.pl === 'report' && PL.prof) { plOpenReport(PL.prof.username); return; }
    if (b.dataset.pl === 'back-profile' && PL.report) { plOpenProfile(PL.report.name); return; }
    if (b.dataset.adm) { if (b.dataset.adm === 'close') armOrRun(b, 'Close for sure?', () => plAdminAction(b)); else plAdminAction(b); return; }
  });
  modal.addEventListener('submit', (e) => { if (e.target.id === 'plReportForm') { e.preventDefault(); plSendReport(e.target); } });
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
    const b = e.target.closest('[data-open-player], [data-open-board], [data-open-report], [data-open-admin]'); if (!b) return;
    document.querySelectorAll('.modal-back').forEach(m => { if (m.id !== 'playerModal') m.hidden = true; });
    if (b.dataset.openBoard != null) plOpenBoard(); else if (b.dataset.openAdmin != null) plOpenAdmin();
    else if (b.dataset.openReport) plOpenReport(b.dataset.openReport, b.dataset.game); else plOpenProfile(b.dataset.openPlayer);
  });
  let rz = null; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (!modal.hidden && PL.view === 'profile' && PL.prof) plDrawChart(); }, 120); });
  // Arriving on a profile or leaderboard address
  const m = location.pathname.match(/^\/@\/([A-Za-z0-9_-]{1,30})\/?$/);
  if (m) { PL.from = '/'; plOpenProfile(m[1]); PL.pushed = false; }
  else if (location.pathname === '/leaderboard') { PL.from = '/'; plOpenBoard(); PL.pushed = false; }
  else if (location.pathname === '/admin') { PL.from = '/'; plOpenAdmin(); PL.pushed = false; }
}
window.WP_PLAYERS = { boot: plBoot, profile: plOpenProfile, board: plOpenBoard, report: plOpenReport, admin: plOpenAdmin, refresh: () => { if (!$('#playerModal').hidden && PL.view === 'profile' && PL.prof) plRender(); } };
