package com.personal.murmur

import org.json.JSONObject
import org.vosk.Model
import org.vosk.Recognizer

/**
 * The second check of "Ok MURMUR" on the last seconds of audio. It passes when the phrase is among
 * the ten best free transcriptions (a short phrase with a name the model does not know is often its
 * second or third guess), or when it wins over the list of sound-alikes.
 */
object WakeCheck {
    const val ALTERNATIVES = 10

    fun passes(model: Model, audio: List<ShortArray>): Boolean =
        guesses(model, audio).any { WakePhrase.heard(it) } || againstLookalikes(model, audio)

    /** The free transcription's best guesses; each one joins the utterances of the audio. */
    private fun guesses(model: Model, audio: List<ShortArray>): List<String> {
        val utterances = mutableListOf<List<String>>()
        Recognizer(model, WakeDetector.RATE.toFloat()).use { recognizer ->
            recognizer.setMaxAlternatives(ALTERNATIVES)
            for (samples in audio) if (recognizer.acceptWaveForm(samples, samples.size)) utterances += alternatives(recognizer.result)
            utterances += alternatives(recognizer.finalResult)
        }
        // The phrase may be the n-th guess of one utterance while the others stay at their best.
        val best = utterances.map { it.firstOrNull().orEmpty() }
        return listOf(best.joinToString(" ")) + utterances.flatMapIndexed { i, options ->
            options.drop(1).map { option -> best.toMutableList().also { it[i] = option }.joinToString(" ") }
        }
    }

    private fun alternatives(json: String): List<String> = runCatching {
        val array = JSONObject(json).getJSONArray("alternatives")
        (0 until array.length()).map { array.getJSONObject(it).optString("text").trim() }
    }.getOrElse { emptyList() }

    private fun againstLookalikes(model: Model, audio: List<ShortArray>): Boolean {
        val parts = mutableListOf<String>()
        Recognizer(model, WakeDetector.RATE.toFloat(), org.json.JSONArray(WakePhrase.lookalikes).toString()).use { recognizer ->
            for (samples in audio) if (recognizer.acceptWaveForm(samples, samples.size)) parts += VoiceMatch.segment(recognizer.result).text
            parts += VoiceMatch.segment(recognizer.finalResult).text
        }
        return WakePhrase.beatsLookalikes(parts)
    }
}
