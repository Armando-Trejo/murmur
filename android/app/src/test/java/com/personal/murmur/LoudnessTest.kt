package com.personal.murmur

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** «Volumen parejo»: loud songs down with the volume, quiet ones up with the enhancer, within limits. */
class LoudnessTest {
    @Test fun loudSongsGoDownQuietOnesUp() {
        Loudness.report("loud1234567", 7.0)
        Loudness.report("quiet123456", -4.0)
        // A song 7 dB over YouTube's reference lands at the target (3 dB over it): 4 dB down.
        assertEquals(10f.pow((Loudness.TARGET_DB - 7f) / 20f), Loudness.attenuation("loud1234567"), 1e-4f)
        assertEquals(0, Loudness.boostMb("loud1234567"))
        // One 4 dB under the reference comes up 7 dB, capped at the maximum boost.
        assertEquals(1f, Loudness.attenuation("quiet123456"), 0f)
        assertEquals((minOf(Loudness.TARGET_DB + 4f, Loudness.MAX_BOOST_DB) * 100).toInt(), Loudness.boostMb("quiet123456"))
    }

    @Test fun correctionsStayWithinLimits() {
        Loudness.report("veryloud123", 20.0)
        Loudness.report("veryquiet12", -20.0)
        assertEquals(-Loudness.MAX_CUT_DB, Loudness.correctionDb("veryloud123")!!, 0f)
        assertEquals((Loudness.MAX_BOOST_DB * 100).toInt(), Loudness.boostMb("veryquiet12"))
    }

    @Test fun unknownSongsAreLeftAlone() {
        assertNull(Loudness.correctionDb("unknown1234"))
        assertEquals(1f, Loudness.attenuation("unknown1234"), 0f)
        assertEquals(0, Loudness.boostMb(null))
    }

    @Test fun youtubesValueWinsOverAMeasurement() {
        Loudness.measure("both1234567", 9f)
        Loudness.report("both1234567", 3.0)
        assertEquals(3f, Loudness.known("both1234567")!!, 0f)
    }

    @Test fun readsYouTubesNewerAudioConfig() {
        // As YouTube sent it for «Toxicity»: 7.11 LKFS loud against a −14 target.
        val config = mapOf("perceptualLoudnessDb" to -7.11, "trackAbsoluteLoudnessLkfs" to -7.11, "loudnessTargetLkfs" to -14.0)
        assertEquals(6.89, Loudness.fromAudioConfig { config[it] }!!, 1e-6)
        assertEquals(3.5, Loudness.fromAudioConfig { mapOf("loudnessDb" to 3.5)[it] }!!, 0.0)
        assertNull(Loudness.fromAudioConfig { null })
    }

    private fun Float.pow(e: Float) = Math.pow(this.toDouble(), e.toDouble()).toFloat()
}
