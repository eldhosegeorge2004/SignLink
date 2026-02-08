
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

// --- State ---
let isCollecting = false;
let collectedData = [];
let currentLang = 'ISL';
let model = null;

// Storage Keys
const STORAGE_KEYS = {
    'ISL': { model: 'my-isl-model', labels: 'isl_labels', data: 'isl_data' },
    'ASL': { model: 'my-asl-model', labels: 'asl_labels', data: 'asl_data' }
};

// --- Initialization ---
function init() {
    console.log("Initializing Training Studio...");
    startCamera();
    loadDataFromStorage();
    renderDataList();
}

langSelect.addEventListener('change', (e) => {
    currentLang = e.target.value;
    model = null; // Reset model context
    collectedData = []; // Clear current view
    saveBtn.disabled = true;
    statusMsg.innerText = `Switched to ${currentLang}`;
    loadDataFromStorage();
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
let camera;
try {
    if (typeof Camera === 'undefined' || typeof Hands === 'undefined') {
        throw new Error("MediaPipe libraries not loaded. Please check your internet connection.");
    }

    camera = new Camera(videoElement, {
        onFrame: async () => {
            await hands.send({ image: videoElement });
        },
        width: 1280,
        height: 720
    });
} catch (e) {
    alert(e.message);
    console.error(e);
}

async function startCamera() {
    try {
        console.log("Starting camera...");
        await camera.start();
        console.log("Camera started successfully.");
    } catch (err) {
        console.error("Camera failed to start:", err);
        alert("Camera failed to start: " + err.message + ". Ensure you have granted permission.");
    }
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

            if (isCollecting) {
                const label = labelInput.value.trim();
                if (label) {
                    const flatLandmarks = preprocessLandmarks(landmarks);
                    saveDataPoint(label, flatLandmarks);
                }
            }
        }
    }

    canvasCtx.restore();
}

function saveDataPoint(label, landmarks) {
    collectedData.push({ label, landmarks });
    updateUIStats();
}

// --- Data Management ---
async function loadDataFromStorage() {
    // Fetch from server instead of localStorage
    try {
        const response = await fetch(`/api/data?lang=${currentLang}`);
        if (response.ok) {
            collectedData = await response.json();
            updateUIStats();
        } else {
            console.error("Failed to load data from server");
        }
    } catch (err) {
        console.error("Error loading data:", err);
    }
}

async function saveData() {
    // Save to server
    try {
        await fetch(`/api/data?lang=${currentLang}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(collectedData)
        });
    } catch (err) {
        console.error("Error saving data:", err);
    }
}

function updateUIStats() {
    totalSamplesBadge.innerText = collectedData.length;
    // Throttle rendering the list if data is huge
    if (Math.random() > 0.9) renderDataList();
}

function renderDataList() {
    const counts = {};
    collectedData.forEach(d => counts[d.label] = (counts[d.label] || 0) + 1);

    if (Object.keys(counts).length === 0) {
        dataList.innerHTML = `<div style="text-align: center; color: #484f58; margin-top: 50px;">No data collected.</div>`;
        return;
    }

    dataList.innerHTML = Object.entries(counts).map(([label, count]) => `
        <div class="data-item">
            <div class="data-item-info">
                <span class="data-label">${label}</span>
                <span class="data-count">${count} samples</span>
            </div>
            <button class="delete-btn" onclick="deleteLabel('${label}')">
                <span class="material-icons" style="font-size:18px;">delete</span>
            </button>
        </div>
    `).join('');

    totalSamplesBadge.innerText = collectedData.length;
}

window.deleteLabel = (label) => {
    if (confirm(`Delete all samples for "${label}"?`)) {
        collectedData = collectedData.filter(d => d.label !== label);
        saveData();
        renderDataList();
    }
};

clearAllBtn.addEventListener('click', () => {
    if (confirm("Delete ALL collected data? This cannot be undone.")) {
        collectedData = [];
        saveData();
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
        saveData(); // Auto-save on release
        renderDataList();
    });
});

// --- Training Logic ---
trainBtn.addEventListener('click', async () => {
    if (collectedData.length < 10) return alert("Collect more data (min 10 samples)!");

    const uniqueLabels = [...new Set(collectedData.map(d => d.label))];
    if (uniqueLabels.length < 2) return alert("Need at least 2 different signs to train.");

    statusMsg.innerText = "Preparing data...";
    trainBtn.disabled = true;

    // Encode
    const labelMap = {};
    uniqueLabels.forEach((l, i) => labelMap[l] = i);

    const xs = tf.tensor2d(collectedData.map(d => d.landmarks));
    const ys = tf.oneHot(tf.tensor1d(collectedData.map(d => labelMap[d.label]), 'int32'), uniqueLabels.length);

    // Architecture
    const newModel = tf.sequential();
    newModel.add(tf.layers.dense({ units: 64, activation: 'relu', inputShape: [63] }));
    newModel.add(tf.layers.dropout({ rate: 0.2 }));
    newModel.add(tf.layers.dense({ units: 32, activation: 'relu' }));
    newModel.add(tf.layers.dense({ units: uniqueLabels.length, activation: 'softmax' }));

    newModel.compile({ optimizer: 'adam', loss: 'categoricalCrossentropy', metrics: ['accuracy'] });

    // Train
    await newModel.fit(xs, ys, {
        epochs: 50,
        shuffle: true,
        callbacks: {
            onEpochEnd: (epoch, logs) => {
                statusMsg.innerText = `Training... Epoch ${epoch + 1}/50 (Loss: ${logs.loss.toFixed(3)})`;
            }
        }
    });

    model = newModel;
    statusMsg.innerText = "Training Complete! Don't forget to save.";
    trainBtn.disabled = false;
    saveBtn.disabled = false;

    xs.dispose();
    ys.dispose();
});

saveBtn.addEventListener('click', async () => {
    if (!model) return;

    // Save Model
    await model.save(`localstorage://${STORAGE_KEYS[currentLang].model}`);

    // Save Labels
    const uniqueLabels = [...new Set(collectedData.map(d => d.label))];
    localStorage.setItem(STORAGE_KEYS[currentLang].labels, JSON.stringify(uniqueLabels));

    alert(`Model saved to ${currentLang} slot! You can now use it in Live Translation.`);
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
                // Basic validation
                const valid = imported.every(d => d.label && d.landmarks && d.landmarks.length === 63);
                if (valid) {
                    collectedData = collectedData.concat(imported);
                    saveData();
                    renderDataList();
                    alert(`Imported ${imported.length} samples successfully.`);
                } else {
                    alert("Invalid data format. Expected array of objects with 'label' and 'landmarks' (size 63).");
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
