package com.personal.murmur

import androidx.media3.common.MediaMetadata
import org.json.JSONObject

/**
 * The cover the notification and the lock screen show: the owner's own image (an album's cover
 * reaches all its songs) first, else the provider's in high resolution.
 */
fun MediaMetadata.Builder.setCover(data: JSONObject): MediaMetadata.Builder {
    val custom = data.optString("customArtwork").takeIf { it.startsWith("data:image/") && it.length < 1_500_000 }
        ?.let { runCatching { android.util.Base64.decode(it.substringAfter(','), android.util.Base64.DEFAULT) }.getOrNull() }
    if (custom != null) return setArtworkData(custom, MediaMetadata.PICTURE_TYPE_FRONT_COVER)
    return setArtworkUri(data.optString("artworkUrl").takeIf { it.startsWith("https://") }
        ?.let { android.net.Uri.parse(YouTubeArtwork.hd(it, 1080)) })
}
