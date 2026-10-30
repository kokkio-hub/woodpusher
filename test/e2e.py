import asyncio, time, os, random
from playwright.async_api import async_playwright
BASE = 'http://localhost:3100'; OUT = '/tmp/claude-0/online'; os.makedirs(OUT, exist_ok=True)
async def poll(pg, expr, timeout=15):
    t = time.time()
    while time.time() - t < timeout:
        v = await pg.evaluate(expr)
        if v: return v
        await asyncio.sleep(.2)
    return None
async def click_sq(pg, sq):
    box = await pg.locator('#board').bounding_box(); o = await pg.evaluate('S.orientation'); f = ord(sq[0]) - 97; r = int(sq[1])
    c, row = (f, 8 - r) if o == 'w' else (7 - f, r - 1)
    await pg.mouse.click(box['x'] + (c + .5) * box['width'] / 8, box['y'] + (row + .5) * box['height'] / 8)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); errs = []
        tag = str(random.randint(1000, 9999))
        pages = {}
        for name in ['ann' + tag, 'ben' + tag]:
            ctx = await b.new_context(viewport={'width': 1366, 'height': 900}); pg = await ctx.new_page()
            pg.on('pageerror', lambda e, n=name: errs.append(f'{n}: {e}'))
            pg.on('console', lambda m, n=name: errs.append(f'{n} console: {m.text}') if m.type == 'error' else None)
            await pg.goto(BASE + '/'); await asyncio.sleep(1)
            await pg.click('#btnOnline'); await asyncio.sleep(.4)
            await pg.click('#onlinePanel [data-act="register"]'); await pg.fill('#authBox [name=username]', name); await pg.fill('#authBox [name=password]', 'password123'); await pg.click('#authBox button[type=submit]'); await pg.click('#authBox [data-acct="saved"]')
            ok = await poll(pg, "ON.me && ON.connected && ON.me.username", 10); print('registered', ok)
            pages[name] = pg
        A, B = pages.values()
        print('engine A:', await poll(A, "document.querySelector('#engineStatus').classList.contains('ok') && document.querySelector('#engineStatus').textContent", 20))
        await A.screenshot(path=f'{OUT}/lobby.png')
        for pg in (A, B): await pg.click('#onlinePanel [data-tc="3+2"]'); await pg.click('#onlinePanel [data-act="seek"]')
        gid = await poll(A, "ON.game && ON.game.id", 10); await poll(B, "ON.game && ON.game.id", 10)
        print('matched game', gid, 'A is', await A.evaluate('ON.game.you'), 'url', A.url)
        W = A if await A.evaluate('ON.game.you') == 'w' else B; Bl = B if W is A else A
        line = ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7']
        for i, u in enumerate(line):
            P = W if i % 2 == 0 else Bl
            await poll(P, f"S.line && S.line.moves.length === {i} && WP_ONLINE.canMove()", 10)
            await click_sq(P, u[:2]); await click_sq(P, u[2:4])
            if i == 2: await W.screenshot(path=f'{OUT}/game.png')
        await poll(W, "ON.game.status === 'finished'", 10); await poll(Bl, "ON.game.status === 'finished'", 10)
        print('result W:', await W.evaluate("[ON.game.result, ON.game.reason, JSON.stringify(ON.game.diff)]"), 'banner:', await W.locator('.banner-title').inner_text())
        print('clock running on board after 2 moves? (expected none now)', await W.evaluate("S.game.clock.running"))
        await W.screenshot(path=f'{OUT}/result.png')
        # rematch
        await W.click('#bnRematchOn'); await asyncio.sleep(.4)
        await poll(Bl, "ON.game && ON.game.rematch", 5); await Bl.click('#onlinePanel [data-act="rematch"]')
        ng = await poll(A, f"ON.game && ON.game.id !== '{gid}' && ON.game.status === 'active' && ON.game.id", 8); print('rematch game', ng, 'W now', await W.evaluate('ON.game.you'))
        # abort the rematch
        await A.click('#onlinePanel [data-act="abort"]'); print('aborted:', await poll(B, "ON.game.status === 'aborted'", 6), 'banner', await B.locator('.banner-title').inner_text())
        # friend challenge
        await A.click('#onlinePanel [data-act="lobby"]') if await A.locator('#onlinePanel [data-act="lobby"]').count() else None
        await A.click('#btnOnline'); await asyncio.sleep(.3)
        await A.click('#onlinePanel [data-act="challenge"]'); url = await poll(A, "ON.challenge && ON.challenge.url", 5); print('challenge url', url)
        await B.goto(url); await poll(B, "ON.incoming && ON.incoming.from && ON.incoming.from !== '…'", 8)
        await B.click('#onlinePanel [data-act="accept-incoming"]'); g3 = await poll(B, "ON.game && ON.game.status === 'active' && ON.game.id", 8)
        print('friend game', g3, 'rated:', await B.evaluate('ON.game.rated'), 'A in game:', await poll(A, f"ON.game && ON.game.id === '{g3}'", 6))
        # play 2 moves then resign by A
        Wf = A if await A.evaluate('ON.game.you') == 'w' else B; Bf = B if Wf is A else A
        await poll(Wf, "WP_ONLINE.canMove()", 5); await click_sq(Wf, 'd2'); await click_sq(Wf, 'd4')
        await poll(Bf, "WP_ONLINE.canMove()", 5); await click_sq(Bf, 'd7'); await click_sq(Bf, 'd5')
        await poll(A, "S.line.moves.length === 2", 5)
        await A.click('#onlinePanel [data-act="draw-offer"]'); await poll(B, "ON.game.drawOffer", 5); await B.click('#onlinePanel [data-act="draw-accept"]')
        print('draw:', await poll(A, "ON.game.status === 'finished' && ON.game.reason", 6))
        # history + review
        await A.click('#onlinePanel [data-act="lobby"]'); await poll(A, "ON.games && ON.games.length >= 2", 6)
        print('history rows', await A.locator('#onlinePanel .game-row').count()); await A.locator('#onlinePanel .game-row').last.click()
        print('review mode:', await poll(A, "S.mode === 'review' && S.line.source", 6))
        await A.click('#btnExitReview'); print('back to', await A.evaluate('S.mode'))
        # offline still works
        await A.click('#btnNew'); await asyncio.sleep(.3); await A.click('#btnPlay'); await asyncio.sleep(.3); await click_sq(A, 'e2'); await click_sq(A, 'e4')
        print('vs stockfish:', await poll(A, "S.line.moves.length >= 2 && S.line.moves.map(m=>m.san).join(' ')", 20))
        print('errors:', errs or 'none'); await b.close()
asyncio.run(main())
