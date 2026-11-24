package com.personal.murmur

import okhttp3.OkHttpClient
import okhttp3.RequestBody.Companion.toRequestBody
import org.schabi.newpipe.extractor.downloader.Downloader
import org.schabi.newpipe.extractor.downloader.Request
import org.schabi.newpipe.extractor.downloader.Response
import org.schabi.newpipe.extractor.NewPipe
import org.schabi.newpipe.extractor.ServiceList
import org.schabi.newpipe.extractor.stream.StreamInfo
import java.util.concurrent.TimeUnit

class OkHttpDownloader : Downloader() {
    override fun execute(request: Request): Response {
        val builder = okhttp3.Request.Builder().url(request.url())
            .header("User-Agent", NativeNetwork.USER_AGENT)
        request.headers().forEach { (key, values) -> builder.removeHeader(key); values.forEach { builder.addHeader(key, it) } }
        val bytes = request.dataToSend()
        builder.method(request.httpMethod(), bytes?.toRequestBody())
        return NativeNetwork.client.newCall(builder.build()).execute().use { r ->
            Response(r.code, r.message, r.headers.toMultimap(), r.body?.string() ?: "", r.request.url.toString())
        }
    }
}
object NativeNetwork {
    const val USER_AGENT = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36"
    val client = OkHttpClient.Builder().connectTimeout(20, TimeUnit.SECONDS).readTimeout(35, TimeUnit.SECONDS).build()
    private var ready = false
    @Synchronized fun init() { if (!ready) { NewPipe.init(OkHttpDownloader()); ready = true } }
    fun extract(videoId: String): StreamInfo {
        require(videoId.matches(Regex("[A-Za-z0-9_-]{11}"))) { "Enlace de YouTube inválido" }
        init(); return StreamInfo.getInfo(ServiceList.YouTube, "https://www.youtube.com/watch?v=$videoId")
    }
    fun audioCandidates(info: StreamInfo) = AudioStreamSelector.rank(info.audioStreams).ifEmpty {
        throw IllegalStateException("Este video no ofrece audio reproducible. Prueba otra versión.")
    }
    fun audio(info: StreamInfo) = audioCandidates(info).first()
    fun playbackSources(info: StreamInfo): List<PlaybackSource> {
        val sources = AudioStreamSelector.rank(info.audioStreams).map { PlaybackSource.from(it) }.toMutableList()
        info.hlsUrl?.takeIf { it.startsWith("https://") }?.let { sources.add(PlaybackSource(it,"application/x-mpegURL")) }
        info.dashMpdUrl?.takeIf { it.startsWith("https://") }?.let { sources.add(PlaybackSource(it,"application/dash+xml")) }
        val unique = sources.distinctBy { it.uri }
        val formats = unique.distinctBy { it.mime ?: it.uri }
        return (formats + unique.filterNot { it in formats }).ifEmpty { error("Este video no ofrece un formato de audio reproducible. Prueba otra versión.") }
    }
    fun downloadableAudio(info: StreamInfo) = audioCandidates(info).firstOrNull { it.deliveryMethod == org.schabi.newpipe.extractor.stream.DeliveryMethod.PROGRESSIVE_HTTP }
        ?: error("Esta emisión no ofrece un archivo de audio descargable. Puedes escucharla en línea.")
    /** Signed links last ~6 h; keep them while they have margin so revisits and skips skip the resolver. */
    private val resolved = AudioSourceCache<YouTubeMusicResolver.Audio>(capacity = 48, lifetimeMs = 3 * 60 * 60_000L)
    private const val EXPIRY_MARGIN_MS = 20 * 60_000L
    fun linkStillValid(audio: YouTubeMusicResolver.Audio, now: Long = System.currentTimeMillis()): Boolean {
        val expire = audio.sources.firstOrNull()?.uri?.let { Regex("[?&]expire=(\\d+)").find(it)?.groupValues?.get(1)?.toLongOrNull() }
            ?: return true
        return expire * 1000 - now > EXPIRY_MARGIN_MS
    }
    fun resolveAudio(videoId:String,preferNewPipe:Boolean=false,forceRefresh:Boolean=false):YouTubeMusicResolver.Audio {
        if (!preferNewPipe && !forceRefresh) resolved.get(videoId)?.takeIf { linkStillValid(it) }?.let { return it }
        resolved.remove(videoId)
        val result = resolveUncached(videoId, preferNewPipe)
        resolved.put(videoId, result)
        return result
    }
    private fun resolveUncached(videoId:String,preferNewPipe:Boolean):YouTubeMusicResolver.Audio {
        val extractorFailure = if (preferNewPipe) try {
            val info = extract(videoId)
            return YouTubeMusicResolver.Audio(info.duration, info.description.content, playbackSources(info))
        } catch (failure: Exception) { failure } else null
        val directFailure = try {
            return YouTubeMusicResolver.resolve(videoId)
        } catch (failure: Exception) { failure }
        if (extractorFailure != null) throw sourceFailure(directFailure, extractorFailure)
        try {
            val info = extract(videoId)
            return YouTubeMusicResolver.Audio(info.duration, info.description.content, playbackSources(info))
        } catch (failure: Exception) {
            throw sourceFailure(directFailure, failure)
        }
    }

    private fun sourceFailure(vararg failures: Exception): ProviderFailure {
        val causes = failures.flatMap { generateSequence(it as Throwable?) { cause -> cause.cause }.take(8).toList() }
        val status = causes.filterIsInstance<YoutubeSourceFailure>().firstOrNull()?.httpStatus ?: -1
        return when {
            causes.any { it is java.net.UnknownHostException || it is java.net.ConnectException ||
                it is java.net.SocketTimeoutException || it is java.net.SocketException } || status in 500..599 ->
                ProviderFailure("AUDIO_NETWORK", status, "youtube", "playback", "No se pudo conectar con YouTube. Revisa tu red y pulsa Reintentar.")
            status == 429 -> ProviderFailure("AUDIO_RATE_LIMIT", status, "youtube", "playback",
                "YouTube limitó las solicitudes de audio. Espera un momento y reintenta.")
            else -> ProviderFailure("AUDIO_UNAVAILABLE", status, "youtube", "playback",
                "YouTube no pudo abrir esta versión. Reintenta o elige otra versión.")
        }
    }
}
