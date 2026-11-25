package com.personal.murmur
import org.junit.Assert.*
import org.junit.Test

class VoiceHintsTest {
    @Test fun commandsComeFirstAndTheTotalStaysWithinTheCap() {
        val saved = (1..900).map { "Artista $it" }
        val hints = VoiceHints.biasing(saved)
        assertEquals(VoiceHints.MAX_BIASING, hints.size)
        assertEquals("Spotify", hints.first())
        assertTrue(hints.contains("Artista 1"))
        assertTrue(VoiceHints.MAX_SAVED <= VoiceHints.MAX_BIASING)
    }
    @Test fun blanksAndRepeatsAreDropped() {
        val hints = VoiceHints.biasing(listOf("The Misfits", " The Misfits ", "", "  ", "Spotify", "King Gizzard & The Lizard Wizard"))
        assertEquals(1, hints.count { it == "The Misfits" })
        assertEquals(1, hints.count { it == "Spotify" })
        assertTrue(hints.contains("King Gizzard & The Lizard Wizard"))
        assertFalse(hints.any { it.isBlank() })
    }
}
