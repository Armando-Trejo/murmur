# Crea, una sola vez, la llave con la que se firman las versiones de MURMUR para compartir.
# La llave queda en la bóveda local (%LOCALAPPDATA%\Inedito-Boveda\murmur-release.jks) y su
# contraseña, cifrada con DPAPI, como acceso "murmur-firma". Nada de esto entra al repositorio.
# IMPORTANTE: si se pierde la llave, los usuarios tendrán que desinstalar para actualizar.
$ErrorActionPreference = "Stop"
$dir = Join-Path $env:LOCALAPPDATA "Inedito-Boveda"
$jks = Join-Path $dir "murmur-release.jks"
$entry = Join-Path $dir "murmur-firma.xml"
if ((Test-Path $jks) -or (Test-Path $entry)) { Write-Host "La llave ya existe; no se reemplaza."; exit 0 }
New-Item -ItemType Directory -Force $dir | Out-Null

# Contraseña aleatoria de 32 caracteres, solo en memoria.
$bytes = New-Object byte[] 24
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$plain = [Convert]::ToBase64String($bytes).Replace("+", "A").Replace("/", "B")
$secure = ConvertTo-SecureString $plain -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential("murmur", $secure)

$keytool = Join-Path $env:JAVA_HOME "bin\keytool.exe"
if (-not (Test-Path $keytool)) { $keytool = (Get-Command keytool).Source }
$env:MURMUR_KS_PASS = $plain
& $keytool -genkeypair -v -keystore $jks -storetype PKCS12 -alias murmur -keyalg RSA -keysize 4096 -validity 10000 `
  -storepass:env MURMUR_KS_PASS -keypass:env MURMUR_KS_PASS -dname "CN=MURMUR, O=Inedito Digital, C=MX" | Out-Null
Remove-Item Env:MURMUR_KS_PASS
if (-not (Test-Path $jks)) { throw "No se creó la llave" }

[pscustomobject]@{ Nombre = "murmur-firma"; Url = $jks; Nota = "Llave de firma de MURMUR (alias murmur). Respaldar el .jks junto con esta entrada."; Credencial = $cred; Fecha = (Get-Date).ToString("s") } |
  Export-Clixml -Path $entry
Write-Host "Llave creada y guardada en la bóveda como murmur-firma."
