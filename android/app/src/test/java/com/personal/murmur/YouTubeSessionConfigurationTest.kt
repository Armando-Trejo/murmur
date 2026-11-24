package com.personal.murmur

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class YouTubeSessionConfigurationTest {
    @Test fun capturesConfigurationFromTheAuthenticatedPageInsteadOfFetchingAnotherHtml() {
        val data=JSONObject().put("clientVersion","1.20261122.01.00").put("visitorData","test-visitor").put("pageId","test-channel").put("sessionIndex","1")
        val parsed=YouTubeSessionConfiguration.fromJavascript(JSONObject.quote(data.toString()))
        assertEquals("1.20261122.01.00",parsed.getString("clientVersion"));assertEquals("test-channel",parsed.getString("pageId"));assertEquals("1",parsed.getString("sessionIndex"))
    }
    @Test fun understandsDirectAndEscapedBootstrapVersions() {
        assertEquals("1.20261122.01.00",YouTubeSessionConfiguration.fromHtml("ytcfg.set({\"INNERTUBE_CLIENT_VERSION\" : \"1.20261122.01.00\"})"))
        assertEquals("1.20261122.01.00",YouTubeSessionConfiguration.fromHtml("{\\\"clientVersion\\\":\\\"1.20261122.01.00\\\"}"))
        assertNull(YouTubeSessionConfiguration.fromHtml("<html>Consent required</html>"))
    }
    @Test fun anUnloadedOrRedirectedPageIsNotSavedAsAWorkingConfiguration() {
        try{YouTubeSessionConfiguration.fromJavascript("\"{}\"");fail("Empty page config accepted")}catch(_:IllegalStateException){}
    }
}
