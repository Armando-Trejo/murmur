package com.personal.murmur

/**
 * The two checks behind "Ok MURMUR", like a phone assistant's wake word.
 *
 * 1. A cheap spotter that only knows the phrase (a tiny Vosk grammar) runs while there is sound.
 *    Because it can only answer with the words it knows, song lyrics or nearby talk can push it into
 *    "hearing" the phrase.
 * 2. When it fires, the same seconds of audio are transcribed again without that restriction. The
 *    phrase must appear in that open transcription too; lyrics come out as what they really say.
 *
 * Vosk's Spanish model has no word "murmur": it writes the name as "murmura", "murmuro" or
 * "mur mur", and "ok" sometimes as "o que".
 */
object WakePhrase {
    private val phrase = Regex("\\b(?:ok|okey|okay|oque|o que|o ke)\\s*(?:mur\\s*mur\\w*|mor\\s*mur\\w*|murmur\\w*)")

    /** True when recognised text contains the wake phrase. */
    fun heard(text: String) = phrase.containsMatchIn(YouTubeMusicPages.normalize(text))

    /** Second check: the open transcription of the same audio, utterance by utterance, contains the phrase. */
    fun confirmed(openTranscription: List<String>) = heard(openTranscription.joinToString(" "))

    /** Spotter vocabulary: the phrase as Vosk spells it, a few look-alikes so near misses land elsewhere, and [unk]. */
    val grammar: List<String> = listOf(
        "ok murmur", "okey murmur", "okay murmur", "o que murmura", "o que murmuro",
        "ok murmura", "okey murmura", "ok", "okey", "okay", "o", "que", "murmur", "murmura", "murmuro", "mur", "[unk]",
    )
}
