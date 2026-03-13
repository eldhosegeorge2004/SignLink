
// --- DOM Elements ---
const videoElement = document.getElementById('inputVideo');
const canvasElement = document.getElementById('outputCanvas');
const canvasCtx = canvasElement.getContext('2d');
const langSelect = document.getElementById('langSelect');
const labelInput = document.getElementById('labelInput');
const captureBtn = document.getElementById('captureBtn');
const trainBtn = document.getElementById('trainBtn');
const saveBtn = document.getElementById('saveBtn');
const statusMsg = document.getElementById('statusMsg');
const dataList = document.getElementById('dataList');
const totalSamplesBadge = document.getElementById('totalSamples');
const recIndicator = document.getElementById('recIndicator');
const uploadBtn = document.getElementById('uploadBtn');
const uploadInput = document.getElementById('uploadInput');
const revertBtn = document.getElementById('revertBtn');
const clearAllBtn = document.getElementById('clearAllBtn');
const testBtn = document.getElementById('testBtn');
const testResult = document.getElementById('testResult');
const dataPanel = document.querySelector('.data-panel');
const openDataPanelBtn = document.getElementById('openDataPanelBtn');
const closeDataPanelBtn = document.getElementById('closeDataPanelBtn');
const drawerBackdrop = document.getElementById('drawerBackdrop');

// Sign Card Elements
const signCardBtn = document.getElementById('signCardBtn');
const signCardInput = document.getElementById('signCardInput');
const signCardStatus = document.getElementById('signCardStatus');
const clearSignDetailsBtn = document.getElementById('clearSignDetailsBtn');
const signCardFileName = document.getElementById('signCardFileName');

// Dynamic mode elements
const staticModeBtn = document.getElementById('staticModeBtn');
const dynamicModeBtn = document.getElementById('dynamicModeBtn');
const modeDescription = document.getElementById('modeDescription');
const captureHint = document.getElementById('captureHint');
const dynamicControls = document.getElementById('dynamicControls');
const startRecordBtn = document.getElementById('startRecordBtn');
const stopRecordBtn = document.getElementById('stopRecordBtn');
const frameCounter = document.getElementById('frameCounter');
const frameCount = document.getElementById('frameCount');
const recordingProgress = document.getElementById('recordingProgress');
const progressBar = document.getElementById('progressBar');

// --- State ---
let isCollecting = false;
let collectedData = [];
let currentLang = 'ISL';
let model = null;
let recordingMode = 'static'; // 'static' or 'dynamic'
const MAX_STATIC_SAMPLES_PER_SESSION = 100;
let staticSessionSampleCount = 0;
let isStaticPausedNoHands = false;

// Dynamic recording state
let isDynamicRecording = false;
let dynamicFrameBuffer = [];
const MAX_DYNAMIC_FRAMES = 30;
const TARGET_FPS = 10; // Capture ~10 frames per second
let lastFrameCaptureTime = 0;
let dynamicRecordingMaxHands = 1;

// Test mode state
let isTestMode = false;
let testStaticModel = null;
let testStaticLabels = [];
let testDynamicModel = null;
let testDynamicLabels = [];
let testDynamicFrameBuffer = [];
let testDynamicBufferStartTime = 0;
const TEST_DYNAMIC_ANALYZE_MS = 1200;

function normalizeLabel(label) {
    const trimmed = (label || '').trim();
    if (!trimmed) return '';
    if (/^[a-zA-Z]$/.test(trimmed)) return trimmed.toUpperCase();
    return trimmed;
}

function normalizeDatasetLabels(samples) {
    let changed = false;
    const normalized = samples.map((sample) => {
        const normalizedLabel = normalizeLabel(sample.label);
        if (normalizedLabel !== sample.label) {
            changed = true;
            return { ...sample, label: normalizedLabel };
        }
        return sample;
    });
    return { normalized, changed };
}

function getUntrainedSampleCount() {
    return collectedData.filter(sample => sample.isTrained === false).length;
}

function updateRevertButtonState() {
    if (!revertBtn) return;

    const untrainedCount = getUntrainedSampleCount();
    revertBtn.disabled = untrainedCount === 0;
    revertBtn.innerHTML = `<span class="material-icons">undo</span>Revert New Data${untrainedCount ? ` (${untrainedCount})` : ''}`;
}

// Storage Keys
const STORAGE_KEYS = {
    'ISL': { model: 'my-isl-model', labels: 'isl_labels', data: 'isl_data' },
    'ASL': { model: 'my-asl-model', labels: 'asl_labels', data: 'asl_data' }
};

// --- Initialization ---
async function init() {
    startCamera();
    await loadDataFromServer();
    checkForSavedModels(); // Check if models already exist in localStorage
    renderDataList();
    updateRevertButtonState();
    setupModeToggle();
    setupMobileDataDrawer();
}

function setupMobileDataDrawer() {
    if (!dataPanel) return;

    const openDrawer = () => {
        dataPanel.classList.add('open');
        if (drawerBackdrop) drawerBackdrop.classList.add('active');
    };

    const closeDrawer = () => {
        dataPanel.classList.remove('open');
        if (drawerBackdrop) drawerBackdrop.classList.remove('active');
    };

    if (openDataPanelBtn) {
        openDataPanelBtn.addEventListener('click', openDrawer);
    }
    if (closeDataPanelBtn) {
        closeDataPanelBtn.addEventListener('click', closeDrawer);
    }
    if (drawerBackdrop) {
        drawerBackdrop.addEventListener('click', closeDrawer);
    }

    window.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeDrawer();
    });

    window.addEventListener('resize', () => {
        if (window.innerWidth > 980) {
            closeDrawer();
        }
    });
}

// Check if models are already saved in localStorage
function checkForSavedModels() {
    const staticLabels = localStorage.getItem(`${STORAGE_KEYS[currentLang].labels}-static`);
    const dynamicLabels = localStorage.getItem(`${STORAGE_KEYS[currentLang].labels}-dynamic`);

    if (staticLabels || dynamicLabels) {
        let modelInfo = "Saved models found: ";
        if (staticLabels) modelInfo += "Static ✋ ";
        if (dynamicLabels) modelInfo += "Dynamic 🔄";
        statusMsg.innerText = `✅ ${modelInfo}. You can use these in Live Translation!`;
        saveBtn.disabled = true; // Models already saved
    }
}

// Mode toggle setup
function setupModeToggle() {
    staticModeBtn.addEventListener('click', () => switchMode('static'));
    dynamicModeBtn.addEventListener('click', () => switchMode('dynamic'));

    startRecordBtn.addEventListener('click', startDynamicRecording);
    stopRecordBtn.addEventListener('click', stopDynamicRecording);
}

function switchMode(mode) {
    recordingMode = mode;
    testDynamicFrameBuffer = [];
    testDynamicBufferStartTime = 0;

    // Update button states
    staticModeBtn.classList.toggle('active', mode === 'static');
    dynamicModeBtn.classList.toggle('active', mode === 'dynamic');

    // Update UI visibility
    if (mode === 'static') {
        captureBtn.style.display = 'flex';
        captureHint.style.display = 'block';
        dynamicControls.style.display = 'none';
        modeDescription.textContent = 'Static: Single pose signs (A, B, Hello, etc.)';
    } else {
        captureBtn.style.display = 'none';
        captureHint.style.display = 'none';
        dynamicControls.style.display = 'block';
        modeDescription.textContent = 'Dynamic: Movement signs (Thank You, Please, Sorry, etc.)';
    }
}

function setTestResult(text) {
    if (testResult) testResult.textContent = text;
}

async function loadTestModels() {
    testStaticModel = null;
    testStaticLabels = [];
    testDynamicModel = null;
    testDynamicLabels = [];

    if (model?.static && Array.isArray(model.staticLabels) && model.staticLabels.length) {
        testStaticModel = model.static;
        testStaticLabels = model.staticLabels;
    }
    if (model?.dynamic && Array.isArray(model.dynamicLabels) && model.dynamicLabels.length) {
        testDynamicModel = model.dynamic;
        testDynamicLabels = model.dynamicLabels;
    }

    if (!testStaticModel) {
        const savedStaticLabels = localStorage.getItem(`${STORAGE_KEYS[currentLang].labels}-static`);
        if (savedStaticLabels) {
            testStaticLabels = JSON.parse(savedStaticLabels);
            try {
                testStaticModel = await tf.loadLayersModel(`localstorage://${STORAGE_KEYS[currentLang].model}-static`);
            } catch (e) {
                console.warn('Unable to load saved static model for test mode.', e);
                testStaticModel = null;
                testStaticLabels = [];
            }
        }
    }

    if (!testDynamicModel) {
        const savedDynamicLabels = localStorage.getItem(`${STORAGE_KEYS[currentLang].labels}-dynamic`);
        if (savedDynamicLabels) {
            testDynamicLabels = JSON.parse(savedDynamicLabels);
            try {
                testDynamicModel = await tf.loadLayersModel(`localstorage://${STORAGE_KEYS[currentLang].model}-dynamic`);
            } catch (e) {
                console.warn('Unable to load saved dynamic model for test mode.', e);
                testDynamicModel = null;
                testDynamicLabels = [];
            }
        }
    }
}

function runStaticTestPrediction(flatLandmarks) {
    if (!testStaticModel || !testStaticLabels.length) {
        setTestResult('No static model available for testing.');
        return;
    }

    tf.tidy(() => {
        const input = tf.tensor2d([flatLandmarks]);
        const pred = testStaticModel.predict(input);
        const conf = pred.max().dataSync()[0];
        const idx = pred.argMax(-1).dataSync()[0];
        const label = testStaticLabels[idx] || 'Unknown';
        setTestResult(`Test (Static): ${label} (${Math.round(conf * 100)}%)`);
    });
}

function runDynamicTestPrediction(flatLandmarks) {
    if (!testDynamicModel || !testDynamicLabels.length) {
        setTestResult('No dynamic model available for testing.');
        return;
    }

    if (testDynamicBufferStartTime === 0) {
        testDynamicBufferStartTime = Date.now();
    }

    testDynamicFrameBuffer.push(flatLandmarks);
    if (testDynamicFrameBuffer.length > MAX_DYNAMIC_FRAMES) {
        testDynamicFrameBuffer.shift();
    }

    const dynamicReady = (Date.now() - testDynamicBufferStartTime) >= TEST_DYNAMIC_ANALYZE_MS;
    if (!dynamicReady || testDynamicFrameBuffer.length < 1) {
        setTestResult(`Test (Dynamic): collecting frames ${testDynamicFrameBuffer.length}/${MAX_DYNAMIC_FRAMES}`);
        return;
    }

    tf.tidy(() => {
        const paddedFrames = [...testDynamicFrameBuffer];
        const lastFrame = paddedFrames[paddedFrames.length - 1];
        while (paddedFrames.length < MAX_DYNAMIC_FRAMES) {
            paddedFrames.push(lastFrame);
        }

        const input = tf.tensor3d([paddedFrames]);
        const pred = testDynamicModel.predict(input);
        const conf = pred.max().dataSync()[0];
        const idx = pred.argMax(-1).dataSync()[0];
        const label = testDynamicLabels[idx] || 'Unknown';
        setTestResult(`Test (Dynamic): ${label} (${Math.round(conf * 100)}%)`);
    });
}

async function toggleTestMode() {
    if (isTestMode) {
        isTestMode = false;
        testDynamicFrameBuffer = [];
        testDynamicBufferStartTime = 0;
        if (testBtn) {
            testBtn.innerHTML = '<span class="material-icons">science</span>Start Test Mode';
            testBtn.classList.remove('primary-btn');
            testBtn.classList.add('secondary-btn');
        }
        setTestResult('Test mode is off.');
        return;
    }

    setTestResult('Loading models for test mode...');
    await loadTestModels();

    if (!testStaticModel && !testDynamicModel) {
        setTestResult('No trained/saved model found. Train first, then test.');
        alert('No trained/saved model found for testing. Train and save first.');
        return;
    }

    isTestMode = true;
    testDynamicFrameBuffer = [];
    testDynamicBufferStartTime = 0;

    if (testBtn) {
        testBtn.innerHTML = '<span class="material-icons">stop</span>Stop Test Mode';
        testBtn.classList.remove('secondary-btn');
        testBtn.classList.add('primary-btn');
    }
    setTestResult(`Test mode active (${recordingMode}). Show a sign.`);
}

function startDynamicRecording() {
    const label = normalizeLabel(labelInput.value);
    if (!label) {
        alert("Please enter a sign name first!");
        labelInput.focus();
        return;
    }
    labelInput.value = label;

    isDynamicRecording = true;
    dynamicFrameBuffer = [];
    lastFrameCaptureTime = 0;
    dynamicRecordingMaxHands = 1;

    // Update UI
    startRecordBtn.style.display = 'none';
    stopRecordBtn.style.display = 'inline-flex';
    frameCounter.style.display = 'block';
    recordingProgress.style.display = 'block';
    recIndicator.style.display = 'flex';
    frameCount.textContent = '0';
    progressBar.style.width = '0%';

    statusMsg.textContent = 'Recording dynamic sign...';
}

function stopDynamicRecording() {
    isDynamicRecording = false;

    // Save the recorded sequence
    if (dynamicFrameBuffer.length >= 10) {
        const label = normalizeLabel(labelInput.value);
        saveDynamicSign(label, dynamicFrameBuffer);
        statusMsg.textContent = `Saved dynamic sign "${label}" with ${dynamicFrameBuffer.length} frames`;
    } else {
        statusMsg.textContent = 'Recording too short! Need at least 10 frames.';
    }

    // Reset UI
    startRecordBtn.style.display = 'inline-flex';
    stopRecordBtn.style.display = 'none';
    frameCounter.style.display = 'none';
    recordingProgress.style.display = 'none';
    recIndicator.style.display = 'none';
    dynamicFrameBuffer = [];
}

langSelect.addEventListener('change', async (e) => {
    currentLang = e.target.value;
    model = null; // Reset model context
    collectedData = []; // Clear current view
    saveBtn.disabled = false; // Re-enable to allow checking for saved models
    statusMsg.innerText = `Switched to ${currentLang}`;
    isTestMode = false;
    testDynamicFrameBuffer = [];
    testDynamicBufferStartTime = 0;
    if (testBtn) {
        testBtn.innerHTML = '<span class="material-icons">science</span>Start Test Mode';
        testBtn.classList.remove('primary-btn');
        testBtn.classList.add('secondary-btn');
    }
    setTestResult('Test mode is off.');
    await loadDataFromServer();
    checkForSavedModels(); // Check if models exist for this language
    renderDataList();
});

if (testBtn) {
    testBtn.addEventListener('click', () => {
        toggleTestMode().catch((err) => {
            console.error('Failed to toggle test mode:', err);
            setTestResult('Failed to start test mode. Check console.');
        });
    });
}

// --- MediaPipe Hands ---
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

// --- Camera ---
const camera = new Camera(videoElement, {
    onFrame: async () => {
        await hands.send({ image: videoElement });
    },
    width: 1280,
    height: 720
});

async function startCamera() {
    await camera.start();
}

// --- Logic ---
function preprocessLandmarks(landmarks) {
    const wrist = landmarks[0];
    let shifted = landmarks.map(p => ({ x: p.x - wrist.x, y: p.y - wrist.y, z: p.z - wrist.z }));
    const indexMCP = shifted[5];
    const distance = Math.sqrt(Math.pow(indexMCP.x, 2) + Math.pow(indexMCP.y, 2) + Math.pow(indexMCP.z, 2)) || 1e-6;
    return shifted.flatMap(p => [p.x / distance, p.y / distance, p.z / distance]);
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
        const detectedHands = Math.min(2, results.multiHandLandmarks.length);

        if (isCollecting && recordingMode === 'static' && isStaticPausedNoHands) {
            isStaticPausedNoHands = false;
            statusMsg.textContent = `Recording resumed: ${staticSessionSampleCount}/${MAX_STATIC_SAMPLES_PER_SESSION} samples`;
        }

        for (const landmarks of results.multiHandLandmarks) {
            drawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS, { color: '#00FF00', lineWidth: 5 });
            drawLandmarks(canvasCtx, landmarks, { color: '#FF0000', lineWidth: 2 });

            // Static mode recording
            if (isCollecting && recordingMode === 'static') {
                const label = normalizeLabel(labelInput.value);
                if (label) {
                    labelInput.value = label;
                    const flatLandmarks = preprocessLandmarks(landmarks);
                    const shouldContinue = captureStaticSample(label, flatLandmarks);
                    if (!shouldContinue) break;
                }
            }

        }

        // Dynamic mode recording: capture one frame per interval from primary hand,
        // while remembering whether this sample used one hand or two hands.
        if (isDynamicRecording && recordingMode === 'dynamic') {
            dynamicRecordingMaxHands = Math.max(dynamicRecordingMaxHands, detectedHands);

            const now = Date.now();
            const frameInterval = 1000 / TARGET_FPS;
            if (now - lastFrameCaptureTime >= frameInterval) {
                const primaryLandmarks = results.multiHandLandmarks[0];
                const flatLandmarks = preprocessLandmarks(primaryLandmarks);
                dynamicFrameBuffer.push(flatLandmarks);
                lastFrameCaptureTime = now;

                frameCount.textContent = dynamicFrameBuffer.length;
                const progress = (dynamicFrameBuffer.length / MAX_DYNAMIC_FRAMES) * 100;
                progressBar.style.width = `${Math.min(progress, 100)}%`;

                if (dynamicFrameBuffer.length >= MAX_DYNAMIC_FRAMES) {
                    stopDynamicRecording();
                }
            }
        }

        if (isTestMode) {
            const primaryLandmarks = results.multiHandLandmarks[0];
            const flatLandmarks = preprocessLandmarks(primaryLandmarks);

            if (recordingMode === 'dynamic' && testDynamicModel) {
                runDynamicTestPrediction(flatLandmarks);
            } else if (testStaticModel) {
                runStaticTestPrediction(flatLandmarks);
            } else if (testDynamicModel) {
                runDynamicTestPrediction(flatLandmarks);
            }
        }
    } else if (isCollecting && recordingMode === 'static') {
        if (!isStaticPausedNoHands) {
            isStaticPausedNoHands = true;
            statusMsg.textContent = `Paused: no hands detected (${staticSessionSampleCount}/${MAX_STATIC_SAMPLES_PER_SESSION})`;
        }
    } else if (isTestMode) {
        setTestResult('Test mode active. Show your hand to predict.');
    }

    canvasCtx.restore();
}

function saveDataPoint(label, landmarks, type = 'static') {
    const normalizedLabel = normalizeLabel(label);
    if (!normalizedLabel) return;
    collectedData.push({ label: normalizedLabel, landmarks, type, isTrained: false, recordedAt: Date.now() });
    updateUIStats();
}

function captureStaticSample(label, flatLandmarks) {
    if (!isCollecting) return false;
    if (staticSessionSampleCount >= MAX_STATIC_SAMPLES_PER_SESSION) {
        stopStaticCollection('Auto-stopped at 100 samples.');
        return false;
    }

    saveDataPoint(label, flatLandmarks, 'static');
    staticSessionSampleCount += 1;
    statusMsg.textContent = `Recording static sign: ${staticSessionSampleCount}/${MAX_STATIC_SAMPLES_PER_SESSION}`;

    if (staticSessionSampleCount >= MAX_STATIC_SAMPLES_PER_SESSION) {
        stopStaticCollection('Auto-stopped at 100 samples.');
        return false;
    }

    return true;
}

function startStaticCollection() {
    const label = normalizeLabel(labelInput.value);
    if (!label) {
        alert("Please enter a sign name first!");
        labelInput.focus();
        return;
    }
    labelInput.value = label;

    isCollecting = true;
    staticSessionSampleCount = 0;
    isStaticPausedNoHands = false;

    recIndicator.style.display = 'flex';
    captureBtn.classList.add('active');
    statusMsg.textContent = `Recording static sign: 0/${MAX_STATIC_SAMPLES_PER_SESSION}`;
}

function stopStaticCollection(reason = 'Recording stopped.') {
    if (!isCollecting) return;

    isCollecting = false;
    isStaticPausedNoHands = false;

    const recordedCount = staticSessionSampleCount;
    staticSessionSampleCount = 0;

    recIndicator.style.display = 'none';
    captureBtn.classList.remove('active');

    const suffix = recordedCount > 0 ? ` Saved ${recordedCount} samples.` : ' No new samples captured.';
    statusMsg.textContent = `${reason}${suffix}`;

    saveToServer().then(() => {
        renderDataList();
    }).catch((err) => {
        console.error('Failed to save static recording session:', err);
    });
}

async function saveDynamicSign(label, frames) {
    const normalizedLabel = normalizeLabel(label);
    if (!normalizedLabel) return;

    collectedData.push({
        label: normalizedLabel,
        type: 'dynamic',
        frames: frames,
        handCount: dynamicRecordingMaxHands,
        frameCount: frames.length,
        recordedAt: Date.now(),
        isTrained: false
    });
    updateUIStats();
    await saveToServer();
    renderDataList();
}

// --- Data Management ---
async function loadDataFromServer() {
    try {
        const res = await fetch('/api/training-data');
        if (!res.ok) throw new Error(`Server responded ${res.status}`);
        const allData = await res.json();
        const loadedData = allData[currentLang] || [];
        const normalizedData = normalizeDatasetLabels(loadedData);
        collectedData = normalizedData.normalized;

        if (normalizedData.changed) {
            // Persist one-time normalization so all future training runs are consistent.
            await saveToServer();
        }
    } catch (err) {
        console.error('Failed to load training data from server:', err);
        collectedData = [];
    }
}

async function saveToServer() {
    try {
        // Fetch the full dataset first so we don't overwrite the other language
        const res = await fetch('/api/training-data');
        const allData = res.ok ? await res.json() : { ISL: [], ASL: [] };
        allData[currentLang] = collectedData;
        await fetch('/api/training-data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(allData)
        });
    } catch (err) {
        console.error('Failed to save training data to server:', err);
    }
}

function updateUIStats() {
    totalSamplesBadge.innerText = collectedData.length;
    updateRevertButtonState();
    // Throttle rendering the list if data is huge
    if (Math.random() > 0.9) renderDataList();
}

function renderDataList() {
    const counts = {};
    const types = {};
    collectedData.forEach(d => {
        counts[d.label] = (counts[d.label] || 0) + 1;
        types[d.label] = d.type || 'static';
    });

    if (Object.keys(counts).length === 0) {
        dataList.innerHTML = `<div style="text-align: center; color: #484f58; margin-top: 50px;">No data collected.</div>`;
        return;
    }

    dataList.innerHTML = Object.entries(counts).map(([label, count]) => {
        const type = types[label];
        const typeIcon = type === 'dynamic' ? '🔄' : '✋';
        const typeLabel = type === 'dynamic' ? 'Dynamic' : 'Static';
        return `
        <div class="data-item">
            <div class="data-item-info">
                <span class="data-label">${typeIcon} ${label}</span>
                <span class="data-count">${count} samples • ${typeLabel}</span>
            </div>
            <button class="delete-btn" onclick="deleteLabel('${label}')">
                <span class="material-icons" style="font-size:18px;">delete</span>
            </button>
        </div>
    `}).join('');

    totalSamplesBadge.innerText = collectedData.length;
    updateRevertButtonState();
}

if (revertBtn) {
    revertBtn.addEventListener('click', async () => {
        const untrainedCount = getUntrainedSampleCount();
        if (untrainedCount === 0) {
            statusMsg.textContent = 'No new untrained data to revert.';
            return;
        }

        const confirmed = confirm(`Delete ${untrainedCount} newly added sample(s) that are not yet trained?`);
        if (!confirmed) return;

        collectedData = collectedData.filter(sample => sample.isTrained !== false);
        await saveToServer();
        renderDataList();
        statusMsg.textContent = `Reverted ${untrainedCount} new sample(s).`;
    });
}

window.deleteLabel = async (label) => {
    if (confirm(`Delete all samples for "${label}"?`)) {
        // Attempt to delete any associated sign card image from the server
        try {
            await fetch('/api/delete-sign-card', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    lang: currentLang,
                    label: label
                })
            });
        } catch (err) {
            console.warn(`Could not delete sign card image for ${label}:`, err);
        }

        collectedData = collectedData.filter(d => d.label !== label);
        await saveToServer();
        renderDataList();
    }
};

clearAllBtn.addEventListener('click', async () => {
    if (confirm("Delete ALL collected data? This cannot be undone.")) {
        collectedData = [];
        await saveToServer();
        renderDataList();
    }
});

// --- Capture Controls ---
captureBtn.addEventListener('click', () => {
    if (recordingMode !== 'static') return;
    if (isCollecting) {
        stopStaticCollection('Recording stopped.');
    } else {
        startStaticCollection();
    }
});

// --- Training Logic ---
const DUMMY_LABEL_PREFIX = '__internal_dummy__';
const STATIC_REHEARSAL_PER_LABEL = 20;
const DYNAMIC_REHEARSAL_PER_LABEL = 8;

function isStaticSample(sample) {
    return sample.type === 'static' || !sample.type;
}

function isDynamicSample(sample) {
    return sample.type === 'dynamic';
}

function getUniqueLabels(samples) {
    return [...new Set(samples.map(s => s.label))];
}

function shuffleArray(arr) {
    const out = [...arr];
    for (let i = out.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

function getRehearsalSamplesPerLabel(samples, perLabelLimit) {
    const buckets = {};
    samples.forEach((sample) => {
        if (!buckets[sample.label]) buckets[sample.label] = [];
        buckets[sample.label].push(sample);
    });

    const rehearsal = [];
    Object.keys(buckets).forEach((label) => {
        const shuffled = shuffleArray(buckets[label]);
        rehearsal.push(...shuffled.slice(0, perLabelLimit));
    });

    return rehearsal;
}

function withDummyClassIfNeeded(samples, labels) {
    if (labels.length >= 2) {
        return { trainingData: samples, trainingLabels: labels };
    }

    const dummyLabel = `${DUMMY_LABEL_PREFIX}_${labels[0]}`;
    const dummyCount = Math.max(1, Math.ceil(samples.length * 0.2));
    const dummySamples = samples.slice(0, dummyCount).map((sample) => ({
        ...sample,
        label: dummyLabel
    }));

    return {
        trainingData: [...samples, ...dummySamples],
        trainingLabels: [labels[0], dummyLabel]
    };
}

function toPublicLabels(labels) {
    return labels.filter(l => !l.startsWith(DUMMY_LABEL_PREFIX));
}

function normalizeLegacySamplesAsTrained(hasStaticModel, hasDynamicModel) {
    let changed = false;
    collectedData.forEach((sample) => {
        if (sample.isTrained !== undefined) return;
        if (hasStaticModel && isStaticSample(sample)) {
            sample.isTrained = true;
            changed = true;
        }
        if (hasDynamicModel && isDynamicSample(sample)) {
            sample.isTrained = true;
            changed = true;
        }
    });
    return changed;
}

async function ensureTrainingModelsLoaded() {
    if (!model) model = {};

    if (!model.static) {
        const savedStaticLabels = localStorage.getItem(`${STORAGE_KEYS[currentLang].labels}-static`);
        if (savedStaticLabels) {
            try {
                model.static = await tf.loadLayersModel(`localstorage://${STORAGE_KEYS[currentLang].model}-static`);
                model.staticLabels = JSON.parse(savedStaticLabels);
                ensureModelCompiled(model.static, 'static model');
            } catch (err) {
                console.warn('Unable to load saved static model for incremental training:', err);
            }
        }
    }

    if (!model.dynamic) {
        const savedDynamicLabels = localStorage.getItem(`${STORAGE_KEYS[currentLang].labels}-dynamic`);
        if (savedDynamicLabels) {
            try {
                model.dynamic = await tf.loadLayersModel(`localstorage://${STORAGE_KEYS[currentLang].model}-dynamic`);
                model.dynamicLabels = JSON.parse(savedDynamicLabels);
                const handReqRaw = localStorage.getItem(`${STORAGE_KEYS[currentLang].labels}-dynamic-hand-req`);
                model.dynamicHandRequirements = handReqRaw ? JSON.parse(handReqRaw) : {};
                ensureModelCompiled(model.dynamic, 'dynamic model');
            } catch (err) {
                console.warn('Unable to load saved dynamic model for incremental training:', err);
            }
        }
    }
}

function createStaticModel(outputUnits) {
    const staticModel = tf.sequential();
    staticModel.add(tf.layers.dense({ units: 64, activation: 'relu', inputShape: [63] }));
    staticModel.add(tf.layers.dropout({ rate: 0.2 }));
    staticModel.add(tf.layers.dense({ units: 32, activation: 'relu' }));
    staticModel.add(tf.layers.dense({ units: outputUnits, activation: 'softmax' }));
    staticModel.compile({ optimizer: 'adam', loss: 'categoricalCrossentropy', metrics: ['accuracy'] });
    return staticModel;
}

function createDynamicModel(outputUnits) {
    const dynamicModel = tf.sequential();
    dynamicModel.add(tf.layers.lstm({
        units: 64,
        returnSequences: true,
        inputShape: [MAX_DYNAMIC_FRAMES, 63],
        kernelInitializer: 'glorotUniform',
        recurrentInitializer: 'glorotUniform'
    }));
    dynamicModel.add(tf.layers.dropout({ rate: 0.2 }));
    dynamicModel.add(tf.layers.lstm({
        units: 32,
        returnSequences: false,
        kernelInitializer: 'glorotUniform',
        recurrentInitializer: 'glorotUniform'
    }));
    dynamicModel.add(tf.layers.dense({ units: outputUnits, activation: 'softmax' }));
    dynamicModel.compile({ optimizer: 'adam', loss: 'categoricalCrossentropy', metrics: ['accuracy'] });
    return dynamicModel;
}

function ensureModelCompiled(modelInstance, modelType = 'model') {
    if (!modelInstance) return;
    if (modelInstance.optimizer) return;

    modelInstance.compile({
        optimizer: 'adam',
        loss: 'categoricalCrossentropy',
        metrics: ['accuracy']
    });
    console.log(`Recompiled ${modelType} for incremental training.`);
}

function computeDynamicHandRequirements(trainingData, labels) {
    const handRequirementMap = {};
    labels.forEach((label) => {
        if (label.startsWith(DUMMY_LABEL_PREFIX)) {
            handRequirementMap[label] = 'any';
            return;
        }

        const labelSamples = trainingData.filter(d => d.label === label);
        const observed = new Set(
            labelSamples
                .map(d => {
                    const raw = Number(d.handCount ?? d.requiredHands);
                    return raw === 2 ? 2 : (raw === 1 ? 1 : null);
                })
                .filter(v => v !== null)
        );

        handRequirementMap[label] = observed.size === 1 ? [...observed][0] : 'any';
    });

    return handRequirementMap;
}

function getMetricAccuracy(logs) {
    return (logs?.acc ?? logs?.accuracy ?? 0).toFixed(3);
}

trainBtn.addEventListener('click', async () => {
    statusMsg.innerText = "Preparing data...";
    trainBtn.disabled = true;
    saveBtn.disabled = true;

    try {
        await ensureTrainingModelsLoaded();

        const staticData = collectedData.filter(isStaticSample);
        const dynamicData = collectedData.filter(isDynamicSample);

        const legacyFlagsChanged = normalizeLegacySamplesAsTrained(Boolean(model?.static), Boolean(model?.dynamic));

        const newStaticData = staticData.filter(d => d.isTrained === false);
        const newDynamicData = dynamicData.filter(d => d.isTrained === false);

        if (!model.static && !model.dynamic && (staticData.length + dynamicData.length) < 10) {
            alert("Collect more data (min 10 samples)!");
            trainBtn.disabled = false;
            saveBtn.disabled = false;
            return;
        }

        if (newStaticData.length === 0 && newDynamicData.length === 0 && (model.static || model.dynamic)) {
            statusMsg.innerText = "No new samples found. Add new recordings, then train.";
            trainBtn.disabled = false;
            saveBtn.disabled = false;
            if (legacyFlagsChanged) await saveToServer();
            return;
        }

        let trainedAnything = false;
        let flagsChanged = legacyFlagsChanged;

        if (newStaticData.length > 0 || (!model.static && staticData.length >= 5)) {
            await new Promise(resolve => setTimeout(resolve, 100));
            const staticResult = await trainStaticModel(staticData, newStaticData);
            if (staticResult.trained) {
                newStaticData.forEach((sample) => {
                    sample.isTrained = true;
                    sample.trainedAt = Date.now();
                });
                flagsChanged = true;
                trainedAnything = true;
            }
        }

        if (newDynamicData.length > 0 || (!model.dynamic && dynamicData.length >= 5)) {
            await new Promise(resolve => setTimeout(resolve, 100));
            const dynamicResult = await trainDynamicModel(dynamicData, newDynamicData);
            if (dynamicResult.trained) {
                newDynamicData.forEach((sample) => {
                    sample.isTrained = true;
                    sample.trainedAt = Date.now();
                });
                flagsChanged = true;
                trainedAnything = true;
            }
        }

        if (!trainedAnything) {
            throw new Error("Not enough new static/dynamic samples to train. Need at least 5 samples for a model type.");
        }

        if (flagsChanged) await saveToServer();

        const modelTypes = [];
        if (model.static) modelTypes.push("Static ✋");
        if (model.dynamic) modelTypes.push("Dynamic 🔄");

        statusMsg.innerText = `✅ Incremental training complete! (${modelTypes.join(', ')}) - Click 'Save to Application' to use your updated models.`;
        trainBtn.disabled = false;
        saveBtn.disabled = false;
    } catch (error) {
        console.error("Training error:", error);
        statusMsg.innerText = `❌ Training failed: ${error.message}`;
        trainBtn.disabled = false;
        saveBtn.disabled = true;
        alert(`Training failed: ${error.message}\n\nCheck browser console for more details.`);
    }
});

async function trainStaticModel(staticData, newStaticData) {
    const hasExistingModel = Boolean(model?.static);
    const existingLabels = model?.staticLabels || [];

    if (!hasExistingModel) {
        if (staticData.length < 5) return { trained: false };

        let baseLabels = getUniqueLabels(staticData);
        const prepared = withDummyClassIfNeeded(staticData, baseLabels);
        const trainingData = prepared.trainingData;
        const trainingLabels = prepared.trainingLabels;
        const labelMap = {};
        trainingLabels.forEach((label, index) => { labelMap[label] = index; });

        statusMsg.innerText = "🔄 Training static model from base dataset...";

        const xs = tf.tensor2d(trainingData.map(d => d.landmarks));
        const ys = tf.oneHot(tf.tensor1d(trainingData.map(d => labelMap[d.label]), 'int32'), trainingLabels.length);
        const staticModel = createStaticModel(trainingLabels.length);

        try {
            await staticModel.fit(xs, ys, {
                epochs: 30,
                batchSize: 16,
                shuffle: true,
                verbose: 1,
                callbacks: {
                    onEpochEnd: async (epoch, logs) => {
                        statusMsg.innerText = `🔄 Static Model: Epoch ${epoch + 1}/30 | Loss: ${logs.loss.toFixed(4)} | Acc: ${getMetricAccuracy(logs)}`;
                        if (epoch % 5 === 0) await tf.nextFrame();
                    }
                }
            });
            model.static = staticModel;
            model.staticLabels = toPublicLabels(trainingLabels);
            return { trained: true };
        } finally {
            xs.dispose();
            ys.dispose();
        }
    }

    if (newStaticData.length === 0) return { trained: false };

    const newLabels = getUniqueLabels(newStaticData);
    const unseenLabels = newLabels.filter(label => !existingLabels.includes(label));

    if (unseenLabels.length === 0) {
        ensureModelCompiled(model.static, 'static model');

        const outputUnits = model.static.layers[model.static.layers.length - 1].units;
        const internalLabels = [...existingLabels];
        while (internalLabels.length < outputUnits) {
            internalLabels.push(`${DUMMY_LABEL_PREFIX}_static_${internalLabels.length}`);
        }

        const labelMap = {};
        internalLabels.forEach((label, index) => { labelMap[label] = index; });

        statusMsg.innerText = `🔄 Incremental static training on ${newStaticData.length} new samples...`;

        const xs = tf.tensor2d(newStaticData.map(d => d.landmarks));
        const ys = tf.oneHot(tf.tensor1d(newStaticData.map(d => labelMap[d.label]), 'int32'), internalLabels.length);

        try {
            await model.static.fit(xs, ys, {
                epochs: 12,
                batchSize: 16,
                shuffle: true,
                verbose: 1,
                callbacks: {
                    onEpochEnd: async (epoch, logs) => {
                        statusMsg.innerText = `🔄 Static Incremental: Epoch ${epoch + 1}/12 | Loss: ${logs.loss.toFixed(4)} | Acc: ${getMetricAccuracy(logs)}`;
                        if (epoch % 4 === 0) await tf.nextFrame();
                    }
                }
            });
            return { trained: true };
        } finally {
            xs.dispose();
            ys.dispose();
        }
    }

    const rehearsalPool = staticData.filter(d => d.isTrained === true && existingLabels.includes(d.label));
    const rehearsalSamples = getRehearsalSamplesPerLabel(rehearsalPool, STATIC_REHEARSAL_PER_LABEL);
    const rebuildData = [...rehearsalSamples, ...newStaticData];
    let rebuildLabels = getUniqueLabels(rebuildData);

    if (rebuildData.length < 5) {
        throw new Error("Need at least 5 static samples for new-label update.");
    }

    const prepared = withDummyClassIfNeeded(rebuildData, rebuildLabels);
    const trainingData = prepared.trainingData;
    const trainingLabels = prepared.trainingLabels;
    const labelMap = {};
    trainingLabels.forEach((label, index) => { labelMap[label] = index; });

    statusMsg.innerText = `🔄 New static labels detected (${unseenLabels.join(', ')}). Rebuilding static model with rehearsal data...`;

    const xs = tf.tensor2d(trainingData.map(d => d.landmarks));
    const ys = tf.oneHot(tf.tensor1d(trainingData.map(d => labelMap[d.label]), 'int32'), trainingLabels.length);
    const rebuiltStaticModel = createStaticModel(trainingLabels.length);

    try {
        await rebuiltStaticModel.fit(xs, ys, {
            epochs: 25,
            batchSize: 16,
            shuffle: true,
            verbose: 1,
            callbacks: {
                onEpochEnd: async (epoch, logs) => {
                    statusMsg.innerText = `🔄 Static Rebuild: Epoch ${epoch + 1}/25 | Loss: ${logs.loss.toFixed(4)} | Acc: ${getMetricAccuracy(logs)}`;
                    if (epoch % 5 === 0) await tf.nextFrame();
                }
            }
        });
        model.static = rebuiltStaticModel;
        model.staticLabels = toPublicLabels(trainingLabels);
        return { trained: true };
    } finally {
        xs.dispose();
        ys.dispose();
    }
}

async function trainDynamicModel(dynamicData, newDynamicData) {
    const hasExistingModel = Boolean(model?.dynamic);
    const existingLabels = model?.dynamicLabels || [];

    if (!hasExistingModel) {
        if (dynamicData.length < 5) return { trained: false };

        let baseLabels = getUniqueLabels(dynamicData);
        const prepared = withDummyClassIfNeeded(dynamicData, baseLabels);
        const trainingData = prepared.trainingData;
        const trainingLabels = prepared.trainingLabels;
        const labelMap = {};
        trainingLabels.forEach((label, index) => { labelMap[label] = index; });

        const handRequirementMap = computeDynamicHandRequirements(trainingData, trainingLabels);

        const paddedSequences = trainingData.map(d => {
            const frames = d.frames || [];
            if (frames.length < MAX_DYNAMIC_FRAMES) {
                const lastFrame = frames[frames.length - 1] || new Array(63).fill(0);
                return [...frames, ...Array(MAX_DYNAMIC_FRAMES - frames.length).fill(lastFrame)];
            }
            return frames.slice(0, MAX_DYNAMIC_FRAMES);
        });

        statusMsg.innerText = "🔄 Training dynamic model from base dataset...";

        const xs = tf.tensor3d(paddedSequences);
        const ys = tf.oneHot(tf.tensor1d(trainingData.map(d => labelMap[d.label]), 'int32'), trainingLabels.length);
        const dynamicModel = createDynamicModel(trainingLabels.length);

        try {
            await dynamicModel.fit(xs, ys, {
                epochs: 20,
                batchSize: 8,
                shuffle: true,
                verbose: 1,
                callbacks: {
                    onEpochEnd: async (epoch, logs) => {
                        statusMsg.innerText = `🔄 Dynamic Model: Epoch ${epoch + 1}/20 | Loss: ${logs.loss.toFixed(4)} | Acc: ${getMetricAccuracy(logs)}`;
                        if (epoch % 5 === 0) await tf.nextFrame();
                    }
                }
            });
            model.dynamic = dynamicModel;
            model.dynamicLabels = toPublicLabels(trainingLabels);
            model.dynamicHandRequirements = Object.fromEntries(
                Object.entries(handRequirementMap).filter(([label]) => !label.startsWith(DUMMY_LABEL_PREFIX))
            );
            return { trained: true };
        } finally {
            xs.dispose();
            ys.dispose();
        }
    }

    if (newDynamicData.length === 0) return { trained: false };

    const newLabels = getUniqueLabels(newDynamicData);
    const unseenLabels = newLabels.filter(label => !existingLabels.includes(label));

    if (unseenLabels.length === 0) {
        ensureModelCompiled(model.dynamic, 'dynamic model');

        const outputUnits = model.dynamic.layers[model.dynamic.layers.length - 1].units;
        const internalLabels = [...existingLabels];
        while (internalLabels.length < outputUnits) {
            internalLabels.push(`${DUMMY_LABEL_PREFIX}_dynamic_${internalLabels.length}`);
        }

        const labelMap = {};
        internalLabels.forEach((label, index) => { labelMap[label] = index; });

        const paddedSequences = newDynamicData.map(d => {
            const frames = d.frames || [];
            if (frames.length < MAX_DYNAMIC_FRAMES) {
                const lastFrame = frames[frames.length - 1] || new Array(63).fill(0);
                return [...frames, ...Array(MAX_DYNAMIC_FRAMES - frames.length).fill(lastFrame)];
            }
            return frames.slice(0, MAX_DYNAMIC_FRAMES);
        });

        statusMsg.innerText = `🔄 Incremental dynamic training on ${newDynamicData.length} new samples...`;

        const xs = tf.tensor3d(paddedSequences);
        const ys = tf.oneHot(tf.tensor1d(newDynamicData.map(d => labelMap[d.label]), 'int32'), internalLabels.length);

        try {
            await model.dynamic.fit(xs, ys, {
                epochs: 10,
                batchSize: 8,
                shuffle: true,
                verbose: 1,
                callbacks: {
                    onEpochEnd: async (epoch, logs) => {
                        statusMsg.innerText = `🔄 Dynamic Incremental: Epoch ${epoch + 1}/10 | Loss: ${logs.loss.toFixed(4)} | Acc: ${getMetricAccuracy(logs)}`;
                        if (epoch % 3 === 0) await tf.nextFrame();
                    }
                }
            });

            const handReqFromNew = computeDynamicHandRequirements(newDynamicData, existingLabels);
            model.dynamicHandRequirements = {
                ...(model.dynamicHandRequirements || {}),
                ...Object.fromEntries(
                    Object.entries(handReqFromNew).filter(([label]) => !label.startsWith(DUMMY_LABEL_PREFIX))
                )
            };
            return { trained: true };
        } finally {
            xs.dispose();
            ys.dispose();
        }
    }

    const rehearsalPool = dynamicData.filter(d => d.isTrained === true && existingLabels.includes(d.label));
    const rehearsalSamples = getRehearsalSamplesPerLabel(rehearsalPool, DYNAMIC_REHEARSAL_PER_LABEL);
    const rebuildData = [...rehearsalSamples, ...newDynamicData];

    if (rebuildData.length < 5) {
        throw new Error("Need at least 5 dynamic samples for new-label update.");
    }

    let rebuildLabels = getUniqueLabels(rebuildData);
    const prepared = withDummyClassIfNeeded(rebuildData, rebuildLabels);
    const trainingData = prepared.trainingData;
    const trainingLabels = prepared.trainingLabels;
    const labelMap = {};
    trainingLabels.forEach((label, index) => { labelMap[label] = index; });

    const handRequirementMap = computeDynamicHandRequirements(trainingData, trainingLabels);

    const paddedSequences = trainingData.map(d => {
        const frames = d.frames || [];
        if (frames.length < MAX_DYNAMIC_FRAMES) {
            const lastFrame = frames[frames.length - 1] || new Array(63).fill(0);
            return [...frames, ...Array(MAX_DYNAMIC_FRAMES - frames.length).fill(lastFrame)];
        }
        return frames.slice(0, MAX_DYNAMIC_FRAMES);
    });

    statusMsg.innerText = `🔄 New dynamic labels detected (${unseenLabels.join(', ')}). Rebuilding dynamic model with rehearsal data...`;

    const xs = tf.tensor3d(paddedSequences);
    const ys = tf.oneHot(tf.tensor1d(trainingData.map(d => labelMap[d.label]), 'int32'), trainingLabels.length);
    const rebuiltDynamicModel = createDynamicModel(trainingLabels.length);

    try {
        await rebuiltDynamicModel.fit(xs, ys, {
            epochs: 16,
            batchSize: 8,
            shuffle: true,
            verbose: 1,
            callbacks: {
                onEpochEnd: async (epoch, logs) => {
                    statusMsg.innerText = `🔄 Dynamic Rebuild: Epoch ${epoch + 1}/16 | Loss: ${logs.loss.toFixed(4)} | Acc: ${getMetricAccuracy(logs)}`;
                    if (epoch % 4 === 0) await tf.nextFrame();
                }
            }
        });

        model.dynamic = rebuiltDynamicModel;
        model.dynamicLabels = toPublicLabels(trainingLabels);
        model.dynamicHandRequirements = Object.fromEntries(
            Object.entries(handRequirementMap).filter(([label]) => !label.startsWith(DUMMY_LABEL_PREFIX))
        );
        return { trained: true };
    } finally {
        xs.dispose();
        ys.dispose();
    }
}

saveBtn.addEventListener('click', async () => {
    // First, check if we have a trained model in memory
    if (!model || (!model.static && !model.dynamic)) {
        // If not, check if models are already saved in localStorage
        const staticLabels = localStorage.getItem(`${STORAGE_KEYS[currentLang].labels}-static`);
        const dynamicLabels = localStorage.getItem(`${STORAGE_KEYS[currentLang].labels}-dynamic`);

        if (staticLabels || dynamicLabels) {
            statusMsg.innerText = `✅ Models already saved! Ready to use in Live Translation.`;
            alert(`✅ Models are already saved!\n\nStatic: ${staticLabels ? '✓' : '✗'}\nDynamic: ${dynamicLabels ? '✓' : '✗'}\n\nYou can use them in Live Translation now.`);
            return;
        }

        alert("❌ No trained model found! Please train first.");
        return;
    }

    saveBtn.disabled = true;
    statusMsg.innerText = "💾 Saving models to browser storage...";

    try {
        let saved = false;

        // Save Static Model
        if (model.static && model.staticLabels) {
            await model.static.save(`localstorage://${STORAGE_KEYS[currentLang].model}-static`);
            localStorage.setItem(`${STORAGE_KEYS[currentLang].labels}-static`, JSON.stringify(model.staticLabels));
            console.log('✅ Static model saved');
            saved = true;
        }

        // Save Dynamic Model
        if (model.dynamic && model.dynamicLabels) {
            await model.dynamic.save(`localstorage://${STORAGE_KEYS[currentLang].model}-dynamic`);
            localStorage.setItem(`${STORAGE_KEYS[currentLang].labels}-dynamic`, JSON.stringify(model.dynamicLabels));
            localStorage.setItem(
                `${STORAGE_KEYS[currentLang].labels}-dynamic-hand-req`,
                JSON.stringify(model.dynamicHandRequirements || {})
            );
            console.log('✅ Dynamic model saved');
            saved = true;
        }

        if (saved) {
            statusMsg.innerText = `✅ Model(s) saved! Ready for use in Live Translation.`;
            alert(`✅ Model(s) saved to ${currentLang} slot!\n\nYou can now use them in Live Translation and Video Call.`);
        } else {
            statusMsg.innerText = "❌ Nothing to save. Train a model first.";
            alert("❌ No trained model components found. Please train first.");
        }
    } catch (error) {
        console.error('Save error:', error);
        statusMsg.innerText = `❌ Save failed: ${error.message}`;
        alert(`❌ Failed to save model: ${error.message}\n\nCheck browser console for details.`);
    } finally {
        saveBtn.disabled = false;
    }
});

// --- External Import ---
uploadBtn.addEventListener('click', () => uploadInput.click());

uploadInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
        try {
            const imported = JSON.parse(evt.target.result);
            if (Array.isArray(imported)) {
                // Validate both static and dynamic formats
                const valid = imported.every(d => {
                    if (!normalizeLabel(d.label)) return false;
                    if (d.type === 'dynamic') {
                        return d.frames && Array.isArray(d.frames) && d.frames.length > 0;
                    } else {
                        return d.landmarks && d.landmarks.length === 63;
                    }
                });

                if (valid) {
                    const normalizedImported = imported.map((sample) => ({
                        ...sample,
                        label: normalizeLabel(sample.label),
                        type: sample.type || 'static',
                        isTrained: false,
                        recordedAt: sample.recordedAt || Date.now()
                    }));
                    collectedData = collectedData.concat(normalizedImported);
                    await saveToServer();
                    renderDataList();
                    alert(`Imported ${normalizedImported.length} samples successfully.`);
                } else {
                    alert("Invalid data format. Expected array with 'label' and either 'landmarks' (static) or 'frames' (dynamic).");
                }
            }
        } catch (err) {
            console.error(err);
            alert("Failed to parse file. Make sure it is valid JSON.");
        }
    };
    reader.readAsText(file);
});

// --- Sign Card Upload ---
if (signCardBtn && signCardInput) {
    signCardBtn.addEventListener('click', () => {
        const label = normalizeLabel(labelInput.value);
        if (!label) {
            alert("Please enter a Sign Name first before uploading its card.");
            labelInput.focus();
            return;
        }
        labelInput.value = label;
        signCardInput.click();
    });

    if (clearSignDetailsBtn) {
        clearSignDetailsBtn.addEventListener('click', async () => {
            const label = normalizeLabel(labelInput.value);
            if (label) {
                // Attempt to delete any associated sign card image from the server
                try {
                    await fetch('/api/delete-sign-card', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            lang: currentLang,
                            label: label
                        })
                    });
                } catch (err) {
                    console.warn(`Could not delete sign card image on clear for ${label}:`, err);
                }
            }

            labelInput.value = '';
            signCardInput.value = '';
            signCardStatus.textContent = '';

            if (signCardFileName) {
                signCardFileName.textContent = '';
                signCardFileName.style.display = 'none';
            }
        });
    }

    signCardInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const label = normalizeLabel(labelInput.value);
        if (!label) {
            alert("Sign name is missing.");
            return;
        }
        labelInput.value = label;

        // Display selected filename
        if (signCardFileName) {
            signCardFileName.textContent = `Selected: ${file.name}`;
            signCardFileName.style.display = 'block';
        }

        // Get extension from filename
        const filenameParts = file.name.split('.');
        if (filenameParts.length < 2) {
            alert("File must have a valid image extension (.jpg, .png, .gif, .webp)");
            return;
        }
        const extension = filenameParts.pop().toLowerCase();

        // Allowed extensions
        if (!['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(extension)) {
            alert("Invalid format. Please upload JPG, PNG, GIF, or WEBP.");
            return;
        }

        signCardStatus.textContent = `Uploading ${file.name}...`;
        signCardStatus.style.color = '#58a6ff'; // Blue loading state

        const reader = new FileReader();
        reader.onload = async (evt) => {
            const base64Data = evt.target.result;

            try {
                const res = await fetch('/api/upload-sign-card', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        lang: currentLang,
                        label: label,
                        imageBase64: base64Data,
                        extension: extension
                    })
                });

                const data = await res.json();
                if (res.ok && data.success) {
                    signCardStatus.textContent = `✅ Uploaded successfully!`;
                    signCardStatus.style.color = '#2ea043'; // Green success state
                    setTimeout(() => {
                        signCardStatus.textContent = ''; // Clear status after a while
                    }, 5000);
                } else {
                    throw new Error(data.error || 'Failed to finish upload');
                }
            } catch (err) {
                console.error("Card upload error:", err);
                signCardStatus.textContent = `❌ Upload failed`;
                signCardStatus.style.color = '#da3633'; // Red error state
                alert("Could not upload sign card. Make sure server is running.");
            }
        };
        reader.readAsDataURL(file);

        // Reset input to allow selecting same file again if it failed
        e.target.value = '';
    });
}

labelInput.addEventListener('blur', () => {
    const normalized = normalizeLabel(labelInput.value);
    if (normalized) {
        labelInput.value = normalized;
    }
});

// Start
init();
