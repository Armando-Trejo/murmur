package com.personal.murmur

import org.junit.Assert.*
import org.junit.Test
import kotlin.math.PI
import kotlin.math.sin

class VoiceGenderTest {
    /** A voice-like tone: fundamental plus two harmonics, with a little vibrato. */
    private fun tone(hz: Double, rate: Int = 22050, seconds: Double = 1.0) = ShortArray((rate * seconds).toInt()) { i ->
        val t = i.toDouble() / rate
        val f = hz * (1 + 0.02 * sin(2 * PI * 5 * t))
        val v = sin(2 * PI * f * t) + 0.5 * sin(4 * PI * f * t) + 0.25 * sin(6 * PI * f * t)
        (v * 8000).toInt().toShort()
    }

    @Test fun aLowVoiceIsAMansAndAHighOneAWomans() {
        assertEquals(VoiceGender.MALE, VoiceGender.classify(VoiceGender.pitch(tone(120.0), 22050)))
        assertEquals(VoiceGender.FEMALE, VoiceGender.classify(VoiceGender.pitch(tone(215.0), 22050)))
    }

    @Test fun pitchIsMeasuredCloseToTheTruth() {
        val hz = VoiceGender.pitch(tone(180.0), 22050)!!
        assertEquals(180.0, hz, 8.0)
    }

    @Test fun silenceTellsNothing() {
        assertNull(VoiceGender.classify(VoiceGender.pitch(ShortArray(22050), 22050)))
    }

    @Test fun readsAPlainWav() {
        val samples = tone(150.0, 16000, 0.1)
        val data = java.io.ByteArrayOutputStream()
        fun le(v: Int, n: Int) { for (i in 0 until n) data.write((v shr (8 * i)) and 0xff) }
        data.write("RIFF".toByteArray()); le(36 + samples.size * 2, 4); data.write("WAVE".toByteArray())
        data.write("fmt ".toByteArray()); le(16, 4); le(1, 2); le(1, 2); le(16000, 4); le(32000, 4); le(2, 2); le(16, 2)
        data.write("data".toByteArray()); le(samples.size * 2, 4); samples.forEach { le(it.toInt(), 2) }
        val (read, rate) = VoiceGender.readWav(data.toByteArray())!!
        assertEquals(16000, rate)
        assertArrayEquals(samples, read)
    }

    @Test fun theSameSpeakerOnlineAndOffline() {
        assertEquals("es-us-x-esc", VoiceGender.speaker("es-us-x-esc-network"))
        assertEquals("es-us-x-esc", VoiceGender.speaker("es-us-x-esc-local"))
    }
}
