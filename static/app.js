"use strict";
/* Perihelion front end: hash router, iris transitions, hand-built SVG charts. */
const $ = (s, r) => (r || S.root || document).querySelector(s) || document.querySelector(s), $$ = (s, r) => [...(r || S.root || document).querySelectorAll(s)];
const G = s => document.querySelector(s), GG = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const reduce = matchMedia("(prefers-reduced-motion:reduce)");
const S = { user: null, csrf: "", sid: null, sid2: null, det: 0, stars: [], cache: {} };
const fmt = (v, d = 3) => v == null || isNaN(v) ? "-" : (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString() : (+v).toFixed(d).replace(/\.?0+$/, "") || "0");
const ci = a => a ? pct(a[0]) + " to " + pct(a[1]) : "n/a";
const pct = v => v == null ? "-" : (v * 100).toFixed(v < .1 ? 1 : 0) + "%";

async function api(path, opt = {}) {
  const o = { method: opt.method || "GET", headers: { "Content-Type": "application/json", "X-CSRF": S.csrf }, credentials: "same-origin" };
  if (opt.body !== undefined) o.body = JSON.stringify(opt.body);
  const r = await fetch("/api" + path, o); let j = {};
  try { j = await r.json(); } catch (e) {}
  if (!r.ok) { const e = new Error(j.error || (r.status === 401 ? "Please sign in." : "Request failed (" + r.status + ")")); e.status = r.status; throw e; }
  return j;
}
const cached = async (k, f) => S.cache[k] || (S.cache[k] = await f());
function toast(m) { const t = G("#toast"); t.textContent = m; t.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 2600); }

const IC = {
  workbench: '<g class="a-pulse"><path d="M3 12h4l2-6 3 12 3-9 2 3h4"/></g>',
  catalog: '<g class="a-scan"><circle cx="11" cy="11" r="6"/><path d="M16 16l5 5"/></g>',
  vetting: '<g class="a-blink"><path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z"/><circle cx="12" cy="11" r="1.6"/></g>',
  phase: '<g class="a-orb"><circle cx="12" cy="12" r="9" opacity=".35"/><ellipse cx="12" cy="12" rx="9" ry="3.5"/></g><circle cx="12" cy="12" r="2.2"/>',
  periodogram: '<g class="a-bars"><path d="M5 20V12"/><path d="M12 20V4"/><path d="M19 20v-6"/></g>',
  size: '<g class="a-blink"><circle cx="8" cy="15" r="2.2"/><circle cx="16" cy="8" r="4"/></g><path d="M3 21h18" opacity=".5"/>',
  validation: '<g class="a-blink"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/></g>',
  field: '<g class="a-blink"><circle cx="6" cy="7" r="1.2"/><circle cx="17" cy="6" r="1.2"/><circle cx="12" cy="13" r="1.6"/><circle cx="19" cy="17" r="1.2"/><circle cx="5" cy="18" r="1.2"/></g><rect x="3" y="3" width="18" height="18" rx="3" opacity=".4"/>',
  compare: '<g class="a-scan"><rect x="3" y="5" width="7" height="14" rx="1.5"/><rect x="14" y="5" width="7" height="14" rx="1.5"/></g>',
  saved: '<g class="a-blink"><path d="M6 3h12v18l-6-4-6 4z"/></g>',
  method: '<g class="a-pulse"><path d="M5 4h11l3 3v13H5z"/><path d="M8 11h8M8 15h6"/></g>',
  account: '<g class="a-blink"><circle cx="12" cy="8" r="4"/><path d="M4 21c1-5 5-6 8-6s7 1 8 6"/></g>'
};
const PAGES = [
  ["workbench", "Workbench"], ["catalog", "Target Catalog"], ["vetting", "Candidate Vetting"], ["phase", "Phase-fold Lab"], ["periodogram", "Periodogram"],
  ["size", "Planet Size & Orbit"], ["validation", "Validation"], ["field", "Kepler Field"], ["compare", "Compare"], ["saved", "Saved Analyses"], ["method", "Method & Data"], ["account", "Account"]];
const LOGO = '<svg class="logo" viewBox="0 0 40 40" fill="none" stroke="#e6cf9f" stroke-width="1.8"><ellipse cx="20" cy="20" rx="17" ry="7" transform="rotate(-25 20 20)"/><circle cx="20" cy="20" r="5"/></svg>';

function nice(lo, hi, n = 5) {
  const span = hi - lo || 1, step0 = span / n, mag = Math.pow(10, Math.floor(Math.log10(step0))), r = step0 / mag;
  const step = (r < 1.5 ? 1 : r < 3 ? 2 : r < 7 ? 5 : 10) * mag, out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}
function plot(o) {
  const W = o.w || 800, H = o.h || 300, L = o.l ?? 52, R = o.r ?? 14, T = o.t ?? 10, B = o.b ?? 34;
  const xl = o.xlog, tx = v => xl ? Math.log10(v) : v;
  const [x0, x1] = o.x, [y0, y1] = o.y;
  const X = v => L + (tx(v) - tx(x0)) / (tx(x1) - tx(x0)) * (W - L - R), Y = v => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
  const id = o.id || 0;
  let s = `<svg class="plot" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.label || "chart")}">`;
  const yt = nice(y0, y1, 4), xt = xl ? [0.01, 0.1, 0.5, 1, 2, 5, 10, 20, 50, 100, 500, 1000, 10000].filter(v => v >= x0 && v <= x1) : nice(x0, x1, 6);
  for (const v of yt) s += `<line class="gridl" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${L - 7}" y="${Y(v) + 4}" text-anchor="end">${fmt(v, 2)}</text>`;
  for (const v of xt) s += `<line class="gridl" y1="${T}" y2="${H - B}" x1="${X(v)}" x2="${X(v)}"/><text x="${X(v)}" y="${H - B + 16}" text-anchor="middle">${fmt(v, 2)}</text>`;
  s += `<line class="ax" x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/><line class="ax" x1="${L}" x2="${L}" y1="${T}" y2="${H - B}"/>`;
  if (o.xlabel) s += `<text x="${(L + W - R) / 2}" y="${H - 4}" text-anchor="middle">${esc(o.xlabel)}</text>`;
  if (o.ylabel) s += `<text transform="translate(12 ${(T + H - B) / 2}) rotate(-90)" text-anchor="middle">${esc(o.ylabel)}</text>`;
  s += `<defs><clipPath id="c${id}"><rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}"/></clipPath><linearGradient id="bm${id}" x1="0" x2="1"><stop offset="0" stop-color="#e6cf9f" stop-opacity="0"/><stop offset=".6" stop-color="#8ec5ff" stop-opacity=".3"/><stop offset="1" stop-color="#e6cf9f" stop-opacity="0"/></linearGradient></defs><g clip-path="url(#c${id})">`;
  for (const b of o.bands || []) s += `<rect x="${X(b[0])}" width="${Math.max(2.5, X(b[1]) - X(b[0]))}" y="${T}" height="${H - T - B}" fill="${b[2] || "#8ec5ff"}" opacity=".28"/>`;
  for (const v of o.vlines || []) s += `<line x1="${X(v.x)}" x2="${X(v.x)}" y1="${T}" y2="${H - B}" stroke="${v.c}" stroke-width="1.2" stroke-dasharray="${v.dash || "4 3"}" opacity=".8"/>`;
  for (const sr of o.series) {
    if (sr.type === "points") {
      for (let i = 0; i < sr.x.length; i++) {
        if (sr.x[i] < x0 || sr.x[i] > x1) continue;
        s += `<circle cx="${X(sr.x[i]).toFixed(1)}" cy="${Y(sr.y[i]).toFixed(1)}" r="${sr.r || 2}" fill="${sr.c}" opacity="${sr.o ?? .8}">${sr.tip ? `<title>${esc(sr.tip[i])}</title>` : ""}</circle>`;
      }
    } else {
      let d = "", pen = false;
      for (let i = 0; i < sr.x.length; i++) {
        if (sr.gap && i && sr.x[i] - sr.x[i - 1] > sr.gap) pen = false;
        d += (pen ? "L" : "M") + X(sr.x[i]).toFixed(1) + " " + Y(Math.max(y0, Math.min(y1, sr.y[i]))).toFixed(1); pen = true;
      }
      s += `<path d="${d}" fill="none" stroke="${sr.c}" stroke-width="${sr.w || 1.5}" stroke-opacity="${sr.o ?? 1}" ${sr.draw ? 'class="line-draw" pathLength="1"' : ""} ${sr.glow ? 'style="filter:drop-shadow(0 0 5px ' + sr.c + '88)"' : ""} stroke-linejoin="round"/>`;
    }
  }
  if (o.beam) s += `<g style="overflow:hidden"><rect class="beam" x="${L - 90}" y="${T}" width="90" height="${H - T - B}" fill="url(#bm${id})"/></g>`;
  return s + "</g></svg>";
}
const range = (a, pad = .05) => { const lo = Math.min(...a), hi = Math.max(...a), p = (hi - lo || 1) * pad; return [lo - p, hi + p]; };
function fold(t, ppm, P, t0, nb, half) {
  const sums = new Float64Array(nb), cnt = new Int32Array(nb), px = [], py = [];
  for (let i = 0; i < t.length; i++) {
    let ph = ((t[i] - t0) / P + 0.5); ph = (ph - Math.floor(ph) - 0.5) * P;
    if (Math.abs(ph) > half) continue;
    px.push(ph); py.push(ppm[i]);
    const b = Math.min(nb - 1, Math.floor((ph + half) / (2 * half) * nb)); sums[b] += ppm[i]; cnt[b]++;
  }
  const bx = [], by = [];
  for (let b = 0; b < nb; b++) if (cnt[b] > 2) { bx.push(-half + (b + .5) * 2 * half / nb); by.push(sums[b] / cnt[b]); }
  return { px, py, bx, by };
}

async function stars() { const r = await api("/stars"); S.stars = r.stars; return r.stars; }
const starLabel = s => (s.name || ("KIC " + s.kepid)) + (s.owner ? " (mine)" : s.kind === "control" ? " (control)" : "");
async function getStar(sid) { return cached("s" + sid, () => api("/star/" + sid)); }
async function getCurve(sid) { return cached("c" + sid, () => api("/star/" + sid + "/curve")); }
async function ensureSid() {
  if (!S.stars.length) await stars();
  if (!S.sid || !S.stars.find(s => s.sid === S.sid)) S.sid = (S.stars.find(s => s.kepid === 11904151) || S.stars[0]).sid;
  return S.sid;
}
function starPicker(id, val) {
  const grp = k => S.stars.filter(k).map(s => `<option value="${s.sid}" ${s.sid === val ? "selected" : ""}>${esc(starLabel(s))} - KIC ${s.kepid}</option>`).join("");
  return `<select id="${id}" aria-label="Choose target"><optgroup label="Confirmed-planet hosts">${grp(s => s.kind === "host" && !s.owner)}</optgroup>
    <optgroup label="Control stars (no Kepler detections)">${grp(s => s.kind === "control" && !s.owner)}</optgroup>${S.stars.some(s => s.owner) ? `<optgroup label="My analyses">${grp(s => s.owner)}</optgroup>` : ""}</select>`;
}
function matchText(d, cat) {
  if (d.match === "exact") return `${d.matched_koi} (P=${fmt(d.true_period, 4)} d)`;
  if (d.match === "harmonic") return `Harmonic of ${d.matched_koi}`;
  return cat && cat.length ? "No confirmed planet at this period" : "Not in confirmed catalog";
}
const detBadge = d => d.passed ? '<span class="badge b-ok">Passes vetting</span>' : '<span class="badge b-bad">Rejected</span>';
const FLAG = { "snr_below_7.1": "SNR below 7.1", fewer_than_3_transits: "Fewer than 3 transits", odd_even_depth_mismatch: "Odd/even depths differ", secondary_eclipse: "Secondary eclipse (likely binary)" };
const pages = {};
function head(title, sub, extra = "") { return `<div class="top"><h1>${title}<small>${sub}</small></h1>${extra}</div>`; }
function stripHtml(s) {
  const d = s.detections.filter(x => x.passed).length;
  return `<div class="strip"><div><b>Target</b><span>${esc(s.name || "KIC " + s.kepid)}</span></div><div><b>Mission</b><span>Kepler, ${s.n_quarters} quarters</span></div>
  <div><b>Detector</b><span>BLS + vetting</span></div><div><b>Baseline</b><span>${fmt(s.baseline, 0)} days</span></div><div><b>Result</b><span>${d} candidate${d === 1 ? "" : "s"} passed</span></div></div>`;
}
pages.workbench = async el => {
  await ensureSid(); const s = await getStar(S.sid), c = await getCurve(S.sid);
  S.det = Math.min(S.det, Math.max(0, s.detections.length - 1)); const d = s.detections[S.det];
  const t = c.t, y = c.ppm, bands = [], bt = [], by6 = [];
  const srt = [...y].sort((p, q) => p - q), sig = (srt[Math.floor(srt.length * .84)] - srt[Math.floor(srt.length * .16)]) / 2;
  const want = d ? d.depth * 1e6 / 3 : 100; let binH = 6; while (binH < 48 && sig / Math.sqrt(binH) > want) binH *= 2;
  { const w = binH / 24; let i = 0; while (i < t.length) { let j = i, sum = 0; while (j < t.length && t[j] - t[i] < w) { sum += y[j]; j++; } bt.push((t[i] + t[j - 1]) / 2); by6.push(sum / (j - i)); i = j; } }
  if (d) for (let k = Math.ceil((t[0] - d.t0) / d.period); d.t0 + k * d.period <= t[t.length - 1]; k++) bands.push([d.t0 + k * d.period - d.duration / 2, d.t0 + k * d.period + d.duration / 2]);
  const bpad = (Math.max(...by6) - Math.min(...by6)) * .15 + 10, yr = [Math.min(...by6) - bpad, Math.max(...by6) + bpad];
  const f = d ? fold(t, y, d.period, d.t0, 70, Math.min(d.period / 2, Math.max(d.duration * 4, 0.3))) : null;
  const per = s.periodogram, half = f && f.bx.length ? f.bx[f.bx.length - 1] : 1;
  el.innerHTML = head("Transit Search Workbench", "Search NASA Kepler light curves for planets passing in front of their stars. Every number on this page was computed from real archive data.",
    `<span class="pill"><i class="dot"></i>Live pipeline results</span>`) + stripHtml(s) +
    `<div class="fields"><div><label for="pick">Target</label>${starPicker("pick", S.sid)}</div>
     <div class="fix"><label for="kic">Analyze any Kepler star</label><div style="display:flex;gap:8px"><input id="kic" inputmode="numeric" placeholder="KIC ID, e.g. 8462852" style="width:210px"><button class="btn sm" id="run">${S.user ? "Run live search" : "Sign in to run"}</button></div></div>
     <div class="fix"><button class="btn ghost sm" id="replay">Replay scan</button> <button class="btn ghost sm" id="watch">${s.watched ? "Watching" : "Watch target"}</button></div></div><div id="jobmsg" class="small muted" style="margin:-6px 0 10px"></div>
    <div class="grid"><div class="card"><h3><span>Flux vs time (detrended)</span><span>${s.detections.length ? "transits shaded" : ""}</span></h3>
      <div id="lc">${plot({ id: 1, x: [t[0], t[t.length - 1]], y: yr, xlabel: "Time (BKJD days)", ylabel: "ppm", label: "Detrended light curve", bands, beam: true,
        series: [{ type: "line", x: bt, y: by6, c: "#e6cf9f", w: 1.6, draw: true, glow: true, gap: 3 }] })}</div><div class="legend"><span><i style="background:#e6cf9f"></i>flux averaged in ${binH}-hour bins</span><span><i style="background:#8ec5ff;opacity:.4"></i>shaded: predicted transit windows</span></div></div>
     <div class="card"><h3><span>Candidate signal</span><span>${d ? "#" + d.rank : ""}</span></h3>
      <div class="tabs">${s.detections.map((x, i) => `<button class="tab ${i === S.det ? "on" : ""}" data-d="${i}">Signal ${x.rank}</button>`).join("")}</div>
      ${d ? `<div class="row"><span>Period</span><span>${fmt(d.period, 5)} d</span></div><div class="row"><span>Depth</span><span>${fmt(d.depth * 1e6, 0)} ppm</span></div>
      <div class="row"><span>Planet radius</span><span>${fmt(d.radius_earth, 2)} R&oplus;</span></div><div class="row"><span>Orbit a</span><span>${fmt(d.a_au, 4)} AU</span></div>
      <div class="row"><span>SNR</span><span>${fmt(d.snr, 1)}</span></div><div class="row"><span>Duration</span><span>${fmt(d.duration * 24, 1)} h</span></div>
      <div class="row"><span>Archive match</span><span style="font-size:13px">${esc(matchText(d, s.catalog_planets))}</span></div>
      <div style="margin-top:10px">${detBadge(d)} ${d.flags.map(fl => `<span class="badge b-mid">${esc(FLAG[fl] || fl)}</span>`).join(" ")}</div>` : '<div class="empty">No signals found.</div>'}
     </div></div>
    <div class="g3"><div class="card"><h3><span>Phase-folded</span><span>${d ? fmt(d.period, 4) + " d" : ""}</span></h3>${f && f.bx.length ? plot({ id: 2, h: 220, x: [-half, half], y: range(f.by.concat([0])), xlabel: "Days from mid-transit", ylabel: "ppm",
        series: [{ type: "points", x: f.px, y: f.py, c: "#8ec5ff", r: 1.3, o: .25 }, { type: "line", x: f.bx, y: f.by, c: "#f3dfb2", w: 2.2, glow: true }] }) : ""}</div>
     <div class="card"><h3><span>Periodogram (BLS)</span><span>log period</span></h3>${plot({ id: 3, h: 220, xlog: true, x: [Math.max(0.5, per[0][0]), per[0][per[0].length - 1]], y: [0, Math.max(...per[1]) * 1.1], xlabel: "Period (days)", ylabel: "BLS SNR",
        vlines: s.catalog_planets.map(p => ({ x: p.period, c: "#8ec5ff" })).concat(s.detections.filter(x => x.passed).map(x => ({ x: x.period, c: "#e6cf9f", dash: "2 2" }))),
        series: [{ type: "line", x: per[0], y: per[1], c: "#b8a6ff", w: 1.4 }] })}<div class="legend"><span><i style="background:#e6cf9f"></i>detected</span><span><i style="background:#8ec5ff"></i>NASA archive</span></div></div>
     <div class="card"><h3><span>Check vs NASA archive</span></h3>${s.catalog_planets.length ? s.catalog_planets.map(p => {
        const hit = s.detections.find(x => x.passed && x.matched_koi === p.kepoi_name && x.match === "exact");
        return `<div class="row"><span>${esc(p.kepler_name || p.kepoi_name)}</span><span style="font-size:13px">${fmt(p.period, 4)} d ${hit ? '<span class="badge b-ok">recovered</span>' : '<span class="badge b-bad">missed</span>'}</span></div>`; }).join("")
        : '<div class="empty">No confirmed planets listed for this star. A detection here would be unvetted.</div>'}</div></div>
    ${S.user ? `<div class="card"><h3><span>Notes on this target</span></h3><div class="fields"><div><textarea id="nbody" rows="2" maxlength="2000" placeholder="Add a note"></textarea></div><div class="fix"><button class="btn sm" id="nsave">Save note</button></div></div><div id="nlist"></div></div>` : ""}`;
  $("#pick").onchange = e => { S.sid = +e.target.value; S.det = 0; render("workbench", { quick: true }); };
  $$(".tab", el).forEach(b => b.onclick = () => { S.det = +b.dataset.d; render("workbench", { quick: true }); });
  $("#replay").onclick = () => { const p = $(".line-draw", el); p.classList.remove("go"); void p.getBoundingClientRect(); p.classList.add("go"); };
  if (!reduce.matches) $(".line-draw", el).classList.add("go");
  $("#watch").onclick = async () => { try { const r = await api("/watch/" + s.kepid, { method: "POST" }); $("#watch").textContent = r.watched ? "Watching" : "Watch target"; delete S.cache["s" + S.sid]; toast(r.watched ? "Added to watchlist" : "Removed from watchlist"); } catch (e) { toast(e.message); } };
  $("#run").onclick = async () => {
    if (!S.user) return go("account");
    const kic = +$("#kic").value; if (!kic) return toast("Enter a KIC ID first.");
    $("#run").disabled = true;
    try { const j = await api("/analyze", { method: "POST", body: { kepid: kic } }); await pollJob(j.job, $("#jobmsg")); } catch (e) { $("#jobmsg").textContent = e.message; }
    $("#run").disabled = false;
  };
  if (S.user) {
    const loadNotes = async () => { const r = await api("/star/" + S.sid + "/notes"); $("#nlist").innerHTML = r.notes.map(n => `<div class="row"><span style="color:var(--tx);font:15px 'Inter Tight'">${esc(n.body)}</span><span class="small muted">${esc(n.created.slice(0, 16))}</span></div>`).join(""); };
    loadNotes(); $("#nsave").onclick = async () => { try { await api("/star/" + S.sid + "/note", { method: "POST", body: { body: $("#nbody").value } }); $("#nbody").value = ""; loadNotes(); toast("Note saved"); } catch (e) { toast(e.message); } };
  }
};
async function pollJob(job, box) {
  box.innerHTML = '<span class="spin"></span>Starting analysis (about a minute)';
  for (;;) {
    await new Promise(r => setTimeout(r, 2000)); const j = await api("/jobs/" + job);
    if (j.status === "error") { box.textContent = j.message; return; }
    if (j.status === "done") { await stars(); S.sid = j.sid; S.det = 0; toast("Analysis complete"); render("workbench", { quick: true }); return; }
    box.innerHTML = '<span class="spin"></span>' + esc(j.message);
  }
}

pages.catalog = async el => {
  const st = pages.catalog.st ||= { q: "", rmin: "", rmax: "", pmin: "", pmax: "", sort: "kepid", dir: "asc", page: 0, analyzed: "" };
  el.innerHTML = head("Target Catalog", "Every confirmed Kepler planet in the NASA Exoplanet Archive. Stars marked Analyzed already have a full transit search in Perihelion.") +
    `<div class="card"><div class="fields"><div><label for="q">Search</label><input id="q" placeholder="Kepler-10, K00072, KIC" value="${esc(st.q)}"></div>
    <div><label>Radius (R&oplus;)</label><div style="display:flex;gap:6px"><input id="rmin" placeholder="min" value="${esc(st.rmin)}"><input id="rmax" placeholder="max" value="${esc(st.rmax)}"></div></div>
    <div><label>Period (days)</label><div style="display:flex;gap:6px"><input id="pmin" placeholder="min" value="${esc(st.pmin)}"><input id="pmax" placeholder="max" value="${esc(st.pmax)}"></div></div>
    <div class="fix"><label>&nbsp;</label><label style="display:flex;gap:6px;align-items:center;color:var(--tx)"><input type="checkbox" id="an" style="width:auto" ${st.analyzed ? "checked" : ""}>Analyzed only</label></div>
    <div class="fix"><button class="btn sm" id="go2">Apply</button></div></div><div class="tw" id="tbl"><div class="empty"><span class="spin"></span>Loading</div></div><div id="pg" style="display:flex;justify-content:space-between;margin-top:12px;align-items:center"></div></div>`;
  const load = async () => {
    const qs = new URLSearchParams({ q: st.q, rmin: st.rmin, rmax: st.rmax, pmin: st.pmin, pmax: st.pmax, sort: st.sort, dir: st.dir, page: st.page, analyzed: st.analyzed });
    const r = await api("/catalog?" + qs); const th = (k, l, n) => `<th class="${n ? "n" : ""}" data-s="${k}" style="cursor:pointer">${l}${st.sort === k ? (st.dir === "asc" ? " ▲" : " ▼") : ""}</th>`;
    $("#tbl").innerHTML = `<table><thead><tr>${th("name", "Planet")}<th>Star</th>${th("period", "Period d", 1)}${th("radius", "Radius R⊕", 1)}<th class="n">a AU</th><th class="n">Teq K</th>${th("snr", "Model SNR", 1)}<th></th></tr></thead><tbody>` +
      (r.rows.length ? r.rows.map(x => `<tr class="${x.sid ? "click" : ""}" data-sid="${x.sid || ""}"><td>${esc(x.kepler_name || x.kepoi_name)}</td><td class="muted">KIC ${x.kepid}</td><td class="n">${fmt(x.period, 4)}</td><td class="n">${fmt(x.radius_earth, 2)}</td><td class="n">${fmt(x.a_au, 4)}</td><td class="n">${fmt(x.teq_k, 0)}</td><td class="n">${fmt(x.model_snr, 0)}</td>
        <td>${x.sid ? '<span class="badge b-ok">Analyzed</span>' : `<button class="btn ghost sm lv" data-k="${x.kepid}">Analyze live</button>`}</td></tr>`).join("") : '<tr><td colspan="8" class="empty">No planets match these filters.</td></tr>') + "</tbody></table>";
    $("#pg").innerHTML = `<span class="small muted">${r.total} planets, page ${r.page + 1} of ${Math.max(1, Math.ceil(r.total / r.page_size))}</span><span><button class="btn ghost sm" id="pv" ${r.page ? "" : "disabled"}>Previous</button> <button class="btn ghost sm" id="nx" ${(r.page + 1) * r.page_size < r.total ? "" : "disabled"}>Next</button></span>`;
    $("#pv").onclick = () => { st.page--; load(); }; $("#nx").onclick = () => { st.page++; load(); };
    $$("th[data-s]", el).forEach(h => h.onclick = () => { st.dir = st.sort === h.dataset.s && st.dir === "asc" ? "desc" : "asc"; st.sort = h.dataset.s; st.page = 0; load(); });
    $$("tr.click", el).forEach(tr => tr.onclick = ev => { S.sid = +tr.dataset.sid; S.det = 0; go("workbench", ev); });
    $$(".lv", el).forEach(b => b.onclick = async ev => { ev.stopPropagation(); if (!S.user) return go("account", ev);
      b.disabled = true; try { const j = await api("/analyze", { method: "POST", body: { kepid: +b.dataset.k } }); toast("Analysis started, about a minute"); S.pendingJob = j.job; go("workbench", ev); } catch (e) { toast(e.message); b.disabled = false; } });
  };
  const apply = () => { Object.assign(st, { q: $("#q").value, rmin: $("#rmin").value, rmax: $("#rmax").value, pmin: $("#pmin").value, pmax: $("#pmax").value, analyzed: $("#an").checked ? "1" : "", page: 0 }); load().catch(e => toast(e.message)); };
  $("#go2").onclick = apply; $("#q").onkeydown = e => e.key === "Enter" && apply(); await load();
};

pages.vetting = async el => {
  await ensureSid(); const s = await getStar(S.sid), v = await cached("val", () => api("/validation"));
  const ok = b => b ? '<span style="color:var(--ok)">✓</span>' : '<span style="color:var(--bad)">✕</span>';
  const rows = s.detections.map(d => `<tr><td>#${d.rank}</td><td class="n">${fmt(d.period, 4)}</td><td class="n">${fmt(d.snr, 1)}</td><td>${ok(d.snr >= 7.1)}</td><td class="n">${d.n_transits}</td><td>${ok(d.n_transits >= 3)}</td>
    <td class="n">${fmt(d.odd_even_sigma, 1)}σ</td><td>${ok(d.odd_even_sigma <= 4)}</td><td class="n">${fmt(d.secondary_snr, 1)}</td><td>${ok(!(d.secondary_snr > 4 && (d.depth_secondary || 0) > .3 * d.depth))}</td><td>${detBadge(d)}</td></tr>`).join("");
  const fl = Object.entries(v.vetting_flags).sort((a, b) => b[1] - a[1]), mx = Math.max(1, ...fl.map(x => x[1]));
  el.innerHTML = head("Candidate Vetting", "Each detected signal is tested for the usual false-positive signatures before it counts as a candidate.") +
    `<div class="fields"><div><label for="pick">Target</label>${starPicker("pick", S.sid)}</div></div>` + stripHtml(s) +
    `<div class="card" style="margin-bottom:16px"><h3><span>Tests for ${esc(s.name || "KIC " + s.kepid)}</span></h3><div class="tw"><table><thead><tr><th>Signal</th><th class="n">Period d</th><th class="n">SNR</th><th>≥7.1</th><th class="n">Transits</th><th>≥3</th><th class="n">Odd/even</th><th>≤4σ</th><th class="n">Secondary SNR</th><th>No eclipse</th><th>Verdict</th></tr></thead><tbody>${rows}</tbody></table></div></div>
    <div class="g2"><div class="card"><h3><span>Odd vs even transit depth</span><span>ppm</span></h3>${s.detections.map(d => `<div class="row"><span>Signal ${d.rank}</span><span style="font-size:14px">odd ${fmt((d.depth_odd || 0) * 1e6, 0)} | even ${fmt((d.depth_even || 0) * 1e6, 0)}</span></div>`).join("")}<p class="small muted" style="margin-top:10px">Two eclipsing stars of different brightness alternate deep and shallow dips. A planet makes equal dips.</p></div>
    <div class="card"><h3><span>Why signals were rejected (shared sample)</span></h3>${fl.map(([k, n]) => `<div style="margin-bottom:12px"><div class="row" style="border:0;padding:0 0 4px"><span style="color:var(--tx)">${esc(FLAG[k] || k)}</span><span>${n}</span></div><div class="bar"><i style="width:${n / mx * 100}%"></i></div></div>`).join("") || '<div class="empty">No rejections yet.</div>'}</div></div>`;
  $("#pick").onchange = e => { S.sid = +e.target.value; render("vetting", { quick: true }); };
};

pages.phase = async el => {
  await ensureSid(); const s = await getStar(S.sid), c = await getCurve(S.sid), d0 = s.detections[0];
  if (!d0) { el.innerHTML = head("Phase-fold Lab", "") + '<div class="card"><div class="empty">This star has no detections to fold on.</div></div>'; return; }
  let st = pages.phase.st; if (!st || pages.phase.sid !== S.sid) st = pages.phase.st = { P: d0.period, t0: d0.t0, bins: 70, win: Math.min(d0.period / 2, Math.max(d0.duration * 4, 0.3)) };
  pages.phase.sid = S.sid;
  el.innerHTML = head("Phase-fold Lab", "Fold the real light curve on any period and watch a transit appear or dissolve. Snap to a detection or to a confirmed planet.") +
    `<div class="fields"><div><label for="pick">Target</label>${starPicker("pick", S.sid)}</div><div class="fix"><label>Snap to</label><div id="snaps" style="display:flex;gap:6px;flex-wrap:wrap"></div></div></div>
    <div class="grid"><div class="card"><h3><span>Folded light curve</span><span id="info"></span></h3><div id="fp"></div></div>
    <div class="card"><h3><span>Controls</span></h3>
    <label for="P">Period: <b id="Pv"></b> d</label><input type="range" id="P" min="0" max="1000" style="padding:0;margin-bottom:6px"><input type="number" id="Pn" step="0.0001" style="margin-bottom:14px">
    <label for="T">Epoch shift: <b id="Tv"></b> d</label><input type="range" id="T" min="-50" max="50" style="padding:0;margin-bottom:14px">
    <label for="B">Bins: <b id="Bv"></b></label><input type="range" id="B" min="20" max="140" style="padding:0">
    <p class="small muted" style="margin-top:14px">Depth below is the folded dip at the center, measured in your browser from the same data the detector used.</p><div class="row"><span>Folded depth</span><span id="dp">-</span></div></div></div>`;
  $("#pick").onchange = e => { S.sid = +e.target.value; pages.phase.st = null; render("phase", { quick: true }); };
  const L0 = Math.log10(0.5), L1 = Math.log10(120);
  const toSlider = P => Math.round((Math.log10(P) - L0) / (L1 - L0) * 1000), fromSlider = v => Math.pow(10, L0 + v / 1000 * (L1 - L0));
  const draw = () => {
    const sh = +$("#T").value / 50 * st.P / 4, f = fold(c.t, c.ppm, st.P, st.t0 + sh, st.bins, st.win);
    $("#Pv").textContent = st.P.toFixed(4); $("#Bv").textContent = st.bins; $("#Tv").textContent = sh.toFixed(3); $("#info").textContent = "P = " + st.P.toFixed(4) + " d";
    if (!f.bx.length) { $("#fp").innerHTML = '<div class="empty">No data in this window.</div>'; return; }
    const ctr = f.by.filter((_, i) => Math.abs(f.bx[i]) < st.win / 6);
    $("#dp").textContent = ctr.length ? fmt(-Math.min(...ctr), 0) + " ppm" : "-";
    $("#fp").innerHTML = plot({ id: 5, x: [-st.win, st.win], y: range(f.by.concat([0]), .3), xlabel: "Days from mid-transit", ylabel: "ppm",
      series: [{ type: "points", x: f.px, y: f.py, c: "#8ec5ff", r: 1.3, o: .22 }, { type: "line", x: f.bx, y: f.by, c: "#f3dfb2", w: 2.4, glow: true }] });
  };
  const set = (P, t0, win) => { st.P = P; st.t0 = t0; if (win) st.win = win; $("#P").value = toSlider(P); $("#Pn").value = P.toFixed(4); $("#T").value = 0; draw(); };
  const sn = [...s.detections.map(d => ({ l: "Signal " + d.rank, P: d.period, t0: d.t0, w: Math.min(d.period / 2, Math.max(d.duration * 4, .3)) })),
    ...s.catalog_planets.filter(p => p.t0 != null).map(p => ({ l: p.kepler_name || p.kepoi_name, P: p.period, t0: p.t0, w: Math.min(p.period / 2, Math.max(p.duration_h / 24 * 4, .3)) }))];
  $("#snaps").innerHTML = sn.map((x, i) => `<button class="tab" data-i="${i}">${esc(x.l)}</button>`).join("");
  $$("#snaps .tab", el).forEach(b => b.onclick = () => { const x = sn[+b.dataset.i]; set(x.P, x.t0, x.w); });
  $("#P").oninput = e => { st.P = fromSlider(+e.target.value); $("#Pn").value = st.P.toFixed(4); draw(); };
  $("#Pn").onchange = e => { const v = +e.target.value; if (v > 0.3 && v < 400) { st.P = v; $("#P").value = toSlider(v); draw(); } };
  $("#T").oninput = draw; $("#B").value = st.bins; $("#B").oninput = e => { st.bins = +e.target.value; draw(); };
  $("#P").value = toSlider(st.P); $("#Pn").value = st.P.toFixed(4); draw();
};
pages.periodogram = async el => {
  await ensureSid(); const s = await getStar(S.sid), per = s.periodogram, mk = Math.max(...per[1]);
  el.innerHTML = head("Periodogram", "The Box Least Squares spectrum for the strongest signal. Peaks at multiples of the true period are aliases, and the vetting step handles them.") +
    `<div class="fields"><div><label for="pick">Target</label>${starPicker("pick", S.sid)}</div></div>` + stripHtml(s) +
    `<div class="card" style="margin-bottom:16px"><h3><span>BLS SNR vs trial period</span><span>${per[0].length} bins, strongest peak kept per bin</span></h3>${plot({ id: 6, h: 380, xlog: true, x: [Math.max(0.5, per[0][0]), per[0][per[0].length - 1]], y: [0, mk * 1.1], xlabel: "Period (days, log scale)", ylabel: "BLS SNR",
      vlines: s.catalog_planets.map(p => ({ x: p.period, c: "#8ec5ff" })).concat(s.detections.map(x => ({ x: x.period, c: x.passed ? "#e6cf9f" : "#ff8f8f", dash: "2 2" }))), series: [{ type: "line", x: per[0], y: per[1], c: "#b8a6ff", w: 1.5, glow: true }] })}
      <div class="legend"><span><i style="background:#e6cf9f"></i>passed vetting</span><span><i style="background:#ff8f8f"></i>rejected</span><span><i style="background:#8ec5ff"></i>NASA archive period</span></div></div>
    <div class="card"><h3><span>Strongest peaks</span></h3><div class="tw"><table><thead><tr><th>Rank</th><th class="n">Period d</th><th class="n">Ratio to signal 1</th><th>Relation</th></tr></thead><tbody>${s.detections.map(d => { const r = d.period / s.detections[0].period, near = [[.5, "about half"], [2, "about double"], [3, "about triple"], [1, "same"]].find(x => Math.abs(r / x[0] - 1) < .02);
      return `<tr><td>#${d.rank}</td><td class="n">${fmt(d.period, 4)}</td><td class="n">${fmt(r, 3)}</td><td>${near ? near[1] + " (possible alias)" : "independent"}</td></tr>`; }).join("")}</tbody></table></div></div>`;
  $("#pick").onchange = e => { S.sid = +e.target.value; render("periodogram", { quick: true }); };
};

pages.size = async el => {
  const r = await cached("so", () => api("/size_orbit")), mode = pages.size.mode || "pr", det = r.detected, cat = r.catalog;
  const gx = o => mode === "pr" ? o.period : (o.insolation ?? o.insol), xs = mode === "pr" ? "Period (days)" : "Insolation (Earth = 1)";
  const cx = cat.filter(o => gx(o) > 0), dx = det.filter(o => gx(o) > 0), hab = det.filter(o => o.insolation > .25 && o.insolation < 1.8 && o.radius_earth < 2.5);
  el.innerHTML = head("Planet Size & Orbit", "Radius comes from transit depth and the catalog stellar radius. Orbit comes from the period and stellar mass via Kepler's third law.") +
    `<div class="tabs"><button class="tab ${mode === "pr" ? "on" : ""}" data-m="pr">Radius vs period</button><button class="tab ${mode === "ir" ? "on" : ""}" data-m="ir">Radius vs insolation</button></div>
    <div class="grid"><div class="card"><h3><span>${det.length} detected planets over ${cat.length} confirmed</span></h3>${plot({ id: 7, h: 400, xlog: true, x: mode === "pr" ? [0.5, 500] : [0.01, 10000], y: [0, 24], xlabel: xs, ylabel: "Radius (R⊕)",
      vlines: mode === "ir" ? [{ x: .25, c: "#8fd9b0" }, { x: 1.8, c: "#8fd9b0" }] : [],
      series: [{ type: "points", x: cx.map(gx), y: cx.map(o => o.radius_earth), c: "#8c96a8", r: 2, o: .35, tip: cx.map(o => o.kepoi_name + " " + fmt(o.radius_earth, 2) + " R⊕") },
        { type: "points", x: dx.map(gx), y: dx.map(o => o.radius_earth), c: "#e6cf9f", r: 4, o: .9, tip: dx.map(o => (o.name || "KIC " + o.kepid) + ": " + fmt(o.radius_earth, 2) + " R⊕, P " + fmt(o.period, 3) + " d") }] })}
      <div class="legend"><span><i style="background:#8c96a8"></i>NASA archive (confirmed)</span><span><i style="background:#e6cf9f"></i>Perihelion detections that passed vetting</span>${mode === "ir" ? '<span><i style="background:#8fd9b0"></i>rough habitable-zone band</span>' : ""}</div></div>
    <div class="card"><h3><span>Habitable-zone check</span></h3><div class="big">${hab.length}</div><div class="cap">detected planets under 2.5 R⊕ with 0.25-1.8× Earth's insolation</div>
      <div style="margin-top:12px">${hab.length ? hab.map(o => `<div class="row"><span>${esc(o.name || "KIC " + o.kepid)}</span><span style="font-size:13px">${fmt(o.radius_earth, 1)} R⊕, S=${fmt(o.insolation, 2)}</span></div>`).join("") : '<p class="small muted">None in this sample. Short-period planets dominate what a transit search finds first.</p>'}</div>
      <p class="small muted" style="margin-top:12px">Insolation uses the catalog star's radius and temperature. It ignores atmosphere and eccentricity, so it is a screening number, not a habitability verdict.</p></div></div>`;
  $$(".tab", el).forEach(b => b.onclick = () => { pages.size.mode = b.dataset.m; render("size", { quick: true }); });
};

pages.validation = async el => {
  const v = await cached("val", () => api("/validation")), h = v.headline, pairs = v.radius_pairs;
  const bars = (arr, t) => `<div class="card"><h3><span>${t}</span></h3>${arr.map(b => `<div style="margin-bottom:12px"><div class="row" style="border:0;padding:0 0 4px"><span style="color:var(--tx)">${esc(b.label)} <span class="muted small">(n=${b.n})</span></span><span>${b.recall == null ? "-" : pct(b.recall)}</span></div><div class="bar"><i style="width:${(b.recall || 0) * 100}%"></i></div></div>`).join("")}</div>`;
  el.innerHTML = head("Validation against the NASA archive", `Perihelion searched ${h.host_stars} stars with confirmed planets and ${h.control_stars} control stars that the Kepler pipeline never flagged. Results are measured, not tuned for display.`,
    `<span class="pill"><i class="dot"></i>Computed by pipeline/build_db.py</span>`) +
    `<div class="g4"><div class="card"><div class="big">${pct(h.recall)}</div><div class="cap">of ${h.known_planets} known planets recovered (${h.recovered}). 95% CI ${ci(h.recall_ci95)}</div></div>
    <div class="card"><div class="big">${pct(h.control_false_alarm_rate)}</div><div class="cap">of ${h.control_stars} control stars produced a candidate that passed vetting. 95% CI ${ci(h.control_false_alarm_ci95)}</div></div>
    <div class="card"><div class="big">${fmt(h.median_period_error * 100, 3)}%</div><div class="cap">median period error on recovered planets</div></div>
    <div class="card"><div class="big">${fmt(h.median_abs_radius_error * 100, 0)}%</div><div class="cap">median radius error vs archive; ${pct(h.within_30pct_radius)} within 30%. Median ratio ${fmt(h.median_radius_ratio, 2)}</div></div></div>
    <div class="g3">${bars(v.by_radius, "Recall by planet size")}${bars(v.by_period, "Recall by orbital period")}${bars(v.by_snr, "Recall by archive signal strength")}</div>
    <div class="g2"><div class="card"><h3><span>Detection threshold sweep</span></h3><div class="tw"><table><thead><tr><th class="n">Min SNR</th><th class="n">Recall</th><th class="n">False alarms on controls</th></tr></thead><tbody>${v.sweep.map(x => `<tr><td class="n">${x.snr}</td><td class="n">${pct(x.recall)}</td><td class="n">${pct(x.false_alarm_rate)}</td></tr>`).join("")}</tbody></table></div><p class="small muted" style="margin-top:8px">Vetting rules apply at every threshold. The shipped threshold is 7.1, Kepler's own.</p></div>
    <div class="card"><h3><span>Radius: Perihelion vs archive</span><span>${pairs.length} planets</span></h3>${plot({ id: 8, h: 300, x: [0, 20], y: [0, 20], xlabel: "Archive radius (R⊕)", ylabel: "Perihelion radius (R⊕)",
      series: [{ type: "line", x: [0, 20], y: [0, 20], c: "#8c96a8", w: 1 }, { type: "points", x: pairs.map(p => p.true), y: pairs.map(p => p.det), c: "#e6cf9f", r: 3.5, o: .8, tip: pairs.map(p => p.kepoi + ": " + fmt(p.det, 2) + " vs " + fmt(p.true, 2)) }] })}
      <p class="small muted">Grey line is perfect agreement. Perihelion ignores limb darkening and impact parameter, so grazing transits read small.</p></div></div>
    <div class="card"><h3><span>Passed detections on host stars</span></h3><div class="row"><span>Match a confirmed planet exactly</span><span>${h.exact}</span></div><div class="row"><span>Harmonic of a confirmed planet</span><span>${h.harmonic}</span></div><div class="row"><span>No confirmed counterpart</span><span>${h.unmatched}</span></div>
      <p class="small muted" style="margin-top:10px">Unmatched signals can be unconfirmed Kepler candidates, planets listed under another period, or false alarms. They are not called discoveries.</p></div>
    <div class="card" style="margin-top:16px"><h3><span>Known planets that were missed</span><span>${v.missed.length}</span></h3><div class="tw" style="max-height:340px;overflow:auto"><table><thead><tr><th>KOI</th><th class="n">Period d</th><th class="n">Radius R⊕</th><th class="n">Archive SNR</th><th>Reason</th></tr></thead><tbody>${v.missed.map(m => `<tr><td>${esc(m.kepoi)}</td><td class="n">${fmt(m.period, 3)}</td><td class="n">${fmt(m.radius, 2)}</td><td class="n">${fmt(m.snr, 0)}</td><td>${m.search_hit ? "Found by search, rejected by vetting" : "Not among the signals found"}</td></tr>`).join("")}</tbody></table></div></div>`;
};

pages.field = async el => {
  const r = await cached("field", () => api("/field")), ra = r.catalog.map(o => o.ra), de = r.catalog.map(o => o.dec);
  const sub = k => r.sample.filter(o => o.kind === k);
  el.innerHTML = head("Kepler Field", "Where the stars sit on the sky. Kepler stared at one patch of Cygnus and Lyra for four years.") +
    `<div class="card"><h3><span>${r.catalog.length} confirmed planets, ${r.sample.length} analyzed stars</span></h3>${plot({ id: 9, h: 480, x: [Math.min(...ra) - .5, Math.max(...ra) + .5], y: [Math.min(...de) - .5, Math.max(...de) + .5], xlabel: "Right ascension (deg)", ylabel: "Declination (deg)",
      series: [{ type: "points", x: ra, y: de, c: "#8ec5ff", r: 2, o: .45, tip: r.catalog.map(o => o.kepoi_name + " P=" + fmt(o.period, 2) + " d") },
        { type: "points", x: sub("control").map(o => o.ra), y: sub("control").map(o => o.dec), c: "#b8a6ff", r: 3.5, o: .85, tip: sub("control").map(o => "KIC " + o.kepid + " (control)") },
        { type: "points", x: sub("host").map(o => o.ra), y: sub("host").map(o => o.dec), c: "#e6cf9f", r: 4, o: .95, tip: sub("host").map(o => (o.name || "KIC " + o.kepid) + " (analyzed host)") }] })}
      <div class="legend"><span><i style="background:#8ec5ff"></i>confirmed planet host</span><span><i style="background:#e6cf9f"></i>analyzed host</span><span><i style="background:#b8a6ff"></i>control star</span></div>
      <p class="small muted" style="margin-top:10px">Hover a point for its name. The gaps are the camera's detector chip gaps.</p></div>`;
};

pages.compare = async el => {
  await ensureSid(); if (!S.sid2 || !S.stars.find(s => s.sid === S.sid2)) S.sid2 = (S.stars.find(s => s.sid !== S.sid && s.kind === "host") || S.stars[1]).sid;
  const [a, b] = await Promise.all([getStar(S.sid), getStar(S.sid2)]), [ca, cb] = await Promise.all([getCurve(S.sid), getCurve(S.sid2)]);
  const col = (s, c, id, color) => { const d = s.detections[0]; if (!d) return `<div class="card"><div class="empty">No signals for ${esc(s.name || "KIC " + s.kepid)}</div></div>`;
    const half = Math.min(d.period / 2, Math.max(d.duration * 4, .3)), f = fold(c.t, c.ppm, d.period, d.t0, 60, half);
    return `<div class="card"><h3><span>${esc(s.name || "KIC " + s.kepid)}</span><span>${detBadge(d)}</span></h3>${plot({ id, h: 230, x: [-half, half], y: range(f.by.concat([0])), xlabel: "Days from mid-transit", ylabel: "ppm", series: [{ type: "points", x: f.px, y: f.py, c: "#8ec5ff", r: 1.2, o: .2 }, { type: "line", x: f.bx, y: f.by, c: color, w: 2.2, glow: true }] })}
      <div class="row"><span>Period</span><span>${fmt(d.period, 4)} d</span></div><div class="row"><span>Radius</span><span>${fmt(d.radius_earth, 2)} R⊕</span></div><div class="row"><span>Orbit</span><span>${fmt(d.a_au, 4)} AU</span></div><div class="row"><span>Equilibrium temp</span><span>${fmt(d.teq_k, 0)} K</span></div><div class="row"><span>SNR</span><span>${fmt(d.snr, 1)}</span></div><div class="row"><span>Star</span><span style="font-size:13px">${fmt(s.srad, 2)} R☉, ${fmt(s.teff, 0)} K, Kp ${fmt(s.kepmag, 1)}</span></div></div>`; };
  el.innerHTML = head("Compare", "Two targets side by side, each folded on its strongest signal.") +
    `<div class="fields"><div><label for="pa">Target A</label>${starPicker("pa", S.sid)}</div><div><label for="pb">Target B</label>${starPicker("pb", S.sid2)}</div></div><div class="g2">${col(a, ca, 10, "#f3dfb2")}${col(b, cb, 11, "#b8a6ff")}</div>`;
  $("#pa").onchange = e => { S.sid = +e.target.value; render("compare", { quick: true }); }; $("#pb").onchange = e => { S.sid2 = +e.target.value; render("compare", { quick: true }); };
};

pages.saved = async el => {
  if (!S.user) return needLogin(el, "Saved Analyses");
  const r = await api("/saved");
  el.innerHTML = head("Saved Analyses", "Live searches you ran, your notes and your watchlist. Only you can see them.") +
    `<div class="g2"><div class="card"><h3><span>My live analyses</span><span>${r.runs.length}</span></h3>${r.runs.length ? `<table><tbody>${r.runs.map(x => `<tr><td>KIC ${x.kepid}</td><td class="muted small">${esc(x.created.slice(0, 16))}</td><td>${x.n_pass} passed</td><td style="text-align:right"><button class="btn ghost sm op" data-s="${x.sid}">Open</button> <button class="btn danger sm dl" data-s="${x.sid}">Delete</button></td></tr>`).join("")}</tbody></table>` : '<div class="empty">No live analyses yet. Enter a KIC ID on the Workbench.</div>'}</div>
    <div class="card"><h3><span>Watchlist</span><span>${r.watch.length}</span></h3>${r.watch.length ? r.watch.map(w => `<div class="row"><span style="color:var(--tx);font:15px 'Inter Tight'">${esc(w.koi || "KIC " + w.kepid)} <span class="muted small">KIC ${w.kepid}</span></span><span>${w.sid ? `<button class="btn ghost sm op" data-s="${w.sid}">Open</button>` : '<span class="small muted">not analyzed</span>'}</span></div>`).join("") : '<div class="empty">Use "Watch target" on the Workbench.</div>'}</div></div>
    <div class="card"><h3><span>Notes</span><span>${r.notes.length}</span></h3>${r.notes.length ? r.notes.map(n => `<div class="row"><span style="color:var(--tx);font:15px 'Inter Tight'">${esc(n.body)} <span class="muted small">KIC ${n.kepid}</span></span><span><button class="btn danger sm dn" data-n="${n.id}">Delete</button></span></div>`).join("") : '<div class="empty">No notes yet.</div>'}</div>`;
  $$(".op", el).forEach(b => b.onclick = ev => { S.sid = +b.dataset.s; S.det = 0; go("workbench", ev); });
  $$(".dl", el).forEach(b => b.onclick = async () => { if (!confirm("Delete this analysis and its notes?")) return; await api("/run/" + b.dataset.s, { method: "DELETE" }); await stars(); delete S.cache["s" + b.dataset.s]; if (S.sid === +b.dataset.s) S.sid = null; render("saved", { quick: true }); });
  $$(".dn", el).forEach(b => b.onclick = async () => { await api("/note/" + b.dataset.n, { method: "DELETE" }); render("saved", { quick: true }); });
};

pages.method = async el => {
  const o = await api("/overview"), h = o.headline;
  el.innerHTML = head("Method & Data", "How Perihelion turns raw Kepler photometry into planet candidates, and where every number comes from.") +
    `<div class="g2"><div class="card prose"><h3><span>Pipeline</span></h3><ol style="list-style:decimal"><li><b>Download.</b> Long-cadence PDCSAP light curves (29.4-minute cadence) from the MAST Kepler archive, first 8 quarters per star, quality flag 0 only.</li>
    <li><b>Detrend.</b> Each quarter is normalised and a 1.5-day running median is divided out, split at data gaps. Upward outliers above 4σ are clipped. Dips are never clipped.</li>
    <li><b>Search.</b> Astropy's Box Least Squares over a frequency-uniform period grid from 0.6 days to the longest period with at least 2.5 cycles. Durations from 1 to 12 hours.</li>
    <li><b>Iterate.</b> The strongest signal is masked and the search repeats, up to 3 signals per star.</li>
    <li><b>Vet.</b> A signal needs SNR of 7.1 or more (Kepler's threshold), at least 3 transits, odd and even depths within 4σ, and no secondary eclipse deeper than 30% of the primary.</li>
    <li><b>Measure.</b> Radius = √depth × stellar radius. Orbit from Kepler's third law and stellar mass. Equilibrium temperature with albedo 0.3.</li></ol>
    <h3><span>Known limits</span></h3><ul><li>Depth-based radius ignores limb darkening and impact parameter, so it reads small for grazing transits.</li><li>The vetting rules catch eclipsing binaries but cannot rule out background blends. Detections are candidates, not confirmed planets.</li><li>Long-period planets with fewer than three transits in 8 quarters are rejected by design.</li><li>The validation sample is stratified by planet size, not a random draw of Kepler stars, so recall describes this sample only.</li></ul></div>
    <div class="card prose"><h3><span>Data provenance</span></h3><div class="row"><span>Confirmed planets (archive)</span><span>${o.catalog_total}</span></div><div class="row"><span>Stars analyzed</span><span>${o.stars.length}</span></div><div class="row"><span>Host stars / controls</span><span>${h.host_stars} / ${h.control_stars}</span></div>
    <p style="margin-top:14px">Planet catalog and stellar parameters: NASA Exoplanet Archive TAP service, tables <code>cumulative</code> (KOI) and <code>Q1_Q17_DR25_KS</code> (stellar properties).</p>
    <p>Photometry: Kepler long-cadence light curves from the Mikulski Archive for Space Telescopes (MAST) at <code>archive.stsci.edu/missions/kepler/lightcurves</code>.</p>
    <p>Control stars: Kepler stars with no KOI and no threshold-crossing event in the DR25 pipeline, Kp 11-14, solar-like. They may still host planets too small or too long-period to detect, so the false-alarm rate counts spurious signals only in part.</p>
    <p>Nothing on any page is generated or placeholder. Numbers are computed by <code>pipeline/</code> and stored in <code>data/science.db</code>. Re-run the pipeline to reproduce them.</p></div></div>`;
};

pages.account = async el => {
  if (!S.user) return needLogin(el, "Account");
  el.innerHTML = head("Account", "Your profile and your data.") + `<div class="g2"><div class="card"><h3><span>Profile</span></h3><div class="row"><span>Email</span><span style="font-size:14px">${esc(S.user.email)}</span></div><div class="row"><span>Member since</span><span style="font-size:14px">${esc(S.user.created.slice(0, 10))}</span></div>
    <div class="fields" style="margin-top:14px"><div><label for="nm">Display name</label><input id="nm" value="${esc(S.user.name)}" maxlength="60"></div><div class="fix"><button class="btn sm" id="sv">Save</button></div></div>
    <div style="display:flex;gap:10px;margin-top:6px;flex-wrap:wrap"><button class="btn ghost sm" id="ex">Export my data (JSON)</button><button class="btn ghost sm" id="lo">Sign out</button></div></div>
    <div class="card"><h3><span>Delete account</span></h3><p class="small muted" style="margin-bottom:12px">Permanently removes your account, live analyses, notes and watchlist. This cannot be undone.</p><label for="dpw">Confirm password</label><input id="dpw" type="password" autocomplete="current-password" style="margin-bottom:12px"><button class="btn danger sm" id="del">Delete my account</button><div class="err" id="derr"></div></div></div>`;
  $("#sv").onclick = async () => { try { const r = await api("/account/name", { method: "POST", body: { name: $("#nm").value } }); S.user = r.user; buildNav(); toast("Saved"); } catch (e) { toast(e.message); } };
  $("#ex").onclick = () => { location.href = "/api/export"; };
  $("#lo").onclick = logout;
  $("#del").onclick = async () => { try { await api("/account", { method: "DELETE", body: { password: $("#dpw").value } }); S.user = null; S.cache = {}; await boot(true); toast("Account deleted"); } catch (e) { $("#derr").textContent = e.message; } };
};
function needLogin(el, title) {
  el.innerHTML = head(title, "Sign in to use this page.") + `<div class="card"><div class="empty">Accounts keep your live analyses, notes and watchlist private.<br><br><button class="btn" id="si">Sign in or create an account</button></div></div>`;
  $("#si").onclick = () => showAuth();
}
const _wb = pages.workbench;
pages.workbench = async el => { await _wb(el); if (S.pendingJob) { const j = S.pendingJob; S.pendingJob = null; pollJob(j, $("#jobmsg", el)); } };

function buildNav() {
  const alt = ["catalog", "periodogram", "field"];
  G("#nav").innerHTML = LOGO + PAGES.slice(0, -1).map(([k, t]) => `<a role="link" tabindex="0" data-k="${k}" data-t="${t}" aria-label="${t}" class="${alt.includes(k) ? "alt" : ""}"><svg viewBox="0 0 24 24">${IC[k]}</svg></a>`).join("") +
    `<span class="sp"></span><a role="link" tabindex="0" data-k="account" data-t="${S.user ? esc(S.user.name) : "Sign in"}" aria-label="Account"><svg viewBox="0 0 24 24">${IC.account}</svg></a>`;
  GG("#nav a").forEach(a => { a.onclick = ev => go(a.dataset.k, ev); a.onkeydown = ev => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); go(a.dataset.k, { clientX: 38, clientY: a.getBoundingClientRect().top + 23 }); } }; });
  mark();
}
let cur = null, busy = false, pendingOrigin = null;
function mark() { GG("#nav a").forEach(a => a.classList.toggle("on", a.dataset.k === cur)); }
function go(k, ev) { if (busy) return; pendingOrigin = ev; if (location.hash === "#/" + k) { route(); } else location.hash = "#/" + k; }
window.addEventListener("hashchange", () => route());
function origin(ev) {
  if (ev && ev.clientX != null && (ev.clientX || ev.clientY)) return [ev.clientX, ev.clientY];
  const e = ev && (ev.currentTarget || ev.target), r = e && e.getBoundingClientRect ? e.getBoundingClientRect() : null;
  return r ? [r.left + r.width / 2, r.top + r.height / 2] : [innerWidth / 2, innerHeight / 3];
}
const ease = t => t < .5 ? 16 * t ** 5 : 1 - Math.pow(-2 * t + 2, 5) / 2;
async function route() {
  const k = (location.hash.match(/^#\/(\w+)/) || [])[1], key = pages[k] ? k : "workbench";
  if (busy || key === cur) return; const ev = pendingOrigin; pendingOrigin = null; render(key, { ev });
}
async function render(key, opt = {}) {
  const view = G("#view"), next = G("#next");
  if (opt.quick || cur === null || reduce.matches) {
    const keepY = opt.quick ? scrollY : 0; S.root = view; await fill(view, key); cur = key; mark(); if (!opt.quick) view.focus({ preventScroll: true }); scrollTo(0, keepY); return;
  }
  busy = true; S.root = next; await fill(next, key);
  const [x, y] = origin(opt.ev), R = Math.hypot(innerWidth, innerHeight) * 1.1, rt = next.style, ring = G("#ring");
  next.classList.add("live"); const t0 = performance.now(), D = 1200;
  await new Promise(done => { (function step(now) {
    const p = Math.min(1, Math.max(0, (now - t0) / D)), e = ease(p), r = R * e, f = Math.max(30, r * .12);
    const m = `radial-gradient(circle at ${x}px ${y}px,#000 ${Math.max(0, r - f)}px,transparent ${r}px)`; rt.webkitMaskImage = rt.maskImage = m; rt.transform = `scale(${1.045 - .045 * e})`; rt.transformOrigin = `${x}px ${y}px`;
    view.style.transform = `scale(${1 - .03 * e})`; view.style.filter = `blur(${6 * e}px) brightness(${1 - .45 * e})`;
    Object.assign(ring.style, { left: x + "px", top: y + "px", width: 2 * r + "px", height: 2 * r + "px", opacity: p < 1 ? Math.sin(Math.PI * Math.min(1, p * 1.15)) * .85 : 0 });
    p < 1 ? requestAnimationFrame(step) : done(); })(t0); });
  view.replaceChildren(...next.childNodes); S.root = view; scrollTo(0, 0);
  view.style.transform = view.style.filter = ""; next.classList.remove("live"); rt.webkitMaskImage = rt.maskImage = rt.transform = ""; ring.style.opacity = 0;
  cur = key; mark(); view.focus({ preventScroll: true }); busy = false;
}
async function fill(el, key) {
  el.innerHTML = '<div class="empty" style="padding-top:25vh"><span class="spin"></span>Loading</div>';
  try { await pages[key](el); } catch (e) {
    el.innerHTML = head("Something went wrong", "") + `<div class="card"><div class="empty">${esc(e.message)}<br><br><button class="btn ghost sm" id="rt">Try again</button></div></div>`; $("#rt", el).onclick = () => render(key, { quick: true });
  }
}

function showAuth(mode = "in") {
  const a = G("#auth"); a.hidden = false; G("#shell").hidden = true; S.root = a;
  a.innerHTML = `<div class="a-side"><div class="brand"><svg viewBox="0 0 40 40" fill="none" stroke="#e6cf9f" stroke-width="1.8"><ellipse cx="20" cy="20" rx="17" ry="7" transform="rotate(-25 20 20)"/><circle cx="20" cy="20" r="5" fill="#f6e6c0"/></svg>Perihelion</div>
    <div class="a-orbit"><i></i><i></i><i></i><b></b></div><div class="note">A transit search workbench built on NASA Kepler data and the NASA Exoplanet Archive.</div></div>
    <div class="a-form"><div class="a-card"><h1>${mode === "in" ? "Sign in" : "Create your account"}<small>${mode === "in" ? "Welcome back to the workbench." : "Run live searches, keep notes and a watchlist."}</small></h1>
    <div class="tabs"><button class="tab ${mode === "in" ? "on" : ""}" data-m="in">Sign in</button><button class="tab ${mode === "up" ? "on" : ""}" data-m="up">Create account</button></div>
    <form id="af" novalidate>${mode === "up" ? '<div><label for="an">Name</label><input id="an" autocomplete="name" maxlength="60"></div>' : ""}<div><label for="ae">Email</label><input id="ae" type="email" autocomplete="email" required></div>
    <div><label for="ap">Password${mode === "up" ? " (8+ characters)" : ""}</label><input id="ap" type="password" autocomplete="${mode === "in" ? "current-password" : "new-password"}" required></div>
    <div class="err" id="ae2" role="alert"></div><button class="btn" style="width:100%" id="sb">${mode === "in" ? "Sign in" : "Create account"}</button></form>
    <p class="small muted" style="margin-top:16px">Or <a href="#" id="guest" style="color:var(--gold)">browse without an account</a>. Live searches and notes need one.</p></div></div>`;
  $$(".tab", a).forEach(b => b.onclick = () => showAuth(b.dataset.m));
  $("#guest").onclick = e => { e.preventDefault(); enter(); };
  $("#af").onsubmit = async e => {
    e.preventDefault(); $("#sb").disabled = true; $("#ae2").textContent = "";
    try { const r = await api(mode === "in" ? "/auth/login" : "/auth/signup", { method: "POST", body: { email: $("#ae").value, password: $("#ap").value, name: $("#an") ? $("#an").value : "" } }); S.user = r.user; S.csrf = r.csrf; S.cache = {}; await stars(); enter(); }
    catch (er) { $("#ae2").textContent = er.message; $("#sb").disabled = false; }
  };
}
function enter() { G("#auth").hidden = true; G("#shell").hidden = false; buildNav(); cur = null; S.root = G("#view"); if (!location.hash) location.hash = "#/workbench"; route(); }
async function logout() { await api("/auth/logout", { method: "POST" }); S.user = null; S.cache = {}; await boot(true); }
async function boot(forceAuth) {
  const m = await api("/me"); S.user = m.user; S.csrf = m.csrf; await stars();
  if (!S.user || forceAuth) showAuth("in"); else enter();
}
boot().catch(e => { document.body.insertAdjacentHTML("beforeend", `<p style="padding:40px;position:relative;z-index:50">Could not reach the server: ${esc(e.message)}</p>`); });
