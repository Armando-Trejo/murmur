package com.personal.murmur.spotify

import android.content.Context
import androidx.annotation.Keep
import org.json.JSONArray

@Keep
interface SpotifyEngineEvents { fun onEvent(type:String,uri:String,eventPosition:Long) }

interface SpotifyEngineBackend {
    fun start(context:Context,token:String,deviceId:String,credentials:String,cache:String,output:SpotifyPcmOutput,events:SpotifyEngineEvents)
    fun load(uri:String)
    fun play()
    fun pause()
    fun seek(position:Long)
    fun shutdown()
    fun volume(gain:Float) {}
}

object JniSpotifyEngineBackend:SpotifyEngineBackend {
    override fun start(context:Context,token:String,deviceId:String,credentials:String,cache:String,output:SpotifyPcmOutput,events:SpotifyEngineEvents) {
        SpotifyNative.nativeInitContext(context.applicationContext);SpotifyNative.nativeSetAudioOutput(output)
        try {SpotifyNative.nativeStart(SpotifyEngineAuthorization.CLIENT_ID,"MURMUR",deviceId,token,credentials,cache,"es",320,0,events)}
        catch(failure:Throwable){runCatching{SpotifyNative.nativeShutdown()};throw failure}
    }
    override fun load(uri:String)=SpotifyNative.nativeLoadQueue(JSONArray().put(uri).toString(),0,true,0,"",false)
    override fun play()=SpotifyNative.nativePlay()
    override fun pause()=SpotifyNative.nativePause()
    override fun seek(position:Long)=SpotifyNative.nativeSeek(position)
    override fun shutdown()=SpotifyNative.nativeShutdown()
}
