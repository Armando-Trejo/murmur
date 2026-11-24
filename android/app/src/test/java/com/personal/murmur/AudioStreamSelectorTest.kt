package com.personal.murmur
import org.junit.Assert.*
import org.junit.Test
import org.schabi.newpipe.extractor.MediaFormat
import org.schabi.newpipe.extractor.stream.AudioStream
import org.schabi.newpipe.extractor.stream.DeliveryMethod
class AudioStreamSelectorTest {
    private fun stream(id: String, format: MediaFormat, bitrate: Int, delivery: DeliveryMethod = DeliveryMethod.PROGRESSIVE_HTTP, url: String = "https://audio.example/$id") = AudioStream.Builder().setId(id).setContent(url,true).setMediaFormat(format).setAverageBitrate(bitrate).setDeliveryMethod(delivery).build()
    @Test fun prefersCompatibleAacWhileKeepingOpusAsFallback() {
        val opus=stream("opus",MediaFormat.WEBMA_OPUS,160); val aac=stream("aac",MediaFormat.M4A,128)
        assertEquals(listOf(aac,opus),AudioStreamSelector.rank(listOf(opus,aac)))
    }
    @Test fun progressiveSourcesPrecedeManifestsAndUnsafeSourcesAreExcluded() {
        val hls=stream("hls",MediaFormat.M4A,256,DeliveryMethod.HLS); val opus=stream("opus",MediaFormat.WEBMA_OPUS,160)
        assertEquals(listOf(opus,hls),AudioStreamSelector.rank(listOf(hls,stream("http",MediaFormat.M4A,320,url="http://audio.example/a"),opus)))
        assertEquals("application/x-mpegURL",PlaybackSource.from(hls).mime)
    }
    @Test fun keepsBestBitrateWithinOneCompatibleFormatAndDeduplicatesUrls() {
        val low=stream("low",MediaFormat.M4A,64);val high=stream("high",MediaFormat.M4A,128)
        assertEquals(listOf(high,low),AudioStreamSelector.rank(listOf(low,high,high)))
        assertEquals("audio/mp4",PlaybackSource.from(high).mime)
    }
    @Test fun doesNotTreatRawLiveDashSegmentsAsAnMpdManifest() {
        val raw=stream("live",MediaFormat.M4A,128,DeliveryMethod.DASH)
        assertTrue(AudioStreamSelector.rank(listOf(raw)).isEmpty())
        val manifest=AudioStream.Builder().setId("mpd").setContent("https://audio.example/stream.mpd",true).setMediaFormat(MediaFormat.M4A).setDeliveryMethod(DeliveryMethod.DASH).build()
        assertEquals("application/dash+xml",PlaybackSource.from(manifest).mime)
    }
}
