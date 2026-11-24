package com.personal.murmur

import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[28])
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class MediaSessionRegistrationTest {
    @Test fun sessionIsRegisteredForNotificationsWithoutAnExternalControllerBinding(){
        val controller=Robolectric.buildService(HybridMediaService::class.java).create()
        try{val service=controller.get();assertEquals(1,service.sessions.size);val session=service.sessions.single();assertNotNull(session.sessionActivity);val intent=shadowOf(session.sessionActivity!!).savedIntent;assertTrue(intent.getBooleanExtra("open_player",false));assertTrue(session.customLayout.isEmpty())}finally{controller.destroy()}
    }
}
