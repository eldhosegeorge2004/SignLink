
const videoElement = document.getElementById('input-video');
const canvasElement = document.getElementById('output-canvas');
const canvasCtx = canvasElement.getContext('2d');
const signView = document.getElementById('sign-view');
const speechView = document.getElementById('speech-view');
const speechPanel = document.getElementById('speech-panel');
const speechCaptionLog = document.getElementById('speech-caption-log');
const camBtn = document.getElementById('cam-btn');
const ttsBtn = document.getElementById('tts-btn');
const sttResult = document.getElementById('stt-result');
const listeningText = document.getElementById('listening-text');
let signVoiceToggle = document.getElementById('sign-voice-toggle');
const voiceSubtitles = document.getElementById('voice-subtitles');

let isSignMode = true; // true = sign detection, false = voice recognition
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
let dynamicLabelHandRequirements = {};
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
        dynamicLabelHandRequirements = {};
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
                const isASL = localStorageModelKey === 'my-asl-model';
                const modelPath = isASL ? 'model/asl/model.json' : 'model/model.json';
                const labelsPath = isASL ? 'model/asl/labels.json' : 'labels.json';

                const response = await fetch(labelsPath);
                if (response.ok) {
                    serverLabels = await response.json();
                    try {
                        serverModel = await tf.loadLayersModel(modelPath);
                        console.log(`Server Model loaded (${serverLabels.length} labels from ${labelsPath})`);
                    } catch (tfErr) {
                        console.error("TFJS Server Model Load Error:", tfErr);
                        serverModel = null;
                    }
                } else {
                    console.warn(`${labelsPath} not found.`);
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
                    console.log(`Diagnostic -> Loaded Local Static Labels for ${localStorageLabelKey}:`, localLabels);
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
                    const dynamicReqData = localStorage.getItem(`${localStorageLabelKey}-dynamic-hand-req`);
                    dynamicLabelHandRequirements = dynamicReqData ? JSON.parse(dynamicReqData) : {};
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

function normalizeHandRequirement(rawValue) {
    if (rawValue === 1 || rawValue === '1') return 1;
    if (rawValue === 2 || rawValue === '2') return 2;
    return 'any';
}

function labelMatchesDetectedHands(label, detectedHandCount) {
    const requirement = normalizeHandRequirement(dynamicLabelHandRequirements[label]);
    return requirement === 'any' || requirement === detectedHandCount;
}

function runPrediction(landmarks, detectedHandCount = 1) {
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
            // Use raw confidence instead of boosting to prevent small models from becoming overconfident on untrained signs
            candidates.push({ ...pNorm, conf: pNorm.conf, source: 'Local' });

            // Note: We intentionally DO NOT evaluate the Local model using the flipped tensor. 
            // The AI Training Studio does not artificially mirror training coordinates, so feeding 
            // a mirrored matrix into a small local model forces it to output garbage data with random spikes.
        }

        // 3. Query Dynamic Model with frame buffer
        // Skip dynamic detection if user is in the middle of spelling
        // TEMP OFF: Paused dynamic model testing entirely while user verifies alphabets
        if (false && localModelDynamic && localLabelsDynamic.length && accumulatedWord.length === 0) {
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
                const predictedDynamicLabel = localLabelsDynamic[idx];

                // Keep dynamic predictions unboosted to reduce false positives,
                // but still enforce hand-count requirements when available.
                if (labelMatchesDetectedHands(predictedDynamicLabel, detectedHandCount)) {
                    candidates.push({
                        label: predictedDynamicLabel,
                        conf: conf,
                        source: 'Dynamic',
                        isDynamic: true
                    });
                }
                tensorDynamic.dispose();
                predDynamic.dispose();
            }
        }

        // 4. Find Best Candidate
        // Group candidates by source
        const serverCandidates = candidates.filter(c => c.source.startsWith('Server'));
        const localCandidates = candidates.filter(c => c.source.startsWith('Local') || c.source === 'Dynamic');

        // Sort both groups by confidence descending
        serverCandidates.sort((a, b) => b.conf - a.conf);
        localCandidates.sort((a, b) => b.conf - a.conf);

        let best = null;

        const bestLocal = localCandidates.length > 0 ? localCandidates[0] : null;
        const bestServer = serverCandidates.length > 0 ? serverCandidates[0] : null;

        // Custom precedence rule (Relative Tiered Override):
        if (bestServer && bestLocal) {
            // SPECIAL EXCEPTION: 8 and 9 are frequently misclassified by Server as V/2 or C.
            // If the local model thinks it is an 8 or 9 with even moderate confidence (>0.75), 
            // completely ignore the server model to protect custom signs.
            const isCustomNumber = bestLocal.label === '8' || bestLocal.label === '9';
            // EXPLICIT ALPHABET PROTECTION: The Local model (which only knows numbers) 
            // will try to hijack alphabets if the Server model dips below 80%.
            const isServerAlpha = /^[A-Z]$/.test(bestServer.label);

            if (isCustomNumber && bestLocal.conf >= 0.75) {
                best = bestLocal;
            } else if (isServerAlpha && bestServer.conf >= 0.60) {
                // If the Server model sees A or B with even minimal confidence (60%),
                // DO NOT let the Custom numbering model guess.
                best = bestServer;
            } else if (bestServer.conf >= 0.95) {
                // Tier 1: Server is extremely confident.
                // It only loses if Local is ALSO extremely confident and mathematically higher.
                if (bestLocal.conf >= 0.95 && bestLocal.conf > bestServer.conf) {
                    best = bestLocal;
                } else {
                    best = bestServer;
                }
            } else if (bestServer.conf < 0.80 && bestLocal.conf >= 0.90) {
                // Tier 2: Server is very unsure (< 0.80), and Local is extremely confident (> 0.90).
                best = bestLocal;
            } else {
                // Tier 3: Neither has a massive edge or weakness, just compare raw confidence.
                best = bestServer.conf > bestLocal.conf ? bestServer : bestLocal;
            }
        } else {
            // Fallbacks if one model type is completely missing
            best = bestServer || bestLocal;
        }

        // 5. Threshold & Display
        if (best) {
            console.log(`Live Prediction -> Best Candidate: ${best.label} (${best.conf * 100}%) from ${best.source}`); // Diagnostic for 8/9
            let outputLabel = best.isDynamic ? best.label : getSmoothedPrediction(best.label);

            // Hardcoded overrides for ASL explicitly requested by user to fix misclassifications
            if (localStorageModelKey === 'my-asl-model' && best.source && best.source.startsWith('Server')) {
                if (outputLabel === 'D') outputLabel = '1';
                if (outputLabel === 'R') outputLabel = '3';
                if (outputLabel === 'W') outputLabel = '6';
                if (outputLabel === 'F') outputLabel = '9';
            }

            updateDisplayedPrediction(outputLabel, best.conf, !!best.isDynamic, flatNormal);

            // If dynamic sign detected, show immediately with special indicator
            // Skip if user is actively spelling (accumulatedWord has content)
            if (best.isDynamic && best.conf > 0.85 && accumulatedWord.length === 0) { // Require high confidence for dynamic
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
            } else if (outputLabel.length === 1 && /^[a-zA-Z0-9]$/.test(outputLabel)) {
                // Single letters or numbers require stable hold
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

        const detectedHandCount = Math.min(2, results.multiHandLandmarks.length);

        for (const landmarks of results.multiHandLandmarks) {
            drawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS, { color: '#00FF00', lineWidth: 5 });
            drawLandmarks(canvasCtx, landmarks, { color: '#FF0000', lineWidth: 2 });
        }

        // Predict once from the primary hand to avoid duplicate/competing outputs.
        runPrediction(results.multiHandLandmarks[0], detectedHandCount);
    } else {
        // No hands detected - set timeout for "Waiting for hands"
        if (!noHandsTimeoutId) {
            noHandsTimeoutId = setTimeout(() => {
                sttResult.innerText = "Waiting for hands...";
                noHandsTimeoutId = null;

                // If hand disappears for a while while spelling, finalize the word
                if (accumulatedWord.length > 0) {
                    finishSpelling(true);
                }
            }, NO_HANDS_TIMEOUT_MS);
        }

        // Reset state on hand loss to allow double letters
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

        const videoConstraintCandidates = [
            {
                facingMode: 'user',
                width: { ideal: 1280 },
                height: { ideal: 720 },
                aspectRatio: { ideal: 16 / 9 },
                resizeMode: 'none'
            },
            {
                facingMode: 'user',
                width: { ideal: 1280 },
                height: { ideal: 720 },
                aspectRatio: { ideal: 16 / 9 }
            },
            {
                facingMode: 'user',
                width: { ideal: 1280 },
                height: { ideal: 720 }
            },
            {
                facingMode: 'user'
            },
            true
        ];

        let lastCameraError = null;
        for (const videoConstraints of videoConstraintCandidates) {
            try {
                localStream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints });
                break;
            } catch (constraintErr) {
                lastCameraError = constraintErr;
                console.warn('Camera constraints failed, trying fallback...', constraintErr?.name || constraintErr);
            }
        }

        if (!localStream) {
            throw lastCameraError || new Error('Unable to initialize camera stream.');
        }

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

            if (isSignMode) {
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

function appendSpeechCaption(text) {
    if (!speechCaptionLog || !text) return;

    const cleaned = text.trim();
    if (!cleaned) return;

    const line = document.createElement('div');
    line.className = 'speech-caption-line';
    line.textContent = `You: ${cleaned}`;
    speechCaptionLog.appendChild(line);

    while (speechCaptionLog.children.length > 70) {
        speechCaptionLog.removeChild(speechCaptionLog.firstChild);
    }

    speechCaptionLog.scrollTop = speechCaptionLog.scrollHeight;
}

// --- Speech Recognition Logic (Speech to Sign) ---
function initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        if (listeningText) listeningText.innerText = "Speech Recognition not supported.";
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
            const transcript = event.results[i][0].transcript;

            if (event.results[i].isFinal) {
                finalTranscript += transcript + ' ';
            } else {
                interimTranscript += transcript;
            }
        }

        if (isSignMode) {
            return;
        }

        if (finalTranscript) {
            const finalized = finalTranscript.trim();
            if (listeningText) listeningText.innerText = `Heard: "${finalized}"`;
            appendSpeechCaption(finalized);
            displaySignCards(finalized);
        }

        const displayText = interimTranscript || finalTranscript;
        if (displayText) {
            voiceSubtitles.innerText = displayText.trim();
        }
    };

    recognition.onerror = (event) => {
        console.error("Speech error", event.error);
    };
}

const translationImageExistsCache = new Map();
let translationPhraseMap = { common: {}, asl: {}, isl: {} };
const TRANSLATION_DIGIT_WORD_MAP = {
    '0': 'zero',
    '1': 'one',
    '2': 'two',
    '3': 'three',
    '4': 'four',
    '5': 'five',
    '6': 'six',
    '7': 'seven',
    '8': 'eight',
    '9': 'nine'
};
const translationCardQueue = [];
const TRANSLATION_MAX_CARD_TOKENS = 260;

async function loadTranslationPhraseMap() {
    try {
        const response = await fetch('/signs-images/phrase-map.json', { cache: 'no-cache' });
        if (!response.ok) return;
        const json = await response.json();
        translationPhraseMap = {
            common: json.common || {},
            asl: json.asl || {},
            isl: json.isl || {}
        };
    } catch (err) {
        console.warn('Failed to load phrase-map.json for translation view.', err);
    }
}
loadTranslationPhraseMap();

function getTranslationLangFolder() {
    return localStorageModelKey === 'my-asl-model' ? 'asl' : 'isl';
}

function checkTranslationImageExists(url) {
    if (translationImageExistsCache.has(url)) {
        return Promise.resolve(translationImageExistsCache.get(url));
    }

    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            translationImageExistsCache.set(url, true);
            resolve(true);
        };
        img.onerror = () => {
            translationImageExistsCache.set(url, false);
            resolve(false);
        };
        img.src = url;
    });
}

async function resolveTranslationWordTokens(word, langFolder) {
    const normalizedWord = word.toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (!normalizedWord) return [];

    const wordCandidates = [
        `/signs-images/${langFolder}/words/${normalizedWord}.jpg`,
        `/signs-images/${langFolder}/words/${normalizedWord}.png`,
        `/signs-images/${langFolder}/${normalizedWord}.jpg`,
        `/signs-images/${langFolder}/${normalizedWord}.png`
    ];

    for (const src of wordCandidates) {
        if (await checkTranslationImageExists(src)) {
            return [{ type: 'card', src, label: normalizedWord }];
        }
    }

    const charTokens = [];
    const charsOnly = normalizedWord.replace(/-/g, '');
    for (const char of charsOnly.toUpperCase()) {
        if (!/[A-Z0-9]/.test(char)) continue;

        const candidates = [];
        if (/[A-Z]/.test(char)) {
            candidates.push(`/signs-images/${langFolder}/characters/${char}.jpg`);
            candidates.push(`/signs-images/${langFolder}/characters/${char}.png`);
        } else {
            candidates.push(`/signs-images/${langFolder}/characters/${char}.jpg`);
            candidates.push(`/signs-images/${langFolder}/characters/${char}.png`);
            const digitWord = TRANSLATION_DIGIT_WORD_MAP[char];
            if (digitWord) {
                candidates.push(`/signs-images/${langFolder}/characters/${digitWord}.jpg`);
                candidates.push(`/signs-images/${langFolder}/characters/${digitWord}.png`);
            }
        }

        let chosen = null;
        for (const src of candidates) {
            if (await checkTranslationImageExists(src)) {
                chosen = src;
                break;
            }
        }

        if (chosen) charTokens.push({ type: 'card', src: chosen, label: char });
    }

    return charTokens.length ? charTokens : [{ type: 'label', label: normalizedWord }];
}

function resolveTranslationMappedPhrase(phrase, langFolder) {
    const perLangMap = translationPhraseMap[langFolder] || {};
    if (perLangMap[phrase]) return perLangMap[phrase];
    return translationPhraseMap.common[phrase] || null;
}

function buildTranslationCardUnits(words, langFolder) {
    const units = [];
    let index = 0;

    while (index < words.length) {
        let matched = null;
        const maxLen = Math.min(4, words.length - index);

        for (let phraseLen = maxLen; phraseLen >= 2; phraseLen--) {
            const phraseWords = words.slice(index, index + phraseLen);
            const phraseText = phraseWords.join(' ');
            const mappedKey = resolveTranslationMappedPhrase(phraseText, langFolder);
            if (mappedKey) {
                matched = {
                    type: 'phrase',
                    words: phraseWords,
                    phraseText,
                    mappedKey
                };
                break;
            }
        }

        if (matched) {
            units.push(matched);
            index += matched.words.length;
        } else {
            units.push({ type: 'word', text: words[index] });
            index += 1;
        }
    }

    return units;
}

async function resolveTranslationUnitTokens(unit, langFolder) {
    if (unit.type === 'word') {
        return resolveTranslationWordTokens(unit.text, langFolder);
    }

    const mappedTokens = await resolveTranslationWordTokens(unit.mappedKey, langFolder);
    const mappedCardToken = mappedTokens.find(t => t.type === 'card');
    if (mappedCardToken) {
        return [{ type: 'card', src: mappedCardToken.src, label: unit.phraseText }];
    }

    const fallbackTokens = [];
    for (let i = 0; i < unit.words.length; i++) {
        const wordTokens = await resolveTranslationWordTokens(unit.words[i], langFolder);
        fallbackTokens.push(...wordTokens);
        if (i < unit.words.length - 1) fallbackTokens.push({ type: 'space' });
    }
    return fallbackTokens;
}

function displaySignCards(text) {
    const cardArea = document.querySelector('.sign-cards-area');
    if (!cardArea) return;

    const words = text.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
        cardArea.innerHTML = '<p>No speech detected yet.</p>';
        return;
    }

    const langFolder = getTranslationLangFolder();

    (async () => {
        const tokens = [];
        const units = buildTranslationCardUnits(words, langFolder);
        for (let i = 0; i < units.length; i++) {
            const resolved = await resolveTranslationUnitTokens(units[i], langFolder);
            tokens.push(...resolved);
            if (i < units.length - 1) tokens.push({ type: 'space' });
        }

        if (translationCardQueue.length && translationCardQueue[translationCardQueue.length - 1]?.type !== 'linebreak') {
            translationCardQueue.push({ type: 'linebreak' });
        }
        translationCardQueue.push(...tokens);

        if (translationCardQueue.length > TRANSLATION_MAX_CARD_TOKENS) {
            const sliceStart = translationCardQueue.length - TRANSLATION_MAX_CARD_TOKENS;
            let trimmedQueue = translationCardQueue.slice(sliceStart);

            if (sliceStart > 0 && !['space', 'linebreak'].includes(translationCardQueue[sliceStart - 1]?.type)) {
                while (trimmedQueue.length && !['space', 'linebreak'].includes(trimmedQueue[0].type)) {
                    trimmedQueue.shift();
                }
            }

            translationCardQueue.length = 0;
            translationCardQueue.push(...trimmedQueue);

            while (translationCardQueue.length && ['space', 'linebreak'].includes(translationCardQueue[0].type)) {
                translationCardQueue.shift();
            }
        }

        cardArea.innerHTML = '';
        cardArea.style.display = 'flex';
        cardArea.style.flexWrap = 'nowrap';
        cardArea.style.flexDirection = 'column';
        cardArea.style.alignItems = 'flex-start';
        cardArea.style.justifyContent = 'flex-start';
        cardArea.style.alignContent = 'flex-start';
        cardArea.style.gap = '10px';
        cardArea.style.padding = '16px';

        const lineGroups = [];
        let currentLine = [];
        let currentGroup = [];
        for (const token of translationCardQueue) {
            if (token.type === 'linebreak') {
                if (currentGroup.length) {
                    currentLine.push(currentGroup);
                    currentGroup = [];
                }
                if (currentLine.length) {
                    lineGroups.push(currentLine);
                    currentLine = [];
                }
                continue;
            }

            if (token.type === 'space') {
                if (currentGroup.length) {
                    currentLine.push(currentGroup);
                    currentGroup = [];
                }
                continue;
            }

            currentGroup.push(token);
        }
        if (currentGroup.length) {
            currentLine.push(currentGroup);
        }
        if (currentLine.length) {
            lineGroups.push(currentLine);
        }

        lineGroups.forEach((line) => {
            const lineEl = document.createElement('div');
            lineEl.style.display = 'flex';
            lineEl.style.flexWrap = 'wrap';
            lineEl.style.alignItems = 'flex-start';
            lineEl.style.gap = '10px';
            lineEl.style.width = '100%';

            line.forEach((group) => {
                const wordGroupEl = document.createElement('div');
                wordGroupEl.style.display = 'flex';
                wordGroupEl.style.flexWrap = 'nowrap';
                wordGroupEl.style.alignItems = 'flex-start';
                wordGroupEl.style.gap = '10px';

                group.forEach((token) => {
                    const card = document.createElement('div');
                    card.style.width = '78px';
                    card.style.height = '88px';
                    card.style.border = '1px solid rgba(148,163,184,0.35)';
                    card.style.borderRadius = '10px';
                    card.style.background = 'rgba(15,23,42,0.92)';
                    card.style.display = 'flex';
                    card.style.flexDirection = 'column';
                    card.style.alignItems = 'center';
                    card.style.justifyContent = 'center';
                    card.style.padding = '5px';

                    if (token.type === 'card') {
                        const img = document.createElement('img');
                        img.src = token.src;
                        img.alt = token.label;
                        img.style.width = '100%';
                        img.style.height = '50px';
                        img.style.objectFit = 'contain';
                        img.style.borderRadius = '6px';
                        img.style.background = 'rgba(0,0,0,0.45)';
                        img.onerror = () => img.style.display = 'none';
                        card.appendChild(img);
                    }

                    const label = document.createElement('div');
                    label.textContent = token.label;
                    label.style.fontSize = '0.64rem';
                    label.style.color = '#fff';
                    label.style.marginTop = '3px';
                    label.style.textAlign = 'center';
                    label.style.width = '100%';
                    label.style.whiteSpace = 'nowrap';
                    label.style.overflow = 'hidden';
                    label.style.textOverflow = 'ellipsis';
                    card.appendChild(label);

                    wordGroupEl.appendChild(card);
                });

                lineEl.appendChild(wordGroupEl);
            });

            cardArea.appendChild(lineEl);
        });
    })();
}

// --- Sign/Voice Mode Toggle ---
function ensureSignVoiceToggle() {
    if (signVoiceToggle) return signVoiceToggle;

    signVoiceToggle = document.getElementById('sign-voice-toggle');
    if (signVoiceToggle) return signVoiceToggle;

    const controlBar = document.querySelector('.control-bar');
    if (!controlBar) return null;

    const btn = document.createElement('button');
    btn.id = 'sign-voice-toggle';
    btn.className = 'control-btn';
    btn.title = 'Switch between Sign and Voice Mode';
    btn.innerHTML = '<span class="material-icons">pan_tool</span>';
    controlBar.appendChild(btn);
    signVoiceToggle = btn;
    return signVoiceToggle;
}

function bindSignVoiceToggle() {
    const toggleBtn = ensureSignVoiceToggle();
    if (!toggleBtn) {
        console.warn('#sign-voice-toggle not found. Sign/Voice toggle is disabled.');
        return;
    }

    if (toggleBtn.dataset.bound === 'true') return;
    toggleBtn.dataset.bound = 'true';

    toggleBtn.addEventListener('click', () => {
        isSignMode = !isSignMode;

        if (isSignMode) {
            // Switch to Sign Mode
            toggleBtn.innerHTML = '<span class="material-icons">pan_tool</span>';
            toggleBtn.title = 'Switch to Voice Mode';
            sttResult.style.display = 'inline-block';
            voiceSubtitles.style.display = 'none';
            voiceSubtitles.innerText = '';
            if (speechPanel) speechPanel.classList.remove('active');

            if (isCamOn && !localStream) startCamera();
            if (recognition) recognition.stop();
        } else {
            // Switch to Voice Mode
            toggleBtn.innerHTML = '<span class="material-icons">mic</span>';
            toggleBtn.title = 'Switch to Sign Mode';
            sttResult.style.display = 'none';
            voiceSubtitles.style.display = 'block';
            if (speechPanel) speechPanel.classList.add('active');
            if (isCamOn && !localStream) startCamera();
            canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

            if (!recognition) initSpeechRecognition();
            setTimeout(() => {
                if (recognition) {
                    try {
                        recognition.start();
                    } catch (e) {
                        console.error("Error starting recognition:", e);
                    }
                }
            }, 500);
        }
    });
}

bindSignVoiceToggle();
document.addEventListener('DOMContentLoaded', bindSignVoiceToggle, { once: true });

if (speechPanel) {
    speechPanel.classList.remove('active');
}

// --- Legacy Mode Button Removed (replaced by Sign/Voice Toggle) ---
// The old modeBtn had two different modes (sign-to-text vs speech-to-sign)
// Now we have Sign Mode (sign detection) vs Voice Mode (speech recognition + captions)

// Initialize (start in sign mode by default)
if (isSignMode && isCamOn) {
    startCamera();
}
