import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await (await b.new_context(viewport={'width': 1366, 'height': 900})).new_page()
        await pg.goto('http://localhost:3100/'); await asyncio.sleep(2)
        print('display font loaded:', await pg.evaluate("document.fonts.check('600 22px \"Josefin Sans\"')"))
        await pg.screenshot(path='/tmp/claude-0/looks/font-desk.png')
        await pg.click('#btnPuzzles'); await asyncio.sleep(1.5); await pg.screenshot(path='/tmp/claude-0/looks/font-puzzle.png', clip={'x': 860, 'y': 70, 'width': 380, 'height': 330})
        m = await (await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)).new_page()
        await m.goto('http://localhost:3100/'); await asyncio.sleep(1.5); await m.screenshot(path='/tmp/claude-0/looks/font-mobile.png', clip={'x': 0, 'y': 0, 'width': 390, 'height': 300})
        await b.close()
asyncio.run(main())
