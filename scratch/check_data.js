const fs = require('fs');
const data = JSON.parse(fs.readFileSync('public/training_data.json', 'utf8'));

['ISL', 'ASL'].forEach(lang => {
    const samples = data[lang] || [];
    console.log(`${lang} samples:`, samples.length);
    if (samples.length > 0) {
        let undefinedCount = 0;
        let invalidCount = 0;
        const lengths = [];
        
        samples.forEach((s, idx) => {
            if (!s || !s.landmarks) {
                undefinedCount++;
            } else if (!Array.isArray(s.landmarks)) {
                invalidCount++;
            } else {
                lengths.push(s.landmarks.length);
            }
        });

        console.log(`  Undefined landmarks: ${undefinedCount}`);
        console.log(`  Invalid landmarks (not array): ${invalidCount}`);
        
        const uniqueLengths = [...new Set(lengths)];
        console.log(`  Unique lengths:`, uniqueLengths);
        if (uniqueLengths.length > 1) {
            uniqueLengths.forEach(len => {
                const count = lengths.filter(l => l === len).length;
                console.log(`    Length ${len}: ${count} samples`);
            });
        }
    }
});


