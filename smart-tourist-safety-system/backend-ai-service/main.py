# SHIELD - Python AI Telemetry & Behavior Anomaly Service
# Uses a real scikit-learn Isolation Forest for unsupervised anomaly detection.
# The model is seeded with synthetic baseline data on startup and retrained
# incrementally as new telemetry arrives — no labelled data required.

import time
import math
import numpy as np
from typing import List, Dict
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler

app = FastAPI(
    title="SHIELD AI Telemetry & Anomaly Engine",
    description=(
        "Real-time unsupervised anomaly detection using scikit-learn Isolation Forest. "
        "Ingests multi-dimensional tourist telemetry (GPS deviation, heart-rate, SpO2, battery) "
        "and returns a calibrated threat score with severity classification."
    ),
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------

class Coordinate(BaseModel):
    lat: float
    lon: float

class TelemetryPayload(BaseModel):
    tokenId: int
    currentLocation: Coordinate
    plannedPath: List[Coordinate]
    heartRate: int
    spo2: int
    battery: int
    timestamp: str

# ---------------------------------------------------------------------------
# Isolation Forest — seeded with realistic baseline tourist telemetry
# Features: [route_deviation_km, heart_rate, spo2, battery, hr_variability]
# ---------------------------------------------------------------------------

def _generate_baseline() -> np.ndarray:
    """
    Synthesise ~400 'normal' tourist telemetry samples so the model has a
    meaningful reference distribution from the moment it starts.
    Normal ranges:  deviation 0–1 km | HR 60–100 | SpO2 93–99 | batt 30–100
    """
    rng = np.random.default_rng(42)
    n = 400
    deviation   = rng.uniform(0.0, 1.0, n)
    heart_rate  = rng.uniform(60, 100, n)
    spo2        = rng.uniform(93, 99, n)
    battery     = rng.uniform(30, 100, n)
    hrv         = rng.uniform(30, 80, n)          # heart-rate variability proxy
    return np.column_stack([deviation, heart_rate, spo2, battery, hrv])

_baseline = _generate_baseline()
_scaler   = StandardScaler().fit(_baseline)

# contamination=0.05 → model expects ~5 % of incoming data to be anomalous
_model = IsolationForest(
    n_estimators=150,
    contamination=0.05,
    random_state=42,
    n_jobs=-1,
)
_model.fit(_scaler.transform(_baseline))

# Rolling buffer — retrain every 50 new readings to keep the model fresh
_telemetry_buffer: List[List[float]] = []
RETRAIN_EVERY = 50

# In-memory registry of processed payloads
ACTIVE_ANOMALY_REGISTRY: Dict[int, dict] = {}

# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------

def _haversine_km(p1: Coordinate, p2: Coordinate) -> float:
    R = 6371.0
    lat1, lon1 = math.radians(p1.lat), math.radians(p1.lon)
    lat2, lon2 = math.radians(p2.lat), math.radians(p2.lon)
    dlat, dlon = lat2 - lat1, lon2 - lon1
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _route_deviation_km(current: Coordinate, planned: List[Coordinate]) -> float:
    """Minimum Haversine distance from current position to any planned waypoint."""
    if not planned:
        return 0.0
    return min(_haversine_km(current, wp) for wp in planned)


def _hrv_proxy(hr: int) -> float:
    """
    Simple proxy for HRV: deviation from resting norm (72 BPM).
    Higher absolute deviation → lower HRV → higher stress indicator.
    Mapped to 0–100 range for feature parity.
    """
    return float(np.clip(abs(hr - 72) * 1.5, 0, 100))


def _severity_from_score(score: float) -> str:
    if score >= 0.75:
        return "CRITICAL"
    if score >= 0.50:
        return "HIGH"
    if score >= 0.25:
        return "MEDIUM"
    return "LOW"


def _retrain_model() -> None:
    """
    Incrementally retrain the Isolation Forest on the rolling buffer
    combined with the original baseline to prevent concept drift.
    """
    global _model, _scaler
    new_data  = np.array(_telemetry_buffer)
    combined  = np.vstack([_baseline, new_data])
    _scaler   = StandardScaler().fit(combined)
    _model    = IsolationForest(
        n_estimators=150,
        contamination=0.05,
        random_state=42,
        n_jobs=-1,
    )
    _model.fit(_scaler.transform(combined))

# ---------------------------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------------------------

@app.post("/api/v1/ai/predict_anomaly", response_model=Dict)
async def predict_anomaly(payload: TelemetryPayload):
    """
    Main telemetry intake — runs Isolation Forest inference on every request.

    Feature vector:
      [route_deviation_km, heart_rate, spo2, battery, hrv_proxy]

    The Isolation Forest returns an anomaly score in [-1, 1] which is
    normalised to a human-readable threat score in [0, 1].
    """
    global _telemetry_buffer

    try:
        # 1. Build feature vector
        deviation_km = _route_deviation_km(payload.currentLocation, payload.plannedPath)
        hrv          = _hrv_proxy(payload.heartRate)
        features     = np.array([[
            deviation_km,
            float(payload.heartRate),
            float(payload.spo2),
            float(payload.battery),
            hrv,
        ]])

        # 2. Scale & run Isolation Forest
        features_scaled = _scaler.transform(features)

        # decision_function → negative = more anomalous
        raw_score = float(_model.decision_function(features_scaled)[0])   # typically [-0.5, 0.5]
        label     = int(_model.predict(features_scaled)[0])               # -1 anomaly, 1 normal

        # Normalise raw_score to [0, 1]: more negative → higher threat
        threat_score = float(np.clip((raw_score * -1 + 0.5), 0.0, 1.0))

        # 3. Rule-based overrides for critical physiological thresholds
        #    (Isolation Forest may miss these in small buffers)
        if payload.spo2 < 85:
            threat_score = max(threat_score, 0.85)
        if payload.heartRate > 150 or payload.heartRate < 40:
            threat_score = max(threat_score, 0.75)
        if deviation_km > 5.0:
            threat_score = max(threat_score, 0.70)
        if payload.battery < 10:
            threat_score = max(threat_score, 0.55)

        threat_score = round(min(threat_score, 1.0), 3)
        severity     = _severity_from_score(threat_score)

        # 4. Buffer telemetry & retrain periodically
        _telemetry_buffer.append(features[0].tolist())
        if len(_telemetry_buffer) >= RETRAIN_EVERY:
            _retrain_model()
            _telemetry_buffer = []

        # 5. Compile response
        report = {
            "tokenId":              payload.tokenId,
            "threatScore":          threat_score,
            "anomalyLabel":         "ANOMALY" if label == -1 else "NORMAL",
            "severity":             severity,
            "safetyStatus":         "CRITICAL_DISTRESS" if threat_score >= 0.75 else
                                    "WARNING_SUSPECT"   if threat_score >= 0.25 else "SAFE",
            "modelType":            "IsolationForest",
            "featureVector": {
                "routeDeviationKm": round(deviation_km, 3),
                "heartRate":        payload.heartRate,
                "spo2":             payload.spo2,
                "battery":          payload.battery,
                "hrvProxy":         round(hrv, 2),
            },
            "bufferSize":           len(_telemetry_buffer),
            "timestamp":            time.time(),
        }

        ACTIVE_ANOMALY_REGISTRY[payload.tokenId] = report
        return report

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI Engine failure: {str(e)}")


@app.get("/api/v1/ai/active_threats")
async def get_active_threats():
    """Return all tourists with threat score > 0.20, sorted by severity."""
    return sorted(
        [v for v in ACTIVE_ANOMALY_REGISTRY.values() if v["threatScore"] > 0.20],
        key=lambda x: x["threatScore"],
        reverse=True,
    )


@app.get("/api/v1/ai/model_info")
async def model_info():
    """Return current model configuration and buffer stats."""
    return {
        "model":           "IsolationForest",
        "n_estimators":    150,
        "contamination":   0.05,
        "baseline_size":   len(_baseline),
        "buffer_size":     len(_telemetry_buffer),
        "retrain_every":   RETRAIN_EVERY,
        "features":        ["route_deviation_km", "heart_rate", "spo2", "battery", "hrv_proxy"],
        "status":          "ONLINE",
        "timestamp":       time.time(),
    }


@app.get("/api/v1/ai/health")
async def health_check():
    return {"status": "ONLINE", "model": "IsolationForest", "timestamp": time.time()}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
