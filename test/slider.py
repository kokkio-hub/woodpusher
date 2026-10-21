import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await (await b.new_context(viewport={'width': 1366, 'height': 900}, device_scale_factor=2)).new_page()
        await pg.goto('http://localhost:3100/'); await asyncio.sleep(1.5)
        await pg.fill('#lvl', '1450'); await pg.dispatch_event('#lvl', 'input'); await asyncio.sleep(.2)
        box = await pg.locator('#setupCard').bounding_box()
        await pg.screenshot(path='/tmp/claude-0/looks/slider.png', clip={'x': box['x'], 'y': box['y'] + 180, 'width': box['width'], 'height': 200})
        await b.close()
asyncio.run(main())
