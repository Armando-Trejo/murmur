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
}
