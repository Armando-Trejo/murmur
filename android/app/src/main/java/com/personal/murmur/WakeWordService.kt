package com.personal.murmur

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import org.json.JSONObject
import org.vosk.Model
import org.vosk.Recognizer
import java.io.File
import java.util.zip.ZipInputStream

/** Spanish Vosk model kept in app storage; downloaded once, on the user's opt-in. */
object WakeWordModel {
    private const val URL = "https://alphacephei.com/vosk/models/vosk-model-small-es-0.42.zip"
    private const val MAX_BYTES = 80L * 1024 * 1024
    fun directory(context: Context) = File(context.filesDir, "models/vosk-es")
    fun available(context: Context) = File(directory(context), "am/final.mdl").isFile && File(directory(context), "conf/model.conf").isFile

    /** Downloads over HTTPS, unzips with path checks into a temp folder, then swaps it in. */
    @Synchronized fun download(context: Context) {
        if (available(context)) return
        val target = directory(context)
        val staging = File(target.parentFile, "vosk-es.part").apply { deleteRecursively(); mkdirs() }
        try {
            NativeNetwork.client.newCall(okhttp3.Request.Builder().url(URL).build()).execute().use { response ->
                check(response.isSuccessful) { "No se pudo descargar el modelo de voz (${response.code})" }
                val body = response.body ?: error("Modelo vacío")
                check(body.contentLength() in 1..MAX_BYTES) { "Tamaño del modelo de voz inesperado" }
                var total = 0L
                ZipInputStream(body.byteStream()).use { zip ->
                    while (true) {
                        val entry = zip.nextEntry ?: break
                        // Strip the top folder ("vosk-model-small-es-0.42/…") and refuse paths leaving staging.
                        val relative = entry.name.substringAfter('/', "").takeIf { it.isNotBlank() } ?: continue
                        val out = File(staging, relative).canonicalFile
                        check(out.path.startsWith(staging.canonicalPath + File.separator)) { "Ruta inválida en el modelo" }
                        if (entry.isDirectory) { out.mkdirs(); continue }
                        out.parentFile?.mkdirs()
                        out.outputStream().use { output ->
                            val buffer = ByteArray(65536)
                            while (true) {
                                val n = zip.read(buffer); if (n < 0) break
                                total += n; check(total <= MAX_BYTES * 2) { "El modelo de voz excede el tamaño esperado" }
                                output.write(buffer, 0, n)
                            }
                        }
                    }
                }
            }
            check(File(staging, "am/final.mdl").isFile && File(staging, "conf/model.conf").isFile) { "El modelo de voz llegó incompleto" }
            target.deleteRecursively()
            check(staging.renameTo(target)) { "No se pudo guardar el modelo de voz" }
        } finally { staging.deleteRecursively() }
    }
}

/**
 * "Ok MURMUR": a microphone foreground service that runs a small offline Spanish recognizer and
 * looks for the wake phrase in what it hears. Nothing leaves the phone until the phrase is heard;
 * then Android's recognizer captures the request, which reaches the app as a voice command.
 * Android shows the persistent notification and the microphone indicator while it is on.
 */
class WakeWordService : Service() {
    companion object {
        private const val CHANNEL = "wake_word"
        private const val LOG_TAG = "MURMUR"
        private const val NOTIFICATION = 1003
        private const val ACTION_STOP = "com.personal.murmur.wake.STOP"
        @Volatile var running = false; private set
        fun enabled(context: Context) = context.getSharedPreferences("playback", 0).getBoolean("wake_word", false)
        fun setEnabled(context: Context, value: Boolean) = context.getSharedPreferences("playback", 0).edit().putBoolean("wake_word", value).apply()
        fun start(context: Context) = ContextCompat.startForegroundService(context, Intent(context, WakeWordService::class.java))
        fun stop(context: Context) { context.stopService(Intent(context, WakeWordService::class.java)) }

        private val wake = Regex("\\b(?:ok|okey|okay|oque|o que|o ke)\\s*(?:mur\\s*mur\\w*|mor\\s*mur\\w*|murmur\\w*)")
        /** True when recognised text contains the wake phrase (Vosk spells it loosely in Spanish). */
        fun heard(text: String) = wake.containsMatchIn(YouTubeMusicPages.normalize(text))
    }

    private val handler = Handler(Looper.getMainLooper())
    private var model: Model? = null
    private var command: SpeechRecognizer? = null
    private var capturing = false
    @Volatile private var loading = false
    private var lastWake = 0L

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            setEnabled(this, false)
            NativeEvents.emit("onWakeWordChanged", JSObject().put("enabled", false))
            stopSelf(); return START_NOT_STICKY
        }
        startInForeground()
        if (model == null && !loading) { loading = true; Thread { load() }.start() }
        return START_STICKY
    }

    private fun startInForeground() {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL, "Escucha «Ok MURMUR»", NotificationManager.IMPORTANCE_MIN))
        val open = PendingIntent.getActivity(this, 3, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val stop = PendingIntent.getService(this, 4, Intent(this, WakeWordService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val notification: Notification = NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_sound).setContentTitle("Di «Ok MURMUR»")
            .setContentText("Escucha local, sin enviar audio hasta que dices la frase.")
            .setOngoing(true).setContentIntent(open).addAction(0, "Desactivar", stop)
            .setPriority(NotificationCompat.PRIORITY_MIN).build()
        if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
        else startForeground(NOTIFICATION, notification)
        running = true
    }

    private fun load() {
        try {
            if (!WakeWordModel.available(this)) WakeWordModel.download(this)
            val loaded = Model(WakeWordModel.directory(this).absolutePath)
            handler.post {
                if (!running) { loaded.close(); return@post }
                model = loaded; loading = false
                listen()
                NativeEvents.emit("onWakeWordChanged", JSObject().put("enabled", true).put("ready", true))
            }
        } catch (failure: Exception) {
            android.util.Log.w("MURMUR", "Wake word unavailable", failure)
            NativeEvents.emit("onVoiceError", JSObject().put("message", failure.message ?: "No se pudo preparar la escucha de «Ok MURMUR»."))
            handler.post { setEnabled(this, false); stopSelf() }
        }
    }

    @Volatile private var loop: Thread? = null

    /**
     * Battery: the recognizer only sees a tiny grammar (variants of the wake phrase; words missing
     * from the model are ignored by Vosk) and only while there is sound. Silence is measured with a
     * cheap RMS per 100 ms frame and never decoded; half a second of pre-roll keeps the "ok".
     */
    private fun listen() {
        val current = model ?: return
        if (capturing || loop != null) return
        val grammar = org.json.JSONArray(listOf("ok murmur", "okey murmur", "okay murmur", "o que murmura", "o que murmuro",
            "ok murmura", "okey murmura", "ok", "okey", "okay", "o", "que", "murmur", "murmura", "murmuro", "mur", "[unk]")).toString()
        val worker = Thread({ capture(current, grammar) }, "MurmurWakeWord")
        loop = worker
        worker.start()
    }

    /**
     * Music from the phone's own speaker reaches the microphone. While it plays, the capture uses the
     * voice-communication path with the platform's echo canceller (it subtracts what the phone itself
     * is playing) and noise suppressor, so "Ok MURMUR" is heard over the song. With headphones, or in
     * silence, the plain voice-recognition path is cheaper and more faithful.
     */
    private fun wantsEchoCancel(): Boolean {
        val audio = getSystemService(android.media.AudioManager::class.java) ?: return false
        if (!audio.isMusicActive) return false
        val private = setOf(android.media.AudioDeviceInfo.TYPE_WIRED_HEADSET, android.media.AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
            android.media.AudioDeviceInfo.TYPE_BLUETOOTH_A2DP, android.media.AudioDeviceInfo.TYPE_USB_HEADSET,
            android.media.AudioDeviceInfo.TYPE_BLUETOOTH_SCO) + (if (Build.VERSION.SDK_INT >= 31) setOf(android.media.AudioDeviceInfo.TYPE_BLE_HEADSET) else emptySet())
        return audio.getDevices(android.media.AudioManager.GET_DEVICES_OUTPUTS).none { it.type in private }
    }

    private fun capture(model: Model, grammar: String) {
        while (loop === Thread.currentThread() && !capturing) {
            val echo = wantsEchoCancel()
            if (!captureWith(model, grammar, echo)) return
        }
    }

    /** One microphone session; returns true to reopen (the music started or stopped), false to end. */
    private fun captureWith(model: Model, grammar: String, echo: Boolean): Boolean {
        val rate = 16000
        val frame = rate / 10 // 100 ms of 16-bit mono samples
        val source = if (echo) android.media.MediaRecorder.AudioSource.VOICE_COMMUNICATION else android.media.MediaRecorder.AudioSource.VOICE_RECOGNITION
        val record = try {
            android.media.AudioRecord(source, rate,
                android.media.AudioFormat.CHANNEL_IN_MONO, android.media.AudioFormat.ENCODING_PCM_16BIT,
                maxOf(android.media.AudioRecord.getMinBufferSize(rate, android.media.AudioFormat.CHANNEL_IN_MONO, android.media.AudioFormat.ENCODING_PCM_16BIT), frame * 4))
        } catch (failure: SecurityException) { handler.post { loop = null }; return false }
        val effects = if (echo) listOfNotNull(
            if (android.media.audiofx.AcousticEchoCanceler.isAvailable()) runCatching { android.media.audiofx.AcousticEchoCanceler.create(record.audioSessionId)?.apply { enabled = true } }.getOrNull() else null,
            if (android.media.audiofx.NoiseSuppressor.isAvailable()) runCatching { android.media.audiofx.NoiseSuppressor.create(record.audioSessionId)?.apply { enabled = true } }.getOrNull() else null,
        ) else emptyList()
        val recognizer = Recognizer(model, rate.toFloat(), grammar)
        val buffer = ShortArray(frame)
        val preroll = ArrayDeque<ShortArray>()
        var hangover = 0
        // Background level (music left after echo cancelling, room noise): speech must rise above it.
        var floor = 300.0
        var frames = 0
        var reopen = false
        try {
            record.startRecording()
            while (loop === Thread.currentThread() && !capturing) {
                val read = record.read(buffer, 0, frame)
                if (read <= 0) { Thread.sleep(50); continue }
                var sum = 0.0
                for (i in 0 until read) sum += buffer[i] * buffer[i].toDouble()
                val rms = kotlin.math.sqrt(sum / read)
                // ~ -32 dBFS in silence: a voice within arm's reach, not room noise; over music, clearly above it.
                val loud = rms > maxOf(800.0, floor * 1.8)
                floor = if (rms < floor) floor * 0.8 + rms * 0.2 else floor * 0.995 + rms * 0.005
                val chunk = buffer.copyOf(read)
                if (loud) hangover = 12 // keep decoding 1.2 s after the last loud frame
                if (hangover > 0) {
                    hangover--
                    while (preroll.isNotEmpty()) feed(recognizer, preroll.removeFirst())
                    feed(recognizer, chunk)
                    if (hangover == 0) { check(recognizer.finalResult, "text"); recognizer.reset() }
                } else {
                    preroll.addLast(chunk); if (preroll.size > 5) preroll.removeFirst()
                }
                // Every 2 s: if the music started or stopped, reopen the microphone on the right path.
                if (++frames % 20 == 0) {
                    if (android.util.Log.isLoggable(LOG_TAG, android.util.Log.DEBUG)) android.util.Log.d(LOG_TAG, "wake mic echo=$echo aec=${effects.size} rms=${rms.toInt()} floor=${floor.toInt()}")
                    if (hangover == 0 && wantsEchoCancel() != echo) { reopen = true; break }
                }
            }
        } catch (failure: Exception) {
            android.util.Log.w("MURMUR", "Wake word listener stopped", failure)
            if (running && !capturing) handler.postDelayed({ loop = null; listen() }, 3_000)
            reopen = false
        } finally {
            runCatching { record.stop() }; record.release(); recognizer.close()
            effects.forEach { runCatching { it.release() } }
            if (!reopen && loop === Thread.currentThread()) loop = null
        }
        return reopen
    }

    private fun feed(recognizer: Recognizer, samples: ShortArray) {
        if (recognizer.acceptWaveForm(samples, samples.size)) check(recognizer.result, "text")
        else check(recognizer.partialResult, "partial")
    }

    private fun pauseListening() {
        val worker = loop
        loop = null
        worker?.join(400)
    }

    private fun check(json: String?, key: String) {
        val text = runCatching { JSONObject(json ?: "{}").optString(key) }.getOrDefault("")
        if (text.isBlank() || !heard(text)) return
        val now = android.os.SystemClock.elapsedRealtime()
        if (now - lastWake < 3_000 || capturing) return
        lastWake = now
        handler.post { captureCommand() }
    }

    /** Each capture gets a token so a late callback from an abandoned recognizer is ignored. */
    private var attempt = 0

    /**
     * The wake phrase was heard: free the microphone and take the request with Android's recognizer.
     * Order: the phone's offline recognizer; if it lacks Spanish (or fails to start), the system
     * recognizer (Google, online); if there is no usable service either, the local Vosk model.
     */
    private fun captureCommand(system: Boolean = false) {
        if (!system) {
            capturing = true
            pauseListening()
            VoiceTriggerManager.beginListening()
            handler.postDelayed({ if (capturing) finishCommand(null, "No escuché un comando después de «Ok MURMUR».") }, 14_000)
        }
        val token = ++attempt
        val local = !system && Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(this)
        if (!local && !SpeechRecognizer.isRecognitionAvailable(this)) { localCommand(); return }
        val recognizer = try {
            if (local && Build.VERSION.SDK_INT >= 31) SpeechRecognizer.createOnDeviceSpeechRecognizer(this) else SpeechRecognizer.createSpeechRecognizer(this)
        } catch (_: Exception) { if (local) captureCommand(system = true) else localCommand(); return }
        command = recognizer
        recognizer.setRecognitionListener(object : RecognitionListener {
            override fun onResults(results: Bundle?) {
                if (token != attempt) return
                finishCommand(results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull { it.isNotBlank() }, null)
            }
            override fun onError(error: Int) {
                if (token != attempt) return
                when {
                    // No Spanish pack / offline engine unusable: same request through the online one.
                    VoiceRecognitionPolicy.retryWithSystem(error, local, false) -> { command?.destroy(); command = null; captureCommand(system = true) }
                    // No network or service at all: fall back to the on-device Spanish model.
                    error in setOf(1, 2, 5, 12, 13) -> { command?.destroy(); command = null; localCommand() }
                    else -> finishCommand(null, VoiceRecognitionPolicy.message(error))
                }
            }
            override fun onReadyForSpeech(params: Bundle?) {}
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onPartialResults(partialResults: Bundle?) {}
            override fun onEvent(eventType: Int, params: Bundle?) {}
        })
        recognizer.startListening(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "es-MX")
            .putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, local)
            .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3))
    }

    /** Last resort, fully offline: free-form Spanish from the wake-word model, up to 7 s. */
    private fun localCommand() {
        val current = model ?: return finishCommand(null, VoiceRecognitionPolicy.message(13))
        val token = ++attempt
        Thread({
            val rate = 16000
            val frame = rate / 10
            val text = try {
                if (checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) != android.content.pm.PackageManager.PERMISSION_GRANTED)
                    throw SecurityException("Sin permiso de micrófono")
                val record = android.media.AudioRecord(android.media.MediaRecorder.AudioSource.VOICE_RECOGNITION, rate,
                    android.media.AudioFormat.CHANNEL_IN_MONO, android.media.AudioFormat.ENCODING_PCM_16BIT, frame * 4)
                val recognizer = Recognizer(current, rate.toFloat())
                val buffer = ShortArray(frame)
                var heardVoice = false; var quiet = 0; var frames = 0
                try {
                    record.startRecording()
                    while (token == attempt && capturing && frames++ < 70 && !(heardVoice && quiet >= 10)) {
                        val read = record.read(buffer, 0, frame); if (read <= 0) continue
                        var sum = 0.0; for (i in 0 until read) sum += buffer[i] * buffer[i].toDouble()
                        if (kotlin.math.sqrt(sum / read) > 800) { heardVoice = true; quiet = 0 } else if (heardVoice) quiet++
                        recognizer.acceptWaveForm(buffer, read)
                    }
                    JSONObject(recognizer.finalResult).optString("text")
                } finally { runCatching { record.stop() }; record.release(); recognizer.close() }
            } catch (failure: Exception) { "" }
            handler.post { if (token == attempt) finishCommand(text.takeIf { it.isNotBlank() }, if (text.isBlank()) "No escuché un comando después de «Ok MURMUR»." else null) }
        }, "MurmurVoiceCommand").start()
    }

    private fun finishCommand(text: String?, error: String?) {
        if (!capturing) return
        capturing = false
        attempt++
        command?.destroy(); command = null
        VoiceTriggerManager.restoreAudio()
        if (!text.isNullOrBlank()) NativeEvents.emit("onVoiceCommandCaptured", JSObject().put("text", text.take(1000)).put("source", "wake"))
        else if (error != null) NativeEvents.emit("onVoiceError", JSObject().put("message", error))
        handler.postDelayed({ if (running) listen() }, 600)
    }

    override fun onDestroy() {
        running = false
        handler.removeCallbacksAndMessages(null)
        command?.destroy(); command = null
        pauseListening()
        model?.close(); model = null
        if (capturing) VoiceTriggerManager.restoreAudio()
        super.onDestroy()
    }
}
