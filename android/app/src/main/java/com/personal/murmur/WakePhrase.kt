package com.personal.murmur

/**
 * The two checks behind "Ok MURMUR", like a phone assistant's wake word. Anyone's voice can say it;
 * what is strict is the phrase: "ok" followed by the name, nothing that only resembles it.
 *
 * 1. A cheap spotter that only knows the phrase (a tiny Vosk grammar) runs while there is sound.
 *    Because it can only answer with the words it knows, song lyrics or nearby talk can push it into
 *    "hearing" the phrase.
 * 2. When it fires, the same seconds of audio are transcribed again (see [WakeCheck]): freely, with
 *    the next best guesses, and against a list of sound-alikes ("okay mamá", "murmullo", "Mauro")
 *    that give the trap sentences somewhere else to go. Lyrics come out as what they really say.
 *
 * Vosk's Spanish model has no word "murmur": it writes the name as "murmura", "murmuro", "mormón"
 * or "mur mur", and "ok" sometimes as "o que". Longer words ("murmuran", "murmullo") are not it.
 * Measured on the phone with WakeBenchReceiver (26 nov 2026).
 */
object WakePhrase {
    private const val OK = "\\b(?:ok|okey|okay)\\s*(?:mur\\s*mur[ao]?|mor\\s*mur[ao]?|murmur[ao]?|mormon)\\b"
    private val phrase = Regex("$OK|\\b(?:oque|o que|o ke)\\s*(?:murmur[ao]|mur\\s*mur[ao]?)\\b")
    private val clearOk = Regex(OK)

    /** True when recognised text contains the wake phrase. */
    fun heard(text: String) = phrase.containsMatchIn(YouTubeMusicPages.normalize(text))

    /** The open transcription of the audio, utterance by utterance, contains the phrase. */
    fun confirmed(openTranscription: List<String>) = heard(openTranscription.joinToString(" "))

    /** Against the sound-alikes only a clear "ok" counts: "o que" is how «oye, ¿qué murmuras?» starts. */
    fun beatsLookalikes(transcription: List<String>) =
        clearOk.containsMatchIn(YouTubeMusicPages.normalize(transcription.joinToString(" ")))

    /** Spotter vocabulary: the phrase as Vosk spells it, a few look-alikes so near misses land elsewhere, and [unk]. */
    val grammar: List<String> = listOf(
        "ok murmur", "okey murmur", "okay murmur", "o que murmura", "o que murmuro",
        "ok murmura", "okey murmura", "ok", "okey", "okay", "o", "que", "murmur", "murmura", "murmuro", "mur", "[unk]",
    )

    /** Second check's vocabulary: the phrase next to what is most often confused with it. */
    val lookalikes: List<String> = listOf(
        "ok murmur", "okey murmur", "okay murmur", "ok murmura", "okey murmura", "ok murmuro", "o que murmura", "o que murmuro",
        "mur mur", "ok mur mur", "ok", "okey", "okay", "mamá", "ok mamá", "okey mamá", "aunque mamá", "y mamá", "además",
        "muy bien", "muchas gracias", "gracias", "google", "mira", "mañana", "momento", "un momento", "me muero", "murieron",
        "murmullo", "el murmullo", "lo que murmuran", "que murmuras", "murmuran", "mauro", "muro", "mucho muro", "amor", "humor",
        "ocurrir", "mar", "mal", "muy", "más", "qué más da", "amigo", "marmolejo", "norma", "emma", "encima", "música", "[unk]",
    )
}
