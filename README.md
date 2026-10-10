https://perihelion.onrender.com/#/size
# Perihelion - exoplanet transit hunter

Searches real NASA Kepler light curves for planet transits (Box Least Squares + vetting), derives planet size and orbit, and validates the result against NASA's confirmed-planet catalog. Flask + SQLite backend with real accounts, 12-page single-page app.

## Run
```
pip install -r requirements.txt
python app.py            # http://localhost:8080  (PORT=9000 python app.py to change)
```
`data/science.db` ships with the processed results. Accounts are created at runtime (the shipped DB has no users). In production set `SECRET_KEY` (and `COOKIE_SECURE=1`). See DEPLOY.md.
Docker: `docker build -t perihelion . && docker run -p 8080:8080 perihelion`. Mount a volume on `/app/data` to keep accounts.

## Re-run the science pipeline
```
python -m pipeline.ingest catalog          # NASA Exoplanet Archive TAP: catalog + stratified sample
python -m pipeline.ingest work 0 2 &       # 2 shards (resumable, downloads from MAST)
python -m pipeline.ingest work 1 2 &
python -m pipeline.build_db                # merge, vet, compute validation report
FULL=1 python -m pipeline.ingest work 0 1  # every confirmed-planet host star (~2,000 stars, ~10+ h on 2 CPUs)
```
## Method
First 8 quarters of PDCSAP long-cadence flux, running-median detrend, astropy BLS (up to 3 iterative signals), vetting (SNR >= 7.1, >= 3 transits, odd/even depth <= 4 sigma, no secondary eclipse). Radius = sqrt(depth) x catalog stellar radius; orbit from Kepler's third law.

## Honest limitations
- Kepler only; TESS is not ingested.
- Validation uses a stratified sample (about 20 stars per planet-size bin) plus 50 control stars, not the whole archive. Coverage is shown on the Data page.
- Controls are Kepler stars with no KOI/TCE; they may hold planets too small to detect.
- Radius ignores limb darkening and impact parameter; stellar parameters come from the catalog.
- Detections are candidates, not discoveries.
- Fonts load from Google Fonts.

Tests: `python tests/e2e.py http://localhost:8080 /tmp/shots` (Playwright + Chrome).
