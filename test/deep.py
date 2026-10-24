# Deep review: the full-strength engine, downloaded on request, checked, kept, used, stopped and removed.
# Needs the server on port 3100, Playwright, openssl, and the full engine's .wasm on disk (the file that goes on R2):
#   DEEP_WASM=path/to/stockfish-19-single.wasm python3 test/deep.py
# engine.woodpusher.org is played by test/engine-host.mjs on 127.0.0.1:443 (so it needs to run as root),
# and the server's availability check is answered by the test itself.
import asyncio, os, sys, time, json, subprocess, ssl, urllib.request, tempfile, shutil
from playwright.async_api import async_playwright
BASE = 'http://localhost:3100'
WASM = os.environ.get('DEEP_WASM', '')
LITE = os.path.join(os.path.dirname(__file__), '..', 'front', 'vendor', 'stockfish.wasm')
OUT = os.environ.get('OUT', '/tmp/claude-0/deep'); os.makedirs(OUT, exist_ok=True)
SHORT = '1. e4 e5 2. Nf3 d6 3. Bc4 Bg4 4. Nc3 g6 5. Nxe5 Bxd1 6. Bxf7+ Ke7 7. Nd5#'
LONGER = '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Nb8 10. d4 Nbd7'
fails = []
def check(name, ok, info=''):
    print(('PASS ' if ok else 'FAIL ') + name + (f'  ({info})' if info else '')); (None if ok else fails.append(name))
async def poll(pg, expr, timeout=120):
    t = time.time()
    while time.time() - t < timeout:
        v = await pg.evaluate(expr)
        if v: return v
        await asyncio.sleep(.25)
HOST = os.path.join(os.path.dirname(__file__), 'engine-host.mjs')
def host(path):
    ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPSHandler(context=ctx))
    return opener.open('https://127.0.0.1' + path, timeout=5).read().decode()
async def setup(ctx, available=True):
    async def api(route): await route.fulfill(status=200, content_type='application/json', body=json.dumps({'available': available}))
    await ctx.route('**/api/deep-engine', api)
async def review(pg, pgn):
    await pg.evaluate(f"loadPGNForReview(`{pgn}`)")
    await poll(pg, "S.review && S.review.done && !document.querySelector('#rvDeep').hidden", 180)
async def main():
    if not os.path.isfile(WASM): print('Set DEEP_WASM to the full engine .wasm'); sys.exit(2)
    hp = None
    try: host('/__served')
    except Exception: hp = subprocess.Popen(['node', HOST, WASM, LITE, '443', BASE])
    for _ in range(40):
        try: host('/__served'); break
        except Exception: time.sleep(.25)
    # Without proxy settings: a proxy configured on the machine would otherwise try to reach the real engine.woodpusher.org
    args = ['--host-resolver-rules=MAP engine.woodpusher.org 127.0.0.1', '--ignore-certificate-errors', '--no-proxy-server']
    env = {k: v for k, v in os.environ.items() if 'proxy' not in k.lower()}
    async with async_playwright() as p:
        b = await p.chromium.launch(args=args, env=env); errs = []
        # A browser profile on disk: a private window (a plain new context) has too little storage to keep 99 MB
        profile = tempfile.mkdtemp(prefix='wp-deep-')
        ctx = await p.chromium.launch_persistent_context(profile, args=args, env=env, viewport={'width': 1366, 'height': 900}); await setup(ctx)
        served0 = host('/__served')   # downloads so far (the host may have served earlier runs)
        pg = ctx.pages[0] if ctx.pages else await ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append('console: ' + m.text) if m.type == 'error' else None)
        await pg.goto(BASE + '/'); await poll(pg, "document.querySelector('#engineStatus').classList.contains('ok')", 60)
        # 1. offered after the normal review, with the download size
        await review(pg, SHORT)
        label = await pg.inner_text('#btnDeep'); note = await pg.inner_text('#rvDeepNote')
        check('button offered after the review', label == 'Deep review' and '99 MB' in note, f'{label} | {note}')
        check('opening a review does not contact the engine host', host('/__served') == served0)
        lite = await pg.evaluate("[S.review.cls.join(' '), accuracyOf('w').toFixed(1), accuracyOf('b').toFixed(1)]")
        # 2. first click asks, second click downloads and runs
        await pg.click('#btnDeep')
        check('first click asks before downloading', (await pg.inner_text('#btnDeep')).startswith('Download 99 MB') and host('/__served') == served0, await pg.inner_text('#btnDeep'))
        t0 = time.time(); await pg.click('#btnDeep')
        ph = await poll(pg, "DEEP.phase === 'download' && document.querySelector('#rvText').textContent", 20)
        check('download shows progress', bool(ph) and 'Downloading full Stockfish 19' in ph, ph)
        run = await poll(pg, "DEEP.phase === 'run' && document.querySelector('#rvText').textContent", 120)
        check('engine starts', bool(run), run)
        await pg.screenshot(path=f'{OUT}/running.png')
        print('  workers:', await pg.evaluate('DEEP.pool.length'), '| stop label:', await pg.inner_text('#btnDeep'))
        done = await poll(pg, "deepCount(S.review) === S.line.fens.length && DEEP.phase === 'idle' && document.querySelector('#rvText').textContent", 600)
        check('deep review finishes', bool(done) and done.startswith('Deep review · full Stockfish 19'), f'{done} in {time.time() - t0:.0f}s')
        check('button gone when done', await pg.evaluate("document.querySelector('#rvDeep').hidden"))
        check('workers freed', await pg.evaluate("DEEP.pool.length === 0"))
        deep = await pg.evaluate("[S.review.cls.join(' '), accuracyOf('w').toFixed(1), accuracyOf('b').toFixed(1)]")
        print('  lite :', lite); print('  deep :', deep)
        check('engine kept in Cache Storage', await pg.evaluate("deepCached().then(Boolean)"))
        served = host('/__served')
        await pg.screenshot(path=f'{OUT}/done.png')
        # 3. reload: the deep results come back without running again
        await pg.reload(); await poll(pg, "S.review && S.review.done", 60)
        txt = await pg.evaluate("document.querySelector('#rvText').textContent")
        check('deep results saved', txt.startswith('Deep review · full Stockfish 19') and await pg.evaluate("S.review.cls.join(' ')") == deep[0], txt)
        # 4. a second game uses the saved engine: no question, no download; Stop keeps the positions done so far
        await review(pg, LONGER)
        note = await pg.inner_text('#rvDeepNote'); check('saved engine: no download mentioned', 'download' not in note.lower(), note)
        await pg.click('#btnDeep')
        check('saved engine: starts straight away', bool(await poll(pg, "DEEP.phase === 'start' || DEEP.phase === 'run'", 10)))
        await poll(pg, "DEEP.phase === 'run'", 60); check('saved engine: not downloaded again', host('/__served') == served, f'downloads: {served}')
        await poll(pg, "deepCount(S.review) >= 4", 240)
        await pg.click('#btnDeep')   # Stop
        st = await poll(pg, "DEEP.phase === 'idle' && DEEP.pool.length === 0 && document.querySelector('#btnDeep').textContent", 10)
        d = await pg.evaluate("deepCount(S.review)")
        check('stop frees the engine and offers to continue', st == 'Continue deep review', f'{st}, {d} positions done')
        print('  text:', await pg.inner_text('#rvText'), '|', await pg.inner_text('#rvDeepNote'))
        # leaving the review during a run stops it too
        await pg.click('#btnDeep'); await poll(pg, "DEEP.phase === 'run'", 60)
        await pg.click('#btnExitReview')
        check('leaving the review stops it', bool(await poll(pg, "DEEP.phase === 'idle' && DEEP.pool.length === 0", 10)))
        # opening another game while a deep review runs frees the engines too
        await review(pg, LONGER); await pg.click('#btnDeep'); await poll(pg, "DEEP.phase === 'run'", 60)
        await pg.evaluate(f"loadPGNForReview(`{SHORT}`)")
        check('another game stops it', bool(await poll(pg, "DEEP.phase === 'idle' && DEEP.pool.length === 0", 10)))
        await poll(pg, "S.review && S.review.done", 120); await pg.click('#btnExitReview')
        # 5. Settings: remove the saved engine
        await pg.click('#btnSettings'); check('settings shows the saved engine', bool(await poll(pg, "!document.querySelector('#deepSection').hidden", 10)))
        print('  settings:', await pg.inner_text('#deepSetText'))
        await pg.click('#btnDeepRemove'); await asyncio.sleep(.5)
        check('remove empties the cache', not await pg.evaluate("deepCached().then(Boolean)") and await pg.evaluate("document.querySelector('#deepSection').hidden"))
        await pg.click('#setDone')
        # 6. mobile layout
        m = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, has_touch=True, is_mobile=True)
        await setup(m); mp = await m.new_page(); mp.on('pageerror', lambda e: errs.append('mobile: ' + str(e)))
        await mp.goto(BASE + '/'); await poll(mp, "document.querySelector('#engineStatus').classList.contains('ok')", 60)
        await review(mp, SHORT); await mp.locator('#rvDeep').scroll_into_view_if_needed()
        await mp.screenshot(path=f'{OUT}/mobile.png')
        check('mobile: one engine, no sideways scroll', await mp.evaluate("deepPoolSize() === 1 && document.documentElement.scrollWidth <= 390"))
        # a browser that cannot keep the engine (some private windows): the deep review still runs, and says so
        await mp.evaluate("(() => { caches.open = () => Promise.reject(new DOMException('no storage', 'SecurityError')); return true; })()")
        await mp.click('#btnDeep'); await mp.click('#btnDeep')
        fin = await poll(mp, "deepCount(S.review) === S.line.fens.length && DEEP.phase === 'idle'", 600)
        await mp.evaluate("S.review.src = []; renderReview()"); note = await mp.inner_text('#rvDeepNote')
        check('no storage: runs, not kept, says so', bool(fin) and await mp.evaluate("DEEP.noCache") and 'each time' in note, note)
        # 7. the wrong file on the server is refused
        host('/__mode/other'); w = await b.new_context(); await setup(w); wp = await w.new_page(); wp.on('pageerror', lambda e: errs.append('wrong: ' + str(e)))
        await wp.goto(BASE + '/'); await poll(wp, "document.querySelector('#engineStatus').classList.contains('ok')", 60)
        await review(wp, SHORT); await wp.click('#btnDeep'); await wp.click('#btnDeep')
        err = await poll(wp, "DEEP.phase === 'error' && document.querySelector('#rvDeepNote').textContent", 60)
        check('wrong file refused', bool(err) and 'not the expected one' in err and await wp.inner_text('#btnDeep') == 'Try again', err)
        check('wrong file not kept', not await wp.evaluate("deepCached().then(Boolean)")); host('/__mode/main')
        # 8. not offered when the file is not on R2
        n = await b.new_context(); await setup(n, available=False); np_ = await n.new_page()
        await np_.goto(BASE + '/'); await poll(np_, "document.querySelector('#engineStatus').classList.contains('ok')", 60)
        await np_.evaluate(f"loadPGNForReview(`{SHORT}`)"); await poll(np_, "S.review && S.review.done", 120); await asyncio.sleep(1)
        check('not offered when the file is missing', await np_.evaluate("document.querySelector('#rvDeep').hidden && DEEP.avail === 'none'"))
        check('no page errors', not errs, '; '.join(errs[:3]))
        await ctx.close(); await b.close(); shutil.rmtree(profile, ignore_errors=True)
    if hp: hp.terminate()
    print('ALL PASS' if not fails else f'{len(fails)} FAILED: ' + ', '.join(fails))
    sys.exit(1 if fails else 0)
asyncio.run(main())
