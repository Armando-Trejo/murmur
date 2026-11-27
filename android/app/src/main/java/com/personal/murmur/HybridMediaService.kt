package com.personal.murmur

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.media.audiofx.LoudnessEnhancer
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import androidx.core.app.NotificationCompat
import androidx.media3.common.*
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.BaseAudioProcessor
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.HttpDataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.audio.DefaultAudioSink
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import androidx.media3.session.MediaLibraryService
import androidx.media3.session.LibraryResult
import androidx.media3.common.MediaItem
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import androidx.media3.session.DefaultMediaNotificationProvider
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionResult
import androidx.media3.session.CommandButton
import android.os.Bundle
import com.getcapacitor.JSObject
import kotlinx.coroutines.*
import org.json.JSONObject
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.*

@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class HybridMediaService : MediaLibraryService() {
    companion object {
        var instance: HybridMediaService? = null
            private set
        const val SLEEP_AT_TRACK_END = -2
        /** Overlap used to hide AudioTrack start-up latency when tracks follow each other without Auto-Mix. */
        const val TAIL_HANDOFF_MS = 240L
        /** RMS below this (about -52 dBFS) counts as the silent tail many uploads end with. */
        const val SILENT_TAIL = 0.0025f
        /** A parked preload must still be at its start; beyond this it is rewound before use. */
        const val PRELOAD_START_TOLERANCE_MS = 400L
        const val METERED_PRELOAD_AFTER_MS = 12_000L
        /** True while MURMUR's own screen is visible; progress events to the WebView slow down otherwise. */
        @Volatile var uiVisible = true
        /** Music level while the person talks to MURMUR (about -26 dB): low enough for the recognizer, still continuous. */
        const val DUCK_GAIN = 0.05f
        /** 25 s of sound at one sample every 100 ms (a song's first seconds alone mislead). */
        const val MEASURE_SAMPLES = 250
        /** Music level under the presenter's voice: a dip you still hear (about -9 dB), not a mute. */
        const val TALK_GAIN = 0.35f
    }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val handler = Handler(Looper.getMainLooper())
    lateinit var primaryPlayer: ExoPlayer
    private lateinit var secondaryPlayer: ExoPlayer
    private var session: MediaLibrarySession? = null
    /** One LoudnessEnhancer per player: quiet songs come up (also the incoming one during a mix). */
    private val enhancers = mutableMapOf<ExoPlayer, LoudnessEnhancer>()
    private var fade: Job? = null
    private var preparing: Job? = null
    private var volumeFade:Job?=null
    private var selectionPending:Long?=null
    private var preloadRetryAt=0L
    var track: JSONObject? = null; private set
    private var nextTrack: JSONObject? = null
    private var upcoming = mutableListOf<JSONObject>()
    private val played=ArrayDeque<JSONObject>()
    private val previousCommand=SessionCommand("murmur.previous",Bundle.EMPTY)
    private val nextCommand=SessionCommand("murmur.next",Bundle.EMPTY)
    private fun remember(data:JSONObject){val before=track;if(before!=null && before.optString("queueId",before.optString("id"))!=data.optString("queueId",data.optString("id"))){played.addLast(before);if(played.size>100)played.removeFirst()}}
    private var transportPlayer:TransportPlayer?=null
    private inner class TransportPlayer(val engine:Player):ForwardingPlayer(engine){
        override fun getAvailableCommands():Player.Commands {
            val commands=super.getAvailableCommands().buildUpon().removeAll(Player.COMMAND_SEEK_TO_PREVIOUS,Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM,Player.COMMAND_SEEK_TO_NEXT,Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM)
            if(track!=null)commands.addAll(Player.COMMAND_SEEK_TO_PREVIOUS,Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
            if(upcoming.isNotEmpty())commands.addAll(Player.COMMAND_SEEK_TO_NEXT,Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM)
            return commands.build()
        }
        override fun isCommandAvailable(command:Int)=availableCommands.contains(command)
        override fun pause() {
            PlaybackRequests.next()
            pausePlayback()
        }
        override fun seekToPrevious()=previousNative()
        override fun seekToPreviousMediaItem()=previousNative()
        override fun seekToNext()=advanceNative()
        override fun seekToNextMediaItem()=advanceNative()
        // Android Auto (or any media browser) asks to play one of MURMUR's own items: MURMUR builds
        // the queue itself instead of handing raw ids to ExoPlayer.
        private fun fromBrowser(items:List<MediaItem>,index:Int):Boolean{
            if(items.isEmpty())return autoStarting
            val id=items.getOrNull(index.coerceAtLeast(0))?.mediaId ?: items.firstOrNull()?.mediaId ?: return false
            if(!id.startsWith("song:")&&!id.startsWith("list:"))return false
            playFromBrowser(id);return true
        }
        override fun setMediaItems(items:MutableList<MediaItem>){if(!fromBrowser(items,0))super.setMediaItems(items)}
        override fun setMediaItems(items:MutableList<MediaItem>,resetPosition:Boolean){if(!fromBrowser(items,0))super.setMediaItems(items,resetPosition)}
        override fun setMediaItems(items:MutableList<MediaItem>,startIndex:Int,startPositionMs:Long){if(!fromBrowser(items,startIndex))super.setMediaItems(items,startIndex,startPositionMs)}
        override fun setMediaItem(item:MediaItem){if(!fromBrowser(listOf(item),0))super.setMediaItem(item)}
        override fun setMediaItem(item:MediaItem,resetPosition:Boolean){if(!fromBrowser(listOf(item),0))super.setMediaItem(item,resetPosition)}
        override fun setMediaItem(item:MediaItem,startPositionMs:Long){if(!fromBrowser(listOf(item),0))super.setMediaItem(item,startPositionMs)}
        override fun addMediaItems(items:MutableList<MediaItem>){if(!fromBrowser(items,0))super.addMediaItems(items)}
        override fun prepare(){if(!autoStarting)super.prepare()}
        override fun play(){if(autoStarting)return;super.play()}

    }
    private fun sessionPlayer(player:Player){val wrapper=TransportPlayer(player);transportPlayer=wrapper;session?.setPlayer(wrapper);MurmurWidget.sync(this)}
    private fun updateMediaButtons(){transportPlayer?.let{sessionPlayer(it.engine)}}
    private fun emitNativeTrack(data:JSONObject, prepared: Boolean = true){
        val local=if(spotifyActive)spotifyIntegrated.webState()else null
        NativeEvents.emit("onNativeTrackChanged",JSObject().put("id",data.optString("id")).put("queueId",data.optString("queueId")).put("prepared",prepared).put("playing",local?.optBoolean("is_playing")?:primaryPlayer.isPlaying).put("loading",local?.optBoolean("loading")?:(primaryPlayer.playbackState==Player.STATE_BUFFERING)).put("transport",if(spotifyActive)"integrated" else "youtube")
            // Where the new song already is (a crossfade starts it seconds in) and its real length.
            .put("positionMs", if (spotifyActive) spotifyIntegrated.positionMs else youtubePositionMs.coerceAtLeast(0))
            .put("durationMs", if (spotifyActive) 0L else primaryPlayer.duration.takeIf { it > 0 } ?: 0L))
        // Gapless and crossfaded changes never stop playing, so the presenter also listens here.
        if (prepared) SpokenReplies.announce(this, data)
    }
    fun previousNative() {
        val position = if (spotifyActive) spotifyIntegrated.positionMs else youtubePositionMs
        val previous = played.lastOrNull()
        if (position > 3000 || previous == null) {
            if (recoveryPositionMs == null) {
                PlaybackRequests.next()
                sourceEpoch++
            }
            selectionPending = null
            if (spotifyActive) {
                cancelOverlap()
                spotifyIntegrated.seekIntegrated(0)
            } else if (recoveryPositionMs != null) {
                // The in-flight resolver is still meant for this same queue entry.
                recoveryPositionMs = 0
            } else {
                cancelOverlap()
                primaryPlayer.seekTo(0)
            }
            return
        }
        switchNative(previous, forward = false)
    }
    private var pendingTrack: JSONObject? = null
    private var mode = "smooth"
    private var sleepAt = 0L
    /** Set by the "end of this track" sleep option; consumed once by the next natural ending. */
    var sleepAtTrackEnd = false; private set
    private var ducking = false
    private val meters = mutableMapOf<ExoPlayer, Meter>()
    val visualPlaying get() = if (spotifyActive) spotifyIntegrated.playing else primaryPlayer.isPlaying
    /**
     * Whether music plays, readable from any thread ("Ok MURMUR" listens on its own thread; ExoPlayer
     * may only be asked on the main thread, and asking from elsewhere stopped the listener after a pause).
     */
    @Volatile var playingAnyThread = false; private set
    val visualAmplitude get()=if(spotifyActive)spotifyIntegrated.visualAmplitude else if(primaryPlayer.isPlaying)meters[primaryPlayer]?.amplitude ?: 0f else 0f
    private val visualAnalyzer = SpectrumAnalyzer()
    /** Spectrum + beat analysis of what is audible now. Main thread; idempotent per frame time. */
    fun visualSpectrum(frameTimeNanos: Long = System.nanoTime()): VisualSpectrum = visualAnalyzer.update(
        if (spotifyActive) spotifyIntegrated.visualTap else meters[primaryPlayer]?.tap, visualPlaying, frameTimeNanos)
    private var presses = 0
    private var sourceTrackId = ""
    private val alternatives = ArrayDeque<PlaybackSource>()
    private var sourceAttempts = 0
    private var refreshedSource=false
    private val integratedDelegate=lazy { com.personal.murmur.spotify.SpotifyIntegratedPlayer(this,onNext={ advanceNative() },onEnded={ spotifyTrackEnded() },onKeysRefused={ code -> fallBackFromEngine(code) }) }
    private var engineFallbackFor = ""
    /**
     * Spotify may refuse audio keys to the librespot engine (it still logs in), and its official Web
     * player fails on WebViews without the DRM it wants. Instead of stopping:
     * - with the Spotify app installed, switch to Connect (the official app plays, MURMUR controls it)
     *   and ask the web layer to replay the same song through that route;
     * - otherwise, from the integrated engine, try the Web player when its scopes were granted.
     * The chosen mode is kept and can be changed back in Conexiones. One switch per song.
     */
    private fun fallBackFromEngine(code: String = ""): Boolean {
        val data = track ?: return false
        if (!spotifyActive) return false
        val id = entryIdentity(data)
        if (engineFallbackFor == id) return false
        engineFallbackFor = id
        // Never depend on the Spotify app: the web layer plays the same song from YouTube Music
        // through MURMUR's own engine (gapless, cache, visualizer, lock screen all keep working).
        spotifyIntegrated.deactivate()
        NativeEvents.emit("onSpotifyEngineError", JSObject().put("trackId", data.optString("id")).put("queueId", data.optString("queueId"))
            .put("code", "SPOTIFY_RETRY_YOUTUBE")
            // Only a route that can never work on this phone (no DRM, keys refused to librespot) is
            // remembered; a single song Spotify Web could not start plays its twin just this once.
            .put("permanent", code != "playback_error").put("reason", code)
            .put("message", "Spotify no pudo reproducir esta canción aquí. MURMUR toca la misma grabación desde YouTube Music."))
        return true
    }
    private val nativeIntegrated by integratedDelegate
    private val webSession by lazy{SpotifySession.stored(this)}
    private val webDelegate=lazy{com.personal.murmur.spotify.SpotifyIntegratedPlayer(this,onNext={advanceNative()},backend=com.personal.murmur.spotify.SpotifyWebBackend(this,tokenProvider={force->webSession.webToken(force)}),manageFocus=false,deviceLabel="MURMUR · Web",tokenSupplier={webSession.webToken()},onEnded={spotifyTrackEnded()},onKeysRefused={code->fallBackFromEngine(code)})}
    private val webIntegrated by webDelegate
    private var selectedWeb=false
    private val spotifyIntegrated get()=if(selectedWeb)webIntegrated else nativeIntegrated
    private var sourceEpoch=0L
    private var recoveryPositionMs: Long? = null
    val youtubePositionMs get() = recoveryPositionMs ?: primaryPlayer.currentPosition
    val youtubeLoading get() = recoveryPositionMs != null ||
        (primaryPlayer.playbackState == Player.STATE_BUFFERING && primaryPlayer.playWhenReady)
    var spotifyActive=false;private set
    suspend fun playIntegrated(data:JSONObject,web:Boolean=false,rememberTrack:Boolean=true) {
        if(rememberTrack)remember(data)
        volumeFade?.cancel()
        sourceEpoch++
        val previousEngine = if (spotifyActive && selectedWeb != web) spotifyIntegrated else null
        pausePlayback()
        previousEngine?.deactivate()
        selectedWeb=web;spotifyActive=true;track=data;sessionPlayer(spotifyIntegrated)
        spotifyIntegrated.load(data)
        updateMediaButtons()
    }
    fun integratedState()=spotifyIntegrated.webState()
    fun pauseIntegrated()=spotifyIntegrated.pauseIntegrated()
    fun resumeIntegrated() {check(spotifyIntegrated.resumeIntegrated()) { "Vuelve a cargar la canción de Spotify integrado." }}
    fun seekIntegrated(ms:Long)=spotifyIntegrated.seekIntegrated(ms)
    fun shutdownIntegrated(clearCache:Boolean=false):Job {sourceEpoch++;spotifyActive=false;sessionPlayer(primaryPlayer);return scope.launch{if(integratedDelegate.isInitialized())nativeIntegrated.shutdown(clearCache).join();if(webDelegate.isInitialized())webIntegrated.shutdown().join();if(clearCache)withContext(Dispatchers.IO){com.personal.murmur.spotify.SpotifyEngineAuthorization.clearRuntimeFiles(this@HybridMediaService)}}}
    /** The car refreshes its lists after the app wrote a new library copy. */
    fun libraryChanged(){val current=session?:return;listOf(AutoLibrary.ROOT,"folder:foryou","folder:playlists","folder:albums").forEach{current.notifyChildrenChanged(it,Int.MAX_VALUE,null)}}
    @Volatile private var autoStarting=false
    /**
     * Starts a list chosen in Android Auto. With MURMUR's screen alive, the app plays it (so the queue,
     * Spotify player and twins behave as usual); otherwise the service plays the songs it can start
     * by itself (YouTube and Spotify's in-app player).
     */
    fun playFromBrowser(mediaId:String){
        val (list,start)=AutoLibrary.locate(this,mediaId) ?: return
        val tracks=list.optJSONArray("tracks") ?: return
        autoStarting=true
        handler.postDelayed({autoStarting=false},1500)
        if(NativeEvents.plugin!=null){
            NativeEvents.emit("onAutoPlay",JSObject().put("collection",list.optString("id")).put("index",start).put("tracks",tracks))
            return
        }
        val mode=com.personal.murmur.spotify.SpotifyEngineAuthorization(this).mode()
        val stamp=System.nanoTime()
        val entries=(0 until tracks.length()).map{i->JSONObject(tracks.getJSONObject(i).toString()).put("queueId","auto-$stamp-$i")}
        val playable=entries.withIndex().filter{AutoLibrary.playableAlone(it.value,mode)}
        val first=playable.indexOfFirst{it.index>=start}.takeIf{it>=0} ?: return
        played.clear();played.addAll(playable.take(first).map{it.value})
        setUpcoming(playable.drop(first).map{it.value})
        advanceNative()
    }
    fun advanceNative() {
        val next = upcoming.firstOrNull() ?: run {
            PlaybackRequests.next()
            pausePlayback()
            return
        }
        switchNative(next, forward = true)
    }

    private fun switchNative(target: JSONObject, forward: Boolean) {
        val ticket = PlaybackRequests.next()
        beginSelection(ticket)
        val from = entryIdentity(track)
        val key = entryIdentity(target)
        val spotify = target.optString("source") == "spotify"
        val playback = if (spotify) com.personal.murmur.spotify.SpotifyEngineAuthorization(this).mode() else ""
        if (playback == "connect") {
            finishSelection(ticket)
            NativeEvents.emit(if (forward) "onRequestNext" else "onRequestPrevious")
            return
        }
        if (!spotify && forward && playPrepared(target, announce = true)) {
            finishSelection(ticket)
            return
        }
        scope.launch {
            try {
                val sources = if (spotify) emptyList() else withContext(Dispatchers.IO) { sourcesFor(target) }
                val candidate = if (forward) upcoming.firstOrNull() else played.lastOrNull()
                if (!PlaybackRequests.isCurrent(ticket) || from != entryIdentity(track)) return@launch
                if (key != entryIdentity(candidate)) {
                    // The queue changed while this track was resolving (an addition, a reorder).
                    // If the outgoing track already finished, continue with the new next entry
                    // instead of staying silent.
                    if (forward && !spotifyActive && primaryPlayer.playbackState == Player.STATE_ENDED) advanceNative()
                    return@launch
                }
                if (forward) upcoming.removeAt(0)
                else {
                    played.removeLast()
                    track?.let { upcoming.add(0, it) }
                }
                if (spotify) playIntegrated(target, playback == "web", rememberTrack = forward)
                else playSources(sources, target, rememberTrack = forward)
                if (PlaybackRequests.isCurrent(ticket) && key == entryIdentity(track)) emitNativeTrack(target)
            } catch (failure: Exception) {
                if (!PlaybackRequests.isCurrent(ticket) || failure is CancellationException) return@launch
                val reason = (failure as? ProviderFailure)?.message
                    ?: "No se pudo abrir esta pista. Abre MURMUR para reintentar."
                if (key == entryIdentity(track)) {
                    emitNativeTrack(target, prepared = false)
                    NativeEvents.emit(if (spotify) "onSpotifyEngineError" else "onTrackError",
                        JSObject().put("trackId", target.optString("id")).put("queueId", target.optString("queueId"))
                            .put("code", (failure as? ProviderFailure)?.code).put("message", reason))
                } else {
                    pausePlayback()
                    NativeEvents.emit("onPlaybackNotice", JSObject().put("message", reason))
                }
            } finally {
                finishSelection(ticket)
                updateMediaButtons()
            }
        }
    }

    private inner class Meter : BaseAudioProcessor() {
        @Volatile var amplitude = 0f
            private set
        /** Lock-free PCM tap for the visualizer (written here on the playback thread). */
        val tap = VisualPcmTap()

        override fun onFlush() { amplitude = 0f; tap.discontinuity() }
        override fun onConfigure(input: AudioProcessor.AudioFormat): AudioProcessor.AudioFormat = input
        override fun queueInput(input: ByteBuffer) {
            if(!input.hasRemaining())return
            val size = input.remaining(); val format = inputAudioFormat
            amplitude = tap.write(input, format.encoding, format.channelCount, format.sampleRate)
            replaceOutputBuffer(size).put(input).flip()
        }
    }
    private fun audioAttributes() = AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build()
    private fun createPlayer(handleAudioFocus: Boolean = true): ExoPlayer {
        val meter = Meter()
        val factory = object : DefaultRenderersFactory(this) {
            override fun buildAudioSink(context: android.content.Context, enableFloatOutput: Boolean, enableAudioTrackPlaybackParams: Boolean): AudioSink = VisualClockSink(DefaultAudioSink.Builder(context).setAudioProcessors(arrayOf(meter)).build(), meter.tap)
        }
        val http = OkHttpDataSource.Factory(NativeNetwork.client)
            .setDefaultRequestProperties(mapOf("User-Agent" to NativeNetwork.USER_AGENT,"Referer" to "https://www.youtube.com/"))
        val upstream = AudioRangeDataSource.Factory(DefaultDataSource.Factory(this, http))
        val cached = androidx.media3.datasource.cache.CacheDataSource.Factory()
            .setCache(MediaCache.get(this))
            .setUpstreamDataSourceFactory(upstream)
            .setFlags(androidx.media3.datasource.cache.CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR)
        val sources = DefaultMediaSourceFactory(MediaCache.RoutingFactory(cached, upstream))
        val selector = androidx.media3.exoplayer.trackselection.DefaultTrackSelector(this).apply { setParameters(buildUponParameters().setTrackTypeDisabled(C.TRACK_TYPE_VIDEO,true)) }
        // 20–60 s of audio: the radio wakes in fewer, longer bursts (battery) and rides out weak signal.
        // 700 ms to start keeps a tap feeling immediate; 2 s after a stall avoids stutter loops.
        val load = androidx.media3.exoplayer.DefaultLoadControl.Builder()
            .setBufferDurationsMs(20_000, 60_000, 700, 2_000)
            .setPrioritizeTimeOverSizeThresholds(true)
            .build()
        return ExoPlayer.Builder(this, factory).setLoadControl(load).setLooper(Looper.getMainLooper()).setMediaSourceFactory(sources).setTrackSelector(selector).build().apply {
            meters[this] = meter
            setAudioAttributes(audioAttributes(), handleAudioFocus)
            // NETWORK also holds a Wi-Fi lock while playing, so streaming does not stall with the screen off.
            setHandleAudioBecomingNoisy(true); setWakeMode(C.WAKE_MODE_NETWORK)
        }
    }
    override fun onCreate() {
        super.onCreate(); instance = this; mode = getSharedPreferences("playback", 0).getString("mix_mode", "smooth") ?: "smooth"
        Loudness.init(this)
        handler.post(loudnessSampler)
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel("hybrid_playback", "Reproducción", NotificationManager.IMPORTANCE_LOW))
        setMediaNotificationProvider(DefaultMediaNotificationProvider.Builder(this).setNotificationId(1001).setChannelId("hybrid_playback").build().apply{setSmallIcon(R.drawable.ic_stat_sound)})
        startForeground(1001, NotificationCompat.Builder(this, "hybrid_playback").setSmallIcon(R.drawable.ic_stat_sound).setContentTitle("MURMUR").setContentText("Preparando audio").setOngoing(true).build())
        primaryPlayer = createPlayer(); secondaryPlayer = createPlayer(false); attach(primaryPlayer)
        val open=android.app.PendingIntent.getActivity(this,0,Intent(this,MainActivity::class.java).apply{putExtra("open_player",true);flags=Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP},android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE)
        val initialTransport=TransportPlayer(primaryPlayer);transportPlayer=initialTransport
        session = MediaLibrarySession.Builder(this, initialTransport, object : MediaLibrarySession.Callback {
            override fun onGetLibraryRoot(session:MediaLibrarySession,browser:MediaSession.ControllerInfo,params:LibraryParams?):ListenableFuture<LibraryResult<MediaItem>> =
                Futures.immediateFuture(LibraryResult.ofItem(AutoLibrary.root(),params))
            override fun onGetChildren(session:MediaLibrarySession,browser:MediaSession.ControllerInfo,parentId:String,page:Int,pageSize:Int,params:LibraryParams?):ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> {
                val all=AutoLibrary.children(this@HybridMediaService,parentId)
                val from=(page.toLong()*pageSize).coerceAtMost(all.size.toLong()).toInt();val to=(from+pageSize).coerceAtMost(all.size)
                return Futures.immediateFuture(LibraryResult.ofItemList(ImmutableList.copyOf(if(pageSize>0)all.subList(from,to) else all),params))
            }
            override fun onGetItem(session:MediaLibrarySession,browser:MediaSession.ControllerInfo,mediaId:String):ListenableFuture<LibraryResult<MediaItem>> =
                Futures.immediateFuture(AutoLibrary.item(this@HybridMediaService,mediaId)?.let{LibraryResult.ofItem(it,null)} ?: LibraryResult.ofError(androidx.media3.session.SessionError.ERROR_BAD_VALUE))
            override fun onSearch(session:MediaLibrarySession,browser:MediaSession.ControllerInfo,query:String,params:LibraryParams?):ListenableFuture<LibraryResult<Void>> {
                session.notifySearchResultChanged(browser,query,AutoLibrary.search(this@HybridMediaService,query).size,params)
                return Futures.immediateFuture(LibraryResult.ofVoid())
            }
            override fun onGetSearchResult(session:MediaLibrarySession,browser:MediaSession.ControllerInfo,query:String,page:Int,pageSize:Int,params:LibraryParams?):ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> =
                Futures.immediateFuture(LibraryResult.ofItemList(ImmutableList.copyOf(AutoLibrary.search(this@HybridMediaService,query)),params))
            /** A spoken request to the car ("pon ...") arrives as a search query. */
            override fun onAddMediaItems(session:MediaSession,controller:MediaSession.ControllerInfo,items:MutableList<MediaItem>):ListenableFuture<MutableList<MediaItem>> {
                val query=items.firstOrNull()?.requestMetadata?.searchQuery
                if(!query.isNullOrBlank()){
                    if(NativeEvents.plugin!=null){NativeEvents.emit("onAutoSearch",JSObject().put("query",query));autoStarting=true;handler.postDelayed({autoStarting=false},1500);return Futures.immediateFuture(mutableListOf())}
                    val found=AutoLibrary.search(this@HybridMediaService,query,1).firstOrNull()
                    return Futures.immediateFuture(if(found!=null)mutableListOf(found) else mutableListOf())
                }
                return Futures.immediateFuture(items)
            }
            override fun onConnect(session:MediaSession,controller:MediaSession.ControllerInfo)=MediaSession.ConnectionResult.AcceptedResultBuilder(session).setAvailableSessionCommands(MediaSession.ConnectionResult.DEFAULT_SESSION_COMMANDS.buildUpon().add(previousCommand).add(nextCommand).build()).build()
            override fun onCustomCommand(session:MediaSession,controller:MediaSession.ControllerInfo,command:SessionCommand,args:Bundle):com.google.common.util.concurrent.ListenableFuture<SessionResult>{when(command.customAction){"murmur.previous"->previousNative();"murmur.next"->advanceNative();else->return com.google.common.util.concurrent.Futures.immediateFuture(SessionResult(androidx.media3.session.SessionError.ERROR_NOT_SUPPORTED))};return com.google.common.util.concurrent.Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))}
            override fun onMediaButtonEvent(session: MediaSession, controllerInfo: MediaSession.ControllerInfo, intent: Intent): Boolean {
                val key = if (android.os.Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_KEY_EVENT, KeyEvent::class.java) else @Suppress("DEPRECATION") intent.getParcelableExtra(Intent.EXTRA_KEY_EVENT)
                if(key?.keyCode in listOf(KeyEvent.KEYCODE_MEDIA_NEXT,KeyEvent.KEYCODE_MEDIA_PREVIOUS)){if(key?.action==KeyEvent.ACTION_UP){if(key.keyCode==KeyEvent.KEYCODE_MEDIA_NEXT)advanceNative()else previousNative()};return true}
                if (key?.keyCode in listOf(KeyEvent.KEYCODE_HEADSETHOOK, KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE)) { if (key?.action == KeyEvent.ACTION_UP) { presses++; handler.removeCallbacks(headset); handler.postDelayed(headset, 420) }; return true }
                return super.onMediaButtonEvent(session, controllerInfo, intent)
            }
        }).setSessionActivity(open).build()
        addSession(session!!)
        updateMediaButtons()
        handler.post(ticker)
    }
    private val headset = Runnable { if (presses >= 2) { VoiceTriggerManager.launch(this, "headset") } else if(spotifyActive){if(spotifyIntegrated.playing)spotifyIntegrated.pauseIntegrated()else spotifyIntegrated.resumeIntegrated()}else if (primaryPlayer.isPlaying) primaryPlayer.pause() else primaryPlayer.play(); presses = 0 }
    private val listener = object : Player.Listener {
        override fun onIsPlayingChanged(isPlaying: Boolean) { if(!spotifyActive) playingAnyThread = isPlaying; if(spotifyActive)return; if (!isPlaying && fade != null && !primaryPlayer.playWhenReady) pausePlayback(); NativeEvents.emit("onPlaybackStateChanged", JSObject().put("trackId",track?.optString("id")).put("queueId",track?.optString("queueId")).put("playing", isPlaying).put("loading", youtubeLoading)); MurmurWidget.sync(this@HybridMediaService)
            // Presenter (off by default): names a song once, when it actually starts sounding.
            if (isPlaying) SpokenReplies.announce(this@HybridMediaService, track) }
        override fun onPlaybackStateChanged(state: Int) {
            if(spotifyActive)return
            NativeEvents.emit("onPlaybackStateChanged", JSObject().put("trackId",track?.optString("id")).put("queueId",track?.optString("queueId")).put("playing", primaryPlayer.isPlaying).put("loading", youtubeLoading))
            if (state == Player.STATE_ENDED && primaryPlayer.playWhenReady && fade == null && selectionPending == null) advanceAfterEnd()
        }
        override fun onPlayerError(error: PlaybackException) {
            if (spotifyActive || selectionPending != null || recoveryPositionMs != null) return
            val request = PlaybackRequests.snapshot()
            val failed = track ?: return
            val identity = entryIdentity(failed)
            val http = generateSequence(error as Throwable?) { it.cause }.filterIsInstance<HttpDataSource.InvalidResponseCodeException>().firstOrNull()?.responseCode
            val position = primaryPlayer.currentPosition.coerceAtLeast(0)
            val networkFailure = error.errorCode in setOf(
                PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED,
                PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT,
                PlaybackException.ERROR_CODE_IO_UNSPECIFIED
            )
            val retryable = error.errorCode in setOf(PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS, PlaybackException.ERROR_CODE_PARSING_CONTAINER_MALFORMED, PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED, PlaybackException.ERROR_CODE_DECODING_FAILED, PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED, PlaybackException.ERROR_CODE_DECODER_INIT_FAILED)
            if (retryable && http !in listOf(401, 403, 410, 429) &&
                sourceTrackId == failed.optString("id") && alternatives.isNotEmpty() && sourceAttempts < 3) {
                val next = alternatives.removeFirst(); sourceAttempts++
                primaryPlayer.setMediaItem(item(next.uri, track!!, next.mime), position); primaryPlayer.prepare(); primaryPlayer.play()
                NativeEvents.emit("onPlaybackStateChanged", JSObject().put("trackId", failed.optString("id"))
                    .put("queueId", failed.optString("queueId")).put("playing", false).put("loading", true))
                return
            }
            val data=failed
            if(!refreshedSource && data.optString("videoId").matches(Regex("[A-Za-z0-9_-]{11}"))==true && (networkFailure || http in listOf(401,403,410) || error.errorCode in listOf(PlaybackException.ERROR_CODE_DECODING_FAILED,PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED,PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED))) {
                refreshedSource = true
                recoveryPositionMs = position
                val ticket = sourceEpoch
                NativeEvents.emit("onPlaybackStateChanged", JSObject().put("trackId", data.optString("id"))
                    .put("queueId", data.optString("queueId")).put("playing", false).put("loading", true))
                scope.launch { try {
                    val replacement=withContext(Dispatchers.IO){NativeNetwork.resolveAudio(data.getString("videoId"),true)}
                    if (ticket != sourceEpoch || !PlaybackRequests.isCurrent(request) || identity != entryIdentity(track)) return@launch
                    val resumeAt = recoveryPositionMs ?: return@launch
                    playSources(replacement.sources, data, recovery = true, startPosition = resumeAt)
                } catch (failure: Exception) {
                    if (failure is CancellationException || ticket != sourceEpoch ||
                        !PlaybackRequests.isCurrent(request) || identity != entryIdentity(track)) return@launch
                    val detail = failure as? ProviderFailure
                    emitYouTubeError(data, detail?.code ?: "AUDIO_UNAVAILABLE",
                        detail?.message ?: "No se pudo recuperar el audio. Pulsa Reintentar o elige otra versión.")
                } }
                return
            }
            val missing = error.errorCode == PlaybackException.ERROR_CODE_IO_FILE_NOT_FOUND
            val message = when {
                http == 429 -> "YouTube limitó las solicitudes de audio. Espera un momento y pulsa Reintentar."
                networkFailure -> "Se interrumpió la conexión de audio. Revisa tu red y pulsa Reintentar."
                else -> when(error.errorCode) {
                    PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS -> "El servidor rechazó el enlace de audio. Pulsa Reintentar o elige otra versión."
                    PlaybackException.ERROR_CODE_IO_FILE_NOT_FOUND -> "El archivo local no está disponible. Pulsa Reintentar para abrir la misma pista en línea."
                    PlaybackException.ERROR_CODE_DECODING_FAILED, PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED -> "Android no pudo decodificar este formato. Pulsa Reintentar o elige otra versión."
                    else -> "No se pudo reproducir este audio. Pulsa Reintentar o busca otra versión."
                }
            }
            emitYouTubeError(failed, when {
                missing -> "AUDIO_NOT_FOUND"
                networkFailure -> "AUDIO_NETWORK"
                http == 429 -> "AUDIO_RATE_LIMIT"
                else -> "AUDIO_PLAYBACK_FAILED"
            }, message)
        }
        override fun onAudioSessionIdChanged(audioSessionId: Int) { configureEnhancer(primaryPlayer, track) }
        override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
            if (spotifyActive || primaryPlayer.currentMediaItemIndex == 0) return
            chainedTrack?.let { adoptChained(it) }
        }
    }
    private fun emitYouTubeError(data: JSONObject, code: String, message: String) {
        val position = youtubePositionMs.coerceAtLeast(0)
        recoveryPositionMs = null
        primaryPlayer.pause()
        NativeEvents.emit("onTrackError", JSObject().put("trackId", data.optString("id"))
            .put("queueId", data.optString("queueId")).put("code", code)
            .put("message", message).put("positionMs", position))
    }

    private fun attach(player: ExoPlayer) { player.addListener(listener) }
    /**
     * «Volumen parejo»: a quiet song is brought up to the reference with the enhancer (loud ones go
     * down with the player's volume, see [baseGain]). Live and bootleg uploads keep their small lift
     * while their level is unknown.
     */
    private fun configureEnhancer(player: ExoPlayer, data: JSONObject?) {
        val known = Loudness.correctionDb(data?.optString("videoId"))
        if (android.util.Log.isLoggable(DEBUG_TAG, android.util.Log.DEBUG))
            android.util.Log.d(DEBUG_TAG, "level ${data?.optString("videoId")} correction=$known volume=${attenuation(data)} boostMb=${Loudness.boostMb(data?.optString("videoId"))}")
        val gain = if (known != null) Loudness.boostMb(data?.optString("videoId"))
            else if (data?.optJSONArray("tags")?.toString()?.contains(Regex("live|bootleg")) == true) 400 else 0
        val id = player.audioSessionId
        val current = enhancers[player]
        if (gain == 0 || id == C.AUDIO_SESSION_ID_UNSET) { current?.let { runCatching { it.enabled = false } }; return }
        try {
            val enhancer = current?.takeIf { enhancerSessions[player] == id } ?: run {
                current?.release()
                LoudnessEnhancer(id).also { enhancers[player] = it; enhancerSessions[player] = id }
            }
            enhancer.setTargetGain(gain)
            enhancer.enabled = true
        } catch (_: Exception) { }
    }
    private val enhancerSessions = mutableMapOf<ExoPlayer, Int>()
    /** Player volume for a song with «Volumen parejo»: loud songs are turned down to the reference. */
    private fun attenuation(data: JSONObject?) = Loudness.attenuation(data?.optString("videoId"))
    private fun item(url: String, data: JSONObject, mime: String? = null) = MediaItem.Builder().setUri(url).setMimeType(mime).setMediaId(data.optString("id"))
        .setCustomCacheKey(MediaCache.key(url, data.optString("videoId"))).setMediaMetadata(MediaMetadata.Builder().setTitle(data.optString("title")).setArtist(data.optString("artist")).setCover(data).build()).build()
    fun play(url: String, data: JSONObject) = playSources(listOf(PlaybackSource(url)), data)
    private fun sourcesFor(data:JSONObject):List<PlaybackSource> {
        val local=data.optString("offlinePath")
        if(local.isNotBlank()) {
            val file=java.io.File(local)
            val root=java.io.File(filesDir,"offline_tracks").canonicalPath+java.io.File.separator
            if(file.canonicalPath.startsWith(root) && file.isFile)return listOf(PlaybackSource(file.absolutePath))
        }
        return NativeNetwork.resolveAudio(data.getString("videoId")).sources
    }
    fun playSources(sources: List<PlaybackSource>, data: JSONObject, recovery:Boolean=false,rememberTrack:Boolean=true,startPosition:Long=0) {
        if(!recovery&&rememberTrack)remember(data)
        volumeFade?.cancel()
        sourceEpoch++
        if(!recovery)refreshedSource=false
        if(spotifyActive){spotifyIntegrated.deactivate();spotifyActive=false;sessionPlayer(primaryPlayer)}
        val first = sources.firstOrNull() ?: error("No hay un formato de audio reproducible")
        recoveryPositionMs = null
        fade?.cancel(); fade = null; preparing?.cancel(); secondaryPlayer.stop(); secondaryPlayer.clearMediaItems(); nextTrack = null; pendingTrack = null; chainedTrack = null
        sourceTrackId = data.optString("id"); sourceAttempts = 1; alternatives.clear(); alternatives.addAll(sources.drop(1))
        track = data; primaryPlayer.volume = baseGain()
        primaryPlayer.setMediaItem(item(first.uri, data, first.mime), startPosition); primaryPlayer.prepare(); primaryPlayer.play(); configureEnhancer(primaryPlayer, data)
        lookUpLevel(data)
        updateMediaButtons()
    }
    private fun entryIdentity(data:JSONObject?) = data?.optString("queueId")?.takeIf{it.isNotBlank()} ?: data?.optString("id").orEmpty()
    fun snapshotQueue(): org.json.JSONArray { val result = org.json.JSONArray();played.forEach{result.put(it)}; track?.let { result.put(it) }; upcoming.forEach { result.put(it) }; return result }
    fun setUpcoming(tracks: List<JSONObject>,previous:List<JSONObject>?=null) {if(previous!=null){played.clear();played.addAll(previous.takeLast(100))}; if (entryIdentity(tracks.firstOrNull()) != entryIdentity(nextTrack ?: pendingTrack ?: chainedTrack)) { cancelOverlap(); preparing?.cancel(); pendingTrack = null; nextTrack = null; clearChain(); secondaryPlayer.stop(); secondaryPlayer.clearMediaItems() }; upcoming = tracks.toMutableList();updateMediaButtons() }
    fun beginSelection(ticket: Long) {
        selectionPending = ticket
        sourceEpoch++
        recoveryPositionMs = null
        cancelOverlap()
    }

    fun finishSelection(ticket: Long) {
        if (selectionPending == ticket) selectionPending = null
    }

    private fun cancelOverlap() {
        val active = fade ?: return
        fade = null
        active.cancel()
        secondaryPlayer.pause()
        secondaryPlayer.seekTo(0)
        secondaryPlayer.volume = 0f
        primaryPlayer.volume = baseGain()
    }

    /**
     * The next entry appended to the primary player's own playlist. ExoPlayer then moves into it on
     * the same AudioTrack, so the last sample of one song meets the first of the next with no gap:
     * the 2.8.0 two-player handoff opened a new AudioTrack per song, which was audible on albums.
     */
    private var chainedTrack: JSONObject? = null

    /** Gapless when Auto-Mix is off, and always inside an album, where songs are meant to run together. */
    fun wantsGapless(current: JSONObject?, next: JSONObject): Boolean {
        if (sleepAtTrackEnd) return false
        if (mode == "off") return true
        val albumId = current?.optString("albumId").orEmpty()
        if (albumId.isNotBlank() && albumId == next.optString("albumId")) return true
        val album = current?.optString("album")?.trim()?.lowercase().orEmpty()
        return album.isNotBlank() && album == next.optString("album").trim().lowercase() &&
            current?.optString("artist").orEmpty().equals(next.optString("artist"), ignoreCase = true)
    }

    private fun chainNext(source: PlaybackSource, data: JSONObject) {
        clearChain()
        if (spotifyActive || primaryPlayer.mediaItemCount != 1) return
        primaryPlayer.addMediaItem(item(source.uri, data, source.mime))
        chainedTrack = data
        pendingTrack = null
    }

    private fun clearChain() {
        chainedTrack = null
        if (!::primaryPlayer.isInitialized) return
        while (primaryPlayer.mediaItemCount > primaryPlayer.currentMediaItemIndex + 1)
            primaryPlayer.removeMediaItem(primaryPlayer.mediaItemCount - 1)
    }

    /** The player entered the chained entry (naturally or by Siguiente): make it the current track. */
    private fun adoptChained(target: JSONObject) {
        chainedTrack = null
        while (primaryPlayer.currentMediaItemIndex > 0) primaryPlayer.removeMediaItem(0)
        remember(target)
        track = target
        if (entryIdentity(upcoming.firstOrNull()) == entryIdentity(target)) upcoming.removeAt(0)
        sourceEpoch++
        recoveryPositionMs = null
        sourceTrackId = target.optString("id")
        refreshedSource = false
        sourceAttempts = 1
        alternatives.clear()
        nextTrack = null
        pendingTrack = null
        tailIdentity = ""
        // Gapless: the new song's level as it starts.
        if (fade == null && volumeFade?.isActive != true) primaryPlayer.volume = baseGain()
        configureEnhancer(primaryPlayer, target)
        updateMediaButtons()
        emitNativeTrack(target)
    }

    fun playPrepared(data: JSONObject, announce: Boolean = false): Boolean {
        if (chainedTrack != null && entryIdentity(data) == entryIdentity(chainedTrack) && primaryPlayer.mediaItemCount > 1) {
            cancelOverlap()
            primaryPlayer.seekTo(primaryPlayer.currentMediaItemIndex + 1, 0)
            primaryPlayer.play()
            return true
        }
        if (entryIdentity(data) != entryIdentity(nextTrack)) return false
        cancelOverlap()
        val state = secondaryPlayer.playbackState
        // A preload that is still buffering keeps its progress: promoting it is faster than a cold start.
        if (state != Player.STATE_READY && state != Player.STATE_BUFFERING) return false
        if (secondaryPlayer.currentPosition > PRELOAD_START_TOLERANCE_MS) secondaryPlayer.seekTo(0)
        promotePrepared(data, announce)
        return true
    }

    fun preloadSource(source: PlaybackSource, data: JSONObject) {
        if (fade != null) return
        // The standby player may be a former primary whose playWhenReady is still true:
        // without this it would play the next song silently and enter it a minute late.
        secondaryPlayer.playWhenReady = false
        secondaryPlayer.setMediaItem(item(source.uri, data, source.mime), 0L)
        secondaryPlayer.volume = 0f
        secondaryPlayer.prepare()
        configureEnhancer(secondaryPlayer, data)
        nextTrack = data
        pendingTrack = null
    }

    fun seekYouTube(position: Long) {
        if (spotifyActive) return
        cancelOverlap()
        val target = position.coerceAtLeast(0)
        if (recoveryPositionMs != null) recoveryPositionMs = target
        else primaryPlayer.seekTo(target)
    }

    fun setMode(value: String) {
        mode = value
        if (value == "off") {
            cancelOverlap()
            if (!spotifyActive && primaryPlayer.playWhenReady && primaryPlayer.playbackState == Player.STATE_ENDED && selectionPending == null) advanceAfterEnd()
        }
    }

    fun pausePlayback() {
        sourceEpoch++
        recoveryPositionMs = null
        selectionPending = null
        preparing?.cancel()
        pendingTrack = null
        if (spotifyActive) spotifyIntegrated.pauseIntegrated()
        cancelOverlap()
        volumeFade?.cancel()
        primaryPlayer.pause()
        secondaryPlayer.pause()
        secondaryPlayer.seekTo(0)
        primaryPlayer.volume = baseGain()
        secondaryPlayer.volume = 0f
    }
    /** Extra level while the presenter or a spoken answer talks (1 = normal), eased in and out. */
    private var talkGain = 1f
    private var talkFade: Job? = null
    /** Level the players sit at when nothing else fades them: listening duck × presenter dip. */
    private fun baseGain() = levelGain() * attenuation(track)
    /** Listening duck × presenter dip, without the song's own level. */
    private fun levelGain() = (if (ducking) DUCK_GAIN else 1f) * talkGain

    /**
     * Presenter voice over the music: the song dips to [TALK_GAIN] in 0.3 s and, when the voice
     * ends, comes back to normal in 0.8 s (like a radio host talking over an intro).
     */
    fun setTalkOver(value: Boolean) {
        val target = if (value) TALK_GAIN else 1f
        talkFade?.cancel()
        talkFade = scope.launch {
            if (!value) delay(250)
            val from = talkGain
            val duration = if (value) 300L else 800L
            val start = android.os.SystemClock.elapsedRealtime()
            while (isActive) {
                val p = ((android.os.SystemClock.elapsedRealtime() - start).toFloat() / duration).coerceIn(0f, 1f)
                val eased = p * p * (3 - 2 * p)
                talkGain = from + (target - from) * eased
                // Auto-Mix fades and the sleep fade apply baseGain() themselves on every step.
                // Both engines follow the same level: the song may switch between Spotify and YouTube
                // while the presenter talks (it speaks right at the change), and must come back on either.
                if (fade == null && volumeFade?.isActive != true) primaryPlayer.volume = baseGain()
                if (integratedDelegate.isInitialized()) nativeIntegrated.talk(talkGain)
                if (webDelegate.isInitialized()) webIntegrated.talk(talkGain)
                if (p >= 1f) break
                delay(30)
            }
            if (android.util.Log.isLoggable(DEBUG_TAG, android.util.Log.DEBUG))
                android.util.Log.d(DEBUG_TAG, "talkover ${if (value) "down" else "up"} gain=$talkGain volume=${primaryPlayer.volume}")
        }
    }

    fun setDucking(value: Boolean) {
        if(spotifyActive)spotifyIntegrated.duck(value)
        if (value == ducking) return
        val ratio = if (value) DUCK_GAIN else 1f / DUCK_GAIN
        ducking = value
        primaryPlayer.volume = (primaryPlayer.volume * ratio).coerceIn(0f, 1f)
        secondaryPlayer.volume = (secondaryPlayer.volume * ratio).coerceIn(0f, 1f)
    }
    fun sleep(minutes: Int) { if (minutes == -1) { fadeVolume(5000); return }; if (minutes == SLEEP_AT_TRACK_END) { sleepAt = 0; sleepAtTrackEnd = true; clearChain(); return }; sleepAtTrackEnd = false; if(minutes<=0){volumeFade?.cancel();if(spotifyActive)spotifyIntegrated.fadeGain(1f);if(fade==null)primaryPlayer.volume=baseGain()}; sleepAt = if (minutes <= 0) 0 else System.currentTimeMillis() + minutes * 60_000L }
    private fun fadeVolume(duration: Long) {
        volumeFade?.cancel();val native=spotifyActive;val id=track?.optString("id")
        volumeFade=scope.launch {val initial=primaryPlayer.volume;val start=android.os.SystemClock.elapsedRealtime()
            while(isActive && android.os.SystemClock.elapsedRealtime()-start<duration){if(native!=spotifyActive || track?.optString("id")!=id){if(native)spotifyIntegrated.fadeGain(1f)else primaryPlayer.volume=baseGain();return@launch};val p=(android.os.SystemClock.elapsedRealtime()-start).toFloat()/duration;val gain=(1-p).pow(2);if(native)spotifyIntegrated.fadeGain(gain)else primaryPlayer.volume=initial*gain;delay(30)}
            if(native)spotifyIntegrated.pauseIntegrated()else primaryPlayer.pause();if(native)spotifyIntegrated.fadeGain(1f)else primaryPlayer.volume=baseGain()
        }
    }
    private fun finishSleepAtTrackEnd(): Boolean {
        if (!sleepAtTrackEnd) return false
        sleepAtTrackEnd = false
        PlaybackRequests.next()
        pausePlayback()
        NativeEvents.emit("onSleepTimerFinished", JSObject().put("reason", "track_end"))
        return true
    }
    private fun spotifyTrackEnded() { if (!finishSleepAtTrackEnd()) advanceNative() }
    private fun advanceAfterEnd() {
        if (finishSleepAtTrackEnd()) return
        if (upcoming.isNotEmpty()) advanceNative()
        else NativeEvents.emit("onTrackEnded", JSObject().put("trackId", track?.optString("id"))
            .put("queueId", track?.optString("queueId")))
    }

    fun manualMix() {
        if (mode == "off" || !startOverlap(4_000)) advanceNative()
    }

    private fun promotePrepared(target: JSONObject, announce: Boolean) {
        val outgoing = primaryPlayer
        if (spotifyActive) {
            spotifyIntegrated.deactivate()
            spotifyActive = false
        }
        outgoing.removeListener(listener)
        chainedTrack = null
        // stop() keeps playWhenReady; clear it so the next preload on this player stays silent and parked.
        outgoing.playWhenReady = false
        outgoing.stop()
        outgoing.clearMediaItems()
        outgoing.setAudioAttributes(audioAttributes(), false)
        primaryPlayer = secondaryPlayer
        secondaryPlayer = outgoing
        remember(target)
        track = target
        nextTrack = null
        pendingTrack = null
        if (entryIdentity(upcoming.firstOrNull()) == entryIdentity(target)) upcoming.removeAt(0)
        sourceEpoch++
        recoveryPositionMs = null
        sourceTrackId = target.optString("id")
        refreshedSource = false
        sourceAttempts = 1
        alternatives.clear()
        primaryPlayer.setAudioAttributes(audioAttributes(), true)
        primaryPlayer.volume = baseGain()
        secondaryPlayer.volume = 0f
        attach(primaryPlayer)
        primaryPlayer.play()
        configureEnhancer(primaryPlayer, target)
        sessionPlayer(primaryPlayer)
        if (announce) emitNativeTrack(target)
    }

    private fun startOverlap(duration: Long, force: Boolean = false): Boolean {
        val target = nextTrack ?: return false
        if ((mode == "off" && !force) || fade != null || spotifyActive || !primaryPlayer.isPlaying ||
            secondaryPlayer.playbackState != Player.STATE_READY || selectionPending != null ||
            entryIdentity(upcoming.firstOrNull()) != entryIdentity(target)) return false
        if (secondaryPlayer.currentPosition > PRELOAD_START_TOLERANCE_MS) {
            // Never mix in a preload that drifted from its start; rewind and let the end handoff take it.
            secondaryPlayer.playWhenReady = false
            secondaryPlayer.seekTo(0)
            return false
        }
        fade = scope.launch {
            val outgoing = primaryPlayer
            val incoming = secondaryPlayer
            incoming.play()
            val started = android.os.SystemClock.elapsedRealtime()
            while (isActive) {
                if (incoming.playbackState != Player.STATE_READY || !outgoing.playWhenReady) {
                    cancelOverlap()
                    if (outgoing.playWhenReady && outgoing.playbackState == Player.STATE_ENDED) advanceAfterEnd()
                    return@launch
                }
                val fraction = ((android.os.SystemClock.elapsedRealtime() - started).toDouble() / duration).coerceIn(0.0, 1.0)
                val gains = AutoMixCurve.gains(fraction)
                val level = levelGain()
                outgoing.volume = gains.first * level * attenuation(track)
                incoming.volume = gains.second * level * attenuation(target)
                if (fraction >= 1) break
                delay(25)
            }
            fade = null
            promotePrepared(target, announce = true)
        }
        return true
    }
    // ---------- Beat-aligned Auto-Mix ----------
    private val beatTimes = ArrayDeque<Long>()
    private var beatIdentity = ""
    private var beatMixFor = ""
    private var sampling = false
    private val beatSampler = object : Runnable {
        override fun run() {
            if (!sampling) return
            val identity = entryIdentity(track)
            if (identity != beatIdentity) { beatIdentity = identity; beatTimes.clear() }
            val spectrum = visualSpectrum(System.nanoTime())
            if (spectrum.beat) {
                beatTimes.addLast(android.os.SystemClock.elapsedRealtime())
                while (beatTimes.size > 48) beatTimes.removeFirst()
            }
            handler.postDelayed(this, 30)
        }
    }
    private fun startBeatSampling() { if (!sampling) { sampling = true; handler.post(beatSampler) } }
    private fun stopBeatSampling() { sampling = false; handler.removeCallbacks(beatSampler) }

    /**
     * The track's beat period from the last onsets: the median interval, only when the pulse is steady
     * (most intervals within 12 % of it) and plausible (40–240 BPM). Null for ballads and loose intros.
     */
    private fun beatPeriodMs(): Long? {
        if (beatIdentity != entryIdentity(track) || beatTimes.size < 8) return null
        val times = beatTimes.toList()
        val intervals = times.zipWithNext { a, b -> b - a }.filter { it in 250..1500 }
        if (intervals.size < 6) return null
        val median = intervals.sorted()[intervals.size / 2]
        val steady = intervals.count { kotlin.math.abs(it - median) <= median * 0.12 }
        return if (steady >= intervals.size * 0.6) median else null
    }

    /** Starts the crossfade on the next predicted beat, lasting a whole number of beats. */
    private fun scheduleBeatMix(fadeMs: Long, period: Long) {
        val identity = entryIdentity(track)
        if (beatMixFor == identity || fade != null) return
        val last = beatTimes.lastOrNull() ?: return
        val now = android.os.SystemClock.elapsedRealtime()
        var next = last
        while (next < now + 40) next += period
        beatMixFor = identity
        handler.postDelayed({
            if (entryIdentity(track) == identity && fade == null) startOverlap(fadeMs)
        }, next - now)
    }

    private var tailIdentity = ""
    private var quietSince = 0L
    private var signalIdentity = ""
    private val tailHandoff = Runnable {
        val scheduled = tailIdentity
        tailIdentity = ""
        if (spotifyActive || fade != null || selectionPending != null || sleepAtTrackEnd ||
            volumeFade?.isActive == true || scheduled != entryIdentity(track)) return@Runnable
        val duration = primaryPlayer.duration.takeIf { it > 0 } ?: return@Runnable
        // A seek after scheduling moves the end away; the ticker schedules a new handoff later.
        if (duration - primaryPlayer.currentPosition > TAIL_HANDOFF_MS * 3) return@Runnable
        startOverlap(TAIL_HANDOFF_MS, force = true)
    }
    /** Hands over a few hundred milliseconds early so the next track starts with no audible gap. */
    private fun watchTail(duration: Long, remaining: Long, now: Long) {
        if (spotifyActive || !primaryPlayer.isPlaying || fade != null || duration <= 0 || nextTrack == null ||
            sleepAtTrackEnd || volumeFade?.isActive == true) { quietSince = 0; return }
        val identity = entryIdentity(track)
        if (remaining in 1..1_600 && tailIdentity != identity) {
            tailIdentity = identity
            handler.removeCallbacks(tailHandoff)
            handler.postDelayed(tailHandoff, (remaining - TAIL_HANDOFF_MS).coerceAtLeast(0))
        }
        val level = visualAmplitude
        if (level > SILENT_TAIL * 8) signalIdentity = identity
        if (signalIdentity != identity || duration < 30_000 || remaining !in 1..6_000 || level >= SILENT_TAIL) {
            quietSince = 0
            return
        }
        if (quietSince == 0L) quietSince = now
        else if (now - quietSince >= 700) {
            quietSince = 0
            startOverlap(if (mode == "off") 450 else minOf(if (mode == "dj") 10_000L else 5_000L, remaining.coerceAtLeast(800)), force = true)
        }
    }
    private val connectivity by lazy { getSystemService(android.net.ConnectivityManager::class.java) }
    /** On mobile data a quick skip should not have paid for the next song: wait a few seconds first. */
    private fun meteredNetwork() = runCatching { connectivity?.isActiveNetworkMetered == true }.getOrDefault(false)
    private var tickCount = 0L
    private var lastProgress = ""
    /** Something time-critical is happening: transitions, preloads and fades need the fast tick. */
    private val busy get() = (!spotifyActive && (primaryPlayer.isPlaying || youtubeLoading)) ||
        (spotifyActive && spotifyIntegrated.playing) || fade != null || preparing?.isActive == true
    /**
     * Measures a song YouTube gave no level for: the tapped RMS (before the player's volume and the
     * enhancer) over its first seconds, ignoring silence. At 25 s of sound the level is applied, eased
     * in, and kept for next time. Songs with YouTube's level are also measured once, only to log both
     * numbers (calibration of [Loudness.measureOffsetDb], adb setprop log.tag.MURMUR DEBUG).
     */
    private var measuring = ""
    private var measureSum = 0.0
    private var measureCount = 0
    private val loudnessSampler = object : Runnable {
        override fun run() {
            if (::primaryPlayer.isInitialized && !spotifyActive && primaryPlayer.isPlaying && fade == null) {
                val data = track
                val videoId = data?.optString("videoId").orEmpty()
                val identity = entryIdentity(data)
                if (identity != measuring) { measuring = identity; measureSum = 0.0; measureCount = 0 }
                val rms = meters[primaryPlayer]?.amplitude ?: 0f
                if (videoId.isNotBlank() && measureCount >= 0 && rms > 0.003f) {
                    measureSum += rms.toDouble() * rms
                    measureCount++
                    if (measureCount == MEASURE_SAMPLES) {
                        val estimate = Loudness.fromMeanSquare(measureSum / measureCount)
                        val reported = Loudness.known(videoId)
                        if (android.util.Log.isLoggable(DEBUG_TAG, android.util.Log.DEBUG))
                            android.util.Log.d(DEBUG_TAG, "loudness $videoId youtube=$reported measured=$estimate rmsOffset=${Loudness.measureOffsetDb}")
                        if (reported == null && !estimate.isNaN()) {
                            Loudness.measure(videoId, estimate)
                            applyMeasuredLevel(data!!)
                        }
                        measureCount = -1 // done with this song
                    }
                }
            }
            handler.postDelayed(this, 100)
        }
    }
    /**
     * A downloaded song plays from the phone, so YouTube was not asked: its level is looked up once in
     * the background (and kept); meanwhile the song plays as it is.
     */
    private fun lookUpLevel(data: JSONObject) {
        val videoId = data.optString("videoId")
        if (data.optString("offlinePath").isBlank() || !videoId.matches(Regex("[A-Za-z0-9_-]{11}")) ||
            Loudness.known(videoId) != null || !Loudness.enabled()) return
        scope.launch {
            val found = withContext(Dispatchers.IO) { runCatching { NativeNetwork.extract(videoId) }.isSuccess && Loudness.known(videoId) != null }
            if (found) applyMeasuredLevel(data)
        }
    }
    /** A level just learned for the song that plays: eased in over a second, never a jump. */
    private fun applyMeasuredLevel(data: JSONObject) {
        if (entryIdentity(data) != entryIdentity(track)) return
        configureEnhancer(primaryPlayer, data)
        if (fade != null || volumeFade?.isActive == true) return
        val from = primaryPlayer.volume
        scope.launch {
            val start = android.os.SystemClock.elapsedRealtime()
            while (isActive && entryIdentity(data) == entryIdentity(track) && fade == null) {
                val p = ((android.os.SystemClock.elapsedRealtime() - start) / 1200f).coerceIn(0f, 1f)
                primaryPlayer.volume = from + (baseGain() - from) * p * p * (3 - 2 * p)
                if (p >= 1f) break
                delay(40)
            }
        }
    }
    /** «Volumen parejo» switched in Opciones: the song that plays follows at once. */
    fun refreshLoudness() {
        if (!::primaryPlayer.isInitialized || spotifyActive) return
        configureEnhancer(primaryPlayer, track)
        if (fade == null && volumeFade?.isActive != true) primaryPlayer.volume = baseGain()
    }
    private val ticker = object : Runnable {
        override fun run() {
            if (::primaryPlayer.isInitialized) {
                tickCount++
                playingAnyThread = if (spotifyActive) spotifyIntegrated.playing else primaryPlayer.isPlaying
                val duration = primaryPlayer.duration.takeIf { it > 0 } ?: 0L; val position = youtubePositionMs
                // Progress wakes the WebView: every 500 ms on screen, every 2 s in the background,
                // and only on change while paused, so an idle or locked phone does no repaint work.
                val progress = "${track?.optString("queueId")}:${position / 500}:$duration"
                val playingNow = !spotifyActive && (primaryPlayer.isPlaying || youtubeLoading)
                val due = if (playingNow) uiVisible || tickCount % 4 == 0L else progress != lastProgress
                if (!spotifyActive && due) {
                    lastProgress = progress
                    NativeEvents.emit("onPlaybackProgress", JSObject().put("trackId",track?.optString("id")).put("queueId",track?.optString("queueId")).put("positionMs", position).put("durationMs", duration))
                }
                val remaining = duration - position; val next = upcoming.firstOrNull()
                val now = android.os.SystemClock.elapsedRealtime()
                if ((primaryPlayer.isPlaying && !spotifyActive || spotifyActive && spotifyIntegrated.playing) &&
                    selectionPending == null && next?.optString("source") == "youtube" &&
                    nextTrack == null && pendingTrack == null && chainedTrack == null && fade == null && now >= preloadRetryAt &&
                    (!meteredNetwork() || position >= METERED_PRELOAD_AFTER_MS || remaining in 1..90_000)) {
                    pendingTrack = next
                    preparing = scope.launch {
                        try {
                            val source = withContext(Dispatchers.IO) { sourcesFor(next).first() }
                            if (pendingTrack === next && entryIdentity(upcoming.firstOrNull()) == entryIdentity(next)) {
                                if (!spotifyActive && wantsGapless(track, next)) chainNext(source, next) else preloadSource(source, next)
                            }
                        } catch (failure: Exception) {
                            if (failure !is CancellationException) preloadRetryAt = android.os.SystemClock.elapsedRealtime() + 8_000
                        } finally {
                            if (pendingTrack === next) pendingTrack = null
                        }
                    }
                }
                if (nextTrack != null && secondaryPlayer.playerError != null && fade == null) {
                    // The cached link is what failed; the retry must resolve a fresh one.
                    nextTrack?.optString("videoId")?.takeIf { it.isNotBlank() }?.let(NativeNetwork::forget)
                    nextTrack = null
                    secondaryPlayer.clearMediaItems()
                    preloadRetryAt = now + 8_000
                }
                val fadeMs = minOf(if (mode == "dj") 10_000L else 5_000L, duration / 3)
                if (sleepAtTrackEnd && !spotifyActive && primaryPlayer.isPlaying && fade == null && duration > 0 && remaining in 1..6_000) {
                    // Close the track softly just before its end so a later Play resumes instead of ending.
                    sleepAtTrackEnd = false
                    fadeVolume(maxOf(1_200L, remaining - 400))
                    NativeEvents.emit("onSleepTimerFinished", JSObject().put("reason", "track_end"))
                }
                val mixing = !sleepAtTrackEnd && volumeFade?.isActive != true && !spotifyActive && mode != "off" && nextTrack != null
                // Listen for the beat in the last 25 s so the mix can land on the music's pulse.
                if (mixing && primaryPlayer.isPlaying && remaining in 1..25_000) startBeatSampling() else if (remaining > 25_000 || !mixing) stopBeatSampling()
                val period = beatPeriodMs()
                val beatFade = period?.let { (it * (if (mode == "dj") 16 else 8)).coerceIn(3_000L, if (mode == "dj") 12_000L else 7_000L).coerceAtMost(duration / 3) }
                if (mixing && beatFade != null && period != null && remaining in 1..(beatFade + period * 2)) scheduleBeatMix(beatFade, period)
                else if (mixing && beatFade == null && remaining in 1..fadeMs) startOverlap(fadeMs)
                watchTail(duration, remaining, now)
                if (sleepAt > 0 && System.currentTimeMillis() >= sleepAt - 15_000) { sleepAt = 0; fadeVolume(15_000); NativeEvents.emit("onSleepTimerFinished", JSObject().put("reason", "timer")) }
                // Home-screen widget: compares a small key, redraws only when song or play state changed.
                MurmurWidget.sync(this@HybridMediaService)
            }
            handler.postDelayed(this, if (!::primaryPlayer.isInitialized || busy || sleepAt > 0) 500 else 2_000)
        }
    }
    override fun onTaskRemoved(rootIntent: Intent?) { PlaybackRequests.next();pausePlayback();preparing?.cancel();stopForeground(STOP_FOREGROUND_REMOVE);stopSelf();super.onTaskRemoved(rootIntent) }
    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaLibrarySession? = session
    override fun onDestroy() { if(integratedDelegate.isInitialized())nativeIntegrated.shutdown();if(webDelegate.isInitialized())webIntegrated.shutdown();handler.removeCallbacksAndMessages(null); scope.cancel(); enhancers.values.forEach { runCatching { it.release() } }; session?.release(); primaryPlayer.release(); secondaryPlayer.release(); instance = null; MurmurWidget.sync(this); super.onDestroy() }
}
