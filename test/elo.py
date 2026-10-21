import asyncio, time
from playwright.async_api import async_playwright
async def poll(pg, expr, timeout=25):
    t = time.time()
    while time.time() - t < timeout:
        v = await pg.evaluate(expr)
        if v: return v
        await asyncio.sleep(.2)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); errs = []
        pg = await (await b.new_context(viewport={'width': 1366, 'height': 900})).new_page()
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://localhost:3100/'); await poll(pg, "ENG.main && document.querySelector('#engineStatus').classList.contains('ok')")
        print('default:', await pg.evaluate("[S.settings.elo, document.querySelector('#lvlOut').textContent, document.querySelector('#lvl').step]"))
        for e in ['500', '1450', '2150', '2800']:
            await pg.fill('#lvl', e); await pg.dispatch_event('#lvl', 'input')
            print(e, '->', await pg.evaluate("document.querySelector('#lvlOut').textContent"), '|', await pg.evaluate(f"JSON.stringify(eloParams({e}))"))
        # engine plays as white at 1450 with multipv: let it move first
        await pg.fill('#lvl', '1450'); await pg.dispatch_event('#lvl', 'input')
        await pg.click('#colB'); await pg.click('#btnPlay')
        print('engine first move:', await poll(pg, "S.line && S.line.moves.length >= 1 && S.line.moves[0].san"))
        lines = await pg.evaluate("(async () => { const r = await ENG.main.search({ fen: S.chess.fen(), depth: 8, movetime: 300, skill: 20, multipv: 4 }); return r.lines.filter(Boolean).map(l => l.pv[0] + ':' + (l.cp ?? 'M' + l.mate)).join(' '); })()")
        print('multipv lines:', lines)
        one = await pg.evaluate("(async () => { const r = await ENG.main.search({ fen: S.chess.fen(), depth: 8, skill: 20 }); return r.lines.filter(Boolean).length; })()")
        print('single-pv lines after reset:', one)
        print('plate:', await pg.evaluate("document.querySelector('#plateTop').innerText.replace(/\\n/g,' | ')"))
        print('errors:', errs or 'none'); await b.close()
asyncio.run(main())
