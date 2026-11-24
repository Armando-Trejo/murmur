import fs from 'node:fs';
// Reads only .env.local. Does not attempt password-based Google/Spotify login.
const env = fs.existsSync('.env.local') ? Object.fromEntries(fs.readFileSync('.env.local','utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => { const n = l.indexOf('='); const value = l.slice(n+1); return [l.slice(0,n), value.startsWith('"') ? JSON.parse(value) : value]; })) : {};
const results = [];
if (env.SPOTIFY_SP_DC) {
 try { const response = await fetch('https://open.spotify.com/get_access_token?reason=transport&productType=web_player', { headers: { Cookie: 'sp_dc=' + env.SPOTIFY_SP_DC }, signal: AbortSignal.timeout(15000) }); const data = response.ok ? await response.json() : {}; results.push({ provider: 'spotify', status: response.status, accessTokenIssued: typeof data.accessToken === 'string' && !!data.accessToken }); } catch { results.push({ provider: 'spotify', reachable: false }); }
} else results.push({ provider:'spotify', status:'not_tested', reason:'No session cookie in .env.local. Use integrated login on the device.' });
results.push({provider:'youtube',status:'not_tested',reason:env.YT_SAPISID ? 'SAPISID alone is not a complete Google session; use integrated login.' : 'No session cookie in .env.local. Password login requires interactive browser challenges.'});
fs.mkdirSync('verification',{recursive:true}); fs.writeFileSync('verification/account-smoke.json',JSON.stringify(results,null,2)); console.log(JSON.stringify(results,null,2));
