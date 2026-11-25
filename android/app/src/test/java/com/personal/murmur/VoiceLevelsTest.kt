package com.personal.murmur

import org.junit.Assert.assertEquals
import org.junit.Test

class VoiceLevelsTest {
    @Test fun silenceIsFlatAndShoutingIsFull() {
        assertEquals(0f, VoiceLevels.normalize(-5f), 0.0001f)
        assertEquals(0f, VoiceLevels.normalize(-2f), 0.0001f)
        assertEquals(0.5f, VoiceLevels.normalize(4f), 0.0001f)
        assertEquals(1f, VoiceLevels.normalize(10f), 0.0001f)
        assertEquals(1f, VoiceLevels.normalize(20f), 0.0001f)
    }
}
