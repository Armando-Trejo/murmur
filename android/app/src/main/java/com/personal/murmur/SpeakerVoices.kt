package com.personal.murmur

/**
 * Picks and names the text-to-speech voices MURMUR can use (JVM-testable: plain data in, plain data out).
 * Spanish only; Mexican first, then US (Latin American) and Spain; higher quality first; voices that
 * are not installed are left out; network (neural) voices only rank first when the phone is online.
 */
object SpeakerVoices {
    data class Option(val name: String, val language: String, val country: String, val quality: Int,
        val network: Boolean, val notInstalled: Boolean = false)

    private fun countryRank(country: String) = when (country.uppercase()) { "MX" -> 0; "US", "419" -> 1; "ES" -> 3; else -> 2 }

    fun rank(options: List<Option>, online: Boolean = true): List<Option> = options
        .filter { it.language.lowercase() in setOf("es", "spa") && !it.notInstalled }
        .sortedWith(compareBy<Option> { countryRank(it.country) }
            .thenByDescending { it.quality }
            .thenBy { if (it.network == online) 0 else 1 }
            .thenBy { it.name })

    /** "Voz 1 · México · natural, en línea": engines do not say the gender, so people listen and choose. */
    fun label(option: Option, index: Int): String {
        val region = when (option.country.uppercase()) {
            "MX" -> "México"; "US", "419" -> "Latinoamérica"; "ES" -> "España"; else -> option.country.ifBlank { "Español" }
        }
        val quality = if (option.quality >= 400) "natural" else if (option.quality >= 300) "clara" else "básica"
        return "Voz ${index + 1} · $region · $quality" + if (option.network) ", en línea" else ""
    }
}
