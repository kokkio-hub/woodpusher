/* =====================================================================
   Deep review: every position of a reviewed game checked again by
   full-strength Stockfish 19 (stockfish.js 19.0.1, single-threaded, with
   the full neural network). The normal review runs the lite build, which
   is 1.9 MB; the full build's .wasm is 99 MB, too much to send to every
   visitor. So it is stored on Cloudflare R2 (engine.woodpusher.org) and
   only downloaded when someone asks for a deep review.

   The page downloads the file itself, checks its SHA-256, keeps it in the
   browser's Cache Storage and compiles it. The engine workers
   (deep-engine.js) receive the compiled module, so the browser compiles
   once however many workers run, and the file never goes through the
   browser's ordinary HTTP cache a second time. Whether the file is on R2
   at all is asked of the Woodpusher server (/api/deep-engine), so a
   visitor's browser only contacts engine.woodpusher.org when they start a
   deep review.
   ===================================================================== */
const DEEP = {
  // Keep url in step with DEEP_ENGINE_URL in server/deep-engine.js (tools/build-front.mjs checks it).
  url: 'https://engine.woodpusher.org/stockfish-19-single.wasm',
  bytes: 99169054,
  sha256: '991bede2f253ebb08ff01fcc48270f4b9c8e66b12d5bd5f8d6f52eb3e3b3a740',
  cache: 'wp-deep-engine',            // Cache Storage; the service worker leaves this one alone
  worker: 'deep-engine.js',
  depth: 20, ms: 5000,                // per position: depth 20, or 5 seconds, whichever comes first
  perPos: 4,                          // seconds per position on one laptop core, for the time estimate
  hash: 32,                           // MB of hash table per engine
  avail: null,                        // null (not known yet), 'cached', 'online' or 'none'
  checking: null, checkedAt: 0,
  phase: 'idle',                      // 'idle', 'download', 'start', 'run' or 'error'
  confirm: false, confirmT: null,
  for: null,                          // the review being deepened
  run: 0, loaded: 0, error: '', pool: [], abort: null, t0: 0, doneAtStart: 0, noCache: false,
};
const deepKey = () => new Request(new URL('/__deep/' + DEEP.url.split('/').pop(), location.href).href);
const deepCount = (R) => (R && R.src ? R.src.filter(x => x === 'deep').length : 0);
const mbText = (b) => Math.round(b / 1e6);

async function deepCacheOpen() { try { return 'caches' in self ? await caches.open(DEEP.cache) : null; } catch (e) { return null; } }
async function deepCached() { const c = await deepCacheOpen(); if (!c) return null; try { return (await c.match(deepKey())) || null; } catch (e) { return null; } }

// Is a deep review possible here: the engine saved in this browser, or on R2 to download?
function deepCheck(force) {
  if (DEEP.checking) return DEEP.checking;
  if (!force && DEEP.avail && (DEEP.avail !== 'none' || Date.now() - DEEP.checkedAt < 60000)) return Promise.resolve(DEEP.avail);
  DEEP.checking = (async () => {
    if (await deepCached()) return 'cached';
    try { const r = await fetch('/api/deep-engine', { cache: 'no-store' }); const d = await r.json(); return d && d.available ? 'online' : 'none'; }
    catch (e) { return 'none'; }
  })().then((a) => { DEEP.avail = a; DEEP.checkedAt = Date.now(); DEEP.checking = null; renderDeep(); return a; });
  return DEEP.checking;
}

async function sha256Hex(buf) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  return Array.from(d, (x) => x.toString(16).padStart(2, '0')).join('');
}
// The compiled engine: from Cache Storage, or downloaded (with progress), checked and kept for next time.
async function deepModule(run) {
  const cache = await deepCacheOpen();
  if (cache) {
    try {
      for (const req of await cache.keys()) if (req.url !== deepKey().url) cache.delete(req);   // an older engine version
      const hit = await cache.match(deepKey());
      if (hit) {
        deepPhase('start');
        try { return await WebAssembly.compileStreaming(hit.clone()); } catch (e) { return await WebAssembly.compile(await hit.arrayBuffer()); }
      }
    } catch (e) { /* download it instead */ }
  }
  deepPhase('download'); DEEP.loaded = 0;
  const ctl = new AbortController(); DEEP.abort = ctl;
  let res;
  try { res = await fetch(DEEP.url, { mode: 'cors', credentials: 'omit', cache: 'no-store', signal: ctl.signal }); }
  catch (e) { if (ctl.signal.aborted) throw e; throw new Error('The engine could not be downloaded. Check your connection and try again.'); }
  if (!res.ok) throw new Error(`The engine could not be downloaded (the server answered ${res.status}).`);
  // Into one buffer of the known size: the file is exactly DEEP.bytes long, so more is the wrong file
  const buf = new Uint8Array(DEEP.bytes); const reader = res.body.getReader(); let at = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    if (run !== DEEP.run) { try { reader.cancel(); } catch (e) {} throw new Error('stopped'); }
    if (at + value.byteLength > buf.length) { try { reader.cancel(); } catch (e) {} throw new Error('The engine file on the server is not the expected one, so it was not used.'); }
    buf.set(value, at); at += value.byteLength; DEEP.loaded = at; deepProgress();
  }
  if (at !== buf.length || (await sha256Hex(buf)) !== DEEP.sha256) throw new Error('The engine file on the server is not the expected one, so it was not used.');
  deepPhase('start');
  DEEP.noCache = !cache;
  if (cache) { try { await cache.put(deepKey(), new Response(new Blob([buf]), { headers: { 'Content-Type': 'application/wasm', 'Content-Length': String(buf.length) } })); } catch (e) { DEEP.noCache = true; } }
  return WebAssembly.compile(buf);
}
// One engine worker, given the compiled module. Resolves to the worker once it answers "uciok", or null.
function deepWorker(mod) {
  return new Promise((resolve) => {
    let w; try { w = new Worker(DEEP.worker); } catch (e) { resolve(null); return; }
    let done = false;
    const fail = () => { if (done) return; done = true; try { w.terminate(); } catch (_) {} resolve(null); };
    const to = setTimeout(fail, 90000);
    w.onerror = (e) => { if (e && e.preventDefault) e.preventDefault(); fail(); };
    w.onmessage = (e) => { if (String(e.data).trim() === 'uciok' && !done) { done = true; clearTimeout(to); w.onmessage = null; w.onerror = null; resolve(w); } };
    try { w.postMessage({ module: mod }); w.postMessage('uci'); } catch (e) { fail(); }
  });
}
// Two engines side by side only on a computer with memory and cores to spare; each holds the 99 MB network.
function deepPoolSize() {
  const cores = navigator.hardwareConcurrency || 2, mem = navigator.deviceMemory || 4;
  const touch = window.matchMedia && matchMedia('(pointer: coarse)').matches;
  return !touch && cores >= 4 && mem >= 8 ? 2 : 1;
}
function deepRelease() {
  for (const e of DEEP.pool) { try { e.cancelAll(); } catch (_) {} try { e.w.terminate(); } catch (_) {} }
  DEEP.pool = []; DEEP.abort = null;
}
function deepPhase(p) { DEEP.phase = p; if (S.mode === 'review') renderReview(); }
let deepRenderPending = false;
function deepProgress() {
  if (deepRenderPending) return; deepRenderPending = true;
  requestAnimationFrame(() => { deepRenderPending = false; if (S.mode === 'review') renderReview(); });
}

async function deepStart() {
  const R = S.review, L = S.line; if (!R || !L || !R.done || DEEP.pool.length || ['download', 'start', 'run'].includes(DEEP.phase)) return;
  const run = ++DEEP.run; DEEP.for = R; DEEP.error = ''; R.src = R.src || [];
  // Analysing the game normally has finished; free those engines for the full one
  R.token++; for (const e of ENG.pool) e.cancelAll();
  const alive = () => run === DEEP.run && S.mode === 'review' && S.review === R;
  try {
    let mod = await deepModule(run);
    if (!alive()) return;
    if (!DEEP.noCache) DEEP.avail = 'cached';
    const want = deepPoolSize(); const ws = [];
    for (let k = 0; k < want; k++) { const w = await deepWorker(mod); if (!w) break; ws.push(w); if (!alive()) { ws.forEach(x => x.terminate()); return; } }
    if (!alive()) { ws.forEach(x => x.terminate()); return; }
    mod = null;   // the workers have their own reference; the page does not need to keep one
    if (!ws.length) throw new Error('Full-strength Stockfish could not start in this browser. The device may not have enough free memory.');
    DEEP.pool = ws.map((w) => { const e = new Engine(w); e.send(`setoption name Hash value ${DEEP.hash}`); return e; });
    DEEP.t0 = performance.now(); DEEP.doneAtStart = deepCount(R); deepPhase('run');
    await deepAnalyse(R, L, alive);
    if (!alive()) return;
    deepRelease(); DEEP.phase = 'idle';
    classifyAll(); renderAll(); save();
    if (deepCount(R) === L.fens.length) { recordReviewAccuracy(); announce('Deep review finished.'); }
  } catch (e) {
    if (run !== DEEP.run) return;
    deepRelease();
    if (e && (e.name === 'AbortError' || e.message === 'stopped')) { DEEP.phase = 'idle'; }
    else { DEEP.error = (e && e.message && !/^(TypeError|RangeError|CompileError)/.test(e.name || '') ? e.message : 'Full-strength Stockfish could not start in this browser. The device may not have enough free memory.'); DEEP.phase = 'error'; }
    if (S.mode === 'review') renderReview();
  } finally {
    // Ended without finishing (another game opened in the review, say): free the engines
    if (run === DEEP.run && ['download', 'start', 'run'].includes(DEEP.phase)) { deepRelease(); DEEP.phase = 'idle'; if (S.mode === 'review') renderReview(); }
  }
}
// The same work as analyse() in app.html, with the full engine, for every position it has not done yet.
async function deepAnalyse(R, L, alive) {
  const n = L.fens.length; let next = 0;
  const work = async (eng) => {
    while (alive()) {
      const i = next++; if (i >= n) return;
      if (R.src[i] === 'deep') continue;
      const term = terminalEval(L.fens[i], i === n - 1, L);
      if (term) { R.evals[i] = term; R.best[i] = null; R.pv[i] = []; R.alt[i] = null; R.src[i] = 'deep'; continue; }
      const res = await eng.search({ fen: L.fens[i], depth: DEEP.depth, movetime: DEEP.ms, skill: 20, multipv: 2 });
      if (!res || !alive()) return;
      storeEval(R, L, i, res, 1);   // the full network's scale is the one the grades are made for
      R.src[i] = 'deep'; onEval(); save();
    }
  };
  await Promise.all(DEEP.pool.map(work));
}
// quiet: leaving the review (no redraw of a panel that is no longer shown)
function deepStop(quiet) {
  if (DEEP.phase === 'idle' && !DEEP.pool.length && !DEEP.abort) return;
  DEEP.run++; if (DEEP.abort) { try { DEEP.abort.abort(); } catch (e) {} }
  deepRelease(); DEEP.phase = 'idle';
  if (S.review) save();
  if (!quiet && S.mode === 'review') { classifyAll(); renderAll(); }
}

/* ---------------- what the review panel shows ---------------- */
function deepEta(R, n) {
  const d = deepCount(R), since = d - DEEP.doneAtStart; if (since < 2) return '';
  const per = (performance.now() - DEEP.t0) / since; const left = (n - d) * per / 60000;
  return left < 1 ? ' · under a minute left' : ` · about ${Math.round(left)} min left`;
}
function reviewProgress(R, n, got) {
  const d = deepCount(R), mine = DEEP.for === R;
  if (mine && DEEP.phase === 'download') return { busy: true, pct: DEEP.loaded / DEEP.bytes, text: `Downloading full Stockfish 19 · ${mbText(DEEP.loaded)} of ${mbText(DEEP.bytes)} MB` };
  if (mine && DEEP.phase === 'start') return { busy: true, pct: d / n, text: 'Starting full-strength Stockfish 19…' };
  if (mine && DEEP.phase === 'run') return { busy: true, pct: d / n, text: `Deep review: ${d} of ${n} positions${deepEta(R, n)}` };
  if (d >= n) return { busy: false, pct: 1, text: `Deep review · full Stockfish 19${depthText(R)}` };
  if (got < n) return { busy: true, pct: got / n, text: `Analysing ${got} of ${n} positions${depthText(R)}` };
  if (d) return { busy: false, pct: 1, text: `Analysed ${n} positions · ${d} of them with full Stockfish 19` };
  return { busy: false, pct: 1, text: `Analysed ${n} positions${depthText(R)}` };
}
function renderDeep() {
  const row = $('#rvDeep'); if (!row) return;
  if (S.mode === 'review' && DEEP.avail !== 'cached' && DEEP.avail !== 'online') deepCheck();   // at most once a minute
  const R = S.review, L = S.line; const n = L ? L.fens.length : 0; const d = deepCount(R);
  const busy = DEEP.for === R && ['download', 'start', 'run'].includes(DEEP.phase);
  const show = S.mode === 'review' && R && L && R.done && d < n && (busy || DEEP.phase === 'error' || DEEP.avail === 'cached' || DEEP.avail === 'online');
  row.hidden = !show; if (!show) return;
  const btn = $('#btnDeep'), note = $('#rvDeepNote');
  let label, text, brass = false;
  if (busy) {
    label = 'Stop';
    text = DEEP.phase === 'download' ? 'The engine is saved in your browser, so this download happens only once.'
      : `Each position gets up to ${DEEP.ms / 1000} seconds, to depth ${DEEP.depth}. You can keep browsing the game meanwhile.`;
  } else if (DEEP.phase === 'error' && DEEP.for === R) { label = 'Try again'; text = DEEP.error; }
  else if (DEEP.confirm) { label = `Download ${mbText(DEEP.bytes)} MB and start`; brass = true; text = DEEP.noCache ? 'This browser could not keep it last time, so it downloads again.' : 'A one-time download: the engine is then saved in this browser for every deep review.'; }
  else {
    label = d ? 'Continue deep review' : 'Deep review';
    const mins = Math.max(1, Math.round((n - d) * DEEP.perPos / deepPoolSize() / 60));
    text = (d ? `${d} of ${n} positions done. ` : 'Check every move again with full-strength Stockfish 19. ')
      + (DEEP.avail === 'cached' ? `About ${mins} min.` : DEEP.noCache ? `A ${mbText(DEEP.bytes)} MB download; this browser can't keep it (a private window?), so it downloads each time.` : `One-time download of ${mbText(DEEP.bytes)} MB.`);
  }
  btn.textContent = label; btn.classList.toggle('btn-brass', brass); note.textContent = text;
}
function onDeepClick() {
  if (DEEP.for === S.review && ['download', 'start', 'run'].includes(DEEP.phase)) { deepStop(); return; }
  if (DEEP.avail !== 'cached' && !DEEP.confirm) {
    DEEP.confirm = true; clearTimeout(DEEP.confirmT);
    DEEP.confirmT = setTimeout(() => { DEEP.confirm = false; renderDeep(); }, 8000);
    renderDeep(); return;
  }
  DEEP.confirm = false; clearTimeout(DEEP.confirmT);
  deepStart();
}

/* ---------------- Settings: the saved engine can be removed ---------------- */
async function renderDeepSettings() {
  const sec = $('#deepSection'); if (!sec) return;
  const hit = await deepCached(); sec.hidden = !hit; if (!hit) return;
  const busy = ['download', 'start', 'run'].includes(DEEP.phase);
  $('#deepSetText').textContent = `Full-strength Stockfish 19 is saved in this browser for deep reviews (${mbText(DEEP.bytes)} MB). Removing it frees the space; the next deep review downloads it again.`;
  $('#btnDeepRemove').disabled = busy;
}
async function removeDeepEngine() {
  if (['download', 'start', 'run'].includes(DEEP.phase)) return;
  const c = await deepCacheOpen(); if (c) { try { for (const req of await c.keys()) await c.delete(req); } catch (e) {} }
  DEEP.avail = null; deepCheck(true); renderDeepSettings(); toast('Removed. The next deep review downloads the engine again.');
}

function wireDeep() {
  $('#btnDeep').addEventListener('click', onDeepClick);
  $('#btnDeepRemove').addEventListener('click', removeDeepEngine);
  $('#btnSettings').addEventListener('click', renderDeepSettings);
  // Know before the first review finishes whether the button can be offered
  setTimeout(() => deepCheck(), 1500);
}
