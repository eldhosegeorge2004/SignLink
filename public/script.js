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

// Helper to load from Firestore
async function loadFromFirestore() {
    try {
        const querySnapshot = await getDocs(collection(db, dbCollection));
        collectedData = [];
        querySnapshot.forEach((doc) => {
            collectedData.push({ ...doc.data(), id: doc.id }); // Use Firestore ID
        });
        updateDataStats();
        renderSignList();
        console.log("Loaded data from Firestore:", collectedData.length);
    } catch (e) {
        console.error("Error loading from Firestore:", e);
    }
}

// Global State
let collectedData = [];
let batchQueue = []; // New data waiting to be uploaded

// Note: uniqueLabels is now maintained by loadModelsAndLabels so ensure
// the variable exists earlier. (declared above with models)

// --- DOM Elements ---
const joinScreen = document.getElementById('join-screen');
const meetingRoom = document.getElementById('meeting-room');
const newMeetingBtn = document.getElementById('newMeetingBtn');
const startRoomInput = document.getElementById('startRoomInput');
const lobbyStatus = document.getElementById('status');
const userNameInput = document.getElementById('userNameInput');
const joinBtn = document.getElementById('joinBtn');
const clockElement = document.getElementById('clock');
const modeSelect = document.getElementById('modeSelect');

const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const localCanvas = document.getElementById('localCanvas');
const ctx = localCanvas.getContext('2d');
const meetingCodeDisplay = document.getElementById('meetingCodeDisplay');
const predictionOverlay = document.getElementById('prediction-overlay');
const predictionDiv = document.getElementById('prediction');
const predictionSignCardsContainer = document.getElementById('prediction-sign-cards-container');
const remotePredictionDiv = document.getElementById('remotePrediction');
const remoteCaptionOverlay = document.getElementById('remote-caption-overlay');

const micBtn = document.getElementById('micBtn');
const camBtn = document.getElementById('camBtn');
const hangupBtn = document.getElementById('hangupBtn');
const trainToggleBtn = document.getElementById('trainToggleBtn');
const ttsBtn = document.getElementById('ttsBtn');

const sidePanel = document.getElementById('side-panel');
const closePanelBtn = document.getElementById('closePanelBtn');
const labelInput = document.getElementById('labelInput');
const collectBtn = document.getElementById('collectBtn');
const dataCountDiv = document.getElementById('dataCount');
const trainBtn = document.getElementById('trainBtn');
const saveBtn = document.getElementById('saveBtn');
const clearBtn = document.getElementById('clearBtn');
const trainStatusDiv = document.getElementById('trainStatus');
const sttToggleBtn = document.getElementById('sttToggleBtn');
const vcCaptionBar = document.getElementById('vc-caption-bar');
const vcLineA = document.getElementById('vc-caption-line-a');
const vcLineB = document.getElementById('vc-caption-line-b');
const captionLogList = document.getElementById('caption-log-list');
const localVolumeMeter = document.getElementById('localVolume');
const remoteVolumeMeter = document.getElementById('remoteVolume');

// Panels & Controls
const infoBtn = document.getElementById('infoBtn');
const peopleBtn = document.getElementById('peopleBtn');
const chatToggleBtn = document.getElementById('chatToggleBtn');

const infoPanel = document.getElementById('info-panel');
const peoplePanel = document.getElementById('people-panel');
const chatPanel = document.getElementById('chat-panel');

const closeInfoBtn = document.getElementById('closeInfoBtn');
const closePeopleBtn = document.getElementById('closePeopleBtn');
const closeChatBtn = document.getElementById('closeChatBtn');

const infoCurrentMode = document.getElementById('infoCurrentMode');
const infoMeetingCode = document.getElementById('infoMeetingCode');
const copyInfoCodeBtn = document.getElementById('copyInfoCodeBtn');
const peopleList = document.getElementById('peopleList');

const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const sendChatBtn = document.getElementById('sendChatBtn');

// --- Global State ---
let localStream;
let pc;
let roomName;
let isMicOn = true;
let isCamOn = true;
let isTTSOn = true;
let isSTTOn = false;
let lastSpokenTime = 0;
let lastRemoteSpokenTime = 0;
const localWordLastSpoken = {};    // NEW: Per-word cooldown for local signs
const remoteWordLastSpoken = {};   // NEW: Per-word cooldown for remote signs
let lastSpokenLabel = "";
let lastRemoteSpokenText = "";
let speakTimeout = null;           // NEW: Track pending speech to avoid race conditions
let iceCandidatesBuffer = []; // Buffer for ICE candidates
let isRecognitionActive = false;   // NEW: Track if SpeechRecognition is actually running
let localName = "You";
let remoteName = "Remote User";

// --- YouTube-style Caption State (Video Call) ---
let vcCaptionLineA = '';
let vcCaptionLineB = '';
const VC_CAPTION_MAX_CHARS = 50; // slightly wider than translation page (wider video layout)
let vcCardQueue = [];
let vcCardRenderSeq = 0;
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
        const response = await fetch('/api/sign-cards', { cache: 'no-cache' });
        if (!response.ok) return;
        const cards = await response.json(); // { isl: [{label, url}], asl: [...] }
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
    if (!predictionSignCardsContainer) return 8;

    const panelWidth = predictionSignCardsContainer.clientWidth;
    if (!panelWidth) return 8;

    const style = window.getComputedStyle(predictionSignCardsContainer);
    const gap = parseInt(style.columnGap || style.gap || '10', 10) || 10;
    const cardWidth = 76;
    const columns = Math.max(1, Math.floor((panelWidth + gap) / (cardWidth + gap)));
    return columns * 2;
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

async function resolveWordTokens(word, langFolder) {
    const normalizedWord = word.toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (!normalizedWord) return [];

    const wordCandidates = [
        `/signs-images/${langFolder}/words/${normalizedWord}.jpg`,
        `/signs-images/${langFolder}/words/${normalizedWord}.png`,
        `/signs-images/${langFolder}/${normalizedWord}.jpg`,
        `/signs-images/${langFolder}/${normalizedWord}.png`
    ];

    for (const src of wordCandidates) {
        if (await checkImageExists(src)) {
            return [{ type: 'card', src, label: normalizedWord }];
        }
    }

    const charTokens = [];
    const charsOnly = normalizedWord.replace(/-/g, '');
    for (const char of charsOnly.toUpperCase()) {
        if (!/[A-Z0-9]/.test(char)) continue;

        const charCandidates = [];
        if (/[A-Z]/.test(char)) {
            charCandidates.push(`/signs-images/${langFolder}/characters/${char}.jpg`);
            charCandidates.push(`/signs-images/${langFolder}/characters/${char}.png`);
        } else {
            charCandidates.push(`/signs-images/${langFolder}/characters/${char}.jpg`);
            charCandidates.push(`/signs-images/${langFolder}/characters/${char}.png`);
            const digitWord = DIGIT_WORD_MAP[char];
            if (digitWord) {
                charCandidates.push(`/signs-images/${langFolder}/characters/${digitWord}.jpg`);
                charCandidates.push(`/signs-images/${langFolder}/characters/${digitWord}.png`);
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

function setPredictionText(text) {
    if (predictionDiv) {
        predictionDiv.innerText = text;
    }
}

setPredictionText("Waiting for sign...");

// Resume audio on any user interaction
document.addEventListener('click', () => {
    if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume().then(() => console.log("AudioContext manually resumed."));
    }
}, { once: true });

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
    const now = new Date();
    clockElement.innerText = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
setInterval(updateClock, 1000);
updateClock();

// --- Accessibility & Communication Boost Features ---

// 1. Speech to Text (Bi-Directional)
function initSTT() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
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
            const trimmed = finalTranscript.trim();
            appendVCCaption(trimmed);
            appendCaptionLog('You', trimmed);
            // Send finalized text to remote peer
            // Send finalized text to remote peer
            if (supabaseChannel) {
                supabaseChannel.send({
                    type: 'broadcast',
                    event: 'speech-message',
                    payload: { text: trimmed }
                });
            }
        } else {
            // Show interim words in real-time
            updateVCCaptionDisplay(interimTranscript.trim());
        }
    };

    recognition.onerror = (event) => {
        console.error("STT Error:", event.error);
        if (event.error === 'not-allowed') {
            alert("Speech recognition permission denied.");
            isSTTOn = false;
            updateSTTUI();
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

function updateSTTUI() {
    if (!sttToggleBtn) return;
    sttToggleBtn.innerHTML = `<span class="material-icons">${isSTTOn ? 'interpreter_mode' : 'voice_over_off'}</span>`;
    sttToggleBtn.classList.toggle('red-btn', !isSTTOn);
    sttToggleBtn.title = isSTTOn ? "Turn off Speech-to-Text" : "Turn on Speech-to-Text";
}
updateSTTUI(); // Sync at startup

function updateTTSUI() {
    if (!ttsBtn) return;
    ttsBtn.innerHTML = `<span class="material-icons">${isTTSOn ? 'volume_up' : 'volume_off'}</span>`;
    ttsBtn.classList.toggle('red-btn', !isTTSOn);
    ttsBtn.setAttribute('title', isTTSOn ? 'Mute Text-to-Speech' : 'Enable Text-to-Speech');
}
updateTTSUI(); // Sync at startup

sttToggleBtn.addEventListener('click', () => {
    isSTTOn = !isSTTOn;
    updateSTTUI();

    if (isSTTOn) {
        if (!recognition) initSTT();
        if (!isRecognitionActive) {
            try {
                recognition.start();
                if (vcCaptionBar) vcCaptionBar.classList.add('active');
                resetVCCaptions();
            } catch (e) {
                console.error("Failed to start Recognition:", e);
                isSTTOn = false;
                updateSTTUI();
            }
        }
    } else {
        if (recognition && isRecognitionActive) recognition.stop();
        if (vcCaptionBar) vcCaptionBar.classList.remove('active');
        hideVCSignCards();
    }
});

// --- YouTube-Style Caption Helpers (Video Call) ---
function updateVCCaptionDisplay(interimText = '') {
    if (!vcLineA || !vcLineB) return;
    vcLineA.textContent = vcCaptionLineA;
    if (interimText) {
        vcLineB.innerHTML =
            (vcCaptionLineB ? document.createTextNode(vcCaptionLineB + ' ').textContent : '') +
            `<span class="vc-interim">${interimText}</span>`;
    } else {
        vcLineB.textContent = vcCaptionLineB;
    }
}

function appendCaptionLog(speaker, text) {
    if (!captionLogList || !text) return;

    const emptyState = captionLogList.querySelector('.caption-log-empty');
    if (emptyState) emptyState.remove();

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
    captionLogList.scrollTop = captionLogList.scrollHeight;
}

function appendVCCaption(finalText) {
    const words = finalText.trim().split(/\s+/).filter(Boolean);
    for (const word of words) {
        const proposed = vcCaptionLineB ? vcCaptionLineB + ' ' + word : word;
        if (proposed.length > VC_CAPTION_MAX_CHARS && vcCaptionLineB) {
            vcCaptionLineA = vcCaptionLineB;
            vcCaptionLineB = word;
        } else {
            vcCaptionLineB = proposed;
        }
    }
    updateVCCaptionDisplay();
}

function resetVCCaptions() {
    vcCaptionLineA = '';
    vcCaptionLineB = '';
    updateVCCaptionDisplay();
    hideVCSignCards();
}

function displayVCSignCards(text) {
    const container = predictionSignCardsContainer;
    if (!container) return;

    const words = text.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return;

    const renderSeq = ++vcCardRenderSeq;
    const langFolder = currentMode.toLowerCase(); // 'isl' or 'asl'

    (async () => {
        const newTokens = [];
        const units = buildCardUnits(words, langFolder);

        for (let i = 0; i < units.length; i++) {
            const tokens = await resolveCardUnitTokens(units[i], langFolder);
            newTokens.push(...tokens);
            if (i < units.length - 1) {
                newTokens.push({ type: 'space' });
            }
        }

        if (renderSeq !== vcCardRenderSeq) return;

        if (vcCardQueue.length && vcCardQueue[vcCardQueue.length - 1]?.type !== 'linebreak') {
            vcCardQueue.push({ type: 'linebreak' });
        }
        vcCardQueue.push(...newTokens);

        const maxVisible = getVCVisibleCardCapacity();
        if (vcCardQueue.length > maxVisible) {
            const sliceStart = vcCardQueue.length - maxVisible;
            let trimmedQueue = vcCardQueue.slice(sliceStart);

            if (sliceStart > 0 && !['space', 'linebreak'].includes(vcCardQueue[sliceStart - 1]?.type)) {
                while (trimmedQueue.length && !['space', 'linebreak'].includes(trimmedQueue[0].type)) {
                    trimmedQueue.shift();
                }
            }

            vcCardQueue = trimmedQueue;
            while (vcCardQueue.length && ['space', 'linebreak'].includes(vcCardQueue[0].type)) {
                vcCardQueue.shift();
            }
        }

        container.innerHTML = '';

        const lineGroups = [];
        let currentLine = [];
        let currentGroup = [];
        for (const token of vcCardQueue) {
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
    })();
}

function hideVCSignCards() {
    const container = predictionSignCardsContainer;
    if (container) {
        vcCardRenderSeq++;
        vcCardQueue = [];
        container.classList.remove('active');
        container.innerHTML = '';
    }
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
            if (!isMicOn || !localStream || !localStream.getAudioTracks().some(t => t.enabled)) {
                localVolumeMeter.classList.remove('volume-active');
                return;
            }

            analyser.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < bufferLength; i++) {
                sum += dataArray[i];
            }
            let average = sum / bufferLength;
            let volume = average / 128; // 0 to 2

            if (volume > 0.02) {
                localVolumeMeter.classList.add('volume-active');
            if (supabaseChannel) {
                supabaseChannel.send({
                    type: 'broadcast',
                    event: 'volume-level',
                    payload: { level: volume }
                });
            }
            } else {
                localVolumeMeter.classList.remove('volume-active');
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
    const room = startRoomInput.value.trim();
    const name = userNameInput ? userNameInput.value.trim() : "";
    joinBtn.disabled = (room.length === 0 || name.length === 0);
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
        trainStatusDiv.innerText = "Model cleared (Switching mode).";

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
    let room = startRoomInput.value.trim();
    if (!room) {
        room = Math.random().toString(36).substring(7);
        startRoomInput.value = room;
    }
    
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

joinBtn.addEventListener('click', async () => {
    roomName = startRoomInput.value.trim().replace(/[^a-zA-Z0-9-]/g, '-');
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
    document.querySelector('.join-box').appendChild(diagBtn);


    // 1. MUST start camera BEFORE joining room to avoid WebRTC errors
    await startCamera();

    joinScreen.classList.remove('active');
    meetingRoom.classList.add('active');
    meetingCodeDisplay.innerText = roomName;

    // Capture Local Name
    localName = userNameInput.value.trim() || "You";
    const localNameSpan = document.getElementById('localUserName');
    if (localNameSpan) localNameSpan.innerText = localName + " (You)";
    updatePeopleList();

    // Supabase Channel Setup
    supabaseChannel = window.supabaseClient.channel(roomName, {
        config: {
            broadcast: { self: false },
            presence: { key: 'user-' + Math.random().toString(36).substring(7) }
        }
    });

    const updateStatus = (text, type = 'info') => {
        const statusEl = document.getElementById('status');
        const meetingStatusText = document.getElementById('meeting-status-text');
        const meetingStatusBar = document.getElementById('meeting-status-bar');

        if (statusEl) {
            statusEl.innerText = text;
            statusEl.style.color = type === 'error' ? '#ef4444' : (type === 'success' ? '#4db6ac' : '#aaa');
        }

        if (meetingStatusText) {
            meetingStatusText.innerText = text;
        }

        if (meetingStatusBar) {
            meetingStatusBar.className = `meeting-status-bar ${type}`;
        }
        
        console.log(`[Status] ${text}`);
    };
    supabaseChannel
        .on('broadcast', { event: 'user-joined' }, (payload) => {
            console.log("New peer joined room:", payload.id, "Name:", payload.name);
            if (payload.name) {
                remoteName = payload.name;
                const remoteNameSpan = document.getElementById('remoteUserName');
                if (remoteNameSpan) remoteNameSpan.innerText = remoteName;
                const remoteSaysLabel = document.getElementById('remote-says-label');
                if (remoteSaysLabel) remoteSaysLabel.innerText = `${remoteName} Says:`;
            }
            updatePeopleList(payload.id);
            if (localStream) {
                handlePeerJoined(payload.id);
            }
        })
        .on('broadcast', { event: 'offer' }, async ({ payload }) => {
            console.log("Offer received from peer. Name:", payload.name);
            if (payload.name) {
                remoteName = payload.name;
                const remoteNameSpan = document.getElementById('remoteUserName');
                if (remoteNameSpan) remoteNameSpan.innerText = remoteName;
                const remoteSaysLabel = document.getElementById('remote-says-label');
                if (remoteSaysLabel) remoteSaysLabel.innerText = `${remoteName} Says:`;
                updatePeopleList('peer-id'); // Ensure remote name is updated in people list
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
                    payload: { sdp: answer }
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
                remoteName = payload.name;
                const remoteNameSpan = document.getElementById('remoteUserName');
                if (remoteNameSpan) remoteNameSpan.innerText = remoteName;
                const remoteSaysLabel = document.getElementById('remote-says-label');
                if (remoteSaysLabel) remoteSaysLabel.innerText = `${remoteName} Says:`;
                updatePeopleList('peer-id');
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
            const payload = data.payload || data; // Handle different payload structures
            remotePredictionDiv.innerText = payload.text;
            
            // Update remote says label if it was "Remote User Says:"
            const remoteSaysLabel = document.getElementById('remote-says-label');
            if (remoteSaysLabel) remoteSaysLabel.innerText = `${remoteName} Says:`;

            remoteCaptionOverlay.classList.remove('hidden');
            setTimeout(() => remoteCaptionOverlay.classList.add('hidden'), 3000);

            const now = Date.now();
            const wordLastSpoken = remoteWordLastSpoken[payload.text] || 0;
            const timeSinceAny = now - lastRemoteSpokenTime;
            const timeSinceSame = now - wordLastSpoken;

            if (isTTSOn && timeSinceSame > 4000 && timeSinceAny > 800) {
                speak(payload.text);
                lastRemoteSpokenText = payload.text;
                lastRemoteSpokenTime = now;
                remoteWordLastSpoken[payload.text] = now;
            }
        })
        .on('broadcast', { event: 'speech-message' }, data => {
            const payload = data.payload || data;
            if (payload.text && payload.text.trim()) {
                if (vcCaptionBar && !vcCaptionBar.classList.contains('active')) {
                    vcCaptionBar.classList.add('active');
                }
                const remoteText = payload.text.trim();
                appendVCCaption(remoteText);
                appendCaptionLog(remoteName, remoteText);
                displayVCSignCards(remoteText);
            }
        })
        .on('broadcast', { event: 'chat-message' }, (data) => {
            const payload = data.payload || data;
            appendMessage({ ...payload, sender: 'Remote User' }, 'remote');
            if (!chatPanel.classList.contains('open') && chatToggleBtn) {
                chatToggleBtn.style.color = '#e37400';
            }
        })
        .on('broadcast', { event: 'volume-level' }, data => {
            const payload = data.payload || data;
            if (remoteVolumeMeter) {
                if (payload.level > 0.02) {
                    remoteVolumeMeter.classList.add('volume-active');
                } else {
                    remoteVolumeMeter.classList.remove('volume-active');
                }
            }
        })
        .on('broadcast', { event: 'emoji-pop' }, data => {
            const payload = data.payload || data;
            popEmojis(payload.emoji);
        })
        .on('broadcast', { event: 'user-left' }, (payload) => {
            console.log("Peer left room:", payload.id);
            updatePeopleList(null);
            if (pc) {
                pc.close();
                pc = null;
            }
            if (remoteVideo) {
                remoteVideo.srcObject = null;
            }
        })
        .subscribe(async (status) => {
            if (status === 'SUBSCRIBED') {
                updateStatus("Connected to signaling server", "success");
                // Notify others that we joined
                // Use a small delay for the new person to broadcast, ensuring others are ready
                setTimeout(() => {
                    supabaseChannel.send({
                        type: 'broadcast',
                        event: 'user-joined',
                        payload: { 
                            id: 'peer-' + Math.random().toString(36).substring(7),
                            name: localName
                        }
                    });
                }, 500);
            } else if (status === 'CHANNEL_ERROR') {
                updateStatus("Signaling connection error", "error");
            } else if (status === 'TIMED_OUT') {
                updateStatus("Signaling timed out", "error");
            }
        });

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
// updateModeVariables is async now, so wait for it and then load models
updateModeVariables().then(() => {
    loadModelsAndLabels();
});
loadSavedLabels();
loadFromFirestore();

function renderSignList() {
    const listDiv = document.getElementById('signList');
    if (!listDiv) return;

    // Group data by label
    const grouped = {};
    collectedData.forEach(item => {
        if (!grouped[item.label]) grouped[item.label] = [];
        grouped[item.label].push(item);
    });

    // Render grouped list
    listDiv.innerHTML = Object.keys(grouped).sort().map(label => {
        const count = grouped[label].length;
        return `
        <div class="sign-item">
            <div class="sign-info">
                <span class="sign-label">${label}</span>
                <span class="sign-count">${count} samples</span>
            </div>
            <button class="delete-btn" onclick="deleteLabel('${label}')" title="Delete Sign">
                <span class="material-icons" style="font-size: 18px;">delete</span>
            </button>
        </div>
        `;
    }).join('');
}

// Global function to delete all data for a specific label
// Global function to delete all data for a specific label
window.deleteLabel = async (label) => {
    if (!confirm(`Are you sure you want to delete the sign "${label}"? This will delete from the database.`)) return;

    // 1. Identify items to delete
    const itemsToDelete = collectedData.filter(d => d.label === label);

    // 2. Delete from Firestore
    // Note: Batch delete is better, but simple loop for now
    for (const item of itemsToDelete) {
        if (item.id) {
            try {
                await deleteDoc(doc(db, dbCollection, item.id));
            } catch (e) {
                console.error("Failed to delete doc:", item.id, e);
            }
        }
    }

    // 3. Update local state
    collectedData = collectedData.filter(d => d.label !== label);
    renderSignList(); // Re-render
    updateDataStats();
    console.log(`Deleted sign: ${label}`);
};

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

    updateDataStats();
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
    try {
        const response = await fetch('labels.json');
        if (response.ok) {
            serverLabels = normalizeLabelList(await response.json()).labels;
            serverModel = await tf.loadLayersModel(serverModelPath);
            console.log(`Server model loaded (${serverLabels.length} labels)`);
        } else {
            console.warn('labels.json not found for server model.');
        }
    } catch (e) {
        console.warn('Server model load failed:', e);
    }

    // load local static model if available
    try {
        const localLabelData = localStorage.getItem(`${localStorageLabelKey}-static`);
        if (localLabelData) {
            const normalizedLocalLabels = normalizeLabelList(JSON.parse(localLabelData));
            uniqueLabels = normalizedLocalLabels.labels;
            if (normalizedLocalLabels.changed) {
                localStorage.setItem(`${localStorageLabelKey}-static`, JSON.stringify(uniqueLabels));
            }
            try {
                model = await tf.loadLayersModel(`localstorage://${localStorageModelKey}-static`);
                console.log(`Local static model loaded (${uniqueLabels.length} labels)`);
            } catch (e) {
                console.warn('Local static model weights not found in localStorage.');
                model = null;
            }
        }
    } catch (e) {
        console.warn('Local static model load failed:', e);
    }

    // load local dynamic model if available
    try {
        const dynamicLabelData = localStorage.getItem(`${localStorageLabelKey}-dynamic`);
        if (dynamicLabelData) {
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
                console.warn('Local dynamic model weights not found in localStorage.');
                modelDynamic = null;
            }
        }
    } catch (e) {
        console.warn('Local dynamic model load failed:', e);
    }

    // update training UI
    if ((model && uniqueLabels.length > 0) || (modelDynamic && uniqueLabelsDynamic.length > 0)) {
        trainStatusDiv.innerText = 'Saved model(s) loaded.';
        if (saveBtn) saveBtn.disabled = false;
    } else {
        trainStatusDiv.innerText = 'No saved local model.';
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

// initial load
loadModelsAndLabels();

// --- Camera & Hand Tracking ---
let isCameraStarted = false;
async function startCamera() {
    if (isCameraStarted) return;
    isCameraStarted = true;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert("Browser API navigator.mediaDevices.getUserMedia not available. Please ensure you are using a modern browser and running on localhost or HTTPS.");
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
        } catch (err) {
            if (err.name === 'NotFoundError') {
                console.warn("Microphone not found, attempting video only.");
                localStream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        facingMode: 'user',
                        width: { ideal: 1280 },
                        height: { ideal: 720 },
                        resizeMode: 'none',
                        frameRate: { ideal: 24, max: 30 }
                    }
                });
                alert("Microphone not found. Starting with camera only.");

                // Disable mic state and UI physically, but allow user to TRY enabling it again.
                isMicOn = false;
                micBtn.innerHTML = `<span class="material-icons">mic_off</span>`;
                micBtn.classList.add('red-btn');
                micBtn.disabled = false; // Allow user to click and retry
                micBtn.title = "No microphone detected (Click to retry)";
                micBtn.style.opacity = "1";
                micBtn.style.cursor = "pointer";

                // Add retry handler ONLY if not already added (simple check)
                if (!micBtn.hasAttribute('data-retry-listener')) {
                    micBtn.setAttribute('data-retry-listener', 'true');
                    micBtn.addEventListener('click', async (e) => {
                        e.stopImmediatePropagation(); // Prevent standard toggle logic
                        try {
                            console.log("Retrying microphone access...");
                            const audioConstraints = {
                                audio: {
                                    echoCancellation: { ideal: true },
                                    noiseSuppression: { ideal: true },
                                    autoGainControl: { ideal: true }
                                }
                            };
                            const newStream = await navigator.mediaDevices.getUserMedia(audioConstraints);

                            // Success! Add track to stream and PC
                            const audioTrack = newStream.getAudioTracks()[0];
                            localStream.addTrack(audioTrack);
                            if (pc) {
                                pc.addTrack(audioTrack, localStream); // sending to remote
                            }

                            // Update UI
                            isMicOn = true;
                            micBtn.innerHTML = `<span class="material-icons">mic</span>`;
                            micBtn.classList.remove('red-btn');
                            micBtn.title = "Turn off microphone";

                            // Initialize analysis for the new track
                            initAudioAnalysis(localStream);

                            alert("Microphone connected successfully!");
                        } catch (retryErr) {
                            console.error("Retry failed:", retryErr);
                            alert("Still cannot find microphone. Please check connection.");
                        }
                    }, { once: true }); // Only try this special retry once per failure state
                }

            } else {
                throw err;
            }
        }
        localVideo.srcObject = localStream;

        let frameCount = 0;
        const camera = new Camera(localVideo, {
            onFrame: async () => {
                if (isCamOn) {
                    // CPU Optimization: Only run AI tracking every 3rd frame (roughly 10-15 FPS)
                    // This keeps the video call smooth while still detecting signs effectively.
                    frameCount++;
                    if (frameCount % 3 === 0) {
                        await hands.send({ image: localVideo });
                    }
                } else {
                    console.debug('onFrame: camera disabled');
                }
            },
        });
        await camera.start();
        initAudioAnalysis(localStream);
    } catch (err) {
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

function onResults(results) {
    console.debug('onResults invoked', {
        hands: results.multiHandLandmarks ? results.multiHandLandmarks.length : 0
    });
    if (localCanvas.width !== localVideo.videoWidth || localCanvas.height !== localVideo.videoHeight) {
        localCanvas.width = localVideo.videoWidth;
        localCanvas.height = localVideo.videoHeight;
    }

    ctx.save();
    ctx.clearRect(0, 0, localCanvas.width, localCanvas.height);

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

        // ALWAYS use the first hand for prediction to avoid "Double Speak" from two hands
        const landmarks = results.multiHandLandmarks[0];

        // Handle Hand Overlay Drawing
        if (isOverlayOn && typeof drawConnectors !== 'undefined') {
            for (const hand of results.multiHandLandmarks) {
                drawConnectors(ctx, hand, HAND_CONNECTIONS, { color: '#00FF00', lineWidth: 4 });
                drawLandmarks(ctx, hand, { color: '#FF0000', lineWidth: 2 });
            }
        }

        // Preprocess for AI (Normalization is Scale/Translation invariant)
        const flatLandmarks = preprocessLandmarks(landmarks);

        const detectedHandCount = Math.min(2, results.multiHandLandmarks.length);

        // Handle Collection or Prediction
        if (isCollecting) {
            const label = labelInput.value.trim();
            if (label) {
                saveGesture(label, flatLandmarks);
            }
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
            console.log("Hands removed, resetting lastAddedLetter");
            lastAddedLetter = null;
        }
        // also clear hold tracking
        heldLetter = null;
        holdStartTime = 0;
    }
    ctx.restore();
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
            const conf = pred.max().dataSync()[0];
            const idx = pred.argMax(-1).dataSync()[0];
            const label = normalizeAlphabetLabel(serverLabels[idx]);
            if (!shouldSkipStaticLabel(label)) {
                candidates.push({ label, conf, source: 'server' });
            }
        }

        // local static predictions (only when hand is still)
        if (staticAllowed && model && uniqueLabels.length) {
            const pred = model.predict(input);
            const conf = pred.max().dataSync()[0];
            const idx = pred.argMax(-1).dataSync()[0];
            const label = normalizeAlphabetLabel(uniqueLabels[idx]);
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
                const conf = predDynamic.max().dataSync()[0];
                const idx = predDynamic.argMax(-1).dataSync()[0];
                const predictedDynamicLabel = normalizeAlphabetLabel(uniqueLabelsDynamic[idx]);

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

                if (supabaseChannel) {
                    supabaseChannel.send({
                        type: 'broadcast',
                        event: 'sign-message',
                        payload: { text: outputLabel }
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

    if (isTTSOn) speak(letter.toLowerCase());
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

    // Speak locally if TTS is on
    if (isTTSOn || forceSpeak) speak(wordToSpeak);

    // Send to remote user
    if (supabaseChannel) {
        supabaseChannel.send({
            type: 'broadcast',
            event: 'sign-message',
            payload: { text: wordToSpeak }
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
    updateDataStats();
    renderSignList();
}

function updateDataStats() {
    dataCountDiv.innerText = `Samples: ${collectedData.length}`;
}

collectBtn.addEventListener('mousedown', () => isCollecting = true);
collectBtn.addEventListener('mouseup', async () => {
    isCollecting = false;

    if (batchQueue.length > 0) {
        const count = batchQueue.length;
        trainStatusDiv.innerText = `Saving ${count} samples...`;

        // Upload batch
        try {
            const promises = batchQueue.map(data => addDoc(collection(db, dbCollection), data));
            await Promise.all(promises);
            trainStatusDiv.innerText = `Saved ${count} samples to DB!`;
            batchQueue = []; // Clear queue
            // Reload to get IDs? Or just trust it. Reloading is safer for Sync.
            await loadFromFirestore();
        } catch (e) {
            console.error("Error saving batch:", e);
            trainStatusDiv.innerText = "Error saving data.";
        }
    }
});

trainBtn.addEventListener('click', async () => {
    if (collectedData.length < 10) return alert("Collect more data (min 10 samples)!");

    uniqueLabels = [...new Set(collectedData.map(d => d.label))];
    if (uniqueLabels.length < 2) return alert("Need at least 2 different signs.");

    const labelMap = {};
    uniqueLabels.forEach((l, i) => labelMap[l] = i);

    const xs = tf.tensor2d(collectedData.map(d => d.landmarks));
    const ys = tf.oneHot(tf.tensor1d(collectedData.map(d => labelMap[d.label]), 'int32'), uniqueLabels.length);

    const newModel = tf.sequential();
    newModel.add(tf.layers.dense({ units: 64, activation: 'relu', inputShape: [63] }));
    newModel.add(tf.layers.dropout({ rate: 0.2 })); // Prevent overfitting
    newModel.add(tf.layers.dense({ units: 32, activation: 'relu' }));
    newModel.add(tf.layers.dense({ units: uniqueLabels.length, activation: 'softmax' }));

    newModel.compile({ optimizer: 'adam', loss: 'categoricalCrossentropy', metrics: ['accuracy'] });

    trainStatusDiv.innerText = "Training...";
    trainBtn.disabled = true;

    await newModel.fit(xs, ys, {
        epochs: 40,
        shuffle: true,
        callbacks: {
            onEpochEnd: (epoch, logs) => {
                trainStatusDiv.innerText = `Loss: ${logs.loss.toFixed(3)}`;
            }
        }
    });

    model = newModel;
    updateModelStatusUI();
    trainStatusDiv.innerText = "Training Done!";
    trainBtn.disabled = false;
    if (saveBtn) saveBtn.disabled = false;

    // 4. Auto-save for better persistence
    try {
        await model.save(`localstorage://${localStorageModelKey}`);
        localStorage.setItem(localStorageLabelKey, JSON.stringify(uniqueLabels));
        console.log("Model and labels auto-saved successfully.");
    } catch (err) {
        console.error("Auto-save failed:", err);
    }

    xs.dispose();
    ys.dispose();
});

saveBtn.addEventListener('click', async () => {
    if (!model) return;
    await model.save(`localstorage://${localStorageModelKey}`);
    localStorage.setItem(localStorageLabelKey, JSON.stringify(uniqueLabels));
    alert("Model and labels saved!");
});

clearBtn.addEventListener('click', () => {
    if (!confirm("Are you sure you want to delete ALL collected training gestures? This cannot be undone.")) return;

    collectedData = [];
    saveToLocal();
    console.log("Deleted all gestures.");
});

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
        remoteVideo.muted = false;
        remoteVideo.volume = 1.0;
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
        const statusText = document.getElementById('meeting-status-text');
        const statusBar = document.getElementById('meeting-status-bar');
        if (statusText) {
            if (state === 'connected') {
                statusText.innerText = 'Connected';
                if (statusBar) statusBar.className = 'meeting-status-bar success';
            } else if (state === 'disconnected' || state === 'failed') {
                statusText.innerText = 'Peer disconnected';
                if (statusBar) statusBar.className = 'meeting-status-bar error';
            } else if (state === 'connecting') {
                statusText.innerText = 'Connecting...';
                if (statusBar) statusBar.className = 'meeting-status-bar info';
            }
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
    if (!localStream || !localStream.getAudioTracks().length) {
        console.warn("No audio track to toggle");
        return;
    }

    isMicOn = !isMicOn;
    localStream.getAudioTracks()[0].enabled = isMicOn;

    // Ensure AudioContext resumes if it was blocked by browser
    if (isMicOn && audioContext && audioContext.state === 'suspended') {
        await audioContext.resume();
    }

    micBtn.innerHTML = `<span class="material-icons">${isMicOn ? 'mic' : 'mic_off'}</span>`;
    micBtn.classList.toggle('red-btn', !isMicOn);
    micBtn.setAttribute('title', isMicOn ? 'Turn off microphone' : 'Turn on microphone');
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
});

ttsBtn.addEventListener('click', () => {
    isTTSOn = !isTTSOn;
    updateTTSUI();
});

function speak(text) {
    if (!window.speechSynthesis) return;

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
    sidePanel.classList.remove('open');
    chatPanel.classList.remove('open');
    if (infoPanel) infoPanel.classList.remove('open');
    if (peoplePanel) peoplePanel.classList.remove('open');
}

// Toggle Chat Panel
if (chatToggleBtn) {
    chatToggleBtn.addEventListener('click', () => {
        const isOpen = chatPanel.classList.contains('open');
        closeAllPanels();
        if (!isOpen) chatPanel.classList.add('open');
        if (chatToggleBtn) chatToggleBtn.style.color = '';
    });
}

// Toggle Info Panel
if (infoBtn) {
    infoBtn.addEventListener('click', () => {
        const isOpen = infoPanel.classList.contains('open');
        closeAllPanels();
        if (!isOpen) {
            infoPanel.classList.add('open');
            // Update info display
            if (infoMeetingCode) infoMeetingCode.innerText = roomName || "N/A";
            if (infoCurrentMode) infoCurrentMode.innerText = `${currentMode} Mode`;
        }
    });
}

// Toggle People Panel
if (peopleBtn) {
    peopleBtn.addEventListener('click', () => {
        const isOpen = peoplePanel.classList.contains('open');
        closeAllPanels();
        if (!isOpen) peoplePanel.classList.add('open');
    });
}

if (closeChatBtn) closeChatBtn.addEventListener('click', () => chatPanel.classList.remove('open'));
if (closeInfoBtn) closeInfoBtn.addEventListener('click', () => infoPanel.classList.remove('open'));
if (closePeopleBtn) closePeopleBtn.addEventListener('click', () => peoplePanel.classList.remove('open'));

if (copyInfoCodeBtn) {
    copyInfoCodeBtn.addEventListener('click', () => {
        if (!roomName) return;
        navigator.clipboard.writeText(roomName).then(() => {
            const icon = copyInfoCodeBtn.querySelector('.material-icons');
            icon.innerText = 'done';
            setTimeout(() => icon.innerText = 'content_copy', 2000);
        });
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

function updatePeopleList(remoteId = null) {
    if (!peopleList) return;

    let localInit = (localName || "Y").charAt(0).toUpperCase();
    let remoteInit = (remoteName || "R").charAt(0).toUpperCase();

    let html = `
        <div class="person-item">
            <div class="person-avatar">${localInit}</div>
            <div class="person-info">
                <div class="person-name">${localName} (You)</div>
                <div class="person-status">Connected</div>
            </div>
        </div>
    `;

    if (remoteId) {
        html += `
            <div class="person-item">
                <div class="person-avatar" style="background: #e37400;">${remoteInit}</div>
                <div class="person-info">
                    <div class="person-name">${remoteName}</div>
                    <div class="person-status" style="color: #4db6ac;">Connected</div>
                </div>
            </div>
        `;
    }

    peopleList.innerHTML = html;
}

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

// --- UI Toggles ---
const overlayBtn = document.getElementById('overlayBtn');
let isOverlayOn = true;

// Overlay Toggle
if (overlayBtn) {
    overlayBtn.addEventListener('click', () => {
        isOverlayOn = !isOverlayOn;
        overlayBtn.innerHTML = `<span class="material-icons" style="color: ${isOverlayOn ? '#4db6ac' : '#8b949e'};">${isOverlayOn ? 'layers' : 'layers_clear'}</span>`;
        overlayBtn.title = isOverlayOn ? "Hide Hand Overlay" : "Show Hand Overlay";
    });
}

// Toggles are already wired up above to isOverlayOn variable


// Training Toggle
trainToggleBtn.addEventListener('click', () => {
    const isOpen = sidePanel.classList.contains('open');
    closeAllPanels();
    if (!isOpen) sidePanel.classList.add('open');
});

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


closePanelBtn.addEventListener('click', () => sidePanel.classList.remove('open'));
hangupBtn.addEventListener('click', () => window.location.reload());

// More Options Toggle (Mobile)
const moreBtn = document.getElementById('moreBtn');
const secondaryControls = document.getElementById('secondary-controls');

if (moreBtn && secondaryControls) {
    moreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        secondaryControls.classList.toggle('active');
    });

    // Close dropdown when clicking elsewhere
    document.addEventListener('click', (e) => {
        if (!secondaryControls.contains(e.target) && !moreBtn.contains(e.target)) {
            secondaryControls.classList.remove('active');
        }
    });
}

// Copy Code Logic
const copyCodeBtn = document.getElementById('copyCodeBtn');
if (copyCodeBtn) {
    copyCodeBtn.addEventListener('click', () => {
        const code = meetingCodeDisplay.innerText;
        navigator.clipboard.writeText(code).then(() => {
            const originalText = meetingCodeDisplay.innerText;
            meetingCodeDisplay.innerText = "COPIED!";
            setTimeout(() => {
                meetingCodeDisplay.innerText = originalText;
            }, 1500);
        });
    });
}