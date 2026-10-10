# MOSFET Lab ⚡

Interactive n-channel MOSFET simulator (IRF540N-calibrated) with a dark
neon UI. Tune V_GS, V_T, k, λ, V_DD, R_D and sweep limits, and watch four
charts update live:

1. **Drain characteristics** — I_D vs V_DS family + DC load line + operating point
2. **Output I–V** at the selected V_GS with the V_DS = V_GS − V_T boundary
3. **Gate / transfer characteristics** — I_D vs V_GS
4. **Amplifier transfer** — V_in vs V_out (common-source stage)

## Model

Square-law MOSFET model with channel-length modulation:

- Triode (V_DS < V_GS − V_T): I_D = k[(V_GS − V_T)V_DS − V_DS²/2](1 + λV_DS)
- Saturation (V_DS ≥ V_GS − V_T): I_D = ½k(V_GS − V_T)²(1 + λV_DS)

The DC operating point solves I_D(V_DS) = (V_DD − V_DS)/R_D by bisection.

## Run

**A. Zero install:** open `index.html` in a browser. Physics runs in JS.

**B. Python backend:**
    cd server
    python -m venv .venv && source .venv/bin/activate
    pip install -r requirements.txt
    python app.py
Open http://localhost:5000 and enable **"Use Python backend (Flask)"**.
`POST /api/simulate` accepts the slider state as JSON and returns all
curves computed in `mosfet.py` — identical shape to the local engine.

**C. TypeScript (optional rebuild of js/mosfet.js):**
    npx tsc ts/mosfet.ts --outFile js/mosfet.js --target es2017 --lib es2017,dom

## Calibration (IRF540NPbF datasheet)

| Parameter | Default | Datasheet |
|---|---|---|
| V_T | 3.0 V | V_GS(th) = 2.0–4.0 V |
| k | 1.35 A/V² | fits ≈33 A @ V_GS = 10 V |
| I_D limit | 33 A warning | continuous drain current @ 25 °C |
| P_D limit | 130 W warning | max power dissipation |

Educational tool — not a SPICE replacement.