/* ============================================================
   MOSFET Lab — TypeScript source.
   Compile: npx tsc ts/mosfet.ts --outFile js/mosfet.js --target es2017 --lib es2017,dom
   Physics + canvas chart renderer + UI wiring. No dependencies.
   ============================================================ */

interface ModelParams { vt: number; k: number; lam: number; }
interface SimQuery {
  model: ModelParams; vgs: number; vdd: number; rd: number;
  vdsMax: number; vgsMax: number;
}
interface Series { label: string; y: number[]; color?: string; }
interface ChartSpec {
  x: number[];
  series: Series[];
  load?: { x: number[]; y: number[] };
  op?: { x: number; y: number };
}
interface OpInfo {
  vds: number; id: number; region: string; pd: number;
  rds: number | null; gfs: number; warnCurrent: boolean; warnPower: boolean;
}
interface Datasets {
  family: ChartSpec; iv: ChartSpec; transfer: ChartSpec; vinVout: ChartSpec; op: OpInfo;
}

/* ---------- physics: square-law MOSFET with channel-length modulation ---------- */

function drainCurrent(vgs: number, vds: number, m: ModelParams): number {
  const vov = vgs - m.vt;
  if (vds <= 0 || vov <= 0) return 0;
  const vdsat = Math.min(vds, vov);
  return Math.max(0, m.k * (vov * vdsat - (vdsat * vdsat) / 2) * (1 + m.lam * vds));
}

function operatingPoint(vgs: number, vdd: number, rd: number, m: ModelParams): { vds: number; id: number } {
  let lo = 0, hi = vdd;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (drainCurrent(vgs, mid, m) > (vdd - mid) / rd) hi = mid;
    else lo = mid;
  }
  const vds = (lo + hi) / 2;
  return { vds, id: drainCurrent(vgs, vds, m) };
}

function regionOf(vgs: number, vds: number, m: ModelParams): string {
  if (vgs <= m.vt) return "Cutoff";
  return vds < vgs - m.vt ? "Triode (Ohmic)" : "Saturation";
}

function buildDatasets(q: SimQuery): Datasets {
  const m = q.model;
  const N = 240;
  const famX: number[] = [];
  for (let i = 0; i <= N; i++) famX.push((q.vdsMax * i) / N);

  const g0 = Math.max(m.vt + 0.75, m.vt * 1.25);
  const top = Math.max(q.vgsMax, g0 + 0.1);
  const gs: number[] = [];
  for (let i = 0; i < 6; i++) gs.push(g0 + (top - g0) * (i / 5));

  const family: ChartSpec = {
    x: famX,
    series: gs.map((g) => ({
      label: `VGS = ${g.toFixed(1)} V`,
      y: famX.map((x) => drainCurrent(g, x, m)),
    })),
  };
  const lxMax = Math.min(q.vdd, q.vdsMax);
  const lx: number[] = [], ly: number[] = [];
  for (let i = 0; i <= 60; i++) {
    const x = (lxMax * i) / 60;
    lx.push(x); ly.push((q.vdd - x) / q.rd);
  }
  family.load = { x: lx, y: ly };

  const iv: ChartSpec = {
    x: famX,
    series: [{ label: `ID @ VGS = ${q.vgs.toFixed(1)} V`, y: famX.map((x) => drainCurrent(q.vgs, x, m)) }],
  };

  const tMax = q.vgsMax + 3;
  const tX: number[] = [];
  for (let i = 0; i <= 200; i++) tX.push((tMax * i) / 200);
  const transfer: ChartSpec = {
    x: tX,
    series: [{ label: "ID (VDS = VDD)", y: tX.map((x) => drainCurrent(x, q.vdd, m)) }],
  };
  const vinVout: ChartSpec = {
    x: tX,
    series: [{ label: "Vout", y: tX.map((x) => Math.max(0, operatingPoint(x, q.vdd, q.rd, m).vds)) }],
  };

  const o = operatingPoint(q.vgs, q.vdd, q.rd, m);
  const op: OpInfo = {
    vds: o.vds,
    id: o.id,
    region: regionOf(q.vgs, o.vds, m),
    pd: o.id * o.vds,
    rds: o.id > 1e-6 ? o.vds / o.id : null,
    gfs: q.vgs > m.vt ? m.k * (q.vgs - m.vt) : 0,
    warnCurrent: o.id > 33,
    warnPower: o.id * o.vds > 130,
  };
  iv.op = { x: o.vds, y: o.id };
  vinVout.op = { x: q.vgs, y: o.vds };

  return { family, iv, transfer, vinVout, op };
}

/* ---------- chart renderer (HTML canvas, no libraries) ---------- */

interface RefLine { x: number; label: string; color?: string; }
interface ChartConfig { xLabel: string; yLabel: string; yUnit: string; refs?: RefLine[]; }

const PALETTE = ["#22d3ee", "#a78bfa", "#f472b6", "#facc15", "#34d399", "#fb923c"];

function niceStep(range: number, ticks: number): number {
  const raw = range / ticks;
  if (raw <= 0 || !isFinite(raw)) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const mult = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  return mult * mag;
}

function fmtTick(v: number, unit: string): string {
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1000) return (v / 1000).toFixed(1) + "k" + unit;
  if (a < 1) return (v * 1000).toFixed(0) + " m" + unit;
  if (a < 10) return v.toFixed(1) + " " + unit;
  return v.toFixed(0) + " " + unit;
}

function drawChart(canvas: HTMLCanvasElement, spec: ChartSpec, cfg: ChartConfig): void {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || 600;
  const H = canvas.clientHeight || 280;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const M = { l: 60, r: 18, t: 18, b: 42 };
  const pw = W - M.l - M.r, ph = H - M.t - M.b;

  let xmax = 0, ymax = 0;
  const scan = (xs: number[], ys: number[]) => {
    for (let i = 0; i < xs.length; i++) {
      if (xs[i] > xmax) xmax = xs[i];
      const y = ys[i];
      if (y !== null && isFinite(y) && y > ymax) ymax = y;
    }
  };
  for (const s of spec.series) scan(spec.x, s.y);
  if (spec.load) scan(spec.load.x, spec.load.y);
  if (spec.op && isFinite(spec.op.y) && spec.op.y > ymax) ymax = spec.op.y;
  if (xmax <= 0) xmax = 1;
  if (ymax <= 0) ymax = 1;
  ymax *= 1.08;

  const X = (v: number) => M.l + (v / xmax) * pw;
  const Y = (v: number) => M.t + ph - (v / ymax) * ph;

  /* grid + ticks */
  const stepX = niceStep(xmax, 6), stepY = niceStep(ymax, 5);
  ctx.font = "10.5px ui-monospace, Menlo, monospace";
  ctx.strokeStyle = "rgba(148,163,184,0.12)";
  ctx.fillStyle = "#64748b";
  ctx.lineWidth = 1;
  for (let x = 0; x <= xmax + 1e-9; x += stepX) {
    const px = X(x);
    ctx.beginPath(); ctx.moveTo(px, M.t); ctx.lineTo(px, M.t + ph); ctx.stroke();
    ctx.textAlign = "center";
    ctx.fillText(x.toFixed(stepX < 1 ? 1 : 0), px, H - M.b + 14);
  }
  for (let y = 0; y <= ymax + 1e-9; y += stepY) {
    const py = Y(y);
    ctx.beginPath(); ctx.moveTo(M.l, py); ctx.lineTo(M.l + pw, py); ctx.stroke();
    ctx.textAlign = "right";
    ctx.fillText(fmtTick(y, cfg.yUnit), M.l - 6, py + 3.5);
  }
  ctx.fillStyle = "#94a3b8";
  ctx.textAlign = "center";
  ctx.fillText(cfg.xLabel, M.l + pw / 2, H - 6);
  ctx.textAlign = "left";
  ctx.fillText(cfg.yLabel, M.l + 4, M.t + 2);

  /* reference lines */
  for (const r of cfg.refs || []) {
    if (r.x > 0 && r.x < xmax) {
      ctx.strokeStyle = r.color || "#f472b6";
      ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(X(r.x), M.t); ctx.lineTo(X(r.x), M.t + ph); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = r.color || "#f472b6";
      ctx.textAlign = "right";
      ctx.fillText(r.label, X(r.x) - 4, M.t + 12);
    }
  }

  /* load line */
  if (spec.load) {
    ctx.strokeStyle = "#f43f5e";
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < spec.load.x.length; i++) {
      const px = X(spec.load.x[i]), py = Y(Math.min(spec.load.y[i], ymax));
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /* series */
  for (let i = 0; i < spec.series.length; i++) {
    const s = spec.series[i];
    ctx.strokeStyle = s.color || PALETTE[i % PALETTE.length];
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    let started = false;
    for (let j = 0; j < spec.x.length; j++) {
      const yv = s.y[j];
      if (yv === null || !isFinite(yv)) { started = false; continue; }
      const cx = X(spec.x[j]), cy = Y(yv);
      if (!started) { ctx.moveTo(cx, cy); started = true; }
      else ctx.lineTo(cx, cy);
    }
    ctx.stroke();
  }

  /* operating point */
  if (spec.op && isFinite(spec.op.x) && isFinite(spec.op.y)) {
    const ox = X(Math.min(spec.op.x, xmax)), oy = Y(Math.min(spec.op.y, ymax));
    ctx.beginPath();
    ctx.arc(ox, oy, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = "#facc15"; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = "#78350f"; ctx.stroke();
  }

  /* legend */
  const items: { label: string; color: string }[] = [];
  for (let i = 0; i < spec.series.length; i++)
    items.push({ label: spec.series[i].label, color: spec.series[i].color || PALETTE[i % PALETTE.length] });
  if (spec.load) items.push({ label: "DC load line", color: "#f43f5e" });
  ctx.font = "10.5px ui-monospace, Menlo, monospace";
  let ly = M.t + 12;
  for (const item of items) {
    const tw = ctx.measureText(item.label).width;
    const lx0 = W - M.r - tw - 26;
    ctx.strokeStyle = item.color; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.moveTo(lx0, ly - 3); ctx.lineTo(lx0 + 16, ly - 3); ctx.stroke();
    ctx.fillStyle = "#cbd5e1"; ctx.textAlign = "left";
    ctx.fillText(item.label, lx0 + 20, ly);
    ly += 16;
  }
}

/* ---------- UI wiring ---------- */

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const val = (id: string): number => parseFloat((document.getElementById(id) as HTMLInputElement).value);

function readParams(): SimQuery {
  return {
    model: { vt: val("p-vt"), k: val("p-k"), lam: val("p-lam") },
    vgs: val("p-vgs"), vdd: val("p-vdd"), rd: val("p-rd"),
    vdsMax: val("p-vdsmax"), vgsMax: val("p-vgsmax"),
  };
}

function fmtA(v: number): string {
  if (v >= 100) return v.toFixed(1) + " A";
  if (v >= 1) return v.toFixed(3) + " A";
  return (v * 1000).toFixed(2) + " mA";
}
function fmtR(v: number): string {
  return v >= 1000 ? (v / 1000).toFixed(1) + " kΩ" : v.toFixed(v < 10 ? 1 : 0) + " Ω";
}

function updateLabels(q: SimQuery): void {
  ($("o-vgs") as HTMLOutputElement).textContent = q.vgs.toFixed(1) + " V";
  ($("o-vdd") as HTMLOutputElement).textContent = q.vdd.toFixed(0) + " V";
  ($("o-rd") as HTMLOutputElement).textContent = fmtR(q.rd);
  ($("o-vt") as HTMLOutputElement).textContent = q.model.vt.toFixed(2) + " V";
  ($("o-k") as HTMLOutputElement).textContent = q.model.k.toFixed(2) + " A/V²";
  ($("o-lam") as HTMLOutputElement).textContent = q.model.lam.toFixed(3) + " V⁻¹";
  ($("o-vdsmax") as HTMLOutputElement).textContent = q.vdsMax.toFixed(0) + " V";
  ($("o-vgsmax") as HTMLOutputElement).textContent = q.vgsMax.toFixed(1) + " V";
}

function updateReadout(op: OpInfo, q: SimQuery): void {
  $("r-id").textContent = fmtA(op.id);
  $("r-vds").textContent = op.vds.toFixed(3) + " V";
  $("r-pd").textContent = op.pd.toFixed(2) + " W";
  $("r-rds").textContent = op.rds === null ? "∞" : (op.rds < 1 ? (op.rds * 1000).toFixed(0) + " mΩ" : op.rds.toFixed(2) + " Ω");
  $("r-gfs").textContent = op.gfs.toFixed(2) + " S";
  const badge = $("r-region");
  badge.textContent = op.region;
  badge.className = "region-badge " + (
    op.region === "Cutoff" ? "region-cutoff" :
    op.region === "Triode (Ohmic)" ? "region-triode" : "region-saturation");
  const warn = $("op-warning");
  warn.hidden = !(op.warnCurrent || op.warnPower);
  warn.textContent = "⚠ Operating point exceeds the IRF540NPbF rating (33 A continuous drain current / 130 W dissipation @ 25 °C case).";
  $("c-vdd").textContent = "VDD = " + q.vdd.toFixed(0) + " V";
  $("c-rd").textContent = "RD = " + fmtR(q.rd);
  $("c-vgs").textContent = "= " + q.vgs.toFixed(1) + " V";
  $("c-id").textContent = "ID = " + fmtA(op.id);
  $("c-vds").textContent = "= " + op.vds.toFixed(2) + " V";
}

let useBackend = false;

async function refresh(): Promise<void> {
  const q = readParams();
  updateLabels(q);
  let data: Datasets;
  if (useBackend) {
    try {
      const res = await fetch("/api/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(q),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      data = (await res.json()) as Datasets;
      $("backend-status").textContent = "Python backend: connected";
    } catch (e) {
      $("backend-status").textContent = "Python backend: unavailable — using local JS engine";
      data = buildDatasets(q);
    }
  } else {
    data = buildDatasets(q);
  }

  const vov = q.vgs - q.model.vt;
  drawChart($("chart-family") as HTMLCanvasElement, data.family,
    { xLabel: "V_DS (V)", yLabel: "I_D (A)", yUnit: "A", refs: [] });
  drawChart($("chart-iv") as HTMLCanvasElement, data.iv,
    { xLabel: "V_DS (V)", yLabel: "I_D (A)", yUnit: "A",
      refs: vov > 0 ? [{ x: vov, label: "VGS−VT", color: "#f59e0b" }] : [] });
  drawChart($("chart-transfer") as HTMLCanvasElement, data.transfer,
    { xLabel: "V_GS (V)", yLabel: "I_D (A)", yUnit: "A",
      refs: [{ x: q.model.vt, label: "VT" }] });
  drawChart($("chart-vout") as HTMLCanvasElement, data.vinVout,
    { xLabel: "V_in (V)", yLabel: "V_out (V)", yUnit: "V",
      refs: [{ x: q.model.vt, label: "VT" }] });

  updateReadout(data.op, q);
}

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll<HTMLInputElement>('input[type="range"]').forEach((el) => {
    el.addEventListener("input", () => { refresh(); });
  });
  document.querySelectorAll<HTMLElement>(".preset").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".preset").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      ($("p-vt") as HTMLInputElement).value = btn.dataset.vt || "3";
      ($("p-k") as HTMLInputElement).value = btn.dataset.k || "1.35";
      ($("p-lam") as HTMLInputElement).value = btn.dataset.lam || "0.02";
      refresh();
    });
  });
  ($("use-backend") as HTMLInputElement).addEventListener("change", (e) => {
    useBackend = (e.target as HTMLInputElement).checked;
    $("backend-status").textContent = useBackend
      ? "Python backend: connecting…"
      : "Python backend: off — local JS engine";
    refresh();
  });
  window.addEventListener("resize", () => { refresh(); });
  refresh();
});