package com.personal.murmur
import org.junit.Test
import org.junit.Assert.*
class ProviderFailureTest {
    @Test fun webCookieDenialPointsToAuthorizationInsteadOfBlamingPremium() { val e=ProviderFailures.response(403,"spotify","web_token"); assertEquals("SPOTIFY_OAUTH_REQUIRED",e.code); assertFalse(e.message!!.contains("Premium")); assertTrue(e.message!!.contains("OAuth")) }
    @Test fun youtubePrivateDenialNeverMentionsSpotify() { val e=ProviderFailures.response(403,"youtube","private_library"); assertEquals("YOUTUBE_PRIVATE_ACCESS_DENIED",e.code); assertFalse(e.message!!.contains("Spotify")); assertTrue(e.message!!.contains("audio público")) }
    @Test fun missingSpotifyDeviceIsRecoverableWithOfficialApp() { assertEquals("SPOTIFY_NO_DEVICE",ProviderFailures.response(404,"spotify","playback").code) }
    @Test fun premiumMessageRequiresExplicitBackendReason() { assertEquals("SPOTIFY_PREMIUM_REQUIRED",ProviderFailures.response(403,"spotify","playback","PREMIUM_REQUIRED").code); assertEquals("SPOTIFY_PERMISSION_DENIED",ProviderFailures.response(403,"spotify","playback").code) }
    @Test fun rateLimitsDoNotTellTheUserToLoginAgain() { assertEquals("RATE_LIMITED",ProviderFailures.response(429,"spotify","library").code) }
    @Test fun playlistAndPlaybackRestrictionsDoNotInvalidateLibraryAccess() { assertFalse(ProviderFailures.invalidatesLibraryAccess(ProviderFailures.response(403,"spotify","playlist"))); assertFalse(ProviderFailures.invalidatesLibraryAccess(ProviderFailures.response(403,"spotify","playback","PREMIUM_REQUIRED"))); assertTrue(ProviderFailures.invalidatesLibraryAccess(ProviderFailures.response(401,"spotify","library"))); assertEquals("SPOTIFY_OAUTH_REQUIRED",ProviderFailures.response(401,"spotify","web_token").code) }
}
