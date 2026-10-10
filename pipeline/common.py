"""Shared science code: MAST access, detrending, BLS search, vetting, planet parameters."""
import io, re, time, urllib.request, urllib.parse
import numpy as np
from astropy.io import fits
from astropy.timeseries import BoxLeastSquares
from scipy.ndimage import median_filter

MAST = "https://archive.stsci.edu/missions/kepler/lightcurves/"
TAP = "https://exoplanetarchive.ipac.caltech.edu/TAP/sync?"
R_SUN_IN_R_EARTH = 109.076

def http(url, tries=4, timeout=60):
    last = None
    for i in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=timeout) as r:
                return r.read()
        except Exception as e:
            last = e; time.sleep(1.5 * (i + 1))
    raise RuntimeError(f"download failed: {url}: {last}")

def tap(query):
    return http(TAP + urllib.parse.urlencode({"query": query, "format": "csv"})).decode()

def kic_dir(kepid):
    s = f"{int(kepid):09d}"
    return f"{MAST}{s[:4]}/{s}/", s

def list_quarters(kepid):
    d, s = kic_dir(kepid)
    html = http(d).decode()
    return d, sorted(set(re.findall(r'(kplr%s-\d+_llc\.fits)' % s, html)))

def fetch_quarters(kepid, max_q=8):
    """Download long-cadence PDCSAP quarters for a KIC star. Returns list of (time, flux, err) arrays."""
    d, files = list_quarters(kepid)
    out = []
    for fn in files[:max_q]:
        raw = http(d + fn)
        with fits.open(io.BytesIO(raw)) as h:
            tb = h[1].data
            t = np.array(tb["TIME"], float); f = np.array(tb["PDCSAP_FLUX"], float)
            e = np.array(tb["PDCSAP_FLUX_ERR"], float); q = np.array(tb["SAP_QUALITY"])
        ok = np.isfinite(t) & np.isfinite(f) & np.isfinite(e) & (q == 0)
        if ok.sum() > 200:
            out.append((t[ok], f[ok], e[ok]))
    return out, len(files)

def detrend(quarters, window_days=1.5, cadence=0.0204321):
    """Normalise each quarter, remove slow trends with a running median, clip upward outliers."""
    T, F, E = [], [], []
    w = int(window_days / cadence) | 1
    for t, f, e in quarters:
        med = np.nanmedian(f)
        f = f / med; e = e / med
        # split on gaps > 0.5 d so the filter never straddles a gap
        idx = np.where(np.diff(t) > 0.5)[0] + 1
        for seg_t, seg_f, seg_e in zip(np.split(t, idx), np.split(f, idx), np.split(e, idx)):
            if len(seg_t) < 50: continue
            ww = min(w, (len(seg_t) // 2) * 2 - 1)
            trend = median_filter(seg_f, size=ww, mode="nearest")
            T.append(seg_t); F.append(seg_f / trend); E.append(seg_e)
    t = np.concatenate(T); f = np.concatenate(F); e = np.concatenate(E)
    s = 1.4826 * np.nanmedian(np.abs(f - np.nanmedian(f)))
    keep = f < 1 + 4 * s   # clip flares / cosmic rays, never clip dips
    return t[keep], f[keep], e[keep]

def period_grid(t, pmin=0.6, pmax=None, duration=0.1, oversample=3):
    base = t.max() - t.min()
    pmax = pmax or min(base / 2.5, 120.0)
    fmin, fmax = 1 / pmax, 1 / pmin
    df = duration / base ** 2 / oversample * 1.0
    n = int((fmax - fmin) / df)
    n = min(max(n, 2000), 60000)
    return 1 / np.linspace(fmax, fmin, n)

DURATIONS = np.array([0.04, 0.06, 0.09, 0.13, 0.18, 0.25, 0.35, 0.5])

def run_bls(t, f, e, periods=None):
    bls = BoxLeastSquares(t, f, dy=e)
    if periods is None: periods = period_grid(t)
    r = bls.power(periods, DURATIONS[DURATIONS < periods.min() * 0.5], objective="snr")
    return bls, r

def mask_transits(t, period, t0, dur, factor=1.6):
    ph = ((t - t0 + 0.5 * period) % period) - 0.5 * period
    return np.abs(ph) < dur * factor / 2

def candidate_stats(t, f, e, period, t0, dur):
    """Depth, SNR and vetting metrics for one candidate signal."""
    ph = ((t - t0 + 0.5 * period) % period) - 0.5 * period
    inn = np.abs(ph) < dur / 2
    out = (np.abs(ph) > dur) & (np.abs(ph) < 3 * dur)
    n_in = int(inn.sum())
    if n_in < 3 or out.sum() < 10:
        return None
    sig = 1.4826 * np.nanmedian(np.abs(f[~inn] - np.nanmedian(f[~inn])))
    sig = max(sig, 1e-7)
    depth = np.median(f[out]) - np.mean(f[inn])
    snr = depth / (sig / np.sqrt(n_in))
    epoch = np.round((t - t0) / period).astype(int)
    # odd/even
    oi, ei = inn & (epoch % 2 == 1), inn & (epoch % 2 == 0)
    if oi.sum() >= 3 and ei.sum() >= 3:
        d_odd = np.median(f[out]) - np.mean(f[oi]); d_even = np.median(f[out]) - np.mean(f[ei])
        err = sig * np.sqrt(1 / oi.sum() + 1 / ei.sum())
        oe_sigma = abs(d_odd - d_even) / err
    else:
        d_odd = d_even = np.nan; oe_sigma = 0.0
    # secondary eclipse at phase 0.5
    ph2 = ((t - t0) % period) - 0.5 * period
    sec = np.abs(ph2) < dur / 2
    if sec.sum() >= 3:
        d_sec = np.median(f[out]) - np.mean(f[sec]); sec_snr = d_sec / (sig / np.sqrt(sec.sum()))
    else:
        d_sec = np.nan; sec_snr = 0.0
    n_tr = len(np.unique(epoch[inn]))
    return dict(depth=float(depth), snr=float(snr), n_in=n_in, n_transits=int(n_tr), sigma=float(sig),
                depth_odd=float(d_odd), depth_even=float(d_even), odd_even_sigma=float(oe_sigma),
                depth_secondary=float(d_sec), secondary_snr=float(sec_snr))

def planet_params(depth, period_d, dur_d, srad, smass, teff):
    """Radius (R_earth), semi-major axis (AU) from depth, period and catalog stellar parameters."""
    out = {}
    if depth > 0 and srad and srad > 0:
        k = np.sqrt(depth)  # Rp/Rs; no limb-darkening correction (documented bias)
        out["radius_earth"] = float(k * srad * R_SUN_IN_R_EARTH)
    if smass and smass > 0:
        out["a_au"] = float((smass * (period_d / 365.25) ** 2) ** (1 / 3))
        if srad and teff:
            # equilibrium temperature, albedo 0.3, full redistribution
            rs_au = srad * 0.00465047
            out["teq_k"] = float(teff * np.sqrt(rs_au / (2 * out["a_au"])) * (0.7) ** 0.25)
            out["insolation"] = float((srad ** 2) * (teff / 5772.0) ** 4 / out["a_au"] ** 2)
    return out

def vet(stats):
    """Rule-based vetting. Returns (passed, flags)."""
    flags = []
    if stats["snr"] < 7.1: flags.append("snr_below_7.1")
    if stats["n_transits"] < 3: flags.append("fewer_than_3_transits")
    if stats["odd_even_sigma"] > 4: flags.append("odd_even_depth_mismatch")
    if stats["secondary_snr"] > 4 and stats["depth_secondary"] > 0.3 * stats["depth"]: flags.append("secondary_eclipse")
    return (len(flags) == 0), flags

def search_star(t, f, e, max_planets=3, periods=None):
    """Iterative BLS: find strongest signal, mask it, repeat. Returns list of detection dicts."""
    dets = []
    tt, ff, ee = t.copy(), f.copy(), e.copy()
    pg = periods
    for k in range(max_planets):
        if len(tt) < 500: break
        p = pg if pg is not None else period_grid(tt)
        bls, r = run_bls(tt, ff, ee, p)
        # trend-robust SNR: use power relative to the median/MAD of the spectrum
        pw = np.nan_to_num(r.power)
        i = int(np.argmax(pw))
        period, t0, dur = float(r.period[i]), float(r.transit_time[i]), float(r.duration[i])
        st = candidate_stats(tt, ff, ee, period, t0, dur)
        if st is None: break
        passed, flags = vet(st)
        dets.append(dict(rank=k + 1, period=period, t0=t0, duration=dur, passed=bool(passed), flags=flags,
                         bls_power=float(pw[i]), **st))
        if k == 0:
            spec = (r.period.copy(), pw.copy())
        m = mask_transits(tt, period, t0, dur)
        tt, ff, ee = tt[~m], ff[~m], ee[~m]
        if not passed and k >= 1: break
    return dets, (spec if dets else None)

def match_period(p_det, p_true, tol=0.01):
    """Return 'exact', 'harmonic' or None."""
    if abs(p_det - p_true) / p_true < tol: return "exact"
    for r in (2.0, 0.5, 3.0, 1 / 3.0):
        if abs(p_det - r * p_true) / (r * p_true) < tol: return "harmonic"
    return None
