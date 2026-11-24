package com.personal.murmur

import org.junit.Assert.*
import org.junit.Test
import kotlin.math.abs

class SubBassFeedbackTest {
    @Test fun pulseHasExactDurationAndClickFreeEndpoints() {
        val pcm = SubBassFeedback.synthesize()
        assertEquals(6174, pcm.size)
        assertEquals(0, pcm.first().toInt())
        assertEquals(0, pcm.last().toInt())
        assertTrue(pcm.maxOf { abs(it.toInt()) } <= 7210)
        assertTrue(pcm.maxOf { abs(it.toInt()) } > 7000)
    }

    @Test fun steadyToneIs75HzAndEdgesAreAttenuated() {
        val pcm = SubBassFeedback.synthesize()
        val crossings = (883 until pcm.size - 882).filter { pcm[it - 1] < 0 && pcm[it] >= 0 }
        assertTrue(crossings.size >= 5)
        crossings.zipWithNext().forEach { (a, b) -> assertEquals(588, b - a) }
        val edgeEnergy = pcm.take(220).sumOf { it.toDouble() * it } / 220
        val bodyEnergy = pcm.slice(1764 until 2352).sumOf { it.toDouble() * it } / 588
        assertTrue(edgeEnergy < bodyEnergy * .05)
    }
}
