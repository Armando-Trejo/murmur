package com.personal.murmur

import kotlin.math.sqrt

/**
 * Text-to-speech engines don't say whether a voice is a woman's or a man's. MURMUR finds out once
 * per voice by synthesizing a short line and measuring its pitch: speaking voices sit around
 * 85–155 Hz for men and 165–255 Hz for women. Plain functions, JVM-testable.
 */
object VoiceGender {
    const val FEMALE = "mujer"
    const val MALE = "hombre"
    /** Between the usual male and female speaking ranges. */
    private const val SPLIT_HZ = 160.0

    /** "es-us-x-esc-network" and "es-us-x-esc-local" are the same speaker. */
    fun speaker(voiceName: String) = voiceName.removeSuffix("-network").removeSuffix("-local")

    fun classify(pitchHz: Double?): String? = when {
        pitchHz == null || pitchHz.isNaN() -> null
        pitchHz < SPLIT_HZ -> MALE
        else -> FEMALE
    }

    /** 16-bit PCM samples and rate of a WAV file (null when it is not plain PCM). */
    fun readWav(bytes: ByteArray): Pair<ShortArray, Int>? {
        if (bytes.size < 44 || String(bytes, 0, 4) != "RIFF" || String(bytes, 8, 4) != "WAVE") return null
        var at = 12
        var rate = 0
        var channels = 1
        var bits = 16
        while (at + 8 <= bytes.size) {
            val id = String(bytes, at, 4)
            val size = int(bytes, at + 4)
            val body = at + 8
            if (id == "fmt ") {
                channels = short(bytes, body + 2)
                rate = int(bytes, body + 4)
                bits = short(bytes, body + 14)
            } else if (id == "data") {
                if (bits != 16 || rate <= 0) return null
                val end = minOf(bytes.size, body + size)
                val frames = (end - body) / (2 * channels)
                val out = ShortArray(frames) { i -> short(bytes, body + i * 2 * channels).toShort() }
                return out to rate
            }
            at = body + size + (size and 1)
        }
        return null
    }

    /**
     * Median fundamental frequency of the voiced parts (autocorrelation per 40 ms frame, 70–400 Hz),
     * or null when there is too little voice to tell.
     */
    fun pitch(samples: ShortArray, rate: Int): Double? {
        val frame = rate * 40 / 1000
        val hop = frame / 2
        val minLag = rate / 400
        val maxLag = rate / 70
        if (samples.size < frame + maxLag) return null
        var loudest = 0.0
        for (s in samples) loudest = maxOf(loudest, kotlin.math.abs(s.toDouble()))
        val pitches = mutableListOf<Double>()
        var start = 0
        while (start + frame + maxLag <= samples.size) {
            var energy = 0.0
            for (i in start until start + frame) energy += samples[i].toDouble() * samples[i]
            val rms = sqrt(energy / frame)
            if (rms > loudest * 0.08) {
                var bestLag = 0
                var best = 0.0
                for (lag in minLag..maxLag) {
                    var corr = 0.0
                    var norm = 0.0
                    for (i in start until start + frame) {
                        corr += samples[i].toDouble() * samples[i + lag]
                        norm += samples[i + lag].toDouble() * samples[i + lag]
                    }
                    val r = if (norm > 0) corr / sqrt(energy * norm) else 0.0
                    if (r > best) { best = r; bestLag = lag }
                }
                if (best > 0.55 && bestLag > 0) pitches += rate.toDouble() / bestLag
            }
            start += hop
        }
        if (pitches.size < 5) return null
        pitches.sort()
        return pitches[pitches.size / 2]
    }

    private fun int(b: ByteArray, at: Int) =
        (b[at].toInt() and 0xff) or ((b[at + 1].toInt() and 0xff) shl 8) or ((b[at + 2].toInt() and 0xff) shl 16) or ((b[at + 3].toInt() and 0xff) shl 24)
    private fun short(b: ByteArray, at: Int) = ((b[at].toInt() and 0xff) or (b[at + 1].toInt() shl 8))
}
