"""Merge worker output into data/science.db and compute the validation report against the NASA Exoplanet Archive."""
import glob, json, os, sqlite3, sys
import numpy as np, pandas as pd
from pipeline.common import match_period

D = os.path.join(os.path.dirname(__file__), "..", "data")

SCHEMA = """
CREATE TABLE IF NOT EXISTS catalog(kepid INT, kepoi_name TEXT, kepler_name TEXT, ra REAL, dec REAL, period REAL, t0 REAL, duration_h REAL,
  depth_ppm REAL, radius_earth REAL, a_au REAL, teq_k REAL, insol REAL, impact REAL, model_snr REAL, n_transits INT,
  teff REAL, srad REAL, smass REAL, kepmag REAL);
CREATE INDEX IF NOT EXISTS ix_cat_kepid ON catalog(kepid);
CREATE TABLE IF NOT EXISTS stars(sid INTEGER PRIMARY KEY AUTOINCREMENT, kepid INT, owner INT, kind TEXT, name TEXT, kepmag REAL, teff REAL, srad REAL,
  smass REAL, ra REAL, dec REAL, n_quarters INT, baseline REAL, n_points INT, scatter REAL, curve BLOB, curve_n INT, periodogram TEXT,
  created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS ix_stars_kepid ON stars(kepid);
CREATE TABLE IF NOT EXISTS detections(id INTEGER PRIMARY KEY AUTOINCREMENT, sid INT, rank INT, period REAL, t0 REAL, duration REAL, depth REAL, snr REAL,
  n_transits INT, odd_even_sigma REAL, depth_odd REAL, depth_even REAL, secondary_snr REAL, depth_secondary REAL, passed INT, flags TEXT,
  radius_earth REAL, a_au REAL, teq_k REAL, insolation REAL, bls_power REAL, match TEXT, matched_koi TEXT, true_period REAL, true_radius REAL);
CREATE INDEX IF NOT EXISTS ix_det_sid ON detections(sid);
CREATE TABLE IF NOT EXISTS validation(id INTEGER PRIMARY KEY, report TEXT, created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE, name TEXT, pw TEXT, created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS notes(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INT, sid INT, body TEXT, created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS watch(user_id INT, kepid INT, created TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(user_id,kepid));
CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, user_id INT, kepid INT, status TEXT, message TEXT, sid INT, created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS login_attempts(ip TEXT, ts REAL);
"""

def connect(path=None):
    db = sqlite3.connect(path or f"{D}/science.db"); db.row_factory = sqlite3.Row
    db.executescript(SCHEMA); return db

def insert_star(db, res, owner=None, cat=None):
    name = None
    if cat is not None and len(cat):
        c = cat[cat.kepid == res["kepid"]]
        if len(c): name = (c.iloc[0].kepler_name if isinstance(c.iloc[0].kepler_name, str) else "").rsplit(" ", 1)[0] or None
    s = res["star"]
    cur = db.execute("INSERT INTO stars(kepid,owner,kind,name,kepmag,teff,srad,smass,ra,dec,n_quarters,baseline,n_points,scatter,curve,curve_n,periodogram) "
                     "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                     (res["kepid"], owner, res["kind"], name, s["kepmag"], s["teff"], s["srad"], s["smass"], s["ra"], s["dec"], res["n_quarters"],
                      res["baseline"], res["n_points"], res["scatter"], bytes.fromhex(res["curve"]), res["curve_n"], json.dumps(res["periodogram"])))
    sid = cur.lastrowid
    for d in res["detections"]:
        db.execute("INSERT INTO detections(sid,rank,period,t0,duration,depth,snr,n_transits,odd_even_sigma,depth_odd,depth_even,secondary_snr,depth_secondary,"
                   "passed,flags,radius_earth,a_au,teq_k,insolation,bls_power) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                   (sid, d["rank"], d["period"], d["t0"], d["duration"], d["depth"], d["snr"], d["n_transits"], d["odd_even_sigma"],
                    d.get("depth_odd"), d.get("depth_even"), d["secondary_snr"], d.get("depth_secondary"), int(d["passed"]), json.dumps(d["flags"]),
                    d.get("radius_earth"), d.get("a_au"), d.get("teq_k"), d.get("insolation"), d["bls_power"]))
    return sid

def build():
    if os.path.exists(f"{D}/science.db"): os.remove(f"{D}/science.db")
    db = connect()
    cat = pd.read_csv(f"{D}/confirmed_catalog.csv")
    for r in cat.itertuples():
        db.execute("INSERT INTO catalog VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                   (r.kepid, r.kepoi_name, r.kepler_name if isinstance(r.kepler_name, str) else None, r.ra, r.dec, r.koi_period, r.koi_time0bk,
                    r.koi_duration, r.koi_depth, r.koi_prad, r.koi_sma, r.koi_teq, r.koi_insol, r.koi_impact, r.koi_model_snr, r.koi_num_transits,
                    r.koi_steff, r.koi_srad, r.koi_smass, r.koi_kepmag))
    n = 0
    for fn in sorted(glob.glob(f"{D}/results_*.jsonl")):
        for line in open(fn):
            insert_star(db, json.loads(line), None, cat); n += 1
    # match detections against the archive
    for s in db.execute("SELECT sid,kepid,kind FROM stars WHERE owner IS NULL").fetchall():
        planets = db.execute("SELECT * FROM catalog WHERE kepid=? AND period IS NOT NULL", (s["kepid"],)).fetchall() if s["kind"] == "host" else []
        for d in db.execute("SELECT id,period FROM detections WHERE sid=?", (s["sid"],)).fetchall():
            best = None
            for p in planets:
                m = match_period(d["period"], p["period"])
                if m and (best is None or m == "exact"): best = (m, p)
            if best:
                db.execute("UPDATE detections SET match=?,matched_koi=?,true_period=?,true_radius=? WHERE id=?",
                           (best[0], best[1]["kepoi_name"], best[1]["period"], best[1]["radius_earth"], d["id"]))
    db.commit()
    report = validate(db); db.execute("INSERT INTO validation(id,report) VALUES(1,?)", (json.dumps(report),)); db.commit()
    print("stars", n); print(json.dumps(report["headline"], indent=1))

def validate(db):
    hosts = db.execute("SELECT sid,kepid FROM stars WHERE owner IS NULL AND kind='host'").fetchall()
    ctrls = db.execute("SELECT sid,kepid FROM stars WHERE owner IS NULL AND kind='control'").fetchall()
    known = []  # every confirmed planet orbiting a sampled host star
    for h in hosts:
        dets = db.execute("SELECT * FROM detections WHERE sid=?", (h["sid"],)).fetchall()
        for p in db.execute("SELECT * FROM catalog WHERE kepid=? AND period IS NOT NULL", (h["kepid"],)).fetchall():
            hit = None; any_hit = None
            for d in dets:
                m = match_period(d["period"], p["period"])
                if m == "exact":
                    any_hit = d
                    if d["passed"]: hit = d; break
            known.append(dict(kepoi=p["kepoi_name"], kepid=h["kepid"], period=p["period"], radius=p["radius_earth"], snr=p["model_snr"],
                              recovered=bool(hit), search_hit=bool(any_hit), det=dict(hit) if hit else None))
    def rate(rows, key="recovered"):
        return (sum(r[key] for r in rows) / len(rows)) if rows else None
    def by(field, edges, labels):
        out = []
        for (lo, hi), lab in zip(zip(edges[:-1], edges[1:]), labels):
            rows = [k for k in known if k[field] is not None and lo <= k[field] < hi]
            out.append(dict(label=lab, n=len(rows), recall=rate(rows)))
        return out
    rad_bins = by("radius", [0, 1.25, 2, 4, 8, 1000], ["<1.25 R⊕", "1.25-2", "2-4", "4-8", ">8 R⊕"])
    per_bins = by("period", [0, 3, 10, 30, 100, 10000], ["<3 d", "3-10", "10-30", "30-100", ">100 d"])
    snr_bins = by("snr", [0, 10, 20, 50, 200, 1e9], ["SNR<10", "10-20", "20-50", "50-200", ">200"])
    matched = [k for k in known if k["recovered"]]
    perr = [abs(k["det"]["period"] - k["period"]) / k["period"] for k in matched]
    rr = [k["det"]["radius_earth"] / k["radius"] for k in matched if k["det"]["radius_earth"] and k["radius"]]
    scatter_pts = [dict(kepoi=k["kepoi"], det=k["det"]["radius_earth"], true=k["radius"], period=k["period"]) for k in matched if k["det"]["radius_earth"] and k["radius"]]
    host_det = db.execute("SELECT d.* FROM detections d JOIN stars s ON s.sid=d.sid WHERE s.owner IS NULL AND s.kind='host' AND d.passed=1").fetchall()
    exact = sum(1 for d in host_det if d["match"] == "exact"); harm = sum(1 for d in host_det if d["match"] == "harmonic")
    ctrl_pass = []
    sweep = []
    for c in ctrls:
        dd = db.execute("SELECT snr,passed,flags FROM detections WHERE sid=?", (c["sid"],)).fetchall()
        ctrl_pass.append(dd)
    for thr in [5, 6, 7.1, 8, 10, 12, 15, 20, 30]:
        rec = []
        for h in hosts:
            dets = db.execute("SELECT * FROM detections WHERE sid=?", (h["sid"],)).fetchall()
            for p in db.execute("SELECT period FROM catalog WHERE kepid=? AND period IS NOT NULL", (h["kepid"],)).fetchall():
                rec.append(any(match_period(d["period"], p["period"]) == "exact" and d["snr"] >= thr and d["n_transits"] >= 3 and d["odd_even_sigma"] <= 4
                               and not (d["secondary_snr"] > 4 and (d["depth_secondary"] or 0) > 0.3 * d["depth"]) for d in dets))
        far = sum(1 for dd in ctrl_pass if any(x["snr"] >= thr for x in dd)) / max(1, len(ctrl_pass))
        sweep.append(dict(snr=thr, recall=sum(rec) / max(1, len(rec)), false_alarm_rate=far))
    far_pass = sum(1 for dd in ctrl_pass if any(x["passed"] for x in dd)) / max(1, len(ctrl_pass))
    flag_counts = {}
    for d in db.execute("SELECT flags FROM detections WHERE passed=0").fetchall():
        for fl in json.loads(d["flags"]): flag_counts[fl] = flag_counts.get(fl, 0) + 1
    ci = lambda k, n: (None if n == 0 else [max(0, k / n - 1.96 * np.sqrt(k / n * (1 - k / n) / n)), min(1, k / n + 1.96 * np.sqrt(k / n * (1 - k / n) / n))])
    headline = dict(host_stars=len(hosts), control_stars=len(ctrls), known_planets=len(known), recovered=len(matched),
                    recall=rate(known), recall_ci95=ci(len(matched), len(known)),
                    median_period_error=float(np.median(perr)) if perr else None,
                    median_radius_ratio=float(np.median(rr)) if rr else None,
                    median_abs_radius_error=float(np.median(np.abs(np.array(rr) - 1))) if rr else None,
                    within_30pct_radius=float(np.mean(np.abs(np.array(rr) - 1) < 0.3)) if rr else None,
                    passed_detections_on_hosts=len(host_det), exact=exact, harmonic=harm, unmatched=len(host_det) - exact - harm,
                    control_false_alarm_rate=far_pass, control_false_alarm_ci95=ci(int(round(far_pass * len(ctrls))), len(ctrls)))
    return dict(headline=headline, by_radius=rad_bins, by_period=per_bins, by_snr=snr_bins, sweep=sweep, radius_pairs=scatter_pts,
                vetting_flags=flag_counts, missed=[dict(kepoi=k["kepoi"], period=k["period"], radius=k["radius"], snr=k["snr"], search_hit=k["search_hit"])
                                                   for k in known if not k["recovered"]][:200])

if __name__ == "__main__":
    build()
