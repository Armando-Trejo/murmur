package com.personal.murmur

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.RadialGradient
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
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
 * MURMUR's music stage, modern-brutalist. Layers, back to front:
 *  1. a fluid background that rotates between looks (liquid light, colour mesh, silk, aurora), dyed
 *     with the artwork palette and crossfaded on every change;
 *  2. one rhythm indicator, also rotating: gradient pulse lines from the disc, animated topographic
 *     contours, or glowing scan lines that follow the spectrum;
 *  3. the circular artwork disc on a spring: it breathes with the bass and kicks on beats;
 *  4. hairline rules and monospaced labels (the brutalist frame).
 * Looks change with each new song and every 90 s of playback. Everything reuses its buffers; shaders
 * are rebuilt only when the artwork palette changes.
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

    // Looks: background and rhythm indicator, each rotating on its own.
    private var background = lastBackground
    private var previousBackground = -1
    private var backgroundMix = 1f
    private var indicator = lastIndicator
    private var previousIndicator = -1
    private var indicatorMix = 1f
    private var lookTimer = 0f

    // Palette: [primary, secondary, highlight], cross-faded on track change.
    private val brand = intArrayOf(0xFF7C5CFF.toInt(), 0xFF2F6BFF.toInt(), 0xFFE6DAFF.toInt())
    private val fromPalette = brand.copyOf()
    private val toPalette = brand.copyOf()
    private val palette = brand.copyOf()
    private var paletteMix = 1f
    private var shadersFor = 0

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
    private val unitX = FloatArray(SPOKES)
    private val unitY = FloatArray(SPOKES)

    // Motion state.
    private var lastFrame = 0L
    private var time = 0f
    private var quiet = 0f
    private var seenBeats = -1L
    private var discX = 0f
    private var discV = 0f
    private var shakeAmp = 0f
    private var shakeAge = 1f
    private var shakeAngle = 0f
    private var glintAge = 1f
    private var beatFlash = 0f
    private var level = 0f
    private var mid = 0f
    private var high = 0f
    private var flow = 0f
    private val bands = FloatArray(SPOKES / 2)
    private val orbit = floatArrayOf(.3f, 2.4f, 4.3f)
    private var pendingBloom = 0f
    private val random = Random(0x4D55)
    /** Topographic contours born on beats: their age in seconds (negative = free slot). */
    private val ripples = FloatArray(6) { -1f }

    // Liquid (one of the backgrounds).
    private var field: LiquidField? = null
    private var fieldBitmap: Bitmap? = null
    private var cell = 1f
    private var fieldDirty = true
    private var ambientDirty = false
    private val stir = floatArrayOf(0f, 3.1f)

    // Reused drawing objects.
    private val path = Path()
    private val lines = FloatArray(SPOKES * 4)
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG)
    private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeJoin = Paint.Join.ROUND }
    private val addStroke = Paint(stroke).apply { xfermode = PorterDuffXfermode(PorterDuff.Mode.ADD) }
    private val addFill = Paint(Paint.ANTI_ALIAS_FLAG).apply { xfermode = PorterDuffXfermode(PorterDuff.Mode.ADD) }
    private val discPaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    private val fieldPaint = Paint(Paint.FILTER_BITMAP_FLAG or Paint.DITHER_FLAG)
    private val rim = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
    private val mono = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        typeface = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD)
        letterSpacing = .18f
    }
    private val matrix = Matrix()
    private val fieldRect = Rect()
    private val fieldTarget = RectF()
    private val shade = LinearGradient(0f, 0f, 0f, 1f,
        intArrayOf(0xE6000000.toInt(), 0x00000000, 0x00000000, 0xB8000000.toInt(), 0xF7000000.toInt()),
        floatArrayOf(0f, .2f, .5f, .7f, .86f), Shader.TileMode.CLAMP)
    private val sideShade = LinearGradient(0f, 0f, 1f, 0f,
        intArrayOf(0x00000000, 0x00000000, 0xC8000000.toInt()), floatArrayOf(0f, .5f, 1f), Shader.TileMode.CLAMP)
    private val discShade = RadialGradient(0f, 0f, 1f, intArrayOf(0x00000000, 0x00000000, 0x73000000),
        floatArrayOf(0f, .72f, 1f), Shader.TileMode.CLAMP)
    // Palette shaders (rebuilt when the palette moves).
    private val blobs = arrayOfNulls<RadialGradient>(4)
    private var silk: LinearGradient? = null
    private var curtain = arrayOfNulls<LinearGradient>(3)
    private var spokeShade: RadialGradient? = null

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

    /** For previews and tests: a fixed look (background 0..3, indicator 0..2). */
    internal fun showLook(background: Int, indicator: Int) {
        this.background = background.mod(BACKGROUNDS.size)
        this.indicator = indicator.mod(INDICATORS.size)
        previousBackground = -1
        previousIndicator = -1
        backgroundMix = 1f
        indicatorMix = 1f
        invalidate()
    }

    /** The next look: a new background and a new rhythm indicator, crossfaded. */
    private fun nextLook() {
        previousBackground = background
        previousIndicator = indicator
        background = (background + 1) % BACKGROUNDS.size
        // Not in lockstep, so the pairs keep changing too.
        indicator = (indicator + if (background == 0) 2 else 1) % INDICATORS.size
        lastBackground = background
        lastIndicator = indicator
        backgroundMix = 0f
        indicatorMix = 0f
        lookTimer = 0f
        if (background == 0) fieldDirty = true
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
        shadersFor = 0
    }

    private fun stage() = if (scene.isEmpty) fallbackScene.apply { set(0f, height * .18f, width.toFloat(), height * .70f) } else scene

    private fun layoutStage() {
        if (width <= 0 || height <= 0) return
        val area = stage()
        // The disc and its indicator fill the space between the frame's labels (no beat strip). The
        // indicator, its ruler ticks included, reaches about 1.75 radii and never crosses the rules.
        val labels = dp(LABEL_SPACE)
        val free = area.height() - 2f * labels
        discRadius = min(area.width() * .29f, free / (2f * OUTER)).coerceAtLeast(dp(36f))
        cx = area.centerX()
        cy = area.top + labels + free / 2f
        shadersFor = 0
    }

    // ---------------------------------------------------------------- artwork & palette

    fun setArtwork(image: Bitmap?) {
        val next = image?.takeUnless { it.isRecycled }?.let { extractPalette(it) } ?: brand
        val square = image?.takeUnless { it.isRecycled }?.let { crop(it) }
        val motion = allowMotion && running
        val changedSong = art != null || oldArt != null
        oldArt = if (motion) art else null
        oldShader = if (motion) artShader else null
        art = square
        artShader = square?.let { BitmapShader(it, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP) }
        artMix = if (motion && (oldArt != null || square != null)) 0f else 1f
        for (i in 0 until 3) fromPalette[i] = palette[i]
        next.copyInto(toPalette)
        paletteMix = if (motion) 0f else 1f
        if (!motion) {
            toPalette.copyInto(palette)
            fieldDirty = true
            shadersFor = 0
        } else {
            ambientDirty = true
            pendingBloom = .85f
            discV += 1.1f
            // A new song brings a new look.
            if (changedSong) nextLook()
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

    /** Gradients that carry the palette, rebuilt only when it (or the size) changes. */
    private fun ensureShaders() {
        val key = palette[0] * 31 + palette[1] * 17 + palette[2] + width * 7 + height
        if (key == shadersFor) return
        shadersFor = key
        val colors = intArrayOf(palette[0], palette[1], lighten(palette[0], .35f), palette[1])
        for (i in blobs.indices) {
            val c = colors[i]
            blobs[i] = RadialGradient(0f, 0f, 1f, intArrayOf(c and 0xFFFFFF or 0xB0000000.toInt(), c and 0xFFFFFF or 0x38000000, c and 0xFFFFFF),
                floatArrayOf(0f, .55f, 1f), Shader.TileMode.CLAMP)
        }
        silk = LinearGradient(0f, 0f, width.toFloat(), 0f,
            intArrayOf(palette[1], palette[0], palette[2], palette[0], palette[1]), null, Shader.TileMode.CLAMP)
        for (i in curtain.indices) {
            val c = if (i == 1) palette[1] else palette[0]
            curtain[i] = LinearGradient(0f, 0f, 0f, 1f,
                intArrayOf(c and 0xFFFFFF, c and 0xFFFFFF or 0x90000000.toInt(), lighten(c, .4f) and 0xFFFFFF or 0x50000000, c and 0xFFFFFF),
                floatArrayOf(0f, .45f, .62f, 1f), Shader.TileMode.CLAMP)
        }
        spokeShade = RadialGradient(0f, 0f, 1f,
            intArrayOf(Color.WHITE, palette[2], palette[0], palette[1] and 0xFFFFFF),
            floatArrayOf(.52f, .62f, .8f, 1f), Shader.TileMode.CLAMP)
    }

    // ---------------------------------------------------------------- frame

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        if (width <= 0 || height <= 0) return
        if (discRadius == 0f) layoutStage()
        val now = clock()
        val dt = if (lastFrame == 0L) 1f / 60f else ((now - lastFrame) / 1e9f).coerceIn(0f, .05f)
        lastFrame = now
        if (allowMotion) advance(now, dt)
        ensureShaders()

        canvas.drawColor(Color.BLACK)
        if (previousBackground >= 0 && backgroundMix < 1f) {
            drawBackground(canvas, previousBackground, 1f)
            val layer = canvas.saveLayerAlpha(0f, 0f, width.toFloat(), height.toFloat(), (255 * ease(backgroundMix)).toInt())
            drawBackground(canvas, background, 1f)
            canvas.restoreToCount(layer)
        } else drawBackground(canvas, background, 1f)
        drawShade(canvas)

        canvas.save()
        canvas.translate(shakeX, shakeY)
        // The indicator stays between the frame's rules.
        val area = stage()
        canvas.save()
        canvas.clipRect(area.left, area.top + dp(LABEL_SPACE) * .55f, area.right, area.bottom - dp(LABEL_SPACE) * .55f)
        if (previousIndicator >= 0 && indicatorMix < 1f) drawIndicator(canvas, previousIndicator, 1f - ease(indicatorMix))
        drawIndicator(canvas, indicator, if (previousIndicator >= 0) ease(indicatorMix) else 1f)
        canvas.restore()
        drawDisc(canvas)
        canvas.restore()
        drawFrame(canvas)

        val wasAnimating = animating
        animating = running && allowMotion && isShown && windowVisibility == VISIBLE && (playing || settling())
        if (animating) postInvalidateOnAnimation()
        if (animating || wasAnimating) follower?.postInvalidateOnAnimation()
    }

    private fun settling() = quiet < 2.2f || pulse > .01f || paletteMix < 1f || artMix < 1f || backgroundMix < 1f ||
        indicatorMix < 1f || abs(discV) > .01f || abs(discX) > .002f || shakeAge < .4f || level > .01f || beatFlash > .01f

    private fun advance(now: Long, dt: Float) {
        time += dt
        if (!playing) quiet += dt
        val spectrum = spectrumSource(now)
        if (spectrum != null) {
            val half = SPOKES / 2
            for (s in 0 until half) {
                val b = (s * spectrum.bandCount / half).coerceAtMost(spectrum.bandCount - 1)
                bands[s] = spectrum.bands[b]
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
            for (s in bands.indices) bands[s] *= fade
            level *= fade; bass *= fade; mid *= fade; high *= fade; pulse *= fade
        }
        // Everything flows faster with the music.
        flow += dt * (if (playing) .55f + bass * 1.4f + level * .8f else .18f)

        // Spring (sub-stepped): the disc breathes with the bass and kicks on beats.
        var remaining = dt
        while (remaining > 0f) {
            val h = min(remaining, 1f / 240f)
            remaining -= h
            val discGoal = bass * .03f
            discV += (-(DISC_W * DISC_W) * (discX - discGoal) - 2f * .38f * DISC_W * discV) * h
            discX += discV * h
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
        beatFlash *= exp(-dt / .18f)
        for (i in ripples.indices) if (ripples[i] >= 0f) {
            ripples[i] += dt
            if (ripples[i] > RIPPLE_LIFE) ripples[i] = -1f
        }

        paletteMix = min(1f, paletteMix + dt / .9f)
        artMix = min(1f, artMix + dt / .6f)
        backgroundMix = min(1f, backgroundMix + dt / 1.6f)
        indicatorMix = min(1f, indicatorMix + dt / 1.1f)
        if (backgroundMix >= 1f) previousBackground = -1
        if (indicatorMix >= 1f) previousIndicator = -1
        val blend = paletteMix * paletteMix * (3f - 2f * paletteMix)
        for (i in 0 until 3) palette[i] = mix(fromPalette[i], toPalette[i], blend)
        if (artMix >= 1f) { oldArt = null; oldShader = null }

        if (playing) {
            lookTimer += dt
            if (lookTimer > LOOK_SECONDS) nextLook()
        }
        if (background == 0 || previousBackground == 0) updateField(dt)
    }

    private fun onBeat(strength: Float) {
        discV += .4f + .8f * strength
        glintAge = 0f
        beatFlash = max(beatFlash, .35f + .65f * strength)
        if (strength > .45f) {
            shakeAmp = dp(2.6f) * strength
            shakeAge = 0f
            shakeAngle = random.nextFloat() * 2f * PI.toFloat()
        }
        val slot = ripples.indices.firstOrNull { ripples[it] < 0f } ?: ripples.indices.maxByOrNull { ripples[it] } ?: 0
        ripples[slot] = 0f
        pendingBloom = max(pendingBloom, strength)
    }

    private fun freeze() {
        pulse = 0f; bass = 0f; level = 0f; mid = 0f; high = 0f
        shakeX = 0f; shakeY = 0f; chroma = 0f; glint = -1f; shakeAge = 1f; beatFlash = 0f
        discX = 0f; discV = 0f
        bands.fill(0f); ripples.fill(-1f)
        paletteMix = 1f; artMix = 1f; oldArt = null; oldShader = null
        backgroundMix = 1f; indicatorMix = 1f; previousBackground = -1; previousIndicator = -1
        toPalette.copyInto(palette)
        fieldDirty = true
        shadersFor = 0
    }

    // ---------------------------------------------------------------- backgrounds

    private fun drawBackground(canvas: Canvas, which: Int, alpha: Float) {
        when (which) {
            0 -> drawLiquid(canvas)
            1 -> drawMesh(canvas, alpha)
            2 -> drawSilk(canvas, alpha)
            else -> drawAurora(canvas, alpha)
        }
    }

    private fun drawShade(canvas: Canvas) {
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

    /** Colour mesh: four soft blobs drifting on slow Lissajous paths, swelling with the bass. */
    private fun drawMesh(canvas: Canvas, alpha: Float) {
        val w = width.toFloat()
        val h = height.toFloat()
        val base = max(w, h)
        for (i in blobs.indices) {
            val shader = blobs[i] ?: continue
            val t = flow * (.32f + i * .07f) + i * 1.7f
            val x = w * (.5f + .36f * sin(t * .9f + i))
            val y = cy + (h * .32f) * sin(t * .63f + i * 2.1f) - h * .06f
            val r = base * (.27f + .04f * i) * (1f + bass * .18f + (if (i == 0) pulse * .12f else 0f))
            matrix.setScale(r, r * (.85f + .25f * sin(t * .5f)))
            matrix.postTranslate(x, y)
            shader.setLocalMatrix(matrix)
            addFill.shader = shader
            addFill.alpha = ((112 + 60 * level) * alpha).toInt().coerceIn(0, 255)
            canvas.drawCircle(x, y, r * 1.1f, addFill)
        }
        addFill.shader = null
    }

    /** Silk: a sheet of fine lines rippling across the screen like fabric in the wind. */
    private fun drawSilk(canvas: Canvas, alpha: Float) {
        val w = width.toFloat()
        val area = stage()
        val centre = area.centerY() + area.height() * .08f
        val spread = area.height() * .38f
        addStroke.shader = silk
        addStroke.strokeWidth = dp(1.1f)
        val count = 30
        val step = w / 48f
        for (k in 0 until count) {
            val f = k / (count - 1f)
            path.rewind()
            var x = -step
            var first = true
            while (x <= w + step) {
                val u = x / w
                val y = centre + spread * (f - .5f) * .9f +
                    spread * .42f * sin(u * 5.2f + flow * 1.1f + f * 1.8f) * (.6f + .4f * sin(flow * .3f + f * 3f)) +
                    spread * .16f * sin(u * 11f - flow * 1.7f + f * 4.1f) * (1f + bass * .9f)
                if (first) path.moveTo(x, y) else path.lineTo(x, y)
                first = false
                x += step
            }
            addStroke.alpha = ((26 + 70 * sin(PI.toFloat() * f)) * alpha * (.8f + level * .5f)).toInt().coerceIn(0, 255)
            canvas.drawPath(path, addStroke)
        }
        addStroke.shader = null
    }

    /** Aurora: tall curtains of light swaying sideways, soft-edged (nested layers), brighter with the music. */
    private fun drawAurora(canvas: Canvas, alpha: Float) {
        val w = width.toFloat()
        val h = height.toFloat()
        val top = h * .04f
        val bottom = h * .8f
        for (k in 0 until 4) {
            val shader = curtain[k % curtain.size] ?: continue
            matrix.setScale(1f, bottom - top)
            matrix.postTranslate(0f, top)
            shader.setLocalMatrix(matrix)
            addFill.shader = shader
            val centre = w * (.14f + k * .24f) + w * .1f * sin(flow * (.45f + k * .07f) + k * 1.3f)
            val width0 = w * (.16f + .05f * sin(flow * .6f + k))
            for ((scale, strength) in AURORA_LAYERS) {
                addFill.alpha = (strength * (.75f + .5f * level + .4f * pulse) * alpha).toInt().coerceIn(0, 255)
                val half = width0 * scale
                path.rewind()
                val rows = 24
                for (r in 0..rows) {
                    val y = top + (bottom - top) * r / rows
                    val x = centre + w * .06f * sin(y / h * 6f + flow * 1.1f + k) - half
                    if (r == 0) path.moveTo(x, y) else path.lineTo(x, y)
                }
                for (r in rows downTo 0) {
                    val y = top + (bottom - top) * r / rows
                    path.lineTo(centre + w * .06f * sin(y / h * 6f + flow * 1.1f + k) + half * (1f + .25f * sin(y / h * 3f - flow + k)), y)
                }
                path.close()
                canvas.drawPath(path, addFill)
            }
        }
        addFill.shader = null
    }

    // ---------------------------------------------------------------- liquid background

    private fun updateField(dt: Float) {
        val liquid = field ?: return
        if (fieldDirty) seedField(liquid)
        if (ambientDirty) paintAmbient(liquid, toPalette)
        val gx = cx / cell
        val gy = cy / cell
        val radius = discRadius / cell
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
        for (k in 0..1) {
            stir[k] += dt * (if (k == 0) .19f else -.23f) * drive
            liquid.swirl(gx + cos(stir[k]) * radius * 1.9f, gy + sin(stir[k]) * radius * 1.7f, radius * .85f,
                (if (k == 0) 1f else -1f) * 10f * dt * (1f + bass + pulse * 2f))
        }
        if (pendingBloom > 0f) {
            val strength = pendingBloom
            pendingBloom = 0f
            val offset = random.nextFloat() * 2f * PI.toFloat()
            for (k in 0 until 9) {
                val a = offset + k * 2f * PI.toFloat() / 9
                val speed = 18f + 46f * strength
                liquid.splat(gx + cos(a) * radius * 1.05f, gy + sin(a) * radius * 1.05f, 1.9f, cos(a) * speed, sin(a) * speed,
                    palette[k % 2], .25f + .3f * strength)
            }
        }
        liquid.step(dt)
        renderField(liquid)
    }

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

    private fun drawLiquid(canvas: Canvas) {
        val liquid = field
        val bitmap = fieldBitmap
        if (liquid != null && bitmap != null) {
            if (fieldDirty) {
                seedField(liquid)
                renderField(liquid)
            }
            canvas.drawBitmap(bitmap, fieldRect, fieldTarget, fieldPaint)
        }
    }

    // ---------------------------------------------------------------- rhythm indicators

    private fun drawIndicator(canvas: Canvas, which: Int, alpha: Float) {
        if (alpha <= .01f) return
        when (which) {
            0 -> drawPulseLines(canvas, alpha)
            1 -> drawTopo(canvas, alpha)
            else -> drawGlowLines(canvas, alpha)
        }
    }

    /** Gradient pulse lines: one hard spoke per band from the rim, white at the root, palette outward. */
    private fun drawPulseLines(canvas: Canvas, alpha: Float) {
        val r0 = discRadius * (1f + discX) * 1.1f
        val reach = discRadius * (REACH - 1.12f)
        val sway = if (allowMotion) flow * .05f else 0f
        val cs = cos(sway)
        val sn = sin(sway)
        var n = 0
        val half = SPOKES / 2
        for (s in 0 until SPOKES) {
            val band = if (s < half) s else SPOKES - 1 - s
            val ux = unitX[s] * cs - unitY[s] * sn
            val uy = unitX[s] * sn + unitY[s] * cs
            val v = (bands[band] * (1f + beatFlash * .35f)).coerceIn(0f, 1.2f)
            val len = reach * (.05f + .95f * v)
            lines[n++] = cx + ux * r0
            lines[n++] = cy + uy * r0
            lines[n++] = cx + ux * (r0 + len)
            lines[n++] = cy + uy * (r0 + len)
        }
        // Faint ruler ticks: the brutalist scale the spokes rise from.
        stroke.shader = null
        stroke.color = Color.WHITE
        stroke.alpha = (44 * alpha).toInt()
        stroke.strokeWidth = dp(.8f)
        stroke.strokeCap = Paint.Cap.BUTT
        val tick = discRadius * .05f
        for (s in 0 until SPOKES step 2) {
            val a = 2f * PI.toFloat() * s / SPOKES + sway
            val r = r0 + reach + dp(6f)
            canvas.drawLine(cx + cos(a) * r, cy + sin(a) * r, cx + cos(a) * (r + tick), cy + sin(a) * (r + tick), stroke)
        }
        val shader = spokeShade ?: return
        val outer = r0 + reach
        matrix.setScale(outer, outer)
        matrix.postTranslate(cx, cy)
        shader.setLocalMatrix(matrix)
        // A soft wide pass under the hard lines: the glow of each pulse.
        addStroke.shader = shader
        addStroke.strokeCap = Paint.Cap.BUTT
        addStroke.strokeWidth = discRadius * .06f
        addStroke.alpha = ((50 + 90 * beatFlash) * alpha).toInt().coerceIn(0, 255)
        canvas.drawLines(lines, 0, n, addStroke)
        addStroke.shader = null
        stroke.shader = shader
        stroke.alpha = (255 * alpha).toInt()
        stroke.strokeWidth = discRadius * .024f
        canvas.drawLines(lines, 0, n, stroke)
        stroke.shader = null
    }

    /** Topographic contours: closed lines that flow outward from the disc, warped by the spectrum. */
    private fun drawTopo(canvas: Canvas, alpha: Float) {
        val r0 = discRadius * (1f + discX) * 1.08f
        val span = discRadius * (REACH - 1.08f)
        val contours = 9
        val gap = span / contours
        val drift = (flow * gap * .9f) % gap
        stroke.shader = null
        stroke.strokeCap = Paint.Cap.ROUND
        for (k in 0 until contours) {
            val base = r0 + k * gap + drift
            val f = ((base - r0) / span).coerceIn(0f, 1f)
            val fade = sin(PI.toFloat() * f)
            contour(canvas, base, f, k.toFloat(), mix(palette[2], palette[0], f), (fade * (110 + 120 * level) * alpha).toInt(), dp(1.1f))
        }
        // Beats leave a bright contour that travels out and fades.
        for (age in ripples) {
            if (age < 0f) continue
            val t = age / RIPPLE_LIFE
            val base = r0 + span * (.02f + .98f * (1f - (1f - t) * (1f - t)))
            contour(canvas, base, t, 11f + age * 3f, Color.WHITE, ((1f - t) * 235 * alpha).toInt(), dp(1.6f) * (1.4f - t))
        }
    }

    private fun contour(canvas: Canvas, radius: Float, f: Float, seed: Float, color: Int, a: Int, width: Float) {
        if (a <= 2) return
        path.rewind()
        val steps = 96
        val half = SPOKES / 2
        for (i in 0..steps) {
            val th = 2f * PI.toFloat() * i / steps
            // Mirror the spectrum like the old ring: bass at the crown.
            val s = ((th / (2f * PI.toFloat())) * SPOKES).toInt().coerceIn(0, SPOKES - 1)
            val band = bands[if (s < half) s else SPOKES - 1 - s]
            val warp = discRadius * (.05f * sin(3f * th + flow * .8f + seed * .7f) +
                .03f * sin(5f * th - flow * 1.1f + seed * 1.3f)) * (1f + level) +
                discRadius * .16f * band * (1f - f * .5f)
            val r = radius + warp
            val x = cx + cos(th - PI.toFloat() / 2) * r
            val y = cy + sin(th - PI.toFloat() / 2) * r * .96f
            if (i == 0) path.moveTo(x, y) else path.lineTo(x, y)
        }
        path.close()
        stroke.color = color
        stroke.alpha = a.coerceIn(0, 255)
        stroke.strokeWidth = width
        canvas.drawPath(path, stroke)
    }

    /** Glow lines: horizontal scan lines across the stage, bent by the spectrum (bass in the middle). */
    private fun drawGlowLines(canvas: Canvas, alpha: Float) {
        val w = width.toFloat()
        val area = stage()
        val count = 5
        val pitch = discRadius * .32f
        val step = w / 64f
        val half = SPOKES / 2
        for (k in 0 until count) {
            val offset = (k - (count - 1) / 2f) * pitch
            val y0 = cy + offset
            if (y0 < area.top || y0 > area.bottom) continue
            path.rewind()
            var x = 0f
            var px = 0f
            var py = 0f
            var first = true
            while (x <= w + 1f) {
                val d = abs(x - cx) / (w / 2f)
                // Between bands, not stepping from one to the next (no zigzag).
                val at = (d * (half - 1)).coerceIn(0f, half - 1f)
                val i0 = at.toInt().coerceAtMost(half - 2)
                val band = bands[i0] + (bands[i0 + 1] - bands[i0]) * (at - i0)
                // Calm at the edges, full in the middle.
                val envelope = cos(d.coerceAtMost(1f) * PI.toFloat() / 2f)
                val dir = if (k % 2 == 0) -1f else 1f
                val y = y0 + dir * discRadius * .7f * band * envelope * (1f - abs(offset) / (pitch * 3.2f)) +
                    discRadius * .05f * sin(x / w * 9f + flow * 2.4f + k * 1.1f) * (.4f + level)
                // Smooth: a quadratic through the midpoints.
                if (first) path.moveTo(x, y) else path.quadTo(px, py, (px + x) / 2f, (py + y) / 2f)
                px = x; py = y
                first = false
                x += step
            }
            path.lineTo(px, py)
            val c = if (k == count / 2) palette[2] else mix(palette[0], palette[1], k / (count - 1f))
            // Glow without blur: wide faint passes under a thin bright core.
            addStroke.shader = null
            addStroke.strokeCap = Paint.Cap.ROUND
            addStroke.color = c
            for ((wide, a) in GLOW_PASSES) {
                addStroke.strokeWidth = dp(wide)
                addStroke.alpha = (a * alpha * (.7f + .6f * beatFlash)).toInt().coerceIn(0, 255)
                canvas.drawPath(path, addStroke)
            }
            stroke.shader = null
            stroke.color = lighten(c, .55f)
            stroke.alpha = (240 * alpha).toInt()
            stroke.strokeWidth = dp(1.3f)
            canvas.drawPath(path, stroke)
        }
    }

    // ---------------------------------------------------------------- disc

    private fun drawDisc(canvas: Canvas) {
        val r = discRadius * (1f + discX)
        fill.color = Color.BLACK
        fill.alpha = 170
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
        rim.alpha = (110 + 140 * beatFlash).toInt().coerceAtMost(255)
        rim.strokeWidth = dp(1.2f)
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

    // ---------------------------------------------------------------- brutalist frame

    /** Hairline rules above and below the stage, with monospaced labels: what plays, how loud. */
    private fun drawFrame(canvas: Canvas) {
        val area = stage()
        if (area.width() < dp(160f)) return
        val left = area.left + dp(22f)
        val right = area.right - dp(22f)
        val top = area.top + dp(4f)
        val bottom = area.bottom - dp(2f)
        stroke.shader = null
        stroke.color = Color.WHITE
        stroke.alpha = 46
        stroke.strokeWidth = dp(.7f)
        stroke.strokeCap = Paint.Cap.BUTT
        canvas.drawLine(left, top, right, top, stroke)
        canvas.drawLine(left, bottom, right, bottom, stroke)
        // Corner ticks.
        val t = dp(7f)
        stroke.alpha = 120
        canvas.drawLine(left, top, left, top + t, stroke)
        canvas.drawLine(right, top, right, top + t, stroke)
        canvas.drawLine(left, bottom, left, bottom - t, stroke)
        canvas.drawLine(right, bottom, right, bottom - t, stroke)
        mono.textSize = dp(8.5f)
        mono.color = Color.WHITE
        mono.alpha = 150
        mono.textAlign = Paint.Align.LEFT
        val label = "%02d/%02d  %s × %s".format(background + 1, BACKGROUNDS.size, BACKGROUNDS[background], INDICATORS[indicator])
        canvas.drawText(label, left, top + t + dp(10f), mono)
        mono.textAlign = Paint.Align.RIGHT
        val meter = (level * 100).roundToInt().coerceIn(0, 99)
        canvas.drawText(if (playing) "SONANDO" else "EN PAUSA", right, top + t + dp(10f), mono)
        mono.alpha = if (beatFlash > .2f) 255 else 120
        canvas.drawText("NV %02d".format(meter) + if (beatFlash > .2f) "  ●" else "  ○", right, bottom - t - dp(4f), mono)
    }

    // ---------------------------------------------------------------- helpers

    private fun ease(t: Float) = t * t * (3f - 2f * t)

    private fun mix(a: Int, b: Int, t: Float): Int {
        if (t <= 0f) return a
        if (t >= 1f) return b
        val ar = (a shr 16) and 0xFF; val ag = (a shr 8) and 0xFF; val ab = a and 0xFF
        val br = (b shr 16) and 0xFF; val bg = (b shr 8) and 0xFF; val bb = b and 0xFF
        return (0xFF shl 24) or ((ar + (br - ar) * t).roundToInt() shl 16) or
            ((ag + (bg - ag) * t).roundToInt() shl 8) or (ab + (bb - ab) * t).roundToInt()
    }

    private fun lighten(color: Int, amount: Float) = mix(color, Color.WHITE, amount)

    internal companion object {
        const val SPOKES = 72
        /** How far the indicator reaches, in disc radii. */
        const val REACH = 1.62f
        /** The whole indicator with its ruler ticks, in disc radii (for layout). */
        const val OUTER = 1.76f
        /** Room for the frame's labels above and below the stage, in dp. */
        const val LABEL_SPACE = 30f
        const val RIPPLE_LIFE = 1.6f
        const val LOOK_SECONDS = 90f
        const val DISC_W = 15.08f // 2π · 2.4 Hz
        val ORBIT_SPEED = floatArrayOf(.34f, -.27f, .41f)
        val BACKGROUNDS = arrayOf("LÍQUIDO", "MALLA", "SEDA", "AURORA")
        val INDICATORS = arrayOf("PULSO", "TOPO", "GLOW")
        val GLOW_PASSES = arrayOf(14f to 18f, 7f to 34f, 3.2f to 70f)
        val AURORA_LAYERS = arrayOf(1f to 34f, .66f to 40f, .38f to 52f, .16f to 70f)
        /** The look continues where the last visit left it, so reopening also shows something new. */
        var lastBackground = 1
        var lastIndicator = 0
    }
}
