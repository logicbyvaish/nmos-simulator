"""MOSFET square-law model with channel-length modulation.

Mirrors js/mosfet.js exactly, so the Flask API returns the same JSON
shape the local JS engine produces.
Calibrated to the IRF540NPbF datasheet (V_GS(th) 2.0-4.0 V, R_DS(on) 44 mOhm).
"""
from dataclasses import dataclass


@dataclass
class Model:
    vt: float = 3.0   # threshold voltage [V] (datasheet: 2.0 - 4.0 V)
    k: float = 1.35    # transconductance factor [A/V^2]
    lam: float = 0.02  # channel-length modulation [1/V]


def _model(m) -> Model:
    if isinstance(m, Model):
        return m
    return Model(vt=float(m.get("vt", 3.0)),
                 k=float(m.get("k", 1.35)),
                 lam=float(m.get("lam", 0.02)))


def drain_current(vgs: float, vds: float, m) -> float:
    m = _model(m)
    vov = vgs - m.vt
    if vds <= 0 or vov <= 0:
        return 0.0
    vdsat = min(vds, vov)
    return max(0.0, m.k * (vov * vdsat - vdsat * vdsat / 2.0) * (1.0 + m.lam * vds))


def operating_point(vgs: float, vdd: float, rd: float, m) -> dict:
    """Bisection solve of the DC load line: I_D(V_DS) = (V_DD - V_DS)/R_D."""
    m = _model(m)
    lo, hi = 0.0, float(vdd)
    for _ in range(80):
        mid = (lo + hi) / 2.0
        if drain_current(vgs, mid, m) > (vdd - mid) / rd:
            hi = mid
        else:
            lo = mid
    vds = (lo + hi) / 2.0
    return {"vds": vds, "id": drain_current(vgs, vds, m)}


def region_of(vgs: float, vds: float, m) -> str:
    m = _model(m)
    if vgs <= m.vt:
        return "Cutoff"
    return "Triode (Ohmic)" if vds < vgs - m.vt else "Saturation"


def build_datasets(q: dict) -> dict:
    m = _model(q.get("model", {}))
    vgs = float(q.get("vgs", 10.0))
    vdd = float(q.get("vdd", 24.0))
    rd = float(q.get("rd", 10.0))
    vds_max = float(q.get("vdsMax", 40.0))
    vgs_max = float(q.get("vgsMax", 12.0))

    n = 240
    fam_x = [vds_max * i / n for i in range(n + 1)]

    g0 = max(m.vt + 0.75, m.vt * 1.25)
    top = max(vgs_max, g0 + 0.1)
    gates = [g0 + (top - g0) * i / 5 for i in range(6)]

    family = {
        "x": fam_x,
        "series": [
            {"label": "VGS = %.1f V" % g, "y": [drain_current(g, x, m) for x in fam_x]}
            for g in gates
        ],
    }
    lx_max = min(vdd, vds_max)
    family["load"] = {
        "x": [lx_max * i / 60 for i in range(61)],
        "y": [(vdd - lx_max * i / 60) / rd for i in range(61)],
    }

    iv = {
        "x": fam_x,
        "series": [{"label": "ID @ VGS = %.1f V" % vgs,
                    "y": [drain_current(vgs, x, m) for x in fam_x]}],
    }

    t_max = vgs_max + 3.0
    t_x = [t_max * i / 200 for i in range(201)]
    transfer = {
        "x": t_x,
        "series": [{"label": "ID (VDS = VDD)",
                    "y": [drain_current(x, vdd, m) for x in t_x]}],
    }
    vin_vout = {
        "x": t_x,
        "series": [{"label": "Vout",
                    "y": [max(0.0, operating_point(x, vdd, rd, m)["vds"]) for x in t_x]}],
    }

    o = operating_point(vgs, vdd, rd, m)
    vds_o, id_o = o["vds"], o["id"]
    op = {
        "vds": vds_o,
        "id": id_o,
        "region": region_of(vgs, vds_o, m),
        "pd": id_o * vds_o,
        "rds": (vds_o / id_o) if id_o > 1e-6 else None,
        "gfs": m.k * (vgs - m.vt) if vgs > m.vt else 0.0,
        "warnCurrent": id_o > 33.0,
        "warnPower": id_o * vds_o > 130.0,
    }
    iv["op"] = {"x": vds_o, "y": id_o}
    vin_vout["op"] = {"x": vgs, "y": vds_o}

    return {"family": family, "iv": iv, "transfer": transfer,
            "vinVout": vin_vout, "op": op}