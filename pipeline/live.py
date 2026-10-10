"""On-demand analysis of any Kepler (KIC) star: stellar parameters from the NASA archive, light curves from MAST."""
import io, pandas as pd
from pipeline.common import *
from pipeline.ingest import pack_curve

def analyze(kepid, progress=lambda m: None):
    ks = pd.read_csv(io.StringIO(tap(f"select kepid,teff,radius,mass,kepmag,ra,dec from Q1_Q17_DR25_KS where kepid={int(kepid)}")))
    if ks.empty: raise ValueError(f"KIC {kepid} is not in the Kepler DR25 stellar catalog")
    r = ks.iloc[0]
    star = dict(srad=r.radius, smass=r.mass, teff=r.teff, kepmag=r.kepmag, ra=r.ra, dec=r.dec)
    progress("Downloading Kepler light curves from MAST")
    q, nfiles = fetch_quarters(kepid, 8)
    if not q: raise ValueError("No usable long-cadence Kepler data for this star")
    progress("Detrending and running the transit search")
    t, f, e = detrend(q)
    dets, spec = search_star(t, f, e, max_planets=3)
    if not dets: raise ValueError("Search produced no candidate signals")
    for d in dets:
        d.update(planet_params(d["depth"], d["period"], d["duration"], star["srad"], star["smass"], star["teff"]))
    blob, n = pack_curve(t, f)
    sp, sw = spec
    edges = np.unique(np.round(np.geomspace(1, len(sp), 601)).astype(int)) - 1
    pp, ww = [], []
    for a, b in zip(edges[:-1], edges[1:]):
        seg = slice(a, max(b, a + 1)); j = a + int(np.argmax(sw[seg])); pp.append(float(sp[j])); ww.append(float(sw[j]))
    o = np.argsort(pp)
    return dict(kepid=int(kepid), kind="live", star={k: (None if pd.isna(v) else float(v)) for k, v in star.items()}, n_quarters=len(q), n_files=nfiles,
                baseline=float(t.max() - t.min()), n_points=int(len(t)), detections=dets, curve=blob.hex(), curve_n=n,
                periodogram=[[pp[i] for i in o], [ww[i] for i in o]], scatter=float(np.std(f)))
