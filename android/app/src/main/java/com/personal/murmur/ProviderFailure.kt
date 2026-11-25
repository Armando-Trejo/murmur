package com.personal.murmur

class ProviderFailure(val code: String, val status: Int, val provider: String, val operation: String, message: String) : Exception(message)

object ProviderFailures {
    fun invalidatesLibraryAccess(error: ProviderFailure): Boolean = error.status == 401 || error.code == "SPOTIFY_OAUTH_REQUIRED" || (error.operation == "oauth_token" && error.status == 400) || (error.status == 403 && error.operation in listOf("profile", "library"))
    fun response(status: Int, provider: String, operation: String, reason: String = ""): ProviderFailure {
        val spotify = provider == "spotify"
        val pair = when {
            status == 429 -> "RATE_LIMITED" to "${if (spotify) "Spotify" else "YouTube"} limitó las solicitudes. Espera unos minutos y vuelve a intentarlo."
            spotify && operation == "web_token" && status in listOf(400, 401, 403, 404) -> "SPOTIFY_OAUTH_REQUIRED" to "Spotify bloqueó el acceso por sesión web. Autoriza Spotify con OAuth desde Opciones (⋯); volver a guardar la cookie no concede permisos de biblioteca."
            status == 401 || (status == 400 && operation == "oauth_token") -> "SESSION_EXPIRED" to "La autorización de ${if (spotify) "Spotify" else "YouTube"} caducó. Vuelve a autorizar la cuenta."
            spotify && reason == "PREMIUM_REQUIRED" -> "SPOTIFY_PREMIUM_REQUIRED" to "Spotify exige una cuenta Premium para controlar la reproducción. La búsqueda y el audio de YouTube siguen disponibles."
            spotify && operation == "playback" && status == 404 -> "SPOTIFY_NO_DEVICE" to "No hay un dispositivo Spotify disponible. Abre la app oficial, reproduce una canción y vuelve a MURMUR."
            spotify && operation == "playlist" && status == 403 -> "SPOTIFY_PLAYLIST_NOT_ACCESSIBLE" to "Spotify no permite importar esta playlist. Comprueba que eres su propietario o colaborador; tus datos locales se conservan."
            // Spotify's development mode answers 403 to accounts not on the app's user list.
            spotify && status == 403 && operation in listOf("profile", "library", "oauth_token") -> "SPOTIFY_USER_NOT_ALLOWED" to "Tu cuenta de Spotify todavía no tiene acceso a MURMUR. Pide que la den de alta; mientras tanto puedes usar YouTube Music y buscar cualquier canción."
            spotify && status == 403 -> "SPOTIFY_PERMISSION_DENIED" to "Spotify no autorizó ${if (operation == "playback") "la reproducción" else "esta consulta"}. Reautoriza con OAuth y comprueba los permisos y usuarios permitidos de tu aplicación Spotify."
            !spotify && operation == "public_music" && status in listOf(401, 403) -> "YOUTUBE_CONTENT_UNAVAILABLE" to "YouTube Music no entregó este contenido ahora. Reintenta en unos segundos o elige otro."
            !spotify && status in listOf(401, 403) -> "YOUTUBE_PRIVATE_ACCESS_DENIED" to "YouTube no autorizó la biblioteca privada. Renueva esa sesión; puedes seguir buscando y escuchando audio público sin conectarla."
            status >= 500 -> "PROVIDER_UNAVAILABLE" to "El servicio no está disponible temporalmente. Intenta nuevamente."
            else -> "PROVIDER_REQUEST_FAILED" to "${if (spotify) "Spotify" else "YouTube"} respondió HTTP $status durante $operation. Intenta nuevamente."
        }
        return ProviderFailure(pair.first, status, provider, operation, pair.second)
    }
}
