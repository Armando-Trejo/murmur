package com.personal.murmur

import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class MediaCacheTest {
    private val signed = "https://rr3---sn-abc.googlevideo.com/videoplayback?expire=1999999999&itag=140&clen=3456789&sig=XYZ&c=ANDROID_MUSIC"

    @Test fun keyIgnoresTheChangingSignature() {
        val again = signed.replace("sig=XYZ", "sig=OTHER").replace("rr3---sn-abc", "rr5---sn-def")
        assertEquals("yt:dQw4w9WgXcQ:140:3456789", MediaCache.key(signed, "dQw4w9WgXcQ"))
        assertEquals(MediaCache.key(signed, "dQw4w9WgXcQ"), MediaCache.key(again, "dQw4w9WgXcQ"))
    }

    @Test fun onlyProgressiveYouTubeAudioIsCached() {
        assertNull(MediaCache.key("https://manifest.googlevideo.com/api/manifest/hls_playlist/id/1", "dQw4w9WgXcQ"))
        assertNull(MediaCache.key("file:///data/offline_tracks/a.m4a", "dQw4w9WgXcQ"))
        assertNull(MediaCache.key(signed.replace("&clen=3456789", ""), "dQw4w9WgXcQ"))
        assertNull(MediaCache.key(signed, "no es un id"))
    }

    @Test fun resolvedLinksAreReusedOnlyWithMargin() {
        val now = 1_700_000_000_000L
        fun audio(expireSeconds: Long) = YouTubeMusicResolver.Audio(200, "",
            listOf(PlaybackSource("https://x.googlevideo.com/videoplayback?expire=$expireSeconds&itag=140")))
        assertTrue(NativeNetwork.linkStillValid(audio(now / 1000 + 3 * 3600), now))
        assertFalse(NativeNetwork.linkStillValid(audio(now / 1000 + 5 * 60), now))
    }
}
