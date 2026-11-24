package com.personal.murmur

import android.net.Uri
import androidx.media3.common.C
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.TransferListener
import androidx.media3.datasource.HttpDataSource
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.ByteArrayOutputStream

@RunWith(RobolectricTestRunner::class)
@Config(manifest=Config.NONE,sdk=[28])
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class AudioRangeDataSourceTest {
    private class MemorySource(val bytes: ByteArray, val rejectSecond: Boolean = false) : DataSource {
        val requests=mutableListOf<DataSpec>()
        var active: DataSpec?=null;var position=0;var limit=0
        override fun addTransferListener(listener: TransferListener) {}
        override fun open(spec: DataSpec): Long {
            if (rejectSecond && spec.position >= 262144) throw HttpDataSource.InvalidResponseCodeException(416,"Range rejected",null,emptyMap(),spec,byteArrayOf())
            requests.add(spec);active=spec;position=spec.position.toInt()
            limit=minOf(bytes.size,if(spec.length<0)bytes.size else position+spec.length.toInt())
            return (limit-position).toLong()
        }
        override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
            if(position>=limit)return C.RESULT_END_OF_INPUT
            val count=minOf(length,limit-position);bytes.copyInto(buffer,offset,position,position+count);position+=count;return count
        }
        override fun getUri(): Uri?=active?.uri
        override fun getResponseHeaders()=mapOf("content-range" to listOf("bytes ${active?.position}-${limit-1}/${bytes.size}"))
        override fun close(){active=null}
    }
    private fun consume(source: DataSource): ByteArray {
        val sink=ByteArrayOutputStream();val buffer=ByteArray(8192)
        while(true){val n=source.read(buffer,0,buffer.size);if(n==C.RESULT_END_OF_INPUT)break;sink.write(buffer,0,n)}
        source.close();return sink.toByteArray()
    }
    @Test fun productionDataSourceReadsTheWholeFileThroughConsecutiveBoundedRequests() {
        val bytes=ByteArray(600000){(it%251).toByte()};val upstream=MemorySource(bytes);val source=AudioRangeDataSource(upstream)
        assertEquals(600000L,source.open(DataSpec(Uri.parse("https://rr.example.googlevideo.com/videoplayback?id=test"))))
        assertArrayEquals(bytes,consume(source));assertEquals(listOf(0L,262144L,524288L),upstream.requests.map{it.position})
        assertTrue(upstream.requests.all{it.length in 1L..262144L})
    }
    @Test fun seeksAndFiniteReadsNeverAddOrDropBytes() {
        val bytes=ByteArray(600000){(it%251).toByte()};val upstream=MemorySource(bytes);val source=AudioRangeDataSource(upstream)
        source.open(DataSpec.Builder().setUri("https://rr.example.googlevideo.com/videoplayback").setPosition(12345).setLength(273333).build())
        assertArrayEquals(bytes.copyOfRange(12345,285678),consume(source));assertEquals(listOf(12345L,274489L),upstream.requests.map{it.position})
    }
    @Test fun offlineFilesAreNotSplitIntoHttpRanges() {
        val bytes=ByteArray(600000);val upstream=MemorySource(bytes);val source=AudioRangeDataSource(upstream)
        source.open(DataSpec(Uri.parse("file:///private/audio.m4a")));assertArrayEquals(bytes,consume(source));assertEquals(1,upstream.requests.size)
    }
    @Test fun rejectionBeforeKnownEndIsAnErrorRatherThanAShortSuccessfulSong() {
        val source=AudioRangeDataSource(MemorySource(ByteArray(600000),true))
        source.open(DataSpec(Uri.parse("https://rr.example.googlevideo.com/videoplayback")))
        try { consume(source);fail("A missing middle block must not become EOF") }
        catch(error:HttpDataSource.InvalidResponseCodeException){assertEquals(416,error.responseCode)}
        finally {source.close()}
    }
}
