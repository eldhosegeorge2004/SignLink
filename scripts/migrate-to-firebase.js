/**
 * migrate-to-firebase.js
 * ─────────────────────────────────────────────────────────
 * One-time script to migrate local sign data to Firebase.
 *
 * What it does:
 *  1. Uploads training_data.json landmark samples to Firestore
 *     Collection structure:
 *       training_data/{ISL|ASL}/signs/{label}/samples (subcollection)
 *         → each document: { label, landmarks, type, isTrained }
 *
 *  2. Uploads sign card images to Firebase Storage
 *     Storage structure:
 *       signs-images/isl/words/<label>.<ext>
 *       signs-images/isl/characters/<label>.<ext>
 *       signs-images/asl/characters/<label>.<ext>
 *
 * Usage:
 *   node scripts/migrate-to-firebase.js
 *
 * Requirements:
 *   npm install firebase-admin
 *   A service account key JSON file downloaded from Firebase Console
 *   → Firebase Console → Project Settings → Service accounts → Generate new private key
 *   Save it as: scripts/serviceAccountKey.json
 * ─────────────────────────────────────────────────────────
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// ── CONFIG ──────────────────────────────────────────────
const SERVICE_ACCOUNT_PATH = path.join(__dirname, 'serviceAccountKey.json');
const TRAINING_DATA_FILE = path.join(__dirname, '..', 'public', 'training_data.json');
const SIGNS_IMAGES_DIR = path.join(__dirname, '..', 'public', 'signs-images');
const STORAGE_BUCKET = 'signlink-3cee9.appspot.com';

// Set to ['ISL'] to skip ISL and only upload ASL (useful after a partial run)
const SKIP_LANGS = ['ISL'];

// Firestore batch size limit is 500. We use 400 to be safe.
const BATCH_SIZE = 400;
// ────────────────────────────────────────────────────────

// ── INIT FIREBASE ADMIN ──────────────────────────────────
if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    console.error('❌ serviceAccountKey.json not found!');
    console.error('   Download it from Firebase Console → Project Settings → Service Accounts');
    console.error(`   Save it to: ${SERVICE_ACCOUNT_PATH}`);
    process.exit(1);
}

const serviceAccount = require(SERVICE_ACCOUNT_PATH);
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: STORAGE_BUCKET,
});

const db = admin.firestore();
// Ignore undefined fields so bad samples don't crash the batch
db.settings({ ignoreUndefinedProperties: true });
const bucket = admin.storage().bucket();
// ────────────────────────────────────────────────────────

/**
 * Upload all training landmark samples to Firestore.
 *
 * Structure in Firestore:
 *   training_data (collection)
 *     └── ISL (document)
 *           └── signs (subcollection)
 *                 └── {label} (document)
 *                       └── samples (subcollection)
 *                             └── {auto-id} (document)  ← one per recorded sample
 *                                   { label, landmarks, type, isTrained }
 */
async function uploadTrainingData() {
    console.log('\n📂 Loading training_data.json...');
    const raw = fs.readFileSync(TRAINING_DATA_FILE, 'utf8');
    const data = JSON.parse(raw); // { ISL: [...], ASL: [...] }

    for (const lang of Object.keys(data)) {
        const samples = data[lang];
        if (!Array.isArray(samples) || samples.length === 0) {
            console.log(`⚠️  No samples found for ${lang}, skipping.`);
            continue;
        }

        if (SKIP_LANGS.includes(lang)) {
            console.log(`⏭️  Skipping ${lang} (already uploaded).`);
            continue;
        }

        console.log(`\n📤 Uploading ${samples.length} ${lang} samples to Firestore...`);

        // Group samples by label so we can write them under a per-label document
        const byLabel = {};
        for (const sample of samples) {
            if (!byLabel[sample.label]) byLabel[sample.label] = [];
            byLabel[sample.label].push(sample);
        }

        const labels = Object.keys(byLabel);
        console.log(`   Labels found (${labels.length}): ${labels.join(', ')}`);

        // Write in batches to respect Firestore's 500-write limit per batch
        let batchCount = 0;
        let batch = db.batch();
        let writesInBatch = 0;

        for (const label of labels) {
            for (const sample of byLabel[label]) {
                // Skip samples with missing or invalid landmarks
                if (!Array.isArray(sample.landmarks) || sample.landmarks.length === 0) {
                    console.warn(`   ⚠️  Skipping sample for label "${label}" — missing landmarks.`);
                    continue;
                }

                // Path: training_data/{lang}/signs/{label}/samples/{auto-id}
                const ref = db
                    .collection('training_data')
                    .doc(lang)
                    .collection('signs')
                    .doc(label)
                    .collection('samples')
                    .doc(); // auto-generated ID

                batch.set(ref, {
                    label: sample.label,
                    landmarks: sample.landmarks,
                    type: sample.type || 'static',
                    isTrained: sample.isTrained !== undefined ? sample.isTrained : true,
                });

                writesInBatch++;

                if (writesInBatch >= BATCH_SIZE) {
                    await batch.commit();
                    batchCount++;
                    console.log(`   ✅ Committed batch #${batchCount} (${writesInBatch} writes)`);
                    batch = db.batch();
                    writesInBatch = 0;
                }
            }
        }

        // Commit remaining writes
        if (writesInBatch > 0) {
            await batch.commit();
            batchCount++;
            console.log(`   ✅ Committed final batch #${batchCount} (${writesInBatch} writes)`);
        }

        console.log(`✅ ${lang} training data upload complete! Total batches: ${batchCount}`);
    }
}

/**
 * Upload all sign card images to Firebase Storage.
 * Walks the signs-images/ directory recursively and uploads each image.
 *
 * Local path:  public/signs-images/isl/words/hello.png
 * Storage path: signs-images/isl/words/hello.png
 */
async function uploadSignCards() {
    console.log('\n🖼️  Uploading sign card images to Firebase Storage...');

    const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);
    let totalUploaded = 0;
    let totalSkipped = 0;

    function walkDir(dir) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walkDir(fullPath);
            } else if (entry.isFile()) {
                const ext = path.extname(entry.name).toLowerCase();
                if (!imageExtensions.has(ext)) {
                    totalSkipped++;
                    return;
                }

                // Build the Firebase Storage destination path
                // e.g. public/signs-images/isl/words/hello.png → signs-images/isl/words/hello.png
                const relativePath = path.relative(
                    path.join(__dirname, '..', 'public'),
                    fullPath
                ).replace(/\\/g, '/'); // normalise to forward slashes for Storage

                uploadQueue.push({ fullPath, relativePath });
            }
        }
    }

    const uploadQueue = [];
    walkDir(SIGNS_IMAGES_DIR);

    console.log(`   Found ${uploadQueue.length} image(s) to upload.`);

    for (const { fullPath, relativePath } of uploadQueue) {
        try {
            await bucket.upload(fullPath, {
                destination: relativePath,
                metadata: {
                    cacheControl: 'public, max-age=31536000',
                },
            });
            console.log(`   ✅ Uploaded: ${relativePath}`);
            totalUploaded++;
        } catch (err) {
            console.error(`   ❌ Failed to upload ${relativePath}: ${err.message}`);
        }
    }

    console.log(`\n✅ Image upload complete. Uploaded: ${totalUploaded}, Skipped (non-image): ${totalSkipped}`);
}

// ── MAIN ─────────────────────────────────────────────────
async function main() {
    console.log('🚀 SignLink Firebase Migration Script');
    console.log('=====================================');

    try {
        await uploadTrainingData();
        await uploadSignCards();
        console.log('\n🎉 Migration complete! All data is now in Firebase.');
    } catch (err) {
        console.error('\n❌ Migration failed:', err);
        process.exit(1);
    } finally {
        process.exit(0);
    }
}

main();
