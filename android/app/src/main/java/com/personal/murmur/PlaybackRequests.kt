package com.personal.murmur

/** One request clock across both providers, pauses and background transitions. */
object PlaybackRequests {
    private val clock = java.util.concurrent.atomic.AtomicLong()
    fun snapshot(): Long = clock.get()
    fun next(): Long = clock.incrementAndGet()
    fun isCurrent(ticket: Long): Boolean = clock.get() == ticket
}
