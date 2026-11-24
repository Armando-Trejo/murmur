package com.personal.murmur

import android.content.Intent
import androidx.core.content.ContextCompat
import com.getcapacitor.*
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.*
import org.schabi.newpipe.extractor.ServiceList
import org.schabi.newpipe.extractor.search.SearchInfo
import org.schabi.newpipe.extractor.stream.StreamInfoItem
import org.json.JSONObject
import org.json.JSONArray
import java.io.File

@CapacitorPlugin(name = "YouTubeAudio")
class YouTubeAudioPlugin : Plugin() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    override fun load() { NativeEvents.attach(this); NativeNetwork.init() }
    fun emit(event: String, data: JSObject) { notifyListeners(event, data, event in setOf("onSharedUrlReceived", "onVoiceCommandCaptured", "onVoiceError", "onShortcutReceived", "onAuthChanged", "onAuthError", "onSpotifyEngineAuthorized","onOpenPlayer","onAppBackground")) }
    private fun async(call: PluginCall, block: suspend () -> JSObject?) { scope.launch { try { val result = block(); call.resolve(result ?: JSObject()) } catch (e: ProviderFailure) { call.reject(e.message ?: "No se pudo abrir el audio", e.code) }
        catch (e: Exception) { call.reject(e.message ?: "No se pudo completar la operación", e) } } }
    private suspend fun service(): HybridMediaService { HybridMediaService.instance?.let { return it }; ContextCompat.startForegroundService(context, Intent(context, HybridMediaService::class.java)); repeat(60) { HybridMediaService.instance?.let { return it }; delay(50) }; error("El servicio de audio no inició") }
    private fun data(call: PluginCall) = JSONObject(call.data.toString())
    @PluginMethod fun setLockVisualizer(call: PluginCall) { LockVisualizer.set(context, call.getBoolean("enabled") ?: true); call.resolve() }
    @PluginMethod fun getLockVisualizer(call: PluginCall) { call.resolve(JSObject().put("enabled", LockVisualizer.enabled(context))) }
    @PluginMethod fun openVisualizer(call: PluginCall) { activity.startActivity(Intent(context, MusicVisualActivity::class.java)); call.resolve() }
    @PluginMethod fun openGeniusLyrics(call: PluginCall) {
        val uri = android.net.Uri.parse(call.getString("url").orEmpty())
        if (uri.scheme != "https" || uri.encodedAuthority != "genius.com" || uri.path != "/search") {
            call.reject("Enlace de Genius inválido.")
            return
        }
        try {
            activity.startActivity(Intent(Intent.ACTION_VIEW, uri))
            call.resolve()
        } catch (_: android.content.ActivityNotFoundException) {
            call.reject("No se pudo abrir Genius en el navegador.")
        }
    }

    @PluginMethod fun openProviderHome(call: PluginCall) {
        val url = if (call.getString("provider") == "spotify") "https://open.spotify.com/" else "https://music.youtube.com/"
        activity.startActivity(Intent(Intent.ACTION_VIEW, android.net.Uri.parse(url)))
        call.resolve()
    }
    @PluginMethod fun openYouTubeArtist(call: PluginCall) {
        val id = call.getString("id").orEmpty()
        if (!id.matches(Regex("UC[A-Za-z0-9_-]{10,120}"))) {
            call.reject("Identificador de artista inválido.")
            return
        }
        try {
            activity.startActivity(Intent(Intent.ACTION_VIEW, android.net.Uri.parse("https://music.youtube.com/channel/$id")))
            call.resolve()
        } catch (_: android.content.ActivityNotFoundException) {
            call.reject("No se pudo abrir YouTube Music.")
        }
    }
    @PluginMethod fun openProviderSearch(call: PluginCall) {
        val query=android.net.Uri.encode(call.getString("query").orEmpty().take(250))
        val url=if(call.getString("provider")=="spotify") "https://open.spotify.com/search/$query" else "https://www.youtube.com/results?search_query=$query"
        activity.startActivity(Intent(Intent.ACTION_VIEW,android.net.Uri.parse(url)));call.resolve()
    }
    @PluginMethod fun searchYouTube(call: PluginCall) = async(call) {
        val query = call.getString("query")?.trim()?.take(250) ?: error("Escribe una búsqueda")
        val tracks = withContext(Dispatchers.IO) {
            NativeNetwork.init(); val info = SearchInfo.getInfo(ServiceList.YouTube, ServiceList.YouTube.searchQHFactory.fromQuery(query, emptyList(), "")); val list = JSArray()
            info.relatedItems.filterIsInstance<StreamInfoItem>().forEach { t ->
                val id = android.net.Uri.parse(t.url).getQueryParameter("v") ?: t.url.substringAfterLast('/')
                if (id.matches(Regex("[A-Za-z0-9_-]{11}"))) list.put(JSObject().put("id", "yt:$id").put("videoId", id).put("source", "youtube").put("title", t.name).put("artist", "Artista por identificar").put("channelTitle", t.uploaderName).put("duration", t.duration).put("artworkUrl", t.thumbnails.maxByOrNull { it.height }?.url ?: "").put("viewCount",t.viewCount.takeIf{it>=0}).put("tags", JSArray()))
            }; list
        }; JSObject().put("tracks", tracks)
    }
    @PluginMethod fun getTrackInfo(call: PluginCall) = async(call) { val id = call.getString("videoId") ?: error("Falta ID"); val info = withContext(Dispatchers.IO) { NativeNetwork.extract(id) }; JSObject().put("track", JSObject().put("id", "yt:$id").put("videoId", id).put("source", "youtube").put("title", info.name).put("artist", "Artista por identificar").put("duration", info.duration).put("description", info.description.content).put("artworkUrl", info.thumbnails.maxByOrNull { it.height }?.url ?: "").put("tags", JSArray())) }
    @PluginMethod fun lookupArtist(call: PluginCall) = async(call) { val name = call.getString("artist")?.take(200) ?: error("Falta artista"); val result = withContext(Dispatchers.IO) { MusicMetadata.artist(name) }; JSObject(result.toString()) }
    @PluginMethod fun extractAndPlay(call: PluginCall) = async(call) {
        val generation = PlaybackRequests.next()
        val currentService = HybridMediaService.instance
        currentService?.beginSelection(generation)
        try {
            val refresh = call.getBoolean("refreshSource") == true
            val position = if (refresh) (call.getDouble("positionMs") ?: 0.0).toLong().coerceAtLeast(0) else 0L
            val data = data(call).apply { remove("refreshSource"); remove("positionMs") }
            val local = call.getString("offlinePath")?.let(::File)
            val root = File(context.filesDir, "offline_tracks").canonicalPath + File.separator
            var duration = data.optDouble("duration", 0.0)
            var description = data.optString("description")
            val playerService = if (!refresh && currentService?.playPrepared(data) == true) currentService else {
                val sources = if (local != null && local.canonicalPath.startsWith(root) && local.isFile) {
                    listOf(PlaybackSource(local.absolutePath))
                } else {
                    val info = withContext(Dispatchers.IO) {
                        NativeNetwork.resolveAudio(call.getString("videoId") ?: error("Falta el ID"), forceRefresh = refresh)
                    }
                    duration = info.duration.toDouble()
                    description = info.description
                    info.sources
                }
                check(PlaybackRequests.isCurrent(generation)) { "Reproducción sustituida por otra solicitud" }
                service().also {
                    check(PlaybackRequests.isCurrent(generation)) { "Solicitud sustituida" }
                    it.playSources(sources, data, startPosition = position)
                }
            }
            val player = playerService.primaryPlayer
            JSObject().put("duration", duration).put("description", description)
                .put("playing", player.isPlaying)
                .put("loading", player.playWhenReady && !player.isPlaying)
        } catch (failure: Exception) {
            if (PlaybackRequests.isCurrent(generation)) currentService?.pausePlayback()
            throw failure
        } finally {
            currentService?.finishSelection(generation)
        }
    }
    @PluginMethod fun preloadNextStream(call: PluginCall) = async(call) { val ticket=PlaybackRequests.snapshot(); val d = data(call); val source = withContext(Dispatchers.IO) { val local = call.getString("offlinePath"); if (local != null && File(local).canonicalPath.startsWith(File(context.filesDir, "offline_tracks").canonicalPath + File.separator) && File(local).isFile) PlaybackSource(local) else NativeNetwork.resolveAudio(call.getString("videoId") ?: error("Falta el ID")).sources.first() }; if(PlaybackRequests.isCurrent(ticket)) service().preloadSource(source, d); null }
    /** Warms the link cache for likely next taps. Links only, at most 3, never audio bytes; failures are silent. */
    @PluginMethod fun prefetchAudio(call: PluginCall) {
        val array = call.getArray("videoIds") ?: JSArray()
        val ids = (0 until array.length()).mapNotNull { array.optString(it).takeIf { id -> id.matches(Regex("[A-Za-z0-9_-]{11}")) } }
            .distinct().take(3)
        call.resolve()
        if (ids.isEmpty()) return
        scope.launch(Dispatchers.IO) { ids.forEach { id -> runCatching { NativeNetwork.resolveAudio(id) } } }
    }
    @PluginMethod fun setQueue(call: PluginCall) = async(call) { val array = call.getArray("tracks") ?: JSArray(); val tracks = (0 until array.length()).map { array.getJSONObject(it) }; val previous=call.getArray("previous");val s=service();val expected=call.getString("currentQueueId");if(expected!=null && expected!=s.track?.optString("queueId"))return@async null;s.setUpcoming(tracks,previous?.let{(0 until it.length()).map{index->it.getJSONObject(index)}}); null }
    @PluginMethod fun pause(call: PluginCall) = async(call) { PlaybackRequests.next(); HybridMediaService.instance?.pausePlayback(); null }
    @PluginMethod fun resume(call: PluginCall) = async(call) { val s = HybridMediaService.instance ?: error("Elige una canción"); s.primaryPlayer.play(); null }
    @PluginMethod fun seekTo(call: PluginCall) = async(call) { HybridMediaService.instance?.seekYouTube((call.getDouble("positionMs") ?: 0.0).toLong()); null }
    @PluginMethod fun setAutoMixMode(call: PluginCall) = async(call) { val mode = call.getString("mode") ?: "off"; context.getSharedPreferences("playback", 0).edit().putString("mix_mode", mode).apply(); HybridMediaService.instance?.setMode(mode); null }
    @PluginMethod fun triggerManualMix(call: PluginCall) = async(call) { service().manualMix(); null }
    @PluginMethod fun setSleepTimer(call: PluginCall) = async(call) { service().sleep(call.getInt("minutes") ?: 0); null }
    @PluginMethod fun haptic(call: PluginCall) {
        val view = bridge?.webView ?: return call.resolve()
        val feedback = HapticPatterns.constant(call.getString("kind") ?: "tick", android.os.Build.VERSION.SDK_INT)
        view.post { view.performHapticFeedback(feedback) }
        call.resolve()
    }
    @PluginMethod fun setDucking(call: PluginCall) = async(call) { HybridMediaService.instance?.setDucking(call.getBoolean("ducking") ?: false); null }
    @PluginMethod fun getState(call: PluginCall) = async(call) { val s = HybridMediaService.instance; val integrated=if(s?.spotifyActive==true)s.integratedState()else null; val result = JSObject().put("playing", integrated?.optBoolean("is_playing") ?: s?.primaryPlayer?.isPlaying ?: false).put("positionMs", integrated?.optLong("progress_ms") ?: s?.youtubePositionMs ?: 0).put("durationMs", integrated?.optJSONObject("item")?.optLong("duration_ms") ?: s?.primaryPlayer?.duration ?: 0).put("loading",integrated?.optBoolean("loading")?:(s?.youtubeLoading ?: false)).put("transport",if(integrated!=null)"integrated" else "youtube"); s?.track?.let { result.put("track", it); result.put("queue", s.snapshotQueue()) }; result }
    @PluginMethod fun showVideo(call: PluginCall) { val id = call.getString("videoId") ?: return call.reject("Falta ID"); activity.startActivity(Intent(context, VideoActivity::class.java).putExtra("videoId", id)); call.resolve() }
    /** Smart downloads only run on an unmetered network (Wi-Fi/Ethernet), never on mobile data. */
    @PluginMethod fun networkState(call: PluginCall) {
        val manager = context.getSystemService(android.net.ConnectivityManager::class.java)
        val caps = manager?.getNetworkCapabilities(manager.activeNetwork)
        call.resolve(JSObject().put("online", caps != null).put("metered", manager?.isActiveNetworkMetered ?: true)
            .put("charging", context.registerReceiver(null, android.content.IntentFilter(Intent.ACTION_BATTERY_CHANGED))
                ?.getIntExtra(android.os.BatteryManager.EXTRA_PLUGGED, 0)?.let { it != 0 } ?: false))
    }
    /** Deletes one downloaded file, only inside MURMUR's own offline folder. */
    @PluginMethod fun deleteOfflineAudio(call: PluginCall) {
        val root = File(context.filesDir, "offline_tracks").canonicalFile
        val file = call.getString("path")?.let { File(it).canonicalFile }
        if (file == null || file.parentFile != root) return call.reject("Ruta de descarga inválida.")
        call.resolve(JSObject().put("deleted", !file.exists() || file.delete()))
    }
    @PluginMethod fun downloadOfflineAudio(call: PluginCall) = async(call) {
        val path = withContext(Dispatchers.IO) {
            val id = call.getString("videoId") ?: error("Falta ID"); val stream = NativeNetwork.downloadableAudio(NativeNetwork.extract(id)); val directory = File(context.filesDir, "offline_tracks").apply { mkdirs() }
            val suffix = if (stream.format?.suffix == "opus" || stream.format?.suffix == "webm") "webm" else "m4a"
            val name = (call.getString("fileName") ?: id).replace(Regex("[^A-Za-z0-9_-]"), "_").take(80)
            val target = File(directory, "$name-$id.$suffix"); val partial = File(directory, "$name-$id.part")
            try { NativeNetwork.client.newCall(okhttp3.Request.Builder().url(stream.content).build()).execute().use { response -> check(response.isSuccessful) { "La descarga respondió ${response.code}" }; response.body?.byteStream()?.use { input -> partial.outputStream().use { output -> val buffer = ByteArray(65536); var total = 0L; while (true) { val n = input.read(buffer); if (n < 0) break; total += n; check(total <= 1024L*1024*1024) { "Archivo demasiado grande" }; output.write(buffer, 0, n) } } } ?: error("Audio vacío") }; check(partial.renameTo(target)); target.absolutePath } finally { partial.delete() }
        }; JSObject().put("path", path)
    }
    @PluginMethod fun saveBackup(call: PluginCall) {
        val content = call.getString("content") ?: return call.reject("Respaldo vacío")
        if(BackupWriter.pending != null) return call.reject("Ya hay una exportación abierta")
        BackupWriter.pending = content
        BackupWriter.completion = { saved, error -> if(error != null) call.reject(error) else call.resolve(JSObject().put("saved",saved)) }
        try { activity.startActivity(Intent(context,BackupWriter::class.java)) } catch(e: Exception) { BackupWriter.pending = null; BackupWriter.completion = null; call.reject("No se pudo abrir el selector de archivos") }
    }
    override fun handleOnDestroy() { scope.cancel(); if (NativeEvents.plugin === this) NativeEvents.plugin = null; super.handleOnDestroy() }
}
