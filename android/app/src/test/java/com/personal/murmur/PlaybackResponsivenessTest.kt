package com.personal.murmur

import org.junit.Assert.*
import org.junit.Test

class PlaybackResponsivenessTest {
    @Test fun newestRequestAcrossSourcesOrPauseInvalidatesEarlierWork() {
        val youtube=PlaybackRequests.next();val spotify=PlaybackRequests.next()
        assertFalse(PlaybackRequests.isCurrent(youtube));assertTrue(PlaybackRequests.isCurrent(spotify))
        PlaybackRequests.next();assertFalse(PlaybackRequests.isCurrent(spotify))
    }
    @Test fun cacheExpiresSignedSourcesAndEvictsLeastRecentlyUsed() {
        var time=0L
        val cache=AudioSourceCache<String>(2,100){time}
        cache.put("a","A");cache.put("b","B");assertEquals("A",cache.get("a"))
        cache.put("c","C");assertNull(cache.get("b"));assertEquals("C",cache.get("c"))
        time=100;assertNull(cache.get("a"));assertNull(cache.get("c"))
    }
    @Test fun recoveryRemovesRejectedSourceInsteadOfServingItAgain() {
        val cache=AudioSourceCache<String>();cache.put("video","old");cache.remove("video")
        assertNull(cache.get("video"));cache.put("video","fresh");assertEquals("fresh",cache.get("video"))
    }
}
