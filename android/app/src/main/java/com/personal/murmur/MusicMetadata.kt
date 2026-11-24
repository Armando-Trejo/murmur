package com.personal.murmur
import org.json.JSONObject
import android.net.Uri

object MusicMetadata {
    private var lastRequest = 0L
    private val cache = mutableMapOf<String, JSONObject>()
    private fun json(url: String): JSONObject = NativeNetwork.client.newCall(okhttp3.Request.Builder().url(url).header("User-Agent", "Murmur/1.0 (personal Android music library)").header("Accept", "application/json").build()).execute().use { response -> check(response.isSuccessful) { "Metadatos no disponibles (${response.code})" }; JSONObject(response.body?.string() ?: "{}") }
    @Synchronized fun artist(candidate: String): JSONObject {
        cache[candidate.lowercase()]?.let { return it }
        val result = JSONObject().put("name", candidate).put("tags", org.json.JSONArray()).put("related", org.json.JSONArray())
        try {
            val data = json("https://api.deezer.com/search/artist?q=" + Uri.encode(candidate)).optJSONArray("data")
            val match = (0 until (data?.length() ?: 0)).map { data!!.getJSONObject(it) }.firstOrNull { it.optString("name").equals(candidate, true) }
            if (match != null) { result.put("name", match.getString("name")); result.put("validated", true); val related = json("https://api.deezer.com/artist/${match.getLong("id")}/related?limit=5").optJSONArray("data"); val names = org.json.JSONArray(); for (i in 0 until (related?.length() ?: 0)) names.put(related!!.getJSONObject(i).optString("name")); result.put("related", names) }
        } catch (_: Exception) { }
        try {
            val wait = lastRequest + 1100 - System.currentTimeMillis(); if (wait > 0) Thread.sleep(wait); lastRequest = System.currentTimeMillis()
            val query = "artist:\"" + candidate.replace("\"", "") + "\""; val artists = json("https://musicbrainz.org/ws/2/artist/?fmt=json&limit=3&query=" + Uri.encode(query)).optJSONArray("artists")
            val match = (0 until (artists?.length() ?: 0)).map { artists!!.getJSONObject(it) }.firstOrNull { it.optString("name").equals(candidate, true) }
            if (match != null) { result.put("validated", true); result.put("name", match.optString("name")); val tags = org.json.JSONArray(); val list = match.optJSONArray("tags"); for (i in 0 until (list?.length() ?: 0)) tags.put(list!!.getJSONObject(i).optString("name")); result.put("tags", tags) }
        } catch (_: Exception) { }
        cache[candidate.lowercase()] = result; return result
    }
}
