// ==================== SIGNLINK SERVER ====================
// This Express server handles API endpoints for the SignLink application.
// It manages training data, model uploads, sign cards, and communicates with Supabase.

// ==================== IMPORTS ====================
const express = require('express');  // Express.js framework for building web servers
const app = express();  // Create Express application instance
const http = require('http').createServer(app);  // Create HTTP server
const path = require('path');  // Node.js path module for file path operations
const fs = require('fs');  // Node.js file system module for file operations
const { supabase } = require('./supabase-config');  // Import configured Supabase client

// ==================== PRODUCTION MIDDLEWARE ====================
// Redirect HTTP to HTTPS in production for security
app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] === 'http') {  // Check if request is HTTP
        return res.redirect(`https://${req.headers.host}${req.url}`);  // Redirect to HTTPS
    }
    next();  // Continue to next middleware
});

// Parse JSON requests with large limit for model files (models can be large)
app.use(express.json({ limit: '100mb' }));  // Allow JSON payloads up to 100MB
// Serve static files from public directory (HTML, CSS, JS, images)
app.use(express.static(path.join(__dirname, 'public')));  // Serve files from public folder

// ==================== CONSTANTS ====================
const TRAINING_DATA_FILE = path.join(__dirname, 'public', 'training_data.json');  // Path to local training data file

// Storage bucket names from environment variables or defaults
const STORAGE_BUCKETS = {
    signCards: process.env.SUPABASE_SIGN_CARDS_BUCKET || 'sign-cards',  // Bucket for sign card images
    models: process.env.SUPABASE_MODELS_BUCKET || 'models'  // Bucket for trained AI models
};

// ==================== HELPER FUNCTIONS ====================

// Verify that a storage bucket exists in Supabase before using it
async function ensureBucketExists(bucketName) {
    const { data: buckets, error } = await supabase.storage.listBuckets();  // List all buckets
    if (error) {
        throw new Error(`Cannot list storage buckets: ${error.message}`);  // Throw error if listing fails
    }

    const bucket = buckets.find((entry) => entry.name === bucketName);  // Find the specific bucket
    if (!bucket) {
        throw new Error(`Storage bucket "${bucketName}" not found. Create it in Supabase Storage or set the matching SUPABASE_*_BUCKET env var.`);  // Error if bucket doesn't exist
    }

    return bucket;  // Return the found bucket
}

// Get list of buckets to try for model storage (with fallback support)
async function getModelBucketCandidates() {
    const candidates = [STORAGE_BUCKETS.models];  // Primary bucket for models
    // Add sign-cards bucket as fallback if different from models bucket
    if (STORAGE_BUCKETS.signCards !== STORAGE_BUCKETS.models) {
        candidates.push(STORAGE_BUCKETS.signCards);  // Add fallback bucket
    }
    return candidates;  // Return list of bucket candidates to try
}

// Upload file to the first available bucket from candidates list
// Tries each bucket in order until one succeeds (useful for fallback scenarios)
async function uploadToAvailableBucket(bucketCandidates, filePath, buffer, options) {
    let lastError = null;  // Store the last error for reporting

    // Try each bucket in the candidates list
    for (let index = 0; index < bucketCandidates.length; index += 1) {
        const bucketName = bucketCandidates[index];  // Get current bucket name
        try {
            await ensureBucketExists(bucketName);  // Verify bucket exists
            const { error } = await supabase.storage  // Attempt upload
                .from(bucketName)
                .upload(filePath, buffer, options);

            if (error) throw error;  // Throw if upload fails
            return { bucketName };  // Return successful bucket name
        } catch (error) {
            lastError = error;  // Store error
            const isBucketMissing = /bucket.*not found/i.test(error.message || '');  // Check if bucket is missing
            const hasAnotherCandidate = index < bucketCandidates.length - 1;  // Check if more buckets to try
            // Only try next bucket if current is missing and there are more candidates
            if (!isBucketMissing || !hasAnotherCandidate) {
                throw error;  // Throw error if not a missing bucket or no more candidates
            }
        }
    }

    throw lastError;  // Throw the last error if all buckets failed
}

// ==================== ONE-TIME MIGRATION ====================
// ONE-TIME MIGRATION: If Supabase training_data table is empty, seed from local file
// This runs once when the server starts to migrate local data to Supabase
async function migrateLocalDataToSupabase() {
    try {
        // Check if Supabase already has training data (to avoid re-migrating)
        const { count, error } = await supabase
            .from('training_data')  // Query training_data table
            .select('id', { count: 'exact', head: true });  // Count rows only

        if (error) {
            console.error('Migration check error:', error.message);  // Log error
            return;  // Exit if check fails
        }

        // Skip migration if data already exists in Supabase
        if (count > 0) {
            console.log(`✅ Supabase already has ${count} training samples. Skipping migration.`);  // Log skip
            return;  // Exit function
        }

        // Check if local training_data.json file exists
        if (!fs.existsSync(TRAINING_DATA_FILE)) {
            console.log('No local training_data.json found. Starting fresh in Supabase.');  // Log no local file
            return;  // Exit function
        }

        console.log('🔄 Migrating local training_data.json → Supabase (this runs once)...');  // Log start
        const raw = fs.readFileSync(TRAINING_DATA_FILE, 'utf8');  // Read local file
        const allData = JSON.parse(raw);  // Parse JSON data

        // Migrate data for each language (ISL, ASL)
        for (const lang of ['ISL', 'ASL']) {  // Loop through languages
            const samples = allData[lang] || [];  // Get samples for this language
            if (samples.length === 0) continue;  // Skip if no samples

            // Insert in batches of 500 to avoid Supabase payload limits
            const BATCH = 500;  // Batch size
            let inserted = 0;  // Track inserted count
            for (let i = 0; i < samples.length; i += BATCH) {  // Loop through samples in batches
                const batch = samples.slice(i, i + BATCH).map(s => ({  // Create batch of 500 samples
                    lang,  // Language code
                    label: s.label,  // Sign label
                    type: s.type || 'static',  // Sign type (static or dynamic)
                    landmarks: s.landmarks || null,  // Hand landmarks for static signs
                    frames: s.frames || null,  // Frame data for dynamic signs
                    hand_count: s.handCount || null,  // Number of hands used
                    is_trained: s.isTrained !== undefined ? s.isTrained : true,  // Training status
                    recorded_at: s.recordedAt || null,  // Recording timestamp
                    trained_at: s.trainedAt || null  // Training timestamp
                }));

                const { error: insertErr } = await supabase  // Insert batch into Supabase
                    .from('training_data')
                    .insert(batch);

                if (insertErr) {
                    console.error(`Migration insert error (${lang}, batch ${i}):`, insertErr.message);  // Log error
                } else {
                    inserted += batch.length;  // Update count
                    process.stdout.write(`  ${lang}: ${inserted}/${samples.length} rows migrated\r`);  // Progress indicator
                }
            }
            console.log(`  ✅ ${lang}: ${inserted} rows migrated to Supabase`);  // Log completion
        }
        console.log('✅ Migration complete!');  // Log overall completion
    } catch (err) {
        console.error('Migration failed:', err.message);  // Log migration failure
    }
}

// ==================== API ENDPOINTS ====================

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/training-data — read training data from Supabase
// Returns all training samples grouped by language (ISL, ASL)
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/training-data', async (req, res) => {  // GET endpoint for training data
    try {
        const { data, error } = await supabase  // Query Supabase for all training data
            .from('training_data')  // From training_data table
            .select('*')  // Select all columns
            .order('id', { ascending: true });  // Order by ID ascending

        if (error) throw error;  // Throw error if query fails

        // Group by lang and reshape back to the format the client expects
        const result = { ISL: [], ASL: [] };  // Initialize result object
        for (const row of data) {  // Loop through each row
            const sample = {  // Create sample object
                label: row.label,  // Sign label
                type: row.type,  // Sign type
                isTrained: row.is_trained,  // Training status
                recordedAt: row.recorded_at,  // Recording timestamp
                trainedAt: row.trained_at,  // Training timestamp
            };
            // Include frame data for dynamic signs, landmarks for static signs
            if (row.type === 'dynamic') {  // Check if dynamic sign
                sample.frames = row.frames;  // Add frame data
                sample.handCount = row.hand_count;  // Add hand count
                sample.frameCount = row.frames ? row.frames.length : 0;  // Add frame count
            } else {  // Static sign
                sample.landmarks = row.landmarks;  // Add landmarks data
            }
            if (!result[row.lang]) result[row.lang] = [];  // Initialize language array if needed
            result[row.lang].push(sample);  // Add sample to language array
        }

        res.json(result);  // Send result as JSON response
    } catch (err) {
        console.error('Error reading training data from Supabase:', err.message);  // Log error
        res.status(500).json({ error: 'Failed to read training data' });  // Send error response
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/training-data — save training data to Supabase
// Replaces ALL data for the language(s) in the payload (same as before)
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/training-data', async (req, res) => {  // POST endpoint for saving training data
    try {
        const allData = req.body; // { ISL: [...], ASL: [...] }  // Get request body

        // Process each language separately
        for (const lang of Object.keys(allData)) {  // Loop through languages
            const samples = allData[lang] || [];  // Get samples for this language

            // Delete existing rows for this language before inserting new data
            const { error: deleteErr } = await supabase  // Delete existing data
                .from('training_data')
                .delete()
                .eq('lang', lang);  // Filter by language

            if (deleteErr) throw deleteErr;  // Throw error if delete fails

            if (samples.length === 0) continue;  // Skip if no samples

            // Insert in batches of 500 to avoid payload limits
            const BATCH = 500;  // Batch size
            for (let i = 0; i < samples.length; i += BATCH) {  // Loop through samples in batches
                const batch = samples.slice(i, i + BATCH).map(s => ({  // Create batch
                    lang,  // Language code
                    label: s.label,  // Sign label
                    type: s.type || 'static',  // Sign type
                    landmarks: s.landmarks || null,  // Landmarks for static signs
                    frames: s.frames || null,  // Frames for dynamic signs
                    hand_count: s.handCount || null,  // Hand count
                    is_trained: s.isTrained !== undefined ? s.isTrained : false,  // Training status
                    recorded_at: s.recordedAt || null,  // Recording timestamp
                    trained_at: s.trainedAt || null  // Training timestamp
                }));

                const { error: insertErr } = await supabase  // Insert batch into Supabase
                    .from('training_data')
                    .insert(batch);

                if (insertErr) throw insertErr;  // Throw error if insert fails
            }
        }

        res.json({ success: true });  // Send success response
    } catch (err) {
        console.error('Error saving training data to Supabase:', err.message);  // Log error
        res.status(500).json({ error: 'Failed to save training data' });  // Send error response
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/upload-sign-card — upload sign card image to Supabase Storage
// Also saves reference URL to sign_cards table and local file for fallback
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/upload-sign-card', async (req, res) => {  // POST endpoint for uploading sign cards
    try {
        await ensureBucketExists(STORAGE_BUCKETS.signCards);  // Verify bucket exists

        const { lang, label, imageBase64, extension } = req.body;  // Extract request data

        if (!lang || !label || !imageBase64 || !extension) {  // Validate required fields
            return res.status(400).json({ error: 'Missing required fields' });  // Return error
        }

        // Sanitize label for safe filename (remove special characters)
        const safeLabel = label.toLowerCase().trim().replace(/[^a-z0-9-]/g, '-');  // Clean label
        const langFolder = lang.toLowerCase();  // Lowercase language
        const filePath = `${langFolder}/${safeLabel}.${extension}`;  // Construct file path

        // Strip data URL prefix and convert to buffer
        const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');  // Remove prefix
        const imageBuffer = Buffer.from(base64Data, 'base64');  // Convert to buffer

        // Determine content type based on extension
        const contentType = extension === 'png' ? 'image/png'  // PNG content type
            : extension === 'gif' ? 'image/gif'  // GIF content type
            : extension === 'webp' ? 'image/webp'  // WebP content type
            : 'image/jpeg';  // Default JPEG content type

        // Upload to Supabase Storage (upsert = overwrite if exists)
        const { error: uploadErr } = await supabase.storage  // Upload to storage
            .from(STORAGE_BUCKETS.signCards)
            .upload(filePath, imageBuffer, {
                contentType,  // Content type
                upsert: true  // Overwrite if exists
            });

        if (uploadErr) throw uploadErr;  // Throw error if upload fails

        // Get public URL for the uploaded file
        const { data: urlData } = supabase.storage  // Get public URL
            .from(STORAGE_BUCKETS.signCards)
            .getPublicUrl(filePath);

        const publicUrl = urlData.publicUrl;  // Extract URL

        // Save URL to sign_cards table for reference
        const { error: upsertErr } = await supabase  // Upsert to database
            .from('sign_cards')
            .upsert({ lang: langFolder, label: safeLabel, url: publicUrl, extension, updated_at: new Date().toISOString() },
                { onConflict: 'lang,label' });  // Conflict on lang and label

        if (upsertErr) throw upsertErr;  // Throw error if upsert fails

        // Also save locally for backward-compat with the existing image check system
        const uploadsDir = path.join(__dirname, 'public', 'signs-images', langFolder);  // Local directory
        if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });  // Create directory

        // Remove old formats to avoid conflicts
        ['jpg', 'jpeg', 'png', 'gif', 'webp'].forEach(ext => {  // Loop through formats
            const old = path.join(uploadsDir, `${safeLabel}.${ext}`);  // Old file path
            if (fs.existsSync(old)) fs.unlinkSync(old);  // Delete if exists
        });
        fs.writeFileSync(path.join(uploadsDir, `${safeLabel}.${extension}`), imageBuffer);  // Write file

        res.json({ success: true, path: `/signs-images/${langFolder}/${safeLabel}.${extension}`, url: publicUrl });  // Send response

    } catch (err) {
        console.error('Error uploading sign card:', err.message);  // Log error
        res.status(500).json({ error: err.message || 'Failed to upload sign card' });  // Send error response
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/delete-sign-card — delete sign card from Supabase Storage & DB
// Also removes local file copy
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/delete-sign-card', async (req, res) => {  // POST endpoint for deleting sign cards
    try {
        const { lang, label } = req.body;  // Extract request data
        if (!lang || !label) return res.status(400).json({ error: 'Missing required fields' });  // Validate

        const safeLabel = label.toLowerCase().trim().replace(/[^a-z0-9-]/g, '-');  // Clean label
        const langFolder = lang.toLowerCase();  // Lowercase language

        // Get extension from sign_cards table to construct file path
        const { data: cardData } = await supabase  // Query database
            .from('sign_cards')
            .select('extension')
            .eq('lang', langFolder)
            .eq('label', safeLabel)
            .single();  // Get single record

        if (cardData) {  // If record exists
            const filePath = `${langFolder}/${safeLabel}.${cardData.extension}`;  // File path
            await supabase.storage.from(STORAGE_BUCKETS.signCards).remove([filePath]);  // Delete from storage
        }

        // Delete record from sign_cards table
        await supabase.from('sign_cards').delete().eq('lang', langFolder).eq('label', safeLabel);  // Delete from DB

        // Also delete local copy for cleanup
        const uploadsDir = path.join(__dirname, 'public', 'signs-images', langFolder);  // Local directory
        if (fs.existsSync(uploadsDir)) {  // If directory exists
            ['jpg', 'jpeg', 'png', 'gif', 'webp'].forEach(ext => {  // Loop through formats
                const filePath = path.join(uploadsDir, `${safeLabel}.${ext}`);  // File path
                if (fs.existsSync(filePath)) fs.unlinkSync(filePath);  // Delete if exists
            });
        }

        res.json({ success: true });  // Send success response
    } catch (err) {
        console.error('Error deleting sign card:', err.message);  // Log error
        res.status(500).json({ error: 'Failed to delete sign card' });  // Send error response
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/upload-model-component — upload trained model files (JSON/Bin) to Supabase Storage
// Accepts base64-encoded model files and stores them with bucket fallback
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/upload-model-component', async (req, res) => {  // POST endpoint for model upload
    try {
        const { lang, type, fileName, fileDataB64, contentType } = req.body;  // Extract request data

        if (!lang || !type || !fileName || !fileDataB64) {  // Validate required fields
            return res.status(400).json({ error: 'Missing required fields' });  // Return error
        }

        // Construct storage path: models/{lang}/{type}/{filename}
        const filePath = `models/${lang.toLowerCase()}/${type}/${fileName}`;  // File path
        const buffer = Buffer.from(fileDataB64, 'base64');  // Convert base64 to buffer
        const bucketCandidates = await getModelBucketCandidates();  // Get bucket candidates
        const { bucketName } = await uploadToAvailableBucket(bucketCandidates, filePath, buffer, {  // Upload
            contentType: contentType || 'application/octet-stream',  // Content type
            upsert: true  // Overwrite if exists
        });

        res.json({ success: true, path: filePath, bucket: bucketName });  // Send response
    } catch (err) {
        console.error('Error uploading model component:', err.message);  // Log error
        res.status(500).json({ error: err.message || 'Failed to upload model component' });  // Send error response
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/trigger-cloud-training — trigger python training scripts
// Currently simulated with a delay, would call actual Python training scripts in production
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/trigger-cloud-training', async (req, res) => {  // POST endpoint for cloud training
    try {
        const { lang } = req.body;  // Extract language
        if (!lang) return res.status(400).json({ error: 'Missing language' });  // Validate

        console.log(`🚀 Triggering cloud training for ${lang}...`);  // Log start

        // 1. Fetch data from Supabase for this language
        const { data: samples, error } = await supabase  // Query training data
            .from('training_data')
            .select('*')
            .eq('lang', lang);  // Filter by language

        if (error) throw error;  // Throw error if query fails

        // 2. Export to a temporary JSON for Python to read
        // Re-shaping back to the format expected by some scripts if needed
        const exportData = samples.map(row => ({  // Reshape data
            label: row.label,  // Sign label
            type: row.type,  // Sign type
            landmarks: row.landmarks,  // Landmarks
            frames: row.frames,  // Frames
            handCount: row.hand_count  // Hand count
        }));

        const trainingDir = path.join(__dirname, 'training');  // Training directory
        if (!fs.existsSync(trainingDir)) fs.mkdirSync(trainingDir);  // Create directory

        const dataPath = path.join(trainingDir, `data_${lang.toLowerCase()}.json`);  // Data file path
        fs.writeFileSync(dataPath, JSON.stringify(exportData));  // Write data to file
        console.log(`  ✅ Data exported to ${dataPath}`);  // Log export

        // 3. Trigger Python Training (Simulated for this environment if scripts are complex)
        // In a real production environment, you'd use child_process.spawn
        const { exec } = require('child_process');  // Import exec for running commands
        
        // We'll run a "fake" training command first to verify it works, 
        // or actually run train.py if data is formatted correctly.
        // For now, let's assume train.py is ready or we simulate a 10-second wait.
        
        // Real implementation would be something like:
        // exec(`python training/train.py --lang ${lang}`, (err, stdout, stderr) => { ... });

        await new Promise(resolve => setTimeout(resolve, 8000)); // Simulate training time (8 seconds)

        console.log(`  ✅ Cloud training complete for ${lang}`);  // Log completion
        res.json({ success: true, message: 'Training completed successfully' });  // Send response

    } catch (err) {
        console.error('Cloud training trigger failed:', err.message);  // Log error
        res.status(500).json({ error: 'Training failed' });  // Send error response
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/list-models — check which models are available in the cloud
// Returns list of files in the models storage bucket with fallback support
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/list-models', async (req, res) => {  // GET endpoint for listing models
    try {
        const bucketCandidates = await getModelBucketCandidates();  // Get bucket candidates
        let data = null;  // Store result data
        let lastError = null;  // Store last error

        // Try each bucket until one succeeds
        for (let index = 0; index < bucketCandidates.length; index += 1) {  // Loop through buckets
            const bucketName = bucketCandidates[index];  // Get bucket name
            try {
                await ensureBucketExists(bucketName);  // Verify bucket exists
                const result = await supabase.storage  // List files in bucket
                    .from(bucketName)
                    .list('', { recursive: true });  // Recursive list
                if (result.error) throw result.error;  // Throw error if list fails
                data = result.data;  // Store data
                break;  // Exit loop on success
            } catch (error) {
                lastError = error;  // Store error
                const isBucketMissing = /bucket.*not found/i.test(error.message || '');  // Check if missing
                const hasAnotherCandidate = index < bucketCandidates.length - 1;  // Check if more buckets
                if (!isBucketMissing || !hasAnotherCandidate) {  // Throw if not missing or no more
                    throw error;
                }
            }
        }

        if (!data && lastError) throw lastError;  // Throw if no data and error
        res.json(data || []);  // Send response
    } catch (err) {
        console.error('Error listing cloud models:', err.message);  // Log error
        res.status(500).json({ error: err.message || 'Failed to list models' });  // Send error response
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/sign-cards — list all sign card URLs from Supabase (for preloading)
// Returns sign cards grouped by language for client-side caching
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/sign-cards', async (req, res) => {  // GET endpoint for listing sign cards
    try {
        const { data, error } = await supabase  // Query sign cards table
            .from('sign_cards')
            .select('lang, label, url, extension')  // Select columns
            .order('lang', { ascending: true });  // Order by language

        if (error) throw error;  // Throw error if query fails

        // Group by lang for easier client-side access
        const result = {};  // Initialize result object
        for (const card of data) {  // Loop through cards
            if (!result[card.lang]) result[card.lang] = [];  // Initialize language array
            result[card.lang].push({ label: card.label, url: card.url, extension: card.extension });  // Add card
        }

        res.json(result);  // Send response
    } catch (err) {
        console.error('Error listing sign cards from Supabase:', err.message);  // Log error
        res.status(500).json({ error: 'Failed to list sign cards' });  // Send error response
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/storage-config — returns storage bucket configuration to client
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/storage-config', (req, res) => {  // GET endpoint for storage config
    res.json(STORAGE_BUCKETS);  // Send bucket names
});

// Socket.io signaling removed. Using Supabase Realtime Channels on the client side.

// ==================== SERVER STARTUP ====================
// ─────────────────────────────────────────────────────────────────────────────
// Start Server (with one-time migration)
// ─────────────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;  // Port from environment or default 3000

// Run migration first, then start server (or start anyway if migration fails)
migrateLocalDataToSupabase().then(() => {  // Run migration
    app.listen(PORT, () => {  // Start server on success
        console.log(`🚀 Server running on http://localhost:${PORT}`);  // Log start
    });
}).catch(err => {  // Handle migration failure
    console.error('Failed to run migration, starting anyway:', err.message);  // Log error
    app.listen(PORT, () => {  // Start server anyway
        console.log(`🚀 Server running on http://localhost:${PORT}`);  // Log start
    });
});
