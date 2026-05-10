// ==================== SIGNLINK AI TRAINING ====================
// This script handles the AI Training page for collecting and training sign language data.
// It manages camera input, hand landmark collection using MediaPipe, model training with TensorFlow.js,
// and synchronization with Supabase for cloud storage.

// ==================== TENSORFLOW.JS MOBILE OPTIMIZATION ====================
// Configure TensorFlow.js for mobile devices (Capacitor WebView)
// This ensures the AI model runs efficiently on mobile devices
async function configureTensorFlowForMobile() {
    try {
        // Prefer WebGL for better performance on mobile (GPU acceleration)
        await tf.setBackend('webgl');  // Set backend to WebGL
        console.log('TensorFlow.js backend set to WebGL');  // Log success
    } catch (e) {
        console.warn('WebGL backend not available, falling back to CPU:', e);  // Warn if WebGL fails
        try {
            await tf.setBackend('cpu');  // Fallback to CPU backend
            console.log('TensorFlow.js backend set to CPU');  // Log fallback
        } catch (cpuError) {
            console.error('Failed to set TensorFlow.js backend:', cpuError);  // Log error
        }
    }
    // Enable memory management for mobile (production mode)
    tf.enableProdMode();  // Enable production mode for better memory usage
    console.log('TensorFlow.js production mode enabled');  // Log success
}

// Initialize TensorFlow.js configuration on page load
configureTensorFlowForMobile();  // Call the configuration function

// ==================== DOM ELEMENTS ====================

// Camera and Canvas Elements (for video processing)
const videoElement = document.getElementById('inputVideo');  // Video element for camera feed
const canvasElement = document.getElementById('outputCanvas');  // Canvas for drawing output
const canvasCtx = canvasElement.getContext('2d');  // 2D drawing context for canvas

// UI Control Elements (main controls)
const langSelect = document.getElementById('langSelect');  // Language selector dropdown
const labelInput = document.getElementById('labelInput');  // Input for sign label name
const captureBtn = document.getElementById('captureBtn');  // Button to capture a sample
const statusMsg = document.getElementById('statusMsg');  // Status message display
const dataList = document.getElementById('dataList');  // List of collected data samples
const totalSamplesBadge = document.getElementById('totalSamples');  // Badge showing total sample count
const recIndicator = document.getElementById('recIndicator');  // Recording indicator (red dot)
const saveBtn = document.getElementById('saveBtn');  // Button to save trained model
const clearAllBtn = document.getElementById('clearAllBtn');  // Button to clear all data

// Data Panel (Sidebar) Elements (for viewing collected data)
const dataPanel = document.querySelector('.data-panel');  // Sidebar data panel
const openDataPanelBtn = document.getElementById('openDataPanelBtn');  // Button to open data panel
const openDataPanelBtnMobile = document.getElementById('openDataPanelBtnMobile');  // Mobile open button
const closeDataPanelBtn = document.getElementById('closeDataPanelBtn');  // Button to close data panel
const backToMainBtn = document.getElementById('backToMainBtn');  // Button to return to main view
const drawerBackdrop = document.getElementById('drawerBackdrop');  // Backdrop for drawer overlay

// Alert/Modal Elements (for custom alerts)
const alertBackdrop = document.getElementById('alertBackdrop');  // Alert backdrop
const customAlert = document.getElementById('customAlert');  // Custom alert dialog
const alertMessage = document.getElementById('alertMessage');  // Alert message text
const alertOkBtn = document.getElementById('alertOkBtn');  // Alert OK button

// Mobile Sidebar Elements (mobile-specific UI)
const mobileLabelDisplay = document.getElementById('mobileLabelDisplay');  // Mobile label display
const mobileModeDisplay = document.getElementById('mobileModeDisplay');  // Mobile mode display

// Mobile Multi-step Setup Elements (for adding new signs on mobile)
const mobileAddButtonWrap = document.getElementById('mobileAddButtonWrap');  // Add button wrapper
const mobileAddSignBtn = document.getElementById('mobileAddSignBtn');  // Mobile add sign button
const mobileRecordingActions = document.getElementById('mobileRecordingActions');  // Recording actions container
const mobileTrainSaveBtn = document.getElementById('mobileTrainSaveBtn');  // Mobile train/save button
const sidebarTrainSaveBtn = document.getElementById('sidebarTrainSaveBtn');  // Sidebar train/save button
const mobileSaveNextBtn = document.getElementById('mobileSaveNextBtn');  // Mobile save/next button
const mobileRecordingCounter = document.getElementById('mobileRecordingCounter');  // Recording counter display
const mobileBackBtn = document.getElementById('mobileBackBtn');  // Mobile back button
const mobileClearSignBtn = document.getElementById('mobileClearSignBtn');  // Mobile clear sign button
const revertLatestBtn = document.getElementById('revertLatestBtn');  // Revert latest button
const mobileRevertBtn = document.getElementById('mobileRevertBtn');  // Mobile revert button
const signSetupModal = document.getElementById('signSetupModal');  // Sign setup modal
const modalLabelInput = document.getElementById('modalLabelInput');  // Modal label input
const modalSignCardBtn = document.getElementById('modalSignCardBtn');  // Modal sign card button
const modalSignCardFileName = document.getElementById('modalSignCardFileName');  // Modal sign card filename
const startRecordingBtn = document.getElementById('startRecordingBtn');  // Start recording button
const nextStepBtns = document.querySelectorAll('.next-step');  // All next step buttons
const prevStepBtns = document.querySelectorAll('.prev-step');  // All previous step buttons
const modalSteps = document.querySelectorAll('.modal-step');  // All modal steps
const langOptions = document.querySelectorAll('.lang-option');  // Language option buttons
const modeOptions = document.querySelectorAll('.mode-option');  // Mode option buttons
const captureBtnPortal = document.getElementById('captureBtnPortal');  // Capture button portal

// Sign Card Elements (for reference images of signs)
const signCardBtn = document.getElementById('signCardBtn');  // Sign card button
const signCardInput = document.getElementById('signCardInput');  // Sign card file input
const signCardStatus = document.getElementById('signCardStatus');  // Sign card status display
const clearSignDetailsBtn = document.getElementById('clearSignDetailsBtn');  // Clear sign details button
const signCardFileName = document.getElementById('signCardFileName');  // Sign card filename display

// Dynamic mode elements (for movement-based signs like 'Z')
const staticModeBtn = document.getElementById('staticModeBtn');  // Static mode button
const dynamicModeBtn = document.getElementById('dynamicModeBtn');  // Dynamic mode button
const modeDescription = document.getElementById('modeDescription');  // Mode description text
const captureHint = document.getElementById('captureHint');  // Capture hint text
const dynamicControls = document.getElementById('dynamicControls');  // Dynamic recording controls
const startRecordBtn = document.getElementById('startRecordBtn');  // Start dynamic recording button
const stopRecordBtn = document.getElementById('stopRecordBtn');  // Stop dynamic recording button
const frameCounter = document.getElementById('frameCounter');  // Frame counter display
const frameCount = document.getElementById('frameCount');  // Frame count display
const recordingProgress = document.getElementById('recordingProgress');  // Recording progress container
const progressBar = document.getElementById('progressBar');  // Progress bar element

// ==================== STATE VARIABLES ====================
// These variables track the current state of the training session
let isCollecting = false;  // Whether currently collecting hand landmark data
let collectedData = [];  // Array of collected training samples
let currentLang = 'ISL';  // Current language (ISL or ASL)
let model = null;  // TensorFlow.js model instance
let recordingMode = 'static';  // 'static' (single pose) or 'dynamic' (movement)
let hasRecordedSignInSession = false;  // Whether user has recorded any signs in current session
const MAX_STATIC_SAMPLES_PER_SESSION = 100;  // Max samples per sign in static mode
let staticSessionSampleCount = 0;  // Count of samples in current static session
let isStaticPausedNoHands = false;  // Whether static recording is paused due to no hands

// Dynamic recording state variables (for movement-based signs)
let isDynamicRecording = false;  // Whether currently recording dynamic sign frames
let dynamicFrameBuffer = [];  // Buffer of frames for dynamic signs
const MAX_DYNAMIC_FRAMES = 30;  // Maximum frames to capture for dynamic signs
const TARGET_FPS = 10;  // Capture ~10 frames per second for dynamic signs
let lastFrameCaptureTime = 0;  // Last time a frame was captured
let dynamicRecordingMaxHands = 1;  // Maximum number of hands to track in dynamic mode

// Pending data for mobile "Finish Setup" workflow
let pendingSignCard = null;  // { base64Data, extension } - sign card image waiting to upload
let lastSessionSampleCountAtStart = 0;  // Sample count when session started
let isInSetupMode = false;  // Whether in mobile setup mode
let lastRecordedBatchCount = 0;  // Count of last recorded batch
let sessionHistory = [];  // History of recorded sessions for revert functionality
let lastTrainSaveState = { lang: '', label: '', sampleCount: 0 };  // Last trained model state

// ==================== UI HELPER FUNCTIONS ====================

// Open the data panel drawer (sidebar)
function openDataDrawer() {
    if (!dataPanel) return;  // Check if panel exists
    dataPanel.classList.add('open');  // Add 'open' class to show panel
    if (drawerBackdrop) drawerBackdrop.classList.add('active');  // Show backdrop
}

// Close the data panel drawer (sidebar)
function closeDataDrawer() {
    if (!dataPanel) return;  // Check if panel exists
    dataPanel.classList.remove('open');  // Remove 'open' class to hide panel
    // Only hide backdrop if sign setup modal is not active
    if (drawerBackdrop && (!signSetupModal || !signSetupModal.classList.contains('active'))) {
        drawerBackdrop.classList.remove('active');  // Hide backdrop
    }
}

// Normalize label to uppercase for single letters, trim for others
// This ensures consistency in label formatting (e.g., 'a' becomes 'A', 'hello' stays 'hello')
function normalizeLabel(label) {
    const trimmed = (label || '').trim();  // Remove whitespace
    if (!trimmed) return '';  // Return empty if no label
    if (/^[a-zA-Z]$/.test(trimmed)) return trimmed.toUpperCase();  // Uppercase single letters
    return trimmed;  // Return trimmed label as-is
}

// Normalize all labels in a dataset
// Applies normalizeLabel to each sample's label in the dataset
function normalizeDatasetLabels(samples) {
    let changed = false;  // Track if any labels changed
    const normalized = samples.map((sample) => {  // Map through samples
        const normalizedLabel = normalizeLabel(sample.label);  // Normalize label
        if (normalizedLabel !== sample.label) {  // Check if changed
            changed = true;  // Mark as changed
            return { ...sample, label: normalizedLabel };  // Return updated sample
        }
        return sample;  // Return unchanged sample
    });
    return { normalized, changed };  // Return normalized data and change flag
}

// Normalize all labels in a list
// Applies normalizeLabel to each label in a list
function normalizeLabelList(labels) {
    let changed = false;  // Track if any labels changed
    const normalized = (labels || []).map((label) => {  // Map through labels
        const nextLabel = normalizeLabel(label);  // Normalize label
        if (nextLabel !== label) {  // Check if changed
            changed = true;  // Mark as changed
        }
        return nextLabel;  // Return normalized label
    });
    return { normalized, changed };  // Return normalized list and change flag
}

// Normalize hand requirement map keys (which signs need 1 or 2 hands)
// Ensures consistency in hand requirement mapping
function normalizeHandRequirementMap(map) {
    let changed = false;  // Track if any keys changed
    const normalized = {};  // Create new normalized object

    Object.entries(map || {}).forEach(([label, requirement]) => {  // Iterate through map
        const normalizedLabel = normalizeLabel(label);  // Normalize label key
        if (normalizedLabel !== label) {  // Check if changed
            changed = true;  // Mark as changed
        }
        normalized[normalizedLabel] = requirement;  // Add to normalized object
    });

    return { normalized, changed };  // Return normalized map and change flag
}

// Generate localStorage key for a sign card
// Creates a unique key for storing sign card data in localStorage
function getSignCardStorageKey(lang, label) {
    return `sign_card_${lang}_${normalizeLabel(label)}`;  // Return formatted key
}

// Generate localStorage prefix for sign cards of a language
// Creates a prefix to find all sign cards for a specific language
function getSignCardStoragePrefix(lang) {
    return `sign_card_${lang}_`;  // Return prefix string
}

// Get all stored sign card keys for a language
// Scans localStorage and returns all keys matching the language prefix
function getStoredSignCardKeys(lang) {
    const prefix = getSignCardStoragePrefix(lang);  // Get prefix for language
    const keys = [];  // Initialize keys array
    for (let i = 0; i < localStorage.length; i += 1) {  // Loop through localStorage
        const key = localStorage.key(i);  // Get key at index
        if (key && key.startsWith(prefix)) {  // Check if key matches prefix
            keys.push(key);  // Add to keys array
        }
    }
    return keys;  // Return matching keys
}

// Save current training data to localStorage (for offline backup)
// Persists collected data to localStorage for offline access
function persistCurrentTrainingDataLocally(lang = currentLang) {
    const keys = STORAGE_KEYS[lang];  // Get storage keys for language
    if (!keys) return;  // Exit if no keys

    if (collectedData.length === 0) {  // Check if no data
        localStorage.removeItem(keys.data);  // Remove existing data
        return;  // Exit function
    }

    try {
        localStorage.setItem(keys.data, JSON.stringify(collectedData));  // Save data as JSON
    } catch (e) {
        if (e.name === 'QuotaExceededError') {  // Check if storage full
            console.error('LocalStorage quota exceeded on mobile device');  // Log error
            showCustomAlert('Storage full. Please train and upload your data to clear space.');  // Alert user
        } else {
            console.error('Failed to save training data locally:', e);  // Log other errors
        }
    }
}

// Clear all local draft data for a language
// Removes training data and sign cards from localStorage
function clearLocalDraftDataForLanguage(lang = currentLang) {
    const keys = STORAGE_KEYS[lang];  // Get storage keys for language
    if (keys) {
        localStorage.removeItem(keys.data);  // Remove training data
    }

    const signCardKeys = getStoredSignCardKeys(lang);  // Get sign card keys
    signCardKeys.forEach((key) => localStorage.removeItem(key));  // Remove all sign cards
}

// Load local draft data from localStorage
// Retrieves previously saved training data from localStorage
function loadLocalDraftData(lang = currentLang) {
    const keys = STORAGE_KEYS[lang];  // Get storage keys for language
    if (!keys) return [];  // Return empty if no keys

    const raw = localStorage.getItem(keys.data);  // Get raw data
    if (!raw) return [];  // Return empty if no data

    try {
        const parsed = JSON.parse(raw);  // Parse JSON
        return Array.isArray(parsed) ? parsed : [];  // Return array or empty
    } catch (err) {
        return [];  // Return empty on error
    }
}

// Convert label to cloud-safe format (lowercase, hyphens only)
// Sanitizes label for use in cloud storage (removes special characters)
function toCloudSignLabel(label) {
    const normalized = normalizeLabel(label);  // Normalize label first
    if (!normalized) return '';  // Return empty if no label
    return normalized.toLowerCase().trim().replace(/[^a-z0-9-]/g, '-');  // Convert to safe format
}

// Delete sign cards from cloud storage
// Removes sign card images and database records from Supabase
async function deleteSignCardsFromCloud(labels = [], lang = currentLang) {
    const normalizedLabels = (labels || []).map((label) => toCloudSignLabel(label)).filter(Boolean);  // Normalize labels
    const langLower = lang.toLowerCase();  // Lowercase language

    try {
        const signCardsBucket = await window.getStorageBucket('signCards');  // Get bucket name
        let query = window.supabaseClient  // Build Supabase query
            .from('sign_cards')
            .select('label, extension')
            .eq('lang', langLower);

        if (normalizedLabels.length > 0) {  // If specific labels provided
            query = query.in('label', normalizedLabels);  // Filter by labels
        }

        const { data, error } = await query;  // Execute query
        if (error) throw error;  // Throw on error

        const rows = data || [];  // Get rows
        if (rows.length > 0) {  // If rows exist
            const paths = rows.map((row) => `${langLower}/${row.label}.${row.extension}`).filter(Boolean);  // Build paths
            if (paths.length > 0) {  // If paths exist
                const { error: removeErr } = await window.supabaseClient.storage  // Delete from storage
                    .from(signCardsBucket)
                    .remove(paths);
                if (removeErr) {
                    console.warn('Failed to remove one or more sign card files from storage:', removeErr);  // Log warning
                }
            }
        }

        let deleteQuery = window.supabaseClient  // Build delete query
            .from('sign_cards')
            .delete()
            .eq('lang', langLower);

        if (normalizedLabels.length > 0) {  // If specific labels provided
            deleteQuery = deleteQuery.in('label', normalizedLabels);  // Filter by labels
        }

        const { error: deleteErr } = await deleteQuery;  // Execute delete
        if (deleteErr) throw deleteErr;  // Throw on error
    } catch (err) {
        console.warn('Failed to delete sign cards from cloud:', err);  // Log warning
    }
}

// Upload sign card record to cloud
// Uploads sign card image to server for storage in Supabase
async function uploadSignCardRecord(label, cardRecord, lang = currentLang) {
    if (!cardRecord?.imageBase64 || !cardRecord?.extension) return;  // Validate input

    const normalizedLabel = normalizeLabel(label);  // Normalize label
    if (!normalizedLabel) return;  // Exit if no label
    const response = await fetch('/api/upload-sign-card', {  // Call upload API
        method: 'POST',  // POST method
        headers: { 'Content-Type': 'application/json' },  // JSON headers
        body: JSON.stringify({  // Request body
            lang,
            label: normalizedLabel,
            imageBase64: cardRecord.imageBase64,
            extension: cardRecord.extension
        })
    });

    const data = await response.json().catch(() => ({}));  // Parse response
    if (!response.ok) {  // Check if failed
        throw new Error(data.error || 'Failed to upload sign card');  // Throw error
    }
}

// Upload all pending sign cards from localStorage to cloud
// Uploads all locally stored sign cards to the server
async function uploadAllPendingSignCards(lang = currentLang) {
    const signCardKeys = getStoredSignCardKeys(lang);  // Get all sign card keys
    for (const key of signCardKeys) {  // Loop through keys
        const label = key.slice(getSignCardStoragePrefix(lang).length);  // Extract label from key
        try {
            const raw = localStorage.getItem(key);  // Get stored data
            if (!raw) continue;  // Skip if no data
            const cardRecord = JSON.parse(raw);  // Parse JSON
            await uploadSignCardRecord(label, cardRecord, lang);  // Upload to cloud
        } catch (e) {
            console.error(`Failed to upload sign card for ${label}:`, e);  // Log error
        }
    }
    // Upload pending sign card if exists
    if (pendingSignCard && normalizeLabel(labelInput.value)) {  // Check if pending card
        await uploadSignCardRecord(labelInput.value, {  // Upload pending card
            imageBase64: pendingSignCard.base64Data,
            extension: pendingSignCard.extension
        }, lang);
    }
}

// Get count of untrained samples
// Returns number of samples that haven't been trained yet
function getUntrainedSampleCount() {
    return collectedData.filter(sample => sample.isTrained === false).length;  // Count untrained
}

// Check if any data has been collected
// Returns true if there are samples in the dataset
function hasCollectedData() {
    return collectedData.length > 0;  // Check if data exists
}

// Check if all data has been trained
// Returns true if all samples are marked as trained
function hasAllDataTrained() {
    return hasCollectedData() && getUntrainedSampleCount() === 0;  // Check if all trained
}

// ==================== STORAGE KEYS ====================
// Storage Keys for localStorage (different keys for each language)
const STORAGE_KEYS = {
    'ISL': { model: 'my-isl-model', labels: 'isl_labels', data: 'isl_data' },  // ISL keys
    'ASL': { model: 'my-asl-model', labels: 'asl_labels', data: 'asl_data' }   // ASL keys
};

// ==================== INITIALIZATION ====================
// Initialize the training page when it loads
async function init() {
    startCamera();  // Start camera for hand detection
    setupModeToggle();  // Setup static/dynamic mode toggle
    setupMobileDataDrawer();  // Setup mobile data panel
    setupMobileSignSetup();  // Setup mobile sign setup workflow
    setupCustomAlert();  // Setup custom alert dialogs
    await loadDataFromServer();  // Load existing training data from server
}

let confirmResolver = null;  // Promise resolver for custom confirm dialogs

// Setup custom alert dialog event listeners
// Configures the OK and Cancel buttons for custom alerts
function setupCustomAlert() {
    const alertCancelBtn = document.getElementById('alertCancelBtn');  // Get cancel button

    if (alertOkBtn) {  // If OK button exists
        alertOkBtn.addEventListener('click', () => {  // Add click handler
            customAlert.classList.remove('active');  // Hide alert
            alertBackdrop.classList.remove('active');  // Hide backdrop
            if (confirmResolver) {  // If waiting for confirm
                confirmResolver(true);  // Resolve with true
                confirmResolver = null;  // Clear resolver
            }
        });
    }

    if (alertCancelBtn) {  // If cancel button exists
        alertCancelBtn.addEventListener('click', () => {  // Add click handler
            customAlert.classList.remove('active');  // Hide alert
            alertBackdrop.classList.remove('active');  // Hide backdrop
            if (confirmResolver) {  // If waiting for confirm
                confirmResolver(false);  // Resolve with false
                confirmResolver = null;  // Clear resolver
            }
        });
    }

    if (alertBackdrop) {  // If backdrop exists
        alertBackdrop.addEventListener('click', () => {  // Add click handler
            customAlert.classList.remove('active');  // Hide alert
            alertBackdrop.classList.remove('active');  // Hide backdrop
            if (confirmResolver) {  // If waiting for confirm
                confirmResolver(false);  // Resolve with false
                confirmResolver = null;  // Clear resolver
            }
        });
    }
}

// Show custom alert dialog
// Displays a custom alert with the given message
function showCustomAlert(message) {
    if (!customAlert || !alertMessage) {  // If custom alert not available
        alert(message);  // Fall back to browser alert
        return;  // Exit
    }
    alertMessage.textContent = message;  // Set message text
    const alertCancelBtn = document.getElementById('alertCancelBtn');  // Get cancel button
    if (alertCancelBtn) alertCancelBtn.style.display = 'none';  // Hide cancel button
    if (confirmResolver) { confirmResolver(false); confirmResolver = null; }  // Clear resolver
    customAlert.classList.add('active');  // Show alert
    alertBackdrop.classList.add('active');  // Show backdrop
}

// Show custom confirm dialog
// Displays a custom confirm dialog and returns a Promise with user's choice
function showCustomConfirm(message) {
    return new Promise((resolve) => {  // Return promise
        if (!customAlert || !alertMessage) {  // If custom alert not available
            resolve(confirm(message));  // Fall back to browser confirm
            return;  // Exit
        }
        alertMessage.textContent = message;  // Set message text
        const alertCancelBtn = document.getElementById('alertCancelBtn');  // Get cancel button
        if (alertCancelBtn) alertCancelBtn.style.display = 'block';  // Show cancel button
        confirmResolver = resolve;  // Store resolver
        customAlert.classList.add('active');  // Show alert
        alertBackdrop.classList.add('active');  // Show backdrop
    });
}

// Show toast notification
// Displays a temporary toast message with an icon
function showToast(message, icon = 'info') {
    const container = document.getElementById('toastContainer');  // Get toast container
    if (!container) return;  // Exit if container doesn't exist

    const toast = document.createElement('div');  // Create toast element
    toast.className = 'toast';  // Add toast class
    toast.innerHTML = `  // Set HTML content
        <span class="material-icons" style="font-size: 18px;">${icon}</span>  <!-- Icon -->
        <span>${message}</span>  <!-- Message -->
    `;
    container.appendChild(toast);  // Add to container

    // Auto-remove after 3 seconds
    setTimeout(() => {  // Set timeout
        toast.classList.add('out');  // Add fade-out class
        setTimeout(() => toast.remove(), 300);  // Remove after animation
    }, 3000);  // 3 second delay
}

// ==================== PROCESSING MODAL HANDLERS ====================
// Show processing modal with title and status
// Displays a modal to show processing progress
function showProcessingModal(title, status) {
    const modal = document.getElementById('processingModal');  // Get modal element
    const titleEl = document.getElementById('processingText');  // Get title element
    const statusEl = document.getElementById('processingStatus');  // Get status element
    
    if (modal && titleEl && statusEl) {  // If all elements exist
        titleEl.textContent = title;  // Set title
        statusEl.textContent = status;  // Set status
        modal.classList.add('active');  // Show modal
    }
}

// Update processing modal title and status
// Updates the text in the processing modal without hiding/showing it
function updateProcessingModal(title, status) {
    const titleEl = document.getElementById('processingText');  // Get title element
    const statusEl = document.getElementById('processingStatus');  // Get status element
    if (titleEl) titleEl.textContent = title;  // Update title
    if (statusEl) statusEl.textContent = status;  // Update status
}

// Hide processing modal
// Hides the processing modal from view
function hideProcessingModal() {
    const modal = document.getElementById('processingModal');  // Get modal element
    if (modal) modal.classList.remove('active');  // Hide modal
}

// ==================== MOBILE DATA DRAWER SETUP ====================
// Setup event listeners for the mobile data panel drawer
function setupMobileDataDrawer() {
    if (!dataPanel) return;  // Exit if panel doesn't exist

    // Add click listeners to open/close buttons
    if (openDataPanelBtn) openDataPanelBtn.addEventListener('click', openDataDrawer);  // Desktop open
    if (openDataPanelBtnMobile) openDataPanelBtnMobile.addEventListener('click', openDataDrawer);  // Mobile open
    if (closeDataPanelBtn) closeDataPanelBtn.addEventListener('click', closeDataDrawer);  // Close button
    if (backToMainBtn) backToMainBtn.addEventListener('click', closeDataDrawer);  // Back button

    // Close drawer when backdrop is clicked
    if (drawerBackdrop) {
        drawerBackdrop.addEventListener('click', closeDataDrawer);  // Backdrop click
    }

    // Close drawer when Escape key is pressed
    window.addEventListener('keydown', (event) => {  // Add key listener
        if (event.key === 'Escape') closeDataDrawer();  // Close on Escape
    });

    // Close drawer when clicking outside (capture phase)
    dataPanel.addEventListener('click', (event) => {  // Add click listener
        if (!(event.target instanceof Element)) return;  // Check if element
        const button = event.target.closest('button');  // Find closest button
        if (!button || !dataPanel.contains(button)) return;  // Check if button inside
        closeDataDrawer();  // Close drawer
    }, true);  // Use capture phase

    // Drawer behavior is now consistent across all screen sizes

    // Initial sync for mobile status tags
    updateMobileStatusTags();  // Update mobile UI status

    // Move capture button to portal on small screens
    // Always move capture button to portal for the unified view
    if (captureBtnPortal && captureBtn) {  // If portal and button exist
        captureBtnPortal.appendChild(captureBtn);  // Move button to portal
    }
}

// ==================== MOBILE SIGN SETUP WORKFLOW ====================
/**
 * Mobile Sign Setup Workflow (Multi-step Dialog)
 * Handles the multi-step modal for adding new signs on mobile devices
 */
function setupMobileSignSetup() {
    if (!mobileAddSignBtn) return;  // Exit if button doesn't exist

    let currentStep = 1;  // Track current modal step

    // Sync setup selections with current state
    // Updates the visual state of language and mode options in the modal
    const syncSetupSelections = () => {
        langOptions.forEach((option) => {  // Loop through language options
            const isActive = option.dataset.value === currentLang;  // Check if active
            option.classList.toggle('active', isActive);  // Toggle active class
            option.style.borderColor = isActive ? '#58a6ff' : '#30363d';  // Update border color
        });

        modeOptions.forEach((option) => {  // Loop through mode options
            const isActive = option.dataset.value === recordingMode;  // Check if active
            option.classList.toggle('active', isActive);  // Toggle active class
            option.style.borderColor = isActive ? '#58a6ff' : '#30363d';  // Update border color
        });

        const desc = document.getElementById('modalModeDesc');  // Get description element
        if (desc) {  // If description exists
            desc.textContent = recordingMode === 'static'  // Set description based on mode
                ? 'Static: Single pose signs (A, B, etc.)'  // Static description
                : 'Dynamic: Movement signs (Thank You, etc.)';  // Dynamic description
        }
    };

    // Update modal steps visibility
    // Shows only the current step in the multi-step modal
    const updateModalSteps = () => {
        modalSteps.forEach(step => {  // Loop through all steps
            step.classList.remove('active');  // Hide all steps
            if (parseInt(step.dataset.step) === currentStep) {  // Check if current step
                step.classList.add('active');  // Show current step
            }
        });
    };

    // Open setup modal at specific step
    // Opens the sign setup modal and sets it to the given step
    const openSetupModal = (step = 1) => {  // Step parameter (default 1)
        currentStep = step;  // Set current step
        syncSetupSelections();  // Sync selections
        updateModalSteps();  // Update step visibility
        signSetupModal.classList.add('active');  // Show modal
        if (drawerBackdrop) drawerBackdrop.classList.add('active');  // Show backdrop
    };

    // Close setup modal
    // Hides the sign setup modal
    const closeSetupModal = () => {
        signSetupModal.classList.remove('active');  // Hide modal
        // Only hide backdrop if data panel is not open
        if (drawerBackdrop && (!dataPanel || !dataPanel.classList.contains('open'))) {
            drawerBackdrop.classList.remove('active');  // Hide backdrop
        }
    };

    // Save current setup to localStorage
    // Saves the current sign setup (label, data, sign card) to localStorage
    const saveCurrentSetupToLocalStorage = () => {
        const label = normalizeLabel(labelInput.value);  // Normalize label
        if (!label) {  // Validate label
            throw new Error('Sign name is missing.');  // Throw error
        }

        if (getCurrentSetupSampleCount() === 0) {  // Check if samples recorded
            throw new Error('Record at least one sample before saving this sign.');  // Throw error
        }

        labelInput.value = label;  // Set normalized label

        persistCurrentTrainingDataLocally(currentLang);  // Save training data

        // Save sign card if pending
        if (pendingSignCard) {  // If sign card pending
            const cardKey = getSignCardStorageKey(currentLang, label);  // Get storage key
            try {
                localStorage.setItem(cardKey, JSON.stringify({  // Save sign card
                    imageBase64: pendingSignCard.base64Data,  // Image data
                    extension: pendingSignCard.extension  // File extension
                }));
            } catch (e) {
                if (e.name === 'QuotaExceededError') {  // Check if storage full
                    console.error('LocalStorage quota exceeded for sign card');  // Log error
                    showCustomAlert('Storage full. Cannot save sign card image.');  // Alert user
                } else {
                    console.error('Failed to save sign card:', e);  // Log error
                }
            }
        }

        sessionHistory = [];  // Clear session history
        updateMobileRevertState();  // Update revert button state
    };

    // Finish current setup and optionally open next
    // Saves the current setup and optionally opens the modal for the next sign
    const finishCurrentSetup = ({ openNext = false } = {}) => {  // openNext parameter
        const label = normalizeLabel(labelInput.value);  // Normalize label
        saveCurrentSetupToLocalStorage();  // Save to localStorage

        const message = openNext  // Choose message based on openNext
            ? `Saved "${label}". Add the next sign, then train the collected data before uploading.`  // Continue message
            : `Saved "${label}" locally!`;  // Done message

        showToast(message, openNext ? 'playlist_add_check' : 'storage');  // Show toast
        resetMobileSignSetup(false);  // Reset setup state
        renderDataList();  // Update data list

        if (openNext) {  // If opening next
            modalLabelInput.value = '';  // Clear label input
            const modalStatus = document.getElementById('modalSignCardStatus');  // Get status element
            if (modalStatus) modalStatus.textContent = '';  // Clear status
            if (modalSignCardFileName) {  // If filename element exists
                modalSignCardFileName.textContent = '';  // Clear filename
                modalSignCardFileName.style.display = 'none';  // Hide filename
            }
            openSetupModal(1);  // Reopen modal at step 1
            modalLabelInput.focus();  // Focus on label input
        }
    };

    // Mobile Finish button click handler
    // Saves the current setup when the finish button is clicked
    mobileAddSignBtn.addEventListener('click', async () => {  // Add click handler
    if (mobileAddSignBtn.dataset.setup !== 'true') return;  // Only if in finish mode

    mobileAddSignBtn.disabled = true;  // Disable button
    mobileAddSignBtn.innerHTML = '<span class="material-icons" style="font-size: 28px;">save</span>';  // Show save icon

    try {
        finishCurrentSetup();  // Save setup
    } catch (err) {
        console.error('Local save error:', err);  // Log error
        showCustomAlert(err.message || 'Failed to save to local storage. Storage might be full.');  // Alert user
        mobileAddSignBtn.disabled = false;  // Re-enable button
        mobileAddSignBtn.innerHTML = '<span class="material-icons" style="font-size: 28px;">check_circle</span>';  // Restore icon
    }
});

// Mobile Save & Next button
// Saves current setup and opens modal for next sign
if (mobileSaveNextBtn) {  // If button exists
    mobileSaveNextBtn.addEventListener('click', () => {  // Add click handler
        try {
            finishCurrentSetup({ openNext: true });  // Save and open next
        } catch (err) {
            console.error('Save and continue error:', err);  // Log error
            showCustomAlert(err.message || 'Failed to save this sign.');  // Alert user
        }
    });
}

// Clear Sign button (X)
// Discards current setup and clears data
mobileClearSignBtn.addEventListener('click', () => {  // Add click handler
    resetMobileSignSetup(true);  // Reset and discard data
});

// Mobile Back button
// Returns to setup mode without discarding data
if (mobileBackBtn) {  // If button exists
    mobileBackBtn.addEventListener('click', () => {  // Add click handler
        resetMobileSignSetup(false);  // Reset without discarding
    });
}

// Mobile Train & Save button
// Triggers model training and upload to server
if (mobileTrainSaveBtn) {  // If button exists
    mobileTrainSaveBtn.addEventListener('click', async () => {  // Add click handler
        if (!hasCollectedData()) {  // Check if data exists
            showToast("No collected data to train.", "warning");  // Show warning
            return;  // Exit
        }

        setTrainSaveButtonBusy(true);  // Set button to busy state

        try {
            showProcessingModal("Training & Saving...", "Training all newly added signs for Live Translation and Video Call.");
            const trainingResult = await runInternalTraining();

            updateProcessingModal("Saving Model...", "Saving the trained model on this device...");
            const savedAnyModel = await saveTrainedModelsToLocalStorage();
            if (!savedAnyModel) {
                throw new Error("No trained model was available to save.");
            }

            updateProcessingModal("Uploading Details...", "Uploading sign cards and reference images...");
            await uploadAllPendingSignCards();

            updateProcessingModal("Syncing Data...", "Saving hand landmarks to the cloud database...");
            await saveToServer();

            updateProcessingModal("Cloud Backup...", "Saving the trained model to the cloud so it works on all devices.");
            await uploadTrainedModelsToCloud();

            hideProcessingModal();

            // Clear local sign data now that everything is safely on the cloud
            collectedData = [];
            sessionHistory = [];
            clearLocalDraftDataForLanguage(currentLang);
            renderDataList();
            updateMobileRevertState();
            updateMobileTrainSaveVisibility();

            const successMsg = trainingResult?.alreadyTrained
                ? "All recorded signs were already trained and saved to cloud."
                : "All recorded signs trained and saved to cloud.";
            showToast(successMsg, 'task_alt');
            } catch (err) {
                console.error('Train & save failed:', err);
                hideProcessingModal();
                showCustomAlert(`Could not train and save the model: ${err.message || 'Unknown error'}`);
                setTrainSaveButtonBusy(false);
                return;
            }

            setTrainSaveButtonBusy(false);
        });
    }

    // Sidebar Train & Save button
    // Triggers model training from the sidebar panel
    if (sidebarTrainSaveBtn) {  // If button exists
        sidebarTrainSaveBtn.addEventListener('click', async () => {  // Add click handler
            if (!isTrainSaveEnabled()) {  // Check if training is enabled
                showToast("No untrained data available to train.", "warning");  // Show warning
                return;  // Exit
            }

            setTrainSaveButtonBusy(true);  // Set button to busy state

            try {
                showProcessingModal("Training & Saving...", "Training all newly added signs for Live Translation and Video Call.");  // Show modal
                const trainingResult = await runInternalTraining();  // Run training

                updateProcessingModal("Saving Model...", "Saving the trained model on this device...");  // Update status
                const savedAnyModel = await saveTrainedModelsToLocalStorage();  // Save locally
                if (!savedAnyModel) {  // Validate save
                    throw new Error("No trained model was available to save.");  // Throw error
                }

                updateProcessingModal("Uploading Details...", "Uploading sign cards and reference images...");  // Update status
                await uploadAllPendingSignCards();  // Upload sign cards

                updateProcessingModal("Syncing Data...", "Saving hand landmarks to the cloud database...");  // Update status
                await saveToServer();  // Save to server

                updateProcessingModal("Cloud Backup...", "Saving the trained model to the cloud so it works on all devices.");  // Update status
                await uploadTrainedModelsToCloud();  // Upload to cloud

                hideProcessingModal();  // Hide modal

                // Clear local sign data now that everything is safely on the cloud
                collectedData = [];  // Clear data
                sessionHistory = [];  // Clear history
                clearLocalDraftDataForLanguage(currentLang);  // Clear local drafts
                renderDataList();  // Update list
                updateMobileRevertState();  // Update revert state
                updateMobileTrainSaveVisibility();  // Update visibility
                updateSidebarTrainSaveState();  // Update sidebar state

                const successMsg = trainingResult?.alreadyTrained  // Check if already trained
                    ? "All recorded signs were already trained and saved to cloud."  // Already trained message
                    : "All recorded signs trained and saved to cloud.";  // Success message
                showToast(successMsg, 'task_alt');  // Show toast
            } catch (err) {
                console.error('Train & save failed:', err);  // Log error
                hideProcessingModal();  // Hide modal
                showCustomAlert(`Could not train and save the model: ${err.message || 'Unknown error'}`);  // Alert user
                setTrainSaveButtonBusy(false);  // Re-enable button
                return;  // Exit
            }

            setTrainSaveButtonBusy(false);  // Re-enable button
        });
    }

    // Sign Card Image from Modal
    // Handles sign card image upload from the modal
    if (modalSignCardBtn) {  // If button exists
        modalSignCardBtn.addEventListener('click', () => {  // Add click handler
            const label = normalizeLabel(modalLabelInput.value);  // Normalize label
            if (!label) {  // Validate label
                showCustomAlert("Please enter the details of the sign!");  // Alert user
                return;  // Exit
            }
            modalLabelInput.value = label;  // Set label in modal
            labelInput.value = label;  // Set label in main input
            // Trigger the hidden file input (re-using the main one)
            signCardInput.click();  // Click file input
        });
    }

    // ==================== UPLOAD TRAINED MODELS TO CLOUD ====================
    // Upload trained models to Supabase cloud storage
    // Saves both static and dynamic models with their labels
    async function uploadTrainedModelsToCloud() {
        if (!model) return;  // Exit if no model

        // Build model JSON structure
        const buildModelJson = (artifacts, weightFileName) => ({  // Function to build JSON
            modelTopology: artifacts.modelTopology,  // Model architecture
            format: artifacts.format || 'layers-model',  // Model format
            generatedBy: artifacts.generatedBy,  // Generator info
            convertedBy: artifacts.convertedBy,  // Converter info
            weightsManifest: [{  // Weights manifest
                paths: [weightFileName],  // Weight file path
                weights: artifacts.weightSpecs || []  // Weight specifications
            }]
        });

        // Upload a single model component to server
        const uploadComponent = async (type, fileName, fileDataB64, contentType) => {
            const response = await fetch('/api/upload-model-component', {  // Call upload API
                method: 'POST',  // POST method
                headers: { 'Content-Type': 'application/json' },  // JSON headers
                body: JSON.stringify({  // Request body
                    lang: currentLang,  // Language
                    type,  // Model type (static/dynamic)
                    fileName,  // File name
                    fileDataB64,  // Base64 data
                    contentType  // Content type
                })
            });

            const data = await response.json().catch(() => ({}));  // Parse response
            if (!response.ok) {  // Check if failed
                throw new Error(data.error || 'Failed to upload model component');  // Throw error
            }
        };

        // Static Model Backup
        // Uploads the static model (single pose signs) to cloud
        if (model.static && model.staticLabels) {  // If static model exists
            updateProcessingModal("Cloud Backup...", "Uploading Static Model components...");  // Update status
            
            // 1. Export Labels
            const labelsJson = JSON.stringify(model.staticLabels);  // Convert labels to JSON
            await uploadComponent('static', 'labels.json', btoa(labelsJson), 'application/json');  // Upload

            // 2. Export Model (JSON and Binary)
            await model.static.save(tf.io.withSaveHandler(async (artifacts) => {  // Save with custom handler
                // Upload model.json
                const modelJson = JSON.stringify(buildModelJson(artifacts, 'model.weights.bin'));  // Build JSON
                await uploadComponent('static', 'model.json', btoa(modelJson), 'application/json');  // Upload

                // Upload weights.bin
                const weightsBlob = new Blob([artifacts.weightData], {type: 'application/octet-stream'});  // Create blob
                const reader = new FileReader();  // Create reader
                const weightsB64 = await new Promise(resolve => {  // Convert to base64
                    reader.onloadend = () => resolve(reader.result.split(',')[1]);  // Extract base64
                    reader.readAsDataURL(weightsBlob);  // Read as data URL
                });
                await uploadComponent('static', 'model.weights.bin', weightsB64, 'application/octet-stream');  // Upload
                
                return {modelArtifactsInfo: {dateSaved: new Date(), modelTopologyType: 'JSON'}};  // Return metadata
            }));
        }

        // Dynamic Model Backup
        // Uploads the dynamic model (movement signs) to cloud
        if (model.dynamic && model.dynamicLabels) {  // If dynamic model exists
            updateProcessingModal("Cloud Backup...", "Uploading Dynamic Model components...");  // Update status
            
            // 1. Labels
            await uploadComponent('dynamic', 'labels.json', btoa(JSON.stringify(model.dynamicLabels)), 'application/json');  // Upload
            
            // 2. Hand Requirements
            const handReqs = model.dynamicHandRequirements || {};  // Get hand requirements
            await uploadComponent('dynamic', 'hand_reqs.json', btoa(JSON.stringify(handReqs)), 'application/json');  // Upload

            // 3. Model Files
            await model.dynamic.save(tf.io.withSaveHandler(async (artifacts) => {  // Save with custom handler
                const modelJson = JSON.stringify(buildModelJson(artifacts, 'model.weights.bin'));  // Build JSON
                await uploadComponent('dynamic', 'model.json', btoa(modelJson), 'application/json');  // Upload

                const weightsB64 = await new Promise(resolve => {  // Convert to base64
                    const reader = new FileReader();  // Create reader
                    reader.onloadend = () => resolve(reader.result.split(',')[1]);  // Extract base64
                    reader.readAsDataURL(new Blob([artifacts.weightData]));  // Read as data URL
                });
                await uploadComponent('dynamic', 'model.weights.bin', weightsB64, 'application/octet-stream');  // Upload
                return {modelArtifactsInfo: {dateSaved: new Date()}};  // Return metadata
            }));
        }
    }

    // Mobile Revert button
    // Reverts the last batch of recorded samples
    if (mobileRevertBtn) {  // If button exists
        mobileRevertBtn.addEventListener('click', () => {  // Add click handler
            revertLatestBatch();  // Revert last batch
        });
    }

    // Desktop Revert button
    // Reverts the last batch of recorded samples (desktop version)
    if (revertLatestBtn) {  // If button exists
        revertLatestBtn.addEventListener('click', () => {  // Add click handler
            revertLatestBatch();  // Revert last batch
        });
    }
}  // End of setupMobileSignSetup function

// ==================== RESET MOBILE SIGN SETUP ====================
// Resets the mobile sign setup state to idle
function resetMobileSignSetup(discard = false) {
    if (!mobileAddSignBtn) return;  // Exit if button doesn't exist
    
    // Clear input fields
    labelInput.value = '';  // Clear main label input
    modalLabelInput.value = '';  // Clear modal label input
    signCardInput.value = '';  // Clear sign card input
    
    // Reset state variables
    isInSetupMode = false;  // Reset setup mode
    pendingSignCard = null;  // Clear pending sign card
    lastRecordedBatchCount = 0;  // Reset batch count
    sessionHistory = [];  // Clear session history

    // Reset UI elements
    mobileAddSignBtn.style.width = '64px';  // Reset width
    mobileAddSignBtn.style.height = '64px';  // Reset height
    mobileAddSignBtn.style.padding = '0';  // Reset padding
    mobileAddSignBtn.title = 'Add New Sign';  // Reset tooltip
    mobileAddSignBtn.innerHTML = '<span class="material-icons" style="font-size: 38px;">add_circle</span>';  // Reset icon
    mobileAddSignBtn.dataset.setup = 'false';  // Reset setup flag
    mobileAddSignBtn.disabled = false;  // Enable button
    mobileClearSignBtn.style.display = 'none';  // Hide clear button
    setMobileBottomBarMode('idle');  // Set to idle mode
    setTrainSaveButtonBusy(false);  // Reset train button

    // Reset status displays
    updateMobileStatusTags();  // Update status tags
    updateMobileSessionActionState();  // Update action state

    if (discard) {  // If discarding data
        // Discard any untrained samples recorded during this setup session
        collectedData = collectedData.filter(d => d.isTrained !== false);  // Keep only trained
    }
    renderDataList();  // Update data list
    
    // Reset Modal internal state
    const firstStep = document.querySelector('.modal-step[data-step="1"]');  // Get first step
    if (firstStep) {  // If first step exists
        modalSteps.forEach(s => s.classList.remove('active'));  // Hide all steps
        firstStep.classList.add('active');  // Show first step
    }
    const modalStatus = document.getElementById('modalSignCardStatus');  // Get status element
    if (modalStatus) modalStatus.textContent = '';  // Clear status
    if (modalSignCardFileName) {  // If filename element exists
        modalSignCardFileName.textContent = '';  // Clear filename
        modalSignCardFileName.style.display = 'none';  // Hide filename
    }

    if (signCardFileName) {  // If main filename element exists
        signCardFileName.textContent = '';  // Clear filename
        signCardFileName.style.display = 'none';  // Hide filename
    }
}

// ==================== MOBILE STATUS UPDATE ====================
/**
 * Updates the small tags shown in the mobile bottom bar
 * Shows the current label and recording mode
 */
function updateMobileStatusTags() {
    if (mobileLabelDisplay) {  // If label display exists
        mobileLabelDisplay.textContent = labelInput.value || 'New Sign';  // Show label or default
    }
    if (mobileModeDisplay) {  // If mode display exists
        mobileModeDisplay.textContent = recordingMode === 'static' ? 'Static Mode' : 'Dynamic Mode';  // Show mode
    }
    updateMobileRevertState();  // Update revert button state
    updateMobileSessionActionState();  // Update action button state
}

// ==================== REVERT BATCH FUNCTIONS ====================
// Get the last batch that can be reverted
// Searches session history for the most recent revertable batch
function getLastRevertableBatch() {
    if (!Array.isArray(sessionHistory) || sessionHistory.length === 0) return null;  // Check if history exists

    for (let i = sessionHistory.length - 1; i >= 0; i -= 1) {  // Loop backwards through history
        const batch = sessionHistory[i];  // Get batch
        const normalizedLabel = normalizeLabel(batch?.label);  // Normalize label
        const count = Number(batch?.count || 0);  // Get count

        if (!normalizedLabel || count <= 0 || collectedData.length < count) {  // Validate batch
            continue;  // Skip invalid batches
        }

        const recentSamples = collectedData.slice(-count);  // Get recent samples
        const matchesBatch = recentSamples.length === count && recentSamples.every((sample) =>  // Check if matches
            normalizeLabel(sample.label) === normalizedLabel &&  // Label matches
            (sample.type || 'static') === (batch.type || 'static') &&  // Type matches
            sample.isTrained === false  // Not trained
        );

        if (matchesBatch) {  // If batch matches
            return { batch, index: i };  // Return batch and index
        }
    }

    return null;  // No matching batch found
}

// Revert the latest batch of recorded samples
// Removes the most recent batch from the collected data
function revertLatestBatch() {
    const revertTarget = getLastRevertableBatch();  // Get revert target

    if (revertTarget) {  // If target found
        // Normal path: session history has a matching batch
        const { batch, index } = revertTarget;  // Destructure target
        const count = Number(batch.count || 0);  // Get count
        const normalizedLabel = normalizeLabel(batch.label);  // Normalize label
        if (!count || !normalizedLabel) return false;  // Validate

        collectedData.splice(-count, count);  // Remove last count samples
        sessionHistory.splice(index, 1);  // Remove from history
        lastRecordedBatchCount = 0;  // Reset batch count
        persistCurrentTrainingDataLocally(currentLang);  // Save to localStorage

        const labelSummary = count === 1 ? '1 sample' : `${count} samples`;  // Format summary
        showToast(`Reverted ${labelSummary} from "${normalizedLabel}"`, 'undo');  // Show toast

        updateUIStats();  // Update UI statistics
        renderDataList();  // Update data list

        // Check if still in setup mode for this label
        if (mobileAddSignBtn && mobileAddSignBtn.dataset.setup === 'true' && normalizeLabel(labelInput.value) === normalizedLabel) {
            const remainingSamples = collectedData.filter((sample) =>  // Count remaining samples
                sample.isTrained === false && normalizeLabel(sample.label) === normalizedLabel  // Untrained matching label
            ).length;
            if (remainingSamples === 0) {
                mobileAddSignBtn.disabled = true;
            }
        }

        return true;  // Return success
    }

    // Fallback: session history is empty (e.g. after Save & Next Sign) but
    // untrained data still exists — revert the last MAX_STATIC_SAMPLES_PER_SESSION (100)
    // untrained samples for the most recently recorded label.
    const untrainedSamples = collectedData.filter(d => d.isTrained === false);  // Get untrained samples
    if (untrainedSamples.length === 0) return false;  // Exit if none

    const lastUntrainedLabel = normalizeLabel(untrainedSamples[untrainedSamples.length - 1].label);  // Get last label

    // Gather indices of all untrained samples for that label, then cap to the last 100
    const targetIndices = [];  // Initialize indices array
    collectedData.forEach((d, i) => {  // Loop through data
        if (normalizeLabel(d.label) === lastUntrainedLabel && d.isTrained === false) {  // If matches
            targetIndices.push(i);  // Add index
        }
    });
    const toRemove = new Set(targetIndices.slice(-MAX_STATIC_SAMPLES_PER_SESSION));  // Get last 100 indices
    const countToRemove = toRemove.size;  // Count to remove

    collectedData = collectedData.filter((_, i) => !toRemove.has(i));  // Remove samples
    lastRecordedBatchCount = 0;  // Reset batch count
    persistCurrentTrainingDataLocally(currentLang);  // Save to localStorage

    const labelSummary = countToRemove === 1 ? '1 sample' : `${countToRemove} samples`;  // Format summary
    showToast(`Reverted ${labelSummary} from "${lastUntrainedLabel}"`, 'undo');  // Show toast

    updateUIStats();  // Update statistics
    renderDataList();  // Update data list

    return true;  // Return success
}

// Update mobile revert button state
// Enables/disables the revert button based on whether there's data to revert
function updateMobileRevertState() {
    const hasRevertable = Boolean(getLastRevertableBatch()) || getUntrainedSampleCount() > 0;  // Check if revertable

    if (mobileRevertBtn) {  // If mobile button exists
        mobileRevertBtn.style.display = 'flex';  // Show button
        mobileRevertBtn.disabled = !hasRevertable;  // Enable/disable
        mobileRevertBtn.innerHTML = `<span class="material-icons" style="font-size: 14px;">undo</span>`;  // Set icon
    }

    if (revertLatestBtn) {  // If desktop button exists
        revertLatestBtn.disabled = !hasRevertable;  // Enable/disable
    }
}

// Update revert button state (wrapper)
// Wrapper function for consistency
function updateRevertButtonState() {
    updateMobileRevertState();  // Call mobile update
}

// Update mobile recording counter
// Updates the counter display showing current/total samples
function updateMobileRecordingCounter(current = 0, total = MAX_STATIC_SAMPLES_PER_SESSION, unit = '') {
    if (!mobileRecordingCounter) return;  // Exit if counter doesn't exist
    mobileRecordingCounter.textContent = unit  // Set text with optional unit
        ? `${current}/${total} ${unit}`  // With unit
        : `${current}/${total}`;  // Without unit
}

// Get current setup sample count
// Returns the number of samples for the current label and mode
function getCurrentSetupSampleCount() {
    const currentLabel = normalizeLabel(labelInput.value);  // Get current label
    if (!currentLabel) return 0;  // Return 0 if no label

    return collectedData.filter((sample) => {  // Filter samples
        if (normalizeLabel(sample.label) !== currentLabel) return false;  // Label must match
        return recordingMode === 'dynamic' ? isDynamicSample(sample) : isStaticSample(sample);  // Type must match
    }).length;  // Return count
}

// Get current label static sample count
// Returns the number of static samples for the current label
function getCurrentLabelStaticSampleCount() {
    const currentLabel = normalizeLabel(labelInput.value);  // Get current label
    if (!currentLabel) return 0;  // Return 0 if no label
    return collectedData.filter(sample => isStaticSample(sample) && normalizeLabel(sample.label) === currentLabel).length;  // Count static samples
}

// Get untrained local draft count
// Returns the number of untrained samples in localStorage
function getUntrainedLocalDraftCount(lang = currentLang) {
    const keys = STORAGE_KEYS[lang];  // Get storage keys
    if (!keys) return 0;  // Return 0 if no keys
    const rawData = localStorage.getItem(keys.data);  // Get raw data
    if (!rawData) return 0;  // Return 0 if no data

    try {
        const parsed = JSON.parse(rawData);  // Parse JSON
        if (!Array.isArray(parsed)) return 0;  // Return 0 if not array
        return parsed.filter(sample => sample && sample.isTrained === false).length;  // Count untrained
    } catch (err) {
        return 0;  // Return 0 on error
    }
}

// Check if train & save is enabled
// Returns true if there's untrained data to train
function isTrainSaveEnabled() {
    return getUntrainedSampleCount() > 0 || getUntrainedLocalDraftCount() > 0;  // Check for untrained data
}

// Set train & save button busy state
// Updates the button appearance and disabled state during training
function setTrainSaveButtonBusy(isBusy) {
    if (mobileTrainSaveBtn) {  // If mobile button exists
        mobileTrainSaveBtn.disabled = isBusy;  // Enable/disable
        mobileTrainSaveBtn.innerHTML = isBusy  // Update content
            ? '<span class="material-icons" style="font-size: 22px;">sync</span><span>Training...</span>'  // Busy state
            : '<span class="material-icons" style="font-size: 22px;">task_alt</span><span>Train &amp; Upload</span>';  // Normal state
    }

    if (sidebarTrainSaveBtn) {  // If sidebar button exists
        sidebarTrainSaveBtn.disabled = isBusy;  // Enable/disable
        sidebarTrainSaveBtn.innerHTML = isBusy  // Update content
            ? '<span class="material-icons" style="font-size: 22px;">sync</span><span>Training...</span>'  // Busy state
            : '<span class="material-icons" style="font-size: 22px;">task_alt</span><span>Train &amp; Save</span>';  // Normal state
    }
}

// ==================== SIDEBAR & MOBILE UI STATE ====================

// Update sidebar train & save button state
// Enables/disables the sidebar train button based on data availability
function updateSidebarTrainSaveState() {
    if (!sidebarTrainSaveBtn) return;  // Exit if button doesn't exist
    sidebarTrainSaveBtn.disabled = !isTrainSaveEnabled();  // Enable/disable
}

// Update mobile train & save button visibility
// Shows/hides the mobile train button based on setup mode and data
function updateMobileTrainSaveVisibility() {
    if (!mobileTrainSaveBtn) return;  // Exit if button doesn't exist

    const shouldShow = isInSetupMode && getCurrentSetupSampleCount() > 0;  // Check if should show

    mobileTrainSaveBtn.style.display = shouldShow ? 'inline-flex' : 'none';  // Show/hide

    if (shouldShow) {  // If showing
        setTrainSaveButtonBusy(false);  // Ensure not busy
    }
}

// Update mobile session action state
// Shows/hides the save & next button based on setup mode
function updateMobileSessionActionState() {
    if (!mobileSaveNextBtn) return;  // Exit if button doesn't exist

    const shouldShow = isInSetupMode;  // Check if in setup mode
    const sampleCount = getCurrentSetupSampleCount();  // Get sample count

    mobileSaveNextBtn.style.display = shouldShow ? 'inline-flex' : 'none';  // Show/hide
    mobileSaveNextBtn.disabled = !shouldShow || sampleCount === 0;  // Enable/disable
}

// ==================== SAVE TRAINED MODELS TO LOCAL STORAGE ====================
// Save trained models to localStorage for offline use
// Saves both static and dynamic models with their labels
async function saveTrainedModelsToLocalStorage() {
    const keys = STORAGE_KEYS[currentLang];  // Get storage keys
    let savedAnyModel = false;  // Track if any model was saved

    try {
        if (model?.static && model.staticLabels) {  // If static model exists
            await model.static.save(`localstorage://${keys.model}-static`);  // Save static model
            try {
                localStorage.setItem(`${keys.labels}-static`, JSON.stringify(model.staticLabels));  // Save static labels
                savedAnyModel = true;  // Mark as saved
            } catch (e) {
                if (e.name === 'QuotaExceededError') {  // Check if storage full
                    console.error('LocalStorage quota exceeded for static model labels');  // Log error
                    throw new Error('Storage full. Cannot save static model labels.');  // Throw error
                }
                throw e;  // Re-throw other errors
            }
        }

        if (model?.dynamic && model.dynamicLabels) {  // If dynamic model exists
            await model.dynamic.save(`localstorage://${keys.model}-dynamic`);  // Save dynamic model
            try {
                localStorage.setItem(`${keys.labels}-dynamic`, JSON.stringify(model.dynamicLabels));  // Save dynamic labels
                localStorage.setItem(`${keys.labels}-dynamic-hand-req`, JSON.stringify(model.dynamicHandRequirements || {}));  // Save hand requirements
                savedAnyModel = true;  // Mark as saved
            } catch (e) {
                if (e.name === 'QuotaExceededError') {  // Check if storage full
                    console.error('LocalStorage quota exceeded for dynamic model labels');  // Log error
                    throw new Error('Storage full. Cannot save dynamic model labels.');  // Throw error
                }
                throw e;  // Re-throw other errors
            }
        }
    } catch (e) {
        console.error('Failed to save models to localStorage:', e);  // Log error
        throw e;  // Re-throw error
    }

    return savedAnyModel;  // Return if any model was saved
}

// ==================== MOBILE BOTTOM BAR MODE ====================
// Set the mobile bottom bar mode (idle or recording)
// Shows/hides different UI elements based on the mode
function setMobileBottomBarMode(mode) {
    const isRecordingMode = mode === 'recording';  // Check if recording mode

    if (mobileAddButtonWrap) {  // If add button wrapper exists
        mobileAddButtonWrap.style.display = isRecordingMode ? 'none' : 'inline-flex';  // Hide/show
    }

    if (mobileRecordingActions) {  // If recording actions container exists
        mobileRecordingActions.style.display = isRecordingMode ? 'flex' : 'none';  // Show/hide
    }

    if (captureBtn) {  // If capture button exists
        captureBtn.style.display = isRecordingMode ? 'flex' : 'none';  // Show/hide
    }

    // Update counter based on mode
    if (recordingMode === 'dynamic') {  // If dynamic mode
        updateMobileRecordingCounter(0, MAX_DYNAMIC_FRAMES, 'frames');  // Update with frame count
    } else {  // Static mode
        updateMobileRecordingCounter(0, MAX_STATIC_SAMPLES_PER_SESSION);  // Update with sample count
    }

    updateMobileTrainSaveVisibility();  // Update train button visibility
    updateMobileSessionActionState();  // Update action button state
}

// ==================== UPLOAD MODEL TO CLOUD ====================
// Upload a trained model to cloud storage
// Uploads model topology, weights, labels, and hand requirements
async function uploadModelToCloud(type, modelInstance, labels, handReqs = null) {
    // 1. Save model to get artifacts
    const saveResults = await modelInstance.save(tf.io.withSaveHandler(async (artifacts) => {  // Save with handler
        return artifacts;  // Return artifacts
    }));

    // 2. Upload Model Topology (JSON)
    const modelJson = {  // Build model JSON
        modelTopology: saveResults.modelTopology,  // Model architecture
        weightsManifest: [{  // Weights manifest
            paths: ['./weights.bin'],  // Weights file path
            weights: saveResults.weightSpecs  // Weight specifications
        }]
    };
    
    await uploadComponent(type, 'model.json', btoa(JSON.stringify(modelJson)), 'application/json');  // Upload

    // 3. Upload Weights (Binary)
    const weightsB64 = arrayBufferToBase64(saveResults.weightData);  // Convert to base64
    await uploadComponent(type, 'weights.bin', weightsB64, 'application/octet-stream');  // Upload

    // 4. Upload Labels
    await uploadComponent(type, 'labels.json', btoa(JSON.stringify(labels)), 'application/json');  // Upload

    // 5. Upload Hand Requirements if dynamic
    if (handReqs) {  // If hand requirements provided
        await uploadComponent(type, 'hand_reqs.json', btoa(JSON.stringify(handReqs)), 'application/json');  // Upload
    }
}

// Upload a single model component to server
// Helper function to upload model files to the server
async function uploadComponent(type, fileName, b64Data, contentType) {
    const response = await fetch('/api/upload-model-component', {  // Call upload API
        method: 'POST',  // POST method
        headers: { 'Content-Type': 'application/json' },  // JSON headers
        body: JSON.stringify({  // Request body
            lang: currentLang,  // Language
            type,  // Model type
            fileName,  // File name
            fileDataB64: b64Data,  // Base64 data
            contentType  // Content type
        })
    });

    const data = await response.json().catch(() => ({}));  // Parse response
    if (!response.ok) {  // Check if failed
        throw new Error(data.error || 'Failed to upload model component');  // Throw error
    }
}

// Convert ArrayBuffer to base64 string
// Helper function to convert binary data to base64 for upload
function arrayBufferToBase64(buffer) {
    let binary = '';  // Initialize binary string
    const bytes = new Uint8Array(buffer);  // Get bytes
    const len = bytes.byteLength;  // Get length
    for (let i = 0; i < len; i++) {  // Loop through bytes
        binary += String.fromCharCode(bytes[i]);  // Convert to character
    }
    return btoa(binary);  // Return base64
}

// ==================== CHECK FOR SAVED MODELS ====================
// Check if models are already saved in localStorage
// Updates UI to show if models are available for use
async function checkForSavedModels() {
    const staticLabels = localStorage.getItem(`${STORAGE_KEYS[currentLang].labels}-static`);  // Get static labels
    const dynamicLabels = localStorage.getItem(`${STORAGE_KEYS[currentLang].labels}-dynamic`);  // Get dynamic labels

    if (staticLabels || dynamicLabels) {  // If any models saved
        let modelInfo = "Saved models found: ";  // Initialize info string
        if (staticLabels) modelInfo += "Static ✋ ";  // Add static info
        if (dynamicLabels) modelInfo += "Dynamic 🔄";  // Add dynamic info
        statusMsg.innerText = `✅ ${modelInfo}. You can use these in Live Translation!`;  // Show status
        if (saveBtn) saveBtn.disabled = true;  // Disable save button

    }
}

// ==================== MODE TOGGLE SETUP ====================
// Setup event listeners for mode toggle buttons
function setupModeToggle() {
    startRecordBtn.addEventListener('click', startDynamicRecording);  // Start recording
    stopRecordBtn.addEventListener('click', stopDynamicRecording);  // Stop recording
}

// Switch between static and dynamic recording modes
// Updates the recording mode and stops any active dynamic recording
function switchMode(mode) {
    if (mode !== 'dynamic' && isDynamicRecording) {  // If switching away from dynamic
        stopDynamicRecording();  // Stop dynamic recording
    }

    recordingMode = mode;  // Set new mode
    // Update button states
    staticModeBtn.classList.toggle('active', mode === 'static');  // Toggle static button
    dynamicModeBtn.classList.toggle('active', mode === 'dynamic');  // Toggle dynamic button

    // Update UI visibility based on mode
    if (mode === 'static') {  // If static mode
        captureBtn.style.display = isInSetupMode ? 'flex' : 'none';  // Show/hide capture button
        captureHint.style.display = 'block';  // Show capture hint
        dynamicControls.style.display = 'none';  // Hide dynamic controls
        modeDescription.textContent = 'Static: Single pose signs (A, B, Hello, etc.)';  // Update description
        if (isInSetupMode) {  // If in setup mode
            updateMobileRecordingCounter(0, MAX_STATIC_SAMPLES_PER_SESSION);  // Update counter
        }
    } else {  // Dynamic mode
        captureBtn.style.display = 'none';  // Hide capture button
        captureHint.style.display = 'none';  // Hide capture hint
        dynamicControls.style.display = 'block';  // Show dynamic controls
        modeDescription.textContent = 'Dynamic: Movement signs (Thank You, Please, Sorry, etc.)';  // Update description
        if (isInSetupMode) {  // If in setup mode
            updateMobileRecordingCounter(0, MAX_DYNAMIC_FRAMES, 'frames');  // Update counter
        }
    }

    updateMobileStatusTags();  // Update mobile status tags
}

// Update mobile tags when label changes
// Event listener for label input changes
labelInput.addEventListener('input', updateMobileStatusTags);  // Add input listener

// ==================== DYNAMIC RECORDING ====================
// Start dynamic recording for movement-based signs
// Begins capturing frames for dynamic sign recording
function startDynamicRecording() {
    if (isDynamicRecording) return;  // Exit if already recording

    const label = normalizeLabel(labelInput.value);  // Get and normalize label
    if (!label) {  // Validate label
        showCustomAlert("Please enter the details of the sign!");  // Alert user
        labelInput.focus();  // Focus on input
        return;  // Exit
    }
    labelInput.value = label;  // Set normalized label

    // Initialize recording state
    isDynamicRecording = true;  // Set recording flag
    dynamicFrameBuffer = [];  // Clear frame buffer
    lastFrameCaptureTime = 0;  // Reset capture time
    dynamicRecordingMaxHands = 1;  // Set max hands to track

    // Update UI for recording state
    startRecordBtn.style.display = 'none';  // Hide start button
    stopRecordBtn.style.display = 'inline-flex';  // Show stop button
    frameCounter.style.display = 'block';  // Show frame counter
    recordingProgress.style.display = 'block';  // Show progress bar
    recIndicator.style.display = 'flex';  // Show recording indicator
    captureBtn.classList.add('active');  // Activate capture button
    frameCount.textContent = '0';  // Reset frame count
    progressBar.style.width = '0%';  // Reset progress bar
    updateMobileRecordingCounter(0, MAX_DYNAMIC_FRAMES, 'frames');  // Update counter

    statusMsg.textContent = 'Recording dynamic sign...';  // Update status
}

// Stop dynamic recording
// Ends the recording and saves the captured frames
function stopDynamicRecording() {
    if (!isDynamicRecording && dynamicFrameBuffer.length === 0) return;  // Exit if not recording

    isDynamicRecording = false;  // Stop recording

    // Save the recorded sequence if long enough
    if (dynamicFrameBuffer.length >= 10) {  // Check minimum frames
        const label = normalizeLabel(labelInput.value);  // Get label
        saveDynamicSign(label, dynamicFrameBuffer);  // Save dynamic sign
        statusMsg.textContent = `Saved dynamic sign "${label}" with ${dynamicFrameBuffer.length} frames`;  // Update status
    } else {  // Too short
        statusMsg.textContent = 'Recording too short! Need at least 10 frames.';  // Update status
    }

    // Reset UI to idle state
    startRecordBtn.style.display = 'inline-flex';  // Show start button
    stopRecordBtn.style.display = 'none';  // Hide stop button
    frameCounter.style.display = 'none';  // Hide frame counter
    recordingProgress.style.display = 'none';  // Hide progress bar
    recIndicator.style.display = 'none';  // Hide recording indicator
    captureBtn.classList.remove('active');  // Deactivate capture button
    dynamicFrameBuffer = [];  // Clear frame buffer
    updateMobileRecordingCounter(0, MAX_DYNAMIC_FRAMES, 'frames');  // Update counter
}

// ==================== LANGUAGE SELECTION ====================
// Handle language selection change
// Loads data and models for the selected language
langSelect.addEventListener('change', async (e) => {  // Add change listener
    currentLang = e.target.value;  // Set new language
    model = null;  // Reset model context
    collectedData = [];  // Clear current view
    if (saveBtn) saveBtn.disabled = false;  // Enable save button
    statusMsg.innerText = `Switched to ${currentLang}`;  // Update status
    await loadDataFromServer();  // Load data from server
    checkForSavedModels();  // Check if models exist for this language
    renderDataList();  // Update data list
});

// ==================== MEDIAPIPE HANDS SETUP ====================
// Initialize MediaPipe Hands for hand landmark detection
const hands = new Hands({  // Create Hands instance
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`  // CDN path
});
hands.setOptions({  // Set MediaPipe options
    maxNumHands: 2,  // Track up to 2 hands
    modelComplexity: 1,  // Medium complexity
    minDetectionConfidence: 0.5,  // Minimum detection confidence
    minTrackingConfidence: 0.5  // Minimum tracking confidence
});
hands.onResults(onResults);  // Set results handler

// ==================== CAMERA SETUP ====================
// Initialize camera for video input
const camera = new Camera(videoElement, {  // Create Camera instance
    onFrame: async () => {  // Frame handler
        await hands.send({ image: videoElement });  // Send frame to MediaPipe
    },
    width: 1280,  // Camera width
    height: 720  // Camera height
});

// Start the camera
async function startCamera() {
    await camera.start();  // Start camera stream
}

// ==================== LANDMARK PROCESSING ====================
// Preprocess hand landmarks for model input
// Normalizes landmarks to be translation and scale invariant
function preprocessLandmarks(landmarks) {
    const wrist = landmarks[0];  // Get wrist landmark (reference point)
    let shifted = landmarks.map(p => ({ x: p.x - wrist.x, y: p.y - wrist.y, z: p.z - wrist.z }));  // Translate to wrist
    const indexMCP = shifted[5];  // Get index finger MCP (reference for scale)
    const distance = Math.sqrt(Math.pow(indexMCP.x, 2) + Math.pow(indexMCP.y, 2) + Math.pow(indexMCP.z, 2)) || 1e-6;  // Calculate distance
    return shifted.flatMap(p => [p.x / distance, p.y / distance, p.z / distance]);  // Normalize and flatten
}

// ==================== MEDIAPIPE RESULTS HANDLER ====================
// Handle MediaPipe hand detection results
// Processes detected hands and updates canvas
function onResults(results) {
    // Resize canvas to match video dimensions
    if (canvasElement.width !== videoElement.videoWidth || canvasElement.height !== videoElement.videoHeight) {  // Check size
        canvasElement.width = videoElement.videoWidth;  // Set width
        canvasElement.height = videoElement.videoHeight;  // Set height
    }

    canvasCtx.save();  // Save canvas context
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);  // Clear canvas

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {  // If hands detected
        const detectedHands = Math.min(2, results.multiHandLandmarks.length);  // Limit to 2 hands

        // Resume static recording if hands reappear
        if (isCollecting && recordingMode === 'static' && isStaticPausedNoHands) {  // If paused
            isStaticPausedNoHands = false;  // Resume
            statusMsg.textContent = `Recording resumed: ${staticSessionSampleCount}/${MAX_STATIC_SAMPLES_PER_SESSION} samples`;  // Update status
        }

        // Draw hand landmarks and connections on canvas
        for (const landmarks of results.multiHandLandmarks) {  // Loop through hands
            drawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS, { color: '#00FF00', lineWidth: 5 });  // Draw connections
            drawLandmarks(canvasCtx, landmarks, { color: '#FF0000', lineWidth: 2 });  // Draw landmarks
        }

        // Static mode recording: only use primary hand (first detected hand)
        if (isCollecting && recordingMode === 'static') {  // If static mode and collecting
            const label = normalizeLabel(labelInput.value);  // Get label
            if (label && results.multiHandLandmarks.length > 0) {  // If valid
                labelInput.value = label;  // Set normalized label
                const primaryLandmarks = results.multiHandLandmarks[0];  // Get primary hand
                const flatLandmarks = preprocessLandmarks(primaryLandmarks);  // Preprocess
                const shouldContinue = captureStaticSample(label, flatLandmarks);  // Capture sample
                if (!shouldContinue) return;  // Stop if max reached
            }
        }

        // Dynamic mode recording: capture one frame per interval from primary hand,
        // while remembering whether this sample used one hand or two hands.
        if (isDynamicRecording && recordingMode === 'dynamic') {  // If dynamic recording
            dynamicRecordingMaxHands = Math.max(dynamicRecordingMaxHands, detectedHands);  // Track max hands

            const now = Date.now();  // Get current time
            const frameInterval = 1000 / TARGET_FPS;  // Calculate interval
            if (now - lastFrameCaptureTime >= frameInterval) {  // If interval passed
                const primaryLandmarks = results.multiHandLandmarks[0];  // Get primary hand
                const flatLandmarks = preprocessLandmarks(primaryLandmarks);  // Preprocess
                dynamicFrameBuffer.push(flatLandmarks);  // Add to buffer
                lastFrameCaptureTime = now;  // Update capture time

                frameCount.textContent = dynamicFrameBuffer.length;  // Update frame count
                const progress = (dynamicFrameBuffer.length / MAX_DYNAMIC_FRAMES) * 100;  // Calculate progress
                progressBar.style.width = `${Math.min(progress, 100)}%`;  // Update progress bar
                updateMobileRecordingCounter(dynamicFrameBuffer.length, MAX_DYNAMIC_FRAMES, 'frames');  // Update counter

                if (dynamicFrameBuffer.length >= MAX_DYNAMIC_FRAMES) {  // If max frames reached
                    stopDynamicRecording();  // Stop recording
                }
            }
        }

    } else if (isCollecting && recordingMode === 'static') {  // No hands detected
        if (!isStaticPausedNoHands) {  // If not paused
            isStaticPausedNoHands = true;  // Pause
            statusMsg.textContent = `Paused: no hands detected (${staticSessionSampleCount}/${MAX_STATIC_SAMPLES_PER_SESSION})`;  // Update status
        }
        // No hands detected
    }

    canvasCtx.restore();  // Restore canvas context
}

// ==================== DATA COLLECTION ====================
// Save a data point (sample) to the collected data array
// Stores the label, landmarks, type, and timestamp
function saveDataPoint(label, landmarks, type = 'static') {
    const normalizedLabel = normalizeLabel(label);  // Normalize label
    if (!normalizedLabel) return;  // Exit if no label
    collectedData.push({ label: normalizedLabel, landmarks, type, isTrained: false, recordedAt: Date.now() });  // Add to data
    updateUIStats();  // Update UI statistics
}

// Capture a static sample
// Captures a single frame for static sign recording
function captureStaticSample(label, flatLandmarks) {
    if (!isCollecting) return false;  // Exit if not collecting
    if (staticSessionSampleCount >= MAX_STATIC_SAMPLES_PER_SESSION) {  // Check max samples
        stopStaticCollection('Auto-stopped at 100 samples.');  // Stop collection
        return false;  // Return false
    }

    saveDataPoint(label, flatLandmarks, 'static');  // Save data point
    staticSessionSampleCount += 1;  // Increment session count
    lastRecordedBatchCount += 1;  // Increment batch count
    statusMsg.textContent = `Recording static sign: ${staticSessionSampleCount}/${MAX_STATIC_SAMPLES_PER_SESSION}`;  // Update status
    updateMobileRecordingCounter(staticSessionSampleCount);  // Update counter
    updateMobileTrainSaveVisibility();  // Update train button

    if (staticSessionSampleCount >= MAX_STATIC_SAMPLES_PER_SESSION) {  // Check max again
        stopStaticCollection('Auto-stopped at 100 samples.');  // Stop collection
        return false;  // Return false
    }

    return true;  // Return true (continue)
}

// Start static collection
// Begins collecting static sign samples
function startStaticCollection() {
    const label = normalizeLabel(labelInput.value);  // Get label
    if (!label) {  // Validate label
        showCustomAlert("Please enter the details of the sign!");  // Alert user
        labelInput.focus();  // Focus on input
        return;  // Exit
    }
    labelInput.value = label;  // Set normalized label

    // Initialize collection state
    isCollecting = true;  // Set collecting flag
    staticSessionSampleCount = 0;  // Reset session count
    lastRecordedBatchCount = 0;  // Start new batch tracking
    isStaticPausedNoHands = false;  // Reset pause flag

    // Update UI for collecting state
    recIndicator.style.display = 'flex';  // Show recording indicator
    captureBtn.classList.add('active');  // Activate capture button
    statusMsg.textContent = `Recording static sign: 0/${MAX_STATIC_SAMPLES_PER_SESSION}`;  // Update status
    updateMobileRecordingCounter(0);  // Reset counter
    updateMobileTrainSaveVisibility();  // Update train button
}

// Stop static collection
// Ends the static sign recording session
function stopStaticCollection(reason = 'Recording stopped.') {
    if (!isCollecting) return;  // Exit if not collecting

    // Reset collection state
    isCollecting = false;  // Clear collecting flag
    isStaticPausedNoHands = false;  // Clear pause flag

    const recordedCount = staticSessionSampleCount;  // Save count
    staticSessionSampleCount = 0;  // Reset session count

    // Reset UI
    recIndicator.style.display = 'none';  // Hide recording indicator
    captureBtn.classList.remove('active');  // Deactivate capture button
    updateMobileRecordingCounter(0);  // Reset counter

    const suffix = recordedCount > 0 ? ` Saved ${recordedCount} samples.` : ' No new samples captured.';  // Format suffix
    statusMsg.textContent = `${reason}${suffix}`;  // Update status

    // Auto-save ONLY if not in a mobile setup session
    if (!isInSetupMode) {  // If not in setup mode
        saveToServer().then(() => {  // Save to server
            renderDataList();  // Update list
        }).catch((err) => {
            console.error('Failed to auto-save static session:', err);  // Log error
        });
    } else {  // In setup mode
        // Just refresh the list and enable Finish button if we have ANY data now
        renderDataList();  // Update list
        if (recordedCount > 0) {  // If samples recorded
            hasRecordedSignInSession = true;  // Mark as recorded
            sessionHistory.push({  // Add to history
                label: labelInput.value,  // Label
                count: recordedCount,  // Count
                type: 'static'  // Type
            });
            lastRecordedBatchCount = 0;  // Reset batch count
        }
        if (recordedCount > 0 && mobileAddSignBtn && mobileAddSignBtn.dataset.setup === 'true') {  // If samples and in setup
            mobileAddSignBtn.disabled = false;  // Enable finish button
        }
        updateMobileRevertState();  // Update revert state
        updateMobileTrainSaveVisibility();  // Update train button
    }
}

// Save dynamic sign data
// Saves a dynamic sign (movement-based) with its frame sequence
async function saveDynamicSign(label, frames) {
    const normalizedLabel = normalizeLabel(label);  // Normalize label
    if (!normalizedLabel) return;  // Exit if no label

    collectedData.push({  // Add to collected data
        label: normalizedLabel,  // Label
        type: 'dynamic',  // Type
        frames: frames,  // Frame sequence
        handCount: dynamicRecordingMaxHands,  // Number of hands
        frameCount: frames.length,  // Frame count
        recordedAt: Date.now(),  // Timestamp
        isTrained: false  // Not trained yet
    });
    sessionHistory.push({  // Add to session history
        label: normalizedLabel,  // Label
        count: 1,  // Count (1 for dynamic)
        type: 'dynamic'  // Type
    });
    updateUIStats();  // Update statistics
    
    // Auto-save ONLY if not in a mobile setup session
    if (!isInSetupMode) {  // If not in setup mode
        await saveToServer();  // Save to server
        renderDataList();  // Update list
        // Reset mobile setup button after recording
        if (window.innerWidth <= 980) {  // If mobile width
            resetMobileSignSetup();  // Reset setup
        }
    } else {  // In setup mode
        hasRecordedSignInSession = true;  // Mark as recorded
        renderDataList();  // Update list
        if (mobileAddSignBtn && mobileAddSignBtn.dataset.setup === 'true') {  // If in setup
            mobileAddSignBtn.disabled = false;  // Enable finish button
        }
        updateMobileRevertState();  // Update revert state
    }
}

// ==================== DATA MANAGEMENT ====================
// Load training data from Supabase server
// Fetches all training data and merges with local drafts
async function loadDataFromServer() {
    try {
        const { data, error } = await window.supabaseClient  // Query Supabase
            .from('training_data')
            .select('*')
            .order('id', { ascending: true });  // Order by ID

        if (error) throw error;  // Throw on error

        // Group data by language
        const allData = { ISL: [], ASL: [] };  // Initialize data object
        for (const row of data) {  // Loop through rows
            const sample = {  // Create sample object
                label: row.label,  // Label
                type: row.type,  // Type
                isTrained: row.is_trained,  // Trained flag
                recordedAt: row.recorded_at,  // Recorded timestamp
                trainedAt: row.trained_at,  // Trained timestamp
            };
            if (row.type === 'dynamic') {  // If dynamic
                sample.frames = row.frames;  // Add frames
                sample.handCount = row.hand_count;  // Add hand count
                sample.frameCount = row.frames ? row.frames.length : 0;  // Add frame count
            } else {  // Static
                sample.landmarks = row.landmarks;  // Add landmarks
            }
            if (!allData[row.lang]) allData[row.lang] = [];  // Initialize language array
            allData[row.lang].push(sample);  // Add sample
        }

        const loadedData = allData[currentLang] || [];  // Get current language data
        // Filter out samples with incorrect landmark length (should be 63 for single hand)
        const validLoadedData = loadedData.filter(d => {  // Filter invalid data
            if (d.type === 'dynamic') return true;  // Dynamic data has different structure
            return d.landmarks && d.landmarks.length === 63;  // Check landmark length
        });
        if (validLoadedData.length !== loadedData.length) {  // If filtered
            console.warn(`Filtered out ${loadedData.length - validLoadedData.length} samples with incorrect landmark length from Supabase`);  // Log warning
        }

        const normalizedData = normalizeDatasetLabels(validLoadedData);  // Normalize labels
        collectedData = normalizedData.normalized;  // Set collected data
        sessionHistory = [];  // Clear history

        const localDraft = normalizeDatasetLabels(loadLocalDraftData(currentLang)).normalized;  // Get local draft
        // Also filter local draft data
        const validLocalDraft = localDraft.filter(d => {  // Filter local draft
            if (d.type === 'dynamic') return true;  // Dynamic data
            return d.landmarks && d.landmarks.length === 63;  // Check landmark length
        });
        if (validLocalDraft.length !== localDraft.length) {  // If filtered
            console.warn(`Filtered out ${localDraft.length - validLocalDraft.length} samples with incorrect landmark length from localStorage`);  // Log warning
        }

        // Merge local draft with server data (avoid duplicates)
        const existingKeys = new Set(collectedData.map((sample) => `${sample.label}|${sample.type}|${sample.recordedAt}`));  // Get existing keys
        validLocalDraft.forEach((sample) => {  // Loop through local draft
            const key = `${sample.label}|${sample.type}|${sample.recordedAt}`;  // Create key
            if (!existingKeys.has(key)) {  // If not duplicate
                collectedData.push(sample);  // Add to collected data
            }
        });

        if (normalizedData.changed) {  // If labels were normalized
            await saveToServer();  // Save to server
        }
    } catch (err) {
        console.error('Failed to load training data from Supabase:', err);  // Log error
        const localDraft = normalizeDatasetLabels(loadLocalDraftData(currentLang)).normalized;  // Get local draft
        const validLocalDraft = localDraft.filter(d => {  // Filter local draft
            if (d.type === 'dynamic') return true;  // Dynamic data
            return d.landmarks && d.landmarks.length === 63;  // Check landmark length
        });
        collectedData = validLocalDraft;  // Use local data only
    } finally {
        renderDataList();  // Update list
    }
}

// Save training data to server
// Uploads collected training data to Supabase
async function saveToServer() {
    try {
        const groupedData = { [currentLang]: collectedData || [] };  // Group by language
        const response = await fetch('/api/training-data', {  // Call save API
            method: 'POST',  // POST method
            headers: { 'Content-Type': 'application/json' },  // JSON headers
            body: JSON.stringify(groupedData)  // Request body
        });

        const data = await response.json().catch(() => ({}));  // Parse response
        if (!response.ok) {  // Check if failed
            throw new Error(data.error || 'Failed to save training data');  // Throw error
        }

        sessionHistory = [];  // Clear history
        updateMobileRevertState();  // Update revert state
    } catch (err) {
        console.error('Failed to save training data to Supabase:', err);  // Log error
        throw err;  // Re-throw error
    }
}

// Update UI statistics
// Updates the total samples badge and other UI elements
function updateUIStats() {
    totalSamplesBadge.innerText = collectedData.length;  // Update total count
    updateMobileRevertState();  // Update revert state
    updateMobileTrainSaveVisibility();  // Update train button
    updateSidebarTrainSaveState();  // Update sidebar state
    updateMobileSessionActionState();  // Update action state
    // Throttle rendering the list if data is huge
    if (Math.random() > 0.9) renderDataList();  // Randomly render (10% chance)
}

// Render the data list in the sidebar
// Displays all collected signs with their sample counts and types
function renderDataList() {
    const counts = {};  // Initialize counts object
    const types = {};  // Initialize types object
    collectedData.forEach(d => {  // Loop through data
        counts[d.label] = (counts[d.label] || 0) + 1;  // Count samples per label
        types[d.label] = d.type || 'static';  // Store type per label
    });

    // Always update total counts even if list is empty
    totalSamplesBadge.innerText = collectedData.length;  // Update total count
    
    updateMobileRevertState();  // Update revert state
    updateSidebarTrainSaveState();  // Update sidebar state
    updateMobileSessionActionState();  // Update action state

    if (Object.keys(counts).length === 0) {  // If no data
        dataList.innerHTML = `<div style="text-align: center; color: #484f58; margin-top: 50px;">No data collected.</div>`;  // Show empty message
        return;  // Exit
    }

    // Render data list items
    dataList.innerHTML = Object.entries(counts).map(([label, count]) => {  // Map to HTML
        const type = types[label];  // Get type
        const typeIcon = type === 'dynamic' ? '🔄' : '✋';  // Get icon
        const typeLabel = type === 'dynamic' ? 'Dynamic' : 'Static';  // Get label
        return `  // Return HTML
        <div class="data-item">
            <div class="data-item-info">
                <span class="data-label">${typeIcon} ${label}</span>
                <span class="data-count">${count} samples • ${typeLabel}</span>
            </div>
            <button class="delete-btn" onclick="deleteLabel('${label}')">
                <span class="material-icons" style="font-size:18px;">delete</span>
            </button>
        </div>
    `}).join('');  // Join HTML
}

// Delete a label and all its samples
// Removes all samples for a given label from local and cloud storage
window.deleteLabel = async (label) => {
    const confirmed = await showCustomConfirm(`Delete all samples for "${label}"?`);  // Confirm deletion
    if (confirmed) {  // If confirmed
        const normalizedLabel = normalizeLabel(label);  // Normalize label

        // 1. Delete sign card from local storage
        localStorage.removeItem(getSignCardStorageKey(currentLang, normalizedLabel));  // Remove sign card

        // 2. Filter data and update local training set
        collectedData = collectedData.filter(d => normalizeLabel(d.label) !== normalizedLabel);  // Remove samples
        sessionHistory = sessionHistory.filter(batch => normalizeLabel(batch?.label) !== normalizedLabel);  // Remove from history
        persistCurrentTrainingDataLocally(currentLang);  // Save to localStorage

        try {
            await saveToServer();  // Save to server
            await deleteSignCardsFromCloud([normalizedLabel], currentLang);  // Delete from cloud
            renderDataList();  // Update list
            showToast(`Deleted "${normalizedLabel}" from local and cloud storage`, 'delete');  // Show toast
        } catch (err) {
            renderDataList();  // Update list
            showToast(`Deleted "${normalizedLabel}" locally, but cloud sync failed`, 'warning');  // Show warning
        }
    }
};

// Clear all button handler
// Deletes all collected data for the current language
clearAllBtn.addEventListener('click', async () => {
    const confirmed = await showCustomConfirm("Delete ALL collected data locally? This cannot be undone.");  // Confirm
    if (confirmed) {  // If confirmed
        const currentLabels = [...new Set(collectedData.map(d => d.label))];  // Get all labels

        // 1. Clear training data from localStorage
        clearLocalDraftDataForLanguage(currentLang);  // Clear local data
        
        collectedData = [];  // Clear collected data
        sessionHistory = [];  // Clear history

        try {
            await saveToServer();  // Save to server
            await deleteSignCardsFromCloud(currentLabels, currentLang);  // Delete from cloud
            renderDataList();  // Update list
            showToast(`All ${currentLang} data cleared locally and in Supabase`, 'delete_forever');  // Show toast
        } catch (err) {
            renderDataList();  // Update list
            showToast(`Cleared local ${currentLang} data, but cloud sync failed`, 'warning');  // Show warning
        }
    }
});

// ==================== CAPTURE CONTROLS ====================
// Capture button click handler
// Toggles between starting and stopping recording based on mode
captureBtn.addEventListener('click', () => {
    if (recordingMode === 'static') {  // If static mode
        if (isCollecting) {  // If collecting
            stopStaticCollection('Recording stopped.');  // Stop collection
        } else {  // Not collecting
            startStaticCollection();  // Start collection
        }
        return;  // Exit
    }

    if (recordingMode === 'dynamic') {  // If dynamic mode
        if (isDynamicRecording) {  // If recording
            stopDynamicRecording();  // Stop recording
        } else {  // Not recording
            startDynamicRecording();  // Start recording
        }
    }
});

// ==================== TRAINING LOGIC ====================
// Constants for training
const DUMMY_LABEL_PREFIX = '__internal_dummy__';  // Prefix for dummy labels
const STATIC_REHEARSAL_PER_LABEL = 20;  // Rehearsal samples per static label
const DYNAMIC_REHEARSAL_PER_LABEL = 8;  // Rehearsal samples per dynamic label

// Check if sample is static
// Returns true if the sample is a static sign
function isStaticSample(sample) {
    return sample.type === 'static' || !sample.type;  // Check type
}

// Check if sample is dynamic
// Returns true if the sample is a dynamic sign
function isDynamicSample(sample) {
    return sample.type === 'dynamic';  // Check type
}

// Get unique labels from samples
// Returns an array of unique label strings
function getUniqueLabels(samples) {
    return [...new Set(samples.map(s => s.label))];  // Extract unique labels
}

// Shuffle array randomly
// Returns a shuffled copy of the input array
function shuffleArray(arr) {
    const out = [...arr];  // Copy array
    for (let i = out.length - 1; i > 0; i -= 1) {  // Fisher-Yates shuffle
        const j = Math.floor(Math.random() * (i + 1));  // Random index
        [out[i], out[j]] = [out[j], out[i]];  // Swap
    }
    return out;  // Return shuffled
}

// Get rehearsal samples per label
// Limits the number of samples per label to prevent imbalance
function getRehearsalSamplesPerLabel(samples, perLabelLimit) {
    const buckets = {};  // Initialize buckets
    samples.forEach((sample) => {  // Loop through samples
        if (!buckets[sample.label]) buckets[sample.label] = [];  // Initialize bucket
        buckets[sample.label].push(sample);  // Add to bucket
    });

    const rehearsal = [];  // Initialize rehearsal array
    Object.keys(buckets).forEach((label) => {  // Loop through buckets
        const shuffled = shuffleArray(buckets[label]);  // Shuffle bucket
        rehearsal.push(...shuffled.slice(0, perLabelLimit));  // Add limited samples
    });

    return rehearsal;  // Return rehearsal samples
}

// Add dummy class if needed for training
// TensorFlow requires at least 2 classes, so adds a dummy class if only 1 exists
function withDummyClassIfNeeded(samples, labels) {
    if (labels.length >= 2) {  // If 2+ classes
        return { trainingData: samples, trainingLabels: labels };  // Return as-is
    }

    const dummyLabel = `${DUMMY_LABEL_PREFIX}_${labels[0]}`;  // Create dummy label
    const dummyCount = Math.max(1, Math.ceil(samples.length * 0.2));  // Calculate dummy count
    const dummySamples = samples.slice(0, dummyCount).map((sample) => ({  // Create dummy samples
        ...sample,  // Copy sample
        label: dummyLabel  // Change label
    }));

    return {
        trainingData: [...samples, ...dummySamples],  // Combine samples
        trainingLabels: [labels[0], dummyLabel]  // Combine labels
    };
}

// Filter out dummy labels
// Returns only public (non-dummy) labels
function toPublicLabels(labels) {
    return labels.filter(l => !l.startsWith(DUMMY_LABEL_PREFIX));  // Filter dummy labels
}

// Normalize legacy samples as trained
// Marks legacy samples as trained if a model exists for their type
function normalizeLegacySamplesAsTrained(hasStaticModel, hasDynamicModel) {
    let changed = false;  // Track changes
    collectedData.forEach((sample) => {  // Loop through samples
        if (sample.isTrained !== undefined) return;  // Skip if already set
        if (hasStaticModel && isStaticSample(sample)) {  // If static model exists
            sample.isTrained = true;  // Mark as trained
            changed = true;  // Mark changed
        }
        if (hasDynamicModel && isDynamicSample(sample)) {  // If dynamic model exists
            sample.isTrained = true;  // Mark as trained
            changed = true;  // Mark changed
        }
    });
    return changed;  // Return if changed
}

// Ensure training models are loaded
// Loads static and dynamic models from cloud or localStorage
async function ensureTrainingModelsLoaded() {
    if (!model) model = {};  // Initialize model object

    // Load static model
    if (!model.static) {  // If static model not loaded
        let localModelKey = `localstorage://${STORAGE_KEYS[currentLang].model}-static`;  // Local storage key

        let cloudData = null;  // Initialize cloud data
        if (navigator.onLine) {  // If online
            cloudData = await fetchCloudModel('static', currentLang);  // Fetch from cloud
        }

        if (cloudData) {  // If cloud data found
            model.static = cloudData.model;  // Set model
            model.staticLabels = cloudData.labels;  // Set labels
            ensureModelCompiled(model.static, 'static model');  // Compile model
            console.log("Loaded static base from cloud.");  // Log
            try {
                await model.static.save(localModelKey);  // Save locally
                localStorage.setItem(`${STORAGE_KEYS[currentLang].labels}-static`, JSON.stringify(model.staticLabels));  // Save labels
            } catch (e) {}  // Ignore save errors
        } else {  // No cloud data
            let savedStaticLabels = localStorage.getItem(`${STORAGE_KEYS[currentLang].labels}-static`);  // Get local labels
            if (savedStaticLabels) {  // If local labels exist
                try {
                    model.static = await tf.loadLayersModel(localModelKey);  // Load model
                    model.staticLabels = JSON.parse(savedStaticLabels);  // Parse labels
                    ensureModelCompiled(model.static, 'static model');  // Compile model
                } catch (err) {
                    model.static = null;  // Clear on error
                }
            }
        }
    }

    // Load dynamic model
    if (!model.dynamic) {  // If dynamic model not loaded
        let cloudData = null;  // Initialize cloud data
        if (navigator.onLine) {  // If online
            cloudData = await fetchCloudModel('dynamic', currentLang);  // Fetch from cloud
        }

        if (cloudData) {  // If cloud data found
            model.dynamic = cloudData.model;  // Set model
            model.dynamicLabels = cloudData.labels;  // Set labels
            model.dynamicHandRequirements = cloudData.handReqs || {};  // Set hand requirements
            ensureModelCompiled(model.dynamic, 'dynamic model');  // Compile model
            console.log("Loaded dynamic base from cloud.");  // Log
            try {
                await model.dynamic.save(`localstorage://${STORAGE_KEYS[currentLang].model}-dynamic`);  // Save locally
                localStorage.setItem(`${STORAGE_KEYS[currentLang].labels}-dynamic`, JSON.stringify(model.dynamicLabels));  // Save labels
                localStorage.setItem(`${STORAGE_KEYS[currentLang].labels}-dynamic-hand-req`, JSON.stringify(model.dynamicHandRequirements));  // Save hand reqs
            } catch (e) {}  // Ignore save errors
        } else {  // No cloud data
            let savedDynamicLabels = localStorage.getItem(`${STORAGE_KEYS[currentLang].labels}-dynamic`);  // Get local labels
            if (savedDynamicLabels) {  // If local labels exist
                try {
                    model.dynamic = await tf.loadLayersModel(`localstorage://${STORAGE_KEYS[currentLang].model}-dynamic`);  // Load model
                    model.dynamicLabels = JSON.parse(savedDynamicLabels);  // Parse labels
                    const handReqRaw = localStorage.getItem(`${STORAGE_KEYS[currentLang].labels}-dynamic-hand-req`);  // Get hand reqs
                    model.dynamicHandRequirements = handReqRaw ? JSON.parse(handReqRaw) : {};  // Parse hand reqs
                    ensureModelCompiled(model.dynamic, 'dynamic model');  // Compile model
                } catch (err) {
                    model.dynamic = null;  // Clear on error
                }
            }
        }
    }
}

// Fetch model from cloud storage
// Loads model and labels from Supabase storage
async function fetchCloudModel(type, lang) {
    try {
        const langLower = lang.toLowerCase();  // Lowercase language
        const candidates = await window.getStorageBucketCandidates('models');  // Get bucket candidates

        for (const modelsBucket of candidates) {  // Try each bucket
            // 1. Get Public URLs for labels and model
            const { data: labelsUrlData } = window.supabaseClient.storage  // Get labels URL
                .from(modelsBucket)
                .getPublicUrl(`${langLower}/${type}/labels.json`);
                
            const { data: modelUrlData } = window.supabaseClient.storage  // Get model URL
                .from(modelsBucket)
                .getPublicUrl(`${langLower}/${type}/model.json`);

            // 2. Load Labels
            const labelsRes = await fetch(labelsUrlData.publicUrl);  // Fetch labels
            if (!labelsRes.ok) {  // If failed
                continue;  // Try next bucket
            }

            const labels = normalizeLabelList(await labelsRes.json()).normalized;  // Normalize labels
            
            // 3. Load Model
            const cloudModel = await tf.loadLayersModel(modelUrlData.publicUrl);  // Load model
            
            let handReqs = null;  // Initialize hand requirements
            if (type === 'dynamic') {  // If dynamic model
                const { data: handReqsUrlData } = window.supabaseClient.storage  // Get hand reqs URL
                    .from(modelsBucket)
                    .getPublicUrl(`${langLower}/${type}/hand_reqs.json`);
                const reqRes = await fetch(handReqsUrlData.publicUrl);  // Fetch hand reqs
                if (reqRes.ok) {  // If successful
                    handReqs = normalizeHandRequirementMap(await reqRes.json()).normalized;  // Normalize hand reqs
                }
            }
            
            return { model: cloudModel, labels, handReqs };  // Return model data
        }

        return null;  // No model found
    } catch (err) {
        console.warn(`Cloud model fetch failed for ${type}:`, err);  // Log warning
        return null;  // Return null
    }
}

// ==================== MODEL CREATION ====================
// Create a static model for single-pose signs
// Builds a neural network for static sign classification
function createStaticModel(outputUnits) {
    const staticModel = tf.sequential();  // Create sequential model
    staticModel.add(tf.layers.dense({ units: 64, activation: 'relu', inputShape: [63] }));  // Input layer
    staticModel.add(tf.layers.dropout({ rate: 0.2 }));  // Dropout layer
    staticModel.add(tf.layers.dense({ units: 32, activation: 'relu' }));  // Hidden layer
    staticModel.add(tf.layers.dense({ units: outputUnits, activation: 'softmax' }));  // Output layer
    staticModel.compile({ optimizer: 'adam', loss: 'categoricalCrossentropy', metrics: ['accuracy'] });  // Compile
    return staticModel;  // Return model
}

// Create a dynamic model for movement-based signs
// Builds an LSTM network for dynamic sign classification
function createDynamicModel(outputUnits) {
    const dynamicModel = tf.sequential();  // Create sequential model
    dynamicModel.add(tf.layers.lstm({  // First LSTM layer
        units: 64,  // 64 units
        returnSequences: true,  // Return sequences
        inputShape: [MAX_DYNAMIC_FRAMES, 63],  // Input shape
        kernelInitializer: 'glorotUniform',  // Weight init
        recurrentInitializer: 'glorotUniform'  // Recurrent init
    }));
    dynamicModel.add(tf.layers.dropout({ rate: 0.2 }));  // Dropout layer
    dynamicModel.add(tf.layers.lstm({  // Second LSTM layer
        units: 32,  // 32 units
        returnSequences: false,  // Don't return sequences
        kernelInitializer: 'glorotUniform',  // Weight init
        recurrentInitializer: 'glorotUniform'  // Recurrent init
    }));
    dynamicModel.add(tf.layers.dense({ units: outputUnits, activation: 'softmax' }));  // Output layer
    dynamicModel.compile({ optimizer: 'adam', loss: 'categoricalCrossentropy', metrics: ['accuracy'] });  // Compile
    return dynamicModel;  // Return model
}

// Ensure model is compiled
// Compiles the model if not already compiled (for incremental training)
function ensureModelCompiled(modelInstance, modelType = 'model') {
    if (!modelInstance) return;  // Exit if no model
    if (modelInstance.optimizer) return;  // Exit if already compiled

    modelInstance.compile({  // Compile model
        optimizer: 'adam',  // Adam optimizer
        loss: 'categoricalCrossentropy',  // Crossentropy loss
        metrics: ['accuracy']  // Track accuracy
    });
    console.log(`Recompiled ${modelType} for incremental training.`);  // Log
}

// Compute dynamic hand requirements
// Determines which signs require 1 or 2 hands based on training data
function computeDynamicHandRequirements(trainingData, labels) {
    const handRequirementMap = {};  // Initialize map
    labels.forEach((label) => {  // Loop through labels
        if (label.startsWith(DUMMY_LABEL_PREFIX)) {  // If dummy label
            handRequirementMap[label] = 'any';  // Set to any
            return;  // Skip
        }

        const labelSamples = trainingData.filter(d => d.label === label);  // Get label samples
        const observed = new Set(  // Get observed hand counts
            labelSamples
                .map(d => {  // Map to hand count
                    const raw = Number(d.handCount ?? d.requiredHands);  // Get count
                    return raw === 2 ? 2 : (raw === 1 ? 1 : null);  // Normalize
                })
                .filter(v => v !== null)  // Filter nulls
        );

        handRequirementMap[label] = observed.size === 1 ? [...observed][0] : 'any';  // Set requirement
    });

    return handRequirementMap;  // Return map
}

// Get metric accuracy from training logs
// Extracts accuracy value from TensorFlow logs
function getMetricAccuracy(logs) {
    return (logs?.acc ?? logs?.accuracy ?? 0).toFixed(3);  // Return accuracy
}

// ==================== INTERNAL TRAINING ====================
// Run internal training on device
// Trains both static and dynamic models using collected data
async function runInternalTraining() {
    try {
        await ensureTrainingModelsLoaded();  // Load base models

        const staticData = collectedData.filter(isStaticSample);  // Filter static data
        const dynamicData = collectedData.filter(isDynamicSample);  // Filter dynamic data

        const legacyFlagsChanged = normalizeLegacySamplesAsTrained(Boolean(model?.static), Boolean(model?.dynamic));  // Normalize legacy

        const newStaticData = staticData.filter(d => d.isTrained === false);  // Get new static data
        const newDynamicData = dynamicData.filter(d => d.isTrained === false);  // Get new dynamic data

        if (!model.static && !model.dynamic && (staticData.length + dynamicData.length) < 10) {  // Validate data
            throw new Error("Collect more data (min 10 samples) before training.");  // Throw error
        }

        if (newStaticData.length === 0 && newDynamicData.length === 0 && (model.static || model.dynamic)) {  // If no new data
            if (legacyFlagsChanged) await saveToServer();  // Save if flags changed
            return { alreadyTrained: true };  // Return already trained
        }

        let trainedAnything = false;  // Track if trained anything
        let flagsChanged = legacyFlagsChanged;  // Track flag changes

        // Train static model
        if (newStaticData.length > 0 || (!model.static && staticData.length >= 5)) {  // If should train
            await new Promise(resolve => setTimeout(resolve, 100));  // Small delay
            updateProcessingModal("Training Static AI...", "Your device is learning hand shapes...");  // Update modal
            const staticResult = await trainStaticModel(staticData, newStaticData);  // Train static
            if (staticResult.trained) {  // If trained
                newStaticData.forEach((sample) => {  // Mark as trained
                    sample.isTrained = true;  // Set flag
                    sample.trainedAt = Date.now();  // Set timestamp
                });
                flagsChanged = true;  // Mark changed
                trainedAnything = true;  // Mark trained
            }
        }

        // Train dynamic model
        if (newDynamicData.length > 0 || (!model.dynamic && dynamicData.length >= 5)) {  // If should train
            await new Promise(resolve => setTimeout(resolve, 100));  // Small delay
            updateProcessingModal("Training Dynamic AI...", "Your device is learning motion patterns...");  // Update modal
            const dynamicResult = await trainDynamicModel(dynamicData, newDynamicData);  // Train dynamic
            if (dynamicResult.trained) {  // If trained
                newDynamicData.forEach((sample) => {  // Mark as trained
                    sample.isTrained = true;  // Set flag
                    sample.trainedAt = Date.now();  // Set timestamp
                });
                flagsChanged = true;  // Mark changed
                trainedAnything = true;  // Mark trained
            }
        }

        if (!trainedAnything) {  // If nothing trained
            throw new Error("Not enough new samples to train. Need at least 5 new samples.");  // Throw error
        }

        if (flagsChanged) await saveToServer();  // Save if changed

        const modelTypes = [];  // Initialize model types
        if (model.static) modelTypes.push("Static ✋");  // Add static if exists
        if (model.dynamic) modelTypes.push("Dynamic 🔄");  // Add dynamic if exists

        return {  // Return result
            trained: true,  // Trained flag
            types: modelTypes,  // Model types
            flagsChanged: flagsChanged  // Flag changes
        };
    } catch (error) {
        throw error;  // Re-throw error
    }
}

// Train static model
// Trains or incrementally updates the static sign model
async function trainStaticModel(staticData, newStaticData) {
    const hasExistingModel = Boolean(model?.static);  // Check if model exists
    const existingLabels = model?.staticLabels || [];  // Get existing labels

    // Train from scratch if no existing model
    if (!hasExistingModel) {  // If no model
        if (staticData.length < 5) return { trained: false };  // Not enough data

        // Filter out samples with incorrect landmark length (should be 63 for single hand)
        const validStaticData = staticData.filter(d => d.landmarks && d.landmarks.length === 63);  // Filter
        if (validStaticData.length !== staticData.length) {  // If filtered
            console.warn(`Filtered out ${staticData.length - validStaticData.length} samples with incorrect landmark length`);  // Log
            staticData = validStaticData;  // Use filtered
        }

        if (staticData.length < 5) return { trained: false };  // Not enough data

        let baseLabels = getUniqueLabels(staticData);  // Get unique labels
        const prepared = withDummyClassIfNeeded(staticData, baseLabels);  // Add dummy if needed
        const trainingData = prepared.trainingData;  // Get training data
        const trainingLabels = prepared.trainingLabels;  // Get training labels
        const labelMap = {};  // Initialize label map
        trainingLabels.forEach((label, index) => { labelMap[label] = index; });  // Build map

        statusMsg.innerText = "🔄 Training static model from base dataset...";  // Update status

        // Final validation: ensure all training data has correct landmark length
        const validTrainingData = trainingData.filter(d => d.landmarks && d.landmarks.length === 63);  // Filter
        if (validTrainingData.length !== trainingData.length) {  // If filtered
            console.warn(`Final filter: removed ${trainingData.length - validTrainingData.length} samples with incorrect landmark length`);  // Log
            trainingData = validTrainingData;  // Use filtered
        }

        if (trainingData.length < 5) return { trained: false };  // Not enough data

        const xs = tf.tensor2d(trainingData.map(d => d.landmarks));  // Create input tensor
        const ys = tf.oneHot(tf.tensor1d(trainingData.map(d => labelMap[d.label]), 'int32'), trainingLabels.length);  // Create output tensor
        const staticModel = createStaticModel(trainingLabels.length);  // Create model

        try {
            await staticModel.fit(xs, ys, {  // Train model
                epochs: 30,  // 30 epochs
                batchSize: 16,  // Batch size
                shuffle: true,  // Shuffle data
                verbose: 1,  // Show logs
                callbacks: {  // Callbacks
                    onEpochEnd: async (epoch, logs) => {  // On epoch end
                        statusMsg.innerText = `🔄 Static Model: Epoch ${epoch + 1}/30 | Loss: ${logs.loss.toFixed(4)} | Acc: ${getMetricAccuracy(logs)}`;  // Update status
                        if (epoch % 5 === 0) await tf.nextFrame();  // Yield to UI
                    }
                }
            });
            model.static = staticModel;  // Save model
            model.staticLabels = toPublicLabels(trainingLabels);  // Save labels
            return { trained: true };  // Return success
        } finally {
            xs.dispose();  // Dispose tensor
            ys.dispose();  // Dispose tensor
        }
    }

    if (newStaticData.length === 0) return { trained: false };  // No new data

    // Filter out samples with incorrect landmark length
    const validNewStaticData = newStaticData.filter(d => d.landmarks && d.landmarks.length === 63);  // Filter
    if (validNewStaticData.length !== newStaticData.length) {  // If filtered
        console.warn(`Filtered out ${newStaticData.length - validNewStaticData.length} new samples with incorrect landmark length`);  // Log
        newStaticData = validNewStaticData;  // Use filtered
    }

    if (newStaticData.length === 0) return { trained: false };  // No valid data

    const newLabels = getUniqueLabels(newStaticData);  // Get new labels
    const unseenLabels = newLabels.filter(label => !existingLabels.includes(label));  // Get unseen labels

    // Incremental training (no new labels)
    if (unseenLabels.length === 0) {  // If no new labels
        ensureModelCompiled(model.static, 'static model');  // Compile model

        const outputUnits = model.static.layers[model.static.layers.length - 1].units;  // Get output units
        const internalLabels = [...existingLabels];  // Copy labels
        while (internalLabels.length < outputUnits) {  // Pad with dummy labels
            internalLabels.push(`${DUMMY_LABEL_PREFIX}_static_${internalLabels.length}`);  // Add dummy
        }

        const labelMap = {};  // Initialize label map
        internalLabels.forEach((label, index) => { labelMap[label] = index; });  // Build map

        statusMsg.innerText = `🔄 Incremental static training on ${newStaticData.length} new samples...`;  // Update status

        // Final validation for incremental training
        const validIncrementalData = newStaticData.filter(d => d.landmarks && d.landmarks.length === 63);  // Filter
        if (validIncrementalData.length !== newStaticData.length) {  // If filtered
            console.warn(`Incremental filter: removed ${newStaticData.length - validIncrementalData.length} samples with incorrect landmark length`);  // Log
            newStaticData = validIncrementalData;  // Use filtered
        }

        const xs = tf.tensor2d(newStaticData.map(d => d.landmarks));  // Create input tensor
        const ys = tf.oneHot(tf.tensor1d(newStaticData.map(d => labelMap[d.label]), 'int32'), internalLabels.length);  // Create output tensor

        try {
            await model.static.fit(xs, ys, {  // Train model
                epochs: 12,  // 12 epochs
                batchSize: 16,  // Batch size
                shuffle: true,  // Shuffle data
                verbose: 1,  // Show logs
                callbacks: {  // Callbacks
                    onEpochEnd: async (epoch, logs) => {  // On epoch end
                        statusMsg.innerText = `🔄 Static Incremental: Epoch ${epoch + 1}/12 | Loss: ${logs.loss.toFixed(4)} | Acc: ${getMetricAccuracy(logs)}`;  // Update status
                        if (epoch % 4 === 0) await tf.nextFrame();  // Yield to UI
                    }
                }
            });
            return { trained: true };  // Return success
        } finally {
            xs.dispose();  // Dispose tensor
            ys.dispose();  // Dispose tensor
        }
    }

    // Rebuild model with new labels
    const rehearsalPool = staticData.filter(d => d.isTrained === true && existingLabels.includes(d.label));  // Get rehearsal data
    const rehearsalSamples = getRehearsalSamplesPerLabel(rehearsalPool, STATIC_REHEARSAL_PER_LABEL);  // Limit rehearsal
    const rebuildData = [...rehearsalSamples, ...newStaticData];  // Combine data
    let rebuildLabels = getUniqueLabels(rebuildData);  // Get unique labels

    if (rebuildData.length < 5) {  // Validate data
        throw new Error("Need at least 5 static samples for new-label update.");  // Throw error
    }

    const prepared = withDummyClassIfNeeded(rebuildData, rebuildLabels);  // Add dummy if needed
    const trainingData = prepared.trainingData;  // Get training data
    const trainingLabels = prepared.trainingLabels;  // Get training labels
    const labelMap = {};  // Initialize label map
    trainingLabels.forEach((label, index) => { labelMap[label] = index; });  // Build map

    statusMsg.innerText = `🔄 New static labels detected (${unseenLabels.join(', ')}). Rebuilding static model with rehearsal data...`;  // Update status

    const xs = tf.tensor2d(trainingData.map(d => d.landmarks));  // Create input tensor
    const ys = tf.oneHot(tf.tensor1d(trainingData.map(d => labelMap[d.label]), 'int32'), trainingLabels.length);  // Create output tensor
    const rebuiltStaticModel = createStaticModel(trainingLabels.length);  // Create model

    try {
        await rebuiltStaticModel.fit(xs, ys, {  // Train model
            epochs: 25,  // 25 epochs
            batchSize: 16,  // Batch size
            shuffle: true,  // Shuffle data
            verbose: 1,  // Show logs
            callbacks: {  // Callbacks
                onEpochEnd: async (epoch, logs) => {  // On epoch end
                    statusMsg.innerText = `🔄 Static Rebuild: Epoch ${epoch + 1}/25 | Loss: ${logs.loss.toFixed(4)} | Acc: ${getMetricAccuracy(logs)}`;  // Update status
                    if (epoch % 5 === 0) await tf.nextFrame();  // Yield to UI
                }
            }
        });
        model.static = rebuiltStaticModel;  // Save model
        model.staticLabels = toPublicLabels(trainingLabels);  // Save labels
        return { trained: true };  // Return success
    } finally {
        xs.dispose();  // Dispose tensor
        ys.dispose();  // Dispose tensor
    }
}

// Train dynamic model
// Trains or incrementally updates the dynamic sign model
async function trainDynamicModel(dynamicData, newDynamicData) {
    const hasExistingModel = Boolean(model?.dynamic);  // Check if model exists
    const existingLabels = model?.dynamicLabels || [];  // Get existing labels

    // Train from scratch if no existing model
    if (!hasExistingModel) {  // If no model
        if (dynamicData.length < 5) return { trained: false };  // Not enough data

        let baseLabels = getUniqueLabels(dynamicData);  // Get unique labels
        const prepared = withDummyClassIfNeeded(dynamicData, baseLabels);  // Add dummy if needed
        const trainingData = prepared.trainingData;  // Get training data
        const trainingLabels = prepared.trainingLabels;  // Get training labels
        const labelMap = {};  // Initialize label map
        trainingLabels.forEach((label, index) => { labelMap[label] = index; });  // Build map

        const handRequirementMap = computeDynamicHandRequirements(trainingData, trainingLabels);  // Compute hand reqs

        // Pad sequences to fixed length
        const paddedSequences = trainingData.map(d => {  // Map to padded sequences
            const frames = d.frames || [];  // Get frames
            if (frames.length < MAX_DYNAMIC_FRAMES) {  // If too short
                const lastFrame = frames[frames.length - 1] || new Array(63).fill(0);  // Get last frame
                return [...frames, ...Array(MAX_DYNAMIC_FRAMES - frames.length).fill(lastFrame)];  // Pad
            }
            return frames.slice(0, MAX_DYNAMIC_FRAMES);  // Trim if too long
        });

        statusMsg.innerText = "🔄 Training dynamic model from base dataset...";  // Update status

        const xs = tf.tensor3d(paddedSequences);  // Create input tensor
        const ys = tf.oneHot(tf.tensor1d(trainingData.map(d => labelMap[d.label]), 'int32'), trainingLabels.length);  // Create output tensor
        const dynamicModel = createDynamicModel(trainingLabels.length);  // Create model

        try {
            await dynamicModel.fit(xs, ys, {  // Train model
                epochs: 20,  // 20 epochs
                batchSize: 8,  // Batch size
                shuffle: true,  // Shuffle data
                verbose: 1,  // Show logs
                callbacks: {  // Callbacks
                    onEpochEnd: async (epoch, logs) => {  // On epoch end
                        statusMsg.innerText = `🔄 Dynamic Model: Epoch ${epoch + 1}/20 | Loss: ${logs.loss.toFixed(4)} | Acc: ${getMetricAccuracy(logs)}`;  // Update status
                        if (epoch % 5 === 0) await tf.nextFrame();  // Yield to UI
                    }
                }
            });
            model.dynamic = dynamicModel;  // Save model
            model.dynamicLabels = toPublicLabels(trainingLabels);  // Save labels
            model.dynamicHandRequirements = Object.fromEntries(  // Save hand reqs (filter dummy)
                Object.entries(handRequirementMap).filter(([label]) => !label.startsWith(DUMMY_LABEL_PREFIX))
            );
            return { trained: true };  // Return success
        } finally {
            xs.dispose();  // Dispose tensor
            ys.dispose();  // Dispose tensor
        }
    }

    if (newDynamicData.length === 0) return { trained: false };  // No new data

    const newLabels = getUniqueLabels(newDynamicData);  // Get new labels
    const unseenLabels = newLabels.filter(label => !existingLabels.includes(label));  // Get unseen labels

    // Incremental training (no new labels)
    if (unseenLabels.length === 0) {  // If no new labels
        ensureModelCompiled(model.dynamic, 'dynamic model');  // Compile model

        const outputUnits = model.dynamic.layers[model.dynamic.layers.length - 1].units;  // Get output units
        const internalLabels = [...existingLabels];  // Copy labels
        while (internalLabels.length < outputUnits) {  // Pad with dummy labels
            internalLabels.push(`${DUMMY_LABEL_PREFIX}_dynamic_${internalLabels.length}`);  // Add dummy
        }

        const labelMap = {};  // Initialize label map
        internalLabels.forEach((label, index) => { labelMap[label] = index; });  // Build map

        // Pad sequences to fixed length
        const paddedSequences = newDynamicData.map(d => {  // Map to padded sequences
            const frames = d.frames || [];  // Get frames
            if (frames.length < MAX_DYNAMIC_FRAMES) {  // If too short
                const lastFrame = frames[frames.length - 1] || new Array(63).fill(0);  // Get last frame
                return [...frames, ...Array(MAX_DYNAMIC_FRAMES - frames.length).fill(lastFrame)];  // Pad
            }
            return frames.slice(0, MAX_DYNAMIC_FRAMES);  // Trim if too long
        });

        statusMsg.innerText = `🔄 Incremental dynamic training on ${newDynamicData.length} new samples...`;  // Update status

        const xs = tf.tensor3d(paddedSequences);  // Create input tensor
        const ys = tf.oneHot(tf.tensor1d(newDynamicData.map(d => labelMap[d.label]), 'int32'), internalLabels.length);  // Create output tensor

        try {
            await model.dynamic.fit(xs, ys, {  // Train model
                epochs: 10,  // 10 epochs
                batchSize: 8,  // Batch size
                shuffle: true,  // Shuffle data
                verbose: 1,  // Show logs
                callbacks: {  // Callbacks
                    onEpochEnd: async (epoch, logs) => {  // On epoch end
                        statusMsg.innerText = `🔄 Dynamic Incremental: Epoch ${epoch + 1}/10 | Loss: ${logs.loss.toFixed(4)} | Acc: ${getMetricAccuracy(logs)}`;  // Update status
                        if (epoch % 3 === 0) await tf.nextFrame();  // Yield to UI
                    }
                }
            });

            const handReqFromNew = computeDynamicHandRequirements(newDynamicData, existingLabels);  // Compute hand reqs
            model.dynamicHandRequirements = {  // Merge hand reqs
                ...(model.dynamicHandRequirements || {}),  // Existing
                ...Object.fromEntries(  // New (filter dummy)
                    Object.entries(handReqFromNew).filter(([label]) => !label.startsWith(DUMMY_LABEL_PREFIX))
                )
            };
            return { trained: true };  // Return success
        } finally {
            xs.dispose();  // Dispose tensor
            ys.dispose();  // Dispose tensor
        }
    }

    // Rebuild model with new labels
    const rehearsalPool = dynamicData.filter(d => d.isTrained === true && existingLabels.includes(d.label));  // Get rehearsal data
    const rehearsalSamples = getRehearsalSamplesPerLabel(rehearsalPool, DYNAMIC_REHEARSAL_PER_LABEL);  // Limit rehearsal
    const rebuildData = [...rehearsalSamples, ...newDynamicData];  // Combine data

    if (rebuildData.length < 5) {  // Validate data
        throw new Error("Need at least 5 dynamic samples for new-label update.");  // Throw error
    }

    let rebuildLabels = getUniqueLabels(rebuildData);  // Get unique labels
    const prepared = withDummyClassIfNeeded(rebuildData, rebuildLabels);  // Add dummy if needed
    const trainingData = prepared.trainingData;  // Get training data
    const trainingLabels = prepared.trainingLabels;  // Get training labels
    const labelMap = {};  // Initialize label map
    trainingLabels.forEach((label, index) => { labelMap[label] = index; });  // Build map

    const handRequirementMap = computeDynamicHandRequirements(trainingData, trainingLabels);  // Compute hand reqs

    // Pad sequences to fixed length
    const paddedSequences = trainingData.map(d => {  // Map to padded sequences
        const frames = d.frames || [];  // Get frames
        if (frames.length < MAX_DYNAMIC_FRAMES) {  // If too short
            const lastFrame = frames[frames.length - 1] || new Array(63).fill(0);  // Get last frame
            return [...frames, ...Array(MAX_DYNAMIC_FRAMES - frames.length).fill(lastFrame)];  // Pad
        }
        return frames.slice(0, MAX_DYNAMIC_FRAMES);  // Trim if too long
    });

    statusMsg.innerText = `🔄 New dynamic labels detected (${unseenLabels.join(', ')}). Rebuilding dynamic model with rehearsal data...`;  // Update status

    const xs = tf.tensor3d(paddedSequences);  // Create input tensor
    const ys = tf.oneHot(tf.tensor1d(trainingData.map(d => labelMap[d.label]), 'int32'), trainingLabels.length);  // Create output tensor
    const rebuiltDynamicModel = createDynamicModel(trainingLabels.length);  // Create model

    try {
        await rebuiltDynamicModel.fit(xs, ys, {  // Train model
            epochs: 16,  // 16 epochs
            batchSize: 8,  // Batch size
            shuffle: true,  // Shuffle data
            verbose: 1,  // Show logs
            callbacks: {  // Callbacks
                onEpochEnd: async (epoch, logs) => {  // On epoch end
                    statusMsg.innerText = `🔄 Dynamic Rebuild: Epoch ${epoch + 1}/16 | Loss: ${logs.loss.toFixed(4)} | Acc: ${getMetricAccuracy(logs)}`;  // Update status
                    if (epoch % 4 === 0) await tf.nextFrame();  // Yield to UI
                }
            }
        });

        model.dynamic = rebuiltDynamicModel;  // Save model
        model.dynamicLabels = toPublicLabels(trainingLabels);  // Save labels
        model.dynamicHandRequirements = Object.fromEntries(  // Save hand reqs (filter dummy)
            Object.entries(handRequirementMap).filter(([label]) => !label.startsWith(DUMMY_LABEL_PREFIX))
        );
        return { trained: true };  // Return success
    } finally {
        xs.dispose();  // Dispose tensor
        ys.dispose();  // Dispose tensor
    }
}

// ==================== SIGN CARD UPLOAD ====================
// Sign card button click handler
// Opens file picker for sign card image upload
if (signCardBtn && signCardInput) {  // If elements exist
    signCardBtn.addEventListener('click', () => {  // Add click handler
        const label = normalizeLabel(labelInput.value);  // Get label
        if (!label) {  // Validate label
            alert("Please enter a Sign Name first before uploading its card.");  // Alert user
            labelInput.focus();  // Focus on input
            return;  // Exit
        }
        labelInput.value = label;  // Set normalized label
        signCardInput.click();  // Open file picker
    });

    // Clear sign details button handler
    // Clears sign name and deletes associated sign card from cloud
    if (clearSignDetailsBtn) {  // If button exists
        clearSignDetailsBtn.addEventListener('click', async () => {  // Add click handler
            const label = normalizeLabel(labelInput.value);  // Get label
            if (label) {  // If label exists
                // Attempt to delete any associated sign card image from the server
                try {
                    const signCardsBucket = await window.getStorageBucket('signCards');  // Get bucket
                    const { data: cardData } = await window.supabaseClient  // Query database
                        .from('sign_cards')
                        .select('extension')
                        .eq('lang', currentLang.toLowerCase())  // Filter by language
                        .eq('label', label)  // Filter by label
                        .single();  // Get single record

                    if (cardData) {  // If card exists
                        const filePath = `${currentLang.toLowerCase()}/${label}.${cardData.extension}`;  // Build file path
                        await window.supabaseClient.storage.from(signCardsBucket).remove([filePath]);  // Delete file
                    }
                    await window.supabaseClient.from('sign_cards').delete().eq('lang', currentLang.toLowerCase()).eq('label', label);  // Delete record
                } catch (err) {
                    console.warn(`Could not delete sign card image on clear for ${label}:`, err);  // Log warning
                }
            }

            // Clear UI elements
            labelInput.value = '';  // Clear label
            signCardInput.value = '';  // Clear file input
            signCardStatus.textContent = '';  // Clear status

            if (signCardFileName) {  // If filename element exists
                signCardFileName.textContent = '';  // Clear filename
                signCardFileName.style.display = 'none';  // Hide element
            }
            if (modalSignCardFileName) {  // If modal filename exists
                modalSignCardFileName.textContent = '';  // Clear filename
                modalSignCardFileName.style.display = 'none';  // Hide element
            }
        });
    }

    // Sign card input change handler
    // Handles file selection and uploads sign card to cloud
    signCardInput.addEventListener('change', (e) => {  // Add change handler
        const file = e.target.files[0];  // Get selected file
        if (!file) return;  // Exit if no file

        const label = normalizeLabel(labelInput.value || modalLabelInput?.value);  // Get label
        if (!label) {  // Validate label
            alert("Sign name is missing.");  // Alert user
            return;  // Exit
        }
        labelInput.value = label;  // Set label
        if (modalLabelInput && signSetupModal?.classList.contains('active')) {  // If modal active
            modalLabelInput.value = label;  // Set modal label
        }

        // Display selected filename
        if (signCardFileName) {  // If filename element exists
            signCardFileName.textContent = `Selected: ${file.name}`;  // Show filename
            signCardFileName.style.display = 'block';  // Show element
        }
        if (modalSignCardFileName) {  // If modal filename exists
            modalSignCardFileName.textContent = file.name;  // Show filename
            modalSignCardFileName.style.display = 'block';  // Show element
        }

        // Get extension from filename
        const filenameParts = file.name.split('.');  // Split filename
        if (filenameParts.length < 2) {  // Validate extension
            alert("File must have a valid image extension (.jpg, .png, .gif, .webp)");  // Alert user
            return;  // Exit
        }
        const extension = filenameParts.pop().toLowerCase();  // Get extension

        // Allowed extensions
        if (!['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(extension)) {  // Validate extension
            alert("Invalid format. Please upload JPG, PNG, GIF, or WEBP.");  // Alert user
            return;  // Exit
        }

        signCardStatus.textContent = `Uploading ${file.name}...`;  // Update status
        signCardStatus.style.color = '#58a6ff';  // Blue loading state

        const reader = new FileReader();  // Create file reader
        reader.onload = async (evt) => {  // On file read
            const base64Data = evt.target.result;  // Get base64 data

            try {
                // BUFFER instead of upload if modal Is open
                const isModalOpen = signSetupModal && signSetupModal.classList.contains('active');  // Check modal
                if (isModalOpen) {  // If modal open
                    pendingSignCard = { base64Data, extension };  // Buffer the card
                    signCardStatus.textContent = `✅ Card selected (Finish Setup to upload)`;  // Update status
                    signCardStatus.style.color = '#58a6ff';  // Blue color
                    const modalStatus = document.getElementById('modalSignCardStatus');  // Get modal status
                    if (modalStatus) {  // If exists
                        modalStatus.textContent = '';  // Clear status
                        modalStatus.style.color = '#58a6ff';  // Blue color
                    }
                    return;  // Exit (don't upload yet)
                }

                // Upload to server
                const response = await fetch('/api/upload-sign-card', {  // Call upload API
                    method: 'POST',  // POST method
                    headers: { 'Content-Type': 'application/json' },  // JSON headers
                    body: JSON.stringify({  // Request body
                        lang: currentLang,  // Language
                        label,  // Label
                        imageBase64: base64Data,  // Image data
                        extension  // File extension
                    })
                });

                const data = await response.json().catch(() => ({}));  // Parse response
                if (!response.ok) throw new Error(data.error || 'Failed to upload sign card');  // Throw error

                if (true) {  // If successful
                    signCardStatus.textContent = `✅ Uploaded successfully!`;  // Update status
                    signCardStatus.style.color = '#2ea043';  // Green success state
                    setTimeout(() => {  // Clear after delay
                        signCardStatus.textContent = '';  // Clear status
                    }, 5000);  // 5 seconds
                } else {  // If failed
                    throw new Error(data.error || 'Failed to finish upload');  // Throw error
                }
            } catch (err) {
                console.error("Card upload error:", err);  // Log error
                signCardStatus.textContent = `❌ Upload failed`;  // Update status
                signCardStatus.style.color = '#da3633';  // Red error state
                alert("Could not upload sign card. Make sure server is running.");  // Alert user
            }
        };
        reader.readAsDataURL(file);  // Read file as data URL

        // Reset input to allow selecting same file again if it failed
        e.target.value = '';  // Reset input
    });
}

// ==================== LABEL INPUT HANDLER ====================
// Label input blur handler
// Normalizes the label when the input loses focus
labelInput.addEventListener('blur', () => {  // Add blur handler
    const normalized = normalizeLabel(labelInput.value);  // Normalize label
    if (normalized) {  // If normalized
        labelInput.value = normalized;  // Set normalized value
    }
});

// ==================== INITIALIZATION ====================
// Start the application
init();  // Initialize the training interface
