# SHIELD - Python AI Telemetry & Behavior Anomaly Service
# Uses a real scikit-learn Isolation Forest for unsupervised anomaly detection.
# Persists records in SQLite using SQLAlchemy, provides JWT Auth and real-time WebSockets streaming.

import time
import math
import os
from typing import List, Dict, Optional
import numpy as np

from fastapi import FastAPI, HTTPException, Depends, status, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler

# SQLAlchemy imports
from sqlalchemy import create_engine, Column, Integer, Float, String, Text, ForeignKey, desc, func
from sqlalchemy.orm import declarative_base, sessionmaker, Session

# Authentication imports
from passlib.context import CryptContext
from jose import JWTError, jwt
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm

# ---------------------------------------------------------------------------
# Database Configuration & Models
# ---------------------------------------------------------------------------
DATABASE_URL = "sqlite:///./shield_safety.db"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class DBUser(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)

class DBTelemetryLog(Base):
    __tablename__ = "telemetry_logs"
    id = Column(Integer, primary_key=True, index=True)
    tokenId = Column(Integer, index=True, nullable=False)
    lat = Column(Float, nullable=False)
    lon = Column(Float, nullable=False)
    heartRate = Column(Integer, nullable=False)
    spo2 = Column(Integer, nullable=False)
    battery = Column(Integer, nullable=False)
    threatScore = Column(Float, nullable=False)
    safetyStatus = Column(String, nullable=False)
    timestamp = Column(Float, nullable=False)

class DBIncident(Base):
    __tablename__ = "incidents"
    id = Column(Integer, primary_key=True, index=True)
    caseId = Column(String, unique=True, index=True, nullable=False)
    tokenId = Column(Integer, index=True, nullable=False)
    touristName = Column(String, nullable=False)
    kycDoc = Column(String, nullable=False)
    lastGps = Column(String, nullable=False)
    heartRate = Column(Integer, nullable=False)
    spo2 = Column(Integer, nullable=False)
    battery = Column(Integer, nullable=False)
    signatureHash = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    timestamp = Column(Float, nullable=False)

Base.metadata.create_all(bind=engine)

# ---------------------------------------------------------------------------
# Security and Password Hashing Settings
# ---------------------------------------------------------------------------
SECRET_KEY = os.environ.get("SHIELD_SECRET_KEY", "SHIELD_SECRET_KEY_99_SECURE")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 120

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/ai/auth/login")

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def get_password_hash(password: str) -> str:
    """Hash password with bcrypt, truncating to 72 bytes first."""
    # Bcrypt has a hard limit of 72 bytes; truncate before hashing
    if isinstance(password, str):
        password_bytes = password.encode('utf-8')
        if len(password_bytes) > 72:
            password_bytes = password_bytes[:72]
        password = password_bytes.decode('utf-8', errors='ignore')
    return pwd_context.hash(password)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify plain password against bcrypt hash, truncating to 72 bytes first."""
    # Bcrypt has a hard limit of 72 bytes; truncate before verification
    if isinstance(plain_password, str):
        password_bytes = plain_password.encode('utf-8')
        if len(password_bytes) > 72:
            password_bytes = password_bytes[:72]
        plain_password = password_bytes.decode('utf-8', errors='ignore')
    return pwd_context.verify(plain_password, hashed_password)

def create_access_token(data: dict, expires_delta: Optional[float] = None) -> str:
    to_encode = data.copy()
    if expires_delta:
        expire = time.time() + expires_delta
    else:
        expire = time.time() + (ACCESS_TOKEN_EXPIRE_MINUTES * 60)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

# Seed default admin user if not present
def seed_admin_user():
    db = SessionLocal()
    try:
        admin_user = db.query(DBUser).filter(DBUser.username == "admin").first()
        if not admin_user:
            hashed_pw = get_password_hash("shield_admin_2026")
            new_admin = DBUser(username="admin", hashed_password=hashed_pw)
            db.add(new_admin)
            db.commit()
            print("Default admin user seeded successfully.")
    except Exception as e:
        print(f"Error seeding admin user: {e}")
    finally:
        db.close()

seed_admin_user()

async def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    
    user = db.query(DBUser).filter(DBUser.username == username).first()
    if user is None:
        raise credentials_exception
    return user

# ---------------------------------------------------------------------------
# WebSocket Connection Manager
# ---------------------------------------------------------------------------
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                # Remove stale connections
                pass

manager = ConnectionManager()

# ---------------------------------------------------------------------------
# FastAPI Initialization
# ---------------------------------------------------------------------------
app = FastAPI(
    title="SHIELD AI Telemetry & Anomaly Engine",
    description=(
        "Real-time unsupervised anomaly detection using scikit-learn Isolation Forest. "
        "Ingests multi-dimensional tourist telemetry (GPS deviation, heart-rate, SpO2, battery) "
        "and returns a calibrated threat score with severity classification, persisted in SQLite."
    ),
    version="2.1.0",
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

class IncidentPayload(BaseModel):
    tokenId: int
    severity: str
    status: str
    summary: str
    ledgerHash: str
    lat: float
    lon: float
    payload: dict

# ---------------------------------------------------------------------------
# Isolation Forest Setup
# ---------------------------------------------------------------------------
def _generate_baseline() -> np.ndarray:
    rng = np.random.default_rng(42)
    n = 400
    deviation   = rng.uniform(0.0, 1.0, n)
    heart_rate  = rng.uniform(60, 100, n)
    spo2        = rng.uniform(93, 99, n)
    battery     = rng.uniform(30, 100, n)
    hrv         = rng.uniform(30, 80, n)
    return np.column_stack([deviation, heart_rate, spo2, battery, hrv])

_baseline = _generate_baseline()
_scaler   = StandardScaler().fit(_baseline)

_model = IsolationForest(
    n_estimators=150,
    contamination=0.05,
    random_state=42,
    n_jobs=-1,
)
_model.fit(_scaler.transform(_baseline))

_telemetry_buffer: List[List[float]] = []
RETRAIN_EVERY = 50

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
    if not planned:
        return 0.0
    return min(_haversine_km(current, wp) for wp in planned)

def _hrv_proxy(hr: int) -> float:
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
    global _model, _scaler
    if len(_telemetry_buffer) < 5:
        return
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
# Authentication API Endpoints
# ---------------------------------------------------------------------------
@app.post("/api/v1/ai/auth/login")
async def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(DBUser).filter(DBUser.username == form_data.username).first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token = create_access_token(data={"sub": user.username})
    return {"access_token": access_token, "token_type": "bearer", "username": user.username}

@app.get("/api/v1/ai/auth/verify")
async def verify_token(current_user: DBUser = Depends(get_current_user)):
    return {"status": "valid", "username": current_user.username}

# ---------------------------------------------------------------------------
# Anomaly and Telemetry Endpoints
# ---------------------------------------------------------------------------
@app.post("/api/v1/ai/predict_anomaly", response_model=Dict)
async def predict_anomaly(payload: TelemetryPayload, db: Session = Depends(get_db)):
    """
    Ingest real-time telemetry, execute ML Isolation Forest inference,
    log the telemetry coordinates/scores to SQLite, and stream alerts to WebSockets.
    """
    global _telemetry_buffer
    try:
        # 1. Feature Extraction
        deviation_km = _route_deviation_km(payload.currentLocation, payload.plannedPath)
        hrv          = _hrv_proxy(payload.heartRate)
        features     = np.array([[
            deviation_km,
            float(payload.heartRate),
            float(payload.spo2),
            float(payload.battery),
            hrv,
        ]])

        # 2. ML Inference
        features_scaled = _scaler.transform(features)
        raw_score = float(_model.decision_function(features_scaled)[0])
        label     = int(_model.predict(features_scaled)[0])

        # Threat normalisation (higher is more threatening)
        threat_score = float(np.clip((raw_score * -1 + 0.5), 0.0, 1.0))

        # Physiological rules override
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
        safety_status = "CRITICAL_DISTRESS" if threat_score >= 0.75 else \
                        "WARNING_SUSPECT"   if threat_score >= 0.25 else "SAFE"

        # Buffer telemetry
        _telemetry_buffer.append(features[0].tolist())
        if len(_telemetry_buffer) >= RETRAIN_EVERY:
            _retrain_model()
            _telemetry_buffer = []

        # 3. Save to SQLite database
        db_log = DBTelemetryLog(
            tokenId=payload.tokenId,
            lat=payload.currentLocation.lat,
            lon=payload.currentLocation.lon,
            heartRate=payload.heartRate,
            spo2=payload.spo2,
            battery=payload.battery,
            threatScore=threat_score,
            safetyStatus=safety_status,
            timestamp=time.time()
        )
        db.add(db_log)
        db.commit()

        # 4. Compile response object
        report = {
            "tokenId":              payload.tokenId,
            "threatScore":          threat_score,
            "anomalyLabel":         "ANOMALY" if label == -1 else "NORMAL",
            "severity":             severity,
            "safetyStatus":         safety_status,
            "modelType":            "IsolationForest",
            "location": {
                "lat": payload.currentLocation.lat,
                "lon": payload.currentLocation.lon
            },
            "featureVector": {
                "routeDeviationKm": round(deviation_km, 3),
                "heartRate":        payload.heartRate,
                "spo2":             payload.spo2,
                "battery":          payload.battery,
                "hrvProxy":         round(hrv, 2),
            },
            "bufferSize":           len(_telemetry_buffer),
            "timestamp":            db_log.timestamp,
        }

        # 5. Live Alert Streaming: broadcast anomalies (threatScore > 0.20)
        if threat_score > 0.20:
            await manager.broadcast({
                "type": "telemetry_anomaly",
                "payload": report
            })

        return report
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI Engine failure: {str(e)}")

@app.get("/api/v1/ai/active_threats")
async def get_active_threats(db: Session = Depends(get_db), current_user: DBUser = Depends(get_current_user)):
    """
    Protected Endpoint: Returns all high-threat records sorted by severity.
    Reads from SQLite to query recently logged telemetry.
    """
    # Fetch most recent logs for each unique token within the last 15 minutes
    time_limit = time.time() - 900
    subquery = db.query(
        DBTelemetryLog.tokenId,
        func.max(DBTelemetryLog.timestamp).label("max_ts")
    ).filter(DBTelemetryLog.timestamp > time_limit).group_by(DBTelemetryLog.tokenId).subquery()

    latest_logs = db.query(DBTelemetryLog).join(
        subquery,
        (DBTelemetryLog.tokenId == subquery.c.tokenId) & 
        (DBTelemetryLog.timestamp == subquery.c.max_ts)
    ).filter(DBTelemetryLog.threatScore > 0.20).order_by(desc(DBTelemetryLog.threatScore)).all()

    threats = []
    for log in latest_logs:
        threats.append({
            "tokenId": log.tokenId,
            "threatScore": log.threatScore,
            "safetyStatus": log.safetyStatus,
            "severity": _severity_from_score(log.threatScore),
            "featureVector": {
                "heartRate": log.heartRate,
                "spo2": log.spo2,
                "battery": log.battery,
                "lat": log.lat,
                "lon": log.lon
            },
            "timestamp": log.timestamp
        })
    return threats

# ---------------------------------------------------------------------------
# Incidents / E-FIR History Management Endpoints (Persisted in SQLite)
# ---------------------------------------------------------------------------
@app.get("/api/v1/ai/history")
async def list_incidents(db: Session = Depends(get_db), current_user: DBUser = Depends(get_current_user)):
    """
    Protected Endpoint: Retrieves list of filed E-FIRs from SQLite database.
    """
    incidents = db.query(DBIncident).order_by(desc(DBIncident.timestamp)).all()
    return incidents

@app.post("/api/v1/ai/incidents")
async def create_incident(payload: IncidentPayload, db: Session = Depends(get_db), current_user: DBUser = Depends(get_current_user)):
    """
    Protected Endpoint: Files a new incident case report (E-FIR) in the database.
    """
    case_id = f"SHIELD-FIR-{payload.ledgerHash[:8].upper()}" if payload.ledgerHash else f"SHIELD-FIR-{int(time.time())}"
    
    existing = db.query(DBIncident).filter(DBIncident.caseId == case_id).first()
    if existing:
        return {"status": "filed", "caseId": case_id, "timestamp": existing.timestamp}

    tourist_name = payload.payload.get("tourist", {}).get("name", "Unknown")
    kyc_doc = payload.payload.get("tourist", {}).get("kyc", "N/A")
    heart_rate = payload.payload.get("vitals", {}).get("heartRate", 72)
    spo2 = payload.payload.get("vitals", {}).get("spo2", 98)
    battery = payload.payload.get("vitals", {}).get("battery", 100)

    new_incident = DBIncident(
        caseId=case_id,
        tokenId=payload.tokenId,
        touristName=tourist_name,
        kycDoc=kyc_doc,
        lastGps=f"{payload.lat}, {payload.lon}",
        heartRate=heart_rate,
        spo2=spo2,
        battery=battery,
        signatureHash=payload.ledgerHash,
        description=payload.summary,
        timestamp=time.time()
    )
    db.add(new_incident)
    db.commit()
    db.refresh(new_incident)
    
    # Broadcast incident created event
    await manager.broadcast({
        "type": "incident_created",
        "payload": {
            "caseId": new_incident.caseId,
            "touristName": new_incident.touristName,
            "signatureHash": new_incident.signatureHash,
            "timestamp": new_incident.timestamp
        }
    })
    
    return {"status": "filed", "caseId": new_incident.caseId, "timestamp": new_incident.timestamp}

# ---------------------------------------------------------------------------
# WebSocket Alert Broadcast Terminal
# ---------------------------------------------------------------------------
@app.websocket("/api/v1/ai/ws")
async def websocket_endpoint(websocket: WebSocket, token: Optional[str] = None, db: Session = Depends(get_db)):
    """
    WebSocket endpoint for real-time alert broadcasts.
    Verifies JWT token passed as query param to secure connection.
    """
    if not token:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
    except JWTError:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    # User authenticated, establish connection
    await manager.connect(websocket)
    try:
        # Keep connection open. Can receive control signals here if needed.
        while True:
            data = await websocket.receive_text()
            # Echo or process client command ping
            await websocket.send_json({"event": "pong", "time": time.time()})
    except WebSocketDisconnect:
        manager.disconnect(websocket)

# ---------------------------------------------------------------------------
# Health and Info Endpoints
# ---------------------------------------------------------------------------
@app.get("/api/v1/ai/model_info")
async def model_info(db: Session = Depends(get_db)):
    total_telemetry = db.query(DBTelemetryLog).count()
    total_incidents = db.query(DBIncident).count()
    return {
        "model":           "IsolationForest",
        "n_estimators":    150,
        "contamination":   0.05,
        "baseline_size":   len(_baseline),
        "buffer_size":     len(_telemetry_buffer),
        "retrain_every":   RETRAIN_EVERY,
        "database":        "SQLite (SQLAlchemy)",
        "total_logs":      total_telemetry,
        "total_incidents": total_incidents,
        "status":          "ONLINE",
        "timestamp":       time.time(),
    }

@app.get("/api/v1/ai/health")
async def health_check():
    return {"status": "ONLINE", "model": "IsolationForest", "db_driver": "sqlite/sqlalchemy", "timestamp": time.time()}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
