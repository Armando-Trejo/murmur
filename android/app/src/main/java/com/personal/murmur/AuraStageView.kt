package com.personal.murmur

import android.content.Context
import android.graphics.*
import android.os.SystemClock
import android.view.View
import kotlin.math.*

/** Three soft light fields stretch and bloom with PCM transients. */
internal class AuraStageView(context: Context) : View(context) {
    private val base = 0xFF05060B.toInt()
    private val fallback = intArrayOf(0xFF246AFF.toInt(), 0xFF6546DE.toInt(), 0xFFB7DDFF.toInt())
    private val defaultLight = gradients(fallback)
    private var light = defaultLight
    private var outgoing: Array<RadialGradient>? = null
    private var changedAt = 0L
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val matrix = Matrix()
    private val scene = RectF()
    private val vignette = LinearGradient(0f, 0f, 0f, 1f,
        intArrayOf(0xBA05060B.toInt(), 0x0505060B, 0x0505060B, 0xF205060B.toInt()),
        floatArrayOf(0f, .24f, .57f, 1f), Shader.TileMode.CLAMP)
    private var lastFrame = 0L
    private var phase = .7f
    private var envelope = 0f
    private var floor = 0f
    private var pulse = 0f

    var allowMotion = true
    var running = false
        set(value) {
            field = value
            lastFrame = 0L
            if (value) invalidate()
        }
    var playing = false
        set(value) {
            if (field == value) return
            field = value
            lastFrame = 0L
            invalidate()
        }

    fun place(left: Float, top: Float, right: Float, bottom: Float) {
        if (right <= left || bottom <= top) return
        if (scene.left == left && scene.top == top && scene.right == right && scene.bottom == bottom) return
        scene.set(left, top, right, bottom)
        invalidate()
    }

    fun setArtwork(image: Bitmap?) {
        val next = image?.let { gradients(palette(it)) } ?: defaultLight
        if (light === next) return
        outgoing = if (allowMotion) light else null
        light = next
        changedAt = SystemClock.uptimeMillis()
        pulse = 0f
        floor = 0f
        envelope = 0f
        invalidate()
    }

    private fun palette(image: Bitmap): IntArray {
        val sample = Bitmap.createScaledBitmap(image, 16, 16, true)
        val votes = FloatArray(12)
        val hsv = FloatArray(3)
        for (y in 0 until sample.height) for (x in 0 until sample.width) {
            Color.colorToHSV(sample.getPixel(x, y), hsv)
            if (hsv[2] >= .17f && hsv[1] >= .22f) {
                votes[(hsv[0] / 30).toInt().coerceIn(0, 11)] += hsv[1] * hsv[2]
            }
        }
        if (sample !== image) sample.recycle()
        val dominant = votes.indices.maxByOrNull { votes[it] } ?: return fallback
        if (votes[dominant] < .4f) return fallback
        val alternate = votes.indices.filter { abs(it - dominant) in 2..10 }.maxByOrNull { votes[it] }
        val hue = dominant * 30f + 15f
        val secondary = if (alternate != null && votes[alternate] > votes[dominant] * .30f)
            alternate * 30f + 15f else (hue + 38f) % 360f
        return intArrayOf(
            Color.HSVToColor(floatArrayOf(hue, .86f, 1f)),
            Color.HSVToColor(floatArrayOf(secondary, .73f, .89f)),
            Color.HSVToColor(floatArrayOf(hue, .33f, 1f))
        )
    }

    private fun gradients(colors: IntArray) = Array(colors.size) { index ->
        val chroma = colors[index] and 0xFFFFFF
        RadialGradient(0f, 0f, 1f,
            intArrayOf(chroma or 0xFF000000.toInt(), chroma or 0xB0000000.toInt(),
                chroma or 0x42000000, chroma or 0x0C000000, chroma),
            floatArrayOf(0f, .26f, .53f, .76f, 1f), Shader.TileMode.CLAMP)
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        if (width <= 0 || height <= 0) return
        val now = SystemClock.uptimeMillis()
        val dt = if (lastFrame == 0L) .016f else ((now - lastFrame) / 1000f).coerceIn(0f, .05f)
        lastFrame = now
        if (allowMotion) {
            val input = if (playing) HybridMediaService.instance?.visualAmplitude ?: 0f else 0f
            envelope += (input - envelope) * (1f - exp(-dt * if (input > envelope) 29f else 9f))
            floor += (envelope - floor) * (1f - exp(-dt * 3.2f))
            val onset = ((envelope - floor - .012f) * 8f).coerceIn(0f, 1f)
            pulse = max(pulse * exp(-dt * 5.2f), onset)
            if (playing) phase = (phase + dt * (.74f + envelope * .85f)) % (100f * PI.toFloat())
        } else {
            pulse = 0f
            envelope = 0f
            outgoing = null
        }
        val time = if (outgoing == null) 1f else ((now - changedAt) / 630f).coerceIn(0f, 1f)
        val blend = time * time * (3f - 2f * time)
        canvas.drawColor(base)
        if (time >= 1f) outgoing = null
        // Keep the old field at full volume underneath the new palette during the dissolve.
        outgoing?.let { drawField(canvas, it, 1f) }
        drawField(canvas, light, blend)
        matrix.setScale(1f, height.toFloat())
        vignette.setLocalMatrix(matrix)
        paint.shader = vignette
        paint.alpha = 255
        canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), paint)
        paint.shader = null
        if (running && allowMotion && isShown && windowVisibility == VISIBLE &&
            (playing || pulse > .006f || outgoing != null)) postInvalidateOnAnimation()
    }

    private fun drawField(canvas: Canvas, colors: Array<RadialGradient>, blend: Float) {
        val w = if (scene.isEmpty) width.toFloat() else scene.width()
        val h = if (scene.isEmpty) height * .66f else scene.height()
        val cx = if (scene.isEmpty) width / 2f else scene.centerX()
        val cy = if (scene.isEmpty) height * .45f else scene.centerY()
        val sweep = phase * .57f
        val energy = envelope.coerceIn(0f, .5f)
        drawLight(canvas, colors[1], cx + w * (.19f * cos(sweep * .9f)), cy - h * .15f,
            w * (.88f + pulse * .20f), h * .41f, -35f + 15f * sin(sweep),
            (.56f + pulse * .22f) * blend)
        drawLight(canvas, colors[0], cx - w * .10f + w * .16f * sin(sweep), cy + h * .10f + h * .13f * cos(sweep),
            w * (.91f + pulse * .19f), h * (.46f + energy * .20f), -39f + 21f * cos(sweep * .8f),
            (.78f + pulse * .17f) * blend)
        drawLight(canvas, colors[2], cx - w * .08f + w * .25f * sin(sweep * .87f + .5f),
            cy + h * (.05f + .10f * sin(sweep)),
            w * (.63f + pulse * .23f), h * (.18f + pulse * .12f), -34f + 21f * cos(sweep * .8f),
            (.46f + pulse * .43f) * blend)
    }

    private fun drawLight(canvas: Canvas, shader: RadialGradient, x: Float, y: Float, sx: Float, sy: Float,
                          angle: Float, strength: Float) {
        matrix.setScale(sx, sy)
        matrix.postRotate(angle)
        matrix.postTranslate(x, y)
        shader.setLocalMatrix(matrix)
        paint.shader = shader
        paint.alpha = (255f * strength).toInt().coerceIn(0, 255)
        canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), paint)
    }
}
