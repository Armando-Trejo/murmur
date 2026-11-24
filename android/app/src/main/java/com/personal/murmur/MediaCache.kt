package com.personal.murmur

import android.content.Context
import android.net.Uri
import androidx.media3.common.util.UnstableApi
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.TransferListener
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.cache.LeastRecentlyUsedCacheEvictor
import androidx.media3.datasource.cache.SimpleCache
import java.io.File

/**
 * Process-wide disk cache for YouTube audio. Repeats, "Anterior", recoveries after a link expires
 * and the promoted preload reuse bytes already downloaded instead of spending mobile data again.
 */
@UnstableApi
object MediaCache {
    const val MAX_BYTES = 256L * 1024 * 1024
    private const val PREFIX = "yt:"
    private var cache: SimpleCache? = null

    /** One SimpleCache per folder per process: the service can be recreated, the cache cannot. */
    @Synchronized fun get(context: Context): SimpleCache = cache ?: SimpleCache(
        File(context.applicationContext.cacheDir, "media3_audio"),
        LeastRecentlyUsedCacheEvictor(MAX_BYTES),
        StandaloneDatabaseProvider(context.applicationContext)
    ).also { cache = it }

    /**
     * Stable key for a signed progressive googlevideo URL. The signature changes on every resolve,
     * so the key uses the video, format (itag) and exact file size (clen) instead of the URL.
     */
    fun key(url: String, videoId: String): String? {
        if (!videoId.matches(Regex("[A-Za-z0-9_-]{11}"))) return null
        val uri = runCatching { Uri.parse(url) }.getOrNull() ?: return null
        val host = uri.host.orEmpty().lowercase()
        if (uri.scheme != "https" || !(host == "googlevideo.com" || host.endsWith(".googlevideo.com")) ||
            !uri.path.orEmpty().startsWith("/videoplayback")) return null
        val itag = uri.getQueryParameter("itag")?.takeIf { it.all(Char::isDigit) } ?: return null
        val length = uri.getQueryParameter("clen")?.takeIf { it.all(Char::isDigit) } ?: return null
        return "$PREFIX$videoId:$itag:$length"
    }

    fun isCacheable(spec: DataSpec) = spec.key?.startsWith(PREFIX) == true

    /** Sends keyed YouTube reads through the cache; local files, HLS and DASH go straight upstream. */
    class RoutingFactory(private val cached: CacheDataSource.Factory, private val direct: DataSource.Factory) : DataSource.Factory {
        override fun createDataSource(): DataSource = Routing(cached.createDataSource(), direct.createDataSource())
    }

    private class Routing(private val cached: DataSource, private val direct: DataSource) : DataSource {
        private var active: DataSource? = null
        override fun addTransferListener(listener: TransferListener) {
            cached.addTransferListener(listener)
            direct.addTransferListener(listener)
        }
        override fun open(dataSpec: DataSpec): Long {
            val source = if (isCacheable(dataSpec)) cached else direct
            active = source
            return source.open(dataSpec)
        }
        override fun read(buffer: ByteArray, offset: Int, length: Int) = active!!.read(buffer, offset, length)
        override fun getUri(): Uri? = active?.uri
        override fun getResponseHeaders(): Map<String, List<String>> = active?.responseHeaders ?: emptyMap()
        override fun close() {
            val source = active ?: return
            active = null
            source.close()
        }
    }
}
