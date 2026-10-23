/* =====================================================================
   Progress follows your account: your puzzle rating and streaks, the
   opening lines you practised, and your games against Stockfish (behind
   the estimated Elo). This browser keeps a copy, so it works offline too;
   changes go to the server a moment later and are merged there with what
   your other devices sent (server/progress.js).
   ===================================================================== */
const SYNC_KEY = 'woodpusher.sync.v1';
// owner: the account this browser's copy belongs to. mergeId: progress made before logging in that is
// on its way into the account (kept across a reload, so a retry doesn't count it twice).
const SYNC = Object.assign({ owner: null, mergeId: null },
  (() => { try { return JSON.parse(localStorage.getItem(SYNC_KEY)) || {}; } catch (e) { return {}; } })(),
  { user: undefined, rev: 0, timer: null, busy: false, again: false, last: 0, failures: 0, silent: false, wired: false });
function saveSyncState() { try { localStorage.setItem(SYNC_KEY, JSON.stringify({ owner: SYNC.owner, mergeId: SYNC.mergeId })); } catch (e) {} }

const PZ_START = () => ({ rating: 1200, solved: 0, tried: 0, streak: 0, best: 0, seen: {} });
const progressPayload = () => ({ lines: PROG.lines, pz: PROG.pz, hist: HIST.games, mist: PROG.mist, daily: PROG.daily });
const hasLocalProgress = () => PROG.pz.tried > 0 || Object.keys(PROG.lines).length > 0 || HIST.games.length > 0 || PROG.mist.length > 0 || Object.keys(PROG.daily).length > 0;
function setLocalProgress(d) {
  PROG.lines = (d && d.lines) || {}; PROG.pz = Object.assign(PZ_START(), (d && d.pz) || {});
  HIST.games = d && Array.isArray(d.hist) ? d.hist : [];
  PROG.mist = d && Array.isArray(d.mist) ? d.mist : []; PROG.daily = (d && d.daily) || {};
  SYNC.silent = true; try { saveProg(); saveHist(); } finally { SYNC.silent = false; }
  renderUserSection();
  if (S.mode === 'puzzle' || S.mode === 'lesson') renderTrainer();
  if (window.WP_PLAYERS) window.WP_PLAYERS.refresh();
}
// trainer.js and profile.js call this whenever they save
function progressChanged() { if (SYNC.silent) return; SYNC.rev++; schedulePush(1500); }
function schedulePush(ms) {
  if (!SYNC.user || SYNC.owner !== SYNC.user.id) return;
  clearTimeout(SYNC.timer); SYNC.timer = setTimeout(() => pushProgress(), ms);
}
async function pushProgress(extra) {
  if (!SYNC.user) return false;
  if (SYNC.busy) { SYNC.again = true; return false; }
  SYNC.busy = true; const rev = SYNC.rev; const uid = SYNC.user.id; let ok = false;
  try {
    const d = await api('/progress', { method: 'PUT', body: Object.assign({ progress: progressPayload() }, extra || {}) });
    ok = true; SYNC.failures = 0; SYNC.last = Date.now();
    if (SYNC.user && SYNC.user.id === uid) {
      SYNC.owner = uid; if (extra && extra.guest) SYNC.mergeId = null; saveSyncState();
      if (SYNC.rev === rev) setLocalProgress(d.progress); else SYNC.again = true;   // newer changes go up next
    }
  } catch (e) {
    // Offline, or the server is restarting: try again a little later
    SYNC.failures++; clearTimeout(SYNC.timer);
    SYNC.timer = setTimeout(() => pushProgress(extra), Math.min(5 * 60 * 1000, 15000 * SYNC.failures));
  } finally {
    SYNC.busy = false;
    if (SYNC.again) { SYNC.again = false; schedulePush(400); }
  }
  return ok;
}
// online.js calls this when it knows who is logged in (null: nobody), and after logging in or out
async function syncUser(me) {
  const prev = SYNC.user; SYNC.user = me || null;
  if (!me) {
    // Logged out (not just offline): this browser's copy belonged to the account, which keeps it
    if (prev) { clearTimeout(SYNC.timer); SYNC.owner = null; SYNC.mergeId = null; saveSyncState(); setLocalProgress(null); }
    return;
  }
  if (prev && prev.id === me.id) return;
  if (SYNC.owner === me.id) { await pushProgress(); return; }
  if (SYNC.owner == null && hasLocalProgress()) {
    // Progress made here before logging in goes into the account, added to what it already has
    if (!SYNC.mergeId) { SYNC.mergeId = 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); saveSyncState(); }
    if (await pushProgress({ guest: true, mergeId: SYNC.mergeId })) { SYNC.mergeId = null; saveSyncState(); }
    return;
  }
  // Another account's copy, or nothing yet: start from what this account has
  if (SYNC.owner != null && SYNC.owner !== me.id) setLocalProgress(null);
  await pushProgress();
}
// Before logging out: send anything not sent yet
async function flushProgress() { clearTimeout(SYNC.timer); if (SYNC.user && SYNC.owner === SYNC.user.id) await pushProgress(); }
function syncBoot() {
  if (typeof io === 'undefined' || SYNC.wired) return; SYNC.wired = true;
  // Back on the page after a while: pick up what other devices did meanwhile
  document.addEventListener('visibilitychange', () => { if (!document.hidden && SYNC.user && Date.now() - SYNC.last > 60 * 1000) pushProgress(); });
  window.addEventListener('online', () => { if (SYNC.user && SYNC.failures) pushProgress(); });
}
window.WP_SYNC = { boot: syncBoot, onUser: syncUser, flush: flushProgress, synced: () => !!(SYNC.user && SYNC.owner === SYNC.user.id) };
