// public/supabase-client.js
const supabaseUrl = 'https://qzfimxpunguvhzljjkyr.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF6ZmlteHB1bmd1dmh6bGpqa3lyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgyODIxODYsImV4cCI6MjA5Mzg1ODE4Nn0.HYDSlhAC2EexuIZQW-92VzHD_zYFk6Ruufn5NXlhKg4';

if (!window.supabase) {
    console.error("Supabase script not loaded! Ensure you have internet connection on first load.");
} else {
    window.supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);
}

const defaultStorageBuckets = {
    signCards: 'sign-cards',
    models: 'models'
};

let storageBucketConfigPromise = null;

async function getStorageBucketConfig() {
    // In APK/Mobile, we should prioritize defaults or cached config to avoid relative fetch errors
    const cached = localStorage.getItem('supabase_storage_config');
    if (cached) {
        try { return JSON.parse(cached); } catch(e) {}
    }

    if (!storageBucketConfigPromise) {
        // Try to fetch from server, but fallback quickly for mobile
        storageBucketConfigPromise = fetch('/api/storage-config')
            .then((response) => {
                if (!response.ok) throw new Error(`Failed to load storage config (${response.status})`);
                return response.json();
            })
            .then(config => {
                localStorage.setItem('supabase_storage_config', JSON.stringify(config));
                return config;
            })
            .catch((error) => {
                console.warn('Using default storage bucket names (expected in mobile):', error.message);
                return defaultStorageBuckets;
            });
    }

    return storageBucketConfigPromise;
}

window.getStorageBucket = async function getStorageBucket(bucketType) {
    const config = await getStorageBucketConfig();
    return config[bucketType] || defaultStorageBuckets[bucketType];
};

window.getStorageBucketCandidates = async function getStorageBucketCandidates(bucketType) {
    const config = await getStorageBucketConfig();
    const primary = config[bucketType] || defaultStorageBuckets[bucketType];
    const candidates = [primary];

    return candidates;
};

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
