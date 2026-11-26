# Compila la versión de prueba (con depuración) firmada con la llave de MURMUR y la instala en el
# teléfono conectado por ADB, encima de la que tenga (mismas firmas que los APK de GitHub).
# Uso: powershell -File scripts\dev\compilar-prueba.ps1 [-SinInstalar]
# Cierra antes «npm run dev»: su vigilante de archivos traba «cap sync».
param([switch]$SinInstalar)
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$access = & "E:\INEDITO\boveda\obtener-acceso.ps1" -Nombre murmur-firma
$env:MURMUR_KEYSTORE = $access.Url
$env:MURMUR_KEYSTORE_PASSWORD = $access.Credencial.GetNetworkCredential().Password
try {
  if (-not $env:JAVA_HOME) { $env:JAVA_HOME = Split-Path (Split-Path (Get-Command java).Source) }
  Push-Location $root
  cmd /c "npm.cmd run build 2>&1" | Select-Object -Last 2
  cmd /c "npx.cmd cap sync android 2>&1" | Select-Object -Last 2
  git checkout -- android/app/capacitor.build.gradle android/capacitor.settings.gradle 2>$null
  Push-Location android
  $log = cmd /c ".\gradlew.bat :app:testDebugUnitTest :app:lintDebug :app:assembleDebug -Pkotlin.incremental=false -Pabi=arm64-v8a -x compileSpotifyNative --console=plain 2>&1"
  $ok = $LASTEXITCODE -eq 0
  $log | Select-String "BUILD|FAILED|^e: |Error:|What went wrong" -Context 0,2 | Select-Object -Last 8
  Pop-Location
  if (-not $ok) { Pop-Location; throw "La compilación falló: no se instaló nada." }
  if (-not $SinInstalar) {
    & "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" install -r android\app\build\outputs\apk\debug\app-debug.apk
  }
  Pop-Location
} finally {
  Remove-Item Env:MURMUR_KEYSTORE_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:MURMUR_KEYSTORE -ErrorAction SilentlyContinue
}
