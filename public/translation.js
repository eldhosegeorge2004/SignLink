// translation.js - Live sign language translation page
// This file handles everything needed to translate sign language in real-time:
// - Getting video from the camera
// - Detecting hands using MediaPipe
// - Running AI models to recognize signs
// - Showing the results on screen
// - Displaying sign cards (reference images)

// ==================== DOM ELEMENTS ====================
// These are HTML elements that we need to interact with

// --- Camera and Canvas Elements ---
// Get the video element that shows the camera feed
const videoElement = document.getElementById('input-video');
// Get the canvas element where we'll draw the hand skeleton overlay
const canvasElement = document.getElementById('output-canvas');
// Get the 2D drawing context for the canvas (used to draw lines and dots)
const canvasCtx = canvasElement.getContext('2d');
// Get the sign view element (for displaying sign cards)
const signView = document.getElementById('sign-view');

// --- UI Panel Elements ---
// Get the speech panel (shows speech-related controls)
const speechPanel = document.getElementById('speech-panel');
// Get the caption log (shows text from speech recognition)
const speechCaptionLog = document.getElementById('speech-caption-log');
// Get the sign cards output area (shows reference images for signs)
const signCardsOutput = document.getElementById('sign-cards-output');
// Get the caption log window (the panel that contains the caption log)
const captionLogWindow = document.getElementById('caption-log-window');
// Get the button to toggle the caption log window on/off
const captionToggleBtn = document.getElementById('captionToggleBtn');
// Get the sign cards panel window (the panel that contains sign cards)
const signCardsPanelWindow = document.getElementById('sign-cards-panel-window');
// Get the button to toggle the sign cards panel on/off
const signCardsToggleBtn = document.getElementById('signCardsToggleBtn');

// --- Control Button Elements ---
// Get the camera button (to turn camera on/off)
const camBtn = document.getElementById('cam-btn');
// Get the text-to-speech button (to turn voice output on/off)
const ttsBtn = document.getElementById('tts-btn');
// Get the result text display (shows the detected sign or speech result)
const sttResult = document.getElementById('stt-result');
// Get the toggle for switching between sign mode and voice mode
let signVoiceToggle = document.getElementById('sign-voice-toggle');

// ==================== APPLICATION STATE ====================
// These variables track the current state of the application

// Mode flag: true = detecting sign language, false = using voice recognition
let isSignMode = true;
// Flag to track if camera is currently on
let isCamOn = true;
// Flag to track if text-to-speech (voice output) is enabled
let isTTSOn = true;
// Store the last label that was spoken (to avoid repeating)
let lastSpokenLabel = "";
// Store the time when the last label was spoken
let lastSpokenTime = 0;
// Store the camera video stream
let localStream = null;
// ID for the camera loop (used to stop it later)
let cameraLoopId = null;
// Speech recognition object (for converting speech to text)
let recognition = null;
// Bridge to native speech recognition on mobile (Capacitor plugin)
const nativeSpeechBridge = window.SignLinkCapacitorSpeech || null;
// Timer for restarting speech recognition if it stops
let speechRestartTimer = null;
// Flag to prevent running hand detection too frequently
let isHandInferencePending = false;
// Track when hand detection last ran
let lastHandInferenceAt = 0;
// Store the last text result displayed
let lastResultText = null;

// --- Mobile Optimization Settings ---
// Check if the user is on a mobile device by testing touch capability and user agent
const IS_MOBILE_DEVICE = window.matchMedia('(pointer: coarse)').matches
    || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
// How often to run hand detection (in milliseconds)
// Mobile devices need faster inference for smoother experience
const HAND_INFERENCE_INTERVAL_MS = IS_MOBILE_DEVICE ? 45 : 55;
// How long to extrapolate (predict) hand position between detections
// Mobile devices need longer extrapolation because detection is slower
const SKELETON_MAX_EXTRAPOLATION_MS = IS_MOBILE_DEVICE ? 180 : 140;
// Damping factor for hand velocity (higher = smoother but slower)
const SKELETON_VELOCITY_DAMPING = IS_MOBILE_DEVICE ? 0.94 : 0.88;
// ID for the skeleton rendering loop
let skeletonRenderLoopId = null;
// Target positions for hand landmarks (where hands should be drawn)
let targetHandLandmarks = [];
// Previous hand landmark positions (for calculating velocity)
let previousTargetHandLandmarks = [];
// Velocity of each hand landmark (how fast each point is moving)
let handLandmarkVelocities = [];
// When hand detection last happened
let lastDetectionAt = 0;

// --- Spelling Mode State ---
// These variables are used when the user is spelling words letter by letter
// Accumulated word (the word being built letter by letter)
let accumulatedWord = "";
// Time when the last letter was added
let lastLetterTime = 0;
// The last letter that was added to the word
let lastAddedLetter = null;
// Timer interval for spelling mode
let spellingInterval = null;
// Text to show while waiting for the next letter
const WAITING_FOR_NEXT_LETTER_TEXT = "Waiting for next letter...";
// How long to wait before clearing the word if no new letters are added (5 seconds)
const SPELLING_IDLE_TIMEOUT_MS = 5000;

// ==================== MODEL & STATE ====================
// We use a "hybrid" approach with multiple models:
// 1. Server Model: Pre-trained model with ISL signs (default, works out of the box)
// 2. Local Model: User-trained signs from the AI Training page (custom signs)

// The pre-trained server model (downloaded from server)
let serverModel = null;
// Labels (names of signs) for the server model
let serverLabels = [];
// The local user-trained model for static signs (hand positions)
let localModel = null;
// Labels for the local model
let localLabels = [];

// --- Dynamic Sign Support ---
// Some signs require movement (like waving, not just a static hand position)
// These need a different type of model that analyzes motion over time

// The local user-trained model for dynamic signs (movement-based)
let localModelDynamic = null;
// Labels for the dynamic model
let localLabelsDynamic = [];
// Map of which signs need 1 hand, 2 hands, or either (for dynamic signs)
let dynamicLabelHandRequirements = {};
// Buffer to store frames for dynamic sign analysis
let dynamicFrameBuffer = [];
// Maximum number of frames to keep in the buffer
const MAX_DYNAMIC_FRAMES = 30;
// How long to collect frames before analyzing (in milliseconds)
const DYNAMIC_ANALYZE_MS = 1500;
// When we started collecting frames for dynamic analysis
let dynamicBufferStartTime = 0;

// --- ASL Z-Letter Motion Detection Thresholds ---
// The letter 'Z' in ASL is special because it requires a specific motion (drawing a Z)
// These thresholds define how much motion is needed to recognize a 'Z'

// How much the hand must move to be considered a "big motion"
const BIG_MOTION_CHANGE_THRESHOLD = 0.06;
// Minimum confidence score to consider it a 'Z'
const ASL_Z_MIN_CONFIDENCE = 0.82;
// Minimum number of frames needed to detect the motion
const ASL_Z_MIN_FRAMES = 6;
// Minimum horizontal distance the finger must travel
const ASL_Z_MIN_X_RANGE = 0.06;
// Minimum vertical distance the finger must travel
const ASL_Z_MIN_Y_RANGE = 0.015;
// Minimum total path distance (length of the Z shape)
const ASL_Z_MIN_PATH_DISTANCE = 0.12;
// Minimum horizontal travel (sum of all horizontal movement)
const ASL_Z_MIN_HORIZONTAL_TRAVEL = 0.09;
// Minimum vertical travel (sum of all vertical movement)
const ASL_Z_MIN_VERTICAL_TRAVEL = 0.02;
// Minimum number of direction changes (Z has 3: horizontal, diagonal, horizontal)
const ASL_Z_MIN_DIRECTION_CHANGES = 1;
// Ratio of path distance to straight-line distance (curved path = higher ratio)
const ASL_Z_MIN_CURVATURE_RATIO = 1.03;
// Minimum average movement of the whole hand
const ASL_Z_MIN_WHOLE_HAND_PATH = 0.11;
// Minimum ratio of landmarks that must be moving (not just the finger)
const ASL_Z_MIN_ACTIVE_LANDMARK_RATIO = 0.28;

// --- Motion Detection for Static Signs ---
// For static signs (hand positions), the hand must be still before we predict
// This prevents false predictions while the hand is moving

// The last prediction we displayed (to avoid flickering)
let lastDisplayedPrediction = null;
// The last hand position frame (for comparison)
let lastDisplayedFrame = null;
// How long the hand must be still before we predict (1 second)
const STATIC_STILL_DURATION_MS = 1000;
// Threshold for detecting motion (below this = still, above this = moving)
const MOTION_THRESHOLD = 0.02;
// The previous frame for motion comparison
let previousMotionFrame = null;
// When the hand became still
let staticStillStartTime = 0;
// How long to wait with no hands before clearing (2 seconds)
const NO_HANDS_TIMEOUT_MS = 2000;
// When hands were last detected
let lastHandDetectedTime = Date.now();
// Timer ID for the no-hands timeout
let noHandsTimeoutId = null;

// Buffer to store recent predictions (for smoothing)
const predictionBuffer = [];
// Key for storing the model in browser storage (default is ISL)
let localStorageModelKey = 'my-isl-model';
// Key for storing labels in browser storage
let localStorageLabelKey = 'isl_labels';

// ==================== HELPER FUNCTIONS ====================

// Function: Update the result text displayed on screen
// This updates the text shown to the user
// It only updates if the text is different (avoids unnecessary updates)
function setResultText(text) {
    // Check if the result element exists and text is different
    if (sttResult && text !== lastResultText) {
        // Update the displayed text
        sttResult.innerText = text;
        // Remember what text we just displayed
        lastResultText = text;
    }
}

// Function: Normalize single letter labels to uppercase
// This ensures all single letters are uppercase (A, B, C, etc.)
// Multi-letter labels are left as-is (hello, thank you, etc.)
function normalizeAlphabetLabel(label) {
    // If it's not a string, return it as-is
    if (typeof label !== 'string') return label;
    // Check if it's a single letter using regex pattern
    // If yes, convert to uppercase; if no, leave as-is
    return /^[a-zA-Z]$/.test(label) ? label.toUpperCase() : label;
}

// Function: Normalize all labels in a list
// Goes through a list of labels and normalizes each one
// Returns the normalized list and whether anything changed
function normalizeLabelList(labels) {
    // Flag to track if any labels were changed
    let changed = false;
    // Map through all labels (or empty list if null)
    const normalized = (labels || []).map((label) => {
        // Normalize this label
        const nextLabel = normalizeAlphabetLabel(label);
        // If it changed, set the flag
        if (nextLabel !== label) changed = true;
        // Return the normalized label
        return nextLabel;
    });
    // Return both the normalized list and the change flag
    return { labels: normalized, changed };
}

// Function: Normalize hand requirement map keys
// This map stores how many hands each sign needs (1, 2, or any)
// We normalize the label keys to ensure consistency
function normalizeHandRequirementMap(map) {
    // Flag to track if any keys were changed
    let changed = false;
    // Create a new normalized map
    const normalized = {};

    // Go through each entry in the original map (or empty object if null)
    Object.entries(map || {}).forEach(([label, requirement]) => {
        // Normalize the label key
        const nextLabel = normalizeAlphabetLabel(label);
        // If it changed, set the flag
        if (nextLabel !== label) changed = true;
        // Add the normalized key with the same requirement value
        normalized[nextLabel] = requirement;
    });

    // Return both the normalized map and the change flag
    return { map: normalized, changed };
}

// ==================== LANGUAGE SELECTOR ====================

// Get the language dropdown element
const langSelect = document.getElementById('lang-select');

// If the language selector exists, set up its behavior
if (langSelect) {
    // On page load, check the current value and set the model keys accordingly
    // This is needed because browsers sometimes restore dropdown state
    if (langSelect.value === 'ASL') {
        // Use ASL model keys
        localStorageModelKey = 'my-asl-model';
        localStorageLabelKey = 'asl_labels';
    } else {
        // Default to ISL model keys
        localStorageModelKey = 'my-isl-model';
        localStorageLabelKey = 'isl_labels';
    }

    // When user changes the language dropdown
    langSelect.addEventListener('change', (e) => {
        // Get the selected language
        const lang = e.target.value;
        // Update the model keys based on the selected language
        if (lang === 'ISL') {
            localStorageModelKey = 'my-isl-model';
            localStorageLabelKey = 'isl_labels';
        } else {
            // For ASL, use ASL model keys
            // Note: Currently ASL mainly uses local models
            localStorageModelKey = 'my-asl-model';
            localStorageLabelKey = 'asl_labels';
        }
        // Show a message to the user
        setResultText(`Switched to ${lang}. Loading models...`);
        // Reload the models for the new language
        loadSavedModelAndLabels();
    });
}

// ==================== TTS BUTTON INITIALIZATION ====================

// Text-to-speech (TTS) starts enabled by default for live translation
// This sets up the button appearance to show it's on
if (ttsBtn) {
    // Set the button icon to show volume up (speaker on)
    ttsBtn.innerHTML = '<span class="material-icons">volume_up</span>';
    // Remove the red button style (red indicates off)
    ttsBtn.classList.remove('red-btn');
}

// ==================== MODEL LOADING ====================

// Function: Load Models and Labels (Hybrid approach)
// This function loads up to 3 different models:
// 1. Server Model: Pre-trained signs from the server
// 2. Local Static Model: User-trained signs for hand positions
// 3. Local Dynamic Model: User-trained signs for movements
// It tries to load all three in parallel for speed
async function loadSavedModelAndLabels() {
    try {
        // --- Reset all model state before loading ---
        serverModel = null;  // Clear server model
        serverLabels = [];  // Clear server labels
        localModel = null;  // Clear local static model
        localLabels = [];  // Clear local static labels
        localModelDynamic = null;  // Clear local dynamic model
        localLabelsDynamic = [];  // Clear local dynamic labels
        dynamicLabelHandRequirements = {};  // Clear hand requirements
        predictionBuffer.length = 0;  // Clear prediction buffer
        dynamicFrameBuffer = [];  // Clear dynamic frame buffer
        dynamicBufferStartTime = 0;  // Reset dynamic buffer time
        lastDisplayedPrediction = null;  // Clear last prediction
        lastDisplayedFrame = null;  // Clear last frame

        // Array to hold all loading promises (for parallel loading)
        const promises = [];

        // --- Step 1: Load Server Model (pre-trained dataset) ---
        const serverLoad = async () => {
            console.log("Attempting to load Server Model...");
            try {
                // Check if we're using ASL or ISL
                const isASL = localStorageModelKey === 'my-asl-model';
                // Set the file path based on language
                const modelPath = isASL ? 'model/asl/model.json' : 'model/model.json';
                const labelsPath = isASL ? 'model/asl/labels.json' : 'labels.json';

                // Try to fetch the labels file
                const response = await fetch(labelsPath);
                if (response.ok) {
                    // Parse and normalize the labels
                    serverLabels = normalizeLabelList(await response.json()).labels;
                    try {
                        // Load the TensorFlow.js model
                        serverModel = await tf.loadLayersModel(modelPath);
                        console.log(`Server Model loaded (${serverLabels.length} labels from ${labelsPath})`);
                    } catch (tfErr) {
                        // If model loading fails, log error and set to null
                        console.error("TFJS Server Model Load Error:", tfErr);
                        serverModel = null;
                    }
                } else {
                    // If labels file not found, log warning
                    console.warn(`${labelsPath} not found.`);
                }
            } catch (e) {
                // If anything goes wrong, log error and set model to null
                console.error("Server model load failed fatally:", e);
                serverModel = null;
            }
            // Return a resolved promise so we can track completion
            return Promise.resolve();
        };
        // Add the server load promise to our array
        promises.push(serverLoad());

        // --- Step 2: Load Local Static Model (user-trained signs) ---
        const localLoad = async () => {
            console.log("Attempting to load Local Static Model...");
            try {
                // Build the storage key for the local model
                let localModelKey = `localstorage://${localStorageModelKey}-static`;

                let cloudData = null;
                // Try to load from cloud if online
                if (navigator.onLine) {
                    cloudData = await fetchCloudModel('static', langSelect.value);
                }

                if (cloudData) {
                    // If cloud data exists, use it
                    localLabels = cloudData.labels;
                    localModel = cloudData.model;
                    console.log("Loaded static model from Cloud.");
                    try {
                        // Save to localStorage for offline use
                        await localModel.save(localModelKey);
                        localStorage.setItem(`${localStorageLabelKey}-static`, JSON.stringify(localLabels));
                    } catch (e) {
                        // Silently ignore save errors
                    }
                } else {
                    // Fall back to localStorage if cloud fails
                    let localLabelData = localStorage.getItem(`${localStorageLabelKey}-static`);
                    if (localLabelData) {
                        // Parse and normalize the labels
                        const normalizedLocalLabels = normalizeLabelList(JSON.parse(localLabelData));
                        localLabels = normalizedLocalLabels.labels;
                        // Save back if normalization changed anything
                        if (normalizedLocalLabels.changed) {
                            localStorage.setItem(`${localStorageLabelKey}-static`, JSON.stringify(localLabels));
                        }
                        try {
                            // Load the model from localStorage
                            localModel = await tf.loadLayersModel(localModelKey);
                            console.log(`Local Static Model loaded from LocalStorage (${localLabels.length} labels)`);
                        } catch (e) {
                            // If loading fails, set to null
                            localModel = null;
                        }
                    }
                }
            } catch (e) {
                // Log warning if anything fails
                console.warn("Local static model load failed:", e);
                localModel = null;
            }
        };
        // Add the local load promise to our array
        promises.push(localLoad());

        // --- Step 3: Load Local Dynamic Model (for movement-based signs) ---
        const dynamicLoad = async () => {
            console.log("Attempting to load Local Dynamic Model...");
            try {
                let cloudData = null;
                // Try to load from cloud if online
                if (navigator.onLine) {
                    cloudData = await fetchCloudModel('dynamic', langSelect.value);
                }

                if (cloudData) {
                    // If cloud data exists, use it
                    localLabelsDynamic = cloudData.labels;
                    localModelDynamic = cloudData.model;
                    dynamicLabelHandRequirements = cloudData.handReqs || {};
                    console.log("Loaded dynamic model from Cloud.");
                    try {
                        // Save to localStorage for offline use
                        await localModelDynamic.save(`localstorage://${localStorageModelKey}-dynamic`);
                        localStorage.setItem(`${localStorageLabelKey}-dynamic`, JSON.stringify(localLabelsDynamic));
                        localStorage.setItem(`${localStorageLabelKey}-dynamic-hand-req`, JSON.stringify(dynamicLabelHandRequirements));
                    } catch (e) {
                        // Silently ignore save errors
                    }
                } else {
                    // Fall back to localStorage if cloud fails
                    let dynamicLabelData = localStorage.getItem(`${localStorageLabelKey}-dynamic`);
                    if (dynamicLabelData) {
                        // Parse and normalize the labels
                        const normalizedDynamicLabels = normalizeLabelList(JSON.parse(dynamicLabelData));
                        localLabelsDynamic = normalizedDynamicLabels.labels;
                        // Save back if normalization changed anything
                        if (normalizedDynamicLabels.changed) {
                            localStorage.setItem(`${localStorageLabelKey}-dynamic`, JSON.stringify(localLabelsDynamic));
                        }
                        // Load hand requirements
                        const dynamicReqData = localStorage.getItem(`${localStorageLabelKey}-dynamic-hand-req`);
                        const normalizedHandReqs = normalizeHandRequirementMap(dynamicReqData ? JSON.parse(dynamicReqData) : {});
                        dynamicLabelHandRequirements = normalizedHandReqs.map;
                        // Save back if normalization changed anything
                        if (normalizedHandReqs.changed) {
                            localStorage.setItem(`${localStorageLabelKey}-dynamic-hand-req`, JSON.stringify(dynamicLabelHandRequirements));
                        }
                        try {
                            // Load the model from localStorage
                            localModelDynamic = await tf.loadLayersModel(`localstorage://${localStorageModelKey}-dynamic`);
                            console.log(`Local Dynamic Model loaded from LocalStorage (${localLabelsDynamic.length} labels)`);
                        } catch (e) {
                            // If loading fails, set to null
                            localModelDynamic = null;
                        }
                    }
                }
            } catch (e) {
                // Log warning if anything fails
                console.warn("Local dynamic model load failed:", e);
                localModelDynamic = null;
            }
        };
        // Add the dynamic load promise to our array
        promises.push(dynamicLoad());

        // --- Step 4: Wait for all models to finish loading ---
        // Use allSettled so one failure doesn't stop the others
        await Promise.allSettled(promises);

        // --- Step 5: UI Feedback ---
        // Check which models successfully loaded
        const loadedModels = [];
        if (serverModel) loadedModels.push("Server");
        if (localModel) loadedModels.push("Local Static");
        if (localModelDynamic) loadedModels.push("Local Dynamic");

        // Only show error message if NO models were found
        if (loadedModels.length === 0) {
            setResultText("No models found. Please train in AI Training mode.");
        }

        // If absolutely no models loaded, show a button to go to training
        if (!serverModel && !localModel && !localModelDynamic) {
            // Only create the button if it doesn't already exist
            if (!document.getElementById('goto-training-btn')) {
                const btn = document.createElement('button');
                btn.id = 'goto-training-btn';
                btn.innerText = "Go to AI Training";
                btn.className = "control-btn";
                btn.style.marginTop = "10px";
                btn.style.background = "#3b82f6";
                // When clicked, navigate to training page
                btn.onclick = () => window.location.href = 'training.html';
                sttResult.parentElement.appendChild(btn);
            }
        } else {
            // If models loaded, remove the training button if it exists
            const btn = document.getElementById('goto-training-btn');
            if (btn) btn.remove();
        }

    } catch (e) {
        // If anything goes wrong, log error and show message
        console.error("Error in hybrid load:", e);
        setResultText("Error loading systems.");
    }
}
// Function: Fetch model from Supabase cloud storage
// This tries to load a model from the cloud (Supabase storage)
// It tries multiple storage buckets with fallback support
async function fetchCloudModel(type, lang) {
    try {
        // Convert language to lowercase for file paths
        const langLower = lang.toLowerCase();
        // Get the list of storage buckets to try (for fallback)
        const candidates = await window.getStorageBucketCandidates('models');
        
        // Try each bucket until one works
        for (const modelsBucket of candidates) {
            // --- Step 1: Get Public URLs for labels and model ---
            const { data: labelsUrlData } = window.supabaseClient.storage
                .from(modelsBucket)
                .getPublicUrl(`${langLower}/${type}/labels.json`);
                
            const { data: modelUrlData } = window.supabaseClient.storage
                .from(modelsBucket)
                .getPublicUrl(`${langLower}/${type}/model.json`);

            // --- Step 2: Load Labels ---
            const labelsRes = await fetch(labelsUrlData.publicUrl);
            if (!labelsRes.ok) {
                // If labels not found in this bucket, try the next one
                continue;
            }

            // Parse and normalize the labels
            const labels = normalizeLabelList(await labelsRes.json()).labels;
            
            // --- Step 3: Load Model ---
            const model = await tf.loadLayersModel(modelUrlData.publicUrl);
            
            // --- Step 4: Load hand requirements for dynamic models ---
            let handReqs = null;
            if (type === 'dynamic') {
                // Only load hand requirements for dynamic models
                const { data: handReqsUrlData } = window.supabaseClient.storage
                    .from(modelsBucket)
                    .getPublicUrl(`${langLower}/${type}/hand_reqs.json`);
                const reqRes = await fetch(handReqsUrlData.publicUrl);
                if (reqRes.ok) {
                    // Parse and normalize the hand requirements
                    handReqs = normalizeHandRequirementMap(await reqRes.json()).map;
                }
            }
            
            // Return the loaded model data
            return { model, labels, handReqs };
        }

        // If no bucket worked, return null
        return null;
    } catch (err) {
        // Log warning if anything fails
        console.warn(`Cloud model fetch failed for ${type}:`, err);
        return null;
    }
}

loadSavedModelAndLabels();

// ==================== MEDIAPIPE HANDS SETUP ====================
// MediaPipe is a library that detects hands in video
// It identifies 21 key points (landmarks) on each hand

// Create a new Hands detector instance
const hands = new Hands({
    // Tell it where to find the MediaPipe files (from CDN)
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
});

// Configure the hand detection options
hands.setOptions({
    maxNumHands: 2,  // Detect up to 2 hands at once
    modelComplexity: 1,  // Use medium complexity model (balance speed and accuracy)
    minDetectionConfidence: 0.7,  // Minimum confidence to detect a hand
    minTrackingConfidence: 0.65  // Minimum confidence to track a hand across frames
});

// Set the function to call when hand detection results are ready
hands.onResults(onResults);

// ==================== HAND LANDMARK HELPERS ====================

// Function: Deep clone hand landmarks
// This creates a copy of the hand landmark data
// We do this to avoid reference issues (changing one shouldn't affect the original)
function cloneHands(hands) {
    // If no hands, return empty array
    // Otherwise, create a deep copy of each hand and each point
    return (hands || []).map((hand) => hand.map((point) => ({
        x: point.x,  // X coordinate (horizontal position)
        y: point.y,  // Y coordinate (vertical position)
        z: point.z   // Z coordinate (depth/distance from camera)
    })));
}

// Function: Ensure canvas size matches video size
// The canvas must be the same size as the video for proper overlay
function syncCanvasSize() {
    // If video dimensions aren't available yet, return false
    if (!videoElement.videoWidth || !videoElement.videoHeight) return false;
    // If canvas size doesn't match video size, update it
    if (canvasElement.width !== videoElement.videoWidth || canvasElement.height !== videoElement.videoHeight) {
        canvasElement.width = videoElement.videoWidth;
        canvasElement.height = videoElement.videoHeight;
    }
    return true;
}

// Function: Update skeleton target positions and calculate velocities
// This updates where we want to draw the hand skeleton
// It also calculates how fast each point is moving (velocity)
// We use velocity to smooth the animation between detections
function updateSkeletonTargets(handLandmarks) {
    // Get the current time (high precision)
    const now = performance.now();
    // Clone the hand landmarks (copy to avoid reference issues)
    const nextHands = cloneHands(handLandmarks);

    // If the number of hands changed, reset previous data
    if (previousTargetHandLandmarks.length !== nextHands.length) {
        previousTargetHandLandmarks = cloneHands(nextHands);
    }

    // --- Calculate velocity for each landmark (for extrapolation) ---
    // Velocity tells us how fast and in what direction each point is moving
    handLandmarkVelocities = nextHands.map((hand, handIndex) => {
        // Get the previous hand position (or current if no previous)
        const previousHand = previousTargetHandLandmarks[handIndex] || hand;
        // Calculate time since last detection (in milliseconds)
        const deltaMs = Math.max(now - lastDetectionAt, 1);

        // Calculate velocity for each point in the hand
        return hand.map((point, pointIndex) => {
            const previousPoint = previousHand[pointIndex] || point;
            // Velocity = (current position - previous position) / time
            return {
                x: (point.x - previousPoint.x) / deltaMs,
                y: (point.y - previousPoint.y) / deltaMs,
                z: (point.z - previousPoint.z) / deltaMs
            };
        });
    });

    // Update the stored values for next time
    previousTargetHandLandmarks = cloneHands(nextHands);
    targetHandLandmarks = nextHands;
    lastDetectionAt = now;
}

// Function: Clear skeleton targets when no hands detected
// This resets all the hand tracking data when hands leave the frame
function clearSkeletonTargets() {
    targetHandLandmarks = [];  // Clear target positions
    previousTargetHandLandmarks = [];  // Clear previous positions
    handLandmarkVelocities = [];  // Clear velocities
}

// Function: Render skeleton with extrapolation for smooth animation
// This draws the hand skeleton on the canvas
// It uses extrapolation (prediction) to smooth out animation between detections
// This makes the skeleton look smooth even if detection is slow
function renderSkeletonFrame(now) {
    // Schedule the next frame (creates a smooth animation loop)
    skeletonRenderLoopId = requestAnimationFrame(renderSkeletonFrame);

    // Ensure canvas size matches video size
    if (!syncCanvasSize()) return;

    // Clear the canvas (erase previous frame)
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

    // If no hands to draw, just return
    if (!targetHandLandmarks.length) {
        return;
    }

    // Calculate how long it's been since the last detection
    const sinceDetectionMs = now - lastDetectionAt;
    // Decide if we should extrapolate (predict) positions
    // Only extrapolate if detection was recent (within the max time)
    const shouldExtrapolate = sinceDetectionMs > 0 && sinceDetectionMs <= SKELETON_MAX_EXTRAPOLATION_MS;

    // Calculate the display positions for all hands
    const displayHands = targetHandLandmarks.map((targetHand, handIndex) => {
        // Get the velocity for this hand
        const velocityHand = handLandmarkVelocities[handIndex] || [];

        // Calculate position for each point in the hand
        return targetHand.map((targetPoint, pointIndex) => {
            // Get the velocity for this point
            const velocityPoint = velocityHand[pointIndex] || { x: 0, y: 0, z: 0 };
            // If extrapolating, predict where the point should be
            // Formula: predicted position = current position + (velocity * time * damping)
            return shouldExtrapolate ? {
                x: Math.min(1, Math.max(0, targetPoint.x + velocityPoint.x * sinceDetectionMs * SKELETON_VELOCITY_DAMPING)),
                y: Math.min(1, Math.max(0, targetPoint.y + velocityPoint.y * sinceDetectionMs * SKELETON_VELOCITY_DAMPING)),
                z: targetPoint.z + velocityPoint.z * sinceDetectionMs * SKELETON_VELOCITY_DAMPING
            } : targetPoint;
        });
    });

    // Draw each hand skeleton
    for (const landmarks of displayHands) {
        // Draw lines connecting the hand joints (green lines)
        drawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS, { color: '#00FF00', lineWidth: 4 });
        // Draw dots at each joint (red dots)
        drawLandmarks(canvasCtx, landmarks, { color: '#FF0000', lineWidth: 2 });
    }
}

// Function: Start the skeleton rendering loop
// This begins the animation loop that draws the hand skeleton
function startSkeletonRenderer() {
    // If already running, don't start again
    if (skeletonRenderLoopId) return;
    // Start the animation loop
    skeletonRenderLoopId = requestAnimationFrame(renderSkeletonFrame);
}

// Function: Stop the skeleton rendering loop
// This stops the animation and clears the hand data
function stopSkeletonRenderer() {
    // If the loop is running, stop it
    if (skeletonRenderLoopId) {
        cancelAnimationFrame(skeletonRenderLoopId);
        skeletonRenderLoopId = null;
    }
    // Clear the hand data
    clearSkeletonTargets();
}

// ==================== LANDMARK PREPROCESSING ====================

// Function: Preprocess hand landmarks for ML model input
// This prepares the hand landmark data for the AI model
// It normalizes positions relative to the wrist and scales by hand size
// This makes the model work regardless of hand position or size in the frame
function preprocessLandmarks(landmarks, mirrorX = false) {
    // Get the wrist position (landmark 0 is always the wrist)
    const wrist = landmarks[0];
    // If mirroring is enabled (for left/right hand symmetry), flip the X coordinate
    const wristX = mirrorX ? 1 - wrist.x : wrist.x;
    // Get the index finger knuckle position (landmark 5)
    const indexMCP = landmarks[5];
    const indexX = mirrorX ? 1 - indexMCP.x : indexMCP.x;
    
    // Calculate hand size using the distance from wrist to index finger
    // This is used to normalize all positions relative to hand size
    const distance = Math.hypot(
        indexX - wristX,
        indexMCP.y - wrist.y,
        indexMCP.z - wrist.z
    ) || 1e-6;  // Use a tiny value if distance is 0 to avoid division by zero
    
    // Create an array to hold the normalized data (3 values per landmark: x, y, z)
    const normalized = new Array(landmarks.length * 3);

    // Normalize each landmark relative to wrist and scale by hand size
    for (let index = 0; index < landmarks.length; index += 1) {
        const point = landmarks[index];
        // Apply mirroring if enabled
        const pointX = mirrorX ? 1 - point.x : point.x;
        // Calculate the array index for this landmark (x, y, z are stored consecutively)
        const base = index * 3;
        // Normalize X: (point X - wrist X) / hand size
        normalized[base] = (pointX - wristX) / distance;
        // Normalize Y: (point Y - wrist Y) / hand size
        normalized[base + 1] = (point.y - wrist.y) / distance;
        // Normalize Z: (point Z - wrist Z) / hand size
        normalized[base + 2] = (point.z - wrist.z) / distance;
    }

    // Return the normalized array
    return normalized;
}

// ==================== PREDICTION SMOOTHING ====================

// Function: Smooth predictions using a rolling buffer
// This reduces flickering by looking at the last several predictions
// It returns the most common prediction from recent history
function getSmoothedPrediction(predLabel) {
    // Add the new prediction to the buffer
    predictionBuffer.push(predLabel);
    // Keep only the last 10 predictions (older ones are removed)
    if (predictionBuffer.length > 10) predictionBuffer.shift();
    
    // Count how many times each label appears in the buffer
    const counts = {};
    predictionBuffer.forEach(l => counts[l] = (counts[l] || 0) + 1);
    
    // Sort labels by count (highest first) and return the most common one
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

// ==================== MOTION DETECTION ====================

// Function: Detect if hand is still (needed for static sign prediction)
// For static signs (hand positions), the hand must be still before we predict
// This prevents false predictions while the hand is moving
function updateMotionState(currentFrame) {
    // Get the current time
    const now = Date.now();

    // If this is the first frame, initialize the previous frame
    if (!previousMotionFrame) {
        previousMotionFrame = currentFrame.slice();
        staticStillStartTime = now;
        return { isStillFrame: false, stillForMs: 0 };
    }

    // Calculate how much the hand moved compared to the previous frame
    let totalDelta = 0;
    for (let i = 0; i < currentFrame.length; i++) {
        // Add the absolute difference for each coordinate
        totalDelta += Math.abs(currentFrame[i] - previousMotionFrame[i]);
    }

    // Calculate the average motion (motion score)
    const motionScore = totalDelta / currentFrame.length;
    // Determine if the hand is still (motion below threshold)
    const isStillFrame = motionScore < MOTION_THRESHOLD;

    // Track how long the hand has been still
    if (isStillFrame) {
        // If hand is still and we weren't tracking, start tracking
        if (staticStillStartTime === 0) staticStillStartTime = now;
    } else {
        // If hand moved, reset the still timer
        staticStillStartTime = 0;
    }

    // Update the previous frame for next comparison
    previousMotionFrame = currentFrame.slice();
    // Calculate how long the hand has been still (in milliseconds)
    const stillForMs = staticStillStartTime ? (now - staticStillStartTime) : 0;
    // Return the results
    return { isStillFrame, stillForMs };
}

// Function: Reset motion detection state
// This clears all motion tracking data
// Call this when you want to start fresh motion detection
function resetMotionState() {
    previousMotionFrame = null;  // Clear the previous frame
    staticStillStartTime = 0;  // Reset the still timer
}

// Function: Calculate difference between two frames
// This measures how much the hand moved between two frames
// Used for motion detection and to decide if we should keep old predictions
function getFrameDifference(frameA, frameB) {
    // If frames are invalid or different sizes, return infinity (max difference)
    if (!frameA || !frameB || frameA.length !== frameB.length) return Infinity;

    // Calculate the total difference between the frames
    let totalDelta = 0;
    for (let i = 0; i < frameA.length; i++) {
        totalDelta += Math.abs(frameA[i] - frameB[i]);
    }
    // Return the average difference per coordinate
    return totalDelta / frameA.length;
}

// Function: Update the last displayed prediction and frame
// This stores the most recent prediction and the hand position at that time
// Used to decide if we should keep showing an old prediction
function updateDisplayedPrediction(label, conf, isDynamic, currentFrame) {
    // Store the prediction details (label, confidence, whether it's dynamic)
    lastDisplayedPrediction = { label, conf, isDynamic };
    // Store a copy of the hand position frame
    lastDisplayedFrame = currentFrame.slice();
}

// Function: Check if we should keep the last prediction
// If the hand hasn't moved much, we keep showing the old prediction
// This prevents the display from flickering when the hand is nearly still
function shouldKeepLastPrediction(currentFrame) {
    // If we don't have a previous prediction, we can't keep it
    if (!lastDisplayedPrediction || !lastDisplayedFrame) return false;
    // Calculate how much the hand moved since the last prediction
    const diff = getFrameDifference(currentFrame, lastDisplayedFrame);
    // If movement is below threshold, keep the old prediction
    return diff < BIG_MOTION_CHANGE_THRESHOLD;
}

// ==================== MODEL PREDICTION ====================

// Function: Run a single model prediction and get the best result
// This takes the model's output tensor and finds the label with highest confidence
// Returns the predicted label and its confidence score
function getPredictionFromTensor(predictionTensor, labels) {
    // If no tensor or no labels, return empty result
    if (!predictionTensor || !labels.length) return { label: null, conf: 0 };

    // Get the confidence values from the tensor
    const values = predictionTensor.dataSync();
    // Start with the first label as the best
    let idx = 0;
    let conf = values[0] ?? 0;

    // Check all other labels to find the one with highest confidence
    for (let valueIndex = 1; valueIndex < values.length; valueIndex += 1) {
        if (values[valueIndex] > conf) {
            conf = values[valueIndex];
            idx = valueIndex;
        }
    }

    // Return the label with highest confidence (normalized) and the confidence score
    // Note: Tensor memory cleanup happens in tf.tidy in the calling function
    return { label: normalizeAlphabetLabel(labels[idx]), conf: conf };
}

// Function: Run prediction on a single model
// This is a wrapper that runs the model and extracts the best prediction
function predictSingleModel(modelInstance, labels, tensor) {
    // If no model or no labels, return empty result
    if (!modelInstance || !labels.length) return { label: null, conf: 0 }
    // Run the model on the input tensor and get the best prediction
    return getPredictionFromTensor(modelInstance.predict(tensor), labels);
}

// Function: Normalize hand requirement value
// Converts the hand requirement to a standard format: 1, 2, or 'any'
// This handles both string and number inputs
function normalizeHandRequirement(rawValue) {
    // If it's 1 (number or string), return 1
    if (rawValue === 1 || rawValue === '1') return 1;
    // If it's 2 (number or string), return 2
    if (rawValue === 2 || rawValue === '2') return 2;
    // Otherwise, it can use any number of hands
    return 'any';
}

// Function: Check if this is the ASL 'Z' letter
// The letter 'Z' in ASL is special because it requires a specific motion
// This function checks if we're in ASL mode and the label is 'Z'
function isASLDynamicSpellingLetter(label) {
    // Only applies to ASL, not ISL
    if (localStorageModelKey !== 'my-asl-model') return false;
    // Label must be a string
    if (typeof label !== 'string') return false;
    // Check if it's the letter Z (case-insensitive)
    return label.toUpperCase() === 'Z';
}

// Function: Calculate motion metrics for ASL 'Z' detection
// This analyzes the finger movement to see if it matches the Z pattern
// It measures path distance, direction changes, curvature, etc.
function getASLZMotionMetrics(frameBuffer) {
    // Extract the index finger tip positions from the frame buffer
    // Index finger tip is at index 24 (X) and 25 (Y) in the landmark array
    const tipPoints = (frameBuffer || [])
        .filter(frame => Array.isArray(frame) && frame.length >= 26)
        .map(frame => ({ x: frame[24], y: frame[25] }));

    // If we don't have enough frames, return empty metrics
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

    // Initialize metrics counters
    let pathDistance = 0;  // Total length of the path traveled
    let horizontalTravel = 0;  // Total horizontal movement
    let verticalTravel = 0;  // Total vertical movement
    let directionChanges = 0;  // Number of direction changes
    let lastHorizontalDirection = 0;  // Last horizontal direction (-1, 0, or 1)
    let wholeHandPathDistance = 0;  // Total movement of all hand landmarks
    let activeLandmarkComparisons = 0;  // Count of landmarks that moved significantly
    let totalLandmarkComparisons = 0;  // Total landmark comparisons

    // Analyze each frame to calculate metrics
    for (let index = 1; index < tipPoints.length; index += 1) {
        // Calculate the movement from previous frame to current frame
        const dx = tipPoints[index].x - tipPoints[index - 1].x;
        const dy = tipPoints[index].y - tipPoints[index - 1].y;
        // Add the distance to the total path distance
        pathDistance += Math.hypot(dx, dy);
        // Add the absolute movements to travel counters
        horizontalTravel += Math.abs(dx);
        verticalTravel += Math.abs(dy);

        // --- Analyze whole hand movement (not just finger tip) ---
        const currentFrame = frameBuffer[index];
        const previousFrame = frameBuffer[index - 1];
        if (Array.isArray(currentFrame) && Array.isArray(previousFrame) && currentFrame.length >= 63 && previousFrame.length >= 63) {
            // Check each of the 21 hand landmarks
            for (let landmark = 0; landmark < 21; landmark += 1) {
                const base = landmark * 3;  // Calculate array index for this landmark
                // Calculate movement in X, Y, Z
                const lx = currentFrame[base] - previousFrame[base];
                const ly = currentFrame[base + 1] - previousFrame[base + 1];
                const lz = currentFrame[base + 2] - previousFrame[base + 2];
                // Calculate the total movement for this landmark
                const landmarkDelta = Math.hypot(lx, ly, lz);

                wholeHandPathDistance += landmarkDelta;
                totalLandmarkComparisons += 1;
                // Count as "active" if movement is significant
                if (landmarkDelta >= 0.01) {
                    activeLandmarkComparisons += 1;
                }
            }
        }

        // --- Track direction changes (for Z pattern detection) ---
        // Determine horizontal direction (-1 = left, 1 = right, 0 = no movement)
        const direction = Math.abs(dx) >= 0.01 ? Math.sign(dx) : 0;
        if (direction !== 0) {
            // If direction changed, increment counter
            if (lastHorizontalDirection !== 0 && direction !== lastHorizontalDirection) {
                directionChanges += 1;
            }
            lastHorizontalDirection = direction;
        }
    }

    // --- Calculate final metrics ---
    // Get all X and Y coordinates
    const xValues = tipPoints.map(point => point.x);
    const yValues = tipPoints.map(point => point.y);
    // Calculate the range (max - min) for X and Y
    const xRange = Math.max(...xValues) - Math.min(...xValues);
    const yRange = Math.max(...yValues) - Math.min(...yValues);
    // Get the start and end points of the path
    const start = tipPoints[0];
    const end = tipPoints[tipPoints.length - 1];
    // Calculate the straight-line distance from start to end
    const endToEndDistance = Math.hypot(end.x - start.x, end.y - start.y);
    // Calculate curvature ratio (path length / straight-line distance)
    // A Z shape has a ratio > 1 because the path is longer than the straight line
    const curvatureRatio = endToEndDistance > 0 ? pathDistance / endToEndDistance : 0;
    // Calculate average whole hand movement
    const normalizedWholeHandPath = totalLandmarkComparisons > 0 ? (wholeHandPathDistance / totalLandmarkComparisons) : 0;
    // Calculate the ratio of active landmarks (those that moved significantly)
    const activeLandmarkRatio = totalLandmarkComparisons > 0 ? (activeLandmarkComparisons / totalLandmarkComparisons) : 0;

    // Return all the calculated metrics
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

// Function: Check if the motion matches ASL 'Z' pattern
// This validates that the finger movement has the characteristics of a Z
// It checks multiple thresholds to ensure it's a real Z, not random motion
function hasStrongASLZMotion(label, confidence, frameBuffer) {
    // If this isn't a Z letter, it doesn't need motion validation
    if (!isASLDynamicSpellingLetter(label)) return true;
    // If confidence is too low, reject it
    if (confidence < ASL_Z_MIN_CONFIDENCE) return false;

    // Get the motion metrics from the frame buffer
    const metrics = getASLZMotionMetrics(frameBuffer);
    // Need at least a minimum number of frames
    if (metrics.frameCount < ASL_Z_MIN_FRAMES) return false;

    // --- Check minimum travel requirements ---
    // The finger must have moved enough in both X and Y directions
    const hasMinimumTravel = metrics.xRange >= ASL_Z_MIN_X_RANGE
        && metrics.yRange >= ASL_Z_MIN_Y_RANGE
        && metrics.pathDistance >= ASL_Z_MIN_PATH_DISTANCE
        && metrics.horizontalTravel >= ASL_Z_MIN_HORIZONTAL_TRAVEL
        && metrics.verticalTravel >= ASL_Z_MIN_VERTICAL_TRAVEL;

    // If minimum travel not met, reject
    if (!hasMinimumTravel) return false;

    // --- Check whole hand movement ---
    // Not just the finger tip - the whole hand should be moving
    const hasWholeHandMovement = metrics.wholeHandPathDistance >= ASL_Z_MIN_WHOLE_HAND_PATH
        && metrics.activeLandmarkRatio >= ASL_Z_MIN_ACTIVE_LANDMARK_RATIO;
    if (!hasWholeHandMovement) return false;

    // --- Check direction changes or curvature ---
    // A Z has direction changes (horizontal, diagonal, horizontal)
    // Or it has high curvature (curved path)
    // This rejects tiny transition jitter but allows real Z without requiring a perfect trace
    const hasDirectionOrCurvature = metrics.directionChanges >= ASL_Z_MIN_DIRECTION_CHANGES
        || metrics.curvatureRatio >= ASL_Z_MIN_CURVATURE_RATIO;

    // Return true if motion matches Z pattern
    return hasDirectionOrCurvature;
}

// Function: Check if the predicted label matches the detected hand count
// Some signs require specific hand counts (1 hand, 2 hands, or either)
// This ensures we don't predict a sign that needs 2 hands when only 1 is visible
function labelMatchesDetectedHands(label, detectedHandCount) {
    // Get the hand requirement for this label (1, 2, or 'any')
    const requirement = normalizeHandRequirement(dynamicLabelHandRequirements[label]);
    // Return true if requirement is 'any' or matches the detected count
    return requirement === 'any' || requirement === detectedHandCount;
}

// Function: Skip certain labels in static mode
// Some signs have special handling and shouldn't be predicted in static mode
// For example, 'hello' might be handled differently
function shouldSkipStaticLabel(label) {
    // Return true if label is 'hello' (case-insensitive)
    return typeof label === 'string' && label.toLowerCase() === 'hello';
}

// Function: Apply ISL-specific hand count disambiguation rules
// In ISL (Indian Sign Language), some signs have different meanings based on hand count
// This function adjusts the label based on how many hands are detected
function applyISLHandCountDisambiguation(label, detectedHandCount) {
    // Only applies to ISL, not ASL
    if (localStorageModelKey !== 'my-isl-model') return label;
    // Label must be a string
    if (typeof label !== 'string') return label;

    // In ISL, 'T' with one hand is actually '1'
    // This is a special case for ISL hand count disambiguation
    if (detectedHandCount < 2 && label.toUpperCase() === 'T') {
        return '1';
    }

    // No disambiguation needed, return the original label
    return label;
}

// Function: Choose the best prediction from multiple model candidates
// When multiple models predict different signs, we need to choose the best one
// This function prioritizes local (user-trained) models over server models
// Because user-trained models are more relevant to the user's custom signs
function chooseBestCandidateWithLocalPriority(candidates) {
    // Separate candidates into server and local groups
    const serverCandidates = candidates.filter(c => c.source.startsWith('Server'));
    const localCandidates = candidates.filter(c => c.source.startsWith('Local') || c.source === 'Dynamic');

    // Sort each group by confidence (highest first)
    serverCandidates.sort((a, b) => b.conf - a.conf);
    localCandidates.sort((a, b) => b.conf - a.conf);

    // Get the best from each group
    const bestLocal = localCandidates[0] || null;
    const bestServer = serverCandidates[0] || null;

    // If we have both local and server predictions, decide between them
    if (bestLocal && bestServer) {
        // Get the labels and convert to uppercase for comparison
        const serverLabel = String(bestServer.label || '').toUpperCase();
        const localLabel = String(bestLocal.label || '').toUpperCase();
        // Check if server predicted an alphabet letter (A-Z)
        const serverIsAlphabet = /^[A-Z]$/.test(serverLabel);
        // Check if local predicted a digit (0-9)
        const localIsDigit = /^[0-9]$/.test(localLabel);

        // Safety guard: if server is very confident about an alphabet
        // and local predicts a digit with much lower confidence, trust the server
        // This prevents misclassifying letters as numbers
        if (serverIsAlphabet && localIsDigit && bestServer.conf >= 0.82 && (bestServer.conf - bestLocal.conf) >= 0.15) {
            return bestServer;
        }

        // Moderate local preference: give local model a 0.20 confidence boost
        // This prioritizes user-trained signs from the AI Training page
        const localScore = bestLocal.conf + 0.20;
        const serverScore = bestServer.conf;
        // Return the one with the higher adjusted score
        return localScore >= serverScore ? bestLocal : bestServer;
    }

    // If only one group has predictions, return the best from that group
    return bestLocal || bestServer || null;
}

// ==================== MAIN PREDICTION FUNCTION ====================

// Function: Main prediction function - runs all available models and chooses best result
// This is the core function that coordinates all model predictions
// It runs server model, local static model, and local dynamic model
// Then it chooses the best prediction using the priority rules
function runPrediction(landmarks, detectedHandCount = 1) {
    // We need at least one model loaded to make predictions
    if (!serverModel && !localModel && !localModelDynamic) return;

    // Use tf.tidy to automatically clean up TensorFlow tensors (prevents memory leaks)
    tf.tidy(() => {
        // --- Prepare Inputs for static models ---
        // Normalize the hand landmarks for the ML models
        const flatNormal = preprocessLandmarks(landmarks);
        // Check if the hand is still (needed for static sign prediction)
        const motionState = updateMotionState(flatNormal);
        // Determine if static prediction is allowed (hand must be still for 1 second)
        const staticAllowed = motionState.stillForMs >= STATIC_STILL_DURATION_MS;

        // If hand is not still, clear the prediction buffer and spell state
        if (!staticAllowed) {
            predictionBuffer.length = 0;
            heldLetter = null;
            holdStartTime = 0;
        }

        // Create a TensorFlow tensor from the normalized landmarks
        const tensorNormal = tf.tensor2d([flatNormal]);

        // --- Collect candidates from all available models ---
        let candidates = [];

        // --- Step 1: Query Server Model (Static only when hand is still) ---
        if (staticAllowed && serverModel && serverLabels.length) {
            // Run prediction on the server model
            const pNorm = predictSingleModel(serverModel, serverLabels, tensorNormal);
            // Add to candidates if not a label to skip
            if (!shouldSkipStaticLabel(pNorm.label)) {
                candidates.push({ ...pNorm, source: 'Server' });
            }

            // If confidence is low, try mirrored version (handles left/right hand ambiguity)
            // Some signs look different with left vs right hand
            if (pNorm.conf < 0.7) {
                // Create a mirrored version of the landmarks (flip X coordinate)
                const tensorFlipped = tf.tensor2d([preprocessLandmarks(landmarks, true)]);
                // Run prediction on mirrored landmarks
                const pFlip = predictSingleModel(serverModel, serverLabels, tensorFlipped);
                // Add to candidates if not a label to skip
                if (!shouldSkipStaticLabel(pFlip.label)) {
                    candidates.push({ ...pFlip, source: 'Server(M)' });
                }
            }
        }

        // --- Step 2: Query Local Static Model (only when hand is still) ---
        if (staticAllowed && localModel && localLabels.length) {
            // Run prediction on the local static model
            const pNorm = predictSingleModel(localModel, localLabels, tensorNormal);
            // Add to candidates if not a label to skip
            if (!shouldSkipStaticLabel(pNorm.label)) {
                candidates.push({ ...pNorm, source: 'Local' });
            }

            // Note: Keep local model non-mirrored to avoid unstable predictions
            // Mirroring can cause issues with user-trained models
        }

        // --- Step 3: Query Dynamic Model with frame buffer ---
        // Only query dynamic model when hand is NOT still (to prevent dynamic signs being detected as static)
        // Skip dynamic detection if user is in the middle of spelling (unless it's ASL Z)
        if (localModelDynamic && localLabelsDynamic.length && !staticAllowed) {
            // If this is the first frame of dynamic detection, start the timer
            if (dynamicBufferStartTime === 0) {
                dynamicBufferStartTime = Date.now();
            }

            // Add current frame to the dynamic frame buffer
            dynamicFrameBuffer.push(flatNormal);

            // Keep buffer at fixed size (remove oldest if too many)
            if (dynamicFrameBuffer.length > MAX_DYNAMIC_FRAMES) {
                dynamicFrameBuffer.shift();
            }

            // Check if we've collected enough frames to analyze
            const dynamicReady = (Date.now() - dynamicBufferStartTime) >= DYNAMIC_ANALYZE_MS;

            // Wait at least 1.5 seconds to analyze motion before predicting dynamic signs
            if (dynamicFrameBuffer.length >= 1 && dynamicReady) {
                // Pad the buffer to MAX_DYNAMIC_FRAMES by repeating the last frame
                // The dynamic model expects a fixed number of frames
                const paddedFrames = [...dynamicFrameBuffer];
                const lastFrame = paddedFrames[paddedFrames.length - 1];
                while (paddedFrames.length < MAX_DYNAMIC_FRAMES) {
                    paddedFrames.push(lastFrame);
                }

                // Create a 3D tensor for the dynamic model (batch, frames, features)
                const tensorDynamic = tf.tensor3d([paddedFrames]);
                // Run prediction on the dynamic model
                const predDynamic = localModelDynamic.predict(tensorDynamic);
                // Extract the best prediction from the tensor
                const { conf, label: predictedDynamicLabel } = getPredictionFromTensor(predDynamic, localLabelsDynamic);

                // --- Validate dynamic prediction ---
                // Keep dynamic predictions unboosted to reduce false positives
                // But still enforce hand-count requirements when available
                // Allow dynamic during spelling only if word is empty or it's ASL Z
                const allowDynamicDuringSpelling = accumulatedWord.length === 0 || isASLDynamicSpellingLetter(predictedDynamicLabel);
                // Check if motion is strong enough (especially important for ASL Z)
                const strongEnoughForZ = hasStrongASLZMotion(predictedDynamicLabel, conf, paddedFrames);
                // Add to candidates if all validations pass
                if (allowDynamicDuringSpelling && strongEnoughForZ && labelMatchesDetectedHands(predictedDynamicLabel, detectedHandCount)) {
                    candidates.push({
                        label: predictedDynamicLabel,
                        conf: conf,
                        source: 'Dynamic',
                        isDynamic: true
                    });
                }
                // Clean up tensors to prevent memory leaks
                tensorDynamic.dispose();
                predDynamic.dispose();
            }
        }

        // --- Step 4: Find Best Candidate with local/web-trained priority ---
        // Choose the best prediction from all candidates using priority rules
        const best = chooseBestCandidateWithLocalPriority(candidates);

        // --- Step 5: Threshold & Display ---
        if (best) {
            // Normalize the label (uppercase letters, etc.)
            // For dynamic signs, use the label directly; for static, smooth it first
            let outputLabel = best.isDynamic ? normalizeAlphabetLabel(best.label) : normalizeAlphabetLabel(getSmoothedPrediction(best.label));

            // --- Hardcoded overrides for ASL (to fix known misclassifications) ---
            // These are corrections for signs that the server model frequently misclassifies
            if (localStorageModelKey === 'my-asl-model' && best.source && best.source.startsWith('Server')) {
                if (outputLabel === 'D') outputLabel = '1';
                if (outputLabel === 'R') outputLabel = '3';
                if (outputLabel === 'W') outputLabel = '6';
                if (outputLabel === 'F') outputLabel = '9';
            }

            // Apply ISL-specific hand count disambiguation rules
            outputLabel = applyISLHandCountDisambiguation(outputLabel, detectedHandCount);
            // Update the stored prediction and frame
            updateDisplayedPrediction(outputLabel, best.conf, !!best.isDynamic, flatNormal);

            // --- Handle single letters/numbers (spelling mode) ---
            if (outputLabel.length === 1 && /^[a-zA-Z0-9]$/.test(outputLabel)) {
                // Dynamic ASL Z is movement-based, use cooldown instead of hold timing
                if (best.isDynamic && isASLDynamicSpellingLetter(outputLabel)) {
                    processDynamicPredictedLetter(outputLabel, best.conf);
                } else {
                    // Static letters use hold timing (must hold for 1 second)
                    processPredictedLetter(outputLabel);
                }
                // Show the result with a dynamic indicator if applicable
                const dynamicTag = best.isDynamic ? ' 🔄' : '';
                setResultText(`Sign: ${outputLabel}${dynamicTag} (${Math.round(best.conf * 100)}%)`);
            }
            // --- Handle dynamic signs (non-letter) with high confidence ---
            else if (best.isDynamic && best.conf > 0.85 && accumulatedWord.length === 0) {
                // Require high confidence for dynamic non-letter signs
                setResultText(`Sign: ${outputLabel} 🔄 (${Math.round(best.conf * 100)}%)`);

                // Change-only speaking: only speak when the sign changes
                // This prevents repeating the same word over and over
                const isDifferentSign = outputLabel !== lastSpokenLabel;

                if (isDifferentSign) {
                    speakText(outputLabel);
                    lastSpokenLabel = outputLabel;
                    lastSpokenTime = Date.now();
                }

                // Clear the dynamic buffer after confident detection
                setTimeout(() => {
                    dynamicFrameBuffer = [];
                    dynamicBufferStartTime = 0;
                }, 500);  // Small delay before clearing
            }
            // --- Handle static signs (non-letter) when not spelling ---
            else if (accumulatedWord.length === 0) {
                // Only show non-dynamic/non-letter signs if not spelling
                setResultText(`Sign: ${outputLabel} (${Math.round(best.conf * 100)}%)`);
                if (outputLabel !== lastSpokenLabel) {
                    speakText(outputLabel);
                    lastSpokenLabel = outputLabel;
                    lastSpokenTime = Date.now();
                }
            }
            // --- Handle case when user is spelling (waiting for next letter) ---
            else if (accumulatedWord.length > 0) {
                setResultText(WAITING_FOR_NEXT_LETTER_TEXT);
            }
        } else {
            // --- No confident prediction ---
            if (accumulatedWord.length > 0) {
                // If spelling, show waiting message
                setResultText(WAITING_FOR_NEXT_LETTER_TEXT);
            } else if (lastDisplayedPrediction) {
                // Only show last prediction if not spelling
                const last = lastDisplayedPrediction;
                const displayText = last.isDynamic ? `${normalizeAlphabetLabel(last.label)} 🔄` : normalizeAlphabetLabel(last.label);
                setResultText(`Sign: ${displayText} (${Math.round(last.conf * 100)}%)`);
            }
            // Don't show "Listening..." - just keep previous prediction or blank
        }
    });  // End of tf.tidy (automatic tensor cleanup)
}

// ==================== MEDIAPIPE RESULTS HANDLER ====================

// Function: Handle results from MediaPipe hand detection
// This is called every time MediaPipe detects hands in the video frame
// It updates the skeleton display and runs predictions
function onResults(results) {
    // Get the detected hand landmarks (empty array if no hands)
    const handLandmarks = results.multiHandLandmarks || [];

    if (handLandmarks.length > 0) {
        // --- Hands detected ---
        // Clear the timeout (we have hands, no need to show "waiting")
        lastHandDetectedTime = Date.now();
        // If spelling, keep the spelling window alive while hands are in frame
        if (accumulatedWord.length > 0) {
            lastLetterTime = Date.now();
        }
        // Clear the no-hands timeout if it was set
        if (noHandsTimeoutId) {
            clearTimeout(noHandsTimeoutId);
            noHandsTimeoutId = null;
        }

        // Count detected hands (max 2)
        const detectedHandCount = Math.min(2, handLandmarks.length);

        // Update the skeleton targets for smooth rendering
        updateSkeletonTargets(handLandmarks);

        // Run prediction on the primary hand (first hand detected)
        // Predict only once to avoid duplicate/competing outputs
        runPrediction(handLandmarks[0], detectedHandCount);
    } else {
        // --- No hands detected ---
        // Set a timeout to show "Waiting for hands..." message
        if (!noHandsTimeoutId) {
            noHandsTimeoutId = setTimeout(() => {
                setResultText("Waiting for hands...");
                noHandsTimeoutId = null;

                // If hand disappears while spelling, finalize the word
                if (accumulatedWord.length > 0) {
                    finishSpelling(true);
                }
            }, NO_HANDS_TIMEOUT_MS);
        }

        // Reset state on hand loss to allow double letters
        // When hand reappears, we want to be able to detect the same letter again
        if (lastAddedLetter !== null) {
            lastAddedLetter = null;
        }
        // Clear hold tracking so letters don't accumulate after a break
        heldLetter = null;
        holdStartTime = 0;
        predictionBuffer.length = 0;
        dynamicFrameBuffer = [];
        dynamicBufferStartTime = 0;
        resetMotionState();
        clearSkeletonTargets();
    }
}

// ==================== SPELLING LOGIC ====================

// This section handles the spelling mode where users spell words letter by letter
// We use a hold-based filter: a letter sign must be held for at least
// `minimumHoldDuration` before it is actually added to the word
// This prevents quick hand movements from being misinterpreted as multiple letters

// How long the user must hold a letter before it's added (1 second)
const minimumHoldDuration = 1000;
// When the user started holding the current letter
let holdStartTime = 0;
// The letter currently being held
let heldLetter = null;
// Cooldown time between dynamic letters (to prevent rapid-fire adding)
const DYNAMIC_LETTER_COOLDOWN_MS = 1200;
// When the last dynamic letter was added
let lastDynamicLetterAddedAt = 0;

// Function: Handle adding a letter to the spelled word
// This is called after the hold check succeeds (user held the letter long enough)
function handleSpelling(letter) {
    // This helper is now only called after the hold check succeeds
    const now = Date.now();
    // Update the time when the last letter was added
    lastLetterTime = now;

    // --- State-Based Filtering: avoid duplicates ---
    // Don't add the same letter twice in a row
    if (letter === lastAddedLetter) {
        return;
    }

    // Remember this letter as the last one added
    lastAddedLetter = letter;
    // Add the letter to the accumulated word
    accumulatedWord += letter;

    // When starting to spell, reset dynamic frame buffer to avoid interference
    // This prevents dynamic sign detection from interfering with spelling
    dynamicFrameBuffer = [];
    dynamicBufferStartTime = 0;

    // Update the spelling display on screen
    updateSpellingDisplay();
}

// Function: Process predicted letter with hold timing
// Called from the prediction loop instead of handleSpelling directly
// This ensures the same letter is being observed continuously for the required
// duration before committing it. If the visible prediction changes, the timer resets.
// This prevents quick hand movements from being misinterpreted as multiple letters
function processPredictedLetter(letter) {
    const now = Date.now();

    if (letter === heldLetter) {
        // User is still holding the same letter
        // If this is the first time we saw this letter, start the timer
        if (holdStartTime === 0) {
            holdStartTime = now;
        }

        // Check if user has held the letter long enough (1 second)
        if (now - holdStartTime >= minimumHoldDuration) {
            // Enough time has passed; actually add the letter to the word
            handleSpelling(letter);
            // Reset so a fresh hold is required for the next letter
            heldLetter = null;
            holdStartTime = 0;
        }
    } else {
        // Sign changed: start a new hold timer for the new letter
        heldLetter = letter;
        holdStartTime = now;
    }
}

// Function: Process dynamic predicted letter (for ASL Z)
// Dynamic letters (like ASL Z) use cooldown instead of hold timing
// Because they're movement-based, we can't use the same hold logic
function processDynamicPredictedLetter(letter, confidence = 0) {
    const now = Date.now();
    // Require minimum confidence for dynamic letters
    if (confidence < 0.7) return;
    // Enforce cooldown between dynamic letters to prevent rapid-fire adding
    if (now - lastDynamicLetterAddedAt < DYNAMIC_LETTER_COOLDOWN_MS) return;

    // Add the letter to the word
    handleSpelling(letter);
    // Update the last dynamic letter time
    lastDynamicLetterAddedAt = now;
}

// Function: Update the spelling display on screen
// Shows the current word being spelled in an overlay
function updateSpellingDisplay() {
    // Get the overlay and text elements
    const overlay = document.getElementById('spelling-overlay');
    const textEl = document.getElementById('spelling-text');

    if (accumulatedWord.length > 0) {
        // If there's a word being spelled, show the overlay
        if (overlay) overlay.style.display = 'block';
        if (textEl) textEl.innerText = accumulatedWord;
    } else {
        // If no word being spelled, hide the overlay
        if (overlay) overlay.style.display = 'none';
        if (textEl) textEl.innerText = "";
    }
}

// --- Spelling Inactivity Check ---
// This interval checks if the user has stopped spelling
// If no new letters are added for 5 seconds, the word is finalized
setInterval(() => {
    if (accumulatedWord.length > 0) {
        const now = Date.now();
        // If it's been 5 seconds since the last letter, finish the word
        if (now - lastLetterTime > SPELLING_IDLE_TIMEOUT_MS) {
            finishSpelling();
        }
    }
}, 500);  // Check every 500 milliseconds

// Function: Finish spelling and output the word
// This is called when the user stops spelling (timeout or hand loss)
function finishSpelling(forceSpeak = false) {
    // Format the word: first letter uppercase, rest lowercase
    const wordToSpeak = accumulatedWord.charAt(0).toUpperCase() + accumulatedWord.slice(1).toLowerCase();

    // Speak the whole word when TTS is ON
    if (isTTSOn) {
        speakText(wordToSpeak);
    }

    // Show the spelled word in the main result area
    setResultText(`Spelled: ${wordToSpeak}`);

    // Reset spelling state for the next word
    accumulatedWord = "";
    lastAddedLetter = null;
    updateSpellingDisplay();
}

// ==================== CAMERA LOGIC ====================

// Function: Start the camera
// This requests camera access with multiple fallback options
// It tries different resolution/quality settings until one works
async function startCamera() {
    try {
        // Stop any previous stream/loop before starting a new one
        stopCamera();

        // Define multiple camera constraint options (for fallback)
        // We try from highest quality to lowest quality
        const videoConstraintCandidates = [
            // Option 1: Highest quality (with resize mode)
            {
                facingMode: 'user',  // Front-facing camera
                width: { ideal: IS_MOBILE_DEVICE ? 960 : 1280 },  // Lower resolution for mobile
                height: { ideal: IS_MOBILE_DEVICE ? 540 : 720 },
                aspectRatio: { ideal: 16 / 9 },  // 16:9 widescreen
                frameRate: { ideal: 30, max: 30 },  // 30 FPS
                resizeMode: 'none'  // Don't let browser resize
            },
            // Option 2: High quality (without resize mode)
            {
                facingMode: 'user',
                width: { ideal: IS_MOBILE_DEVICE ? 960 : 1280 },
                height: { ideal: IS_MOBILE_DEVICE ? 540 : 720 },
                aspectRatio: { ideal: 16 / 9 },
                frameRate: { ideal: 30, max: 30 }
            },
            // Option 3: Medium quality
            {
                facingMode: 'user',
                width: { ideal: IS_MOBILE_DEVICE ? 640 : 1280 },
                height: { ideal: IS_MOBILE_DEVICE ? 480 : 720 },
                frameRate: { ideal: 30, max: 30 }
            },
            // Option 4: Any resolution, just 30 FPS
            {
                facingMode: 'user',
                frameRate: { ideal: 30, max: 30 }
            },
            // Option 5: Default (no constraints)
            true
        ];

        // Try each constraint option until one works
        let lastCameraError = null;
        for (const videoConstraints of videoConstraintCandidates) {
            try {
                // Request camera access with these constraints
                localStream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints });
                break;  // If successful, stop trying other options
            } catch (constraintErr) {
                // If this option failed, save the error and try the next one
                lastCameraError = constraintErr;
                console.warn('Camera constraints failed, trying fallback...', constraintErr?.name || constraintErr);
            }
        }

        // If all options failed, throw an error
        if (!localStream) {
            throw lastCameraError || new Error('Unable to initialize camera stream.');
        }

        // Set the video element to show the camera stream
        videoElement.srcObject = localStream;

        // Start playing the video
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

        // Start the skeleton renderer (draws hand overlay)
        startSkeletonRenderer();

        // --- Camera Processing Loop ---
        // This function processes each video frame for hand detection
        const processFrame = async () => {
            // Stop processing if camera is off or no stream
            if (!isCamOn || !localStream) {
                return;
            }

            // Only process if in sign mode (not voice mode)
            if (isSignMode) {
                const now = performance.now();
                // Throttle hand detection to run at a fixed interval
                // This prevents the CPU from being overloaded
                if (!isHandInferencePending && (now - lastHandInferenceAt) >= HAND_INFERENCE_INTERVAL_MS) {
                    // Mark that we're processing a frame
                    isHandInferencePending = true;
                    lastHandInferenceAt = now;

                    try {
                        // Send the video frame to MediaPipe for hand detection
                        await hands.send({ image: videoElement });
                    } finally {
                        // Always clear the pending flag, even if there's an error
                        isHandInferencePending = false;
                    }
                }
            }

            // Schedule the next frame (creates a smooth processing loop)
            cameraLoopId = requestAnimationFrame(processFrame);
        };

        // Start the camera processing loop
        cameraLoopId = requestAnimationFrame(processFrame);

    } catch (err) {
        // If camera access fails, log error and alert user
        console.error("Error accessing camera:", err);
        alert("Could not access camera. Please allow permissions.");
    }
}

// Function: Stop the camera
// This stops the camera stream and all processing loops
function stopCamera() {
    // Stop the camera processing loop
    if (cameraLoopId) {
        cancelAnimationFrame(cameraLoopId);
        cameraLoopId = null;
    }

    // Stop the camera stream (turn off the camera)
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }

    // Reset hand detection state
    isHandInferencePending = false;
    lastHandInferenceAt = 0;
    // Stop the skeleton renderer
    stopSkeletonRenderer();
    // Clear the video element
    videoElement.srcObject = null;
    // Clear the canvas (remove hand overlay)
    if (canvasElement.width && canvasElement.height) {
        canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    }
}

// ==================== CAMERA BUTTON HANDLER ====================

// Camera button click handler - toggles camera on/off
camBtn.addEventListener('click', () => {
    // Toggle the camera state
    isCamOn = !isCamOn;
    // Get the placeholder element (shown when camera is off)
    const placeholder = document.getElementById('camera-off-placeholder');

    if (isCamOn) {
        // --- Turn camera on ---
        startCamera();
        // Update button icon to show camera is on
        camBtn.innerHTML = '<span class="material-icons">videocam</span>';
        // Remove red button style (red indicates off)
        camBtn.classList.remove('red-btn');
        // Hide the placeholder
        if (placeholder) placeholder.style.display = 'none';
        // Make video visible
        videoElement.style.opacity = '1';
    } else {
        // --- Turn camera off ---
        stopCamera();
        // Update button icon to show camera is off
        camBtn.innerHTML = '<span class="material-icons">videocam_off</span>';
        // Add red button style
        camBtn.classList.add('red-btn');

        // Clear the canvas
        canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
        // Clear the video stream
        videoElement.srcObject = null;
        // Hide the video
        videoElement.style.opacity = '0';
        // Show the placeholder
        if (placeholder) placeholder.style.display = 'flex';

        // Show message to user
        setResultText("Camera is off.");
    }
});

// ==================== TTS (TEXT-TO-SPEECH) LOGIC ====================

// TTS button click handler - toggles voice output on/off
ttsBtn.addEventListener('click', () => {
    // Toggle the TTS state
    isTTSOn = !isTTSOn;
    if (isTTSOn) {
        // --- Turn TTS on ---
        // Update button icon to show volume up
        ttsBtn.innerHTML = '<span class="material-icons">volume_up</span>';
        // Remove red button style
        ttsBtn.classList.remove('red-btn');

        // Initialize TTS based on platform
        if (window.capacitorTextToSpeech && window.capacitorTextToSpeech.TextToSpeech) {
            // Use Capacitor native TTS (for mobile apps)
            window.capacitorTextToSpeech.TextToSpeech.stop().catch(e => console.error(e));
        } else if (window.speechSynthesis) {
            // Use Web Speech API (for web browsers)
            // Cancel any stuck queues on Android WebView before initializing
            window.speechSynthesis.cancel();
            // Use a silent space instead of an empty string (empty string crashes some TTS engines)
            const initUtterance = new SpeechSynthesisUtterance(" ");
            initUtterance.lang = 'en-US';
            window.speechSynthesis.speak(initUtterance);
        }
    } else {
        // --- Turn TTS off ---
        // Update button icon to show volume off
        ttsBtn.innerHTML = '<span class="material-icons">volume_off</span>';
        // Add red button style
        ttsBtn.classList.add('red-btn');
        
        // Stop any current speech
        if (window.capacitorTextToSpeech && window.capacitorTextToSpeech.TextToSpeech) {
            window.capacitorTextToSpeech.TextToSpeech.stop().catch(e => console.error(e));
        } else if (window.speechSynthesis) {
            window.speechSynthesis.cancel();
        }
    }
});

// Function: Speak text using Text-to-Speech
// This speaks the given text if TTS is enabled or forced
// It uses either Capacitor native TTS (mobile) or Web Speech API (web)
function speakText(text, forceSpeak = false) {
    // Only speak if TTS is on or forced, and if there's text to speak
    if ((isTTSOn || forceSpeak) && text) {
        // --- Cross-tab debounce using localStorage ---
        // This prevents multiple tabs from speaking at the same time
        const now = Date.now();
        const lastGlobalSpeak = parseInt(localStorage.getItem('lastGlobalSpeakTime') || '0');

        // If another tab spoke recently (within 500ms), suppress this speech
        if (now - lastGlobalSpeak < 500) {
            console.log("Speech suppressed: global debounce active (translation.js).");
            return;
        }
        // Update the last speak time
        localStorage.setItem('lastGlobalSpeakTime', now.toString());

        // --- Speak using the appropriate TTS engine ---
        if (window.capacitorTextToSpeech && window.capacitorTextToSpeech.TextToSpeech) {
            // Use Capacitor native TTS (for mobile apps)
            window.capacitorTextToSpeech.TextToSpeech.speak({
                text: text,
                lang: 'en-US',  // Language: English (US)
                rate: 1.0,  // Normal speed
                pitch: 1.0,  // Normal pitch
                volume: 1.0,  // Full volume
            }).catch(e => console.error("Native TTS Error:", e));
        } else if (window.speechSynthesis) {
            // Use Web Speech API (for web browsers)
            // Crucial for Android WebView: clear the queue before adding a new utterance
            window.speechSynthesis.cancel();
            
            // Create a new utterance (speech request)
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.rate = 1.0;  // Normal speed
            // Explicitly setting the language is required for many mobile TTS engines
            utterance.lang = 'en-US';
            
            // Speak the text
            window.speechSynthesis.speak(utterance);
        }
    }
}

// ==================== UI PANEL FUNCTIONS ====================

// Function: Append speech caption to the caption log
// This adds a line of text to the speech caption display
// Used when speech recognition detects speech
function appendSpeechCaption(text) {
    // If caption log doesn't exist or no text, do nothing
    if (!speechCaptionLog || !text) return;

    // Clean up the text (remove extra whitespace)
    const cleaned = text.trim();
    if (!cleaned) return;

    // Remove the "empty" message if it exists
    const emptyMsg = speechCaptionLog.querySelector('.caption-log-empty');
    if (emptyMsg) {
        emptyMsg.remove();
    }

    // Create a new entry line
    const line = document.createElement('div');
    line.className = 'caption-log-entry';

    // Create the speaker label
    const speakerLabel = document.createElement('span');
    speakerLabel.className = 'caption-log-speaker';
    speakerLabel.textContent = 'You:';

    // Add the label and text to the line
    line.appendChild(speakerLabel);
    line.append(document.createTextNode(` ${cleaned}`));
    // Add the line to the caption log
    speechCaptionLog.appendChild(line);

    // Keep only the last 70 entries (remove oldest if too many)
    while (speechCaptionLog.children.length > 70) {
        speechCaptionLog.removeChild(speechCaptionLog.firstChild);
    }

    // Scroll to the bottom to show the newest entry
    speechCaptionLog.scrollTop = speechCaptionLog.scrollHeight;
}

// Function: Set the sign cards panel collapsed/expanded state
// This controls whether the sign cards panel is visible or hidden
function setSignCardsPanelCollapsed(collapsed) {
    // If elements don't exist, do nothing
    if (!signCardsPanelWindow || !signCardsToggleBtn) return;

    // Toggle the collapsed class on the panel
    signCardsPanelWindow.classList.toggle('collapsed', collapsed);
    // Update the accessibility attribute
    signCardsToggleBtn.setAttribute('aria-expanded', String(!collapsed));
    // Update the button tooltip
    signCardsToggleBtn.setAttribute('title', collapsed ? 'Show sign cards' : 'Hide sign cards');
}

// Function: Set the caption log collapsed/expanded state
// This controls whether the caption log is visible or hidden
function setCaptionLogCollapsed(collapsed) {
    // If elements don't exist, do nothing
    if (!captionLogWindow || !captionToggleBtn) return;

    // Toggle the collapsed class on the panel
    captionLogWindow.classList.toggle('collapsed', collapsed);
    // Update the accessibility attribute
    captionToggleBtn.setAttribute('aria-expanded', String(!collapsed));
    // Update the button tooltip
    captionToggleBtn.setAttribute('title', collapsed ? 'Show captions' : 'Hide captions');
}

// Initialize panels to expanded state on page load
setCaptionLogCollapsed(false);
setSignCardsPanelCollapsed(false);

// ==================== SPEECH RECOGNITION LOGIC (SPEECH TO SIGN) ====================

// Function: Initialize speech recognition
// This sets up speech recognition to convert speech to text
// Used in voice mode (as opposed to sign mode)
async function initSpeechRecognition() {
    // If already initialized, return the existing recognition object
    if (recognition) return recognition;
    
    // Variables to track the last captions (for duplicate detection)
    let lastFinalCaption = '';
    let lastFinalCaptionAt = 0;

    // Helper: Normalize transcript text for comparison
    // Converts to lowercase, removes punctuation, normalizes spaces
    const normalizeTranscript = (text) => String(text || '')
        .toLowerCase()
        .replace(/[^\w\s]|_/g, '')  // Remove punctuation and special characters
        .replace(/\s+/g, ' ')  // Normalize multiple spaces to single space
        .trim();  // Remove leading/trailing spaces

    // Handler: Process final transcript (when speech recognition completes)
    const handleFinalTranscript = (text) => {
        // Only process if in voice mode (not sign mode)
        if (isSignMode) return;

        // Clean up the text
        const finalized = String(text || '').trim();
        if (!finalized) return;
        const now = Date.now();
        const normalized = normalizeTranscript(finalized);
        if (!normalized) return;

        // Check for duplicate (same caption within 4.5 seconds)
        const isDuplicate = normalized === lastFinalCaption && (now - lastFinalCaptionAt) < 4500;
        if (isDuplicate) {
            console.log('STT duplicate suppressed:', finalized);
            return;
        }

        // Remember this caption
        lastFinalCaption = normalized;
        lastFinalCaptionAt = now;

        // Display the caption
        appendSpeechCaption(finalized);
        displaySignCards(finalized);
        setResultText(finalized);
    };

    // Variables to track partial transcripts (for duplicate detection)
    let lastPartialSentText = '';
    let lastPartialSentAt = 0;
    
    // Handler: Process partial transcript (while speech is being recognized)
    const handlePartialTranscript = (text) => {
        // Only process if in voice mode
        if (isSignMode) return;
        // Clean up the text
        const partial = String(text || '').trim();
        // Only process if at least 4 characters (too short otherwise)
        if (!partial || partial.length < 4) return;

        const now = Date.now();
        // Check for duplicate or too soon (within 350ms)
        const isDuplicate = partial.toLowerCase() === lastPartialSentText.toLowerCase();
        const tooSoon = (now - lastPartialSentAt) < 350;
        if (isDuplicate || tooSoon) return;

        // Remember this partial transcript
        lastPartialSentText = partial;
        lastPartialSentAt = now;
        // Show "Listening" status with partial text
        setResultText(`Listening: ${partial}`);
    };

    // Function: Restart speech recognition after an error or stop
    // This helps keep speech recognition running continuously
    const restartRecognition = async (delayMs = 450) => {
        // Only restart if in voice mode and recognition exists
        if (isSignMode || !recognition) return;

        // Clear any existing restart timer
        if (speechRestartTimer) {
            clearTimeout(speechRestartTimer);
            speechRestartTimer = null;
        }

        // Set a timer to restart after a delay
        speechRestartTimer = setTimeout(async () => {
            speechRestartTimer = null;
            // Check again before restarting (mode might have changed)
            if (isSignMode || !recognition) return;

            console.log("Restarting speech recognition...");
            try {
                await recognition.start();
            } catch (e) {
                console.error("Error restarting recognition:", e);
            }
        }, delayMs);
    };

    // --- Try to use native speech recognition (Capacitor plugin for mobile) ---
    if (nativeSpeechBridge && nativeSpeechBridge.isSupportedCandidate()) {
        // Check if native speech recognition is available
        const nativeAvailable = await nativeSpeechBridge.isAvailable();
        if (nativeAvailable) {
            // Create a native speech recognition session
            const session = await nativeSpeechBridge.createSession({
                lang: 'en-US',  // Language: English (US)
                partialResults: true,  // Get partial results while speaking
                onStart: () => {
                    // Called when speech recognition starts
                    if (!isSignMode) {
                        setResultText('Listening... speak now');
                    }
                },
                onFinal: (data) => {
                    // Called when final transcript is ready
                    handleFinalTranscript(data && data.transcript);
                },
                onPartial: (data) => {
                    // Called when partial transcript is ready
                    handlePartialTranscript(data && data.transcript);
                },
                onError: (data) => {
                    // Called when an error occurs
                    const errorCode = data && data.error;
                    console.error("Speech recognition error:", errorCode || (data && data.message));
                    // If error is "busy", restart after 1.4 seconds
                    if (errorCode === 'busy') {
                        restartRecognition(1400);
                    } else if (errorCode === 'no-match' || errorCode === 'no-speech') {
                        // No speech detected or no match, restart after 1.4 seconds
                        restartRecognition(1400);
                    } else if (errorCode === 'network') {
                        // Network error, restart after 2 seconds
                        restartRecognition(2000);
                    } else if (errorCode === 'not-allowed') {
                        // Permission denied, show error message
                        setResultText("Microphone permission denied for speech mode.");
                    } else if (errorCode === 'service-not-allowed') {
                        // Service not available, show error message
                        setResultText("Speech service unavailable on this phone.");
                    }
                },
                onEnd: (data) => {
                    // Called when speech recognition session ends
                    console.log("Speech recognition ended.");
                    const restartable = data && data.restartable !== false;
                    // If restartable, restart after 1.3 seconds
                    if (restartable) {
                        restartRecognition(1300);
                    }
                }
            });

            // Create a recognition object with start/stop methods
            recognition = {
                async start() {
                    // Start the native speech recognition session
                    const started = await session.start({ lang: 'en-US', partialResults: true });
                    if (!isSignMode) {
                        setResultText('Listening... speak now');
                    }
                    return started;
                },
                async stop() {
                    // Stop the native speech recognition session
                    return session.stop();
                }
            };

            return recognition;
        }
    }

    // --- Fallback: Use Web Speech API (for web browsers) ---
    // If native speech recognition is not available, try Web Speech API

    // Get the Web Speech API class (different names in different browsers)
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        // If Web Speech API is not available, show error message
        setResultText("Speech-to-text is not available on this device/browser.");
        return null;
    }

    // Create a new Web Speech Recognition instance
    recognition = new SpeechRecognition();
    recognition.continuous = true;  // Keep listening even after speech is detected
    recognition.interimResults = true;  // Get partial results while speaking
    recognition.lang = 'en-US';  // Language: English (US)

    // Handle speech recognition results
    recognition.onresult = (event) => {
        let finalTranscript = '';

        // Go through all results (from current index to end)
        for (let i = event.resultIndex; i < event.results.length; ++i) {
            const transcript = event.results[i][0].transcript;

            // If this is a final result, add it to the transcript
            if (event.results[i].isFinal) {
                finalTranscript += transcript + ' ';
            }
        }

        // Process the final transcript
        handleFinalTranscript(finalTranscript);
    };

    // Handle speech recognition errors
    recognition.onerror = (event) => {
        console.error("Speech recognition error:", event.error);
        if (event.error === 'busy') {
            restartRecognition(1400);
        } else if (event.error === 'no-match' || event.error === 'no-speech') {
            restartRecognition(1400);
        } else if (event.error === 'network') {
            restartRecognition(2000);
        }
    };

    // Handle speech recognition end (restart to keep it running)
    recognition.onend = () => {
        console.log("Speech recognition ended.");
        restartRecognition(1300);
    };

    return recognition;
}

// ==================== SIGN CARDS (TRANSLATION) ====================

// Cache to track which sign card images exist (avoids repeated checks)
const translationImageExistsCache = new Map();
// Map of phrase mappings for different languages
let translationPhraseMap = { common: {}, asl: {}, isl: {} };
// Map digits to their word equivalents (for sign card lookup)
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
// Queue for sign cards to display
const translationCardQueue = [];
// Maximum number of sign cards to show at once
const TRANSLATION_MAX_CARD_TOKENS = 260;

// Function: Get the sign cards display area
// Returns the element where sign cards should be shown
function getTranslationCardArea() {
    return signCardsOutput || document.querySelector('.prediction-sign-cards-container');
}

// Function: Load the phrase map for sign card lookup
// This loads a JSON file that maps phrases to their component words
async function loadTranslationPhraseMap() {
    try {
        // Fetch the phrase map JSON file
        const response = await fetch('/signs-images/phrase-map.json', { cache: 'no-cache' });
        if (!response.ok) return;
        // Parse the JSON
        const json = await response.json();
        // Store the phrase maps for each language
        translationPhraseMap = {
            common: json.common || {},
            asl: json.asl || {},
            isl: json.isl || {}
        };
    } catch (err) {
        console.warn('Failed to load phrase-map.json for translation view.', err);
    }
}
// Load the phrase map when the page loads
loadTranslationPhraseMap();

// Function: Get the language folder for sign cards
// Returns 'asl' or 'isl' based on the current model
function getTranslationLangFolder() {
    return localStorageModelKey === 'my-asl-model' ? 'asl' : 'isl';
}

// Function: Check if a sign card image exists
// This tries to load an image and returns true if it exists, false otherwise
// Uses a cache to avoid repeated checks for the same URL
function checkTranslationImageExists(url) {
    // If we've already checked this URL, return the cached result
    if (translationImageExistsCache.has(url)) {
        return Promise.resolve(translationImageExistsCache.get(url));
    }

    // Try to load the image
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            // Image loaded successfully - cache and return true
            translationImageExistsCache.set(url, true);
            resolve(true);
        };
        img.onerror = () => {
            // Image failed to load - cache and return false
            translationImageExistsCache.set(url, false);
            resolve(false);
        };
        img.src = url;
    });
}

// Function: Resolve word to sign card image URLs
// This takes a word and returns a list of possible image URLs to try
// It tries different variations of the word (exact, digit-to-word, etc.)
async function resolveTranslationWordTokens(word, langFolder) {
    // Normalize the word (lowercase, remove special characters)
    const normalizedWord = word.toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (!normalizedWord) return [];

    // Build a list of candidate image URLs to try
    const wordCandidates = [
        // Try the exact word first (in words folder)
        `/signs-images/${langFolder}/words/${normalizedWord}.jpg`,
        `/signs-images/${langFolder}/words/${normalizedWord}.png`,
        `/signs-images/${langFolder}/words/${normalizedWord}.gif`,
        // Try the exact word in root folder
        `/signs-images/${langFolder}/${normalizedWord}.jpg`,
        `/signs-images/${langFolder}/${normalizedWord}.png`,
        `/signs-images/${langFolder}/${normalizedWord}.gif`
    ];

    // Try each candidate URL until one exists
    for (const src of wordCandidates) {
        if (await checkTranslationImageExists(src)) {
            // Found a matching image - return it
            return [{ type: 'card', src, label: normalizedWord }];
        }
    }

    // --- Fallback: Try individual characters ---
    // If no word image exists, try to show each character separately
    const charTokens = [];
    const charsOnly = normalizedWord.replace(/-/g, '');  // Remove hyphens
    for (const char of charsOnly.toUpperCase()) {
        // Skip non-alphanumeric characters
        if (!/[A-Z0-9]/.test(char)) continue;

        const candidates = [];
        if (/[A-Z]/.test(char)) {
            // For letters, try the letter image
            candidates.push(`/signs-images/${langFolder}/characters/${char}.jpg`);
            candidates.push(`/signs-images/${langFolder}/characters/${char}.png`);
            candidates.push(`/signs-images/${langFolder}/characters/${char}.gif`);
        } else {
            // For digits, try the digit image and the word equivalent
            candidates.push(`/signs-images/${langFolder}/characters/${char}.jpg`);
            candidates.push(`/signs-images/${langFolder}/characters/${char}.png`);
            candidates.push(`/signs-images/${langFolder}/characters/${char}.gif`);
            const digitWord = TRANSLATION_DIGIT_WORD_MAP[char];
            if (digitWord) {
                // Also try the word (e.g., '1' -> 'one')
                candidates.push(`/signs-images/${langFolder}/characters/${digitWord}.jpg`);
                candidates.push(`/signs-images/${langFolder}/characters/${digitWord}.png`);
                candidates.push(`/signs-images/${langFolder}/characters/${digitWord}.gif`);
            }
        }

        // Try each candidate for this character
        let chosen = null;
        for (const src of candidates) {
            if (await checkTranslationImageExists(src)) {
                chosen = src;
                break;
            }
        }

        // If we found an image for this character, add it
        if (chosen) charTokens.push({ type: 'card', src: chosen, label: char });
    }

    // Return character tokens if found, otherwise return as a text label
    return charTokens.length ? charTokens : [{ type: 'label', label: normalizedWord }];
}

// Function: Resolve a phrase to its mapped key
// This looks up a phrase in the phrase map to find a better match
// For example, "thank you" might map to a specific sign image
function resolveTranslationMappedPhrase(phrase, langFolder) {
    // Get the language-specific phrase map
    const perLangMap = translationPhraseMap[langFolder] || {};
    // Check if the phrase exists in the language-specific map
    if (perLangMap[phrase]) return perLangMap[phrase];
    // Fall back to the common phrase map
    return translationPhraseMap.common[phrase] || null;
}

// Function: Build translation card units from words
// This groups words into phrases (when a phrase has a specific sign) or individual words
// This helps show the correct sign cards for multi-word phrases
function buildTranslationCardUnits(words, langFolder) {
    const units = [];
    let index = 0;

    // Process each word or phrase
    while (index < words.length) {
        let matched = null;
        // Maximum phrase length is 4 words
        const maxLen = Math.min(4, words.length - index);

        // Try to match phrases from longest to shortest (4 words, then 3, then 2)
        for (let phraseLen = maxLen; phraseLen >= 2; phraseLen--) {
            const phraseWords = words.slice(index, index + phraseLen);
            const phraseText = phraseWords.join(' ');
            // Check if this phrase has a mapped sign
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
            // Found a phrase match - add it and skip those words
            units.push(matched);
            index += matched.words.length;
        } else {
            // No phrase match - add as individual word
            units.push({ type: 'word', text: words[index] });
            index += 1;
        }
    }

    return units;
}

// Function: Resolve a translation unit to sign card tokens
// This takes a unit (word or phrase) and resolves it to actual image URLs
async function resolveTranslationUnitTokens(unit, langFolder) {
    if (unit.type === 'word') {
        // For individual words, resolve directly
        return resolveTranslationWordTokens(unit.text, langFolder);
    }

    // --- For phrases ---
    // Try to resolve the mapped key to a single image
    const mappedTokens = await resolveTranslationWordTokens(unit.mappedKey, langFolder);
    const mappedCardToken = mappedTokens.find(t => t.type === 'card');
    if (mappedCardToken) {
        // Found a single image for the whole phrase
        return [{ type: 'card', src: mappedCardToken.src, label: unit.phraseText }];
    }

    // --- Fallback: Resolve each word in the phrase separately ---
    const fallbackTokens = [];
    for (let i = 0; i < unit.words.length; i++) {
        const wordTokens = await resolveTranslationWordTokens(unit.words[i], langFolder);
        fallbackTokens.push(...wordTokens);
        // Add space between words (except after last word)
        if (i < unit.words.length - 1) fallbackTokens.push({ type: 'space' });
    }
    return fallbackTokens;
}

/**
 * Renders the state of translationCardQueue to the UI.
 * This function takes the queue of sign cards and displays them on screen
 * It organizes cards into lines and groups for proper layout
 */
function renderTranslationCardQueue() {
    const cardArea = getTranslationCardArea();
    if (!cardArea) return;

    // Clear the card area
    cardArea.innerHTML = '';
    // Show/hide the active class based on whether there are cards
    cardArea.classList.toggle('active', translationCardQueue.length > 0);

    // --- Organize tokens into lines and groups ---
    const lineGroups = [];
    let currentLine = [];
    let currentGroup = [];
    for (const token of translationCardQueue) {
        if (token.type === 'linebreak') {
            // Line break: finish current group and line
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
            // Space: finish current group but stay on same line
            if (currentGroup.length) {
                currentLine.push(currentGroup);
                currentGroup = [];
            }
            continue;
        }

        // Add the token to the current group
        currentGroup.push(token);
    }
    // Finish the last group and line
    if (currentGroup.length) currentLine.push(currentGroup);
    if (currentLine.length) lineGroups.push(currentLine);

    // --- Render each line of cards ---
    lineGroups.forEach((line) => {
        // Create a line element
        const lineEl = document.createElement('div');
        lineEl.className = 'prediction-sign-line';
        lineEl.style.flexWrap = 'nowrap';  // Don't wrap cards to next line
        lineEl.style.gap = '25px';  // Gap between groups
        lineEl.style.flexShrink = '0';  // Don't shrink

        // Render each group in the line
        line.forEach((group) => {
            // Create a group element (for words)
            const wordGroupEl = document.createElement('div');
            wordGroupEl.className = 'prediction-word-group';
            wordGroupEl.style.flexWrap = 'nowrap';
            wordGroupEl.style.alignItems = 'flex-start';
            wordGroupEl.style.gap = '10px';  // Gap between cards
            wordGroupEl.style.flexShrink = '0';

            // Render each card in the group
            group.forEach((token) => {
                // Create a card element
                const card = document.createElement('div');
                card.className = 'prediction-sign-card';
                card.style.width = '78px';
                card.style.height = '88px';
                card.style.border = '1px solid rgba(148,163,184,0.35)';
                card.style.background = 'rgba(15,23,42,0.92)';
                card.style.padding = '5px';
                card.style.flexShrink = '0';

                // If it's a card type, add the image
                if (token.type === 'card') {
                    const img = document.createElement('img');
                    img.src = token.src;
                    img.alt = token.label;
                    img.style.height = '50px';
                    img.style.objectFit = 'contain';
                    img.style.background = 'rgba(0,0,0,0.45)';
                    // Hide image if it fails to load
                    img.onerror = () => img.style.display = 'none';
                    card.appendChild(img);
                }

                // Add the label text
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

                // Add the card to the group
                wordGroupEl.appendChild(card);
            });
            // Add the group to the line
            lineEl.appendChild(wordGroupEl);
        });
        // Add the line to the card area
        cardArea.appendChild(lineEl);
    });
    
    // --- Auto-scroll to show new cards ---
    setTimeout(() => {
        // Scroll the sign cards panel to the bottom so newly added rows are visible
        cardArea.scrollTo({
            top: cardArea.scrollHeight,
            behavior: 'smooth'
        });

        // Horizontally pan the last (currently growing) line to reveal the newest card
        const lastLine = cardArea.querySelector('.prediction-sign-line:last-child');
        if (lastLine) {
            lastLine.scrollTo({
                left: lastLine.scrollWidth,
                behavior: 'smooth'
            });
        }
    }, 10);

    // Also scroll the speech caption log to the bottom if it exists
    if (speechCaptionLog) {
        speechCaptionLog.scrollTo({
            top: speechCaptionLog.scrollHeight,
            behavior: 'smooth'
        });
    }
}

// Function: Display sign cards for a given text
// This takes text (from speech recognition) and displays the corresponding sign cards
// It shows cards one by one with a streaming effect for better readability
async function displaySignCards(text) {
    const cardArea = getTranslationCardArea();
    if (!cardArea) return;

    // Split text into words and filter out empty strings
    const words = text.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
        // If no words, show placeholder if queue is empty
        if (translationCardQueue.length === 0) {
            cardArea.classList.remove('active');
            cardArea.innerHTML = '<div class="placeholder-msg">Sign Cards will appear here.</div>';
        }
        return;
    }

    // Get the language folder for sign cards
    const langFolder = getTranslationLangFolder();
    // Build translation units (words and phrases)
    const units = buildTranslationCardUnits(words, langFolder);

    // Process each unit (word or phrase)
    for (let i = 0; i < units.length; i++) {
        // Resolve the unit to sign card tokens
        const tokens = await resolveTranslationUnitTokens(units[i], langFolder);
        
        // Add each token (card/label) with a small delay for a streaming effect
        // This ensures long words enter the screen predictably and remain readable
        for (const token of tokens) {
            translationCardQueue.push(token);

            // --- Prune queue to prevent it from getting too large ---
            if (translationCardQueue.length > TRANSLATION_MAX_CARD_TOKENS) {
                const sliceStart = translationCardQueue.length - TRANSLATION_MAX_CARD_TOKENS;
                let trimmedQueue = translationCardQueue.slice(sliceStart);
                // Ensure we don't cut in the middle of a word
                if (sliceStart > 0 && !['space', 'linebreak'].includes(translationCardQueue[sliceStart-1]?.type)) {
                    while (trimmedQueue.length && !['space', 'linebreak'].includes(trimmedQueue[0].type)) {
                        trimmedQueue.shift();
                    }
                }
                translationCardQueue.length = 0;
                translationCardQueue.push(...trimmedQueue);
                // Remove leading spaces/linebreaks
                while (translationCardQueue.length && ['space', 'linebreak'].includes(translationCardQueue[0].type)) {
                    translationCardQueue.shift();
                }
            }

            // Re-render the queue to show the new card
            renderTranslationCardQueue();

            // Delay for readability (200ms pause after each image is generated)
            await new Promise(r => setTimeout(r, 200));
        }

        // Add linebreak after each word unit
        translationCardQueue.push({ type: 'linebreak' });
        renderTranslationCardQueue();

        // Extra gap between words (600ms pause)
        if (i < units.length - 1) {
            await new Promise(r => setTimeout(r, 600));
        }
    }
}

// ==================== SIGN/VOICE MODE TOGGLE ====================

// Function: Ensure the sign/voice toggle element exists
// This creates or retrieves the toggle button for switching between sign mode and voice mode
function ensureSignVoiceToggle() {
    // If it already exists, return it
    if (signVoiceToggle) return signVoiceToggle;

    // Try to get the toggle element by ID
    signVoiceToggle = document.getElementById('sign-voice-toggle');
    if (signVoiceToggle) return signVoiceToggle;

    // If not found, create the toggle button
    const controlBar = document.querySelector('.control-bar');
    if (!controlBar) return null;

    // Create the button element
    const btn = document.createElement('button');
    btn.id = 'sign-voice-toggle';
    btn.className = 'control-btn';
    btn.title = 'Switch between Sign and Voice Mode';
    btn.innerHTML = '<span class="material-icons">pan_tool</span>';  // Hand icon for sign mode
    controlBar.appendChild(btn);
    signVoiceToggle = btn;
    return signVoiceToggle;
}

// Function: Bind the sign/voice toggle button event handler
// This sets up the click handler for switching between sign mode and voice mode
function bindSignVoiceToggle() {
    const toggleBtn = ensureSignVoiceToggle();
    if (!toggleBtn) {
        console.warn('#sign-voice-toggle not found. Sign/Voice toggle is disabled.');
        return;
    }

    // Prevent binding the event multiple times
    if (toggleBtn.dataset.bound === 'true') return;
    toggleBtn.dataset.bound = 'true';

    // Set up the click handler
    toggleBtn.addEventListener('click', async () => {
        // Toggle the mode
        isSignMode = !isSignMode;
        
        // Use body class for robust CSS-based UI toggling
        document.body.classList.toggle('voice-mode-active', !isSignMode);

        if (isSignMode) {
            // --- Switch to Sign Mode ---
            // Update button icon to show hand (sign mode)
            toggleBtn.innerHTML = '<span class="material-icons">pan_tool</span>';
            toggleBtn.title = 'Switch to Voice Mode';

            // Start camera if needed
            if (isCamOn && !localStream) startCamera();
            // Stop speech recognition restart timer
            if (speechRestartTimer) {
                clearTimeout(speechRestartTimer);
                speechRestartTimer = null;
            }
            // Stop speech recognition
            if (recognition) {
                try {
                    await recognition.stop();
                } catch (error) {
                    console.error("Error stopping recognition:", error);
                }
            }
        } else {
            // --- Switch to Voice Mode ---
            // Update button icon to show microphone (voice mode)
            toggleBtn.innerHTML = '<span class="material-icons">mic</span>';
            toggleBtn.title = 'Switch to Sign Mode';

            // Start camera if needed (still need camera for sign cards display)
            if (isCamOn && !localStream) startCamera();
            // Clear the canvas (no hand detection needed in voice mode)
            canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

            // Initialize speech recognition if not already initialized
            if (!recognition) {
                await initSpeechRecognition();
            }

            // If speech recognition is not available, show error
            if (!recognition) {
                setResultText("Speech-to-text is unavailable on this phone/browser.");
                return;
            }

            // Start speech recognition with a small delay
            setTimeout(async () => {
                if (recognition) {
                    try {
                        await recognition.start();
                    } catch (e) {
                        console.error("Error starting recognition:", e);
                        setResultText(`Speech-to-text could not start: ${e && e.message ? e.message : 'unknown error'}`);
                    }
                }
            }, 500);
        }
    });
}

// Bind the toggle button (immediately and on DOM ready)
bindSignVoiceToggle();
document.addEventListener('DOMContentLoaded', bindSignVoiceToggle, { once: true });


// ==================== UTILITY FUNCTIONS ====================

// --- Legacy Mode Button Removed (replaced by Sign/Voice Toggle) ---
// The old modeBtn had two different modes (sign-to-text vs speech-to-sign)
// Now we have Sign Mode (sign detection) vs Voice Mode (speech recognition + captions)

// --- Drag to Scroll Utility ---
// This enables drag-to-scroll functionality for touch/mouse devices
// It allows users to scroll by dragging instead of using scrollbars
function enableDragToScroll(el, direction = 'both') {
    if (!el) return;
    let isDown = false;  // Track if mouse is down
    let startX, startY;  // Starting position
    let scrollLeft, scrollTop;  // Starting scroll position

    // Mouse down: start dragging
    el.addEventListener('mousedown', (e) => {
        isDown = true;
        el.style.cursor = 'grabbing';  // Change cursor to grabbing hand
        startX = e.pageX - el.offsetLeft;
        startY = e.pageY - el.offsetTop;
        scrollLeft = el.scrollLeft;
        scrollTop = el.scrollTop;
    });

    // Mouse leave: stop dragging
    el.addEventListener('mouseleave', () => {
        isDown = false;
        el.style.cursor = 'default';
    });

    // Mouse up: stop dragging
    el.addEventListener('mouseup', () => {
        isDown = false;
        el.style.cursor = 'default';
    });

    // Mouse move: scroll if dragging
    el.addEventListener('mousemove', (e) => {
        if (!isDown) return;
        e.preventDefault();  // Prevent default selection
        
        // Handle horizontal scrolling
        if (direction === 'both' || direction === 'horizontal') {
            const x = e.pageX - el.offsetLeft;
            const walkX = (x - startX) * 2;  // Multiply for faster scrolling
            el.scrollLeft = scrollLeft - walkX;
        }
        
        // Handle vertical scrolling
        if (direction === 'both' || direction === 'vertical') {
            const y = e.pageY - el.offsetTop;
            const walkY = (y - startY) * 2;  // Multiply for faster scrolling
            el.scrollTop = scrollTop - walkY;
        }
    });
}

// Enable drag-to-scroll for the speech caption log (vertical only)
if (speechCaptionLog) {
    enableDragToScroll(speechCaptionLog, 'vertical');
}

// Enable drag-to-scroll for the sign cards area (horizontal only)
const cardArea = getTranslationCardArea();
if (cardArea) {
    enableDragToScroll(cardArea, 'horizontal');
}

// --- Caption Toggle Button Handler ---
// This button toggles the caption log panel collapsed/expanded
if (captionToggleBtn) {
    captionToggleBtn.addEventListener('click', () => {
        if (!captionLogWindow) return;
        // Toggle the collapsed state
        const willCollapse = !captionLogWindow.classList.contains('collapsed');
        setCaptionLogCollapsed(willCollapse);
    });
}

// --- Sign Cards Toggle Button Handler ---
// This button toggles the sign cards panel collapsed/expanded
if (signCardsToggleBtn) {
    signCardsToggleBtn.addEventListener('click', () => {
        if (!signCardsPanelWindow) return;
        // Toggle the collapsed state
        const willCollapse = !signCardsPanelWindow.classList.contains('collapsed');
        setSignCardsPanelCollapsed(willCollapse);
    });
}

// ==================== INITIALIZATION ====================

// Initialize: start camera if in sign mode and camera is on
if (isSignMode && isCamOn) {
    startCamera();
}
