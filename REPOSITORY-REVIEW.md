# Integración de repositorios en MURMUR 1.4

22 de noviembre de 2026, America/Mexico_City. Integración real de componentes seleccionados; no se fusionaron las tres aplicaciones completas. Los checkouts de referencia permanecen en `.research/`, fuera del APK.

| Proyecto fijado | Integración en MURMUR | Límite |
| --- | --- | --- |
| [Square 139441f](https://github.com/Lelonio/Square/tree/139441f) | `native/spotify`: motor Rust/librespot y tres crates vendorizados; nombre de biblioteca y exports JNI adaptados. Nuevas capas Kotlin de autorización, PCM, Media3, foco, metadatos y cola en segundo plano. Cuatro ABIs compiladas. | Requiere Premium y autorización adicional. Se adaptaron además WebSdkEngine/player.html para una alternativa oficial Web Playback con OAuth propio y EME; no extrae claves DRM. |
| [Spotui 2502236](https://github.com/Spotui/Spotui/tree/2502236) | Perfil ANDROID_MUSIC y resolución de audio directo en `YouTubeMusicResolver.kt`; AAC prioritario y fallback NewPipe. | No se importaron proxies comunitarios ni sustitución silenciosa del audio Spotify por YouTube. |
| [NewTube 6f96a1b](https://github.com/aleixrodriala/newtube/tree/6f96a1b) | Patrón de fallo estructurado y saneado en `YoutubeSourceFailure.kt`, inspirado/adaptado de SabrException; recuperación propia con reextracción de enlaces y posición preservada. | Su motor SABR completo y submódulos NO se incorporaron. |

## Spotify dentro de MURMUR

El modo predeterminado es Integrado · Premium. `SpotifyIntegratedPlayer` adapta el motor a MediaSession; `SpotifyPcmOutput` entrega PCM S16 a AudioTrack. Las llamadas de red/control se serializan fuera de la UI. Pausa, reanudar, seek, fin de pista, foco, ducking de voz y temporizador usan el motor local. La cola puede avanzar a YouTube o Spotify integrado con la WebView en segundo plano. El crossfade simultáneo se conserva únicamente entre pistas YouTube.

La autorización de audio usa PKCE, cliente público de librespot y retorno loopback `http://127.0.0.1:5588/login`. Los tokens quedan cifrados por separado de la biblioteca, cuyo Client ID aportado y retorno `http://127.0.0.1:43821/callback` se conservan. Cerrar sesión cancela autorizaciones, detiene el motor y borra sus archivos privados. Connect sigue disponible por elección explícita; no hay fallback silencioso que abra Spotify oficial cuando el motor falla.

`native/spotify/UPSTREAM.md` recoge procedencia y compilación. Herramientas fijadas: Rust 1.100.0, cargo-ndk 4.1.2, NDK 28.2.13676358. Se compilan arm64-v8a, armeabi-v7a, x86 y x86_64, API26. `scripts/verify-spotify-native.mjs` comprueba máquina ELF, diez exports JNI, dependencias de sistema y alineación LOAD de 16 KiB. Esta última comprobación se refiere a las nuevas bibliotecas Spotify; no elimina la advertencia pendiente de MediaPipe.

## YouTube y conservación de color

Se prueba primero la resolución ANDROID_MUSIC. Respuestas sin audio directo o fallos de extracción pasan a NewPipe. Los formatos se conservan como alternativas de Media3; ante 401/403/410 o determinados fallos de códec se reextrae una vez, prefiriendo NewPipe y conservando la posición. Los cambios de pista y la pausa invalidan recuperaciones pendientes. Las peticiones Googlevideo mantienen rangos limitados de 256 KiB y el User-Agent correspondiente. Los archivos offline se validan dentro del directorio privado, también al avanzar la cola.

Las carátulas y miniaturas mantienen los píxeles originales. El tema oscuro corresponde a controles y fondos; el QA comprueba una portada de colores renderizada en contextos aislados, sin incorporar datos de prueba al producto.

## Licencias y alcance comprobado

Square y Spotui: GPL-3.0; NewTube: MIT, con dependencias que mantienen sus avisos. Licencias completas en `third_party/` y `android/app/src/main/assets/licenses/`. Los crates vendorizados conservan sus licencias propias. El código fuente adaptado y las instrucciones de compilación acompañan esta entrega local y deben acompañar cualquier redistribución conforme a las licencias aplicables.

Las pruebas cubren estados nativos con backend simulado, cancelación, autorización aislada, JNI/ELF, red pública YouTube y UI responsive. No hubo dispositivo Android disponible para conceder la cuenta Premium ni escuchar audio. Algunas cuentas pueden recibir rechazo de claves del proveedor; ese fallo se comunica y no se presenta como reproducción correcta. Ver `VERIFICATION.md` y `verification/` para los resultados finales.

## Corrección posterior 1.4

Las capturas del usuario mostraron rechazo real de claves Spotify y error de runtime YouTube. Se adaptaron `WebSdkEngine.kt` y `assets/websdk/player.html` de Square 139441f, conservando su licencia; se integran mediante `SpotifyWebBackend` con la cola/MediaSession de MURMUR. El token procede del Client ID propio con scopes streaming/email. El SDK oficial sirve y descifra su audio; MURMUR no obtiene claves DRM. El modo Web se elige explícitamente, no sustituye pistas por YouTube ni abre Spotify oficial. Sus estados y puente se prueban con SDK simulado; no se afirma audio real de la cuenta.

Se incorporó también el patrón LoginKeepAlive de Square para evitar suspensión del receptor loopback en segundo plano y la captura DOM de configuración YouTube Music. El fallo del medidor YouTube se reprodujo con ExoPlayer/AudioSink real en Robolectric y se corrigió al ignorar buffers vacíos. Ver `VERIFICATION.md` para pruebas, artefacto y límites.

## Fuentes del feed en MURMUR 2.4

| Proveedor | Referencia | Integración |
| --- | --- | --- |
| YouTube Music | [ytmusicapi get_home](https://github.com/sigma67/ytmusicapi/blob/main/ytmusicapi/mixins/browsing.py) y [adaptador de Music Assistant](https://github.com/music-assistant/server/blob/dev/music_assistant/providers/ytmusic/helpers.py) | El lector nativo consulta `FEmusic_home` con la sesión de YouTube Music, conserva orden y títulos de las secciones y lee hasta tres páginas. Si el estado de sesión es ambiguo, consulta el menú de cuenta. Las colecciones recomendadas usan esa misma sesión y se guardan por acción explícita. |
| Spotify | [NTify-SpotAPI](https://github.com/NTifyApp/NTify-SpotAPI) y [Get User's Top Items](https://developer.spotify.com/documentation/web-api/reference/get-users-top-artists-and-tracks) | NTify consulta el Inicio interno con un token de cuenta y otro de cliente. El prototipo `native/spotify/src/pathfinder.rs` conserva una ruta experimental. La vista 2.4 usa la actividad reciente de la cuenta por OAuth y enlaza al Inicio oficial de Spotify. |

La vista HTML incorpora datos de demostración y un rótulo dentro del feed. El APK se valida con respuestas de prueba. La comparación con las cuentas del usuario queda pendiente de una sesión autenticada en Android.
