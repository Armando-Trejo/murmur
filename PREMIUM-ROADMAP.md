# MURMUR · Hoja de ruta premium

Propuesta para llevar MURMUR al nivel de una app de música premium sin perder su identidad: negro AMOLED, acento configurable, carátulas a color, biblioteca local y privacidad. Cada bloque indica impacto para el usuario, esfuerzo, riesgo técnico y si necesita un teléfono para validarse.

## Entregado en 2.7.0

Respuesta a la prueba del usuario en su teléfono con 2.6.0.

| Mejora | Dónde | Estado |
| --- | --- | --- |
| Mixes y radios de YouTube leídos desde la cola `next` (con sesión y en público) | Inicio → mix, enlaces `RD…` | Pruebas del parser. Falta abrir mixes reales en el teléfono. |
| Carátulas HD por tamaño, sin franjas 4:3 y con reintentos | Toda la app y la notificación | Pruebas unitarias y vista previa. |
| Cola FIFO para lo que añade el usuario y «Añadir todo a la cola» | Filas, hoja de acciones, colecciones | Prueba del orquestador. |
| Paso sin corte: arranque 240 ms antes del final, silencio final y realce sólo en directos | `HybridMediaService` | Compila y pasa las pruebas del servicio. Falta escucharlo. |
| Letras: LRCLIB flexible y YouTube Music como respaldo | Reproductor → Letras | Pruebas con respuestas simuladas. |
| Perfil de artista y cabecera de álbum/playlist | Biblioteca, reproductor, Inicio | Vista previa con datos de demostración. |
| Bienvenida, menús ⋮, ajustes plegados, flecha de volver contextual | Inicio, Biblioteca, Buscar, Conexiones | Vista previa a 375 px. |
| Gestos: revelar «A la cola», portada deslizable, hoja arrastrable, onda de tinta | Toda la app | Vista previa; falta sentirlo en el teléfono. |
| Pantalla musical nueva con análisis de espectro y pulsos | `MusicVisualActivity` | Pruebas del analizador. Falta medir fluidez en el teléfono. |

## Entregado en 2.6.0

| Mejora | Dónde | Estado |
| --- | --- | --- |
| Fondo del reproductor con la luz de la carátula y minirreproductor teñido | Reproductor, barra inferior | Verificado en vista previa. Falta medir fluidez en teléfono. |
| Letras sincronizadas con seguimiento, atenuado y «Seguir la letra» | Reproductor → Letras | Verificado en vista previa con letra sintética. |
| «Tu resumen»: tiempo, racha, hora favorita, saltadas, 7 días, fuentes, top artistas y canciones | Tu Biblioteca, tarjeta en Inicio | Verificado en vista previa con historial sintético y pruebas unitarias. |
| Saludo contextual, esqueletos de carga y búsquedas recientes | Inicio, Buscar | Verificado en vista previa. |
| Temporizador de sueño con cuenta atrás y «Al terminar esta canción» | Reproductor, Conexiones | Pruebas Robolectric del servicio. Falta prueba física del final de pista. |
| Respuesta háptica del sistema | Controles, cola, guardar | Pruebas del mapeo. Falta prueba física. |
| Diagnóstico toque→audio (p50/p95, fallos, código) con informe saneado | Conexiones | Pruebas unitarias e integración con el orquestador. |

## Siguiente nivel: propuestas priorizadas

| # | Propuesta | Impacto | Esfuerzo | Riesgo | Teléfono |
| --- | --- | --- | --- | --- | --- |
| 1 | **Ecualizador y volumen normalizado.** Presets (Graves, Voz, Noche) y normalización de sonoridad con `android.media.audiofx` sobre la sesión de Media3. Para Spotify integrado, aplicar la ganancia al PCM propio. | Alto | Medio | Medio: cada fabricante implementa audiofx distinto | Sí |
| 2 | **Radio sin fin.** Al agotarse la cola, continuar con canciones afines (DiscoveryEngine + historial) y mostrar el origen «Porque escuchaste…». Desactivable. | Alto | Medio | Bajo | No para la lógica |
| 3 | **Widget de pantalla de inicio.** Carátula, título y anterior/pausa/siguiente con el tono de la portada. | Alto | Medio | Bajo | Sí |
| 4 | **Android Auto.** Pasar `HybridMediaService` a `MediaLibraryService` con árbol de navegación: Recientes, Playlists, Mixes, Descargas. | Alto para conducción | Alto | Medio | Sí, con DHU o coche |
| 5 | **Build de lanzamiento.** Keystore de release, R8/minify y recorte de recursos. El APK de depuración pesa ~42 MB. Requiere planear la migración de firma, porque Android no actualiza sobre una firma distinta. | Medio | Bajo | Alto si se cambia la firma sin plan | Sí |
| 6 | **Descargas inteligentes.** Descargar favoritas sólo con Wi-Fi, cola de descargas con progreso y cancelación, y pantalla de almacenamiento. | Medio | Medio | Bajo | Sí |
| 7 | **Tarjeta para compartir.** Imagen vertical con carátula, tono y verso elegido de la letra, compartida con el menú de Android. | Medio | Bajo | Bajo | No |
| 8 | **Material You opcional.** Acento tomado del fondo de pantalla en Android 12+, como un preset más. | Medio | Bajo | Bajo | Sí |
| 9 | **Primera ejecución guiada.** Tres pasos: conectar YouTube Music, elegir modo de Spotify y probar una canción, con el diagnóstico de 2.6 como comprobación final. | Medio | Bajo | Bajo | No |
| 10 | **Rendimiento con bibliotecas grandes.** Virtualizar listas largas y dividir `App.tsx` (≈3 000 líneas) por vistas con carga diferida. Reduce el tiempo de arranque y facilita el mantenimiento. | Medio | Medio | Bajo | Medición sí |
| 11 | **Portadas personalizadas** (plan P1 #10). Selector de fotos de Android, recorte y restauración. | Medio | Medio | Bajo | Sí |
| 12 | **Auditoría TalkBack y letra grande.** Orden de foco del reproductor, anuncios de cambio de pista y lectura de la letra activa. | Medio | Bajo | Bajo | Sí |

## Orden recomendado

1. Validar 2.7 en el teléfono con la matriz de [CONTINUAR-MURMUR.md](CONTINUAR-MURMUR.md) (mixes, paso entre canciones, letras y visualizador primero) y usar el diagnóstico para obtener los primeros p50/p95 reales.
2. Radio sin fin y primera ejecución guiada, porque no dependen del hardware y mejoran la retención.
3. Ecualizador, widget y descargas inteligentes, con pruebas en el teléfono del usuario.
4. Build de lanzamiento con plan de firma, y después Android Auto.
