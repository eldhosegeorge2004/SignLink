
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
const clearAllBtn = document.getElementById('clearAllBtn');

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

// Dynamic recording state
let isDynamicRecording = false;
let dynamicFrameBuffer = [];
const MAX_DYNAMIC_FRAMES = 30;
const TARGET_FPS = 10; // Capture ~10 frames per second
let lastFrameCaptureTime = 0;

// Storage Keys
const STORAGE_KEYS = {
    'ISL': { model: 'my-isl-model', labels: 'isl_labels', data: 'isl_data' },
    'ASL': { model: 'my-asl-model', labels: 'asl_labels', data: 'asl_data' }
};

// --- Initialization ---
function init() {
    startCamera();
    loadDataFromStorage();
    checkForSavedModels(); // Check if models already exist in localStorage
    renderDataList();
    setupModeToggle();
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

function startDynamicRecording() {
    const label = labelInput.value.trim();
    if (!label) {
        alert("Please enter a sign name first!");
        labelInput.focus();
        return;
    }
    
    isDynamicRecording = true;
    dynamicFrameBuffer = [];
    lastFrameCaptureTime = 0;
    
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
        const label = labelInput.value.trim();
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

langSelect.addEventListener('change', (e) => {
    currentLang = e.target.value;
    model = null; // Reset model context
    collectedData = []; // Clear current view
    saveBtn.disabled = false; // Re-enable to allow checking for saved models
    statusMsg.innerText = `Switched to ${currentLang}`;
    loadDataFromStorage();
    checkForSavedModels(); // Check if models exist for this language
    renderDataList();
});

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

    if (results.multiHandLandmarks) {
        for (const landmarks of results.multiHandLandmarks) {
            drawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS, { color: '#00FF00', lineWidth: 5 });
            drawLandmarks(canvasCtx, landmarks, { color: '#FF0000', lineWidth: 2 });

            // Static mode recording
            if (isCollecting && recordingMode === 'static') {
                const label = labelInput.value.trim();
                if (label) {
                    const flatLandmarks = preprocessLandmarks(landmarks);
                    saveDataPoint(label, flatLandmarks, 'static');
                }
            }
            
            // Dynamic mode recording
            if (isDynamicRecording && recordingMode === 'dynamic') {
                const now = Date.now();
                const frameInterval = 1000 / TARGET_FPS;
                
                if (now - lastFrameCaptureTime >= frameInterval) {
                    const flatLandmarks = preprocessLandmarks(landmarks);
                    dynamicFrameBuffer.push(flatLandmarks);
                    lastFrameCaptureTime = now;
                    
                    // Update UI
                    frameCount.textContent = dynamicFrameBuffer.length;
                    const progress = (dynamicFrameBuffer.length / MAX_DYNAMIC_FRAMES) * 100;
                    progressBar.style.width = `${Math.min(progress, 100)}%`;
                    
                    // Auto-stop at max frames
                    if (dynamicFrameBuffer.length >= MAX_DYNAMIC_FRAMES) {
                        stopDynamicRecording();
                    }
                }
            }
        }
    }

    canvasCtx.restore();
}

function saveDataPoint(label, landmarks, type = 'static') {
    collectedData.push({ label, landmarks, type });
    updateUIStats();
}

function saveDynamicSign(label, frames) {
    collectedData.push({ 
        label, 
        type: 'dynamic', 
        frames: frames,
        frameCount: frames.length,
        recordedAt: Date.now()
    });
    updateUIStats();
    saveToLocalStorage();
    renderDataList();
}

// --- Data Management ---
function loadDataFromStorage() {
    // We are implementing a simplified localstorage persistence for DATA
    // Note: Live Translation usually only reads the MODEL and LABELS.
    // Ideally we should store the raw data too so users can resume training.
    const raw = localStorage.getItem(STORAGE_KEYS[currentLang].data);
    if (raw) {
        collectedData = JSON.parse(raw);
    }
}

function saveToLocalStorage() {
    localStorage.setItem(STORAGE_KEYS[currentLang].data, JSON.stringify(collectedData));
}

function updateUIStats() {
    totalSamplesBadge.innerText = collectedData.length;
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
}

window.deleteLabel = (label) => {
    if (confirm(`Delete all samples for "${label}"?`)) {
        collectedData = collectedData.filter(d => d.label !== label);
        saveToLocalStorage();
        renderDataList();
    }
};

clearAllBtn.addEventListener('click', () => {
    if (confirm("Delete ALL collected data? This cannot be undone.")) {
        collectedData = [];
        saveToLocalStorage();
        renderDataList();
    }
});

// --- Capture Controls ---
captureBtn.addEventListener('mousedown', () => {
    if (!labelInput.value.trim()) {
        alert("Please enter a sign name first!");
        labelInput.focus();
        return;
    }
    isCollecting = true;
    recIndicator.style.display = 'flex';
    captureBtn.classList.add('active');
});

['mouseup', 'mouseleave'].forEach(evt => {
    captureBtn.addEventListener(evt, () => {
        isCollecting = false;
        recIndicator.style.display = 'none';
        captureBtn.classList.remove('active');
        saveToLocalStorage(); // Auto-save on release
        renderDataList();
    });
});

// --- Training Logic ---
trainBtn.addEventListener('click', async () => {
    if (collectedData.length < 10) return alert("Collect more data (min 10 samples)!");

    // Separate static and dynamic data
    const staticData = collectedData.filter(d => d.type === 'static' || !d.type);
    const dynamicData = collectedData.filter(d => d.type === 'dynamic');

    statusMsg.innerText = "Preparing data...";
    trainBtn.disabled = true;
    saveBtn.disabled = true;
    model = null; // Reset model to ensure clean state

    try {
        // Train Static Model
        if (staticData.length >= 5) {
            await new Promise(resolve => setTimeout(resolve, 100)); // Allow UI refresh
            await trainStaticModel(staticData);
            console.log('After static training, model:', model);
            await new Promise(resolve => setTimeout(resolve, 100)); // Allow UI refresh
        }

        // Train Dynamic Model
        if (dynamicData.length >= 5) {
            await new Promise(resolve => setTimeout(resolve, 100)); // Allow UI refresh
            await trainDynamicModel(dynamicData);
            console.log('After dynamic training, model:', model);
            await new Promise(resolve => setTimeout(resolve, 100)); // Allow UI refresh
        }

        if (staticData.length < 5 && dynamicData.length < 5) {
            alert("Need at least 5 samples of either static or dynamic signs!");
            trainBtn.disabled = false;
            return;
        }

        // Verify model was created
        if (!model || (!model.static && !model.dynamic)) {
            throw new Error("Model was not properly created during training. Please try again.");
        }

        const modelTypes = [];
        if (model.static) modelTypes.push("Static ✋");
        if (model.dynamic) modelTypes.push("Dynamic 🔄");
        
        statusMsg.innerText = `✅ Training Complete! (${modelTypes.join(', ')}) - Click 'Save to Application' to use your models.`;
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

async function trainStaticModel(staticData) {
    console.log(`trainStaticModel called with ${staticData.length} samples`);
    const uniqueLabels = [...new Set(staticData.map(d => d.label))];
    console.log(`Unique static labels: ${uniqueLabels.join(', ')}`);
    
    if (uniqueLabels.length < 2) {
        const msg = `❌ Need at least 2 different static signs. You have: ${uniqueLabels.join(', ')}`;
        statusMsg.innerText = msg;
        console.warn(msg);
        throw new Error(`Only ${uniqueLabels.length} unique static sign(s). Need at least 2 different signs with different names.`);
    }

    statusMsg.innerText = "🔄 Training static model (this may take 1-2 minutes)...";
    console.log(`Starting static training with ${staticData.length} samples, ${uniqueLabels.length} classes`);

    const labelMap = {};
    uniqueLabels.forEach((l, i) => labelMap[l] = i);

    const xs = tf.tensor2d(staticData.map(d => d.landmarks));
    const ys = tf.oneHot(tf.tensor1d(staticData.map(d => labelMap[d.label]), 'int32'), uniqueLabels.length);

    const staticModel = tf.sequential();
    staticModel.add(tf.layers.dense({ units: 64, activation: 'relu', inputShape: [63] }));
    staticModel.add(tf.layers.dropout({ rate: 0.2 }));
    staticModel.add(tf.layers.dense({ units: 32, activation: 'relu' }));
    staticModel.add(tf.layers.dense({ units: uniqueLabels.length, activation: 'softmax' }));

    staticModel.compile({ optimizer: 'adam', loss: 'categoricalCrossentropy', metrics: ['accuracy'] });

    try {
        console.log('Starting fit...');
        
        // Allow UI to update before starting training
        await new Promise(resolve => setTimeout(resolve, 100));
        
        await staticModel.fit(xs, ys, {
            epochs: 30, // Reduced from 50 for faster training
            batchSize: 16,
            shuffle: true,
            verbose: 1,
            callbacks: {
                onEpochEnd: async (epoch, logs) => {
                    const msg = `🔄 Static Model: Epoch ${epoch + 1}/30 | Loss: ${logs.loss.toFixed(4)} | Acc: ${logs.acc.toFixed(3)}`;
                    statusMsg.innerText = msg;
                    console.log(`Epoch ${epoch + 1}: Loss=${logs.loss.toFixed(4)}, Acc=${logs.acc.toFixed(3)}`);
                    // Allow UI to update every few epochs
                    if (epoch % 5 === 0) {
                        await tf.nextFrame();
                    }
                }
            }
        });

        console.log('Fit complete, setting model variable...');
        // Save to global model variable
        model = { static: staticModel, staticLabels: uniqueLabels };
        console.log('Static model training complete. Model state:', { hasStatic: !!model.static, labelsCount: model.staticLabels?.length });
    } catch (error) {
        console.error('Static model training error:', error);
        throw new Error(`Static model training failed: ${error.message}`);
    } finally {
        console.log('Cleaning up tensors...');
        xs.dispose();
        ys.dispose();
    }
}

async function trainDynamicModel(dynamicData) {
    console.log(`trainDynamicModel called with ${dynamicData.length} samples`);
    const uniqueLabels = [...new Set(dynamicData.map(d => d.label))];
    console.log(`Unique dynamic labels: ${uniqueLabels.join(', ')}`);
    
    if (uniqueLabels.length < 2) {
        const msg = `❌ Need at least 2 different dynamic signs. You have: ${uniqueLabels.join(', ')}`;
        statusMsg.innerText = msg;
        console.warn(msg);
        throw new Error(`Only ${uniqueLabels.length} unique dynamic sign(s). Need at least 2 different signs with different names.`);
    }

    statusMsg.innerText = "🔄 Training dynamic model (this may take 1-2 minutes)...";
    console.log(`Starting dynamic training with ${dynamicData.length} samples, ${uniqueLabels.length} classes`);

    const labelMap = {};
    uniqueLabels.forEach((l, i) => labelMap[l] = i);

    // Pad/truncate sequences to fixed length
    const paddedSequences = dynamicData.map(d => {
        const frames = d.frames || [];
        if (frames.length < MAX_DYNAMIC_FRAMES) {
            // Pad with last frame
            const lastFrame = frames[frames.length - 1] || new Array(63).fill(0);
            return [...frames, ...Array(MAX_DYNAMIC_FRAMES - frames.length).fill(lastFrame)];
        } else {
            // Truncate
            return frames.slice(0, MAX_DYNAMIC_FRAMES);
        }
    });

    const xs = tf.tensor3d(paddedSequences); // [samples, timesteps, features]
    const ys = tf.oneHot(tf.tensor1d(dynamicData.map(d => labelMap[d.label]), 'int32'), uniqueLabels.length);

    const dynamicModel = tf.sequential();
    // Use glorotUniform instead of default orthogonal for faster initialization
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
    dynamicModel.add(tf.layers.dense({ units: uniqueLabels.length, activation: 'softmax' }));

    dynamicModel.compile({ optimizer: 'adam', loss: 'categoricalCrossentropy', metrics: ['accuracy'] });

    try {
        console.log('Starting fit...');
        
        // Allow UI to update before starting training
        await new Promise(resolve => setTimeout(resolve, 100));
        
        await dynamicModel.fit(xs, ys, {
            epochs: 20, // Reduced from 30 for faster training
            batchSize: 8,
            shuffle: true,
            verbose: 1,
            callbacks: {
                onEpochEnd: async (epoch, logs) => {
                    const msg = `🔄 Dynamic Model: Epoch ${epoch + 1}/20 | Loss: ${logs.loss.toFixed(4)} | Acc: ${logs.acc.toFixed(3)}`;
                    statusMsg.innerText = msg;
                    console.log(`Epoch ${epoch + 1}: Loss=${logs.loss.toFixed(4)}, Acc=${logs.acc.toFixed(3)}`);
                    // Allow UI to update every few epochs
                    if (epoch % 5 === 0) {
                        await tf.nextFrame();
                    }
                }
            }
        });

        console.log('Fit complete, setting model variable...');
        // Merge with model object
        if (!model) {
            console.log('Model is null, creating new model object');
            model = {};
        }
        model.dynamic = dynamicModel;
        model.dynamicLabels = uniqueLabels;
        console.log('Dynamic model training complete. Model state:', { hasDynamic: !!model.dynamic, labelsCount: model.dynamicLabels?.length });
    } catch (error) {
        console.error('Dynamic model training error:', error);
        throw new Error(`Dynamic model training failed: ${error.message}`);
    } finally {
        console.log('Cleaning up tensors...');
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
    reader.onload = (evt) => {
        try {
            const imported = JSON.parse(evt.target.result);
            if (Array.isArray(imported)) {
                // Validate both static and dynamic formats
                const valid = imported.every(d => {
                    if (!d.label) return false;
                    if (d.type === 'dynamic') {
                        return d.frames && Array.isArray(d.frames) && d.frames.length > 0;
                    } else {
                        return d.landmarks && d.landmarks.length === 63;
                    }
                });
                
                if (valid) {
                    collectedData = collectedData.concat(imported);
                    saveToLocalStorage();
                    renderDataList();
                    alert(`Imported ${imported.length} samples successfully.`);
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

// Start
init();
