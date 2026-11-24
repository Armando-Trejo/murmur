# Continuidad de MURMUR 2.7.0

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
