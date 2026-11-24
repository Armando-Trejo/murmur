package com.personal.murmur

import android.content.SharedPreferences
import okhttp3.Request
import okhttp3.FormBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.MediaType.Companion.toMediaType
import org.json.JSONObject
import com.getcapacitor.JSObject
import java.util.concurrent.TimeUnit

class SpotifySession(private val prefs: SharedPreferences) {
    companion object {
        fun stored(context:android.content.Context)=SpotifySession(androidx.security.crypto.EncryptedSharedPreferences.create(context,"hybrid_sessions",androidx.security.crypto.MasterKey.Builder(context).setKeyScheme(androidx.security.crypto.MasterKey.KeyScheme.AES256_GCM).build(),androidx.security.crypto.EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,androidx.security.crypto.EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM))
    }
    fun webToken(force:Boolean=false):String {
        check(hasOAuth() && prefs.getString("oauth_scopes","")!!.split(' ').containsAll(listOf("streaming","user-read-email"))){"Renueva Autorizar Spotify desde Conexiones para conceder los permisos del reproductor Web. Habilita Web Playback SDK en tu aplicación de Spotify for Developers."}
        return accessToken(force)
    }
    private var token: String? = null
    private var expires = 0L
    private val http = NativeNetwork.client.newBuilder().callTimeout(15, TimeUnit.SECONDS).build()
    private fun hasOAuth() = !prefs.getString("refresh_token", null).isNullOrBlank()
    private fun stored() = hasOAuth() || !prefs.getString("spotify_cookie", null).isNullOrBlank()
    private fun invalidate(error: ProviderFailure) { if (ProviderFailures.invalidatesLibraryAccess(error)) prefs.edit().putBoolean("spotify_verified", false).putString("spotify_error", error.message).putString("spotify_code", error.code).apply() }
    fun clearToken() { token = null; expires = 0 }
    fun status(): JSObject {
        val verified = stored() && prefs.getBoolean("spotify_verified", false) && prefs.getInt("verification_version", 0) == 2
        return JSObject().put("spotify", verified).put("spotifySession", stored()).put("oauth", hasOAuth()).put("spotifyWebAuthorized",hasOAuth() && prefs.getString("oauth_scopes","")!!.split(' ').containsAll(listOf("streaming","user-read-email")))
            .put("spotifyState", if (verified) "verified" else if (stored()) "authorization_required" else "disconnected")
            .put("spotifyMessage", if (verified) "Biblioteca autorizada" else prefs.getString("spotify_error", if (stored()) "Sesión guardada sin acceso comprobado a la biblioteca. Autoriza Spotify con OAuth." else "Autoriza tu biblioteca con OAuth"))
            .put("spotifyCode", prefs.getString("spotify_code", "")).put("clientId", prefs.getString("client_id", prefs.getString("pending_client_id", "")))
            .put("spotifyVerifiedAt", prefs.getLong("spotify_verified_at", 0))
    }
    private fun json(request: Request, operation: String): JSONObject = http.newCall(request).execute().use { response ->
        val text = response.body?.string().orEmpty()
        if (!response.isSuccessful) {
            val reason = try { JSONObject(text).optJSONObject("error")?.optString("reason").orEmpty() } catch (_: Exception) { "" }
            throw ProviderFailures.response(response.code, "spotify", operation, reason)
        }
        if (text.isBlank()) JSONObject() else try { JSONObject(text) } catch (_: Exception) { throw ProviderFailure("INVALID_PROVIDER_RESPONSE", response.code,"spotify",operation,"Spotify devolvió una respuesta inesperada. Intenta nuevamente.") }
    }
    @Synchronized private fun accessToken(force: Boolean = false): String {
        if (!force && token != null && System.currentTimeMillis() < expires - 60000) return token!!
        val refresh = prefs.getString("refresh_token", null)
        val oauth = !refresh.isNullOrBlank()
        val epoch=prefs.getLong("spotify_epoch",0)
        val data = if (oauth) json(Request.Builder().url("https://accounts.spotify.com/api/token").post(FormBody.Builder().add("grant_type","refresh_token").add("refresh_token",refresh!!).add("client_id",prefs.getString("client_id","")!!).build()).build(),"oauth_token")
        else {
            val cookie = prefs.getString("spotify_cookie", null) ?: throw ProviderFailure("SPOTIFY_OAUTH_REQUIRED",401,"spotify","authorization","Autoriza Spotify con OAuth desde Conexiones para acceder a tu biblioteca.")
            json(Request.Builder().url("https://open.spotify.com/get_access_token?reason=transport&productType=web_player").header("Cookie",cookie).header("User-Agent","Mozilla/5.0").build(),"web_token")
        }
        check(epoch==prefs.getLong("spotify_epoch",0) && (!oauth || refresh==prefs.getString("refresh_token",null))){"La sesión de Spotify cambió. Vuelve a elegir la canción."}
        token = data.optString(if (oauth) "access_token" else "accessToken").takeIf { it.isNotBlank() }
            ?: throw ProviderFailure("SPOTIFY_OAUTH_REQUIRED",403,"spotify","authorization","La sesión web no otorgó acceso a Spotify. Autoriza tu Client ID con OAuth desde Conexiones.")
        expires = if (oauth) System.currentTimeMillis()+data.optLong("expires_in",3600)*1000 else data.optLong("accessTokenExpirationTimestampMs",System.currentTimeMillis()+300000)
        if (data.has("refresh_token")) prefs.edit().putString("refresh_token",data.getString("refresh_token")).apply()
        return token!!
    }
    private fun operation(path: String) = when { path.startsWith("/me/player") -> "playback"; path == "/me" -> "profile"; path.startsWith("/playlists/") -> "playlist"; path.startsWith("/me/top/") -> "top_tracks"; path.startsWith("/search") -> "search"; else -> "library" }
    fun request(path: String, method: String = "GET", body: String = "", checking: Boolean = false): JSONObject {
        require(path.startsWith('/') && !path.startsWith("//") && !path.contains("\\") && !path.contains("..") && !path.contains('\r') && !path.contains('\n')) { "Ruta Spotify inválida" }
        require(method in listOf("GET","PUT","POST","DELETE")) { "Método inválido" }
        if (!checking && !hasOAuth() && !prefs.getBoolean("spotify_verified",false)) throw ProviderFailure("SPOTIFY_OAUTH_REQUIRED",403,"spotify",operation(path),"La cookie guardada no autoriza la biblioteca de Spotify. Conecta tu Client ID con OAuth desde Conexiones.")
        fun make(force: Boolean) = Request.Builder().url("https://api.spotify.com/v1$path").header("Authorization","Bearer "+accessToken(force)).method(method,if(method=="GET") null else body.toRequestBody("application/json".toMediaType())).build()
        try { return try { json(make(false),operation(path)) } catch (error: ProviderFailure) { if(error.status==401 && hasOAuth()) json(make(true),operation(path)) else throw error } }
        catch (error: ProviderFailure) { invalidate(error); throw error }
    }
    fun verify(): JSObject {
        try {
            request("/me",checking=true)
            request("/me/tracks?limit=1",checking=true)
            prefs.edit().putBoolean("spotify_verified",true).putInt("verification_version",2).putLong("spotify_verified_at",System.currentTimeMillis()).remove("spotify_error").remove("spotify_code").apply()
            return status()
        } catch (error: ProviderFailure) { invalidate(error); throw error }
    }
    fun play(uri: String): JSONObject {
        require(uri.matches(Regex("spotify:track:[A-Za-z0-9]{22}"))) { "La canción de Spotify no tiene un identificador válido" }
        val devices = request("/me/player/devices").optJSONArray("devices")
        val available = (0 until (devices?.length() ?: 0)).map { devices!!.getJSONObject(it) }.filter { !it.optBoolean("is_restricted") && it.optString("id").isNotBlank() }
        val device = available.firstOrNull { it.optBoolean("is_active") } ?: available.firstOrNull { it.optString("type").equals("Smartphone",true) } ?: available.firstOrNull()
            ?: throw ProviderFailures.response(404,"spotify","playback")
        val id = device.getString("id")
        if (!device.optBoolean("is_active")) request("/me/player","PUT",JSONObject().put("device_ids",org.json.JSONArray().put(id)).put("play",false).toString())
        request("/me/player/play?device_id="+android.net.Uri.encode(id),"PUT",JSONObject().put("uris",org.json.JSONArray().put(uri)).put("position_ms",0).toString())
        return JSONObject().put("deviceName",device.optString("name")).put("deviceType",device.optString("type"))
    }
}
