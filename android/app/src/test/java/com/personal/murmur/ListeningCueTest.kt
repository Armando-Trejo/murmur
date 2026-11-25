package com.personal.murmur

import org.junit.Assert.*
import org.junit.Test
import kotlin.math.abs

class ListeningCueTest {
    private val note = ListeningCue.SAMPLE_RATE * ListeningCue.NOTE_MS / 1000

    @Test fun twoShortNotesWithClickFreeEdges() {
        val pcm = ListeningCue.synthesize()
        assertEquals(note * 2, pcm.size)
        assertEquals(0, pcm.first().toInt())
        assertEquals(0, pcm.last().toInt())
        // Where one note ends and the next starts, both fade to silence (no click).
        assertTrue(abs(pcm[note - 1].toInt()) < 50)
        assertTrue(abs(pcm[note].toInt()) < 50)
    }

    @Test fun itIsSoft() {
        val peak = ListeningCue.synthesize().maxOf { abs(it.toInt()) }
        assertTrue(peak <= (Short.MAX_VALUE * ListeningCue.LEVEL).toInt() + 1)
        assertTrue(peak > (Short.MAX_VALUE * ListeningCue.LEVEL * 0.9).toInt())
    }

    @Test fun theSecondNoteIsHigher() {
        val pcm = ListeningCue.synthesize()
        fun crossings(from: Int, to: Int) = (from + 1 until to).count { pcm[it - 1] < 0 && pcm[it] >= 0 }
        assertTrue(crossings(note, note * 2) > crossings(0, note))
    }
}
