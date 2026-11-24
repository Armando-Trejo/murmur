package com.personal.murmur

import org.json.JSONObject
import org.json.JSONArray
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.MediaType.Companion.toMediaType
import java.security.MessageDigest

class YouTubeLibraryReader(private val cookie: String,private val config:JSONObject=JSONObject()) {
    companion object {
        /** Used only for anonymous public requests when the page does not expose its client version. */
        const val PUBLIC_CLIENT_VERSION = "1.20241118.01.00"
        /** YouTube Music search tabs ("params" of the Artists and Albums chips). */
        const val ARTISTS_FILTER = "EgWKAQIgAWoMEA4QChADEAQQCRAF"
        const val ALBUMS_FILTER = "EgWKAQIYAWoMEA4QChADEAQQCRAF"
        const val SONGS_FILTER = "EgWKAQIIAWoMEA4QChADEAQQCRAF"
        const val FEATURED_PLAYLISTS_FILTER = "EgeKAQQoADgBagwQDhAKEAMQBBAJEAU"
        const val COMMUNITY_PLAYLISTS_FILTER = "EgeKAQQoAEABagwQDhAKEAMQBBAJEAU"
    }
    private var version: String? = config.optString("clientVersion").takeIf(YouTubeSessionConfiguration::validVersion)
    private val signedIn get() = cookie.split(';').any {
        val name = it.trim().substringBefore('=')
        name == "SAPISID" || name == "__Secure-3PAPISID"
    }
    private fun clientVersion(): String {
        version?.let { return it }
        val html=runCatching {
            NativeNetwork.client.newCall(Request.Builder().url("https://music.youtube.com/").header("User-Agent",NativeNetwork.USER_AGENT).apply { if(cookie.isNotBlank())header("Cookie",cookie) }.build()).execute().use { response -> if(!response.isSuccessful)throw ProviderFailures.response(response.code,"youtube","private_library"); response.body?.string().orEmpty() }
        }.getOrElse { if (signedIn) throw it else "" }
        val found=YouTubeSessionConfiguration.fromHtml(html)
            ?: if (!signedIn) PUBLIC_CLIENT_VERSION
            else error("Renueva la sesión de YouTube, espera a volver a YouTube Music y pulsa Guardar conexión para capturar su configuración.")
        version=found;return found
    }
    private fun request(browseId: String? = null, continuation: String? = null,
                        home: Boolean = false, accountMenu: Boolean = false,
                        watch: JSONObject? = null, search: String? = null, searchParams: String? = null): JSONObject {
        val pairs=cookie.split(';').map { it.trim() }
        val sapisid=(pairs.firstOrNull { it.startsWith("SAPISID=") } ?: pairs.firstOrNull { it.startsWith("__Secure-3PAPISID=") })?.substringAfter('=')
        val now=System.currentTimeMillis()/1000
        val hash=MessageDigest.getInstance("SHA-1").digest("$now $sapisid https://music.youtube.com".toByteArray()).joinToString("") { "%02x".format(it) }
        val client=clientVersion()
        val body=JSONObject().put("context",JSONObject().put("client",JSONObject().put("clientName","WEB_REMIX").put("clientVersion",client).put("hl","es")))
        config.optString("visitorData").takeIf{it.isNotBlank()}?.let{body.getJSONObject("context").getJSONObject("client").put("visitorData",it)}
        config.optString("pageId").takeIf{it.isNotBlank()}?.let{body.getJSONObject("context").put("user",JSONObject().put("onBehalfOfUser",it))}
        if (watch != null) watch.keys().forEach { body.put(it, watch.get(it)) }
        else if (search != null) { body.put("query", search); searchParams?.let { body.put("params", it) } }
        else if (home && !accountMenu) body.put("browseId", "FEmusic_home")
        else if (continuation != null) body.put("continuation", continuation)
        else if (browseId != null) body.put("browseId", browseId)
        val endpoint = when { accountMenu -> "account/account_menu"; watch != null -> "next"; search != null -> "search"; else -> "browse" }
        val operation = if (watch != null || search != null || !signedIn) "public_music" else "private_library"
        val url = "https://music.youtube.com/youtubei/v1/$endpoint".toHttpUrl().newBuilder()
            .addQueryParameter("prettyPrint", "false").apply {
                if ((home || watch != null) && continuation != null) {
                    addQueryParameter("ctoken", continuation)
                    addQueryParameter("continuation", continuation)
                    addQueryParameter("type", "next")
                }
            }.build()
        val builder=Request.Builder().url(url).apply { if(cookie.isNotBlank())header("Cookie",cookie) }.header("User-Agent",NativeNetwork.USER_AGENT).header("Origin","https://music.youtube.com").header("X-Origin","https://music.youtube.com").header("X-Youtube-Client-Name","67").header("X-Youtube-Client-Version",client).header("X-Goog-AuthUser",config.optString("sessionIndex","0"))
        if(sapisid!=null)builder.header("Authorization","SAPISIDHASH ${now}_$hash")
        config.optString("visitorData").takeIf{it.isNotBlank()}?.let{builder.header("X-Goog-Visitor-Id",it)}
        config.optString("pageId").takeIf{it.isNotBlank()}?.let{builder.header("X-Goog-PageId",it)}
        val data=NativeNetwork.client.newCall(builder.post(body.toString().toRequestBody("application/json".toMediaType())).build()).execute().use { response -> if(!response.isSuccessful)throw ProviderFailures.response(response.code,"youtube",operation);JSONObject(response.body?.string() ?: "{}") }
        if(data.has("error") || (!accountMenu && !data.has("contents")&&!data.has("continuationContents")&&!data.has("onResponseReceivedActions")))throw ProviderFailures.response(403,"youtube",operation)
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
        val header=YouTubeMusicPages.header(request(browse))
        val tracks=tracks("ytpl:$browse")
        val artwork=header.optString("artworkUrl")
        val artist=header.optString("artist")
        // Album rows carry neither cover nor artist: inherit them from the album header.
        for(i in 0 until tracks.length()){
            val track=tracks.getJSONObject(i)
            if(track.optString("artworkUrl").isBlank()&&artwork.isNotBlank())track.put("artworkUrl",artwork)
            if(artist.isNotBlank()&&track.optString("artist")=="Artista no identificado")track.put("artist",artist)
        }
        val result=JSONObject().put("title",header.optString("title").ifBlank{"Colección de YouTube"}).put("tracks",tracks)
        for(key in listOf("artworkUrl","artist","year","subtitle"))header.optString(key).takeIf{it.isNotBlank()}?.let{result.put(key,it)}
        return result
    }

    /** Mixes and radios live in the watch queue, not in a browsable playlist. */
    fun mix(id:String, videoId:String?=null):JSONObject {
        require(id.matches(Regex("RD[A-Za-z0-9_-]{2,120}"))){"Mix de YouTube inválido"}
        val watch=JSONObject().put("playlistId",id).put("enablePersistentPlaylistPanel",true)
            .put("isAudioOnly",true).put("tunerSettingValue","AUTOMIX_SETTING_NORMAL")
        videoId?.takeIf{it.matches(Regex("[A-Za-z0-9_-]{11}"))}?.let{watch.put("videoId",it)}
        val result=JSONArray();val ids=mutableSetOf<String>();val tokens=mutableSetOf<String>()
        var title:String?=null;var token:String?=null
        for(page in 0 until 4){
            val data=YouTubeMusicPages.watchPlaylist(request(continuation=token,watch=watch))
            if(title==null)title=data.title
            for(i in 0 until data.tracks.length()){val track=data.tracks.getJSONObject(i);if(ids.add(track.getString("id")))result.put(track)}
            token=data.continuation?.takeIf(tokens::add)?:break
            if(result.length()>=100)break
        }
        check(result.length()>0){"YouTube no entregó canciones para este mix."}
        return JSONObject().put("title",title?:"Mix de YouTube").put("tracks",result)
            .put("artworkUrl",result.getJSONObject(0).optString("artworkUrl"))
    }

    /** Lyrics as YouTube Music shows them (plain text and its licensed source). */
    fun lyrics(videoId:String):YouTubeMusicPages.Lyrics? {
        require(videoId.matches(Regex("[A-Za-z0-9_-]{11}"))){"Video inválido"}
        val watch=JSONObject().put("videoId",videoId).put("enablePersistentPlaylistPanel",true).put("isAudioOnly",true)
        val browse=YouTubeMusicPages.lyricsBrowseId(request(watch=watch))?:return null
        return YouTubeMusicPages.lyrics(request(browse))
    }

    /** Best song match on YouTube Music, used to find lyrics for tracks without a video. */
    fun songVideo(query:String):String? {
        val page=YouTubeMusicPages.find(request(search=query.take(200)),setOf("musicShelfRenderer","musicCardShelfRenderer"))?:return null
        return YouTubeMusicPages.find(page,setOf("playlistItemData","watchEndpoint"))?.optString("videoId")?.takeIf{it.matches(Regex("[A-Za-z0-9_-]{11}"))}
    }

    fun artist(id:String?, name:String?):JSONObject {
        val channel=id?.takeIf{it.matches(Regex("UC[A-Za-z0-9_-]{10,120}"))}
            ?: name?.trim()?.takeIf{it.isNotBlank()}?.let(::artistChannelFor)
            ?: throw IllegalStateException("YouTube Music no encontró un perfil con el nombre exacto de este artista.")
        return YouTubeMusicPages.artist(request(channel),channel)
    }

    /** Looks up each credited name in the Artists tab of search and accepts only an exact name match. */
    private fun artistChannelFor(line:String):String? {
        val names=YouTubeMusicPages.artistNames(line)
        // Main credited artist first: each search only accepts the name it searched for.
        for(name in names.take(3)){
            YouTubeMusicPages.matchingArtistChannel(request(search=name.take(120),searchParams=ARTISTS_FILTER),listOf(name))?.let{return it}
        }
        return YouTubeMusicPages.matchingArtistChannel(request(search=names.first().take(120)),names)
    }

    /** Song results of YouTube Music search (Songs tab: official audio, album metadata, length). */
    fun searchSongs(query:String):JSONArray = YouTubeMusicPages.songResults(request(search=query.take(200),searchParams=SONGS_FILTER))

    /** Album results of YouTube Music search, newest provider order. */
    fun searchAlbums(query:String):JSONArray = YouTubeMusicPages.albumResults(request(search=query.take(200),searchParams=ALBUMS_FILTER))
    /** YouTube Music's own playlists for a mood or activity first, then community ones. */
    fun searchPlaylists(query:String):JSONArray {
        val featured = YouTubeMusicPages.playlistResults(request(search=query.take(200),searchParams=FEATURED_PLAYLISTS_FILTER))
        return if (featured.length() >= 3) featured else JSONArray().also { all ->
            for (i in 0 until featured.length()) all.put(featured.get(i))
            val community = YouTubeMusicPages.playlistResults(request(search=query.take(200),searchParams=COMMUNITY_PLAYLISTS_FILTER))
            for (i in 0 until community.length()) all.put(community.get(i))
        }
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

