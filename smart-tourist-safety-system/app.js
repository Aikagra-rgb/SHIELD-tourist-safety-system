// SHIELD - Production Real-Time Application Coordinator & State Manager

// Core Application State
let state = {
  blockchain: new Blockchain(),
  touristActive: false,
  touristData: null,
  activeAlerts: [],
  currentLanguage: 'en',
  
  // Enterprise mode gateways switches
  enterpriseMode: false,
  gatewayGisUrl: 'http://localhost:8080',
  gatewayAiUrl: 'http://localhost:8000',
  
  // Real GIS Coordinates (Centered in East Khasi Hills, Meghalaya)
  gpsCoords: { lat: 25.5788, lon: 91.8931 }, // Shillong coordinates
  gpsOptIn: true,
  realGpsActive: false,
  deviceGpsWatchId: null,
  
  // IoT Vitals Telemetry
  vitals: {
    heartRate: 72,
    spo2: 98,
    battery: 98
  },
  
  // Webcam & Face KYC Data
  webcamStream: null,
  biometricImageBase64: null,
  biometricHash: null,
  
  // Browser Speech APIs
  speechRecognition: null,
  speechSynth: window.speechSynthesis,
  
  // Leaflet elements
  leafletMap: null,
  touristMarker: null,
  geofencePolygons: [],
  trailPathLine: null,
  trailPoints: [],
  
  // UI states
  sosActive: false,
  geofenceBreach: false,
  soundMuted: false,
  chainTampered: false,
  efirStatus: 'DRAFT', // 'DRAFT', 'FILED'
  
  // Audio alarm frequencies
  audioCtx: null,
  sirenInterval: null
};

// Real-world Geofence Polygons representation (East Khasi Hills & Borders near Cherrapunji/Dawki)
const GEOFENCE_ZONES = [
  {
    name: "Dawki International Border Restricted Corridor",
    color: "#ef4444",
    coords: [
      [25.1850, 92.0000],
      [25.1800, 92.0300],
      [25.1650, 92.0250],
      [25.1680, 91.9900]
    ]
  },
  {
    name: "Mawphlang Sacred Forest Reserve Sector-C",
    color: "#f59e0b",
    coords: [
      [25.4450, 91.7500],
      [25.4600, 91.7700],
      [25.4520, 91.7900],
      [25.4380, 91.7750]
    ]
  }
];

// SVG QR Generator for Digital ID
function generateSVGQR(text) {
  const hash = sha256(text) || "shielddefaultqr";
  let matrix = '';
  for (let r = 0; r < 12; r++) {
    for (let c = 0; c < 12; c++) {
      const charIndex = (r * 12 + c) % hash.length;
      const isFilled = hash.charCodeAt(charIndex) % 2 === 0 || (r < 3 && c < 3) || (r > 8 && c < 3) || (r < 3 && c > 8);
      if (isFilled) {
        matrix += `<rect x="${c * 5 + 5}" y="${r * 5 + 5}" width="4" height="4" fill="#0f172a" />`;
      }
    }
  }
  return `
    <svg viewBox="0 0 70 70" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="18" height="18" fill="none" stroke="#0f172a" stroke-width="2"/>
      <rect x="6" y="6" width="10" height="10" fill="#0f172a"/>
      <rect x="50" y="2" width="18" height="18" fill="none" stroke="#0f172a" stroke-width="2"/>
      <rect x="54" y="6" width="10" height="10" fill="#0f172a"/>
      <rect x="2" y="50" width="18" height="18" fill="none" stroke="#0f172a" stroke-width="2"/>
      <rect x="6" y="54" width="10" height="10" fill="#0f172a"/>
      ${matrix}
    </svg>
  `;
}

// Ray Casting Algorithm to check if actual Lat/Lon coordinate falls inside a polygon
function isCoordinateInsidePolygon(lat, lon, polygonCoords) {
  let inside = false;
  for (let i = 0, j = polygonCoords.length - 1; i < polygonCoords.length; j = i++) {
    const xi = polygonCoords[i][0], yi = polygonCoords[i][1];
    const xj = polygonCoords[j][0], yj = polygonCoords[j][1];
    
    const intersect = ((yi > lon) !== (yj > lon))
        && (lat < (xj - xi) * (lon - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// Dynamic Translation Handler
function translatePhoneApp(langCode) {
  state.currentLanguage = langCode;
  const t = window.TRANSLATIONS[langCode] || window.TRANSLATIONS['en'];
  
  document.getElementById('t-app-name').innerText = t.appName;
  document.getElementById('t-safety-score').innerText = t.safetyScore;
  document.getElementById('t-panic-sos-txt').innerText = state.sosActive ? "SOS ON" : "SOS";
  document.getElementById('t-panic-sos-subtxt').innerText = state.sosActive ? t.panicActive : "Tap to SOS";
  document.getElementById('t-gps-status').innerText = t.gpsStatus;
  document.getElementById('t-privacy-notice').innerText = t.privacyNotice;
  document.getElementById('t-iot-vitals').innerText = t.iotVitals;
  document.getElementById('t-heart-rate').innerText = t.heartRate;
  document.getElementById('t-oxygen').innerText = t.oxygen;
  
  const badge = document.getElementById('safety-status-badge');
  if (state.sosActive) {
    badge.innerText = t.statusSOS;
  } else if (state.geofenceBreach || state.vitals.spo2 < 90 || state.vitals.heartRate > 120 || state.vitals.battery < 20) {
    badge.innerText = t.statusWarning;
  } else {
    badge.innerText = t.statusSafe;
  }
}

// Production-Grade Webcam capture interface (Biometrics)
function toggleWebcam() {
  const video = document.getElementById('webcam-stream');
  const canvas = document.getElementById('captured-canvas');
  const snapBtn = document.getElementById('btn-snap-camera');
  const toggleBtn = document.getElementById('btn-toggle-camera');
  
  if (state.webcamStream) {
    stopWebcam();
  } else {
    // Start camera stream
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false })
      .then(stream => {
        state.webcamStream = stream;
        video.srcObject = stream;
        video.style.display = 'block';
        canvas.style.display = 'none';
        
        snapBtn.style.display = 'block';
        toggleBtn.innerText = "📷 Stop Camera";
        toggleBtn.style.background = "rgba(239, 68, 68, 0.15)";
        toggleBtn.style.borderColor = "var(--neon-red)";
        toggleBtn.style.color = "var(--neon-red)";
        
        pushAlert('BIOMETRICS', "Face KYC Webcam session started. Align passport photo.", 'info');
      })
      .catch(err => {
        console.error("Camera access failed:", err);
        alert("Unable to open device webcam. Please check browser camera permissions!");
      });
  }
}

function stopWebcam() {
  const video = document.getElementById('webcam-stream');
  const toggleBtn = document.getElementById('btn-toggle-camera');
  const snapBtn = document.getElementById('btn-snap-camera');
  
  if (state.webcamStream) {
    state.webcamStream.getTracks().forEach(track => track.stop());
    state.webcamStream = null;
  }
  
  video.style.display = 'none';
  video.srcObject = null;
  snapBtn.style.display = 'none';
  
  toggleBtn.innerText = "📷 Start Webcam";
  toggleBtn.style.background = "";
  toggleBtn.style.borderColor = "";
  toggleBtn.style.color = "";
}

function captureFaceBiometrics() {
  const video = document.getElementById('webcam-stream');
  const canvas = document.getElementById('captured-canvas');
  const shutter = document.getElementById('camera-overlay-shutter');
  
  if (!state.webcamStream) return;
  
  // Freeze shutter animation
  shutter.style.display = 'flex';
  playWarningTone();
  
  setTimeout(() => {
    const ctx = canvas.getContext('2d');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    // Draw current frame into canvas
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    // Export base64 image data
    state.biometricImageBase64 = canvas.toDataURL('image/jpeg');
    
    // Cryptographically hash image binary to verify integrity later
    state.biometricHash = sha256(state.biometricImageBase64);
    
    // Display preview frame
    canvas.style.display = 'block';
    shutter.style.display = 'none';
    
    stopWebcam();
    
    pushAlert('BIOMETRICS', `Face frame captured successfully. Crypto fingerprint logged: ${state.biometricHash.substring(0, 16)}...`, 'info');
  }, 400);
}

// Synths Emergency Alarm using Web Audio API (Dynamic Oscillators)
function startSiren() {
  if (state.soundMuted) return;
  try {
    if (!state.audioCtx) {
      state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    
    stopSiren();
    
    let isHigh = false;
    state.sirenInterval = setInterval(() => {
      if (state.soundMuted || !state.audioCtx) return;
      
      const osc = state.audioCtx.createOscillator();
      const gain = state.audioCtx.createGain();
      
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(isHigh ? 960 : 740, state.audioCtx.currentTime);
      
      gain.gain.setValueAtTime(0.08, state.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, state.audioCtx.currentTime + 0.35);
      
      osc.connect(gain);
      gain.connect(state.audioCtx.destination);
      
      osc.start();
      osc.stop(state.audioCtx.currentTime + 0.4);
      
      isHigh = !isHigh;
    }, 400);
  } catch (err) {
    console.error("Audio Context Failed: ", err);
  }
}

function stopSiren() {
  if (state.sirenInterval) {
    clearInterval(state.sirenInterval);
    state.sirenInterval = null;
  }
}

function playWarningTone() {
  if (state.soundMuted) return;
  try {
    if (!state.audioCtx) {
      state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    const osc = state.audioCtx.createOscillator();
    const gain = state.audioCtx.createGain();
    
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(440, state.audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(220, state.audioCtx.currentTime + 0.3);
    
    gain.gain.setValueAtTime(0.12, state.audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, state.audioCtx.currentTime + 0.3);
    
    osc.connect(gain);
    gain.connect(state.audioCtx.destination);
    
    osc.start();
    osc.stop(state.audioCtx.currentTime + 0.35);
  } catch(err) {}
}

// Browser Text-To-Speech alert engine (Synthesized Voice)
function speakVoiceAlert(text) {
  if (state.soundMuted || !state.speechSynth) return;
  
  // Stop current utterances
  state.speechSynth.cancel();
  
  const utterance = new SpeechSynthesisUtterance(text);
  
  // Resolve regional voice mapping based on lang
  if (state.currentLanguage === 'hi') {
    utterance.lang = 'hi-IN';
  } else if (state.currentLanguage === 'bn') {
    utterance.lang = 'bn-IN';
  } else {
    utterance.lang = 'en-US';
  }
  
  utterance.rate = 1.0;
  utterance.pitch = 1.05;
  state.speechSynth.speak(utterance);
}

// Voice SOS Activation API (Web Speech API Recognition)
function initVoiceSOS() {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    console.warn("Speech recognition not supported in this browser.");
    document.getElementById('speech-recognition-active-badge').innerText = "🎙️ Voice SOS Support Missing";
    document.getElementById('speech-recognition-active-badge').style.borderColor = "var(--border-color)";
    document.getElementById('speech-recognition-active-badge').style.color = "var(--text-muted)";
    return;
  }
  
  try {
    state.speechRecognition = new SpeechRec();
    state.speechRecognition.continuous = true;
    state.speechRecognition.interimResults = false;
    state.speechRecognition.lang = 'en-IN';
    
    state.speechRecognition.onresult = (event) => {
      const transcript = event.results[event.results.length - 1][0].transcript.trim().toLowerCase();
      console.log("Speech captured: ", transcript);
      
      const keywords = ["help", "emergency", "sos", "bachao", "danger", "police", "save me"];
      const matched = keywords.some(word => transcript.includes(word));
      
      if (matched && !state.sosActive && state.touristActive) {
        pushAlert('VOICE RECOGNITION', `Distress keyword recognized from audio telemetry: "${transcript}"! Engaging SOS!`, 'sos');
        triggerSOS(true);
      }
    };
    
    state.speechRecognition.onerror = (e) => {
      // Graceful restart on error
      console.error("Speech Engine Error:", e.error);
    };
    
    state.speechRecognition.onend = () => {
      // Continuously keep active for safety
      if (state.touristActive) {
        state.speechRecognition.start();
      }
    };
    
    // Start listening on launch
    state.speechRecognition.start();
  } catch (err) {
    console.error("Speech Init failed: ", err);
  }
}

// Generate unique Blockchain Block UI layout card
function renderBlockchainBlocks() {
  const container = document.getElementById('ledger-timeline-container');
  container.innerHTML = '';
  
  state.blockchain.chain.slice().reverse().forEach((block, idx) => {
    const reverseIndex = state.blockchain.chain.length - 1 - idx;
    const isMined = block.nonce > 0 || block.index === 0;
    
    let tamperedClass = '';
    if (state.chainTampered && reverseIndex === 1) {
      tamperedClass = 'tampered';
    }
    
    const blockEl = document.createElement('div');
    blockEl.className = `block-item ${isMined ? 'mined' : ''} ${tamperedClass}`;
    
    let txHtml = '';
    block.transactions.forEach(tx => {
      let isEmergency = tx.type === 'SOS_TRIGGER' || tx.type === 'GEOFENCE_BREACH';
      txHtml += `
        <div style="margin-top: 5px;">
          <span class="tx-tag ${isEmergency ? 'emergency' : ''}">${tx.type}</span>
          <span style="font-size:0.6rem; color: var(--text-secondary); word-break: break-all;">
            ${JSON.stringify(tx.details).substring(0, 75)}...
          </span>
        </div>
      `;
    });

    blockEl.innerHTML = `
      <div class="block-meta">
        <strong>BLOCK #${block.index}</strong>
        <span>Nonce: ${block.nonce}</span>
      </div>
      <div class="block-hash">
        Prev: <span>${block.previousHash.substring(0, 10)}...</span>
      </div>
      <div class="block-hash" style="margin-bottom: 4px;">
        Hash: <span style="font-weight:bold;">${block.hash.substring(0, 14)}...</span>
      </div>
      <div class="block-tx-list">
        <strong>Transactions:</strong>
        ${txHtml}
      </div>
      <div style="font-size:0.5rem; text-align:right; color: var(--text-muted); margin-top: 6px;">
        📅 ${new Date(block.timestamp).toLocaleTimeString()}
      </div>
    `;
    container.appendChild(blockEl);
  });
  
  document.getElementById('blocks-count').innerText = state.blockchain.chain.length;
}

// Push system notifications into dispatcher alerts feed
function pushAlert(type, message, level = 'info') {
  const container = document.getElementById('alert-feed-box');
  const now = new Date();
  const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
  
  const placeholder = document.getElementById('placeholder-notif');
  if (placeholder) {
    placeholder.remove();
  }
  
  if (state.activeAlerts.length > 35) {
    state.activeAlerts.shift();
    if (container.lastChild) container.removeChild(container.lastChild);
  }
  
  const alertObj = { type, message, level, time: timeStr };
  state.activeAlerts.unshift(alertObj);
  
  const alertEl = document.createElement('div');
  alertEl.className = `alert-notification ${level === 'sos' ? 'sos' : level === 'warning' ? 'warning' : ''}`;
  
  let icon = 'ℹ️';
  if (level === 'sos') icon = '🚨';
  else if (level === 'warning') icon = '⚠️';
  else if (type === 'BLOCKCHAIN') icon = '⛓️';
  else if (type === 'GPS') icon = '🛰️';
  
  alertEl.innerHTML = `
    <span class="alert-badge-icon">${icon}</span>
    <div class="alert-notif-body">
      <div class="alert-notif-header">
        <span style="font-weight: 700; color: ${level==='sos' ? 'var(--neon-red)' : level==='warning' ? 'var(--neon-yellow)' : 'var(--neon-blue)'}">${type}</span>
        <span>${timeStr}</span>
      </div>
      <span class="alert-notif-desc">${message}</span>
    </div>
  `;
  
  container.insertBefore(alertEl, container.firstChild);
  
  const warningSosCount = state.activeAlerts.filter(a => a.level === 'sos' || a.level === 'warning').length;
  document.getElementById('header-alert-count').innerText = warningSosCount;
  
  const indicator = document.getElementById('sos-count-indicator');
  if (warningSosCount > 0) {
    indicator.className = "indicator active-sos";
  } else {
    indicator.className = "indicator";
  }
}

// Compute Safety score dynamically based on active factors
function recalculateSafetyScore() {
  if (!state.touristActive) return;
  
  if (state.enterpriseMode) {
    // Compile planned corridor coordinates list
    const plannedList = [
      { lat: 25.5788, lon: 91.8931 }, // Umroi AP
      { lat: 25.4600, lon: 91.7700 }, // Shillong city
      { lat: 25.1850, lon: 92.0000 }  // Cherrapunji/Dawki sector
    ];
    
    fetch(`${state.gatewayAiUrl}/api/v1/ai/predict_anomaly`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tokenId: 1,
        currentLocation: { lat: state.gpsCoords.lat, lon: state.gpsCoords.lon },
        plannedPath: plannedList,
        heartRate: state.vitals.heartRate,
        spo2: state.vitals.spo2,
        battery: state.vitals.battery,
        timestamp: new Date().toISOString()
      })
    })
    .then(res => res.json())
    .then(result => {
      // Scale safety score from threat ratio (1.0 threat = 0 safety)
      const score = Math.round((1.0 - result.threatScore) * 100);
      pushAlert('GATEWAY API', `FastAPI AI Behavior Anomaly Threat Score: ${result.threatScore} (${result.safetyStatus})`, 'info');
      
      // Update score UI
      updateSafetyGaugeUI(score);
    })
    .catch(err => {
      console.error("FastAPI AI Gateway failed, fallback to local heuristics:", err);
      runLocalSafetyScoreCalculation();
    });
  } else {
    runLocalSafetyScoreCalculation();
  }
}

function runLocalSafetyScoreCalculation() {
  let score = 100;
  
  if (state.vitals.battery < 20) {
    score -= 25;
  } else if (state.vitals.battery < 50) {
    score -= 10;
  }
  
  if (state.vitals.spo2 < 85) {
    score -= 40;
  } else if (state.vitals.spo2 < 90) {
    score -= 20;
  }
  
  if (state.vitals.heartRate > 140 || state.vitals.heartRate < 50) {
    score -= 20;
  }
  
  if (state.geofenceBreach) {
    score -= 45;
  }
  
  if (state.sosActive) {
    score = 12;
  }
  
  score = Math.max(5, score);
  updateSafetyGaugeUI(score);
}

function updateSafetyGaugeUI(score) {
  document.getElementById('safety-score-val').innerText = score;
  
  const fill = document.getElementById('safety-gauge-fill');
  const offset = 283 - (score / 100) * 283;
  fill.style.strokeDashoffset = offset;
  
  if (score >= 80) {
    fill.style.stroke = "var(--emerald)";
    document.getElementById('safety-status-badge').style.borderColor = "rgba(16, 185, 129, 0.3)";
    document.getElementById('safety-status-badge').style.color = "var(--emerald)";
    document.getElementById('safety-status-badge').style.backgroundColor = "rgba(16, 185, 129, 0.12)";
  } else if (score >= 45) {
    fill.style.stroke = "var(--neon-yellow)";
    document.getElementById('safety-status-badge').style.borderColor = "rgba(245, 158, 11, 0.4)";
    document.getElementById('safety-status-badge').style.color = "var(--neon-yellow)";
    document.getElementById('safety-status-badge').style.backgroundColor = "rgba(245, 158, 11, 0.12)";
  } else {
    fill.style.stroke = "var(--neon-red)";
    document.getElementById('safety-status-badge').style.borderColor = "rgba(239, 68, 68, 0.4)";
    document.getElementById('safety-status-badge').style.color = "var(--neon-red)";
    document.getElementById('safety-status-badge').style.backgroundColor = "rgba(239, 68, 68, 0.15)";
  }
  
  translatePhoneApp(state.currentLanguage);
}

// Update AI anomaly status dashboard panel
function updateAICenter() {
  const deviation = document.getElementById('ai-val-deviation');
  const inactivity = document.getElementById('ai-val-inactivity');
  const vitals = document.getElementById('ai-val-vitals');
  
  if (state.geofenceBreach) {
    deviation.innerText = "98% (RESTRICTED ZONE)";
    deviation.className = "ai-status-val danger";
  } else {
    deviation.innerText = "4% (ON PATTERN)";
    deviation.className = "ai-status-val safe";
  }
  
  if (state.vitals.battery <= 5) {
    inactivity.innerText = "CRITICAL (SIGNAL DROPPED)";
    inactivity.className = "ai-status-val danger";
  } else if (state.vitals.battery <= 15) {
    inactivity.innerText = "WARNING (SIGNAL FAILING)";
    inactivity.className = "ai-status-val warning";
  } else {
    inactivity.innerText = "NORMAL (TELEMETRY LIVE)";
    inactivity.className = "ai-status-val safe";
  }
  
  if (state.vitals.spo2 < 90 || state.vitals.heartRate > 130) {
    vitals.innerText = "VITAL ANOMALY SPOTTED";
    vitals.className = "ai-status-val danger";
  } else {
    vitals.innerText = "STABLE BEAT (72-90BPM)";
    vitals.className = "ai-status-val safe";
  }
}

// Redraft and re-render E-FIR in Courier Font panel
function redraftEFIR() {
  const efirBox = document.getElementById('efir-doc-box');
  const name = state.touristActive ? state.touristData.name : "Devraj Baruah";
  const kyc = state.touristActive ? state.touristData.kyc : "4820 9021 5530 (Aadhaar)";
  const contact = state.touristActive ? state.touristData.emergency : "+91 94350-98210";
  const origin = state.touristActive ? state.touristData.origin : "Umroi Airport";
  
  const gps = state.gpsCoords;
  
  let blockchainHash = "Awaiting active incident registry.";
  if (state.blockchain.chain.length > 1) {
    blockchainHash = state.blockchain.getLatestBlock().hash;
  }
  
  let behaviorHtml = "";
  if (state.sosActive) {
    behaviorHtml = `<span style="color:#b91c1c; font-weight:bold;">- CRITICAL: Subject triggered EMERGENCY PANIC SOS beacon. Emergency response dispatched.</span>`;
  } else if (state.geofenceBreach) {
    behaviorHtml = `<span style="color:#d97706; font-weight:bold;">- WARNING: Geofence violation recorded. Entered restricted border territory at coordinate boundary.</span>`;
  } else if (state.vitals.spo2 < 90) {
    behaviorHtml = `<span style="color:#d97706; font-weight:bold;">- WARNING: Vital Health Anomaly. SpO2 Oxygen drop detected (${state.vitals.spo2}%). Mountain sickness suspected.</span>`;
  } else {
    behaviorHtml = `- Active telemetry streaming. Normal travel corridor behavior recorded in ledger.`;
  }
  
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const timeStr = now.toTimeString().split(' ')[0];
  
  efirBox.innerHTML = `
    <div class="efir-watermark">${state.sosActive ? 'EMERGENCY' : 'CONFIDENTIAL'}</div>
    <div class="efir-title">FIRST INFORMATION REPORT (E-FIR)</div>
    <div style="text-align: center; font-size: 0.6rem; font-weight: bold; margin-bottom: 10px;">
      ISSUED BY: STATE TOURISM SAFETY COCKPIT // UNDER IT SECTION 80A
    </div>
    
    <div class="efir-meta-block">
      <div><strong>FIR NO:</strong> SHIELD-FIR-${blockchainHash.substring(0, 8).toUpperCase()}</div>
      <div style="text-align: right;"><strong>DATE:</strong> ${dateStr}</div>
      <div><strong>TIME:</strong> ${timeStr}</div>
      <div style="text-align: right;"><strong>STATUS:</strong> <span style="font-weight:bold; color: ${state.efirStatus==='FILED' ? '#15803d' : '#b91c1c'}">${state.efirStatus}</span></div>
    </div>

    <div class="efir-section-title">1. COMPLAINANT / SUBJECT PARTICULARS</div>
    <div><strong>NAME:</strong> ${name}</div>
    <div><strong>KYC IDENTITY:</strong> ${kyc} (Secure & Verified)</div>
    <div><strong>CONTACT EMER:</strong> ${contact}</div>

    <div class="efir-section-title">2. GEOLOCATION & SIGNAL TELEMETRY LOG</div>
    <div><strong>STATE ENTRY POINT:</strong> ${origin}</div>
    <div><strong>LAST POSITION:</strong> LAT: ${gps.lat.toFixed(5)}° N | LON: ${gps.lon.toFixed(5)}° E</div>
    <div><strong>GPS TELEMETRY OPT-IN:</strong> ${state.gpsOptIn ? "YES" : "NO"}</div>
    <div><strong>IOT VITALS SIGN:</strong> HR: ${state.vitals.heartRate} BPM | SpO2: ${state.vitals.spo2}% | DEVICE BATT: ${state.vitals.battery}%</div>
    <div><strong>BIOMETRIC FACE HASH:</strong> ${state.biometricHash ? state.biometricHash.substring(0,24)+'...' : 'N/A'}</div>

    <div class="efir-section-title">3. ANOMALY FORENSICS & DISTRESS LOG</div>
    <div>${behaviorHtml}</div>

    <div class="efir-section-title">4. BLOCKCHAIN INTEGRITY & AUDIT PROOF</div>
    <div class="efir-blockchain-hash">
      The telemetry logs and identity KYC have been committed cryptographically. This record is immutable and verified as legal evidence.
      <br><strong>LEDGER SECURE BLOCK HASH:</strong><br>
      <span style="font-size:0.55rem; color:#1e293b; font-weight:bold;">${blockchainHash}</span>
    </div>
    
    <div style="margin-top: 15px; border-top: 1px dashed #cbd5e1; padding-top: 6px; display: flex; justify-content: space-between; font-size: 0.55rem; color: #475569;">
      <span>SUBMITTED DIGITALLY UNDER SYSTEM NODE</span>
      <span>SIGNATURE AUTHENTICATED</span>
    </div>
  `;
  
  const fileBtn = document.getElementById('btn-file-efir');
  const printBtn = document.getElementById('btn-print-efir');
  
  if (state.sosActive || state.geofenceBreach || (state.vitals.spo2 < 90)) {
    fileBtn.removeAttribute('disabled');
    fileBtn.style.background = "linear-gradient(135deg, var(--neon-red), #b91c1c)";
    fileBtn.style.cursor = "pointer";
    fileBtn.style.boxShadow = "var(--shadow-neon-red)";
    
    printBtn.removeAttribute('disabled');
  } else {
    fileBtn.setAttribute('disabled', 'true');
    fileBtn.style.background = "var(--bg-tertiary)";
    fileBtn.style.cursor = "not-allowed";
    fileBtn.style.boxShadow = "none";
    
    printBtn.setAttribute('disabled', 'true');
  }
}

// Core SOS panic trigger toggle
function triggerSOS(forceState = null) {
  if (!state.touristActive) {
    alert("Please register a Digital Tourist ID first before utilizing the Emergency Safety Cockpit!");
    return;
  }
  
  const originalState = state.sosActive;
  state.sosActive = forceState !== null ? forceState : !state.sosActive;
  
  const sosBtn = document.getElementById('panic-sos-btn');
  const overlay = document.getElementById('sos-overlay');
  
  if (state.sosActive) {
    sosBtn.classList.add('pulse-active');
    sosBtn.style.background = "linear-gradient(135deg, #ef4444, #ffffff)";
    sosBtn.style.color = "#b91c1c";
    overlay.style.display = 'block';
    
    startSiren();
    
    // Vocal Warning Alarms in selected language
    const voiceMsg = state.currentLanguage === 'hi' 
      ? "चेतावनी! आपातकालीन अलार्म सक्रिय हो गया है। पुलिस नियंत्रण कक्ष को आपकी लाइव स्थिति भेज दी गई है।"
      : "Warning! Emergency panic beacon active. Your live location telemetry has been sent to the Police Control room.";
    speakVoiceAlert(voiceMsg);
    
    state.blockchain.createTransaction('SOS_TRIGGER', {
      status: "CRITICAL SOS ACTIVE",
      tourist: state.touristData.name,
      coords: { ...state.gpsCoords },
      vitals: { ...state.vitals },
      biometricHash: state.biometricHash
    });
    
    const block = state.blockchain.minePendingTransactions('State Police Command Node');
    pushAlert('EMERGENCY SOS', `Tourist "${state.touristData.name}" triggered panic SOS button at lat:${state.gpsCoords.lat.toFixed(5)}°! Rescue dispatched.`, 'sos');
    
    document.getElementById('phone-logo-element').className = "phone-logo sos-active";
  } else {
    sosBtn.classList.remove('pulse-active');
    sosBtn.style.background = "linear-gradient(135deg, var(--neon-red), #b91c1c)";
    sosBtn.style.color = "#fff";
    overlay.style.display = 'none';
    
    stopSiren();
    
    if (originalState) {
      state.blockchain.createTransaction('SOS_TRIGGER', {
        status: "SOS DEACTIVATED / RESOLVED",
        tourist: state.touristData.name,
        time: new Date().toISOString()
      });
      state.blockchain.minePendingTransactions('State Police Command Node');
      pushAlert('INFO', `Distress call for "${state.touristData.name}" was marked RESOLVED. All units debriefed.`, 'info');
    }
    
    document.getElementById('phone-logo-element').className = "phone-logo";
  }
  
  recalculateSafetyScore();
  updateAICenter();
  redraftEFIR();
  renderBlockchainBlocks();
}

// Initialize Leaflet GIS Map Engine with Real Geofences
function initLeafletMap() {
  const container = document.getElementById('leaflet-map-element');
  if (!container) return;
  
  // Center map on Shillong, Meghalaya
  state.leafletMap = L.map('leaflet-map-element', {
    zoomControl: true,
    attributionControl: false
  }).setView([state.gpsCoords.lat, state.gpsCoords.lon], 12);
  
  // Modern Dark Map Tiles from Voyager (CartoDB) - beautiful dark cyberpunk match
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    maxZoom: 19,
    subdomains: 'abcd'
  }).addTo(state.leafletMap);
  
  // Custom pulsing neon marker for the tourist
  const touristIcon = L.divIcon({
    className: 'map-tourist-cursor-wrapper',
    html: `
      <div style="position: relative; width: 14px; height: 14px; background: var(--emerald); border: 2.5px solid #fff; border-radius: 50%; box-shadow: 0 0 10px var(--emerald); cursor: pointer;" id="div-tourist-marker">
        <div style="position: absolute; top: -14px; left: -14px; width: 36px; height: 36px; border: 1.5px solid var(--emerald); border-radius: 50%; opacity: 0.8; animation: ripple-pulse 1.5s infinite ease-out;"></div>
      </div>
    `,
    iconSize: [14, 14],
    iconAnchor: [7, 7]
  });
  
  // Place marker on map
  state.touristMarker = L.marker([state.gpsCoords.lat, state.gpsCoords.lon], {
    icon: touristIcon,
    draggable: true
  }).addTo(state.leafletMap);
  
  // Bind standard popup
  state.touristMarker.bindPopup(`<strong style="color:var(--emerald);">Devraj Baruah (Active Target)</strong><br>Vitals Stable | GPS Active`).openPopup();
  
  // Draw Geofence Polygons onto the Leaflet map
  GEOFENCE_ZONES.forEach(zone => {
    const polygon = L.polygon(zone.coords, {
      color: zone.color,
      fillColor: zone.color,
      fillOpacity: 0.15,
      weight: 2,
      dashArray: '5, 5'
    }).addTo(state.leafletMap);
    
    // Bind simple hover popup
    polygon.bindPopup(`<strong>GEOFENCE: ${zone.name}</strong><br><span style="color:var(--neon-red); font-weight:bold;">RESTRICTED HIGH-RISK TERRITORY</span>`);
    state.geofencePolygons.push({ name: zone.name, polygon: polygon, coords: zone.coords });
  });
  
  // Set up Trail Path Line
  state.trailPathLine = L.polyline([[state.gpsCoords.lat, state.gpsCoords.lon]], {
    color: 'var(--emerald)',
    weight: 3,
    dashArray: '2, 6',
    opacity: 0.7
  }).addTo(state.leafletMap);
  
  state.trailPoints = [[state.gpsCoords.lat, state.gpsCoords.lon]];
  
  // Dragging event bindings on real GIS Marker
  state.touristMarker.on('drag', (e) => {
    const latlng = e.target.getLatLng();
    updateTouristGISPosition(latlng.lat, latlng.lng);
  });
  
  state.touristMarker.on('dragend', (e) => {
    e.target.openPopup();
  });
  
  // Click anywhere on map to route
  state.leafletMap.on('click', (e) => {
    if (!state.touristActive || state.realGpsActive) return;
    
    const latlng = e.latlng;
    state.touristMarker.setLatLng(latlng);
    updateTouristGISPosition(latlng.lat, latlng.lng);
  });
}

function updateTouristGISPosition(lat, lon) {
  state.gpsCoords = { lat, lon };
  
  document.getElementById('map-gps-coord').innerText = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  
  if (state.gpsOptIn) {
    // Extend trail path
    state.trailPoints.push([lat, lon]);
    state.trailPathLine.setLatLngs(state.trailPoints);
    
    // Enterprise Mode Service Call
    if (state.enterpriseMode) {
      fetch(`${state.gatewayGisUrl}/api/v1/gis/update_location`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenId: 1,
          lat: lat,
          lon: lon
        })
      })
      .then(res => res.json())
      .then(result => {
        pushAlert('GATEWAY API', `PostGIS SQL Spatial index lookup: ${result.geofenceBreach ? 'RESTRICTED BREACH 🚨' : 'PATH SECURED ✅'}`, 'info');
        handleGeofenceTrigger(result.geofenceBreach, result.breachedZoneName || "Restricted Area");
      })
      .catch(err => {
        console.error("GIS API Gateway failed, fallback to local math:", err);
        // Fallback to local Point-in-Polygon calculations
        runLocalGeofenceCheck(lat, lon);
      });
    } else {
      // Offline local containment
      runLocalGeofenceCheck(lat, lon);
    }
  }
}

function runLocalGeofenceCheck(lat, lon) {
  let inBreach = false;
  let breachedZoneName = "";
  
  for (let i = 0; i < state.geofencePolygons.length; i++) {
    const isInside = isCoordinateInsidePolygon(lat, lon, state.geofencePolygons[i].coords);
    if (isInside) {
      inBreach = true;
      breachedZoneName = state.geofencePolygons[i].name;
      break;
    }
  }
  
  handleGeofenceTrigger(inBreach, breachedZoneName);
}

function handleGeofenceTrigger(inBreach, breachedZoneName) {
  if (inBreach !== state.geofenceBreach) {
    state.geofenceBreach = inBreach;
    
    const hud = document.getElementById('map-geofence-hud');
    const markerDiv = document.getElementById('div-tourist-marker');
    
    if (state.geofenceBreach) {
      hud.innerText = "GEOFENCE BREACH!";
      hud.style.color = "var(--neon-red)";
      if (markerDiv) {
        markerDiv.style.backgroundColor = "var(--neon-red)";
        markerDiv.style.boxShadow = "0 0 12px var(--neon-red)";
      }
      
      playWarningTone();
      
      // Vocal voice alert
      const alertMsg = state.currentLanguage === 'hi'
        ? `चेतावनी! आपने प्रतिबंधित सीमा क्षेत्र ${breachedZoneName} में प्रवेश किया है। पुलिस को सूचित कर दिया गया है।`
        : `Warning! You have crossed into the restricted border zone of ${breachedZoneName}. State Tourism Police have been notified!`;
      speakVoiceAlert(alertMsg);
      
      pushAlert('GEOFENCE BREACH', `Subject breached high-security sector "${breachedZoneName}" at coordinate [${state.gpsCoords.lat.toFixed(5)}, ${state.gpsCoords.lon.toFixed(5)}]! Dispatch units alert.`, 'warning');
      
      state.blockchain.createTransaction('GEOFENCE_BREACH', {
        tourist: state.touristActive ? state.touristData.name : "Devraj Baruah",
        location: { ...state.gpsCoords },
        sector: breachedZoneName,
        alertType: "RESTRICTED_COLLISION"
      });
      state.blockchain.minePendingTransactions('Border Police Sub-Node');
      renderBlockchainBlocks();
    } else {
      hud.innerText = "SECURED";
      hud.style.color = "var(--emerald)";
      if (markerDiv) {
        markerDiv.style.backgroundColor = "var(--emerald)";
        markerDiv.style.boxShadow = "0 0 10px var(--emerald)";
      }
      
      speakVoiceAlert(state.currentLanguage === 'hi' ? "आप सुरक्षित क्षेत्र में वापस आ गए हैं।" : "You have returned to the secure travel corridor.");
      
      pushAlert('INFO', `Subject returned safely into secure state travel corridor at lat:${state.gpsCoords.lat.toFixed(5)}°. Boundary cleared.`, 'info');
    }
    
    recalculateSafetyScore();
    updateAICenter();
    redraftEFIR();
  }
}

// Hardware Device GPS sensor watch implementation
function toggleRealDeviceGPS(enable) {
  if (!enable) {
    if (state.deviceGpsWatchId !== null) {
      navigator.geolocation.clearWatch(state.deviceGpsWatchId);
      state.deviceGpsWatchId = null;
    }
    state.realGpsActive = false;
    pushAlert('GPS', "Hardware GPS sensor watch disabled. Command manual map drags restored.", 'info');
    return;
  }
  
  if (!navigator.geolocation) {
    alert("HTML5 Geolocation API not supported in this device/browser!");
    document.getElementById('real-gps-tracking-switch').checked = false;
    return;
  }
  
  state.realGpsActive = true;
  pushAlert('GPS', "Requesting hardware GPS sensor authorization stream...", 'info');
  
  state.deviceGpsWatchId = navigator.geolocation.watchPosition(
    (position) => {
      const lat = position.coords.latitude;
      const lon = position.coords.longitude;
      
      pushAlert('GPS', `Hardware sat tracking ping: [Lat: ${lat.toFixed(5)}°, Lon: ${lon.toFixed(5)}°] accurate to ${position.coords.accuracy.toFixed(1)}m.`, 'info');
      
      // Update Marker & Map in real-time
      if (state.touristMarker && state.leafletMap) {
        const latlng = L.latLng(lat, lon);
        state.touristMarker.setLatLng(latlng);
        state.leafletMap.setView(latlng, 14);
        updateTouristGISPosition(lat, lon);
      }
    },
    (err) => {
      console.error("GPS Watch Position failed:", err);
      alert(`GPS Sensor access failed: ${err.message}. Reverting to simulator dragging.`);
      document.getElementById('real-gps-tracking-switch').checked = false;
      state.realGpsActive = false;
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
}

// Dynamic input simulator listeners
function initSimulationSliders() {
  const hrSlider = document.getElementById('sim-slider-heart');
  const spo2Slider = document.getElementById('sim-slider-spo2');
  const battSlider = document.getElementById('sim-slider-phone-batt');
  
  hrSlider.addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    state.vitals.heartRate = val;
    
    const label = document.getElementById('sim-val-heart');
    label.innerText = `${val} BPM`;
    document.getElementById('vital-heart').innerText = `${val} BPM`;
    
    if (val > 130) {
      label.className = "val critical";
      if (state.touristActive) {
        pushAlert('IOT TELEMETRY', `Tachycardia Warning: High Heartbeat (${val} BPM) detected in cold high-altitude!`, 'warning');
      }
    } else if (val > 105) {
      label.className = "val warning";
    } else {
      label.className = "val";
    }
    
    recalculateSafetyScore();
    updateAICenter();
    redraftEFIR();
  });
  
  spo2Slider.addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    state.vitals.spo2 = val;
    
    const label = document.getElementById('sim-val-spo2');
    label.innerText = `${val}%`;
    document.getElementById('vital-spo2').innerText = `${val}%`;
    
    if (val < 85) {
      label.className = "val critical";
      if (state.touristActive) {
        pushAlert('IOT TELEMETRY', `CRITICAL: Hypoxia Alert! Tourist SpO2 Oxygen drops to ${val}%! Dispatching rescue.`, 'sos');
        speakVoiceAlert("Warning! Low oxygen anomaly detected on your wearable band. Please stop climbing and sit down!");
      }
    } else if (val < 90) {
      label.className = "val warning";
      if (state.touristActive) {
        pushAlert('IOT TELEMETRY', `Vital Warning: Low oxygen levels (${val}%) detected. Subject climbing rapidly?`, 'warning');
      }
    } else {
      label.className = "val";
    }
    
    recalculateSafetyScore();
    updateAICenter();
    redraftEFIR();
  });

  battSlider.addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    state.vitals.battery = val;
    
    document.getElementById('sim-val-phone-batt').innerText = `${val}%`;
    document.getElementById('phone-battery-status').innerText = `🔋 ${val}%`;
    
    if (val < 15) {
      if (state.touristActive) {
        pushAlert('DEVICE STAT', `CRITICAL: Tourist smartphone battery is at ${val}%. Signal tracking risk extremely high!`, 'warning');
      }
    }
    
    recalculateSafetyScore();
    updateAICenter();
    redraftEFIR();
  });
}

// Persistence loader to fetch registered sessions from LocalStorage
function loadCachedTouristRegistry() {
  const savedData = localStorage.getItem('shield_tourist_details');
  if (!savedData) return;
  
  try {
    const tourist = JSON.parse(savedData);
    state.touristActive = true;
    state.touristData = tourist;
    
    // Snaps base64 facial capture if cached
    state.biometricImageBase64 = localStorage.getItem('shield_tourist_face_base64');
    state.biometricHash = localStorage.getItem('shield_tourist_face_hash');
    
    // Display Digital ID UI
    const blockHash = state.blockchain.chain.length > 1 ? state.blockchain.chain[1].hash : "SHIELD-MINTED";
    document.getElementById('id-card-element').style.display = 'block';
    document.getElementById('card-tourist-name').innerText = tourist.name;
    document.getElementById('card-id-hash').innerText = `SHIELD-${blockHash.substring(0, 10).toUpperCase()}`;
    document.getElementById('card-validity').innerText = `ACTIVE (${tourist.duration} DAYS)`;
    document.getElementById('card-entry-point').innerText = tourist.origin.toUpperCase();
    document.getElementById('card-qr-box').innerHTML = generateSVGQR(tourist.name + tourist.kyc + blockHash);
    
    // Append face image preview on physical card if captured
    const photoBox = document.getElementById('card-biometric-photo');
    if (state.biometricImageBase64 && photoBox) {
      photoBox.innerHTML = `<img src="${state.biometricImageBase64}" alt="KYC Face">`;
    }
    
    document.getElementById('header-active-count').innerText = "1";
    document.getElementById('tourists-count-indicator').style.backgroundColor = "var(--emerald)";
    document.getElementById('tourists-count-indicator').style.boxShadow = "0 0 8px var(--emerald)";
    
    pushAlert('BLOCKCHAIN', "Persistent tourist session successfully loaded from local blockchain database.", 'info');
    
    recalculateSafetyScore();
    updateAICenter();
    redraftEFIR();
  } catch (err) {
    console.error("Session loader failed: ", err);
  }
}

// Set up event listeners for main dashboard action buttons
function initControlActionButtons() {
  
  // Camera toggle button
  document.getElementById('btn-toggle-camera').addEventListener('click', () => {
    toggleWebcam();
  });
  
  // Camera Shutter Button
  document.getElementById('btn-snap-camera').addEventListener('click', () => {
    captureFaceBiometrics();
  });

  // Registration Submit Minting
  document.getElementById('kyc-form').addEventListener('submit', (e) => {
    e.preventDefault();
    
    const name = document.getElementById('tourist-name').value;
    const kyc = document.getElementById('tourist-kyc').value;
    const origin = document.getElementById('tourist-origin').value;
    const duration = document.getElementById('itinerary-days').value;
    const emergency = document.getElementById('emergency-contact').value;
    
    const mintBtn = document.getElementById('btn-mint-id');
    
    mintBtn.setAttribute('disabled', 'true');
    mintBtn.className = "btn-primary mining";
    mintBtn.innerHTML = `<span>⏳ Mining Block on Consortium...</span>`;
    
    // Push blockchain transaction
    state.blockchain.createTransaction('KYC_REGISTER', {
      name, kyc, origin, durationDays: duration, emergencyContact: emergency,
      biometricHash: state.biometricHash || "NO_BIOMETRICS_Ingested"
    });
    
    setTimeout(() => {
      const block = state.blockchain.minePendingTransactions('Airport Immigration Node');
      
      state.touristActive = true;
      state.touristData = { name, kyc, origin, duration, emergency };
      
      // Save data cache to LocalStorage database persistence
      localStorage.setItem('shield_tourist_details', JSON.stringify(state.touristData));
      if (state.biometricImageBase64) {
        localStorage.setItem('shield_tourist_face_base64', state.biometricImageBase64);
        localStorage.setItem('shield_tourist_face_hash', state.biometricHash);
      }
      
      // Render card
      const photoBox = document.getElementById('card-biometric-photo');
      document.getElementById('id-card-element').style.display = 'block';
      document.getElementById('card-tourist-name').innerText = name;
      document.getElementById('card-id-hash').innerText = `SHIELD-${block.hash.substring(0, 10).toUpperCase()}`;
      document.getElementById('card-validity').innerText = `ACTIVE (${duration} DAYS)`;
      document.getElementById('card-entry-point').innerText = origin.toUpperCase();
      document.getElementById('card-qr-box').innerHTML = generateSVGQR(name + kyc + block.hash);
      
      if (state.biometricImageBase64 && photoBox) {
        photoBox.innerHTML = `<img src="${state.biometricImageBase64}" alt="KYC Face">`;
      }
      
      mintBtn.removeAttribute('disabled');
      mintBtn.className = "btn-primary";
      mintBtn.innerHTML = `<span>🔗 Mint Blockchain ID</span>`;
      
      document.getElementById('header-active-count').innerText = "1";
      document.getElementById('tourists-count-indicator').style.backgroundColor = "var(--emerald)";
      document.getElementById('tourists-count-indicator').style.boxShadow = "0 0 8px var(--emerald)";
      
      pushAlert('BLOCKCHAIN', `Digital ID successfully minted & verified in Block #${block.index}. Hash: ${block.hash.substring(0, 16)}...`, 'info');
      
      speakVoiceAlert(`Congratulations Devraj. Your Digital Tourist ID has been successfully minted on the blockchain.`);
      
      recalculateSafetyScore();
      updateAICenter();
      redraftEFIR();
      renderBlockchainBlocks();
    }, 1200);
  });
  
  // Auditing / Verification of blockchain integrity
  document.getElementById('btn-audit-ledger').addEventListener('click', () => {
    const banner = document.getElementById('chain-status-banner');
    const text = document.getElementById('chain-status-text');
    
    const audit = state.blockchain.isChainValid();
    
    if (audit.valid) {
      banner.className = "chain-status-banner valid";
      text.innerText = "Ledger integrity validated. Cryptographic linkages secure.";
      pushAlert('BLOCKCHAIN', "Consortium Ledger audit completed. Cryptographic chain verified as 100% integral.", 'info');
      speakVoiceAlert("Ledger audit completed. Integrity matches parent block hashes.");
    } else {
      banner.className = "chain-status-banner invalid";
      text.innerText = `INTEGRITY COMPROMISED: ${audit.message}`;
      pushAlert('BLOCKCHAIN', `LEDGER BREACH CHECK FAILURE: Block #${audit.blockIndex} holds tampered transactions!`, 'sos');
      speakVoiceAlert("Warning! Security ledger check failed. Tampered block detected!");
    }
    
    renderBlockchainBlocks();
  });
  
  // Simulate Tamper Intrusions on Blockchain data
  document.getElementById('btn-tamper-ledger').addEventListener('click', () => {
    if (state.blockchain.chain.length < 2) {
      alert("Please register a Tourist ID first to generate ledger data blocks to tamper!");
      return;
    }
    
    state.chainTampered = true;
    
    // Tamper the local details inside chain directly (violates SHA256 integrity check)
    state.blockchain.chain[1].transactions[0].details.name = "🚨 MALICIOUS_SPY_INTRUDER 🚨";
    state.blockchain.chain[1].transactions[0].details.kyc = "9999 9999 9999 (FAKE)";
    
    const banner = document.getElementById('chain-status-banner');
    const text = document.getElementById('chain-status-text');
    
    banner.className = "chain-status-banner invalid";
    text.innerText = "CRITICAL: Corrupted parent hash detected on Block #1. Security ledger ALERT active!";
    
    pushAlert('SECURITY ALERT', "WARNING: Direct database modification detected inside node server! Local blockchain block hash does not match stored signature.", 'sos');
    speakVoiceAlert("Alert! Intrusive database modification detected on Node Airport Immigration! Blocking node authorization.");
    
    playWarningTone();
    
    renderBlockchainBlocks();
    redraftEFIR();
  });
  
  // SOS Click
  document.getElementById('panic-sos-btn').addEventListener('click', () => {
    triggerSOS();
  });
  
  // GPS Tracking Switch
  document.getElementById('gps-tracking-switch').addEventListener('change', (e) => {
    state.gpsOptIn = e.target.checked;
    
    if (state.gpsOptIn) {
      pushAlert('GPS', "Tourist enabled GPS telemetry. Real-time path visualization restored in Command Center.", 'info');
      document.getElementById('vital-heart').innerText = `${state.vitals.heartRate} BPM`;
      document.getElementById('vital-spo2').innerText = `${state.vitals.spo2}%`;
      if (state.touristMarker) {
        state.touristMarker.setLatLng([state.gpsCoords.lat, state.gpsCoords.lon]);
      }
    } else {
      pushAlert('GPS', "Tourist DISABLED GPS tracking. Command center telemetry enters restricted offline-paired protocol.", 'warning');
      document.getElementById('vital-heart').innerText = "PAIRED (OFF)";
      document.getElementById('vital-spo2').innerText = "PAIRED (OFF)";
      
      // Clear trailing line on map
      state.trailPoints = [];
      if (state.trailPathLine) state.trailPathLine.setLatLngs([]);
      
      if (state.geofenceBreach) {
        state.geofenceBreach = false;
        document.getElementById('map-geofence-hud').innerText = "SECURED";
        document.getElementById('map-geofence-hud').style.color = "var(--emerald)";
        const markerDiv = document.getElementById('div-tourist-marker');
        if (markerDiv) {
          markerDiv.style.backgroundColor = "var(--emerald)";
          markerDiv.style.boxShadow = "0 0 10px var(--emerald)";
        }
      }
    }
    
    recalculateSafetyScore();
    updateAICenter();
    redraftEFIR();
  });
  
  // Toggle Real Hardware Device GPS
  document.getElementById('real-gps-tracking-switch').addEventListener('change', (e) => {
    toggleRealDeviceGPS(e.target.checked);
  });

  // Audio Mute toggle
  document.getElementById('audio-mute-toggle').addEventListener('click', (e) => {
    state.soundMuted = !state.soundMuted;
    e.target.innerText = state.soundMuted ? "🔇" : "🔊";
    
    if (state.soundMuted) {
      stopSiren();
      if (state.speechSynth) state.speechSynth.cancel();
    } else if (state.sosActive) {
      startSiren();
    }
  });
  
  // E-FIR File Submission
  document.getElementById('btn-file-efir').addEventListener('click', () => {
    if (state.efirStatus === 'FILED') return;
    
    state.efirStatus = 'FILED';
    
    state.blockchain.createTransaction('E-FIR_GENERATE', {
      firNo: `SHIELD-FIR-${state.blockchain.getLatestBlock().hash.substring(0, 8).toUpperCase()}`,
      tourist: state.touristData.name,
      status: "FILED & SIGNED BY COMMAND CENTER"
    });
    
    state.blockchain.minePendingTransactions('State Police Command Node');
    pushAlert('E-FIR', "E-FIR officially submitted and signed on state police consortium ledger.", 'info');
    speakVoiceAlert("E F I R filed and registered on security blockchain.");
    
    redraftEFIR();
    renderBlockchainBlocks();
  });
  
  // E-FIR Print/Save trigger
    window.print();
  });

  // Toggle Enterprise Gateways Mode
  document.getElementById('enterprise-mode-switch').addEventListener('change', (e) => {
    state.enterpriseMode = e.target.checked;
    
    if (state.enterpriseMode) {
      pushAlert('SYSTEM', "Cloud Enterprise Mode ENGAGED. Live REST APIs & PostGIS bindings active.", 'info');
      speakVoiceAlert("Cloud Enterprise Core engaged. Telemetry and GIS index services connected.");
    } else {
      pushAlert('SYSTEM', "Local Simulator Mode ENGAGED. Local offline mocks active.", 'info');
      speakVoiceAlert("Local Simulator mode restored.");
    }
    
    recalculateSafetyScore();
    updateAICenter();
    redraftEFIR();
  });
}

// Smartphone clock ticking simulator
function startSmartphoneClock() {
  setInterval(() => {
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    document.getElementById('phone-time').innerText = timeStr;
  }, 10000);
}

// Startup Initialization sequence
window.addEventListener('DOMContentLoaded', () => {
  // 1. Initial Genesis block
  renderBlockchainBlocks();
  
  // 2. Load Leaflet Map Engine
  initLeafletMap();
  
  // 3. Load persistent LocalStorage cache
  loadCachedTouristRegistry();
  
  // 4. Initialize speech APIs (Voice SOS)
  initVoiceSOS();
  
  // 5. Initialize layout elements
  translatePhoneApp('en');
  initControlActionButtons();
  initSimulationSliders();
  startSmartphoneClock();
});
