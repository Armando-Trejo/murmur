package com.personal.murmur

import android.app.Activity
import android.os.Bundle
import android.os.Build
import android.content.Intent
import android.speech.*
import android.widget.TextView
import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Color
import android.view.Gravity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

/** Microphone lifetime is bounded by this visible, user-initiated Activity. */
class VoiceCaptureActivity : Activity(), RecognitionListener {
    companion object { private var active = false }
    private var ownsSession = false
    private var recognizer: SpeechRecognizer? = null
    private var settled = false
    private var onDevice = false
    private var retried = false
    private var attempt = 0
    private lateinit var label: TextView
    private val handler = android.os.Handler(android.os.Looper.getMainLooper())
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (active) { finishResult(null, "Ya hay una escucha en curso."); return }
        active = true; ownsSession = true
        if (Build.VERSION.SDK_INT >= 27) { setShowWhenLocked(true); setTurnScreenOn(false) }
        window.statusBarColor = Color.BLACK; window.navigationBarColor = Color.BLACK
        label = TextView(this).apply {
            text = "Preparando micrófono…"; textSize = 24f; setTextColor(Color.WHITE)
            setBackgroundColor(Color.BLACK); gravity = Gravity.CENTER
        }
        setContentView(label)
        val pad = (24 * resources.displayMetrics.density).toInt()
        ViewCompat.setOnApplyWindowInsetsListener(label) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            view.setPadding(pad + bars.left, pad + bars.top, pad + bars.right, pad + bars.bottom); insets
        }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED)
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 8)
        else begin()
    }
    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != 8) return
        if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) begin()
        else finishResult(null, VoiceRecognitionPolicy.message(9))
    }
    private fun begin(system: Boolean = false) {
        onDevice = !system && Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(this)
        if (!onDevice && !SpeechRecognizer.isRecognitionAvailable(this)) {
            finishResult(null, "No hay un servicio de reconocimiento activado. Actívalo en los ajustes de voz de Android."); return
        }
        try {
            VoiceTriggerManager.beginListening()
            recognizer = if (onDevice && Build.VERSION.SDK_INT >= 31) SpeechRecognizer.createOnDeviceSpeechRecognizer(this) else SpeechRecognizer.createSpeechRecognizer(this)
            recognizer!!.setRecognitionListener(listener(++attempt))
            val request = VoiceHints.request(this, onDevice)
            recognizer!!.startListening(request)
            handler.postDelayed({ finishResult(null, "La escucha terminó sin un comando. Vuelve a intentarlo.") }, 15000)
        } catch (_: Exception) {
            if (onDevice && !retried) retrySystem() else finishResult(null, VoiceRecognitionPolicy.message(5))
        }
    }
    private fun retrySystem() {
        retried = true; handler.removeCallbacksAndMessages(null)
        ++attempt
        val old = recognizer; recognizer = null
        old?.destroy()
        label.text = "Probando el servicio de voz del teléfono…\n\nPuede necesitar conexión."
        handler.post { if (!settled) begin(system = true) }
    }
    private fun finishResult(text: String?, error: String?, returnToApp: Boolean = true) {
        if (settled) return
        settled = true; handler.removeCallbacksAndMessages(null)
        ++attempt; recognizer?.destroy(); recognizer = null
        if (ownsSession) { active = false; ownsSession = false; VoiceTriggerManager.restoreAudio() }
        val data = Intent().putExtra("voice_text", text).putExtra("voice_error", error)
        if (intent.getBooleanExtra("return_result", false)) setResult(if (error == null) RESULT_OK else RESULT_CANCELED, data)
        else if (returnToApp) startActivity(data.setClass(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP))
        else if (error != null) NativeEvents.emit("onVoiceError", com.getcapacitor.JSObject().put("message", error))
        finish()
    }
    override fun onResults(results: Bundle?) {
        val text = VoiceHints.join(results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION))
        finishResult(text, if (text == null) VoiceRecognitionPolicy.message(7) else null)
    }
    override fun onError(error: Int) {
        if (settled) return
        if (VoiceRecognitionPolicy.retryWithSystem(error, onDevice, retried)) retrySystem()
        else finishResult(null, VoiceRecognitionPolicy.message(error))
    }
    override fun onReadyForSpeech(params: Bundle?) { label.text = "Te escucho…\n\nDi: Siguiente, Pausa o Reproduce un artista." }
    override fun onBeginningOfSpeech() { label.text = "Escuchando tu comando…" }
    override fun onRmsChanged(rmsdB: Float) {}; override fun onBufferReceived(buffer: ByteArray?) {}
    override fun onEndOfSpeech() { label.text = "Entendiendo tu comando…" }
    override fun onPartialResults(partialResults: Bundle?) {}; override fun onEvent(eventType: Int, params: Bundle?) {}
    private fun listener(token: Int) = object : RecognitionListener {
        private fun current() = token == attempt && !settled
        override fun onResults(results: Bundle?) { if (current()) this@VoiceCaptureActivity.onResults(results) }
        override fun onError(error: Int) { if (current()) this@VoiceCaptureActivity.onError(error) }
        override fun onReadyForSpeech(params: Bundle?) { if (current()) this@VoiceCaptureActivity.onReadyForSpeech(params) }
        override fun onBeginningOfSpeech() { if (current()) this@VoiceCaptureActivity.onBeginningOfSpeech() }
        override fun onEndOfSpeech() { if (current()) this@VoiceCaptureActivity.onEndOfSpeech() }
        override fun onRmsChanged(value: Float) {}; override fun onBufferReceived(buffer: ByteArray?) {}
        override fun onPartialResults(results: Bundle?) {}; override fun onEvent(type: Int, params: Bundle?) {}
    }
    @Deprecated("Legacy back callback for API 26+ voice Activity")
    override fun onBackPressed() { finishResult(null, "Escucha cancelada.", returnToApp = false) }
    override fun onStop() { if (!settled && !isChangingConfigurations) finishResult(null, "Escucha cancelada.", returnToApp = false); super.onStop() }
    override fun onDestroy() {
        ++attempt; handler.removeCallbacksAndMessages(null); recognizer?.destroy()
        if (ownsSession) { active = false; VoiceTriggerManager.restoreAudio() }
        super.onDestroy()
    }
}
