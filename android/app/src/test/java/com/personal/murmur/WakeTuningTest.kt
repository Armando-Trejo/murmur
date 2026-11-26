package com.personal.murmur

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WakeTuningTest {
    @Test fun acceptsTheWaysTheModelWritesTheExactPhrase() {
        // As transcribed on the phone from several voices saying «Ok MURMUR».
        for (text in listOf("okay murmuro", "okay mormón", "ok murmura", "okey mur mur", "okaymurmur", "o que murmuro"))
            assertTrue(text, WakePhrase.heard(text))
    }

    @Test fun onlyTheExactNameCounts() {
        for (text in listOf("oye qué murmuras", "o que murmuran", "ok murmullo", "okey mauro", "ok mamá", "ok muy bien",
            "lo que murmura la gente", "ok mortal combat", "murmuro", "ok murmurando", "okay marmolejo"))
            assertFalse(text, WakePhrase.heard(text))
    }

    @Test fun againstTheLookalikesOnlyAClearOkCounts() {
        assertTrue(WakePhrase.beatsLookalikes(listOf("ok murmura")))
        assertFalse(WakePhrase.beatsLookalikes(listOf("o que murmura")))
        assertFalse(WakePhrase.beatsLookalikes(listOf("ok mamá")))
    }

    private fun frame(amplitude: Int) = ShortArray(WakeDetector.FRAME) { (if (it % 2 == 0) amplitude else -amplitude).toShort() }

    @Test fun aFarVoiceIsHeardAndBroughtUp() {
        val level = WakeLevel()
        repeat(20) { level.measure(frame(60), WakeDetector.FRAME, false) }
        assertTrue(level.measure(frame(220), WakeDetector.FRAME, false))
        repeat(5) { level.measure(frame(250), WakeDetector.FRAME, false) }
        assertTrue(level.gain > 5)
    }

    @Test fun aCloseVoiceRightAfterAFarOneIsNeverClipped() {
        val level = WakeLevel()
        repeat(8) { level.measure(frame(250), WakeDetector.FRAME, false) }
        level.measure(frame(20_000), WakeDetector.FRAME, false)
        val loudest = level.amplified(frame(20_000), WakeDetector.FRAME).maxOf { it.toInt() }
        assertTrue("$loudest", loudest <= 30_000)
    }

    @Test fun volumeStepsStayInsideTheSlider() {
        assertEquals(13, VolumeSteps.target(10, 15, "up", null))
        assertEquals(15, VolumeSteps.target(14, 15, "up", null))
        assertEquals(0, VolumeSteps.target(2, 15, "down", null))
        assertEquals(8, VolumeSteps.target(2, 15, null, 50))
        assertEquals(15, VolumeSteps.target(2, 15, null, 400))
        assertEquals(100, VolumeSteps.percent(15, 15))
    }

    @Test fun anOldVoiceProfileComesBackSwitchedOff() {
        val vectors = "[[1,0,0],[0.9,0.1,0]]"
        assertFalse(VoiceProfile.fromJson("""{"version":1,"enabled":true,"threshold":0.4,"vectors":$vectors}""")!!.enabled)
        assertTrue(VoiceProfile.fromJson("""{"version":2,"enabled":true,"threshold":0.4,"vectors":$vectors}""")!!.enabled)
    }
}
