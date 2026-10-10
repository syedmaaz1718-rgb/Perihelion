"""Record a walkthrough of the running app as screenshot frames stitched by ffmpeg.
Usage: python tests/walkthrough.py [base_url] [out.mp4]"""
import sys, os, time, subprocess, tempfile
from playwright.sync_api import sync_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8080"; OUT = sys.argv[2] if len(sys.argv) > 2 else "walkthrough.mp4"
fr = tempfile.mkdtemp(); n = 0
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    pg = b.new_context(viewport={"width": 1280, "height": 800}).new_page()
    def shoot(sec):
        global n; end = time.time() + sec
        while time.time() < end: pg.screenshot(path=f"{fr}/{n:05d}.jpg", type="jpeg", quality=80); n += 1
    t0 = time.time()
    pg.goto(BASE); pg.wait_for_selector("#guest"); shoot(2); pg.click("#guest"); pg.wait_for_selector(".strip"); shoot(4)
    for i in range(1, len(pg.query_selector_all("#nav a"))):
        pg.query_selector_all("#nav a")[i].click(); shoot(2.6)
    pg.query_selector_all("#nav a")[0].click(); shoot(2)
    fps = n / (time.time() - t0); b.close()
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", f"{fps:.2f}", "-i", f"{fr}/%05d.jpg", "-vf", "fps=25", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "24", "-movflags", "+faststart", OUT], check=True)
print("frames", n, "fps", round(fps, 1))
