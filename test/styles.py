import asyncio, time
from playwright.async_api import async_playwright
from PIL import Image
STYLES = ['wood', 'ivory', 'metal', 'marble', 'diagram', 'bauhaus', 'frost', 'crystal']
PGN = '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Na5 10. Bc2 c5 11. d4 Qc7'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); errs = []
        pg = await (await b.new_context(viewport={'width': 1366, 'height': 900}, device_scale_factor=1)).new_page()
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://localhost:3100/'); await asyncio.sleep(1.5)
        await pg.evaluate(f"loadPGNForReview(`{PGN}`)"); await asyncio.sleep(.5)
        await pg.evaluate("exitReview()") if False else None
        await pg.evaluate("goTo(S.line.moves.length, false)"); await asyncio.sleep(.3)
        shots = []
        for st in STYLES:
            await pg.evaluate(f"S.settings.pieces='{st}'; S.settings.board=PIECE_STYLES['{st}'].board; applyLook();")
            await asyncio.sleep(2.2)
            box = await pg.locator('#boardWrap').bounding_box()
            path = f'/tmp/claude-0/looks/st-{st}.png'
            await pg.screenshot(path=path, clip=box); shots.append(path)
        # settings modal
        await pg.click('#btnSettings'); await asyncio.sleep(.5); await pg.screenshot(path='/tmp/claude-0/looks/settings.png')
        ims = [Image.open(s).resize((330, 330)) for s in shots]
        grid = Image.new('RGB', (330 * 4 + 30, 330 * 2 + 10), (20, 38, 29))
        for i, im in enumerate(ims): grid.paste(im, ((i % 4) * 340, (i // 4) * 340))
        grid.save('/tmp/claude-0/looks/styles-grid.png')
        print('errors:', errs or 'none'); await b.close()
asyncio.run(main())
