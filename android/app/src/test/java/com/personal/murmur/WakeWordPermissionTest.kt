package com.personal.murmur

import org.robolectric.RuntimeEnvironment
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf

/**
 * After reinstalling (or revoking the microphone), "Ok MURMUR" may still be switched on in the
 * settings. Starting a microphone service then crashes the app on every launch: it must stay off.
 */
@RunWith(RobolectricTestRunner::class)
class WakeWordPermissionTest {
    @Test fun withoutMicrophonePermissionItDoesNotStart() {
        val app: android.app.Application = RuntimeEnvironment.getApplication()
        shadowOf(app).denyPermissions(android.Manifest.permission.RECORD_AUDIO)
        WakeWordService.setEnabled(app, true)
        assertFalse(WakeWordService.canListen(app))
        assertFalse(WakeWordService.start(app))
        assertNull(shadowOf(app).nextStartedService)
    }
}
