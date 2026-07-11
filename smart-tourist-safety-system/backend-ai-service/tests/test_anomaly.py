import sys
import os
import pytest
import time
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# Set database path to physical file during test execution
os.environ["SHIELD_SECRET_KEY"] = "TEST_SECRET_KEY_FOR_SHIELD_PROJECT"

# Add path of main.py
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from main import app, Base, get_db, DBUser, DBTelemetryLog, DBIncident, get_password_hash

# Setup test physical SQLite database
TEST_DB_FILE = "./test_shield_safety.db"
TEST_DATABASE_URL = f"sqlite:///{TEST_DB_FILE}"
engine = create_engine(TEST_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()

app.dependency_overrides[get_db] = override_get_db

@pytest.fixture(autouse=True)
def setup_database():
    # Remove file if it somehow exists
    if os.path.exists(TEST_DB_FILE):
        try:
            os.remove(TEST_DB_FILE)
        except Exception:
            pass
            
    Base.metadata.create_all(bind=engine)
    
    # Seed dummy user for auth checks
    db = TestingSessionLocal()
    hashed_pw = get_password_hash("testpassword")
    test_user = DBUser(username="testadmin", hashed_password=hashed_pw)
    db.add(test_user)
    db.commit()
    db.close()
    
    yield
    
    # Teardown
    Base.metadata.drop_all(bind=engine)
    # Force engine disposal to close all file handles before deleting
    engine.dispose()
    if os.path.exists(TEST_DB_FILE):
        try:
            os.remove(TEST_DB_FILE)
        except Exception:
            pass

client = TestClient(app)

def test_health_check():
    response = client.get("/api/v1/ai/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ONLINE"
    assert "model" in response.json()

def test_login_and_token_verification():
    # Login with valid credentials
    response = client.post(
        "/api/v1/ai/auth/login",
        data={"username": "testadmin", "password": "testpassword"}
    )
    assert response.status_code == 200
    token_data = response.json()
    assert "access_token" in token_data
    assert token_data["token_type"] == "bearer"
    
    # Verify token
    token = token_data["access_token"]
    verify_response = client.get(
        "/api/v1/ai/auth/verify",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert verify_response.status_code == 200
    assert verify_response.json()["username"] == "testadmin"

def test_login_invalid_credentials():
    response = client.post(
        "/api/v1/ai/auth/login",
        data={"username": "testadmin", "password": "wrongpassword"}
    )
    assert response.status_code == 401

def test_predict_anomaly_safe():
    # Normal vital values with no route deviation
    payload = {
        "tokenId": 12,
        "currentLocation": {"lat": 25.5788, "lon": 91.8931},
        "plannedPath": [{"lat": 25.5788, "lon": 91.8931}],
        "heartRate": 75,
        "spo2": 98,
        "battery": 90,
        "timestamp": "2026-07-12T03:00:00Z"
    }
    response = client.post("/api/v1/ai/predict_anomaly", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["tokenId"] == 12
    assert "threatScore" in data
    assert data["safetyStatus"] in ["SAFE", "WARNING_SUSPECT"]

def test_predict_anomaly_spo2_distress():
    # Oxygen dropping critically (SPO2 = 80)
    payload = {
        "tokenId": 12,
        "currentLocation": {"lat": 25.5788, "lon": 91.8931},
        "plannedPath": [{"lat": 25.5788, "lon": 91.8931}],
        "heartRate": 75,
        "spo2": 80, # Critically low
        "battery": 90,
        "timestamp": "2026-07-12T03:00:00Z"
    }
    response = client.post("/api/v1/ai/predict_anomaly", json=payload)
    assert response.status_code == 200
    data = response.json()
    # Spo2 < 85 override sets score to at least 0.85
    assert data["threatScore"] >= 0.85
    assert data["safetyStatus"] == "CRITICAL_DISTRESS"
    assert data["severity"] == "CRITICAL"

def test_predict_anomaly_route_deviation():
    # High route deviation: current lat/lon is far from planned waypoints
    payload = {
        "tokenId": 12,
        "currentLocation": {"lat": 26.5788, "lon": 92.8931}, # Approx ~145 km away
        "plannedPath": [{"lat": 25.5788, "lon": 91.8931}],
        "heartRate": 75,
        "spo2": 98,
        "battery": 90,
        "timestamp": "2026-07-12T03:00:00Z"
    }
    response = client.post("/api/v1/ai/predict_anomaly", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["featureVector"]["routeDeviationKm"] > 5.0
    assert data["threatScore"] >= 0.70

def test_active_threats_unauthorized():
    # Accessing protected route without JWT token should fail
    response = client.get("/api/v1/ai/active_threats")
    assert response.status_code == 401

def test_active_threats_authorized():
    # Authenticate first
    login_response = client.post(
        "/api/v1/ai/auth/login",
        data={"username": "testadmin", "password": "testpassword"}
    )
    token = login_response.json()["access_token"]
    
    # Ingest a distress telemetry to trigger threat score > 0.20
    payload = {
        "tokenId": 99,
        "currentLocation": {"lat": 25.5788, "lon": 91.8931},
        "plannedPath": [{"lat": 25.5788, "lon": 91.8931}],
        "heartRate": 160, # Tachycardia spike override (>=0.75)
        "spo2": 98,
        "battery": 90,
        "timestamp": "2026-07-12T03:00:00Z"
    }
    client.post("/api/v1/ai/predict_anomaly", json=payload)
    
    # Query threats list
    threats_response = client.get(
        "/api/v1/ai/active_threats",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert threats_response.status_code == 200
    threats = threats_response.json()
    assert len(threats) >= 1
    assert threats[0]["tokenId"] == 99
    assert threats[0]["threatScore"] >= 0.75

def test_incidents_management():
    # Authenticate
    login_response = client.post(
        "/api/v1/ai/auth/login",
        data={"username": "testadmin", "password": "testpassword"}
    )
    token = login_response.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    
    # Verify no initial incidents
    response = client.get("/api/v1/ai/history", headers=headers)
    assert response.status_code == 200
    assert len(response.json()) == 0
    
    # Create incident
    incident_payload = {
        "tokenId": 99,
        "severity": "CRITICAL",
        "status": "FILED",
        "summary": "Heartbeat spiked while hiking in restricted geo-fence corridor.",
        "ledgerHash": "0x539afbcdef123456",
        "lat": 25.5788,
        "lon": 91.8931,
        "payload": {
            "tourist": {
                "name": "Devraj Baruah",
                "kyc": "4820 9021 5530"
            },
            "vitals": {
                "heartRate": 160,
                "spo2": 98,
                "battery": 90
            }
        }
    }
    create_res = client.post("/api/v1/ai/incidents", json=incident_payload, headers=headers)
    assert create_res.status_code == 200
    assert create_res.json()["status"] == "filed"
    
    # Verify incident is in database
    list_res = client.get("/api/v1/ai/history", headers=headers)
    assert list_res.status_code == 200
    assert len(list_res.json()) == 1
    assert list_res.json()[0]["caseId"].startswith("SHIELD-FIR-")
