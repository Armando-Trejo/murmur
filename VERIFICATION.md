# Verificación MURMUR2.0

APK2.0/código12, 42468726bytes. SHA256 `00a5c1053bb3db3e08c9f84e0a5dc80d4976e6b3374a0412164d195c699206f6`. Firma v2 válida. Dist idéntico al APK y escaneo de datos privados sin filtración.

- Web138/138: verification/vitest-20.json. Incluye parseo de enlaces, URLs ajenas rechazadas, importación de metadatos de álbum, preservación offline y no reemplazar ante respuesta vacía.
- Android {'tests': 62, 'errors': 0, 'failures': 0, 'skipped': 0}; lint {'Error': 0, 'Fatal': 0, 'Warning': 101}. verification/android-tests-20.json, android-lint-20.json, session20-native.log. Smoke previo de reproducción pública YouTube activado. No equivale a probar nuevas colecciones remotas con sesiones personales.
- Chrome390: importación mock Spotify abre álbum sin autoplay, etiqueta persiste tras reload, directorio/artista/álbum y ausencia de overflow/errores; verification/collection-qa.json, session20-collection.log. Captura .impeccable/review/qa/collection-390.png.
- Chrome320/390/1280 de gestos y navegación: verification/experience-qa.json, session20-browser.log. Puente/audio simulados, no medición física.

Importar desde un enlace en Tu Biblioteca valida enlace completo/URI Spotify, playlist/álbum y lista/mix/álbum YouTube Music. Spotify requiere OAuth; YouTube público usa NewPipe con fallback Music y sesión cuando está disponible. Se cargan páginas antes de transacción local, preservando offline y tags. Mix RD se guarda como selección puntual, no radio infinita. Enlaces Spotify cortos necesitan su URL completa. Álbumes parciales locales muestran canciones disponibles.

Nuevos campos album/albumId y kind son opcionales, compatibles con registros existentes. Mostrar como cambia etiqueta local, no el proveedor. Directorios Artistas/Álbumes y artista en historial/URL; enlaces desde reproductor y menú de canciones. Página de artista combina biblioteca y resultados relevantes, no promete catálogo completo ni biografías.

Falta verificar importación de colecciones reales del usuario, restricciones del proveedor y UI física. Para datos de álbum de canciones antiguas, volver a sincronizar Spotify. Historial verification/VERIFICATION-1.9.1.md.
