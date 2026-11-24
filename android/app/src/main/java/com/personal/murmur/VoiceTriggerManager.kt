package com.personal.murmur
import android.content.Context
import android.content.Intent
import com.getcapacitor.JSObject

/** User-initiated entry. Android still owns background activity/microphone restrictions. */
object VoiceTriggerManager {
    fun intent(context: Context, source: String = "button") = Intent(context, VoiceCaptureActivity::class.java)
        .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP).putExtra("voice_trigger", source)
    fun launch(context: Context, source: String = "headset"): Boolean = try {
        context.startActivity(intent(context, source).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); true
    } catch (_: Exception) {
        restoreAudio()
        NativeEvents.emit("onVoiceError", JSObject().put("message", "Android bloqueó la apertura en segundo plano. Usa el mosaico de voz o abre MURMUR."))
        false
    }
    fun beginListening() { HybridMediaService.instance?.setDucking(true); SubBassFeedback.play() }
    fun restoreAudio() { HybridMediaService.instance?.setDucking(false) }
}
