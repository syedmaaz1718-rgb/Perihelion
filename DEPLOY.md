# Deploy Perihelion on Render (free) - step by step

You need: a GitHub account, a Render account (sign in with GitHub). Both free. No card needed for the free web service.

## Part 1 - Put the code on GitHub (browser only, no git commands)
1. Unzip `perihelion-deploy-ready.zip`. You get a folder called `perihelion`.
2. Go to github.com, click **+** (top right) > **New repository**.
3. Name it `perihelion`. Choose **Private** (Render can still deploy it). Do NOT tick "Add a README". Click **Create repository**.
4. On the empty repo page click the link **uploading an existing file**.
5. Open the unzipped `perihelion` folder on your computer. Select EVERYTHING inside it (Dockerfile, app.py, data, pipeline, static, ...) and drag it into the browser page.
   - Drag the contents, not the outer folder, so `Dockerfile` sits at the top level of the repo.
   - If the upload page rejects the `data` folder or says too many files, drag in batches: first everything except `data`, commit, then use **Add file > Upload files** again for `data`.
6. Click **Commit changes**.
7. Check: the repo front page shows `Dockerfile` and `app.py` at the top level (not inside a subfolder).

## Part 2 - Deploy on Render
1. Go to render.com, sign in with GitHub.
2. Click **New +** > **Web Service**.
3. Choose **Build and deploy from a Git repository**, connect GitHub if asked (allow access to the `perihelion` repo), pick `perihelion`, click **Connect**.
4. Fill in:
   - Name: `perihelion` (this becomes `perihelion.onrender.com`; if taken, add digits)
   - Region: closest to you (Singapore is good from India)
   - Branch: `main`
   - Language / Runtime: **Docker** (Render detects the Dockerfile)
   - Instance type: **Free**
5. Open **Environment Variables** > **Add** these two:
   - `SECRET_KEY` = a long random string. Make one with your password manager's generator (40+ random characters), or type 40+ random letters and digits yourself. Keep a copy somewhere. Do not change it later, or everyone gets logged out.
   - `COOKIE_SECURE` = `1`
6. Under Advanced, set **Health Check Path** to `/healthz`.
7. Click **Create Web Service**. The first build takes about 5-10 minutes. Wait for **Your service is live** in the log.
8. Open the URL at the top of the page (`https://perihelion.onrender.com`). That is your public link.

## Part 3 - Quick check
- Home page loads and shows the planet data.
- Sign up with a test account, log out, log in again.
- Open the Validation and Catalog pages.

## What to expect on the free tier (honest notes)
- **Sleep:** after about 15 minutes with no visitors the app sleeps. The next visit takes roughly 30-60 seconds to wake up. Fine for a demo; open the link once before showing anyone.
- **User accounts do not survive restarts.** Free Render has no permanent disk. Accounts, saved runs, notes and watchlists live in the SQLite file inside the container. Every sleep/wake, redeploy or crash resets that file to the shipped one, which has the Kepler results but zero users. Public visitors can still browse everything; they would need to sign up again after a reset.
- Because `SECRET_KEY` is fixed, login cookies stay valid, but the account behind them will be gone after a reset, so users just appear logged out.
- **Keeping accounts permanently costs money:** a Render persistent disk needs a paid instance (about $7/month for the Starter instance plus disk storage). A disk cannot simply be mounted on /app/data, because that would hide the shipped Kepler database, so it would also need a small code change.
- Free alternative for permanent accounts: move users to a free hosted Postgres. That needs code changes. Not needed for a demo.
- "Analyze a new star" downloads data from NASA on demand and takes a while. On the free 512 MB instance it should work, but if a run fails with the service restarting, that is memory; browsing is unaffected.
- Updating the app later: edit files on GitHub (pencil icon) or upload again; Render redeploys automatically (and resets accounts).

## If something goes wrong
- Build fails with "Dockerfile not found": the files are in a subfolder of the repo. Re-upload with the contents at top level.
- Page says "Application failed to respond": open **Logs** in Render and send me the last 20 lines.
- Login does not stick: check `COOKIE_SECURE` is exactly `1` and you are using the https:// URL.
