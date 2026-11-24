package com.personal.murmur

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class YouTubeMusicPagesTest {
    private fun panelRow(id: String, title: String, byline: String, length: String = "3:41") = """
        {"playlistPanelVideoRenderer":{"videoId":"$id","title":{"runs":[{"text":"$title"}]},
         "longBylineText":{"runs":[{"text":"$byline"}]},"lengthText":{"runs":[{"text":"$length"}]},
         "thumbnail":{"thumbnails":[{"url":"https://lh3.googleusercontent.com/x=w60-h60-l90-rj","width":60,"height":60},
                                    {"url":"https://lh3.googleusercontent.com/x=w120-h120-l90-rj","width":120,"height":120}]}}}
    """.trimIndent()

    @Test fun readsMixQueueWithAlbumYearAndSharpArtwork() {
        val data = JSONObject("""
            {"contents":{"singleColumnMusicWatchNextResultsRenderer":{"tabbedRenderer":{"watchNextTabbedResultsRenderer":{"tabs":[
              {"tabRenderer":{"content":{"musicQueueRenderer":{"content":{"playlistPanelRenderer":{
                "title":"Mix de ejemplo",
                "contents":[
                  ${panelRow("abcdefghijk", "Afuera", "Caifanes • El Silencio • 1992")},
                  ${panelRow("bcdefghijkl", "Video", "Canal • 1,2 M de vistas")},
                  {"automixPreviewVideoRenderer":{}},
                  ${panelRow("abcdefghijk", "Duplicada", "Otro • X • 2000")}
                ],
                "continuations":[{"nextRadioContinuationData":{"continuation":"more"}}]
              }}}}}},
              {"tabRenderer":{"endpoint":{"browseEndpoint":{"browseId":"MPLYt_lyrics"}}}}
            ]}}}}}
        """.trimIndent())
        val page = YouTubeMusicPages.watchPlaylist(data)
        assertEquals(2, page.tracks.length())
        val first = page.tracks.getJSONObject(0)
        assertEquals("Caifanes", first.getString("artist"))
        assertEquals("El Silencio", first.getString("album"))
        assertEquals(221, first.getInt("duration"))
        assertEquals("https://lh3.googleusercontent.com/x=w544-h544-l90-rj", first.getString("artworkUrl"))
        assertFalse(page.tracks.getJSONObject(1).has("album"))
        assertEquals("more", page.continuation)
        assertEquals("MPLYt_lyrics", YouTubeMusicPages.lyricsBrowseId(data))
    }

    @Test fun readsMixContinuationPages() {
        val page = YouTubeMusicPages.watchPlaylist(JSONObject("""
            {"continuationContents":{"playlistPanelContinuation":{"contents":[${panelRow("cdefghijklm", "Otra", "Banda • Disco • 2010")}]}}}
        """.trimIndent()))
        assertEquals(1, page.tracks.length())
        assertNull(page.continuation)
    }

    @Test(expected = IllegalStateException::class) fun rejectsResponsesWithoutAQueue() {
        YouTubeMusicPages.watchPlaylist(JSONObject("""{"contents":{"messageRenderer":{}}}"""))
    }

    @Test fun readsAlbumHeaderArtistYearAndCover() {
        val header = YouTubeMusicPages.header(JSONObject("""
            {"contents":{"twoColumnBrowseResultsRenderer":{"tabs":[{"tabRenderer":{"content":{"sectionListRenderer":{"contents":[
              {"musicResponsiveHeaderRenderer":{"title":{"runs":[{"text":"El Silencio"}]},
                "subtitle":{"runs":[{"text":"Álbum"},{"text":" • "},{"text":"1992"}]},
                "straplineTextOne":{"runs":[{"text":"Caifanes"}]},
                "thumbnail":{"musicThumbnailRenderer":{"thumbnail":{"thumbnails":[{"url":"https://lh3.googleusercontent.com/a=w226-h226-l90-rj","width":226,"height":226}]}}}}}
            ]}}}}]}}}
        """.trimIndent()))
        assertEquals("El Silencio", header.getString("title"))
        assertEquals("Caifanes", header.getString("artist"))
        assertEquals("1992", header.getString("year"))
        assertTrue(header.getString("artworkUrl").endsWith("=w544-h544-l90-rj"))
    }

    @Test fun findsTheArtistChannelMatchingTheName() {
        val search = JSONObject("""
            {"contents":[
              {"musicResponsiveListItemRenderer":{"navigationEndpoint":{"browseEndpoint":{"browseId":"UCotherartist000001",
                "browseEndpointContextSupportedConfigs":{"browseEndpointContextMusicConfig":{"pageType":"MUSIC_PAGE_TYPE_ARTIST"}}}},
                "flexColumns":[{"musicResponsiveListItemFlexColumnRenderer":{"text":{"runs":[{"text":"Caifanes Tributo"}]}}}]}},
              {"musicResponsiveListItemRenderer":{"navigationEndpoint":{"browseEndpoint":{"browseId":"UCcaifanes0000000001",
                "browseEndpointContextSupportedConfigs":{"browseEndpointContextMusicConfig":{"pageType":"MUSIC_PAGE_TYPE_ARTIST"}}}},
                "flexColumns":[{"musicResponsiveListItemFlexColumnRenderer":{"text":{"runs":[{"text":"Caifanes"}]}}}]}}
            ]}
        """.trimIndent())
        assertEquals("UCcaifanes0000000001", YouTubeMusicPages.artistChannel(search, "caifanes"))
    }

    @Test fun readsArtistHeaderAndLyricsShelf() {
        val artist = YouTubeMusicPages.artist(JSONObject("""
            {"header":{"musicImmersiveHeaderRenderer":{"title":{"runs":[{"text":"Caifanes"}]},
              "description":{"runs":[{"text":"Banda de rock mexicana."}]},
              "thumbnail":{"musicThumbnailRenderer":{"thumbnail":{"thumbnails":[{"url":"https://lh3.googleusercontent.com/p=w540-h225-p-l90-rj","width":540,"height":225}]}}}}},
             "contents":{}}
        """.trimIndent()), "UCcaifanes0000000001")
        assertEquals("Caifanes", artist.getString("name"))
        assertEquals("Banda de rock mexicana.", artist.getString("description"))
        assertTrue(artist.getString("artworkUrl").startsWith("https://lh3.googleusercontent.com/p="))
        val lyrics = YouTubeMusicPages.lyrics(JSONObject("""
            {"contents":{"sectionListRenderer":{"contents":[{"musicDescriptionShelfRenderer":{
              "description":{"runs":[{"text":"Línea uno\nLínea dos"}]},"footer":{"runs":[{"text":"Fuente: LyricFind"}]}}}]}}}
        """.trimIndent()))
        assertEquals("Línea uno\nLínea dos", lyrics?.text)
        assertEquals("LyricFind", lyrics?.source)
    }

    @Test fun upgradesOnlyKnownImageHosts() {
        assertEquals("https://yt3.ggpht.com/a=w1080-h1080-l90-rj", YouTubeArtwork.hd("https://yt3.ggpht.com/a=s88-c-k-c0x00ffffff-no-rj", 1080))
        assertEquals("https://i.ytimg.com/vi/abc/hqdefault.jpg", YouTubeArtwork.hd("https://i.ytimg.com/vi/abc/hqdefault.jpg"))
        assertEquals("https://example.org/a=w60-h60", YouTubeArtwork.hd("https://example.org/a=w60-h60"))
    }
}
