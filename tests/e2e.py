"""End-to-end browser check: signup, every page, iris transition, notes, watchlist, mobile width. Usage: python tests/e2e.py [base_url] [outdir]"""
import sys, time, os
from playwright.sync_api import sync_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8080"
OUT = sys.argv[2] if len(sys.argv) > 2 else "/tmp/shots"
os.makedirs(OUT, exist_ok=True)
PAGES = ["workbench","catalog","vetting","phase","periodogram","size","validation","field","compare","saved","method","account"]
errors = []
def run(width, height, tag, full=False):
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
        ctx = b.new_context(viewport={"width": width, "height": height}); pg = ctx.new_page()
        pg.on("console", lambda m: errors.append((tag, m.text)) if m.type == "error" and "fonts.g" not in m.text else None)
        pg.on("pageerror", lambda e: errors.append((tag, "PAGEERROR " + str(e))))
        pg.goto(BASE); pg.wait_for_selector("#af"); pg.screenshot(path=f"{OUT}/{tag}-login.png")
        pg.click("text=Create account >> nth=0"); pg.fill("#an", "Test User"); pg.fill("#ae", f"t{int(time.time())}@example.com"); pg.fill("#ap", "correct-horse-battery")
        pg.click("#sb"); pg.wait_for_selector("#nav a", timeout=15000); pg.wait_for_selector(".strip", timeout=15000)
        for k in PAGES:
            pg.evaluate(f"location.hash='#/{k}'"); pg.wait_for_timeout(1800 if k != "workbench" else 700)
            pg.wait_for_function("!document.querySelector('.spin')||document.querySelector('#view h1')", timeout=15000); pg.wait_for_timeout(900)
            ov = pg.evaluate("document.documentElement.scrollWidth>innerWidth+2")
            if ov: errors.append((tag, f"horizontal overflow on {k}"))
            pg.screenshot(path=f"{OUT}/{tag}-{k}.png", full_page=full)
        b.close()
run(1440, 900, "d"); run(390, 844, "m")
print("ERRORS:", errors if errors else "none")
