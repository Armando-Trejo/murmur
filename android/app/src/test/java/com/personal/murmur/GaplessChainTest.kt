package com.personal.murmur

import android.os.Looper
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
 * Songs meant to run together (Auto-Mix off, or one album) are appended to the playing player's own
 * playlist, so the next one starts on the same AudioTrack instead of a freshly opened second player.
 * Robolectric's audio sink never reaches READY, so the natural end is covered on the phone; here the
 * chain and the move into it are driven directly.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class GaplessChainTest {
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
        assertTrue("Condition not reached", condition())
    }

    private fun entry(name: String, file: java.io.File) = JSONObject().put("id", "test:$name")
        .put("queueId", "q-$name").put("source", "youtube").put("offlinePath", file.absolutePath)
        .put("title", name).put("artist", "Artista")

    @Test fun albumNeighboursAndMixOffAreGapless() {
        val controller = Robolectric.buildService(HybridMediaService::class.java).create()
        val service = controller.get()
        try {
            val a = JSONObject().put("album", "Disco").put("artist", "Artista")
            assertTrue("Same album runs together even with Auto-Mix", service.wantsGapless(a, JSONObject().put("album", "disco ").put("artist", "artista")))
            assertFalse("Different albums keep the crossfade", service.wantsGapless(a, JSONObject().put("album", "Otro").put("artist", "Artista")))
            assertTrue("Same album id", service.wantsGapless(JSONObject().put("albumId", "MPREb_x"), JSONObject().put("albumId", "MPREb_x")))
            service.setMode("off")
            assertTrue("Auto-Mix off is always gapless", service.wantsGapless(a, JSONObject().put("album", "Otro")))
        } finally { controller.destroy() }
    }

    @Test fun chainedSongPlaysOnTheSamePlayer() {
        val controller = Robolectric.buildService(HybridMediaService::class.java).create()
        val service = controller.get()
        val directory = java.io.File(service.filesDir, "offline_tracks").apply { mkdirs() }
        val files = listOf("a", "b", "c").map { java.io.File(directory, "gap-$it.wav").apply { writeBytes(wav(3)) } }
        val chain = HybridMediaService::class.java.getDeclaredMethod("chainNext", PlaybackSource::class.java, JSONObject::class.java)
            .apply { isAccessible = true }
        try {
            val (a, b, c) = files.mapIndexed { index, file -> entry("abc"[index].toString(), file) }
            service.play(files[0].toURI().toString(), a)
            service.setUpcoming(listOf(b, c), emptyList())
            val player = service.primaryPlayer

            chain.invoke(service, PlaybackSource(files[1].absolutePath), b)
            assertEquals("B is queued inside the playing player", 2, player.mediaItemCount)
            assertTrue(service.playPrepared(b, announce = true))
            await { service.track?.optString("queueId") == "q-b" }
            assertSame("Moving into a chained song must not switch players", player, service.primaryPlayer)
            assertEquals("The finished song leaves the playlist", 1, player.mediaItemCount)

            // A queue change drops a chained song that is no longer next.
            chain.invoke(service, PlaybackSource(files[2].absolutePath), c)
            assertEquals(2, player.mediaItemCount)
            service.setUpcoming(listOf(a), emptyList())
            assertEquals("Stale chain is removed", 1, player.mediaItemCount)
            assertEquals("q-b", service.track?.optString("queueId"))
        } finally {
            controller.destroy(); files.forEach { it.delete() }
        }
    }
}
