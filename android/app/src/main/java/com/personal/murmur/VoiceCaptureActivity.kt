package com.personal.murmur

import android.app.Activity
import android.os.Bundle
import android.os.Build
import android.content.Intent
import android.speech.*
import android.widget.TextView
import android.view.View
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
    private lateinit var transcript: TextView
    private lateinit var waves: VoiceWaveView
    private lateinit var panel: android.widget.LinearLayout
    private lateinit var scrim: android.widget.FrameLayout
    private val handler = android.os.Handler(android.os.Looper.getMainLooper())
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (active) { finishResult(null, "Ya hay una escucha en curso."); return }
        active = true; ownsSession = true
        if (Build.VERSION.SDK_INT >= 27) { setShowWhenLocked(true); setTurnScreenOn(false) }
        buildPanel()
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
        onDevice = !system && VoiceHints.preferOnDevice(this)
        if (!onDevice && !SpeechRecognizer.isRecognitionAvailable(this)) {
            finishResult(null, "No hay un servicio de reconocimiento activado. Actívalo en los ajustes de voz de Android."); return
        }
        try {
            VoiceTriggerManager.beginListening(this)
            recognizer = if (onDevice && Build.VERSION.SDK_INT >= 31) SpeechRecognizer.createOnDeviceSpeechRecognizer(this) else SpeechRecognizer.createSpeechRecognizer(this)
            recognizer!!.setRecognitionListener(listener(++attempt))
            val request = VoiceHints.request(this, onDevice)
            recognizer!!.startListening(request)
            handler.postDelayed({ finishResult(null, "La escucha terminó sin un comando. Vuelve a intentarlo.") }, 15000)
        } catch (_: Exception) {
            if (onDevice && !retried) retrySystem() else finishResult(null, VoiceRecognitionPolicy.message(5))
        }
    }
    /**
     * An assistant-style panel over the dimmed screen: status, the words as they are heard and waves
     * that move with the voice. Tapping outside or «Cancelar» stops listening.
     */
    private fun buildPanel() {
        val dp = resources.displayMetrics.density
        window.statusBarColor = Color.TRANSPARENT
        window.navigationBarColor = Color.rgb(20, 18, 24)
        androidx.core.view.WindowCompat.setDecorFitsSystemWindows(window, false)
        scrim = android.widget.FrameLayout(this).apply {
            setBackgroundColor(Color.argb(150, 0, 0, 0))
            setOnClickListener { finishResult(null, "Escucha cancelada.", returnToApp = false) }
        }
        panel = android.widget.LinearLayout(this).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            isClickable = true
            background = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.rgb(20, 18, 24))
                cornerRadii = floatArrayOf(28 * dp, 28 * dp, 28 * dp, 28 * dp, 0f, 0f, 0f, 0f)
            }
        }
        val handle = View(this).apply {
            background = android.graphics.drawable.GradientDrawable().apply { setColor(Color.argb(60, 255, 255, 255)); cornerRadius = 3 * dp }
        }
        panel.addView(handle, android.widget.LinearLayout.LayoutParams((36 * dp).toInt(), (5 * dp).toInt()).apply { topMargin = (10 * dp).toInt() })
        label = TextView(this).apply {
            text = "Preparando micrófono…"; textSize = 14f; setTextColor(Color.argb(190, 255, 255, 255))
            letterSpacing = 0.04f; typeface = android.graphics.Typeface.DEFAULT_BOLD; gravity = Gravity.CENTER
        }
        panel.addView(label, android.widget.LinearLayout.LayoutParams(-1, -2).apply { topMargin = (18 * dp).toInt() })
        transcript = TextView(this).apply {
            text = "Prueba: «pon algo de Caifanes»"; textSize = 24f; setTextColor(Color.argb(110, 255, 255, 255))
            gravity = Gravity.CENTER; minLines = 2; maxLines = 3; ellipsize = android.text.TextUtils.TruncateAt.START
            setPadding((24 * dp).toInt(), 0, (24 * dp).toInt(), 0)
        }
        panel.addView(transcript, android.widget.LinearLayout.LayoutParams(-1, -2).apply { topMargin = (10 * dp).toInt() })
        waves = VoiceWaveView(this)
        panel.addView(waves, android.widget.LinearLayout.LayoutParams(-1, (120 * dp).toInt()).apply { topMargin = (6 * dp).toInt() })
        val cancel = TextView(this).apply {
            text = "Cancelar"; textSize = 15f; setTextColor(Color.rgb(179, 157, 250)); gravity = Gravity.CENTER
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            setPadding((24 * dp).toInt(), (12 * dp).toInt(), (24 * dp).toInt(), (12 * dp).toInt())
            setOnClickListener { finishResult(null, "Escucha cancelada.", returnToApp = false) }
        }
        panel.addView(cancel, android.widget.LinearLayout.LayoutParams(-2, (48 * dp).toInt()).apply { bottomMargin = (8 * dp).toInt() })
        scrim.addView(panel, android.widget.FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM))
        setContentView(scrim)
        ViewCompat.setOnApplyWindowInsetsListener(panel) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            view.setPadding(bars.left, 0, bars.right, bars.bottom); insets
        }
        // Rises from the bottom over the dimmed screen.
        scrim.alpha = 0f; scrim.animate().alpha(1f).setDuration(180).start()
        panel.translationY = 420 * dp
        panel.animate().translationY(0f).setDuration(320).setInterpolator(android.view.animation.PathInterpolator(0.2f, 0.9f, 0.3f, 1f)).start()
    }

    private fun showHeard(text: String?) {
        if (text.isNullOrBlank()) return
        transcript.text = text
        transcript.setTextColor(Color.WHITE)
    }

    private fun retrySystem() {
        retried = true; handler.removeCallbacksAndMessages(null)
        ++attempt
        val old = recognizer; recognizer = null
        old?.destroy()
        label.text = "Probando el servicio de voz del teléfono…"
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
        val list = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
        val text = VoiceHints.join(list)
        if (text == null) { finishResult(null, VoiceRecognitionPolicy.message(7)); return }
        // A beat to read what was understood, then MURMUR takes over ("Buscando «…»").
        showHeard(list?.firstOrNull())
        label.text = "Entendido"
        waves.mode = VoiceWaveView.Mode.THINKING
        handler.postDelayed({ finishResult(text, null) }, 280)
    }
    override fun onError(error: Int) {
        if (settled) return
        if (VoiceRecognitionPolicy.retryWithSystem(error, onDevice, retried)) retrySystem()
        else finishResult(null, VoiceRecognitionPolicy.message(error))
    }
    override fun onReadyForSpeech(params: Bundle?) { label.text = "Te escucho…"; waves.mode = VoiceWaveView.Mode.WAITING }
    override fun onBeginningOfSpeech() { label.text = "Escuchando…"; waves.mode = VoiceWaveView.Mode.LISTENING }
    override fun onRmsChanged(rmsdB: Float) { waves.setRms(rmsdB); if (rmsdB > 1f && waves.mode == VoiceWaveView.Mode.WAITING) waves.mode = VoiceWaveView.Mode.LISTENING }
    override fun onBufferReceived(buffer: ByteArray?) {}
    override fun onEndOfSpeech() { label.text = "Entendiendo…"; waves.mode = VoiceWaveView.Mode.THINKING }
    override fun onPartialResults(partialResults: Bundle?) { showHeard(partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()) }
    override fun onEvent(eventType: Int, params: Bundle?) {}
    private fun listener(token: Int) = object : RecognitionListener {
        private fun current() = token == attempt && !settled
        override fun onResults(results: Bundle?) { if (current()) this@VoiceCaptureActivity.onResults(results) }
        override fun onError(error: Int) { if (current()) this@VoiceCaptureActivity.onError(error) }
        override fun onReadyForSpeech(params: Bundle?) { if (current()) this@VoiceCaptureActivity.onReadyForSpeech(params) }
        override fun onBeginningOfSpeech() { if (current()) this@VoiceCaptureActivity.onBeginningOfSpeech() }
        override fun onEndOfSpeech() { if (current()) this@VoiceCaptureActivity.onEndOfSpeech() }
        override fun onRmsChanged(value: Float) { if (current()) this@VoiceCaptureActivity.onRmsChanged(value) }
        override fun onBufferReceived(buffer: ByteArray?) {}
        override fun onPartialResults(results: Bundle?) { if (current()) this@VoiceCaptureActivity.onPartialResults(results) }
        override fun onEvent(type: Int, params: Bundle?) {}
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
