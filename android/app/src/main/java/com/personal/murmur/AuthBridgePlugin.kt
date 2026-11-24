package com.personal.murmur

import android.app.Dialog
import android.graphics.Color
import android.webkit.*
import android.widget.*
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.getcapacitor.*
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.*
import okhttp3.Request
import okhttp3.FormBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.MediaType.Companion.toMediaType
import org.json.JSONObject
import java.security.MessageDigest
import java.security.SecureRandom
import android.util.Base64

@CapacitorPlugin(name = "AuthBridge")
class AuthBridgePlugin : Plugin() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val prefs by lazy { EncryptedSharedPreferences.create(context, "hybrid_sessions", MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(), EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV, EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM) }
    private val spotify by lazy { SpotifySession(prefs) }
    private val remote by lazy { SpotifyRemotePlayer(activity) }
    private val engineAuth by lazy { com.personal.murmur.spotify.SpotifyEngineAuthorization(context) }
    private var engineServer: LoopbackOAuthServer?=null
    private var oauthServer: LoopbackOAuthServer? = null
    private var loginDialog: Dialog? = null
    private var loginView: WebView? = null
    private var loginCall: PluginCall? = null
    private fun async(call: PluginCall, block: suspend () -> JSObject) { scope.launch { try { call.resolve(block()) } catch (e: ProviderFailure) { if(e.provider=="youtube")prefs.edit().putBoolean("youtube_verified",false).apply(); call.reject(e.message ?: "Acceso denegado", e.code, JSObject().put("status", e.status).put("provider", e.provider).put("operation", e.operation)) } catch (e: java.io.IOException) { call.reject("No se pudo contactar con el servicio. Revisa la conexión e intenta nuevamente.", "NETWORK_ERROR") } catch (e: Exception) { call.reject(e.message ?: "No se pudo conectar") } } }
    @PluginMethod fun status(call: PluginCall) { call.resolve(connectionStatus()) }
    private fun connectionStatus(): JSObject {
        val result=spotify.status().put("youtube", prefs.getBoolean("youtube_verified", false) && !prefs.getString("youtube_cookie", null).isNullOrBlank()).put("youtubeSession", !prefs.getString("youtube_cookie", null).isNullOrBlank()).put("youtubePublicAudio", true)
        result.put("youtubeRevision", prefs.getLong("youtube_revision", 0))
            .put("spotifyRevision", prefs.getLong("spotify_revision", 0))
        val engine=engineAuth.status();engine.keys().forEach { key -> result.put(key,engine.get(key)) };return result
    }
    private suspend fun playbackService():HybridMediaService {
        HybridMediaService.instance?.let{return it}
        androidx.core.content.ContextCompat.startForegroundService(context,android.content.Intent(context,HybridMediaService::class.java))
        repeat(60){HybridMediaService.instance?.let{return it};delay(50)};error("No se pudo iniciar el servicio de música")
    }
    @PluginMethod fun setSpotifyPlaybackMode(call:PluginCall)=async(call){
        val mode=call.getString("mode") ?: error("Falta modo")
        require(mode in listOf("integrated","web","connect")){"Modo inválido"}
        if(mode!=engineAuth.mode())HybridMediaService.instance?.shutdownIntegrated()?.join()
        if(mode!="connect")remote.disconnect()
        engineAuth.mode(mode);connectionStatus()
    }
    @PluginMethod fun authorizeSpotifyEngine(call:PluginCall)=async(call){
        engineServer?.stop();HybridMediaService.instance?.shutdownIntegrated()
        val url=engineAuth.begin()
        engineServer=LoopbackOAuthServer(scope,{ uri -> scope.launch { try {
            withContext(Dispatchers.IO){engineAuth.finish(uri)}
            NativeEvents.emit("onSpotifyEngineAuthorized",JSObject().put("authorized",true))
        } catch(failure:Exception){engineAuth.cancelPending();NativeEvents.emit("onAuthError",JSObject().put("message",failure.message ?: "No se pudo autorizar el motor de Spotify"))} finally {LoginKeepAlive.stop(context)} } },{ message -> engineAuth.cancelPending();LoginKeepAlive.stop(context);NativeEvents.emit("onAuthError",JSObject().put("message",message)) },5588,"/login")
        try {
            withContext(Dispatchers.IO){engineServer!!.start()}
            LoginKeepAlive.start(context)
            activity.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW,url))
        } catch(failure:Exception) {
            engineServer?.stop();engineAuth.cancelPending();LoginKeepAlive.stop(context);throw failure
        }
        JSObject().put("started",true)
    }
    @PluginMethod fun completeSpotifyEngineAuthorization(call:PluginCall)=async(call){
        val uri=android.net.Uri.parse(call.getString("url")?.trim() ?: error("Pega el enlace de retorno"))
        require(uri.scheme=="http" && uri.host=="127.0.0.1" && uri.port==5588 && uri.path=="/login" && uri.userInfo==null && uri.fragment==null && uri.toString().length<=8192){"Pega el enlace local de autorización del motor de Spotify."}
        withContext(Dispatchers.IO){engineAuth.finish(uri)};engineServer?.stop();LoginKeepAlive.stop(context)
        NativeEvents.emit("onSpotifyEngineAuthorized",JSObject().put("authorized",true));connectionStatus()
    }
    @PluginMethod fun verifySpotify(call: PluginCall) = async(call) { withContext(Dispatchers.IO) { spotify.verify(); connectionStatus() } }
    @PluginMethod fun playSpotify(call: PluginCall) = async(call) {
        val request = PlaybackRequests.next()
        val uri = call.getString("uri") ?: error("Falta canción")
        if(engineAuth.mode() in listOf("integrated","web")) {
            val metadata=JSONObject(call.data.toString()).apply{put("spotifyUri",uri);put("source","spotify")}
            val service=playbackService();check(PlaybackRequests.isCurrent(request)){"Solicitud sustituida"};service.playIntegrated(metadata,engineAuth.mode()=="web")
            val snapshot=service.integratedState()
            if(snapshot.optString("error").isNotBlank())throw ProviderFailure("SPOTIFY_ENGINE_FAILED",0,"spotify","engine_playback",snapshot.optString("error"))
            return@async JSObject().put("deviceName",snapshot.optJSONObject("device")?.optString("name")).put("deviceType","Smartphone").put("transport","integrated").put("playing",snapshot.optBoolean("is_playing")).put("loading",snapshot.optBoolean("loading"))
        }
        HybridMediaService.instance?.pausePlayback()
        val client = prefs.getString("client_id", "").orEmpty()
        if (remote.connected && client.matches(Regex("[A-Fa-f0-9]{32}"))) {
            remote.play(client, uri); JSObject().put("deviceName", "Este teléfono · Spotify").put("deviceType", "Smartphone")
        } else try { withContext(Dispatchers.IO) { JSObject(spotify.play(uri).toString()) } }
        catch (error: ProviderFailure) {
            if (error.code != "SPOTIFY_NO_DEVICE" || !client.matches(Regex("[A-Fa-f0-9]{32}"))) throw error
            remote.play(client, uri)
            JSObject().put("deviceName", "Este teléfono · Spotify").put("deviceType", "Smartphone")
        }
    }
    @PluginMethod fun spotifyAndroidSetup(call: PluginCall) = async(call) { withContext(Dispatchers.IO) {
        val signatures = if (android.os.Build.VERSION.SDK_INT >= 28) context.packageManager.getPackageInfo(context.packageName, android.content.pm.PackageManager.GET_SIGNING_CERTIFICATES).signingInfo?.apkContentsSigners
            else @Suppress("DEPRECATION") context.packageManager.getPackageInfo(context.packageName, android.content.pm.PackageManager.GET_SIGNATURES).signatures
        val signature = signatures?.firstOrNull() ?: error("No se pudo consultar la firma de esta instalación")
        val sha1 = MessageDigest.getInstance("SHA-1").digest(signature.toByteArray()).joinToString(":") { "%02X".format(it) }
        JSObject().put("packageName",context.packageName).put("sha1",sha1).put("redirectUri",LoopbackOAuthServer.REDIRECT)
    } }
    @PluginMethod fun openSpotify(call: PluginCall) { val intent = context.packageManager.getLaunchIntentForPackage("com.spotify.music"); if (intent == null) { call.reject("Instala o abre Spotify en un dispositivo Connect.", "SPOTIFY_APP_NOT_INSTALLED"); return }; activity.startActivity(intent); call.resolve() }
    @PluginMethod fun login(call: PluginCall) {
        val provider = call.getString("provider") ?: return call.reject("Proveedor inválido")
        if (provider !in listOf("spotify", "youtube")) return call.reject("Proveedor inválido")
        activity.runOnUiThread {
            if (loginDialog != null) { call.reject("Ya hay un inicio de sesión abierto"); return@runOnUiThread }
            val dialog = Dialog(activity, android.R.style.Theme_Material_NoActionBar); loginDialog = dialog; loginCall = call
            val layout = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.BLACK); setPadding(12, 28, 12, 8) }
            val hint = TextView(activity).apply { text = "Inicia sesión en ${if (provider == "spotify") "accounts.spotify.com" else "music.youtube.com"}. La sesión se guardará cifrada en este dispositivo."; setTextColor(Color.WHITE); setPadding(16, 12, 16, 12) }
            val browser = WebView(activity); loginView = browser; browser.settings.javaScriptEnabled = true; browser.settings.domStorageEnabled = true; browser.settings.allowFileAccess = false; browser.settings.allowContentAccess = false; browser.settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            val manager = CookieManager.getInstance(); manager.setAcceptCookie(true); manager.setAcceptThirdPartyCookies(browser, true)
            browser.webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean { val uri = request.url; val host = uri.host ?: return true; val allowed = if (provider == "spotify") host == "spotify.com" || host.endsWith(".spotify.com") || host == "google.com" || host.endsWith(".google.com") || host == "appleid.apple.com" else host == "youtube.com" || host.endsWith(".youtube.com") || host == "google.com" || host.endsWith(".google.com"); return uri.scheme != "https" || !allowed }
            }
            val save = Button(activity).apply { text = "He iniciado sesión · Guardar conexión"; setOnClickListener {
                val cookie = manager.getCookie(if (provider == "spotify") "https://open.spotify.com" else "https://music.youtube.com") ?: ""
                val keys = if (provider == "spotify") listOf("sp_dc") else listOf("SAPISID","__Secure-3PAPISID")
                if (!cookie.split(';').any { item -> keys.any{item.trim().startsWith("$it=")} }) { hint.text = "No se detectó la sesión. Completa el acceso. El proveedor puede bloquear navegadores integrados."; return@setOnClickListener }
                if(provider=="youtube") {
                    if(android.net.Uri.parse(browser.url).host!="music.youtube.com"){hint.text="Vuelve a YouTube Music, espera a que cargue y pulsa Guardar conexión.";browser.loadUrl("https://music.youtube.com/");return@setOnClickListener}
                    browser.evaluateJavascript(YouTubeSessionConfiguration.SCRIPT){raw ->
                        try {
                            val config=YouTubeSessionConfiguration.fromJavascript(raw)
                            prefs.edit().putString("youtube_cookie",cookie).putString("youtube_config",config.toString()).putLong("youtube_revision",prefs.getLong("youtube_revision",0)+1).putBoolean("youtube_verified",false).apply()
                            youtubeReader=null;manager.flush();loginCall=null;dialog.dismiss();call.resolve(JSObject().put("connected",false).put("sessionStored",true))
                        }catch(failure:Exception){hint.text=failure.message ?: "Espera a que termine de cargar YouTube Music y vuelve a guardar."}
                    };return@setOnClickListener
                }
                prefs.edit().putString(provider + "_cookie", cookie).putBoolean(provider + "_verified", false).apply(); prefs.edit().putLong("spotify_revision",prefs.getLong("spotify_revision",0)+1).apply(); spotify.clearToken(); manager.flush(); loginCall = null; dialog.dismiss(); call.resolve(JSObject().put("connected", false).put("sessionStored", true))
            } }
            val close = Button(activity).apply { text = "Cancelar"; setOnClickListener { dialog.cancel() } }
            layout.addView(hint); layout.addView(browser, LinearLayout.LayoutParams(-1, 0, 1f)); layout.addView(save); layout.addView(close); dialog.setContentView(layout)
            dialog.setOnDismissListener { loginCall?.reject("Inicio de sesión cancelado"); loginCall = null; loginDialog = null; loginView?.destroy(); loginView = null }
            dialog.show(); browser.loadUrl(if (provider == "spotify") "https://accounts.spotify.com/login" else "https://music.youtube.com")
        }
    }
    private fun requestJson(request: Request, provider: String = "youtube", operation: String = "private_library"): JSONObject = NativeNetwork.client.newCall(request).execute().use { response ->
        val text = response.body?.string().orEmpty()
        if (!response.isSuccessful) throw ProviderFailures.response(response.code, provider, operation)
        if (text.isBlank()) JSONObject() else JSONObject(text)
    }
    @PluginMethod fun spotifyRequest(call: PluginCall) = async(call) {
        val path = call.getString("path") ?: error("Falta ruta")
        val method = call.getString("method", "GET")!!
        if(engineAuth.mode() in listOf("integrated","web") && path.startsWith("/me/player") && !path.startsWith("/me/player/devices")) {
            val service=HybridMediaService.instance
            val local=when {
                method=="GET" && path=="/me/player" -> service?.takeIf{it.spotifyActive}?.integratedState() ?: JSONObject()
                method=="PUT" && path=="/me/player/pause" -> {service?.pauseIntegrated();JSONObject()}
                method=="PUT" && path=="/me/player/play" -> {val active=service?.takeIf{it.spotifyActive}?:error("Vuelve a elegir una canción de Spotify");active.resumeIntegrated();JSONObject()}
                method=="PUT" && path.startsWith("/me/player/seek?position_ms=") -> {service?.seekIntegrated(path.substringAfter("position_ms=").substringBefore('&').toLong().coerceAtLeast(0));JSONObject()}
                else -> throw IllegalArgumentException("Control no disponible en el motor local")
            }
            return@async JSObject().put("data",local)
        }
        when {
            remote.connected && method == "PUT" && path == "/me/player/pause" -> { remote.pause(); JSObject().put("data",JSObject()) }
            remote.connected && method == "PUT" && path == "/me/player/play" -> { remote.resume(); JSObject().put("data",JSObject()) }
            remote.connected && method == "PUT" && path.startsWith("/me/player/seek?position_ms=") -> { remote.seek(path.substringAfter("position_ms=").substringBefore('&').toLong().coerceAtLeast(0)); JSObject().put("data",JSObject()) }
            else -> withContext(Dispatchers.IO) { JSObject().put("data", spotify.request(path, method, call.getString("body") ?: "")) }
        }
    }
    private var youtubeReader: YouTubeLibraryReader? = null
    private fun youtube(): YouTubeLibraryReader = youtubeReader ?: YouTubeLibraryReader(prefs.getString("youtube_cookie",null) ?: error("Renueva la sesión de YouTube para importar canciones privadas"),runCatching{JSONObject(prefs.getString("youtube_config","{}")!!)}.getOrDefault(JSONObject())).also { youtubeReader=it }
    @PluginMethod fun youtubeCollection(call:PluginCall)=async(call){
        val id=call.getString("id")?:error("Falta colección")
        require(id.matches(Regex("[A-Za-z0-9_-]{2,120}"))){"Identificador inválido"}
        withContext(Dispatchers.IO){
            val data=if(call.getBoolean("personalized", false)==true) youtube().collection(id)
            else if(id.startsWith("MPREb"))YouTubeLibraryReader(prefs.getString("youtube_cookie","").orEmpty(),runCatching{JSONObject(prefs.getString("youtube_config","{}")!!)}.getOrDefault(JSONObject())).collection(id)
            else try{YouTubeCollectionReader.read(id)}catch(failure:Exception){
                try{YouTubeLibraryReader(prefs.getString("youtube_cookie","").orEmpty(),runCatching{JSONObject(prefs.getString("youtube_config","{}")!!)}.getOrDefault(JSONObject())).collection(id)}
                catch(fallback:Exception){throw IllegalStateException("No se pudo leer esta colección. Revisa el enlace y conecta YouTube si es privada. "+fallback.message,fallback)}
            }
            JSObject(data.toString())
        }
    }
    @PluginMethod fun youtubeHome(call: PluginCall) = async(call) {
        withContext(Dispatchers.IO) { JSObject().put("shelves", youtube().home()) }
    }

    @PluginMethod fun youtubeLibrary(call: PluginCall) = async(call) { withContext(Dispatchers.IO) { val lists=youtube().playlists(); prefs.edit().putBoolean("youtube_verified",true).apply(); JSObject().put("playlists",lists) } }
    @PluginMethod fun youtubePlaylist(call: PluginCall) = async(call) { val id=call.getString("id") ?: error("Falta playlist"); withContext(Dispatchers.IO) { JSObject().put("tracks",youtube().tracks(id)) } }
    @PluginMethod fun logout(call: PluginCall)=async(call) {
        val provider = call.getString("provider") ?: error("Falta proveedor")
        require(provider in listOf("spotify", "youtube")){"Proveedor inválido"}
        if(provider=="spotify")prefs.edit().putLong("spotify_epoch",prefs.getLong("spotify_epoch",0)+1).apply()
        if (provider == "spotify") {LoginKeepAlive.stop(context);remote.disconnect();engineServer?.stop();engineAuth.clear();val service=HybridMediaService.instance;if(service!=null)service.shutdownIntegrated(true).join()else withContext(Dispatchers.IO){com.personal.murmur.spotify.SpotifyEngineAuthorization.clearRuntimeFiles(context)}}
        prefs.edit().remove(provider + "_cookie").putBoolean(provider + "_verified",false)
            .putLong(provider + "_revision",prefs.getLong(provider + "_revision",0)+1).apply()
        if (provider == "spotify") {
            oauthServer?.stop()
            prefs.edit().remove("refresh_token").remove("oauth_scopes").remove("client_id").remove("pkce").remove("oauth_state").remove("pending_client_id").remove("oauth_started_at").apply()
            spotify.clearToken()
        } else {youtubeReader=null;prefs.edit().remove("youtube_config").apply()}
        val hosts = if (provider == "spotify") listOf("https://spotify.com", "https://accounts.spotify.com", "https://open.spotify.com") else listOf("https://youtube.com", "https://music.youtube.com", "https://accounts.google.com")
        hosts.forEach { host -> (CookieManager.getInstance().getCookie(host) ?: "").split(';').forEach { cookie ->
            val name = cookie.trim().substringBefore('=')
            if (name.isNotBlank()) CookieManager.getInstance().setCookie(host, "$name=; Max-Age=0; Path=/; Secure")
        } }
        CookieManager.getInstance().flush()
        JSObject()
    }
    @PluginMethod fun oauthLogin(call: PluginCall) = async(call) {
        val id = call.getString("clientId")?.trim() ?: error("Falta Client ID")
        require(id.matches(Regex("[a-fA-F0-9]{32}"))) { "El Client ID debe contener 32 caracteres hexadecimales" }
        val random = ByteArray(48).also { SecureRandom().nextBytes(it) }
        val verifier = Base64.encodeToString(random, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
        val challenge = Base64.encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray()), Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
        val state = java.util.UUID.randomUUID().toString()
        oauthServer?.stop()
        val server = LoopbackOAuthServer(scope, { uri -> oauthCallback(uri) }, { message -> LoginKeepAlive.stop(context);NativeEvents.emit("onAuthError",JSObject().put("message",message)) })
        withContext(Dispatchers.IO) { server.start() }; oauthServer = server
        prefs.edit().putString("pkce",verifier).putString("pending_client_id",id).putString("oauth_state",state).putLong("oauth_started_at",System.currentTimeMillis()).apply()
        val uri = android.net.Uri.parse("https://accounts.spotify.com/authorize").buildUpon().appendQueryParameter("client_id",id).appendQueryParameter("response_type","code").appendQueryParameter("redirect_uri",LoopbackOAuthServer.REDIRECT).appendQueryParameter("code_challenge_method","S256").appendQueryParameter("code_challenge",challenge).appendQueryParameter("state",state).appendQueryParameter("scope","streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state playlist-read-private playlist-read-collaborative user-library-read user-library-modify user-top-read").build()
        try { LoginKeepAlive.start(context);activity.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW,uri)) } catch(e: Exception) { LoginKeepAlive.stop(context);server.stop(); throw e }
        JSObject()
    }
    fun oauthCallback(uri: android.net.Uri) { scope.launch {
        try {
            check(OAuthCallbackRequest.validState(prefs.getString("oauth_state",null),uri.getQueryParameter("state"),prefs.getLong("oauth_started_at",0),System.currentTimeMillis())) { "La autorización caducó o su respuesta no es válida. Inicia OAuth de nuevo." }
            if(uri.getQueryParameter("error") != null) throw ProviderFailure("SPOTIFY_AUTHORIZATION_DENIED",403,"spotify","authorization","Spotify no concedió la autorización. Comprueba la cuenta y los usuarios permitidos de tu aplicación en Spotify for Developers y vuelve a autorizar.")
            val code = uri.getQueryParameter("code") ?: error("Autorización cancelada en Spotify")
            val client = prefs.getString("pending_client_id",null) ?: error("Falta Client ID de la autorización")
            val result = withContext(Dispatchers.IO) { requestJson(Request.Builder().url("https://accounts.spotify.com/api/token").post(FormBody.Builder().add("grant_type","authorization_code").add("code",code).add("redirect_uri",LoopbackOAuthServer.REDIRECT).add("client_id",client).add("code_verifier",prefs.getString("pkce","")!!).build()).build(),"spotify","oauth_token") }
            check(prefs.getString("oauth_state",null)==uri.getQueryParameter("state")) { "La autorización se canceló antes de terminar." }
            prefs.edit().putLong("spotify_revision",prefs.getLong("spotify_revision",0)+1).putString("refresh_token",result.getString("refresh_token")).putString("oauth_scopes",result.optString("scope")).putString("client_id",client).putBoolean("spotify_verified",false).remove("pkce").remove("oauth_state").remove("pending_client_id").remove("oauth_started_at").apply()
            spotify.clearToken()
            withContext(Dispatchers.IO) { spotify.verify() }
            NativeEvents.emit("onAuthChanged",JSObject().put("provider","spotify").put("verified",true))
        } catch(e: Exception) { NativeEvents.emit("onAuthError",JSObject().put("message",e.message ?: "No se pudo autorizar Spotify").put("code",(e as? ProviderFailure)?.code ?: "AUTH_FAILED")); NativeEvents.emit("onAuthChanged") } finally {LoginKeepAlive.stop(context)}
    } }
    override fun handleOnStop() { if (remote.connected) remote.disconnect(); super.handleOnStop() }
    override fun handleOnDestroy() { LoginKeepAlive.stop(context);engineServer?.stop();remote.disconnect(); loginDialog?.dismiss(); oauthServer?.stop(); scope.cancel(); super.handleOnDestroy() }
}
