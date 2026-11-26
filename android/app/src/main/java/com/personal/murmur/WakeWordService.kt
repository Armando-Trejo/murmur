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

/** Vosk models arrive as one zip with a top folder; this installs one safely into app storage. */
object ModelArchive {
    /**
     * Downloads over HTTPS (declared size up to [maxBytes]), unzips with path checks into a staging
     * folder, checks the [required] files and only then swaps it in. [label] names it in errors.
     */
    fun install(url: String, maxBytes: Long, target: File, required: List<String>, label: String) {
        val name = label.replaceFirstChar { it.uppercase() }
        val staging = File(target.parentFile, target.name + ".part").apply { deleteRecursively(); mkdirs() }
        try {
            NativeNetwork.client.newCall(okhttp3.Request.Builder().url(url).build()).execute().use { response ->
                check(response.isSuccessful) { "No se pudo descargar $label (${response.code})" }
                val body = response.body ?: error("$name llegó vacío")
                check(body.contentLength() in 1..maxBytes) { "$name tiene un tamaño inesperado" }
                var total = 0L
                ZipInputStream(body.byteStream()).use { zip ->
                    while (true) {
                        val entry = zip.nextEntry ?: break
                        // Strip the top folder ("vosk-model-…/…") and refuse paths leaving staging.
                        val relative = entry.name.substringAfter('/', "").takeIf { it.isNotBlank() } ?: continue
                        val out = File(staging, relative).canonicalFile
                        check(out.path.startsWith(staging.canonicalPath + File.separator)) { "$name trae una ruta inválida" }
                        if (entry.isDirectory) { out.mkdirs(); continue }
                        out.parentFile?.mkdirs()
                        out.outputStream().use { output ->
                            val buffer = ByteArray(65536)
                            while (true) {
                                val n = zip.read(buffer); if (n < 0) break
                                total += n; check(total <= maxBytes * 2) { "$name excede el tamaño esperado" }
                                output.write(buffer, 0, n)
                            }
                        }
                    }
                }
            }
            check(required.all { File(staging, it).isFile }) { "$name llegó incompleto" }
            target.deleteRecursively()
            check(staging.renameTo(target)) { "No se pudo guardar $label" }
        } finally { staging.deleteRecursively() }
    }
}

/** Spanish Vosk model kept in app storage; downloaded once, on the user's opt-in. */
object WakeWordModel {
    private const val URL = "https://alphacephei.com/vosk/models/vosk-model-small-es-0.42.zip"
    private const val MAX_BYTES = 80L * 1024 * 1024
    private val REQUIRED = listOf("am/final.mdl", "conf/model.conf")
    fun directory(context: Context) = File(context.filesDir, "models/vosk-es")
    fun available(context: Context) = REQUIRED.all { File(directory(context), it).isFile }

    /** Downloads over HTTPS, unzips with path checks into a temp folder, then swaps it in. */
    @Synchronized fun download(context: Context) {
        if (available(context)) return
        ModelArchive.install(URL, MAX_BYTES, directory(context), REQUIRED, "el modelo de voz")
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
        /** Android refuses a microphone service without the microphone permission (it would crash MURMUR). */
        fun canListen(context: Context) = ContextCompat.checkSelfPermission(context, android.Manifest.permission.RECORD_AUDIO) ==
            android.content.pm.PackageManager.PERMISSION_GRANTED
        /** Starts listening when allowed; returns false when the microphone permission is missing. */
        fun start(context: Context): Boolean {
            if (!canListen(context)) return false
            ContextCompat.startForegroundService(context, Intent(context, WakeWordService::class.java))
            return true
        }
        fun stop(context: Context) { context.stopService(Intent(context, WakeWordService::class.java)) }

        /** True when recognised text contains the wake phrase (Vosk spells it loosely in Spanish). */
        fun heard(text: String) = WakePhrase.heard(text)
        /** After music stops, keep listening this long so "Ok MURMUR, continúa" still works. */
        const val IDLE_GRACE_MS = 3 * 60_000L
        /** "music": with MURMUR on screen or while music plays (and a short while after); "screen": only on screen. */
        fun mode(context: Context) = context.getSharedPreferences("playback", 0).getString("wake_mode", "music") ?: "music"
        fun setMode(context: Context, value: String) = context.getSharedPreferences("playback", 0).edit()
            .putString("wake_mode", if (value == "screen") "screen" else "music").apply()
        /** MURMUR's own screen is showing (set by MainActivity; false until it says so). */
        @Volatile var appVisible = false

        @Volatile private var instance: WakeWordService? = null
        /** True while "Entrena tu voz" has the microphone: the listener stays closed. */
        @Volatile var held = false; private set

        /**
         * "Entrena tu voz" needs the microphone: the listener lets go of it (waits up to 1.5 s for its
         * capture to close) and stays closed until [releaseMicrophone]. False while the request after
         * "Ok MURMUR" is being captured. Call off the main thread.
         */
        fun holdMicrophone(): Boolean {
            held = true
            val service = instance ?: return true
            if (service.capturing) { held = false; return false }
            val worker = service.loop
            service.loop = null
            if (worker != null && worker !== Thread.currentThread()) worker.join(1_500)
            return true
        }

        /** Gives the microphone back to the listener, which reopens it if listening is useful. */
        fun releaseMicrophone() {
            held = false
            instance?.let { service -> service.handler.post { if (running) service.listen() } }
        }

        /** The Spanish model the listener already has in memory, so the enrollment need not load another. */
        fun sharedModel(): Model? = instance?.model
    }

    private val handler = Handler(Looper.getMainLooper())
    @Volatile private var model: Model? = null
    private var command: SpeechRecognizer? = null
    @Volatile private var capturing = false
    @Volatile private var loading = false
    private var lastWake = 0L

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            setEnabled(this, false)
            NativeEvents.emit("onWakeWordChanged", JSObject().put("enabled", false))
            stopSelf(); return START_NOT_STICKY
        }
        // No permission (e.g. after reinstalling) or MURMUR not allowed to start it from the background:
        // stay off instead of crashing; it starts again the next time MURMUR opens with permission.
        if (!canListen(this) || runCatching { startInForeground() }.isFailure) {
            running = false
            stopSelf(); return START_NOT_STICKY
        }
        if (model == null && !loading) { loading = true; Thread { load() }.start() }
        return START_STICKY
    }

    private fun startInForeground() {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL, "Escucha «Ok MURMUR»", NotificationManager.IMPORTANCE_MIN))
        val notification = notification(listening = true)
        if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
        else startForeground(NOTIFICATION, notification)
        running = true
    }

    private fun notification(listening: Boolean): Notification {
        val open = PendingIntent.getActivity(this, 3, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val stop = PendingIntent.getService(this, 4, Intent(this, WakeWordService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        return NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_sound)
            .setContentTitle(if (listening) "Di «Ok MURMUR»" else "«Ok MURMUR» en espera")
            .setContentText(if (listening) "Escucha local, sin enviar audio hasta que dices la frase."
                else if (mode(this) == "screen") "Micrófono apagado. Escucha de nuevo al abrir MURMUR."
                else "Micrófono apagado. Vuelve a escuchar cuando suena música o abres MURMUR.")
            .setOngoing(true).setContentIntent(open).addAction(0, "Desactivar", stop)
            .setPriority(NotificationCompat.PRIORITY_MIN).build()
    }

    /** Last time music played: the phrase stays useful a while after a pause ("Ok MURMUR, continúa"). */
    // Starts "long ago": right after the service starts the microphone opens only for the app on
    // screen or for music, not for three minutes of silence with the screen off.
    @Volatile private var lastMusicAt = android.os.SystemClock.elapsedRealtime() - IDLE_GRACE_MS
    private var listeningShown = true

    /**
     * The microphone only opens when a command can matter: MURMUR is on screen, music is playing,
     * or it stopped less than [IDLE_GRACE_MS] ago. Otherwise the service waits without recording.
     */
    private fun useful(): Boolean {
        val now = android.os.SystemClock.elapsedRealtime()
        val audio = getSystemService(android.media.AudioManager::class.java)
        if (audio?.isMusicActive == true || HybridMediaService.instance?.visualPlaying == true) lastMusicAt = now
        if (mode(this) == "screen") return appVisible
        return appVisible || now - lastMusicAt < IDLE_GRACE_MS
    }

    private fun showListening(listening: Boolean) {
        if (listening == listeningShown || !running) return
        listeningShown = listening
        runCatching { getSystemService(NotificationManager::class.java).notify(NOTIFICATION, notification(listening)) }
    }

    /** While waiting, checks every 3 s whether listening became useful again. */
    private val watch = object : Runnable {
        override fun run() {
            if (!running) return
            if (!capturing && loop == null && model != null && !held) {
                if (useful()) listen() else showListening(false)
            }
            handler.postDelayed(this, 3_000)
        }
    }

    private fun load() {
        try {
            if (!WakeWordModel.available(this)) WakeWordModel.download(this)
            val loaded = Model(WakeWordModel.directory(this).absolutePath)
            // "Solo mi voz" on: have the speaker model ready before the first wake, not during it.
            if (VoiceProfile.active(this) != null) SpeakerModelStore.shared(this)
            handler.post {
                if (!running) { loaded.close(); return@post }
                model = loaded; loading = false
                listen()
                handler.removeCallbacks(watch); handler.postDelayed(watch, 3_000)
                NativeEvents.emit("onWakeWordChanged", JSObject().put("enabled", true).put("ready", true))
            }
        } catch (failure: Exception) {
            android.util.Log.w("MURMUR", "Wake word unavailable", failure)
            NativeEvents.emit("onVoiceError", JSObject().put("message", failure.message ?: "No se pudo preparar la escucha de «Ok MURMUR»."))
            handler.post { setEnabled(this, false); stopSelf() }
        }
    }

    @Volatile private var loop: Thread? = null

    private fun listen() {
        val current = model ?: return
        if (capturing || loop != null || held) return
        if (!useful()) { showListening(false); return }
        showListening(true)
        val worker = Thread({ capture(current) }, "MurmurWakeWord")
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

    private fun capture(model: Model) {
        while (loop === Thread.currentThread() && !capturing) {
            val echo = wantsEchoCancel()
            if (!captureWith(model, echo)) return
        }
    }

    /** One microphone session; returns true to reopen (the music started or stopped), false to end. */
    private fun captureWith(model: Model, echo: Boolean): Boolean {
        val rate = WakeDetector.RATE
        val frame = WakeDetector.FRAME // 100 ms of 16-bit mono samples
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
        val detector = WakeDetector(model) { audio, hard ->
            val checkStarted = android.os.SystemClock.elapsedRealtime()
            confirm(model, audio, hard).also {
                if (android.util.Log.isLoggable(LOG_TAG, android.util.Log.DEBUG))
                    android.util.Log.d(LOG_TAG, "wake timing check=${android.os.SystemClock.elapsedRealtime() - checkStarted}ms")
            }
        }
        val buffer = ShortArray(frame)
        var frames = 0
        var reopen = false
        try {
            record.startRecording()
            while (loop === Thread.currentThread() && !capturing) {
                val read = record.read(buffer, 0, frame)
                if (read <= 0) { Thread.sleep(50); continue }
                frames++
                if (detector.accept(buffer, read, echo || musicPlaying())) {
                    val now = android.os.SystemClock.elapsedRealtime()
                    if (now - lastWake >= 3_000) {
                        commandStarted = now
                        lastWake = now
                        handler.post { captureCommand() }
                    }
                }
                // Every 2 s: stop if listening no longer helps; reopen if the music started or stopped.
                if (frames % 20 == 0) {
                    if (android.util.Log.isLoggable(LOG_TAG, android.util.Log.DEBUG)) android.util.Log.d(LOG_TAG, "wake mic echo=$echo aec=${effects.size} rms=${detector.rms.toInt()} floor=${detector.floor.toInt()} gain=${String.format(java.util.Locale.ROOT, "%.1f", detector.gain)}")
                    if (detector.idle) {
                        if (!useful()) break
                        if (wantsEchoCancel() != echo) { reopen = true; break }
                    }
                }
            }
        } catch (failure: Exception) {
            android.util.Log.w("MURMUR", "Wake word listener stopped", failure)
            if (running && !capturing) handler.postDelayed({ loop = null; listen() }, 3_000)
            reopen = false
        } finally {
            runCatching { record.stop() }; record.release(); detector.close()
            effects.forEach { runCatching { it.release() } }
            if (!reopen && loop === Thread.currentThread()) loop = null
        }
        return reopen
    }

    private fun musicPlaying() = runCatching { getSystemService(android.media.AudioManager::class.java).isMusicActive }.getOrDefault(false)

    /**
     * Second check, on the capture thread (~0.3 s): the same seconds transcribed without the phrase
     * grammar. With "Solo mi voz" on, the same pass also yields the speaker's x-vector, which must
     * resemble the enrolled voice. If the speaker model is missing or fails, the phrase check alone
     * decides, as before. Only counts and similarities reach the debug log, never what was said.
     */
    private fun confirm(model: Model, audio: List<ShortArray>, overMusic: Boolean): Boolean {
        val debug = android.util.Log.isLoggable(LOG_TAG, android.util.Log.DEBUG)
        val heard = runCatching { WakeCheck.passes(model, audio) }.getOrDefault(false)
        val profile = VoiceProfile.active(this)
        val speaker = if (profile != null && heard) SpeakerModelStore.shared(this) else null
        val open = speaker?.let { runCatching { Recognizer(model, 16000f, it) }.getOrNull() }
        if (open == null || profile == null) {
            if (debug) android.util.Log.d(LOG_TAG, "wake check ${if (heard) "confirmed" else "rejected"} voice=${if (profile == null) "off" else "unavailable"}")
            return heard
        }
        // «Solo mi voz» (off unless the owner turns it on): the same audio must also sound like them.
        return try {
            val segments = mutableListOf<VoiceMatch.Segment>()
            for (samples in audio) if (open.acceptWaveForm(samples, samples.size)) segments += VoiceMatch.segment(open.result)
            segments += VoiceMatch.segment(open.finalResult)
            val words = segments.joinToString(" ") { it.text }.split(' ').count { it.isNotBlank() }
            val sample = VoiceMatch.sample(segments)
            val similarity = sample?.let { VoiceMatch.similarity(profile.vectors, it.first) }
            VoiceMatch.accepts(similarity, profile.threshold, overMusic).also { ok ->
                if (debug) android.util.Log.d(LOG_TAG, String.format(java.util.Locale.ROOT,
                    "wake voice %s words=%d similarity=%.3f threshold=%.3f music=%b frames=%d",
                    if (ok) "accepted" else "rejected", words, similarity ?: Double.NaN, profile.threshold, overMusic, sample?.second ?: 0))
            }
        } catch (_: Exception) { false } finally { open.close() }
    }

    private fun pauseListening() {
        val worker = loop
        loop = null
        worker?.join(400)
    }

    /** When the phrase was confirmed (debug timing only). */
    @Volatile private var commandStarted = 0L

    /** Each capture gets a token so a late callback from an abandoned recognizer is ignored. */
    private var attempt = 0

    /**
     * The wake phrase was heard: free the microphone and take the request with Android's recognizer.
     * Order: the phone's offline recognizer; if it lacks Spanish (or fails to start), the system
     * recognizer (Google, online); if there is no usable service either, the local Vosk model.
     */
    private fun captureCommand(system: Boolean = false) {
        if (!system) {
            // "Entrena tu voz" took the microphone between the check and this moment.
            if (held || capturing) return
            capturing = true
            pauseListening()
            VoiceTriggerManager.beginListening(this)
            // The app shows "Te escucho…" so the person knows the phrase was understood.
            NativeEvents.emit("onVoiceListening", JSObject().put("listening", true).put("source", "wake"))
            handler.postDelayed({ if (capturing) finishCommand(null, "No escuché un comando después de «Ok MURMUR».") }, 14_000)
        }
        val token = ++attempt
        val local = !system && VoiceHints.preferOnDevice(this)
        if (!local && !SpeechRecognizer.isRecognitionAvailable(this)) { localCommand(); return }
        val recognizer = try {
            if (local && Build.VERSION.SDK_INT >= 31) SpeechRecognizer.createOnDeviceSpeechRecognizer(this) else SpeechRecognizer.createSpeechRecognizer(this)
        } catch (_: Exception) { if (local) captureCommand(system = true) else localCommand(); return }
        command = recognizer
        recognizer.setRecognitionListener(object : RecognitionListener {
            override fun onResults(results: Bundle?) {
                if (token != attempt) return
                if (android.util.Log.isLoggable(LOG_TAG, android.util.Log.DEBUG))
                    android.util.Log.d(LOG_TAG, "wake timing command=${android.os.SystemClock.elapsedRealtime() - commandStarted}ms online=${!local}")
                finishCommand(VoiceHints.join(results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)), null)
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
        recognizer.startListening(VoiceHints.request(this, local))
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
        NativeEvents.emit("onVoiceListening", JSObject().put("listening", false).put("source", "wake"))
        if (!text.isNullOrBlank()) NativeEvents.emit("onVoiceCommandCaptured", JSObject().put("text", text.take(1000)).put("source", "wake"))
        else if (error != null) NativeEvents.emit("onVoiceError", JSObject().put("message", error))
        handler.postDelayed({ if (running) listen() }, 600)
    }

    override fun onDestroy() {
        running = false
        if (instance === this) instance = null
        handler.removeCallbacksAndMessages(null)
        command?.destroy(); command = null
        pauseListening()
        model?.close(); model = null
        if (capturing) VoiceTriggerManager.restoreAudio()
        super.onDestroy()
    }
}
