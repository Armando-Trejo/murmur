package com.personal.murmur

import android.os.Looper
import androidx.media3.exoplayer.ExoPlayer
import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.lang.reflect.Proxy
import java.util.concurrent.CompletableFuture
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
@Config(manifest=Config.NONE,sdk=[28])
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class AudioBridgeThreadTest {
    @Test fun seekAndRestartDuringRecoveryKeepThePendingSourceWithTheLatestPosition() {
        val service = HybridMediaService()
        val request = PlaybackRequests.next()
        val position = HybridMediaService::class.java.getDeclaredField("recoveryPositionMs").apply { isAccessible = true }
        position.set(service, 16_000L)

        service.seekYouTube(72_000)
        assertEquals(72_000L, service.youtubePositionMs)
        assertTrue(service.youtubeLoading)
        service.previousNative()
        assertEquals(0L, service.youtubePositionMs)
        assertTrue(service.youtubeLoading)
        assertTrue(PlaybackRequests.isCurrent(request))
    }

    @Test fun workerThreadBridgeCallReadsPlayerStateOnTheApplicationLooper() {
        val instance=HybridMediaService::class.java.getDeclaredField("instance").apply{isAccessible=true};val previous=instance.get(null)
        val result=CompletableFuture<JSObject>();val worker=Executors.newSingleThreadExecutor()
        try {
            val service=HybridMediaService()
            service.primaryPlayer=Proxy.newProxyInstance(ExoPlayer::class.java.classLoader,arrayOf(ExoPlayer::class.java)){_,method,_->
                check(Looper.myLooper()==Looper.getMainLooper()){ "Player accessed on wrong thread" }
                when(method.name){"isPlaying"->true;"getCurrentPosition"->1234L;"getDuration"->10000L;"getPlaybackState"->androidx.media3.common.Player.STATE_READY;else->null}
            } as ExoPlayer
            instance.set(null,service)
            val call=object:PluginCall(null,"YouTubeAudio","test","getState",JSObject()){
                override fun resolve(data:JSObject){result.complete(data)}
                override fun reject(message:String,exception:Exception?){result.completeExceptionally(IllegalStateException(message,exception))}
            }
            val plugin=YouTubeAudioPlugin()
            worker.submit{plugin.getState(call)}.get(5,TimeUnit.SECONDS)
            shadowOf(Looper.getMainLooper()).idle()
            val state=result.get(5,TimeUnit.SECONDS)
            assertTrue(state.getBoolean("playing"));assertEquals(1234L,state.getLong("positionMs"))
        } finally {instance.set(null,previous);worker.shutdownNow()}
    }
}
