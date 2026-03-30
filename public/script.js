import { db } from './firebase-config.js';
import { collection, addDoc, getDocs, deleteDoc, doc } from "firebase/firestore";

// Note: supabaseClient is initialized globally in videocall.html
let supabaseChannel = null;

// --- Persistence Configuration (Firestore) ---
// Default to ISL
let currentMode = 'ISL';
let dbCollection = 'gestures';
let localStorageModelKey = 'my-isl-model';
let localStorageLabelKey = 'isl_labels';

// Hybrid model support (same as translation.js)
let serverModel = null;
let serverLabels = [];
let model = null; // local model reference (used earlier)
let uniqueLabels = [];

// Dynamic sign support
let modelDynamic = null;
let uniqueLabelsDynamic = [];
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

// prediction buffer must exist before any model loading/prediction logic
const predictionBuffer = [];

// Spelling hold state (same feature added in translation.js)
const minimumHoldDuration = 1000; // ms
let holdStartTime = 0;
let heldLetter = null;
const DYNAMIC_LETTER_COOLDOWN_MS = 1200;
let lastDynamicLetterAddedAt = 0;

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

async function fetchCloudModel(type, lang) {
    try {
        const langLower = lang.toLowerCase();

        const { data: labelsUrlData } = window.supabaseClient.storage
            .from('models')
            .getPublicUrl(`${langLower}/${type}/labels.json`);

        const { data: modelUrlData } = window.supabaseClient.storage
            .from('models')
            .getPublicUrl(`${langLower}/${type}/model.json`);

        const labelsRes = await fetch(labelsUrlData.publicUrl);
        if (!labelsRes.ok) return null;
        const labels = normalizeLabelList(await labelsRes.json()).labels;

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

async function updateModeVariables() {
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
    // whenever the language mode changes, reload available models
    await loadModelsAndLabels();
}

// loadFromFirestore and updateDataStats removed

// Global State
let collectedData = [];
let batchQueue = []; // New data waiting to be uploaded

// Note: uniqueLabels is now maintained by loadModelsAndLabels so ensure
// the variable exists earlier. (declared above with models)

// --- DOM Elements ---
const joinScreen = document.getElementById('join-screen');
const joiningLoader = document.getElementById('joining-loader');
const meetingRoom = document.getElementById('meeting-room');
const newMeetingBtn = document.getElementById('newMeetingBtn');
const startRoomInput = document.getElementById('startRoomInput');
const lobbyStatus = document.getElementById('status');
let meetingStatusToastTimer = null;
let lastMeetingStatusToast = '';
let captionPanelDimTimer = null;
const userNameInput = document.getElementById('userNameInput');
const joinBtn = document.getElementById('joinBtn');
const clockElement = document.getElementById('clock');
const modeSelect = document.getElementById('modeSelect');

const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const localCanvas = document.getElementById('localCanvas');
const ctx = localCanvas.getContext('2d');
const meetingCodeDisplay = document.getElementById('meetingCodeDisplay');
const mobileMeetingCodeDisplay = document.getElementById('mobileMeetingCodeDisplay');
const predictionOverlay = document.getElementById('prediction-overlay');
const predictionDiv = document.getElementById('prediction');
const predictionSignCardsContainer = document.getElementById('prediction-sign-cards-container');
const captionLogWindow = document.getElementById('caption-log-window');
const captionToggleBtn = document.getElementById('captionToggleBtn');
const signCardsPanelWindow = document.getElementById('sign-cards-panel-window');
const signCardsToggleBtn = document.getElementById('signCardsToggleBtn');
const captionPanelViewport = document.getElementById('caption-panel-viewport');
const captionPanelTrack = document.getElementById('caption-panel-track');
const remotePredictionDiv = document.getElementById('remotePrediction');
const remoteCaptionOverlay = document.getElementById('remote-caption-overlay');

const micBtn = document.getElementById('micBtn');
const camBtn = document.getElementById('camBtn');
const hangupBtn = document.getElementById('hangupBtn');
const ttsBtn = document.getElementById('ttsBtn');

const sttToggleBtn = document.getElementById('sttToggleBtn');
const ttsToggleBtn = document.getElementById('ttsToggleBtn');
const captionLogList = document.getElementById('caption-log-list');
const localVolumeMeter = document.getElementById('localVolume');
const remoteVolumeMeter = document.getElementById('remoteVolume');
const moreOptionsBtn = document.getElementById('moreOptionsBtn');
const moreOptionsMenu = document.getElementById('moreOptionsMenu');
const speakerToggleBtn = document.getElementById('speakerToggleBtn');
const skeletonToggleBtn = document.getElementById('skeletonToggleBtn');

// Panels & Controls
const chatToggleBtn = document.getElementById('chatToggleBtn');
const chatPanel = document.getElementById('chat-panel');
const closeChatBtn = document.getElementById('closeChatBtn');

const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const sendChatBtn = document.getElementById('sendChatBtn');
const mobileCopyCodeBtn = document.getElementById('mobileCopyCodeBtn');

// --- Global State ---
let vcCardQueue = [];
let vcCardRenderSeq = 0;
let vcAutoHideTimeout = null;
let signCardsPanelManuallyCollapsed = false;
let localStream;
let pc;
let roomName;
let isMicOn = true;
let isCamOn = true;
let isTTSOn = false;
let isSTTOn = false;
let lastSpokenTime = 0;
let lastRemoteSpokenTime = 0;
let lastRemoteVolumeActiveTime = 0;
const localWordLastSpoken = {};    // NEW: Per-word cooldown for local signs
const remoteWordLastSpoken = {};   // NEW: Per-word cooldown for remote signs
let lastSpokenLabel = "";
let lastRemoteSpokenText = "";
let speakTimeout = null;           // NEW: Track pending speech to avoid race conditions
let iceCandidatesBuffer = []; // Buffer for ICE candidates
let isRecognitionActive = false;   // NEW: Track if SpeechRecognition is actually running
let isCreatingMeeting = false;    // NEW: Track if user is the meeting creator
let localName = "You";
let remoteName = "Remote User";
let activeCaptionPanelView = 'captions';
let lastSTTStartAt = 0;
let isRemoteAudioEnabled = JSON.parse(localStorage.getItem('vc-remote-audio-enabled') ?? 'true');
let isOverlayOn = JSON.parse(localStorage.getItem('vc-hand-overlay-enabled') ?? 'true');

function applyRemoteAudioPreference() {
    if (!remoteVideo) return;
    remoteVideo.muted = !isRemoteAudioEnabled;
    remoteVideo.volume = isRemoteAudioEnabled ? 1.0 : 0;
}

function updateOptionsMenuUI() {
    if (speakerToggleBtn) {
        speakerToggleBtn.classList.toggle('off', !isRemoteAudioEnabled);
        speakerToggleBtn.setAttribute('aria-pressed', String(isRemoteAudioEnabled));
        const state = speakerToggleBtn.querySelector('.more-option-state');
        if (state) state.textContent = isRemoteAudioEnabled ? 'On' : 'Off';
    }

    if (skeletonToggleBtn) {
        skeletonToggleBtn.classList.toggle('off', !isOverlayOn);
        skeletonToggleBtn.setAttribute('aria-pressed', String(isOverlayOn));
        const state = skeletonToggleBtn.querySelector('.more-option-state');
        if (state) state.textContent = isOverlayOn ? 'On' : 'Off';
    }

    if (moreOptionsBtn && moreOptionsMenu) {
        const isOpen = !moreOptionsMenu.hasAttribute('hidden');
        moreOptionsBtn.setAttribute('aria-expanded', String(isOpen));
    }
}

function closeMoreOptionsMenu() {
    if (!moreOptionsMenu) return;
    moreOptionsMenu.setAttribute('hidden', '');
    updateOptionsMenuUI();
}

function toggleMoreOptionsMenu(forceOpen) {
    if (!moreOptionsMenu) return;
    const shouldOpen = typeof forceOpen === 'boolean'
        ? forceOpen
        : moreOptionsMenu.hasAttribute('hidden');

    if (shouldOpen) {
        moreOptionsMenu.removeAttribute('hidden');
    } else {
        moreOptionsMenu.setAttribute('hidden', '');
    }

    updateOptionsMenuUI();
}

applyRemoteAudioPreference();
updateOptionsMenuUI();

function disableSTTWithStatus(message) {
    isSTTOn = false;
    isRecognitionActive = false;
    updateSTTUI();
    document.body.classList.remove('stt-active');
    if (message) {
        const statusEl = document.getElementById('status');
        if (statusEl) {
            statusEl.innerText = message;
            statusEl.style.color = '#ef4444';
        }
        console.log(`[Status] ${message}`);
    }
}

// Helper to stop all camera/mic tracks
function stopCamera() {
    if (localCameraController) {
        try {
            localCameraController.stop();
        } catch (e) {
            console.warn('Unable to stop camera controller cleanly:', e);
        }
        localCameraController = null;
    }

    isCameraStarted = false;
    isHandInferencePending = false;
    lastHandInferenceAt = 0;
    overlayHadRenderedContent = false;

    if (localStream) {
        localStream.getTracks().forEach(track => {
            track.stop();
            console.log("Stopped track:", track.kind);
        });
        localStream = null;
    }
    if (localVideo) localVideo.srcObject = null;
    if (remoteVideo) remoteVideo.srcObject = null;
    if (localCanvas.width && localCanvas.height) {
        ctx.clearRect(0, 0, localCanvas.width, localCanvas.height);
    }
    console.log("Camera and tracks stopped.");
}

function setRemoteName(name) {
    if (!name || (name === remoteName && remoteName !== "Remote User")) return;
    remoteName = name;
    console.log("Updating remote name to:", name);
    
    // Update Video Labels
    const remoteNameSpan = document.getElementById('remoteUserName');
    if (remoteNameSpan) remoteNameSpan.innerText = remoteName;
    
    const remoteSaysLabel = document.getElementById('remote-says-label');
    if (remoteSaysLabel) remoteSaysLabel.innerText = `${remoteName} Says:`;
    
    // Sidebar update removed (People panel is deleted)
}

const vcImageExistsCache = new Map();
let signPhraseMap = { common: {}, asl: {}, isl: {} };
const DIGIT_WORD_MAP = {
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

async function loadSignPhraseMap() {
    try {
        const response = await fetch('/signs-images/phrase-map.json', { cache: 'no-cache' });
        if (!response.ok) return;
        const json = await response.json();
        signPhraseMap = {
            common: json.common || {},
            asl: json.asl || {},
            isl: json.isl || {}
        };
    } catch (err) {
        console.warn('Failed to load phrase-map.json, continuing without phrase mapping.', err);
    }
}
loadSignPhraseMap();

// Preload sign card URLs from Supabase into cache so cards render instantly
async function preloadSignCardsFromSupabase() {
    try {
        const { data, error } = await window.supabaseClient
            .from('sign_cards')
            .select('lang, label, url');
        if (error) return;
        
        const cards = { isl: [], asl: [] };
        for (const row of data) {
            if (!cards[row.lang]) cards[row.lang] = [];
            cards[row.lang].push(row);
        }
        
        let count = 0;
        for (const [lang, items] of Object.entries(cards)) {
            for (const item of items) {
                // Cache the Supabase public URL as available
                vcImageExistsCache.set(item.url, true);
                count++;
            }
        }
        if (count > 0) console.log(`✅ Preloaded ${count} sign card URLs from Supabase`);
    } catch (err) {
        console.warn('Failed to preload sign cards from Supabase:', err);
    }
}
preloadSignCardsFromSupabase();

function getVCVisibleCardCapacity() {
    if (!predictionSignCardsContainer) return 30;

    const panelWidth = predictionSignCardsContainer.clientWidth;
    if (!panelWidth) return 30;

    const style = window.getComputedStyle(predictionSignCardsContainer);
    const gap = parseInt(style.columnGap || style.gap || '10', 10) || 10;
    const cardWidth = 76;
    const columns = Math.max(1, Math.floor((panelWidth + gap) / (cardWidth + gap)));
    // Use more rows on narrower screens so full phrases are never clipped
    const rows = columns <= 3 ? 5 : columns <= 5 ? 4 : 3;
    return Math.max(30, columns * rows);
}

function checkImageExists(url) {
    if (vcImageExistsCache.has(url)) {
        return Promise.resolve(vcImageExistsCache.get(url));
    }

    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            vcImageExistsCache.set(url, true);
            resolve(true);
        };
        img.onerror = () => {
            vcImageExistsCache.set(url, false);
            resolve(false);
        };
        img.src = url;
    });
}

function buildSignImageCandidates(basePath, keys) {
    const extensions = ['png', 'jpg', 'jpeg', 'gif', 'webp'];
    const uniqueKeys = [...new Set(keys.filter(Boolean))];
    const urls = [];

    for (const key of uniqueKeys) {
        for (const ext of extensions) {
            urls.push(`${basePath}/${key}.${ext}`);
        }
    }

    return urls;
}

async function resolveWordTokens(word, langFolder) {
    const normalizedWord = word.toLowerCase().replace(/[^a-z0-9-\s]/g, '').trim();
    if (!normalizedWord) return [];

    const collapsedWord = normalizedWord.replace(/\s+/g, '-');
    const joinedWord = normalizedWord.replace(/\s+/g, '');
    const wordCandidates = [
        ...buildSignImageCandidates(`/signs-images/${langFolder}/words`, [
            collapsedWord,
            joinedWord,
            normalizedWord
        ]),
        ...buildSignImageCandidates(`/signs-images/${langFolder}`, [
            collapsedWord,
            joinedWord,
            normalizedWord
        ])
    ];

    for (const src of wordCandidates) {
        if (await checkImageExists(src)) {
            return [{ type: 'card', src, label: collapsedWord }];
        }
    }

    const charTokens = [];
    const charsOnly = joinedWord.replace(/-/g, '');
    for (const char of charsOnly.toUpperCase()) {
        if (!/[A-Z0-9]/.test(char)) continue;

        const charCandidates = [];
        if (/[A-Z]/.test(char)) {
            charCandidates.push(...buildSignImageCandidates(`/signs-images/${langFolder}/characters`, [char]));
        } else {
            charCandidates.push(...buildSignImageCandidates(`/signs-images/${langFolder}/characters`, [char]));
            const digitWord = DIGIT_WORD_MAP[char];
            if (digitWord) {
                charCandidates.push(...buildSignImageCandidates(`/signs-images/${langFolder}/characters`, [digitWord]));
            }
        }

        let chosen = null;
        for (const src of charCandidates) {
            if (await checkImageExists(src)) {
                chosen = src;
                break;
            }
        }

        if (chosen) {
            charTokens.push({ type: 'card', src: chosen, label: char });
        }
    }

    if (charTokens.length > 0) return charTokens;
    return [{ type: 'label', label: normalizedWord }];
}

function resolveMappedPhrase(phrase, langFolder) {
    const perLangMap = signPhraseMap[langFolder] || {};
    if (perLangMap[phrase]) return perLangMap[phrase];
    return signPhraseMap.common[phrase] || null;
}

function buildCardUnits(words, langFolder) {
    const units = [];
    let index = 0;

    while (index < words.length) {
        let matched = null;
        const maxLen = Math.min(4, words.length - index);

        for (let phraseLen = maxLen; phraseLen >= 2; phraseLen--) {
            const phraseWords = words.slice(index, index + phraseLen);
            const phraseText = phraseWords.join(' ');
            const mappedKey = resolveMappedPhrase(phraseText, langFolder);
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

async function resolveCardUnitTokens(unit, langFolder) {
    if (unit.type === 'word') {
        return resolveWordTokens(unit.text, langFolder);
    }

    const mappedTokens = await resolveWordTokens(unit.mappedKey, langFolder);
    const mappedCardToken = mappedTokens.find(t => t.type === 'card');
    if (mappedCardToken) {
        return [{ type: 'card', src: mappedCardToken.src, label: unit.phraseText }];
    }

    const fallbackTokens = [];
    for (let i = 0; i < unit.words.length; i++) {
        const wordTokens = await resolveWordTokens(unit.words[i], langFolder);
        fallbackTokens.push(...wordTokens);
        if (i < unit.words.length - 1) fallbackTokens.push({ type: 'space' });
    }
    return fallbackTokens;
}

// --- Spelling Mode State ---
let accumulatedWord = "";
let lastLetterTime = 0;
let lastAddedLetter = null; // Track the actual last ACCEPTED letter
let spellingInterval = null;
const SPELLING_IDLE_TIMEOUT_MS = 5000;

// Accessibility Feature States
let recognition;
let audioContext;
let analyser;
let micSource;
let volumeInterval;
let localCameraController = null;
let isHandInferencePending = false;
let lastHandInferenceAt = 0;
let overlayHadRenderedContent = false;
let lastPredictionText = null;
const HAND_INFERENCE_INTERVAL_MS = 80;

function setPredictionText(text) {
    if (predictionDiv && text !== lastPredictionText) {
        predictionDiv.innerText = text;
        lastPredictionText = text;
    }
}

setPredictionText("Waiting for sign...");

// Resume audio on any user interaction
document.addEventListener('click', () => {
    if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume().then(() => console.log("AudioContext manually resumed."));
    }
}, { once: true });

document.addEventListener('click', (event) => {
    if (!moreOptionsMenu || !moreOptionsBtn) return;
    if (moreOptionsMenu.hasAttribute('hidden')) return;
    if (moreOptionsMenu.contains(event.target) || moreOptionsBtn.contains(event.target)) return;
    closeMoreOptionsMenu();
});

// Supabase connection handled during join-room

const rtcConfig = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
        { urls: "stun:stun3.l.google.com:19302" },
        { urls: "stun:stun4.l.google.com:19302" },
        { urls: "stun:stun.services.mozilla.com" },
        // Expanded TURN servers with more protocols to bypass strict firewalls
        {
            urls: [
                "turn:openrelay.metered.ca:80",
                "turn:openrelay.metered.ca:443",
                "turn:openrelay.metered.ca:443?transport=tcp"
            ],
            username: "openrelayproject",
            credential: "openrelayproject"
        }
    ],
    iceCandidatePoolSize: 10,
    bundlePolicy: "max-bundle",
    rtcpMuxPolicy: "require",
    iceTransportPolicy: "all"
};

// Helper to limit bitrate in SDP (prevents "poor connection" lag)
function setMaxBitrate(sdp, maxBitrateKbps) {
    const lines = sdp.split('\r\n');
    let lineIndex = -1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].indexOf('m=video') !== -1) {
            lineIndex = i;
            break;
        }
    }
    if (lineIndex === -1) return sdp;

    // Check if there's already a 'b=' line
    lineIndex++;
    while (lines[lineIndex] && (lines[lineIndex].indexOf('i=') === 0 || lines[lineIndex].indexOf('c=') === 0)) {
        lineIndex++;
    }

    if (lines[lineIndex] && lines[lineIndex].indexOf('b=AS') === 0) {
        lines[lineIndex] = 'b=AS:' + maxBitrateKbps;
    } else {
        lines.splice(lineIndex, 0, 'b=AS:' + maxBitrateKbps);
    }
    return lines.join('\r\n');
}

// --- Clock Utility ---
function updateClock() {
    if (!clockElement) return;
    const now = new Date();
    clockElement.innerText = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
setInterval(updateClock, 1000);
updateClock();

// --- Accessibility & Communication Boost Features ---

// 1. Speech to Text (Bi-Directional)
function initSTT() {
    if (!isSTTSupported) {
        console.warn("Speech Recognition not supported in this browser.");
        if (sttToggleBtn) sttToggleBtn.style.display = 'none';
        return;
    }

    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
        isRecognitionActive = true;
        lastSTTStartAt = Date.now();
        console.log("STT: Recognition started.");
    };

    recognition.onresult = (event) => {
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
            const t = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                finalTranscript += t;
            } else {
                interimTranscript += t;
            }
        }

        if (finalTranscript) {
            const trimmed = finalTranscript.trim().toLowerCase();
            
            // --- STT Echo Suppression Logic ---
            // If the local STT picks up the other participant's voice from the speakers, 
            // the text will match what was just broadcast. We ignore recent duplicates.
            if (trimmed === lastRemoteSpokenText.toLowerCase() && (Date.now() - lastRemoteSpokenTime < 3000)) {
                console.log("[STT Diagnostic] Suppressing local transcript echo matching remote speech.");
                return;
            }

            const capitalized = finalTranscript.trim();

            // Treat finalized local transcripts as the local speaker's speech unless
            // they are an exact recent duplicate of the remote transcript above.
            appendCaptionLog("You", capitalized);
            displayVCSignCards(capitalized);
            
            // Send finalized text to the remote peer. Exact remote duplicates were
            // already filtered above, which avoids transcript echo loops without
            // blocking legitimate speech when both participants enable STT.
            if (supabaseChannel) {
                supabaseChannel.send({
                    type: 'broadcast',
                    event: 'speech-message',
                    payload: { text: capitalized, name: localName }
                });
            }
        }
    };

    recognition.onerror = (event) => {
        console.error("STT Error:", event.error);
        if (event.error === 'not-allowed') {
            alert("Speech recognition permission denied.");
            disableSTTWithStatus("Speech-to-text permission denied.");
        } else if (event.error === 'audio-capture') {
            disableSTTWithStatus("Speech-to-text could not access the microphone in this tab.");
        } else if (event.error === 'service-not-allowed') {
            disableSTTWithStatus("Speech-to-text is not available in this browser tab.");
        } else if (event.error === 'aborted') {
            const startedRecently = lastSTTStartAt && (Date.now() - lastSTTStartAt < 5000);
            const hiddenTab = document.hidden;
            if (hiddenTab || startedRecently) {
                disableSTTWithStatus("Speech-to-text stopped in this tab. For local testing, use two different browsers or two devices.");
            }
        } else if (event.error === 'network') {
            console.warn("STT Network error. Will attempt restart.");
        }
    };

    recognition.onend = () => {
        isRecognitionActive = false;
        console.log("STT: Recognition ended.");
        // Auto-restart only if user still wants it on and it wasn't a hard error
        if (isSTTOn) {
            console.log("STT: Attempting auto-restart...");
            try {
                recognition.start();
            } catch (e) {
                console.error("STT Restart Error:", e);
            }
        }
    };
}

// --- Speech Recognition Support Check ---
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const isSTTSupported = !!SpeechRecognition;

function updateSTTUI() {
    if (!sttToggleBtn) return;
    if (!isSTTSupported) {
        sttToggleBtn.style.display = 'none';
        return;
    }
    if (sttToggleBtn.classList.contains('more-option-item')) {
        sttToggleBtn.classList.toggle('off', !isSTTOn);
        sttToggleBtn.setAttribute('aria-pressed', String(isSTTOn));
        const stateTag = sttToggleBtn.querySelector('.more-option-state');
        if (stateTag) {
            stateTag.textContent = isSTTOn ? "On" : "Off";
        }
    } else {
        sttToggleBtn.innerHTML = `<span class="material-icons">${isSTTOn ? 'interpreter_mode' : 'voice_over_off'}</span>`;
        sttToggleBtn.classList.toggle('red-btn', !isSTTOn);
        sttToggleBtn.title = isSTTOn ? "Turn off Speech-to-Text" : "Turn on Speech-to-Text";
    }
}
updateSTTUI(); // Sync at startup

function updateTTSUI() {
    if (ttsBtn) {
        ttsBtn.innerHTML = `<span class="material-icons">${isTTSOn ? 'volume_up' : 'volume_off'}</span>`;
        ttsBtn.classList.toggle('red-btn', !isTTSOn);
        ttsBtn.setAttribute('title', isTTSOn ? 'Mute Text-to-Speech' : 'Enable Text-to-Speech');
    }
    if (ttsToggleBtn) {
        ttsToggleBtn.classList.toggle('off', !isTTSOn);
        ttsToggleBtn.setAttribute('aria-pressed', String(isTTSOn));
        const stateTag = ttsToggleBtn.querySelector('.more-option-state');
        if (stateTag) {
            stateTag.textContent = isTTSOn ? "On" : "Off";
        }
    }
}
updateTTSUI(); // Sync at startup

function startSTTSession() {
    if (!isSTTSupported) return;
    isSTTOn = true;
    updateSTTUI();
    document.body.classList.add('stt-active');

    if (!recognition) initSTT();
    if (!isRecognitionActive) {
        try {
            recognition.start();
            hideVCSignCards();
        } catch (e) {
            console.error("Failed to start Recognition:", e);
            isSTTOn = false;
            updateSTTUI();
            document.body.classList.remove('stt-active');
        }
    }
}

function stopSTTSession() {
    isSTTOn = false;
    updateSTTUI();
    document.body.classList.remove('stt-active');
    if (recognition && isRecognitionActive) recognition.stop();
    hideVCSignCards();
}

if (sttToggleBtn) {
    sttToggleBtn.addEventListener('click', () => {
        if (isSTTOn) {
            stopSTTSession();
        } else {
            startSTTSession();
        }
    });
}



function appendCaptionLog(speaker, text) {
    if (!captionLogList || !text) return;

    // Remove empty placeholder
    const emptyMsg = captionLogList.querySelector('.caption-log-empty');
    if (emptyMsg) emptyMsg.remove();

    // Maintain a history of the last 15 messages for context
    while (captionLogList.children.length > 15) {
        captionLogList.removeChild(captionLogList.firstChild);
    }

    const entry = document.createElement('div');
    entry.className = 'caption-log-entry';

    const speakerLabel = document.createElement('span');
    speakerLabel.className = 'caption-log-speaker';
    speakerLabel.textContent = `${speaker}:`;

    const dialogue = document.createElement('span');
    dialogue.textContent = ` ${text}`;

    entry.appendChild(speakerLabel);
    entry.appendChild(dialogue);
    captionLogList.appendChild(entry);
    wakeCaptionPanel();
    updateCaptionLogViewport();
    scrollCaptionLogToLatest();
}

function ensureCaptionPlaceholder() {
    if (!captionLogList) return;
    const hasEntries = !!captionLogList.querySelector('.caption-log-entry');
    const emptyMsg = captionLogList.querySelector('.caption-log-empty');

    if (!hasEntries && !emptyMsg) {
        const placeholder = document.createElement('div');
        placeholder.className = 'caption-log-empty';
        placeholder.textContent = 'Captions will appear here during the call.';
        captionLogList.appendChild(placeholder);
    } else if (hasEntries && emptyMsg) {
        emptyMsg.remove();
    }
}

function resetVCCaptions() {
    hideVCSignCards();
    if (captionLogList) {
        captionLogList.innerHTML = '';
        ensureCaptionPlaceholder();
        updateCaptionLogViewport();
        scrollCaptionLogToLatest();
    }
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

setSignCardsPanelCollapsed(true);
setCaptionLogCollapsed(false);

function displayVCSignCards(text) {
    const container = document.getElementById('prediction-sign-cards-container');
    if (!container) return;

    const words = text.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return;

    const renderSeq = ++vcCardRenderSeq;
    const langFolder = currentMode.toLowerCase(); // 'isl' or 'asl'

    // Always clear history to only show the most recent utterance
    vcCardQueue = [];
    container.innerHTML = '';
    container.scrollTop = 0;

    (async () => {
        const units = buildCardUnits(words, langFolder);

        // Clear any pending auto-hide timer since new speech is arriving
        if (vcAutoHideTimeout) {
            clearTimeout(vcAutoHideTimeout);
            vcAutoHideTimeout = null;
        }

        if (!signCardsPanelManuallyCollapsed) {
            setSignCardsPanelCollapsed(false);
        }

        // Ensure panel is visible at the start of rendering
        wakeCaptionPanel();

        for (let i = 0; i < units.length; i++) {
            const tokens = await resolveCardUnitTokens(units[i], langFolder);
            
            // Staggered loop for streaming effect (inherited from live translation mode)
            for (const token of tokens) {
                if (renderSeq !== vcCardRenderSeq) return;

                vcCardQueue.push(token);
                
                // Incremental Render: Directly append the new card to avoid flickering existing ones
                appendIncrementalVCCard(token);

                // Streaming delay
                await new Promise(r => setTimeout(r, 220));
            }

            if (i < units.length - 1) {
                if (renderSeq !== vcCardRenderSeq) return;
                const spaceToken = { type: 'space' };
                vcCardQueue.push(spaceToken);
                appendIncrementalVCCard(spaceToken);
                // Extra gap for word spacing
                await new Promise(r => setTimeout(r, 100));
            }
        }

        // Dim the panel after inactivity instead of hiding it
        vcAutoHideTimeout = setTimeout(() => {
            dimCaptionPanel();
        }, 7000);
    })();
}

function appendIncrementalVCCard(token) {
    const container = document.getElementById('prediction-sign-cards-container');
    if (!container) return;

    if (!container.classList.contains('active')) {
        container.classList.add('active');
        container.innerHTML = ''; // Clear placeholder
    }

    // 1. Ensure we have a line
    let lastLine = container.querySelector('.prediction-sign-line:last-child');
    if (!lastLine) {
        lastLine = document.createElement('div');
        lastLine.className = 'prediction-sign-line';
        container.appendChild(lastLine);
    }

    if (token.type === 'space') {
        // Create a new word group for the next cards
        const wordGroupEl = document.createElement('div');
        wordGroupEl.className = 'prediction-word-group';
        lastLine.appendChild(wordGroupEl);
        return;
    }

    if (token.type === 'linebreak') {
        const lineEl = document.createElement('div');
        lineEl.className = 'prediction-sign-line';
        container.appendChild(lineEl);
        return;
    }

    // 2. Ensure we have a word group in the current line
    let lastGroup = lastLine.querySelector('.prediction-word-group:last-child');
    if (!lastGroup) {
        lastGroup = document.createElement('div');
        lastGroup.className = 'prediction-word-group';
        lastLine.appendChild(lastGroup);
    }

    // 3. Create and append the card
    const card = document.createElement('div');
    card.className = 'prediction-sign-card';

    if (token.type === 'card') {
        const img = document.createElement('img');
        img.src = token.src;
        img.alt = token.label;
        img.onerror = () => {
            img.style.display = 'none';
            card.classList.add('no-image');
        };
        card.appendChild(img);
    } else {
        card.classList.add('no-image');
    }

    const label = document.createElement('div');
    label.className = 'prediction-sign-card-label';
    label.textContent = token.label.length > 12 ? token.label.substring(0, 10) + '...' : token.label;

    card.appendChild(label);
    lastGroup.appendChild(card);
    container.scrollTop = container.scrollHeight;
}

function reRenderVCSignCards() {
    const container = document.getElementById('prediction-sign-cards-container');
    if (!container) return;

    if (vcCardQueue.length === 0) {
        container.innerHTML = '';
        container.classList.remove('active');
        return;
    }

    const maxVisible = getVCVisibleCardCapacity();
    let visibleQueue = [];
    let cardCount = 0;
    let indexFound = -1;

    // Work backwards to collect up to maxVisible cards
    for (let i = vcCardQueue.length - 1; i >= 0; i--) {
        const token = vcCardQueue[i];
        if (token.type === 'card') {
            cardCount++;
        }
        if (cardCount > maxVisible) {
            indexFound = i + 1;
            break;
        }
    }

    if (indexFound !== -1) {
        visibleQueue = vcCardQueue.slice(indexFound);
        // If we split a word (the token we start with is a card, and the token before it was also a card)
        if (indexFound > 0 && vcCardQueue[indexFound].type === 'card' && vcCardQueue[indexFound - 1].type === 'card') {
            // Drop cards until we hit a space or linebreak to preserve word integrity
            while (visibleQueue.length && visibleQueue[0].type === 'card') {
                visibleQueue.shift();
            }
        }
    } else {
        visibleQueue = vcCardQueue.slice();
    }

    // Strip any leading spaces or linebreaks
    while (visibleQueue.length && ['space', 'linebreak'].includes(visibleQueue[0].type)) {
        visibleQueue.shift();
    }

    container.innerHTML = '';

    const lineGroups = [];
    let currentLine = [];
    let currentGroup = [];
    for (const token of visibleQueue) {
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

    lineGroups.forEach(line => {
        const lineEl = document.createElement('div');
        lineEl.className = 'prediction-sign-line';

        line.forEach(group => {
            const wordGroupEl = document.createElement('div');
            wordGroupEl.className = 'prediction-word-group';

            group.forEach(token => {
                const card = document.createElement('div');
                card.className = 'prediction-sign-card';

                if (token.type === 'card') {
                    const img = document.createElement('img');
                    img.src = token.src;
                    img.alt = token.label;
                    img.onerror = () => {
                        img.style.display = 'none';
                        card.classList.add('no-image');
                    };
                    card.appendChild(img);
                } else {
                    card.classList.add('no-image');
                }

                const label = document.createElement('div');
                label.className = 'prediction-sign-card-label';
                label.textContent = token.label.length > 12 ? token.label.substring(0, 10) + '...' : token.label;

                card.appendChild(label);
                wordGroupEl.appendChild(card);
            });

            lineEl.appendChild(wordGroupEl);
        });

        container.appendChild(lineEl);
    });

    container.classList.add('active');
    container.scrollTop = container.scrollHeight;
}

window.addEventListener('resize', () => {
    if (predictionSignCardsContainer && predictionSignCardsContainer.classList.contains('active')) {
        reRenderVCSignCards();
    }
});

function hideVCSignCards() {
    const container = document.getElementById('prediction-sign-cards-container');
    dimCaptionPanel();
    
    if (container) {
        vcCardRenderSeq++;
        vcCardQueue = [];
        container.classList.remove('active');
        container.innerHTML = '';
    }

    setSignCardsPanelCollapsed(true);
}

// 2. Visual Audio Feedback (Volume Meter)
async function initAudioAnalysis(stream) {
    console.log("Initializing audio analysis...");
    try {
        const tracks = stream.getAudioTracks();
        if (!stream || !tracks.length) {
            console.warn("No audio tracks found in stream for analysis.");
            return;
        }

        const activeTrack = tracks[0];
        console.log(`[Audio Diagnostic] Using Mic: "${activeTrack.label}"`);
        console.log(`[Audio Diagnostic] Hardware Enabled: ${activeTrack.enabled}, Status: ${activeTrack.readyState}`);

        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }

        if (audioContext.state === 'suspended') {
            console.log("Resuming suspended AudioContext...");
            await audioContext.resume();
        }

        if (micSource) {
            try { micSource.disconnect(); } catch (e) { }
        }
        if (analyser) {
            try { analyser.disconnect(); } catch (e) { }
        }

        analyser = audioContext.createAnalyser();
        micSource = audioContext.createMediaStreamSource(stream);
        micSource.connect(analyser);
        analyser.fftSize = 256;

        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        console.log("Audio analysis started. Loop active.");

        function checkVolume() {
            let volume = 0;
            if (isMicOn && localStream && localStream.getAudioTracks().some(t => t.enabled)) {
                analyser.getByteFrequencyData(dataArray);
                let sum = 0;
                for (let i = 0; i < bufferLength; i++) {
                    sum += dataArray[i];
                }
                let average = sum / bufferLength;
                volume = average / 128; // 0 to 2

                if (volume > 0.02) {
                    localVolumeMeter.classList.add('volume-active');
                } else {
                    localVolumeMeter.classList.remove('volume-active');
                }
            } else {
                localVolumeMeter.classList.remove('volume-active');
            }

            if (supabaseChannel) {
                supabaseChannel.send({
                    type: 'broadcast',
                    event: 'volume-level',
                    payload: { level: volume, micOn: isMicOn }
                });
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
function validateLobby() {
    const room = startRoomInput.value.trim().toLowerCase();
    const name = userNameInput ? userNameInput.value.trim() : "";
    
    // Enforce app-generated code format (5-letter word)
    const codeFormat = /^[a-z]{5}$/;
    const isValidCode = codeFormat.test(room);

    if (room.length > 0 && !isValidCode) {
        lobbyStatus.innerText = "Invalid code. Please use a 5-letter code (e.g., apple, shark).";
        lobbyStatus.style.color = "#ef4444";
        joinBtn.disabled = true;
    } else {
        lobbyStatus.innerText = "Ready to connect";
        lobbyStatus.style.color = "#4db6ac";
        joinBtn.disabled = (room.length === 0 || name.length === 0);
    }
}

startRoomInput.addEventListener('input', validateLobby);
if (userNameInput) userNameInput.addEventListener('input', validateLobby);

// Mode Selector Logic
if (modeSelect) {
    modeSelect.addEventListener('change', async (e) => {
        currentMode = e.target.value;
        await updateModeVariables();

        // Reload everything
        model = null; // Clear current model (will be reset by loader)

        await loadFromFirestore(); // Reload data
        // new loader handles both server & local models
        await loadModelsAndLabels();
    });
}

function updateModelStatusUI() {
    const statusEl = document.getElementById('model-status');
    if (!statusEl) return;

    if (model) {
        statusEl.innerText = `Model: Active (${currentMode})`;
        statusEl.style.color = "#4db6ac";
    } else {
        statusEl.innerText = `Model: Missing (Train in settings)`;
        statusEl.style.color = "#ef4444";
    }
}

function loadSavedLabels() {
    try {
        const stored = localStorage.getItem(localStorageLabelKey);
        uniqueLabels = stored ? JSON.parse(stored) : [];
        console.log(`Loaded ${uniqueLabels.length} labels for ${currentMode} mode.`);
        if (uniqueLabels.length > 0) {
            console.log("Labels:", uniqueLabels);
        }
    } catch (e) {
        console.error("Failed to parse saved labels from local storage:", e);
        uniqueLabels = [];
    }
}

newMeetingBtn.addEventListener('click', () => {
    // Generate a fresh 5-letter code
    const letters = "abcdefghijklmnopqrstuvwxyz";
    let room = "";
    for(let i=0; i<5; i++) room += letters.charAt(Math.floor(Math.random() * letters.length));
    
    startRoomInput.value = room;
    isCreatingMeeting = true; // Mark as creator
    
    validateLobby();

    if (joinBtn.disabled) {
        if (userNameInput) {
            userNameInput.focus();
            userNameInput.style.borderColor = "#ef4444";
            setTimeout(() => userNameInput.style.borderColor = "", 2000);
        }
        lobbyStatus.innerText = "Please enter your name first!";
        lobbyStatus.style.color = "#ef4444";
    } else {
        joinBtn.click();
    }
});

joinBtn.addEventListener('click', async (e) => {
    // If this click was manual (not from New Meeting button), reset creator flag
    // Synthetic clicks from newMeetingBtn.click() have isTrusted === false
    if (e.isTrusted) {
        isCreatingMeeting = false;
    }

    roomName = startRoomInput.value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
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
    const joinBox = document.querySelector('.join-card') || document.querySelector('.join-box');
    if (joinBox) joinBox.appendChild(diagBtn);


    // 1. MUST start camera BEFORE joining room to avoid WebRTC errors
    await startCamera();

    joinScreen.classList.remove('active');
    
    // If creating meeting, go straight in. If joining, show loader.
    if (isCreatingMeeting) {
        meetingRoom.classList.add('active');
    } else {
        joiningLoader.classList.add('active');
    }

    if (meetingCodeDisplay) meetingCodeDisplay.innerText = roomName;
    if (mobileMeetingCodeDisplay) mobileMeetingCodeDisplay.innerText = roomName;

    // Capture Local Name
    localName = userNameInput.value.trim() || "You";
    const localNameSpan = document.getElementById('localUserName');
    if (localNameSpan) localNameSpan.innerText = localName + " (You)";

    // Bitrate Utility Function
    function setMaxBitrate(sdp, bitrate) {
        const lines = sdp.split('\n');
        let line = -1;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].indexOf('m=video') === 0) {
                line = i;
                break;
            }
        }
        if (line === -1) return sdp;
        line++;
        while (lines[line].indexOf('i=') === 0 || lines[line].indexOf('c=') === 0) {
            line++;
        }
        if (lines[line].indexOf('b') === 0) {
            lines[line] = 'b=AS:' + bitrate;
            return lines.join('\n');
        }
        lines.splice(line, 0, 'b=AS:' + bitrate);
        return lines.join('\n');
    }

    // Supabase Channel Setup
    const myPresenceKey = 'user-' + Math.random().toString(36).substring(7);
    supabaseChannel = window.supabaseClient.channel(roomName, {
        config: {
            broadcast: { self: false },
            presence: { key: myPresenceKey }
        }
    });

    const showMeetingStatusToast = (text, type = 'info') => {
        const meetingStatusText = document.getElementById('meeting-status-text');
        const meetingStatusBar = document.getElementById('meeting-status-bar');
        if (!meetingStatusText || !meetingStatusBar) return;
        if (lastMeetingStatusToast === text) return;

        lastMeetingStatusToast = text;
        meetingStatusText.innerText = text;
        meetingStatusBar.className = `meeting-status-bar ${type} visible`;

        if (meetingStatusToastTimer) {
            clearTimeout(meetingStatusToastTimer);
        }

        meetingStatusToastTimer = setTimeout(() => {
            meetingStatusBar.classList.remove('visible');
        }, 2000);
    };

    const updateStatus = (text, type = 'info') => {
        const statusEl = document.getElementById('status');

        if (text === "Connected to peer") {
            document.querySelector('.main-stage')?.classList.add('is-connected');
        }

        if (statusEl) {
            statusEl.innerText = text;
            statusEl.style.color = type === 'error' ? '#ef4444' : (type === 'success' ? '#4db6ac' : '#aaa');
        }

        showMeetingStatusToast(text, type);
        
        console.log(`[Status] ${text}`);
    };
    supabaseChannel
        .on('broadcast', { event: 'user-joined' }, ({ payload }) => {
            console.log("New peer joined room:", payload.id, "Name:", payload.name);
            if (payload.name) {
                setRemoteName(payload.name);
            }

            supabaseChannel.send({
                type: 'broadcast',
                event: 'camera-toggle',
                payload: { isCamOn }
            });
            
            // If we are the host, immediately announce ourselves back to the new joiner
            if (isCreatingMeeting) {
                supabaseChannel.send({
                    type: 'broadcast',
                    event: 'host-heartbeat',
                    payload: { host: localName }
                });
            }

            if (localStream) {
                handlePeerJoined(payload.id);
            }
        })
        .on('broadcast', { event: 'offer' }, async ({ payload }) => {
            console.log("Offer received from peer. Name:", payload.name);
            if (payload.name) {
                setRemoteName(payload.name);
            }
            try {
                if (!pc) createPeerConnection();
                if (pc.signalingState !== "stable") {
                    console.log("Signaling state not stable, ignoring offer (might be a collision)");
                    return;
                }
                await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
                processBufferedIceCandidates();
                const answer = await pc.createAnswer();
                answer.sdp = setMaxBitrate(answer.sdp, 1000);
                await pc.setLocalDescription(answer);
                console.log("Sending answer...");
                supabaseChannel.send({
                    type: 'broadcast',
                    event: 'answer',
                    payload: { sdp: answer, name: localName }
                });
                updateStatus("Connected to peer", "success");
            } catch (e) {
                console.error("Error handling offer:", e);
                updateStatus("Connection failed: " + e.message, "error");
            }
        })
        .on('broadcast', { event: 'answer' }, async ({ payload }) => {
            console.log("Answer received from peer. Name:", payload.name);
            if (payload.name) {
                setRemoteName(payload.name);
            }
            try {
                if (pc) {
                    await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
                    processBufferedIceCandidates();
                    updateStatus("Connected to peer", "success");
                }
            } catch (e) {
                console.error("Error handling answer:", e);
                updateStatus("Connection error", "error");
            }
        })
        .on('broadcast', { event: 'ice' }, async ({ payload }) => {
            const candidate = payload.candidate;
            if (pc && pc.remoteDescription && pc.remoteDescription.type) {
                try {
                    await pc.addIceCandidate(new RTCIceCandidate(candidate));
                } catch (e) {
                    console.error("Error adding ICE candidate:", e);
                }
            } else {
                iceCandidatesBuffer.push(candidate);
            }
        })
        .on('broadcast', { event: 'sign-message' }, data => {
            const payload = data.payload || data;
            if (payload.text) {
                const text = payload.text;
                const isDynamic = !!payload.isDynamic;
                const name = payload.name || "Remote User";
                setRemoteName(name);

                // Update Remote Overlay (Toast)
                if (remotePredictionDiv) {
                    const displayText = isDynamic ? `${text} 🔄` : text;
                    remotePredictionDiv.innerText = displayText;
                }
                if (remoteCaptionOverlay) {
                    remoteCaptionOverlay.classList.remove('hidden');
                    // Auto-hide toast after 3s
                    if (window.vcRemoteToastTimeout) clearTimeout(window.vcRemoteToastTimeout);
                    window.vcRemoteToastTimeout = setTimeout(() => {
                        remoteCaptionOverlay.classList.add('hidden');
                    }, 3000);
                }

                // Unify with STT Caption Log and Cards
                // Note: isSTTOn check removed to allow one-way translation (everyone sees remote captions)
                const logText = isDynamic ? `${text} 🔄` : text;
                appendCaptionLog(name, logText);
                displayVCSignCards(text); // Resolve cards for the sign label

                const now = Date.now();
                const wordLastSpoken = remoteWordLastSpoken[text] || 0;
                const timeSinceAny = now - lastRemoteSpokenTime;
                const timeSinceSame = now - wordLastSpoken;

                if (isTTSOn && timeSinceSame > 4000 && timeSinceAny > 800) {
                    speak(text);
                    lastRemoteSpokenText = text;
                    lastRemoteSpokenTime = now;
                    remoteWordLastSpoken[text] = now;
                }
            }
        })
        .on('broadcast', { event: 'speech-message' }, data => {
            // Note: isSTTOn check removed to allow one-way translation (everyone sees remote captions)
            const payload = data.payload || data;
            if (payload.text && payload.text.trim()) {
                if (payload.name) setRemoteName(payload.name);
                const remoteText = payload.text.trim();
                
                // Update global tracking for echo suppression
                lastRemoteSpokenText = remoteText;
                lastRemoteSpokenTime = Date.now();

                appendCaptionLog(remoteName, remoteText);
                displayVCSignCards(remoteText);
            }
        })
        .on('broadcast', { event: 'chat-message' }, (data) => {
            const payload = data.payload || data;
            if (payload.sender && payload.sender !== 'You') {
                setRemoteName(payload.sender);
            }
            appendMessage({ ...payload, sender: remoteName }, 'remote');
            if (!chatPanel.classList.contains('open') && chatToggleBtn) {
                chatToggleBtn.style.color = '#e37400';
            }
        })
        .on('broadcast', { event: 'volume-level' }, data => {
            const payload = data.payload || data;
            if (remoteVolumeMeter) {
                if (payload.micOn === false) {
                    remoteVolumeMeter.innerText = 'mic_off';
                    remoteVolumeMeter.classList.remove('volume-active');
                } else {
                    remoteVolumeMeter.innerText = 'mic';
                    if (payload.level > 0.02) {
                        remoteVolumeMeter.classList.add('volume-active');
                        lastRemoteVolumeActiveTime = Date.now();
                    } else {
                        remoteVolumeMeter.classList.remove('volume-active');
                    }
                }
            }
        })
        .on('broadcast', { event: 'camera-toggle' }, data => {
            const payload = data.payload || data;
            const remoteContainer = document.getElementById('remoteContainer');
            if (remoteContainer) {
                if (payload.isCamOn === false) {
                    remoteContainer.classList.add('video-muted');
                } else {
                    remoteContainer.classList.remove('video-muted');
                }
            }
        })
        .on('broadcast', { event: 'emoji-pop' }, data => {
            const payload = data.payload || data;
            popEmojis(payload.emoji);
        })
        .on('broadcast', { event: 'user-left' }, ({ payload }) => {
            console.log("Peer left room:", payload.id);
            if (pc) {
                pc.close();
                pc = null;
            }
            if (remoteVideo) {
                remoteVideo.srcObject = null;
            }
            document.querySelector('.main-stage')?.classList.remove('is-connected');
            updateStatus("Peer left", "info");
        })
        .on('broadcast', { event: 'host-heartbeat' }, (data) => {
            const payload = data.payload || data;
            if (payload.host) {
                setRemoteName(payload.host);
            }
            if (!isCreatingMeeting && joiningLoader.classList.contains('active')) {
                console.log("Host heartbeat detected! Entering room...");
                joiningLoader.classList.remove('active');
                meetingRoom.classList.add('active');
                updateStatus("Connected to peer", "success");
            }
        })
        .on('presence', { event: 'sync' }, () => {
            const state = supabaseChannel.presenceState();
            const users = Object.values(state).flat();
            
            // Enforce max 2 participants limit
            if (users.length > 2) {
                // Sort by who joined first
                const sortedUsers = [...users].sort((a, b) => new Date(a.online_at) - new Date(b.online_at));
                const myIndex = sortedUsers.findIndex(u => u.presenceKey === myPresenceKey);
                
                // If I am 3rd or later, I must disconnect
                if (myIndex >= 2) {
                    console.log("Room is full. Disconnecting...");
                    supabaseChannel.unsubscribe();
                    stopCamera();
                    
                    const joiningLoader = document.getElementById('joining-loader');
                    const meetingRoom = document.getElementById('meeting-room');
                    const joinScreen = document.getElementById('join-screen');
                    const lobbyStatus = document.getElementById('status');
                    
                    if (joiningLoader) joiningLoader.classList.remove('active');
                    if (meetingRoom) meetingRoom.classList.remove('active');
                    if (joinScreen) joinScreen.classList.add('active');
                    
                    setTimeout(() => {
                        const modal = document.getElementById('full-room-modal');
                        if (modal) modal.classList.add('active');
                    }, 100);
                    return; // Stop processing sync
                }
            }
            
            // Try to find the remote peer's name from presence data
            const peer = users.find(u => u.user_id !== (isCreatingMeeting ? 'host' : 'joiner'));
            if (peer && peer.name) {
                setRemoteName(peer.name);
            }

            const hostFound = users.some(u => u.user_id === 'host');
            console.log(`[Presence Sync] ${users.length} users. Host found: ${hostFound}`);
            
            if (hostFound && !isCreatingMeeting && joiningLoader.classList.contains('active')) {
                joiningLoader.classList.remove('active');
                meetingRoom.classList.add('active');
                updateStatus("Connected to peer", "success");
            }
        });

        let subRetries = 0;
        const handleSubscription = async (status) => {
            if (status === 'SUBSCRIBED') {
                updateStatus("Connected to signaling server", "success");

                // Register ourselves in the presence state
                supabaseChannel.track({ 
                    user_id: isCreatingMeeting ? 'host' : 'joiner', 
                    name: localName,
                    presenceKey: myPresenceKey,
                    online_at: new Date().toISOString() 
                });

                // Host: Start a heartbeat so joiners can find us easily
                if (isCreatingMeeting) {
                    setInterval(() => {
                        supabaseChannel.send({
                            type: 'broadcast',
                            event: 'host-heartbeat',
                            payload: { host: localName }
                        });
                    }, 2000);
                }

                // Joiner: Polling Fallback (in case heartbeats/sync are skipped)
                if (!isCreatingMeeting) {
                    let attempts = 0;
                    const maxAttempts = 20; // Wait up to 10 seconds
                    
                    const checkInterval = setInterval(() => {
                        attempts++;
                        if (!joiningLoader.classList.contains('active')) {
                            clearInterval(checkInterval);
                            return;
                        }

                        const presenceState = supabaseChannel.presenceState();
                        const users = Object.values(presenceState).flat();
                        const hostFound = users.some(u => u.user_id === 'host');
                        // Also accept if ANY peer is present (handles host-rejoin case
                        // where the original host left and is now rejoining, but the
                        // other participant is still registered as 'joiner')
                        const anyoneFound = users.length > 1 || (users.length === 1 && users[0].user_id !== (isCreatingMeeting ? 'host' : 'joiner'));

                        if (hostFound) {
                            clearInterval(checkInterval);
                            joiningLoader.classList.remove('active');
                            meetingRoom.classList.add('active');
                            updateStatus("Connected to peer", "success");
                        } else if (anyoneFound) {
                            // No host presence, but someone is in the room —
                            // promote this user to host so the meeting can continue
                            clearInterval(checkInterval);
                            console.log("[Rejoin] No host found but peers present — rejoining as host.");
                            isCreatingMeeting = true;
                            supabaseChannel.track({
                                user_id: 'host',
                                name: localName,
                                presenceKey: myPresenceKey,
                                online_at: new Date().toISOString()
                            });
                            joiningLoader.classList.remove('active');
                            meetingRoom.classList.add('active');
                            updateStatus("Reconnected as host", "success");
                        } else if (attempts >= maxAttempts) {
                            clearInterval(checkInterval);
                            stopCamera(); 
                            joiningLoader.classList.remove('active');
                            joinScreen.classList.add('active');
                            lobbyStatus.innerText = "Meeting not found.";
                            lobbyStatus.style.color = "#ef4444";
                        }
                    }, 500);
                }

                // Broadcast join event for WebRTC
                setTimeout(() => {
                    supabaseChannel.send({
                        type: 'broadcast',
                        event: 'user-joined',
                        payload: { 
                            id: 'peer-' + Math.random().toString(36).substring(7),
                            name: localName
                        }
                    });
                    // Immediately broadcast our camera/mic state so the remote peer
                    // shows the camera-off icon right from the start
                    supabaseChannel.send({
                        type: 'broadcast',
                        event: 'camera-toggle',
                        payload: { isCamOn }
                    });
                }, 1000);
            } else if (status === 'CHANNEL_ERROR') {
                updateStatus("Signaling connection error", "error");
            } else if (status === 'TIMED_OUT') {
                if (subRetries < 3) {
                    subRetries++;
                    updateStatus(`Signaling timed out. Retrying... (${subRetries}/3)`, "info");
                    setTimeout(() => {
                        if (supabaseChannel) supabaseChannel.subscribe(handleSubscription, 30000);
                    }, 2000);
                } else {
                    updateStatus("Signaling timed out. Please refresh.", "error");
                }
            }
        };
        
        supabaseChannel.subscribe(handleSubscription, 30000);

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

let isCollecting = false;
// Initial Load
if (modeSelect) modeSelect.value = currentMode;
// updateModeVariables already reloads models for the active mode.
updateModeVariables();
loadSavedLabels();
// loadFromFirestore removed to prevent reference errors to deleted UI components

// Global function to delete all data for a specific label removed

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
}

// --- Model Loading ---
// This replaces the old `loadSavedModel` and pulls together both server
// model (pre-trained dataset) and any locally trained model for the
// selected language.
async function loadModelsAndLabels() {
    // reset state
    serverModel = null;
    serverLabels = [];
    model = null;
    uniqueLabels = [];
    modelDynamic = null;
    uniqueLabelsDynamic = [];
    dynamicLabelHandRequirements = {};
    predictionBuffer.length = 0;
    dynamicFrameBuffer = [];
    dynamicBufferStartTime = 0;
    lastDisplayedPrediction = null;
    lastDisplayedFrame = null;

    // load server model for selected language
    const serverModelPath = currentMode === 'ASL' ? 'model/asl/model.json' : 'model/model.json';
    const serverLabelsPath = currentMode === 'ASL' ? 'model/asl/labels.json' : 'labels.json';
    try {
        const response = await fetch(serverLabelsPath);
        if (response.ok) {
            serverLabels = normalizeLabelList(await response.json()).labels;
            serverModel = await tf.loadLayersModel(serverModelPath);
            console.log(`Server model loaded (${serverLabels.length} labels)`);
        } else {
            console.warn(`${serverLabelsPath} not found for server model.`);
        }
    } catch (e) {
        console.warn('Server model load failed:', e);
    }

    // load local static model if available
    try {
        const localLabelData = localStorage.getItem(`${localStorageLabelKey}-static`);
        if (!localLabelData) {
            const cloudData = await fetchCloudModel('static', currentMode);
            if (cloudData) {
                uniqueLabels = cloudData.labels;
                model = cloudData.model;
                console.log(`Cloud static model loaded (${uniqueLabels.length} labels)`);
            }
        } else {
            const normalizedLocalLabels = normalizeLabelList(JSON.parse(localLabelData));
            uniqueLabels = normalizedLocalLabels.labels;
            if (normalizedLocalLabels.changed) {
                localStorage.setItem(`${localStorageLabelKey}-static`, JSON.stringify(uniqueLabels));
            }
            try {
                model = await tf.loadLayersModel(`localstorage://${localStorageModelKey}-static`);
                console.log(`Local static model loaded (${uniqueLabels.length} labels)`);
            } catch (e) {
                console.warn('Local static model weights not found in localStorage. Checking cloud...');
                const cloudData = await fetchCloudModel('static', currentMode);
                if (cloudData) {
                    uniqueLabels = cloudData.labels;
                    model = cloudData.model;
                    console.log(`Cloud static model loaded (${uniqueLabels.length} labels)`);
                } else {
                    model = null;
                }
            }
        }
    } catch (e) {
        console.warn('Local static model load failed:', e);
    }

    // load local dynamic model if available
    try {
        const dynamicLabelData = localStorage.getItem(`${localStorageLabelKey}-dynamic`);
        if (!dynamicLabelData) {
            const cloudData = await fetchCloudModel('dynamic', currentMode);
            if (cloudData) {
                uniqueLabelsDynamic = cloudData.labels;
                modelDynamic = cloudData.model;
                dynamicLabelHandRequirements = cloudData.handReqs || {};
                console.log(`Cloud dynamic model loaded (${uniqueLabelsDynamic.length} labels)`);
            }
        } else {
            const normalizedDynamicLabels = normalizeLabelList(JSON.parse(dynamicLabelData));
            uniqueLabelsDynamic = normalizedDynamicLabels.labels;
            if (normalizedDynamicLabels.changed) {
                localStorage.setItem(`${localStorageLabelKey}-dynamic`, JSON.stringify(uniqueLabelsDynamic));
            }
            const dynamicReqData = localStorage.getItem(`${localStorageLabelKey}-dynamic-hand-req`);
            const normalizedHandReqs = normalizeHandRequirementMap(dynamicReqData ? JSON.parse(dynamicReqData) : {});
            dynamicLabelHandRequirements = normalizedHandReqs.map;
            if (normalizedHandReqs.changed) {
                localStorage.setItem(`${localStorageLabelKey}-dynamic-hand-req`, JSON.stringify(dynamicLabelHandRequirements));
            }
            try {
                modelDynamic = await tf.loadLayersModel(`localstorage://${localStorageModelKey}-dynamic`);
                console.log(`Local dynamic model loaded (${uniqueLabelsDynamic.length} labels)`);
            } catch (e) {
                console.warn('Local dynamic model weights not found in localStorage. Checking cloud...');
                const cloudData = await fetchCloudModel('dynamic', currentMode);
                if (cloudData) {
                    uniqueLabelsDynamic = cloudData.labels;
                    modelDynamic = cloudData.model;
                    dynamicLabelHandRequirements = cloudData.handReqs || {};
                    console.log(`Cloud dynamic model loaded (${uniqueLabelsDynamic.length} labels)`);
                } else {
                    modelDynamic = null;
                }
            }
        }
    } catch (e) {
        console.warn('Local dynamic model load failed:', e);
    }

    // update training UI
    if ((model && uniqueLabels.length > 0) || (modelDynamic && uniqueLabelsDynamic.length > 0)) {
        console.log('Saved model(s) loaded.');
    } else {
        console.log('No saved local model.');
    }

    console.log('loadModelsAndLabels completed', {
        serverModel: !!serverModel,
        serverLabelsLen: serverLabels.length,
        localModel: !!model,
        uniqueLabelsLen: uniqueLabels.length,
        dynamicModel: !!modelDynamic,
        dynamicLabelsLen: uniqueLabelsDynamic.length
    });
}

// --- Camera & Hand Tracking ---
let isCameraStarted = false;
async function startCamera() {
    if (isCameraStarted && localStream) return;
    isCameraStarted = true;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert("Browser API navigator.mediaDevices.getUserMedia not available. Please ensure you are using a modern browser and running on localhost or HTTPS.");
        isCameraStarted = false;
        return;
    }

    try {
        try {
            console.log("Requesting camera and microphone...");
            const videoConstraints = {
                facingMode: 'user',
                width: { ideal: 1280 },
                height: { ideal: 720 },
                resizeMode: 'none',
                frameRate: { ideal: 24, max: 30 }
            };
            const constraints = {
                video: videoConstraints,
                audio: {
                    echoCancellation: { ideal: true },
                    noiseSuppression: { ideal: true },
                    autoGainControl: { ideal: true }
                }
            };
            localStream = await navigator.mediaDevices.getUserMedia(constraints);
            console.log("Media access granted.");

            // --- Mute on join: start with mic and camera off ---
            localStream.getAudioTracks().forEach(t => t.enabled = false);
            localStream.getVideoTracks().forEach(t => t.enabled = false);
            isMicOn = false;
            isCamOn = false;
        } catch (err) {
            console.error("Initial media request failed:", err);
            if (err.name === 'NotFoundError' || err.name === 'NotAllowedError') {
                console.warn("Microphone access issue, attempting video only.");
                try {
                    localStream = await navigator.mediaDevices.getUserMedia({
                        video: videoConstraints
                    });
                    
                    // Update UI state to reflect missing mic
                    isMicOn = false;
                    if (micBtn) {
                        micBtn.innerHTML = `<span class="material-icons">mic_off</span>`;
                        micBtn.classList.add('red-btn');
                        micBtn.title = err.name === 'NotAllowedError' ? "Microphone blocked (Click to request)" : "No microphone detected (Click to retry)";
                    }
                    if (localVolumeMeter) localVolumeMeter.innerText = 'mic_off';

                } catch (vErr) {
                    console.error("Complete media failure:", vErr);
                    alert("Could not access camera or microphone. Please check permissions.");
                    throw vErr;
                }
            } else {
                throw err;
            }
        }
        localVideo.srcObject = localStream;

        // Sync buttons to the muted-on-join state
        if (micBtn) {
            micBtn.innerHTML = `<span class="material-icons">mic_off</span>`;
            micBtn.classList.add('red-btn');
            micBtn.setAttribute('title', 'Turn on microphone');
        }
        if (camBtn) {
            camBtn.innerHTML = `<span class="material-icons">videocam_off</span>`;
            camBtn.classList.add('red-btn');
            camBtn.setAttribute('title', 'Turn on camera');
        }
        if (localVolumeMeter) localVolumeMeter.innerText = 'mic_off';
        const localContainer = document.getElementById('localContainer');
        if (localContainer) localContainer.classList.add('video-muted');

        localCameraController = new Camera(localVideo, {
            onFrame: async () => {
                if (!isCamOn || !localVideo.videoWidth || !localVideo.videoHeight) {
                    return;
                }

                const now = performance.now();
                if (isHandInferencePending || (now - lastHandInferenceAt) < HAND_INFERENCE_INTERVAL_MS) {
                    return;
                }

                isHandInferencePending = true;
                lastHandInferenceAt = now;

                try {
                    await hands.send({ image: localVideo });
                } finally {
                    isHandInferencePending = false;
                }
            },
        });
        await localCameraController.start();
        initAudioAnalysis(localStream);
    } catch (err) {
        isCameraStarted = false;
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
    const indexMCP = landmarks[5];
    const distance = Math.hypot(
        indexMCP.x - wrist.x,
        indexMCP.y - wrist.y,
        indexMCP.z - wrist.z
    ) || 1e-6;
    const normalized = new Array(landmarks.length * 3);

    for (let index = 0; index < landmarks.length; index += 1) {
        const point = landmarks[index];
        const base = index * 3;
        normalized[base] = (point.x - wrist.x) / distance;
        normalized[base + 1] = (point.y - wrist.y) / distance;
        normalized[base + 2] = (point.z - wrist.z) / distance;
    }

    return normalized;
}

function getSmoothedPrediction(predLabel) {
    predictionBuffer.push(predLabel);
    if (predictionBuffer.length > 15) predictionBuffer.shift();
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

function onResults(results) {
    const handLandmarks = results.multiHandLandmarks || [];
    const shouldDrawOverlay = isOverlayOn && handLandmarks.length > 0 && typeof drawConnectors !== 'undefined';
    const shouldTouchCanvas = (shouldDrawOverlay || overlayHadRenderedContent) && localVideo.videoWidth && localVideo.videoHeight;

    if (shouldTouchCanvas) {
        if (localCanvas.width !== localVideo.videoWidth || localCanvas.height !== localVideo.videoHeight) {
            localCanvas.width = localVideo.videoWidth;
            localCanvas.height = localVideo.videoHeight;
        }
        ctx.save();
        ctx.clearRect(0, 0, localCanvas.width, localCanvas.height);
    }

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

        // ALWAYS use the first hand for prediction to avoid "Double Speak" from two hands
        const landmarks = handLandmarks[0];

        // Handle Hand Overlay Drawing
        if (shouldDrawOverlay) {
            for (const hand of handLandmarks) {
                drawConnectors(ctx, hand, HAND_CONNECTIONS, { color: '#00FF00', lineWidth: 4 });
                drawLandmarks(ctx, hand, { color: '#FF0000', lineWidth: 2 });
            }
            overlayHadRenderedContent = true;
        }

        // Preprocess for AI (Normalization is Scale/Translation invariant)
        const flatLandmarks = preprocessLandmarks(landmarks);

        const detectedHandCount = Math.min(2, handLandmarks.length);

        // Handle Collection or Prediction
        if (isCollecting) {
            // Collection disabled
        } else {
            runPrediction(flatLandmarks, detectedHandCount);
        }
    } else {
        // If hand disappears while spelling, finalize immediately
        if (accumulatedWord.length > 0) {
            finishSpelling(true);
        }

        // No hands detected - set timeout for "Waiting for hands"
        if (!noHandsTimeoutId) {
            noHandsTimeoutId = setTimeout(() => {
                setPredictionText("Waiting for sign...");
                noHandsTimeoutId = null;
            }, NO_HANDS_TIMEOUT_MS);
        }

        predictionBuffer.length = 0;
        dynamicFrameBuffer = [];
        dynamicBufferStartTime = 0;
        resetMotionState();

        // Reset the last added letter so user can sign the same letter again if they lift their hand
        // e.g. "Apple" requires P -> lift -> P
        if (lastAddedLetter !== null) {
            lastAddedLetter = null;
        }
        // also clear hold tracking
        heldLetter = null;
        holdStartTime = 0;
        overlayHadRenderedContent = false;
    }

    if (shouldTouchCanvas) {
        ctx.restore();
    }
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

function isASLDynamicSpellingLetter(label) {
    if (currentMode !== 'ASL') return false;
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

function applyISLHandCountDisambiguation(label, detectedHandCount) {
    if (currentMode !== 'ISL') return label;
    if (typeof label !== 'string') return label;

    if (detectedHandCount < 2 && label.toUpperCase() === 'T') {
        return '1';
    }

    return label;
}

function shouldSkipStaticLabel(label) {
    return typeof label === 'string' && label.toLowerCase() === 'hello';
}

function getPredictionPeak(predictionTensor, labels) {
    const values = predictionTensor.dataSync();
    let maxIndex = 0;
    let maxConfidence = values[0] ?? 0;

    for (let index = 1; index < values.length; index += 1) {
        if (values[index] > maxConfidence) {
            maxConfidence = values[index];
            maxIndex = index;
        }
    }

    return {
        conf: maxConfidence,
        label: normalizeAlphabetLabel(labels[maxIndex])
    };
}

function chooseBestCandidateWithLocalPriority(candidates) {
    const serverCandidates = candidates.filter(c => c.source === 'server');
    const localCandidates = candidates.filter(c => c.source === 'local' || c.source === 'dynamic');

    serverCandidates.sort((a, b) => b.conf - a.conf);
    localCandidates.sort((a, b) => b.conf - a.conf);

    const bestServer = serverCandidates[0] || null;
    const bestLocal = localCandidates[0] || null;

    if (bestServer && bestLocal) {
        const serverLabel = String(bestServer.label || '').toUpperCase();
        const localLabel = String(bestLocal.label || '').toUpperCase();
        const serverIsAlphabet = /^[A-Z]$/.test(serverLabel);
        const localIsDigit = /^[0-9]$/.test(localLabel);

        // Keep a narrow safety guard only for strong alphabet-vs-digit conflicts.
        if (serverIsAlphabet && localIsDigit && bestServer.conf >= 0.75 && (bestServer.conf - bestLocal.conf) >= 0.08) {
            return bestServer;
        }

        // Stronger local preference so website-trained signs actually take priority.
        const localScore = bestLocal.conf + 0.10;
        const serverScore = bestServer.conf;
        return localScore >= serverScore ? bestLocal : bestServer;
    }

    return bestLocal || bestServer || null;
}

function runPrediction(flatLandmarks, detectedHandCount = 1) {
    // require either server or local model to be present
    if ((!serverModel || serverLabels.length === 0) &&
        (!model || uniqueLabels.length === 0) &&
        (!modelDynamic || uniqueLabelsDynamic.length === 0)) {
        return;
    }

    tf.tidy(() => {
        const motionState = updateMotionState(flatLandmarks);
        const staticAllowed = motionState.stillForMs >= STATIC_STILL_DURATION_MS;

        if (!staticAllowed) {
            predictionBuffer.length = 0;
            heldLetter = null;
            holdStartTime = 0;
        }

        const input = tf.tensor2d([flatLandmarks]);
        let candidates = [];

        // server predictions (ISL only, only when hand is still)
        if (staticAllowed && serverModel && serverLabels.length) {
            const pred = serverModel.predict(input);
            const { conf, label } = getPredictionPeak(pred, serverLabels);
            if (!shouldSkipStaticLabel(label)) {
                candidates.push({ label, conf, source: 'server' });
            }
        }

        // local static predictions (only when hand is still)
        if (staticAllowed && model && uniqueLabels.length) {
            const pred = model.predict(input);
            const { conf, label } = getPredictionPeak(pred, uniqueLabels);
            if (!shouldSkipStaticLabel(label)) {
                candidates.push({ label, conf, source: 'local' });
            }
        }

        // dynamic predictions with frame buffer
        if (modelDynamic && uniqueLabelsDynamic.length) {
            if (dynamicBufferStartTime === 0) {
                dynamicBufferStartTime = Date.now();
            }

            dynamicFrameBuffer.push(flatLandmarks);

            if (dynamicFrameBuffer.length > MAX_DYNAMIC_FRAMES) {
                dynamicFrameBuffer.shift();
            }

            const dynamicReady = (Date.now() - dynamicBufferStartTime) >= DYNAMIC_ANALYZE_MS;

            if (dynamicFrameBuffer.length >= 1 && dynamicReady) {
                const paddedFrames = [...dynamicFrameBuffer];
                const lastFrame = paddedFrames[paddedFrames.length - 1];
                while (paddedFrames.length < MAX_DYNAMIC_FRAMES) {
                    paddedFrames.push(lastFrame);
                }

                const tensorDynamic = tf.tensor3d([paddedFrames]);
                const predDynamic = modelDynamic.predict(tensorDynamic);
                const { conf, label: predictedDynamicLabel } = getPredictionPeak(predDynamic, uniqueLabelsDynamic);

                // Boost confidence for dynamic signs to compete with static scores
                const boostedConf = Math.min(conf * 1.2, 1.0);
                const allowDynamicDuringSpelling = accumulatedWord.length === 0 || isASLDynamicSpellingLetter(predictedDynamicLabel);
                const strongEnoughForZ = hasStrongASLZMotion(predictedDynamicLabel, conf, paddedFrames);
                if (allowDynamicDuringSpelling && strongEnoughForZ && labelMatchesDetectedHands(predictedDynamicLabel, detectedHandCount)) {
                    candidates.push({
                        label: predictedDynamicLabel,
                        conf: boostedConf,
                        source: 'dynamic',
                        isDynamic: true
                    });
                }

                tensorDynamic.dispose();
                predDynamic.dispose();
            }
        }

        if (candidates.length === 0) {
            // No confident prediction
            if (accumulatedWord.length > 0) {
                // During spelling, clear display to prevent competing outputs
                setPredictionText('');
            } else if (lastDisplayedPrediction) {
                // Only show last prediction if not spelling
                const last = lastDisplayedPrediction;
                const displayText = last.isDynamic ? `${normalizeAlphabetLabel(last.label)} 🔄` : normalizeAlphabetLabel(last.label);
                setPredictionText(`Sign: ${displayText} (${Math.round(last.conf * 100)}%)`);
            }
            // Don't show "Listening..." - just keep previous prediction or blank
            return;
        }

        const best = chooseBestCandidateWithLocalPriority(candidates);
        if (!best) return;
        const rawOutputLabel = best.isDynamic ? normalizeAlphabetLabel(best.label) : normalizeAlphabetLabel(getSmoothedPrediction(best.label));
        const outputLabel = applyISLHandCountDisambiguation(rawOutputLabel, detectedHandCount);
        updateDisplayedPrediction(outputLabel, best.conf, !!best.isDynamic, flatLandmarks);

        // Clear dynamic buffer if dynamic sign detected with good confidence
        if (best.isDynamic && best.conf > 0.60) { // Lowered from 0.75
            setTimeout(() => {
                dynamicFrameBuffer = [];
                dynamicBufferStartTime = 0;
            }, 500); // Small delay before clearing
        }

        // Check if it's a single letter
        if (outputLabel.length === 1 && /^[a-zA-Z]$/.test(outputLabel)) {
            if (best.isDynamic && isASLDynamicSpellingLetter(outputLabel)) {
                processDynamicPredictedLetter(outputLabel, best.conf);
            } else {
                processPredictedLetter(outputLabel);
            }
            setPredictionText(`Sign: ${outputLabel} (${Math.round(best.conf * 100)}%)`);
        } else if (accumulatedWord.length > 0) {
            // During spelling, suppress prediction display (only show spelling overlay)
            setPredictionText('');
        } else {
            const displayText = best.isDynamic ? `${outputLabel} 🔄` : outputLabel;
            setPredictionText(`Sign: ${displayText} (${Math.round(best.conf * 100)}%)`);

            const now = Date.now();
            // Change-only speaking: do not repeat while the same sign remains detected.
            const isDifferentSign = outputLabel !== lastSpokenLabel;
            const shouldSpeak = isDifferentSign;

            if (shouldSpeak) {
                lastSpokenLabel = outputLabel;
                lastSpokenTime = now;
                localWordLastSpoken[outputLabel] = now;

                if (isSTTOn) {
                    const logText = best.isDynamic ? `${outputLabel} 🔄` : outputLabel;
                    appendCaptionLog("You", logText);
                    displayVCSignCards(outputLabel);
                }

                if (supabaseChannel) {
                    supabaseChannel.send({
                        type: 'broadcast',
                        event: 'sign-message',
                        payload: { 
                            text: outputLabel, 
                            name: localName, 
                            isDynamic: !!best.isDynamic 
                        }
                    });
                }

                if (EMOJI_MAP[outputLabel.toUpperCase()]) {
                    popEmojis(EMOJI_MAP[outputLabel.toUpperCase()]);
                    if (supabaseChannel) {
                        supabaseChannel.send({
                            type: 'broadcast',
                            event: 'emoji-pop',
                            payload: { emoji: EMOJI_MAP[outputLabel.toUpperCase()] }
                        });
                    }
                }
            }
        }
    });
}

// --- Spelling Logic ---
// Use same hold-based filtering as translation page
function handleSpelling(letter) {
    const now = Date.now();
    lastLetterTime = now;

    if (letter === lastAddedLetter) {
        return;
    }

    lastAddedLetter = letter;
    accumulatedWord += letter;

    updateSpellingDisplay();
}

function processPredictedLetter(letter) {
    const now = Date.now();

    if (letter === heldLetter) {
        if (holdStartTime === 0) holdStartTime = now;
        if (now - holdStartTime >= minimumHoldDuration) {
            handleSpelling(letter);
            heldLetter = null;
            holdStartTime = 0;
        }
    } else {
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
    // Convert to Title Case to encourage TTS to say it as a word, not spell it (e.g. "Saurav" vs "SAURAV")
    const wordToSpeak = accumulatedWord.charAt(0).toUpperCase() + accumulatedWord.slice(1).toLowerCase();

    // Keep finalized spelled words in the local live caption feed too.
    if (isSTTOn) {
        appendCaptionLog("You", `[Spelled] ${wordToSpeak}`);
        displayVCSignCards(wordToSpeak);
    }

    // Send to remote user as specialized spelled-word event
    if (supabaseChannel) {
        supabaseChannel.send({
            type: 'broadcast',
            event: 'sign-message',
            payload: { text: wordToSpeak, name: localName, isSpelled: true }
        });
    }

    // Show in local toast
    setPredictionText(`Spelled: ${wordToSpeak}`);

    // Reset
    accumulatedWord = "";
    lastAddedLetter = null;
    updateSpellingDisplay();
}

// --- Training Logic ---
function saveToLocal() {
    // This helper updates the UI and stats after local data modification
    // Note: Use addDoc/deleteDoc for persistent Firestore changes.
}

// updateDataStats removed

// Training Logic removed

// --- Signaling & WebRTC ---
// Peer logic refactored into Supabase Channel setup
async function handlePeerJoined(id) {
    if (pc && (pc.connectionState === 'connected' || pc.connectionState === 'connecting')) {
        console.log("Peer already connected/connecting. Skipping offer.");
        return;
    }

    // Add a small jittered delay to avoid simultaneous offer collision
    await new Promise(r => setTimeout(r, Math.random() * 500 + 200));

    createPeerConnection();
    const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
    });
    offer.sdp = setMaxBitrate(offer.sdp, 1000);
    await pc.setLocalDescription(offer);
    console.log("Sending offer to peer...");
    supabaseChannel.send({
        type: 'broadcast',
        event: 'offer',
        payload: { sdp: offer, name: localName }
    });
}

function processBufferedIceCandidates() {
    if (!pc || !pc.remoteDescription) return;
    console.log(`Processing ${iceCandidatesBuffer.length} buffered ICE candidates`);
    iceCandidatesBuffer.forEach(candidate => {
        pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => {
            console.error("Error adding buffered ICE candidate:", e);
        });
    });
    iceCandidatesBuffer = [];
}

function createPeerConnection() {
    // Close any stale connection before creating a new one
    if (pc) {
        console.log("Closing existing peer connection before creating a new one.");
        pc.close();
        pc = null;
    }

    pc = new RTCPeerConnection(rtcConfig);
    console.log("RTCPeerConnection created.");

    // Add all local media tracks so the remote peer receives them
    if (localStream) {
        console.log(`Adding ${localStream.getTracks().length} local tracks to PeerConnection`);
        localStream.getTracks().forEach(track => {
            pc.addTrack(track, localStream);
        });
    } else {
        console.error("localStream is null when createPeerConnection is called!");
    }

    // When remote tracks arrive, display the remote video
    pc.ontrack = (event) => {
        console.log("Remote track received:", event.track.kind);

        if (event.streams && event.streams[0]) {
            if (remoteVideo.srcObject !== event.streams[0]) {
                remoteVideo.srcObject = event.streams[0];
                console.log("Attached remote stream from event.");
            }
        } else {
            // Fallback: manually build a MediaStream from individual tracks
            if (!remoteVideo.srcObject || !(remoteVideo.srcObject instanceof MediaStream)) {
                remoteVideo.srcObject = new MediaStream();
            }
            remoteVideo.srcObject.addTrack(event.track);
        }

        // Ensure remote audio plays (browsers may block autoplay)
        applyRemoteAudioPreference();
        const playPromise = remoteVideo.play();
        if (playPromise !== undefined) {
            playPromise.catch(err => {
                console.warn("Autoplay blocked — user interaction required:", err);
            });
        }
    };

    // Send our ICE candidates to the remote peer via Supabase
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            console.log(`Generated ICE candidate (${event.candidate.type}):`, event.candidate.candidate.substring(0, 50) + "...");
            if (supabaseChannel) {
                supabaseChannel.send({
                    type: 'broadcast',
                    event: 'ice',
                    payload: { candidate: event.candidate }
                });
            }
        }
    };

    // Update the meeting status bar
    pc.onconnectionstatechange = () => {
        const state = pc ? pc.connectionState : 'closed';
        console.log("WebRTC Connection State:", state);
        
        if (state === 'disconnected' || state === 'failed') {
            document.querySelector('.main-stage')?.classList.remove('is-connected');
        }
        if (state === 'connected') {
            showMeetingStatusToast('Connected', 'success');
        } else if (state === 'disconnected' || state === 'failed') {
            showMeetingStatusToast('Peer disconnected', 'error');
        } else if (state === 'connecting') {
            showMeetingStatusToast('Connecting...', 'info');
        }
    };

    pc.oniceconnectionstatechange = () => {
        console.log("WebRTC ICE Connection State:", pc ? pc.iceConnectionState : 'n/a');
        if (pc && pc.iceConnectionState === 'disconnected') {
            console.warn("Peer disconnected. Waiting for reconnection...");
        }
    };
}

// --- Audio Controls ---
micBtn.addEventListener('click', async () => {
    // If no audio track exists, attempt to acquire one (Retry logic)
    if (!localStream || !localStream.getAudioTracks().length) {
        try {
            console.log("Attempting to acquire microphone track...");
            const tempStream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                } 
            });
            const audioTrack = tempStream.getAudioTracks()[0];
            localStream.addTrack(audioTrack);
            
            if (pc) {
                // Inform remote user about new track
                pc.addTrack(audioTrack, localStream);
                // Renogotiation might be needed here but usually RTCPeerConnection handles simple addTrack ok
                // In some setups we might need to createOffer again.
            }
            
            isMicOn = true;
            initAudioAnalysis(localStream);
            alert("Microphone linked successfully!");
        } catch (e) {
            console.error("Microphone recovery failed:", e);
            alert("Could not find or access microphone. Check browser permissions.");
            return;
        }
    } else {
        isMicOn = !isMicOn;
        localStream.getAudioTracks()[0].enabled = isMicOn;
    }

    // Ensure AudioContext resumes if it was blocked by browser
    if (isMicOn && audioContext && audioContext.state === 'suspended') {
        await audioContext.resume();
    }

    micBtn.innerHTML = `<span class="material-icons">${isMicOn ? 'mic' : 'mic_off'}</span>`;
    micBtn.classList.toggle('red-btn', !isMicOn);
    micBtn.setAttribute('title', isMicOn ? 'Turn off microphone' : 'Turn on microphone');

    // Sync the status icon next to user name
    if (localVolumeMeter) {
        localVolumeMeter.innerText = isMicOn ? 'mic' : 'mic_off';
        if (!isMicOn) localVolumeMeter.classList.remove('volume-active');
    }

    // Immediate broadcast for responsiveness
    if (supabaseChannel) {
        supabaseChannel.send({
            type: 'broadcast',
            event: 'volume-level',
            payload: { level: 0, micOn: isMicOn }
        });
    }
});

camBtn.addEventListener('click', () => {
    isCamOn = !isCamOn;
    localStream.getVideoTracks().forEach(track => track.enabled = isCamOn);

    const localContainer = document.getElementById('localContainer');

    // UI feedback for video state
    if (!isCamOn) {
        ctx.clearRect(0, 0, localCanvas.width, localCanvas.height);
        setPredictionText("Camera Off");
        localContainer.classList.add('video-muted');
    } else {
        localContainer.classList.remove('video-muted');
        setPredictionText("Waiting for sign...");
    }

    camBtn.innerHTML = `<span class="material-icons">${isCamOn ? 'videocam' : 'videocam_off'}</span>`;
    camBtn.classList.toggle('red-btn', !isCamOn);
    camBtn.setAttribute('title', isCamOn ? 'Turn off camera' : 'Turn on camera');

    // Broadcast camera state
    if (supabaseChannel) {
        supabaseChannel.send({
            type: 'broadcast',
            event: 'camera-toggle',
            payload: { isCamOn }
        });
    }
});

if (ttsBtn) {
    ttsBtn.addEventListener('click', () => {
        isTTSOn = !isTTSOn;
        updateTTSUI();
        if (!isTTSOn && window.speechSynthesis) {
            window.speechSynthesis.cancel();
        }
    });
}

if (ttsToggleBtn) {
    ttsToggleBtn.addEventListener('click', () => {
        isTTSOn = !isTTSOn;
        updateTTSUI();
        if (!isTTSOn && window.speechSynthesis) {
            window.speechSynthesis.cancel();
        }
    });
}

function speak(text) {
    if (!isTTSOn || !window.speechSynthesis) return;

    // 1. Hardware-level safety: Unified temporal debounce (500ms)
    // We use localStorage to coordinate across multiple tabs (e.g. if user has translation.html AND videocall.html open)
    const now = Date.now();
    const lastGlobalSpeak = parseInt(localStorage.getItem('lastGlobalSpeakTime') || '0');

    if (now - lastGlobalSpeak < 500) {
        console.log("Speech suppressed: global debounce active.");
        return;
    }

    // Update both memory and storage trackers
    window._lastSystemSpeakTime = now;
    localStorage.setItem('lastGlobalSpeakTime', now.toString());

    // 2. Clear any pending speak operation to avoid the setTimeout race condition
    if (speakTimeout) {
        clearTimeout(speakTimeout);
        speakTimeout = null;
    }

    // 3. Cancel current speech and queue the new one
    // We use a small delay because window.speechSynthesis.cancel() is often asynchronous 
    // on the OS level and needs a moment to clear hardware buffers.
    window.speechSynthesis.cancel();

    speakTimeout = setTimeout(() => {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        utterance.volume = 1.0;

        window.speechSynthesis.speak(utterance);
        speakTimeout = null;
    }, 50);
}

// --- Chat Logic ---

function closeAllPanels() {
    if (chatPanel) {
        chatPanel.classList.remove('open');
    }
    closeMoreOptionsMenu();
}

// Toggle Chat Panel
if (chatToggleBtn) {
    chatToggleBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent document click from closing it immediately
        const isOpen = chatPanel.classList.contains('open');
        console.log("Chat toggle clicked. Currently open:", isOpen);
        closeAllPanels();
        if (!isOpen) {
            chatPanel.classList.add('open');
            chatToggleBtn.style.color = ''; // Reset alert color
            console.log("Chat panel opened.");
        } else {
            console.log("Chat panel closed.");
        }
    });
}

if (closeChatBtn) closeChatBtn.addEventListener('click', () => chatPanel.classList.remove('open'));

if (moreOptionsBtn) {
    moreOptionsBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        toggleMoreOptionsMenu();
    });
}

if (moreOptionsMenu) {
    moreOptionsMenu.addEventListener('click', (event) => {
        event.stopPropagation();
    });
}

if (speakerToggleBtn) {
    speakerToggleBtn.addEventListener('click', () => {
        isRemoteAudioEnabled = !isRemoteAudioEnabled;
        localStorage.setItem('vc-remote-audio-enabled', JSON.stringify(isRemoteAudioEnabled));
        applyRemoteAudioPreference();
        updateOptionsMenuUI();
    });
}

if (skeletonToggleBtn) {
    skeletonToggleBtn.addEventListener('click', () => {
        isOverlayOn = !isOverlayOn;
        localStorage.setItem('vc-hand-overlay-enabled', JSON.stringify(isOverlayOn));
        if (!isOverlayOn && localCanvas.width && localCanvas.height) {
            ctx.clearRect(0, 0, localCanvas.width, localCanvas.height);
            overlayHadRenderedContent = false;
        }
        updateOptionsMenuUI();
    });
}

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
    if (supabaseChannel) {
        supabaseChannel.send({
            type: 'broadcast',
            event: 'chat-message',
            payload: msgData
        });
    }

    // Display locally
    appendMessage(msgData, 'self');

    // Clear input
    chatInput.value = '';
    sendChatBtn.disabled = true;
}

// Chat events refactored into Supabase Channel setup

// updatePeopleList removed

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

// Training Toggle removed

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


// Panel close listeners removed
hangupBtn.addEventListener('click', () => window.location.reload());

// Copy Code Logic
const copyCodeBtn = document.getElementById('copyCodeBtn');

function copyMeetingCode() {
    const code = roomName || (meetingCodeDisplay ? meetingCodeDisplay.innerText : '');
    if (!code) return;

    navigator.clipboard.writeText(code).then(() => {
        const desktopOriginal = meetingCodeDisplay ? meetingCodeDisplay.innerText : null;
        const mobileOriginal = mobileMeetingCodeDisplay ? mobileMeetingCodeDisplay.innerText : null;

        if (meetingCodeDisplay) meetingCodeDisplay.innerText = 'COPIED!';
        if (mobileMeetingCodeDisplay) mobileMeetingCodeDisplay.innerText = 'COPIED!';

        setTimeout(() => {
            if (meetingCodeDisplay && desktopOriginal !== null) meetingCodeDisplay.innerText = desktopOriginal;
            if (mobileMeetingCodeDisplay && mobileOriginal !== null) mobileMeetingCodeDisplay.innerText = mobileOriginal;
        }, 1500);
    });
}

// --- Drag to Scroll Utility (Matching Live Translation Mode) ---
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

    // Mobile touch support
    el.addEventListener('touchstart', (e) => {
        isDown = true;
        startX = e.touches[0].pageX - el.offsetLeft;
        startY = e.touches[0].pageY - el.offsetTop;
        scrollLeft = el.scrollLeft;
        scrollTop = el.scrollTop;
    });

    el.addEventListener('touchend', () => {
        isDown = false;
    });

    el.addEventListener('touchmove', (e) => {
        if (!isDown) return;
        
        if (direction === 'both' || direction === 'horizontal') {
            const x = e.touches[0].pageX - el.offsetLeft;
            const walkX = (x - startX) * 2;
            el.scrollLeft = scrollLeft - walkX;
        }
        
        if (direction === 'both' || direction === 'vertical') {
            const y = e.touches[0].pageY - el.offsetTop;
            const walkY = (y - startY) * 2;
            el.scrollTop = scrollTop - walkY;
        }
    });
}

function updateCaptionLogViewport() {
    if (!captionLogList) return;

    const entries = Array.from(captionLogList.children);
    if (entries.length === 0) {
        captionLogList.style.maxHeight = '0px';
        return;
    }

    const visibleEntries = entries.slice(-3);
    const listStyle = window.getComputedStyle(captionLogList);
    const gap = parseFloat(listStyle.gap || listStyle.rowGap || '0') || 0;
    const paddingTop = parseFloat(listStyle.paddingTop || '0') || 0;
    const paddingBottom = parseFloat(listStyle.paddingBottom || '0') || 0;
    const visibleHeight = visibleEntries.reduce((total, item) => total + item.offsetHeight, 0)
        + gap * Math.max(visibleEntries.length - 1, 0)
        + paddingTop
        + paddingBottom;

    captionLogList.style.maxHeight = `${Math.ceil(visibleHeight)}px`;
}

function getCaptionPanel() {
    return document.querySelector('.caption-log-panel');
}

function hasCaptionContent() {
    const hasEntries = !!(captionLogList && captionLogList.querySelector('.caption-log-entry'));
    const hasCards = !!(
        predictionSignCardsContainer &&
        predictionSignCardsContainer.classList.contains('active') &&
        vcCardQueue.length > 0 &&
        signCardsPanelWindow &&
        !signCardsPanelWindow.classList.contains('collapsed')
    );
    return hasEntries || hasCards;
}

function getLatestCaptionText() {
    if (!captionLogList) return '';
    const lastEntry = captionLogList.querySelector('.caption-log-entry:last-child');
    if (!lastEntry) return '';

    const speakerLabel = lastEntry.querySelector('.caption-log-speaker');
    const speakerText = speakerLabel ? speakerLabel.textContent : '';
    const fullText = lastEntry.textContent || '';
    return fullText.replace(speakerText, '').replace(/\s*🔄\s*/g, ' ').trim();
}

function ensureCaptionPanelVisible() {
    const panel = getCaptionPanel();
    if (!panel) return null;
    panel.classList.add('visible');
    return panel;
}

function dimCaptionPanel() {
    const panel = getCaptionPanel();
    if (!panel) return;
    panel.classList.remove('awake');
}

function wakeCaptionPanel() {
    if (!hasCaptionContent()) return;
    const panel = ensureCaptionPanelVisible();
    if (!panel) return;
    panel.classList.add('awake');
    if (captionPanelDimTimer) {
        clearTimeout(captionPanelDimTimer);
    }
    captionPanelDimTimer = setTimeout(() => {
        dimCaptionPanel();
    }, 7000);
}

function scrollCaptionLogToLatest() {
    if (!captionLogList) return;
    captionLogList.scrollTop = captionLogList.scrollHeight;
}

function snapCaptionLogToLatest() {
    if (!captionLogList) return;
    window.setTimeout(() => {
        scrollCaptionLogToLatest();
    }, 0);
}

// Enable for Video Call Screen elements
if (predictionSignCardsContainer) {
    predictionSignCardsContainer.addEventListener('mousedown', wakeCaptionPanel);
    predictionSignCardsContainer.addEventListener('touchstart', wakeCaptionPanel, { passive: true });
}
if (captionToggleBtn) {
    captionToggleBtn.addEventListener('click', () => {
        if (!captionLogWindow) return;
        const willCollapse = !captionLogWindow.classList.contains('collapsed');
        setCaptionLogCollapsed(willCollapse);
        if (willCollapse) {
            dimCaptionPanel();
        } else {
            wakeCaptionPanel();
            updateCaptionLogViewport();
            scrollCaptionLogToLatest();
        }
    });
}
if (signCardsToggleBtn) {
    signCardsToggleBtn.addEventListener('click', () => {
        if (!signCardsPanelWindow) return;
        const willCollapse = !signCardsPanelWindow.classList.contains('collapsed');
        signCardsPanelManuallyCollapsed = willCollapse;
        setSignCardsPanelCollapsed(willCollapse);
        if (willCollapse) {
            dimCaptionPanel();
        } else {
            wakeCaptionPanel();
        }
    });
}
if (captionLogList) {
    ensureCaptionPlaceholder();
    enableDragToScroll(captionLogList, 'vertical');
    captionLogList.addEventListener('mouseup', snapCaptionLogToLatest);
    captionLogList.addEventListener('mouseleave', snapCaptionLogToLatest);
    captionLogList.addEventListener('touchend', snapCaptionLogToLatest);
    captionLogList.addEventListener('touchcancel', snapCaptionLogToLatest);
    captionLogList.addEventListener('mousedown', wakeCaptionPanel);
    captionLogList.addEventListener('touchstart', wakeCaptionPanel, { passive: true });
    captionLogList.addEventListener('pointerdown', wakeCaptionPanel);
    document.addEventListener('mouseup', snapCaptionLogToLatest);
    document.addEventListener('touchend', snapCaptionLogToLatest);
    document.addEventListener('touchcancel', snapCaptionLogToLatest);
    window.addEventListener('resize', updateCaptionLogViewport);
    updateCaptionLogViewport();
    scrollCaptionLogToLatest();
}

if (copyCodeBtn) {
    copyCodeBtn.addEventListener('click', copyMeetingCode);
}

if (mobileCopyCodeBtn) {
    mobileCopyCodeBtn.addEventListener('click', copyMeetingCode);
}

const meetingCodeBtn = document.getElementById('meetingCodeBtn');
if (meetingCodeBtn) {
    meetingCodeBtn.addEventListener('click', copyMeetingCode);
}

// Full Room Modal Logic
const fullRoomModal = document.getElementById('full-room-modal');
const fullRoomOkBtn = document.getElementById('fullRoomOkBtn');

if (fullRoomOkBtn) {
    fullRoomOkBtn.addEventListener('click', () => {
        if (fullRoomModal) fullRoomModal.classList.remove('active');
    });
}
