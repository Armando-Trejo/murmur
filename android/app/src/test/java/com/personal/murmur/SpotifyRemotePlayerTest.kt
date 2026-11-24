package com.personal.murmur

import android.app.Activity
import android.os.Looper
import com.spotify.android.appremote.api.Connector
import com.spotify.android.appremote.api.SpotifyAppRemote
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.Mockito.*
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(manifest=Config.NONE,sdk=[28])
class SpotifyRemotePlayerTest {
    @Test fun logoutCancelsPendingPlaybackAndReleasesLateSdkConnection() {
        var callback:Connector.ConnectionListener?=null
        var released:SpotifyAppRemote?=null
        val lateRemote=mock(SpotifyAppRemote::class.java)
        val subject=SpotifyRemotePlayer(Activity(),installed={true},connector={_,_,listener->callback=listener},release={released=it})
        val scope=CoroutineScope(SupervisorJob()+Dispatchers.Main)
        var failure:Throwable?=null
        try {
            val job=scope.launch {try{subject.play("e".repeat(32),"spotify:track:"+"A".repeat(22))}catch(error:Throwable){failure=error}}
            shadowOf(Looper.getMainLooper()).idle();assertNotNull(callback)
            subject.disconnect();shadowOf(Looper.getMainLooper()).idle()
            assertTrue(job.isCompleted);assertTrue(failure is CancellationException)
            callback!!.onConnected(lateRemote)
            assertSame(lateRemote,released)
            verifyNoInteractions(lateRemote)
        } finally {scope.cancel()}
    }
}
