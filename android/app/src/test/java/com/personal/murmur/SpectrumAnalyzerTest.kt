package com.personal.murmur

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.sin

class SpectrumAnalyzerTest {
    private val rate = 48_000

    private fun sine(frequency: Double, amplitude: Double, length: Int) =
        FloatArray(length) { (amplitude * sin(2 * PI * frequency * it / rate)).toFloat() }

    private fun settle(analyzer: SpectrumAnalyzer, window: FloatArray): VisualSpectrum {
        repeat(40) { analyzer.analyze(window, rate, 1f / 60f) }
        return analyzer.spectrum
    }

    @Test fun sineLightsItsOwnBandAndMidEnergy() {
        val analyzer = SpectrumAnalyzer()
        val spectrum = settle(analyzer, sine(1_000.0, .5, analyzer.fftSize))
        val loudest = spectrum.bands.indices.maxByOrNull { spectrum.bands[it] }!!
        val centre = spectrum.frequencies[loudest]
        assertTrue("1 kHz should land in its own band (got $centre Hz)", centre in 850f..1_180f)
        assertTrue(spectrum.bands[loudest] > .85f)
        for (b in spectrum.bands.indices) {
            val f = spectrum.frequencies[b]
            if (f < 300f || f > 3_500f) assertTrue("band at $f Hz leaked ${spectrum.bands[b]}", spectrum.bands[b] < .08f)
        }
        assertTrue(spectrum.mid > spectrum.bass * 4f)
        assertTrue(spectrum.mid > spectrum.high * 4f)
        analyzer.analyze(sine(1_000.0, .5, analyzer.fftSize), rate, 1f / 60f)
        assertFalse("A steady tone is not a beat", analyzer.spectrum.beat)
    }

    @Test fun bassSineDrivesBassAndPeaksHoldThenFall() {
        val analyzer = SpectrumAnalyzer()
        val spectrum = settle(analyzer, sine(60.0, .6, analyzer.fftSize))
        assertTrue("bass ${spectrum.bass}", spectrum.bass > .45f)
        assertTrue("high ${spectrum.high}", spectrum.high < .03f)
        val loudest = spectrum.bands.indices.maxByOrNull { spectrum.bands[it] }!!
        assertTrue(spectrum.frequencies[loudest] < 120f)
        val held = spectrum.peaks[loudest]
        val silence = FloatArray(analyzer.fftSize)
        repeat(12) { analyzer.analyze(silence, rate, 1f / 60f) } // 0.2 s: bars drop, peak dots wait
        assertTrue(spectrum.bands[loudest] < held * .5f)
        assertEquals(held, spectrum.peaks[loudest], 1e-4f)
        repeat(60) { analyzer.analyze(silence, rate, 1f / 60f) }
        assertTrue("peak dots fall after the hold", spectrum.peaks[loudest] < held * .2f)
    }

    @Test fun silenceStaysDarkAndNeverBeats() {
        val analyzer = SpectrumAnalyzer()
        val silence = FloatArray(analyzer.fftSize)
        repeat(120) {
            analyzer.analyze(silence, rate, 1f / 60f)
            assertFalse(analyzer.spectrum.beat)
        }
        assertTrue(analyzer.spectrum.bands.all { it < .01f })
        assertEquals(0L, analyzer.spectrum.beatCount)
    }

    /** 120 BPM kick drum under a sustained pad and hi-hat hiss: one beat per kick, on time. */
    @Test fun kickPatternTriggersOneBeatPerKickOnTime() {
        val seconds = 4.5
        val total = (seconds * rate).toInt()
        val noise = java.util.Random(7)
        val kicks = (0 until 8).map { .25 + it * .5 }
        val signal = FloatArray(total) { i ->
            val t = i.toDouble() / rate
            val pad = .12 * sin(2 * PI * 440 * t) + .08 * sin(2 * PI * 659.3 * t)
            val hat = .015 * (noise.nextDouble() * 2 - 1)
            var kick = 0.0
            for (onset in kicks) {
                val age = t - onset
                if (age >= 0 && age < .35) {
                    // Pitch-dropping sine (110 Hz -> 50 Hz) with a fast decay, like a real kick.
                    val phase = 2 * PI * (50 * age + 60 * .045 * (1 - exp(-age / .045)))
                    kick += .8 * exp(-age / .11) * sin(phase)
                }
            }
            (pad + hat + kick).toFloat()
        }
        val analyzer = SpectrumAnalyzer()
        val window = FloatArray(analyzer.fftSize)
        val beats = mutableListOf<Double>()
        val frames = (seconds * 60).toInt()
        for (frame in 0 until frames) {
            val centre = frame * rate / 60
            for (i in window.indices) {
                val at = centre - window.size / 2 + i
                window[i] = if (at in 0 until total) signal[at] else 0f
            }
            analyzer.analyze(window, rate, 1f / 60f)
            if (analyzer.spectrum.beat) beats += frame / 60.0
        }
        assertEquals("beats at $beats", kicks.size, beats.size)
        for ((kick, beat) in kicks.zip(beats)) {
            assertTrue("beat at $beat for kick at $kick", beat in kick - .04..kick + .05)
        }
        assertTrue(analyzer.spectrum.beatStrength > .2f)
    }

    @Test fun tapDownmixesPcm16AndFloatWithoutMovingTheBuffer() {
        val tap = VisualPcmTap(capacity = 4096)
        val pcm = ByteBuffer.allocate(4 * 3).order(ByteOrder.LITTLE_ENDIAN)
        repeat(3) { pcm.putShort(16384); pcm.putShort(-8192) } // L = .5, R = -.25
        pcm.flip()
        val rms = tap.write(pcm, VisualPcmTap.ENCODING_PCM_16BIT, 2, rate)
        assertEquals(0, pcm.position())
        assertEquals(kotlin.math.sqrt((.25 + .0625) / 2).toFloat(), rms, 1e-4f)
        val float = ByteBuffer.allocate(8 * 2).order(ByteOrder.LITTLE_ENDIAN)
        repeat(2) { float.putFloat(.75f); float.putFloat(.25f) }
        float.flip()
        tap.write(float, VisualPcmTap.ENCODING_PCM_FLOAT, 2, rate)
        assertEquals(5L, tap.written)
        val now = System.nanoTime()
        tap.publishAudible(2, now) // frame 2 audible now
        val out = FloatArray(4)
        assertTrue(tap.readAudible(out, now))
        // Window of 4 centred on frame 2 covers frames 0..3.
        assertEquals(.125f, out[0], 1e-4f)
        assertEquals(.125f, out[2], 1e-4f)
        assertEquals(.5f, out[3], 1e-4f)
        assertFalse("stale clocks read as silence", tap.readAudible(out, now + 2_000_000_000L))
    }

    @Test fun tapFollowsTheSinkMediaClockAcrossRingWrap() {
        val tap = VisualPcmTap(capacity = 1024)
        tap.handledPresentationUs = 5_000_000L
        val pcm = ByteBuffer.allocate(256 * 2).order(ByteOrder.LITTLE_ENDIAN)
        var next = 0
        repeat(12) { // 3072 frames: wraps the 1024 ring three times
            pcm.clear()
            repeat(256) { pcm.putShort(((next++ % 1000) * 30).toShort()) }
            pcm.flip()
            tap.write(pcm, VisualPcmTap.ENCODING_PCM_16BIT, 1, rate)
        }
        assertEquals(3072L, tap.written)
        val now = System.nanoTime()
        // Speaker is at 5 s + 2400 frames (50 ms) of media time.
        tap.publishMediaPosition(5_050_000L, now)
        val out = FloatArray(128)
        assertTrue(tap.readAudible(out, now))
        assertEquals(((2400 % 1000) * 30) / 32768f, out[64], 2e-4f)
        tap.discontinuity()
        tap.publishMediaPosition(9_000_000L, now) // ignored until the next buffer anchors the stream
        assertTrue(tap.readAudible(out, now))
        assertEquals(((2400 % 1000) * 30) / 32768f, out[64], 2e-4f)
    }

    @androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
    @Test fun tapEncodingsMatchWhatTheAudioSinkReports() {
        assertEquals(androidx.media3.common.C.ENCODING_PCM_16BIT, VisualPcmTap.ENCODING_PCM_16BIT)
        assertEquals(androidx.media3.common.C.ENCODING_PCM_8BIT, VisualPcmTap.ENCODING_PCM_8BIT)
        assertEquals(androidx.media3.common.C.ENCODING_PCM_FLOAT, VisualPcmTap.ENCODING_PCM_FLOAT)
        assertEquals(androidx.media3.common.C.ENCODING_PCM_24BIT, VisualPcmTap.ENCODING_PCM_24BIT)
        assertEquals(androidx.media3.common.C.ENCODING_PCM_32BIT, VisualPcmTap.ENCODING_PCM_32BIT)
        assertEquals(androidx.media3.common.C.TIME_UNSET, VisualPcmTap.TIME_UNSET)
    }

    @Test fun analyzerUpdateIsIdempotentPerFrameAndReleasesWhenPaused() {
        val tap = VisualPcmTap()
        val analyzer = SpectrumAnalyzer()
        val tone = sine(200.0, .5, 8192)
        tap.writeMono(tone, 0, tone.size, rate)
        var now = System.nanoTime()
        tap.publishAudible(4096, now)
        repeat(20) { now += 16_666_667L; tap.publishAudible(4096, now); analyzer.update(tap, true, now) }
        assertTrue(analyzer.spectrum.signal)
        val level = analyzer.spectrum.level
        assertTrue(level > .02f)
        analyzer.update(tap, true, now)
        assertEquals(level, analyzer.spectrum.level, 0f)
        repeat(60) { now += 16_666_667L; analyzer.update(tap, false, now) }
        assertFalse(analyzer.spectrum.signal)
        assertTrue(analyzer.spectrum.level < level * .05f)
        assertTrue(abs(analyzer.spectrum.pulse) < .01f)
    }
}
