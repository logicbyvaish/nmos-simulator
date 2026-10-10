"""MOSFET Lab — Flask backend.

Serves the static website from the project root and exposes
POST /api/simulate, which computes all curves with the Python model.
Run:  python app.py   →  http://localhost:5000
"""
import os

from flask import Flask, jsonify, request, send_from_directory

from mosfet import build_datasets

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
app = Flask(__name__, static_folder=ROOT, static_url_path="")


@app.get("/")
def index():
    return send_from_directory(ROOT, "index.html")


@app.post("/api/simulate")
def simulate():
    """Body: {"model":{"vt","k","lam"},"vgs","vdd","rd","vdsMax","vgsMax"}.
    Returns the same JSON shape as js/mosfet.js buildDatasets()."""
    q = request.get_json(force=True, silent=True) or {}
    return jsonify(build_datasets(q))


if __name__ == "__main__":
    print("MOSFET Lab running at http://localhost:5000  (tick 'Use Python backend' in the UI)")
    app.run(debug=True, port=5000)