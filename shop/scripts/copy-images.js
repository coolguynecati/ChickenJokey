const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', '..', 'images');
const dest = path.join(__dirname, '..', 'images');

if (!fs.existsSync(src)) {
    console.warn('[copy-images] source not found:', src);
    process.exit(0);
}

fs.cpSync(src, dest, { recursive: true, force: true });
console.log('[copy-images] synced →', dest);
