package com.personal.murmur

import org.schabi.newpipe.extractor.MediaFormat
import org.schabi.newpipe.extractor.stream.AudioStream
import org.schabi.newpipe.extractor.stream.DeliveryMethod

object AudioStreamSelector {
    fun rank(streams: List<AudioStream>): List<AudioStream> = streams
        .filter { it.isUrl && it.content.startsWith("https://") && (it.deliveryMethod in setOf(DeliveryMethod.PROGRESSIVE_HTTP, DeliveryMethod.HLS) || it.deliveryMethod == DeliveryMethod.DASH && (it.manifestUrl?.startsWith("https://") == true || it.content.substringBefore('?').endsWith(".mpd"))) }
        .sortedWith(compareBy<AudioStream> { if (it.deliveryMethod == DeliveryMethod.PROGRESSIVE_HTTP) 0 else 1 }
            .thenBy { if (it.format == MediaFormat.M4A || it.codec?.startsWith("mp4a") == true) 0 else 1 }
            .thenByDescending { it.averageBitrate })
        .distinctBy { it.content }
}

data class PlaybackSource(val uri: String, val mime: String? = null) {
    companion object {
        fun from(stream: AudioStream) = PlaybackSource(if (stream.deliveryMethod == DeliveryMethod.DASH) stream.manifestUrl?.takeIf { it.startsWith("https://") } ?: stream.content else stream.content, when (stream.deliveryMethod) {
            DeliveryMethod.HLS -> "application/x-mpegURL"
            DeliveryMethod.DASH -> "application/dash+xml"
            else -> stream.format?.mimeType
        })
    }
}
