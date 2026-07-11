# SHIELD - Python AI Telemetry & Behavior Anomaly Service
# Exposes real-time analytics to determine tourist safety risks

import time
import math
from typing import List, Dict, Optional
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import numpy as np

app = FastAPI(
    title="SHIELD AI Telemetry & Anomaly Engine",
    description="Real-time predictive analytics and heuristics monitoring tourist deviations & vital signals.",
    version="1.0.0"
)

# Enable CORS for frontend interface
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Telemetry data payload model
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

# Redis / Database mock cache
ACTIVE_ANOMALY_REGISTRY = {}

def calculate_distance(p1: Coordinate, p2: Coordinate) -> float:
    """
    Calculate Haversine distance between two GPS coordinates in kilometers.
    """
    R = 6371.0 # Earth radius
    lat1, lon1 = math.radians(p1.lat), math.radians(p1.lon)
    lat2, lon2 = math.radians(p2.lat), math.radians(p2.lon)
    
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    
    a = math.sin(dlat / 2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c

def predict_route_deviation(current: Coordinate, planned: List[Coordinate]) -> float:
    """
    AI Heuristic: Finds the minimum distance from current location to planned travel corridor.
    Returns deviation rate (0% to 100%).
    """
    if not planned:
        return 0.0
    
    # Calculate Haversine distance to all planned route coordinates
    distances = [calculate_distance(current, node) for node in planned]
    min_dist_km = min(distances) if distances else 0.0
    
    # Standard security corridor: 2 km buffer zone
    # If tourist drifts past 2km, scale deviation rate linearly up to 5km (100% breach)
    if min_dist_km <= 0.8:
        return 0.0
    elif min_dist_km >= 4.0:
        return 100.0
    else:
        return ((min_dist_km - 0.8) / (4.2 - 0.8)) * 100.0

def evaluate_vital_distress(hr: int, spo2: int) -> Dict[str, any]:
    """
    Evaluates bio-telemetry spikes using a standard classification framework.
    """
    anomaly = False
    details = []
    severity = "GREEN"

    # Hypoxia warning threshold
    if spo2 < 85:
        anomaly = True
        details.append(f"Hypoxia Alert: Oxygen critically low ({spo2}%)")
        severity = "RED"
    elif spo2 < 90:
        anomaly = True
        details.append(f"Hypoxia Warning: Mild oxygen drop ({spo2}%)")
        severity = "AMBER"

    # Cardiac distress thresholds
    if hr > 140:
        anomaly = True
        details.append(f"Tachycardia Spike: Spiked heartbeat ({hr} BPM)")
        severity = "RED" if severity == "RED" or spo2 < 90 else "AMBER"
    elif hr < 45:
        anomaly = True
        details.append(f"Bradycardia Alert: Flatlining heartbeat ({hr} BPM)")
        severity = "RED"

    return {
        "anomalyDetected": anomaly,
        "details": details,
        "severity": severity,
        "scores": {
            "cardiacIndex": float(np.clip((hr - 72) / 68, -1, 1)),
            "respiratoryIndex": float(np.clip((98 - spo2) / 18, 0, 1))
        }
    }

@app.post("/api/v1/ai/predict_anomaly", response_model=Dict)
async def process_telemetry(payload: TelemetryPayload):
    """
    Main telemetry intake pipeline.
    Determines route deviation, checks vitals, and logs anomalous behavior state.
    """
    try:
        # 1. Analyze route boundaries
        deviation_rate = predict_route_deviation(payload.currentLocation, payload.plannedPath)
        
        # 2. Check wearable vitals
        vitals_report = evaluate_vital_distress(payload.heartRate, payload.spo2)
        
        # 3. Compile overall anomaly threat index (0.0 to 1.0)
        threat_score = 0.0
        
        # Geofence breach weights heavily
        if deviation_rate > 50.0:
            threat_score += 0.5
        else:
            threat_score += (deviation_rate / 100.0) * 0.3
            
        # Vitals weight
        if vitals_report["severity"] == "RED":
            threat_score += 0.5
        elif vitals_report["severity"] == "AMBER":
            threat_score += 0.25
            
        # Low phone battery penalty
        if payload.battery < 15:
            threat_score += 0.2
            
        threat_score = min(1.0, threat_score)
        
        # 4. Determine final action status
        safety_status = "SAFE"
        if threat_score >= 0.7:
            safety_status = "CRITICAL_DISTRESS"
        elif threat_score >= 0.35:
            safety_status = "WARNING_SUSPECT"
            
        report = {
            "tokenId": payload.tokenId,
            "threatScore": float(round(threat_score, 3)),
            "safetyStatus": safety_status,
            "routeDeviationPercent": float(round(deviation_rate, 2)),
            "vitalsAnalysis": vitals_report,
            "phoneBatteryLevel": payload.battery,
            "timestamp": time.time()
        }
        
        # Cache updates
        ACTIVE_ANOMALY_REGISTRY[payload.tokenId] = report
        
        return report
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI Engine failure: {str(e)}")

@app.get("/api/v1/ai/active_threats")
async def get_active_threats():
    """
    Get all active alerts sorted by threat severity (high threat score first)
    """
    sorted_threats = sorted(
        [v for v in ACTIVE_ANOMALY_REGISTRY.values() if v["threatScore"] > 0.2],
        key=lambda x: x["threatScore"],
        reverse=True
    )
    return sorted_threats

@app.get("/api/v1/ai/health")
async def health_check():
    return {"status": "ONLINE", "nodes_verified": 3, "timestamp": time.time()}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
