package com.personal.murmur.spotify

import android.content.Context
import android.media.AudioManager
import android.media.AudioFocusRequest
import android.media.AudioAttributes
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.annotation.Keep
import androidx.media3.common.*
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import com.getcapacitor.JSObject
import com.personal.murmur.NativeEvents
import com.personal.murmur.ProviderFailure
import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicLong

private object SpotifyEngineWorker {
    val dispatcher=Executors.newSingleThreadExecutor { task -> Thread(task,"murmur-spotify-control").apply { isDaemon=true } }.asCoroutineDispatcher()
}

/** Native engine adapter, following Square's SimpleBasePlayer/PCM separation. */
@Keep
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class SpotifyIntegratedPlayer(private val context: Context, private val onNext: () -> Unit, private val backend:SpotifyEngineBackend=JniSpotifyEngineBackend, private val manageFocus:Boolean=true,private val deviceLabel:String="MURMUR · Integrado", private val onEnded:(()->Unit)?=null, private val onKeysRefused:(()->Boolean)?=null, private val tokenSupplier:(()->String)?=null) : SimpleBasePlayer(Looper.getMainLooper()),SpotifyEngineEvents {
    val visualAmplitude get()=if(playing)output.amplitude else 0f
    val visualTap get()=output.visualTap
    private val handler=Handler(Looper.getMainLooper())
    private val scope=CoroutineScope(SupervisorJob()+SpotifyEngineWorker.dispatcher)
    private val generation=AtomicLong(0)
    private val output=SpotifyPcmOutput { message -> handler.post {
        pauseIntegrated();error=PlaybackException(message,null,PlaybackException.ERROR_CODE_AUDIO_TRACK_INIT_FAILED)
        NativeEvents.emit("onSpotifyEngineError",JSObject().put("trackId",track?.optString("id")).put("queueId",track?.optString("queueId")).put("message",message));invalidate()
    } }
    private val auth by lazy { SpotifyEngineAuthorization(context) }
    private val audio=context.getSystemService(AudioManager::class.java)
    private var focusHeld=false
    private var resumeAfterFocus=false
    private var voiceDucked=false
    /** Presenter voice over the song (1 = normal). */
    private var talkLevel=1f
    private var focusDucked=false
    private var fadeLevel=1f
    private var loaded=false
    private var wantPlay=false
    private var noisyRegistered=false
    private val noisyReceiver=object:android.content.BroadcastReceiver(){
        override fun onReceive(context:Context,intent:android.content.Intent){
            if(intent.action==AudioManager.ACTION_AUDIO_BECOMING_NOISY && active)pauseIntegrated()
        }
    }
    private fun watchHeadphones(){if(!noisyRegistered){androidx.core.content.ContextCompat.registerReceiver(context,noisyReceiver,android.content.IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY),androidx.core.content.ContextCompat.RECEIVER_NOT_EXPORTED);noisyRegistered=true}}
    private fun stopWatchingHeadphones(){if(noisyRegistered){context.unregisterReceiver(noisyReceiver);noisyRegistered=false}}
    private val focus=AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN).setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
        .setOnAudioFocusChangeListener({ change -> when(change) {
            AudioManager.AUDIOFOCUS_GAIN -> { focusDucked=false;applyGain();if(resumeAfterFocus){resumeAfterFocus=false;resumeIntegrated()} }
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {focusDucked=true;applyGain()}
            else -> {val again=change==AudioManager.AUDIOFOCUS_LOSS_TRANSIENT && playing;pauseIntegrated(!again);resumeAfterFocus=again}
        } },handler).build()
    @Volatile private var started=false
    var track: JSONObject?=null;private set
    var active=false;private set
    var playing=false;private set
    var loading=false;private set
    var positionMs=0L;private set
    private var error:PlaybackException?=null
    private val deviceId=context.getSharedPreferences("murmur_engine_device",0).let { prefs -> prefs.getString("id",null) ?: java.util.UUID.randomUUID().toString().replace("-","").also { prefs.edit().putString("id",it).apply() } }
    private fun invalidate() { invalidateState();NativeEvents.emit("onSpotifyEngineState",JSObject().put("playing",playing).put("loading",loading).put("positionMs",positionMs).put("trackId",track?.optString("id")).put("queueId",track?.optString("queueId"))) }
    override fun getState(): State {
        val item=track
        val available=Player.Commands.Builder().addAll(Player.COMMAND_PLAY_PAUSE,Player.COMMAND_STOP,Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM,Player.COMMAND_GET_CURRENT_MEDIA_ITEM,Player.COMMAND_GET_METADATA,Player.COMMAND_GET_TIMELINE,Player.COMMAND_RELEASE).build()
        val builder=State.Builder().setAvailableCommands(available).setPlaybackState(if(item==null || error!=null)Player.STATE_IDLE else if(loading)Player.STATE_BUFFERING else Player.STATE_READY)
            .setPlayWhenReady(playing||loading,Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST).setContentPositionMs(positionMs).setPlayerError(error)
        if(item!=null)builder.setPlaylist(listOf(MediaItemData.Builder(item.optString("id")).setMediaItem(MediaItem.Builder().setMediaId(item.optString("id")).setMediaMetadata(MediaMetadata.Builder().setTitle(item.optString("title")).setArtist(item.optString("artist")).setArtworkUri(item.optString("artworkUrl").takeIf { it.startsWith("https://") }?.let { Uri.parse(it) }).build()).build()).setIsSeekable(true).setDurationUs((item.optDouble("duration",0.0)*1000000).toLong().coerceAtLeast(1)).build())).setCurrentMediaItemIndex(0)
        return builder.build()
    }
    suspend fun load(data: JSONObject) {
        watchHeadphones()
        val ticket=generation.incrementAndGet()
        track=data;active=true;wantPlay=true;playing=false;loading=true;loaded=false;positionMs=0;error=null;fadeLevel=1f;applyGain()
        focusHeld=!manageFocus || audio.requestAudioFocus(focus)==AudioManager.AUDIOFOCUS_REQUEST_GRANTED
        if(!focusHeld){active=false;loading=false;throw IllegalStateException("Android no concedió el foco de audio. Cierra otras llamadas o grabaciones y reintenta.")}
        output.enable(true)
        invalidate()
        try { scope.async {
            if(!started) {
                val token=tokenSupplier?.invoke() ?: auth.token()
                val session=if(tokenSupplier!=null)"test-session" else auth.sessionId()
                val credentials=java.io.File(context.cacheDir,"spotify_engine/$session/credentials").apply { mkdirs() }
                val cache=java.io.File(context.cacheDir,"spotify_engine/$session/audio").apply { mkdirs() }
                backend.start(context,token,deviceId,credentials.absolutePath,cache.absolutePath,output,this@SpotifyIntegratedPlayer)
                started=true
            }
            if(ticket!=generation.get())throw CancellationException("Solicitud sustituida")
            val uri=data.optString("spotifyUri");require(uri.matches(Regex("spotify:track:[A-Za-z0-9]{22}"))) { "Identificador Spotify inválido" }
            backend.load(uri)
            if (ticket == generation.get()) loaded = true
        }.await() } catch(failure:Throwable) {
            if(ticket==generation.get()){loading=false;playing=false;output.enable(false);output.stop();abandonFocus();error=PlaybackException("El motor local no pudo abrir la pista.",null,PlaybackException.ERROR_CODE_REMOTE_ERROR);invalidate()}
            if(failure is CancellationException)throw failure
            if(failure is ProviderFailure)throw failure
            throw ProviderFailure("SPOTIFY_ENGINE_FAILED",0,"spotify","engine_playback","El motor local no pudo iniciar Spotify. Comprueba la autorización Premium y reintenta; no se abrió la app oficial.")
        }
    }
    @Keep override fun onEvent(type:String,uri:String,eventPosition:Long) { val ticket=generation.get();handler.post {
        if(ticket!=generation.get() || error!=null)return@post
        if(!active || (uri.isNotEmpty() && uri!=track?.optString("spotifyUri")))return@post
        if(!wantPlay && type in listOf("playing","loading","position","end_of_track"))return@post
        if(wantPlay && loading && type in listOf("paused","stopped"))return@post
        if(type.startsWith("web_error:")) {
            val code=type.substringAfter(':');pauseIntegrated()
            // DRM or playback failure of the official Web player on this device: let the service pick another route.
            if(code in setOf("playback_error","eme_unavailable","initialization_error") && onKeysRefused?.invoke()==true)return@post
            val message=when(code){
                "authentication_error","http_401","http_403" -> "Spotify Web necesita una autorización válida de tu aplicación. Habilita Web Playback SDK y renueva Autorizar Spotify en Opciones (⋯)."
                "eme_unavailable","initialization_error" -> "Este Android System WebView no permite el reproductor protegido de Spotify. Actualiza WebView y Chrome y reintenta."
                "account_error" -> "Spotify Web no admitió esta cuenta. Comprueba Premium y los usuarios permitidos de tu aplicación de Spotify."
                else -> "Spotify Web no pudo iniciar el audio ($code). Vuelve a elegir la canción o renueva la autorización."
            }
            error=PlaybackException(message,null,PlaybackException.ERROR_CODE_REMOTE_ERROR);NativeEvents.emit("onSpotifyEngineError",JSObject().put("trackId",track?.optString("id")).put("queueId",track?.optString("queueId")).put("message",message));invalidate();return@post
        }
        when(type){
            "loading"->{loading=true;playing=false}
            "playing"->{
                if(!focusHeld){focusHeld=!manageFocus || audio.requestAudioFocus(focus)==AudioManager.AUDIOFOCUS_REQUEST_GRANTED;if(!focusHeld){pauseIntegrated();return@post}}
                output.enable(true);loading=false;playing=true;positionMs=eventPosition
            }
            "position"->positionMs=eventPosition
            "paused","stopped"->{loading=false;playing=false;output.enable(false);output.stop();if(!resumeAfterFocus)abandonFocus()}
            "end_of_track"->{loading=false;playing=false;output.enable(false);output.stop();invalidate();(onEnded?:onNext).invoke();return@post}
            "key_refused","unavailable"->{if(type=="key_refused" && onKeysRefused?.invoke()==true){loading=true;playing=false;invalidate();return@post};loading=false;playing=false;output.enable(false);output.stop();abandonFocus();error=PlaybackException("Spotify no permitió reproducir esta pista con el motor integrado.",null,PlaybackException.ERROR_CODE_REMOTE_ERROR);NativeEvents.emit("onSpotifyEngineError",JSObject().put("trackId",track?.optString("id")).put("queueId",track?.optString("queueId")).put("message",if(type=="key_refused")"Spotify rechazó las claves del motor librespot. En Opciones (⋯) elige Integrado · Web y renueva Autorizar Spotify para usar la alternativa." else "Spotify no pudo abrir esta canción. Prueba otra pista o renueva la autorización del motor."))}
        };invalidate()
    } }
    fun pauseIntegrated(releaseFocus:Boolean=true) {wantPlay=false;generation.incrementAndGet();loading=false;playing=false;output.enable(false);output.stop();if(releaseFocus){resumeAfterFocus=false;abandonFocus()};if(started)scope.launch{runCatching{backend.pause()}};invalidate()}
    fun deactivate(){pauseIntegrated();active=false}
    fun resumeIntegrated():Boolean {
        if(!started || !loaded || error!=null)return false
        focusHeld=!manageFocus || audio.requestAudioFocus(focus)==AudioManager.AUDIOFOCUS_REQUEST_GRANTED;if(!focusHeld)return false
        val ticket=generation.incrementAndGet();wantPlay=true;loading=true;invalidate();output.enable(true)
        scope.launch{runCatching{backend.play()}.onFailure{handler.post{
            if(ticket!=generation.get() || !active)return@post
            pauseIntegrated();error=PlaybackException("No se pudo reanudar Spotify integrado. Vuelve a elegir la canción.",null,PlaybackException.ERROR_CODE_REMOTE_ERROR)
            NativeEvents.emit("onSpotifyEngineError",JSObject().put("trackId",track?.optString("id")).put("queueId",track?.optString("queueId")).put("message",error!!.message));invalidate()
        }}};return true
    }
    fun seekIntegrated(ms:Long){positionMs=ms.coerceAtLeast(0);scope.launch{runCatching{backend.seek(positionMs)}};invalidate()}
    private fun applyGain(){val gain=fadeLevel*talkLevel*(if(voiceDucked) com.personal.murmur.HybridMediaService.DUCK_GAIN else if(focusDucked) .15f else 1f);output.volume(gain);backend.volume(gain)}
    fun fadeGain(value:Float){fadeLevel=value.coerceIn(0f,1f);applyGain()}
    fun duck(value:Boolean){voiceDucked=value;applyGain()}
    fun talk(level:Float){talkLevel=level.coerceIn(0f,1f);applyGain()}
    private fun abandonFocus(){if(focusHeld){if(manageFocus)audio.abandonAudioFocusRequest(focus);focusHeld=false}}
    fun shutdown(clearCache:Boolean=false):Job {deactivate();stopWatchingHeadphones();return scope.launch{if(started)runCatching{backend.shutdown()};started=false;output.release();if(clearCache)SpotifyEngineAuthorization.clearRuntimeFiles(context)}}
    override fun handleSetPlayWhenReady(value:Boolean):ListenableFuture<*> {if(value && !resumeIntegrated())return Futures.immediateFailedFuture<Any>(IllegalStateException("Vuelve a cargar la canción desde MURMUR"));if(!value)pauseIntegrated();return Futures.immediateVoidFuture()}
    override fun handleStop():ListenableFuture<*> {pauseIntegrated();return Futures.immediateVoidFuture()}
    override fun handleSeek(index:Int,ms:Long,command:Int):ListenableFuture<*> {if(command==Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM)onNext.invoke()else seekIntegrated(ms);return Futures.immediateVoidFuture()}
    override fun handleRelease():ListenableFuture<*> {shutdown();return Futures.immediateVoidFuture()}
    fun webState()=JSONObject().put("is_playing",playing).put("loading",loading).put("error",error?.message?:"").put("progress_ms",positionMs).put("item",JSONObject().put("uri",track?.optString("spotifyUri")).put("duration_ms",((track?.optDouble("duration")?:0.0)*1000).toLong())).put("device",JSONObject().put("name",deviceLabel).put("type","Smartphone"))
}
