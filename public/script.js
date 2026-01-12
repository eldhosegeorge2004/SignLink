import { db } from './firebase-config.js';
import { collection, addDoc, getDocs, deleteDoc, doc } from "firebase/firestore";

const socket = io();

// --- Persistence Configuration (Firestore) ---
// Default to ISL
let currentMode = 'ISL';
let dbCollection = 'gestures';
let localStorageModelKey = 'my-isl-model';
let localStorageLabelKey = 'isl_labels';

function updateModeVariables() {
    if (currentMode === 'ISL') {
        dbCollection = 'gestures';
        localStorageModelKey = 'my-isl-model';
        localStorageLabelKey = 'isl_labels';
    } else {
        dbCollection = 'asl_gestures';
        localStorageModelKey = 'my-asl-model';
        localStorageLabelKey = 'asl_labels';
    }
    console.log(`Switched to ${currentMode} mode. DB: ${dbCollection}`);
}

// Helper to load from Firestore
async function loadFromFirestore() {
    try {
        const querySnapshot = await getDocs(collection(db, dbCollection));
        collectedData = [];
        querySnapshot.forEach((doc) => {
            collectedData.push({ ...doc.data(), id: doc.id }); // Use Firestore ID
        });
        updateDataStats();
        renderSignList();
        console.log("Loaded data from Firestore:", collectedData.length);
    } catch (e) {
        console.error("Error loading from Firestore:", e);
    }
}

// Global State
let collectedData = [];
let batchQueue = []; // New data waiting to be uploaded
let uniqueLabels = [];

// --- DOM Elements ---
const joinScreen = document.getElementById('join-screen');
const meetingRoom = document.getElementById('meeting-room');
const newMeetingBtn = document.getElementById('newMeetingBtn');
const startRoomInput = document.getElementById('startRoomInput');
const joinBtn = document.getElementById('joinBtn');
const lobbyStatus = document.getElementById('status');
const clockElement = document.getElementById('clock');
const modeSelect = document.getElementById('modeSelect');

const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const localCanvas = document.getElementById('localCanvas');
const ctx = localCanvas.getContext('2d');
const meetingCodeDisplay = document.getElementById('meetingCodeDisplay');
const predictionDiv = document.getElementById('prediction');
const remotePredictionDiv = document.getElementById('remotePrediction');
const remoteCaptionOverlay = document.getElementById('remote-caption-overlay');

const micBtn = document.getElementById('micBtn');
const camBtn = document.getElementById('camBtn');
const hangupBtn = document.getElementById('hangupBtn');
const trainToggleBtn = document.getElementById('trainToggleBtn');
const ttsBtn = document.getElementById('ttsBtn');

const sidePanel = document.getElementById('side-panel');
const closePanelBtn = document.getElementById('closePanelBtn');
const labelInput = document.getElementById('labelInput');
const collectBtn = document.getElementById('collectBtn');
const dataCountDiv = document.getElementById('dataCount');
const trainBtn = document.getElementById('trainBtn');
const saveBtn = document.getElementById('saveBtn');
const clearBtn = document.getElementById('clearBtn');
const trainStatusDiv = document.getElementById('trainStatus');
const sttOverlay = document.getElementById('stt-overlay');
const sttText = document.getElementById('stttext');
const sttToggleBtn = document.getElementById('sttToggleBtn');
const localVolumeMeter = document.getElementById('localVolume');
const remoteVolumeMeter = document.getElementById('remoteVolume');

// Panels & Controls
const infoBtn = document.getElementById('infoBtn');
const peopleBtn = document.getElementById('peopleBtn');
const chatToggleBtn = document.getElementById('chatToggleBtn');

const infoPanel = document.getElementById('info-panel');
const peoplePanel = document.getElementById('people-panel');
const chatPanel = document.getElementById('chat-panel');

const closeInfoBtn = document.getElementById('closeInfoBtn');
const closePeopleBtn = document.getElementById('closePeopleBtn');
const closeChatBtn = document.getElementById('closeChatBtn');

const infoCurrentMode = document.getElementById('infoCurrentMode');
const infoMeetingCode = document.getElementById('infoMeetingCode');
const copyInfoCodeBtn = document.getElementById('copyInfoCodeBtn');
const peopleList = document.getElementById('peopleList');

const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const sendChatBtn = document.getElementById('sendChatBtn');

// --- Global State ---
let localStream;
let pc;
let roomName;
let isMicOn = true;
let isCamOn = true;
let isTTSOn = true;
let isSTTOn = false;
let lastSpokenTime = 0;
let lastRemoteSpokenTime = 0;
const localWordLastSpoken = {};    // NEW: Per-word cooldown for local signs
const remoteWordLastSpoken = {};   // NEW: Per-word cooldown for remote signs
let lastSpokenLabel = "";
let lastRemoteSpokenText = "";
let speakTimeout = null;           // NEW: Track pending speech to avoid race conditions
let iceCandidatesBuffer = []; // Buffer for ICE candidates

// Accessibility Feature States
let recognition;
let audioContext;
let analyser;
let micSource;
let volumeInterval;

// Resume audio on any user interaction
document.addEventListener('click', () => {
    if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume().then(() => console.log("AudioContext manually resumed."));
    }
}, { once: true });

socket.on('connect', () => console.log("Connected to signaling server with ID:", socket.id));
socket.on('connect_error', (err) => console.error("Socket Connection Error:", err));

const rtcConfig = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
        { urls: "stun:stun3.l.google.com:19302" },
        { urls: "stun:stun4.l.google.com:19302" },
        // Free TURN server for testing (Note: For production, use a paid service like Twilio or Metered.ca)
        {
            urls: "turn:openrelay.metered.ca:80",
            username: "openrelayproject",
            credential: "openrelayproject"
        },
        {
            urls: "turn:openrelay.metered.ca:443",
            username: "openrelayproject",
            credential: "openrelayproject"
        },
        {
            urls: "turn:openrelay.metered.ca:443?transport=tcp",
            username: "openrelayproject",
            credential: "openrelayproject"
        }
    ],
    iceCandidatePoolSize: 10,
    bundlePolicy: "balanced"
};

// Helper to limit bitrate in SDP (prevents "poor connection" lag)
function setMaxBitrate(sdp, maxBitrateKbps) {
    const lines = sdp.split('\r\n');
    let lineIndex = -1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].indexOf('m=video') !== -1) {
            lineIndex = i;
            break;
        }
    }
    if (lineIndex === -1) return sdp;

    // Check if there's already a 'b=' line
    lineIndex++;
    while (lines[lineIndex] && (lines[lineIndex].indexOf('i=') === 0 || lines[lineIndex].indexOf('c=') === 0)) {
        lineIndex++;
    }

    if (lines[lineIndex] && lines[lineIndex].indexOf('b=AS') === 0) {
        lines[lineIndex] = 'b=AS:' + maxBitrateKbps;
    } else {
        lines.splice(lineIndex, 0, 'b=AS:' + maxBitrateKbps);
    }
    return lines.join('\r\n');
}

// --- Clock Utility ---
function updateClock() {
    const now = new Date();
    clockElement.innerText = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
setInterval(updateClock, 1000);
updateClock();

// --- Accessibility & Communication Boost Features ---

// 1. Speech to Text (Bi-Directional)
function initSTT() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        console.warn("Speech Recognition not supported in this browser.");
        sttToggleBtn.style.display = 'none';
        return;
    }

    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
        let finalTranscript = '';
        let interimTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
                finalTranscript += event.results[i][0].transcript;
            } else {
                interimTranscript += event.results[i][0].transcript;
            }
        }

        const textToShow = finalTranscript || interimTranscript;
        if (textToShow.trim()) {
            // Send to remote peer
            socket.emit('speech-message', { room: roomName, text: textToShow });
            // Show locally in a "caption" way? 
            // Optionally show your own speech too
            showSTT(textToShow, true);
        }
    };

    recognition.onerror = (event) => {
        console.error("STT Error:", event.error);
        if (event.error === 'not-allowed') {
            alert("Speech recognition permission denied.");
            isSTTOn = false;
            updateSTTUI();
        }
    };

    recognition.onend = () => {
        if (isSTTOn) recognition.start(); // Keep listening if toggled on
    };
}

function updateSTTUI() {
    if (!sttToggleBtn) return;
    sttToggleBtn.innerHTML = `<span class="material-icons">${isSTTOn ? 'interpreter_mode' : 'voice_over_off'}</span>`;
    sttToggleBtn.classList.toggle('red-btn', !isSTTOn);
    sttToggleBtn.title = isSTTOn ? "Turn off Speech-to-Text" : "Turn on Speech-to-Text";
}
updateSTTUI(); // Sync at startup

function updateTTSUI() {
    if (!ttsBtn) return;
    ttsBtn.innerHTML = `<span class="material-icons">${isTTSOn ? 'volume_up' : 'volume_off'}</span>`;
    ttsBtn.classList.toggle('red-btn', !isTTSOn);
    ttsBtn.setAttribute('title', isTTSOn ? 'Mute Text-to-Speech' : 'Enable Text-to-Speech');
}
updateTTSUI(); // Sync at startup

sttToggleBtn.addEventListener('click', () => {
    isSTTOn = !isSTTOn;
    updateSTTUI();
    if (isSTTOn) {
        if (!recognition) initSTT();
        recognition.start();
        sttOverlay.classList.remove('hidden');
        sttText.innerText = "Listening to you...";
    } else {
        if (recognition) recognition.stop();
        sttOverlay.classList.add('hidden');
    }
});

function showSTT(text, isSelf = false) {
    sttOverlay.classList.remove('hidden');
    sttText.innerText = (isSelf ? "You: " : "Remote: ") + text;

    // Clear after some silence/timeout
    clearTimeout(window.sttTimeout);
    window.sttTimeout = setTimeout(() => {
        if (isSTTOn) {
            sttText.innerText = "Listening...";
        } else {
            sttOverlay.classList.add('hidden');
        }
    }, 4000);
}

// 2. Visual Audio Feedback (Volume Meter)
async function initAudioAnalysis(stream) {
    console.log("Initializing audio analysis...");
    try {
        const tracks = stream.getAudioTracks();
        if (!stream || !tracks.length) {
            console.warn("No audio tracks found in stream for analysis.");
            return;
        }

        const activeTrack = tracks[0];
        console.log(`[Audio Diagnostic] Using Mic: "${activeTrack.label}"`);
        console.log(`[Audio Diagnostic] Hardware Enabled: ${activeTrack.enabled}, Status: ${activeTrack.readyState}`);

        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }

        if (audioContext.state === 'suspended') {
            console.log("Resuming suspended AudioContext...");
            await audioContext.resume();
        }

        if (micSource) {
            try { micSource.disconnect(); } catch (e) { }
        }
        if (analyser) {
            try { analyser.disconnect(); } catch (e) { }
        }

        analyser = audioContext.createAnalyser();
        micSource = audioContext.createMediaStreamSource(stream);
        micSource.connect(analyser);
        analyser.fftSize = 256;

        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        console.log("Audio analysis started. Loop active.");

        function checkVolume() {
            if (!isMicOn || !localStream || !localStream.getAudioTracks().some(t => t.enabled)) {
                localVolumeMeter.classList.remove('volume-active');
                return;
            }

            analyser.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < bufferLength; i++) {
                sum += dataArray[i];
            }
            let average = sum / bufferLength;
            let volume = average / 128; // 0 to 2

            if (volume > 0.02) {
                localVolumeMeter.classList.add('volume-active');
                socket.emit('volume-level', { room: roomName, level: volume });
            } else {
                localVolumeMeter.classList.remove('volume-active');
            }
        }

        if (volumeInterval) clearInterval(volumeInterval);
        volumeInterval = setInterval(checkVolume, 100);
    } catch (e) {
        console.error("Audio analysis failed:", e);
    }
}

// 3. Sign-to-Emoji Shortcuts (The Wow Factor)
const EMOJI_MAP = {
    'HELLO': '👋',
    'THANKS': '🙏',
    'I LOVE YOU': '❤️',
    'HEART': '❤️',
    'GOOD': '👍',
    'YES': '✅',
    'NO': '❌',
    'AWESOME': '✨',
    'HAPPY': '😊'
};

function popEmojis(emoji) {
    const container = document.getElementById('particles-container');
    const count = 15;

    for (let i = 0; i < count; i++) {
        const p = document.createElement('div');
        p.className = 'particle';
        p.innerText = emoji;

        // Random trajectory
        const x = (Math.random() - 0.5) * 600;
        const y = -Math.random() * 800 - 200;
        const r = Math.random() * 360;

        p.style.setProperty('--x', `${x}px`);
        p.style.setProperty('--y', `${y}px`);
        p.style.setProperty('--r', `${r}deg`);

        p.style.left = '50%';
        p.style.bottom = '20%';

        container.appendChild(p);

        // Remove after animation
        setTimeout(() => p.remove(), 2000);
    }
}

// --- Initialization & UI ---
startRoomInput.addEventListener('input', (e) => {
    joinBtn.disabled = e.target.value.trim().length === 0;
});

// Mode Selector Logic
if (modeSelect) {
    modeSelect.addEventListener('change', async (e) => {
        currentMode = e.target.value;
        updateModeVariables();

        // Reload everything
        model = null; // Clear current model
        trainStatusDiv.innerText = "Model cleared (Switching mode).";

        await loadFromFirestore(); // Reload data
        loadSavedLabels(); // Reload labels
        await loadSavedModel(); // Try loading model for new mode
    });
}

function updateModelStatusUI() {
    const statusEl = document.getElementById('model-status');
    if (!statusEl) return;

    if (model) {
        statusEl.innerText = `Model: Active (${currentMode})`;
        statusEl.style.color = "#4db6ac";
    } else {
        statusEl.innerText = `Model: Missing (Train in settings)`;
        statusEl.style.color = "#ef4444";
    }
}

function loadSavedLabels() {
    try {
        const stored = localStorage.getItem(localStorageLabelKey);
        uniqueLabels = stored ? JSON.parse(stored) : [];
        console.log(`Loaded ${uniqueLabels.length} labels for ${currentMode} mode.`);
        if (uniqueLabels.length > 0) {
            console.log("Labels:", uniqueLabels);
        }
    } catch (e) {
        console.error("Failed to parse saved labels from local storage:", e);
        uniqueLabels = [];
    }
}

newMeetingBtn.addEventListener('click', () => {
    let room = startRoomInput.value.trim();
    if (!room) {
        room = Math.random().toString(36).substring(7);
        startRoomInput.value = room;
    }
    joinBtn.disabled = false;
    joinBtn.click();
});

joinBtn.addEventListener('click', async () => {
    roomName = startRoomInput.value.trim();
    if (!roomName) return;

    lobbyStatus.innerText = "Joining...";


    // Diagnostic Button Logic
    const diagBtn = document.createElement('button');
    diagBtn.innerText = "Check Devices";
    diagBtn.className = "btn-text";
    diagBtn.style.marginTop = "10px";
    diagBtn.style.color = "#aaa";
    diagBtn.onclick = async () => {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioDevices = devices.filter(d => d.kind === 'audioinput');
            const videoDevices = devices.filter(d => d.kind === 'videoinput');

            const micModal = document.getElementById('mic-modal');
            const modalRetryBtn = document.getElementById('modalRetryBtn');
            const modalDismissBtn = document.getElementById('modalDismissBtn');

            if (audioDevices.length === 0) {
                micModal.classList.add('active');

                modalRetryBtn.onclick = () => window.location.reload();
                modalDismissBtn.onclick = () => micModal.classList.remove('active');
            } else {
                let msg = `--- Device Report ---\n`;
                msg += `Microphones found: ${audioDevices.length}\n`;
                audioDevices.forEach(d => msg += `- ${d.label || 'Unknown Mic'} (${d.deviceId})\n`);

                msg += `\nCameras found: ${videoDevices.length}\n`;
                videoDevices.forEach(d => msg += `- ${d.label || 'Unknown Cam'} (${d.deviceId})\n`);

                msg += `\nPermission State: ${(await navigator.permissions.query({ name: 'microphone' })).state}`;
                alert(msg);
            }
        } catch (e) {
            alert("Diagnostic failed: " + e.message);
        }
    };
    document.querySelector('.join-box').appendChild(diagBtn);


    // 1. MUST start camera BEFORE joining room to avoid WebRTC errors
    await startCamera();

    joinScreen.classList.remove('active');
    meetingRoom.classList.add('active');
    meetingCodeDisplay.innerText = roomName;

    socket.emit("join-room", roomName);

    if (window.speechSynthesis) {
        const primingUtterance = new SpeechSynthesisUtterance("");
        window.speechSynthesis.speak(primingUtterance);
    }
});

// --- MediaPipe & TF.js Setup ---
const hands = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
});

hands.setOptions({
    maxNumHands: 2,
    modelComplexity: 1,
    minDetectionConfidence: 0.8, // Increased for better mobile detection
    minTrackingConfidence: 0.7,  // Increased to reduce jitter
    selfieMode: true             // Essential for front-facing phone cameras
});

hands.onResults(onResults);

let model = null;
let isCollecting = false;
// Initial Load
if (modeSelect) modeSelect.value = currentMode;
updateModeVariables();
loadSavedLabels();
loadFromFirestore();

function renderSignList() {
    const listDiv = document.getElementById('signList');
    if (!listDiv) return;

    // Group data by label
    const grouped = {};
    collectedData.forEach(item => {
        if (!grouped[item.label]) grouped[item.label] = [];
        grouped[item.label].push(item);
    });

    // Render grouped list
    listDiv.innerHTML = Object.keys(grouped).sort().map(label => {
        const count = grouped[label].length;
        return `
        <div class="sign-item">
            <div class="sign-info">
                <span class="sign-label">${label}</span>
                <span class="sign-count">${count} samples</span>
            </div>
            <button class="delete-btn" onclick="deleteLabel('${label}')" title="Delete Sign">
                <span class="material-icons" style="font-size: 18px;">delete</span>
            </button>
        </div>
        `;
    }).join('');
}

// Global function to delete all data for a specific label
// Global function to delete all data for a specific label
window.deleteLabel = async (label) => {
    if (!confirm(`Are you sure you want to delete the sign "${label}"? This will delete from the database.`)) return;

    // 1. Identify items to delete
    const itemsToDelete = collectedData.filter(d => d.label === label);

    // 2. Delete from Firestore
    // Note: Batch delete is better, but simple loop for now
    for (const item of itemsToDelete) {
        if (item.id) {
            try {
                await deleteDoc(doc(db, dbCollection, item.id));
            } catch (e) {
                console.error("Failed to delete doc:", item.id, e);
            }
        }
    }

    // 3. Update local state
    collectedData = collectedData.filter(d => d.label !== label);
    renderSignList(); // Re-render
    updateDataStats();
    console.log(`Deleted sign: ${label}`);
};

function saveGesture(label, landmarks) {
    const dataPoint = {
        label: label,
        landmarks: landmarks,
        timestamp: Date.now()
    };

    // Add to local state immediately for UI feedback
    collectedData.push(dataPoint);

    // Add to batch queue for upload on mouseup
    batchQueue.push(dataPoint);

    updateDataStats();
}

async function loadSavedModel() {
    try {
        console.log(`Attempting to load model: ${localStorageModelKey}`);
        model = await tf.loadLayersModel(`localstorage://${localStorageModelKey}`);

        // Also load labels associated with this mode
        loadSavedLabels();

        if (model && uniqueLabels.length > 0) {
            console.log("Model and labels loaded safely from local storage.");
            trainStatusDiv.innerText = "Saved model loaded.";
            if (saveBtn) saveBtn.disabled = false;
        } else {
            console.warn("Model loaded but uniqueLabels is empty (or model is null).");
            trainStatusDiv.innerText = "Model found, but labels missing.";
            model = null; // Invalidate if labels are missing
        }
    } catch (e) {
        console.log("No saved model found for this mode yet.");
        model = null;
    }
    updateModelStatusUI();
}
loadSavedModel();

// --- Camera & Hand Tracking ---
let isCameraStarted = false;
async function startCamera() {
    if (isCameraStarted) return;
    isCameraStarted = true;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert("Browser API navigator.mediaDevices.getUserMedia not available. Please ensure you are using a modern browser and running on localhost or HTTPS.");
        return;
    }

    try {
        try {
            console.log("Requesting camera and microphone...");
            const constraints = {
                video: {
                    width: { ideal: 640 },
                    height: { ideal: 480 },
                    frameRate: { ideal: 24, max: 30 }
                },
                audio: {
                    echoCancellation: { ideal: true },
                    noiseSuppression: { ideal: true },
                    autoGainControl: { ideal: true }
                }
            };
            localStream = await navigator.mediaDevices.getUserMedia(constraints);
            console.log("Media access granted.");
        } catch (err) {
            if (err.name === 'NotFoundError') {
                console.warn("Microphone not found, attempting video only.");
                localStream = await navigator.mediaDevices.getUserMedia({ video: true });
                alert("Microphone not found. Starting with camera only.");

                // Disable mic state and UI physically, but allow user to TRY enabling it again.
                isMicOn = false;
                micBtn.innerHTML = `<span class="material-icons">mic_off</span>`;
                micBtn.classList.add('red-btn');
                micBtn.disabled = false; // Allow user to click and retry
                micBtn.title = "No microphone detected (Click to retry)";
                micBtn.style.opacity = "1";
                micBtn.style.cursor = "pointer";

                // Add retry handler ONLY if not already added (simple check)
                if (!micBtn.hasAttribute('data-retry-listener')) {
                    micBtn.setAttribute('data-retry-listener', 'true');
                    micBtn.addEventListener('click', async (e) => {
                        e.stopImmediatePropagation(); // Prevent standard toggle logic
                        try {
                            console.log("Retrying microphone access...");
                            const audioConstraints = {
                                audio: {
                                    echoCancellation: { ideal: true },
                                    noiseSuppression: { ideal: true },
                                    autoGainControl: { ideal: true }
                                }
                            };
                            const newStream = await navigator.mediaDevices.getUserMedia(audioConstraints);

                            // Success! Add track to stream and PC
                            const audioTrack = newStream.getAudioTracks()[0];
                            localStream.addTrack(audioTrack);
                            if (pc) {
                                pc.addTrack(audioTrack, localStream); // sending to remote
                            }

                            // Update UI
                            isMicOn = true;
                            micBtn.innerHTML = `<span class="material-icons">mic</span>`;
                            micBtn.classList.remove('red-btn');
                            micBtn.title = "Turn off microphone";

                            // Initialize analysis for the new track
                            initAudioAnalysis(localStream);

                            alert("Microphone connected successfully!");
                        } catch (retryErr) {
                            console.error("Retry failed:", retryErr);
                            alert("Still cannot find microphone. Please check connection.");
                        }
                    }, { once: true }); // Only try this special retry once per failure state
                }

            } else {
                throw err;
            }
        }
        localVideo.srcObject = localStream;

        let frameCount = 0;
        const camera = new Camera(localVideo, {
            onFrame: async () => {
                if (isCamOn) {
                    // CPU Optimization: Only run AI tracking every 3rd frame (roughly 10-15 FPS)
                    // This keeps the video call smooth while still detecting signs effectively.
                    frameCount++;
                    if (frameCount % 3 === 0) {
                        await hands.send({ image: localVideo });
                    }
                }
            },
        });
        await camera.start();
        initAudioAnalysis(localStream);
    } catch (err) {
        console.error("Camera error:", err);
        let msg = "Could not access camera/microphone.";
        if (err.name === 'NotAllowedError') {
            msg = "Permission denied. Please allow access to camera and microphone in your browser settings.";
        } else if (err.name === 'NotFoundError') {
            msg = "No camera or microphone found. Please connect a device.";
        } else if (err.name === 'NotReadableError') {
            msg = "Camera/Microphone is already in use by another application. Please close other apps and try again.";
        } else if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
            msg = "Camera access requires HTTPS or localhost. You are using " + location.protocol;
        }
        alert(msg);
    }
}

function preprocessLandmarks(landmarks) {
    const wrist = landmarks[0];

    // 1. Translation Invariance: Shift all points relative to the wrist (0,0,0)
    let shifted = landmarks.map(p => ({
        x: p.x - wrist.x,
        y: p.y - wrist.y,
        z: p.z - wrist.z
    }));

    // 2. Scale Invariance: Calculate "hand size" (distance from wrist to index finger MCP)
    // Index MCP is landmark 5
    const indexMCP = shifted[5];
    const distance = Math.sqrt(
        Math.pow(indexMCP.x, 2) +
        Math.pow(indexMCP.y, 2) +
        Math.pow(indexMCP.z, 2)
    ) || 1e-6; // Avoid division by zero

    // 3. Normalize all coordinates by this distance
    return shifted.flatMap(p => [
        p.x / distance,
        p.y / distance,
        p.z / distance
    ]);
}

const predictionBuffer = [];
function getSmoothedPrediction(predLabel) {
    predictionBuffer.push(predLabel);
    if (predictionBuffer.length > 15) predictionBuffer.shift();
    const counts = {};
    predictionBuffer.forEach(l => counts[l] = (counts[l] || 0) + 1);
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

function onResults(results) {
    if (localCanvas.width !== localVideo.videoWidth || localCanvas.height !== localVideo.videoHeight) {
        localCanvas.width = localVideo.videoWidth;
        localCanvas.height = localVideo.videoHeight;
    }

    ctx.save();
    ctx.clearRect(0, 0, localCanvas.width, localCanvas.height);

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        // ALWAYS use the first hand for prediction to avoid "Double Speak" from two hands
        const landmarks = results.multiHandLandmarks[0];

        // Handle Hand Overlay Drawing
        if (isOverlayOn && typeof drawConnectors !== 'undefined') {
            for (const hand of results.multiHandLandmarks) {
                drawConnectors(ctx, hand, HAND_CONNECTIONS, { color: '#00FF00', lineWidth: 4 });
                drawLandmarks(ctx, hand, { color: '#FF0000', lineWidth: 2 });
            }
        }

        // Preprocess for AI (Normalization is Scale/Translation invariant)
        const flatLandmarks = preprocessLandmarks(landmarks);

        // Handle Collection or Prediction
        if (isCollecting) {
            const label = labelInput.value.trim();
            if (label) {
                saveGesture(label, flatLandmarks);
            }
        } else {
            runPrediction(flatLandmarks);
        }
    } else {
        predictionDiv.innerText = "Waiting for hands...";
        predictionBuffer.length = 0;
    }
    ctx.restore();
}

function runPrediction(flatLandmarks) {
    if (model && uniqueLabels.length > 0) {
        // Use tf.tidy to prevent memory leaks
        tf.tidy(() => {
            const input = tf.tensor2d([flatLandmarks]);
            const prediction = model.predict(input);
            const pIndex = prediction.argMax(-1).dataSync()[0];
            const conf = prediction.max().dataSync()[0];

            if (conf > 0.75) {
                const label = uniqueLabels[pIndex];
                const smoothLabel = getSmoothedPrediction(label);
                predictionDiv.innerText = `Sign: ${smoothLabel} (${Math.round(conf * 100)}%)`;

                const now = Date.now();
                const wordLastSpoken = localWordLastSpoken[smoothLabel] || 0;
                const timeSinceAny = now - lastSpokenTime;
                const timeSinceSame = now - wordLastSpoken;

                // 1. Same word must wait 4 seconds (Prevents accidental double-triggers/stutter)
                // 2. Global inter-word gap of 800ms for "fluent" sentences (prevents flicker)
                if (timeSinceSame > 4000 && timeSinceAny > 800) {
                    lastSpokenLabel = smoothLabel;
                    lastSpokenTime = now;
                    localWordLastSpoken[smoothLabel] = now;

                    socket.emit("sign-message", { room: roomName, text: smoothLabel });

                    if (isTTSOn) speak(smoothLabel);

                    // Check for Emoji Shortcuts
                    if (EMOJI_MAP[smoothLabel.toUpperCase()]) {
                        popEmojis(EMOJI_MAP[smoothLabel.toUpperCase()]);
                        socket.emit("emoji-pop", { room: roomName, emoji: EMOJI_MAP[smoothLabel.toUpperCase()] });
                    }
                }
            }
        });
    }
}

// --- Training Logic ---
function saveToLocal() {
    // This helper updates the UI and stats after local data modification
    // Note: Use addDoc/deleteDoc for persistent Firestore changes.
    updateDataStats();
    renderSignList();
}

function updateDataStats() {
    dataCountDiv.innerText = `Samples: ${collectedData.length}`;
}

collectBtn.addEventListener('mousedown', () => isCollecting = true);
collectBtn.addEventListener('mouseup', async () => {
    isCollecting = false;

    if (batchQueue.length > 0) {
        const count = batchQueue.length;
        trainStatusDiv.innerText = `Saving ${count} samples...`;

        // Upload batch
        try {
            const promises = batchQueue.map(data => addDoc(collection(db, dbCollection), data));
            await Promise.all(promises);
            trainStatusDiv.innerText = `Saved ${count} samples to DB!`;
            batchQueue = []; // Clear queue
            // Reload to get IDs? Or just trust it. Reloading is safer for Sync.
            await loadFromFirestore();
        } catch (e) {
            console.error("Error saving batch:", e);
            trainStatusDiv.innerText = "Error saving data.";
        }
    }
});

trainBtn.addEventListener('click', async () => {
    if (collectedData.length < 10) return alert("Collect more data (min 10 samples)!");

    uniqueLabels = [...new Set(collectedData.map(d => d.label))];
    if (uniqueLabels.length < 2) return alert("Need at least 2 different signs.");

    const labelMap = {};
    uniqueLabels.forEach((l, i) => labelMap[l] = i);

    const xs = tf.tensor2d(collectedData.map(d => d.landmarks));
    const ys = tf.oneHot(tf.tensor1d(collectedData.map(d => labelMap[d.label]), 'int32'), uniqueLabels.length);

    const newModel = tf.sequential();
    newModel.add(tf.layers.dense({ units: 64, activation: 'relu', inputShape: [63] }));
    newModel.add(tf.layers.dropout({ rate: 0.2 })); // Prevent overfitting
    newModel.add(tf.layers.dense({ units: 32, activation: 'relu' }));
    newModel.add(tf.layers.dense({ units: uniqueLabels.length, activation: 'softmax' }));

    newModel.compile({ optimizer: 'adam', loss: 'categoricalCrossentropy', metrics: ['accuracy'] });

    trainStatusDiv.innerText = "Training...";
    trainBtn.disabled = true;

    await newModel.fit(xs, ys, {
        epochs: 40,
        shuffle: true,
        callbacks: {
            onEpochEnd: (epoch, logs) => {
                trainStatusDiv.innerText = `Loss: ${logs.loss.toFixed(3)}`;
            }
        }
    });

    model = newModel;
    updateModelStatusUI();
    trainStatusDiv.innerText = "Training Done!";
    trainBtn.disabled = false;
    if (saveBtn) saveBtn.disabled = false;

    // 4. Auto-save for better persistence
    try {
        await model.save(`localstorage://${localStorageModelKey}`);
        localStorage.setItem(localStorageLabelKey, JSON.stringify(uniqueLabels));
        console.log("Model and labels auto-saved successfully.");
    } catch (err) {
        console.error("Auto-save failed:", err);
    }

    xs.dispose();
    ys.dispose();
});

saveBtn.addEventListener('click', async () => {
    if (!model) return;
    await model.save(`localstorage://${localStorageModelKey}`);
    localStorage.setItem(localStorageLabelKey, JSON.stringify(uniqueLabels));
    alert("Model and labels saved!");
});

clearBtn.addEventListener('click', () => {
    if (!confirm("Are you sure you want to delete ALL collected training gestures? This cannot be undone.")) return;

    collectedData = [];
    saveToLocal();
    console.log("Deleted all gestures.");
});

// --- Signaling & WebRTC ---
socket.on("user-joined", async (id) => {
    console.log("New peer joined room:", id);
    updatePeopleList(id); // Update the People panel
    if (!localStream) {
        console.warn("Local stream not ready. Peer connection delayed.");
        return;
    }
    createPeerConnection();
    const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
    });
    // Set max bitrate to 1000kbps (stable for 480p)
    offer.sdp = setMaxBitrate(offer.sdp, 1000);
    await pc.setLocalDescription(offer);
    console.log("Sending offer to peer...");
    socket.emit("offer", { room: roomName, sdp: offer });
});

socket.on("user-left", (id) => {
    console.log("Peer left room:", id);
    updatePeopleList(null); // Remove from People panel
    // Cleanup peer connection if it matches
    if (pc) {
        pc.close();
        pc = null;
    }
    // Remote video cleanup
    if (remoteVideo) {
        remoteVideo.srcObject = null;
    }
});

socket.on("offer", async (data) => {
    console.log("Offer received from peer");
    if (!pc) createPeerConnection();
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    processBufferedIceCandidates();
    const answer = await pc.createAnswer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
    });
    // Set max bitrate to 1000kbps (stable for 480p)
    answer.sdp = setMaxBitrate(answer.sdp, 1000);
    await pc.setLocalDescription(answer);
    console.log("Sending answer...");
    socket.emit("answer", { room: roomName, sdp: answer });
});

socket.on("answer", async (data) => {
    console.log("Answer received from peer");
    if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        processBufferedIceCandidates();
    }
});

socket.on("ice", async (data) => {
    if (pc && pc.remoteDescription && pc.remoteDescription.type) {
        try {
            await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (e) {
            console.error("Error adding ICE candidate:", e);
        }
    } else {
        iceCandidatesBuffer.push(data.candidate);
    }
});

async function processBufferedIceCandidates() {
    console.log(`Processing ${iceCandidatesBuffer.length} buffered ICE candidates`);
    while (iceCandidatesBuffer.length > 0) {
        const candidate = iceCandidatesBuffer.shift();
        try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
            console.error("Error adding buffered ICE candidate:", e);
        }
    }
}

socket.on("sign-message", data => {
    remotePredictionDiv.innerText = data.text;
    remoteCaptionOverlay.classList.remove('hidden');
    setTimeout(() => remoteCaptionOverlay.classList.add('hidden'), 3000);

    const now = Date.now();
    const wordLastSpoken = remoteWordLastSpoken[data.text] || 0;
    const timeSinceAny = now - lastRemoteSpokenTime;
    const timeSinceSame = now - wordLastSpoken;

    // Symmetric logic for remote signs to avoid redundant peer-side chatter
    // Same rule: 4s for same-word repeat, 800ms for fluent different-word sequence
    if (isTTSOn && timeSinceSame > 4000 && timeSinceAny > 800) {
        speak(data.text);
        lastRemoteSpokenText = data.text;
        lastRemoteSpokenTime = now;
        remoteWordLastSpoken[data.text] = now;
    }
});

socket.on("speech-message", data => {
    showSTT(data.text, false);
});

socket.on("volume-level", data => {
    if (remoteVolumeMeter) {
        if (data.level > 0.02) {
            remoteVolumeMeter.classList.add('volume-active');
        } else {
            remoteVolumeMeter.classList.remove('volume-active');
        }
    }
});

socket.on("emoji-pop", data => {
    popEmojis(data.emoji);
});

function createPeerConnection() {
    pc = new RTCPeerConnection(rtcConfig);

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit("ice", { room: roomName, candidate: event.candidate });
        }
    };

    pc.ontrack = (event) => {
        console.log("Remote track received:", event.track.kind);

        // Prefer using the stream provided by the event, this handles audio+video sync better
        if (event.streams && event.streams[0]) {
            if (remoteVideo.srcObject !== event.streams[0]) {
                remoteVideo.srcObject = event.streams[0];
                console.log("Attached remote stream from event");
            }
        } else {
            // Fallback: manually manage the stream if event.streams is missing
            if (!remoteVideo.srcObject || !(remoteVideo.srcObject instanceof MediaStream)) {
                remoteVideo.srcObject = new MediaStream();
            }
            remoteVideo.srcObject.addTrack(event.track);
        }

        // Ensure the remote video is unmuted and plays
        remoteVideo.muted = false;
        remoteVideo.volume = 1.0;

        // Final attempt to play, catching block errors
        const playPromise = remoteVideo.play();
        if (playPromise !== undefined) {
            playPromise.then(_ => {
                console.log("Autoplay success!");
            }).catch(error => {
                console.warn("Autoplay was prevented. User must interact with page first.");
                // We show this via the STT overlay as a hint
                if (sttText) sttText.innerText = "Click anywhere to enable remote sound!";
                sttOverlay.classList.remove('hidden');
            });
        }
    };

    if (localStream) {
        console.log(`Adding ${localStream.getTracks().length} local tracks to PeerConnection`);
        localStream.getTracks().forEach(track => {
            pc.addTrack(track, localStream);
        });
    } else {
        console.error("localStream is null when createPeerConnection is called!");
    }

    pc.onconnectionstatechange = () => {
        console.log("WebRTC Connection State:", pc.connectionState);
    };

    pc.oniceconnectionstatechange = () => {
        console.log("WebRTC ICE Connection State:", pc.iceConnectionState);
    };
}

// --- Audio Controls ---
micBtn.addEventListener('click', async () => {
    if (!localStream || !localStream.getAudioTracks().length) {
        console.warn("No audio track to toggle");
        return;
    }

    isMicOn = !isMicOn;
    localStream.getAudioTracks()[0].enabled = isMicOn;

    // Ensure AudioContext resumes if it was blocked by browser
    if (isMicOn && audioContext && audioContext.state === 'suspended') {
        await audioContext.resume();
    }

    micBtn.innerHTML = `<span class="material-icons">${isMicOn ? 'mic' : 'mic_off'}</span>`;
    micBtn.classList.toggle('red-btn', !isMicOn);
    micBtn.setAttribute('title', isMicOn ? 'Turn off microphone' : 'Turn on microphone');
});

camBtn.addEventListener('click', () => {
    isCamOn = !isCamOn;
    localStream.getVideoTracks().forEach(track => track.enabled = isCamOn);

    const localContainer = document.getElementById('localContainer');

    // UI feedback for video state
    if (!isCamOn) {
        ctx.clearRect(0, 0, localCanvas.width, localCanvas.height);
        predictionDiv.innerText = "Camera Off";
        localContainer.classList.add('video-muted');
    } else {
        localContainer.classList.remove('video-muted');
        predictionDiv.innerText = "Waiting for sign...";
    }

    camBtn.innerHTML = `<span class="material-icons">${isCamOn ? 'videocam' : 'videocam_off'}</span>`;
    camBtn.classList.toggle('red-btn', !isCamOn);
    camBtn.setAttribute('title', isCamOn ? 'Turn off camera' : 'Turn on camera');
});

ttsBtn.addEventListener('click', () => {
    isTTSOn = !isTTSOn;
    updateTTSUI();
});

function speak(text) {
    if (!window.speechSynthesis) return;

    // 1. Hardware-level safety: Unified temporal debounce (500ms)
    // This prevents double-speaking if local prediction and remote socket fire at once,
    // or if MediaPipe triggers multiple results in the same event loop.
    const now = Date.now();
    if (now - (window._lastSystemSpeakTime || 0) < 500) {
        console.log("Speech suppressed: debounce active.");
        return;
    }
    window._lastSystemSpeakTime = now;

    // 2. Clear any pending speak operation to avoid the setTimeout race condition
    if (speakTimeout) {
        clearTimeout(speakTimeout);
        speakTimeout = null;
    }

    // 3. Cancel current speech and queue the new one
    // We use a small delay because window.speechSynthesis.cancel() is often asynchronous 
    // on the OS level and needs a moment to clear hardware buffers.
    window.speechSynthesis.cancel();

    speakTimeout = setTimeout(() => {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        utterance.volume = 1.0;

        window.speechSynthesis.speak(utterance);
        speakTimeout = null;
    }, 50);
}

// --- Chat Logic ---

function closeAllPanels() {
    sidePanel.classList.remove('open');
    chatPanel.classList.remove('open');
    if (infoPanel) infoPanel.classList.remove('open');
    if (peoplePanel) peoplePanel.classList.remove('open');
}

// Toggle Chat Panel
if (chatToggleBtn) {
    chatToggleBtn.addEventListener('click', () => {
        const isOpen = chatPanel.classList.contains('open');
        closeAllPanels();
        if (!isOpen) chatPanel.classList.add('open');
        if (chatToggleBtn) chatToggleBtn.style.color = '';
    });
}

// Toggle Info Panel
if (infoBtn) {
    infoBtn.addEventListener('click', () => {
        const isOpen = infoPanel.classList.contains('open');
        closeAllPanels();
        if (!isOpen) {
            infoPanel.classList.add('open');
            // Update info display
            if (infoMeetingCode) infoMeetingCode.innerText = roomName || "N/A";
            if (infoCurrentMode) infoCurrentMode.innerText = `${currentMode} Mode`;
        }
    });
}

// Toggle People Panel
if (peopleBtn) {
    peopleBtn.addEventListener('click', () => {
        const isOpen = peoplePanel.classList.contains('open');
        closeAllPanels();
        if (!isOpen) peoplePanel.classList.add('open');
    });
}

if (closeChatBtn) closeChatBtn.addEventListener('click', () => chatPanel.classList.remove('open'));
if (closeInfoBtn) closeInfoBtn.addEventListener('click', () => infoPanel.classList.remove('open'));
if (closePeopleBtn) closePeopleBtn.addEventListener('click', () => peoplePanel.classList.remove('open'));

if (copyInfoCodeBtn) {
    copyInfoCodeBtn.addEventListener('click', () => {
        if (!roomName) return;
        navigator.clipboard.writeText(roomName).then(() => {
            const icon = copyInfoCodeBtn.querySelector('.material-icons');
            icon.innerText = 'done';
            setTimeout(() => icon.innerText = 'content_copy', 2000);
        });
    });
}

// Chat Input Logic
chatInput.addEventListener('input', (e) => {
    sendChatBtn.disabled = e.target.value.trim().length === 0;
});

chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !sendChatBtn.disabled) {
        sendMessage();
    }
});

sendChatBtn.addEventListener('click', sendMessage);

function sendMessage() {
    const text = chatInput.value.trim();
    if (!text) return;

    // Emit to server
    const msgData = { room: roomName, text: text, sender: 'You', timestamp: Date.now() };
    socket.emit('chat-message', msgData);

    // Display locally
    appendMessage(msgData, 'self');

    // Clear input
    chatInput.value = '';
    sendChatBtn.disabled = true;
}

socket.on('chat-message', (data) => {
    appendMessage({ ...data, sender: 'Remote User' }, 'remote');
    if (!chatPanel.classList.contains('open') && chatToggleBtn) {
        // Optional: Show notification dot on chat button
        chatToggleBtn.style.color = '#e37400'; // Orange alert
    }
});

function updatePeopleList(remoteId = null) {
    if (!peopleList) return;

    let html = `
        <div class="person-item">
            <div class="person-avatar">Y</div>
            <div class="person-info">
                <div class="person-name">You (Local)</div>
                <div class="person-status">Connected</div>
            </div>
        </div>
    `;

    if (remoteId) {
        html += `
            <div class="person-item">
                <div class="person-avatar" style="background: #e37400;">R</div>
                <div class="person-info">
                    <div class="person-name">Remote User</div>
                    <div class="person-status" style="color: #4db6ac;">Connected</div>
                </div>
            </div>
        `;
    }

    peopleList.innerHTML = html;
}

function appendMessage(data, type) {
    const time = new Date(data.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const div = document.createElement('div');
    div.classList.add('message-wrapper', type);
    div.innerHTML = `
        <div class="message-sender">${data.sender}</div>
        <div class="message-bubble">
            ${data.text}
        </div>
        <div class="message-time">${time}</div>
    `;

    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight; // Auto scroll
}

// --- UI Toggles ---
const overlayBtn = document.getElementById('overlayBtn');
let isOverlayOn = true;

// Overlay Toggle
if (overlayBtn) {
    overlayBtn.addEventListener('click', () => {
        isOverlayOn = !isOverlayOn;
        overlayBtn.innerHTML = `<span class="material-icons" style="color: ${isOverlayOn ? '#4db6ac' : '#8b949e'};">${isOverlayOn ? 'layers' : 'layers_clear'}</span>`;
        overlayBtn.title = isOverlayOn ? "Hide Hand Overlay" : "Show Hand Overlay";
    });
}

// Toggles are already wired up above to isOverlayOn variable


// Training Toggle
trainToggleBtn.addEventListener('click', () => {
    const isOpen = sidePanel.classList.contains('open');
    closeAllPanels();
    if (!isOpen) sidePanel.classList.add('open');
});

// Upload Dataset Logic
const uploadBtn = document.getElementById('uploadBtn');
const uploadInput = document.getElementById('uploadInput');

if (uploadBtn && uploadInput) {
    uploadBtn.addEventListener('click', () => uploadInput.click());

    uploadInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const uploadedData = JSON.parse(event.target.result);
                if (!Array.isArray(uploadedData)) throw new Error("Invalid format: Root must be an array.");

                // Simple validation
                if (uploadedData.length > 0 && (!uploadedData[0].label || !uploadedData[0].landmarks)) {
                    throw new Error("Invalid format: Items must have 'label' and 'landmarks'.");
                }

                // Merge with existing data
                collectedData = [...collectedData, ...uploadedData];
                saveToLocal(); // Save and update UI
                alert(`Successfully imported ${uploadedData.length} samples!`);
            } catch (err) {
                alert("Error importing dataset: " + err.message);
                console.error(err);
            }
        };
        reader.readAsText(file);
        // Reset input so same file can be selected again
        e.target.value = '';
    });
}


closePanelBtn.addEventListener('click', () => sidePanel.classList.remove('open'));
hangupBtn.addEventListener('click', () => window.location.reload());

// More Options Toggle (Mobile)
const moreBtn = document.getElementById('moreBtn');
const secondaryControls = document.getElementById('secondary-controls');

if (moreBtn && secondaryControls) {
    moreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        secondaryControls.classList.toggle('active');
    });

    // Close dropdown when clicking elsewhere
    document.addEventListener('click', (e) => {
        if (!secondaryControls.contains(e.target) && !moreBtn.contains(e.target)) {
            secondaryControls.classList.remove('active');
        }
    });
}

// Copy Code Logic
const copyCodeBtn = document.getElementById('copyCodeBtn');
if (copyCodeBtn) {
    copyCodeBtn.addEventListener('click', () => {
        const code = meetingCodeDisplay.innerText;
        navigator.clipboard.writeText(code).then(() => {
            const originalText = meetingCodeDisplay.innerText;
            meetingCodeDisplay.innerText = "COPIED!";
            setTimeout(() => {
                meetingCodeDisplay.innerText = originalText;
            }, 1500);
        });
    });
}