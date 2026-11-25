# Contexto para retomar MURMUR (sesión «seguimiento mkt», 24 nov 2026)

Léelo primero si continúas MURMUR en otra PC u otra sesión. El detalle técnico de cada versión está en [CONTINUAR-MURMUR.md](CONTINUAR-MURMUR.md), en las secciones de la 2.8.0 a la 2.14.0.

## Cómo trabaja el dueño del proyecto
- Todo en español. Cada encargo termina con un resumen de 2 a 5 líneas: qué quedó, qué falta y qué depende de él.
- Muchas veces escribe desde el celular. Los APK se le entregan como archivo en el chat para descargarlos desde ahí.
- Antes de decir «listo»: revisión crítica con capturas reales del teléfono o la vista previa en alto de celular, sin encimados ni textos que no se lean, y la acción principal clara. Que compile no basta.
- La calidad visual debe ser premium, moderna y fácil de usar, sin ser experimental.
- No escribir contraseñas en formularios. Las sesiones de YouTube Music y Spotify las inicia él en el teléfono.
- No inventar resultados: lo probado en el teléfono se dice como probado, y lo demás como no verificado.

## Estado actual: 2.14.1 (code 30)
La 2.14.1 se hizo en la PC RAM y recupera los arreglos de audio de la 2.7.1 que no habían pasado a la 2.8.0. El detalle está en [CONTINUAR-MURMUR.md](CONTINUAR-MURMUR.md). Es solo de prueba: falta firmarla para compartir.

La 2.14.0 (code 29) fue la primera versión para compartir: firmada para distribución, sin depuración, con bienvenida, Conexiones simplificada y reporte de cierres. Funciones de las últimas entregas:
- **La música no se detiene:** `src/core/continuation.ts`. Con 2 o menos canciones restantes agrega 12 afines sin repetir ninguna versión. En Buscar, tocar un resultado reproduce solo esa canción.
- **Respaldo de versiones:** `anotherVersion()` en `spotifyBridge.ts`. Si una plataforma no tiene la canción o está bloqueada, usa la otra o la salta.
- **Spotify suena con el motor de MURMUR** (su gemela de YouTube Music): no depende de la app de Spotify ni de Premium. Los motores propios de Spotify están en Opciones avanzadas.
- **Voz conversacional:** `VoiceIntentParser.ts` (controles por palabras clave, muletillas, verbos coloquiales y plataforma en cualquier parte de la frase) más `requestResolver.ts` (lo que no tiene forma fija se resuelve contra los catálogos de Spotify y YouTube Music). Los ambientes salen de playlists de YouTube Music.
- **«Ok MURMUR»:** Vosk local, cancelación de eco con música por la bocina y umbral adaptable. El dueño lo probó y funciona.
- **Recuerda la sesión:** cola, canción y segundo en `murmur.session`; reanuda con `startAtMs`.
- **Hecho para ti:** Descubrimiento diario (10) y semanal (20) que aprenden de lo que escuchas, guardas y saltas. Además: aleatorio mágico, editor de carátulas, buscador dentro de playlists y álbumes, mezcla al ritmo y descargas inteligentes por Wi-Fi.

## Pendiente
1. **Probar la 2.14.0 en el teléfono:** bienvenida, Conexiones, reporte de cierres y la voz con frases reales. Solo se probó en la vista previa web y con pruebas automáticas.
2. **Spotify para otros usuarios:** la app no trae Client ID integrado. El dueño escribe el suyo en Conexiones › Spotify › Opciones avanzadas. Para integrarlo hay que poner `VITE_SPOTIFY_CLIENT_ID=...` en `.env.local` (no se sube al repositorio) y compilar de nuevo. Spotify en modo desarrollo solo admite 25 usuarios dados de alta en su panel.
3. **Cosas que faltan para usuarios sin conocimientos técnicos:** aviso de actualización (hoy se mandan a mano), y probar la bienvenida en teléfonos con pantalla baja.
4. **Ideas de IA propuestas, sin implementar:** modelo de textos multilingüe de unos 30 MB en lugar del Universal Sentence Encoder (que está en inglés); un modelo de lenguaje opcional (Gemma de unos 500 MB) para conversación y un DJ que presente las canciones; perfiles por horario.
5. **GitHub:** desde la PC original, la cuenta `ineditodigital-sudo` no tenía permiso de escritura. La PC RAM sí subió versiones antes (la 2.7.0 está en `main`).
6. **Probar la 2.14.1 en el teléfono:** que una canción tocada en frío empiece más rápido y que reordenar la cola al final de una canción no deje silencio.

## Compilar
- **Requisitos:** Node 20+, JDK 17+, Android SDK (en `android/local.properties`, `sdk.dir` con `C\:/...` escapado). La librería nativa de Spotify (`libmurmurspotify.so`) **no** viene en el repositorio: `.gitignore` excluye `android/app/src/main/jniLibs/`. Hay que copiarla de una compilación anterior a `android/app/src/main/jniLibs/<abi>/` y compilar con `-x compileSpotifyNative`, o compilarla con Rust (`scripts/build-spotify-native.mjs`). El código de `native/` no cambia desde la 2.5.1.
- **Firmas de prueba por PC:** cada PC firma las versiones de prueba con su propio `~/.android/debug.keystore`. Las de la PC RAM llevan `78d2b623…` y las de la PC original `b2c540f0…`. Una versión de una PC no se instala encima de la de otra. Para que ambas PC produzcan la misma firma, hay que copiar el mismo `debug.keystore` a las dos por un medio seguro (USB), nunca por el repositorio.
- **Web:** `npm.cmd ci`, después `npx.cmd tsc -b` y `npx.cmd vitest run` (214 pruebas).
- **APK de prueba:** `npm.cmd run android:sync` y, desde `android`:
  `.\gradlew.bat :app:testDebugUnitTest :app:lintDebug :app:assembleDebug "-Pkotlin.incremental=false" "-Pabi=arm64-v8a" -x compileSpotifyNative --console=plain`
  En PowerShell los `-P` van entre comillas. Después de sincronizar, deshacer los cambios de saltos de línea: `git checkout -- android/app/capacitor.build.gradle android/capacitor.settings.gradle`.
- **APK para compartir:** `scripts/compilar-release.ps1`. Necesita la llave de la bóveda local de la PC original (`murmur-firma` y `murmur-release.jks` en `%LOCALAPPDATA%\Inedito-Boveda`). **Solo esa PC puede firmar las versiones para compartir.** Si la llave se lleva a otra PC, tiene que ir por un medio seguro, nunca por el repositorio.
- Las versiones de prueba y las de compartir tienen firmas distintas. Para cambiar de una a otra en el teléfono: Exportar respaldo, desinstalar, instalar e Importar respaldo.
- **Vista previa web:** `npm.cmd run dev`; abrir `http://localhost:5173/?bienvenida` para ver la bienvenida (con viewport de 390×844 y de 360×640).

## Probar en el teléfono (solo con la versión de prueba, que permite depuración)
- **ADB:** `%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe`. En Windows a veces hay que reautorizar la depuración USB.
- **Inspeccionar la app:** `adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>` y luego `node scripts/dev/cdp.mjs "<expresión JS>"`.
- **Comandos de voz sin hablar:** `scripts/dev/voz.ps1 "ponme bailarina de miranda en spotify"`. Manda el texto como si lo dijera el reconocedor y muestra qué entendió MURMUR (`voice:log`) y qué está sonando.
- **Ver la escucha de «Ok MURMUR»:** `adb shell setprop log.tag.MURMUR DEBUG` y luego `adb logcat -s MURMUR` (líneas «wake mic»).
- La versión para compartir no permite inspeccionarla por dentro: con ella solo sirven logcat, capturas y el reporte de cierres.

## Decisiones tomadas (no volver a discutir)
- Spotify reproduce con su gemela de YouTube Music. librespot y el Web SDK fallan por restricciones de Spotify (claves de audio rechazadas, sin DRM en WebView), y el dueño pidió no depender para nada de la app de Spotify.
- Spotify ya no permite leer playlists ajenas en modo desarrollo. Los ambientes usan playlists de YouTube Music: `youtubePlaylists`, y hay que quitar el prefijo «VL» antes de llamar a `youtubeCollection`.
- La voz entiende sin comandos fijos: unas pocas reglas para los controles y, para la música, los catálogos deciden.
- No se publica en Google Play, porque extraer audio de YouTube va contra sus reglas. Se distribuye el APK directo.
