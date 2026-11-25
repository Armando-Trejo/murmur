package com.personal.murmur

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.SizeF
import android.view.View
import android.widget.RemoteViews
import androidx.core.graphics.createBitmap
import androidx.media3.common.Player
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Home-screen player. The playback service pushes changes; the launcher only asks on add, resize and boot. */
class MurmurWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) = MurmurWidget.refresh(context)
    override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, options: Bundle) = MurmurWidget.refresh(context)
    override fun onDisabled(context: Context) = MurmurWidget.release()
}

/** The widget's buttons. Not exported: only MURMUR's own PendingIntents reach it. */
class MurmurWidgetActions : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val service = HybridMediaService.instance
        if (service == null || service.track == null) {
            // Android stopped MURMUR after the widget was drawn: open it instead of acting on nothing,
            // and redraw the empty card so the next tap goes straight to the app.
            MurmurWidget.open(context, player = false)
            MurmurWidget.refresh(context)
            return
        }
        try {
            when (intent.action) {
                MurmurWidget.ACTION_PREVIOUS -> service.previousNative()
                MurmurWidget.ACTION_NEXT -> service.advanceNative()
                MurmurWidget.ACTION_TOGGLE -> if (!MurmurWidget.toggle(service)) MurmurWidget.open(context, player = true)
                else -> return
            }
        } catch (_: RuntimeException) {
            // A tap on the home screen must never close MURMUR; the app shows what went wrong.
            MurmurWidget.open(context, player = true)
        }
        MurmurWidget.settle(context)
    }
}

/**
 * Draws the widget with RemoteViews from [HybridMediaService.instance]. Everything here runs on the
 * main thread except the cover download, which runs on its own low-priority thread.
 */
object MurmurWidget {
    const val ACTION_PREVIOUS = "com.personal.murmur.widget.PREVIOUS"
    const val ACTION_TOGGLE = "com.personal.murmur.widget.TOGGLE"
    const val ACTION_NEXT = "com.personal.murmur.widget.NEXT"
    private const val COVER_RADIUS = 0.14f
    private const val MAX_COVER_BYTES = 4 * 1024 * 1024

    private val main = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor { task -> Thread(task, "murmur-widget-cover").apply { isDaemon = true; priority = Thread.MIN_PRIORITY } }
    private val http by lazy { NativeNetwork.client.newBuilder().callTimeout(12, TimeUnit.SECONDS).build() }

    private var lastKey: String? = null
    private var coverKey: String? = null
    private var coverBitmap: Bitmap? = null
    /** Written on the main thread, read by the cover thread to skip songs that were already skipped. */
    @Volatile private var loadingKey: String? = null
    private var appContext: Context? = null
    private val settleCheck = Runnable { appContext?.let(::sync) }

    /**
     * Called by the playback service on track and play-state changes and from its ticker. Cheap when
     * nothing visible changed; a failure here never reaches playback.
     */
    fun sync(context: Context) {
        try {
            val state = current()
            if (state.key == lastKey) return
            lastKey = state.key
            render(context.applicationContext, state)
        } catch (_: Exception) {
            // Keep lastKey: retrying on every tick would not fix a launcher that refuses the update.
        }
    }

    /** Redraws even if nothing changed: a widget was added, resized or the launcher restarted. */
    fun refresh(context: Context) {
        lastKey = null
        sync(context)
    }

    /** The engine settles a moment after a tap (buffering, a new source): look again shortly. */
    fun settle(context: Context) {
        appContext = context.applicationContext
        main.removeCallbacks(settleCheck)
        main.postDelayed(settleCheck, 350)
        main.postDelayed(settleCheck, 1_500)
    }

    /** The last widget was removed. */
    fun release() {
        main.removeCallbacks(settleCheck)
        lastKey = null; coverKey = null; coverBitmap = null; loadingKey = null
    }

    private fun current(): WidgetState {
        val service = HybridMediaService.instance ?: return WidgetState.EMPTY
        val track = service.track ?: return WidgetState.EMPTY
        return WidgetModel.state(true, track.optString("title"), track.optString("artist"),
            track.optString("artworkUrl"), track.optString("videoId"), engaged(service))
    }

    /** Playing or about to (buffering, recovering a source): the button offers Pause. */
    private fun engaged(service: HybridMediaService): Boolean {
        if (service.spotifyActive) {
            val state = service.integratedState()
            return state.optBoolean("is_playing") || state.optBoolean("loading")
        }
        val player = service.primaryPlayer
        return service.youtubeLoading || (player.playWhenReady &&
            player.playbackState != Player.STATE_ENDED && player.playbackState != Player.STATE_IDLE)
    }

    /** Same decision as MURMUR's music screen. False when only the app can resume (failed source, lost engine). */
    fun toggle(service: HybridMediaService): Boolean = try {
        if (engaged(service)) {
            PlaybackRequests.next()
            service.pausePlayback()
            true
        } else if (service.spotifyActive) {
            service.resumeIntegrated()
            true
        } else {
            val player = service.primaryPlayer
            when (player.playbackState) {
                Player.STATE_IDLE -> false
                Player.STATE_ENDED -> { player.seekTo(0); player.play(); true }
                else -> { player.play(); true }
            }
        }
    } catch (_: IllegalStateException) {
        false
    }

    fun open(context: Context, player: Boolean) {
        try { context.startActivity(launch(context, player)) } catch (_: RuntimeException) { }
    }

    private fun launch(context: Context, player: Boolean) = Intent(context, MainActivity::class.java)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        .apply { if (player) putExtra("open_player", true) }

    private fun activity(context: Context, player: Boolean): PendingIntent = PendingIntent.getActivity(context,
        if (player) 4101 else 4102, launch(context, player), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    private fun broadcast(context: Context, action: String, code: Int): PendingIntent = PendingIntent.getBroadcast(context, code,
        Intent(context, MurmurWidgetActions::class.java).setAction(action), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    private fun render(context: Context, state: WidgetState) {
        val manager = context.getSystemService(AppWidgetManager::class.java) ?: return
        val ids = manager.getAppWidgetIds(ComponentName(context, MurmurWidgetProvider::class.java))
        if (ids.isEmpty()) return
        val cover = cover(context, state)
        if (Build.VERSION.SDK_INT >= 31) {
            // The launcher picks the layout per size; the shared bitmap is parcelled once.
            val minHeight = WidgetModel.COMPACT_BELOW_DP.toFloat()
            manager.updateAppWidget(ids, RemoteViews(mapOf(
                SizeF(120f, 40f) to views(context, state, cover, compact = true),
                SizeF(120f, minHeight) to views(context, state, cover, compact = false))))
        } else for (id in ids) {
            val height = runCatching { manager.getAppWidgetOptions(id)?.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT) }.getOrNull() ?: 0
            manager.updateAppWidget(id, views(context, state, cover, WidgetModel.compact(height)))
        }
    }

    private fun views(context: Context, state: WidgetState, cover: Bitmap?, compact: Boolean): RemoteViews {
        val views = RemoteViews(context.packageName, if (compact) R.layout.murmur_widget_compact else R.layout.murmur_widget_regular)
        if (cover != null) views.setImageViewBitmap(R.id.murmur_widget_cover, cover)
        else views.setImageViewResource(R.id.murmur_widget_cover, R.drawable.murmur_widget_cover_placeholder)
        if (!state.loaded) {
            views.setTextViewText(R.id.murmur_widget_title, context.getString(R.string.app_name))
            views.setTextViewText(R.id.murmur_widget_artist, context.getString(R.string.murmur_widget_empty_subtitle))
            views.setViewVisibility(R.id.murmur_widget_controls, View.GONE)
            if (!compact) views.setViewVisibility(R.id.murmur_widget_brand, View.GONE)
            views.setContentDescription(R.id.murmur_widget_cover, context.getString(R.string.murmur_widget_open))
            views.setOnClickPendingIntent(android.R.id.background, activity(context, player = false))
            return views
        }
        val title = state.title ?: context.getString(R.string.murmur_widget_untitled)
        views.setTextViewText(R.id.murmur_widget_title, title)
        views.setTextViewText(R.id.murmur_widget_artist, state.artist ?: context.getString(R.string.app_name))
        views.setViewVisibility(R.id.murmur_widget_controls, View.VISIBLE)
        if (!compact) views.setViewVisibility(R.id.murmur_widget_brand, View.VISIBLE)
        val play = WidgetModel.playButton(state.playing)
        views.setImageViewResource(R.id.murmur_widget_play, play.icon)
        views.setContentDescription(R.id.murmur_widget_play, context.getString(play.description))
        views.setContentDescription(R.id.murmur_widget_cover, context.getString(R.string.murmur_widget_open_player))
        views.setOnClickPendingIntent(R.id.murmur_widget_previous, broadcast(context, ACTION_PREVIOUS, 4111))
        views.setOnClickPendingIntent(R.id.murmur_widget_play, broadcast(context, ACTION_TOGGLE, 4112))
        views.setOnClickPendingIntent(R.id.murmur_widget_next, broadcast(context, ACTION_NEXT, 4113))
        // Talk to MURMUR without leaving the microphone on: one tap opens the voice capture.
        if (!compact) views.setOnClickPendingIntent(R.id.murmur_widget_voice, android.app.PendingIntent.getActivity(context, 4114,
            VoiceTriggerManager.intent(context, "widget").addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK),
            android.app.PendingIntent.FLAG_IMMUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT))
        views.setOnClickPendingIntent(android.R.id.background, activity(context, player = true))
        return views
    }

    /** The cached cover for this song, or null while it loads (the card then redraws once it arrives). */
    private fun cover(context: Context, state: WidgetState): Bitmap? {
        if (state.covers.isEmpty()) return null
        val key = state.covers.joinToString("|")
        if (key == coverKey) return coverBitmap
        if (key == loadingKey) return null
        loadingKey = key
        val app = context.applicationContext
        val urls = state.covers
        io.execute {
            if (loadingKey != key) return@execute
            val image = urls.firstNotNullOfOrNull { url -> runCatching { download(url) }.getOrNull() }
            main.post {
                if (loadingKey == key) loadingKey = null
                if (image != null) {
                    coverKey = key
                    coverBitmap = image
                    if (runCatching { current().covers == urls }.getOrDefault(false)) refresh(app)
                }
            }
        }
        return null
    }

    private fun download(url: String): Bitmap? {
        val bytes = http.newCall(okhttp3.Request.Builder().url(url).build()).execute().use { response ->
            if (!response.isSuccessful) return null
            val body = response.body ?: return null
            if (body.contentLength() > MAX_COVER_BYTES) return null
            val output = ByteArrayOutputStream()
            val buffer = ByteArray(8192)
            body.byteStream().use { input ->
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    if (output.size() + count > MAX_COVER_BYTES) return null
                    output.write(buffer, 0, count)
                }
            }
            output.toByteArray()
        }
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
        val options = BitmapFactory.Options().apply {
            inSampleSize = WidgetModel.sampleSize(bounds.outWidth, bounds.outHeight, WidgetModel.COVER_MAX_PX)
        }
        val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options) ?: return null
        return rounded(decoded, WidgetModel.isVideoThumbnail(url))
    }

    /** Square, at most [WidgetModel.COVER_MAX_PX] per side, with corners concentric to the card's. */
    private fun rounded(source: Bitmap, videoThumbnail: Boolean): Bitmap? {
        val crop = WidgetModel.coverCrop(source.width, source.height, videoThumbnail)
        if (crop.side <= 0) return null
        val size = minOf(crop.side, WidgetModel.COVER_MAX_PX)
        val scale = size.toFloat() / crop.side
        val shader = BitmapShader(source, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP).apply {
            setLocalMatrix(Matrix().apply {
                setTranslate(-crop.left.toFloat(), -crop.top.toFloat())
                postScale(scale, scale)
            })
        }
        val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG).apply { this.shader = shader }
        val output = createBitmap(size, size)
        val radius = size * COVER_RADIUS
        Canvas(output).drawRoundRect(RectF(0f, 0f, size.toFloat(), size.toFloat()), radius, radius, paint)
        source.recycle()
        return output
    }
}
