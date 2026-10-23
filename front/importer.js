/* =====================================================================
   Review a game: find your recent games on Lichess or Chess.com by
   username (the Woodpusher server fetches them, see server/import.js),
   or paste a PGN.
   ===================================================================== */
const IMP_KEY = 'woodpusher.import.v1';
const IMP_SITES = { lichess: 'Lichess', chesscom: 'Chess.com' };
const IMP = Object.assign({ tab: 'user', site: 'lichess', name: '' },
  (() => { try { return JSON.parse(localStorage.getItem(IMP_KEY)) || {}; } catch (e) { return {}; } })(),
  { busy: false, error: '', data: null, token: 0, wired: false });
if (!IMP_SITES[IMP.site]) IMP.site = 'lichess';
function saveImp() { try { localStorage.setItem(IMP_KEY, JSON.stringify({ tab: IMP.tab, site: IMP.site, name: IMP.name })); } catch (e) {} }
// The look-up needs the Woodpusher server; a copy of the page without it only offers pasting.
const impAvailable = () => typeof io !== 'undefined';

function impAgo(ms) {
  if (!ms) return '';
  const s = (Date.now() - ms) / 1000;
  if (s < 3600) { const m = Math.max(1, Math.round(s / 60)); return `${m} min ago`; }
  if (s < 86400) { const h = Math.round(s / 3600); return `${h} hour${h === 1 ? '' : 's'} ago`; }
  if (s < 7 * 86400) { const d = Math.round(s / 86400); return d === 1 ? 'yesterday' : `${d} days ago`; }
  const d = new Date(ms); const same = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-GB', same ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
}
const IMP_REASON = { checkmate: 'checkmate', resignation: 'resigned', 'on time': 'on time', abandonment: 'left the game', agreement: 'draw agreed', draw: 'draw', stalemate: 'stalemate', 'threefold repetition': 'repetition', 'insufficient material': 'insufficient material', 'the 50-move rule': '50-move rule', 'timeout vs insufficient material': 'timeout vs insufficient material', 'cheat detected': 'cheat detected' };

function impRow(g, i) {
  const you = g.you; const opp = you === 'b' ? g.white : g.black;
  const res = g.result === '1/2-1/2' ? 'draw' : you ? ((g.result === '1-0') === (you === 'w') ? 'win' : 'loss') : '';
  const badge = res === 'win' ? 'W' : res === 'loss' ? 'L' : res === 'draw' ? '½' : '·';
  const title = you ? `vs ${esc(opp.name)}${opp.rating ? ` <span class="meta">(${opp.rating})</span>` : ''}` : `${esc(g.white.name)} vs ${esc(g.black.name)}`;
  const meta = [g.tc, g.speed, g.rated ? 'rated' : 'casual', IMP_REASON[g.reason] || '', impAgo(g.endedAt)].filter(Boolean).map(esc).join(' · ');
  const label = `${res === 'win' ? 'Win' : res === 'loss' ? 'Loss' : res === 'draw' ? 'Draw' : 'Game'} ${you ? 'against ' + opp.name : g.white.name + ' against ' + g.black.name}, ${[g.tc, g.speed, impAgo(g.endedAt)].filter(Boolean).join(', ')}. Review it.`;
  return `<button class="game-row imp-row" data-imp="${i}" aria-label="${esc(label)}"><span class="res ${res}" aria-hidden="true">${badge}</span><span aria-hidden="true"><span>${title}</span><br><span class="meta">${meta}</span>${g.opening ? `<br><span class="meta">${esc(g.opening)}</span>` : ''}</span><span class="imp-go" aria-hidden="true">Review</span></button>`;
}
function impRender() {
  const can = impAvailable(); const user = can && IMP.tab === 'user';
  $('#impTabs').hidden = !can;
  document.querySelectorAll('#impTabs [data-imptab]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.imptab === (user ? 'user' : 'paste'))));
  $('#impUserPane').hidden = !user; $('#impPastePane').hidden = user;
  $('#pgnSample').hidden = user; $('#pgnGo').hidden = user; $('#pgnCancel').textContent = user ? 'Close' : 'Cancel';
  if (!can) return;
  document.querySelectorAll('#impSite .seg-btn').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.site === IMP.site)));
  const go = $('#impGo'); go.disabled = IMP.busy; go.textContent = IMP.busy ? 'Finding…' : 'Find games';
  const err = $('#impErr'); err.hidden = !IMP.error; err.textContent = IMP.error;
  const list = $('#impList'); const site = IMP_SITES[IMP.site];
  if (IMP.busy) list.innerHTML = `<p class="fine"><span class="spinner"></span>Fetching the games from ${esc(site)}…</p>`;
  else if (IMP.data && IMP.data.site === IMP.site) {
    const d = IMP.data;
    list.innerHTML = d.games.length
      ? `<span class="field-label">Recent games of ${esc(d.username)} on ${esc(IMP_SITES[d.site])}</span><div class="game-list">${d.games.map(impRow).join('')}</div><p class="fine">Standard chess only. Variants such as Chess960 are left out.</p>`
      : `<p class="fine">${esc(d.username)} has no finished games of standard chess on ${esc(IMP_SITES[d.site])} yet.</p>`;
  } else list.innerHTML = '';
}
async function impSearch() {
  const inp = $('#impName'); const name = inp.value.trim();
  if (!name) { IMP.error = 'Type a username first.'; impRender(); inp.focus(); return; }
  IMP.name = name; saveImp();
  IMP.busy = true; IMP.error = ''; const token = ++IMP.token; impRender();
  try {
    const d = await api(`/import/${IMP.site}/${encodeURIComponent(name)}`);
    if (token !== IMP.token) return;
    IMP.data = d;
  } catch (e) {
    if (token !== IMP.token) return;
    IMP.data = null; IMP.error = e instanceof TypeError ? 'No connection. Check your internet and try again.' : e.message;
  }
  IMP.busy = false; impRender();
}
function impReview(i) {
  const g = IMP.data && IMP.data.games[i]; if (!g) return;
  if (S.mode === 'play') { IMP.error = 'Finish or abandon your current game first.'; impRender(); return; }
  try { loadPGNForReview(g.pgn, { you: g.you, reason: g.reason }); $('#pgnModal').hidden = true; }
  catch (e) { IMP.error = e.message; impRender(); }
}
function impOpen(tab) {
  const can = impAvailable();
  if (can && (tab === 'user' || tab === 'paste')) { IMP.tab = tab; saveImp(); }
  impRender();
  if (can && IMP.tab === 'user') {
    const inp = $('#impName'); if (!inp.value) inp.value = IMP.name;
    // A remembered username shows its games straight away
    if (inp.value && !IMP.busy && !(IMP.data && IMP.data.site === IMP.site && IMP.data.username.toLowerCase() === inp.value.trim().toLowerCase())) impSearch();
    if (!inp.value) inp.focus();
  } else $('#pgnInput').focus();
}
function impBoot() {
  if (!impAvailable() || IMP.wired) return; IMP.wired = true;
  $('#btnFindGames').hidden = false;
  $('#ctaSub').textContent = 'Pick one of your games on Lichess or Chess.com by username, or paste a PGN, and get every move graded, from best to blunder.';
  $('#impTabs').addEventListener('click', (e) => { const b = e.target.closest('[data-imptab]'); if (!b) return; IMP.tab = b.dataset.imptab; saveImp(); impOpen(); });
  $('#impSite').addEventListener('click', (e) => { const b = e.target.closest('[data-site]'); if (!b || b.dataset.site === IMP.site) return; IMP.site = b.dataset.site; IMP.error = ''; IMP.token++; IMP.busy = false; saveImp(); impRender(); $('#impName').focus(); });
  $('#impForm').addEventListener('submit', (e) => { e.preventDefault(); impSearch(); });
  $('#impList').addEventListener('click', (e) => { const b = e.target.closest('[data-imp]'); if (b) impReview(+b.dataset.imp); });
}
window.WP_IMPORT = { open: impOpen, boot: impBoot };
