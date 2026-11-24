package com.personal.murmur

import android.os.Looper
import androidx.media3.common.Player
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

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[28])
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class HybridPlayerRuntimeTest {
    @Test fun productionPlayerConsumesPcmThroughItsRealAudioSink() {
        val controller=Robolectric.buildService(HybridMediaService::class.java).create()
        val service=controller.get()
        val pcmBytes = 6 * 88_200
        val bytes=ByteBuffer.allocate(44+pcmBytes).order(ByteOrder.LITTLE_ENDIAN).apply {
            put("RIFF".toByteArray());putInt(capacity()-8);put("WAVEfmt ".toByteArray());putInt(16);putShort(1);putShort(1);putInt(44100);putInt(88200);putShort(2);putShort(16);put("data".toByteArray());putInt(pcmBytes)
            while(remaining()>=2) putShort(if (position() % 4 == 0) 8192 else -8192)
        }.array()
        val directory=java.io.File(service.filesDir,"offline_tracks").apply{mkdirs()}
        val file=java.io.File(directory,"runtime-test.wav").apply{writeBytes(bytes)}
        var media:androidx.media3.session.MediaController?=null
        fun await(condition:()->Boolean){val deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(5);while(!condition()&&System.nanoTime()<deadline){shadowOf(Looper.getMainLooper()).idle();Thread.sleep(10)};assertTrue("Media session did not settle",condition())}
        try {
            service.play(file.toURI().toString(),JSONObject().put("id","test:pcm").put("source","youtube").put("offlinePath",file.absolutePath).put("title","Synthetic PCM"))
            val field = HybridMediaService::class.java.getDeclaredField("meters").apply { isAccessible = true }
            val meter = checkNotNull((field.get(service) as Map<*, *>)[service.primaryPlayer])
            val amplitude = meter.javaClass.getDeclaredField("amplitude").apply { isAccessible = true }
            await { service.primaryPlayer.playerError != null || amplitude.getFloat(meter) > .1f }
            assertNull(service.primaryPlayer.playerError)
            assertEquals("The active renderer must feed its own PCM amplitude to the visualizer",
                .25f, amplitude.getFloat(meter), .02f)
            val notifications=shadowOf(service.getSystemService(android.app.NotificationManager::class.java))
            await{notifications.getNotification(1001)?.extras?.getString(android.app.Notification.EXTRA_TITLE)=="Synthetic PCM"}
            assertNotNull(notifications.getNotification(1001).extras.getParcelable<android.os.Parcelable>("android.mediaSession"))
            val pendingTicket=PlaybackRequests.next()
            service.onTaskRemoved(null)
            assertFalse("Leaving the task cancels pending provider work",PlaybackRequests.isCurrent(pendingTicket))
            assertFalse("Removing MURMUR from recents must pause",service.primaryPlayer.playWhenReady)
            service.primaryPlayer.play()

            val connection=androidx.media3.session.MediaController.Builder(service,service.sessions.single().token).buildAsync();await{connection.isDone};media=connection.get()
            service.setUpcoming(listOf(JSONObject().put("id","test:next").put("queueId","next-entry").put("source","youtube").put("offlinePath",file.absolutePath).put("title","Next PCM")),emptyList())
            await{media!!.availableCommands.contains(Player.COMMAND_SEEK_TO_NEXT)}
            media!!.seekToNext();await{service.track?.optString("id")=="test:next"}
            media!!.seekToPrevious();await{service.track?.optString("id")=="test:pcm"}
            await{notifications.getNotification(1001)?.actions?.size==3}
            val actions=notifications.getNotification(1001).actions
            assertEquals(listOf("Seek to previous item","Pause","Seek to next item"),actions.map{it.title.toString()})

        } finally {media?.release();controller.destroy();file.delete()}
    }
}

