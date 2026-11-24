package com.personal.murmur
import org.junit.Assert.*
import org.junit.Test

class VoiceRecognitionPolicyTest {
    @Test fun missingLocalLanguageRetriesOnlyOnce() {
        assertTrue(VoiceRecognitionPolicy.retryWithSystem(13, true, false))
        assertTrue(VoiceRecognitionPolicy.retryWithSystem(12, true, false))
        assertFalse(VoiceRecognitionPolicy.retryWithSystem(13, true, true))
        assertFalse(VoiceRecognitionPolicy.retryWithSystem(13, false, false))
    }
    @Test fun noRetryForDeniedPermissionSilenceOrBusyMicrophone() {
        for (code in listOf(3, 6, 7, 8, 9, 10)) assertFalse(VoiceRecognitionPolicy.retryWithSystem(code, true, false))
    }
    @Test fun errorsOfferSpecificRecovery() {
        assertTrue(VoiceRecognitionPolicy.message(9).contains("permiso"))
        assertTrue(VoiceRecognitionPolicy.message(2).contains("conexión"))
        assertTrue(VoiceRecognitionPolicy.message(13).contains("idioma"))
        assertTrue(VoiceRecognitionPolicy.message(3).contains("interruptor"))
    }
}
