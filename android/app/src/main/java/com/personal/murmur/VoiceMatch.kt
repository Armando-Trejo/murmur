package com.personal.murmur

import org.json.JSONObject
import kotlin.math.sqrt

/**
 * "Solo mi voz": the arithmetic behind speaker verification for "Ok MURMUR".
 *
 * Vosk's speaker model turns an utterance into an x-vector (128 numbers, already whitened). Two
 * utterances by the same person point in similar directions, so they are compared by cosine
 * similarity. A short phrase gives a noisy vector, so the enrollment keeps three takes, a wake is
 * compared with their average, and the threshold comes from how alike the owner's own takes were,
 * minus a margin and kept inside a range that never locks the owner out.
 */
object VoiceMatch {
    /** Takes in "Entrena tu voz". */
    const val TAKES = 3
    /** Lowest threshold: below it nearly any voice would pass. */
    const val MIN_THRESHOLD = 0.25
    /** Highest threshold: above it the owner could be refused on a noisy day or from farther away. */
    const val MAX_THRESHOLD = 0.50
    /** Room under the enrollment's own spread for another room, distance or mood. */
    const val MARGIN = 0.15
    /** Over the phone's own music the voice arrives through echo cancelling: a little more leeway. */
    const val OVER_MUSIC_RELIEF = 0.15
    /** A take this unlike the previous ones is probably another person or mostly noise. */
    const val MIN_TAKE_SIMILARITY = 0.20
    /** Speech frames (10 ms) a take needs for a vector worth keeping. */
    const val MIN_FRAMES = 40
    /** 100 ms frames louder than this (and than the room) count as voice in a take. */
    const val MIN_VOICE_RMS = 600.0
    /** Voiced 100 ms frames a take needs: less than this is a whisper or nothing at all. */
    const val MIN_VOICED_FRAMES = 3

    /** One utterance from the recognizer: its text, and its x-vector when Vosk could compute one. */
    class Segment(val text: String, val vector: FloatArray?, val frames: Int)

    /** Reads a Vosk result; "spk" and "spk_frames" only appear when the speaker model produced a vector. */
    fun segment(json: String?): Segment {
        val result = runCatching { JSONObject(json ?: "{}") }.getOrElse { JSONObject() }
        val spk = result.optJSONArray("spk")
        val vector = spk?.let { array -> FloatArray(array.length()) { array.optDouble(it, 0.0).toFloat() } }
            ?.takeIf { it.isNotEmpty() && it.all(Float::isFinite) }
        return Segment(result.optString("text"), vector, if (vector != null) result.optInt("spk_frames", 0) else 0)
    }

    /** Cosine similarity in [-1, 1]; NaN when the vectors cannot be compared (empty, zero, other size). */
    fun cosine(a: FloatArray, b: FloatArray): Double {
        if (a.size != b.size || a.isEmpty()) return Double.NaN
        var dot = 0.0; var na = 0.0; var nb = 0.0
        for (i in a.indices) {
            dot += a[i].toDouble() * b[i]
            na += a[i].toDouble() * a[i]
            nb += b[i].toDouble() * b[i]
        }
        if (na == 0.0 || nb == 0.0) return Double.NaN
        return dot / sqrt(na * nb)
    }

    /** Average direction of several vectors, each scaled to unit length first; optional weights. */
    fun centroid(vectors: List<FloatArray>, weights: List<Int>? = null): FloatArray? {
        val dim = vectors.firstOrNull()?.size ?: return null
        val sum = DoubleArray(dim)
        var used = 0
        for ((index, vector) in vectors.withIndex()) {
            if (vector.size != dim) return null
            var norm = 0.0
            for (value in vector) norm += value.toDouble() * value
            norm = sqrt(norm)
            if (norm == 0.0 || !norm.isFinite()) continue
            val weight = weights?.getOrNull(index)?.toDouble() ?: 1.0
            for (k in 0 until dim) sum[k] += vector[k] / norm * weight
            used++
        }
        return if (used == 0) null else FloatArray(dim) { sum[it].toFloat() }
    }

    /**
     * The voice in what the recognizer heard: the utterances that contain the phrase (or every
     * utterance with a vector, when the phrase was split), weighted by their speech frames.
     */
    fun sample(segments: List<Segment>): Pair<FloatArray, Int>? {
        val voiced = segments.filter { it.vector != null && it.frames > 0 }
        val chosen = voiced.filter { WakePhrase.heard(it.text) }.ifEmpty { voiced }
        if (chosen.isEmpty()) return null
        val vector = centroid(chosen.map { it.vector!! }, chosen.map { it.frames }) ?: return null
        return vector to chosen.sumOf { it.frames }
    }

    /** How much a sample sounds like the enrolled takes: cosine against their average. */
    fun similarity(takes: List<FloatArray>, sample: FloatArray): Double =
        centroid(takes)?.let { cosine(it, sample) } ?: Double.NaN

    /**
     * Threshold from the enrollment itself: each take is compared with the average of the others
     * (as a future wake will be compared with the average of all three); the least alike, minus
     * [MARGIN], clamped to [MIN_THRESHOLD]..[MAX_THRESHOLD].
     */
    fun threshold(takes: List<FloatArray>): Double {
        if (takes.size < 2) return MIN_THRESHOLD
        val worst = takes.indices
            .map { i -> similarity(takes.filterIndexed { j, _ -> j != i }, takes[i]) }
            .filter { !it.isNaN() }
            .minOrNull() ?: return MIN_THRESHOLD
        return (worst - MARGIN).coerceIn(MIN_THRESHOLD, MAX_THRESHOLD)
    }

    /** A new take is kept only if it resembles the ones already recorded. */
    fun takeFits(previous: List<FloatArray>, take: FloatArray): Boolean {
        if (previous.isEmpty()) return true
        val similarity = similarity(previous, take)
        return similarity.isNaN() || similarity >= MIN_TAKE_SIMILARITY
    }

    /**
     * Accept decision. No similarity (the vector could not be computed, or the profile came from
     * another model) falls back to the phrase check alone: the owner is never locked out.
     */
    fun accepts(similarity: Double?, threshold: Double, overMusic: Boolean = false): Boolean {
        if (similarity == null || similarity.isNaN()) return true
        val needed = if (overMusic) (threshold - OVER_MUSIC_RELIEF).coerceAtLeast(MIN_THRESHOLD) else threshold
        return similarity >= needed
    }

    /** 100 ms frames of a take that carry voice: louder than [MIN_VOICE_RMS] and than twice the room. */
    fun voicedFrames(rms: List<Double>): Int {
        if (rms.isEmpty()) return 0
        val floor = rms.sorted()[rms.size / 10]
        val needed = maxOf(MIN_VOICE_RMS, minOf(floor * 2.0, 2_000.0))
        return rms.count { it > needed }
    }
}
