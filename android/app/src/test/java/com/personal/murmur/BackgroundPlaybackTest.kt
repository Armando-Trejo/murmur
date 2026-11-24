package com.personal.murmur
import android.app.Activity
import android.os.Looper
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.time.Duration
@RunWith(RobolectricTestRunner::class)
@Config(sdk=[28])
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class BackgroundPlaybackTest {
 @Test fun backgroundKeepsPlayingAndTaskRemovalStopsService() {
  val controller=Robolectric.buildService(HybridMediaService::class.java).create()
  val activity=Robolectric.buildActivity(Activity::class.java).create().start().resume()
  try {
   val service=controller.get();service.primaryPlayer.play();val ticket=PlaybackRequests.next()
   activity.pause().stop();shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(500))
   assertTrue(service.primaryPlayer.playWhenReady);assertTrue(PlaybackRequests.isCurrent(ticket))
   service.onTaskRemoved(null);assertFalse(service.primaryPlayer.playWhenReady);assertFalse(PlaybackRequests.isCurrent(ticket));assertTrue(shadowOf(service).isStoppedBySelf)
  } finally {activity.destroy();controller.destroy()}
 }
}
