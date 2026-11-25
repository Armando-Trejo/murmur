package com.personal.murmur

import org.junit.Assert.*
import org.junit.Test
import java.util.Random

class VoiceMatchTest {
    private val random = Random(7)
    private fun voice() = FloatArray(128) { random.nextGaussian().toFloat() }
    /** Another take by the same voice: the same direction plus recording noise. */
    private fun take(voice: FloatArray, noise: Double) = FloatArray(voice.size) { (voice[it] + random.nextGaussian() * noise).toFloat() }

    @Test fun cosineMeasuresDirectionAndRefusesWhatCannotBeCompared() {
        val a = floatArrayOf(1f, 2f, 3f)
        assertEquals(1.0, VoiceMatch.cosine(a, floatArrayOf(2f, 4f, 6f)), 1e-9)
        assertEquals(-1.0, VoiceMatch.cosine(a, floatArrayOf(-1f, -2f, -3f)), 1e-9)
        assertEquals(0.0, VoiceMatch.cosine(floatArrayOf(1f, 0f), floatArrayOf(0f, 1f)), 1e-9)
        assertTrue(VoiceMatch.cosine(a, floatArrayOf(1f, 2f)).isNaN())
        assertTrue(VoiceMatch.cosine(a, floatArrayOf(0f, 0f, 0f)).isNaN())
        assertTrue(VoiceMatch.cosine(floatArrayOf(), floatArrayOf()).isNaN())
    }

    @Test fun aConsistentEnrollmentGetsTheCeilingAndANoisyOneTheFloor() {
        val owner = voice()
        val clean = List(3) { take(owner, 0.3) }
        assertEquals(VoiceMatch.MAX_THRESHOLD, VoiceMatch.threshold(clean), 1e-9)
        val noisy = List(3) { take(owner, 2.5) }
        assertEquals(VoiceMatch.MIN_THRESHOLD, VoiceMatch.threshold(noisy), 1e-9)
    }

    @Test fun theThresholdSitsAMarginUnderTheLeastAlikeTake() {
        val owner = voice()
        val takes = List(3) { take(owner, 1.0) }
        val worst = takes.indices.minOf { i -> VoiceMatch.similarity(takes.filterIndexed { j, _ -> j != i }, takes[i]) }
        val expected = (worst - VoiceMatch.MARGIN).coerceIn(VoiceMatch.MIN_THRESHOLD, VoiceMatch.MAX_THRESHOLD)
        assertEquals(expected, VoiceMatch.threshold(takes), 1e-9)
        assertTrue(VoiceMatch.threshold(takes) in VoiceMatch.MIN_THRESHOLD..VoiceMatch.MAX_THRESHOLD)
    }

    @Test fun theOwnerPassesAndAnotherVoiceDoesNot() {
        for (noise in listOf(0.5, 1.0, 1.2)) {
            val owner = voice()
            val takes = List(3) { take(owner, noise) }
            val threshold = VoiceMatch.threshold(takes)
            repeat(20) {
                val later = take(owner, noise)
                assertTrue("owner noise=$noise", VoiceMatch.accepts(VoiceMatch.similarity(takes, later), threshold))
            }
            repeat(20) {
                val stranger = take(voice(), noise)
                assertFalse("stranger noise=$noise", VoiceMatch.accepts(VoiceMatch.similarity(takes, stranger), threshold))
            }
        }
    }

    @Test fun withoutAVectorThePhraseAloneDecides() {
        assertTrue(VoiceMatch.accepts(null, VoiceMatch.MAX_THRESHOLD))
        assertTrue(VoiceMatch.accepts(Double.NaN, VoiceMatch.MAX_THRESHOLD))
        // A profile from another model (other size) cannot be compared: never lock the owner out.
        assertTrue(VoiceMatch.accepts(VoiceMatch.similarity(listOf(voice(), voice()), FloatArray(64) { 1f }), 0.4))
    }

    @Test fun overMusicTheBarDropsALittleButNeverBelowTheFloor() {
        assertFalse(VoiceMatch.accepts(0.42, 0.45))
        assertTrue(VoiceMatch.accepts(0.42, 0.45, overMusic = true))
        assertFalse(VoiceMatch.accepts(VoiceMatch.MIN_THRESHOLD - 0.01, VoiceMatch.MIN_THRESHOLD, overMusic = true))
        assertTrue(VoiceMatch.accepts(0.45, 0.45))
    }

    @Test fun aTakeUnlikeThePreviousOnesIsAskedAgain() {
        val owner = voice()
        val previous = listOf(take(owner, 0.5), take(owner, 0.5))
        assertTrue(VoiceMatch.takeFits(emptyList(), voice()))
        assertTrue(VoiceMatch.takeFits(previous, take(owner, 0.5)))
        assertFalse(VoiceMatch.takeFits(previous, previous[0].map { -it }.toFloatArray()))
    }

    @Test fun theSampleIsTheUtteranceWithThePhraseWeightedByItsSpeech() {
        val owner = voice()
        val other = voice()
        val segments = listOf(
            VoiceMatch.Segment("la canción sigue", other, 120),
            VoiceMatch.Segment("ok murmura", owner, 80),
            VoiceMatch.Segment("", null, 0),
        )
        val (vector, frames) = VoiceMatch.sample(segments)!!
        assertEquals(80, frames)
        assertEquals(1.0, VoiceMatch.cosine(vector, owner), 1e-6)
        // The phrase split across utterances: every utterance with a vector counts, by frames.
        val split = listOf(VoiceMatch.Segment("ok", owner, 30), VoiceMatch.Segment("murmura", owner, 50))
        assertEquals(80, VoiceMatch.sample(split)!!.second)
        assertNull(VoiceMatch.sample(listOf(VoiceMatch.Segment("ok murmur", null, 0))))
    }

    @Test fun readsTheSpeakerVectorFromVoskResults() {
        val withVector = VoiceMatch.segment("""{"text":"ok murmura","spk":[0.5,-1.25,2.0],"spk_frames":73}""")
        assertEquals("ok murmura", withVector.text)
        assertArrayEquals(floatArrayOf(0.5f, -1.25f, 2f), withVector.vector, 1e-6f)
        assertEquals(73, withVector.frames)
        val plain = VoiceMatch.segment("""{"text":"ok"}""")
        assertNull(plain.vector)
        assertEquals(0, plain.frames)
        assertEquals("", VoiceMatch.segment("no es json").text)
        assertEquals("", VoiceMatch.segment(null).text)
    }

    @Test fun voiceMustRiseAboveTheRoom() {
        val silence = List(30) { 120.0 }
        assertEquals(0, VoiceMatch.voicedFrames(silence))
        val spoken = List(20) { 150.0 } + List(8) { 2_500.0 } + List(10) { 150.0 }
        assertEquals(8, VoiceMatch.voicedFrames(spoken))
        // Loud room (music): only what clearly rises above it counts.
        val loudRoom = List(30) { 900.0 } + List(5) { 1_500.0 } + List(4) { 3_000.0 }
        assertEquals(4, VoiceMatch.voicedFrames(loudRoom))
        assertEquals(0, VoiceMatch.voicedFrames(emptyList()))
    }

    @Test fun theProfileSurvivesStorageAndRejectsDamage() {
        val vectors = listOf(floatArrayOf(1f, 2f), floatArrayOf(3f, 4f), floatArrayOf(5f, 6f))
        val restored = VoiceProfile.fromJson(VoiceProfile(vectors, 0.42, enabled = true).toJson())!!
        assertEquals(0.42, restored.threshold, 1e-9)
        assertTrue(restored.enabled)
        assertEquals(3, restored.vectors.size)
        assertArrayEquals(vectors[2], restored.vectors[2], 1e-6f)
        assertFalse(restored.withEnabled(false).enabled)
        // A threshold out of range is brought back into it.
        assertEquals(VoiceMatch.MAX_THRESHOLD, VoiceProfile.fromJson(VoiceProfile(vectors, 0.99, true).toJson())!!.threshold, 1e-9)
        assertNull(VoiceProfile.fromJson("""{"threshold":0.4,"vectors":[[1,2]]}"""))
        assertNull(VoiceProfile.fromJson("""{"threshold":0.4,"vectors":[[1,2],[1]]}"""))
        assertNull(VoiceProfile.fromJson("basura"))
    }
}
