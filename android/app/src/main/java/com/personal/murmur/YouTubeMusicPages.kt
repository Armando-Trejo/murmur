package com.personal.murmur

import org.json.JSONArray
import org.json.JSONObject

/** Upgrades provider thumbnail URLs to the sharpest size the CDN serves. */
object YouTubeArtwork {
    private val sized = Regex("=(?:w\\d+-h\\d+|s\\d+)[^/?#]*$")

    fun hd(url: String, size: Int = 544): String {
        if (!url.startsWith("https://")) return url
        val host = url.substringAfter("https://").substringBefore('/')
        if (host != "lh3.googleusercontent.com" && host != "yt3.googleusercontent.com" &&
            host != "yt3.ggpht.com") return url
        return if (sized.containsMatchIn(url)) url.replace(sized, "=w$size-h$size-l90-rj")
        else url
    }
}

data class YouTubeWatchPage(val title: String?, val tracks: JSONArray, val continuation: String?)

/** Parsers for YouTube Music watch queues (mixes), headers, artists and lyrics. */
object YouTubeMusicPages {
    private val videoId = Regex("[A-Za-z0-9_-]{11}")
    private val year = Regex("\\d{4}")

    fun text(value: JSONObject?): String = value?.optString("simpleText")?.takeIf { it.isNotBlank() }
        ?: value?.optJSONArray("runs")?.let { runs ->
            (0 until runs.length()).joinToString("") { runs.optJSONObject(it)?.optString("text").orEmpty() }
        }.orEmpty()

    fun find(value: Any?, names: Set<String>): JSONObject? {
        when (value) {
            is JSONObject -> {
                for (key in names) value.optJSONObject(key)?.let { return it }
                for (key in value.keys()) find(value.opt(key), names)?.let { return it }
            }
            is JSONArray -> for (i in 0 until value.length()) find(value.opt(i), names)?.let { return it }
        }
        return null
    }

    fun largest(images: JSONArray?): String = images?.let { list ->
        (0 until list.length()).mapNotNull(list::optJSONObject)
            .maxByOrNull { it.optInt("width") * it.optInt("height").coerceAtLeast(1) }
            ?.optString("url").orEmpty()
    }.orEmpty().let { YouTubeArtwork.hd(it) }

    private fun duration(label: String): Long =
        if (label.matches(Regex("\\d{1,3}:\\d{2}(?::\\d{2})?")))
            label.split(':').fold(0L) { total, part -> total * 60 + part.toInt() } else -1L

    /** Reads the queue panel of the `next` endpoint, used by mixes and radios. */
    fun watchPlaylist(data: JSONObject): YouTubeWatchPage {
        val panel = data.optJSONObject("continuationContents")?.optJSONObject("playlistPanelContinuation")
            ?: find(data.opt("contents"), setOf("playlistPanelRenderer"))
            ?: throw IllegalStateException("YouTube no entregó las canciones de este mix.")
        val contents = panel.optJSONArray("contents") ?: JSONArray()
        val tracks = JSONArray()
        val ids = mutableSetOf<String>()
        for (i in 0 until contents.length()) {
            val entry = contents.optJSONObject(i) ?: continue
            val row = entry.optJSONObject("playlistPanelVideoRenderer")
                ?: entry.optJSONObject("playlistPanelVideoWrapperRenderer")?.optJSONObject("primaryRenderer")
                    ?.optJSONObject("playlistPanelVideoRenderer")
                ?: continue
            val id = row.optString("videoId")
            if (!id.matches(videoId) || !ids.add(id)) continue
            val title = text(row.optJSONObject("title"))
            if (title.isBlank()) continue
            val byline = text(row.optJSONObject("longBylineText")).ifBlank { text(row.optJSONObject("shortBylineText")) }
            val parts = byline.split(" • ", " · ").map(String::trim).filter(String::isNotBlank)
            val track = JSONObject().put("id", "yt:$id").put("videoId", id).put("source", "youtube")
                .put("title", title).put("artist", parts.firstOrNull() ?: "Artista no identificado")
                .put("duration", duration(text(row.optJSONObject("lengthText"))))
                .put("artworkUrl", largest(row.optJSONObject("thumbnail")?.optJSONArray("thumbnails")))
                .put("tags", JSONArray()).put("saved", false)
            if (parts.size >= 3 && parts.last().matches(year)) track.put("album", parts[1])
            tracks.put(track)
        }
        val next = panel.optJSONArray("continuations")?.optJSONObject(0)?.let {
            it.optJSONObject("nextRadioContinuationData") ?: it.optJSONObject("nextContinuationData")
        }?.optString("continuation")?.takeIf(String::isNotBlank)
        return YouTubeWatchPage(text(panel.optJSONObject("title")).ifBlank { null }, tracks, next)
    }

    /** Browse id of the lyrics tab offered for the first track of a watch response. */
    fun lyricsBrowseId(data: JSONObject): String? {
        val tabs = find(data.opt("contents"), setOf("watchNextTabbedResultsRenderer"))?.optJSONArray("tabs") ?: return null
        for (i in 0 until tabs.length()) {
            val id = tabs.optJSONObject(i)?.optJSONObject("tabRenderer")?.optJSONObject("endpoint")
                ?.optJSONObject("browseEndpoint")?.optString("browseId").orEmpty()
            if (id.startsWith("MPLYt")) return id
        }
        return null
    }

    data class Lyrics(val text: String, val source: String)

    fun lyrics(data: JSONObject): Lyrics? {
        val shelf = find(data.opt("contents"), setOf("musicDescriptionShelfRenderer")) ?: return null
        val body = text(shelf.optJSONObject("description")).replace("\r\n", "\n").trim()
        if (body.isBlank()) return null
        val footer = text(shelf.optJSONObject("footer")).trim()
        return Lyrics(body, footer.removePrefix("Fuente:").removePrefix("Source:").trim().ifBlank { "YouTube Music" })
    }

    /** Album or playlist header: title, artist line, year and the square cover. */
    fun header(data: JSONObject): JSONObject {
        val header = find(data, setOf("musicResponsiveHeaderRenderer", "musicDetailHeaderRenderer"))
            ?: return JSONObject()
        val result = JSONObject()
        text(header.optJSONObject("title")).takeIf { it.isNotBlank() }?.let { result.put("title", it) }
        val subtitle = text(header.optJSONObject("subtitle"))
        val strapline = text(header.optJSONObject("straplineTextOne"))
        val parts = subtitle.split(" • ", " · ").map(String::trim).filter(String::isNotBlank)
        val artist = strapline.ifBlank { parts.getOrNull(1)?.takeUnless { it.matches(year) }.orEmpty() }
        if (artist.isNotBlank()) result.put("artist", artist)
        parts.firstOrNull { it.matches(year) }?.let { result.put("year", it) }
        if (parts.isNotEmpty()) result.put("subtitle", parts.first())
        val cover = largest(find(header, setOf("musicThumbnailRenderer"))?.optJSONObject("thumbnail")?.optJSONArray("thumbnails"))
            .ifBlank { largest(find(header, setOf("croppedSquareThumbnailRenderer"))?.optJSONObject("thumbnail")?.optJSONArray("thumbnails")) }
        if (cover.isNotBlank()) result.put("artworkUrl", cover)
        return result
    }

    /**
     * Names worth looking up for an artist line as tracks carry it: "A feat. B", "A, B & C",
     * "Misfits - Topic", "MisfitsVEVO". The full cleaned line comes first, then each credited artist.
     */
    fun artistNames(raw: String): List<String> {
        val clean = raw.replace(Regex("(?i)\\s*-\\s*topic\\s*$"), "")
            .replace(Regex("(?i)\\s*\\((?:official|oficial)\\)"), "")
            .replace(Regex("(?i)(?<=\\S)vevo\\s*$"), "").trim()
        val parts = clean.split(Regex("(?i)\\s*(?:,|&|/|\\bfeat\\.?|\\bft\\.?|\\bfeaturing\\b|\\bwith\\b|\\s+x\\s+|\\s+y\\s+)\\s*"))
            .map(String::trim).filter(String::isNotBlank)
        return (listOf(clean) + parts).filter(String::isNotBlank).distinct()
    }

    private fun sameName(a: String, b: String): Boolean {
        val x = normalize(a); val y = normalize(b)
        return x.isNotBlank() && (x == y || x.removePrefix("the ") == y.removePrefix("the "))
    }

    /**
     * Artist channel whose name matches one of [names] exactly (ignoring accents, case and "The").
     * Never falls back to an unrelated channel: a wrong profile is worse than none.
     */
    fun matchingArtistChannel(data: JSONObject, names: List<String>): String? {
        val found = mutableListOf<Pair<String, String>>()
        fun walk(value: Any?) {
            when (value) {
                is JSONObject -> {
                    val renderer = value.optJSONObject("musicResponsiveListItemRenderer")
                        ?: value.optJSONObject("musicCardShelfRenderer")
                    if (renderer != null) {
                        val nav = renderer.optJSONObject("navigationEndpoint")?.optJSONObject("browseEndpoint")
                            ?: find(renderer.opt("title"), setOf("browseEndpoint"))
                        val channel = nav?.optString("browseId").orEmpty()
                        val page = nav?.optJSONObject("browseEndpointContextSupportedConfigs")
                            ?.optJSONObject("browseEndpointContextMusicConfig")?.optString("pageType").orEmpty()
                        val title = text(renderer.optJSONObject("title")).ifBlank {
                            text(renderer.optJSONArray("flexColumns")?.optJSONObject(0)
                                ?.optJSONObject("musicResponsiveListItemFlexColumnRenderer")?.optJSONObject("text"))
                        }
                        if (channel.matches(Regex("UC[A-Za-z0-9_-]{10,120}")) &&
                            (page.isBlank() || page == "MUSIC_PAGE_TYPE_ARTIST")) found.add(channel to title)
                    }
                    value.keys().forEach { walk(value.opt(it)) }
                }
                is JSONArray -> for (i in 0 until value.length()) walk(value.opt(i))
            }
        }
        walk(data)
        for (name in names) found.firstOrNull { sameName(it.second, name) }?.let { return it.first }
        return null
    }

    /**
     * Albums from the Albums tab of YouTube Music search, as feed items the collection view opens:
     * id MPREb…, title, "Álbum · Artista · Año" subtitle, artist, year and the square cover.
     */
    fun albumResults(data: JSONObject): JSONArray {
        val result = JSONArray()
        val seen = mutableSetOf<String>()
        fun walk(value: Any?) {
            when (value) {
                is JSONObject -> {
                    // List rows, and the "top result" card, which carries the best match.
                    val card = value.optJSONObject("musicCardShelfRenderer")
                    val row = value.optJSONObject("musicResponsiveListItemRenderer") ?: card
                    if (row != null) {
                        val album = Regex("MPREb[A-Za-z0-9_-]{2,120}")
                        // The album link sits on the row, or only on its title run.
                        val id = row.optJSONObject("navigationEndpoint")?.optJSONObject("browseEndpoint")?.optString("browseId")
                            ?.takeIf { it.matches(album) }
                            ?: find(row.opt(if (card != null) "title" else "flexColumns"), setOf("browseEndpoint"))?.optString("browseId")
                                ?.takeIf { it.matches(album) }
                            ?: ""
                        if (id.matches(album) && seen.add(id)) {
                            val columns = row.optJSONArray("flexColumns")
                            fun column(i: Int) = if (card != null) text(card.optJSONObject(if (i == 0) "title" else "subtitle"))
                                else text(columns?.optJSONObject(i)?.optJSONObject("musicResponsiveListItemFlexColumnRenderer")?.optJSONObject("text"))
                            val title = column(0)
                            val parts = column(1).split(" • ", " · ").map(String::trim).filter(String::isNotBlank)
                            val yearPart = parts.lastOrNull { it.matches(year) }
                            val artist = parts.drop(1).filterNot { it == yearPart }.joinToString(", ")
                            val cover = largest(find(row, setOf("musicThumbnailRenderer"))?.optJSONObject("thumbnail")?.optJSONArray("thumbnails"))
                            if (title.isNotBlank()) result.put(JSONObject().put("id", id).put("title", title)
                                .put("subtitle", listOf(parts.firstOrNull() ?: "Álbum", artist, yearPart.orEmpty()).filter(String::isNotBlank).joinToString(" · "))
                                .put("artist", artist).put("year", yearPart.orEmpty()).put("source", "youtube").put("kind", "album")
                                .put("artworkUrl", cover).put("link", "https://music.youtube.com/browse/$id"))
                        }
                    }
                    value.keys().forEach { walk(value.opt(it)) }
                }
                is JSONArray -> for (i in 0 until value.length()) walk(value.opt(i))
            }
        }
        walk(data)
        return result
    }

    /** First artist channel found in a search response, preferring an exact name match. */
    fun artistChannel(data: JSONObject, name: String): String? {
        val wanted = normalize(name)
        val found = mutableListOf<Pair<String, String>>()
        fun walk(value: Any?) {
            when (value) {
                is JSONObject -> {
                    val endpoint = value.optJSONObject("browseEndpoint")
                    val id = endpoint?.optString("browseId").orEmpty()
                    val page = endpoint?.optJSONObject("browseEndpointContextSupportedConfigs")
                        ?.optJSONObject("browseEndpointContextMusicConfig")?.optString("pageType").orEmpty()
                    if (id.matches(Regex("UC[A-Za-z0-9_-]{10,120}")) && page == "MUSIC_PAGE_TYPE_ARTIST") {
                        found.add(id to "")
                    }
                    val renderer = value.optJSONObject("musicResponsiveListItemRenderer")
                        ?: value.optJSONObject("musicCardShelfRenderer")
                    if (renderer != null) {
                        val nav = renderer.optJSONObject("navigationEndpoint")?.optJSONObject("browseEndpoint")
                            ?: find(renderer.opt("title"), setOf("browseEndpoint"))
                        val channel = nav?.optString("browseId").orEmpty()
                        val title = text(renderer.optJSONObject("title")).ifBlank {
                            text(renderer.optJSONArray("flexColumns")?.optJSONObject(0)
                                ?.optJSONObject("musicResponsiveListItemFlexColumnRenderer")?.optJSONObject("text"))
                        }
                        if (channel.matches(Regex("UC[A-Za-z0-9_-]{10,120}")) && normalize(title) == wanted) {
                            found.add(0, channel to title)
                        }
                    }
                    value.keys().forEach { walk(value.opt(it)) }
                }
                is JSONArray -> for (i in 0 until value.length()) walk(value.opt(i))
            }
        }
        walk(data)
        return found.firstOrNull { it.second.isNotBlank() }?.first ?: found.firstOrNull()?.first
    }

    /** Artist page: hero image, name, description and the provider shelves. */
    fun artist(data: JSONObject, id: String): JSONObject {
        val header = find(data.opt("header"), setOf("musicImmersiveHeaderRenderer", "musicVisualHeaderRenderer", "musicResponsiveHeaderRenderer"))
        val name = text(header?.optJSONObject("title"))
        val image = largest(find(header, setOf("musicThumbnailRenderer"))?.optJSONObject("thumbnail")?.optJSONArray("thumbnails"))
        val about = text(header?.optJSONObject("description")).trim()
        val result = JSONObject().put("id", id).put("name", name.ifBlank { "Artista" })
            .put("shelves", YouTubePlaylistParser.homeShelves(data))
        if (image.isNotBlank()) result.put("artworkUrl", image)
        if (about.isNotBlank()) result.put("description", about.take(1200))
        text(header?.optJSONObject("subscriptionButton")?.let { find(it, setOf("subscribeButtonRenderer")) }
            ?.optJSONObject("subscriberCountText")).takeIf { it.isNotBlank() }?.let { result.put("audience", it) }
        return result
    }

    fun normalize(value: String): String = java.text.Normalizer.normalize(value, java.text.Normalizer.Form.NFD)
        .replace(Regex("\\p{M}+"), "").lowercase().replace(Regex("[^a-z0-9]+"), " ").trim()
}
