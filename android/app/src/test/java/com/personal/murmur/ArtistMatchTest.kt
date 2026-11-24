package com.personal.murmur

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class ArtistMatchTest {
    private fun artistRow(id: String, name: String) = """
        {"musicResponsiveListItemRenderer":{
          "navigationEndpoint":{"browseEndpoint":{"browseId":"$id","browseEndpointContextSupportedConfigs":
            {"browseEndpointContextMusicConfig":{"pageType":"MUSIC_PAGE_TYPE_ARTIST"}}}},
          "flexColumns":[{"musicResponsiveListItemFlexColumnRenderer":{"text":{"runs":[{"text":"$name"}]}}}]}}
    """.trimIndent()

    @Test fun creditedNamesAreSplitAndCleaned() {
        assertEquals(listOf("Bad Bunny feat. Drake", "Bad Bunny", "Drake"), YouTubeMusicPages.artistNames("Bad Bunny feat. Drake"))
        assertEquals("Misfits", YouTubeMusicPages.artistNames("Misfits - Topic").first())
        assertEquals("Misfits", YouTubeMusicPages.artistNames("MisfitsVEVO").first())
        assertTrue(YouTubeMusicPages.artistNames("Calle 13, Rubén Blades & Residente").containsAll(listOf("Calle 13", "Rubén Blades", "Residente")))
    }

    @Test fun onlyAnExactNameIsAccepted() {
        val data = JSONObject("""{"contents":[${artistRow("UCfeatured000000000000", "Drake")},${artistRow("UCmisfits0000000000000", "The Misfits")}]}""")
        assertEquals("Exact credited name, ignoring 'The' and case", "UCmisfits0000000000000",
            YouTubeMusicPages.matchingArtistChannel(data, YouTubeMusicPages.artistNames("misfits")))
        assertNull("An unrelated first result is never used", YouTubeMusicPages.matchingArtistChannel(data, listOf("Danzig")))
        assertEquals("The full line wins, then each credited artist", "UCfeatured000000000000",
            YouTubeMusicPages.matchingArtistChannel(data, YouTubeMusicPages.artistNames("Someone feat. Drake")))
    }

    @Test fun albumSearchRowsBecomeOpenableAlbums() {
        val data = JSONObject("""
            {"contents":[{"musicResponsiveListItemRenderer":{
              "navigationEndpoint":{"browseEndpoint":{"browseId":"MPREb_abc123"}},
              "thumbnail":{"musicThumbnailRenderer":{"thumbnail":{"thumbnails":[{"url":"https://lh3.googleusercontent.com/x=w120-h120","width":120,"height":120}]}}},
              "flexColumns":[
                {"musicResponsiveListItemFlexColumnRenderer":{"text":{"runs":[{"text":"Static Age"}]}}},
                {"musicResponsiveListItemFlexColumnRenderer":{"text":{"runs":[{"text":"Álbum"},{"text":" • "},{"text":"Misfits"},{"text":" • "},{"text":"1997"}]}}}]}},
              {"musicResponsiveListItemRenderer":{"navigationEndpoint":{"browseEndpoint":{"browseId":"UCnotanalbum000000000"}},
               "flexColumns":[{"musicResponsiveListItemFlexColumnRenderer":{"text":{"runs":[{"text":"Misfits"}]}}}]}}]}
        """.trimIndent())
        val albums = YouTubeMusicPages.albumResults(data)
        assertEquals(1, albums.length())
        val album = albums.getJSONObject(0)
        assertEquals("MPREb_abc123", album.getString("id"))
        assertEquals("Static Age", album.getString("title"))
        assertEquals("Misfits", album.getString("artist"))
        assertEquals("1997", album.getString("year"))
        assertEquals("https://music.youtube.com/browse/MPREb_abc123", album.getString("link"))
    }
}
