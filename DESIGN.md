---
name: MURMUR
description: MURMUR 1.6, biblioteca musical local con controles AMOLED, audio integrado y artwork en color original.
colors:
  base: "#000000"
  surface: "#121212"
  active: "#1E1E1E"
  border: "#242424"
  accent: "#FFFFFF"
  secondary: "#A1A1AA"
  brand: "#B69AFF"
typography:
  display:
    fontFamily: 'Inter, Roboto, "Segoe UI", sans-serif'
    fontSize: "clamp(1.9rem, 8.5vw, 3.1rem)"
    fontWeight: 750
    lineHeight: 1.08
    letterSpacing: "-0.035em"
  headline:
    fontFamily: 'Inter, Roboto, "Segoe UI", sans-serif'
    fontSize: "1.2rem"
    fontWeight: 700
    letterSpacing: "-0.025em"
  body:
    fontFamily: 'Inter, Roboto, "Segoe UI", sans-serif'
    fontSize: "0.85rem"
    lineHeight: 1.5
  label:
    fontFamily: "monospace"
    fontSize: "9px"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "0.035em"
  wordmark:
    fontFamily: 'Inter, Roboto, "Segoe UI", sans-serif'
    fontSize: "0.78rem"
    fontWeight: 600
    letterSpacing: "0.28em"
rounded:
  cover: "5px"
  artwork: "8px"
  search: "7px"
  panel: "8px"
  connection: "12px"
  sheet: "20px 20px 0 0"
  pill: "25px"
  button: "28px"
spacing:
  tight: "8px"
  control-gap: "10px"
  panel: "20px"
  mobile-gutter: "22px"
components:
  button-primary:
    backgroundColor: "{colors.brand}"
    textColor: "{colors.base}"
    rounded: "{rounded.button}"
    padding: "12px 20px"
  button-secondary:
    backgroundColor: "{colors.active}"
    textColor: "{colors.accent}"
    rounded: "{rounded.button}"
    padding: "12px 20px"
  search-field:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.surface}"
    rounded: "{rounded.search}"
    padding: "0 14px"
    height: "54px"
  source-spotify:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.base}"
    typography: "{typography.label}"
    rounded: "3px"
    padding: "4px 6px"
  connection-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.accent}"
    rounded: "{rounded.connection}"
    padding: "18px"
---

# Design System: MURMUR

## Overview

**Creative North Star: "Una sola frecuencia"**

MURMUR reúne dos fuentes musicales en una interfaz española, compacta y personal. El mundo visual usa negro AMOLED, superficies tonales, un acento configurable y tipografía contundente. La dirección procede del brief final fijado por el usuario y de la implementación; la metáfora resume esa dirección, sin representar una nueva propuesta creativa aprobada.

La identidad usa el logo original aportado por el usuario: un isotipo blanco de trazos entrelazados y ondas laterales, acompañado por MURMUR en mayúsculas espaciadas. Los fondos y badges de fuente mantienen la base neutral; los controles activos admiten el acento elegido por el usuario. Las portadas y miniaturas conservan su color original por corrección explícita del usuario recogida en `PRODUCT.md`; su contenido no amplía la paleta de interfaz.

**Key Characteristics:**

- Negro AMOLED, seis primitivas neutrales y acento configurable.
- Identidad blanca con el isotipo original del usuario y nombre espaciado.
- Densidad musical compacta, artwork original en color, fallback geométrico y metadatos legibles.
- Estados y acciones que describen el acceso real disponible.

**Evidencia y alcance — MURMUR 1.6:** extraído de `src/App.tsx`, `src/styles.css`, `src/mobile-qa.css`, `src/experience.css`, `src/components/AppearanceSettings.tsx`, `src/components/SwipeSurface.tsx`, `src/components/SeekBar.tsx`, `src/main.tsx`, `src/core/AudioOrchestrator.ts`, `android/app/src/main/java/com/personal/murmur/MurmurApplication.kt`, `src/core/appearance.ts`, `src/core/useInterfaceNavigation.ts` y `src/core/musicOrder.ts`. La serie de capturas de QA, actualizada durante el cierre 1.6, usa `.impeccable/review/qa/experience-{390,320,1280}-{settings,home,player,queue,search}.png`; `experience-390-transition.png` muestra deliberadamente un instante de la animación normal. La revisión conserva escenarios de movimiento reducido y escenarios de movimiento normal para las entradas y el cambio de portada. Las portadas públicas reales son fixtures aislados de QA con procedencia en `verification/music-art-fixtures.json`; no se distribuyen con el producto ni representan biblioteca personal importada. En capturas de página completa, la navegación fija aparece a la altura del viewport y la cola puede estar desplazada. El usuario confirmó ambas fuentes de audio en 1.4/1.5 en su teléfono; los cambios nuevos de 1.6 no están comprobados en hardware. Las pruebas de controlador Media3 y recursos usan Robolectric; no certifican ejecución física de 1.6, voz, 60 fps ni latencia de una cuenta real. Las sesiones y configuración privada no deben copiarse a documentación o muestras.

El cierre de identidad y controles de voz se documenta con `.impeccable/review/qa/logo-new.png`, `.impeccable/review/qa/390x844-1-home.png` y `.impeccable/review/qa/390x844-1-connections.png`. Son capturas de navegador y una composición de recursos de apertura e icono; no prueban su ejecución en un teléfono ni reconocimiento de voz real.

## Colors

El frontmatter conserva seis primitivas neutrales y añade la marca predeterminada. El acento configurable autorizado en `PRODUCT.md` sustituye la antigua restricción de interfaz exclusivamente monocromática. Las transparencias de marca derivan del acento elegido.

### Primary

- **Amatista configurable — brand:** relleno de acciones principales, selección, progreso y luz ambiental opcional. «Tu acento», en Conexiones, ofrece Amatista, Menta, Ámbar, Rosa, Azul, Blanco y un color hexadecimal personalizado.
- **Blanco señal — accent:** isotipo, nombre, texto principal, búsqueda y badges neutros; conserva su función original aunque el acento de marca cambie.

### Neutral

- **Negro AMOLED — base:** lienzo y reproductor expandido; fondo y barras del sistema Android.
- **Carbón panel — surface:** tarjetas, categorías, conexiones y minirreproductor.
- **Carbón activo — active:** estados seleccionados secundarios, segmentos, botones secundarios y avisos oscuros.
- **Grafito límite — border:** contornos, separadores y superficies gráficas auxiliares.
- **Gris apoyo — secondary:** metadatos, texto secundario, navegación inactiva y segunda línea del titular.

**The Neutral Base and Chosen Accent Rule.** Mantener superficies AMOLED neutrales, logo blanco y badges monocromáticos. Usar el acento elegido en controles y detalles activos; `--brand-ink` selecciona negro o blanco para rellenos, mientras `--brand-readable` aclara colores oscuros para texto y foco. El color de las portadas es contenido y no crea tokens adicionales.

**The Stable Lettering Rule.** Los fallbacks geométricos de mix mantienen lettering blanco sobre un campo opaco de superficie; el disco no pasa por detrás del texto. Los collages de carátulas ocultan ese lettering y separan el pie blanco con un degradado oscuro.

Las portadas de canciones y miniaturas de vídeo conservan los colores de la imagen original; `src/styles.css` aplica `filter: none` a `.cover[src]`. El halo de portada deriva del acento de marca y es opcional. Los fallbacks geométricos locales permanecen monocromáticos; cuando hay carátulas guardadas o escuchadas, los mixes y playlists pueden mostrarlas en collage. La preferencia de acento y de luz ambiental se conserva localmente y en respaldos.

## Typography

**Display Font / Body Font:** Inter, Roboto, Segoe UI, sans-serif. Es una pila CSS; no supone una fuente Inter empaquetada ni garantiza métricas idénticas en todos los sistemas.

**Label/Mono Font:** monospace para chips de fuente, tiempos e identificadores técnicos.

**Character:** titulares densos con tracking negativo, texto funcional compacto y metadatos discretos. Sólo el nombre MURMUR usa el tracking amplio del frontmatter.

- **Display:** escala fluida según frontmatter, con salto de línea y ajuste de palabras que evitan desbordamiento. El override final mantiene esa escala en escritorio.
- **Headline:** según frontmatter; en escritorio (1.4rem). Títulos de página (1.8rem), peso (750), interlínea (1.13).
- **Title:** canción en fila (0.85rem), peso (650), interlínea (1.6), truncado de una línea. Título de mix (0.82rem).
- **Body:** textos de apoyo entre (0.72rem) y (0.85rem); explicación de conexión (0.8rem), interlínea (1.7).
- **Label:** chips según frontmatter; navegación inferior (0.65rem), peso (500), interlínea (1.2), con etiquetas capaces de envolver. Tiempos de fila (0.68rem) monoespaciados.
- **Wordmark:** según frontmatter; barra superior de escritorio (0.85rem). Mantener lectura completa y separación del isotipo.
- **Card lettering:** mayúsculas con escala `clamp(1.1rem, 5.3vw, 2.5rem)`; desde (680px), `clamp(1.8rem, 4vw, 3rem)`. Peso (750), interlínea (0.96), tracking (-0.04em), adaptación responsive y campo opaco. Búsqueda y Client ID usan entradas de (16px).

## Layout

Móvil primero y sin desplazamiento horizontal de pantalla. La app ocupa el ancho disponible, sus hijos permiten encoger y los textos largos envuelven. El contenido conserva márgenes laterales (22px), (16px) bajo (359px), y el relleno inferior es `calc(24px + var(--bottom-shell-height))`. Un `ResizeObserver` mide la altura real de la zona inferior y actualiza esa variable: no sustituirla por una reserva fija. La cabecera es sticky, negra y tiene altura mínima de (72px) más área segura.

Cuatro destinos persistentes: Inicio, Buscar, Tu Biblioteca y Conexiones. Barra inferior de altura mínima (76px) y altura real flexible; minirreproductor encima cuando existe una pista actual. Las etiquetas y los filtros envuelven en varias líneas: no usar carrusel horizontal de filtros. El minirreproductor tiene altura mínima (66px). La zona inferior y los avisos se posicionan usando la altura medida, incluso con fuente aumentada.

Accesos rápidos en dos columnas, tres desde (680px), con altura mínima (60px). Mixes en grid de dos columnas `minmax(0, 1fr)`, tres desde (680px), con separación vertical (18px) y horizontal (12px); los vídeos usan dos columnas. Arte de mix cuadrado y títulos capaces de envolver. Desde (1000px), rail lateral de (232px) reemplaza la barra inferior; contenido y zona inferior dejan ese espacio. Conexiones limita la lectura a (620px).

Reproductor completo: ancho disponible, portada limitada a `min(100%, 360px, 45dvh)` y línea de calidad que envuelve. Transporte con iconos de (44px), botón principal (64px), reducido a (56px) bajo (359px). Hojas de acción: ancho máximo (520px), alto máximo (85dvh).

En navegador se conservan los `env(safe-area-inset-*)`. En Android, `MainActivity` aplica al contenedor raíz los insets reales de barras, recorte y teclado mediante `WindowInsetsCompat`, y consume esos insets. La política se documenta desde código; requiere comprobación en dispositivo.

## Elevation & Depth

La profundidad procede de negro, superficie, activo y borde. No introducir sombras de tarjeta que compitan con esa jerarquía. La zona inferior tiene fondo negro sólido. Existen superposición negra translúcida en hojas y halo de marca tenue detrás de la portada. El minirreproductor y la tarjeta de escucha usan sombras ambientales derivadas del acento; «Luz ambiental» desactiva esas sombras y el halo, sin alterar las portadas. La legibilidad depende de campos sólidos.

Niveles implementados: zona inferior (25), reproductor (40), hoja (60), aviso (90). El aviso oscuro añade borde grafito (1px), radio (10px) y sombra negra (0 8px 28px). Foco visible: contorno de acento legible (2px), separación (4px). Los botones aplican brillo de hover (1.12); el botón de icono añade una película blanca tenue.

## Shapes

Portadas y accesos rápidos usan esquinas pequeñas; paneles usan radios medios; conexiones y ajustes usan el radio de conexión. Acciones principales y filtros son cápsulas; controles de icono y reproducción son círculos. Las hojas se redondean sólo arriba.

El isotipo procede del logo original del usuario; conservar sus trazos y proporciones, sin reconstruirlo mediante el antiguo símbolo geométrico simplificado. `src/components/MurmurMark.tsx` presenta `src/assets/murmur-mark.png` como imagen contenida, decorativa dentro de los botones de marca con nombre accesible; cabecera y rail usan ese mismo recurso.

Android conserva el fondo de arranque negro y los recursos raster en `android/app/src/main/res/drawable-nodpi/`: `murmur_mark.png` para el isotipo, `murmur_launcher.png` para el foreground del icono y `murmur_lockup.png` para la identidad completa original. `android/app/src/main/java/com/personal/murmur/SplashActivity.kt` muestra el lockup completo mediante `ImageView`, sin recomponer el nombre con texto del sistema. `drawable/ic_launcher_foreground.xml` usa el recurso de launcher; el icono adaptable y su variante monocromática lo comparten. `drawable/ic_murmur_isotype.xml` y `drawable/ic_stat_sound.xml` resuelven el nuevo isotipo para arranque del sistema y notificación. Verificar los recursos por API y densidad al modificarlos: la composición de recursos y la inspección de código no prueban su apariencia ejecutada en Android.

## Components

### Buttons and controls

Primario con acento de marca y texto negro o blanco según luminancia; secundario de activo con texto blanco. Altura mínima (48px), relleno (12px 20px), peso (700). Iconos circulares base (48 × 48px), reducidos a (44px) en filas, minirreproductor y transporte; reproducción principal (64 × 64px), (56 × 56px) en móvil estrecho. Segmentos, filtros y selectores revisados: mínimo (48px). Cierre de aviso (44 × 44px). Deshabilitado: opacidad (0.4) y cursor no disponible. No generalizar estas cifras a cualquier elemento sin inspeccionar su CSS.

Los dos accesos a Control por voz, en cabecera y Conexiones, se deshabilitan mientras la captura está pendiente. La cabecera expone además `aria-busy`; una captura no admite otra pulsación simultánea. Los errores de captura usan el aviso oscuro de error descrito abajo.

### Inputs and feedback

Búsqueda blanca (54px), texto oscuro y radio de búsqueda; borrado (44px). Client ID sobre negro con borde grafito; otros campos de hoja conservan superficie activa. Avisos siempre oscuros: fondo activo, texto blanco y borde grafito, con icono de éxito, error o información y cierre de (44px). Error usa `role="alert"`; información y éxito usan `role="status"`. Texto envuelto y posicionamiento `12px + altura medida de zona inferior`; no recuperar el aviso blanco anterior. Carga, error, sin resultados y biblioteca vacía tienen mensajes propios.

### Navigation and filters

Cuatro destinos con icono y etiqueta. Selección con acento legible en móvil y escritorio; el panel activo conserva su fondo neutral. El logotipo de cabecera y el del rail son botones para volver a Inicio, con nombre accesible. Las rutas hash inválidas regresan a `#/home` y muestran un aviso informativo. Los filtros mantienen selección blanca con texto negro; los segmentos de modo usan la tinta legible sobre una película del acento. Los filtros modifican colecciones reales: Música presenta Spotify, Solo YouTube limita esa fuente y Mix Híbrido muestra playlists locales híbridas. Inicio ofrece Daily Hybrid Mix, Puente Spotify → YouTube y Radar de descubrimiento; la cantidad visible cambia con el filtro.

### Source chips

**SPOTIFY:** sólido blanco con texto negro. **YT AUDIO:** contorno grafito, fondo transparente y texto gris. **MIX:** playlist híbrida local. Los badges identifican la fuente, sin mostrar bitrate o códec supuesto. La calidad Spotify depende del motor seleccionado y del proveedor; el stream de YouTube determina su códec real. Conservar títulos explicativos y línea contextual del reproductor.

### Mix and media cards

Las tarjetas de mix usan collages de carátulas guardadas o escuchadas; sin ellas muestran disco geométrico, lettering blanco sobre superficie opaca y botón circular blanco. Título y descripción debajo del arte. Portadas remotas y miniaturas mantienen el color original con carga diferida y `decoding="async"`; YouTube puede resolver su miniatura por ID de vídeo. Ante fallo se usa el gráfico geométrico local. Las playlists sin portada propia usan carátulas de sus canciones. La tarjeta de escucha destaca la última pista real con arte y acción de reproducción; no aparece para inventar actividad. Las filas usan carátula (56px), (48px) en móvil estrecho, y altura mínima (76px). Los resultados corresponden al proveedor. No introducir canciones ficticias para rellenar biblioteca vacía.

### Library and connections

Biblioteca vacía ofrece buscar o conectar; playlists vacías y descargas tienen texto propio. Spotify distingue sesión web guardada de biblioteca autorizada: cookie o sesión no son acceso API verificado. El CTA «Autorizar Spotify» permanece visible y la configuración se ofrece colapsada con el Client ID público preconfigurado. OAuth usa PKCE, sin Client Secret, y retorno loopback `http://127.0.0.1:43821/callback`. «Sincronizar biblioteca» se habilita con autorización verificada; el usuario puede comprobar acceso, renovarlo o abrir la app oficial. En navegador, las operaciones nativas informan que requieren el APK.

«Reproducción de Spotify» ofrece el modo predeterminado «Integrado · Premium», «Integrado · Web» y «Spotify Connect». El primero usa el motor Rust/librespot dentro de MURMUR y muestra «Activar Spotify integrado», «Renovar motor integrado» o «Reiniciar autorización del motor» según su estado. Su consentimiento adicional usa PKCE y retorno 127.0.0.1:5588/login, separado de la autorización de biblioteca. «Motor autorizado» describe permisos almacenados, no garantiza claves de audio ni una reproducción comprobada. Incluso sin sesión de biblioteca debe poder cerrarse la sesión del motor o cancelarse su consentimiento pendiente. Los selectores y botones mantienen las primitivas oscuras, foco visible, ajuste de línea y estados de carga existentes.

Dentro de «Configuración de Spotify», «Copiar configuración Android» explica cómo registrar paquete y huella únicamente para Connect/App Remote. El motor integrado no necesita esos datos ni abrir Spotify oficial. El botón se deshabilita mientras hay una operación pendiente y confirma éxito tras copiar. Las autorizaciones, audífonos, salida PCM y voz requieren validación en Android físico; las capturas de navegador no la sustituyen. «Integrado · Web» usa el SDK oficial de Spotify, EME del WebView y permisos streaming del Client ID propio. No extrae claves DRM ni incorpora todo SABR. El snippet del panel es una muestra visual sin datos reales.

YouTube presenta primero «Buscar audio de YouTube»: búsqueda y audio público son independientes de Spotify y no requieren cuenta. La sesión privada se ofrece en acción secundaria para intentar importar playlists. Progreso, cantidades importadas y listas inaccesibles tienen mensajes propios. Una importación no debe anunciar éxito ni crear listas vacías al fallar la obtención de canciones; las canciones y sus IDs se guardan juntos por playlist y los datos locales previos se conservan. Esa corrección se comprobó con respuesta simulada, sin validar una biblioteca personal real.

La descarga de embeddings es explícita (6 MB), con estado «Descargando modelo…» y mención de verificación SHA-256. La presencia del control no prueba una descarga ejecutada en Android. No confundirlo visualmente con una cuenta conectada.

Conexiones incluye las filas «Control por voz», «Voz y privacidad» y «Permisos de la app». La última abre los ajustes de la app Android para administrar micrófono y notificaciones. «Voz y privacidad» consulta la disponibilidad del reconocimiento y el permiso de micrófono: informa si falta un servicio o autorización y, cuando hay servicio local, recuerda que español debe estar descargado. La disponibilidad local no confirma un paquete de idioma instalado ni funcionamiento offline. En navegador estas acciones explican que requieren Android mediante los avisos existentes; no aparentan conceder permisos ni probar la voz.

### Recuperación de autorización y reproductor Web (1.4)

Integrado · Web es una alternativa explícita para el rechazo de claves librespot. Su ayuda dirige a habilitar Web Playback SDK y renovar Autorizar Spotify con el Client ID de biblioteca. Permisos concedidos no equivalen a audio confirmado. Los errores distinguen falta de EME/WebView, autorización y cuenta.

«El navegador no regresó» revela un campo password de enlace de retorno y «Completar autorización», deshabilitado vacío. El enlace sólo vive en memoria del formulario, se valida en nativo y no se persiste ni exporta. Un servicio foreground mantiene el receptor durante el acceso. Las muestras son sintéticas, sin códigos personales.

### Player and motion

Mini y reproductor completo, cola, letras y menús usan las mismas primitivas. Conservar nombres accesibles, foco visible y semántica de diálogo. Las letras activas pasan de gris a blanco; la línea de calidad describe el motor y la fuente disponibles sin atribuir un bitrate medido.

El cambio de canción superpone las portadas durante (420ms), con desplazamiento horizontal (32px), giro (3°) y desenfoque (6px), curva `cubic-bezier(0.16, 1, 0.3, 1)`. Movimiento reducido elimina desplazamiento, giro y desenfoque y usa duración cero. No confundir una captura intermedia deliberada con un fallo de portada.

**The Visible Before Motion Rule.** El contenido es visible por defecto. La entrada de página usa fade (200ms); cada grupo observado entra una vez por navegación con reveal (300ms), desplazamiento vertical (12px) y curva `cubic-bezier(0.23, 1, 0.32, 1)`. WAAPI anima encabezados de sección, tarjeta de escucha, grids y secciones de ajustes cuando entran en vista; al navegar se desconecta el observador y se cancelan las animaciones pendientes. La navegación no espera su finalización. Movimiento reducido conserva el fade sin desplazamiento; no oculta el contenido hasta que una animación termine.

Framer Motion enlaza superficies, selección y pulsaciones; reproductor con resorte (damping 32, stiffness 260) y pulsación (escala 0.94). `MotionConfig reducedMotion="user"` respeta la preferencia del sistema; portada y reproductor conservan además sus comprobaciones de `useReducedMotion`. Ecualizador CSS alternado (0.7s); `prefers-reduced-motion` suprime animaciones y transiciones CSS. El retorno del deslizamiento usa (150ms) con la curva de entrada y se elimina con movimiento reducido. Estos valores describen la implementación y no son una medición de rendimiento.

Durante la carga, el botón de transporte mantiene Pausa en el centro y un spinner atenuado; sigue disponible para cancelar la carga y pausar. El icono «Volver a sortear la cola» vuelve a ordenar aleatoriamente sólo las próximas canciones, conserva la actual y las anteriores y se deshabilita si hay menos de dos próximas. Shuffle y Auto Mix son acciones independientes.

La barra de posición conserva un borrador local bajo el dedo durante el arrastre: las actualizaciones del proveedor no desplazan el thumb. Al soltar confirma la posición; cancelar el puntero descarta el borrador. El teclado confirma sus cambios sin requerir un gesto táctil. El motor aplica debounce (80ms) y descarta operaciones de una canción anterior. Esa espera no representa latencia medida del proveedor.


### Gesture and navigation ownership

El deslizamiento a la derecha de una fila añade a la cola; la zona informativa del minirreproductor cambia de pista. Sólo el agarre central del reproductor admite cierre hacia abajo; el slider conserva únicamente búsqueda temporal. La cola se reordena desde su agarre y ofrece botones subir/bajar. Usa identidades estables por instancia, incluso para canciones repetidas; durante el gesto mantiene un borrador local y confirma el orden al soltar. Las filas se recolocan con resorte (stiffness 500, damping 40). El reproductor es dueño del scroll, con `layoutScroll` y desplazamiento automático al arrastrar cerca de sus bordes; la cola empieza con (80) entradas y permite ampliarlas. Los bordes laterales (26px) se reservan al gesto del sistema; el reconocimiento bloquea el eje y suprime el clic tras arrastrar. El movimiento vertical sobre texto de filas y cola desplaza la lista.

La navegación distingue página, playlist, reproductor, panel y hoja; deduplica pulsaciones repetidas de pestaña. Atrás/Adelante visibles y el historial del navegador restauran capas sin volver a reproducir la canción. Las listas muestran (80) entradas y «Mostrar más» amplía la vista sin recortar la cola completa; el índice de carátulas y los órdenes se memoizan. Los listeners nativos se mantienen estables. Al pulsar Siguiente varias veces, el índice avanza inmediatamente en cada acción: prevalece el último destino y se cancela la carga anterior, sin agrupar los avances en una única solicitud.

Al completar una playlist se retira su formulario del historial antes de abrir el detalle. Atrás devuelve a biblioteca sin reabrir el formulario completado.

### Ordering and native transport

Popularidad ordena únicamente métricas finitas no negativas dentro de las posiciones conocidas de cada proveedor; las pistas sin métrica conservan su posición exacta. No compara reproducciones YouTube con popularidad Spotify como si fueran una sola puntuación. El orden personal usa escuchas locales de al menos (30s), cantidad de reproducciones y tiempo acumulado; la relevancia conserva el orden original.

La sesión nativa se registra en MediaSessionService; la notificación abre el reproductor y ofrece anterior/siguiente para la cola nativa. El controlador Media3 y los recursos se verifican con Robolectric; la apariencia y respuesta físicas de los cambios 1.6 siguen pendientes de comprobación. La política1.7 conserva audio en segundo plano y pantalla apagada. Retirar la tarea cancela cargas y detiene el servicio; Android administra la vida del proceso. Comportamiento físico pendiente.

### Cierre interrumpible y cambios concurrentes

`PlayerLayer` conserva el cierre del reproductor independiente de la proyección de las filas: entrada por opacidad (200ms), salida (150ms), curva `cubic-bezier(0.23, 1, 0.32, 1)`. Al cerrar desactiva eventos táctiles y desmonta al terminar ese plazo; reabrir cancela el cierre pendiente y retoma la opacidad actual. La reducción de movimiento conserva este fade sin desplazamiento. Las animaciones de cola no pueden retener una pantalla cerrada.

Si cambia la cola real durante un arrastre, se cancela el gesto obsoleto y se adoptan las identidades vigentes. Al soltar se vuelve a leer la cola: se conservan las canciones recién encoladas y se descartan las que ya pasaron. El límite de carga también cubre los avances automáticos nativos; Pausa y reintento continúan disponibles.

## Do's and Don'ts

### Do:

- Do conservar las superficies neutrales, el acento configurable con contraste legible y el color original de portadas y miniaturas.
- Do mantener MURMUR en mayúsculas con su tracking amplio y usar los recursos originales del logo del usuario.
- Do conservar campos opacos bajo lettering geométrico, foco visible y reserva inferior medida para navegación persistente.
- Do representar bibliotecas, sesiones, carga y errores según datos reales.
- Do envolver filtros, títulos y navegación para mantener cero scroll horizontal con fuente aumentada.
- Do distinguir acceso Spotify verificado de sesión guardada y ofrecer YouTube público de forma independiente.
- Do verificar icono y splash resueltos en Android además de las capturas web.

### Don't:

- Don't reintroducir verdes o rojos como identificadores de proveedor.
- Don't aplicar escala de grises al artwork original ni convertir sus colores en tokens de interfaz.
- Don't situar lettering sobre el disco sin el campo sólido de contraste.
- Don't mostrar bitrate o códec supuesto en badges: usar SPOTIFY, YT AUDIO y MIX.
- Don't recuperar carruseles horizontales de filtros o mixes ni avisos blancos.
- Don't rellenar estados vacíos con cuentas o pistas que aparenten ser personales.
- Don't convertir una revisión de navegador en una afirmación de rendimiento o ejecución Android validada.
- Don't afirmar que español está descargado o que la voz offline funciona sólo porque hay un servicio local disponible.


## Corrección de interacción 1.7

La instrucción vigente conserva audio en segundo plano y con pantalla apagada; retirar la tarea detiene reproducción y servicio. Sustituye cualquier descripción previa de pausa por ocultación. Las tarjetas de mixes abren el contenido antes de reproducir; la cola tiene ancla y entradas accionables que descartan las anteriores al saltar.

Buscar reduce el encabezado al enfocar, coloca el campo arriba y usa Relevancia por defecto. Los accesos a búsquedas oficiales consultan la sesión del proveedor; no se promete replicar su algoritmo personal dentro de MURMUR.

Pantalla musical animada es una actividad nativa activada expresamente desde el reproductor: portada original, tres gradientes que toman sus colores, oscilación suave y controles. Se dibuja a un máximo objetivo de30FPS, se detiene al ocultarse y respeta desactivar animaciones. Modo inmersivo y showWhenLocked sin desbloquear ni lanzarse automáticamente; no reemplaza el lockscreen del sistema. Comportamiento físico y latencia real pendientes. Mantener MURMUR y sus cuatro destinos.


## Visual musical1.8

Referencias del usuario: esfera de partículas luminosa y ondas orgánicas, negro profundo y controles limpios. La actividad nativa dibuja3600 puntos en una esfera deformable y9 ondas; paleta derivada de portada con saturación/luz mínimas. Reloj arriba, título marquee y artista abajo, progreso y transporte vectorial. El arte no se desatura. Amplitud PCM local/YouTube sin micrófono; Web usa movimiento ambiental. Se respeta escala global de animación y se detiene dibujo al ocultar. No sustituye automáticamente keyguard.

Títulos musicales web en una línea, cinta bidireccional sólo si desbordan y son visibles, pausas18% al inicio/final y28px/s, mínimo7s. Reduce Motion elimina cinta y usa elipsis. Los mixes abren ruta antes de preparar datos; biblioteca local primero y descubrimiento posterior. Navegación no espera animaciones; ningún claim de latencia física de audio.


## Visual musical1.9

El usuario sustituye la esfera por una combinación de vinilo giratorio y aura fluida. Disco negro con surcos concéntricos, reflejo que gira y carátula circular a color como etiqueta. Seis campos radiales translúcidos derivan colores de portada y se desplazan como neblina; ocho contornos suaves envuelven el disco. Rotación sólo al reproducir; Reduce Motion detiene movimiento y se conserva parada de dibujo al ocultar. Se retira el selector Audio/Video del player. La notificación usa vectores propios24dp de skip anterior/siguiente con triángulo y barra orientados correctamente.


## Corrección1.9.1

Notificación usa comandos estándar skip previous/next en un adaptador ForwardingPlayer común para ambos motores; elimina flechas personalizadas extra. La prueba del controlador real comprueba anterior/pausa/siguiente y ejecuta saltos estándar. El visualizador incrementa deriva de niebla, contornos y ondas expansivas; detecta cambios de energía mediante envolventes rápida/lenta del PCM disponible. Web conserva movimiento ambiental y no se afirma beat PCM para ese motor. Importación de biblioteca YouTube pagina y reconoce tarjetas clásicas y Music.


## Colecciones2.0

La biblioteca incorpora un desplegable Importar desde un enlace y accesos Artistas / Álbumes. Formulario oscuro, campo URL de16px y48px mínimos, estado de importación y errores recuperables. Importar navega al contenido sin autoplay. Mostrar como guarda etiqueta local playlist/álbum sin modificar proveedor. Los artistas usan arte de música disponible, no retratos inventados; página con álbumes locales y hasta30 canciones locales/resultados relevantes. No se inventa biografía, conteo de oyentes ni catálogo completo. Navegación artista/directorio vive en historial y URL, con Back y scroll al cambiar. Álbumes parciales se identifican por canciones disponibles. Se conservan acento, logo y cuatro destinos.
