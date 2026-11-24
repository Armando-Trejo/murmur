package com.personal.murmur

import android.net.Uri
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.TransferListener
import androidx.media3.datasource.HttpDataSource
import java.io.EOFException

/** Bounded reads of progressive Google video files; local files and manifests pass through. */
@UnstableApi
class AudioRangeDataSource(private val upstream: DataSource) : DataSource {
    class Factory(private val upstream: DataSource.Factory) : DataSource.Factory {
        override fun createDataSource(): DataSource = AudioRangeDataSource(upstream.createDataSource())
    }
    private var original: DataSpec? = null
    private var cursor: AudioByteRanges? = null
    private var requestRemaining = 0L
    private var opened = false
    private var ended = false
    override fun addTransferListener(listener: TransferListener) = upstream.addTransferListener(listener)
    override fun open(input: DataSpec): Long {
        val music=input.uri.host.orEmpty().endsWith(".googlevideo.com") && input.uri.getQueryParameter("c")=="ANDROID_MUSIC"
        val spec=if(music)input.buildUpon().setHttpRequestHeaders(input.httpRequestHeaders+mapOf("User-Agent" to YouTubeMusicResolver.USER_AGENT)).build()else input
        original = spec; ended = false
        val host = spec.uri.host.orEmpty().lowercase()
        val bounded = spec.uri.scheme == "https" && (host == "googlevideo.com" || host.endsWith(".googlevideo.com")) && spec.uri.path.orEmpty().startsWith("/videoplayback") && spec.httpMethod == DataSpec.HTTP_METHOD_GET
        if (!bounded) { cursor = null; opened = true; return upstream.open(spec) }
        val ranges = AudioByteRanges(spec.position, spec.length); cursor = ranges
        openRange()
        return when {
            spec.length >= 0 -> minOf(spec.length, ranges.total?.let { (it-spec.position).coerceAtLeast(0) } ?: Long.MAX_VALUE)
            ranges.total != null -> (ranges.total!!-spec.position).coerceAtLeast(0)
            else -> C.LENGTH_UNSET.toLong()
        }
    }
    private fun openRange() {
        val ranges = cursor!!
        requestRemaining = ranges.requestedLength()
        if (requestRemaining == 0L) { ended = true; return }
        opened = true
        upstream.open(original!!.buildUpon().setPosition(ranges.position).setLength(requestRemaining).build())
        val range = upstream.responseHeaders.entries.firstOrNull { it.key.equals("Content-Range", true) }?.value?.firstOrNull()
        range?.substringAfterLast('/')?.toLongOrNull()?.let { ranges.total = it }
        requestRemaining = minOf(requestRemaining, ranges.total?.let { (it-ranges.position).coerceAtLeast(0) } ?: Long.MAX_VALUE)
    }
    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        if (length == 0) return 0
        val ranges = cursor ?: return upstream.read(buffer, offset, length)
        if (ended || ranges.requestedLength() == 0L) return C.RESULT_END_OF_INPUT
        if (!opened) {
            try { openRange() } catch (error: HttpDataSource.InvalidResponseCodeException) {
                upstream.close(); opened = false
                if (error.responseCode != 416 || ranges.total?.let { ranges.position < it } == true) throw error
                ended = true; return C.RESULT_END_OF_INPUT
            }
        }
        if (ended) return C.RESULT_END_OF_INPUT
        val count = upstream.read(buffer, offset, minOf(length.toLong(), requestRemaining).toInt())
        if (count == C.RESULT_END_OF_INPUT) {
            ended = true
            if (ranges.total?.let { ranges.position < it } == true) throw EOFException("El servidor interrumpió el bloque de audio")
            return C.RESULT_END_OF_INPUT
        }
        ranges.advance(count); requestRemaining -= count
        if (requestRemaining == 0L) { upstream.close(); opened = false }
        return count
    }
    override fun getUri(): Uri? = upstream.uri ?: original?.uri
    override fun getResponseHeaders(): Map<String, List<String>> = upstream.responseHeaders
    override fun close() { if (opened) upstream.close(); opened = false; original = null; cursor = null; ended = true }
}
