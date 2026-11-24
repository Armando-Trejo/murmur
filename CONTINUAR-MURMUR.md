# Continuidad de MURMUR 2.5.1

## Estado para retomar

Repositorio local en `D:/PROYECTOS IA/APP HYBRIDA`. MURMUR es una app Android con interfaz React/Capacitor, Media3 para YouTube y tres modos de Spotify. El APK de esta entrega usa `com.personal.murmur` y el código de versión 18. La vista previa HTML usa pistas y pulso de demostración.

- El inicio y la vuelta de segundo plano respetan una selección mientras se carga. `AudioOrchestrator.init` descarta restauraciones tardías y `refreshNativeState` evita que la pista saliente desplace a la que el usuario acaba de elegir.
- `HybridMediaService` conserva la última posición solicitada durante la recuperación de YouTube. La WebView y `MusicVisualActivity` leen esa posición mientras se resuelve la fuente. Pausar o cambiar de pista invalida la recuperación anterior. Volver al principio de la misma pista actualiza la posición sin abrir otra solicitud.
- El aura usa transitorios del PCM disponible. Spotify Web usa movimiento ambiental. Genius se abre como búsqueda desde Letras, y LRCLIB devuelve las letras dentro de la aplicación.
- El Inicio de YouTube Music usa la sesión guardada. Spotify muestra la actividad de la cuenta vía OAuth y enlaza a su Inicio oficial. La ruta de Spotify Pathfinder en Rust queda experimental. `REPOSITORY-REVIEW.md` recoge los repositorios y requisitos de autenticación.

Lee primero el [plan completo para el siguiente agente](SIGUIENTE-AGENTE.md).

## Primera tarea del siguiente modelo

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
