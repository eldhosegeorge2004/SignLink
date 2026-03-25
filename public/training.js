
// --- DOM Elements ---
const videoElement = document.getElementById('inputVideo');
const canvasElement = document.getElementById('outputCanvas');
const canvasCtx = canvasElement.getContext('2d');
const langSelect = document.getElementById('langSelect');
const labelInput = document.getElementById('labelInput');
const captureBtn = document.getElementById('captureBtn');
const statusMsg = document.getElementById('statusMsg');
const dataList = document.getElementById('dataList');
const totalSamplesBadge = document.getElementById('totalSamples');
const recIndicator = document.getElementById('recIndicator');
const clearAllBtn = document.getElementById('clearAllBtn');
const dataPanel = document.querySelector('.data-panel');
const openDataPanelBtn = document.getElementById('openDataPanelBtn');
const openDataPanelBtnMobile = document.getElementById('openDataPanelBtnMobile');
const closeDataPanelBtn = document.getElementById('closeDataPanelBtn');
const backToMainBtn = document.getElementById('backToMainBtn');
const drawerBackdrop = document.getElementById('drawerBackdrop');
const alertBackdrop = document.getElementById('alertBackdrop');
const customAlert = document.getElementById('customAlert');
const alertMessage = document.getElementById('alertMessage');
const alertOkBtn = document.getElementById('alertOkBtn');

// Mobile Sidebar Elements
// Mobile Sidebar Elements
const mobileLabelDisplay = document.getElementById('mobileLabelDisplay');
const mobileModeDisplay = document.getElementById('mobileModeDisplay');

// Mobile Multi-step Setup Elements
const mobileAddButtonWrap = document.getElementById('mobileAddButtonWrap');
const mobileAddSignBtn = document.getElementById('mobileAddSignBtn');
const mobileRecordingActions = document.getElementById('mobileRecordingActions');
const mobileTrainSaveBtn = document.getElementById('mobileTrainSaveBtn');
const mobileRecordingCounter = document.getElementById('mobileRecordingCounter');
const mobileBackBtn = document.getElementById('mobileBackBtn');
const mobileClearSignBtn = document.getElementById('mobileClearSignBtn');
const mobileUploadBtn = document.getElementById('mobileUploadBtn');
const cloudSyncBtn = document.getElementById('cloudSyncBtn');
const mobileRevertBtn = document.getElementById('mobileRevertBtn');
const signSetupModal = document.getElementById('signSetupModal');
const modalLabelInput = document.getElementById('modalLabelInput');
const modalSignCardBtn = document.getElementById('modalSignCardBtn');
const startRecordingBtn = document.getElementById('startRecordingBtn');
const nextStepBtns = document.querySelectorAll('.next-step');
const prevStepBtns = document.querySelectorAll('.prev-step');
const modalSteps = document.querySelectorAll('.modal-step');
const langOptions = document.querySelectorAll('.lang-option');
const modeOptions = document.querySelectorAll('.mode-option');
const captureBtnPortal = document.getElementById('captureBtnPortal');

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

// Pending data for mobile "Finish Setup" workflow
let pendingSignCard = null; // { base64Data, extension }
let lastSessionSampleCountAtStart = 0;
let isInSetupMode = false;
let lastRecordedBatchCount = 0;
let sessionHistory = [];
let lastTrainSaveState = { lang: '', label: '', sampleCount: 0 };

function openDataDrawer() {
    if (!dataPanel) return;
    dataPanel.classList.add('open');
    if (drawerBackdrop) drawerBackdrop.classList.add('active');
}

function closeDataDrawer() {
    if (!dataPanel) return;
    dataPanel.classList.remove('open');
    if (drawerBackdrop) drawerBackdrop.classList.remove('active');
}

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

function normalizeLabelList(labels) {
    let changed = false;
    const normalized = (labels || []).map((label) => {
        const nextLabel = normalizeLabel(label);
        if (nextLabel !== label) {
            changed = true;
        }
        return nextLabel;
    });
    return { normalized, changed };
}

function normalizeHandRequirementMap(map) {
    let changed = false;
    const normalized = {};

    Object.entries(map || {}).forEach(([label, requirement]) => {
        const normalizedLabel = normalizeLabel(label);
        if (normalizedLabel !== label) {
            changed = true;
        }
        normalized[normalizedLabel] = requirement;
    });

    return { normalized, changed };
}

function getUntrainedSampleCount() {
    return collectedData.filter(sample => sample.isTrained === false).length;
}

// Storage Keys
const STORAGE_KEYS = {
    'ISL': { model: 'my-isl-model', labels: 'isl_labels', data: 'isl_data' },
    'ASL': { model: 'my-asl-model', labels: 'asl_labels', data: 'asl_data' }
};

// --- Initialization ---
async function init() {
    startCamera();
    setupModeToggle();
    setupMobileDataDrawer();
    setupMobileSignSetup(); // New mobile workflow
    setupCustomAlert();
    await loadDataFromServer();
}

let confirmResolver = null;

function setupCustomAlert() {
    const alertCancelBtn = document.getElementById('alertCancelBtn');

    if (alertOkBtn) {
        alertOkBtn.addEventListener('click', () => {
            customAlert.classList.remove('active');
            alertBackdrop.classList.remove('active');
            if (confirmResolver) {
                confirmResolver(true);
                confirmResolver = null;
            }
        });
    }

    if (alertCancelBtn) {
        alertCancelBtn.addEventListener('click', () => {
            customAlert.classList.remove('active');
            alertBackdrop.classList.remove('active');
            if (confirmResolver) {
                confirmResolver(false);
                confirmResolver = null;
            }
        });
    }

    if (alertBackdrop) {
        alertBackdrop.addEventListener('click', () => {
            customAlert.classList.remove('active');
            alertBackdrop.classList.remove('active');
            if (confirmResolver) {
                confirmResolver(false);
                confirmResolver = null;
            }
        });
    }
}

function showCustomAlert(message) {
    if (!customAlert || !alertMessage) {
        alert(message);
        return;
    }
    alertMessage.textContent = message;
    const alertCancelBtn = document.getElementById('alertCancelBtn');
    if (alertCancelBtn) alertCancelBtn.style.display = 'none';
    if (confirmResolver) { confirmResolver(false); confirmResolver = null; }
    customAlert.classList.add('active');
    alertBackdrop.classList.add('active');
}

function showCustomConfirm(message) {
    return new Promise((resolve) => {
        if (!customAlert || !alertMessage) {
            resolve(confirm(message));
            return;
        }
        alertMessage.textContent = message;
        const alertCancelBtn = document.getElementById('alertCancelBtn');
        if (alertCancelBtn) alertCancelBtn.style.display = 'block';
        confirmResolver = resolve;
        customAlert.classList.add('active');
        alertBackdrop.classList.add('active');
    });
}

function showToast(message, icon = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `
        <span class="material-icons" style="font-size: 18px;">${icon}</span>
        <span>${message}</span>
    `;
    container.appendChild(toast);

    // Auto-remove after 3s
    setTimeout(() => {
        toast.classList.add('out');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Processing Modal Handlers
function showProcessingModal(title, status) {
    const modal = document.getElementById('processingModal');
    const titleEl = document.getElementById('processingText');
    const statusEl = document.getElementById('processingStatus');
    
    if (modal && titleEl && statusEl) {
        titleEl.textContent = title;
        statusEl.textContent = status;
        modal.classList.add('active');
    }
}

function updateProcessingModal(title, status) {
    const titleEl = document.getElementById('processingText');
    const statusEl = document.getElementById('processingStatus');
    if (titleEl) titleEl.textContent = title;
    if (statusEl) statusEl.textContent = status;
}

function hideProcessingModal() {
    const modal = document.getElementById('processingModal');
    if (modal) modal.classList.remove('active');
}

function setupMobileDataDrawer() {
    if (!dataPanel) return;

    if (openDataPanelBtn) openDataPanelBtn.addEventListener('click', openDataDrawer);
    if (openDataPanelBtnMobile) openDataPanelBtnMobile.addEventListener('click', openDataDrawer);
    if (closeDataPanelBtn) closeDataPanelBtn.addEventListener('click', closeDataDrawer);
    if (backToMainBtn) backToMainBtn.addEventListener('click', closeDataDrawer);

    if (drawerBackdrop) {
        drawerBackdrop.addEventListener('click', closeDataDrawer);
    }

    window.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeDataDrawer();
    });

    dataPanel.addEventListener('click', (event) => {
        if (!(event.target instanceof Element)) return;
        const button = event.target.closest('button');
        if (!button || !dataPanel.contains(button)) return;
        closeDataDrawer();
    }, true);

    // Drawer behavior is now consistent across all screen sizes

    // Initial sync for mobile status tags
    updateMobileStatusTags();

    // Move capture button to portal on small screens
    // Always move capture button to portal for the unified view
    if (captureBtnPortal && captureBtn) {
        captureBtnPortal.appendChild(captureBtn);
    }
}

/**
 * Mobile Sign Setup Workflow (Multi-step Dialog)
 */
function setupMobileSignSetup() {
    if (!mobileAddSignBtn) return;

    let currentStep = 1;

    const updateModalSteps = () => {
        modalSteps.forEach(step => {
            step.classList.remove('active');
            if (parseInt(step.dataset.step) === currentStep) {
                step.classList.add('active');
            }
        });
    };

    mobileAddSignBtn.addEventListener('click', () => {
        if (mobileAddSignBtn.dataset.setup === 'true') return; // Don't open modal if we are in "Finish" mode
        currentStep = 1;
        updateModalSteps();
        signSetupModal.classList.add('active');
        if (drawerBackdrop) drawerBackdrop.classList.add('active');
    });

    nextStepBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            if (currentStep < 3) {
                currentStep++;
                updateModalSteps();
            }
        });
    });

    prevStepBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            if (currentStep > 1) {
                currentStep--;
                updateModalSteps();
            }
        });
    });

    // Cancel Setup
    document.querySelectorAll('.cancel-setup').forEach(btn => {
        btn.addEventListener('click', () => {
            signSetupModal.classList.remove('active');
            if (drawerBackdrop) drawerBackdrop.classList.remove('active');
            // Don't reset everything, just close the modal. 
            // The main bar still says "Add New Sign"
        });
    });

    // Language Selection
    langOptions.forEach(opt => {
        opt.addEventListener('click', () => {
            langOptions.forEach(o => {
                o.classList.remove('active');
                o.style.borderColor = '#30363d';
            });
            opt.classList.add('active');
            opt.style.borderColor = '#58a6ff';
            
            // Sync with main select
            const val = opt.dataset.value;
            langSelect.value = val;
            currentLang = val;
            loadDataFromServer();
        });
    });

    // Mode Selection
    modeOptions.forEach(opt => {
        opt.addEventListener('click', () => {
            modeOptions.forEach(o => {
                o.classList.remove('active');
                o.style.borderColor = '#30363d';
            });
            opt.classList.add('active');
            opt.style.borderColor = '#58a6ff';
            
            const mode = opt.dataset.value;
            switchMode(mode);
            
            const desc = document.getElementById('modalModeDesc');
            if (desc) {
                desc.textContent = mode === 'static' ? 
                    'Static: Single pose signs (A, B, etc.)' : 
                    'Dynamic: Movement signs (Thank You, etc.)';
            }
        });
    });

    // Start Recording (Step 3 Button)
    if (startRecordingBtn) {
        startRecordingBtn.addEventListener('click', () => {
            const label = modalLabelInput.value.trim();
            if (!label) {
                showCustomAlert("Sign Name is compulsory! Please enter a name.");
                modalLabelInput.focus();
                return;
            }

            // 1. Prepare for recording
            labelInput.value = label;
            isInSetupMode = true;
            updateMobileStatusTags();

            // 2. Close Modal
            signSetupModal.classList.remove('active');
            if (drawerBackdrop) drawerBackdrop.classList.remove('active');

            // 3. Transitions
            mobileAddSignBtn.dataset.setup = 'true';
            setMobileBottomBarMode('recording');
        });
    }

    // Mobile Finish Button click handling
    mobileAddSignBtn.addEventListener('click', async () => {
        if (mobileAddSignBtn.dataset.setup !== 'true') return;

        const label = labelInput.value.trim();
        mobileAddSignBtn.disabled = true;
        mobileAddSignBtn.innerHTML = '<span class="material-icons" style="font-size: 28px;">save</span>';

        try {
            // 1. Save to Local Storage instead of server
            saveToLocalStorage();
            
            showToast(`✅ Sign "${label}" saved locally!`, 'storage');
            resetMobileSignSetup(false); // DO NOT discard data on finish
            renderDataList();
        } catch (err) {
            console.error('Local save error:', err);
            showCustomAlert('Failed to save to local storage. Storage might be full.');
            mobileAddSignBtn.disabled = false;
            mobileAddSignBtn.innerHTML = '<span class="material-icons" style="font-size: 28px;">check_circle</span>';
        }
    });

    function saveToLocalStorage() {
        try {
            const keys = STORAGE_KEYS[currentLang];
            const label = labelInput.value.trim();
            
            // Save training data
            localStorage.setItem(keys.data, JSON.stringify(collectedData));
            
            // Save sign card if pending
            if (pendingSignCard) {
                const cardKey = `sign_card_${currentLang}_${label}`;
                localStorage.setItem(cardKey, JSON.stringify({
                    imageBase64: pendingSignCard.base64Data,
                    extension: pendingSignCard.extension
                }));
            }
            console.log(`Data for ${label} saved to localStorage.`);
        } catch (err) {
            console.error('Error in saveToLocalStorage:', err);
            throw err;
        }
    }

    // Clear Sign Button (X)
    mobileClearSignBtn.addEventListener('click', () => {
        resetMobileSignSetup(true); // DISCARD data on clear
    });

    if (mobileBackBtn) {
        mobileBackBtn.addEventListener('click', () => {
            resetMobileSignSetup(true);
        });
    }

    if (mobileTrainSaveBtn) {
        mobileTrainSaveBtn.addEventListener('click', async () => {
            const currentStaticCount = getCurrentLabelStaticSampleCount();
            if (currentStaticCount < MAX_STATIC_SAMPLES_PER_SESSION) return;

            setTrainSaveButtonBusy(true);

            try {
                showProcessingModal("Training & Saving...", "Creating your local model for Live Translation and Video Call.");
                const trainingResult = await runInternalTraining();

                updateProcessingModal("Saving Model...", "Saving the trained model on this device...");
                const savedAnyModel = await saveTrainedModelsToLocalStorage();
                if (!savedAnyModel) {
                    throw new Error("No trained model was available to save.");
                }

                updateProcessingModal("Saving Samples...", "Syncing training metadata...");
                await saveToServer();

                hideProcessingModal();

                lastTrainSaveState = {
                    lang: currentLang,
                    label: normalizeLabel(labelInput.value),
                    sampleCount: getCurrentLabelStaticSampleCount()
                };

                updateMobileTrainSaveVisibility();

                const successMsg = trainingResult?.alreadyTrained
                    ? "Model already trained and saved for Live Translation & Video Call."
                    : "Model trained and saved for Live Translation & Video Call.";
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

    // Sign Card Image from Modal
    if (modalSignCardBtn) {
        modalSignCardBtn.addEventListener('click', () => {
            const label = modalLabelInput.value.trim();
            if (!label) {
                showCustomAlert("Please enter the details of the sign!");
                return;
            }
            // Trigger the hidden file input (re-using the main one)
            signCardInput.click();
        });
    }

    // Connect Mobile Action Buttons
    if (mobileUploadBtn) {
        mobileUploadBtn.addEventListener('click', async () => {
            if (collectedData.length === 0) {
                showToast("No data to upload!", "warning");
                return;
            }

            mobileUploadBtn.disabled = true;
            
            try {
                // 1. DATA PREP & LOCAL TRAINING (ON DEVICE)
                showProcessingModal("Training Locally...", "Your device is learning the signs from your recordings. Please keep the app open.");
                
                const trainingResult = await runInternalTraining();

                updateProcessingModal("Saving On Device...", "Saving the trained model on this device for Live Translation.");
                const savedAnyModel = await saveTrainedModelsToLocalStorage();
                if (!savedAnyModel) {
                    throw new Error("Training finished, but no model was available to save.");
                }
                
                // 2. IMAGE SYNC
                updateProcessingModal("Uploading Details...", "Uploading sign cards and reference images...");
                await uploadAllPendingSignCards();

                // 3. LANDMARK SYNC
                updateProcessingModal("Syncing Data...", "Saving hand landmarks to the cloud database...");
                await saveToServer();
                
                // 4. CLOUD MODEL BACKUP
                updateProcessingModal("Cloud Backup...", "Saving the trained model to the cloud so it works on all devices.");
                await uploadTrainedModelsToCloud();

                hideProcessingModal();
                showToast('✅ On-device training & cloud sync complete!', 'auto_awesome');
                
            } catch (err) {
                console.error('Mobile process failed:', err);
                hideProcessingModal();
                showCustomAlert(`Encountered an issue: ${err.message || 'Check connection'}`);
            } finally {
                mobileUploadBtn.disabled = false;
            }
        });
    }

    async function uploadTrainedModelsToCloud() {
        if (!model) return;

        const buildModelJson = (artifacts, weightFileName) => ({
            modelTopology: artifacts.modelTopology,
            format: artifacts.format || 'layers-model',
            generatedBy: artifacts.generatedBy,
            convertedBy: artifacts.convertedBy,
            weightsManifest: [{
                paths: [weightFileName],
                weights: artifacts.weightSpecs || []
            }]
        });

        const uploadComponent = async (type, fileName, fileDataB64, contentType) => {
            const path = `${currentLang.toLowerCase()}/${type}/${fileName}`;
            
            // Convert base64 to Blob
            const byteCharacters = atob(fileDataB64);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const blob = new Blob([byteArray], { type: contentType });

            const { error: uploadErr } = await window.supabaseClient.storage
                .from('models')
                .upload(path, blob, { contentType, upsert: true });

            if (uploadErr) throw uploadErr;
        };

        // Static Model Backup
        if (model.static && model.staticLabels) {
            updateProcessingModal("Cloud Backup...", "Uploading Static Model components...");
            
            // 1. Export Labels
            const labelsJson = JSON.stringify(model.staticLabels);
            await uploadComponent('static', 'labels.json', btoa(labelsJson), 'application/json');

            // 2. Export Model (JSON and Binary)
            await model.static.save(tf.io.withSaveHandler(async (artifacts) => {
                // Upload model.json
                const modelJson = JSON.stringify(buildModelJson(artifacts, 'model.weights.bin'));
                await uploadComponent('static', 'model.json', btoa(modelJson), 'application/json');

                // Upload weights.bin
                const weightsBlob = new Blob([artifacts.weightData], {type: 'application/octet-stream'});
                const reader = new FileReader();
                const weightsB64 = await new Promise(resolve => {
                    reader.onloadend = () => resolve(reader.result.split(',')[1]);
                    reader.readAsDataURL(weightsBlob);
                });
                await uploadComponent('static', 'model.weights.bin', weightsB64, 'application/octet-stream');
                
                return {modelArtifactsInfo: {dateSaved: new Date(), modelTopologyType: 'JSON'}};
            }));
        }

        // Dynamic Model Backup
        if (model.dynamic && model.dynamicLabels) {
            updateProcessingModal("Cloud Backup...", "Uploading Dynamic Model components...");
            
            // 1. Labels
            await uploadComponent('dynamic', 'labels.json', btoa(JSON.stringify(model.dynamicLabels)), 'application/json');
            
            // 2. Hand Reqs
            const handReqs = model.dynamicHandRequirements || {};
            await uploadComponent('dynamic', 'hand_reqs.json', btoa(JSON.stringify(handReqs)), 'application/json');

            // 3. Model Files
            await model.dynamic.save(tf.io.withSaveHandler(async (artifacts) => {
                const modelJson = JSON.stringify(buildModelJson(artifacts, 'model.weights.bin'));
                await uploadComponent('dynamic', 'model.json', btoa(modelJson), 'application/json');

                const weightsB64 = await new Promise(resolve => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result.split(',')[1]);
                    reader.readAsDataURL(new Blob([artifacts.weightData]));
                });
                await uploadComponent('dynamic', 'model.weights.bin', weightsB64, 'application/octet-stream');
                return {modelArtifactsInfo: {dateSaved: new Date()}};
            }));
        }
    }


    // Mobile Revert button
    if (mobileRevertBtn) {
        mobileRevertBtn.addEventListener('click', () => {
            if (sessionHistory.length > 0) {
                const count = sessionHistory.pop();
                if (collectedData.length >= count) {
                    // Ensure we only revert samples of the current label to be safe
                    const label = labelInput.value.trim();
                    const lastSamples = collectedData.slice(-count);
                    const allMatch = lastSamples.every(s => s.label === label);
                    
                    if (allMatch) {
                        collectedData.splice(-count);
                        showToast(`${count} samples reverted`, 'undo');
                        updateUIStats();
                        renderDataList();
                        updateMobileRevertState();
                        
                        // If no samples left for this setup, disable Finish
                        const currentSamples = collectedData.filter(d => d.label === label);
                        if (currentSamples.length === 0 && mobileAddSignBtn) {
                            mobileAddSignBtn.disabled = true;
                        }
                    }
                }
            }
        });
    }
}

function resetMobileSignSetup(discard = false) {
    if (!mobileAddSignBtn) return;
    
    // Clear inputs
    labelInput.value = '';
    modalLabelInput.value = '';
    signCardInput.value = '';
    
    isInSetupMode = false;
    pendingSignCard = null;
    lastRecordedBatchCount = 0;
    sessionHistory = [];

    // Reset UI
    mobileAddSignBtn.style.width = '64px';
    mobileAddSignBtn.style.height = '64px';
    mobileAddSignBtn.style.padding = '0';
    mobileAddSignBtn.title = 'Add New Sign';
    mobileAddSignBtn.innerHTML = '<span class="material-icons" style="font-size: 38px;">add_circle</span>';
    mobileAddSignBtn.dataset.setup = 'false';
    mobileAddSignBtn.disabled = false;
    mobileClearSignBtn.style.display = 'none';
    setMobileBottomBarMode('idle');
    setTrainSaveButtonBusy(false);

    // Reset status
    updateMobileStatusTags();

    if (discard) {
        // Discard any untrained samples recorded during this setup session
        collectedData = collectedData.filter(d => d.isTrained !== false);
    }
    renderDataList();
    
    // Reset Modal internal state
    const firstStep = document.querySelector('.modal-step[data-step="1"]');
    if (firstStep) {
        modalSteps.forEach(s => s.classList.remove('active'));
        firstStep.classList.add('active');
    }
    const modalStatus = document.getElementById('modalSignCardStatus');
    if (modalStatus) modalStatus.textContent = '';

    if (signCardFileName) {
        signCardFileName.textContent = '';
        signCardFileName.style.display = 'none';
    }
}

/**
 * Updates the small tags shown in the mobile bottom bar
 */
function updateMobileStatusTags() {
    if (mobileLabelDisplay) {
        mobileLabelDisplay.textContent = labelInput.value || 'New Sign';
    }
    if (mobileModeDisplay) {
        mobileModeDisplay.textContent = recordingMode === 'static' ? 'Static Mode' : 'Dynamic Mode';
    }
    updateMobileRevertState();
}

function updateMobileRevertState() {
    if (!mobileRevertBtn) return;
    mobileRevertBtn.style.display = 'flex';
    mobileRevertBtn.disabled = sessionHistory.length === 0;
    mobileRevertBtn.innerHTML = `<span class="material-icons" style="font-size: 14px;">undo</span>`;
}

function updateRevertButtonState() {
    updateMobileRevertState();
}

function updateMobileRecordingCounter(current = 0, total = MAX_STATIC_SAMPLES_PER_SESSION) {
    if (!mobileRecordingCounter) return;
    mobileRecordingCounter.textContent = `${current}/${total}`;
}

function getCurrentLabelStaticSampleCount() {
    const currentLabel = normalizeLabel(labelInput.value);
    if (!currentLabel) return 0;
    return collectedData.filter(sample => isStaticSample(sample) && normalizeLabel(sample.label) === currentLabel).length;
}

function setTrainSaveButtonBusy(isBusy) {
    if (!mobileTrainSaveBtn) return;
    mobileTrainSaveBtn.disabled = isBusy;
    mobileTrainSaveBtn.innerHTML = isBusy
        ? '<span class="material-icons" style="font-size: 22px;">sync</span><span>Training...</span>'
        : '<span class="material-icons" style="font-size: 22px;">task_alt</span><span>Train &amp; Save</span>';
}

function updateMobileTrainSaveVisibility() {
    if (!mobileTrainSaveBtn) return;

    const currentLabel = normalizeLabel(labelInput.value);
    const currentStaticCount = getCurrentLabelStaticSampleCount();
    const alreadySaved =
        lastTrainSaveState.lang === currentLang &&
        lastTrainSaveState.label === currentLabel &&
        lastTrainSaveState.sampleCount >= currentStaticCount &&
        currentStaticCount >= MAX_STATIC_SAMPLES_PER_SESSION;

    const shouldShow =
        isInSetupMode &&
        recordingMode === 'static' &&
        currentStaticCount >= MAX_STATIC_SAMPLES_PER_SESSION;

    mobileTrainSaveBtn.style.display = shouldShow ? 'inline-flex' : 'none';

    if (shouldShow) {
        if (alreadySaved) {
            mobileTrainSaveBtn.disabled = true;
            mobileTrainSaveBtn.innerHTML = '<span class="material-icons" style="font-size: 22px;">check_circle</span><span>Saved</span>';
        } else {
            setTrainSaveButtonBusy(false);
        }
    }
}

async function saveTrainedModelsToLocalStorage() {
    const keys = STORAGE_KEYS[currentLang];
    let savedAnyModel = false;

    if (model?.static && model.staticLabels) {
        await model.static.save(`localstorage://${keys.model}-static`);
        localStorage.setItem(`${keys.labels}-static`, JSON.stringify(model.staticLabels));
        savedAnyModel = true;
    }

    if (model?.dynamic && model.dynamicLabels) {
        await model.dynamic.save(`localstorage://${keys.model}-dynamic`);
        localStorage.setItem(`${keys.labels}-dynamic`, JSON.stringify(model.dynamicLabels));
        localStorage.setItem(`${keys.labels}-dynamic-hand-req`, JSON.stringify(model.dynamicHandRequirements || {}));
        savedAnyModel = true;
    }

    return savedAnyModel;
}

function setMobileBottomBarMode(mode) {
    const isRecordingMode = mode === 'recording';

    if (mobileAddButtonWrap) {
        mobileAddButtonWrap.style.display = isRecordingMode ? 'none' : 'inline-flex';
    }

    if (mobileRecordingActions) {
        mobileRecordingActions.style.display = isRecordingMode ? 'flex' : 'none';
    }

    if (captureBtn) {
        captureBtn.style.display = isRecordingMode ? 'flex' : 'none';
    }

    if (!isRecordingMode) {
        updateMobileRecordingCounter(0);
    }

    updateMobileTrainSaveVisibility();
}


async function uploadModelToCloud(type, modelInstance, labels, handReqs = null) {
    // 1. Save model to get artifacts
    const saveResults = await modelInstance.save(tf.io.withSaveHandler(async (artifacts) => {
        return artifacts;
    }));

    // 2. Upload Model Topology (JSON)
    const modelJson = {
        modelTopology: saveResults.modelTopology,
        weightsManifest: [{
            paths: ['./weights.bin'],
            weights: saveResults.weightSpecs
        }]
    };
    
    await uploadComponent(type, 'model.json', btoa(JSON.stringify(modelJson)), 'application/json');

    // 3. Upload Weights (Binary)
    const weightsB64 = arrayBufferToBase64(saveResults.weightData);
    await uploadComponent(type, 'weights.bin', weightsB64, 'application/octet-stream');

    // 4. Upload Labels
    await uploadComponent(type, 'labels.json', btoa(JSON.stringify(labels)), 'application/json');

    // 5. Upload Hand Reqs if dynamic
    if (handReqs) {
        await uploadComponent(type, 'hand_reqs.json', btoa(JSON.stringify(handReqs)), 'application/json');
    }
}

async function uploadComponent(type, fileName, b64Data, contentType) {
    const path = `${currentLang.toLowerCase()}/${type}/${fileName}`;
    
    // Convert base64 to Blob
    const byteCharacters = atob(b64Data);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: contentType });

    const { error: uploadErr } = await window.supabaseClient.storage
        .from('models')
        .upload(path, blob, { contentType, upsert: true });

    if (uploadErr) throw new Error(`Supabase upload error: ${uploadErr.message}`);
}

function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

// Check if models are already saved in localStorage
async function checkForSavedModels() {
    const staticLabels = localStorage.getItem(`${STORAGE_KEYS[currentLang].labels}-static`);
    const dynamicLabels = localStorage.getItem(`${STORAGE_KEYS[currentLang].labels}-dynamic`);

    if (staticLabels || dynamicLabels) {
        let modelInfo = "Saved models found: ";
        if (staticLabels) modelInfo += "Static ✋ ";
        if (dynamicLabels) modelInfo += "Dynamic 🔄";
        statusMsg.innerText = `✅ ${modelInfo}. You can use these in Live Translation!`;
        saveBtn.disabled = true; // Models already saved
        if (cloudSyncBtn) {
            cloudSyncBtn.disabled = false;
            cloudSyncBtn.title = "Upload these models to Supabase Cloud";
        }
    }
}

// Mode toggle setup
function setupModeToggle() {
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
        captureBtn.style.display = isInSetupMode ? 'flex' : 'none';
        captureHint.style.display = 'block';
        dynamicControls.style.display = 'none';
        modeDescription.textContent = 'Static: Single pose signs (A, B, Hello, etc.)';
    } else {
        captureBtn.style.display = 'none';
        captureHint.style.display = 'none';
        dynamicControls.style.display = 'block';
        modeDescription.textContent = 'Dynamic: Movement signs (Thank You, Please, Sorry, etc.)';
    }

    updateMobileStatusTags();
}

// Update mobile tags when label changes
labelInput.addEventListener('input', updateMobileStatusTags);



function startDynamicRecording() {
    const label = normalizeLabel(labelInput.value);
    if (!label) {
        showCustomAlert("Please enter the details of the sign!");
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
    await loadDataFromServer();
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

    } else if (isCollecting && recordingMode === 'static') {
        if (!isStaticPausedNoHands) {
            isStaticPausedNoHands = true;
            statusMsg.textContent = `Paused: no hands detected (${staticSessionSampleCount}/${MAX_STATIC_SAMPLES_PER_SESSION})`;
        }
        // No hands detected
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
    lastRecordedBatchCount += 1;
    statusMsg.textContent = `Recording static sign: ${staticSessionSampleCount}/${MAX_STATIC_SAMPLES_PER_SESSION}`;
    updateMobileRecordingCounter(staticSessionSampleCount);
    updateMobileTrainSaveVisibility();

    if (staticSessionSampleCount >= MAX_STATIC_SAMPLES_PER_SESSION) {
        stopStaticCollection('Auto-stopped at 100 samples.');
        return false;
    }

    return true;
}

function startStaticCollection() {
    const label = normalizeLabel(labelInput.value);
    if (!label) {
        showCustomAlert("Please enter the details of the sign!");
        labelInput.focus();
        return;
    }
    labelInput.value = label;

    isCollecting = true;
    staticSessionSampleCount = 0;
    lastRecordedBatchCount = 0; // Start new batch tracking
    isStaticPausedNoHands = false;

    recIndicator.style.display = 'flex';
    captureBtn.classList.add('active');
    statusMsg.textContent = `Recording static sign: 0/${MAX_STATIC_SAMPLES_PER_SESSION}`;
    updateMobileRecordingCounter(0);
    updateMobileTrainSaveVisibility();
}

function stopStaticCollection(reason = 'Recording stopped.') {
    if (!isCollecting) return;

    isCollecting = false;
    isStaticPausedNoHands = false;

    const recordedCount = staticSessionSampleCount;
    staticSessionSampleCount = 0;

    recIndicator.style.display = 'none';
    captureBtn.classList.remove('active');
    updateMobileRecordingCounter(0);

    const suffix = recordedCount > 0 ? ` Saved ${recordedCount} samples.` : ' No new samples captured.';
    statusMsg.textContent = `${reason}${suffix}`;

    // Auto-save ONLY if not in a mobile setup session
    if (!isInSetupMode) {
        saveToServer().then(() => {
            renderDataList();
        }).catch((err) => {
            console.error('Failed to auto-save static session:', err);
        });
    } else {
        // Just refresh the list and enable Finish button if we have ANY data now
        renderDataList();
        if (recordedCount > 0) {
            sessionHistory.push(recordedCount);
            lastRecordedBatchCount = 0;
        }
        if (recordedCount > 0 && mobileAddSignBtn && mobileAddSignBtn.dataset.setup === 'true') {
            mobileAddSignBtn.disabled = false;
        }
        updateMobileRevertState();
        updateMobileTrainSaveVisibility();
    }
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
    sessionHistory.push(1); // Dynamic is 1 sample per session
    updateUIStats();
    
    // Auto-save ONLY if not in a mobile setup session
    if (!isInSetupMode) {
        await saveToServer();
        renderDataList();
        // Reset mobile setup button after recording
        if (window.innerWidth <= 980) {
            resetMobileSignSetup();
        }
    } else {
        renderDataList();
        if (mobileAddSignBtn && mobileAddSignBtn.dataset.setup === 'true') {
            mobileAddSignBtn.disabled = false;
        }
        updateMobileRevertState();
    }
}

// --- Data Management ---
async function loadDataFromServer() {
    try {
        const { data, error } = await window.supabaseClient
            .from('training_data')
            .select('*')
            .order('id', { ascending: true });

        if (error) throw error;

        // Group by lang
        const allData = { ISL: [], ASL: [] };
        for (const row of data) {
            const sample = {
                label: row.label,
                type: row.type,
                isTrained: row.is_trained,
                recordedAt: row.recorded_at,
                trainedAt: row.trained_at,
            };
            if (row.type === 'dynamic') {
                sample.frames = row.frames;
                sample.handCount = row.hand_count;
                sample.frameCount = row.frames ? row.frames.length : 0;
            } else {
                sample.landmarks = row.landmarks;
            }
            if (!allData[row.lang]) allData[row.lang] = [];
            allData[row.lang].push(sample);
        }

        const loadedData = allData[currentLang] || [];
        const normalizedData = normalizeDatasetLabels(loadedData);
        collectedData = normalizedData.normalized;

        if (normalizedData.changed) {
            await saveToServer();
        }
    } catch (err) {
        console.error('Failed to load training data from Supabase:', err);
        collectedData = [];
    } finally {
        renderDataList();
    }
}

async function saveToServer() {
    try {
        const lang = currentLang;
        const samples = collectedData || [];

        // Delete existing rows for this language
        const { error: deleteErr } = await window.supabaseClient
            .from('training_data')
            .delete()
            .eq('lang', lang);

        if (deleteErr) throw deleteErr;

        if (samples.length === 0) return;

        // Insert in batches of 500
        const BATCH = 500;
        for (let i = 0; i < samples.length; i += BATCH) {
            const batch = samples.slice(i, i + BATCH).map(s => ({
                lang,
                label: s.label,
                type: s.type || 'static',
                landmarks: s.landmarks || null,
                frames: s.frames || null,
                hand_count: s.handCount || null,
                is_trained: s.isTrained !== undefined ? s.isTrained : false,
                recorded_at: s.recordedAt || null,
                trained_at: s.trainedAt || null
            }));

            const { error: insertErr } = await window.supabaseClient
                .from('training_data')
                .insert(batch);

            if (insertErr) throw insertErr;
        }
    } catch (err) {
        console.error('Failed to save training data to Supabase:', err);
    }
}

function updateUIStats() {
    totalSamplesBadge.innerText = collectedData.length;
    updateMobileRevertState();
    updateMobileTrainSaveVisibility();
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

    // Always update total counts even if list is empty
    totalSamplesBadge.innerText = collectedData.length;
    
    // Sync mobile upload button state (disabled if there is no data)
    if (typeof mobileUploadBtn !== 'undefined' && mobileUploadBtn) {
        mobileUploadBtn.disabled = collectedData.length === 0;
    }

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
}

window.deleteLabel = async (label) => {
    const confirmed = await showCustomConfirm(`Delete all samples for "${label}"?`);
    if (confirmed) {
        // 1. Delete sign card from local storage
        const cardKey = `sign_card_${currentLang}_${label}`;
        localStorage.removeItem(cardKey);

        // 2. Filter data and update local training set
        collectedData = collectedData.filter(d => d.label !== label);
        
        const keys = STORAGE_KEYS[currentLang];
        localStorage.setItem(keys.data, JSON.stringify(collectedData));
        
        renderDataList();
        showToast(`Deleted "${label}" from local storage`, 'delete');
    }
};

clearAllBtn.addEventListener('click', async () => {
    const confirmed = await showCustomConfirm("Delete ALL collected data locally? This cannot be undone.");
    if (confirmed) {
        const keys = STORAGE_KEYS[currentLang];
        
        // 1. Clear training data from localStorage
        localStorage.removeItem(keys.data);
        
        // 2. Clear known sign cards (Best effort based on current list)
        const currentLabels = [...new Set(collectedData.map(d => d.label))];
        currentLabels.forEach(label => {
            localStorage.removeItem(`sign_card_${currentLang}_${label}`);
        });

        collectedData = [];
        renderDataList();
        showToast(`All ${currentLang} data cleared locally`, 'delete_forever');
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
        let savedStaticLabels = localStorage.getItem(`${STORAGE_KEYS[currentLang].labels}-static`);
        let localModelKey = `localstorage://${STORAGE_KEYS[currentLang].model}-static`;

        if (!savedStaticLabels) {
            console.log("Local static labels missing. Checking cloud for incremental base...");
            const cloudData = await fetchCloudModel('static', currentLang);
            if (cloudData) {
                model.static = cloudData.model;
                model.staticLabels = cloudData.labels;
                ensureModelCompiled(model.static, 'static model');
                console.log("Loaded static base from cloud.");
                return;
            }
        }

        if (savedStaticLabels) {
            try {
                model.static = await tf.loadLayersModel(localModelKey);
                model.staticLabels = JSON.parse(savedStaticLabels);
                ensureModelCompiled(model.static, 'static model');
            } catch (err) {
                console.warn('Unable to load saved static model from LocalStorage. Checking cloud...');
                const cloudData = await fetchCloudModel('static', currentLang);
                if (cloudData) {
                    model.static = cloudData.model;
                    model.staticLabels = cloudData.labels;
                    ensureModelCompiled(model.static, 'static model');
                }
            }
        }
    }

    if (!model.dynamic) {
        let savedDynamicLabels = localStorage.getItem(`${STORAGE_KEYS[currentLang].labels}-dynamic`);
        
        if (!savedDynamicLabels) {
            console.log("Local dynamic labels missing. Checking cloud for incremental base...");
            const cloudData = await fetchCloudModel('dynamic', currentLang);
            if (cloudData) {
                model.dynamic = cloudData.model;
                model.dynamicLabels = cloudData.labels;
                model.dynamicHandRequirements = cloudData.handReqs || {};
                ensureModelCompiled(model.dynamic, 'dynamic model');
                console.log("Loaded dynamic base from cloud.");
                return;
            }
        }

        if (savedDynamicLabels) {
            try {
                model.dynamic = await tf.loadLayersModel(`localstorage://${STORAGE_KEYS[currentLang].model}-dynamic`);
                model.dynamicLabels = JSON.parse(savedDynamicLabels);
                const handReqRaw = localStorage.getItem(`${STORAGE_KEYS[currentLang].labels}-dynamic-hand-req`);
                model.dynamicHandRequirements = handReqRaw ? JSON.parse(handReqRaw) : {};
                ensureModelCompiled(model.dynamic, 'dynamic model');
            } catch (err) {
                console.warn('Unable to load saved dynamic model from LocalStorage. Checking cloud...');
                const cloudData = await fetchCloudModel('dynamic', currentLang);
                if (cloudData) {
                    model.dynamic = cloudData.model;
                    model.dynamicLabels = cloudData.labels;
                    model.dynamicHandRequirements = cloudData.handReqs || {};
                    ensureModelCompiled(model.dynamic, 'dynamic model');
                }
            }
        }
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
        const labels = normalizeLabelList(await labelsRes.json()).normalized;
        
        // 3. Load Model
        const cloudModel = await tf.loadLayersModel(modelUrlData.publicUrl);
        
        let handReqs = null;
        if (type === 'dynamic') {
            const { data: handReqsUrlData } = window.supabaseClient.storage
                .from('models')
                .getPublicUrl(`${langLower}/${type}/hand_reqs.json`);
            const reqRes = await fetch(handReqsUrlData.publicUrl);
            if (reqRes.ok) {
                handReqs = normalizeHandRequirementMap(await reqRes.json()).normalized;
            }
        }
        
        return { model: cloudModel, labels, handReqs };
    } catch (err) {
        console.warn(`Cloud model fetch failed for ${type}:`, err);
        return null;
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

async function runInternalTraining() {
    try {
        await ensureTrainingModelsLoaded();

        const staticData = collectedData.filter(isStaticSample);
        const dynamicData = collectedData.filter(isDynamicSample);

        const legacyFlagsChanged = normalizeLegacySamplesAsTrained(Boolean(model?.static), Boolean(model?.dynamic));

        const newStaticData = staticData.filter(d => d.isTrained === false);
        const newDynamicData = dynamicData.filter(d => d.isTrained === false);

        if (!model.static && !model.dynamic && (staticData.length + dynamicData.length) < 10) {
            throw new Error("Collect more data (min 10 samples) before training.");
        }

        if (newStaticData.length === 0 && newDynamicData.length === 0 && (model.static || model.dynamic)) {
            if (legacyFlagsChanged) await saveToServer();
            return { alreadyTrained: true };
        }

        let trainedAnything = false;
        let flagsChanged = legacyFlagsChanged;

        if (newStaticData.length > 0 || (!model.static && staticData.length >= 5)) {
            await new Promise(resolve => setTimeout(resolve, 100));
            updateProcessingModal("Training Static AI...", "Your device is learning hand shapes...");
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
            updateProcessingModal("Training Dynamic AI...", "Your device is learning motion patterns...");
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
            throw new Error("Not enough new samples to train. Need at least 5 new samples.");
        }

        if (flagsChanged) await saveToServer();

        const modelTypes = [];
        if (model.static) modelTypes.push("Static ✋");
        if (model.dynamic) modelTypes.push("Dynamic 🔄");

        return { 
            trained: true, 
            types: modelTypes,
            flagsChanged: flagsChanged
        };
    } catch (error) {
        throw error;
    }
}

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
                    const { data: cardData } = await window.supabaseClient
                        .from('sign_cards')
                        .select('extension')
                        .eq('lang', currentLang.toLowerCase())
                        .eq('label', label)
                        .single();

                    if (cardData) {
                        const filePath = `${currentLang.toLowerCase()}/${label}.${cardData.extension}`;
                        await window.supabaseClient.storage.from('sign-cards').remove([filePath]);
                    }
                    await window.supabaseClient.from('sign_cards').delete().eq('lang', currentLang.toLowerCase()).eq('label', label);
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
                // BUFFER instead of upload if modal Is open
                const isModalOpen = signSetupModal && signSetupModal.classList.contains('active');
                if (isModalOpen) {
                    pendingSignCard = { base64Data, extension };
                    signCardStatus.textContent = `✅ Card selected (Finish Setup to upload)`;
                    signCardStatus.style.color = '#58a6ff';
                    const modalStatus = document.getElementById('modalSignCardStatus');
                    if (modalStatus) {
                        modalStatus.textContent = `✅ Image attached`;
                        modalStatus.style.color = '#58a6ff';
                    }
                    return;
                }

                // Convert base64 to Blob
                const base64Response = await fetch(base64Data);
                const blob = await base64Response.blob();
                
                const filePath = `${currentLang.toLowerCase()}/${label}.${extension}`;
                const { error: uploadErr } = await window.supabaseClient.storage
                    .from('sign-cards')
                    .upload(filePath, blob, { contentType: blob.type, upsert: true });
                
                if (uploadErr) throw uploadErr;

                const { data: urlData } = window.supabaseClient.storage
                    .from('sign-cards')
                    .getPublicUrl(filePath);

                const { error: upsertErr } = await window.supabaseClient
                    .from('sign_cards')
                    .upsert({ lang: currentLang.toLowerCase(), label: label, url: urlData.publicUrl, extension, updated_at: new Date().toISOString() }, { onConflict: 'lang,label' });

                if (upsertErr) throw upsertErr;

                if (true) {
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
