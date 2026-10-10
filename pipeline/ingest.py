"""Step 1: pull the NASA Exoplanet Archive catalog and choose the validation sample.
   Step 2 (worker): download Kepler light curves from MAST and run the transit search on each star.
   Usage: python -m pipeline.ingest catalog | python -m pipeline.ingest work <shard> <nshards>"""
import sys, io, json, os, zlib, time, traceback
import numpy as np, pandas as pd
from pipeline.common import *

D = os.path.join(os.path.dirname(__file__), "..", "data")
COLS = ("kepid,kepoi_name,kepler_name,koi_disposition,ra,dec,koi_period,koi_time0bk,koi_duration,koi_depth,koi_prad,"
        "koi_sma,koi_teq,koi_insol,koi_impact,koi_model_snr,koi_num_transits,koi_steff,koi_srad,koi_smass,koi_kepmag")

def build_catalog(n_per_bin=20, n_controls=50, seed=7):
    rng = np.random.default_rng(seed)
    cat = pd.read_csv(io.StringIO(tap(f"select {COLS} from cumulative where koi_disposition='CONFIRMED'")))
    cat.to_csv(f"{D}/confirmed_catalog.csv", index=False)
    ok = cat[(cat.koi_kepmag < 14) & cat.koi_prad.notna() & cat.koi_srad.notna() & cat.koi_smass.notna()]
    ok = ok[ok.koi_num_transits >= 5]
    bins = [(0, 1.25), (1.25, 2), (2, 4), (4, 8), (8, 100)]
    hosts = []
    for lo, hi in bins:
        sub = ok[(ok.koi_prad >= lo) & (ok.koi_prad < hi)].kepid.unique()
        hosts += list(rng.choice(sub, size=min(n_per_bin, len(sub)), replace=False))
    if 11904151 not in hosts: hosts.append(11904151)  # Kepler-10
    ks = pd.read_csv(io.StringIO(tap(
        "select kepid,teff,radius,mass,kepmag,ra,dec,nkoi,ntce from Q1_Q17_DR25_KS "
        "where nkoi=0 and ntce=0 and kepmag>=11 and kepmag<14 and radius>0.7 and radius<1.6 and mass>0.6 and mass<1.4 and st_quarters like '1111111%'")))
    ctrl = rng.choice(ks.kepid.values, size=n_controls, replace=False)
    ks[ks.kepid.isin(ctrl)].to_csv(f"{D}/controls_catalog.csv", index=False)
    rows = [dict(kepid=int(k), kind="host") for k in hosts] + [dict(kepid=int(k), kind="control") for k in ctrl]
    pd.DataFrame(rows).to_csv(f"{D}/sample.csv", index=False)
    print("catalog", len(cat), "hosts", len(hosts), "controls", len(ctrl))

def pack_curve(t, f, bin_h=1.0):
    """1-hour binned, int16 ppm flux (display + phase lab). Gaps preserved."""
    w = bin_h / 24.0
    b = np.floor((t - t[0]) / w).astype(int)
    u, inv = np.unique(b, return_inverse=True)
    tt = np.bincount(inv, t) / np.bincount(inv)
    ff = np.bincount(inv, f) / np.bincount(inv)
    ppm = np.clip(np.round((ff - 1) * 1e6), -32000, 32000).astype(np.int16)
    return zlib.compress(np.asarray(tt, np.float32).tobytes() + ppm.tobytes(), 9), len(tt)

def process(kepid, kind, cat, ctrl):
    q, nfiles = fetch_quarters(kepid, 8)
    t, f, e = detrend(q)
    dets, spec = search_star(t, f, e, max_planets=3)
    if kind == "host":
        r = cat[cat.kepid == kepid].iloc[0]
        star = dict(srad=r.koi_srad, smass=r.koi_smass, teff=r.koi_steff, kepmag=r.koi_kepmag, ra=r.ra, dec=r.dec)
    else:
        r = ctrl[ctrl.kepid == kepid].iloc[0]
        star = dict(srad=r.radius, smass=r.mass, teff=r.teff, kepmag=r.kepmag, ra=r.ra, dec=r.dec)
    for d in dets:
        d.update(planet_params(d["depth"], d["period"], d["duration"], star["srad"], star["smass"], star["teff"]))
    blob, n = pack_curve(t, f)
    sp, sw = spec
    # compress periodogram to <=600 log-spaced points (max in each bin)
    edges = np.unique(np.round(np.geomspace(1, len(sp), 601)).astype(int)) - 1
    pp, ww = [], []
    for a, b2 in zip(edges[:-1], edges[1:]):
        seg = slice(a, max(b2, a + 1)); j = a + int(np.argmax(sw[seg])); pp.append(float(sp[j])); ww.append(float(sw[j]))
    order = np.argsort(pp)
    return dict(kepid=kepid, kind=kind, star=star, n_quarters=len(q), n_files=nfiles, baseline=float(t.max() - t.min()),
                n_points=int(len(t)), detections=dets, curve=blob.hex(), curve_n=n,
                periodogram=[[pp[i] for i in order], [ww[i] for i in order]], scatter=float(np.std(f)))

if __name__ == "__main__":
    if sys.argv[1] == "catalog":
        build_catalog()
    else:
        shard, ns = int(sys.argv[2]), int(sys.argv[3])
        cat = pd.read_csv(f"{D}/confirmed_catalog.csv"); ctrl = pd.read_csv(f"{D}/controls_catalog.csv")
        sample = pd.read_csv(f"{D}/sample.csv")
        if os.environ.get("FULL"):  # every confirmed-planet host + all controls, not just the validation sample
            hosts = pd.DataFrame({"kepid": cat.kepid.unique(), "kind": "host"})
            sample = pd.concat([hosts, ctrl[["kepid"]].assign(kind="control")], ignore_index=True)
        out = f"{D}/results_{shard}.jsonl"
        done = set()
        if os.path.exists(out):
            done = {json.loads(l)["kepid"] for l in open(out)}
        with open(out, "a") as fh:
            for i, r in sample.iterrows():
                if i % ns != shard or r.kepid in done: continue
                t0 = time.time()
                try:
                    res = process(int(r.kepid), r.kind, cat, ctrl)
                    fh.write(json.dumps(res) + "\n"); fh.flush()
                    print(i, r.kepid, r.kind, len(res["detections"]), round(time.time() - t0), "s", flush=True)
                except Exception as ex:
                    print("FAIL", r.kepid, ex, flush=True)
