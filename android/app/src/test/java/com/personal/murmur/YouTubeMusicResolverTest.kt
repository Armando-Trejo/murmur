package com.personal.murmur
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class YouTubeMusicResolverTest {
    @Test fun compatibleDirectAudioPrecedesWebmAndKeepsMetadata() {
        val data=JSONObject("""{"playabilityStatus":{"status":"OK"},"videoDetails":{"lengthSeconds":"240","shortDescription":"description"},"streamingData":{"adaptiveFormats":[{"mimeType":"audio/webm; codecs=opus","bitrate":160000,"url":"https://cdn.example/opus"},{"mimeType":"audio/mp4; codecs=mp4a","bitrate":128000,"url":"https://cdn.example/aac"},{"mimeType":"video/mp4","url":"https://cdn.example/video"}]}}""")
        val result=YouTubeMusicResolver.parse(data);assertEquals(240L,result.duration);assertEquals("audio/mp4",result.sources[0].mime);assertEquals(2,result.sources.size)
    }
    @Test fun cipheredOrUnsafeSourcesAreRejectedForTheNextResolver() {
        val data=JSONObject("""{"playabilityStatus":{"status":"OK"},"streamingData":{"adaptiveFormats":[{"mimeType":"audio/mp4","signatureCipher":"private-opaque-data"},{"mimeType":"audio/webm","url":"http://unsafe.example/audio"}]}}""")
        try{YouTubeMusicResolver.parse(data);fail()}catch(error:YoutubeSourceFailure){assertEquals("direct_audio_unavailable",error.reason);assertFalse(error.message!!.contains("private-opaque-data"))}
    }
    @Test fun providerRefusalKeepsBodiesAndSignedUrlsOutOfTheError() {
        try{YouTubeMusicResolver.parse(JSONObject("""{"playabilityStatus":{"status":"LOGIN_REQUIRED","reason":"https://secret.example/token"}}"""));fail()}
        catch(error:YoutubeSourceFailure){assertEquals("playability_denied",error.reason);assertFalse(error.message!!.contains("secret.example"));assertNull(error.cause)}
    }
}
