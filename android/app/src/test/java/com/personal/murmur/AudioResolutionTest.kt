package com.personal.murmur

import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/** Recovered from 2.7.1: resolutions are shared, the denied fast path is skipped and failed links are forgotten. */
class AudioResolutionTest {
    private var now = 1_700_000_000_000L
    private val direct = AtomicInteger()
    private val extractor = AtomicInteger()
    private fun audio(expireSeconds: Long? = null) = YouTubeMusicResolver.Audio(200, "",
        listOf(PlaybackSource("https://rr1---sn.googlevideo.com/videoplayback?id=1" + (expireSeconds?.let { "&expire=$it" } ?: ""))))

    @Before fun setUp() {
        NativeNetwork.resetForTests()
        NativeNetwork.clock = { now }
        NativeNetwork.directResolver = { direct.incrementAndGet(); throw YoutubeSourceFailure("playability_denied") }
        NativeNetwork.extractorResolver = { extractor.incrementAndGet(); audio(now / 1000 + 6 * 3600) }
    }

    @After fun tearDown() = NativeNetwork.restoreForTests()

    @Test fun deniedFastPathIsSkippedForHalfAnHour() {
        NativeNetwork.resolveAudio("aaaaaaaaaaa")
        NativeNetwork.resolveAudio("bbbbbbbbbbb")
        assertEquals("the denied client is asked once, not on every tap", 1, direct.get())
        assertEquals(2, extractor.get())
        now += 31 * 60_000
        NativeNetwork.resolveAudio("ccccccccccc")
        assertEquals(2, direct.get())
    }

    @Test fun otherFastPathFailuresDoNotBlockIt() {
        NativeNetwork.directResolver = { direct.incrementAndGet(); throw YoutubeSourceFailure("player_http", 500) }
        NativeNetwork.resolveAudio("aaaaaaaaaaa")
        NativeNetwork.resolveAudio("bbbbbbbbbbb")
        assertEquals("a server error is not a denial", 2, direct.get())
    }

    @Test fun cachedLinksAreReusedUntilCloseToExpiry() {
        NativeNetwork.resolveAudio("aaaaaaaaaaa")
        now += 2 * 3_600_000
        NativeNetwork.resolveAudio("aaaaaaaaaaa")
        assertEquals("a two-hour-old link valid for six hours is reused", 1, extractor.get())
        NativeNetwork.extractorResolver = { extractor.incrementAndGet(); audio(now / 1000 + 15 * 60) }
        NativeNetwork.resolveAudio("bbbbbbbbbbb")
        NativeNetwork.resolveAudio("bbbbbbbbbbb")
        assertEquals("a link expiring in 15 minutes is resolved again", 3, extractor.get())
    }

    @Test fun aTapJoinsTheResolutionAlreadyRunning() {
        val started = CountDownLatch(1)
        val release = CountDownLatch(1)
        NativeNetwork.extractorResolver = {
            extractor.incrementAndGet(); started.countDown(); release.await(5, TimeUnit.SECONDS); audio(now / 1000 + 3600)
        }
        val pool = Executors.newFixedThreadPool(2)
        val prefetch = pool.submit<YouTubeMusicResolver.Audio> { NativeNetwork.resolveAudio("aaaaaaaaaaa") }
        assertTrue(started.await(5, TimeUnit.SECONDS))
        val tap = pool.submit<YouTubeMusicResolver.Audio> { NativeNetwork.resolveAudio("aaaaaaaaaaa") }
        Thread.sleep(100)
        release.countDown()
        assertSame(prefetch.get(5, TimeUnit.SECONDS), tap.get(5, TimeUnit.SECONDS))
        assertEquals("one extraction serves both", 1, extractor.get())
        pool.shutdown()
    }

    @Test fun aFailedResolutionIsNotCachedAndRefreshBypassesTheCache() {
        var fail = true
        NativeNetwork.extractorResolver = { extractor.incrementAndGet(); if (fail) throw java.io.IOException("offline"); audio(now / 1000 + 3600) }
        assertThrows(ProviderFailure::class.java) { NativeNetwork.resolveAudio("aaaaaaaaaaa") }
        fail = false
        NativeNetwork.resolveAudio("aaaaaaaaaaa")
        NativeNetwork.resolveAudio("aaaaaaaaaaa", forceRefresh = true)
        assertEquals(3, extractor.get())
        assertNotNull(NativeNetwork.cachedAudio("aaaaaaaaaaa"))
        NativeNetwork.forget("aaaaaaaaaaa")
        assertNull(NativeNetwork.cachedAudio("aaaaaaaaaaa"))
    }
}
