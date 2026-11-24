package com.personal.murmur

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.RadialGradient
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Shader
import android.view.View
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.random.Random

/**
 * MURMUR's music stage. Layers, back to front:
 *  1. liquid light: a fluid simulation dyed with the artwork palette; emitters orbit the disc and
 *     speed up with the bass, every beat splashes outward and blooms the exposure;
 *  2. an LED dot ring around the disc: a mirrored spectrum (bass at the crown) with peak-hold dots;
 *  3. the circular artwork disc on a spring: it breathes with the bass and kicks on beats;
 *  4. dot bursts thrown from the rim on strong beats;
 *  5. a dot-matrix "beat horizon": loudness history flowing outward from the centre, beats lit white.
 * Strong beats add a short decaying shake with an RGB split. Everything is drawn with reused
 * buffers (drawPoints batches) and shaders that are rebuilt only when the artwork changes.
 */
internal class AuraStageView(context: Context) : View(context) {
    private val density = resources.displayMetrics.density
    private fun dp(value: Float) = value * density

    var allowMotion = true
        set(value) {
            if (field == value) return
            field = value
            if (!value) freeze()
            invalidate()
        }
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
            quiet = 0f
            invalidate()
        }
    /** The view redrawn in lockstep with the stage (the dot clock). */
    var follower: View? = null
    internal var spectrumSource: (Long) -> VisualSpectrum? = { HybridMediaService.instance?.visualSpectrum(it) }
    internal var clock: () -> Long = { System.nanoTime() }

    // Frame state shared with the dot clock.
    var pulse = 0f; private set
    var bass = 0f; private set
    var shakeX = 0f; private set
    var shakeY = 0f; private set
    var chroma = 0f; private set
    var glint = -1f; private set
    var animating = false; private set
    val glow get() = palette[2]

    // Palette: [primary, secondary, highlight], cross-faded on track change.
    private val brand = intArrayOf(0xFF7C5CFF.toInt(), 0xFF2F6BFF.toInt(), 0xFFE6DAFF.toInt())
    private val fromPalette = brand.copyOf()
    private val toPalette = brand.copyOf()
    private val palette = brand.copyOf()
    private var paletteMix = 1f
    private var backlight = backlightShader(brand[0])
    private var oldBacklight: RadialGradient? = null

    // Artwork disc.
    private var art: Bitmap? = null
    private var artShader: BitmapShader? = null
    private var oldArt: Bitmap? = null
    private var oldShader: BitmapShader? = null
    private var artMix = 1f

    // Geometry.
    private val scene = RectF()
    private val fallbackScene = RectF()
    private var cx = 0f
    private var cy = 0f
    private var discRadius = 0f
    private var ringInner = 0f
    private var ringStep = 0f
    private var ringDot = 0f
    private var stripY = 0f
    private var stripPitch = 0f
    private var stripRow = 0f
    private var stripDot = 0f
    private val unitX = FloatArray(SPOKES)
    private val unitY = FloatArray(SPOKES)

    // Motion state.
    private var lastFrame = 0L
    private var time = 0f
    private var quiet = 0f
    private var seenBeats = -1L
    private var discX = 0f
    private var discV = 0f
    private var ringX = 0f
    private var ringV = 0f
    private var shakeAmp = 0f
    private var shakeAge = 1f
    private var shakeAngle = 0f
    private var glintAge = 1f
    private var level = 0f
    private var mid = 0f
    private var high = 0f
    private val bands = FloatArray(SPOKES / 2)
    private val peaks = FloatArray(SPOKES / 2)
    private val orbit = floatArrayOf(.3f, 2.4f, 4.3f)
    private var pendingBloom = 0f
    private val random = Random(0x4D55)

    // Liquid.
    private var field: LiquidField? = null
    private var fieldBitmap: Bitmap? = null
    private var cell = 1f
    private var fieldDirty = true
    private var ambientDirty = false
    private val stir = floatArrayOf(0f, 3.1f)

    // Particles (struct of arrays, ring-allocated).
    private val px = FloatArray(MAX_PARTICLES)
    private val py = FloatArray(MAX_PARTICLES)
    private val pvx = FloatArray(MAX_PARTICLES)
    private val pvy = FloatArray(MAX_PARTICLES)
    private val life = FloatArray(MAX_PARTICLES)
    private val span = FloatArray(MAX_PARTICLES)
    private val tone = IntArray(MAX_PARTICLES)
    private var nextParticle = 0
    private var alive = 0

    // Beat horizon history (newest at the centre).
    private val history = FloatArray(STRIP_HALF)
    private val accents = BooleanArray(STRIP_HALF)
    private var stripTimer = 0f
    private var stripPeak = 0f
    private var stripBeat = false

    // Reused draw buffers.
    private val ringRows = Array(RING_ROWS) { DotBucket(SPOKES) }
    private val ringPeaks = DotBucket(SPOKES)
    private val ringAll = DotBucket(SPOKES * RING_ROWS)
    private val ringIdle = DotBucket(SPOKES * RING_ROWS)
    private val sparks = Array(6) { DotBucket(MAX_PARTICLES) }
    private val stripLit = Array(8) { DotBucket(STRIP_HALF * 2 * (STRIP_ROWS * 2 + 1)) }
    private val stripIdle = DotBucket(STRIP_HALF * 2 * (STRIP_ROWS * 2 + 1))

    private val dotPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
    }
    private val addPaint = Paint(dotPaint).apply { xfermode = PorterDuffXfermode(PorterDuff.Mode.ADD) }
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG)
    private val discPaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    private val fieldPaint = Paint(Paint.FILTER_BITMAP_FLAG or Paint.DITHER_FLAG)
    private val rim = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
    private val matrix = Matrix()
    private val fieldRect = Rect()
    private val fieldTarget = RectF()
    private val shade = LinearGradient(0f, 0f, 0f, 1f,
        intArrayOf(0xE0000000.toInt(), 0x00000000, 0x00000000, 0xB8000000.toInt(), 0xF7000000.toInt()),
        floatArrayOf(0f, .21f, .5f, .7f, .86f), Shader.TileMode.CLAMP)
    private val sideShade = LinearGradient(0f, 0f, 1f, 0f,
        intArrayOf(0x00000000, 0x00000000, 0xC8000000.toInt()), floatArrayOf(0f, .5f, 1f), Shader.TileMode.CLAMP)
    private val discShade = RadialGradient(0f, 0f, 1f, intArrayOf(0x00000000, 0x00000000, 0x73000000),
        floatArrayOf(0f, .72f, 1f), Shader.TileMode.CLAMP)

    init {
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
        for (s in 0 until SPOKES / 2) {
            // Right half runs clockwise from the crown to the base; the left half mirrors it.
            val angle = -PI / 2 + (s + .5) * PI / (SPOKES / 2)
            unitX[s] = cos(angle).toFloat()
            unitY[s] = sin(angle).toFloat()
            unitX[SPOKES - 1 - s] = -unitX[s]
            unitY[SPOKES - 1 - s] = unitY[s]
        }
    }

    // ---------------------------------------------------------------- layout

    fun place(left: Float, top: Float, right: Float, bottom: Float) {
        if (right <= left || bottom <= top) return
        if (scene.left == left && scene.top == top && scene.right == right && scene.bottom == bottom) return
        scene.set(left, top, right, bottom)
        layoutStage()
        fieldDirty = true
        invalidate()
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        if (w <= 0 || h <= 0) return
        cell = max(w, h) / 128f
        val columns = (w / cell).toInt().coerceAtLeast(8) + 1
        val rows = (h / cell).toInt().coerceAtLeast(8) + 1
        if (field?.columns != columns || field?.rows != rows) {
            field = LiquidField(columns, rows)
            fieldBitmap = Bitmap.createBitmap(columns, rows, Bitmap.Config.ARGB_8888)
        }
        fieldRect.set(0, 0, columns, rows)
        fieldTarget.set(0f, 0f, columns * cell, rows * cell)
        layoutStage()
        fieldDirty = true
    }

    private fun layoutStage() {
        if (width <= 0 || height <= 0) return
        val area = if (scene.isEmpty) fallbackScene.apply { set(0f, height * .18f, width.toFloat(), height * .70f) } else scene
        // Ring + beat horizon form one group, centred in the free area between header and controls.
        val stripHeight = if (area.height() > dp(300f)) dp(40f) else dp(32f)
        val gap = if (area.height() > dp(300f)) dp(30f) else dp(16f)
        discRadius = min(area.width() * .265f, (area.height() - gap - stripHeight) / (2f * RING_REACH))
            .coerceAtLeast(dp(36f))
        ringInner = discRadius * 1.13f
        ringStep = discRadius * .062f
        ringDot = (ringStep * .64f).coerceIn(dp(1.7f), dp(3.4f))
        val group = 2f * RING_REACH * discRadius + gap + stripHeight
        cx = area.centerX()
        cy = area.top + (area.height() - group) / 2f + RING_REACH * discRadius
        stripY = cy + RING_REACH * discRadius + gap + stripHeight / 2f
        stripRow = stripHeight / (STRIP_ROWS * 2 + 1)
        stripPitch = min((area.width() - dp(40f)) / (STRIP_HALF * 2 - 2), stripRow * 1.6f)
        stripDot = (stripRow * .48f).coerceIn(dp(1.5f), dp(2.8f))
    }

    // ---------------------------------------------------------------- artwork & palette

    fun setArtwork(image: Bitmap?) {
        val next = image?.takeUnless { it.isRecycled }?.let { extractPalette(it) } ?: brand
        val square = image?.takeUnless { it.isRecycled }?.let { crop(it) }
        val motion = allowMotion && running
        oldArt = if (motion) art else null
        oldShader = if (motion) artShader else null
        art = square
        artShader = square?.let { BitmapShader(it, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP) }
        artMix = if (motion && (oldArt != null || square != null)) 0f else 1f
        for (i in 0 until 3) fromPalette[i] = palette[i]
        next.copyInto(toPalette)
        paletteMix = if (motion) 0f else 1f
        oldBacklight = if (motion) backlight else null
        backlight = backlightShader(next[0])
        if (!motion) {
            toPalette.copyInto(palette)
            fieldDirty = true
        } else {
            ambientDirty = true
            pendingBloom = .85f
            discV += 1.1f
        }
        invalidate()
    }

    private fun crop(image: Bitmap): Bitmap? = runCatching {
        val side = min(image.width, image.height)
        if (side <= 0) return null
        val scale = min(1f, 512f / side)
        matrix.setScale(scale, scale)
        Bitmap.createBitmap(image, (image.width - side) / 2, (image.height - side) / 2, side, side, matrix, true)
            .let { if (it === image) it.copy(Bitmap.Config.ARGB_8888, false) else it }
    }.getOrNull()

    private fun extractPalette(image: Bitmap): IntArray {
        val sample = runCatching { Bitmap.createScaledBitmap(image, 16, 16, true) }.getOrNull() ?: return brand
        val votes = FloatArray(12)
        val hsv = FloatArray(3)
        for (y in 0 until sample.height) for (x in 0 until sample.width) {
            Color.colorToHSV(sample.getPixel(x, y), hsv)
            if (hsv[2] >= .17f && hsv[1] >= .22f) votes[(hsv[0] / 30).toInt().coerceIn(0, 11)] += hsv[1] * hsv[2]
        }
        if (sample !== image) sample.recycle()
        val dominant = votes.indices.maxByOrNull { votes[it] } ?: return brand
        if (votes[dominant] < .4f) return brand
        val alternate = votes.indices.filter { abs(it - dominant) in 2..10 }.maxByOrNull { votes[it] }
        val hue = dominant * 30f + 15f
        val second = if (alternate != null && votes[alternate] > votes[dominant] * .30f) alternate * 30f + 15f
        else (hue + 38f) % 360f
        return intArrayOf(
            Color.HSVToColor(floatArrayOf(hue, .84f, 1f)),
            Color.HSVToColor(floatArrayOf(second, .76f, .92f)),
            mix(Color.HSVToColor(floatArrayOf(hue, .24f, 1f)), brand[2], .45f))
    }

    private fun backlightShader(color: Int) = RadialGradient(0f, 0f, 1f,
        intArrayOf(color and 0xFFFFFF or 0x8C000000.toInt(), color and 0xFFFFFF or 0x30000000, color and 0xFFFFFF),
        floatArrayOf(0f, .5f, 1f), Shader.TileMode.CLAMP)

    // ---------------------------------------------------------------- frame

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        if (width <= 0 || height <= 0) return
        if (discRadius == 0f) layoutStage()
        val now = clock()
        val dt = if (lastFrame == 0L) 1f / 60f else ((now - lastFrame) / 1e9f).coerceIn(0f, .05f)
        lastFrame = now
        if (allowMotion) advance(now, dt)

        drawField(canvas)
        canvas.save()
        canvas.translate(shakeX, shakeY)
        drawBacklight(canvas)
        drawRing(canvas)
        drawDisc(canvas)
        drawSparks(canvas)
        drawStrip(canvas)
        canvas.restore()

        val wasAnimating = animating
        animating = running && allowMotion && isShown && windowVisibility == VISIBLE && (playing || settling())
        if (animating) postInvalidateOnAnimation()
        if (animating || wasAnimating) follower?.postInvalidateOnAnimation()
    }

    private fun settling() = quiet < 2.2f || pulse > .01f || alive > 0 || paletteMix < 1f || artMix < 1f ||
        abs(discV) > .01f || abs(discX) > .002f || shakeAge < .4f || level > .01f

    private fun advance(now: Long, dt: Float) {
        time += dt
        if (!playing) quiet += dt
        val spectrum = spectrumSource(now)
        if (spectrum != null) {
            val half = SPOKES / 2
            for (s in 0 until half) {
                val b = (s * spectrum.bandCount / half).coerceAtMost(spectrum.bandCount - 1)
                bands[s] = spectrum.bands[b]
                peaks[s] = spectrum.peaks[b]
            }
            level = spectrum.level
            bass = spectrum.bass
            mid = spectrum.mid
            high = spectrum.high
            pulse = spectrum.pulse
            if (seenBeats >= 0 && spectrum.beatCount != seenBeats && playing) onBeat(spectrum.beatStrength)
            seenBeats = spectrum.beatCount
        } else {
            val fade = exp(-dt / .15f)
            for (s in bands.indices) { bands[s] *= fade; peaks[s] *= fade }
            level *= fade; bass *= fade; mid *= fade; high *= fade; pulse *= fade
        }

        // Springs (sub-stepped): the disc breathes with the bass; the ring follows it a beat late.
        var remaining = dt
        while (remaining > 0f) {
            val h = min(remaining, 1f / 240f)
            remaining -= h
            val discGoal = bass * .03f
            discV += (-(DISC_W * DISC_W) * (discX - discGoal) - 2f * .38f * DISC_W * discV) * h
            discX += discV * h
            ringV += (-(RING_W * RING_W) * (ringX - discX * 1.4f) - 2f * .55f * RING_W * ringV) * h
            ringX += ringV * h
        }
        discX = discX.coerceIn(-.06f, .14f)

        shakeAge += dt
        val envelope = exp(-shakeAge / .075f)
        val wobble = shakeAmp * envelope * sin(2f * PI.toFloat() * 17f * shakeAge)
        shakeX = cos(shakeAngle) * wobble
        shakeY = sin(shakeAngle) * wobble
        chroma = shakeAmp * envelope * 1.1f
        glintAge += dt
        glint = if (glintAge < .45f) glintAge / .45f else -1f

        paletteMix = min(1f, paletteMix + dt / .9f)
        artMix = min(1f, artMix + dt / .6f)
        val blend = paletteMix * paletteMix * (3f - 2f * paletteMix)
        for (i in 0 until 3) palette[i] = mix(fromPalette[i], toPalette[i], blend)
        if (artMix >= 1f) { oldArt = null; oldShader = null }
        if (paletteMix >= 1f) oldBacklight = null

        updateSparks(dt)
        updateStrip(dt)
        updateField(dt)
    }

    private fun onBeat(strength: Float) {
        discV += .4f + .8f * strength
        glintAge = 0f
        if (strength > .45f) {
            shakeAmp = dp(3.2f) * strength
            shakeAge = 0f
            shakeAngle = random.nextFloat() * 2f * PI.toFloat()
        }
        burst((6 + 30 * strength * strength).toInt(), strength)
        stripBeat = true
        pendingBloom = max(pendingBloom, strength)
    }

    private fun freeze() {
        pulse = 0f; bass = 0f; level = 0f; mid = 0f; high = 0f
        shakeX = 0f; shakeY = 0f; chroma = 0f; glint = -1f; shakeAge = 1f
        discX = 0f; discV = 0f; ringX = 0f; ringV = 0f
        bands.fill(0f); peaks.fill(0f); history.fill(0f); accents.fill(false)
        alive = 0; life.fill(0f)
        paletteMix = 1f; artMix = 1f; oldArt = null; oldShader = null; oldBacklight = null
        toPalette.copyInto(palette)
        fieldDirty = true
    }

    // ---------------------------------------------------------------- liquid

    private fun updateField(dt: Float) {
        val liquid = field ?: return
        if (fieldDirty) seedField(liquid)
        if (ambientDirty) paintAmbient(liquid, toPalette)
        val gx = cx / cell
        val gy = cy / cell
        val radius = discRadius / cell
        // Three emitters orbit just outside the disc; paused, they idle slowly so the liquid stays alive.
        val drive = if (playing) 1f + bass * 1.6f + pulse * 1.8f else .35f
        val feed = if (playing) .9f + bass * 2.4f + pulse * 1.8f else .35f
        val accel = if (playing) 60f + mid * 90f + pulse * 140f else 14f
        for (e in 0 until 3) {
            orbit[e] += dt * ORBIT_SPEED[e] * drive
            val a = orbit[e]
            val ca = cos(a)
            val sa = sin(a)
            val reach = radius * (1.15f + .35f * sin(time * .37f + e * 2.1f))
            val dir = if (e == 1) -1f else 1f
            val push = accel * dt
            liquid.splat(gx + ca * reach, gy + sa * reach, 1.5f,
                (-sa * dir * 1.5f + ca * .9f) * push, (ca * dir * 1.5f + sa * .9f) * push,
                palette[if (e == 2) 0 else e], dt * feed)
        }
        // Two slow counter-rotating vortices drift around the disc and shear the dye into ribbons.
        for (k in 0..1) {
            stir[k] += dt * (if (k == 0) .19f else -.23f) * drive
            liquid.swirl(gx + cos(stir[k]) * radius * 1.9f, gy + sin(stir[k]) * radius * 1.7f, radius * .85f,
                (if (k == 0) 1f else -1f) * 10f * dt * (1f + bass + pulse * 2f))
        }
        if (pendingBloom > 0f) {
            val strength = pendingBloom
            pendingBloom = 0f
            val spokes = 9
            val offset = random.nextFloat() * 2f * PI.toFloat()
            for (k in 0 until spokes) {
                val a = offset + k * 2f * PI.toFloat() / spokes
                val ca = cos(a)
                val sa = sin(a)
                val speed = 18f + 46f * strength
                liquid.splat(gx + ca * radius * 1.05f, gy + sa * radius * 1.05f, 1.9f, ca * speed, sa * speed,
                    palette[k % 2], .25f + .3f * strength)
            }
        }
        liquid.step(dt)
        renderField(liquid)
    }

    /** The resting colour field: two artwork hues pooled around the disc, fading toward the edges. */
    private fun paintAmbient(liquid: LiquidField, colors: IntArray) {
        ambientDirty = false
        val gx = cx / cell
        val gy = cy / cell
        val r = discRadius / cell
        liquid.clearAmbient()
        liquid.ambient(gx - r * .75f, gy - r * .9f, r * 1.9f, colors[0], .3f)
        liquid.ambient(gx + r * .9f, gy + r * .8f, r * 1.8f, colors[1], .28f)
        liquid.ambient(gx - r * .4f, gy + r * 2.3f, r * 1.3f, colors[1], .1f)
        liquid.ambient(gx + r * .4f, gy - r * 2.3f, r * 1.3f, colors[0], .1f)
        liquid.ambient(gx, gy, r * .9f, colors[2], .05f)
    }

    private fun seedField(liquid: LiquidField) {
        fieldDirty = false
        paintAmbient(liquid, toPalette)
        liquid.reset()
    }

    private fun renderField(liquid: LiquidField) {
        liquid.render(1.45f * (1f + bass * .45f + pulse * .7f), .86f)
        fieldBitmap?.setPixels(liquid.pixels, 0, liquid.columns, 0, 0, liquid.columns, liquid.rows)
    }

    private fun drawField(canvas: Canvas) {
        val liquid = field
        val bitmap = fieldBitmap
        canvas.drawColor(Color.BLACK)
        if (liquid != null && bitmap != null) {
            if (fieldDirty) {
                seedField(liquid)
                renderField(liquid)
            }
            canvas.drawBitmap(bitmap, fieldRect, fieldTarget, fieldPaint)
        }
        matrix.setScale(1f, height.toFloat())
        shade.setLocalMatrix(matrix)
        fill.shader = shade
        fill.alpha = 255
        canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), fill)
        if (!scene.isEmpty && scene.right < width * .8f) {
            matrix.setScale(width.toFloat(), 1f)
            sideShade.setLocalMatrix(matrix)
            fill.shader = sideShade
            canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), fill)
        }
        fill.shader = null
    }

    // ---------------------------------------------------------------- disc & ring

    private fun drawBacklight(canvas: Canvas) {
        val r = discRadius * (1.75f + bass * .25f + pulse * .3f)
        matrix.setScale(r, r)
        matrix.postTranslate(cx, cy)
        val strength = (.55f + bass * .3f + pulse * .35f).coerceAtMost(1f)
        oldBacklight?.let {
            it.setLocalMatrix(matrix)
            fill.shader = it
            fill.alpha = (255 * strength * (1f - paletteMix)).toInt()
            canvas.drawCircle(cx, cy, r, fill)
        }
        backlight.setLocalMatrix(matrix)
        fill.shader = backlight
        fill.alpha = (255 * strength * if (oldBacklight != null) paletteMix else 1f).toInt()
        canvas.drawCircle(cx, cy, r, fill)
        fill.shader = null
        fill.alpha = 255
    }

    private fun drawRing(canvas: Canvas) {
        val sway = if (allowMotion) sin(time * .23f) * .28f else 0f
        val cs = cos(sway)
        val sn = sin(sway)
        val grow = 1f + ringX * .55f
        for (row in ringRows) row.clear()
        ringPeaks.clear()
        ringAll.clear()
        ringIdle.clear()
        val half = SPOKES / 2
        for (s in 0 until SPOKES) {
            val band = if (s < half) s else SPOKES - 1 - s
            val ux = unitX[s] * cs - unitY[s] * sn
            val uy = unitX[s] * sn + unitY[s] * cs
            val value = bands[band]
            val litRows = (value * RING_ROWS + .25f).toInt().coerceIn(0, RING_ROWS)
            for (m in 0 until RING_ROWS) {
                val r = (ringInner + m * ringStep * (1f + ringX * 1.2f)) * grow
                val x = cx + ux * r
                val y = cy + uy * r
                if (m < litRows) {
                    ringRows[m].add(x, y)
                    ringAll.add(x, y)
                } else ringIdle.add(x, y)
            }
            val peakRow = (peaks[band] * RING_ROWS + .25f).toInt() - 1
            if (peakRow >= litRows && peakRow in 0 until RING_ROWS) {
                val r = (ringInner + (peakRow + .35f) * ringStep * (1f + ringX * 1.2f)) * grow
                ringPeaks.add(cx + ux * r, cy + uy * r)
            }
        }
        dotPaint.color = 0xFFE6DAFF.toInt()
        dotPaint.alpha = 26
        dotPaint.strokeWidth = ringDot * .62f
        canvas.drawPoints(ringIdle.points, 0, ringIdle.size, dotPaint)

        if (chroma > .35f && ringAll.size > 0) {
            val dx = cos(shakeAngle) * chroma
            val dy = sin(shakeAngle) * chroma
            addPaint.strokeWidth = ringDot
            addPaint.color = 0xFFFF2E7A.toInt()
            addPaint.alpha = (170 * min(1f, chroma / dp(2.5f))).toInt()
            canvas.translate(dx, dy)
            canvas.drawPoints(ringAll.points, 0, ringAll.size, addPaint)
            addPaint.color = 0xFF2EE6FF.toInt()
            addPaint.alpha = (170 * min(1f, chroma / dp(2.5f))).toInt()
            canvas.translate(-2f * dx, -2f * dy)
            canvas.drawPoints(ringAll.points, 0, ringAll.size, addPaint)
            canvas.translate(dx, dy)
        }
        if (ringAll.size > 0 && (pulse > .02f || bass > .1f)) {
            addPaint.color = palette[0]
            addPaint.alpha = (42 * min(1f, pulse + bass * .4f)).toInt()
            addPaint.strokeWidth = ringDot * 2.6f
            canvas.drawPoints(ringAll.points, 0, ringAll.size, addPaint)
        }
        for (m in 0 until RING_ROWS) {
            val bucket = ringRows[m]
            if (bucket.size == 0) continue
            val t = m / (RING_ROWS - 1f)
            dotPaint.color = mix(lighten(palette[0], .25f), palette[2], t)
            dotPaint.alpha = 255
            dotPaint.strokeWidth = ringDot * (1f - .3f * t)
            canvas.drawPoints(bucket.points, 0, bucket.size, dotPaint)
        }
        if (ringPeaks.size > 0) {
            dotPaint.color = Color.WHITE
            dotPaint.alpha = 240
            dotPaint.strokeWidth = ringDot * .92f
            canvas.drawPoints(ringPeaks.points, 0, ringPeaks.size, dotPaint)
        }
    }

    private fun drawDisc(canvas: Canvas) {
        val r = discRadius * (1f + discX)
        fill.color = Color.BLACK
        fill.alpha = 150
        canvas.drawCircle(cx, cy, r * 1.045f, fill)
        fill.alpha = 255
        val current = artShader
        val bitmap = art
        if (artMix < 1f) {
            val previous = oldShader
            val old = oldArt
            if (previous != null && old != null) drawArt(canvas, previous, old, r, 255)
            else drawEmptyDisc(canvas, r, 255)
        }
        val alpha = (255 * artMix).toInt()
        if (current != null && bitmap != null) drawArt(canvas, current, bitmap, r, alpha)
        else drawEmptyDisc(canvas, r, alpha)
        matrix.setScale(r, r)
        matrix.postTranslate(cx, cy)
        discShade.setLocalMatrix(matrix)
        fill.shader = discShade
        canvas.drawCircle(cx, cy, r, fill)
        fill.shader = null
        rim.color = palette[2]
        rim.alpha = (95 + 120 * pulse).toInt().coerceAtMost(255)
        rim.strokeWidth = dp(1.1f)
        canvas.drawCircle(cx, cy, r + dp(.6f), rim)
    }

    private fun drawArt(canvas: Canvas, shader: BitmapShader, bitmap: Bitmap, r: Float, alpha: Int) {
        matrix.setScale(2f * r / bitmap.width, 2f * r / bitmap.height)
        matrix.postTranslate(cx - r, cy - r)
        shader.setLocalMatrix(matrix)
        discPaint.shader = shader
        discPaint.alpha = alpha
        canvas.drawCircle(cx, cy, r, discPaint)
        discPaint.shader = null
    }

    private fun drawEmptyDisc(canvas: Canvas, r: Float, alpha: Int) {
        fill.color = 0xFF0C0A14.toInt()
        fill.alpha = alpha
        canvas.drawCircle(cx, cy, r, fill)
        rim.color = palette[2]
        rim.strokeWidth = dp(.8f)
        for (k in 1..5) {
            rim.alpha = (alpha * (.10f + .04f * k)).toInt()
            canvas.drawCircle(cx, cy, r * (.32f + k * .12f), rim)
        }
        fill.color = palette[2]
        fill.alpha = alpha
        canvas.drawCircle(cx, cy, r * .07f, fill)
        fill.alpha = 255
    }

    // ---------------------------------------------------------------- particles

    private fun burst(count: Int, strength: Float) {
        val r = discRadius * (1f + discX)
        repeat(count) {
            val i = nextParticle
            nextParticle = (nextParticle + 1) % MAX_PARTICLES
            if (life[i] <= 0f) alive++
            val a = random.nextFloat() * 2f * PI.toFloat()
            val speed = discRadius * (.8f + random.nextFloat() * 1.9f) * (.6f + strength)
            px[i] = cx + cos(a) * r * 1.04f
            py[i] = cy + sin(a) * r * 1.04f
            pvx[i] = cos(a) * speed
            pvy[i] = sin(a) * speed
            span[i] = .45f + random.nextFloat() * .7f
            life[i] = span[i]
            tone[i] = if (random.nextFloat() < .55f) 0 else 1
        }
    }

    private fun updateSparks(dt: Float) {
        if (alive == 0) return
        val drag = exp(-dt * 2.4f)
        var count = 0
        for (i in 0 until MAX_PARTICLES) {
            if (life[i] <= 0f) continue
            life[i] -= dt
            if (life[i] <= 0f) continue
            pvx[i] *= drag
            pvy[i] *= drag
            px[i] += pvx[i] * dt
            py[i] += pvy[i] * dt
            count++
        }
        alive = count
    }

    private fun drawSparks(canvas: Canvas) {
        if (alive == 0) return
        for (bucket in sparks) bucket.clear()
        for (i in 0 until MAX_PARTICLES) {
            if (life[i] <= 0f) continue
            val age = (life[i] / span[i]).coerceIn(0f, 1f)
            val stage = if (age > .66f) 0 else if (age > .33f) 1 else 2
            sparks[tone[i] * 3 + stage].add(px[i], py[i])
        }
        for (k in sparks.indices) {
            val bucket = sparks[k]
            if (bucket.size == 0) continue
            val stage = k % 3
            addPaint.color = if (k < 3) palette[2] else lighten(palette[0], .3f)
            addPaint.alpha = when (stage) { 0 -> 235; 1 -> 150; else -> 70 }
            addPaint.strokeWidth = ringDot * when (stage) { 0 -> 1.05f; 1 -> .85f; else -> .65f }
            canvas.drawPoints(bucket.points, 0, bucket.size, addPaint)
        }
    }

    // ---------------------------------------------------------------- beat horizon

    private fun updateStrip(dt: Float) {
        stripPeak = max(stripPeak, (level * .75f + bass * .55f).coerceAtMost(1f))
        stripTimer += dt
        if (stripTimer < 1f / 18f) return
        stripTimer %= 1f / 18f
        System.arraycopy(history, 0, history, 1, STRIP_HALF - 1)
        System.arraycopy(accents, 0, accents, 1, STRIP_HALF - 1)
        history[0] = stripPeak
        accents[0] = stripBeat
        stripPeak = 0f
        stripBeat = false
    }

    private fun drawStrip(canvas: Canvas) {
        for (bucket in stripLit) bucket.clear()
        stripIdle.clear()
        for (k in 0 until STRIP_HALF) {
            val value = history[k]
            val lit = (value * STRIP_ROWS + .3f).toInt().coerceIn(0, STRIP_ROWS)
            val fade = (k * 4 / STRIP_HALF).coerceIn(0, 3)
            val bucket = stripLit[fade + if (accents[k]) 4 else 0]
            for (side in 0..1) {
                if (k == 0 && side == 1) continue
                val x = cx + (if (side == 0) k else -k) * stripPitch
                for (row in -STRIP_ROWS..STRIP_ROWS) {
                    val y = stripY + row * stripRow
                    if (abs(row) <= lit && (lit > 0 || row == 0) && value > .015f) bucket.add(x, y)
                    else stripIdle.add(x, y)
                }
            }
        }
        dotPaint.color = 0xFFE6DAFF.toInt()
        dotPaint.alpha = 22
        dotPaint.strokeWidth = stripDot * .75f
        canvas.drawPoints(stripIdle.points, 0, stripIdle.size, dotPaint)
        for (k in stripLit.indices) {
            val bucket = stripLit[k]
            if (bucket.size == 0) continue
            val accent = k >= 4
            val fade = k % 4
            dotPaint.color = if (accent) Color.WHITE else mix(palette[1], palette[2], .35f)
            dotPaint.alpha = (255 * (1f - fade * .24f) * if (accent) 1f else .85f).toInt()
            dotPaint.strokeWidth = stripDot * (if (accent) 1.08f else 1f) * (1f - fade * .08f)
            canvas.drawPoints(bucket.points, 0, bucket.size, dotPaint)
        }
    }

    // ---------------------------------------------------------------- helpers

    private fun mix(a: Int, b: Int, t: Float): Int {
        if (t <= 0f) return a
        if (t >= 1f) return b
        val ar = (a shr 16) and 0xFF; val ag = (a shr 8) and 0xFF; val ab = a and 0xFF
        val br = (b shr 16) and 0xFF; val bg = (b shr 8) and 0xFF; val bb = b and 0xFF
        return (0xFF shl 24) or ((ar + (br - ar) * t).roundToInt() shl 16) or
            ((ag + (bg - ag) * t).roundToInt() shl 8) or (ab + (bb - ab) * t).roundToInt()
    }

    private fun lighten(color: Int, amount: Float) = mix(color, Color.WHITE, amount)

    private companion object {
        const val SPOKES = 72
        const val RING_ROWS = 8
        const val STRIP_HALF = 26
        const val STRIP_ROWS = 3
        const val MAX_PARTICLES = 160
        const val RING_REACH = 1.6f
        const val DISC_W = 15.08f // 2π · 2.4 Hz
        const val RING_W = 10.68f // 2π · 1.7 Hz
        val ORBIT_SPEED = floatArrayOf(.34f, -.27f, .41f)
    }
}
