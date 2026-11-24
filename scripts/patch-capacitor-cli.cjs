// Capacitor 6's default-import interop is incompatible with patched node-tar 7.
// Keep the requested Capacitor major while using the maintained extraction library.
const fs = require('node:fs');
const path = require('node:path');
const target = path.join(process.cwd(),'node_modules','@capacitor','cli','dist','util','template.js');
let code = fs.readFileSync(target,'utf8');
if (code.includes('const tar_1 = require("tar");')) process.exit(0);
const before = 'const tar_1 = tslib_1.__importDefault(require("tar"));';
if (!code.includes(before) || !code.includes('tar_1.default.extract')) throw new Error('Capacitor CLI template changed. Review the tar compatibility patch.');
code = code.replace(before,'const tar_1 = require("tar");').replaceAll('tar_1.default.extract','tar_1.extract');
fs.writeFileSync(target,code);
console.log('Applied Capacitor 6 / node-tar 7 compatibility patch.');
