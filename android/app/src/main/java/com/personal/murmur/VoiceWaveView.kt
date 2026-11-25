package com.personal.murmur

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.provider.Settings
import android.view.View
import kotlin.math.PI
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin

/**
 * Assistant-style voice waves: four soft, tapered sine waves in MURMUR's colours that swell with the
 * voice level (the recognizer's RMS) and breathe gently while waiting. While MURMUR works out the
 * request they settle into a calm pulse. With animations turned off in Android they stay still.
 */
class VoiceWaveView(context: Context) : View(context) {
    enum class Mode { WAITING, LISTENING, THINKING }

    private val density = resources.displayMetrics.density
    private val colors = intArrayOf(Color.rgb(179, 157, 250), Color.rgb(255, 122, 198), Color.rgb(110, 200, 255), Color.WHITE)
    private val alphas = intArrayOf(235, 170, 150, 110)
    private val paints = colors.mapIndexed { i, color ->
        Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeCap = Paint.Cap.ROUND
            strokeWidth = (if (i == 0) 3.2f else 2.2f) * density
            this.color = color
            alpha = alphas[i]
        }
    }
    private val path = Path()
    private var target = 0f
    private var level = 0f
    private var phase = 0f
    private var lastFrame = 0L
    private val still = runCatching {
        Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
    }.getOrDefault(false)

    var mode = Mode.WAITING
        set(value) { field = value; invalidate() }

    /** Recognizer RMS in dB (about -2 silent … 10 loud) to a 0–1 level. */
    fun setRms(rmsDb: Float) { target = VoiceLevels.normalize(rmsDb) }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val now = System.nanoTime()
        val dt = if (lastFrame == 0L) 0.016f else min(0.05f, (now - lastFrame) / 1e9f)
        lastFrame = now
        // Fast attack, slow release: the waves jump with a syllable and fall back softly.
        val goal = when (mode) { Mode.LISTENING -> target; Mode.WAITING -> 0.06f; Mode.THINKING -> 0.1f }
        level += (goal - level) * min(1f, dt * if (goal > level) 18f else 4.5f)
        if (!still) phase += dt * when (mode) { Mode.THINKING -> 5.5f; Mode.WAITING -> 2.2f; Mode.LISTENING -> 4f + level * 6f }

        val w = width.toFloat(); val h = height.toFloat(); val mid = h / 2f
        val pulse = if (mode == Mode.THINKING && !still) 0.55f + 0.45f * sin(phase * 0.9f) else 1f
        for (i in paints.indices.reversed()) {
            val amplitude = h * 0.42f * max(0.05f, level) * (1f - i * 0.17f) * pulse
            val frequency = 1.3f + i * 0.42f
            val offset = i * 0.85f
            path.reset()
            var x = 0f
            val step = max(2f, w / 90f)
            while (x <= w) {
                val t = x / w
                val envelope = sin(PI.toFloat() * t).pow(2)
                val y = mid + amplitude * envelope * sin(2f * PI.toFloat() * frequency * t + phase * (1f + i * 0.12f) + offset)
                if (x == 0f) path.moveTo(x, y) else path.lineTo(x, y)
                x += step
            }
            canvas.drawPath(path, paints[i])
        }
        if (!still && isAttachedToWindow) postInvalidateOnAnimation()
    }

    override fun onDetachedFromWindow() { lastFrame = 0L; super.onDetachedFromWindow() }
}

/** Plain helpers for the wave level (JVM-testable). */
object VoiceLevels {
    fun normalize(rmsDb: Float): Float = ((rmsDb + 2f) / 12f).coerceIn(0f, 1f)
}
