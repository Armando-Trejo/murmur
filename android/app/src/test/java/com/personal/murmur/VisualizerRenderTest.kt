package com.personal.murmur

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.view.View
import android.view.ViewGroup
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import kotlin.math.PI
import kotlin.math.exp
import kotlin.math.sin

/** Drives the stage with a synthetic song (kick, bassline, pad, hats) and renders real frames. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class VisualizerRenderTest {
    private val rate = 48_000

    private fun song(seconds: Double): FloatArray {
        val noise = java.util.Random(3)
        val total = (seconds * rate).toInt()
        val beat = .47 // ~128 BPM
        return FloatArray(total) { i ->
            val t = i.toDouble() / rate
            val inBeat = t % beat
            val kickAge = inBeat - .05
            val kick = if (kickAge >= 0 && kickAge < .3) {
                .75 * exp(-kickAge / .1) * sin(2 * PI * (48 * kickAge + 70 * .04 * (1 - exp(-kickAge / .04))))
            } else 0.0
            val note = if ((t / (beat * 2)).toInt() % 2 == 0) 55.0 else 73.4
            val bassline = .16 * sin(2 * PI * note * t) * (.6 + .4 * sin(2 * PI * t / beat))
            val pad = .07 * (sin(2 * PI * 440 * t) + sin(2 * PI * 554.4 * t) + sin(2 * PI * 659.3 * t))
            val hatAge = (t + beat / 2) % (beat / 2)
            val hat = .05 * exp(-hatAge / .02) * (noise.nextDouble() * 2 - 1)
            (kick + bassline + pad + hat).toFloat()
        }
    }

    private fun render(name: String, widthDp: Int, heightDp: Int, look: Pair<Int, Int>? = null) {
        val service = Robolectric.buildService(HybridMediaService::class.java).create()
        org.robolectric.util.ReflectionHelpers.setField(service.get(), "track",
            org.json.JSONObject().put("title", "Afuera (El nervio del volcán)").put("artist", "Caifanes").put("duration", 290))
        val activity = Robolectric.buildActivity(MusicVisualActivity::class.java).create().start().resume()
        try {
            shadowOf(android.os.Looper.getMainLooper()).idle()
            val root = activity.get().window.decorView
            val density = activity.get().resources.displayMetrics.density
            val width = (widthDp * density).toInt()
            val height = (heightDp * density).toInt()
            root.measure(View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
                View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY))
            root.layout(0, 0, width, height)
            fun <T : View> find(view: View, type: Class<T>): T? = when {
                type.isInstance(view) -> type.cast(view)
                view is ViewGroup -> (0 until view.childCount).firstNotNullOfOrNull { find(view.getChildAt(it), type) }
                else -> null
            }
            val stage = checkNotNull(find(root, AuraStageView::class.java))
            stage.setArtwork(BitmapFactory.decodeFile("../../verification/fixtures/cover-2.jpg"))
            look?.let { stage.showLook(it.first, it.second) }
            val signal = song(4.0)
            val analyzer = SpectrumAnalyzer()
            val window = FloatArray(analyzer.fftSize)
            var now = 1_000_000_000L
            var frame = 0
            stage.clock = { now }
            stage.spectrumSource = {
                val centre = frame * rate / 60
                for (i in window.indices) {
                    val at = centre - window.size / 2 + i
                    window[i] = if (at in signal.indices) signal[at] else 0f
                }
                analyzer.analyze(window, rate, 1f / 60f)
            }
            stage.playing = true
            val output = java.io.File("build/visualizer-preview").apply { mkdirs() }
            val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(bitmap)
            var beats = 0
            var saved = 0
            var lastBeat = -100
            for (f in 0 until 160) {
                frame = f
                now += 16_666_667L
                root.draw(canvas)
                if (analyzer.spectrum.beat) { beats++; lastBeat = f }
                val keep = f == 60 || (f > 100 && saved < 3 && f - lastBeat == 2) || f == 159
                if (keep) {
                    saved++
                    java.io.File(output, "$name-${"%03d".format(f)}.png").outputStream().use {
                        bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)
                    }
                }
            }
            assertTrue("the synthetic song should produce beats, got $beats", beats >= 5)
        } finally {
            activity.pause().stop().destroy()
            service.destroy()
        }
    }

    @Test @Config(qualifiers = "w390dp-h844dp-port-xxhdpi") fun portraitStageReactsToBeats() = render("portrait", 390, 844)

    @Test @Config(qualifiers = "w844dp-h390dp-land-xxhdpi") fun landscapeStageReactsToBeats() = render("landscape", 844, 390)

    /** One preview per look: every background with a rhythm indicator (build/visualizer-preview). */
    @Test @Config(qualifiers = "w390dp-h844dp-port-xxhdpi") fun everyLookRenders() {
        render("look-liquido-pulso", 390, 844, 0 to 0)
        render("look-malla-topo", 390, 844, 1 to 1)
        render("look-seda-glow", 390, 844, 2 to 2)
        render("look-aurora-pulso", 390, 844, 3 to 0)
    }
}
