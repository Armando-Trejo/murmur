package com.personal.murmur

import org.junit.Assert.*
import org.junit.Test

class SpeakerVoicesTest {
    private val voices = listOf(
        SpeakerVoices.Option("es-es-x-eea-local", "es", "ES", 400, false),
        SpeakerVoices.Option("es-us-x-esc-network", "es", "US", 400, true),
        SpeakerVoices.Option("es-us-x-esf-local", "es", "US", 400, false),
        SpeakerVoices.Option("es-mx-basic", "es", "MX", 300, false),
        SpeakerVoices.Option("en-us-x-iol-local", "en", "US", 400, false),
        SpeakerVoices.Option("es-us-x-missing", "es", "US", 500, false, notInstalled = true),
    )

    @Test fun onlySpanishAndInstalled() {
        val names = SpeakerVoices.rank(voices).map { it.name }
        assertFalse(names.contains("en-us-x-iol-local"))
        assertFalse(names.contains("es-us-x-missing"))
    }

    @Test fun mexicoFirstThenLatinAmericaThenSpain() {
        val ranked = SpeakerVoices.rank(voices)
        assertEquals("MX", ranked.first().country)
        assertEquals("ES", ranked.last().country)
    }

    @Test fun neuralNetworkVoiceFirstOnlyWhenOnline() {
        val us = voices.filter { it.country == "US" }
        assertEquals("es-us-x-esc-network", SpeakerVoices.rank(us, online = true).first().name)
        assertEquals("es-us-x-esf-local", SpeakerVoices.rank(us, online = false).first().name)
    }

    @Test fun friendlyLabels() {
        assertEquals("Voz 1 · Latinoamérica · natural, en línea", SpeakerVoices.label(voices[1], 0))
        assertEquals("Voz 2 · México · clara", SpeakerVoices.label(voices[3], 1))
    }
}
