param([string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot))
$ErrorActionPreference = 'Stop'
$apk = Join-Path $ProjectRoot 'android\app\build\outputs\apk\debug\app-debug.apk'
if (-not (Test-Path -LiteralPath $apk)) { throw 'APK not found' }
$envFile = Join-Path $ProjectRoot '.env.local'
$sensitiveValues = @()
if (Test-Path -LiteralPath $envFile) {
  foreach ($line in [IO.File]::ReadAllLines($envFile)) {
    if ($line -match '^[A-Z_]+=(.+)$') { $value = $Matches[1]; if ($value.StartsWith('"')) { $value = ConvertFrom-Json -InputObject $value }; if ($value.Length -ge 6) { $sensitiveValues += $value } }
  }
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($apk)
try {
  $entriesChecked = 0
  foreach ($entry in $archive.Entries) {
    if ($entry.FullName -match '(?i)(\.env|contraseñas|credentials\.txt)') { throw 'Unexpected sensitive file in APK' }
    $stream = $entry.Open(); $memory = [IO.MemoryStream]::new()
    try { $stream.CopyTo($memory); $bytes = $memory.ToArray(); $utf8 = [Text.Encoding]::UTF8.GetString($bytes); foreach ($value in $sensitiveValues) { if ($utf8.Contains($value)) { throw ('Credential content detected in APK entry: ' + $entry.FullName) } } } finally { $stream.Dispose(); $memory.Dispose() }
    $entriesChecked++
  }
} finally { $archive.Dispose() }
$result = [ordered]@{ package = 'com.personal.murmur'; appName = 'MURMUR'; artifact = $apk; bytes = (Get-Item -LiteralPath $apk).Length; sha256 = (Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash.ToLowerInvariant(); zipEntriesChecked = $entriesChecked; credentialValuesChecked = $sensitiveValues.Count; credentialLeakDetected = $false; checkedAtUtc = [DateTime]::UtcNow.ToString('o') }
$outputDir = Join-Path $ProjectRoot 'verification'; New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
$result | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $outputDir 'artifact.json') -Encoding utf8
$result | ConvertTo-Json
