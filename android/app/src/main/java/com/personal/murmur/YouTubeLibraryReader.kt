package com.personal.murmur

import org.json.JSONObject
import org.json.JSONArray
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.MediaType.Companion.toMediaType
import java.security.MessageDigest

class YouTubeLibraryReader(private val cookie: String,private val config:JSONObject=JSONObject()) {
    private var version: String? = config.optString("clientVersion").takeIf(YouTubeSessionConfiguration::validVersion)
    private fun clientVersion(): String {
        version?.let { return it }
        val html=NativeNetwork.client.newCall(Request.Builder().url("https://music.youtube.com/").header("Cookie",cookie).build()).execute().use { response -> if(!response.isSuccessful)throw ProviderFailures.response(response.code,"youtube","private_library"); response.body?.string().orEmpty() }
        val found=YouTubeSessionConfiguration.fromHtml(html)
            ?: error("Renueva la sesión de YouTube, espera a volver a YouTube Music y pulsa Guardar conexión para capturar su configuración.")
        version=found;return found
    }
    private fun request(browseId: String? = null, continuation: String? = null,
                        home: Boolean = false, accountMenu: Boolean = false): JSONObject {
        val pairs=cookie.split(';').map { it.trim() }
        val sapisid=(pairs.firstOrNull { it.startsWith("SAPISID=") } ?: pairs.firstOrNull { it.startsWith("__Secure-3PAPISID=") })?.substringAfter('=')
        val now=System.currentTimeMillis()/1000
        val hash=MessageDigest.getInstance("SHA-1").digest("$now $sapisid https://music.youtube.com".toByteArray()).joinToString("") { "%02x".format(it) }
        val client=clientVersion()
        val body=JSONObject().put("context",JSONObject().put("client",JSONObject().put("clientName","WEB_REMIX").put("clientVersion",client).put("hl","es")))
        config.optString("visitorData").takeIf{it.isNotBlank()}?.let{body.getJSONObject("context").getJSONObject("client").put("visitorData",it)}
        config.optString("pageId").takeIf{it.isNotBlank()}?.let{body.getJSONObject("context").put("user",JSONObject().put("onBehalfOfUser",it))}
        if (home && !accountMenu) body.put("browseId", "FEmusic_home")
        else if (continuation != null) body.put("continuation", continuation)
        else if (browseId != null) body.put("browseId", browseId)
        val endpoint = if (accountMenu) "account/account_menu" else "browse"
        val url = "https://music.youtube.com/youtubei/v1/$endpoint".toHttpUrl().newBuilder()
            .addQueryParameter("prettyPrint", "false").apply {
                if (home && continuation != null) {
                    addQueryParameter("ctoken", continuation)
                    addQueryParameter("continuation", continuation)
                    addQueryParameter("type", "next")
                }
            }.build()
        val builder=Request.Builder().url(url).header("Cookie",cookie).header("User-Agent",NativeNetwork.USER_AGENT).header("Origin","https://music.youtube.com").header("X-Origin","https://music.youtube.com").header("X-Youtube-Client-Name","67").header("X-Youtube-Client-Version",client).header("X-Goog-AuthUser",config.optString("sessionIndex","0"))
        if(sapisid!=null)builder.header("Authorization","SAPISIDHASH ${now}_$hash")
        config.optString("visitorData").takeIf{it.isNotBlank()}?.let{builder.header("X-Goog-Visitor-Id",it)}
        config.optString("pageId").takeIf{it.isNotBlank()}?.let{builder.header("X-Goog-PageId",it)}
        val data=NativeNetwork.client.newCall(builder.post(body.toString().toRequestBody("application/json".toMediaType())).build()).execute().use { response -> if(!response.isSuccessful)throw ProviderFailures.response(response.code,"youtube","private_library");JSONObject(response.body?.string() ?: "{}") }
        if(data.has("error") || (!accountMenu && !data.has("contents")&&!data.has("continuationContents")&&!data.has("onResponseReceivedActions")))throw ProviderFailures.response(403,"youtube","private_library")
        return data
    }
    fun home(): JSONArray {
        check(cookie.split(';').any {
            val name = it.trim().substringBefore('=')
            name == "SAPISID" || name == "__Secure-3PAPISID"
        }) { "Renueva tu sesión de YouTube para cargar tu Inicio." }
        val shelves = JSONArray()
        val seenTokens = mutableSetOf<String>()
        var token: String? = null
        repeat(3) { page ->
            val data = request(continuation = token, home = true)
            val loggedOut = data.optJSONObject("responseContext")
                ?.optJSONObject("mainAppWebResponseContext")?.opt("loggedOut")
            check(loggedOut != true) { "YouTube Music cerró tu sesión. Vuelve a conectarla." }
            if (page == 0 && loggedOut != false) {
                val menu = request(accountMenu = true)
                check(YouTubePlaylistParser.hasSignedInAccount(menu)) {
                    "No pudimos confirmar tu cuenta de YouTube Music. Renueva la sesión en Conexiones."
                }
            }
            val rows = YouTubePlaylistParser.homeShelves(data)
            for (index in 0 until rows.length()) shelves.put(rows.getJSONObject(index))
            token = YouTubePlaylistParser.homeContinuation(data)?.takeIf(seenTokens::add)
            if (token == null) return shelves
        }
        return shelves
    }

    fun playlists(): JSONArray {
        val result=JSONArray();val ids=mutableSetOf<String>();val tokens=mutableSetOf<String>();var token:String?=null
        repeat(100){
            val data=request(if(token==null)"FEmusic_liked_playlists" else null,token)
            val lists=YouTubePlaylistParser.playlists(data)
            for(i in 0 until lists.length()){val list=lists.getJSONObject(i);if(ids.add(list.getString("id")))result.put(list)}
            token=YouTubePlaylistParser.continuation(data)
            if(token==null)return result
            check(tokens.add(token!!)){"YouTube repitió una página de la biblioteca. Tus playlists locales se conservan."}
        }
        error("La biblioteca supera el límite de páginas. Tus playlists locales se conservan.")
    }
    fun collection(id:String):JSONObject {
        val browse=if(id.startsWith("MPREb"))id else "VL$id"
        val data=request(browse)
        fun title(value:Any?):String?{
            when(value){is JSONObject->{for(key in listOf("musicDetailHeaderRenderer","musicResponsiveHeaderRenderer")){value.optJSONObject(key)?.optJSONObject("title")?.let{t->val runs=t.optJSONArray("runs");val text=t.optString("simpleText").ifBlank{runs?.let{(0 until it.length()).joinToString(""){i->it.optJSONObject(i)?.optString("text").orEmpty()}}.orEmpty()};if(text.isNotBlank())return text}};for(key in value.keys())title(value.opt(key))?.let{return it}}
            is JSONArray->for(i in 0 until value.length())title(value.opt(i))?.let{return it}}
            return null
        }
        return JSONObject().put("title",title(data)?:"Colección de YouTube").put("tracks",tracks("ytpl:$browse"))
    }
    fun tracks(id: String): JSONArray {
        val browse=id.removePrefix("ytpl:")
        require(browse.matches(Regex("(?:VL|MPREb)[A-Za-z0-9_-]{2,120}"))) { "Playlist YouTube inválida" }
        val result=JSONArray();val ids=mutableSetOf<String>();val tokens=mutableSetOf<String>();var token:String?=null
        repeat(100) {
            val page=YouTubePlaylistParser.parse(request(if(token==null)browse else null,token))
            for(i in 0 until page.tracks.length()) { val track=page.tracks.getJSONObject(i);if(ids.add(track.getString("id")))result.put(track) }
            token=page.continuation
            if(token==null)return result
            check(tokens.add(token!!)) { "YouTube repitió una página de la playlist. Se conservaron tus datos locales." }
        }
        error("La playlist supera el límite de paginación. No se reemplazaron tus datos locales.")
    }
}

