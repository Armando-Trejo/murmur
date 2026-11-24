package com.personal.murmur

import android.os.Looper
import androidx.media3.common.Player
import com.personal.murmur.spotify.*
import kotlinx.coroutines.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.Before
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
@Config(manifest=Config.NONE,sdk=[28])
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class SpotifyIntegratedPlayerTest {
    @Before fun grantReceiverPermissionFromMergedAndroidManifest(){
        val app:android.app.Application=RuntimeEnvironment.getApplication()
        shadowOf(app).grantPermissions(app.packageName+".DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION")
    }
    private class Backend:SpotifyEngineBackend {
        val calls=java.util.Collections.synchronizedList(mutableListOf<String>())
        var listener:SpotifyEngineEvents?=null
        var gate:CountDownLatch?=null
        var fail=false
        var failPlay=false
        override fun start(context:android.content.Context,token:String,deviceId:String,credentials:String,cache:String,output:SpotifyPcmOutput,events:SpotifyEngineEvents){calls.add("start");listener=events;gate?.await(3,TimeUnit.SECONDS);if(fail)error("Synthetic native refusal")}
        override fun load(uri:String){calls.add("load:$uri");listener!!.onEvent("playing",uri,0)}
        override fun play(){calls.add("play");if(failPlay)error("Synthetic resume failure")}
        override fun pause(){calls.add("pause")}
        override fun seek(position:Long){calls.add("seek:$position")}
        override fun shutdown(){calls.add("shutdown")}
    }
    private val uri="spotify:track:"+"A".repeat(22)
    private fun data()=JSONObject().put("id","sp:one").put("spotifyUri",uri).put("source","spotify").put("title","Afuera").put("artist","Caifanes").put("duration",230)
    private fun await(done:()->Boolean){val deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(5);while(!done()&&System.nanoTime()<deadline){shadowOf(Looper.getMainLooper()).idle();Thread.sleep(5)};shadowOf(Looper.getMainLooper()).idle();assertTrue("Native adapter operation did not settle",done())}
    @Test fun nativeCallbacksDriveMediaSessionStateWithoutAnExternalApp() {
        val backend=Backend();var ended=0
        val player=SpotifyIntegratedPlayer(RuntimeEnvironment.getApplication(),{ended++},backend){"test-token"}
        val scope=CoroutineScope(SupervisorJob()+Dispatchers.Main);var failure:Throwable?=null
        try {
            val job=scope.launch{try{player.load(data())}catch(error:Throwable){failure=error}}
            await{job.isCompleted};assertNull(failure);assertTrue(player.playing);assertEquals("Afuera",player.mediaMetadata.title.toString())
            assertEquals(listOf("start","load:$uri"),backend.calls.toList());assertEquals(Player.STATE_READY,player.playbackState)
            backend.listener!!.onEvent("position",uri,12345);shadowOf(Looper.getMainLooper()).idle();assertEquals(12345L,player.positionMs)
            player.pauseIntegrated();await{backend.calls.contains("pause")};assertFalse(player.playing)
            backend.listener!!.onEvent("playing",uri,100);shadowOf(Looper.getMainLooper()).idle();assertFalse("A late callback must not undo pause",player.playing)
            assertTrue(player.resumeIntegrated());await{backend.calls.contains("play")};player.seekIntegrated(9000);await{backend.calls.contains("seek:9000")}
            backend.listener!!.onEvent("end_of_track",uri,0);shadowOf(Looper.getMainLooper()).idle();assertEquals(1,ended)
        }finally{val stop=player.shutdown();await{stop.isCompleted};scope.cancel()}
    }
    @Test fun deactivationDuringHandshakeNeverLoadsOrPlaysTheOldTrack() {
        val backend=Backend().apply{gate=CountDownLatch(1)};val player=SpotifyIntegratedPlayer(RuntimeEnvironment.getApplication(),{},backend){"test-token"}
        val scope=CoroutineScope(SupervisorJob()+Dispatchers.Main)
        try {
            val job=scope.launch{runCatching{player.load(data())}}
            await{backend.calls.contains("start")};player.deactivate();backend.gate!!.countDown();await{job.isCompleted}
            assertFalse(backend.calls.any{it.startsWith("load:")});assertFalse(player.playing)
        }finally{backend.gate!!.countDown();val stop=player.shutdown();await{stop.isCompleted};scope.cancel()}
    }
    @Test fun nativeFailureDoesNotInventPlaybackOrFallbackToAnotherTransport() {
        val backend=Backend().apply{fail=true};val player=SpotifyIntegratedPlayer(RuntimeEnvironment.getApplication(),{},backend){"test-token"}
        val scope=CoroutineScope(SupervisorJob()+Dispatchers.Main);var failure:Throwable?=null
        try {val job=scope.launch{try{player.load(data())}catch(error:Throwable){failure=error}};await{job.isCompleted}
            assertTrue(failure is ProviderFailure);assertFalse(player.playing);assertFalse(player.loading);assertNotNull(player.playerError)
            assertEquals(listOf("start"),backend.calls.toList())
        }finally{val stop=player.shutdown();await{stop.isCompleted};scope.cancel()}
    }
    @Test fun headphoneDisconnectPausesAndReceiverIsRemovedOnShutdown() {
        val context=RuntimeEnvironment.getApplication();val backend=Backend();val player=SpotifyIntegratedPlayer(context,{},backend){"test-token"}
        val scope=CoroutineScope(SupervisorJob()+Dispatchers.Main)
        try {
            val job=scope.launch{player.load(data())};await{job.isCompleted};assertTrue(player.playing)
            context.sendBroadcast(android.content.Intent(android.media.AudioManager.ACTION_AUDIO_BECOMING_NOISY));await{backend.calls.contains("pause")}
            assertFalse(player.playing);assertFalse(player.loading)
            val stop=player.shutdown();await{stop.isCompleted};val before=backend.calls.size
            context.sendBroadcast(android.content.Intent(android.media.AudioManager.ACTION_AUDIO_BECOMING_NOISY));shadowOf(Looper.getMainLooper()).idle()
            assertEquals(before,backend.calls.size)
        }finally{val stop=player.shutdown();await{stop.isCompleted};scope.cancel()}
    }
    @Test fun resumeFailureEndsBufferingAndPublishesMediaSessionError() {
        val backend=Backend();val player=SpotifyIntegratedPlayer(RuntimeEnvironment.getApplication(),{},backend){"test-token"}
        val scope=CoroutineScope(SupervisorJob()+Dispatchers.Main)
        try {
            val job=scope.launch{player.load(data())};await{job.isCompleted};player.pauseIntegrated();backend.failPlay=true
            assertTrue(player.resumeIntegrated());await{player.playerError!=null}
            assertFalse(player.loading);assertFalse(player.playing);assertEquals(Player.STATE_IDLE,player.playbackState);assertFalse(player.resumeIntegrated())
        }finally{val stop=player.shutdown();await{stop.isCompleted};scope.cancel()}
    }
    @Test fun webPlaybackFailureProducesAnActionableIdleStateInsteadOfAFalsePlayingState() {
        val backend=Backend();val player=SpotifyIntegratedPlayer(RuntimeEnvironment.getApplication(),{},backend,manageFocus=false,deviceLabel="MURMUR · Web"){"synthetic-web-token"}
        val scope=CoroutineScope(SupervisorJob()+Dispatchers.Main)
        try {
            val job=scope.launch{player.load(data())};await{job.isCompleted};assertTrue(player.playing)
            assertEquals("MURMUR · Web",player.webState().getJSONObject("device").getString("name"))
            backend.listener!!.onEvent("web_error:eme_unavailable",uri,0);await{player.playerError!=null}
            assertFalse(player.playing);assertFalse(player.loading);assertTrue(player.playerError!!.message!!.contains("WebView"));assertEquals(Player.STATE_IDLE,player.playbackState)
        }finally{val stop=player.shutdown();await{stop.isCompleted};scope.cancel()}
    }
}
