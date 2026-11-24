package com.personal.murmur
import android.view.HapticFeedbackConstants
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
@RunWith(RobolectricTestRunner::class)
@Config(sdk=[28])
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class SleepAndHapticsTest {
 @Test fun endOfTrackSleepIsArmedReplacedAndCancelled() {
  val controller=Robolectric.buildService(HybridMediaService::class.java).create()
  try {
   val service=controller.get()
   service.sleep(HybridMediaService.SLEEP_AT_TRACK_END);assertTrue(service.sleepAtTrackEnd)
   service.sleep(15);assertFalse("A timed sleep replaces the end-of-track option",service.sleepAtTrackEnd)
   service.sleep(HybridMediaService.SLEEP_AT_TRACK_END);service.sleep(0);assertFalse(service.sleepAtTrackEnd)
   assertEquals(1f,service.primaryPlayer.volume,0.001f)
  } finally {controller.destroy()}
 }
 @Test fun hapticsUseSystemFeedbackWithFallbacks() {
  assertEquals(HapticFeedbackConstants.CLOCK_TICK,HapticPatterns.constant("tick",28))
  assertEquals(HapticFeedbackConstants.VIRTUAL_KEY,HapticPatterns.constant("confirm",28))
  assertEquals(HapticFeedbackConstants.CONFIRM,HapticPatterns.constant("confirm",30))
  assertEquals(HapticFeedbackConstants.LONG_PRESS,HapticPatterns.constant("reject",29))
  assertEquals(HapticFeedbackConstants.REJECT,HapticPatterns.constant("reject",34))
  assertEquals(HapticFeedbackConstants.CLOCK_TICK,HapticPatterns.constant("desconocido",34))
 }
}
