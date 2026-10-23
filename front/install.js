/* =====================================================================
   Woodpusher as an app: registers the service worker (sw.js), which lets
   the site be installed and open without a connection, and offers to
   install it in Settings and the footer.
   ===================================================================== */
const INS = { prompt: null, installed: false, wired: false };
const insStandalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
const insIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function renderInstall() {
  const sec = $('#installSection'); if (!sec) return;
  const foot = $('#footInstall');
  let html;
  if (insStandalone() || INS.installed) html = '<p class="fine">Woodpusher is installed. It opens from your home screen or app list, and games against Stockfish, puzzles, openings and reviews work without a connection too.</p>';
  else if (INS.prompt) html = '<p class="fine">Put Woodpusher on your home screen or desktop. It opens in its own window, and games against Stockfish, puzzles, openings and reviews also work without a connection.</p><div class="user-actions"><button class="btn btn-brass btn-small" data-install>Install Woodpusher</button></div>';
  else if (insIOS()) html = '<p class="fine">On iPhone and iPad: open Woodpusher in Safari, tap the Share button, then <b>Add to Home Screen</b>. It then opens like an app and also works without a connection.</p>';
  else html = '<p class="fine">To install Woodpusher as an app, open your browser’s menu and choose <b>Install app</b> or <b>Add to Home screen</b>. Chrome, Edge and Samsung Internet can, and Safari on iPhone and iPad (Share, then Add to Home Screen).</p>';
  sec.querySelector('.ins-body').innerHTML = html; sec.hidden = false;
  if (foot) foot.hidden = !(INS.prompt && !INS.installed && !insStandalone());
}
async function runInstall() {
  const p = INS.prompt; if (!p) return;
  INS.prompt = null;
  try { p.prompt(); const r = await p.userChoice; if (r && r.outcome === 'accepted') INS.installed = true; } catch (e) {}
  renderInstall();
}
// The browser's title bar follows the light or dark look
function syncThemeColor() {
  const m = document.querySelector('meta[name="theme-color"]'); if (!m) return;
  const c = getComputedStyle(document.documentElement).getPropertyValue('--leather').trim(); if (c) m.setAttribute('content', c);
}
function installBoot() {
  if (INS.wired) return; INS.wired = true;
  // Only on the Woodpusher site itself (the built page links the manifest)
  if (!document.querySelector('link[rel="manifest"]')) return;
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    const reg = () => navigator.serviceWorker.register('/sw.js').catch(() => {});
    if (document.readyState === 'complete') reg(); else window.addEventListener('load', reg);
  }
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); INS.prompt = e; renderInstall(); });
  window.addEventListener('appinstalled', () => { INS.installed = true; INS.prompt = null; renderInstall(); toast('Woodpusher is installed.'); });
  document.addEventListener('click', (e) => { if (e.target.closest('[data-install]')) { e.preventDefault(); runInstall(); } });
  syncThemeColor(); new MutationObserver(syncThemeColor).observe(document.documentElement, { attributes: true, attributeFilter: ['data-look'] });
  renderInstall();
}
window.WP_INSTALL = { boot: installBoot };
