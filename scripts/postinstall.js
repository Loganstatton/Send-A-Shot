const fs = require('fs');
const path = require('path');
const dir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
console.log('[postinstall] ensured data/ directory exists');
