/* MOSFET Lab — physics + chart renderer + UI wiring (compiled from ts/mosfet.ts). No dependencies. */
(function () {
  "use strict";

  function drainCurrent(vgs, vds, m) {
    var vov = vgs - m.vt;
    if (vds <= 0 || vov <= 0) return 0;
    var vdsat = Math.min(vds, vov);
    return Math.max(0, m.k * (vov * vdsat - (vdsat * vdsat) / 2) * (1 + m.lam * vds));
  }

  function operatingPoint(vgs, vdd, rd, m) {
    var lo = 0, hi = vdd;
    for (var i = 0; i < 80; i++) {
      var mid = (lo + hi) / 2;
      if (drainCurrent(vgs, mid, m) > (vdd - mid) / rd) hi = mid;
      else lo = mid;
    }
    var vds = (lo + hi) / 2;
    return { vds: vds, id: drainCurrent(vgs, vds, m) };
  }

  function regionOf(vgs, vds, m) {
    if (vgs <= m.vt) return "Cutoff";
    return vds < vgs - m.vt ? "Triode (Ohmic)" : "Saturation";
  }

  function buildDatasets(q) {
    var m = q.model, N = 240, famX = [], i, g;
    for (i = 0; i <= N; i++) famX.push((q.vdsMax * i) / N);
    var g0 = Math.max(m.vt + 0.75, m.vt * 1.25);
    var top = Math.max(q.vgsMax, g0 + 0.1);
    var gs = [];
    for (i = 0; i < 6; i++) gs.push(g0 + (top - g0) * (i / 5));
    var family = {
      x: famX,
      series: gs.map(function (g) {
        return { label: "VGS = " + g.toFixed(1) + " V", y: famX.map(function (x) { return drainCurrent(g, x, m); }) };
      })
    };
    var lxMax = Math.min(q.vdd, q.vdsMax), lx = [], ly = [];
    for (i = 0; i <= 60; i++) { var xl = (lxMax * i) / 60; lx.push(xl); ly.push((q.vdd - xl) / q.rd); }
    family.load = { x: lx, y: ly };
    var iv = {
      x: famX,
      series: [{ label: "ID @ VGS = " + q.vgs.toFixed(1) + " V", y: famX.map(function (x) { return drainCurrent(q.vgs, x, m); }) }]
    };
    var tMax = q.vgsMax + 3, tX = [];
    for (i = 0; i <= 200; i++) tX.push((tMax * i) / 200);
    var transfer = { x: tX, series: [{ label: "ID (VDS = VDD)", y: tX.map(function (x) { return drainCurrent(x, q.vdd, m); }) }] };
    var vinVout = { x: tX, series: [{ label: "Vout", y: tX.map(function (x) { return Math.max(0, operatingPoint(x, q.vdd, q.rd, m).vds); }) }] };
    var o = operatingPoint(q.vgs, q.vdd, q.rd, m);
    var op = {
      vds: o.vds, id: o.id,
      region: regionOf(q.vgs, o.vds, m),
      pd: o.id * o.vds,
      rds: o.id > 1e-6 ? o.vds / o.id : null,
      gfs: q.vgs > m.vt ? m.k * (q.vgs - m.vt) : 0,
      warnCurrent: o.id > 33,
      warnPower: o.id * o.vds > 130
    };
    iv.op = { x: o.vds, y: o.id };
    vinVout.op = { x: q.vgs, y: o.vds };
    return { family: family, iv: iv, transfer: transfer, vinVout: vinVout, op: op };
  }

  var PALETTE = ["#22d3ee", "#a78bfa", "#f472b6", "#facc15", "#34d399", "#fb923c"];

  function niceStep(range, ticks) {
    var raw = range / ticks;
    if (raw <= 0 || !isFinite(raw)) return 1;
    var mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var norm = raw / mag;
    var mult = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
    return mult * mag;
  }

  function fmtTick(v, unit) {
    if (v === 0) return "0";
    var a = Math.abs(v);
    if (a >= 1000) return (v / 1000).toFixed(1) + "k" + unit;
    if (a < 1) return (v * 1000).toFixed(0) + " m" + unit;
    if (a < 10) return v.toFixed(1) + " " + unit;
    return v.toFixed(0) + " " + unit;
  }

  function drawChart(canvas, spec, cfg) {
    var dpr = window.devicePixelRatio || 1;
    var W = canvas.clientWidth || 600;
    var H = canvas.clientHeight || 280;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    var ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    var M = { l: 60, r: 18, t: 18, b: 42 };
    var pw = W - M.l - M.r, ph = H - M.t - M.b;
    var xmax = 0, ymax = 0, i, j;
    function scan(xs, ys) {
      for (var i2 = 0; i2 < xs.length; i2++) {
        if (xs[i2] > xmax) xmax = xs[i2];
        var y = ys[i2];
        if (y !== null && isFinite(y) && y > ymax) ymax = y;
      }
    }
    for (i = 0; i < spec.series.length; i++) scan(spec.x, spec.series[i].y);
    if (spec.load) scan(spec.load.x, spec.load.y);
    if (spec.op && isFinite(spec.op.y) && spec.op.y > ymax) ymax = spec.op.y;
    if (xmax <= 0) xmax = 1;
    if (ymax <= 0) ymax = 1;
    ymax *= 1.08;

    function X(v) { return M.l + (v / xmax) * pw; }
    function Y(v) { return M.t + ph - (v / ymax) * ph; }

    var stepX = niceStep(xmax, 6), stepY = niceStep(ymax, 5);
    ctx.font = "10.5px ui-monospace, Menlo, monospace";
    ctx.strokeStyle = "rgba(148,163,184,0.12)";
    ctx.fillStyle = "#64748b";
    ctx.lineWidth = 1;
    for (var x = 0; x <= xmax + 1e-9; x += stepX) {
      var px = X(x);
      ctx.beginPath(); ctx.moveTo(px, M.t); ctx.lineTo(px, M.t + ph); ctx.stroke();
      ctx.textAlign = "center";
      ctx.fillText(x.toFixed(stepX < 1 ? 1 : 0), px, H - M.b + 14);
    }
    for (var y = 0; y <= ymax + 1e-9; y += stepY) {
      var py = Y(y);
      ctx.beginPath(); ctx.moveTo(M.l, py); ctx.lineTo(M.l + pw, py); ctx.stroke();
      ctx.textAlign = "right";
      ctx.fillText(fmtTick(y, cfg.yUnit), M.l - 6, py + 3.5);
    }
    ctx.fillStyle = "#94a3b8";
    ctx.textAlign = "center";
    ctx.fillText(cfg.xLabel, M.l + pw / 2, H - 6);
    ctx.textAlign = "left";
    ctx.fillText(cfg.yLabel, M.l + 4, M.t + 2);

    (cfg.refs || []).forEach(function (r) {
      if (r.x > 0 && r.x < xmax) {
        ctx.strokeStyle = r.color || "#f472b6";
        ctx.setLineDash([5, 4]);
        ctx.beginPath(); ctx.moveTo(X(r.x), M.t); ctx.lineTo(X(r.x), M.t + ph); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = r.color || "#f472b6";
        ctx.textAlign = "right";
        ctx.fillText(r.label, X(r.x) - 4, M.t + 12);
      }
    });

    if (spec.load) {
      ctx.strokeStyle = "#f43f5e";
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (i = 0; i < spec.load.x.length; i++) {
        var lx2 = X(spec.load.x[i]), ly2 = Y(Math.min(spec.load.y[i], ymax));
        if (i === 0) ctx.moveTo(lx2, ly2); else ctx.lineTo(lx2, ly2);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    for (i = 0; i < spec.series.length; i++) {
      var s = spec.series[i];
      ctx.strokeStyle = s.color || PALETTE[i % PALETTE.length];
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      var started = false;
      for (j = 0; j < spec.x.length; j++) {
        var yv = s.y[j];
        if (yv === null || !isFinite(yv)) { started = false; continue; }
        var cx = X(spec.x[j]), cy = Y(yv);
        if (!started) { ctx.moveTo(cx, cy); started = true; } else ctx.lineTo(cx, cy);
      }
      ctx.stroke();
    }

    if (spec.op && isFinite(spec.op.x) && isFinite(spec.op.y)) {
      var ox = X(Math.min(spec.op.x, xmax)), oy = Y(Math.min(spec.op.y, ymax));
      ctx.beginPath();
      ctx.arc(ox, oy, 5.5, 0, Math.PI * 2);
      ctx.fillStyle = "#facc15"; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = "#78350f"; ctx.stroke();
    }

    var items = [];
    for (i = 0; i < spec.series.length; i++)
      items.push({ label: spec.series[i].label, color: spec.series[i].color || PALETTE[i % PALETTE.length] });
    if (spec.load) items.push({ label: "DC load line", color: "#f43f5e" });
    ctx.font = "10.5px ui-monospace, Menlo, monospace";
    var ly3 = M.t + 12;
    for (i = 0; i < items.length; i++) {
      var tw = ctx.measureText(items[i].label).width;
      var lx0 = W - M.r - tw - 26;
      ctx.strokeStyle = items[i].color; ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.moveTo(lx0, ly3 - 3); ctx.lineTo(lx0 + 16, ly3 - 3); ctx.stroke();
      ctx.fillStyle = "#cbd5e1"; ctx.textAlign = "left";
      ctx.fillText(items[i].label, lx0 + 20, ly3);
      ly3 += 16;
    }
  }

  /* ---------- UI wiring ---------- */
  function $(id) { return document.getElementById(id); }
  function val(id) { return parseFloat(document.getElementById(id).value); }

  function readParams() {
    return {
      model: { vt: val("p-vt"), k: val("p-k"), lam: val("p-lam") },
      vgs: val("p-vgs"), vdd: val("p-vdd"), rd: val("p-rd"),
      vdsMax: val("p-vdsmax"), vgsMax: val("p-vgsmax")
    };
  }

  function fmtA(v) {
    if (v >= 100) return v.toFixed(1) + " A";
    if (v >= 1) return v.toFixed(3) + " A";
    return (v * 1000).toFixed(2) + " mA";
  }
  function fmtR(v) {
    return v >= 1000 ? (v / 1000).toFixed(1) + " kΩ" : v.toFixed(v < 10 ? 1 : 0) + " Ω";
  }

  function updateLabels(q) {
    $("o-vgs").textContent = q.vgs.toFixed(1) + " V";
    $("o-vdd").textContent = q.vdd.toFixed(0) + " V";
    $("o-rd").textContent = fmtR(q.rd);
    $("o-vt").textContent = q.model.vt.toFixed(2) + " V";
    $("o-k").textContent = q.model.k.toFixed(2) + " A/V²";
    $("o-lam").textContent = q.model.lam.toFixed(3) + " V⁻¹";
    $("o-vdsmax").textContent = q.vdsMax.toFixed(0) + " V";
    $("o-vgsmax").textContent = q.vgsMax.toFixed(1) + " V";
  }

  function updateReadout(op, q) {
    $("r-id").textContent = fmtA(op.id);
    $("r-vds").textContent = op.vds.toFixed(3) + " V";
    $("r-pd").textContent = op.pd.toFixed(2) + " W";
    $("r-rds").textContent = op.rds === null ? "∞" : (op.rds < 1 ? (op.rds * 1000).toFixed(0) + " mΩ" : op.rds.toFixed(2) + " Ω");
    $("r-gfs").textContent = op.gfs.toFixed(2) + " S";
    var badge = $("r-region");
    badge.textContent = op.region;
    badge.className = "region-badge " + (
      op.region === "Cutoff" ? "region-cutoff" :
      op.region === "Triode (Ohmic)" ? "region-triode" : "region-saturation");
    var warn = $("op-warning");
    warn.hidden = !(op.warnCurrent || op.warnPower);
    warn.textContent = "⚠ Operating point exceeds the IRF540NPbF rating (33 A continuous drain current / 130 W dissipation @ 25 °C case).";
    $("c-vdd").textContent = "VDD = " + q.vdd.toFixed(0) + " V";
    $("c-rd").textContent = "RD = " + fmtR(q.rd);
    $("c-vgs").textContent = "= " + q.vgs.toFixed(1) + " V";
    $("c-id").textContent = "ID = " + fmtA(op.id);
    $("c-vds").textContent = "= " + op.vds.toFixed(2) + " V";
  }

  var useBackend = false;

  function refresh() {
    var q = readParams();
    updateLabels(q);
    var done = function (data) {
      var vov = q.vgs - q.model.vt;
      drawChart($("chart-family"), data.family,
        { xLabel: "V_DS (V)", yLabel: "I_D (A)", yUnit: "A", refs: [] });
      drawChart($("chart-iv"), data.iv,
        { xLabel: "V_DS (V)", yLabel: "I_D (A)", yUnit: "A",
          refs: vov > 0 ? [{ x: vov, label: "VGS−VT", color: "#f59e0b" }] : [] });
      drawChart($("chart-transfer"), data.transfer,
        { xLabel: "V_GS (V)", yLabel: "I_D (A)", yUnit: "A",
          refs: [{ x: q.model.vt, label: "VT" }] });
      drawChart($("chart-vout"), data.vinVout,
        { xLabel: "V_in (V)", yLabel: "V_out (V)", yUnit: "V",
          refs: [{ x: q.model.vt, label: "VT" }] });
      updateReadout(data.op, q);
    };
    if (!useBackend) { done(buildDatasets(q)); return; }
    $("backend-status").textContent = "Python backend: connecting…";
    fetch("/api/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(q)
    }).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    }).then(function (data) {
      $("backend-status").textContent = "Python backend: connected";
      done(data);
    }).catch(function () {
      $("backend-status").textContent = "Python backend: unavailable — using local JS engine";
      done(buildDatasets(q));
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll('input[type="range"]').forEach(function (el) {
      el.addEventListener("input", refresh);
    });
    document.querySelectorAll(".preset").forEach(function (btn) {
      btn.addEventListener("click", function () {
        document.querySelectorAll(".preset").forEach(function (b) { b.classList.remove("active"); });
        btn.classList.add("active");
        $("p-vt").value = btn.dataset.vt;
        $("p-k").value = btn.dataset.k;
        $("p-lam").value = btn.dataset.lam;
        refresh();
      });
    });
    $("use-backend").addEventListener("change", function (e) {
      useBackend = e.target.checked;
      $("backend-status").textContent = useBackend
        ? "Python backend: connecting…"
        : "Python backend: off — local JS engine";
      refresh();
    });
    window.addEventListener("resize", refresh);
    refresh();
  });
})();