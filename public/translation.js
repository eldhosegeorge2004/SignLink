
const videoElement = document.getElementById('input-video');
const canvasElement = document.getElementById('output-canvas');
const canvasCtx = canvasElement.getContext('2d');
const signView = document.getElementById('sign-view');
const speechView = document.getElementById('speech-view');
const camBtn = document.getElementById('cam-btn');
const ttsBtn = document.getElementById('tts-btn');
const modeBtn = document.getElementById('mode-btn');
const modeText = document.getElementById('mode-text');
const sttResult = document.getElementById('stt-result');
const listeningText = document.getElementById('listening-text');

let isSignToTextMode = true;
let isCamOn = true;
let isTTSOn = false;
let lastSpokenLabel = "";
let lastSpokenTime = 0;
let localStream = null;
let camera = null;
let recognition = null; // For Speech to Text

// --- Spelling Mode State ---
let accumulatedWord = "";
let lastLetterTime = 0;
let lastAddedLetter = null;
let spellingInterval = null;

// --- Model & State ---
// Hybrid Model Approaches:
// 1. Server Model (Pre-trained ISL Dataset)
// 2. Local Model (User Generated via AI Training)
let serverModel = null;
let serverLabels = [];
let localModel = null;
let localLabels = [];

const predictionBuffer = [];
let localStorageModelKey = 'my-isl-model'; // Default
let localStorageLabelKey = 'isl_labels';

// Language Selector Logic
const langSelect = document.getElementById('lang-select');
if (langSelect) {
    langSelect.addEventListener('change', (e) => {
        const lang = e.target.value;
        if (lang === 'ISL') {
            localStorageModelKey = 'my-isl-model';
            localStorageLabelKey = 'isl_labels';
        } else {
            // For ASL or others, we might only have local models for now
            // or different server models. For now, assume mainly local for ASL.
            localStorageModelKey = 'my-asl-model';
            localStorageLabelKey = 'asl_labels';
        }
        sttResult.innerText = `Switched to ${lang}. Loading models...`;
        loadSavedModelAndLabels();
    });
}

// Load Models and Labels (Hybrid)
async function loadSavedModelAndLabels() {
    try {
        // Reset State
        serverModel = null;
        serverLabels = [];
        localModel = null;
        localLabels = [];
        predictionBuffer.length = 0;

        const promises = [];

        // 1. Load Server Model (ISL Only for now)
        if (localStorageModelKey === 'my-isl-model') {
            const serverLoad = async () => {
                console.log("Attempting to load Server Model...");
                try {
                    const response = await fetch('labels.json');
                    if (response.ok) {
                        serverLabels = await response.json();
                        serverModel = await tf.loadLayersModel('model/model.json');
                        console.log(`Server Model loaded (${serverLabels.length} labels)`);
                    } else {
                        console.warn("labels.json not found.");
                    }
                } catch (e) {
                    console.warn("Server model load failed:", e);
                }
            };
            promises.push(serverLoad());
        }

        // 2. Load Local Model (Always try, based on keys)
        const localLoad = async () => {
            console.log("Attempting to load Local Model...");
            try {
                const localLabelData = localStorage.getItem(localStorageLabelKey);
                if (localLabelData) {
                    localLabels = JSON.parse(localLabelData);
                    try {
                        localModel = await tf.loadLayersModel(`localstorage://${localStorageModelKey}`);
                        console.log(`Local Model loaded (${localLabels.length} labels)`);
                    } catch (e) {
                        console.warn("Local model weights not found in localStorage.");
                        localModel = null; // Ensure null if load fails
                    }
                }
            } catch (e) {
                console.warn("Local model load failed:", e);
            }
        };
        promises.push(localLoad());

        // Wait for both
        await Promise.all(promises);

        // 3. UI Feedback
        let statusMsg = "";
        if (serverModel && localModel) {
            statusMsg = "Hybrid Mode: Server & Local Models Loaded.";
        } else if (serverModel) {
            statusMsg = "Server Model Loaded.";
        } else if (localModel) {
            statusMsg = "Local Model Loaded.";
        } else {
            statusMsg = "No models found. Please train in AI Training mode.";
        }
        sttResult.innerText = statusMsg;

        // "Go to Training" button if absolutely nothing
        if (!serverModel && !localModel) {
            if (!document.getElementById('goto-training-btn')) {
                const btn = document.createElement('button');
                btn.id = 'goto-training-btn';
                btn.innerText = "Go to AI Training";
                btn.className = "control-btn";
                // ... styling ...
                btn.style.marginTop = "10px";
                btn.style.background = "#3b82f6";
                btn.onclick = () => window.location.href = 'training.html';
                sttResult.parentElement.appendChild(btn);
            }
        } else {
            const btn = document.getElementById('goto-training-btn');
            if (btn) btn.remove();
        }

    } catch (e) {
        console.error("Error in hybrid load:", e);
        sttResult.innerText = "Error loading systems.";
    }
}
loadSavedModelAndLabels();

// --- MediaPipe Setup ---
const hands = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
});

hands.setOptions({
    maxNumHands: 2,
    modelComplexity: 1,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
});

hands.onResults(onResults);

function preprocessLandmarks(landmarks) {
    const wrist = landmarks[0];

    // 1. Translation Invariance
    let shifted = landmarks.map(p => ({
        x: p.x - wrist.x,
        y: p.y - wrist.y,
        z: p.z - wrist.z
    }));

    // 2. Scale Invariance
    const indexMCP = shifted[5];
    const distance = Math.sqrt(
        Math.pow(indexMCP.x, 2) +
        Math.pow(indexMCP.y, 2) +
        Math.pow(indexMCP.z, 2)
    ) || 1e-6;

    // 3. Normalize
    return shifted.flatMap(p => [
        p.x / distance,
        p.y / distance,
        p.z / distance
    ]);
}

function getSmoothedPrediction(predLabel) {
    predictionBuffer.push(predLabel);
    if (predictionBuffer.length > 10) predictionBuffer.shift(); // Slightly faster response
    const counts = {};
    predictionBuffer.forEach(l => counts[l] = (counts[l] || 0) + 1);
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}


function flipLandmarks(landmarks) {
    return landmarks.map(p => ({
        x: 1 - p.x,
        y: p.y,
        z: p.z
    }));
}

// Helper to run a single model prediction
function predictSingleModel(modelInstance, labels, tensor) {
    if (!modelInstance || !labels.length) return { label: null, conf: 0 };

    const pred = modelInstance.predict(tensor);
    const conf = pred.max().dataSync()[0];
    const idx = pred.argMax(-1).dataSync()[0];

    // Cleanup happens in tf.tidy in caller
    return { label: labels[idx], conf: conf };
}

function runPrediction(landmarks) {
    // We need at least one model
    if (!serverModel && !localModel) return;

    tf.tidy(() => {
        // Prepare Inputs
        const flatNormal = preprocessLandmarks(landmarks);
        const tensorNormal = tf.tensor2d([flatNormal]);

        const flipped = flipLandmarks(landmarks);
        const flatFlipped = preprocessLandmarks(flipped);
        const tensorFlipped = tf.tensor2d([flatFlipped]);

        // We will collect candidates from all available models + mirror states
        // Structure: { label, conf, source }
        let candidates = [];

        // 1. Query Server Model
        if (serverModel && serverLabels.length) {
            const pNorm = predictSingleModel(serverModel, serverLabels, tensorNormal);
            candidates.push({ ...pNorm, source: 'Server' });

            const pFlip = predictSingleModel(serverModel, serverLabels, tensorFlipped);
            // Optional: Penalize flipped slightly if needed, or treat equally
            candidates.push({ ...pFlip, source: 'Server(M)' });
        }

        // 2. Query Local Model
        if (localModel && localLabels.length) {
            const pNorm = predictSingleModel(localModel, localLabels, tensorNormal);
            candidates.push({ ...pNorm, source: 'Local' });

            const pFlip = predictSingleModel(localModel, localLabels, tensorFlipped);
            candidates.push({ ...pFlip, source: 'Local(M)' });
        }

        // 3. Find Best Candidate
        // Sort by confidence descending
        candidates.sort((a, b) => b.conf - a.conf);
        const best = candidates[0];

        // 4. Threshold & Display
        if (best && best.conf > 0.6) { // Global threshold
            const smoothLabel = getSmoothedPrediction(best.label);

            // Check if it's a single letter (A-Z)
            if (smoothLabel.length === 1 && /^[a-zA-Z]$/.test(smoothLabel)) {
                handleSpelling(smoothLabel);
                sttResult.innerText = `Sign: ${smoothLabel} (${Math.round(best.conf * 100)}%)`;
            } else {
                sttResult.innerText = `Sign: ${smoothLabel}`;
                speakText(smoothLabel);
            }
        } else {
            sttResult.innerText = "Listening...";
        }
    });
}

function onResults(results) {
    // Resize canvas
    if (canvasElement.width !== videoElement.videoWidth || canvasElement.height !== videoElement.videoHeight) {
        canvasElement.width = videoElement.videoWidth;
        canvasElement.height = videoElement.videoHeight;
    }

    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

    if (results.multiHandLandmarks) {
        for (const landmarks of results.multiHandLandmarks) {
            drawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS, { color: '#00FF00', lineWidth: 5 });
            drawLandmarks(canvasCtx, landmarks, { color: '#FF0000', lineWidth: 2 });
            runPrediction(landmarks);
        }
    } else {
        // Reset state on hand loss
        if (lastAddedLetter !== null) {
            lastAddedLetter = null;
        }
    }
    canvasCtx.restore();
}

// --- Spelling Logic ---
function handleSpelling(letter) {
    const now = Date.now();
    lastLetterTime = now;

    // Strict State-Based Filtering:
    if (letter === lastAddedLetter) {
        return;
    }

    lastAddedLetter = letter;
    accumulatedWord += letter;

    // Speak the letter immediately
    if (isTTSOn) speakText(letter.toLowerCase());

    updateSpellingDisplay();
}

function updateSpellingDisplay() {
    const overlay = document.getElementById('spelling-overlay');
    const textEl = document.getElementById('spelling-text');

    if (accumulatedWord.length > 0) {
        if(overlay) overlay.style.display = 'block';
        if(textEl) textEl.innerText = accumulatedWord;
    } else {
        if(overlay) overlay.style.display = 'none';
        if(textEl) textEl.innerText = "";
    }
}

// Check for 3-second silence to finish the word
setInterval(() => {
    if (accumulatedWord.length > 0) {
        const now = Date.now();
        if (now - lastLetterTime > 3000) {
            finishSpelling();
        }
    }
}, 500);

function finishSpelling() {
    const wordToSpeak = accumulatedWord.charAt(0).toUpperCase() + accumulatedWord.slice(1).toLowerCase();

    // Speak the whole word
    speakText(wordToSpeak);

    // Show in main result area
    sttResult.innerText = `Spelled: ${wordToSpeak}`;

    // Reset
    accumulatedWord = "";
    lastAddedLetter = null;
    updateSpellingDisplay();
}

// --- Camera Logic ---
async function startCamera() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true });
        videoElement.srcObject = localStream;

        camera = new Camera(videoElement, {
            onFrame: async () => {
                if (isSignToTextMode && isCamOn) {
                    await hands.send({ image: videoElement });
                }
            },
            width: 1280,
            height: 720
        });
        camera.start();

    } catch (err) {
        console.error("Error accessing camera:", err);
        alert("Could not access camera. Please allow permissions.");
    }
}

function stopCamera() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
}

camBtn.addEventListener('click', () => {
    isCamOn = !isCamOn;
    const placeholder = document.getElementById('camera-off-placeholder');

    if (isCamOn) {
        startCamera();
        camBtn.innerHTML = '<span class="material-icons">videocam</span>';
        camBtn.classList.remove('red-btn');
        if (placeholder) placeholder.style.display = 'none';
        videoElement.style.opacity = '1';
    } else {
        stopCamera();
        camBtn.innerHTML = '<span class="material-icons">videocam_off</span>';
        camBtn.classList.add('red-btn');

        canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
        videoElement.srcObject = null;
        videoElement.style.opacity = '0';
        if (placeholder) placeholder.style.display = 'flex';

        sttResult.innerText = "Camera is off.";
    }
});

// TTS Logic
ttsBtn.addEventListener('click', () => {
    isTTSOn = !isTTSOn;
    if (isTTSOn) {
        ttsBtn.innerHTML = '<span class="material-icons">volume_up</span>';
        ttsBtn.style.color = '#3b82f6';

        if (window.speechSynthesis) {
            window.speechSynthesis.speak(new SpeechSynthesisUtterance(""));
        }
    } else {
        ttsBtn.innerHTML = '<span class="material-icons">volume_off</span>';
        ttsBtn.style.color = 'white';
        window.speechSynthesis.cancel();
    }
});

function speakText(text) {
    if (isTTSOn && text) {
        // Cross-tab debounce using localStorage
        const now = Date.now();
        const lastGlobalSpeak = parseInt(localStorage.getItem('lastGlobalSpeakTime') || '0');

        if (now - lastGlobalSpeak < 500) {
            console.log("Speech suppressed: global debounce active (translation.js).");
            return;
        }
        localStorage.setItem('lastGlobalSpeakTime', now.toString());

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1.0;
        window.speechSynthesis.speak(utterance);
    }
}

// --- Speech Recognition Logic (Speech to Sign) ---
function initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        listeningText.innerText = "Speech Recognition not supported.";
        return;
    }

    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
        let finalTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
                finalTranscript += event.results[i][0].transcript;
            }
        }

        if (finalTranscript) {
            listeningText.innerText = `Heard: "${finalTranscript}"`;
            displaySignCards(finalTranscript);
        }
    };

    recognition.onerror = (event) => {
        console.error("Speech error", event.error);
    };
}

function displaySignCards(text) {
    const cardArea = document.querySelector('.sign-cards-area');
    // Simple visual feedback
    cardArea.innerHTML = `<h2 style="color: white;">Displaying signs for: ${text}</h2>`;
}

// --- Mode Switching ---
modeBtn.addEventListener('click', () => {
    isSignToTextMode = !isSignToTextMode;

    if (isSignToTextMode) {
        signView.style.display = 'flex';
        speechView.classList.remove('active');
        modeText.innerText = "Switch to Live Speech";

        if (isCamOn) startCamera();
        if (recognition) recognition.stop();

    } else {
        signView.style.display = 'none';
        speechView.classList.add('active');
        modeText.innerText = "Switch to Sign Translator";

        if (!recognition) initSpeechRecognition();
        setTimeout(() => {
            if (recognition) {
                try {
                    recognition.start();
                } catch (e) {
                }
            }
        }, 500);

    }
});

// Initialize
startCamera();
