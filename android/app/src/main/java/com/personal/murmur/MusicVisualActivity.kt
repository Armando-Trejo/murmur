package com.personal.murmur

import android.animation.ValueAnimator
import android.app.Activity
import android.content.res.ColorStateList
import android.content.res.Configuration
import android.graphics.*
import android.graphics.drawable.ColorDrawable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.TextUtils
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.view.animation.PathInterpolator
import android.widget.*
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import kotlinx.coroutines.*
import java.io.ByteArrayOutputStream
import java.util.Date
import java.util.Locale
import kotlin.math.min
import kotlin.math.roundToInt

/** User-opened visual player. Android continues to own the secure lock screen. */
class MusicVisualActivity : Activity() {
    private enum class Control { Close, Back, Play, Next }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val handler = Handler(Looper.getMainLooper())
    private val settle = PathInterpolator(.16f, 1f, .3f, 1f)
    private lateinit var art: AuraStageView
    private lateinit var controlsPanel: View
    private lateinit var title: TextView
    private lateinit var artist: TextView
    private lateinit var clock: DotClockView
    private lateinit var date: TextView
    private lateinit var elapsed: TextView
    private lateinit var total: TextView
    private lateinit var play: TransportButton
    private lateinit var timeline: SeekBar
    private var durationMs = 0L
    private var active = false
    private var entered = false
    private var seeking = false
    private var coverKey: String? = null
    private var artworkJob: Job? = null
    private val accent = 0xFFE6DAFF.toInt()
    private val secondary = 0xFFB9B3C5.toInt()
    private val update = object : Runnable {
        override fun run() {
            if (!active) return
            val service = HybridMediaService.instance
            if (service == null) {
                finish()
                return
            }
            val data = service.track
            title.updateText(data?.optString("title")?.takeIf { it.isNotBlank() } ?: "Elige una canción")
            artist.updateText(data?.optString("artist").orEmpty())
            artist.visibility = if (artist.text.isEmpty()) View.GONE else View.VISIBLE

            val now = Date()
            val hours24 = android.text.format.DateFormat.is24HourFormat(this@MusicVisualActivity)
            clock.setTime(android.text.format.DateFormat.format(if (hours24) "H:mm" else "h:mm", now).toString(),
                if (hours24) "" else android.text.format.DateFormat.format("a", now).toString().uppercase(Locale.getDefault()),
                android.text.format.DateFormat.getTimeFormat(this@MusicVisualActivity).format(now))
            date.updateText(android.text.format.DateFormat.format("EEE, d MMM", now).toString().replace(".", ""))
            val state = if (service.spotifyActive) service.integratedState() else null
            val position = (state?.optLong("progress_ms") ?: service.youtubePositionMs).coerceAtLeast(0L)
            val reportedDuration = if (service.spotifyActive) {
                state?.optJSONObject("item")?.optLong("duration_ms") ?: 0L
            } else {
                service.primaryPlayer.duration
            }
            durationMs = reportedDuration.takeIf { it > 0L }
                ?: (data?.optDouble("duration", 0.0)?.times(1000)?.toLong() ?: 0L)
            val fraction = if (durationMs > 0) (position.toFloat() / durationMs).coerceIn(0f, 1f) else 0f
            timeline.isEnabled = durationMs > 0
            if (!seeking) {
                timeline.progress = (fraction * 1000).roundToInt()
                elapsed.updateText(formatTime(position))
            }
            total.updateText(if (durationMs > 0) formatTime(durationMs) else "—:—")
            val engaged = if (service.spotifyActive) {
                state?.optBoolean("is_playing") == true || state?.optBoolean("loading") == true
            } else service.youtubeLoading || service.primaryPlayer.playWhenReady
            art.playing = service.visualPlaying
            val action = if (engaged) "Pausar" else "Reproducir"
            if (play.text.toString() != action) {
                play.text = action
                play.contentDescription = action
            }
            loadArtwork(data?.optString("artworkUrl").orEmpty(), data?.optString("videoId").orEmpty())
            handler.postDelayed(this, 250)
        }
    }

    @Suppress("DEPRECATION")
    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        if (android.os.Build.VERSION.SDK_INT >= 27) setShowWhenLocked(true)
        else window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED)
        window.statusBarColor = Color.BLACK
        window.navigationBarColor = Color.BLACK
        window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
            View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION

        val wide = resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE
        val root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val cutout = insets.getInsets(WindowInsetsCompat.Type.displayCutout())
            view.setPadding(cutout.left, cutout.top, cutout.right, cutout.bottom)
            insets
        }
        art = AuraStageView(this)
        root.addView(art, FrameLayout.LayoutParams(-1, -1))
        val header = createHeader(wide)
        val panel = createControls(wide)
        controlsPanel = panel
        val railWidth = (resources.displayMetrics.widthPixels * .44f).roundToInt()
        val headerParams = FrameLayout.LayoutParams(if (wide) (resources.displayMetrics.widthPixels * .53f).roundToInt() else -1, -2, Gravity.TOP or Gravity.START)
        val panelParams = FrameLayout.LayoutParams(if (wide) railWidth else -1, -2,
            if (wide) Gravity.END or Gravity.CENTER_VERTICAL else Gravity.BOTTOM)
        root.addView(header, headerParams)
        root.addView(panel, panelParams)
        val brand = TextView(this).apply {
            setText(R.string.app_name)
            textSize = 10.5f
            letterSpacing = .42f
            setTextColor(0x9EE6DAFF.toInt())
            typeface = Typeface.create("sans-serif", Typeface.BOLD)
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        }
        root.addView(brand, FrameLayout.LayoutParams(-2, -2, Gravity.TOP or Gravity.START).apply {
            setMargins(dp(22), dp(29), 0, 0)
        })

        val close = TransportButton(Control.Close, "Volver a MURMUR") { finish() }
        val closeParams = FrameLayout.LayoutParams(dp(48), dp(48), Gravity.TOP or Gravity.END).apply {
            setMargins(0, dp(12), dp(12), 0)
        }
        root.addView(close, closeParams)
        root.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ ->
            val left = art.left.toFloat()
            val top = (header.bottom - art.top + dp(10)).toFloat()
            val right = if (wide) (panel.left - dp(12)).toFloat() else art.right.toFloat()
            val bottom = if (wide) (art.bottom - dp(18)).toFloat() else (panel.top - dp(12)).toFloat()
            art.place(0f, top, right - left, bottom - art.top)
        }
        setContentView(root)
    }

    private fun createHeader(wide: Boolean): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER_HORIZONTAL
        setPadding(dp(18), dp(if (wide) 14 else 28), dp(18), dp(4))
        date = label(if (wide) 10.5f else 11.5f, secondary, "sans-serif-condensed", Typeface.BOLD).apply {
            gravity = Gravity.CENTER
            maxLines = 1
            isAllCaps = true
            letterSpacing = .3f
        }
        addView(date)
        // Dot-matrix clock: LED dots that swell with the bass and catch a light sweep on beats.
        clock = DotClockView(this@MusicVisualActivity, art, DotMatrixText.FACE_ROWS, if (wide) 4.7f else 6.3f).apply {
            setPadding(0, dp(if (wide) 8 else 14), 0, dp(2))
        }
        art.follower = clock
        addView(clock, LinearLayout.LayoutParams(-1, -2))
    }

    private fun createControls(wide: Boolean): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(if (wide) 18 else 26), dp(9), dp(if (wide) 18 else 26), dp(if (wide) 7 else 26))
        title = label(if (wide) 25f else 31f, 0xFFF7F3FD.toInt(), "sans-serif-condensed", Typeface.BOLD).apply {
            setSingleLine(true)
            ellipsize = TextUtils.TruncateAt.MARQUEE
            marqueeRepeatLimit = -1
            isSelected = true
            letterSpacing = -.012f
            includeFontPadding = false
        }
        addView(title, LinearLayout.LayoutParams(-1, -2))
        artist = label(12f, 0xD9E6DAFF.toInt(), "sans-serif-medium").apply {
            setSingleLine(true)
            ellipsize = TextUtils.TruncateAt.END
            isAllCaps = true
            letterSpacing = .2f
        }
        addView(artist, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(7) })
        timeline = SeekBar(this@MusicVisualActivity).apply {
            contentDescription = "Posición de reproducción"
            max = 1000
            progressTintList = ColorStateList.valueOf(accent)
            progressBackgroundTintList = ColorStateList.valueOf(0xFF373340.toInt())
            thumbTintList = ColorStateList.valueOf(accent)
            setPadding(dp(6), 0, dp(6), 0)
            setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                override fun onStartTrackingTouch(bar: SeekBar) { seeking = true }
                override fun onProgressChanged(bar: SeekBar, value: Int, fromUser: Boolean) {
                    if (fromUser) {
                        elapsed.updateText(formatTime(durationMs * value / 1000))
                        if (!seeking) seekTo(value)
                    }
                }
                override fun onStopTrackingTouch(bar: SeekBar) {
                    seeking = false
                    seekTo(bar.progress)
                }
            })
        }
        addView(timeline, LinearLayout.LayoutParams(-1, dp(48)))
        val times = LinearLayout(this@MusicVisualActivity)
        elapsed = label(12.5f, accent, "sans-serif-condensed", Typeface.BOLD).apply {
            fontFeatureSettings = "tnum"
            letterSpacing = .08f
        }
        total = label(12.5f, secondary, "sans-serif-condensed", Typeface.BOLD).apply {
            gravity = Gravity.END
            fontFeatureSettings = "tnum"
            letterSpacing = .08f
        }
        times.addView(elapsed, LinearLayout.LayoutParams(0, -2, 1f))
        times.addView(total, LinearLayout.LayoutParams(0, -2, 1f))
        addView(times, LinearLayout.LayoutParams(-1, -2))
        val controls = LinearLayout(this@MusicVisualActivity).apply { gravity = Gravity.CENTER }
        controls.addView(TransportButton(Control.Back, "Anterior") {
            HybridMediaService.instance?.previousNative()
        }, LinearLayout.LayoutParams(dp(if (wide) 54 else 64), dp(64)))
        play = TransportButton(Control.Play, "Reproducir") { toggle() }
        controls.addView(play, LinearLayout.LayoutParams(dp(if (wide) 66 else 76), dp(76)).apply { setMargins(dp(if (wide) 8 else 13), 0, dp(if (wide) 8 else 13), 0) })
        controls.addView(TransportButton(Control.Next, "Siguiente") {
            HybridMediaService.instance?.advanceNative()
        }, LinearLayout.LayoutParams(dp(if (wide) 54 else 64), dp(64)))
        addView(controls, LinearLayout.LayoutParams(-1, dp(90)))
    }

    private fun label(size: Float, color: Int, family: String = "sans-serif", style: Int = Typeface.NORMAL) = TextView(this).apply {
        textSize = size
        setTextColor(color)
        typeface = Typeface.create(family, style)
    }
    private fun TextView.updateText(value: String) {
        if (text.toString() != value) text = value
    }
    private fun formatTime(ms: Long) = "%d:%02d".format(ms.coerceAtLeast(0) / 60000, ms.coerceAtLeast(0) / 1000 % 60)
    private fun dp(value: Int) = (value * resources.displayMetrics.density).roundToInt()

    private fun seekTo(progress: Int) {
        if (durationMs <= 0) return
        val position = durationMs * progress / 1000
        HybridMediaService.instance?.let {
            if (it.spotifyActive) it.seekIntegrated(position) else it.seekYouTube(position)
        }
    }

    private fun toggle() {
        val service = HybridMediaService.instance ?: return
        try {
            val state = if (service.spotifyActive) service.integratedState() else null
            val engaged = if (service.spotifyActive) {
                state?.optBoolean("is_playing") == true || state?.optBoolean("loading") == true
            } else service.youtubeLoading || service.primaryPlayer.playWhenReady
            if (engaged) {
                PlaybackRequests.next()
                service.pausePlayback()
            } else if (service.spotifyActive) service.resumeIntegrated() else service.primaryPlayer.play()
            handler.removeCallbacks(update)
            handler.post(update)
        } catch (_: IllegalStateException) {
            Toast.makeText(this, "Vuelve a MURMUR para recargar esta canción.", Toast.LENGTH_LONG).show()
        }
    }

    private fun loadArtwork(url: String, videoId: String) {
        val key = "$url|$videoId"
        if (coverKey == key) return
        coverKey = key
        artworkJob?.cancel()
        artworkJob = scope.launch {
            val image = withContext(Dispatchers.IO) {
                val video = videoId.matches(Regex("[A-Za-z0-9_-]{11}"))
                val fromVideo = url.isBlank() || url.startsWith("https://i.ytimg.com/") || url.startsWith("https://img.youtube.com/")
                val candidates = buildList {
                    if (video && fromVideo) add("https://i.ytimg.com/vi/$videoId/maxresdefault.jpg")
                    if (url.startsWith("https://")) add(url)
                    if (video && fromVideo) add("https://i.ytimg.com/vi/$videoId/hqdefault.jpg")
                }
                candidates.distinct().firstNotNullOfOrNull(::downloadArtwork)
            }
            if (coverKey == key) {
                art.setArtwork(image)
                image?.recycle()
            }
        }
    }

    private fun downloadArtwork(url: String): Bitmap? = runCatching {
        val request = okhttp3.Request.Builder().url(url).build()
        NativeNetwork.client.newCall(request).execute().use response@ { response ->
            if (!response.isSuccessful) return@response null
            val input = response.body?.byteStream() ?: return@response null
            val output = ByteArrayOutputStream()
            val buffer = ByteArray(8192)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                if (output.size() + count > 4 * 1024 * 1024) return@response null
                output.write(buffer, 0, count)
            }
            val bytes = output.toByteArray()
            val dimensions = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, dimensions)
            if (min(dimensions.outWidth, dimensions.outHeight) < 100 && url.endsWith("maxresdefault.jpg")) return@response null
            val options = BitmapFactory.Options().apply {
                inSampleSize = (maxOf(dimensions.outWidth, dimensions.outHeight) / 768).coerceAtLeast(1)
            }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
        }
    }.getOrNull()

    override fun onResume() {
        super.onResume()
        active = true
        art.allowMotion = ValueAnimator.areAnimatorsEnabled()
        art.running = true
        title.ellipsize = if (art.allowMotion) TextUtils.TruncateAt.MARQUEE else TextUtils.TruncateAt.END
        title.isSelected = art.allowMotion
        if (!entered && art.allowMotion) {
            controlsPanel.alpha = .68f
            controlsPanel.translationY = dp(9).toFloat()
            controlsPanel.animate().alpha(1f).translationY(0f).setDuration(280).setInterpolator(settle).start()
        }
        entered = true
        handler.post(update)
    }

    override fun onPause() {
        active = false
        art.running = false
        controlsPanel.animate().cancel()
        controlsPanel.alpha = 1f
        controlsPanel.translationY = 0f
        handler.removeCallbacks(update)
        super.onPause()
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        scope.cancel()
        super.onDestroy()
    }

    @android.annotation.SuppressLint("AppCompatCustomView")
    private inner class TransportButton(
        private val control: Control,
        label: String,
        action: () -> Unit,
    ) : Button(this@MusicVisualActivity) {
        private val ink = Paint(Paint.ANTI_ALIAS_FLAG)
        private val glyph = Path()
        init {
            text = label
            contentDescription = label
            background = ColorDrawable(Color.TRANSPARENT)
            setOnClickListener { action() }
        }

        override fun setPressed(pressed: Boolean) {
            if (pressed == isPressed) return
            super.setPressed(pressed)
            if (ValueAnimator.areAnimatorsEnabled()) {
                val size = if (pressed) .947f else 1f
                animate().scaleX(size).scaleY(size).setDuration(if (pressed) 95 else 165)
                    .setInterpolator(settle).start()
            }
        }

        override fun onDraw(canvas: Canvas) {
            val cx = width / 2f
            val cy = height / 2f
            val main = control == Control.Play
            val radius = min(cx, cy) * if (main) .88f else .71f
            ink.style = Paint.Style.FILL
            ink.color = if (main) accent else 0xFF20212C.toInt()
            ink.alpha = if (isPressed) 195 else 255
            canvas.drawCircle(cx, cy, radius, ink)
            ink.style = Paint.Style.STROKE
            ink.strokeWidth = dp(1).toFloat()
            ink.color = if (isFocused) Color.WHITE else 0x30FFFFFF
            canvas.drawCircle(cx, cy, radius, ink)
            ink.style = Paint.Style.FILL
            ink.color = if (main) 0xFF20182B.toInt() else 0xFFF1EBF9.toInt()
            val unit = radius * .44f
            when {
                control == Control.Close -> {
                    ink.strokeWidth = dp(2).toFloat()
                    ink.strokeCap = Paint.Cap.ROUND
                    canvas.drawLine(cx-unit*.7f, cy-unit*.7f, cx+unit*.7f, cy+unit*.7f, ink)
                    canvas.drawLine(cx+unit*.7f, cy-unit*.7f, cx-unit*.7f, cy+unit*.7f, ink)
                }
                main && text.toString() == "Pausar" -> {
                    canvas.drawRoundRect(cx-unit*.64f, cy-unit, cx-unit*.21f, cy+unit, 2f, 2f, ink)
                    canvas.drawRoundRect(cx+unit*.21f, cy-unit, cx+unit*.64f, cy+unit, 2f, 2f, ink)
                }
                else -> {
                    val direction = if (control == Control.Back) -1 else 1
                    val offset = if (main) unit * .12f else -unit * .245f * direction
                    val center = cx + offset
                    glyph.rewind()
                    glyph.moveTo(center-unit*.64f*direction, cy-unit)
                    glyph.lineTo(center+unit*.83f*direction, cy)
                    glyph.lineTo(center-unit*.64f*direction, cy+unit)
                    glyph.close()
                    canvas.drawPath(glyph, ink)
                    if (!main) {
                        val bar = center + unit * 1.02f * direction
                        canvas.drawRoundRect(bar-unit*.11f, cy-unit, bar+unit*.11f, cy+unit, 1f, 1f, ink)
                    }
                }
            }
        }
    }
}
