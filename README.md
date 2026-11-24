# MURMUR 2.5.1

App Android de música con biblioteca local, reproducción de Spotify y YouTube, feeds por proveedor, visualizador de aura y letras de LRCLIB con búsqueda en Genius. Paquete `com.personal.murmur`, Android 8.0 o posterior. Interfaz React y Capacitor, servicio Kotlin/Media3 y motor Rust/librespot.

[Plan del siguiente agente](SIGUIENTE-AGENTE.md) · [Estado y pruebas para retomar](CONTINUAR-MURMUR.md) · [Componentes externos](REPOSITORY-REVIEW.md)

## Compilar

1. Instala Node.js, JDK 21 y Android SDK 35. Consulta el NDK, los objetivos Rust y cargo-ndk fijados en [native/spotify/UPSTREAM.md](native/spotify/UPSTREAM.md). Configura su ruta con `ANDROID_NDK_HOME`.
2. Desde la raíz, ejecuta `npm ci` y `npm run android:sync`.
3. Desde `android`, ejecuta `.\gradlew.bat :app:testDebugUnitTest :app:lintDebug :app:assembleDebug` en Windows. En otros sistemas usa `./gradlew`. El APK de depuración se genera en `android/app/build/outputs/apk/debug/app-debug.apk`.
4. Para escuchar Spotify, configura el Client ID de tu aplicación en Conexiones y registra el retorno documentado allí. El ajuste se guarda en el dispositivo. El APK de este repositorio requiere la misma firma local que tu versión instalada para actualizar sobre ella.

Usa `npm test` para las pruebas web. Ejecuta `npm run dev` para la interfaz o `node scripts/build-motion-preview.mjs` para generar el HTML interactivo de prueba. La demo usa pistas, carátulas y pulso de ejemplo. Las bibliotecas nativas generadas, el APK y el HTML se construyen localmente.

## Historial

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
