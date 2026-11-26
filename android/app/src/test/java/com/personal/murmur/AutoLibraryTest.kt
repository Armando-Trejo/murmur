package com.personal.murmur

import org.robolectric.RuntimeEnvironment
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class AutoLibraryTest {
    private val context = RuntimeEnvironment.getApplication()

    private fun track(id: String, title: String, artist: String, source: String = "youtube") = JSONObject()
        .put("id", id).put("title", title).put("artist", artist).put("source", source).put("duration", 200)
        .put("artworkUrl", "https://i.ytimg.com/vi/$id/hq.jpg")
        .apply { if (source == "youtube") put("videoId", id) else put("spotifyUri", "spotify:track:3Q2YTJihx6gPSyEgSzi44U") }

    private fun save() = AutoLibrary.save(context, JSONObject().put("updatedAt", 1).put("collections", JSONArray()
        .put(JSONObject().put("id", "auto:saved").put("title", "Guardadas").put("group", "foryou")
            .put("tracks", JSONArray().put(track("a1", "Persiana Americana", "Soda Stereo")).put(track("a2", "Bailarina", "Miranda!", "spotify"))))
        .put(JSONObject().put("id", "yt:PL#1").put("title", "Viaje").put("group", "playlists")
            .put("tracks", JSONArray().put(track("b1", "Muddy Water", "King Gizzard"))))).toString())

    @Test fun browsesFoldersListsAndSongs() {
        save()
        val root = AutoLibrary.children(context, AutoLibrary.ROOT).map { it.mediaId }
        assertEquals(listOf("folder:foryou", "folder:playlists"), root) // no albums saved: no empty folder
        assertEquals(listOf("list:auto:saved"), AutoLibrary.children(context, "folder:foryou").map { it.mediaId })
        val songs = AutoLibrary.children(context, "list:auto:saved")
        assertEquals(listOf("song:auto:saved#0", "song:auto:saved#1"), songs.map { it.mediaId })
        assertEquals("Persiana Americana", songs[0].mediaMetadata.title)
        assertTrue(songs[0].mediaMetadata.isPlayable == true)
        // A playlist id with '#' still resolves to its song.
        val (list, index) = AutoLibrary.locate(context, "song:yt:PL#1#0")!!
        assertEquals("yt:PL#1", list.optString("id")); assertEquals(0, index)
    }

    @Test fun searchesByTitleAndArtistWithoutAccents() {
        save()
        assertEquals(listOf("song:auto:saved#0"), AutoLibrary.search(context, "soda persiana").map { it.mediaId })
        assertEquals(1, AutoLibrary.search(context, "MIRANDA").size)
        assertTrue(AutoLibrary.search(context, "nada que ver").isEmpty())
    }

    @Test fun theServicePlaysAloneOnlyWhatItCanStart() {
        val spotify = track("a2", "Bailarina", "Miranda!", "spotify")
        assertTrue(AutoLibrary.playableAlone(track("a1", "x", "y"), "integrated"))
        assertTrue(AutoLibrary.playableAlone(spotify, "web"))
        assertFalse(AutoLibrary.playableAlone(spotify, "connect"))
    }

    @Test fun theMediaLibraryServiceAnswersAndroidAuto() {
        save()
        val controller = Robolectric.buildService(HybridMediaService::class.java).create()
        try {
            val session = controller.get().sessions.single()
            assertTrue(session is androidx.media3.session.MediaLibraryService.MediaLibrarySession)
        } finally { controller.destroy() }
    }
}
