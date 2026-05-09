const fs = require('fs');
const path = require('path');

// Load the training_data.json file
const trainingDataPath = path.join(__dirname, 'public', 'training_data.json');
console.log('Reading training_data.json...');

const rawData = fs.readFileSync(trainingDataPath, 'utf8');
const trainingData = JSON.parse(rawData);

console.log(`Loaded training data with keys: ${Object.keys(trainingData).join(', ')}`);

// Extract ISL data
const islData = trainingData.ISL || [];
console.log(`Found ${islData.length} ISL training samples`);

if (islData.length === 0) {
    console.log('No ISL data found to upload');
    process.exit(0);
}

// Transform ISL data to match Supabase training_data table structure
const supabaseData = islData.map(sample => ({
    lang: 'isl',
    label: sample.label,
    type: sample.type || 'static',
    landmarks: sample.landmarks || null,
    frames: sample.frames || null,
    hand_count: sample.handCount || null,
    is_trained: sample.isTrained !== undefined ? sample.isTrained : true,
    recorded_at: sample.recordedAt ? new Date(sample.recordedAt).toISOString() : new Date().toISOString(),
    trained_at: sample.trainedAt ? new Date(sample.trainedAt).toISOString() : null
}));

console.log(`Transformed ${supabaseData.length} samples for Supabase`);

// Count static vs dynamic
const staticCount = supabaseData.filter(s => s.type === 'static').length;
const dynamicCount = supabaseData.filter(s => s.type === 'dynamic').length;
console.log(`Static samples: ${staticCount}, Dynamic samples: ${dynamicCount}`);

// Upload to Supabase via the API endpoint
async function uploadToSupabase() {
    try {
        console.log('Uploading to Supabase via /api/training-data...');
        
        const response = await fetch('http://localhost:3000/api/training-data', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ ISL: supabaseData })
        });

        const result = await response.json();
        
        if (!response.ok) {
            throw new Error(result.error || 'Upload failed');
        }

        console.log('✅ Successfully uploaded ISL data to Supabase');
        console.log(`Uploaded ${supabaseData.length} samples`);
    } catch (error) {
        console.error('❌ Error uploading to Supabase:', error.message);
        console.log('Make sure the server is running on http://localhost:3000');
        process.exit(1);
    }
}

uploadToSupabase();
