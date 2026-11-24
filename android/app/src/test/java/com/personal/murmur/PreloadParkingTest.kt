package com.personal.murmur

import android.os.Looper
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.TimeUnit

/**
 * Regression for "the next song starts a minute in / a short cut between songs": after the first
 * promotion the standby player is the former primary, whose playWhenReady used to stay true, so
 * every later preload played silently in the background.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class PreloadParkingTest {
    private fun wav(seconds: Int): ByteArray {
        val pcm = seconds * 88_200
        return ByteBuffer.allocate(44 + pcm).order(ByteOrder.LITTLE_ENDIAN).apply {
            put("RIFF".toByteArray()); putInt(capacity() - 8); put("WAVEfmt ".toByteArray()); putInt(16); putShort(1); putShort(1)
            putInt(44100); putInt(88200); putShort(2); putShort(16); put("data".toByteArray()); putInt(pcm)
            while (remaining() >= 2) putShort(if (position() % 4 == 0) 6000 else -6000)
        }.array()
    }

    private fun await(condition: () -> Boolean) {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
        while (!condition() && System.nanoTime() < deadline) { shadowOf(Looper.getMainLooper()).idle(); Thread.sleep(10) }
        assertTrue("Player did not settle", condition())
    }

    @Test fun preloadsAfterAPromotionStayParkedAtTheStart() {
        val controller = Robolectric.buildService(HybridMediaService::class.java).create()
        val service = controller.get()
        val directory = java.io.File(service.filesDir, "offline_tracks").apply { mkdirs() }
        val files = listOf("a", "b", "c").map { java.io.File(directory, "park-$it.wav").apply { writeBytes(wav(8)) } }
        fun entry(name: String, file: java.io.File) = JSONObject().put("id", "test:$name").put("queueId", "q-$name")
            .put("source", "youtube").put("offlinePath", file.absolutePath).put("title", name)
        val standby = HybridMediaService::class.java.getDeclaredField("secondaryPlayer").apply { isAccessible = true }
        try {
            val (a, b, c) = files.mapIndexed { index, file -> entry("abc"[index].toString(), file) }
            service.play(files[0].toURI().toString(), a)
            service.setUpcoming(listOf(b, c), emptyList())
            service.preloadSource(PlaybackSource(files[1].absolutePath), b)
            // Robolectric's audio sink never reports a parked player READY; a prepared (buffering) one is enough.
            await { (standby.get(service) as ExoPlayer).playbackState != Player.STATE_IDLE }
            assertTrue(service.playPrepared(b, announce = true))
            assertEquals("q-b", service.track?.optString("queueId"))

            // The former primary is now the standby; the next preload must not start on its own.
            service.preloadSource(PlaybackSource(files[2].absolutePath), c)
            val parked = standby.get(service) as ExoPlayer
            await { parked.playbackState != Player.STATE_IDLE }
            repeat(40) { shadowOf(Looper.getMainLooper()).idle(); Thread.sleep(10) }
            assertFalse("A parked preload must not play", parked.playWhenReady)
            assertTrue("A parked preload stays at its start", parked.currentPosition <= HybridMediaService.PRELOAD_START_TOLERANCE_MS)
            assertTrue(service.playPrepared(c, announce = true))
            assertEquals("q-c", service.track?.optString("queueId"))
        } finally {
            controller.destroy(); files.forEach { it.delete() }
        }
    }
}
