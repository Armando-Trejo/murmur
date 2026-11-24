package com.personal.murmur

/** Position accounting shared by successive HTTP requests, including seeks and finite reads. */
class AudioByteRanges(start: Long, length: Long = -1, private val chunkSize: Long = 256 * 1024) {
    var position = start; private set
    var remaining = length; private set
    var total: Long? = null
    init { require(start >= 0 && length >= -1 && chunkSize > 0) }
    fun requestedLength(): Long = minOf(chunkSize, if (remaining >= 0) remaining else Long.MAX_VALUE, total?.let { (it-position).coerceAtLeast(0) } ?: Long.MAX_VALUE)
    fun advance(bytes: Int) { require(bytes >= 0); position += bytes; if (remaining >= 0) remaining = (remaining-bytes).coerceAtLeast(0) }
}
