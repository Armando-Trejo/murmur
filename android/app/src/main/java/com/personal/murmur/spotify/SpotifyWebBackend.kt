package com.personal.murmur.spotify

import android.content.Context
import android.os.Handler
import android.os.Looper
import kotlinx.coroutines.*

/** Square WebSdkEngine adapted to MURMUR's Media3/queue adapter. Chromium owns audio focus. */
class SpotifyWebBackend(private val context:Context,private val tokenProvider:(Boolean)->String,private val engineFactory:((Context,(Boolean)->String)->WebSdkEngine)?=null):SpotifyEngineBackend {
    private val handler=Handler(Looper.getMainLooper())
    private var engine:WebSdkEngine?=null
    private var observer:Job?=null
    private val scope=CoroutineScope(SupervisorJob()+Dispatchers.Main)
    private var events:SpotifyEngineEvents?=null
    private var uri=""
    private var pending=false
    private var needsLoad=false
    private var wantPlay=false
    override fun start(context:Context,token:String,deviceId:String,credentials:String,cache:String,output:SpotifyPcmOutput,events:SpotifyEngineEvents){handler.post{
        this.events=events;engine?.release();observer?.cancel()
        val runtime=engineFactory?.invoke(this.context,tokenProvider) ?: WebSdkEngine(this.context,tokenProvider);engine=runtime
        observer=scope.launch {runtime.state.collect { state ->
            if(runtime!==engine)return@collect
            when {
                state.error!=null -> events.onEvent("web_error:${state.error}",uri,state.position)
                state.stage=="ready" && pending && wantPlay -> {pending=false;runtime.play(uri)}
                state.uri==uri && uri.isNotBlank() && !state.busy -> {
                    needsLoad=false
                    if(!wantPlay && !state.paused){runtime.command("pause");return@collect}
                    events.onEvent(if(state.ended)"end_of_track" else if(state.paused)"paused" else "playing",uri,state.position)
                }
            }
        }}
        runtime.connect()
    }}
    override fun load(uri:String){handler.post{this.uri=uri;pending=true;needsLoad=true;wantPlay=true;events?.onEvent("loading",uri,0);val runtime=engine;if(runtime?.state?.value?.stage=="ready"){pending=false;runtime.play(uri)}}}
    override fun play(){handler.post{
        wantPlay=true
        val runtime=engine ?: return@post
        val state=runtime.state.value
        if(state.stage!="ready"){pending=true;return@post}
        if(needsLoad || state.uri!=uri || state.busy){pending=false;needsLoad=true;runtime.play(uri)}else runtime.resume()
    }}
    override fun pause(){handler.post{wantPlay=false;pending=false;engine?.cancelPendingPlay();engine?.command("pause")}}
    override fun seek(position:Long){handler.post{engine?.seek(position)}}
    override fun volume(gain:Float){handler.post{engine?.command("volume",(gain.coerceIn(0f,1f)*1000).toLong())}}
    override fun shutdown(){handler.post{wantPlay=false;pending=false;needsLoad=false;observer?.cancel();observer=null;engine?.release();engine=null;events=null;uri=""}}
}
