package com.personal.murmur

import org.json.JSONObject
import org.vosk.Model
import org.vosk.Recognizer

/**
 * The listening itself, one 100 ms frame at a time, apart from the microphone: the service feeds it
 * what the mic hears and the debug bench feeds it recordings, so what is measured is what runs.
 *
 * Battery: the spotter only sees a tiny grammar and only while there is sound. Silence is measured
 * with a cheap RMS and never decoded; half a second of pre-roll keeps the "ok". When the spotter
 * fires, [verify] gets the last seconds of audio and has the last word.
 */
class WakeDetector(
    model: Model,
    private val verify: (audio: List<ShortArray>, hard: Boolean) -> Boolean,
) : AutoCloseable {
    private val recognizer = Recognizer(model, RATE.toFloat(), org.json.JSONArray(WakePhrase.grammar).toString())
    private val preroll = ArrayDeque<ShortArray>()
    /** The last 2.5 s of audio, loud or not: what the second check transcribes. */
    private val recent = ArrayDeque<ShortArray>()
    private var hangover = 0
    private val level = WakeLevel()
    private var frames = 0
    private var verifyAt = -1
    private var quietUntil = 0

    /** True while nothing is being decoded or checked: a good moment to reopen the microphone. */
    val idle get() = hangover == 0 && verifyAt < 0
    val rms get() = level.rms
    val floor get() = level.floor
    val gain get() = level.gain

    /** [overMusic]: the phone itself is playing. True when «Ok MURMUR» was heard and confirmed. */
    fun accept(buffer: ShortArray, read: Int, overMusic: Boolean): Boolean {
        frames++
        val loud = level.measure(buffer, read, overMusic)
        val chunk = level.amplified(buffer, read)
        recent.addLast(chunk); if (recent.size > RECENT) recent.removeFirst()
        if (loud) hangover = HANGOVER // keep decoding 1.2 s after the last loud frame
        var spotted = false
        if (hangover > 0) {
            hangover--
            while (preroll.isNotEmpty()) spotted = feed(preroll.removeFirst()) || spotted
            spotted = feed(chunk) || spotted
            if (hangover == 0) { spotted = spotted(recognizer.finalResult, "text") || spotted; recognizer.reset() }
        } else {
            preroll.addLast(chunk); if (preroll.size > PREROLL) preroll.removeFirst()
        }
        // The spotter fired: let the phrase finish (0.4 s), then confirm it with an open transcription.
        if (spotted && verifyAt < 0 && frames >= quietUntil) verifyAt = frames + 4
        if (verifyAt !in 0..frames) return false
        verifyAt = -1
        recognizer.reset(); hangover = 0; preroll.clear()
        // Over music or from far away the voiceprint comes out blurred: a little more leeway.
        val confirmed = verify(recent.toList(), overMusic || level.gain > 2.5)
        // A refused near-miss must not stop the person who repeats it right away.
        quietUntil = frames + if (confirmed) 30 else 8
        return confirmed
    }

    private fun feed(samples: ShortArray): Boolean =
        if (recognizer.acceptWaveForm(samples, samples.size)) spotted(recognizer.result, "text")
        else spotted(recognizer.partialResult, "partial")

    private fun spotted(json: String?, key: String): Boolean {
        val text = runCatching { JSONObject(json ?: "{}").optString(key) }.getOrDefault("")
        return text.isNotBlank() && WakePhrase.heard(text)
    }

    override fun close() = recognizer.close()

    companion object {
        const val RATE = 16000
        const val FRAME = RATE / 10
        private const val HANGOVER = 12
        private const val PREROLL = 6
        private const val RECENT = 25
    }
}

/**
 * How loud the room is and how much a faraway voice must be brought up. The gain follows the voice
 * (not the room) and drops at once when someone speaks close, so a near voice is never clipped by
 * the boost a far one needed a moment before.
 */
class WakeLevel {
    var rms = 0.0; private set
    var floor = 200.0; private set
    var gain = 1.0; private set

    /** True when the frame carries something louder than the room. */
    fun measure(buffer: ShortArray, read: Int, overMusic: Boolean): Boolean {
        var sum = 0.0
        var peak = 0
        for (i in 0 until read) {
            val v = buffer[i].toInt()
            sum += v * v.toDouble()
            peak = maxOf(peak, kotlin.math.abs(v))
        }
        rms = kotlin.math.sqrt(sum / maxOf(1, read))
        // A voice from across the room (about -46 dBFS) in a quiet one; over music, clearly above it.
        val loud = rms > maxOf(if (overMusic) MUSIC_MIN else QUIET_MIN, floor * if (overMusic) 1.35 else 1.45)
        floor = if (rms < floor) floor * 0.8 + rms * 0.2 else floor * 0.995 + rms * 0.005
        if (loud) {
            val wanted = (TARGET / rms).coerceIn(1.0, MAX_GAIN)
            // Down at once, up gently.
            gain = if (wanted < gain) wanted else gain * 0.55 + wanted * 0.45
        }
        // Never past full scale: a clipped voice is decoded worse than a quiet one.
        if (peak > 0) gain = minOf(gain, maxOf(1.0, 30_000.0 / peak))
        return loud
    }

    fun amplified(buffer: ShortArray, read: Int): ShortArray {
        if (gain <= 1.05) return buffer.copyOf(read)
        return ShortArray(read) { i -> (buffer[i] * gain).toInt().coerceIn(-32_768, 32_767).toShort() }
    }

    companion object {
        const val QUIET_MIN = 170.0
        const val MUSIC_MIN = 450.0
        const val TARGET = 2_500.0
        const val MAX_GAIN = 10.0
    }
}
