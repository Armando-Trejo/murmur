# Compila la versión de MURMUR para compartir (firmada, sin depuración, solo arm64).
# Uso: powershell -File scripts\compilar-release.ps1
# La contraseña de la llave sale de la bóveda y pasa a Gradle por variables de entorno de este
# proceso; nunca se imprime ni se guarda.
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$access = & "E:\INEDITO\boveda\obtener-acceso.ps1" -Nombre murmur-firma
$env:MURMUR_KEYSTORE = $access.Url
$env:MURMUR_KEYSTORE_PASSWORD = $access.Credencial.GetNetworkCredential().Password
try {
  if (-not $env:JAVA_HOME) { $env:JAVA_HOME = Split-Path (Split-Path (Get-Command java).Source) }
  Push-Location $root
  npm.cmd run android:sync | Select-Object -Last 1
  Push-Location android
  .\gradlew.bat :app:assembleRelease "-Pkotlin.incremental=false" "-Pabi=arm64-v8a" -x compileSpotifyNative --console=plain |
    Select-String "BUILD|FAILED|error" | Select-Object -Last 5
  Pop-Location
  $version = (Get-Content package.json -Raw | ConvertFrom-Json).version
  $out = Join-Path $root "MURMUR-$version.apk"
  Copy-Item android\app\build\outputs\apk\release\app-release.apk $out -Force
  Write-Host "APK: $out"
  Pop-Location
} finally {
  Remove-Item Env:MURMUR_KEYSTORE_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:MURMUR_KEYSTORE -ErrorAction SilentlyContinue
}
