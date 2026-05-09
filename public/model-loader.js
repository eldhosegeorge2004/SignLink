/**
 * model-loader.js
 * Builds and returns TF.js sign-language models trained exclusively from
 * the local /training_data.json file.  No localStorage, no Supabase,
 * no external cloud services are used.
 */

const MAX_DYNAMIC_FRAMES_ML = 30;
const DUMMY_LABEL_PREFIX_ML = '__internal_dummy__';

// ── helpers ─────────────────────────────────────────────────────────────────

function _normalizeLabel(label) {
    if (typeof label !== 'string') return label;
    return /^[a-zA-Z]$/.test(label) ? label.toUpperCase() : label;
}

function _getUniqueLabels(samples) {
    return [...new Set(samples.map(s => _normalizeLabel(s.label)))];
}

function _shuffleArray(arr) {
    const out = [...arr];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

function _withDummyClass(samples, labels) {
    if (labels.length >= 2) return { trainingData: samples, trainingLabels: labels };
    const dummyLabel = `${DUMMY_LABEL_PREFIX_ML}_${labels[0]}`;
    const dummyCount = Math.max(1, Math.ceil(samples.length * 0.2));
    const dummySamples = samples.slice(0, dummyCount).map(s => ({ ...s, label: dummyLabel }));
    return {
        trainingData: [...samples, ...dummySamples],
        trainingLabels: [labels[0], dummyLabel]
    };
}

function _toPublicLabels(labels) {
    return labels.filter(l => !l.startsWith(DUMMY_LABEL_PREFIX_ML));
}

function _computeHandReqs(trainingData, labels) {
    const map = {};
    labels.forEach(label => {
        if (label.startsWith(DUMMY_LABEL_PREFIX_ML)) { map[label] = 'any'; return; }
        const labelSamples = trainingData.filter(d => _normalizeLabel(d.label) === label);
        const observed = new Set(
            labelSamples
                .map(d => {
                    const raw = Number(d.handCount ?? d.requiredHands);
                    return raw === 2 ? 2 : (raw === 1 ? 1 : null);
                })
                .filter(v => v !== null)
        );
        map[label] = observed.size === 1 ? [...observed][0] : 'any';
    });
    return map;
}

function _padFeatures(features) {
    if (!Array.isArray(features)) return features;
    if (features.length === 63) {
        return [...features, ...new Array(63).fill(0)];
    }
    return features;
}

// ── model factories ──────────────────────────────────────────────────────────

function _createStaticModel(outputUnits) {
    const m = tf.sequential();
    m.add(tf.layers.dense({ units: 64, activation: 'relu', inputShape: [126] }));
    m.add(tf.layers.dropout({ rate: 0.2 }));
    m.add(tf.layers.dense({ units: 32, activation: 'relu' }));
    m.add(tf.layers.dense({ units: outputUnits, activation: 'softmax' }));
    m.compile({ optimizer: 'adam', loss: 'categoricalCrossentropy', metrics: ['accuracy'] });
    return m;
}

function _createDynamicModel(outputUnits) {
    const m = tf.sequential();
    m.add(tf.layers.lstm({
        units: 64,
        returnSequences: true,
        inputShape: [MAX_DYNAMIC_FRAMES_ML, 126],
        kernelInitializer: 'glorotUniform',
        recurrentInitializer: 'glorotUniform'
    }));
    m.add(tf.layers.dropout({ rate: 0.2 }));
    m.add(tf.layers.lstm({
        units: 32,
        returnSequences: false,
        kernelInitializer: 'glorotUniform',
        recurrentInitializer: 'glorotUniform'
    }));
    m.add(tf.layers.dense({ units: outputUnits, activation: 'softmax' }));
    m.compile({ optimizer: 'adam', loss: 'categoricalCrossentropy', metrics: ['accuracy'] });
    return m;
}

// ── core training helpers ────────────────────────────────────────────────────

async function _trainStaticFromScratch(staticSamples) {
    if (staticSamples.length < 5) return null;

    const baseLabels = _getUniqueLabels(staticSamples);
    const prepared   = _withDummyClass(staticSamples, baseLabels);
    const { trainingData, trainingLabels } = prepared;

    const handReqs = _computeHandReqs(trainingData, trainingLabels);
    const labelMap = {};
    trainingLabels.forEach((lbl, idx) => { labelMap[lbl] = idx; });

    const xs = tf.tensor2d(trainingData.map(d => _padFeatures(d.landmarks)));
    const ys = tf.oneHot(
        tf.tensor1d(trainingData.map(d => labelMap[_normalizeLabel(d.label)]), 'int32'),
        trainingLabels.length
    );
    const staticModel = _createStaticModel(trainingLabels.length);

    try {
        await staticModel.fit(xs, ys, {
            epochs: 30,
            batchSize: 16,
            shuffle: true,
            verbose: 0,
            callbacks: {
                onEpochEnd: async (epoch) => {
                    if (epoch % 5 === 0) await tf.nextFrame();
                }
            }
        });

        const publicHandReqs = Object.fromEntries(
            Object.entries(handReqs).filter(([lbl]) => !lbl.startsWith(DUMMY_LABEL_PREFIX_ML))
        );

        return { 
            model: staticModel, 
            labels: _toPublicLabels(trainingLabels),
            handReqs: publicHandReqs
        };
    } finally {
        xs.dispose();
        ys.dispose();
    }
}

async function _trainDynamicFromScratch(dynamicSamples) {
    if (dynamicSamples.length < 5) return null;

    const baseLabels = _getUniqueLabels(dynamicSamples);
    const prepared   = _withDummyClass(dynamicSamples, baseLabels);
    const { trainingData, trainingLabels } = prepared;

    const labelMap = {};
    trainingLabels.forEach((lbl, idx) => { labelMap[lbl] = idx; });

    const handReqs = _computeHandReqs(trainingData, trainingLabels);

    const paddedSequences = trainingData.map(d => {
        const frames = (d.frames || []).map(f => _padFeatures(f));
        if (frames.length < MAX_DYNAMIC_FRAMES_ML) {
            const lastFrame = frames[frames.length - 1] || new Array(126).fill(0);
            return [...frames, ...Array(MAX_DYNAMIC_FRAMES_ML - frames.length).fill(lastFrame)];
        }
        return frames.slice(0, MAX_DYNAMIC_FRAMES_ML);
    });

    const xs = tf.tensor3d(paddedSequences);
    const ys = tf.oneHot(
        tf.tensor1d(trainingData.map(d => labelMap[_normalizeLabel(d.label)]), 'int32'),
        trainingLabels.length
    );
    const dynamicModel = _createDynamicModel(trainingLabels.length);

    try {
        await dynamicModel.fit(xs, ys, {
            epochs: 20,
            batchSize: 8,
            shuffle: true,
            verbose: 0,
            callbacks: {
                onEpochEnd: async (epoch) => {
                    if (epoch % 5 === 0) await tf.nextFrame();
                }
            }
        });

        const publicHandReqs = Object.fromEntries(
            Object.entries(handReqs).filter(([lbl]) => !lbl.startsWith(DUMMY_LABEL_PREFIX_ML))
        );

        return {
            model: dynamicModel,
            labels: _toPublicLabels(trainingLabels),
            handReqs: publicHandReqs
        };
    } finally {
        xs.dispose();
        ys.dispose();
    }
}

// ── public API ───────────────────────────────────────────────────────────────

/**
 * Fetches /training_data.json and trains static + dynamic models for the
 * given language ('ISL' or 'ASL').  No Supabase, no localStorage.
 *
 * @param {string} lang - 'ISL' or 'ASL'
 * @returns {Promise<{
 *   staticModel: tf.LayersModel|null,
 *   staticLabels: string[],
 *   dynamicModel: tf.LayersModel|null,
 *   dynamicLabels: string[],
 *   handReqs: Object
 * }>}
 */
window.loadModelsFromTrainingData = async function loadModelsFromTrainingData(lang = 'ISL') {
    const result = {
        staticModel: null,
        staticLabels: [],
        staticHandReqs: {},
        dynamicModel: null,
        dynamicLabels: [],
        dynamicHandReqs: {}
    };

    try {
        console.log(`[model-loader] Fetching training_data.json for ${lang}…`);
        const response = await fetch('/training_data.json');
        if (!response.ok) {
            console.error('[model-loader] Could not fetch training_data.json:', response.status);
            return result;
        }

        const json = await response.json();
        const allSamples = json[lang];

        if (!Array.isArray(allSamples) || allSamples.length === 0) {
            console.warn(`[model-loader] No samples found for language "${lang}" in training_data.json`);
            return result;
        }

        console.log(`[model-loader] Loaded ${allSamples.length} total samples for ${lang}.`);

        // Normalize labels
        const samples = allSamples.map(s => ({
            ...s,
            label: _normalizeLabel(s.label)
        }));

        const staticSamples  = samples.filter(s => s.type === 'static'  || !s.type);
        const dynamicSamples = samples.filter(s => s.type === 'dynamic');

        console.log(`[model-loader] Static: ${staticSamples.length} | Dynamic: ${dynamicSamples.length}`);

        // Train static model
        if (staticSamples.length >= 5) {
            console.log('[model-loader] Training static model…');
            try {
                const staticResult = await _trainStaticFromScratch(staticSamples);
                if (staticResult) {
                    result.staticModel  = staticResult.model;
                    result.staticLabels = staticResult.labels;
                    result.staticHandReqs = staticResult.handReqs;
                    console.log(`[model-loader] Static model ready. Labels (${staticResult.labels.length}):`, staticResult.labels);
                }
            } catch (err) {
                console.error('[model-loader] Static model training failed:', err);
            }
        } else {
            console.warn('[model-loader] Not enough static samples to train (need ≥5).');
        }

        // Train dynamic model
        if (dynamicSamples.length >= 5) {
            console.log('[model-loader] Training dynamic model…');
            try {
                const dynamicResult = await _trainDynamicFromScratch(dynamicSamples);
                if (dynamicResult) {
                    result.dynamicModel  = dynamicResult.model;
                    result.dynamicLabels = dynamicResult.labels;
                    result.dynamicHandReqs = dynamicResult.handReqs;
                    console.log(`[model-loader] Dynamic model ready. Labels (${dynamicResult.labels.length}):`, dynamicResult.labels);
                }
            } catch (err) {
                console.error('[model-loader] Dynamic model training failed:', err);
            }
        } else {
            console.warn('[model-loader] Not enough dynamic samples to train (need ≥5).');
        }
    } catch (err) {
        console.error('[model-loader] Fatal error loading training data:', err);
    }

    return result;
};
