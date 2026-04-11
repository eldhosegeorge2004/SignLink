// migrate-sign-cards.js
// One-time script: uploads all existing local sign card images to Supabase Storage
// and populates the sign_cards table with their public URLs.
// Run once with: node migrate-sign-cards.js

require('dotenv').config();
const { supabase } = require('./supabase-config');
const fs = require('fs');
const path = require('path');

const STORAGE_BUCKET = process.env.SUPABASE_SIGN_CARDS_BUCKET || 'sign-cards';
const SIGNS_DIR = path.join(__dirname, 'public', 'signs-images');
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

function getContentType(ext) {
    switch (ext.toLowerCase()) {
        case '.png':  return 'image/png';
        case '.gif':  return 'image/gif';
        case '.webp': return 'image/webp';
        default:      return 'image/jpeg';
    }
}

async function uploadImage(localPath, storagePath, lang, label, extension) {
    const buffer = fs.readFileSync(localPath);
    const contentType = getContentType(extension);

    // Upload to Supabase Storage
    const { error: uploadErr } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(storagePath, buffer, { contentType, upsert: true });

    if (uploadErr) {
        console.error(`  ❌ Upload failed for ${storagePath}:`, uploadErr.message);
        return null;
    }

    // Get public URL
    const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);
    const publicUrl = data.publicUrl;

    // Save to sign_cards table
    const { error: upsertErr } = await supabase
        .from('sign_cards')
        .upsert(
            { lang, label, url: publicUrl, extension: extension.replace('.', ''), updated_at: new Date().toISOString() },
            { onConflict: 'lang,label' }
        );

    if (upsertErr) {
        console.error(`  ❌ DB upsert failed for ${label}:`, upsertErr.message);
        return null;
    }

    return publicUrl;
}

async function migrateFolder(localFolder, lang, subfolder = null) {
    const folderPath = subfolder
        ? path.join(SIGNS_DIR, localFolder, subfolder)
        : path.join(SIGNS_DIR, localFolder);

    if (!fs.existsSync(folderPath)) {
        console.log(`  Folder not found, skipping: ${folderPath}`);
        return 0;
    }

    const files = fs.readdirSync(folderPath);
    let count = 0;

    for (const file of files) {
        const ext = path.extname(file).toLowerCase();
        if (!IMAGE_EXTENSIONS.includes(ext)) continue;

        const name = path.basename(file, ext);
        const localPath = path.join(folderPath, file);

        // Build storage path: e.g. isl/characters/A.jpg or isl/words/hello.gif
        const storagePath = subfolder
            ? `${lang}/${subfolder}/${file}`
            : `${lang}/${file}`;

        // DB label is subfolder/name so we can distinguish characters from words
        const label = subfolder ? `${subfolder}/${name}` : name;

        process.stdout.write(`  Uploading ${storagePath}...`);
        const url = await uploadImage(localPath, storagePath, lang, label, ext);
        if (url) {
            process.stdout.write(` ✅\n`);
            count++;
        } else {
            process.stdout.write(` ❌\n`);
        }
    }

    return count;
}

async function main() {
    console.log('🚀 Starting sign card image migration to Supabase Storage...\n');

    // Verify bucket exists
    const { data: buckets, error: bucketsErr } = await supabase.storage.listBuckets();
    if (bucketsErr) {
        console.error('❌ Cannot list storage buckets:', bucketsErr.message);
        console.error('Make sure your SUPABASE_SERVICE_KEY has storage permissions.');
        process.exit(1);
    }

    const bucket = buckets.find(b => b.name === STORAGE_BUCKET);
    if (!bucket) {
        console.error(`❌ Bucket "${STORAGE_BUCKET}" not found!`);
        console.error(`Please create a PUBLIC bucket named "${STORAGE_BUCKET}" in Supabase Dashboard → Storage → New Bucket`);
        process.exit(1);
    }
    console.log(`✅ Bucket "${STORAGE_BUCKET}" found (public: ${bucket.public})\n`);

    let total = 0;

    // ISL characters (A-Z, 1-9)
    console.log('📂 Uploading ISL characters...');
    total += await migrateFolder('isl', 'isl', 'characters');

    // ISL words (hello, namaste, etc.)
    console.log('\n📂 Uploading ISL words...');
    total += await migrateFolder('isl', 'isl', 'words');

    // ISL root-level images (e.g. test-card.gif)
    console.log('\n📂 Uploading ISL root images...');
    total += await migrateFolder('isl', 'isl');

    // ASL characters (A-Z, 1-9)
    console.log('\n📂 Uploading ASL characters...');
    total += await migrateFolder('asl', 'asl', 'characters');

    // ASL words
    const aslWordsPath = path.join(SIGNS_DIR, 'asl', 'words');
    if (fs.existsSync(aslWordsPath)) {
        console.log('\n📂 Uploading ASL words...');
        total += await migrateFolder('asl', 'asl', 'words');
    }

    console.log(`\n✅ Migration complete! Uploaded ${total} sign card images to Supabase Storage.`);
    console.log(`\nVerify in Supabase Dashboard → Storage → ${STORAGE_BUCKET} bucket & Table Editor → sign_cards table`);
    process.exit(0);
}

main().catch(err => {
    console.error('\n❌ Migration failed:', err.message);
    process.exit(1);
});
