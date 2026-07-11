# 🛡️ SHIELD — Smart Tourist Safety Monitoring & Incident Response System

> A next-generation digital safety ecosystem for tourists powered by **AI**, **Blockchain**, and **Geo-Fencing** technologies.

![SHIELD Dashboard](https://img.shields.io/badge/Status-Production%20Ready-brightgreen?style=for-the-badge)
![Tech](https://img.shields.io/badge/Stack-HTML%20%7C%20CSS%20%7C%20JavaScript-blue?style=for-the-badge)
![License](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)

---

## 🌟 Features

### 🪪 Digital Tourist ID Platform
- Blockchain-based secure digital ID generation at entry points
- KYC integration (Aadhaar / Passport) with trip itinerary embedding
- Emergency contacts stored on-chain with tamper-proof validation
- Time-limited IDs valid only for the duration of the visit

### 📱 Tourist Mobile Safety Simulator
- **Auto-assigned Safety Score** based on real-time travel patterns & area sensitivity
- **Geo-Fencing Alerts** when entering high-risk or restricted zones
- **SOS Panic Button** — instantly notifies nearest police unit and emergency contacts
- **Real-time GPS tracking** with draggable location simulation on interactive SVG map
- **IoT Wearable Integration** — pulse rate, battery, and connectivity simulation

### 🤖 AI-Based Anomaly Detection
- Detects location drop-offs, prolonged inactivity, and behavioral anomalies
- Real-time alert generation with severity classification (LOW / MEDIUM / HIGH / CRITICAL)
- Automated pattern analysis engine with confidence scoring

### 🏛️ Authority Command Dashboard
- Live heatmap with tourist density visualization
- Active alert management with response assignment
- Blockchain ledger audit trail with integrity verification
- E-FIR (Electronic First Information Report) automated generation

### 🌐 Multi-Language Support
- 11 languages: English, Hindi, Tamil, Telugu, Kannada, Malayalam, Bengali, Gujarati, Marathi, Punjabi, Urdu

---

## 🗂️ Project Structure

```
smart-tourist-safety-system/
├── index.html                      # Main cockpit UI (3-column responsive layout)
├── styles.css                      # Cyberpunk dark-mode design system
├── app.js                          # Core logic engine (blockchain, geo-fence, SOS)
├── blockchain.js                   # Custom SHA-256 cryptographic ledger
├── languages.js                    # 11-language translation dictionary
├── docker-compose.yml              # Orchestration for backend microservices
├── backend-ai-service/             # Python FastAPI AI anomaly detection service
├── backend-blockchain-contract/    # Node.js smart contract service (Ethereum/Ganache)
└── backend-gis-service/            # Node.js GIS & geo-fencing microservice
```

---

## 🚀 Quick Start

### Frontend (No Install Required)
Simply open `smart-tourist-safety-system/index.html` in any modern browser.

### Backend Microservices (Docker Required)
```bash
# Install Docker Desktop first, then:
cd smart-tourist-safety-system
docker compose up --build -d
```

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla HTML5, CSS3, JavaScript (ES6+) |
| Design | Glassmorphism, Cyberpunk dark-mode, CSS animations |
| Blockchain | Custom SHA-256 cryptographic ledger (client-side) |
| Maps | Custom SVG vector map with geo-fence overlays |
| AI Engine | Simulated anomaly detection (extendable to real ML models) |
| Backend | Python FastAPI, Node.js Express |
| Containerization | Docker & Docker Compose |
| Fonts | Google Fonts (Inter, Outfit) |

---

## 📸 System Modules

- **Registration Panel** — Issue blockchain-backed digital tourist IDs
- **Mobile Safety Cockpit** — Simulated tourist smartphone with live telemetry
- **Control Center Map** — SVG geo-fence map with zone risk overlays
- **AI Threat Monitor** — Real-time anomaly detection alerts
- **Blockchain Ledger** — Tamper-proof transaction audit trail
- **E-FIR Generator** — One-click incident report generation

---

## 📄 License

This project is licensed under the **MIT License**.

---

## 🤝 Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

---

*Built with ❤️ for Smart Tourism Safety*
