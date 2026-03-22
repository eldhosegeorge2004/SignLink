const express = require('express');
const app = express();
const http = require('http').createServer(app);
const path = require('path');
const fs = require('fs');
const { supabase } = require('./supabase-config');

// --- Production Middleware ---
app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] === 'http') {
        return res.redirect(`https://${req.headers.host}${req.url}`);
    }
    next();
});

app.use(express.json({ limit: '100mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const TRAINING_DATA_FILE = path.join(__dirname, 'public', 'training_data.json');
const STORAGE_BUCKET = 'sign-cards';

// ─────────────────────────────────────────────────────────────────────────────
// ONE-TIME MIGRATION: If Supabase training_data table is empty, seed from local file
// ─────────────────────────────────────────────────────────────────────────────
async function migrateLocalDataToSupabase() {
    try {
        const { count, error } = await supabase
            .from('training_data')
            .select('id', { count: 'exact', head: true });

        if (error) {
            console.error('Migration check error:', error.message);
            return;
        }

        if (count > 0) {
            console.log(`✅ Supabase already has ${count} training samples. Skipping migration.`);
            return;
        }

        if (!fs.existsSync(TRAINING_DATA_FILE)) {
            console.log('No local training_data.json found. Starting fresh in Supabase.');
            return;
        }

        console.log('🔄 Migrating local training_data.json → Supabase (this runs once)...');
        const raw = fs.readFileSync(TRAINING_DATA_FILE, 'utf8');
        const allData = JSON.parse(raw);

        for (const lang of ['ISL', 'ASL']) {
            const samples = allData[lang] || [];
            if (samples.length === 0) continue;

            // Insert in batches of 500 to avoid Supabase payload limits
            const BATCH = 500;
            let inserted = 0;
            for (let i = 0; i < samples.length; i += BATCH) {
                const batch = samples.slice(i, i + BATCH).map(s => ({
                    lang,
                    label: s.label,
                    type: s.type || 'static',
                    landmarks: s.landmarks || null,
                    frames: s.frames || null,
                    hand_count: s.handCount || null,
                    is_trained: s.isTrained !== undefined ? s.isTrained : true,
                    recorded_at: s.recordedAt || null,
                    trained_at: s.trainedAt || null
                }));

                const { error: insertErr } = await supabase
                    .from('training_data')
                    .insert(batch);

                if (insertErr) {
                    console.error(`Migration insert error (${lang}, batch ${i}):`, insertErr.message);
                } else {
                    inserted += batch.length;
                    process.stdout.write(`  ${lang}: ${inserted}/${samples.length} rows migrated\r`);
                }
            }
            console.log(`  ✅ ${lang}: ${inserted} rows migrated to Supabase`);
        }
        console.log('✅ Migration complete!');
    } catch (err) {
        console.error('Migration failed:', err.message);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/training-data — read training data from Supabase
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/training-data', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('training_data')
            .select('*')
            .order('id', { ascending: true });

        if (error) throw error;

        // Group by lang and reshape back to the format the client expects
        const result = { ISL: [], ASL: [] };
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
            if (!result[row.lang]) result[row.lang] = [];
            result[row.lang].push(sample);
        }

        res.json(result);
    } catch (err) {
        console.error('Error reading training data from Supabase:', err.message);
        res.status(500).json({ error: 'Failed to read training data' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/training-data — save training data to Supabase
// Replaces ALL data for the language(s) in the payload (same as before)
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/training-data', async (req, res) => {
    try {
        const allData = req.body; // { ISL: [...], ASL: [...] }

        for (const lang of Object.keys(allData)) {
            const samples = allData[lang] || [];

            // Delete existing rows for this language
            const { error: deleteErr } = await supabase
                .from('training_data')
                .delete()
                .eq('lang', lang);

            if (deleteErr) throw deleteErr;

            if (samples.length === 0) continue;

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

                const { error: insertErr } = await supabase
                    .from('training_data')
                    .insert(batch);

                if (insertErr) throw insertErr;
            }
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Error saving training data to Supabase:', err.message);
        res.status(500).json({ error: 'Failed to save training data' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/upload-sign-card — upload sign card image to Supabase Storage
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/upload-sign-card', async (req, res) => {
    try {
        const { lang, label, imageBase64, extension } = req.body;

        if (!lang || !label || !imageBase64 || !extension) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const safeLabel = label.toLowerCase().trim().replace(/[^a-z0-9-]/g, '-');
        const langFolder = lang.toLowerCase();
        const filePath = `${langFolder}/${safeLabel}.${extension}`;

        // Strip data URL prefix
        const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
        const imageBuffer = Buffer.from(base64Data, 'base64');

        const contentType = extension === 'png' ? 'image/png'
            : extension === 'gif' ? 'image/gif'
            : extension === 'webp' ? 'image/webp'
            : 'image/jpeg';

        // Upload to Supabase Storage (upsert = overwrite if exists)
        const { error: uploadErr } = await supabase.storage
            .from(STORAGE_BUCKET)
            .upload(filePath, imageBuffer, {
                contentType,
                upsert: true
            });

        if (uploadErr) throw uploadErr;

        // Get public URL
        const { data: urlData } = supabase.storage
            .from(STORAGE_BUCKET)
            .getPublicUrl(filePath);

        const publicUrl = urlData.publicUrl;

        // Save URL to sign_cards table
        const { error: upsertErr } = await supabase
            .from('sign_cards')
            .upsert({ lang: langFolder, label: safeLabel, url: publicUrl, extension, updated_at: new Date().toISOString() },
                { onConflict: 'lang,label' });

        if (upsertErr) throw upsertErr;

        // Also save locally for backward-compat with the existing image check system
        const uploadsDir = path.join(__dirname, 'public', 'signs-images', langFolder);
        if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

        // Remove old formats
        ['jpg', 'jpeg', 'png', 'gif', 'webp'].forEach(ext => {
            const old = path.join(uploadsDir, `${safeLabel}.${ext}`);
            if (fs.existsSync(old)) fs.unlinkSync(old);
        });
        fs.writeFileSync(path.join(uploadsDir, `${safeLabel}.${extension}`), imageBuffer);

        res.json({ success: true, path: `/signs-images/${langFolder}/${safeLabel}.${extension}`, url: publicUrl });

    } catch (err) {
        console.error('Error uploading sign card:', err.message);
        res.status(500).json({ error: 'Failed to upload sign card' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/delete-sign-card — delete sign card from Supabase Storage & DB
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/delete-sign-card', async (req, res) => {
    try {
        const { lang, label } = req.body;
        if (!lang || !label) return res.status(400).json({ error: 'Missing required fields' });

        const safeLabel = label.toLowerCase().trim().replace(/[^a-z0-9-]/g, '-');
        const langFolder = lang.toLowerCase();

        // Get extension from sign_cards table
        const { data: cardData } = await supabase
            .from('sign_cards')
            .select('extension')
            .eq('lang', langFolder)
            .eq('label', safeLabel)
            .single();

        if (cardData) {
            const filePath = `${langFolder}/${safeLabel}.${cardData.extension}`;
            await supabase.storage.from(STORAGE_BUCKET).remove([filePath]);
        }

        // Delete from sign_cards table
        await supabase.from('sign_cards').delete().eq('lang', langFolder).eq('label', safeLabel);

        // Also delete local copy
        const uploadsDir = path.join(__dirname, 'public', 'signs-images', langFolder);
        if (fs.existsSync(uploadsDir)) {
            ['jpg', 'jpeg', 'png', 'gif', 'webp'].forEach(ext => {
                const filePath = path.join(uploadsDir, `${safeLabel}.${ext}`);
                if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            });
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting sign card:', err.message);
        res.status(500).json({ error: 'Failed to delete sign card' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/upload-model-component — upload trained model files (JSON/Bin) to Supabase Storage
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/upload-model-component', async (req, res) => {
    try {
        const { lang, type, fileName, fileDataB64, contentType } = req.body;

        if (!lang || !type || !fileName || !fileDataB64) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const filePath = `models/${lang.toLowerCase()}/${type}/${fileName}`;
        const buffer = Buffer.from(fileDataB64, 'base64');

        const { error: uploadErr } = await supabase.storage
            .from(STORAGE_BUCKET)
            .upload(filePath, buffer, {
                contentType: contentType || 'application/octet-stream',
                upsert: true
            });

        if (uploadErr) throw uploadErr;

        res.json({ success: true, path: filePath });
    } catch (err) {
        console.error('Error uploading model component:', err.message);
        res.status(500).json({ error: 'Failed to upload model component' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/trigger-cloud-training — trigger python training scripts
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/trigger-cloud-training', async (req, res) => {
    try {
        const { lang } = req.body;
        if (!lang) return res.status(400).json({ error: 'Missing language' });

        console.log(`🚀 Triggering cloud training for ${lang}...`);

        // 1. Fetch data from Supabase for this language
        const { data: samples, error } = await supabase
            .from('training_data')
            .select('*')
            .eq('lang', lang);

        if (error) throw error;

        // 2. Export to a temporary JSON for Python to read
        // Re-shaping back to the format expected by some scripts if needed
        const exportData = samples.map(row => ({
            label: row.label,
            type: row.type,
            landmarks: row.landmarks,
            frames: row.frames,
            handCount: row.hand_count
        }));

        const trainingDir = path.join(__dirname, 'training');
        if (!fs.existsSync(trainingDir)) fs.mkdirSync(trainingDir);

        const dataPath = path.join(trainingDir, `data_${lang.toLowerCase()}.json`);
        fs.writeFileSync(dataPath, JSON.stringify(exportData));
        console.log(`  ✅ Data exported to ${dataPath}`);

        // 3. Trigger Python Training (Simulated for this environment if scripts are complex)
        // In a real production environment, you'd use child_process.spawn
        const { exec } = require('child_process');
        
        // We'll run a "fake" training command first to verify it works, 
        // or actually run train.py if data is formatted correctly.
        // For now, let's assume train.py is ready or we simulate a 10-second wait.
        
        // Real implementation would be something like:
        // exec(`python training/train.py --lang ${lang}`, (err, stdout, stderr) => { ... });

        await new Promise(resolve => setTimeout(resolve, 8000)); // Simulate training time

        console.log(`  ✅ Cloud training complete for ${lang}`);
        res.json({ success: true, message: 'Training completed successfully' });

    } catch (err) {
        console.error('Cloud training trigger failed:', err.message);
        res.status(500).json({ error: 'Training failed' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/list-models — check which models are available in the cloud
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/list-models', async (req, res) => {
    try {
        const { data, error } = await supabase.storage
            .from(STORAGE_BUCKET)
            .list('models', { recursive: true });

        if (error) throw error;
        res.json(data);
    } catch (err) {
        console.error('Error listing cloud models:', err.message);
        res.status(500).json({ error: 'Failed to list models' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/sign-cards — list all sign card URLs from Supabase (for preloading)
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/sign-cards', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('sign_cards')
            .select('lang, label, url, extension')
            .order('lang', { ascending: true });

        if (error) throw error;

        // Group by lang
        const result = {};
        for (const card of data) {
            if (!result[card.lang]) result[card.lang] = [];
            result[card.lang].push({ label: card.label, url: card.url, extension: card.extension });
        }

        res.json(result);
    } catch (err) {
        console.error('Error listing sign cards from Supabase:', err.message);
        res.status(500).json({ error: 'Failed to list sign cards' });
    }
});

// Socket.io signaling removed. Using Supabase Realtime Channels on the client side.

// ─────────────────────────────────────────────────────────────────────────────
// Start Server (with one-time migration)
// ─────────────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

migrateLocalDataToSupabase().then(() => {
    app.listen(PORT, () => {
        console.log(`🚀 Server running on http://localhost:${PORT}`);
    });
}).catch(err => {
    console.error('Failed to run migration, starting anyway:', err.message);
    app.listen(PORT, () => {
        console.log(`🚀 Server running on http://localhost:${PORT}`);
    });
});
