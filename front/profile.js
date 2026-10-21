/* =====================================================================
   You: an estimated Elo from your games against Stockfish and the accuracy
   of your reviewed games (kept in this browser only), plus your account
   and online ratings when the Woodpusher server is there.
   ===================================================================== */
const HIST_KEY = 'woodpusher.history.v1';
const HIST_MAX = 120;
const HIST = (() => {
  try { const h = JSON.parse(localStorage.getItem(HIST_KEY)); if (h && Array.isArray(h.games)) return h; } catch (e) {}
  return { v: 1, games: [] };            // newest first
})();
function saveHist() { if (HIST.games.length > HIST_MAX) HIST.games.length = HIST_MAX; try { localStorage.setItem(HIST_KEY, JSON.stringify(HIST)); } catch (e) {} }
const histId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// A finished game against Stockfish: who won, at what strength.
function recordStockfishGame() {
  const L = S.line, g = S.game;
  if (!L || !g || L.source !== 'play' || g.online || !g.elo) return null;
  if (L.result === '*' || L.reason === 'aborted') return null;
  const mine = L.moves.filter(m => m.color === g.playerColor).length;
  if (mine < 5 && L.reason !== 'checkmate') return null;   // a resignation after two moves says nothing about strength
  const w = L.result === '1-0' ? 'w' : L.result === '0-1' ? 'b' : null;
  const score = w ? (w === g.playerColor ? 1 : 0) : 0.5;
  if (!g.histId) g.histId = histId();
  const rec = { id: g.histId, at: Date.now(), kind: 'sf', elo: g.elo, color: g.playerColor, score, tc: g.tc, plies: L.moves.length, takebacks: g.takebacks || 0, key: lineKey(L), acc: null };
  const old = HIST.games.find(x => x.id === rec.id);
  if (old) Object.assign(old, rec, { acc: old.acc }); else HIST.games.unshift(rec);
  saveHist();
  return old || rec;
}

// A finished review of one of your own games: how accurately you played.
function recordReviewAccuracy() {
  const L = S.line, g = S.game, R = S.review;
  if (!L || !g || !R || !R.done) return;
  let color, kind;
  if (L.source === 'play' && !g.online) { color = g.playerColor; kind = 'sf'; }
  else if (L.source === 'online' && g.you) { color = g.you; kind = 'online'; }
  else return;                                                // PGN imports: we don't know which side was you
  const own = L.moves.filter((m, i) => m.color === color && R.cls[i] && R.cls[i] !== 'forced').length;
  if (own < 8) return;
  const acc = accuracyOf(color); if (acc == null) return;
  const key = lineKey(L);
  let rec = HIST.games.find(x => x.key === key && x.kind === kind && x.color === color);
  if (!rec && kind === 'sf') rec = recordStockfishGame();
  if (!rec && kind === 'online') { rec = { id: histId(), at: Date.now(), kind, color, key, acc: null }; HIST.games.unshift(rec); }
  if (!rec) return;
  const a = Math.round(acc * 10) / 10;
  if (rec.acc === a) return;
  rec.acc = a; saveHist();
}

// Rough link between game accuracy and playing strength. Accuracy depends on the opponent and the
// kind of game too, so the model trusts it much less than results.
const ACC_TO_ELO = [[40, 500], [55, 800], [65, 1100], [73, 1400], [80, 1700], [85, 2000], [89, 2300], [93, 2600], [96, 2900]];
function eloFromAccuracy(a) {
  const P = ACC_TO_ELO; if (a <= P[0][0]) return P[0][1]; if (a >= P[P.length - 1][0]) return P[P.length - 1][1];
  for (let i = 1; i < P.length; i++) if (a <= P[i][0]) { const [a0, e0] = P[i - 1], [a1, e1] = P[i]; return e0 + (e1 - e0) * (a - a0) / (a1 - a0); }
  return P[P.length - 1][1];
}

// Bayesian estimate on a grid: a broad prior around 1200, the Elo formula for each result against
// Stockfish, and a weak pull towards what your accuracy suggests. Recent games count more.
function estimateElo() {
  const sf = HIST.games.filter(x => x.kind === 'sf' && x.score != null);
  const accs = HIST.games.filter(x => x.acc != null);
  if (!sf.length && !accs.length) return null;
  const LO = 100, HI = 3200, STEP = 10, N = (HI - LO) / STEP + 1;
  const lp = new Float64Array(N);
  for (let k = 0; k < N; k++) { const r = LO + k * STEP; lp[k] = -0.5 * ((r - 1200) / 500) ** 2; }
  let si = 0, ai = 0;
  for (const x of HIST.games) {
    if (x.kind === 'sf' && x.score != null) {
      const w = Math.pow(0.97, si++) * (x.takebacks ? 0.5 : 1);
      for (let k = 0; k < N; k++) { const p = 1 / (1 + Math.pow(10, (x.elo - (LO + k * STEP)) / 400)); lp[k] += w * (x.score * Math.log(p) + (1 - x.score) * Math.log(1 - p)); }
    }
    if (x.acc != null) {
      const w = Math.pow(0.97, ai++); const m = eloFromAccuracy(x.acc);
      for (let k = 0; k < N; k++) lp[k] -= 0.5 * w * (((LO + k * STEP) - m) / 450) ** 2;
    }
  }
  let mx = -Infinity; for (let k = 0; k < N; k++) mx = Math.max(mx, lp[k]);
  let z = 0, m1 = 0, m2 = 0;
  for (let k = 0; k < N; k++) { const p = Math.exp(lp[k] - mx), r = LO + k * STEP; z += p; m1 += p * r; m2 += p * r * r; }
  const mean = m1 / z, sd = Math.sqrt(Math.max(0, m2 / z - mean * mean));
  const r50 = (v) => Math.round(v / 50) * 50;
  // Only wins (or only losses) say how far you are above (or below) Stockfish, not where you are.
  const oneSided = sf.length > 0 && (sf.every(x => x.score === 1) || sf.every(x => x.score === 0));
  let confidence = sd >= 250 ? 'Rough guess' : sd >= 150 || oneSided ? 'Taking shape' : 'Fairly settled';
  const above = mean > ELO_MAX;           // beating the strongest setting: the scale runs out
  if (above) confidence = 'Off the scale';
  return {
    elo: Math.round(mean / 10) * 10, sd, lo: Math.max(100, r50(mean - sd)), hi: r50(mean + sd), above,
    games: sf.length, reviews: accs.length, confidence,
  };
}

/* ---------------- the user section at the top of Settings ---------------- */
const RATING_CATS = [['bullet', 'Bullet'], ['blitz', 'Blitz'], ['rapid', 'Rapid'], ['classical', 'Classical']];
function sinceText(iso) { const d = new Date(iso); return isNaN(d) ? '' : `Member since ${d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}`; }
function renderUserSection() {
  const el = $('#userSection'); if (!el) return;
  const OW = window.WP_ONLINE; const online = !!(OW && OW.available && OW.available());
  const me = online ? OW.me() : null; const checking = online && !OW.loaded();
  const name = me ? me.username : checking ? 'Checking your account…' : online ? 'Guest' : 'You';
  const sub = me ? sinceText(me.createdAt) : checking ? '' : online ? 'Not logged in' : 'Playing offline';
  const est = estimateElo();
  const games = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  let detail;
  if (!est) detail = 'Play a game against Stockfish and Woodpusher will start guessing your Elo. Reviewing your games afterwards sharpens the guess.';
  else {
    const from = [est.games ? `${games(est.games, 'game')} against Stockfish` : '', est.reviews ? `${games(est.reviews, 'reviewed game')}` : ''].filter(Boolean).join(' and ');
    detail = est.above
      ? `You beat Stockfish even at its strongest setting here (${ELO_MAX}), so Woodpusher can't measure higher. Based on ${from}.`
      : `Likely between ${est.lo} and ${est.hi}, from ${from}. Recent games count more.`;
  }
  let ratings = '';
  if (me) {
    const r = me.ratings || {};
    ratings = `<div class="user-ratings"><span class="field-label">Online ratings</span>
      <div class="ratings-row">${RATING_CATS.map(([k, label]) => { const x = r[k] || { rating: 1500, provisional: true, games: 0 };
        return `<div class="rbox"><small>${label}</small><b>${x.rating}${x.provisional ? '?' : ''}</b><span class="rbox-n">${games(x.games || 0, 'game')}</span></div>`; }).join('')}</div>
      <p class="fine">A <b>?</b> means the rating is still a guess. It settles after a handful of rated games.</p></div>`;
  }
  let action = '';
  if (me) action = `<button class="btn btn-small" data-user="logout">Log out</button>`;
  else if (online && !checking) action = `<button class="btn btn-brass btn-small" data-user="login">Log in or create an account</button>`;
  el.innerHTML = `
    <div class="you"><span class="you-ic" aria-hidden="true">${pieceSVG('wK')}</span><span class="you-text"><span class="you-name">${esc(name)}</span>${sub ? `<span class="you-sub">${esc(sub)}</span>` : ''}</span></div>
    <div class="est"><small>Estimated Elo</small><b>${!est ? '–' : est.above ? ELO_MAX + '+' : '≈' + est.elo}</b><span class="chip">${est ? est.confidence : 'No games yet'}</span></div>
    <p class="fine user-detail">${esc(detail)}${online ? '' : ' Accounts and online ratings live on the Woodpusher website.'}</p>
    ${ratings}
    ${action ? `<div class="user-actions">${action}</div>` : ''}`;
}
function wireUserSection() {
  $('#userSection').addEventListener('click', (e) => {
    const b = e.target.closest('[data-user]'); if (!b || !window.WP_ONLINE) return;
    if (b.dataset.user === 'login') { $('#settingsModal').hidden = true; window.WP_ONLINE.login(); }
    if (b.dataset.user === 'logout') { if (window.WP_ONLINE.logout()) $('#settingsModal').hidden = true; }
  });
}
