package com.personal.murmur
import org.junit.Assert.*
import org.junit.Test
class AudioByteRangesTest {
    @Test fun sequentialRangesHaveNoGapsAndStopAtKnownFileEnd() {
        val ranges=AudioByteRanges(0,chunkSize=1024);ranges.total=2500
        assertEquals(1024L,ranges.requestedLength());ranges.advance(1024)
        assertEquals(1024L,ranges.position);assertEquals(1024L,ranges.requestedLength());ranges.advance(1024)
        assertEquals(452L,ranges.requestedLength());ranges.advance(452);assertEquals(0L,ranges.requestedLength())
    }
    @Test fun honorsSeekOffsetAndFiniteExtractorReads() {
        val ranges=AudioByteRanges(65536,1500,1024);ranges.total=100000
        ranges.advance(1024);assertEquals(66560L,ranges.position);assertEquals(476L,ranges.requestedLength())
        ranges.advance(476);assertEquals(0L,ranges.remaining);assertEquals(0L,ranges.requestedLength())
    }
    @Test fun exactBoundaryDoesNotAskPastKnownEnd() { val ranges=AudioByteRanges(0,chunkSize=1024);ranges.total=2048;ranges.advance(2048);assertEquals(0L,ranges.requestedLength()) }
}
