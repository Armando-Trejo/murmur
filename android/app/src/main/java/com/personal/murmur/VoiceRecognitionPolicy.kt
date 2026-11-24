package com.personal.murmur

/** Android error constants kept as values so recovery policy is JVM-testable. */
object VoiceRecognitionPolicy {
    fun retryWithSystem(error: Int, onDevice: Boolean, retried: Boolean) =
        onDevice && !retried && error in setOf(4, 5, 11, 12, 13, 14, 15)
    fun message(error: Int): String = when (error) {
        1, 2 -> "El servicio de voz necesita conexión. Revisa tu red o descarga español en los ajustes de voz de Android."
        3 -> "No se pudo usar el micrófono. Cierra otras grabaciones y revisa el interruptor de acceso al micrófono de Android."
        6, 7 -> "No se entendió un comando. Acércate al micrófono y vuelve a intentarlo."
        8, 10 -> "El servicio de voz está ocupado. Espera un momento y vuelve a intentarlo."
        9 -> "Activa el permiso de micrófono en Ajustes de la app y comprueba el acceso al micrófono de Android."
        12, 13 -> "Español no está disponible en el servicio de voz. Descarga el idioma en los ajustes de voz de Android."
        else -> "El servicio de voz no respondió. Revisa que tengas un servicio de reconocimiento activado en Android."
    }
}
