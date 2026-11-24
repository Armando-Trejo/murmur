import fs from 'node:fs';
// One-time local migration. Never print values or expose these keys through Vite.
const source = process.argv[2]; if (!source) throw new Error('Pass a local credentials file path.');
if (fs.existsSync('.env.local')) { console.log('.env.local already exists; preserved.'); process.exit(0); }
const raw = fs.readFileSync(source, 'utf8'); const keys = ['SPOTIFY_EMAIL','SPOTIFY_PASSWORD','SPOTIFY_SP_DC','GOOGLE_EMAIL','GOOGLE_PASSWORD','YT_SAPISID']; const values = {};
for (const key of keys) { const match = raw.match(new RegExp('^\\s*' + key + '\\s*[:=]\\s*(.+)$', 'mi')); if (match) values[key] = match[1].trim().replace(/^['"]|['"]$/g, ''); }
// Spanish/plain-text account lists: infer only labeled account blocks, never guess values.
let current = '';
for (const line of raw.split(/\r?\n/)) {
 if (/spotify/i.test(line)) current = 'SPOTIFY'; else if (/youtube|google/i.test(line)) current = 'GOOGLE';
 const email = line.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i); if (current && email) values[current + '_EMAIL'] ??= email[0];
 const password = line.match(/(?:contrase[nñ]a|password|clave)\s*[:=]\s*(.+)/i); if (current && password) values[current + '_PASSWORD'] ??= password[1].trim();
}
fs.writeFileSync('.env.local', '# Local account tests only. Never bundle, commit or export.\n' + keys.filter(k => values[k]).map(k => k + '=' + JSON.stringify(values[k])).join('\n') + '\n', { mode: 0o600 });
console.log('Created .env.local; populated fields: ' + keys.filter(k => values[k]).join(', ') + '. Values withheld.');
