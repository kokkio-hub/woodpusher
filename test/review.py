# Game review: move grades (brilliant, great, mistake, blunder), the plain-language notes, and Play through,
# which replays a game and stops at those moments. Needs the server on port 3100 and Playwright.
import asyncio, os, sys, time
from playwright.async_api import async_playwright
BASE = 'http://localhost:3100'; OUT = '/tmp/claude-0/review'; os.makedirs(OUT, exist_ok=True)
GAMES = {
    'opera': None,   # Morphy's Opera Game, built in
    'legal': '1. e4 e5 2. Nf3 d6 3. Bc4 Bg4 4. Nc3 g6 5. Nxe5 Bxd1 6. Bxf7+ Ke7 7. Nd5#',
    'blackburne': '1. e4 e5 2. Nf3 Nc6 3. Bc4 Nd4 4. Nxe5 Qg5 5. Nxf7 Qxg2 6. Rf1 Qxe4+ 7. Be2 Nf3#',
    'hangs': '1. e4 e5 2. Nf3 Qg5 3. Nxg5',
    'attacked': '1. e4 d5 2. exd5 Qxd5 3. Nc3 a6 4. Nxd5',
    'fork': '[FEN "6k1/5ppp/8/8/3n4/8/3Q1PPP/6K1 w - - 0 1"]\n1. Qc3 Ne2+ 2. Kf1 Nxc3',
    'backrank': '[FEN "6k1/5ppp/8/8/8/8/q4PPP/3R2K1 w - - 0 1"]\n1. h3 Qa1',
    'reti':'1. e4 c6 2. d4 d5 3. Nc3 dxe4 4. Nxe4 Nf6 5. Qd3 e5 6. dxe5 Qa5+ 7. Bd2 Qxe5 8. O-O-O Nxe4 9. Qd8+ Kxd8 10. Bg5+ Kc7 11. Bd8# 1-0',
    'kasparov': '''1. e4 d6 2. d4 Nf6 3. Nc3 g6 4. Be3 Bg7 5. Qd2 c6 6. f3 b5 7. Nge2 Nbd7 8. Bh6 Bxh6 9. Qxh6 Bb7 10. a3 e5
      11. O-O-O Qe7 12. Kb1 a6 13. Nc1 O-O-O 14. Nb3 exd4 15. Rxd4 c5 16. Rd1 Nb6 17. g3 Kb8 18. Na5 Ba8 19. Bh3 d5
      20. Qf4+ Ka7 21. Rhe1 d4 22. Nd5 Nbxd5 23. exd5 Qd6 24. Rxd4 cxd4 25. Re7+ Kb6 26. Qxd4+ Kxa5 27. b4+ Ka4
      28. Qc3 Qxd5 29. Ra7 Bb7 30. Rxb7 Qc4 31. Qxf6 Kxa3 32. Qxa6+ Kxb4 33. c3+ Kxc3 34. Qa1+ Kd2 35. Qb2+ Kd1
      36. Bf1 Rd2 37. Rd7 Rxd7 38. Bxc4 bxc4 39. Qxh8 Rd3 40. Qa8 c3 41. Qa4+ Ke1 42. f4 f5 43. Kc1 Rd2 44. Qa7 1-0''',
}
async def poll(pg, expr, timeout=240):
    t = time.time()
    while time.time() - t < timeout:
        v = await pg.evaluate(expr)
        if v: return v
        await asyncio.sleep(.25)
    return None
async def main():
    only = sys.argv[1:] or list(GAMES)
    async with async_playwright() as p:
        b = await p.chromium.launch(); errs = []
        pg = await (await b.new_context(viewport={'width': 1366, 'height': 900})).new_page()
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append('console: ' + m.text) if m.type == 'error' else None)
        await pg.goto(BASE + '/'); await asyncio.sleep(1)
        await poll(pg, "document.querySelector('#engineStatus').classList.contains('ok')", 40)
        for name in only:
            pgn = GAMES[name]
            if pgn: await pg.evaluate(f"loadPGNForReview(`{pgn}`)")
            else: await pg.click('#btnImport'); await pg.click('#btnSample')
            t0 = time.time(); ok = await poll(pg, "S.review && S.review.done")
            print(f'\n=== {name}: analysed in {time.time() - t0:.0f}s' if ok else f'\n=== {name}: analysis did not finish')
            rows = await pg.evaluate("""S.line.moves.map((m, i) => [moveLabel(i) + ' ' + m.san, S.review.cls[i]])""")
            print(' '.join(f'{a}[{c}]' for a, c in rows))
            notes = await pg.evaluate("""(() => { const out = []; for (let v = 1; v <= S.line.moves.length; v++) { const c = S.review.cls[v - 1];
                if (!AP_STOPS.includes(c)) continue; goTo(v, false); const el = document.querySelector('#annot');
                out.push(el.querySelector('.annot-title').textContent + '\\n    ' + el.querySelector('.annot-body').textContent.trim()); } goTo(0, false); return out; })()""")
            for n in notes: print('  ' + n)
            await pg.screenshot(path=f'{OUT}/{name}.png')
        # Play through: it must stop exactly at each brilliant/great/mistake/blunder, in order, then reach the end
        await pg.evaluate("S.settings.apSpeed = 'fast'; goTo(0, false)")
        want = await pg.evaluate("S.review.cls.map((c, i) => AP_STOPS.includes(c) ? i + 1 : 0).filter(Boolean)")
        got = []
        await pg.click('#btnAutoPlay')
        for _ in range(len(want)):
            v = await poll(pg, "AP.stop || null", 60); got.append(v)
            if len(got) == 1: await pg.screenshot(path=f'{OUT}/paused.png')
            label = await pg.locator('#btnAutoPlay').inner_text()
            await pg.click('#btnAutoPlay')
        end = await poll(pg, "!AP.on && !AP.stop && S.view === liveIndex() && 'end'", 60)
        print('\nplay through stops', got, 'expected', want, 'then', end, '| button while paused:', label)
        # stepping by hand takes over
        await pg.evaluate("goTo(0, false)"); await pg.click('#navPlay'); await asyncio.sleep(1.2)
        await pg.keyboard.press('ArrowLeft'); print('arrow key stops it:', await pg.evaluate("!AP.on"))
        await pg.keyboard.press('Space'); print('space starts it:', await pg.evaluate("AP.on")); await pg.keyboard.press('Space'); print('space pauses it:', await pg.evaluate("!AP.on"))
        m = await (await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)).new_page()
        m.on('pageerror', lambda e: errs.append('mobile: ' + str(e)))
        await m.goto(BASE + '/'); await asyncio.sleep(1); await poll(m, "document.querySelector('#engineStatus').classList.contains('ok')", 40)
        await m.click('#btnImport'); await m.click('#btnSample'); await poll(m, "S.review && S.review.done")
        await m.evaluate("goTo(31, false)"); await asyncio.sleep(.3)
        await m.screenshot(path=f'{OUT}/mobile.png', full_page=True)
        print('mobile scrollW', await m.evaluate('document.documentElement.scrollWidth'))
        print('errors:', errs or 'none'); await b.close()
asyncio.run(main())
