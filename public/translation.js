
const videoElement = document.getElementById('input-video');
const canvasElement = document.getElementById('output-canvas');
const canvasCtx = canvasElement.getContext('2d');
const signView = document.getElementById('sign-view');
const speechPanel = document.getElementById('speech-panel');
const speechCaptionLog = document.getElementById('speech-caption-log');
const signCardsOutput = document.getElementById('sign-cards-output');
const captionLogWindow = document.getElementById('caption-log-window');
const captionToggleBtn = document.getElementById('captionToggleBtn');
const signCardsPanelWindow = document.getElementById('sign-cards-panel-window');
const signCardsToggleBtn = document.getElementById('signCardsToggleBtn');
const camBtn = document.getElementById('cam-btn');
const ttsBtn = document.getElementById('tts-btn');
const sttResult = document.getElementById('stt-result');
let signVoiceToggle = document.getElementById('sign-voice-toggle');

let isSignMode = true; // true = sign detection, false = voice recognition
let isCamOn = true;
let isTTSOn = true;
let lastSpokenLabel = "";
let lastSpokenTime = 0;
let localStream = null;
let cameraLoopId = null;
let recognition = null; // For Speech to Text
let isHandInferencePending = false;
let lastHandInferenceAt = 0;
let lastResultText = null;
const IS_MOBILE_DEVICE = window.matchMedia('(pointer: coarse)').matches
    || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
const HAND_INFERENCE_INTERVAL_MS = IS_MOBILE_DEVICE ? 45 : 55;
const SKELETON_MAX_EXTRAPOLATION_MS = IS_MOBILE_DEVICE ? 180 : 140;
const SKELETON_VELOCITY_DAMPING = IS_MOBILE_DEVICE ? 0.94 : 0.88;
let skeletonRenderLoopId = null;
let targetHandLandmarks = [];
let previousTargetHandLandmarks = [];
let handLandmarkVelocities = [];
let lastDetectionAt = 0;

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
const ASL_Z_MIN_CONFIDENCE = 0.82;
const ASL_Z_MIN_FRAMES = 6;
const ASL_Z_MIN_X_RANGE = 0.06;
const ASL_Z_MIN_Y_RANGE = 0.015;
const ASL_Z_MIN_PATH_DISTANCE = 0.12;
const ASL_Z_MIN_HORIZONTAL_TRAVEL = 0.09;
const ASL_Z_MIN_VERTICAL_TRAVEL = 0.02;
const ASL_Z_MIN_DIRECTION_CHANGES = 1;
const ASL_Z_MIN_CURVATURE_RATIO = 1.03;
const ASL_Z_MIN_WHOLE_HAND_PATH = 0.11;
const ASL_Z_MIN_ACTIVE_LANDMARK_RATIO = 0.28;
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

function setResultText(text) {
    if (sttResult && text !== lastResultText) {
        sttResult.innerText = text;
        lastResultText = text;
    }
}

function normalizeAlphabetLabel(label) {
    if (typeof label !== 'string') return label;
    return /^[a-zA-Z]$/.test(label) ? label.toUpperCase() : label;
}

function normalizeLabelList(labels) {
    let changed = false;
    const normalized = (labels || []).map((label) => {
        const nextLabel = normalizeAlphabetLabel(label);
        if (nextLabel !== label) changed = true;
        return nextLabel;
    });
    return { labels: normalized, changed };
}

function normalizeHandRequirementMap(map) {
    let changed = false;
    const normalized = {};

    Object.entries(map || {}).forEach(([label, requirement]) => {
        const nextLabel = normalizeAlphabetLabel(label);
        if (nextLabel !== label) changed = true;
        normalized[nextLabel] = requirement;
    });

    return { map: normalized, changed };
}

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
        setResultText(`Switched to ${lang}. Loading models...`);
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
                    serverLabels = normalizeLabelList(await response.json()).labels;
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
                let localLabelData = localStorage.getItem(`${localStorageLabelKey}-static`);
                let localModelKey = `localstorage://${localStorageModelKey}-static`;

                if (!localLabelData) {
                    console.log("Local static labels missing. Checking cloud...");
                    const cloudData = await fetchCloudModel('static', langSelect.value);
                    if (cloudData) {
                        localLabels = cloudData.labels;
                        localModel = cloudData.model;
                        console.log("Loaded static model from Cloud.");
                        return;
                    }
                }

                if (localLabelData) {
                    const normalizedLocalLabels = normalizeLabelList(JSON.parse(localLabelData));
                    localLabels = normalizedLocalLabels.labels;
                    if (normalizedLocalLabels.changed) {
                        localStorage.setItem(`${localStorageLabelKey}-static`, JSON.stringify(localLabels));
                    }
                    try {
                        localModel = await tf.loadLayersModel(localModelKey);
                        console.log(`Local Static Model loaded from LocalStorage (${localLabels.length} labels)`);
                    } catch (e) {
                        console.warn("Local static model not in LocalStorage. Checking cloud...");
                        const cloudData = await fetchCloudModel('static', langSelect.value);
                        if (cloudData) {
                            localLabels = cloudData.labels;
                            localModel = cloudData.model;
                        } else {
                            localModel = null;
                        }
                    }
                }
            } catch (e) {
                console.warn("Local static model load failed:", e);
                localModel = null;
            }
        };
        promises.push(localLoad());

        // 3. Load Local Dynamic Model
        const dynamicLoad = async () => {
            console.log("Attempting to load Local Dynamic Model...");
            try {
                let dynamicLabelData = localStorage.getItem(`${localStorageLabelKey}-dynamic`);
                
                if (!dynamicLabelData) {
                    console.log("Local dynamic labels missing. Checking cloud...");
                    const cloudData = await fetchCloudModel('dynamic', langSelect.value);
                    if (cloudData) {
                        localLabelsDynamic = cloudData.labels;
                        localModelDynamic = cloudData.model;
                        dynamicLabelHandRequirements = cloudData.handReqs || {};
                        console.log("Loaded dynamic model from Cloud.");
                        return;
                    }
                }

                if (dynamicLabelData) {
                    const normalizedDynamicLabels = normalizeLabelList(JSON.parse(dynamicLabelData));
                    localLabelsDynamic = normalizedDynamicLabels.labels;
                    if (normalizedDynamicLabels.changed) {
                        localStorage.setItem(`${localStorageLabelKey}-dynamic`, JSON.stringify(localLabelsDynamic));
                    }
                    const dynamicReqData = localStorage.getItem(`${localStorageLabelKey}-dynamic-hand-req`);
                    const normalizedHandReqs = normalizeHandRequirementMap(dynamicReqData ? JSON.parse(dynamicReqData) : {});
                    dynamicLabelHandRequirements = normalizedHandReqs.map;
                    if (normalizedHandReqs.changed) {
                        localStorage.setItem(`${localStorageLabelKey}-dynamic-hand-req`, JSON.stringify(dynamicLabelHandRequirements));
                    }
                    try {
                        localModelDynamic = await tf.loadLayersModel(`localstorage://${localStorageModelKey}-dynamic`);
                        console.log(`Local Dynamic Model loaded from LocalStorage (${localLabelsDynamic.length} labels)`);
                    } catch (e) {
                        console.warn("Local dynamic model not in LocalStorage. Checking cloud...");
                        const cloudData = await fetchCloudModel('dynamic', langSelect.value);
                        if (cloudData) {
                            localLabelsDynamic = cloudData.labels;
                            localModelDynamic = cloudData.model;
                            dynamicLabelHandRequirements = cloudData.handReqs || {};
                        } else {
                            localModelDynamic = null;
                        }
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
            setResultText("No models found. Please train in AI Training mode.");
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
        setResultText("Error loading systems.");
    }
}
async function fetchCloudModel(type, lang) {
    try {
        const langLower = lang.toLowerCase();
        
        // 1. Get Public URLs for labels and model
        const { data: labelsUrlData } = window.supabaseClient.storage
            .from('models')
            .getPublicUrl(`${langLower}/${type}/labels.json`);
            
        const { data: modelUrlData } = window.supabaseClient.storage
            .from('models')
            .getPublicUrl(`${langLower}/${type}/model.json`);

        // 2. Load Labels
        const labelsRes = await fetch(labelsUrlData.publicUrl);
        if (!labelsRes.ok) return null;
        const labels = normalizeLabelList(await labelsRes.json()).labels;
        
        // 3. Load Model
        const model = await tf.loadLayersModel(modelUrlData.publicUrl);
        
        let handReqs = null;
        if (type === 'dynamic') {
            const { data: handReqsUrlData } = window.supabaseClient.storage
                .from('models')
                .getPublicUrl(`${langLower}/${type}/hand_reqs.json`);
            const reqRes = await fetch(handReqsUrlData.publicUrl);
            if (reqRes.ok) {
                handReqs = normalizeHandRequirementMap(await reqRes.json()).map;
            }
        }
        
        return { model, labels, handReqs };
    } catch (err) {
        console.warn(`Cloud model fetch failed for ${type}:`, err);
        return null;
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
    minDetectionConfidence: 0.7,
    minTrackingConfidence: 0.65
});

hands.onResults(onResults);

function cloneHands(hands) {
    return (hands || []).map((hand) => hand.map((point) => ({
        x: point.x,
        y: point.y,
        z: point.z
    })));
}

function syncCanvasSize() {
    if (!videoElement.videoWidth || !videoElement.videoHeight) return false;
    if (canvasElement.width !== videoElement.videoWidth || canvasElement.height !== videoElement.videoHeight) {
        canvasElement.width = videoElement.videoWidth;
        canvasElement.height = videoElement.videoHeight;
    }
    return true;
}

function updateSkeletonTargets(handLandmarks) {
    const now = performance.now();
    const nextHands = cloneHands(handLandmarks);

    if (previousTargetHandLandmarks.length !== nextHands.length) {
        previousTargetHandLandmarks = cloneHands(nextHands);
    }

    handLandmarkVelocities = nextHands.map((hand, handIndex) => {
        const previousHand = previousTargetHandLandmarks[handIndex] || hand;
        const deltaMs = Math.max(now - lastDetectionAt, 1);

        return hand.map((point, pointIndex) => {
            const previousPoint = previousHand[pointIndex] || point;
            return {
                x: (point.x - previousPoint.x) / deltaMs,
                y: (point.y - previousPoint.y) / deltaMs,
                z: (point.z - previousPoint.z) / deltaMs
            };
        });
    });

    previousTargetHandLandmarks = cloneHands(nextHands);
    targetHandLandmarks = nextHands;
    lastDetectionAt = now;
}

function clearSkeletonTargets() {
    targetHandLandmarks = [];
    previousTargetHandLandmarks = [];
    handLandmarkVelocities = [];
}

function renderSkeletonFrame(now) {
    skeletonRenderLoopId = requestAnimationFrame(renderSkeletonFrame);

    if (!syncCanvasSize()) return;

    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

    if (!targetHandLandmarks.length) {
        return;
    }

    const sinceDetectionMs = now - lastDetectionAt;
    const shouldExtrapolate = sinceDetectionMs > 0 && sinceDetectionMs <= SKELETON_MAX_EXTRAPOLATION_MS;

    const displayHands = targetHandLandmarks.map((targetHand, handIndex) => {
        const velocityHand = handLandmarkVelocities[handIndex] || [];

        return targetHand.map((targetPoint, pointIndex) => {
            const velocityPoint = velocityHand[pointIndex] || { x: 0, y: 0, z: 0 };
            return shouldExtrapolate ? {
                x: Math.min(1, Math.max(0, targetPoint.x + velocityPoint.x * sinceDetectionMs * SKELETON_VELOCITY_DAMPING)),
                y: Math.min(1, Math.max(0, targetPoint.y + velocityPoint.y * sinceDetectionMs * SKELETON_VELOCITY_DAMPING)),
                z: targetPoint.z + velocityPoint.z * sinceDetectionMs * SKELETON_VELOCITY_DAMPING
            } : targetPoint;
        });
    });

    for (const landmarks of displayHands) {
        drawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS, { color: '#00FF00', lineWidth: 4 });
        drawLandmarks(canvasCtx, landmarks, { color: '#FF0000', lineWidth: 2 });
    }
}

function startSkeletonRenderer() {
    if (skeletonRenderLoopId) return;
    skeletonRenderLoopId = requestAnimationFrame(renderSkeletonFrame);
}

function stopSkeletonRenderer() {
    if (skeletonRenderLoopId) {
        cancelAnimationFrame(skeletonRenderLoopId);
        skeletonRenderLoopId = null;
    }
    clearSkeletonTargets();
}

function preprocessLandmarks(landmarks, mirrorX = false) {
    const wrist = landmarks[0];
    const wristX = mirrorX ? 1 - wrist.x : wrist.x;
    const indexMCP = landmarks[5];
    const indexX = mirrorX ? 1 - indexMCP.x : indexMCP.x;
    const distance = Math.hypot(
        indexX - wristX,
        indexMCP.y - wrist.y,
        indexMCP.z - wrist.z
    ) || 1e-6;
    const normalized = new Array(landmarks.length * 3);

    for (let index = 0; index < landmarks.length; index += 1) {
        const point = landmarks[index];
        const pointX = mirrorX ? 1 - point.x : point.x;
        const base = index * 3;
        normalized[base] = (pointX - wristX) / distance;
        normalized[base + 1] = (point.y - wrist.y) / distance;
        normalized[base + 2] = (point.z - wrist.z) / distance;
    }

    return normalized;
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
        previousMotionFrame = currentFrame.slice();
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

    previousMotionFrame = currentFrame.slice();
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
    lastDisplayedFrame = currentFrame.slice();
}

function shouldKeepLastPrediction(currentFrame) {
    if (!lastDisplayedPrediction || !lastDisplayedFrame) return false;
    const diff = getFrameDifference(currentFrame, lastDisplayedFrame);
    return diff < BIG_MOTION_CHANGE_THRESHOLD;
}

// Helper to run a single model prediction
function getPredictionFromTensor(predictionTensor, labels) {
    if (!predictionTensor || !labels.length) return { label: null, conf: 0 };

    const values = predictionTensor.dataSync();
    let idx = 0;
    let conf = values[0] ?? 0;

    for (let valueIndex = 1; valueIndex < values.length; valueIndex += 1) {
        if (values[valueIndex] > conf) {
            conf = values[valueIndex];
            idx = valueIndex;
        }
    }

    // Cleanup happens in tf.tidy in caller
    return { label: normalizeAlphabetLabel(labels[idx]), conf: conf };
}

function predictSingleModel(modelInstance, labels, tensor) {
    if (!modelInstance || !labels.length) return { label: null, conf: 0 };
    return getPredictionFromTensor(modelInstance.predict(tensor), labels);
}

function normalizeHandRequirement(rawValue) {
    if (rawValue === 1 || rawValue === '1') return 1;
    if (rawValue === 2 || rawValue === '2') return 2;
    return 'any';
}

function isASLDynamicSpellingLetter(label) {
    if (localStorageModelKey !== 'my-asl-model') return false;
    if (typeof label !== 'string') return false;
    return label.toUpperCase() === 'Z';
}

function getASLZMotionMetrics(frameBuffer) {
    const tipPoints = (frameBuffer || [])
        .filter(frame => Array.isArray(frame) && frame.length >= 26)
        .map(frame => ({ x: frame[24], y: frame[25] }));

    if (tipPoints.length < 2) {
        return {
            frameCount: tipPoints.length,
            xRange: 0,
            yRange: 0,
            pathDistance: 0,
            horizontalTravel: 0,
            verticalTravel: 0,
            directionChanges: 0,
            endToEndDistance: 0,
            curvatureRatio: 0
        };
    }

    let pathDistance = 0;
    let horizontalTravel = 0;
    let verticalTravel = 0;
    let directionChanges = 0;
    let lastHorizontalDirection = 0;
    let wholeHandPathDistance = 0;
    let activeLandmarkComparisons = 0;
    let totalLandmarkComparisons = 0;

    for (let index = 1; index < tipPoints.length; index += 1) {
        const dx = tipPoints[index].x - tipPoints[index - 1].x;
        const dy = tipPoints[index].y - tipPoints[index - 1].y;
        pathDistance += Math.hypot(dx, dy);
        horizontalTravel += Math.abs(dx);
        verticalTravel += Math.abs(dy);

        const currentFrame = frameBuffer[index];
        const previousFrame = frameBuffer[index - 1];
        if (Array.isArray(currentFrame) && Array.isArray(previousFrame) && currentFrame.length >= 63 && previousFrame.length >= 63) {
            for (let landmark = 0; landmark < 21; landmark += 1) {
                const base = landmark * 3;
                const lx = currentFrame[base] - previousFrame[base];
                const ly = currentFrame[base + 1] - previousFrame[base + 1];
                const lz = currentFrame[base + 2] - previousFrame[base + 2];
                const landmarkDelta = Math.hypot(lx, ly, lz);

                wholeHandPathDistance += landmarkDelta;
                totalLandmarkComparisons += 1;
                if (landmarkDelta >= 0.01) {
                    activeLandmarkComparisons += 1;
                }
            }
        }

        const direction = Math.abs(dx) >= 0.01 ? Math.sign(dx) : 0;
        if (direction !== 0) {
            if (lastHorizontalDirection !== 0 && direction !== lastHorizontalDirection) {
                directionChanges += 1;
            }
            lastHorizontalDirection = direction;
        }
    }

    const xValues = tipPoints.map(point => point.x);
    const yValues = tipPoints.map(point => point.y);
    const xRange = Math.max(...xValues) - Math.min(...xValues);
    const yRange = Math.max(...yValues) - Math.min(...yValues);
    const start = tipPoints[0];
    const end = tipPoints[tipPoints.length - 1];
    const endToEndDistance = Math.hypot(end.x - start.x, end.y - start.y);
    const curvatureRatio = endToEndDistance > 0 ? pathDistance / endToEndDistance : 0;
    const normalizedWholeHandPath = totalLandmarkComparisons > 0 ? (wholeHandPathDistance / totalLandmarkComparisons) : 0;
    const activeLandmarkRatio = totalLandmarkComparisons > 0 ? (activeLandmarkComparisons / totalLandmarkComparisons) : 0;

    return {
        frameCount: tipPoints.length,
        xRange,
        yRange,
        pathDistance,
        horizontalTravel,
        verticalTravel,
        directionChanges,
        endToEndDistance,
        curvatureRatio,
        wholeHandPathDistance: normalizedWholeHandPath,
        activeLandmarkRatio
    };
}

function hasStrongASLZMotion(label, confidence, frameBuffer) {
    if (!isASLDynamicSpellingLetter(label)) return true;
    if (confidence < ASL_Z_MIN_CONFIDENCE) return false;

    const metrics = getASLZMotionMetrics(frameBuffer);
    if (metrics.frameCount < ASL_Z_MIN_FRAMES) return false;

    const hasMinimumTravel = metrics.xRange >= ASL_Z_MIN_X_RANGE
        && metrics.yRange >= ASL_Z_MIN_Y_RANGE
        && metrics.pathDistance >= ASL_Z_MIN_PATH_DISTANCE
        && metrics.horizontalTravel >= ASL_Z_MIN_HORIZONTAL_TRAVEL
        && metrics.verticalTravel >= ASL_Z_MIN_VERTICAL_TRAVEL;

    if (!hasMinimumTravel) return false;

    const hasWholeHandMovement = metrics.wholeHandPathDistance >= ASL_Z_MIN_WHOLE_HAND_PATH
        && metrics.activeLandmarkRatio >= ASL_Z_MIN_ACTIVE_LANDMARK_RATIO;
    if (!hasWholeHandMovement) return false;

    // Reject tiny transition jitter, but allow real Z without requiring a perfect trace.
    const hasDirectionOrCurvature = metrics.directionChanges >= ASL_Z_MIN_DIRECTION_CHANGES
        || metrics.curvatureRatio >= ASL_Z_MIN_CURVATURE_RATIO;

    return hasDirectionOrCurvature;
}

function labelMatchesDetectedHands(label, detectedHandCount) {
    const requirement = normalizeHandRequirement(dynamicLabelHandRequirements[label]);
    return requirement === 'any' || requirement === detectedHandCount;
}

function shouldSkipStaticLabel(label) {
    return typeof label === 'string' && label.toLowerCase() === 'hello';
}

function applyISLHandCountDisambiguation(label, detectedHandCount) {
    if (localStorageModelKey !== 'my-isl-model') return label;
    if (typeof label !== 'string') return label;

    if (detectedHandCount < 2 && label.toUpperCase() === 'T') {
        return '1';
    }

    return label;
}

function chooseBestCandidateWithLocalPriority(candidates) {
    const serverCandidates = candidates.filter(c => c.source.startsWith('Server'));
    const localCandidates = candidates.filter(c => c.source.startsWith('Local') || c.source === 'Dynamic');

    serverCandidates.sort((a, b) => b.conf - a.conf);
    localCandidates.sort((a, b) => b.conf - a.conf);

    const bestLocal = localCandidates[0] || null;
    const bestServer = serverCandidates[0] || null;

    if (bestLocal && bestServer) {
        const serverLabel = String(bestServer.label || '').toUpperCase();
        const localLabel = String(bestLocal.label || '').toUpperCase();
        const serverIsAlphabet = /^[A-Z]$/.test(serverLabel);
        const localIsDigit = /^[0-9]$/.test(localLabel);

        // Keep a narrow safety guard only for strong alphabet-vs-digit conflicts.
        if (serverIsAlphabet && localIsDigit && bestServer.conf >= 0.75 && (bestServer.conf - bestLocal.conf) >= 0.08) {
            return bestServer;
        }

        // Stronger local preference so website-trained signs win more consistently.
        const localScore = bestLocal.conf + 0.10;
        const serverScore = bestServer.conf;
        return localScore >= serverScore ? bestLocal : bestServer;
    }

    return bestLocal || bestServer || null;
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

        // Collect candidates from all available models
        let candidates = [];

        // 1. Query Server Model (Static only when hand is still)
        if (staticAllowed && serverModel && serverLabels.length) {
            const pNorm = predictSingleModel(serverModel, serverLabels, tensorNormal);
            if (!shouldSkipStaticLabel(pNorm.label)) {
                candidates.push({ ...pNorm, source: 'Server' });
            }

            if (pNorm.conf < 0.7) {
                const tensorFlipped = tf.tensor2d([preprocessLandmarks(landmarks, true)]);
                const pFlip = predictSingleModel(serverModel, serverLabels, tensorFlipped);
                if (!shouldSkipStaticLabel(pFlip.label)) {
                    candidates.push({ ...pFlip, source: 'Server(M)' });
                }
            }
        }

        // 2. Query Local Static Model (only when hand is still)
        if (staticAllowed && localModel && localLabels.length) {
            const pNorm = predictSingleModel(localModel, localLabels, tensorNormal);
            if (!shouldSkipStaticLabel(pNorm.label)) {
                candidates.push({ ...pNorm, source: 'Local' });
            }

            // Keep local model non-mirrored to avoid unstable predictions from mirrored coordinates.
        }

        // 3. Query Dynamic Model with frame buffer
        // Skip dynamic detection if user is in the middle of spelling
        if (localModelDynamic && localLabelsDynamic.length) {
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
                const { conf, label: predictedDynamicLabel } = getPredictionFromTensor(predDynamic, localLabelsDynamic);

                // Keep dynamic predictions unboosted to reduce false positives,
                // but still enforce hand-count requirements when available.
                const allowDynamicDuringSpelling = accumulatedWord.length === 0 || isASLDynamicSpellingLetter(predictedDynamicLabel);
                const strongEnoughForZ = hasStrongASLZMotion(predictedDynamicLabel, conf, paddedFrames);
                if (allowDynamicDuringSpelling && strongEnoughForZ && labelMatchesDetectedHands(predictedDynamicLabel, detectedHandCount)) {
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

        // 4. Find Best Candidate with local/web-trained priority
        const best = chooseBestCandidateWithLocalPriority(candidates);

        // 5. Threshold & Display
        if (best) {
            let outputLabel = best.isDynamic ? normalizeAlphabetLabel(best.label) : normalizeAlphabetLabel(getSmoothedPrediction(best.label));

            // Hardcoded overrides for ASL explicitly requested by user to fix misclassifications
            if (localStorageModelKey === 'my-asl-model' && best.source && best.source.startsWith('Server')) {
                if (outputLabel === 'D') outputLabel = '1';
                if (outputLabel === 'R') outputLabel = '3';
                if (outputLabel === 'W') outputLabel = '6';
                if (outputLabel === 'F') outputLabel = '9';
            }

            outputLabel = applyISLHandCountDisambiguation(outputLabel, detectedHandCount);
            updateDisplayedPrediction(outputLabel, best.conf, !!best.isDynamic, flatNormal);

            if (outputLabel.length === 1 && /^[a-zA-Z0-9]$/.test(outputLabel)) {
                // Dynamic ASL Z is movement-based, so use cooldown commit instead of static hold timing.
                if (best.isDynamic && isASLDynamicSpellingLetter(outputLabel)) {
                    processDynamicPredictedLetter(outputLabel, best.conf);
                } else {
                    processPredictedLetter(outputLabel);
                }
                const dynamicTag = best.isDynamic ? ' 🔄' : '';
                setResultText(`Sign: ${outputLabel}${dynamicTag} (${Math.round(best.conf * 100)}%)`);
            } else if (best.isDynamic && best.conf > 0.85 && accumulatedWord.length === 0) { // Require high confidence for dynamic
                setResultText(`Sign: ${outputLabel} 🔄 (${Math.round(best.conf * 100)}%)`);

                // Change-only speaking: do not repeat while same sign remains detected.
                const isDifferentSign = outputLabel !== lastSpokenLabel;

                if (isDifferentSign) {
                    speakText(outputLabel);
                    lastSpokenLabel = outputLabel;
                    lastSpokenTime = Date.now();
                }

                // Clear buffer after confident detection
                setTimeout(() => {
                    dynamicFrameBuffer = [];
                    dynamicBufferStartTime = 0;
                }, 500); // Small delay before clearing
            } else if (accumulatedWord.length === 0) {
                // Only show non-dynamic/non-letter signs if not spelling
                setResultText(`Sign: ${outputLabel} (${Math.round(best.conf * 100)}%)`);
                if (outputLabel !== lastSpokenLabel) {
                    speakText(outputLabel);
                    lastSpokenLabel = outputLabel;
                    lastSpokenTime = Date.now();
                }
            } else if (accumulatedWord.length > 0) {
                // During spelling, suppress sttResult display entirely (only show spelling overlay)
                setResultText('');
            }
        } else {
            // No confident prediction
            if (accumulatedWord.length > 0) {
                // During spelling, clear sttResult to prevent competing displays
                setResultText('');
            } else if (lastDisplayedPrediction) {
                // Only show last prediction if not spelling
                const last = lastDisplayedPrediction;
                const displayText = last.isDynamic ? `${normalizeAlphabetLabel(last.label)} 🔄` : normalizeAlphabetLabel(last.label);
                setResultText(`Sign: ${displayText} (${Math.round(last.conf * 100)}%)`);
            }
            // Don't show "Listening..." - just keep previous prediction or blank
        }
    });
}

function onResults(results) {
    const handLandmarks = results.multiHandLandmarks || [];

    if (handLandmarks.length > 0) {
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

        const detectedHandCount = Math.min(2, handLandmarks.length);

        updateSkeletonTargets(handLandmarks);

        // Predict once from the primary hand to avoid duplicate/competing outputs.
        runPrediction(handLandmarks[0], detectedHandCount);
    } else {
        // No hands detected - set timeout for "Waiting for hands"
        if (!noHandsTimeoutId) {
            noHandsTimeoutId = setTimeout(() => {
                setResultText("Waiting for hands...");
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
        clearSkeletonTargets();
    }
}

// --- Spelling Logic ---
// We introduce a hold-based filter: a letter sign must be held for at least
// `minimumHoldDuration` before it is actually added. This prevents quick
// hand movements from being misinterpreted as multiple letters.
const minimumHoldDuration = 1000; // milliseconds (~1 second)
let holdStartTime = 0;
let heldLetter = null;
const DYNAMIC_LETTER_COOLDOWN_MS = 1200;
let lastDynamicLetterAddedAt = 0;

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

function processDynamicPredictedLetter(letter, confidence = 0) {
    const now = Date.now();
    if (confidence < 0.7) return;
    if (now - lastDynamicLetterAddedAt < DYNAMIC_LETTER_COOLDOWN_MS) return;

    handleSpelling(letter);
    lastDynamicLetterAddedAt = now;
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

    // Speak the whole word only if TTS is OFF (to avoid redundancy since letters are already spoken)
    // but allow forceSpeak (hand loss) to still trigger it if TTS is disabled.
    if (!isTTSOn) {
        speakText(wordToSpeak, forceSpeak);
    }

    // Show in main result area
    setResultText(`Spelled: ${wordToSpeak}`);

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
                width: { ideal: IS_MOBILE_DEVICE ? 960 : 1280 },
                height: { ideal: IS_MOBILE_DEVICE ? 540 : 720 },
                aspectRatio: { ideal: 16 / 9 },
                frameRate: { ideal: 30, max: 30 },
                resizeMode: 'none'
            },
            {
                facingMode: 'user',
                width: { ideal: IS_MOBILE_DEVICE ? 960 : 1280 },
                height: { ideal: IS_MOBILE_DEVICE ? 540 : 720 },
                aspectRatio: { ideal: 16 / 9 },
                frameRate: { ideal: 30, max: 30 }
            },
            {
                facingMode: 'user',
                width: { ideal: IS_MOBILE_DEVICE ? 640 : 1280 },
                height: { ideal: IS_MOBILE_DEVICE ? 480 : 720 },
                frameRate: { ideal: 30, max: 30 }
            },
            {
                facingMode: 'user',
                frameRate: { ideal: 30, max: 30 }
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

        startSkeletonRenderer();

        const processFrame = async () => {
            if (!isCamOn || !localStream) {
                return;
            }

            if (isSignMode) {
                const now = performance.now();
                if (!isHandInferencePending && (now - lastHandInferenceAt) >= HAND_INFERENCE_INTERVAL_MS) {
                    isHandInferencePending = true;
                    lastHandInferenceAt = now;

                    try {
                        await hands.send({ image: videoElement });
                    } finally {
                        isHandInferencePending = false;
                    }
                }
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

    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }

    isHandInferencePending = false;
    lastHandInferenceAt = 0;
    stopSkeletonRenderer();
    videoElement.srcObject = null;
    if (canvasElement.width && canvasElement.height) {
        canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
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

        setResultText("Camera is off.");
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

    const emptyMsg = speechCaptionLog.querySelector('.caption-log-empty');
    if (emptyMsg) {
        emptyMsg.remove();
    }

    const line = document.createElement('div');
    line.className = 'caption-log-entry';

    const speakerLabel = document.createElement('span');
    speakerLabel.className = 'caption-log-speaker';
    speakerLabel.textContent = 'You:';

    line.appendChild(speakerLabel);
    line.append(document.createTextNode(` ${cleaned}`));
    speechCaptionLog.appendChild(line);

    while (speechCaptionLog.children.length > 70) {
        speechCaptionLog.removeChild(speechCaptionLog.firstChild);
    }

    speechCaptionLog.scrollTop = speechCaptionLog.scrollHeight;
}

function setSignCardsPanelCollapsed(collapsed) {
    if (!signCardsPanelWindow || !signCardsToggleBtn) return;

    signCardsPanelWindow.classList.toggle('collapsed', collapsed);
    signCardsToggleBtn.setAttribute('aria-expanded', String(!collapsed));
    signCardsToggleBtn.setAttribute('title', collapsed ? 'Show sign cards' : 'Hide sign cards');
}

function setCaptionLogCollapsed(collapsed) {
    if (!captionLogWindow || !captionToggleBtn) return;

    captionLogWindow.classList.toggle('collapsed', collapsed);
    captionToggleBtn.setAttribute('aria-expanded', String(!collapsed));
    captionToggleBtn.setAttribute('title', collapsed ? 'Show captions' : 'Hide captions');
}

setCaptionLogCollapsed(false);
setSignCardsPanelCollapsed(false);

// --- Speech Recognition Logic (Speech to Sign) ---
function initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
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
            appendSpeechCaption(finalized);
            displaySignCards(finalized);
        }
    };

    recognition.onerror = (event) => {
        console.error("Speech recognition error:", event.error);
    };

    recognition.onend = () => {
        console.log("Speech recognition ended.");
        // Auto-restart if we are still in voice mode
        if (!isSignMode) {
            console.log("Restarting speech recognition...");
            try {
                recognition.start();
            } catch (e) {
                console.error("Error restarting recognition:", e);
                // If it fails immediately, try again after a short delay
                setTimeout(() => {
                    if (!isSignMode) recognition.start();
                }, 1000);
            }
        }
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

function getTranslationCardArea() {
    return signCardsOutput || document.querySelector('.prediction-sign-cards-container');
}

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
        `/signs-images/${langFolder}/words/${normalizedWord}.gif`,
        `/signs-images/${langFolder}/${normalizedWord}.jpg`,
        `/signs-images/${langFolder}/${normalizedWord}.png`,
        `/signs-images/${langFolder}/${normalizedWord}.gif`
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
            candidates.push(`/signs-images/${langFolder}/characters/${char}.gif`);
        } else {
            candidates.push(`/signs-images/${langFolder}/characters/${char}.jpg`);
            candidates.push(`/signs-images/${langFolder}/characters/${char}.png`);
            candidates.push(`/signs-images/${langFolder}/characters/${char}.gif`);
            const digitWord = TRANSLATION_DIGIT_WORD_MAP[char];
            if (digitWord) {
                candidates.push(`/signs-images/${langFolder}/characters/${digitWord}.jpg`);
                candidates.push(`/signs-images/${langFolder}/characters/${digitWord}.png`);
                candidates.push(`/signs-images/${langFolder}/characters/${digitWord}.gif`);
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

/**
 * Renders the state of translationCardQueue to the UI.
 * Scoped here to be called during incremental updates.
 */
function renderTranslationCardQueue() {
    const cardArea = getTranslationCardArea();
    if (!cardArea) return;

    cardArea.innerHTML = '';
    cardArea.classList.toggle('active', translationCardQueue.length > 0);

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
    if (currentGroup.length) currentLine.push(currentGroup);
    if (currentLine.length) lineGroups.push(currentLine);

    lineGroups.forEach((line) => {
        const lineEl = document.createElement('div');
        lineEl.className = 'prediction-sign-line';
        lineEl.style.flexWrap = 'nowrap';
        lineEl.style.gap = '25px';
        lineEl.style.flexShrink = '0';

        line.forEach((group) => {
            const wordGroupEl = document.createElement('div');
            wordGroupEl.className = 'prediction-word-group';
            wordGroupEl.style.flexWrap = 'nowrap';
            wordGroupEl.style.alignItems = 'flex-start';
            wordGroupEl.style.gap = '10px';
            wordGroupEl.style.flexShrink = '0';

            group.forEach((token) => {
                const card = document.createElement('div');
                card.className = 'prediction-sign-card';
                card.style.width = '78px';
                card.style.height = '88px';
                card.style.border = '1px solid rgba(148,163,184,0.35)';
                card.style.background = 'rgba(15,23,42,0.92)';
                card.style.padding = '5px';
                card.style.flexShrink = '0';

                if (token.type === 'card') {
                    const img = document.createElement('img');
                    img.src = token.src;
                    img.alt = token.label;
                    img.style.height = '50px';
                    img.style.objectFit = 'contain';
                    img.style.background = 'rgba(0,0,0,0.45)';
                    img.onerror = () => img.style.display = 'none';
                    card.appendChild(img);
                }

                const label = document.createElement('div');
                label.className = 'prediction-sign-card-label';
                label.textContent = token.label;
                label.style.fontSize = '0.64rem';
                label.style.color = '#fff';
                label.style.marginTop = '3px';
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
    
    // Auto-scroll logic with smooth panning for new words
    // Calculate the jump point (previous end) to start the smooth pan from
    const oldScrollWidth = cardArea.dataset.lastScrollWidth ? parseInt(cardArea.dataset.lastScrollWidth) : 0;
    const newScrollWidth = cardArea.scrollWidth;
    
    // 1. Instantly jump back to the previous end position so we can pan from there
    cardArea.scrollLeft = oldScrollWidth;

    // 2. Perform smooth scroll to the new end position
    setTimeout(() => {
        cardArea.scrollTo({
            left: newScrollWidth,
            behavior: 'smooth'
        });
        // Store current width for the next word
        cardArea.dataset.lastScrollWidth = newScrollWidth.toString();
    }, 10);

    // Vertical scroll for desktop side-panel
    cardArea.scrollTop = cardArea.scrollHeight;
}

async function displaySignCards(text) {
    const cardArea = getTranslationCardArea();
    if (!cardArea) return;

    const words = text.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
        if (translationCardQueue.length === 0) {
            cardArea.classList.remove('active');
            cardArea.innerHTML = '<div class="placeholder-msg">Sign Cards will appear here.</div>';
        }
        return;
    }

    const langFolder = getTranslationLangFolder();
    const units = buildTranslationCardUnits(words, langFolder);

    for (let i = 0; i < units.length; i++) {
        const tokens = await resolveTranslationUnitTokens(units[i], langFolder);
        
        // Add each token (card/label) with a small delay for a streaming effect
        // This ensures long words enter the screen predictably and remain readable
        for (const token of tokens) {
            translationCardQueue.push(token);

            // Prune queue within the loop to keep it responsive
            if (translationCardQueue.length > TRANSLATION_MAX_CARD_TOKENS) {
                const sliceStart = translationCardQueue.length - TRANSLATION_MAX_CARD_TOKENS;
                let trimmedQueue = translationCardQueue.slice(sliceStart);
                if (sliceStart > 0 && !['space', 'linebreak'].includes(translationCardQueue[sliceStart-1]?.type)) {
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

            // Reveal this card now
            renderTranslationCardQueue();

            // Delay for readability (250ms is roughly matching manual sign speed)
            await new Promise(r => setTimeout(r, 250));
        }

        // Add linebreak after each word unit
        translationCardQueue.push({ type: 'linebreak' });
        renderTranslationCardQueue();

        // Extra gap between words
        if (i < units.length - 1) {
            await new Promise(r => setTimeout(r, 600));
        }
    }
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
        
        // Use body class for robust CSS-based UI toggling
        document.body.classList.toggle('voice-mode-active', !isSignMode);

        if (isSignMode) {
            // Switch to Sign Mode
            toggleBtn.innerHTML = '<span class="material-icons">pan_tool</span>';
            toggleBtn.title = 'Switch to Voice Mode';

            if (isCamOn && !localStream) startCamera();
            if (recognition) recognition.stop();
        } else {
            // Switch to Voice Mode
            toggleBtn.innerHTML = '<span class="material-icons">mic</span>';
            toggleBtn.title = 'Switch to Sign Mode';

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



// --- Legacy Mode Button Removed (replaced by Sign/Voice Toggle) ---
// The old modeBtn had two different modes (sign-to-text vs speech-to-sign)
// Now we have Sign Mode (sign detection) vs Voice Mode (speech recognition + captions)

// --- Drag to Scroll Utility ---
function enableDragToScroll(el, direction = 'both') {
    if (!el) return;
    let isDown = false;
    let startX, startY;
    let scrollLeft, scrollTop;

    el.addEventListener('mousedown', (e) => {
        isDown = true;
        el.style.cursor = 'grabbing';
        startX = e.pageX - el.offsetLeft;
        startY = e.pageY - el.offsetTop;
        scrollLeft = el.scrollLeft;
        scrollTop = el.scrollTop;
    });

    el.addEventListener('mouseleave', () => {
        isDown = false;
        el.style.cursor = 'default';
    });

    el.addEventListener('mouseup', () => {
        isDown = false;
        el.style.cursor = 'default';
    });

    el.addEventListener('mousemove', (e) => {
        if (!isDown) return;
        e.preventDefault();
        
        if (direction === 'both' || direction === 'horizontal') {
            const x = e.pageX - el.offsetLeft;
            const walkX = (x - startX) * 2;
            el.scrollLeft = scrollLeft - walkX;
        }
        
        if (direction === 'both' || direction === 'vertical') {
            const y = e.pageY - el.offsetTop;
            const walkY = (y - startY) * 2;
            el.scrollTop = scrollTop - walkY;
        }
    });
}

if (speechCaptionLog) {
    enableDragToScroll(speechCaptionLog, 'vertical');
}

const cardArea = getTranslationCardArea();
if (cardArea) {
    enableDragToScroll(cardArea, 'horizontal');
}

if (captionToggleBtn) {
    captionToggleBtn.addEventListener('click', () => {
        if (!captionLogWindow) return;
        const willCollapse = !captionLogWindow.classList.contains('collapsed');
        setCaptionLogCollapsed(willCollapse);
    });
}

if (signCardsToggleBtn) {
    signCardsToggleBtn.addEventListener('click', () => {
        if (!signCardsPanelWindow) return;
        const willCollapse = !signCardsPanelWindow.classList.contains('collapsed');
        setSignCardsPanelCollapsed(willCollapse);
    });
}

// Initialize (start in sign mode by default)
if (isSignMode && isCamOn) {
    startCamera();
}
