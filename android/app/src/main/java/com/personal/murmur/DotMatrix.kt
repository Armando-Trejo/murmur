package com.personal.murmur

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.Rect
import android.graphics.Typeface
import android.view.View
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/** Reusable float buffer of x,y pairs for one Canvas.drawPoints call. */
internal class DotBucket(capacity: Int) {
    val points = FloatArray(capacity * 2)
    var size = 0
        private set

    fun clear() { size = 0 }
    fun add(x: Float, y: Float) {
        if (size + 1 >= points.size) return
        points[size] = x
        points[size + 1] = y
        size += 2
    }
}

/**
 * Text as an LED grid. Clock characters (0-9 and ':') use a hand-drawn 5x9 dot face so every
 * stroke is exactly one dot wide; anything else (other numbering systems, letters) is rasterised
 * 4x supersampled into a small offscreen bitmap once per change and each cell's ink becomes a dot.
 */
internal class DotMatrixText(val rows: Int, private val maxColumns: Int, typeface: Typeface) {
    private val sample = 4
    private val raster = Bitmap.createBitmap(maxColumns * sample, rows * sample, Bitmap.Config.ARGB_8888)
    private val canvas = Canvas(raster)
    private val pixels = IntArray(raster.width * raster.height)
    private val bounds = Rect()
    private val ink = Paint(Paint.ANTI_ALIAS_FLAG or Paint.SUBPIXEL_TEXT_FLAG).apply {
        this.typeface = typeface
        color = Color.WHITE
    }
    /** Coverage 0..1 per cell, row-major with [columns] used columns. */
    val coverage = FloatArray(maxColumns * rows)
    var columns = 0
        private set
    var text = ""
        private set

    fun set(value: String): Boolean {
        if (value == text) return false
        text = value
        coverage.fill(0f)
        if (rows == FACE_ROWS && value.isNotEmpty() && value.all { it in FACE }) compose(value) else rasterize(value)
        return true
    }

    private fun compose(value: String) {
        var column = 0
        for ((index, character) in value.withIndex()) {
            val glyph = FACE.getValue(character)
            val wide = glyph[0].length
            if (index > 0) column++
            if (column + wide > maxColumns) break
            for (row in 0 until rows) for (x in 0 until wide) {
                if (glyph[row][x] == '#') coverage[row * maxColumns + column + x] = 1f
            }
            column += wide
        }
        columns = column
    }

    private fun rasterize(value: String) {
        ink.textSize = 100f
        ink.getTextBounds("0123456789", 0, 10, bounds)
        val digitHeight = max(1, bounds.height()).toFloat()
        ink.textSize = 100f * rows * sample * .80f / digitHeight
        val width = ink.measureText(value)
        columns = min(maxColumns, ceil(width / sample).toInt() + 1)
        raster.eraseColor(Color.TRANSPARENT)
        val baseline = (rows * sample + digitHeight * ink.textSize / 100f) / 2f
        canvas.drawText(value, sample * .5f, baseline, ink)
        raster.getPixels(pixels, 0, raster.width, 0, 0, raster.width, raster.height)
        val norm = 1f / (sample * sample * 255f)
        for (row in 0 until rows) for (column in 0 until maxColumns) {
            var sum = 0
            if (column < columns) {
                for (y in row * sample until (row + 1) * sample) {
                    val line = y * raster.width
                    for (x in column * sample until (column + 1) * sample) sum += pixels[line + x] ushr 24
                }
            }
            coverage[row * maxColumns + column] = sum * norm
        }
    }

    fun at(row: Int, column: Int) = coverage[row * maxColumns + column]

    companion object {
        const val FACE_ROWS = 9
        private val FACE = mapOf(
            '0' to arrayOf(".###.", "#...#", "#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."),
            '1' to arrayOf("..#..", ".##..", "#.#..", "..#..", "..#..", "..#..", "..#..", "..#..", ".###."),
            '2' to arrayOf(".###.", "#...#", "....#", "....#", "...#.", "..#..", ".#...", "#....", "#####"),
            '3' to arrayOf(".###.", "#...#", "....#", "....#", "..##.", "....#", "....#", "#...#", ".###."),
            '4' to arrayOf("...#.", "..##.", ".#.#.", "#..#.", "#..#.", "#####", "...#.", "...#.", "...#."),
            '5' to arrayOf("#####", "#....", "#....", "####.", "....#", "....#", "....#", "#...#", ".###."),
            '6' to arrayOf("..##.", ".#...", "#....", "#....", "####.", "#...#", "#...#", "#...#", ".###."),
            '7' to arrayOf("#####", "....#", "....#", "...#.", "...#.", "..#..", "..#..", ".#...", ".#..."),
            '8' to arrayOf(".###.", "#...#", "#...#", "#...#", ".###.", "#...#", "#...#", "#...#", ".###."),
            '9' to arrayOf(".###.", "#...#", "#...#", "#...#", ".####", "....#", "....#", "...#.", ".##.."),
            ':' to arrayOf(".", ".", "#", ".", ".", ".", "#", ".", "."),
        )
    }
}

/**
 * The big clock rendered as glowing LED dots that swell with the bass, catch a light sweep on
 * every beat and wipe in when the minute changes. Reads its motion from [stage].
 */
@android.annotation.SuppressLint("ViewConstructor") // Built in code only; never inflated from XML.
internal class DotClockView(
    context: Context,
    private val stage: AuraStageView,
    private val rowsHigh: Int,
    private val pitchDp: Float,
) : View(context) {
    private val matrix = DotMatrixText(rowsHigh, 64, Typeface.create("sans-serif-condensed", Typeface.BOLD))
    private val levels = 4
    private val lit = Array(levels) { DotBucket(64 * rowsHigh) }
    private val all = DotBucket(64 * rowsHigh)
    private val sweep = DotBucket(64 * rowsHigh)
    private val backdrop = DotBucket(66 * rowsHigh)
    private val dot = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
    }
    private val additive = Paint(dot).apply { xfermode = PorterDuffXfermode(PorterDuff.Mode.ADD) }
    private val label = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        typeface = Typeface.create("sans-serif-condensed", Typeface.BOLD)
        color = 0xFFB9B3C5.toInt()
        letterSpacing = .14f
    }
    private var marker = ""
    private var laidOut = false
    private var pitch = 0f
    private var originX = 0f
    private var originY = 0f
    private var wipeStart = 0L
    private var hasText = false

    init {
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_YES
    }

    /** [digits] is drawn in dots, [suffix] (a.m./p.m.) in small type, [spoken] is read by TalkBack. */
    fun setTime(digits: String, suffix: String, spoken: String) {
        if (contentDescription?.toString() != spoken) contentDescription = spoken
        val changed = matrix.set(digits)
        if (suffix != marker) {
            marker = suffix
            laidOut = false
        }
        if (changed) {
            if (hasText && stage.allowMotion) wipeStart = System.nanoTime()
            hasText = true
            laidOut = false
            invalidate()
        } else if (!laidOut) invalidate()
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val width = MeasureSpec.getSize(widthMeasureSpec)
        val height = (rowsHigh * pitchDp * resources.displayMetrics.density).toInt() + paddingTop + paddingBottom
        setMeasuredDimension(width, resolveSize(height, heightMeasureSpec))
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) { laidOut = false }

    private fun layoutDots() {
        laidOut = true
        val columns = matrix.columns
        pitch = (height - paddingTop - paddingBottom).toFloat() / rowsHigh
        label.textSize = pitch * 1.75f
        val markerWidth = if (marker.isEmpty()) 0f else label.measureText(marker) + pitch * 1.4f
        originX = (width - (columns - 1) * pitch - markerWidth) / 2f
        originY = paddingTop + pitch / 2f
        for (bucket in lit) bucket.clear()
        all.clear()
        backdrop.clear()
        for (row in 0 until rowsHigh) for (column in -1..columns) {
            val x = originX + column * pitch
            val y = originY + row * pitch
            val c = if (column in 0 until columns) matrix.at(row, column) else 0f
            if (c < .22f) backdrop.add(x, y)
            else {
                lit[((c - .22f) / .78f * levels).toInt().coerceIn(0, levels - 1)].add(x, y)
                all.add(x, y)
            }
        }
    }

    override fun onDraw(canvas: Canvas) {
        if (!hasText || width == 0) return
        if (!laidOut) layoutDots()
        val now = System.nanoTime()
        val wipe = if (wipeStart == 0L) 1f else ((now - wipeStart) / 520e6f).coerceIn(0f, 1f)
        if (wipe >= 1f) wipeStart = 0L
        val pulse = stage.pulse
        val swell = 1f + pulse * .16f + stage.bass * .06f
        canvas.save()
        canvas.translate(stage.shakeX * .6f, stage.shakeY * .6f)

        dot.color = 0xFFE6DAFF.toInt()
        dot.alpha = 24
        dot.strokeWidth = pitch * .3f
        canvas.drawPoints(backdrop.points, 0, backdrop.size, dot)

        val chroma = stage.chroma * .5f
        if (chroma > .35f && all.size > 0) {
            additive.strokeWidth = pitch * .6f * swell
            additive.color = 0xFFFF2E7A.toInt()
            additive.alpha = (150 * min(1f, chroma / 3f)).toInt()
            canvas.translate(chroma, 0f)
            canvas.drawPoints(all.points, 0, all.size, additive)
            canvas.translate(-2f * chroma, 0f)
            additive.color = 0xFF2EE6FF.toInt()
            additive.alpha = (150 * min(1f, chroma / 3f)).toInt()
            canvas.drawPoints(all.points, 0, all.size, additive)
            canvas.translate(chroma, 0f)
        }
        if (pulse > .02f && all.size > 0) {
            additive.color = stage.glow
            additive.alpha = (64 * pulse).toInt()
            additive.strokeWidth = pitch * 1.2f * swell
            canvas.drawPoints(all.points, 0, all.size, additive)
        }
        // Wipe: columns left of the scan line are on; the scan line itself flares white.
        val reveal = if (wipe < 1f) originX - pitch + wipe * (matrix.columns + 2) * pitch else Float.MAX_VALUE
        if (reveal < Float.MAX_VALUE) {
            canvas.save()
            canvas.clipRect(0f, 0f, reveal, height.toFloat())
        }
        for (level in 0 until levels) {
            val bucket = lit[level]
            if (bucket.size == 0) continue
            val ink = .52f + .48f * (level + 1f) / levels
            dot.color = 0xFFF6F1FF.toInt()
            dot.alpha = (255 * ink).toInt()
            dot.strokeWidth = pitch * (.36f + .24f * sqrt((level + 1f) / levels)) * swell
            canvas.drawPoints(bucket.points, 0, bucket.size, dot)
        }
        if (reveal < Float.MAX_VALUE) canvas.restore()

        // Light sweep on each beat (or the scan line of a minute change).
        val sweepX = when {
            wipe < 1f -> reveal
            stage.glint in 0f..1f -> originX - pitch * 3 + stage.glint * (matrix.columns + 6) * pitch
            else -> Float.NaN
        }
        if (!sweepX.isNaN()) {
            sweep.clear()
            var i = 0
            while (i < all.size) {
                val x = all.points[i]
                if (kotlin.math.abs(x - sweepX) < pitch * 1.6f) sweep.add(x, all.points[i + 1])
                i += 2
            }
            if (sweep.size > 0) {
                additive.color = Color.WHITE
                additive.alpha = if (wipe < 1f) 230 else (200 * (1f - stage.glint)).toInt()
                additive.strokeWidth = pitch * .66f * swell
                canvas.drawPoints(sweep.points, 0, sweep.size, additive)
            }
        }
        if (marker.isNotEmpty()) {
            val x = originX + (matrix.columns - 1) * pitch + pitch * 1.4f
            canvas.drawText(marker, x, originY + (rowsHigh - 1) * pitch + pitch * .3f, label)
        }
        canvas.restore()
        if (wipe < 1f) postInvalidateOnAnimation()
    }
}
