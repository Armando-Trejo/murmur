# Continuidad de MURMUR 2.11.0

## Estado de 2.11.0 (24 nov 2026, código 25)

Instalado en el HONOR del usuario. Novedades y dónde viven:

- **Hecho para ti** (`src/core/autoMixes.ts`, `src/components/MadeForYou.tsx`): Descubrimiento diario (10, se renueva cada día) y semanal (20, cada lunes) que aprenden de escuchas completas, guardados y saltos (`tasteProfile`; un salto de una recomendación pesa más). Candidatos: radio de YouTube (`RDAMVM`) de tus más escuchadas, artistas relacionados (Deezer vía `lookupArtist`) buscados en Spotify y YouTube Music; puntuación con acuerdo de fuentes, cercanía a tus artistas y el modelo local (`Voice.rankTags`). Solo canciones nunca escuchadas ni guardadas. Se renueva al abrir y cada 30 min si toca. Todo se guarda como playlists `auto:*` que **se abren** antes de reproducir. Se borran los mixes fijos `local:mix:*` de las primeras versiones y su carrusel del Inicio. Comprobado: diario y semanal generados con artistas afines (Psychedelic Porn Crumpets, Ween, IDLES, Death Grips…).
- **Mezclas por círculos de artistas** (`artistCircles` en `blendMixes.ts`): Spotify ya no entrega géneros de artistas; se agrupan por artistas relacionados.
- **Aleatorio mágico** (`AudioOrchestrator.cycleShuffle`, `src/core/magicShuffle.ts`): el botón cicla aleatorio → mágico (intercala ~1 canción afín cada 3, marcadas `smart` y «✦ Sugerida») → apagado (quita las agregadas y restaura el orden). Comprobado en el teléfono: 10 → 13 → 10.
- **Buscador dentro de playlists y álbumes** (más de 8 canciones), fijo al desplazar; un resultado reproduce la colección completa desde esa canción.
- **Carátulas propias** (`CoverEditor.tsx`): subir imagen (se guarda como JPEG 640 px en el teléfono), mover, zoom (`object-view-box`), recortar o completa, restaurar. En playlists/álbumes (menú ⋮) y canciones (opciones). Campos `customArtwork` y `artworkFrame`.
- **Portadas**: tamaños por uso (`Cover size="small"` pide ~300 px en listas, antes 640 px por miniatura de 44 px), playlists sin carátula con la de su primera canción.
- **Reproductor que cabe** (`useFitCover`): la portada toma el alto que sobra tras título, barra y controles; artista y álbum en una línea. Probado a 360×640.
- **Biblioteca sin duplicados** (`src/core/dedupe.ts`): misma canción en Spotify y YouTube se muestra una vez (mismo título sin «Remaster/feat.», artista principal y duración ±4 s); versiones en vivo/remix quedan aparte.
- **Transición mini → reproductor**: la portada vuela del mini a la grande con el fondo opaco temprano y tamaño final ya calculado (`PlayerLayer`).
- **Descargas inteligentes** (`src/core/smartDownloads.ts`): solo en red no medida (Wi-Fi), tus 30 más escuchadas (Spotify vía gemelo de YouTube), se borran solo las propias al salir del top; interruptor en Conexiones. Nativo: `networkState`, `deleteOfflineAudio`.
- **Mezcla DJ al ritmo** (`HybridMediaService`): en los últimos 25 s mide el tempo con los golpes del analizador; el fundido dura 8 (Suave) o 16 (DJ) tiempos y arranca sobre un golpe. Sin pulso estable usa el fundido normal. **Pendiente: escucharlo en el teléfono.**

YouTube Music aparece desconectado porque su sesión se borró en la reinstalación de 2.8.0 (llave de Keystore); hay que volver a iniciar sesión en Conexiones.

Verificación: 189 pruebas web, 97 Android, lint 0 errores.

---

# Historial: continuidad de MURMUR 2.10.0

## Estado de 2.10.0 (24 nov 2026, código 24)

Instalado y probado en el HONOR Magic8 Lite del usuario (Android 16) por ADB.

- **Spotify sin la app de Spotify.** Spotify niega las llaves de audio a librespot en esta cuenta (`audio key error 0 1`, bloqueo de cuenta reportado en librespot#1649, sin solución) y su Web Playback SDK no tiene DRM en Android WebView. Requisito del usuario: no depender de la app de Spotify. Ahora, al rechazo, `HybridMediaService.fallBackFromEngine` emite `SPOTIFY_RETRY_YOUTUBE`; la capa web guarda `localStorage murmur.spotifyVia=youtube` y reproduce el **gemelo de YouTube Music** (`src/core/spotifyBridge.ts`: búsqueda en la pestaña Canciones con `Auth.youtubeSongs`, puntuación por título, artista y duración, rechaza en vivo/covers; caché `twin:v1:` en `db.settings`). La entrada conserva `queueId`, metadatos de Spotify y `bridgedFrom: "spotify"`; las 3 siguientes se resuelven por adelantado para que el motor nativo las precargue y encadene sin corte. Medido en el teléfono: primera canción ~7 s (espera el rechazo), siguientes 0,5 s; la app de Spotify no se abre. Connect sigue existiendo pero ya no es la salida automática.
- **Encabezado.** `useHeaderScroll` pone `data-header` en `<html>`: transparente arriba de todo, se oculta al bajar y reaparece al subir, de borde a borde y con desvanecido (antes era un bloque oscuro con orillas).
- **«Ok MURMUR».** `WakeWordService` (servicio en primer plano tipo micrófono) con Vosk sin conexión (`com.alphacephei:vosk-android:0.3.47`, modelo `vosk-model-small-es-0.42` de ~39 MB descargado al activar, en `files/models/vosk-es`). Gramática corta (el modelo no tiene «murmur»; detecta «ok/okey murmura/murmuro/mur…», `WakeWordService.heard`) y un detector de voz por RMS (>800) que no decodifica el silencio. Al oír la frase: baja la música, pulso, `SpeechRecognizer` de Android captura la petición y llega como `onVoiceCommandCaptured` (retenido si la app está cerrada). Interruptor en Conexiones (`WakeWordSetting`), apagado por defecto; notificación fija y punto verde del micrófono mientras está activo. CPU: 68 % de un núcleo sin gramática → ~7 % con gramática → ~0 % en silencio con el umbral. Confirmado por el usuario en su teléfono. La captura de la petición prueba el reconocedor sin conexión, luego el de Google en línea (el HONOR no tiene español sin conexión) y al final Vosk libre.
- **Batería, interfaz.** La aurora de la bienvenida (3 animaciones infinitas bajo `filter: blur(40px)`) costaba ~60 % de un núcleo en RenderThread y ~45 % en el compositor con la app quieta. Ahora degradados sin filtro y 2 ciclos de animación: 0 % en reposo.
- **Escritura.** Cursor visible (`caret-color`), resaltado de selección, contorno al enfocar la búsqueda, y las pestañas se ocultan mientras el teclado está abierto.
- Perfiles: con varios artistas gana el primero acreditado. Álbumes: duraciones en canciones de álbum y búsqueda con resultado principal de YouTube y Spotify (límite 10).

Verificación: 184 pruebas web, 97 Android, lint 0 errores. En el teléfono: Spotify vía YouTube, gapless en álbum (sin `AudioTrack` nuevo en el cambio), pantalla musical sobre el bloqueo, búsqueda de álbumes, mezclas por círculos de artistas, encabezado, cursor y consumo. «Permanecer activo» (`svc power stayon usb`) quedó encendido en el teléfono por pedido del usuario para las pruebas.

---

# Historial: continuidad de MURMUR 2.9.0

## Estado de 2.9.0 (24 nov 2026, código 23)

Instalado en el HONOR del usuario encima de 2.8.0 (misma firma de esta PC, datos conservados). Responde a su prueba de 2.8.0.

- **Sin corte entre canciones (gapless).** Los registros mostraban un `AudioTrack` nuevo en cada cambio: la siguiente canción sonaba en el segundo reproductor. Ahora, con Auto-Mix apagado y siempre dentro de un mismo álbum (`albumId`, o mismo álbum y artista), la siguiente se agrega a la lista del **mismo** ExoPlayer (`HybridMediaService.chainNext`/`adoptChained`, `wantsGapless`) y suena sobre la misma salida de audio. Con Auto-Mix entre canciones de distinto álbum se conserva el fundido con el segundo reproductor. Prueba: `GaplessChainTest` (la transición natural sólo se puede comprobar en el teléfono: Robolectric no llega a READY).
- **Pantalla musical al bloquear.** `MainActivity.onPause`/`ACTION_SCREEN_OFF`: si la pantalla se apaga con MURMUR al frente y suena música, abre `MusicVisualActivity` (ya tenía `showWhenLocked`; ahora `setTurnScreenOn(false)`), que hace de carátula de bloqueo con reloj. Cerrarla pide desbloquear (`requestDismissKeyguard`). Interruptor «Pantalla musical al bloquear» en Conexiones › Tu acento (`LockVisualizer`, `playback.lock_visualizer`, activado por defecto).
- **Perfiles de artista.** Antes, si no había coincidencia exacta se tomaba el primer canal de artista de la búsqueda (a menudo otro artista). Ahora `YouTubeMusicPages.artistNames` separa créditos («feat.», «,», «&», «x», «- Topic», «VEVO») y `matchingArtistChannel` sólo acepta un nombre exacto (sin acentos, mayúsculas ni «The»), buscando en la pestaña Artistas. Sin coincidencia se muestra el aviso y la biblioteca local. Prueba: `ArtistMatchTest`.
- **Búsqueda de álbumes.** Filtro «Álbumes» en Buscar y carrusel de álbumes arriba de los resultados en «Todo». YouTube Music (`youtubeAlbums`, pestaña Álbumes) y Spotify (`/search?type=album`), intercalados. El + guarda el álbum completo en la biblioteca (`saveCollection`); tocarlo abre el álbum (`feed:MPREb…` o `feed:spalbum-<id>`). Código: `src/core/albumSearch.ts`, `src/components/AlbumResults.tsx`.
- **Mezclas MURMUR** en Inicio (`src/core/blendMixes.ts`, `src/components/BlendMixes.tsx`): top tracks y top artists (con géneros) de Spotify, Inicio de YouTube Music, radio de YouTube (`RDAMVM<videoId>`) a partir de tus canciones y tu historial en MURMUR. Los géneros se agrupan en familias por palabras clave y, si el modelo local de 6 MB está descargado, con `Voice.rankTags`. Genera «Tu mezcla MURMUR», hasta 3 «Mezcla · <familia>», «Descubrimiento cruzado» (sólo canciones nuevas) y «Radio de <canción>». Caché de 12 h en `db.settings` `blend:v1`; el + las guarda como playlist híbrida.
- **Spotify integrado.** Tras la reinstalación, Spotify autentica el motor librespot pero rechaza las llaves de audio (`audio key refused`, error 0 1), un bloqueo del lado de Spotify. Ahora, al recibir `key_refused`, si la autorización de la biblioteca tiene los permisos del reproductor Web, la misma canción sigue en **Integrado · Web** y ese modo queda guardado (`HybridMediaService.fallBackToWeb`). Si no, se muestra el aviso para cambiarlo en Conexiones.
- La precarga de enlaces de 2.7.1 (`prefetchAudio`) y `SecurePrefs` siguen igual que en 2.8.0.

Verificación: 180 pruebas web, 95 Android, lint 0 errores. Pendiente en teléfono: fin natural de canción en álbum y con Auto-Mix apagado, bloqueo con música, búsqueda de álbumes, mezclas y Spotify Web.

---

# Historial: continuidad de MURMUR 2.8.0

## Estado de 2.8.0 (24 nov 2026)

Repositorio local en `D:/Armando/Nueva carpeta/murmur`, remoto `https://github.com/Armando-Trejo/murmur.git`, rama `main`. Responde a la prueba del usuario con 2.7.0: cortes breves entre canciones, siguiente canción que entra adelantada un minuto o más, reproducción poco inmediata, bloques sólidos en la interfaz y uso de caché, buffer, batería y datos.

Causa raíz de los cortes y del adelanto: tras el primer cambio preparado, el reproductor de reserva es el antiguo principal y `stop()` conserva `playWhenReady = true`. Cada precarga siguiente sonaba en silencio (volumen 0) mientras se escuchaba la actual. Al llegar el relevo, `startOverlap` la metía ya avanzada, o `playPrepared` la rechazaba (`currentPosition != 0`) y abría la pista en frío, con un corte. Además descargaba y decodificaba la canción entera de más (datos y batería).

- `HybridMediaService.preloadSource` y `promotePrepared` dejan la reserva con `playWhenReady = false`. `playPrepared` acepta una precarga en `BUFFERING` y rebobina si se desvió más de `PRELOAD_START_TOLERANCE_MS`; `startOverlap` nunca mezcla una precarga desviada. Prueba: `PreloadParkingTest`.
- Caché de audio en disco: `MediaCache.kt` (`SimpleCache` de 256 MB en `cacheDir/media3_audio`, LRU). La clave es `yt:<videoId>:<itag>:<clen>` porque la firma del enlace cambia en cada resolución. Sólo pasa por caché el audio progresivo de googlevideo; locales, HLS y DASH van directo. Prueba: `MediaCacheTest`.
- Enlaces resueltos: `NativeNetwork.resolveAudio` los reutiliza hasta 3 h (48 entradas) mientras les queden más de 20 min antes de `expire`; antes caducaban a los 5 min.
- Buffer: 20–60 s (ráfagas de radio más largas y espaciadas), 700 ms para arrancar y 2 s tras una pausa por red. `WAKE_MODE_NETWORK` mantiene el Wi-Fi activo con la pantalla apagada.
- Datos móviles: con red medida la siguiente canción se precarga después de 12 s de escucha o en los últimos 90 s, así que un salto rápido no paga la descarga.
- Batería: el ticker nativo baja a 2 s cuando no suena nada y el progreso a la WebView va cada 500 ms en pantalla, cada 2 s en segundo plano y sólo si cambia en pausa (`MainActivity.onStart/onStop` → `HybridMediaService.uiVisible`). El sondeo de Spotify no consulta mientras está en pausa y la app oculta.
- Interfaz: `src/v28.css` (importado al final). Barra superior, minirreproductor y pestañas pasan de bloques negros opacos (~230 px) a vidrio translúcido con desenfoque sobre un degradado corto; el minirreproductor es una tarjeta flotante de 16 px de radio; la lista termina libre bajo los controles. Respaldo casi opaco si no hay `backdrop-filter`.

Compilación sin Rust en esta PC: `libmurmurspotify.so` (arm64) se tomó del APK 2.7.0 que entregó el usuario y se compila con `-Pabi=arm64-v8a -x compileSpotifyNative`. `jniLibs/` sigue fuera de git.

Instalación del 24 nov 2026: el teléfono (HONOR Magic8 Lite, Android 16) tenía **2.7.1, código 21**, compilado fuera de este repo. Su único cambio frente a 2.7.0 era la precarga de enlaces (`prefetchAudio`), que se trasladó a 2.8.0 (`src/core/prefetch.ts` y `YouTubeAudioPlugin.prefetchAudio`). 2.8.0 pasó a **código 22**. Como 2.7.1 estaba firmado con la clave de otra PC (`78d2b623…`), se desinstaló y se instaló 2.8.0 firmado con la clave de esta PC (`b2c540f0…`); las siguientes versiones compiladas aquí ya se instalan encima. Los datos se respaldaron antes con `run-as … tar` (la app de depuración lo permite) en `D:\Armando\Nueva carpeta\murmur-respaldo-2.7.1\`, junto con el APK 2.7.1, y se restauraron. Las sesiones cifradas no sobreviven a la desinstalación (la llave de Keystore se borra): `SecurePrefs` las descarta en vez de cerrar la app, y hay que reconectar YouTube Music y Spotify.

ADB en esta PC: Windows asignaba WinUSB genérico a la interfaz ADB del HONOR (VID 339B). Se agregó `DeviceInterfaceGUIDs = {F72FE0D4-CBCB-407d-8814-9ED673D0DD6B}` en `HKLM\SYSTEM\CurrentControlSet\Enum\USB\VID_339B&PID_107D&MI_01\…\Device Parameters`, con permiso del usuario.

### Primera prueba en teléfono para 2.8.0

| Caso | Resultado esperado |
| --- | --- |
| Lista de 5+ canciones de YouTube con Auto-Mix apagado, dejarla correr | Cada canción entra desde 0:00, sin corte audible. |
| Lo mismo en Suave y DJ | Fundido; la entrante empieza desde el inicio. |
| Siguiente en la app y en la notificación tras 20 s de escucha | Cambio inmediato (precarga lista). |
| Repetir una canción ya escuchada sin red | Suena desde la caché mientras esté guardada. |
| Pantalla apagada 30 min con Wi-Fi | Sin cortes ni pausas por red. |

---

# Historial: continuidad de MURMUR 2.7.0

## Estado para retomar

Repositorio local en `D:/PROYECTOS IA/APP HYBRIDA`, remoto `https://github.com/Armando-Trejo/murmur.git`, rama `main`. El commit de esta entrega se titula «Publica MURMUR 2.7.0: mixes, letras, perfiles y pantalla musical». APK `com.personal.murmur` 2.7.0, código de versión 20, firmado con la misma clave local de depuración que 2.6.0, así que se instala encima conservando biblioteca y sesiones. Para enviarlo al teléfono por la app se compila además un APK sólo arm64 (`-Pabi=arm64-v8a`, ~20 MB) porque el universal supera el límite de 30 MB.

La entrega responde a la prueba del usuario con 2.6.0. Qué cambió y dónde vive:

- Mixes de YouTube: `YouTubeLibraryReader.mix()` pide la cola al endpoint `next` (`playlistId` RD…), parseada por `YouTubeMusicPages.watchPlaylist`. `AuthBridgePlugin.youtubeCollection` prueba con sesión, luego en público (`YouTubeLibraryReader("")` con `PUBLIC_CLIENT_VERSION`) y luego NewPipe, y conserva el primer fallo real. Las peticiones públicas usan la operación `public_music`: su 401/403 da `YOUTUBE_CONTENT_UNAVAILABLE` y ya no marca la sesión como no verificada. La causa del fallo anterior era pedir `browse VLRD…`, que YouTube responde sin contenido.
- Álbum y artista: `YouTubeMusicPages.header` (título, artista, año, portada) completa portada y artista de las filas de álbum; `youtubeArtist({id|name})` resuelve el canal por búsqueda y devuelve foto, descripción, audiencia y estantes. UI en `src/components/ArtistProfile.tsx` (ruta `artist` + `artistId`) y la cabecera `collection-hero` de `App.tsx`.
- Portadas: `src/core/artwork.ts` (`sizedArtwork`, `isLetterboxed`, candidatas ordenadas) y `src/components/Cover.tsx` (reintentos y `online`). En Kotlin, `YouTubeArtwork.hd` (544 px en listas, 1 080 en la notificación).
- Cola: `AudioOrchestrator.enqueue` acepta una o varias pistas y las inserta tras la actual y tras las marcadas `userQueued` (FIFO). `playList` limpia la marca.
- Paso entre canciones: `HybridMediaService.watchTail` programa `tailHandoff` 240 ms antes del final (también con Auto-Mix apagado, `startOverlap(force = true)`) y adelanta el cambio si detecta 700 ms de silencio en los últimos 6 s de una pista que tuvo señal. `configureEnhancer` sólo engancha `LoudnessEnhancer` en directos.
- Letras: `getLyrics` en `DiscoveryEngine.ts` limpia título y artista (`lyricsQuery`), consulta `api/get` y `api/search` de LRCLIB con `pickLrclib` y, si no hay letra, `Auth.youtubeLyrics` (pestaña de letra de YouTube Music, normalmente LyricFind). Caché `lyrics:v3:` sólo con resultados.
- Interfaz: `OverflowMenu.tsx` (portal, abre hacia arriba cerca del borde, teclado), bienvenida `welcome-hero`, flecha de volver en la barra superior (se quitó la barra Atrás/Adelante), ajustes plegados en Conexiones, gestos de `SwipeSurface` (prop `reveal`, umbral con háptico, rebote), portada del reproductor deslizable, hoja de opciones arrastrable desde el asa y onda de tinta global. Estilos en `src/v27.css`, importado al final.
- Pantalla musical: `VisualSpectrumAnalyzer.kt` (`VisualPcmTap` sin bloqueos escrito desde el hilo de audio en `Meter` y en `SpotifyPcmOutput`; `SpectrumAnalyzer` con ventana Hann, FFT, 36 bandas logarítmicas, graves/medios/agudos y golpes con media adaptable y periodo refractario). `VisualClockSink.kt` (un `ForwardingAudioSink`) alinea el análisis con la posición audible, unos 250 ms por detrás de lo decodificado. API: `HybridMediaService.visualSpectrum(frameTimeNanos)` devuelve una instancia reutilizada; `visualAmplitude` sigue disponible y lo usa `watchTail`. Dibujo en `AuraStageView.kt` (fluido de `LiquidField.kt`, anillo, disco, ráfagas, franja y vibración) y `DotMatrix.kt` (reloj de 5×9 puntos). `VisualizerRenderTest` escribe fotogramas en `android/app/build/visualizer-preview/`; `MusicVisualActivityTest` reescribe `verification/visualizer-25.png`.

## Primera tarea del siguiente modelo

Instalar el APK 2.7.0 sobre 2.6.0 en el teléfono del usuario y recorrer esta matriz. No hubo teléfono conectado por ADB en esta sesión.

| Caso | Resultado esperado |
| --- | --- |
| Abrir varios mixes del Inicio de YouTube Music (Supermix, Mix de artista, radio de una canción) | Se abren con 25–100 canciones, sin «YouTube no autorizó la biblioteca privada». Reproducir y Guardar colección funcionan. |
| Pasar entre canciones con Auto-Mix apagado y en Suave | No se oye corte. En apagado el cambio es inmediato; en Suave hay fundido. |
| Añadir A, B y C a la cola (menú y deslizando) | Suenan A, B, C justo después de la actual y antes del resto de la lista. |
| Letras de canciones de YouTube Music, de videos y de Spotify | Aparece la letra dentro de la app (sincronizada si LRCLIB la tiene, si no la de YouTube Music) con su crédito. |
| Portadas en listas, reproductor, álbum, artista y notificación | Nítidas, sin franjas negras; si una falla, aparece otra al poco o al volver la red. |
| Tocar el artista en el reproductor y un artista del Inicio | Abre el perfil dentro de MURMUR con foto, Populares, álbumes y afines. |
| Pantalla musical (icono ✦ del reproductor) | Fluida, reacciona a los golpes de bajo y cambia de color con la portada. |
| Gestos | Deslizar filas revela «A la cola» y vibra al cruzar el umbral; deslizar la portada cambia de canción; arrastrar la hoja hacia abajo la cierra. |

## Verificación de 2.7.0

- `npx vitest run`: 169 pruebas web en 17 archivos. Nuevas: orden FIFO de la cola, carátulas por tamaño y franjas, `lyricsLookup.test.ts` (limpieza de títulos, elección en LRCLIB, LRC con varias marcas, respaldo de YouTube Music, error de red).
- `.\gradlew.bat :app:testDebugUnitTest :app:lintDebug :app:assembleDebug -Pkotlin.incremental=false`: 86 pruebas Android, 1 omitida (smoke de red), lint con 0 errores y 99 avisos. Nuevas: `YouTubeMusicPagesTest`, `SpectrumAnalyzerTest`, `VisualizerRenderTest`.
- `apksigner verify`: esquema v2, misma huella SHA-256 `78d2b623…` que 2.6.0, `versionName 2.7.0`, `versionCode 20`, tanto en el universal (`MURMUR-2.7.0.apk`, 40,4 MiB) como en el arm64 (`MURMUR-2.7.0-arm64.apk`, 20,2 MiB). Los cinco archivos web coinciden con `dist`; `scripts/verify-artifact.ps1` no detecta credenciales.
- Vista previa revisada en Chrome a 375 px y 768 px: bienvenida, perfil de artista, cabecera de álbum, menús ⋮, Conexiones plegado, portada deslizable y letras, sin errores de consola ni desbordes horizontales. La demo incluye un artista y un álbum de ejemplo.

## Historial: estado de 2.6.0

Repositorio local en `D:/PROYECTOS IA/APP HYBRIDA`, remoto `https://github.com/Armando-Trejo/murmur.git`, rama `main`. El commit de esta entrega se titula «Publica MURMUR 2.6.0: experiencia premium». APK `com.personal.murmur` 2.6.0, código de versión 19, firmado con la misma clave local de depuración que 2.5.1, así que se instala encima conservando biblioteca y sesiones.

Lo nuevo de 2.6 y dónde vive:

- Fondo del reproductor y tono del minirreproductor: `src/core/palette.ts`, `src/components/PlayerBackdrop.tsx`, estilos en `src/premium.css`. Depende del ajuste Luz ambiental (`data-glows`).
- Letras sincronizadas: `src/core/lyrics.ts` y `src/components/SyncedLyrics.tsx`, montado dentro del panel Letras de `App.tsx`.
- Tu resumen: `src/core/insights.ts` y `src/components/ListeningInsights.tsx`; ruta `#/library?directory=insights`.
- Búsquedas recientes: `src/core/recentSearches.ts`, guardadas en `db.settings` con la clave `search.recent` (viajan en los respaldos).
- Temporizador: hoja `sleep` en `useInterfaceNavigation.ts`; `setSleepTimer({minutes:-2})` arma `HybridMediaService.sleepAtTrackEnd`. YouTube cierra con un fundido en los últimos 6 s; Spotify integrado se detiene en `end_of_track` mediante el nuevo callback `onEnded` de `SpotifyIntegratedPlayer`. El servicio emite `onSleepTimerFinished`.
- Hápticos: `src/core/haptics.ts` → `YouTubeAudio.haptic` → `HapticPatterns.kt` (`performHapticFeedback`, sin permiso de vibración). Preferencia `murmur.haptics` en localStorage.
- Métricas toque→audio: `src/core/PlaybackMetrics.ts` (`SelectionTimer` dentro de `AudioOrchestrator.update`) y `src/components/PlaybackDiagnostics.tsx`. Guarda hasta 80 muestras en localStorage con códigos saneados, sin mensajes ni URLs.

## Historial: verificación de 2.6.0

- `npm.cmd test`: 162 pruebas web en 15 archivos (incluye `premium.test.ts` y `AudioOrchestrator.metrics.test.ts`).
- `.\gradlew.bat :app:testDebugUnitTest :app:lintDebug :app:assembleDebug -Pkotlin.incremental=false`: 69 pruebas Android, 1 omitida (smoke de red), lint con 0 errores. Nuevas: `SleepAndHapticsTest` y `SpotifyIntegratedPlayerTest.naturalEndUsesTheEndCallbackInsteadOfSkipping`.
- `apksigner verify`: esquema v2, `versionName 2.6.0`, `versionCode 19`. Los cinco archivos web del APK coinciden byte a byte con `dist`. `scripts/verify-artifact.ps1` no detecta credenciales.
- Vista previa `preview/MURMUR-animaciones.html` (regenerar con `node scripts/build-motion-preview.mjs`) revisada en Chrome a 375 px y 768 px, sin errores de consola ni desbordes. Ahora incluye historial y letra sintéticos, marcados como demostración.

Propuestas para la siguiente iteración: [PREMIUM-ROADMAP.md](PREMIUM-ROADMAP.md).

---

# Historial: continuidad de MURMUR 2.5.1

## Estado de 2.5.1

Repositorio local en `D:/PROYECTOS IA/APP HYBRIDA`. MURMUR es una app Android con interfaz React/Capacitor, Media3 para YouTube y tres modos de Spotify. El APK de esta entrega usa `com.personal.murmur` y el código de versión 18. La vista previa HTML usa pistas y pulso de demostración.

- El inicio y la vuelta de segundo plano respetan una selección mientras se carga. `AudioOrchestrator.init` descarta restauraciones tardías y `refreshNativeState` evita que la pista saliente desplace a la que el usuario acaba de elegir.
- `HybridMediaService` conserva la última posición solicitada durante la recuperación de YouTube. La WebView y `MusicVisualActivity` leen esa posición mientras se resuelve la fuente. Pausar o cambiar de pista invalida la recuperación anterior. Volver al principio de la misma pista actualiza la posición sin abrir otra solicitud.
- El aura usa transitorios del PCM disponible. Spotify Web usa movimiento ambiental. Genius se abre como búsqueda desde Letras, y LRCLIB devuelve las letras dentro de la aplicación.
- El Inicio de YouTube Music usa la sesión guardada. Spotify muestra la actividad de la cuenta vía OAuth y enlaza a su Inicio oficial. La ruta de Spotify Pathfinder en Rust queda experimental. `REPOSITORY-REVIEW.md` recoge los repositorios y requisitos de autenticación.

Lee primero el [plan completo para el siguiente agente](SIGUIENTE-AGENTE.md).

## Pruebas pendientes de 2.5.1

Validar el APK 2.5.1 sobre una instalación existente con las dos cuentas conectadas. El desarrollo automatizado no dispone de teléfono conectado. Si el usuario reporta un fallo, anotar proveedor, modo Spotify, acción de transporte, si había red y si cambia la posición o la entrada de la cola. Reproducir ese caso antes de reescribir el motor.

| Caso | Resultado esperado |
| --- | --- |
| Tocar A, B y C con rapidez y volver a primer plano | C conserva el título y la selección. La primera reproducción de C empieza en cero. |
| Quitar y devolver Wi-Fi durante YouTube | La misma entrada se recupera o muestra una acción de reintento. Mover el deslizador durante la recuperación ajusta el punto de retorno. |
| Intentar avanzar desde la notificación a una pista inaccesible | La pista queda disponible en la cola. Probar también Anterior y Siguiente con una pista local conocida. |
| Ir a segundo plano o bloquear y luego retirar MURMUR de Recientes | El audio continúa en segundo plano y con el teléfono bloqueado. Retirar la tarea detiene la reproducción. |
| Abrir la pantalla musical durante YouTube y Spotify integrado | El aura responde al audio disponible. Con movimiento reducido se mantiene estática. |
| Abrir Letras en una pista conocida | LRCLIB muestra letras cuando hay coincidencia. Genius recibe el título y el artista en la búsqueda. |

Punto de entrada técnico. Revisar `src/core/AudioOrchestrator.ts`, `HybridMediaService.kt`, `YouTubeAudioPlugin.kt` y `PlaybackRequests.kt`. Los saltos de Android y la WebView comparten el contador de solicitudes. Validar por `queueId` para distinguir canciones repetidas. Si hacen falta trazas, registrar origen, etapa, código de error y tiempos. Usar identificadores de cola y mantener cookies, tokens y URLs firmadas fuera de los registros.

## Artefactos y verificación

- APK firmado en `android/app/build/outputs/apk/debug/app-debug.apk`.
- Demo en `preview/MURMUR-animaciones.html`. Regenerar con `node scripts/build-motion-preview.mjs`.
- Pruebas JS con `npm.cmd test`. Tras `npm.cmd run android:sync`, ejecutar `.\gradlew.bat :app:testDebugUnitTest :app:lintDebug :app:assembleDebug -Pkotlin.incremental=false` desde `android` con JDK 21. El smoke público se puede activar con `-PnetworkSmoke=true`.
- `verification/vitest-251.json`, `session251-native.log` y `session251-browser.log` contienen el detalle de la última entrega.

Verificación de 2.5.1. Pasaron 143 pruebas web, 65 de Android, lint y tres tamaños en Chrome. El smoke público se dejó fuera de esta ejecución. Verifiqué la firma v2 del APK y que sus assets coinciden con el build web.

## Historial de la entrega 2.1

Objetivo del usuario: mostrar música del Inicio de sus proveedores, acercar la navegación a YouTube Music, corregir cortes y posición inicial, y cargar mejores carátulas.

Implementado: Inicio de YouTube Music mediante la conexión ya existente; estantes ordenados por el proveedor y tarjetas de pistas/colecciones. Spotify aporta canciones principales de la cuenta por afinidad y acceso al Inicio oficial. Su API documentada no ofrece el feed exacto de la app. Estado de conexión, recarga y errores por proveedor. Imágenes con la mayor variante disponible en el lector y alternativas HD en el reproductor para video.

Reproducción: se retira el temporizador de transición híbrida de JavaScript. Media3 prepara la próxima pista de YouTube y promueve el buffer listo al terminar o saltar. Desactivar la mezcla cancela el solapamiento y devuelve la pista preparada a cero. Las recuperaciones de red conservan posición de la misma pista. Cambios en HybridMediaService, YouTubeAudioPlugin y AudioOrchestrator.

Validación completada. 138 pruebas web, 63 pruebas Android con smoke público de YouTube y tres tamaños en Chrome con respuestas simuladas para los feeds. Lint sin errores. APK 2.1, código 13, firmado con esquema v2. El bundle empaquetado coincide con dist. Resultados en verification/integration-21.json y session21-final.log.

Punto para retomar. Instalar la APK de android/app/build/outputs/apk/debug/app-debug.apk sobre la anterior y revisar Para ti con una sesión real de cada proveedor. Si YouTube Music muestra error, comprobar sesión y formato de respuesta de Inicio. No registrar cookies ni tokens. Comparar Spotify con las canciones principales de la cuenta y su Inicio oficial. Medir en teléfono los saltos preparados y fríos, cortes en red inestable y desactivación del crossfade durante una transición. No había dispositivo conectado por ADB.

Para reproducir la verificación local, usar npm test y npm run android:sync. Luego ejecutar gradlew :app:testDebugUnitTest :app:lintDebug :app:assembleDebug con JDK 21. El script scripts/experience-qa.mjs acepta MURMUR_QA_URL para probar una vista previa de Vite.

## Actualización de continuidad para MURMUR 2.5

El pedido de esta iteración cubre conexión, contenido rechazado, cambio entre pistas, aura animada al ritmo y acceso a Genius. El contenido de «Para ti» de Spotify sigue consultando la actividad reciente según la entrega 2.4.

- `src/core/AudioOrchestrator.ts` valida el turno y la identidad de cada entrada de la cola antes de aplicar estados. La espera de 30 segundos tiene una salida recuperable. Un estado tardío de carga o pausa no modifica una selección posterior. El Reintentar de YouTube solicita una fuente fresca y pasa la posición de la misma entrada. Una selección nueva comienza en cero.
- `HybridMediaService.kt`, `YouTubeAudioPlugin.kt` y `OkHttpDownloader.kt` conservan la siguiente entrada hasta resolver su fuente. Media3 limita la recuperación de enlaces caducados y preserva la posición. Los dos resolutores distinguen conexión, límite de solicitudes y contenido. Las versiones alternativas se eligen desde Buscar. Spotify conserva sus rutas existentes de autorización.
- `AuraStageView.kt` y `MusicVisualActivity.kt` dibujan tres campos de luz con una paleta derivada de la carátula. Los transitorios usan muestras PCM del reproductor activo en YouTube y Spotify integrado nativo. El motor Spotify Web ofrece movimiento ambiental cuando no expone muestras. El modo de movimiento reducido inmoviliza el campo de luz.
- `DiscoveryEngine.ts` y el panel Letras distinguen sincronización, texto plano, instrumental y error de LRCLIB. La consulta se inicia al abrir el panel y se cancela si cambia la canción. «Buscar letra en Genius» abre la búsqueda con el título y el artista. La [API pública para desarrolladores](https://docs.genius.com/) se orienta a fichas y anotaciones. No se requiere token para abrir el enlace. [Cómo obtiene texto LyricsGenius](https://github.com/johnwmillr/LyricsGenius/blob/master/docs/src/how_it_works.rst) explica la diferencia entre la API y la página.

Para recompilar, ejecutar `npm.cmd run android:sync` y luego `.\gradlew.bat :app:testDebugUnitTest :app:lintDebug :app:assembleDebug -Pkotlin.incremental=false -PnetworkSmoke=true` desde el directorio Android con JDK 21. La vista previa se empaqueta con `node scripts/build-motion-preview.mjs`. La captura nativa de Robolectric se guarda en `verification/visualizer-25.png`. Los resultados se recogen en `session25-native.log` y `verification/vitest-25.json`.

Punto para retomar en un teléfono. Probar YouTube y Spotify salteando rápido desde la app, la notificación y la pantalla musical. Interrumpir Wi-Fi durante una pista, comprobar que la posición de esa pista se conserva al recuperar y que Siguiente abre desde cero. Probar una versión restringida y verificar las acciones de reintento, búsqueda y conexión. Comparar el pulso con audio real y el modo Reducir animaciones. No había un teléfono conectado por ADB durante esta sesión.

Resultado de cierre de 2.5. Pasaron 141 pruebas web, 64 pruebas Android locales, lint y el smoke público de extracción de YouTube en una ejecución separada. El APK 2.5, código 17, quedó firmado con esquema v2 y contiene exactamente los cinco archivos del build web. La vista previa pasó las pruebas de aura, letras, movimiento reducido y navegación en Chrome. Resultados en `session25-final.log`, `session25-browser.log` y `verification/vitest-25.json`.

## 2.12.0 (code 27) — la música no se detiene
- `src/core/continuation.ts`: con 2 o menos canciones restantes, `AudioOrchestrator.ensureContinuation()` agrega 12 (radio de YouTube Music + artistas afines + escuchadas recientes), sin repetir versiones (`songKey`). Marcadas `continuation` (no se quitan al apagar el aleatorio).
- Buscar: tocar un resultado reproduce solo esa canción (`songRow(..., solo)`); antes encolaba los demás resultados, que eran otras versiones de la misma.
- Versiones: `anotherVersion()` en spotifyBridge. Spotify sin gemela → cualquier subida de YouTube; YouTube bloqueado (AUDIO_UNAVAILABLE…) → otra subida; si no hay, salta (máx. 4 seguidas).
- Voz: plataforma al final («… en Spotify / desde YouTube»), álbumes («pon el disco X de Y», `albumTracks`), `bestSong` prefiere estudio; si no está en la plataforma pedida avisa y usa la otra.
- «Ok MURMUR» con música: con música por la bocina del teléfono usa VOICE_COMMUNICATION + AcousticEchoCanceler/NoiseSuppressor; umbral adaptable (piso de ruido ×1.8). Diagnóstico: `adb shell setprop log.tag.MURMUR DEBUG` → líneas «wake mic».
- Prueba sin hablar: `adb shell am start -n com.personal.murmur/.MainActivity --es voice_text "'pon X de Y en spotify'"`.
## 2.13.0 (code 28) — voz conversacional y recordar dónde te quedaste
- `VoiceIntentParser.ts`: entiende el lenguaje coloquial. Los controles se reconocen por palabras clave dentro de frases cortas («pásale a la que sigue», «párale tantito», «¿cómo se llama esta rola?»). Quita muletillas («oye», «me late», «quiero»), acepta verbos como «ponme», «me pones», «tócame» o «quiero oír», y detecta la plataforma en cualquier parte de la frase (incluso escrita mal, como «espotifai»).
- `requestResolver.ts` + `resolveRequest()`: lo que no tiene una forma fija se resuelve contra los catálogos (Spotify track/artist/album + YouTube Music), y gana el resultado cuyos nombres cubren mejor las palabras dichas. «X de Y» lo confirma el catálogo («Vámonos de viaje» es un título). Sin verbo solo se reproduce si el catálogo lo confirma (`strict`).
- Ambientes («algo tranquilo para trabajar»): playlists de YouTube Music (`youtubePlaylists`, filtro de playlists destacadas y luego de la comunidad; quitar «VL» al leerlas) ordenadas según tu gusto. Spotify ya no permite leer playlists ajenas en modo desarrollo.
- Reconocedor: `VoiceHints.kt` (es-MX, 5 alternativas, pausas más largas y en Android 13+ un sesgo hacia tus artistas y playlists mediante `setVoiceHints`). Las alternativas llegan unidas por saltos de línea y el enrutador se queda con la primera que entiende. Registro de comandos en `db.settings["voice:log"]`.
- Nuevos comandos: «¿qué canción es?», «más como esta», «aleatorio».
- Recordar sesión: `murmur.session` en localStorage (cola, índice y segundo; se guarda cada 4 s y al ocultar la app). Al iniciar sin servicio nativo se restaura en pausa y, al reproducir, arranca con `startAtMs`, que el plugin nativo respeta.
- Prueba sin hablar: el script `voz.ps1` de la carpeta temporal envía `voice_text` y lee `voice:log`.
## 2.14.0 (code 29) — primera versión para compartir
- **Firma:** la versión para compartir (release) se firma con la llave `murmur-release.jks`, guardada en `%LOCALAPPDATA%\Inedito-Boveda`, cuya contraseña es el acceso `murmur-firma` de la bóveda. La llave se crea una sola vez con `scripts/crear-llave-release.ps1` y se compila con `scripts/compilar-release.ps1` (genera `MURMUR-<versión>.apk`). La versión release no se puede depurar: no admite `run-as` ni CDP. **Respaldar el .jks:** si se pierde, los usuarios tendrán que desinstalar para actualizar.
- **Instalaciones de depuración anteriores:** usan otra firma. Para pasar a release hay que exportar el respaldo (Ajustes › Avanzado), desinstalar, instalar la release e importar el respaldo. La sesión de YouTube Music se vuelve a iniciar.
- **Spotify:** el Client ID integrado sale de `VITE_SPOTIFY_CLIENT_ID` en `.env.local`, que no se sube al repositorio. Sin él, la tarjeta de Spotify dice «Disponible pronto» y se oculta «Conectar». Cualquiera puede escribir su propio Client ID en Opciones avanzadas. En modo desarrollo, Spotify solo admite a 25 usuarios dados de alta; a los demás les aparece `SPOTIFY_USER_NOT_ALLOWED`, con un mensaje claro.
- **Spotify suena por MURMUR de forma predeterminada:** `spotifyViaYouTube()` es verdadero salvo que se elija un motor de Spotify en Opciones avanzadas (`murmur.spotifyVia = "spotify"`).
- **Conexiones:** YouTube Music aparece primero («Funciona sin cuenta»). Lo técnico (motores, Client ID, Redirect URI, huella Android) quedó en «Opciones avanzadas».
- **Bienvenida (`Welcome.tsx`):** 3 pasos en el primer inicio (`murmur.welcomed`). En web se prueba con `?bienvenida`.
- **Reporte de cierres:** `CrashLog` en `MurmurApplication` guarda `last-crash.txt`. Al siguiente inicio aparece un aviso con el botón «Enviar» (hoja de compartir de Android) que incluye los últimos 10 errores de la interfaz (`murmur.jsErrors`). Nada se envía solo.
- `APP_VERSION` ya sale de package.json.
## 2.14.1 (code 30) — audio sin esperas (lo que faltaba de la 2.7.1)
La 2.7.1 de la PC RAM nunca llegó a GitHub; la 2.8.0 solo trasladó su precarga de enlaces. Se recuperan las otras piezas, adaptadas al código actual:
- **Cliente denegado en pausa:** `NativeNetwork.resolveUncached` deja de pedir audio al cliente anónimo ANDROID_MUSIC durante 30 min cuando YouTube lo niega (`playability_denied`, 401 o 403). Antes cada toque en frío pagaba esa llamada fallida antes de ir a NewPipe.
- **Una sola resolución por canción:** `resolveAudio` comparte la petición en curso (`inflight`). Un toque sobre una canción que la precarga ya está resolviendo espera ese resultado en vez de extraerla otra vez.
- **Cola que cambia durante una transición:** si la canción saliente ya terminó, `switchNative` sigue con la nueva siguiente en lugar de quedarse en silencio.
- **Enlace roto al precargar:** cuando falla la precarga de la siguiente, se olvida su enlace (`NativeNetwork.forget`) y el reintento resuelve uno nuevo, en vez de reutilizar el roto hasta 3 h.
- Pruebas: `AudioResolutionTest` (5). La caché de 2.8.0 (3 h y margen de 20 min antes de `expire`) no cambia.
- No verificado en el teléfono: esta PC no tiene uno conectado por ADB.
## 2.15.0 (code 31) — voz que no adivina, tiempo exacto, respaldo automático y gestos fluidos
**«Ok MURMUR» con doble comprobación** (`WakePhrase.kt`, `WakeWordService.kt`):
- Paso 1: el detector de la frase (gramática mínima de Vosk) corre solo mientras hay sonido.
- Paso 2: cuando dispara, los últimos 2.5 s se transcriben otra vez sin gramática, y la frase tiene que aparecer también ahí. La letra de una canción ya no activa a MURMUR.
- En el registro de depuración solo quedan conteos de palabras, nunca lo que se dijo.
- El micrófono solo se abre con MURMUR en pantalla, con música sonando o hasta 10 minutos después de pausar (`IDLE_GRACE_MS`), para que «continúa» funcione. Fuera de eso el servicio espera sin grabar y la notificación dice «en espera».
- Mientras escucha el pedido, la música baja al 5 % (`HybridMediaService.DUCK_GAIN`); antes bajaba al 15 %.
- La app muestra la píldora «Te escucho…» (evento `onVoiceListening`).

**Comandos de control y nada de adivinar** (`VoiceIntentParser.ts`, `VoiceCommandRouter.ts`):
- Entiende «para / pausa / detén la música», «ponle pausa», «continúa / sigue con la música», «ponle play», «vuelve a ponerla».
- La música solo suena si se pide de forma explícita (`asksToPlay`): con un verbo («pon», «reproduce»), un deseo («quiero», «se me antoja») o una plataforma («en Spotify»).
- Sin eso no busca nada y contesta: «Para poner música, di «pon»…».
- Entre las alternativas del reconocedor gana un control o un pedido explícito, nunca una suposición.

**Sliders de tiempo** (`AudioOrchestrator.ts`, `SeekBar.tsx`):
- Usan la duración real que reporta el motor (`state.duration`), ya no la del catálogo. La gemela de YouTube de una canción de Spotify dura distinto.
- `onNativeTrackChanged` ahora trae `positionMs` y `durationMs`, así el fundido DJ ya no reinicia la barra a 0.
- Los avisos de avance viejos ya no regresan el control después de adelantar (`seekGuard`).
- Si se pausa en la app y se reanuda desde la notificación, los audífonos o la pantalla de bloqueo, la barra ya no se congela (`externalResume`).
- La barra avanza cuadro por cuadro con `usePlaybackClock`: va hasta 1.2 s por delante del último aviso y nunca pasa del final.
- El relleno termina bajo el centro del control, y la etiqueta izquierda muestra el tiempo mientras arrastras.

**Respaldo que sobrevive a desinstalar** (`AutoBackup.kt`, `src/core/autoBackup.ts`, `db.ts`):
- El formato 2 incluye las preferencias de `localStorage` (`murmur.*`, menos `jsErrors`).
- La copia se guarda en `Descargas/MURMUR/murmur-respaldo.json` sin pedir permisos, con MediaStore (Android 10 o más). Se hace 20 s después de abrir, como máximo cada 6 h, y al pasar a segundo plano. Nunca guarda una biblioteca vacía encima.
- La bienvenida tiene «Ya usaba MURMUR: restaurar».
- Las sesiones de YouTube Music y Spotify no entran en el respaldo: siguen en el almacenamiento cifrado de Android. Con la misma firma, cada actualización las conserva solas.

**Gestos y animaciones** (`PlayerLayer.tsx`, `SwipeSurface.tsx`, `MiniTrackSwap.tsx`, `Unfold.tsx`, `viewTransition.ts`, `motion215.css`):
- Al cerrar el reproductor deslizando hacia abajo, todo el panel sigue el dedo. Cierra por distancia o por velocidad; si no, regresa con resorte.
- El minirreproductor cambia de canción con un deslizamiento rápido: la canción sale en la dirección del gesto y la siguiente entra por el lado contrario. Si lo tomas a media animación, sigue desde donde va.
- Las pestañas y las páginas cambian con View Transitions: las páginas más profundas entran por la derecha, al regresar entran por la izquierda y las pestañas se funden con una leve subida. Las barras no se mueven; durante esos ~300 ms tienen un fondo oscuro detrás para que no se vea la página a través del vidrio. Sin soporte o con movimiento reducido, se usa la animación anterior.
- La letra y la cola se despliegan animando la altura.
- El minirreproductor aparece y desaparece con animación.
- La portada solo va hacia atrás con «Anterior».
- La fila de la cola se levanta con resorte al arrastrarla.
- La hoja de acciones sigue hacia abajo al cerrarse.
- Los títulos largos que se desplazan se desvanecen en los bordes, ya no se cortan.

**Verificado en el teléfono** (HONOR, Android 16, 25 nov 2026, por adb inalámbrico):
- La 2.15.0 se instaló encima de la 2.14.1 sin perder datos: 2,176 canciones, 38 playlists y el historial.
- Comandos de texto como voz:
  - «para la música», «sigue con la música», «ponle pausa» y «ponle play» funcionaron;
  - «la casa de mi mamá» no reprodujo nada;
  - «pon static age de misfits en youtube» la reprodujo.
- Slider: la etiqueta coincide con el motor (0:36–0:40 de 1:47, contra 37–40.5 s del motor).
- Gestos: deslizar hacia abajo cerró el reproductor y el deslizamiento rápido en el minirreproductor cambió de canción.
- El respaldo `Download/MURMUR/murmur-respaldo.json` (1.7 MB) se creó solo.
- **Falta probar con voz real:** la doble comprobación de «Ok MURMUR» con música sonando. El permiso de micrófono se perdió al reinstalar en la 2.14.1: hay que volver a activar «Ok MURMUR» en Ajustes.

## 2.16.0 (code 32) — tu voz, widget, gestos nuevos, presentador y mix del momento
- **Solo mi voz** (`VoiceMatch.kt`, `VoiceEnrollment.kt`, `src/components/VoiceEnrollment.tsx`):
  - Al activarla descarga un modelo de hablante de Vosk (`vosk-model-spk-0.4`, 13 MB) y pide decir «Ok MURMUR» 3 veces.
  - `confirm()` además compara la huella de voz (coseno). El umbral se ajusta con el propio entrenamiento: entre 0.25 y 0.50, con 0.05 menos si hay música.
  - Si el modelo o la huella fallan, decide solo la frase: nunca deja fuera al dueño.
  - Sin probar con voz real; los valores para afinar salen de `adb logcat -s MURMUR`, en las líneas `wake voice … similarity=… threshold=…`.
- **Respuestas habladas y presentador** (`SpokenReplies.kt`, `src/core/voiceReplies.ts`, `VoiceExtrasSetting.tsx`):
  - Usa el TTS del teléfono en es-MX y baja la música mientras habla.
  - Tras «Ok MURMUR» dice la respuesta, salvo cuando la música ya la da (empieza o salta una canción).
  - El presentador (apagado por defecto) anuncia cada canción nueva al empezar a sonar, también con transiciones sin pausa y con fundido: llamadas en `onIsPlayingChanged` y `emitNativeTrack`.
- **Temporizador por voz** (`parseSleep`): «apaga la música en 20 minutos», «para en media hora», «al terminar esta canción», «cancela el temporizador». El router emite `murmur:sleep` y la app usa el mismo `chooseSleep` que el botón.
- **Widget** (`MurmurWidget.kt`, `MurmurWidgetModel.kt`, `res/layout/murmur_widget_*`):
  - Muestra portada, título, artista y anterior/reproducir/siguiente.
  - `MurmurWidget.sync` desde `HybridMediaService`, solo cuando algo cambia.
  - Sin servicio activo, abre MURMUR.
- **Gestos nuevos** (`gestures216.css`, `CoverDoubleTap.tsx`, `QueueRowGestures.tsx`, `useLongPress.ts`):
  - Deslizar hacia arriba en el minirreproductor abre el reproductor siguiendo el dedo. Abre siempre arriba (`riseGuard`): antes, el impulso lo dejaba desplazado y el primer jalón hacia abajo solo regresaba el scroll.
  - Doble toque en la portada guarda la canción, con un corazón animado.
  - Deslizar a la izquierda una fila de la cola la quita, con «Deshacer». Usa `player.reorder`; la canción actual no se puede quitar.
  - Mantener presionada una canción abre su menú.
- **Mix del momento** (`MomentMix.tsx`): una tarjeta en Inicio según la hora y el día, de mañana, concentrarte, fin de semana, noche o madrugada. Usa el mismo motor que «pon algo tranquilo…».
- **Aviso de actualización** (`src/core/updates.ts`, `openUpdate`):
  - Cada 12 h consulta `releases/latest` de GitHub y ofrece «Actualizar» con el APK arm64 de la release.
  - **Necesita publicar releases en GitHub**: la etiqueta es `vX.Y.Z` y el APK debe llevar la misma firma que el teléfono.

**Verificado en el teléfono** (25 nov 2026, adb inalámbrico):
- Temporizador por voz y su cancelación.
- Preferencias de voz.
- El widget quedó registrado como proveedor.
- La tarjeta del mix del momento en Inicio.
- Deslizar hacia arriba abre y, un segundo después, deslizar hacia abajo cierra.
- Mantener presionada una fila abre «Acciones de canción».

**Falta en el teléfono:**
- Probar «Solo mi voz» con voz real.
- Escuchar las respuestas habladas y el presentador: el volumen estaba en 0.
- Poner el widget en la pantalla de inicio: lo hace el dueño.
- Pendiente conocido: con la hoja de entrenamiento abierta, el gesto atrás de Android también afecta a la pantalla de atrás.

## 2.17.0 (code 33) — voz que entiende tu música, biblioteca con buscador, mix personal y micrófono bajo control
**Voz**
- `voicePhonetics.ts`: claves fonéticas para inglés oído en español.
- `voiceLibrary.ts`: busca primero en tu biblioteca.
- `routeVoiceCommand`: evalúa todas las alternativas del reconocedor.
- Umbrales de confianza:
  - biblioteca: 0.85 o más reproduce; menos de 0.75 nunca;
  - catálogos: 0.82 o más reproduce; menos de 0.70 solo ofrece opciones;
  - entre ambos, reproduce la mejor y muestra `VoiceChoices`, «¿No era esta?».
- Frases nuevas: «la canción X», «lo nuevo de X», «las mejores de X», «mis favoritas», «échame/rólame…».
- Hasta 500 nombres de tu biblioteca se pasan como pistas al reconocedor.
- Probado en el teléfono con los fallos reales del registro:
  - «Pon misfits» → Misfits;
  - «King Caesars and the leaser weaser» → King Gizzard;
  - «Don Can you West» → Kanye West;
  - «okay murmuro» → «Te escucho»;
  - pláticas → nada;
  - «los backs» → la mejor opción, más opciones para elegir.

**Biblioteca** (`librarySearch.ts`, `LibraryTools.tsx`, `library217.css`):
- Buscador general tolerante a errores, con resultados agrupados por tipo.
- Filtro dentro de cada categoría.
- «Ordenar» por categoría, guardado en `murmur.sort.<categoría>`:
  - recientes, más escuchadas, escuchadas recientemente, A–Z, artista, álbum, duración y número de canciones;
  - los datos salen de `history` y del nuevo `addedAt`.
- Artistas y Álbumes ahora solo listan canciones guardadas.

**Mix del momento personal** (`momentMix.ts`):
- 14 canciones tuyas que sueles oír a esta hora (±2 h, mismo tipo de día, últimos 60 días, ponderadas) y 11 descubrimientos cercanos de `continuationPicks`.
- Si hay pocos datos: la misma hora cualquier día, luego tus favoritas por ambiente y, al final, el catálogo.
- Caché de 30 min; se arma 1.5 s después de abrir para que el toque sea inmediato.

**Micrófono:**
- Modo de escucha `wake_mode`:
  - «Con música»: en pantalla, con música y 3 min después;
  - «Solo en pantalla»: el micrófono se apaga al salir de la app (`WakeWordService.appVisible`).
- El widget tiene botón de micrófono, que abre `VoiceCaptureActivity` sin escucha continua.
- Por qué el indicador no se puede quitar: solo el asistente del sistema puede usar el chip de bajo consumo que espera la palabra; cualquier otra app usa el micrófono normal y Android lo indica.

## 2.17.1 (code 34) — indicador de voz en cada paso
- La píldora de arriba (`voice-listening` en `App.tsx`) muestra el estado de la petición de voz:
  1. «Te escucho…» mientras capta, con «Ok MURMUR» o con el botón de micrófono de la app.
  2. «Buscando «lo que dijiste»…» con un indicador giratorio mientras la resuelve (`heardLabel`).
  3. «Preparando música…» hasta que la canción suena o falla.
- Una vibración ligera confirma que terminó de oír.
- Si el indicador ya dice «Preparando música…», no aparece el aviso inferior «Preparando audio…».
- La píldora abarca toda la barra superior para no tapar a medias el logo ni el micrófono.
- Verificado en el teléfono con «pon las mejores de caifanes» y «pon algo de enjambre».

## 2.18.0 (code 35) — panel de voz con ondas y voz más natural
**Panel de voz** (`VoiceCaptureActivity.kt`, `VoiceWaveView.kt`, tema `Theme.MurmurVoice`)
- El botón de micrófono de la app, el del widget, el mosaico de ajustes rápidos y los audífonos ya no abren una pantalla negra con texto.
- Ahora sube desde abajo un panel sobre la pantalla oscurecida, con:
  - un estado («Te escucho…», «Escuchando…», «Entendiendo…», «Entendido»);
  - las palabras en vivo, con `EXTRA_PARTIAL_RESULTS`;
  - cuatro ondas de colores de MURMUR que crecen con el volumen de la voz (`onRmsChanged`), respiran en espera y pulsan mientras entiende;
  - el botón «Cancelar».
- Tocar fuera del panel cancela la escucha.
- Si Android tiene las animaciones apagadas, las ondas quedan quietas.
- La app ya no muestra su propia píldora «Te escucho…» detrás del panel. Después sigue «Buscando «…»».
- Sin verificar en el teléfono con voz real: el dueño estaba usando el teléfono.

**Voz más natural** (`SpokenReplies.kt`, `SpeakerVoices.kt`)
- Usa el motor de Google (`com.google.android.tts`) si está instalado; en el HONOR sí está.
- Elige la voz en español más natural: México primero, luego Latinoamérica y España, por calidad; las neuronales en línea solo cuando hay internet.
- En Ajustes hay «Voz de MURMUR», con las voces disponibles: al tocar una se escucha una muestra y queda elegida (`tts_voice`).
- El motor no informa el género de cada voz, así que se elige escuchándolas.

## 2.19.0 (code 36) — tu biblioteca se edita, el álbum manda la carátula y la voz deja de inventar

**Editar la biblioteca** (`src/core/libraryEdit.ts`, `src/components/LibraryEditor.tsx`)
- Playlists y álbumes: crear, renombrar (en un álbum también artista y año), añadir canciones de tu biblioteca, quitarlas con «Deshacer» y eliminar la colección.
- «Crear álbum» está en el menú ⋮ de Tu Biblioteca y arriba de Álbumes.
- Canciones: no se crean (vienen de los catálogos), pero sí se corrigen título, artista y álbum, se quitan de una colección y se eliminan de MURMUR (sale de Guardadas, de toda playlist o álbum y borra su descarga).
- **Nada de esto lo deshace una sincronización.** `mergeSyncedTrack` y `mergeSyncedPlaylist` conservan lo que tú cambiaste: lo que quitaste no vuelve (`removedIds`), lo que renombraste mantiene tu nombre (`edited`), lo que dejaste de guardar no se vuelve a guardar (`unliked`) y una colección eliminada no reaparece (`library:deletedPlaylists`).
- En una playlist de un proveedor, lo que añades vive al lado (`playlist_overrides`), porque cada sincronización reemplaza su lista.

**Guardar un álbum ya no guarda sus canciones**
- Un álbum se guarda en Álbumes y sus canciones **no** entran a Guardadas: marcas con ♥ solo la que quieras. Las que ya estaban guardadas se quedan.
- El menú del álbum tiene «Quitar sus canciones de Guardadas», con el número que hay.
- El ♥ del reproductor ahora es interruptor: toca otra vez y se quita de Guardadas, con «Deshacer».

**La carátula del álbum es la de sus canciones** (`applyAlbumCover`)
- La que trae el álbum o la que tú subas se aplica a todas sus canciones, en la app y en la notificación (`TrackCover.kt`).
- Cada canción guarda la suya debajo (`ownArt`) y la recupera si sale del álbum o el álbum se elimina.
- Se aplica al guardar un álbum, al sincronizar y al abrir la app.

**Voz: instrucciones de todos los días** (`VoiceIntentParser.ts`)
- Volumen: «súbele», «baja un poco el volumen», «más fuerte», «volumen al 30», «volumen al máximo» (`VolumeSteps.kt`, muestra el control de Android).
- Nuevas: «repite esta canción» / «desde el principio», «quita de favoritos», «sígale», «pasa la canción», «de quién es esta», «dame like», «sorpréndeme».
- «Pon la playlist de rock», si no es tuya, ya busca esa música en el catálogo en vez de no entender.
- El reconocedor espera 1.3 s de silencio (antes 0.9) para no cortarte a media frase.

**Voz: deja de confundir artistas** (`voiceCatalogue.ts`, `voicePhonetics.ts`)
- Spotify dejó de mandar `popularity` (llega vacío): el lugar en su búsqueda hace de popularidad (`catalogueRank`), así que nombres cortos y conocidos (AC/DC, Muse, Queen, Korn) ya no parecen desconocidos.
- El nombre exacto que dijiste gana sobre el que solo suena parecido, aunque el parecido esté en tu biblioteca.
- Dos arreglos del comparador fonético, salidos de pruebas reales en el teléfono:
  - unir dos palabras en una solo cuenta si no hay otra evidencia y suena casi igual («miss suites» sí es Misfits; «ac dc» no es «CatDog»);
  - el esqueleto de consonantes solo compara palabras de largo parecido («ac dc» ya no es «Canción Acuática»).
- Si no está seguro, ofrece opciones en vez de poner cualquier cosa.

**«Ok MURMUR»: lo dice cualquiera, pero solo esa frase** (`WakePhrase.kt`, `WakeCheck.kt`, `WakeDetector.kt`)
- **«Solo mi voz» viene apagado** y los perfiles de antes vuelven apagados: antes podía quedar encendido sin que se notara y MURMUR ignoraba a cualquiera que no fueras tú. Enciéndelo solo si eso es lo que quieres.
- La segunda comprobación ya no mira una sola transcripción: revisa las diez mejores del modelo y además pone la frase a competir contra una lista de parecidos («okay mamá», «murmullo», «Mauro», «Marmolejo»). Medido en el teléfono con voces grabadas: de 88 a 171 confirmaciones de las 177 que el detector alcanza, sin una sola activación falsa en 160 frases trampa.
- La frase es estricta: «murmura», «murmuro», «mormón» y «mur mur» sí; «murmullo», «murmuran», «Mauro» o «ok mamá» no.
- Voz lejana: el micrófono sube las voces bajas antes de decodificarlas, baja de golpe cuando alguien habla cerca (para no saturar) y el umbral de ruido es más bajo.
- `WakeDetector.kt` separa la escucha del micrófono, así se puede medir sin hablar: `WakeBenchReceiver` (solo en versiones de prueba) graba «Ok MURMUR» con todas las voces del teléfono y se las reproduce de cerca, de lejos, muy lejos y con ruido.

**Probado en el teléfono del dueño (26 nov 2026):** biblioteca restaurada (2 353 canciones, 40 playlists), carátulas de álbum aplicadas a 167 canciones al arrancar, menú de álbum y hoja de canción revisados en capturas reales, «súbele al volumen», «quita de favoritos», «pon muse», «pon queen», «pon algo de enjambre», «pon bailarina de miranda» y «pon ac dc» (ofrece opciones, ya no inventa).

**Falta probar con voz real:** «Ok MURMUR» dicho por ti y por otra persona, y el panel de voz.

