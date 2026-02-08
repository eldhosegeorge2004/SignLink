
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
let model = null;
let uniqueLabels = [];
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
            localStorageModelKey = 'my-asl-model';
            localStorageLabelKey = 'asl_labels';
        }
        sttResult.innerText = `Switched to ${lang}. Loading model...`;
        loadSavedModelAndLabels();
    });
}

// Load Model and Labels
async function loadSavedModelAndLabels() {
    try {
        uniqueLabels = JSON.parse(localStorage.getItem(localStorageLabelKey)) || [];

        // TF.js load
        try {
            model = await tf.loadLayersModel(`localstorage://${localStorageModelKey}`);
            console.log(`Model (${localStorageModelKey}) loaded successfully.`);

            if (uniqueLabels.length > 0) {
                sttResult.innerText = "Model loaded! Start signing.";
            } else {
                sttResult.innerText = "Model loaded, but labels are missing!";
            }

        } catch (modelErr) {
            console.warn("Failed to load model:", modelErr);
            sttResult.innerText = "Model not found. Please train it in Video Call mode first.";
            model = null; // Ensure null if failed
        }

    } catch (e) {
        console.error("Error loading model/labels:", e);
        sttResult.innerText = "Error loading system.";
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

function getSmoothedPrediction(predLabel) {
    predictionBuffer.push(predLabel);
    if (predictionBuffer.length > 15) predictionBuffer.shift();
    const counts = {};
    predictionBuffer.forEach(l => counts[l] = (counts[l] || 0) + 1);
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
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

                console.log(`Prediction: "${smoothLabel}" (Length: ${smoothLabel.length})`); // DEBUG

                // Check if it's a single letter (A-Z) or a full word
                if (smoothLabel.length === 1 && /^[a-zA-Z]$/.test(smoothLabel)) {
                    console.log("Triggering spelling for:", smoothLabel); // DEBUG
                    handleSpelling(smoothLabel);
                } else {
                    // It's a full word/phrase
                    sttResult.innerText = `Sign: ${smoothLabel} (${Math.round(conf * 100)}%)`;
                    // Trigger Speech for word
                    speakText(smoothLabel);
                }
            }
            // else { sttResult.innerText = "..."; }
        });
    } else {
        if (!model) {
            // Already handled in load
        }
        else if (uniqueLabels.length === 0) sttResult.innerText = "No labels found.";
    }
}

function onResults(results) {
    // Resize canvas to match video
    if (canvasElement.width !== videoElement.videoWidth || canvasElement.height !== videoElement.videoHeight) {
        canvasElement.width = videoElement.videoWidth;
        canvasElement.height = videoElement.videoHeight;
    }

    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

    // Draw landmarks
    if (results.multiHandLandmarks) {
        for (const landmarks of results.multiHandLandmarks) {
            drawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS, { color: '#00FF00', lineWidth: 5 });
            drawLandmarks(canvasCtx, landmarks, { color: '#FF0000', lineWidth: 2 });

            // Run Prediction Logic using the ported method
            const flatLandmarks = preprocessLandmarks(landmarks);
            runPrediction(flatLandmarks);
        }
    } else {
        // sttResult.innerText = "Waiting for signs..."; 
        // Don't overwrite error messages if model is missing
        if (model) {
            // sttResult.innerText = "Waiting for signs...";
        }

        // Reset state on hand loss
        if (lastAddedLetter !== null) {
            lastAddedLetter = null;
        }
    }
    canvasCtx.restore();
}

// --- Camera Logic ---
async function startCamera() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true });
        videoElement.srcObject = localStream;

        // Initialize MediaPipe Camera Utils
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

        // UI Updates for Off State
        canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
        videoElement.srcObject = null; // Explicitly clear source
        videoElement.style.opacity = '0'; // Hide video element
        if (placeholder) placeholder.style.display = 'flex';

        if (model) sttResult.innerText = "Camera is off.";
    }
});

// TTS Logic
ttsBtn.addEventListener('click', () => {
    isTTSOn = !isTTSOn;
    if (isTTSOn) {
        ttsBtn.innerHTML = '<span class="material-icons">volume_up</span>';
        ttsBtn.style.color = '#3b82f6'; // Active color

        // Priming for mobile browsers
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

// --- Spelling Logic ---
function handleSpelling(letter) {
    const now = Date.now();

    // Update timestamp to keep the session alive
    lastLetterTime = now;

    // Simple Debounce: Don't add the same letter repeatedly within 1.5 seconds
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

    console.log("Update Display. Word:", accumulatedWord); // DEBUG

    if (accumulatedWord.length > 0) {
        overlay.style.display = 'block';
        textEl.innerText = accumulatedWord;
    } else {
        overlay.style.display = 'none';
        textEl.innerText = "";
    }
}

// Check for 3-second silence to finish the word
setInterval(() => {
    if (accumulatedWord.length > 0) {
        const now = Date.now();
        if (now - lastLetterTime > 3000) {
            // 3 seconds passed since last letter
            finishSpelling();
        }
    }
}, 500);

function finishSpelling() {
    console.log("Spelling finished:", accumulatedWord);

    // Convert to Title Case
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
            // Trigger Sign Card Display (Placeholder)
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
    // In a real app, we would map words to sign images.
}

// --- Mode Switching ---
modeBtn.addEventListener('click', () => {
    isSignToTextMode = !isSignToTextMode;

    if (isSignToTextMode) {
        // Switch to Sign-to-Text
        signView.style.display = 'flex'; // Use flex to center
        speechView.classList.remove('active');
        modeText.innerText = "Switch to Live Speech"; // The button logic is "Switch TO the other mode"

        // Restart camera if it should be on
        if (isCamOn) startCamera();

        // Stop speech recognition
        if (recognition) recognition.stop();

    } else {
        // Switch to Speech-to-Sign
        signView.style.display = 'none';
        speechView.classList.add('active');
        modeText.innerText = "Switch to Sign Translator";

        // Stop camera to save resources
        // if(isCamOn) stopCamera(); 

        // Start speech recognition
        if (!recognition) initSpeechRecognition();

        // Add small delay to ensure recognition is ready
        setTimeout(() => {
            if (recognition) {
                try {
                    recognition.start();
                } catch (e) {
                    // Already started
                }
            }
        }, 500);

    }
});


// Add red-btn style if not present in CSS (handled in style.css or inline)
// reuse existing red-btn class if available, else standard toggle
// style.css has .red-btn

// Initialize
startCamera();
