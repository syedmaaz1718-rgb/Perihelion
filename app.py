"""Perihelion - transit search workbench. Flask + SQLite backend."""
import json, os, secrets, threading, time, uuid, zlib, io
import numpy as np, pandas as pd
from flask import Flask, g, jsonify, request, session, send_from_directory, abort, Response
from werkzeug.security import generate_password_hash, check_password_hash
from pipeline.build_db import connect, insert_star, D

app = Flask(__name__, static_folder="static", static_url_path="/static")
def _secret():
    s = os.environ.get("SECRET_KEY") or os.environ.get("PERIHELION_SECRET")
    if s: return s
    kf = os.path.join(D, "secret.key")
    try:
        if not os.path.exists(kf): open(kf, "w").write(secrets.token_hex(32))
        return open(kf).read().strip()
    except OSError:
        return secrets.token_hex(32)
app.secret_key = _secret()
_secure = (os.environ.get("COOKIE_SECURE") or os.environ.get("PERIHELION_HTTPS") or "").lower() in ("1", "true", "yes")
app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax", MAX_CONTENT_LENGTH=1 << 20,
                  SESSION_COOKIE_SECURE=_secure)
if _secure:  # behind Render's proxy: use the real client IP and https scheme
    from werkzeug.middleware.proxy_fix import ProxyFix
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1)
DB_PATH = os.path.join(D, "science.db")
LIVE_LOCK = threading.Semaphore(1)

def db():
    if "db" not in g:
        g.db = connect(DB_PATH)
    return g.db

@app.teardown_appcontext
def close(_):
    d = g.pop("db", None)
    if d: d.close()

@app.after_request
def headers(r):
    r.headers["X-Content-Type-Options"] = "nosniff"; r.headers["X-Frame-Options"] = "DENY"
    r.headers["Referrer-Policy"] = "same-origin"
    r.headers["Content-Security-Policy"] = ("default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
                                            "font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; script-src 'self'")
    if request.path.startswith("/api/"): r.headers["Cache-Control"] = "no-store"
    return r

def uid():
    return session.get("uid")

def need_user():
    if not uid(): abort(401)
    if request.method in ("POST", "PUT", "DELETE"):
        if request.headers.get("X-CSRF") != session.get("csrf"): abort(403)
        o = request.headers.get("Origin")
        if o and o.split("//", 1)[-1] != request.host: abort(403)

def rows(q, a=()):
    return [dict(r) for r in db().execute(q, a).fetchall()]

def visible_star(sid):
    r = db().execute("SELECT * FROM stars WHERE sid=? AND (owner IS NULL OR owner=?)", (sid, uid() or -1)).fetchone()
    if not r: abort(404)
    return r

def star_json(s):
    d = {k: s[k] for k in s.keys() if k not in ("curve", "periodogram")}
    d["detections"] = rows("SELECT * FROM detections WHERE sid=? ORDER BY rank", (s["sid"],))
    for x in d["detections"]: x["flags"] = json.loads(x["flags"] or "[]")
    d["periodogram"] = json.loads(s["periodogram"])
    d["catalog_planets"] = rows("SELECT kepoi_name,kepler_name,period,t0,duration_h,depth_ppm,radius_earth,a_au,teq_k,insol,model_snr FROM catalog WHERE kepid=? ORDER BY period", (s["kepid"],))
    d["watched"] = bool(uid() and db().execute("SELECT 1 FROM watch WHERE user_id=? AND kepid=?", (uid(), s["kepid"])).fetchone())
    return d

@app.route("/")
def index():
    return send_from_directory("static", "index.html")

@app.route("/healthz")
def health():
    return {"ok": True}

# ---------- auth ----------
def new_session(u):
    session.clear(); session["uid"] = u["id"]; session["csrf"] = secrets.token_hex(16)

def me_json():
    if not uid(): return {"user": None, "csrf": session.setdefault("csrf", secrets.token_hex(16))}
    u = db().execute("SELECT id,email,name,created FROM users WHERE id=?", (uid(),)).fetchone()
    if not u: session.clear(); return {"user": None, "csrf": session.setdefault("csrf", secrets.token_hex(16))}
    return {"user": dict(u), "csrf": session["csrf"]}

@app.get("/healthz")
def healthz():
    return {"ok": True}

@app.get("/api/me")
def me():
    return me_json()

def csrf_public():
    if request.headers.get("X-CSRF") != session.get("csrf"): abort(403)

@app.post("/api/auth/signup")
def signup():
    csrf_public()
    j = request.get_json(force=True, silent=True) or {}
    email = (j.get("email") or "").strip().lower(); name = (j.get("name") or "").strip()[:60]; pw = j.get("password") or ""
    if "@" not in email or "." not in email.split("@")[-1] or len(email) > 120: return {"error": "Enter a valid email address."}, 400
    if len(pw) < 8: return {"error": "Password must be at least 8 characters."}, 400
    if not name: name = email.split("@")[0]
    if db().execute("SELECT 1 FROM users WHERE email=?", (email,)).fetchone(): return {"error": "An account with this email already exists."}, 409
    cur = db().execute("INSERT INTO users(email,name,pw) VALUES(?,?,?)", (email, name, generate_password_hash(pw))); db().commit()
    new_session({"id": cur.lastrowid}); return me_json()

@app.post("/api/auth/login")
def login():
    csrf_public()
    ip = request.remote_addr or "?"; now = time.time()
    db().execute("DELETE FROM login_attempts WHERE ts<?", (now - 600,))
    if db().execute("SELECT COUNT(*) c FROM login_attempts WHERE ip=?", (ip,)).fetchone()["c"] >= 10:
        return {"error": "Too many attempts. Try again in a few minutes."}, 429
    j = request.get_json(force=True, silent=True) or {}
    u = db().execute("SELECT * FROM users WHERE email=?", ((j.get("email") or "").strip().lower(),)).fetchone()
    if not u or not check_password_hash(u["pw"], j.get("password") or ""):
        db().execute("INSERT INTO login_attempts VALUES(?,?)", (ip, now)); db().commit()
        return {"error": "Incorrect email or password."}, 401
    new_session(u); return me_json()

@app.post("/api/auth/logout")
def logout():
    csrf_public(); session.clear(); return me_json()

# ---------- science data ----------
@app.get("/api/overview")
def overview():
    rep = json.loads(db().execute("SELECT report FROM validation WHERE id=1").fetchone()["report"])
    return dict(catalog_total=db().execute("SELECT COUNT(*) c FROM catalog").fetchone()["c"],
                stars=rows("SELECT sid,kepid,kind,name,kepmag FROM stars WHERE owner IS NULL ORDER BY kind DESC, kepid"),
                headline=rep["headline"])

@app.get("/api/stars")
def stars():
    return {"stars": rows("SELECT s.sid,s.kepid,s.kind,s.name,s.kepmag,s.owner,(SELECT COUNT(*) FROM detections d WHERE d.sid=s.sid AND d.passed=1) AS n_pass "
                          "FROM stars s WHERE s.owner IS NULL OR s.owner=? ORDER BY s.kind DESC, s.kepid", (uid() or -1,))}

@app.get("/api/catalog")
def catalog():
    q = (request.args.get("q") or "").strip().lower()
    sql = ("SELECT c.*, (SELECT sid FROM stars s WHERE s.kepid=c.kepid AND s.owner IS NULL LIMIT 1) AS sid FROM catalog c WHERE 1=1")
    a = []
    if q:
        sql += " AND (lower(kepoi_name) LIKE ? OR lower(kepler_name) LIKE ? OR CAST(kepid AS TEXT) LIKE ?)"; a += [f"%{q}%"] * 3
    for key, col, op in (("rmin", "radius_earth", ">="), ("rmax", "radius_earth", "<="), ("pmin", "period", ">="), ("pmax", "period", "<=")):
        v = request.args.get(key)
        if v not in (None, ""):
            try: a.append(float(v)); sql += f" AND {col} {op} ?"
            except ValueError: abort(400)
    if request.args.get("analyzed") == "1": sql += " AND sid IS NOT NULL"
    sort = {"period": "period", "radius": "radius_earth", "snr": "model_snr", "name": "kepoi_name", "mag": "kepmag"}.get(request.args.get("sort"), "kepid")
    sql += f" ORDER BY {sort} {'DESC' if request.args.get('dir') == 'desc' else 'ASC'}"
    allr = rows(sql, a); page = max(0, int(request.args.get("page", 0) or 0)); n = 40
    return {"total": len(allr), "rows": allr[page * n:(page + 1) * n], "page": page, "page_size": n}

@app.get("/api/field")
def field():
    return {"catalog": rows("SELECT kepid,kepoi_name,ra,dec,radius_earth,period FROM catalog WHERE ra IS NOT NULL"),
            "sample": rows("SELECT kepid,kind,ra,dec,name FROM stars WHERE owner IS NULL AND ra IS NOT NULL")}

@app.get("/api/star/<int:sid>")
def star(sid):
    return star_json(visible_star(sid))

@app.get("/api/star/<int:sid>/curve")
def curve(sid):
    s = visible_star(sid); raw = zlib.decompress(s["curve"]); n = s["curve_n"]
    t = np.frombuffer(raw[:4 * n], np.float32); f = np.frombuffer(raw[4 * n:], np.int16)
    return {"t": [round(float(x), 4) for x in t], "ppm": [int(x) for x in f]}

@app.get("/api/validation")
def validation():
    return json.loads(db().execute("SELECT report FROM validation WHERE id=1").fetchone()["report"])

@app.get("/api/size_orbit")
def size_orbit():
    return {"detected": rows("SELECT d.id,d.sid,s.kepid,s.name,d.period,d.radius_earth,d.a_au,d.teq_k,d.insolation,d.snr,d.match,d.matched_koi,d.true_radius "
                             "FROM detections d JOIN stars s ON s.sid=d.sid WHERE d.passed=1 AND d.radius_earth IS NOT NULL AND (s.owner IS NULL OR s.owner=?)", (uid() or -1,)),
            "catalog": rows("SELECT kepoi_name,period,radius_earth,a_au,teq_k,insol FROM catalog WHERE radius_earth IS NOT NULL AND period IS NOT NULL")}

# ---------- live analysis ----------
def run_job(job, user_id, kepid):
    from pipeline.live import analyze
    c = connect(DB_PATH)
    def upd(status, msg, sid=None):
        c.execute("UPDATE jobs SET status=?,message=?,sid=? WHERE id=?", (status, msg, sid, job)); c.commit()
    try:
        upd("queued", "Waiting for the analysis worker")
        with LIVE_LOCK:
            res = analyze(kepid, lambda m: upd("running", m))
        cat = pd.read_csv(os.path.join(D, "confirmed_catalog.csv"))
        sid = insert_star(c, res, owner=user_id, cat=cat); c.commit()
        upd("done", "Analysis complete", sid)
    except Exception as ex:
        upd("error", str(ex)[:300])
    finally:
        c.close()

@app.post("/api/analyze")
def analyze_live():
    need_user()
    try: kepid = int((request.get_json(force=True, silent=True) or {}).get("kepid"))
    except (TypeError, ValueError): return {"error": "Enter a numeric KIC ID."}, 400
    if not (1000000 <= kepid <= 99999999): return {"error": "KIC IDs are 7 to 8 digits."}, 400
    if db().execute("SELECT COUNT(*) c FROM jobs WHERE user_id=? AND status IN ('queued','running')", (uid(),)).fetchone()["c"] >= 1:
        return {"error": "You already have an analysis running."}, 429
    job = uuid.uuid4().hex[:12]
    db().execute("INSERT INTO jobs(id,user_id,kepid,status,message) VALUES(?,?,?,?,?)", (job, uid(), kepid, "queued", "Starting")); db().commit()
    threading.Thread(target=run_job, args=(job, uid(), kepid), daemon=True).start()
    return {"job": job}

@app.get("/api/jobs/<job>")
def job_status(job):
    need_user()
    j = db().execute("SELECT * FROM jobs WHERE id=? AND user_id=?", (job, uid())).fetchone()
    if not j: abort(404)
    return dict(j)

# ---------- user data ----------
@app.get("/api/saved")
def saved():
    need_user()
    return {"runs": rows("SELECT sid,kepid,name,created,(SELECT COUNT(*) FROM detections d WHERE d.sid=stars.sid AND d.passed=1) n_pass FROM stars WHERE owner=? ORDER BY sid DESC", (uid(),)),
            "notes": rows("SELECT n.id,n.sid,n.body,n.created,s.kepid FROM notes n JOIN stars s ON s.sid=n.sid WHERE n.user_id=? ORDER BY n.id DESC", (uid(),)),
            "watch": rows("SELECT w.kepid,w.created,(SELECT sid FROM stars s WHERE s.kepid=w.kepid AND s.owner IS NULL LIMIT 1) sid,(SELECT kepoi_name FROM catalog c WHERE c.kepid=w.kepid LIMIT 1) koi FROM watch w WHERE user_id=? ORDER BY created DESC", (uid(),))}

@app.delete("/api/run/<int:sid>")
def del_run(sid):
    need_user()
    if not db().execute("SELECT 1 FROM stars WHERE sid=? AND owner=?", (sid, uid())).fetchone(): abort(404)
    for t in ("detections", "notes"): db().execute(f"DELETE FROM {t} WHERE sid=?", (sid,))
    db().execute("DELETE FROM stars WHERE sid=?", (sid,)); db().commit(); return {"ok": True}

@app.post("/api/star/<int:sid>/note")
def add_note(sid):
    need_user(); visible_star(sid)
    body = ((request.get_json(force=True, silent=True) or {}).get("body") or "").strip()[:2000]
    if not body: return {"error": "Write something first."}, 400
    db().execute("INSERT INTO notes(user_id,sid,body) VALUES(?,?,?)", (uid(), sid, body)); db().commit(); return {"ok": True}

@app.delete("/api/note/<int:nid>")
def del_note(nid):
    need_user(); db().execute("DELETE FROM notes WHERE id=? AND user_id=?", (nid, uid())); db().commit(); return {"ok": True}

@app.get("/api/star/<int:sid>/notes")
def star_notes(sid):
    need_user(); visible_star(sid)
    return {"notes": rows("SELECT id,body,created FROM notes WHERE user_id=? AND sid=? ORDER BY id DESC", (uid(), sid))}

@app.post("/api/watch/<int:kepid>")
def toggle_watch(kepid):
    need_user()
    if db().execute("SELECT 1 FROM watch WHERE user_id=? AND kepid=?", (uid(), kepid)).fetchone():
        db().execute("DELETE FROM watch WHERE user_id=? AND kepid=?", (uid(), kepid)); on = False
    else:
        db().execute("INSERT INTO watch(user_id,kepid) VALUES(?,?)", (uid(), kepid)); on = True
    db().commit(); return {"watched": on}

@app.get("/api/export")
def export():
    need_user(); u = db().execute("SELECT id,email,name,created FROM users WHERE id=?", (uid(),)).fetchone()
    data = dict(account=dict(u), analyses=[star_json(db().execute("SELECT * FROM stars WHERE sid=?", (r["sid"],)).fetchone())
                                           for r in rows("SELECT sid FROM stars WHERE owner=?", (uid(),))],
                notes=rows("SELECT sid,body,created FROM notes WHERE user_id=?", (uid(),)), watchlist=rows("SELECT kepid,created FROM watch WHERE user_id=?", (uid(),)))
    return Response(json.dumps(data, indent=1), mimetype="application/json", headers={"Content-Disposition": "attachment; filename=perihelion-export.json"})

@app.post("/api/account/name")
def rename():
    need_user(); n = ((request.get_json(force=True, silent=True) or {}).get("name") or "").strip()[:60]
    if not n: return {"error": "Name can't be empty."}, 400
    db().execute("UPDATE users SET name=? WHERE id=?", (n, uid())); db().commit(); return me_json()

@app.delete("/api/account")
def delete_account():
    need_user()
    j = request.get_json(force=True, silent=True) or {}
    u = db().execute("SELECT * FROM users WHERE id=?", (uid(),)).fetchone()
    if not check_password_hash(u["pw"], j.get("password") or ""): return {"error": "Password is incorrect."}, 403
    for r in rows("SELECT sid FROM stars WHERE owner=?", (uid(),)):
        db().execute("DELETE FROM detections WHERE sid=?", (r["sid"],))
    for t in ("stars WHERE owner", "notes WHERE user_id", "watch WHERE user_id", "jobs WHERE user_id", "users WHERE id"):
        db().execute(f"DELETE FROM {t}=?", (uid(),))
    db().commit(); session.clear(); return {"ok": True}

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 8080)), threaded=True)
