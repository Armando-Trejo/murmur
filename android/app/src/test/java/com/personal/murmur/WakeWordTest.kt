package com.personal.murmur

import org.junit.Assert.*
import org.junit.Test

class WakeWordTest {
    @Test fun hearsTheWakePhraseAsSpanishRecognitionSpellsIt() {
        for (text in listOf("ok murmur", "okey murmur pon misfits", "okay mur mur", "o que murmura", "oye ok mormur")) {
            assertTrue(text, WakeWordService.heard(text))
        }
    }

    @Test fun ignoresOrdinaryTalk() {
        for (text in listOf("murmur", "ok", "el murmullo del agua", "okey mañana", "o que mal")) {
            assertFalse(text, WakeWordService.heard(text))
        }
    }

    @Test fun theSecondCheckRejectsLyricsTheSpotterForcedIntoThePhrase() {
        // The grammar spotter can only answer with its words; the open transcription writes the real lyrics.
        assertFalse(WakePhrase.confirmed(listOf("lo que más quiero en la vida")))
        assertFalse(WakePhrase.confirmed(listOf("yo que murmuro tu nombre")))
        assertFalse(WakePhrase.confirmed(listOf("", "")))
    }

    @Test fun theSecondCheckAcceptsThePhraseEvenOverMusicOrSplitAcrossUtterances() {
        assertTrue(WakePhrase.confirmed(listOf("la noche ok murmura")))
        assertTrue(WakePhrase.confirmed(listOf("y", "o que murmura pon algo")))
        assertTrue(WakePhrase.confirmed(listOf("okey mur mur")))
    }

    @Test fun theSpotterGrammarEndsWithUnknownSoOtherSpeechHasSomewhereToGo() {
        assertEquals("[unk]", WakePhrase.grammar.last())
    }
}
