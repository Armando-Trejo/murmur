# Prueba un comando de voz en el teléfono sin hablar (solo con la versión de prueba, que permite depuración).
# Uso: powershell -File scripts\dev\voz.ps1 "ponme bailarina de miranda en spotify" [segundos]
# Manda el texto como si lo hubiera escrito el reconocedor de voz y muestra qué entendió MURMUR,
# qué respondió y qué está sonando.
param([Parameter(Mandatory)][string]$Text, [int]$Wait = 12)
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
$cdp = Join-Path $PSScriptRoot "cdp.mjs"
$appPid = (& $adb shell pidof com.personal.murmur).Trim()
if (-not $appPid) { throw "MURMUR no está abierto en el teléfono" }
& $adb forward tcp:9222 localabstract:webview_devtools_remote_$appPid | Out-Null
$escaped = $Text.Replace('"', '\"')
& $adb shell am start -n com.personal.murmur/.MainActivity --es voice_text "'$escaped'" 2>&1 | Out-Null
Start-Sleep $Wait
node $cdp "(async () => { const s = await window.Capacitor.Plugins.YouTubeAudio.getState(); const log = await new Promise(r => { const q = indexedDB.open('HybridSound'); q.onsuccess = () => { const t = q.result.transaction('settings').objectStore('settings').get('voice:log'); t.onsuccess = () => r(t.result?.value?.[0]); }; }); return JSON.stringify({ entendio: log?.understood, respuesta: log?.answer, suena: s.track && (s.track.title + ' | ' + s.track.artist + ' | ' + (s.track.bridgedFrom || s.track.source)), siguen: (s.queue || []).slice(1, 4).map(t => t.title + ' - ' + t.artist) }); })()"
