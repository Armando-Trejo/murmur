# MURMUR 2.7.0

App Android de música con biblioteca local, reproducción de Spotify y YouTube, feeds por proveedor, reproductor con luz de la carátula, letras sincronizadas, resumen de escucha local, visualizador musical reactivo, perfiles de artista y álbum de YouTube Music y letras de LRCLIB y YouTube Music. Paquete `com.personal.murmur`, Android 8.0 o posterior. Interfaz React y Capacitor, servicio Kotlin/Media3 y motor Rust/librespot.

[Plan del siguiente agente](SIGUIENTE-AGENTE.md) · [Estado y pruebas para retomar](CONTINUAR-MURMUR.md) · [Hoja de ruta premium](PREMIUM-ROADMAP.md) · [Componentes externos](REPOSITORY-REVIEW.md)

## Compilar

1. Instala Node.js, JDK 21 y Android SDK 35. Consulta el NDK, los objetivos Rust y cargo-ndk fijados en [native/spotify/UPSTREAM.md](native/spotify/UPSTREAM.md). Configura su ruta con `ANDROID_NDK_HOME`.
2. Desde la raíz, ejecuta `npm ci` y `npm run android:sync`.
3. Desde `android`, ejecuta `.\gradlew.bat :app:testDebugUnitTest :app:lintDebug :app:assembleDebug` en Windows. En otros sistemas usa `./gradlew`. El APK de depuración se genera en `android/app/build/outputs/apk/debug/app-debug.apk`.
4. Para escuchar Spotify, configura el Client ID de tu aplicación en Conexiones y registra el retorno documentado allí. El ajuste se guarda en el dispositivo. El APK de este repositorio requiere la misma firma local que tu versión instalada para actualizar sobre ella.

Para un APK más ligero que se pueda enviar al teléfono, compila sólo para arm64 con `.\gradlew.bat :app:assembleDebug -Pabi=arm64-v8a` (unos 20 MB en lugar de 40; no sirve en teléfonos de 32 bits).

Usa `npm test` para las pruebas web. Ejecuta `npm run dev` para la interfaz o `node scripts/build-motion-preview.mjs` para generar el HTML interactivo de prueba. La demo usa pistas, carátulas y pulso de ejemplo. Las bibliotecas nativas generadas, el APK y el HTML se construyen localmente.

## Historial

## Novedades 2.7

- **Mixes de YouTube que abren.** Los mixes y radios (`RD…`) se leen de la cola de reproducción de YouTube Music en lugar de pedirlos como playlist privada, que es lo que provocaba «YouTube no autorizó la biblioteca privada». Se intenta con tu sesión y, si falla, de forma pública. Un error de contenido público ya no marca tu sesión como caducada.
- **Carátulas HD.** Las portadas de YouTube Music y de artistas se piden al CDN a 544 px en listas y 1 200 px en el reproductor, la cabecera y la notificación; Spotify usa su imagen de 640 px. Los fotogramas 4:3 de YouTube ya no muestran franjas negras. Si una carátula falla se prueba la siguiente opción y, si todas fallan, se reintenta dos veces y al recuperar la conexión. Las canciones de un álbum heredan su portada y su artista.
- **Cola en orden.** «Añadir a la cola» y deslizar a la derecha ponen las canciones después de la actual y de lo que ya añadiste, en el orden en que las añadiste. «Añadir todo a la cola» en playlists y álbumes.
- **Sin corte entre canciones.** El siguiente tema arranca 240 ms antes del final aunque Auto-Mix esté apagado, se detecta el silencio final de muchas subidas para pasar antes, y el realce de volumen solo se activa en directos, porque engancharlo en cada cambio podía producir un microcorte.
- **Letras dentro de la app.** Búsqueda flexible en LRCLIB (título limpio, artista principal, duración aproximada, prefiere letra sincronizada) y, si no hay, la letra que muestra YouTube Music (normalmente de LyricFind). Genius no ofrece letras por API; su búsqueda solo aparece cuando ninguna fuente tiene la letra.
- **Perfil de artista.** Foto HD teñida con su color, oyentes, tus reproducciones, Reproducir y Aleatorio, descripción plegable, Populares de YouTube Music, tus canciones, álbumes, sencillos, videos y artistas afines. Se abre desde el reproductor, la cola, la biblioteca y los artistas del Inicio (antes saltaban a la app de YouTube Music).
- **Álbumes y playlists.** Cabecera con portada grande, fondo desenfocado, tipo, artista, año, número de canciones y duración total; pistas numeradas en álbumes; Reproducir, Aleatorio, Guardar y menú ⋮.
- **Menos ruido.** Se quitaron la barra Atrás/Adelante (ahora hay una flecha en la barra superior solo en vistas de detalle, además del gesto de Android), el botón de temporizador del reproductor (sigue en Conexiones) y el acceso Descargas del Inicio (la pestaña de Biblioteca solo aparece si hay descargas). Ordenar, importar enlaces, buscar con tu sesión y las opciones de colección viven en menús ⋮; Conexiones pliega «Voz y permisos» y «Avanzado». La pantalla musical se abre con el icono ✦ del reproductor.
- **Pantalla musical nueva.** Analiza el audio real (espectro de 36 bandas de 35 Hz a 16 kHz, graves, medios, agudos y detección de golpes) sincronizado con lo que sale del altavoz. Fondo líquido con los colores de la portada que gira con los graves y salpica en cada golpe, anillo de puntos LED con picos que caen, disco de portada con resorte, ráfagas de puntos y una vibración visual de hasta 3 dp en los golpes fuertes, franja de pulsos y reloj de matriz de puntos que late con el bajo. Títulos en Roboto Condensed y textos espaciados en mayúsculas. Sin animación si el sistema la desactiva.
- **Bienvenida nueva.** Aurora animada con el color de lo que suena, fecha, saludo, tiempo de la semana y una tarjeta para seguir escuchando.
- **Gestos y respuesta al tacto.** Deslizar una canción revela «A la cola», vibra al cruzar el umbral y rebota al soltar; deslizar la portada del reproductor cambia de canción; arrastrar la hoja de opciones hacia abajo la cierra; onda de tinta al tocar filas y menús, escala al pulsar, entrada escalonada de menús y transición del minirreproductor al cambiar de pista. Todo respeta «reducir movimiento».

Verificación de 2.7: 169 pruebas web en 17 archivos, 86 pruebas Android (1 omitida: smoke de red), lint sin errores, APK v2 `2.7.0` código 20 con la misma firma que 2.6.0, assets idénticos al build web y sin credenciales. Vista previa revisada a 375 px y 768 px sin errores de consola ni desbordes. No hubo teléfono: falta escuchar el paso entre canciones, abrir mixes reales y medir la fluidez de la pantalla musical.

## Novedades 2.6

- **Reproductor inmersivo.** El fondo del reproductor toma la luz de la carátula y se funde con el negro AMOLED; cambia con un fundido al pasar de pista. El minirreproductor adopta el tono de la portada. Todo depende de **Conexiones → Luz ambiental**: si la desactivas, vuelve el negro puro. Las carátulas conservan sus colores.
- **Letras sincronizadas.** La línea que suena se mantiene centrada y resaltada, las anteriores se atenúan y tocar una línea salta a ese momento. Al desplazarte a mano la letra deja de seguir la canción unos segundos y aparece **Seguir la letra**.
- **Tu resumen.** Desde Tu Biblioteca o la tarjeta de Inicio: tiempo escuchado (7 días, 30 días o todo), racha de días, hora favorita, porcentaje de canciones saltadas, minutos de los últimos 7 días, reparto Spotify/YouTube y tus artistas y canciones principales. Se calcula en el teléfono con el historial existente.
- **Inicio y Buscar.** Saludo según la hora con el tiempo escuchado en la semana, esqueletos de carga en los feeds y **búsquedas recientes** (se guardan al pulsar Buscar o al reproducir un resultado; se pueden quitar una a una o todas).
- **Temporizador de sueño en el reproductor.** Botón con cuenta atrás junto a Mezclar ahora: 15/30/45/60 minutos o **Al terminar esta canción** (YouTube y Spotify integrado). Spotify Connect sigue en su propio dispositivo.
- **Respuesta háptica.** Vibración breve del sistema al reproducir, saltar, guardar y añadir a la cola. Respeta el ajuste de vibración táctil de Android y se desactiva en Conexiones.
- **Diagnóstico de reproducción.** Conexiones mide en el teléfono el tiempo desde que eliges una canción hasta que el motor confirma el audio (p50/p95 por proveedor, fallos y último código). **Copiar informe** genera un texto sin cuentas, tokens ni enlaces.

Verificación de 2.6: 162 pruebas web, 69 pruebas Android (1 omitida: smoke de red), lint sin errores, APK v2 `2.6.0` código 19 con assets idénticos al build web y sin credenciales. La vista previa HTML se revisó en Chrome a 375 px y 768 px. Falta validar en un teléfono Android: hápticos, temporizador al final de pista y fluidez del fondo.

## Novedades2.0

Tu Biblioteca → Importar desde un enlace admite enlaces completos de playlists, mixes y álbumes de Spotify/YouTube, URI Spotify y álbumes de YouTube Music. Spotify necesita autorización de biblioteca; colecciones privadas YouTube usan sesión. Enlaces cortos Spotify requieren copiar su dirección completa. Mixes se guardan como selección puntual y no son radio infinita. Importar abre contenido sin autoplay; fallos no reemplazan datos previos y audio offline se conserva.

Tu Biblioteca → Artistas / Álbumes organiza datos disponibles. La página de artista combina música local y búsqueda relevante de proveedores; no promete biografías ni catálogo completo. Desde el reproductor se puede abrir artista y, si hay metadatos, álbum. Para registros Spotify antiguos, sincronizar de nuevo añade nombre/ID de álbum. Mostrar como en cada colección permite alternar Playlist / Álbum sólo localmente.

## Novedades1.9.1

Controles estándar de sesión: anterior, pausa/play y siguiente. Las flechas ya no son acciones extra al final. Ondas expansivas y reacción más marcada a cambios de energía en el visualizador. Importación YouTube recorre páginas de biblioteca y reconoce tarjetas clásicas además de Music; usa Conexiones → Importar playlists para actualizar.

## Novedades1.9

Vinilo giratorio con carátula a color, aura fluida y neblina animada. Giro pausado al detener audio. Iconos propios anterior/siguiente en la notificación multimedia. Selector Audio/Video retirado para liberar espacio.

## Novedades1.8

Visualizador nativo de partículas/ondas inspirado en las referencias: reloj, portada central, colores de carátula, título de una línea, seek y controles. Reactividad PCM local y YouTube; Web usa animación ambiental. Se activa en Pantalla musical animada; no reemplaza automáticamente el bloqueo.

Títulos largos como cintillo sólo cuando desbordan y están visibles; movimiento reducido conserva elipsis. Mixes abren primero con biblioteca local y añaden descubrimientos después. Salto YouTube reutiliza secundaria preparada. Verificación PC de rutas26–27ms de media; audio real depende del proveedor.

## Novedades1.7

- Mixes abren su playlist antes de reproducir. La cola se abre y desplaza a su sección; tocar una entrada inicia esa canción y elimina las anteriores.
- Visualizador nativo activado desde **Pantalla musical animada**, con colores de portada y controles, disponible sobre el bloqueo seguro mientras esa actividad esté abierta. No sustituye automáticamente la pantalla de bloqueo ni desbloquea el teléfono. Prueba física pendiente.
- Búsqueda enfoca el campo arriba, prioriza Relevancia y permite abrir el buscador oficial con la sesión del proveedor. Los resultados internos no prometen replicar su algoritmo personal.
- Buffer inicial YouTube750ms y rebuffer1500ms; eliminada pausa redundante antes de cargar Spotify integrado. Latencia real depende de red/proveedor; no se midió una mejora en teléfono.

## Correcciones conservadas de 1.6

- Eventos nativos registrados una sola vez. Los cambios rápidos de pestaña no reinstalan listeners ni esperan animaciones; se cancela la restauración de scroll pendiente.
- Siguiente/Anterior responde de inmediato. La última selección sustituye la carga anterior; los eventos de otra entrada no pisan la actual. Se elimina la espera de escritura de historial antes del salto.
- **Volver a sortear la cola** aplica Fisher–Yates sólo a las próximas entradas, preserva duplicados y la canción actual, y garantiza un orden diferente cuando hay al menos dos próximas. Auto-Mix conserva su ajuste independiente.
- La cola arrastrada usa un borrador local y una sola confirmación al soltar; IDs estables, scroll durante drag y reconciliación si entra una canción o avanza la reproducción mientras se arrastra. Botones Subir/Bajar y listas progresivas de80 entradas.
- Barra de progreso con thumb local durante el gesto, confirmación al soltar y agrupación de órdenes de seek. Captura táctil no se cancela por perder la captura implícita de un hijo.
- Pausa sigue disponible durante la carga. Se acotan cargas atascadas a30s con reintento; se reconcilia estado real al volver de una acción de notificación. Se precarga la siguiente pista YouTube y se reutiliza durante5min un máximo de12 resoluciones; recuperar una fuente rechazada invalida su caché. No se afirma una latencia real de cuenta medida.
- **Segundo plano y pantalla apagada conservan el audio.** Retirar la tarea de Recientes cancela cargas, detiene el servicio multimedia y libera motores. Android administra la terminación del proceso de la app.
- Entradas suaves al cambiar de sección y al aparecer grupos durante el scroll, cancelables y visibles por defecto. Animate UI instalada como skill; se aplican sus tokens CSS (fade200ms/reveal300ms/ease.out), conservando React18 y Framer Motion existentes, sin nueva dependencia. Reduce Motion elimina el desplazamiento.

## Funciones conservadas de 1.5

- Gestos por zona y eje: deslizar fila a la derecha añade a continuación; minirreproductor cambia de pista; sólo el tirador central cierra el player hacia abajo. El seek conserva su función. Reordenar cola requiere el tirador y ofrece Subir/Bajar accesibles. Los bordes se reservan para Atrás de Android y se suprime el clic residual tras arrastrar.
- Historial de vistas, playlists, player, paneles y menús con Atrás/Adelante, sin duplicar pestañas ni volver a reproducir al navegar. Identidades por entrada evitan confundir canciones repetidas; los cambios de selección sustituyen la carga anterior y las transiciones tardías no saltan otra pista.
- MediaSession registrada directamente en el servicio, notificación multimedia, acceso al player y anterior/siguiente nativos. Pruebas con un controlador Media3 real y recursos Android en Robolectric; representación física pendiente.
- Carátulas reales en hero, filas, collages de mixes y playlists; fallback de miniatura YouTube para registros antiguos sin imagen. Listas progresivas de80 entradas y resolución de arte indexada/memoizada.
- Búsqueda por Populares, Más escuchadas por mí o Relevancia. Las métricas finitas no negativas se ordenan sólo entre posiciones medidas del mismo proveedor. Sin métrica se conserva el lugar original; no se compara un score Spotify con vistas YouTube. La biblioteca prioriza reproducciones locales de al menos30segundos y permite A–Z.
- Conexiones → **Tu acento**: amatista predeterminada, presets y color personalizado, luz ambiental opcional y contraste legible incluso con tonos oscuros. Las carátulas conservan sus colores. Transición de420ms de portada con desplazamiento, giro y desenfoque; Reduce Motion elimina el movimiento.

## Spotify y YouTube

Integrado · Premium usa librespot dentro de MURMUR, con autorización propia en `http://127.0.0.1:5588/login`. Para cuentas con rechazo de claves, **Integrado · Web** utiliza el SDK oficial: habilitar Web Playback SDK en la app de Spotify for Developers y renovar **Autorizar Spotify** con el Client ID propio, permisos streaming/email y retorno de biblioteca `http://127.0.0.1:43821/callback`. Connect controla un reproductor externo por elección explícita. Las cuentas existentes se conservan; no es necesario reconectarlas por esta actualización si siguen funcionando.

PKCE/state/caducidad y tokens cifrados. El receptor permanece activo en un servicio foreground durante el navegador; el retorno del motor permite recuperación manual sin persistir códigos. YouTube público no necesita sesión; para importar biblioteca privada se captura configuración desde la página YouTube Music autenticada. Son integraciones sujetas a cambios de los proveedores. El SDK Web no extrae claves DRM; no se portó todo SABR. Procedencia y licencias: `REPOSITORY-REVIEW.md`, `third_party/` y avisos del APK.

Voz, permisos, biblioteca local, overlays no destructivos, descargas YouTube privadas, respaldo/importación y temporizador se conservan. Los comandos dependen de los idiomas/servicios del teléfono y de Android; no hay escucha permanente. Crossfade simultáneo sólo entre pistas YouTube. Spotify no ofrece descargas offline en este proyecto.

## Ejecutar y compilar

```powershell
npm ci
npm test
npm run build
npx cap sync android
cd android
.\gradlew.bat assembleDebug testDebugUnitTest lintDebug -PnetworkSmoke
```

JDK21 (fuentes Java/Kotlin17), Android SDK35 y herramientas fijadas. Rust1.100.0, cargo-ndk4.1.2 y NDK28.2.13676358 para cuatro ABIs. Gradle invoca `scripts/build-spotify-native.mjs`; reconstrucción en `native/spotify/UPSTREAM.md`. Este equipo usa SDK en la misma unidad del proyecto por un problema de rutas D8 en Windows. Directorios de SDK/toolchain, secretos y checkouts de investigación quedan ignorados.

## Probar en PC y alcance

`npx vite preview --host 127.0.0.1 --port 5173`, después `http://127.0.0.1:5173`. El navegador permite revisar interfaz y biblioteca local; los puentes de reproducción/autorización siguen siendo Android. No se distribuye un motor Windows. La pestaña abierta previamente puede actualizarse para cargar1.5.

**118 pruebas web,54 nativas,9 escenarios de layout y3 perfiles de interacción táctil Chrome.** Datos de prueba y carátulas de las capturas están aislados y no van en el APK. No hubo Android físico para verificar los gestos/notificaciones1.5 ni medir60FPS. El emulador previo no arrancó con virtualización desactivada; no se cambió BIOS/Windows. MediaPipe0.10.14 mantiene una advertencia de alineación16KiB; las nuevas bibliotecas Spotify sí pasan ELF/JNI/alineación en cuatro ABIs. Detalles y límites: `VERIFICATION.md`.
