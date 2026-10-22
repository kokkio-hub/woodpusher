# Premoves in two real browsers: queue while the opponent is to move, instant execution, multiple premoves,
# illegal premoves cancelled, cancelling by right-click / Esc / clicking an empty square, the Settings switch,
# and premoves against Stockfish. Needs the server on port 3100 and Playwright.
import asyncio, time, os, random
from playwright.async_api import async_playwright
BASE = os.environ.get('BASE', 'http://localhost:3100'); OUT = '/tmp/claude-0/premove'; os.makedirs(OUT, exist_ok=True)
fails = []
def check(name, ok, extra=''):
    print(('PASS ' if ok else 'FAIL ') + name + (f'  ({extra})' if extra else ''))
    if not ok: fails.append(name)
async def poll(pg, expr, timeout=10):
    t = time.time()
    while time.time() - t < timeout:
        v = await pg.evaluate(expr)
        if v: return v
        await asyncio.sleep(.05)
    return None
async def sq_xy(pg, sq):
    box = await pg.locator('#board').bounding_box(); o = await pg.evaluate('S.orientation'); f = ord(sq[0]) - 97; r = int(sq[1])
    c, row = (f, 8 - r) if o == 'w' else (7 - f, r - 1)
    return box['x'] + (c + .5) * box['width'] / 8, box['y'] + (row + .5) * box['height'] / 8
async def click_sq(pg, sq, button='left'):
    x, y = await sq_xy(pg, sq); await pg.mouse.click(x, y, button=button)
async def drag(pg, a, b):
    x1, y1 = await sq_xy(pg, a); x2, y2 = await sq_xy(pg, b)
    await pg.mouse.move(x1, y1); await pg.mouse.down(); await pg.mouse.move((x1 + x2) / 2, (y1 + y2) / 2, steps=4); await pg.mouse.move(x2, y2, steps=4); await pg.mouse.up()
async def move(pg, uci): await click_sq(pg, uci[:2]); await click_sq(pg, uci[2:4])
moves = lambda pg: pg.evaluate("S.line.moves.map(m => m.uci).join(' ')")
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); errs = []; tag = str(random.randint(1000, 9999)); pages = []
        for name in ['pmA' + tag, 'pmB' + tag]:
            ctx = await b.new_context(viewport={'width': 1366, 'height': 900}); pg = await ctx.new_page()
            pg.on('pageerror', lambda e, n=name: errs.append(f'{n}: {e}'))
            pg.on('console', lambda m, n=name: errs.append(f'{n} console: {m.text}') if m.type == 'error' else None)
            await pg.goto(BASE + '/'); await asyncio.sleep(.8)
            await pg.click('#btnOnline'); await asyncio.sleep(.3)
            await pg.click('#onlinePanel [data-auth="register"]'); await pg.fill('#authUser', name); await pg.fill('#authPass', 'password123'); await pg.click('#authForm button[type=submit]')
            await poll(pg, "ON.me && ON.connected && ON.me.username"); pages.append(pg)
        A, B = pages
        await A.click('#onlinePanel [data-act="seek"]'); await asyncio.sleep(.3); await B.click('#onlinePanel [data-act="seek"]')
        await poll(A, "ON.game && ON.game.status === 'active'"); await poll(B, "ON.game && ON.game.status === 'active'")
        W, K = (A, B) if await A.evaluate('ON.game.you') == 'w' else (B, A)
        misplaced = "pieceEls.filter(p => { const [c, r] = sqToCR(p.sq); return +p.el.style.getPropertyValue('--x') !== c || +p.el.style.getPropertyValue('--y') !== r; }).length"
        check("Black's pieces drawn from Black's side", await K.evaluate("S.orientation") == 'b' and await K.evaluate(misplaced) == 0, f'{await K.evaluate(misplaced)} misplaced')

        # 1. Black premoves before White's first move
        await move(K, 'e7e5')
        check('premove queued', await K.evaluate('S.premoves.length') == 1)
        check('premove shown on the board', await K.evaluate("!!pieceEls.find(p => p.sq === 'e5' && p.code === 'bP') && !pieceEls.find(p => p.sq === 'e7')"))
        check('premove squares highlighted', await K.locator('#hlLayer .hl-pre').count() == 2)
        check('premove note', 'Premove set' in await K.locator('#viewNote').inner_text())
        await K.screenshot(path=OUT + '/1-premove-set.png')
        check('nothing sent yet', await W.evaluate('S.line.moves.length') == 0)
        await move(W, 'e2e4')
        ok = await poll(W, "S.line.moves.length === 2", 5)
        check('premove played the instant White moved', bool(ok), await moves(W))
        check('both boards agree', await moves(W) == await moves(K) == 'e2e4 e7e5')
        check('queue empty afterwards', await K.evaluate('S.premoves.length') == 0)
        await asyncio.sleep(.4); await K.screenshot(path=OUT + '/2-premove-played.png')

        # 2. Two premoves in a row, one with drag and drop
        await move(K, 'b8c6'); await drag(K, 'g8', 'f6')
        check('two premoves queued', await K.evaluate('S.premoves.length') == 2)
        check('both shown', await K.evaluate("!!pieceEls.find(p => p.sq === 'c6' && p.code === 'bN') && !!pieceEls.find(p => p.sq === 'f6' && p.code === 'bN')"))
        check('four squares highlighted', await K.locator('#hlLayer .hl-pre').count() == 4)
        await K.screenshot(path=OUT + '/3-two-premoves.png')
        await move(W, 'g1f3')
        await poll(W, "S.line.moves.length === 4", 5)
        check('first premove played', await moves(W) == 'e2e4 e7e5 g1f3 b8c6', await moves(W))
        check('second still queued', await K.evaluate('S.premoves.length') == 1)
        await move(W, 'f1c4')
        await poll(W, "S.line.moves.length === 6", 5)
        check('second premove played', await moves(W) == 'e2e4 e7e5 g1f3 b8c6 f1c4 g8f6', await moves(W))

        # 3. A premove that is illegal when the turn comes is dropped, nothing is sent
        await move(K, 'e5e4')      # the white pawn on e4 blocks it
        check('blocked premove queued', await K.evaluate('S.premoves.length') == 1)
        await move(W, 'd2d3')
        await poll(K, "S.line.moves.length === 7", 5); await asyncio.sleep(.5)
        check('illegal premove cancelled', await K.evaluate('S.premoves.length') == 0 and await K.evaluate('S.line.moves.length') == 7)
        check('black still to move', await K.evaluate("S.chess.turn()") == 'b')
        check('pieces back to the real position', await K.evaluate("!!pieceEls.find(p => p.sq === 'e5' && p.code === 'bP')"))
        await move(K, 'a7a6'); await poll(W, "S.line.moves.length === 8", 5)

        # 4. Cancelling: right-click, Esc, clicking an empty square
        await move(K, 'h7h6'); await click_sq(K, 'd4', 'right')
        check('right-click cancels', await K.evaluate('S.premoves.length') == 0)
        await move(K, 'h7h6'); await K.keyboard.press('Escape')
        check('Esc cancels', await K.evaluate('S.premoves.length') == 0)
        await move(K, 'h7h6'); await click_sq(K, 'd5')
        check('click on an empty square cancels', await K.evaluate('S.premoves.length') == 0)
        check('board shows the real position again', await K.evaluate("!!pieceEls.find(p => p.sq === 'h7') && !pieceEls.find(p => p.sq === 'h6')"))
        await move(W, 'b1c3'); await poll(K, "S.line.moves.length === 9", 5); await asyncio.sleep(.4)
        check('no move made after cancelling', await K.evaluate('S.line.moves.length') == 9)

        # 5. Looking back at earlier moves drops the queue
        await move(K, 'h7h6')            # real move now; then queue one and step back
        await poll(W, "S.line.moves.length === 10", 5)
        await move(K, 'g7g6'); await K.keyboard.press('ArrowLeft')
        check('looking back drops premoves', await K.evaluate('S.premoves.length') == 0)
        await K.keyboard.press('End')

        # 6. Settings switch off: no premoves
        await K.evaluate("S.settings.premove = false")
        await move(K, 'g7g6')
        check('premoves off in Settings', await K.evaluate('S.premoves.length') == 0)
        await K.evaluate("S.settings.premove = true")

        # 7. Capture premove that becomes a recapture
        await move(W, 'c1e3'); await poll(K, "S.line.moves.length === 11", 5)
        await move(K, 'f8b4'); await poll(W, "S.line.moves.length === 12", 5)   # Bb4 pins c3
        await move(K, 'b4c3')            # premove: take on c3
        await move(W, 'a2a3'); await poll(W, "S.line.moves.length === 14", 5)
        check('capture premove played', (await moves(W)).endswith('a2a3 b4c3'), (await moves(W))[-30:])
        await move(W, 'b2c3'); await poll(K, "S.line.moves.length === 15", 5)
        await K.screenshot(path=OUT + '/4-after-capture.png')

        # 8. Resign while a premove is queued: the board returns to the real position
        await move(K, 'd7d6'); await poll(W, "S.line.moves.length === 16", 5)
        await move(K, 'c8g4')
        await W.click('#onlinePanel [data-act="resign"]'); await W.click('#onlinePanel [data-act="resign"]')
        await poll(K, "ON.game.status !== 'active'", 5)
        check('premoves dropped at game end', await K.evaluate("S.premoves.length === 0 && !pieceEls.find(p => p.sq === 'g4')"))

        # 9. Premoves against Stockfish
        pg = W
        await pg.click('#onlinePanel [data-act="lobby"]') if await pg.locator('#onlinePanel [data-act="lobby"]').count() else None
        await pg.click('#btnNew'); await asyncio.sleep(.3)
        await poll(pg, "document.querySelector('#engineStatus').classList.contains('ok')", 25)
        await pg.click('#colorSeg [data-color="w"]'); await pg.click('#btnPlay'); await asyncio.sleep(.3)
        await move(pg, 'e2e4'); await move(pg, 'd2d4'); await move(pg, 'b1c3')
        q = await pg.evaluate('S.premoves.length'); check('premoves queued vs Stockfish', q >= 1, f'{q} queued')
        ok = await poll(pg, "S.line.moves.length >= 5 && S.premoves.length === 0", 15)
        mv = await pg.evaluate("S.line.moves.map(m => m.uci)")
        check('premoves played vs Stockfish', bool(ok) and mv[0] == 'e2e4' and mv[2] == 'd2d4' and mv[4] == 'b1c3', ' '.join(mv))
        await asyncio.sleep(.6); await pg.screenshot(path=OUT + '/5-vs-stockfish.png')

        # 10. Promotion premove (with the piece picker) and a castling premove, from a set-up position
        await pg.evaluate("""() => { S.engineToken++; if (ENG.main) ENG.main.cancelAll(); S.thinking = false;
          const fen = '4k3/1P6/8/8/8/8/8/4K2R b K - 0 1'; S.chess = new Chess(fen);
          S.line = newLine(fen, { w: 'You', b: 'Stockfish' }, { w: 'White', b: 'Bot' });
          S.game = { playerColor: 'w', elo: 1200, opp: null, tc: '3+2', clock: { w: 180000, b: 180000, running: 'b', last: performance.now() }, lastEngineScore: null };
          S.view = 0; S.orientation = 'w'; S.premoves = []; S.sel = null; S.legal = [];
          setMode('play'); renderCoords(); renderPieces(fen, false); renderAll(); }""")
        await move(pg, 'b7b8')
        check('promotion picker opens for a premove', await pg.evaluate("!document.querySelector('#promo').hidden"))
        await pg.click('#promo [data-p="n"]')
        check('underpromotion premove queued', await pg.evaluate("S.premoves.length === 1 && S.premoves[0].promo === 'n' && !!pieceEls.find(p => p.sq === 'b8' && p.code === 'wN')"))
        await move(pg, 'e1g1')
        check('castling premove shows king and rook', await pg.evaluate("!!pieceEls.find(p => p.sq === 'g1' && p.code === 'wK') && !!pieceEls.find(p => p.sq === 'f1' && p.code === 'wR')"))
        await pg.evaluate("() => { const m = S.chess.move('Kd7'); afterMove(m); }")
        ok = await poll(pg, "S.line.moves.length >= 4 && S.premoves.length === 0", 15)
        sans = await pg.evaluate("S.line.moves.map(m => m.san)")
        check('promotion and castling premoves played', bool(ok) and sans[1] == 'b8=N+' and sans[3] == 'O-O', ' '.join(sans))

        real = [e for e in errs if 'favicon' not in e]
        check('no page errors', not real, '; '.join(real[:5]))
        await b.close()
    print('ALL PASS' if not fails else f'{len(fails)} FAILED: ' + ', '.join(fails))
asyncio.run(main())
