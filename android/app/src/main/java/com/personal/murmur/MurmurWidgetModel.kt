package com.personal.murmur

import androidx.annotation.DrawableRes
import androidx.annotation.StringRes
import kotlin.math.abs

/**
 * What the home-screen widget shows, reduced to plain values. [key] changes only when something
 * visible changes, so the playback service can ask on every tick and the launcher is redrawn only
 * on a real change (a new song, play/pause), never once per tick.
 */
data class WidgetState(
    val loaded: Boolean,
    val title: String?,
    val artist: String?,
    /** Cover URLs to try in order; empty when the song has none. */
    val covers: List<String>,
    val playing: Boolean,
) {
    val key: String get() = if (!loaded) "empty" else listOf(title, artist, covers.firstOrNull(), playing).joinToString("\u0001")

    companion object {
        val EMPTY = WidgetState(false, null, null, emptyList(), false)
    }
}

data class WidgetButton(@DrawableRes val icon: Int, @StringRes val description: Int)

/** Square region cut from a decoded cover before it is rounded. */
data class CoverCrop(val left: Int, val top: Int, val side: Int)

/** Pure decisions behind the widget (no Android types), covered by JVM tests. */
object WidgetModel {
    /** Covers are cut square and kept at most this many pixels per side (RemoteViews parcel size). */
    const val COVER_MAX_PX = 300
    /** Below this height (dp) only the one-row layout fits: cover, text and buttons side by side. */
    const val COMPACT_BELOW_DP = 116
    private const val TEXT_LIMIT = 120
    private val videoIdPattern = Regex("[A-Za-z0-9_-]{11}")
    private val spaces = Regex("\\s+")

    fun state(loaded: Boolean, title: String?, artist: String?, artworkUrl: String?, videoId: String?, playing: Boolean): WidgetState =
        if (!loaded) WidgetState.EMPTY
        else WidgetState(true, text(title), text(artist), covers(artworkUrl, videoId), playing)

    /** One trimmed line, or null when there is nothing worth showing (JSON nulls read as "null"). */
    fun text(raw: String?): String? {
        val value = raw?.replace(spaces, " ")?.trim().orEmpty()
        return if (value.isEmpty() || value.equals("null", ignoreCase = true)) null else value.take(TEXT_LIMIT)
    }

    /**
     * Where to fetch the cover from. YouTube video thumbnails are 4:3 with bars, so for videos the
     * 640 px and 480 px frames are tried first; album art is requested at the widget's size.
     */
    fun covers(artworkUrl: String?, videoId: String?): List<String> {
        val url = artworkUrl?.trim()?.takeIf { it.startsWith("https://") }
        val video = videoId?.trim()?.takeIf { videoIdPattern.matches(it) }
        val fromVideo = url == null || isVideoThumbnail(url)
        return buildList {
            if (video != null && fromVideo) {
                add("https://i.ytimg.com/vi/$video/sddefault.jpg")
                add("https://i.ytimg.com/vi/$video/hqdefault.jpg")
            }
            if (url != null) add(YouTubeArtwork.hd(url, COVER_MAX_PX))
        }.distinct()
    }

    fun isVideoThumbnail(url: String): Boolean {
        val host = url.substringAfter("://").substringBefore('/').substringBefore(':').lowercase()
        return host == "img.youtube.com" || host == "ytimg.com" || host.endsWith(".ytimg.com")
    }

    fun playButton(playing: Boolean): WidgetButton =
        if (playing) WidgetButton(R.drawable.murmur_widget_pause, R.string.murmur_widget_pause)
        else WidgetButton(R.drawable.murmur_widget_play, R.string.murmur_widget_play)

    /** Launchers before Android 12 only report sizes; 0 means unknown and keeps the full layout. */
    fun compact(minHeightDp: Int): Boolean = minHeightDp in 1 until COMPACT_BELOW_DP

    /** Power-of-two decode step that keeps the shorter side at least [target] pixels. */
    fun sampleSize(width: Int, height: Int, target: Int): Int {
        val shorter = minOf(width, height)
        if (shorter <= 0 || target <= 0) return 1
        var sample = 1
        while (shorter / (sample * 2) >= target) sample *= 2
        return sample
    }

    /** The centred square to keep; 4:3 video thumbnails first lose the bars around their 16:9 frame. */
    fun coverCrop(width: Int, height: Int, videoThumbnail: Boolean): CoverCrop {
        var top = 0
        var content = height
        if (videoThumbnail && width > 0 && abs(width * 3 - height * 4) <= width / 50) {
            content = width * 9 / 16
            top = (height - content) / 2
        }
        val side = minOf(width, content).coerceAtLeast(0)
        return CoverCrop((width - side) / 2, top + (content - side) / 2, side)
    }
}
