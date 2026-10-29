const fs = require('node:fs'); const crypto = require('node:crypto'); const path = require('node:path');
const root = path.join(__dirname, '..'), meta = require('../vendor-core/version.json');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
if (hash('vendor-core/core.ts') !== meta.sourceSha256 || Object.entries(meta.compiled).some(([file, digest]) => hash(file) !== digest)) throw new Error('vendored_core_changed_update_source_compile_and_manifest');
console.log('Vendored core hashes verified');
