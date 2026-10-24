import asyncio, time, os
from playwright.async_api import async_playwright
OUT = '/tmp/claude-0/looks'; os.makedirs(OUT, exist_ok=True)
async def poll(pg, expr, timeout=20):
    t = time.time()
    while time.time() - t < timeout:
        v = await pg.evaluate(expr)
        if v: return v
        await asyncio.sleep(.2)
async def click_sq(pg, sq):
    box = await pg.locator('#board').bounding_box(); o = await pg.evaluate('S.orientation'); f = ord(sq[0]) - 97; r = int(sq[1])
    c, row = (f, 8 - r) if o == 'w' else (7 - f, r - 1)
    await pg.mouse.click(box['x'] + (c + .5) * box['width'] / 8, box['y'] + (row + .5) * box['height'] / 8)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); errs = []
        pg = await (await b.new_context(viewport={'width': 1366, 'height': 900})).new_page()
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://localhost:3100/'); await asyncio.sleep(1.5)
        await pg.click('#btnPlay'); await asyncio.sleep(.3)
        for mv in [('e2','e4'), ('g1','f3'), ('f1','c4')]:
            await poll(pg, "S.chess.turn()==='w' && !S.thinking", 20); await click_sq(pg, mv[0]); await click_sq(pg, mv[1]); await asyncio.sleep(.3)
        await poll(pg, "S.line.moves.length>=6", 20); await asyncio.sleep(1.2)
        print('clocks in the player bars:', await pg.evaluate("[...document.querySelectorAll('.plate .tchip')].map(r=>r.className+' '+r.textContent.trim())"))
        await pg.screenshot(path=f'{OUT}/desk-play.png')
        m = await (await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)).new_page()
        await m.goto('http://localhost:3100/'); await asyncio.sleep(1.2)
        print('mobile clock display:', await m.evaluate("getComputedStyle(document.querySelector('.plate .tchip')).display"), 'scrollW', await m.evaluate('document.documentElement.scrollWidth'))
        print('errors:', errs or 'none'); await b.close()
asyncio.run(main())
