package com.personal.murmur

import android.content.Context
import android.net.Uri
import android.os.Bundle
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * The library Android Auto browses: a copy MURMUR's screen writes (core/autoLibrary.ts) so the car
 * can list and start music while the app is closed. Ids:
 * - `root`, `folder:foryou|playlists|albums` (folders),
 * - `list:<collection>` (a playable list),
 * - `song:<collection>#<index>` (a song inside that list, so its neighbours become the queue).
 */
object AutoLibrary {
    const val ROOT = "root"
    private const val FILE = "auto-library.json"
    private val folders = listOf(
        Triple("foryou", "Para ti", "Lo reciente, tus guardadas y tus mixes"),
        Triple("playlists", "Playlists", "Tus playlists de Spotify, YouTube y MURMUR"),
        Triple("albums", "Álbumes", "Los álbumes que guardaste"),
    )
    @Volatile private var cache: Pair<Long, JSONArray>? = null

    fun save(context: Context, json: String) {
        val parsed = JSONObject(json) // reject anything that is not the expected document
        require(parsed.has("collections")) { "Biblioteca inválida" }
        val target = File(context.filesDir, FILE)
        val temp = File(context.filesDir, "$FILE.tmp")
        temp.writeText(json)
        if (!temp.renameTo(target)) { target.delete(); temp.renameTo(target) }
        cache = null
    }

    fun collections(context: Context): JSONArray {
        val file = File(context.filesDir, FILE)
        val stamp = file.lastModified()
        cache?.takeIf { it.first == stamp }?.let { return it.second }
        val list = runCatching { JSONObject(file.readText()).optJSONArray("collections") }.getOrNull() ?: JSONArray()
        cache = stamp to list
        return list
    }

    fun collection(context: Context, id: String): JSONObject? {
        val all = collections(context)
        return (0 until all.length()).map { all.getJSONObject(it) }.firstOrNull { it.optString("id") == id }
    }

    private fun artwork(url: String?) = url?.takeIf { it.startsWith("https://") }?.let(Uri::parse)

    fun root(): MediaItem = folder(ROOT, "MURMUR", null)

    private fun folder(id: String, title: String, subtitle: String?) = MediaItem.Builder().setMediaId(id)
        .setMediaMetadata(MediaMetadata.Builder().setTitle(title).setSubtitle(subtitle)
            .setIsBrowsable(true).setIsPlayable(false).setMediaType(MediaMetadata.MEDIA_TYPE_FOLDER_MIXED).build()).build()

    private fun listItem(c: JSONObject): MediaItem {
        val tracks = c.optJSONArray("tracks")?.length() ?: 0
        val group = c.optString("group")
        return MediaItem.Builder().setMediaId("list:" + c.optString("id"))
            .setMediaMetadata(MediaMetadata.Builder().setTitle(c.optString("title"))
                .setSubtitle(c.optString("subtitle").ifBlank { "$tracks canciones" })
                .setArtworkUri(artwork(c.optString("artworkUrl")))
                .setIsBrowsable(true).setIsPlayable(true)
                .setMediaType(if (group == "albums") MediaMetadata.MEDIA_TYPE_ALBUM else MediaMetadata.MEDIA_TYPE_PLAYLIST)
                .build()).build()
    }

    fun songItem(collectionId: String, index: Int, t: JSONObject): MediaItem = MediaItem.Builder()
        .setMediaId("song:$collectionId#$index")
        .setMediaMetadata(MediaMetadata.Builder().setTitle(t.optString("title")).setArtist(t.optString("artist"))
            .setAlbumTitle(t.optString("album").ifBlank { null }).setArtworkUri(artwork(t.optString("artworkUrl")))
            .setIsBrowsable(false).setIsPlayable(true).setMediaType(MediaMetadata.MEDIA_TYPE_MUSIC)
            .setExtras(Bundle().apply { putString("murmur.source", t.optString("source")) }).build()).build()

    fun children(context: Context, parentId: String): List<MediaItem> {
        if (parentId == ROOT) {
            val all = collections(context)
            val groups = (0 until all.length()).map { all.getJSONObject(it).optString("group") }.toSet()
            return folders.filter { it.first in groups }.map { folder("folder:" + it.first, it.second, it.third) }
        }
        if (parentId.startsWith("folder:")) {
            val group = parentId.removePrefix("folder:")
            val all = collections(context)
            return (0 until all.length()).map { all.getJSONObject(it) }.filter { it.optString("group") == group }.map(::listItem)
        }
        if (parentId.startsWith("list:")) {
            val id = parentId.removePrefix("list:")
            val tracks = collection(context, id)?.optJSONArray("tracks") ?: return emptyList()
            return (0 until tracks.length()).map { songItem(id, it, tracks.getJSONObject(it)) }
        }
        return emptyList()
    }

    fun item(context: Context, mediaId: String): MediaItem? = when {
        mediaId == ROOT -> root()
        mediaId.startsWith("folder:") -> folders.firstOrNull { "folder:" + it.first == mediaId }?.let { folder(mediaId, it.second, it.third) }
        mediaId.startsWith("list:") -> collection(context, mediaId.removePrefix("list:"))?.let(::listItem)
        else -> locate(context, mediaId)?.let { (c, i) -> songItem(c.optString("id"), i, c.getJSONArray("tracks").getJSONObject(i)) }
    }

    /** `song:<collection>#<index>` or `list:<collection>` → the list and where to start. */
    fun locate(context: Context, mediaId: String): Pair<JSONObject, Int>? {
        if (mediaId.startsWith("list:")) return collection(context, mediaId.removePrefix("list:"))?.let { it to 0 }
        if (!mediaId.startsWith("song:")) return null
        val body = mediaId.removePrefix("song:")
        val cut = body.lastIndexOf('#').takeIf { it > 0 } ?: return null
        val list = collection(context, body.substring(0, cut)) ?: return null
        val index = body.substring(cut + 1).toIntOrNull() ?: return null
        val size = list.optJSONArray("tracks")?.length() ?: 0
        return if (index in 0 until size) list to index else null
    }

    /** Songs whose title or artist contain every word of the query (voice search with the app closed). */
    fun search(context: Context, query: String, limit: Int = 30): List<MediaItem> {
        val words = normalize(query).split(' ').filter { it.isNotBlank() }
        if (words.isEmpty()) return emptyList()
        val out = mutableListOf<MediaItem>()
        val seen = mutableSetOf<String>()
        val all = collections(context)
        for (c in 0 until all.length()) {
            val list = all.getJSONObject(c)
            val tracks = list.optJSONArray("tracks") ?: continue
            for (i in 0 until tracks.length()) {
                val t = tracks.getJSONObject(i)
                val text = normalize(t.optString("title") + " " + t.optString("artist") + " " + t.optString("album"))
                if (words.all { text.contains(it) } && seen.add(t.optString("id"))) out += songItem(list.optString("id"), i, t)
                if (out.size >= limit) return out
            }
        }
        return out
    }

    private fun normalize(text: String) = java.text.Normalizer.normalize(text.lowercase(), java.text.Normalizer.Form.NFD)
        .replace(Regex("\\p{M}+"), "").replace(Regex("[^a-z0-9ñ ]"), " ").replace(Regex("\\s+"), " ").trim()

    /** A song the service can start by itself: YouTube (id or file) or Spotify with its in-app player. */
    fun playableAlone(t: JSONObject, spotifyMode: String) = when (t.optString("source")) {
        "spotify" -> spotifyMode == "web" && t.optString("spotifyUri").startsWith("spotify:track:")
        else -> t.optString("videoId").isNotBlank() || t.optString("offlinePath").isNotBlank()
    }
}
