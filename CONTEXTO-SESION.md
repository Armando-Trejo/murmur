# Contexto para retomar MURMUR (sesión «seguimiento mkt», 24 nov 2026)

Léelo primero si continúas MURMUR en otra PC u otra sesión. El detalle técnico de cada versión está en [CONTINUAR-MURMUR.md](CONTINUAR-MURMUR.md), en las secciones de la 2.8.0 a la 2.14.0.

## Cómo trabaja el dueño del proyecto
- Todo en español. Cada encargo termina con un resumen de 2 a 5 líneas: qué quedó, qué falta y qué depende de él.
- Muchas veces escribe desde el celular. Los APK se le entregan como archivo en el chat para descargarlos desde ahí.
- Antes de decir «listo»: revisión crítica con capturas reales del teléfono o la vista previa en alto de celular, sin encimados ni textos que no se lean, y la acción principal clara. Que compile no basta.
- La calidad visual debe ser premium, moderna y fácil de usar, sin ser experimental.
- No escribir contraseñas en formularios. Las sesiones de YouTube Music y Spotify las inicia él en el teléfono.
- No inventar resultados: lo probado en el teléfono se dice como probado, y lo demás como no verificado.

## Estado actual: 2.20.0 (code 37)
La 2.20.0 hace que Spotify suene desde Spotify dentro de MURMUR (Web Playback SDK, sin la app de Spotify), guía para que cualquiera conecte su propia llave de Spotify, Android Auto, actualización desde la app, «Modo invitado» y un filtro para que pruebas o peticiones ajenas no entrenen el algoritmo. **Cambio de firma:** desde aquí todo va con la llave de release (`d03a64dd…`, solo en la bóveda de la PC Maindsoft). Detalle en [CONTINUAR-MURMUR.md](CONTINUAR-MURMUR.md).

### 2.19.0 (code 36)
La 2.19.0 trae la edición de la biblioteca (crear, renombrar, quitar y eliminar playlists, álbumes y canciones, sin que una sincronización lo deshaga), guardar un álbum sin llenar Guardadas, la carátula del álbum aplicada a sus canciones, instrucciones de voz de todos los días (volumen, repetir, quitar de favoritos) y una escucha que deja de confundir artistas.

**Ojo con la firma:** el 26 nov 2026 el teléfono se pasó a la llave de prueba de la PC RAM (`78d2b623...`). Hubo que desinstalar y reinstalar, y volver a iniciar sesión en YouTube Music y Spotify. Los respaldos de ese momento están en `../respaldo-telefono-2.18.0/`. Para que la PC Maindsoft vuelva a instalar encima, hay que llevarle `C:\Users\RAM\.android\debug.keystore` por USB.

### 2.18.0 (code 35)
La 2.18.0 trae el panel de voz con ondas y la elección de una voz más natural para el presentador y las respuestas.

### 2.17.1 (code 34)
La 2.17.1 agrega el indicador de voz en cada paso: escucha, búsqueda y preparación.

### 2.17.0 (code 33)
La 2.17.0 trae voz que busca primero en tu biblioteca por cómo suenan los nombres, buscador y ordenamientos en la biblioteca, mix del momento personal, modos de escucha de «Ok MURMUR» y botón de voz en el widget. Cada versión se publica también como release en GitHub con su APK (`gh` está en esta PC). Detalle en [CONTINUAR-MURMUR.md](CONTINUAR-MURMUR.md).

### 2.16.0 (code 32)
La 2.16.0 trae «Solo mi voz», respuestas habladas, presentador, temporizador por voz, widget, gestos nuevos, mix del momento y aviso de actualización. Detalle y lo que falta probar en [CONTINUAR-MURMUR.md](CONTINUAR-MURMUR.md). Lo de abajo describe la 2.15.0, que sigue vigente.

### 2.15.0 (code 31)
Hecha en la PC RAM e instalada en el teléfono del dueño por depuración inalámbrica (`adb connect <ip>:<puerto>`; el cable USB de esa PC falla). Trae:
- voz con doble comprobación de «Ok MURMUR» y comandos de control;
- nada de adivinar canciones;
- sliders con la duración real;
- respaldo automático en Descargas/MURMUR;
- gestos con animación.

El detalle está en [CONTINUAR-MURMUR.md](CONTINUAR-MURMUR.md). La 2.14.1 recuperó los arreglos de audio de la 2.7.1.

**Firma:** el teléfono tiene ahora versiones firmadas con la llave de prueba de la PC RAM (`78d2b623…`). Para que la PC original genere versiones que se instalen encima, copia `C:\Users\RAM\.android\debug.keystore` a `%USERPROFILE%\.android\debug.keystore` en esa PC por USB (respalda antes la suya). Sin la misma firma, cada cambio de PC obliga a desinstalar. La restauración desde `Descargas/MURMUR/murmur-respaldo.json` evita empezar de cero, pero hay que volver a iniciar sesión.

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
- **APK de prueba firmado como los de GitHub (desde 2.20):** `scripts/dev/compilar-prueba.ps1` compila con depuración, firma con la llave de release y lo instala encima por ADB. Cierra antes `npm run dev`: su vigilante traba `cap sync`.
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
- Spotify suena con el Web Playback SDK dentro de MURMUR (desde 2.20; Widevine en el WebView sí funciona en el teléfono del dueño). librespot sigue rechazado por Spotify. La gemela de YouTube Music queda como respaldo y para cuentas sin Premium. **No depender nunca de la app de Spotify** (lo reiteró el dueño el 26 nov 2026): Connect queda solo como opción avanzada.
- Spotify ya no permite leer playlists ajenas en modo desarrollo. Los ambientes usan playlists de YouTube Music: `youtubePlaylists`, y hay que quitar el prefijo «VL» antes de llamar a `youtubeCollection`.
- La voz entiende sin comandos fijos: unas pocas reglas para los controles y, para la música, los catálogos deciden. Desde 2.15 la música solo suena con un pedido explícito («pon», «quiero», «en Spotify»): MURMUR no adivina.
- «Ok MURMUR» comprueba la frase dos veces y solo abre el micrófono con la app en pantalla, con música o hasta 10 min después de pausar.
- No se publica en Google Play, porque extraer audio de YouTube va contra sus reglas. Se distribuye el APK directo.
