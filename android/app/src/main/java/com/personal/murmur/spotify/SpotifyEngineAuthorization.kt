package com.personal.murmur.spotify

import android.content.Context
import android.net.Uri
import android.util.Base64
import com.getcapacitor.JSObject
import com.personal.murmur.NativeNetwork
import com.personal.murmur.OAuthCallbackRequest
import com.personal.murmur.ProviderFailure
import okhttp3.FormBody
import okhttp3.Request
import org.json.JSONObject
import java.security.MessageDigest
import java.security.SecureRandom

/** Separate native-engine consent, following Square/SpotifyOAuth. Library OAuth is untouched. */
class SpotifyEngineAuthorization(context: Context, private val prefs:android.content.SharedPreferences = securePrefs(context), private val tokenRequest:((FormBody)->JSONObject)?=null) {
    companion object {
        const val CLIENT_ID = "65b708073fc0480ea92a077233ca87bd"
        const val REDIRECT = "http://127.0.0.1:5588/login"
        private fun securePrefs(context:Context)=com.personal.murmur.SecurePrefs.open(context,"murmur_spotify_engine")
        fun clearRuntimeFiles(context:Context){val root=context.cacheDir.canonicalFile;val directory=java.io.File(root,"spotify_engine").canonicalFile;check(directory.parentFile==root);if(directory.exists())check(directory.deleteRecursively()){"No se pudo borrar la caché privada del motor"}}
    }
    private fun secret() = ByteArray(48).also { SecureRandom().nextBytes(it) }.let { Base64.encodeToString(it,Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING) }
    fun authorized() = !prefs.getString("refresh",null).isNullOrBlank()
    fun authorizing()=OAuthCallbackRequest.validState(prefs.getString("state",null),prefs.getString("state",null),prefs.getLong("started",0),System.currentTimeMillis())
    fun sessionId()=prefs.getString("session",null) ?: "uninitialized"
    fun cancelPending(){prefs.edit().remove("state").remove("verifier").remove("started").putLong("epoch",prefs.getLong("epoch",0)+1).apply()}
    fun status() = JSObject().put("spotifyEngineAuthorized",authorized()).put("spotifyEngineAuthorizing",authorizing()).put("spotifyPlaybackMode",prefs.getString("mode","integrated"))
    fun mode() = prefs.getString("mode","integrated") ?: "integrated"
    fun mode(value: String) { require(value in listOf("integrated","web","connect"));prefs.edit().putString("mode",value).apply() }
    fun begin(): Uri {
        val verifier=secret();val state=secret()
        prefs.edit().putString("verifier",verifier).putString("state",state).putLong("started",System.currentTimeMillis()).apply()
        val challenge=Base64.encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII)),Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
        return Uri.parse("https://accounts.spotify.com/authorize").buildUpon().appendQueryParameter("client_id",CLIENT_ID)
            .appendQueryParameter("response_type","code").appendQueryParameter("redirect_uri",REDIRECT)
            .appendQueryParameter("code_challenge_method","S256").appendQueryParameter("code_challenge",challenge)
            .appendQueryParameter("state",state).appendQueryParameter("scope","streaming app-remote-control user-read-private").build()
    }
    private fun exchange(form: FormBody): JSONObject = tokenRequest?.invoke(form) ?: NativeNetwork.client.newCall(Request.Builder().url("https://accounts.spotify.com/api/token").post(form).build()).execute().use { response ->
        if (!response.isSuccessful) throw ProviderFailure("SPOTIFY_ENGINE_AUTH_REQUIRED",response.code,"spotify","engine_authorization","Spotify no concedió la autorización al motor local. Vuelve a activar Spotify integrado desde Opciones (⋯).")
        JSONObject(response.body?.string() ?: error("Respuesta vacía de Spotify"))
    }
    fun finish(uri: Uri) {
        val state=prefs.getString("state",null);val epoch=prefs.getLong("epoch",0)
        check(OAuthCallbackRequest.validState(state,uri.getQueryParameter("state"),prefs.getLong("started",0),System.currentTimeMillis())) { "La autorización del motor caducó. Iníciala otra vez." }
        if(uri.getQueryParameter("error")!=null) error("Spotify no concedió la autorización del motor integrado.")
        val code=uri.getQueryParameter("code") ?: error("La respuesta no contiene autorización")
        val data=exchange(FormBody.Builder().add("grant_type","authorization_code").add("client_id",CLIENT_ID).add("redirect_uri",REDIRECT).add("code",code).add("code_verifier",prefs.getString("verifier","")!!).build())
        check(epoch==prefs.getLong("epoch",0) && state==prefs.getString("state",null)) { "Autorización cancelada" }
        check(data.optString("refresh_token").isNotBlank()) { "No se recibió una sesión renovable del motor" };persist(data);prefs.edit().putString("session",java.util.UUID.randomUUID().toString()).remove("state").remove("verifier").remove("started").apply()
    }
    private fun persist(data: JSONObject) {
        val access=data.optString("access_token");check(access.isNotBlank()) { "Spotify no devolvió acceso al motor" }
        prefs.edit().putString("access",access).putLong("expires",System.currentTimeMillis()+data.optLong("expires_in",3600)*1000).apply()
        data.optString("refresh_token").takeIf { it.isNotBlank() }?.let { prefs.edit().putString("refresh",it).apply() }
    }
    @Synchronized fun token(): String {
        if(authorizing())throw ProviderFailure("SPOTIFY_ENGINE_AUTH_PENDING",401,"spotify","engine_authorization","Completa la autorización del motor de Spotify en el navegador.")
        if(!authorized())throw ProviderFailure("SPOTIFY_ENGINE_AUTH_REQUIRED",401,"spotify","engine_authorization","Activa Spotify integrado (Premium) desde Opciones (⋯). Es una autorización adicional del motor librespot.")
        val epoch=prefs.getLong("epoch",0)
        if(System.currentTimeMillis()<prefs.getLong("expires",0)-60000)return prefs.getString("access","")!!
        val data=exchange(FormBody.Builder().add("grant_type","refresh_token").add("client_id",CLIENT_ID).add("refresh_token",prefs.getString("refresh","")!!).build())
        check(epoch==prefs.getLong("epoch",0)) { "Sesión del motor cerrada" };persist(data);return prefs.getString("access","")!!
    }
    fun clear() { val next=prefs.getLong("epoch",0)+1;val selected=mode();prefs.edit().clear().putLong("epoch",next).putString("mode",selected).apply() }
}
