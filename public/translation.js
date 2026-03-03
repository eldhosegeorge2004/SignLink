
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
let isTTSOn = true;
let lastSpokenLabel = "";
let lastSpokenTime = 0;
let localStream = null;
let camera = null;
let cameraLoopId = null;
let recognition = null; // For Speech to Text

// --- Spelling Mode State ---
let accumulatedWord = "";
let lastLetterTime = 0;
let lastAddedLetter = null;
let spellingInterval = null;
const SPELLING_IDLE_TIMEOUT_MS = 5000;

// --- Model & State ---
// Hybrid Model Approaches:
// 1. Server Model (Pre-trained ISL Dataset)
// 2. Local Model (User Generated via AI Training)
let serverModel = null;
let serverLabels = [];
let localModel = null;
let localLabels = [];

// Dynamic sign support
let localModelDynamic = null;
let localLabelsDynamic = [];
let dynamicFrameBuffer = [];
const MAX_DYNAMIC_FRAMES = 30;
const DYNAMIC_ANALYZE_MS = 1500;
let dynamicBufferStartTime = 0;
const BIG_MOTION_CHANGE_THRESHOLD = 0.06;
let lastDisplayedPrediction = null;
let lastDisplayedFrame = null;
const STATIC_STILL_DURATION_MS = 1000;
const MOTION_THRESHOLD = 0.02;
let previousMotionFrame = null;
let staticStillStartTime = 0;
const NO_HANDS_TIMEOUT_MS = 2000;
let lastHandDetectedTime = Date.now();
let noHandsTimeoutId = null;

const predictionBuffer = [];
let localStorageModelKey = 'my-isl-model'; // Default
let localStorageLabelKey = 'isl_labels';

// Language Selector Logic
const langSelect = document.getElementById('lang-select');
if (langSelect) {
    // Sync state on page load in case browser restores Dropdown state
    if (langSelect.value === 'ASL') {
        localStorageModelKey = 'my-asl-model';
        localStorageLabelKey = 'asl_labels';
    } else {
        localStorageModelKey = 'my-isl-model';
        localStorageLabelKey = 'isl_labels';
    }

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

// TTS starts enabled by default for live translation
if (ttsBtn) {
    ttsBtn.innerHTML = '<span class="material-icons">volume_up</span>';
    ttsBtn.classList.remove('red-btn');
}

// Load Models and Labels (Hybrid)
async function loadSavedModelAndLabels() {
    try {
        // Reset State
        serverModel = null;
        serverLabels = [];
        localModel = null;
        localLabels = [];
        localModelDynamic = null;
        localLabelsDynamic = [];
        predictionBuffer.length = 0;
        dynamicFrameBuffer = [];
        dynamicBufferStartTime = 0;
        lastDisplayedPrediction = null;
        lastDisplayedFrame = null;

        const promises = [];

        // 1. Load Server Model
        const serverLoad = async () => {
            console.log("Attempting to load Server Model...");
            try {
                let labelsPath = 'labels.json';
                let modelPath = 'model/model.json';

                if (localStorageModelKey === 'my-asl-model') {
                    labelsPath = 'dataset.json'; // The dataset JSON we generated contains the classes (we saved a huge dump but labels.json was also saved in /training) - actually let's use the explicit labels.json we built for it. Wait, the converter output ASL into model/asl, but we didn't move labels.json.
                    // Assuming labels.json is pulled from the root, let's configure ASL to load the specific labels.
                    labelsPath = 'labels.json?v=8'; // Update this depending on where the user put the training labels. Let's assume we moved it.
                    modelPath = 'model/asl/model.json?v=8';

                    // Fetch the ASL specific classes we know we just trained
                    serverLabels = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z"];

                    try {
                        serverModel = await tf.loadLayersModel(modelPath);
                        console.log(`Server Model loaded (${serverLabels.length} ASL labels)`);
                    } catch (tfErr) {
                        console.error("TFJS ASL Model Load Error:", tfErr);
                        serverModel = null;
                    }
                    return Promise.resolve();
                }

                const response = await fetch(labelsPath);
                if (response.ok) {
                    serverLabels = await response.json();
                    try {
                        serverModel = await tf.loadLayersModel(modelPath);
                        console.log(`Server Model loaded (${serverLabels.length} labels)`);
                    } catch (tfErr) {
                        console.error("TFJS ISL Model Load Error:", tfErr);
                        serverModel = null;
                    }
                } else {
                    console.warn("labels.json not found.");
                }
            } catch (e) {
                console.error("Server model load failed fatally:", e);
                serverModel = null;
            }
            return Promise.resolve();
        };
        promises.push(serverLoad());

        // 2. Load Local Static Model
        const localLoad = async () => {
            console.log("Attempting to load Local Static Model...");
            try {
                const localLabelData = localStorage.getItem(`${localStorageLabelKey}-static`);
                if (localLabelData) {
                    localLabels = JSON.parse(localLabelData);
                    try {
                        localModel = await tf.loadLayersModel(`localstorage://${localStorageModelKey}-static`);
                        console.log(`Local Static Model loaded (${localLabels.length} labels)`);
                    } catch (e) {
                        console.warn("Local static model weights not found in localStorage.");
                        localModel = null;
                    }
                }
            } catch (e) {
                console.warn("Local static model load failed:", e);
                localModel = null;
            }
            return Promise.resolve(); // NEVER reject because we want server model to survive
        };
        promises.push(localLoad());

        // 3. Load Local Dynamic Model
        const dynamicLoad = async () => {
            console.log("Attempting to load Local Dynamic Model...");
            try {
                const dynamicLabelData = localStorage.getItem(`${localStorageLabelKey}-dynamic`);
                if (dynamicLabelData) {
                    localLabelsDynamic = JSON.parse(dynamicLabelData);
                    try {
                        localModelDynamic = await tf.loadLayersModel(`localstorage://${localStorageModelKey}-dynamic`);
                        console.log(`Local Dynamic Model loaded (${localLabelsDynamic.length} labels)`);
                    } catch (e) {
                        console.warn("Local dynamic model weights not found in localStorage.");
                        localModelDynamic = null;
                    }
                }
            } catch (e) {
                console.warn("Local dynamic model load failed:", e);
            }
        };
        promises.push(dynamicLoad());

        // Wait for all promises (use allSettled so one failure doesn't kill others)
        await Promise.allSettled(promises);

        // 4. UI Feedback - only show error if no models found
        const loadedModels = [];
        if (serverModel) loadedModels.push("Server");
        if (localModel) loadedModels.push("Local Static");
        if (localModelDynamic) loadedModels.push("Local Dynamic");
        
        // Don't show models loaded message - keep display clear
        if (loadedModels.length === 0) {
            sttResult.innerText = "No models found. Please train in AI Training mode.";
        }

        // "Go to Training" button if absolutely nothing
        if (!serverModel && !localModel && !localModelDynamic) {
            if (!document.getElementById('goto-training-btn')) {
                const btn = document.createElement('button');
                btn.id = 'goto-training-btn';
                btn.innerText = "Go to AI Training";
                btn.className = "control-btn";
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

function updateMotionState(currentFrame) {
    const now = Date.now();

    if (!previousMotionFrame) {
        previousMotionFrame = [...currentFrame];
        staticStillStartTime = now;
        return { isStillFrame: false, stillForMs: 0 };
    }

    let totalDelta = 0;
    for (let i = 0; i < currentFrame.length; i++) {
        totalDelta += Math.abs(currentFrame[i] - previousMotionFrame[i]);
    }

    const motionScore = totalDelta / currentFrame.length;
    const isStillFrame = motionScore < MOTION_THRESHOLD;

    if (isStillFrame) {
        if (staticStillStartTime === 0) staticStillStartTime = now;
    } else {
        staticStillStartTime = 0;
    }

    previousMotionFrame = [...currentFrame];
    const stillForMs = staticStillStartTime ? (now - staticStillStartTime) : 0;
    return { isStillFrame, stillForMs };
}

function resetMotionState() {
    previousMotionFrame = null;
    staticStillStartTime = 0;
}

function getFrameDifference(frameA, frameB) {
    if (!frameA || !frameB || frameA.length !== frameB.length) return Infinity;

    let totalDelta = 0;
    for (let i = 0; i < frameA.length; i++) {
        totalDelta += Math.abs(frameA[i] - frameB[i]);
    }
    return totalDelta / frameA.length;
}

function updateDisplayedPrediction(label, conf, isDynamic, currentFrame) {
    lastDisplayedPrediction = { label, conf, isDynamic };
    lastDisplayedFrame = [...currentFrame];
}

function shouldKeepLastPrediction(currentFrame) {
    if (!lastDisplayedPrediction || !lastDisplayedFrame) return false;
    const diff = getFrameDifference(currentFrame, lastDisplayedFrame);
    return diff < BIG_MOTION_CHANGE_THRESHOLD;
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
    if (!serverModel && !localModel && !localModelDynamic) return;

    tf.tidy(() => {
        // Prepare Inputs for static models
        const flatNormal = preprocessLandmarks(landmarks);
        const motionState = updateMotionState(flatNormal);
        const staticAllowed = motionState.stillForMs >= STATIC_STILL_DURATION_MS;

        if (!staticAllowed) {
            predictionBuffer.length = 0;
            heldLetter = null;
            holdStartTime = 0;
        }

        const tensorNormal = tf.tensor2d([flatNormal]);

        const flipped = flipLandmarks(landmarks);
        const flatFlipped = preprocessLandmarks(flipped);
        const tensorFlipped = tf.tensor2d([flatFlipped]);

        // Collect candidates from all available models
        let candidates = [];
        
        // Debug: Log which models are active (only once per 100 frames)
        if (!window.debugFrameCount) window.debugFrameCount = 0;
        window.debugFrameCount++;
        if (window.debugFrameCount % 100 === 0) {
            console.log('Active models:', {
                server: !!serverModel,
                localStatic: !!localModel,
                localDynamic: !!localModelDynamic,
                dynamicLabels: localLabelsDynamic,
                bufferSize: dynamicFrameBuffer.length
            });
        }

        // 1. Query Server Model (Static only when hand is still)
        if (staticAllowed && serverModel && serverLabels.length) {
            const pNorm = predictSingleModel(serverModel, serverLabels, tensorNormal);
            candidates.push({ ...pNorm, source: 'Server' });

            const pFlip = predictSingleModel(serverModel, serverLabels, tensorFlipped);
            candidates.push({ ...pFlip, source: 'Server(M)' });
        }

        // 2. Query Local Static Model (only when hand is still)
        if (staticAllowed && localModel && localLabels.length) {
            const pNorm = predictSingleModel(localModel, localLabels, tensorNormal);
            candidates.push({ ...pNorm, source: 'Local' });

            const pFlip = predictSingleModel(localModel, localLabels, tensorFlipped);
            candidates.push({ ...pFlip, source: 'Local(M)' });
        }

        // 3. Query Dynamic Model with frame buffer
        // Skip dynamic detection if user is in the middle of spelling
        if (localModelDynamic && localLabelsDynamic.length && accumulatedWord.length === 0) {
            if (dynamicBufferStartTime === 0) {
                dynamicBufferStartTime = Date.now();
            }

            // Add current frame to buffer
            dynamicFrameBuffer.push(flatNormal);
            
            // Keep buffer at fixed size
            if (dynamicFrameBuffer.length > MAX_DYNAMIC_FRAMES) {
                dynamicFrameBuffer.shift();
            }
            
            const dynamicReady = (Date.now() - dynamicBufferStartTime) >= DYNAMIC_ANALYZE_MS;

            // Wait at least 1 second to analyze motion before predicting dynamic signs
            if (dynamicFrameBuffer.length >= 1 && dynamicReady) {
                // Pad to MAX_DYNAMIC_FRAMES
                const paddedFrames = [...dynamicFrameBuffer];
                const lastFrame = paddedFrames[paddedFrames.length - 1];
                while (paddedFrames.length < MAX_DYNAMIC_FRAMES) {
                    paddedFrames.push(lastFrame);
                }
                
                const tensorDynamic = tf.tensor3d([paddedFrames]);
                const predDynamic = localModelDynamic.predict(tensorDynamic);
                const conf = predDynamic.max().dataSync()[0];
                const idx = predDynamic.argMax(-1).dataSync()[0];
                
                // Give dynamic predictions higher priority by boosting confidence
                candidates.push({ 
                    label: localLabelsDynamic[idx], 
                    conf: Math.min(conf * 1.2, 1.0), // Boost confidence by 20%
                    source: 'Dynamic',
                    isDynamic: true
                });
                
                tensorDynamic.dispose();
                predDynamic.dispose();
            }
        }

        // 4. Find Best Candidate
        // Sort by confidence descending
        candidates.sort((a, b) => b.conf - a.conf);
        const best = candidates[0];

        // 5. Threshold & Display
        if (best) {
            const outputLabel = best.isDynamic ? best.label : getSmoothedPrediction(best.label);
            updateDisplayedPrediction(outputLabel, best.conf, !!best.isDynamic, flatNormal);

            // If dynamic sign detected, show immediately with special indicator
            // Skip if user is actively spelling (accumulatedWord has content)
            if (best.isDynamic && best.conf > 0.60 && accumulatedWord.length === 0) { // Lower threshold for dynamic
                sttResult.innerText = `Sign: ${outputLabel} 🔄 (${Math.round(best.conf * 100)}%)`;
                
                // Debounce speech: only speak if different sign or 4+ seconds have passed
                const now = Date.now();
                const timeSinceLast = now - lastSpokenTime;
                const isDifferentSign = outputLabel !== lastSpokenLabel;

                if (isDifferentSign || timeSinceLast > 4000) {
                    speakText(outputLabel);
                    lastSpokenLabel = outputLabel;
                    lastSpokenTime = now;
                }
                
                // Clear buffer after confident detection
                setTimeout(() => {
                    dynamicFrameBuffer = [];
                    dynamicBufferStartTime = 0;
                }, 500); // Small delay before clearing
            } else if (outputLabel.length === 1 && /^[a-zA-Z]$/.test(outputLabel)) {
                // Single letters require stable hold
                processPredictedLetter(outputLabel);
                sttResult.innerText = `Sign: ${outputLabel} (${Math.round(best.conf * 100)}%)`;
            } else if (accumulatedWord.length === 0) {
                // Only show non-dynamic/non-letter signs if not spelling
                sttResult.innerText = `Sign: ${outputLabel} (${Math.round(best.conf * 100)}%)`;
                speakText(outputLabel);
            } else if (accumulatedWord.length > 0) {
                // During spelling, suppress sttResult display entirely (only show spelling overlay)
                sttResult.innerText = '';
            }
        } else {
            // No confident prediction
            if (accumulatedWord.length > 0) {
                // During spelling, clear sttResult to prevent competing displays
                sttResult.innerText = '';
            } else if (lastDisplayedPrediction) {
                // Only show last prediction if not spelling
                const last = lastDisplayedPrediction;
                const displayText = last.isDynamic ? `${last.label} 🔄` : last.label;
                sttResult.innerText = `Sign: ${displayText} (${Math.round(last.conf * 100)}%)`;
            }
            // Don't show "Listening..." - just keep previous prediction or blank
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

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        // Hands detected - clear the timeout
        lastHandDetectedTime = Date.now();
        if (accumulatedWord.length > 0) {
            // Keep spelling window alive while user still has hands in frame
            lastLetterTime = Date.now();
        }
        if (noHandsTimeoutId) {
            clearTimeout(noHandsTimeoutId);
            noHandsTimeoutId = null;
        }
        
        for (const landmarks of results.multiHandLandmarks) {
            drawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS, { color: '#00FF00', lineWidth: 5 });
            drawLandmarks(canvasCtx, landmarks, { color: '#FF0000', lineWidth: 2 });
            runPrediction(landmarks);
        }
    } else {
        // If hand disappears while spelling, finalize immediately
        if (accumulatedWord.length > 0) {
            finishSpelling(true);
        }

        // No hands detected - set timeout for "Waiting for hands"
        if (!noHandsTimeoutId) {
            noHandsTimeoutId = setTimeout(() => {
                sttResult.innerText = "Waiting for hands...";
                noHandsTimeoutId = null;
            }, NO_HANDS_TIMEOUT_MS);
        }
        
        // Reset state on hand loss
        if (lastAddedLetter !== null) {
            lastAddedLetter = null;
        }
        // also clear hold tracking so letters don't accumulate after a break
        heldLetter = null;
        holdStartTime = 0;
        predictionBuffer.length = 0;
        dynamicFrameBuffer = [];
        dynamicBufferStartTime = 0;
        resetMotionState();
    }
    canvasCtx.restore();
}

// --- Spelling Logic ---
// We introduce a hold-based filter: a letter sign must be held for at least
// `minimumHoldDuration` before it is actually added. This prevents quick
// hand movements from being misinterpreted as multiple letters.
const minimumHoldDuration = 1000; // milliseconds (~1 second)
let holdStartTime = 0;
let heldLetter = null;

function handleSpelling(letter) {
    // This helper is now only called after the hold check succeeds.
    const now = Date.now();
    lastLetterTime = now;

    // Strict State-Based Filtering: avoid duplicates
    if (letter === lastAddedLetter) {
        return;
    }

    lastAddedLetter = letter;
    accumulatedWord += letter;
    
    // When starting to spell, reset dynamic frame buffer to avoid interference
    dynamicFrameBuffer = [];
    dynamicBufferStartTime = 0;

    // Speak the letter immediately if TTS is enabled
    if (isTTSOn) speakText(letter.toLowerCase());

    updateSpellingDisplay();
}

// Called from the prediction loop instead of handleSpelling directly.
// Ensures the same letter is being observed continuously for the required
// duration before committing it. If the visible prediction changes, the
// timer resets.
function processPredictedLetter(letter) {
    const now = Date.now();

    if (letter === heldLetter) {
        // continue holding the same letter
        if (holdStartTime === 0) {
            holdStartTime = now;
        }

        if (now - holdStartTime >= minimumHoldDuration) {
            // enough time has passed; actually add the letter if it's new
            handleSpelling(letter);
            // reset so a fresh hold is required for the next addition
            heldLetter = null;
            holdStartTime = 0;
        }
    } else {
        // sign changed: start a new hold timer
        heldLetter = letter;
        holdStartTime = now;
    }
}

function updateSpellingDisplay() {
    const overlay = document.getElementById('spelling-overlay');
    const textEl = document.getElementById('spelling-text');

    if (accumulatedWord.length > 0) {
        if (overlay) overlay.style.display = 'block';
        if (textEl) textEl.innerText = accumulatedWord;
    } else {
        if (overlay) overlay.style.display = 'none';
        if (textEl) textEl.innerText = "";
    }
}

// Check for spelling inactivity to finish the word
setInterval(() => {
    if (accumulatedWord.length > 0) {
        const now = Date.now();
        if (now - lastLetterTime > SPELLING_IDLE_TIMEOUT_MS) {
            finishSpelling();
        }
    }
}, 500);

function finishSpelling(forceSpeak = false) {
    const wordToSpeak = accumulatedWord.charAt(0).toUpperCase() + accumulatedWord.slice(1).toLowerCase();

    // Speak the whole word
    speakText(wordToSpeak, forceSpeak);

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
        // Stop any previous stream/loop before starting a new one
        stopCamera();

        localStream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: 'user',
                width: { ideal: 1280 },
                height: { ideal: 720 },
                aspectRatio: { ideal: 16 / 9 },
                resizeMode: 'none'
            }
        });
        videoElement.srcObject = localStream;

        await videoElement.play();

        // Match container ratio to actual camera stream for full, uncropped view
        const videoContainer = document.querySelector('.video-container');
        const track = localStream.getVideoTracks()[0];
        const settings = track ? track.getSettings() : null;
        const actualWidth = settings?.width || videoElement.videoWidth;
        const actualHeight = settings?.height || videoElement.videoHeight;
        if (videoContainer && actualWidth && actualHeight) {
            videoContainer.style.aspectRatio = `${actualWidth} / ${actualHeight}`;
        }

        const processFrame = async () => {
            if (!isCamOn || !localStream) {
                return;
            }

            if (isSignToTextMode) {
                await hands.send({ image: videoElement });
            }

            cameraLoopId = requestAnimationFrame(processFrame);
        };

        cameraLoopId = requestAnimationFrame(processFrame);

    } catch (err) {
        console.error("Error accessing camera:", err);
        alert("Could not access camera. Please allow permissions.");
    }
}

function stopCamera() {
    if (cameraLoopId) {
        cancelAnimationFrame(cameraLoopId);
        cameraLoopId = null;
    }

    if (camera) {
        try {
            camera.stop();
        } catch (e) {
            // ignore
        }
        camera = null;
    }

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
        ttsBtn.classList.remove('red-btn');

        if (window.speechSynthesis) {
            window.speechSynthesis.speak(new SpeechSynthesisUtterance(""));
        }
    } else {
        ttsBtn.innerHTML = '<span class="material-icons">volume_off</span>';
        ttsBtn.classList.add('red-btn');
        window.speechSynthesis.cancel();
    }
});

function speakText(text, forceSpeak = false) {
    if ((isTTSOn || forceSpeak) && text) {
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
