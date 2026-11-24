package com.personal.murmur

import org.json.JSONObject
import org.json.JSONArray

data class YouTubePlaylistPage(val tracks: JSONArray, val continuation: String?)
object YouTubePlaylistParser {
    private fun text(value: JSONObject?): String = value?.optString("simpleText")?.takeIf { it.isNotBlank() }
        ?: value?.optJSONArray("runs")?.let { runs -> (0 until runs.length()).joinToString("") { runs.optJSONObject(it)?.optString("text").orEmpty() } }.orEmpty()
    private fun find(value: Any?, names: Set<String>): JSONObject? {
        when(value) { is JSONObject -> { for(key in names) value.optJSONObject(key)?.let { return it }; for(key in value.keys()) find(value.opt(key),names)?.let { return it } }; is JSONArray -> for(i in 0 until value.length()) find(value.opt(i),names)?.let { return it } }
        return null
    }
    private fun thumbnail(value: JSONObject): String {
        val images = find(value, setOf("musicThumbnailRenderer"))
            ?.optJSONObject("thumbnail")?.optJSONArray("thumbnails") ?: return ""
        return (0 until images.length()).mapNotNull(images::optJSONObject)
            .maxByOrNull { it.optInt("width") * it.optInt("height").coerceAtLeast(1) }
            ?.optString("url").orEmpty().let { YouTubeArtwork.hd(it) }
    }

    fun hasSignedInAccount(data: JSONObject): Boolean =
        text(find(data.opt("actions"), setOf("activeAccountHeaderRenderer"))
            ?.optJSONObject("accountName")).isNotBlank()

    private fun homeSection(data: JSONObject): JSONObject? =
        data.optJSONObject("continuationContents")?.optJSONObject("sectionListContinuation")
            ?: find(data.opt("contents"), setOf("sectionListRenderer"))
            ?: find(data.opt("onResponseReceivedActions"), setOf("appendContinuationItemsAction"))

    fun homeContinuation(data: JSONObject): String? {
        val section = homeSection(data) ?: return null
        val legacy = section.optJSONArray("continuations")?.optJSONObject(0)
        legacy?.optJSONObject("nextContinuationData")?.optString("continuation")
            ?.takeIf(String::isNotBlank)?.let { return it }
        val contents = section.optJSONArray("contents") ?: section.optJSONArray("continuationItems")
            ?: return null
        for (index in contents.length() - 1 downTo 0) {
            val item = contents.optJSONObject(index)?.optJSONObject("continuationItemRenderer")
                ?: continue
            continuation(item)?.let { return it }
        }
        return null
    }

    fun homeShelves(data: JSONObject): JSONArray {
        val result = JSONArray()
        fun walk(value: Any?) {
            when (value) {
                is JSONObject -> {
                    val shelf = value.optJSONObject("musicCarouselShelfRenderer")
                        ?: value.optJSONObject("musicShelfRenderer")
                    if (shelf == null) {
                        value.keys().forEach { walk(value.opt(it)) }
                        return
                    }
                    val header = find(shelf.opt("header"), setOf("musicCarouselShelfBasicHeaderRenderer"))
                    val title = text(header?.optJSONObject("title")).ifBlank {
                        text(shelf.optJSONObject("title")).ifBlank { "Para ti" }
                    }
                    val contents = shelf.optJSONArray("contents") ?: return
                    val entries = JSONArray()
                    val seen = mutableSetOf<String>()
                    for (i in 0 until contents.length()) {
                        val item = contents.optJSONObject(i) ?: continue
                        val row = item.optJSONObject("musicResponsiveListItemRenderer")
                            ?: item.optJSONObject("musicTwoRowItemRenderer") ?: continue
                        val firstColumn = row.optJSONArray("flexColumns")?.optJSONObject(0)
                        val endpoint = row.optJSONObject("navigationEndpoint")
                            ?: find(row.opt("title"), setOf("navigationEndpoint"))
                            ?: find(firstColumn, setOf("navigationEndpoint"))
                        val overlay = find(row.opt("overlay"), setOf("playNavigationEndpoint"))
                        val watch = endpoint?.optJSONObject("watchEndpoint")
                            ?: overlay?.optJSONObject("watchEndpoint")
                        val browse = endpoint?.optJSONObject("browseEndpoint")?.optString("browseId").orEmpty()
                        val video = row.optJSONObject("playlistItemData")?.optString("videoId")
                            ?.takeIf { it.isNotBlank() } ?: watch?.optString("videoId").orEmpty()
                        val playlist = watch?.optString("playlistId").orEmpty().ifBlank {
                            endpoint?.optJSONObject("watchPlaylistEndpoint")?.optString("playlistId").orEmpty()
                        }.ifBlank { if (browse.startsWith("VL")) browse.removePrefix("VL") else "" }
                        val collection = if (browse.startsWith("MPREb")) browse else playlist
                        val artistId = browse.removePrefix("MPLA")
                        val columns = row.optJSONArray("flexColumns")
                        fun column(index: Int) = text(columns?.optJSONObject(index)
                            ?.optJSONObject("musicResponsiveListItemFlexColumnRenderer")?.optJSONObject("text"))
                        val name = text(row.optJSONObject("title")).ifBlank { column(0) }
                        if (name.isBlank()) continue
                        val subtitle = text(row.optJSONObject("subtitle")).ifBlank { column(1) }
                        val artwork = thumbnail(row)
                        if (artistId.matches(Regex("UC[A-Za-z0-9_-]{10,120}"))) {
                            if (seen.add(artistId)) entries.put(JSONObject()
                                .put("id", artistId).put("artistId", artistId).put("title", name)
                                .put("subtitle", subtitle).put("artworkUrl", artwork))
                        } else if (collection.matches(Regex("[A-Za-z0-9_-]{2,120}")) &&
                            (browse.startsWith("MPREb") || browse.startsWith("VL") ||
                                video.isBlank() || playlist.startsWith("RD"))) {
                            if (!seen.add(collection)) continue
                            val path = if (collection.startsWith("MPREb")) "browse/$collection" else "playlist?list=$collection"
                            entries.put(JSONObject().put("id", collection).put("title", name)
                                .put("subtitle", subtitle).put("artworkUrl", artwork)
                                .put("link", "https://music.youtube.com/$path"))
                        } else if (video.matches(Regex("[A-Za-z0-9_-]{11}")) && seen.add(video)) {
                            val track = JSONObject().put("id", "yt:$video").put("videoId", video)
                                .put("source", "youtube").put("title", name)
                                .put("artist", subtitle.ifBlank { "YouTube Music" })
                                .put("duration", -1).put("artworkUrl", artwork).put("tags", JSONArray())
                            entries.put(JSONObject().put("id", video).put("title", name)
                                .put("subtitle", subtitle).put("artworkUrl", artwork).put("track", track))
                        }
                    }
                    if (entries.length() > 0) result.put(JSONObject().put("title", title).put("items", entries))
                }
                is JSONArray -> for (i in 0 until value.length()) walk(value.opt(i))
            }
        }
        val section = homeSection(data)
        walk(section?.opt("contents") ?: section?.opt("continuationItems") ?: data.opt("contents"))
        return result
    }
    fun continuation(shelf: JSONObject): String? {
        val entry=shelf.optJSONArray("continuations")?.optJSONObject(0)
        (entry?.optJSONObject("nextContinuationData") ?: entry?.optJSONObject("reloadContinuationData"))?.optString("continuation")?.takeIf { it.isNotBlank() }?.let { return it }
        find(shelf,setOf("nextContinuationData","reloadContinuationData"))?.optString("continuation")?.takeIf{it.isNotBlank()}?.let{return it}
        return find(shelf,setOf("continuationCommand"))?.optString("token")?.takeIf { it.isNotBlank() }
    }
    fun playlists(data: JSONObject): JSONArray {
        val result=JSONArray();val ids=mutableSetOf<String>()
        fun walk(value: Any?) { when(value) { is JSONObject -> {
            for(kind in listOf("musicTwoRowItemRenderer","musicResponsiveListItemRenderer","gridPlaylistRenderer","playlistRenderer")) value.optJSONObject(kind)?.let { renderer ->
                val id=renderer.optJSONObject("navigationEndpoint")?.optJSONObject("browseEndpoint")?.optString("browseId") ?: renderer.optString("playlistId").takeIf{it.isNotBlank()}?.let{"VL"+it}
                if(id!=null&&id.startsWith("VL")&&ids.add(id)) { val title=text(renderer.optJSONObject("title")).ifBlank { text(renderer.optJSONArray("flexColumns")?.optJSONObject(0)?.optJSONObject("musicResponsiveListItemFlexColumnRenderer")?.optJSONObject("text")) }; if(title.isNotBlank()) result.put(JSONObject().put("id","ytpl:$id").put("browseId",id).put("title",title).put("source","youtube").put("artworkUrl",thumbnail(renderer))) }
            };value.keys().forEach { walk(value.opt(it)) }
        }; is JSONArray -> for(i in 0 until value.length())walk(value.opt(i)) } }
        walk(data);return result
    }
    fun parse(data: JSONObject): YouTubePlaylistPage {
        val shelf=find(data,setOf("musicPlaylistShelfRenderer","musicPlaylistShelfContinuation","musicShelfRenderer","musicShelfContinuation","appendContinuationItemsAction"))
            ?: throw IllegalStateException("YouTube no entregó las canciones de esta playlist. Tus datos locales se conservan.")
        val contents=shelf.optJSONArray("contents") ?: shelf.optJSONArray("continuationItems") ?: JSONArray()
        val tracks=JSONArray();val ids=mutableSetOf<String>()
        for(i in 0 until contents.length()) {
            val row=contents.optJSONObject(i)?.optJSONObject("musicResponsiveListItemRenderer") ?: continue
            val watch=find(row,setOf("playlistItemData","watchEndpoint"));val id=watch?.optString("videoId").orEmpty()
            if(!id.matches(Regex("[A-Za-z0-9_-]{11}"))||!ids.add(id))continue
            val columns=row.optJSONArray("flexColumns")
            val title=text(columns?.optJSONObject(0)?.optJSONObject("musicResponsiveListItemFlexColumnRenderer")?.optJSONObject("text"))
            if(title.isBlank())continue
            val artist=text(columns?.optJSONObject(1)?.optJSONObject("musicResponsiveListItemFlexColumnRenderer")?.optJSONObject("text")).ifBlank { "Artista no identificado" }
            val durationText=text(row.optJSONArray("fixedColumns")?.optJSONObject(0)?.optJSONObject("musicResponsiveListItemFixedColumnRenderer")?.optJSONObject("text"))
            val duration=if(durationText.matches(Regex("\\d{1,3}:\\d{2}(?::\\d{2})?"))) durationText.split(':').fold(0L) { n,s -> n*60+s.toInt() } else -1L
            tracks.put(JSONObject().put("id","yt:$id").put("videoId",id).put("source","youtube").put("title",title).put("artist",artist).put("duration",duration).put("artworkUrl",thumbnail(row)).put("tags",JSONArray()).put("saved",true))
        }
        return YouTubePlaylistPage(tracks,continuation(shelf))
    }
}
