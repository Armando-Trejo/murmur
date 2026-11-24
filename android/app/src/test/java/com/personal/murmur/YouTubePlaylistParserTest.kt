package com.personal.murmur
import org.json.JSONObject
import org.junit.Test
import org.junit.Assert.*
class YouTubePlaylistParserTest {
    private val row="""{"musicResponsiveListItemRenderer":{"playlistItemData":{"videoId":"abcdefghijk"},"flexColumns":[{"musicResponsiveListItemFlexColumnRenderer":{"text":{"runs":[{"text":"Afuera"}]}}},{"musicResponsiveListItemFlexColumnRenderer":{"text":{"runs":[{"text":"Caifanes"}]}}}],"fixedColumns":[{"musicResponsiveListItemFixedColumnRenderer":{"text":{"runs":[{"text":"4:15"}]}}}]}}"""
    @Test fun parsesRealSongsAndNextPageToken() { val result=YouTubePlaylistParser.parse(JSONObject("""{"contents":{"musicPlaylistShelfRenderer":{"contents":[$row,{"continuationItemRenderer":{"continuationEndpoint":{"continuationCommand":{"token":"next"}}}}]}}}"""));assertEquals(1,result.tracks.length());val track=result.tracks.getJSONObject(0);assertEquals("Afuera",track.getString("title"));assertEquals("Caifanes",track.getString("artist"));assertEquals(255,track.getInt("duration"));assertEquals("next",result.continuation) }
    @Test fun handlesContinuationPagesAndUnplayableRows() { val result=YouTubePlaylistParser.parse(JSONObject("""{"continuationContents":{"musicPlaylistShelfContinuation":{"contents":[$row,{"musicResponsiveListItemRenderer":{"flexColumns":[]}}],"continuations":[{"nextContinuationData":{"continuation":"more"}}]}}}"""));assertEquals(1,result.tracks.length());assertEquals("more",result.continuation) }
    @Test(expected=IllegalStateException::class) fun doesNotTreatAnUnrecognizedResponseAsAnEmptyPlaylist() { YouTubePlaylistParser.parse(JSONObject("""{"contents":{"signInRenderer":{}}}""")) }
    @Test fun libraryReadsClassicAndMusicCardsAndContinuation() {
        val data=JSONObject("""{"contents":[{"gridPlaylistRenderer":{"playlistId":"PLexample","title":{"simpleText":"Guardada"}}},{"musicTwoRowItemRenderer":{"navigationEndpoint":{"browseEndpoint":{"browseId":"VLowned"}},"title":{"runs":[{"text":"Propia"}]}}}],"continuations":[{"nextContinuationData":{"continuation":"page2"}}]}""")
        assertEquals(2,YouTubePlaylistParser.playlists(data).length());assertEquals("page2",YouTubePlaylistParser.continuation(data));assertEquals("page2",YouTubePlaylistParser.continuation(JSONObject().put("contents",data)))
    }
    @Test fun homePreservesProviderOrderAndSelectsBestArtwork() {
        val data = JSONObject("""
            {"contents":{"sectionListRenderer":{"contents":[
              {"musicCarouselShelfRenderer":{
                "header":{"musicCarouselShelfBasicHeaderRenderer":{"title":{"simpleText":"Para escuchar hoy"}}},
                "contents":[
                  {"musicTwoRowItemRenderer":{
                    "title":{"simpleText":"Mi mix"},
                    "navigationEndpoint":{"browseEndpoint":{"browseId":"VLRDexample"}}
                  }},
                  {"musicTwoRowItemRenderer":{
                    "title":{"simpleText":"Mi canción"},
                    "navigationEndpoint":{"watchEndpoint":{"videoId":"abcdefghijk"}},
                    "thumbnailRenderer":{"musicThumbnailRenderer":{"thumbnail":{"thumbnails":[
                      {"url":"https://example.org/small","width":90,"height":90},
                      {"url":"https://example.org/large","width":720,"height":720}
                    ]}}}
                  }}
                ]
              }}
            ]}}}
        """.trimIndent())
        val shelf = YouTubePlaylistParser.homeShelves(data).getJSONObject(0)
        assertEquals("Para escuchar hoy", shelf.getString("title"))
        val items = shelf.getJSONArray("items")
        assertEquals("https://music.youtube.com/playlist?list=RDexample", items.getJSONObject(0).getString("link"))
        assertEquals("https://example.org/large", items.getJSONObject(1).getString("artworkUrl"))
        assertEquals("yt:abcdefghijk", items.getJSONObject(1).getJSONObject("track").getString("id"))
    }

    @Test fun parsesHomeContinuationWithoutFollowingShelfPaging() {
        val response = JSONObject("""
            {"continuationContents":{"sectionListContinuation":{
              "contents":[
                {"musicCarouselShelfRenderer":{
                  "title":{"simpleText":"Siguiente selección"},
                  "continuations":[{"nextContinuationData":{"continuation":"inner"}}],
                  "contents":[
                    {"musicTwoRowItemRenderer":{
                      "title":{"runs":[{"text":"Álbum","navigationEndpoint":{"browseEndpoint":{"browseId":"MPREb_example"}}}]},
                      "overlay":{"musicItemThumbnailOverlayRenderer":{"content":{"musicPlayButtonRenderer":{"playNavigationEndpoint":{"watchEndpoint":{"videoId":"abcdefghijk"}}}}}}
                    }},
                    {"musicTwoRowItemRenderer":{
                      "title":{"simpleText":"Artista"},
                      "navigationEndpoint":{"browseEndpoint":{"browseId":"MPLAUC1234567890"}}
                    }}
                  ]
                }},
                {"continuationItemRenderer":{"continuationEndpoint":{"continuationCommand":{"token":"outer"}}}}
              ]
            }}}
        """.trimIndent())
        val items = YouTubePlaylistParser.homeShelves(response).getJSONObject(0).getJSONArray("items")
        assertEquals("https://music.youtube.com/browse/MPREb_example", items.getJSONObject(0).getString("link"))
        assertFalse(items.getJSONObject(0).has("track"))
        assertEquals("UC1234567890", items.getJSONObject(1).getString("artistId"))
        assertEquals("outer", YouTubePlaylistParser.homeContinuation(response))
    }

    @Test fun checksAccountMarkerAndNotGuestMenu() {
        val account = JSONObject("""{"actions":[{"openPopupAction":{"popup":{
            "activeAccountHeaderRenderer":{"accountName":{"runs":[{"text":"Cuenta de prueba"}]}}
        }}}]}""")
        assertTrue(YouTubePlaylistParser.hasSignedInAccount(account))
        assertFalse(YouTubePlaylistParser.hasSignedInAccount(JSONObject("""{"actions":[{"signInRenderer":{}}]}""")))
    }
}
