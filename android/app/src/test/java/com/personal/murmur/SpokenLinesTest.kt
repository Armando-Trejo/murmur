package com.personal.murmur

import org.junit.Assert.*
import org.junit.Test

class SpokenLinesTest {
    @Test fun answersLoseTheirScreenStyling() {
        assertEquals("Suena Bailarina de Miranda!", SpokenLines.clean("Suena «Bailarina» de Miranda!"))
        assertEquals("En pausa", SpokenLines.clean("  En   pausa "))
    }

    @Test fun longNoticesStopAtTheFirstSentence() {
        val long = "Para poner música, di pon y lo que quieres escuchar. Escuché: " + "palabra ".repeat(40)
        val spoken = SpokenLines.clean(long)
        assertTrue(spoken, spoken.length <= 160)
        assertTrue(spoken, spoken.endsWith("escuchar."))
    }

    @Test fun thePresenterNamesTheSongAndTheLeadArtist() {
        val line = SpokenLines.announcement("Bailarina (Official Video)", "Miranda!, Juliana Gattas", 0)
        assertEquals("Ahora suena Bailarina, de Miranda!", line)
    }

    @Test fun thePresenterRotatesItsLines() {
        val lines = (0 until 4).map { SpokenLines.announcement("Afuera", "Caifanes", it) }.toSet()
        assertEquals(4, lines.size)
    }

    @Test fun nothingToSayWithoutATitle() {
        assertEquals("", SpokenLines.announcement("", "Caifanes", 1))
        assertEquals("Ahora suena Afuera.", SpokenLines.announcement("Afuera", "", 0))
    }

    @Test fun videoNoiseIsRemovedFromTitles() {
        assertEquals("Afuera", SpokenLines.cleanTitle("Afuera [Remastered 2011]"))
        assertEquals("La Célula Que Explota", SpokenLines.cleanTitle("La Célula Que Explota (Video Oficial)"))
        assertEquals("Cumbia (de los pajaritos)", SpokenLines.cleanTitle("Cumbia (de los pajaritos)"))
    }

    @Test fun theRadioHostIsFriendlyAndVaried() {
        val lines = (0 until 10).map { SpokenLines.radio("Afuera", "Caifanes", it, 15, 1) }.toSet()
        assertEquals(10, lines.size)
        assertTrue(lines.all { "Afuera" in it && "Caifanes" in it })
        assertTrue(SpokenLines.radio("Afuera", "Caifanes", 0, 9, 0).startsWith("Buenos días."))
        assertEquals("", SpokenLines.radio("", "Caifanes", 0, 9, 1))
    }

    @Test fun aNewMoodIsNamedAndBlocksSoundLikeAHost() {
        val moods = (0 until 4).map { SpokenLines.mood("Afuera", "Caifanes", "algo alegre", it) }
        assertTrue(moods.all { "algo alegre" in it && "Afuera" in it && "Caifanes" in it })
        val blocks = (0 until 4).map { SpokenLines.block("Afuera", "Caifanes", it, 15, 1) }
        assertTrue(blocks.all { "Afuera" in it && "Caifanes" in it })
        assertTrue(SpokenLines.block("Afuera", "Caifanes", 0, 21, 0).startsWith("Buenas noches."))
    }
}
