// public/supabase-client.js
// Client-side Supabase configuration for browser access
// Uses anon key for public access (restricted by RLS policies in Supabase)
const supabaseUrl = 'https://ynvykdraupxkhsxxsonb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InludnlrZHJhdXB4a2hzeHhzb25iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzMTIyMDUsImV4cCI6MjA4ODg4ODIwNX0.DRdCi6jxts3i9g0vTaRevRcIB4xfEadqxxX_d3DYzvA';
window.supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);

// Default storage bucket names for different types of files
const defaultStorageBuckets = {
    signCards: 'sign-cards',  // Bucket for sign card reference images
    models: 'models'           // Bucket for trained ML models
};

let storageBucketConfigPromise = null;

// Fetch storage bucket configuration from server
// Falls back to defaults if server is unavailable
async function getStorageBucketConfig() {
    if (!storageBucketConfigPromise) {
        storageBucketConfigPromise = fetch('/api/storage-config')
            .then((response) => {
                if (!response.ok) throw new Error(`Failed to load storage config (${response.status})`);
                return response.json();
            })
            .catch((error) => {
                console.warn('Falling back to default storage bucket names:', error);
                return defaultStorageBuckets;
            });
    }

    return storageBucketConfigPromise;
}

// Get the storage bucket name for a given type (sign-cards, models)
window.getStorageBucket = async function getStorageBucket(bucketType) {
    const config = await getStorageBucketConfig();
    return config[bucketType] || defaultStorageBuckets[bucketType];
};

// Get list of candidate buckets to try for a given type
// For models, also tries sign-cards bucket as fallback
window.getStorageBucketCandidates = async function getStorageBucketCandidates(bucketType) {
    const config = await getStorageBucketConfig();
    const primary = config[bucketType] || defaultStorageBuckets[bucketType];
    const candidates = [primary];

    if (bucketType === 'models') {
        const signCardsBucket = config.signCards || defaultStorageBuckets.signCards;
        if (signCardsBucket && signCardsBucket !== primary) {
            candidates.push(signCardsBucket);
        }
    }

    return candidates;
};

// Execute a storage operation with automatic bucket fallback
// Tries primary bucket first, then falls back to secondary buckets if primary is missing
window.withStorageBucketFallback = async function withStorageBucketFallback(bucketType, operation) {
    const candidates = await window.getStorageBucketCandidates(bucketType);
    let lastError = null;

    for (let index = 0; index < candidates.length; index += 1) {
        const bucketName = candidates[index];
        try {
            return await operation(bucketName);
        } catch (error) {
            lastError = error;
            const isBucketMissing = /bucket not found/i.test(error?.message || '');
            const hasAnotherCandidate = index < candidates.length - 1;

            if (!isBucketMissing || !hasAnotherCandidate) {
                throw error;
            }

            console.warn(`Storage bucket "${bucketName}" was not found for ${bucketType}; trying fallback bucket.`);
        }
    }

    throw lastError;
};
