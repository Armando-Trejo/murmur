package com.personal.murmur

import android.os.Looper
import com.personal.murmur.spotify.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.Mockito.*
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(manifest=Config.NONE,sdk=[28])
class SpotifyWebBackendTest {
    private val uri="spotify:track:"+"A".repeat(22)
    private fun pump()=shadowOf(Looper.getMainLooper()).idle()
    private fun scenario(body:(SpotifyWebBackend,WebSdkEngine,MutableStateFlow<WebSdkState>)->Unit) {
        val context:android.app.Application=RuntimeEnvironment.getApplication()
        val state=MutableStateFlow(WebSdkState(stage="loading"));val runtime=mock(WebSdkEngine::class.java)
        `when`(runtime.state).thenReturn(state.asStateFlow())
        val backend=SpotifyWebBackend(context,{"synthetic"},{_,_->runtime})
        val events=object:SpotifyEngineEvents {override fun onEvent(type:String,uri:String,eventPosition:Long){}}
        try {backend.start(context,"synthetic","device","","",SpotifyPcmOutput(),events);backend.load(uri);pump();body(backend,runtime,state)}finally{backend.shutdown();pump()}
    }
    @Test fun pausedInitializationDoesNotPlayAtReadyButResumeSchedulesTheMissingUri()=scenario {backend,runtime,state->
        backend.pause();pump();state.value=WebSdkState(stage="ready",deviceId="fixture");pump()
        verify(runtime,never()).play(uri,emptyList(),0)
        backend.play();pump();verify(runtime).play(uri,emptyList(),0);verify(runtime,never()).resume()
    }
    @Test fun resumeBeforeReadyRetainsTheRequestedTrack()=scenario {backend,runtime,state->
        backend.pause();backend.play();pump();verify(runtime,never()).play(uri,emptyList(),0)
        state.value=WebSdkState(stage="ready",deviceId="fixture");pump();verify(runtime).play(uri,emptyList(),0)
    }
    @Test fun pausedInitialPutIsRetriedButAConfirmedPausedTrackResumesWithoutRestart()=scenario {backend,runtime,state->
        state.value=WebSdkState(stage="ready",deviceId="fixture");pump();verify(runtime).play(uri,emptyList(),0)
        state.value=state.value.copy(busy=true);pump();backend.pause();pump();verify(runtime).cancelPendingPlay()
        backend.play();pump();verify(runtime,times(2)).play(uri,emptyList(),0)
        state.value=state.value.copy(busy=false,uri=uri,paused=true,position=1234);pump()
        backend.pause();backend.play();pump();verify(runtime).resume();verify(runtime,times(2)).play(uri,emptyList(),0)
    }
}
