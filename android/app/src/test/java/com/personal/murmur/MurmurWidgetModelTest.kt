package com.personal.murmur

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MurmurWidgetModelTest {
    @Test fun textFallsBackOnMissingBlankOrJsonNullValues() {
        assertNull(WidgetModel.text(null))
        assertNull(WidgetModel.text("   \n\t"))
        assertNull(WidgetModel.text("null"))
        assertNull(WidgetModel.text(" NULL "))
        assertEquals("Hola mundo", WidgetModel.text("  Hola \n  mundo  "))
        assertEquals(120, WidgetModel.text("a".repeat(500))!!.length)
    }

    @Test fun nothingLoadedIsTheEmptyStateWhateverElseIsPassed() {
        val state = WidgetModel.state(false, "Canción", "Artista", "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg", "abcdefghijk", true)
        assertEquals(WidgetState.EMPTY, state)
        assertEquals("empty", state.key)
        assertFalse(state.loaded)
    }

    @Test fun loadedStateKeepsCleanTextAndLeavesFallbacksToTheRenderer() {
        val state = WidgetModel.state(true, "  Luz  de  luna ", "", null, "", false)
        assertTrue(state.loaded)
        assertEquals("Luz de luna", state.title)
        assertNull(state.artist)
        assertTrue(state.covers.isEmpty())
    }

    @Test fun keyChangesOnlyWithWhatTheWidgetShows() {
        val playing = WidgetModel.state(true, "A", "B", "https://lh3.googleusercontent.com/x=w120-h120-l90-rj", null, true)
        val again = WidgetModel.state(true, " A ", "B", "https://lh3.googleusercontent.com/x=w120-h120-l90-rj", null, true)
        val paused = playing.copy(playing = false)
        val otherSong = WidgetModel.state(true, "C", "B", "https://lh3.googleusercontent.com/x=w120-h120-l90-rj", null, true)
        assertEquals(playing.key, again.key)
        assertNotEquals(playing.key, paused.key)
        assertNotEquals(playing.key, otherSong.key)
        assertNotEquals(WidgetState.EMPTY.key, paused.key)
    }

    @Test fun playButtonOffersTheOppositeOfTheCurrentState() {
        assertEquals(WidgetButton(R.drawable.murmur_widget_pause, R.string.murmur_widget_pause), WidgetModel.playButton(true))
        assertEquals(WidgetButton(R.drawable.murmur_widget_play, R.string.murmur_widget_play), WidgetModel.playButton(false))
    }

    @Test fun albumArtIsRequestedAtWidgetSizeAndOnlyOverHttps() {
        assertEquals(listOf("https://lh3.googleusercontent.com/abc=w300-h300-l90-rj"),
            WidgetModel.covers("https://lh3.googleusercontent.com/abc=w544-h544-l90-rj", "abcdefghijk"))
        assertEquals(listOf("https://i.scdn.co/image/ab67"), WidgetModel.covers(" https://i.scdn.co/image/ab67 ", null))
        assertTrue(WidgetModel.covers("http://example.com/a.jpg", null).isEmpty())
        assertTrue(WidgetModel.covers("file:///sdcard/a.jpg", "bad id").isEmpty())
        assertTrue(WidgetModel.covers(null, null).isEmpty())
    }

    @Test fun videoThumbnailsPreferLargerFramesThenTheOriginal() {
        assertEquals(listOf(
            "https://i.ytimg.com/vi/abcdefghijk/sddefault.jpg",
            "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg",
            "https://i.ytimg.com/vi/abcdefghijk/maxresdefault.jpg"),
            WidgetModel.covers("https://i.ytimg.com/vi/abcdefghijk/maxresdefault.jpg", "abcdefghijk"))
        assertEquals(listOf(
            "https://i.ytimg.com/vi/abcdefghijk/sddefault.jpg",
            "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg"),
            WidgetModel.covers("", "abcdefghijk"))
        assertTrue(WidgetModel.isVideoThumbnail("https://i9.ytimg.com/vi/x/hq.jpg"))
        assertTrue(WidgetModel.isVideoThumbnail("https://img.youtube.com/vi/x/0.jpg"))
        assertFalse(WidgetModel.isVideoThumbnail("https://lh3.googleusercontent.com/x"))
        assertFalse(WidgetModel.isVideoThumbnail("https://ytimg.com.evil.example/x"))
    }

    @Test fun compactLayoutOnlyForKnownShortHeights() {
        assertFalse(WidgetModel.compact(0))
        assertTrue(WidgetModel.compact(40))
        assertTrue(WidgetModel.compact(WidgetModel.COMPACT_BELOW_DP - 1))
        assertFalse(WidgetModel.compact(WidgetModel.COMPACT_BELOW_DP))
        assertFalse(WidgetModel.compact(180))
    }

    @Test fun decodeStepKeepsTheShorterSideAtLeastTheTarget() {
        assertEquals(1, WidgetModel.sampleSize(480, 360, 300))
        assertEquals(1, WidgetModel.sampleSize(640, 480, 300))
        assertEquals(2, WidgetModel.sampleSize(1280, 720, 300))
        assertEquals(8, WidgetModel.sampleSize(3000, 3000, 300))
        assertEquals(1, WidgetModel.sampleSize(0, 0, 300))
        assertEquals(1, WidgetModel.sampleSize(100, 100, 300))
    }

    @Test fun coverCropDropsVideoBarsAndCentresTheSquare() {
        assertEquals(CoverCrop(105, 45, 270), WidgetModel.coverCrop(480, 360, videoThumbnail = true))
        assertEquals(CoverCrop(140, 60, 360), WidgetModel.coverCrop(640, 480, videoThumbnail = true))
        assertEquals(CoverCrop(280, 0, 720), WidgetModel.coverCrop(1280, 720, videoThumbnail = true))
        assertEquals(CoverCrop(60, 0, 360), WidgetModel.coverCrop(480, 360, videoThumbnail = false))
        assertEquals(CoverCrop(0, 0, 500), WidgetModel.coverCrop(500, 500, videoThumbnail = true))
        assertEquals(CoverCrop(0, 50, 300), WidgetModel.coverCrop(300, 400, videoThumbnail = false))
        assertEquals(0, WidgetModel.coverCrop(0, 0, videoThumbnail = true).side)
    }
}
