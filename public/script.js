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

// --- Global State ---
let localStream;
let pc;
let roomName;
let isMicOn = true;
let isCamOn = true;
let isTTSOn = true;
let isSTTOn = false;
let lastSpokenLabel = "";
let lastSpokenTime = 0;

// Accessibility Feature States
let recognition;
let audioContext;
let analyser;
let micSource;
let volumeInterval;

const rtcConfig = {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

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
    sttToggleBtn.innerHTML = `<span class="material-icons">${isSTTOn ? 'interpreter_mode' : 'voice_over_off'}</span>`;
    sttToggleBtn.classList.toggle('red-btn', !isSTTOn);
    sttToggleBtn.title = isSTTOn ? "Turn off Speech-to-Text" : "Turn on Speech-to-Text";
}

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
    try {
        if (!stream.getAudioTracks().length) return;

        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        micSource = audioContext.createMediaStreamSource(stream);
        micSource.connect(analyser);
        analyser.fftSize = 256;

        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        function checkVolume() {
            if (!isMicOn) {
                localVolumeMeter.classList.remove('volume-active');
                localVolumeMeter.style.transform = 'scaleY(1)';
                return;
            }

            analyser.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < bufferLength; i++) {
                sum += dataArray[i];
            }
            let average = sum / bufferLength;
            let volume = average / 128; // 0 to 2

            if (volume > 0.1) {
                localVolumeMeter.classList.add('volume-active');
                localVolumeMeter.style.transform = `scaleY(${1 + volume})`;
                // Emit volume to remote
                socket.emit('volume-level', { room: roomName, level: volume });
            } else {
                localVolumeMeter.classList.remove('volume-active');
                localVolumeMeter.style.transform = 'scaleY(1)';
                socket.emit('volume-level', { room: roomName, level: 0 });
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

function loadSavedLabels() {
    uniqueLabels = JSON.parse(localStorage.getItem(localStorageLabelKey)) || [];
}

newMeetingBtn.addEventListener('click', () => {
    const randomId = Math.random().toString(36).substring(7);
    startRoomInput.value = randomId;
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
// Initial Load
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
        model = await tf.loadLayersModel(`localstorage://${localStorageModelKey}`);
        console.log("Model loaded from local storage");
        trainStatusDiv.innerText = "Model loaded.";
    } catch (e) {
        console.log("No saved model found.");
    }
}
loadSavedModel();

// --- Camera & Hand Tracking ---
async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert("Browser API navigator.mediaDevices.getUserMedia not available. Please ensure you are using a modern browser and running on localhost or HTTPS.");
        return;
    }

    try {
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
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
                            const newStream = await navigator.mediaDevices.getUserMedia({ audio: true });

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
                            alert("Microphone connected successfully!");

                            // Remove this temporary listener so standard toggle works next time
                            // (Reloading page is cleaner, but this is a hotfix)
                            window.location.reload();
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

        const camera = new Camera(localVideo, {
            onFrame: async () => {
                await hands.send({ image: localVideo });
            },
            // Removing hardcoded width/height to let browser/MediaPipe 
            // choose the best native resolution for the device (Portrait on mobile)
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
    // Normalize coordinates relative to wrist
    return landmarks.flatMap(p => [
        p.x - wrist.x,
        p.y - wrist.y,
        p.z - wrist.z
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
        for (const landmarks of results.multiHandLandmarks) {
            // Draw connectors using MediaPipe drawing utils
            if (typeof drawConnectors !== 'undefined') {
                drawConnectors(ctx, landmarks, HAND_CONNECTIONS, { color: '#00FF00', lineWidth: 4 });
                drawLandmarks(ctx, landmarks, { color: '#FF0000', lineWidth: 2 });
            }

            const flatLandmarks = preprocessLandmarks(landmarks);

            if (isCollecting) {
                const label = labelInput.value.trim();
                if (label) {
                    // collectedData.push({ label: label, landmarks: flatLandmarks });
                    // updateDataStats();
                    // Save to Firebase instead
                    saveGesture(label, flatLandmarks);
                }
            } else {
                runPrediction(flatLandmarks);
            }
        }
    } else {
        predictionDiv.innerText = "Waiting for hands...";
        predictionBuffer.length = 0; // Clear buffer when hand leaves
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

            if (conf > 0.75) { // Increased confidence threshold
                const label = uniqueLabels[pIndex];
                const smoothLabel = getSmoothedPrediction(label);
                predictionDiv.innerText = `Sign: ${smoothLabel} (${Math.round(conf * 100)}%)`;

                if (isTTSOn && smoothLabel !== lastSpokenLabel && (Date.now() - lastSpokenTime > 3000)) {
                    lastSpokenLabel = smoothLabel;
                    lastSpokenTime = Date.now();
                    socket.emit("sign-message", { room: roomName, text: smoothLabel });

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
    trainStatusDiv.innerText = "Training Done!";
    trainBtn.disabled = false;
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
    console.log("Peer connected:", id);
    if (!localStream) return; // Prevent race condition
    createPeerConnection();
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("offer", { room: roomName, sdp: offer });
});

socket.on("offer", async (data) => {
    if (!pc) createPeerConnection();
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit("answer", { room: roomName, sdp: answer });
});

socket.on("answer", async (data) => {
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
});

socket.on("ice", async (data) => {
    if (pc) await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
});

socket.on("sign-message", data => {
    remotePredictionDiv.innerText = data.text;
    remoteCaptionOverlay.classList.remove('hidden');
    setTimeout(() => remoteCaptionOverlay.classList.add('hidden'), 3000);
    if (isTTSOn) speak(data.text);
});

socket.on("speech-message", data => {
    showSTT(data.text, false);
});

socket.on("volume-level", data => {
    if (remoteVolumeMeter) {
        if (data.level > 0.1) {
            remoteVolumeMeter.classList.add('volume-active');
            remoteVolumeMeter.style.transform = `scaleY(${1 + data.level})`;
        } else {
            remoteVolumeMeter.classList.remove('volume-active');
            remoteVolumeMeter.style.transform = 'scaleY(1)';
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
        remoteVideo.srcObject = event.streams[0];
    };

    if (localStream) {
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }
}

// --- Audio Controls ---
micBtn.addEventListener('click', () => {
    isMicOn = !isMicOn;
    localStream.getAudioTracks()[0].enabled = isMicOn;
    micBtn.innerHTML = `<span class="material-icons">${isMicOn ? 'mic' : 'mic_off'}</span>`;
    micBtn.classList.toggle('red-btn', !isMicOn);
    micBtn.setAttribute('title', isMicOn ? 'Turn off microphone' : 'Turn on microphone');
});

camBtn.addEventListener('click', () => {
    isCamOn = !isCamOn;
    localStream.getVideoTracks()[0].enabled = isCamOn;
    camBtn.innerHTML = `<span class="material-icons">${isCamOn ? 'videocam' : 'videocam_off'}</span>`;
    camBtn.classList.toggle('red-btn', !isCamOn);
    camBtn.setAttribute('title', isCamOn ? 'Turn off camera' : 'Turn on camera');
});

ttsBtn.addEventListener('click', () => {
    isTTSOn = !isTTSOn;
    ttsBtn.innerHTML = `<span class="material-icons">${isTTSOn ? 'volume_up' : 'volume_off'}</span>`;
    ttsBtn.classList.toggle('red-btn', !isTTSOn);
    ttsBtn.setAttribute('title', isTTSOn ? 'Mute Text-to-Speech' : 'Enable Text-to-Speech');
});

function speak(text) {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    window.speechSynthesis.speak(utterance);
}

// --- Chat Logic ---
const chatPanel = document.getElementById('chat-panel');
const closeChatBtn = document.getElementById('closeChatBtn');
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const sendChatBtn = document.getElementById('sendChatBtn');

// Toggle Chat Panel (reusing info button or adding new one? Using existing 'Chat' button at bottom right)
const chatToggleBtn = document.getElementById('chatToggleBtn');
if (chatToggleBtn) {
    chatToggleBtn.addEventListener('click', () => {
        chatPanel.classList.toggle('open');
        // Close training panel if open
        sidePanel.classList.remove('open');
        // Reset alert color
        chatToggleBtn.style.color = '';
    });
}

closeChatBtn.addEventListener('click', () => chatPanel.classList.remove('open'));

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

// Modify onResults to respect overlay state
const originalOnResults = onResults;
onResults = function (results) {
    if (localCanvas.width !== localVideo.videoWidth || localCanvas.height !== localVideo.videoHeight) {
        localCanvas.width = localVideo.videoWidth;
        localCanvas.height = localVideo.videoHeight;
    }

    ctx.save();
    ctx.clearRect(0, 0, localCanvas.width, localCanvas.height);

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        for (const landmarks of results.multiHandLandmarks) {
            // Draw connectors ONLY if overlay is ON
            if (isOverlayOn && typeof drawConnectors !== 'undefined') {
                drawConnectors(ctx, landmarks, HAND_CONNECTIONS, { color: '#00FF00', lineWidth: 4 });
                drawLandmarks(ctx, landmarks, { color: '#FF0000', lineWidth: 2 });
            }

            const flatLandmarks = preprocessLandmarks(landmarks);

            // Prediction runs AUTOMATICALLY regardless of overlay
            if (isCollecting) {
                const label = labelInput.value.trim();
                if (label) {
                    saveGesture(label, flatLandmarks);
                }
            } else {
                runPrediction(flatLandmarks);
            }
        }
    } else {
        predictionDiv.innerText = "Waiting for hands...";
        predictionBuffer.length = 0;
    }
    ctx.restore();
}
// Re-bind the modified function to hands
hands.onResults(onResults);


// Training Toggle
trainToggleBtn.addEventListener('click', () => {
    sidePanel.classList.toggle('open');
    chatPanel.classList.remove('open');
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