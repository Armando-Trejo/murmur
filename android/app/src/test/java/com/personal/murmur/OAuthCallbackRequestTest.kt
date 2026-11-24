package com.personal.murmur
import org.junit.Test
import org.junit.Assert.*
class OAuthCallbackRequestTest {
    @org.junit.Test fun nativeEngineCallbackHasItsOwnExactPath(){org.junit.Assert.assertEquals("/login?code=x&state=y",OAuthCallbackRequest.target("GET /login?code=x&state=y HTTP/1.1","/login"));org.junit.Assert.assertNull(OAuthCallbackRequest.target("GET /callback?code=x HTTP/1.1","/login"))}
    @Test fun acceptsOnlyTheLocalCallbackGetPath() { assertEquals("/callback?code=abc&state=nonce",OAuthCallbackRequest.target("GET /callback?code=abc&state=nonce HTTP/1.1")); assertNull(OAuthCallbackRequest.target("GET /favicon.ico HTTP/1.1")); assertNull(OAuthCallbackRequest.target("POST /callback?code=x HTTP/1.1")); assertNull(OAuthCallbackRequest.target("GET https://other.test/callback?x HTTP/1.1")) }
    @Test fun rejectsMissingMismatchedAndExpiredState() { assertFalse(OAuthCallbackRequest.validState(null,null,0,0)); assertFalse(OAuthCallbackRequest.validState("a","b",1000,2000)); assertFalse(OAuthCallbackRequest.validState("a","a",1000,602000)); assertTrue(OAuthCallbackRequest.validState("a","a",1000,2000)) }
}
