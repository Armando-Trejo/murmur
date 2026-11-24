package com.personal.murmur
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Test
import org.junit.Assume.assumeTrue
import org.junit.Assert.*
import org.schabi.newpipe.extractor.ServiceList
import org.schabi.newpipe.extractor.search.SearchInfo
import org.schabi.newpipe.extractor.stream.StreamInfoItem
class ExtractorNetworkSmokeTest {
    @Test fun publicYouTubeSearchAndStreamExtraction() {
        assumeTrue("Opt-in live network smoke", System.getProperty("murmur.networkSmoke") == "true")
        NativeNetwork.init()
        val search = SearchInfo.getInfo(ServiceList.YouTube, ServiceList.YouTube.searchQHFactory.fromQuery("Caifanes Afuera", emptyList(), ""))
        val track = search.relatedItems.filterIsInstance<StreamInfoItem>().firstOrNull { it.duration > 0 } ?: error("No public search results")
        val id = track.url.substringAfter("v=").substringBefore('&')
        val info = NativeNetwork.extract(id)
        val stream = NativeNetwork.audio(info)
        assertTrue(info.duration > 0)
        assertTrue(stream.content.startsWith("https://"))
        assertTrue(stream.averageBitrate > 0)
        val resolved=NativeNetwork.resolveAudio(id).sources.first()
        val agent=if(resolved.uri.toHttpUrl().queryParameter("c")=="ANDROID_MUSIC")YouTubeMusicResolver.USER_AGENT else NativeNetwork.USER_AGENT
        NativeNetwork.client.newCall(okhttp3.Request.Builder().url(resolved.uri).header("User-Agent",agent).header("Referer","https://www.youtube.com/").header("Range","bytes=0-1023").build()).execute().use { response ->
            assertTrue("Audio URL returned HTTP ${response.code}", response.isSuccessful)
            val bytes = response.body?.byteStream()?.readNBytes(1024) ?: byteArrayOf()
            assertTrue("Audio URL returned no media header", bytes.size > 16)
            val mp4 = String(bytes.copyOfRange(4,8), Charsets.US_ASCII) == "ftyp"
            val webm = bytes.take(4).map { it.toInt() and 255 } == listOf(0x1a,0x45,0xdf,0xa3)
            assertTrue("Returned body is not MP4/WebM audio", mp4 || webm)
        }
        NativeNetwork.client.newCall(okhttp3.Request.Builder().url(resolved.uri).header("User-Agent",agent).header("Referer","https://www.youtube.com/").header("Range","bytes=65536-66559").build()).execute().use { response ->
            assertEquals("The stream must support bounded follow-up reads",206,response.code)
            assertTrue(response.header("Content-Range").orEmpty().contains("65536-"))
            assertEquals(1024,response.body!!.byteStream().readNBytes(1024).size)
        }
    }
}
