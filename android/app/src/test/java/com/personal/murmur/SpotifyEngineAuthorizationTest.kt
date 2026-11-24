package com.personal.murmur
import android.net.Uri
import com.personal.murmur.spotify.SpotifyEngineAuthorization
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
@Config(manifest=Config.NONE,sdk=[28])
class SpotifyEngineAuthorizationTest {
    private val context get()=RuntimeEnvironment.getApplication()
    private fun prefs()=context.getSharedPreferences("engine-test-"+java.util.UUID.randomUUID(),0)
    private fun tokens()=JSONObject().put("access_token","synthetic-access").put("refresh_token","synthetic-refresh").put("expires_in",3600)
    @Test fun consentIsSeparateFromLibraryAndDefaultsToIntegratedPlayback(){
        val engine=SpotifyEngineAuthorization(context,prefs()){tokens()};val library=context.getSharedPreferences("library-test",0).apply{edit().putString("client_id","user-client").apply()}
        val url=engine.begin();assertEquals("integrated",engine.mode());assertEquals(SpotifyEngineAuthorization.CLIENT_ID,url.getQueryParameter("client_id"));assertEquals(SpotifyEngineAuthorization.REDIRECT,url.getQueryParameter("redirect_uri"));assertEquals("S256",url.getQueryParameter("code_challenge_method"));assertEquals("user-client",library.getString("client_id",null));assertFalse(engine.authorized())
    }
    @Test fun wrongNonceNeverExchangesATokenAndSuccessCannotBeReplayed(){
        var requests=0;val engine=SpotifyEngineAuthorization(context,prefs()){requests++;tokens()};val url=engine.begin()
        try{engine.finish(Uri.parse(SpotifyEngineAuthorization.REDIRECT+"?code=x&state=wrong"));fail()}catch(_:IllegalStateException){}
        assertEquals(0,requests)
        val callback=Uri.parse(SpotifyEngineAuthorization.REDIRECT+"?code=x&state="+url.getQueryParameter("state"));engine.finish(callback)
        assertTrue(engine.authorized());assertEquals("synthetic-access",engine.token());assertEquals(1,requests)
        try{engine.finish(callback);fail()}catch(_:IllegalStateException){};assertEquals(1,requests)
    }
    @Test fun logoutDuringExchangeCannotRestoreTheSession(){
        val entered=CountDownLatch(1);val release=CountDownLatch(1);val worker=Executors.newSingleThreadExecutor()
        val engine=SpotifyEngineAuthorization(context,prefs()){entered.countDown();release.await(3,TimeUnit.SECONDS);tokens()};val url=engine.begin()
        try{val task=worker.submit{runCatching{engine.finish(Uri.parse(SpotifyEngineAuthorization.REDIRECT+"?code=x&state="+url.getQueryParameter("state")))}}
            assertTrue(entered.await(3,TimeUnit.SECONDS));engine.clear();release.countDown();task.get(3,TimeUnit.SECONDS);assertFalse(engine.authorized())
        }finally{release.countDown();worker.shutdownNow()}
    }
}
