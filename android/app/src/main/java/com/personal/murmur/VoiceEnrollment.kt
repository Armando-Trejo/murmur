package com.personal.murmur

import android.content.Context
import android.os.Handler
import android.os.Looper
import com.getcapacitor.JSObject
import org.json.JSONArray
import org.json.JSONObject
import org.vosk.Model
import org.vosk.Recognizer
import org.vosk.SpeakerModel
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.sqrt

/** Vosk's speaker model (~13 MB): downloaded on the first "Solo mi voz", loaded once per process. */
object SpeakerModelStore {
    private const val URL = "https://alphacephei.com/vosk/models/vosk-model-spk-0.4.zip"
    private const val MAX_BYTES = 40L * 1024 * 1024
    private val REQUIRED = listOf("final.ext.raw", "mean.vec", "transform.mat", "mfcc.conf")
    fun directory(context: Context) = File(context.filesDir, "models/vosk-spk")
    fun available(context: Context) = REQUIRED.all { File(directory(context), it).isFile }

    @Volatile private var loaded: SpeakerModel? = null
    @Volatile private var failed = false

    @Synchronized fun download(context: Context) {
        if (available(context)) return
        ModelArchive.install(URL, MAX_BYTES, directory(context), REQUIRED, "el modelo de tu voz")
    }

    /**
     * The model in memory, or null when it is missing or does not load: verification then steps
     * aside and "Ok MURMUR" keeps working with the phrase check alone. Kept for the process's life.
     */
    @Synchronized fun shared(context: Context): SpeakerModel? {
        loaded?.let { return it }
        if (failed || !available(context)) return null
        return try {
            SpeakerModel(directory(context).absolutePath).also { loaded = it }
        } catch (failure: Exception) {
            failed = true; android.util.Log.w("MURMUR", "Speaker model unavailable", failure); null
        } catch (failure: LinkageError) {
            failed = true; android.util.Log.w("MURMUR", "Speaker model unavailable", failure); null
        }
    }

    /** A copy that does not load is replaced once with a fresh download. */
    @Synchronized fun repair(context: Context) {
        if (loaded != null) return
        directory(context).deleteRecursively()
        failed = false
        download(context)
    }
}

/**
 * The enrolled voice: three x-vectors and the threshold computed from them. Kept only in the app's
 * no-backup storage (never in Android backups, MURMUR's own backup or the web layer).
 */
class VoiceProfile(val vectors: List<FloatArray>, val threshold: Double, val enabled: Boolean) {
    fun withEnabled(value: Boolean) = VoiceProfile(vectors, threshold, value)

    fun toJson(): String = JSONObject()
        .put("version", VERSION)
        .put("enabled", enabled)
        .put("threshold", threshold)
        .put("vectors", JSONArray().apply { vectors.forEach { vector -> put(JSONArray().apply { vector.forEach { put(it.toDouble()) } }) } })
        .toString()

    companion object {
        private const val VERSION = 2
        private fun file(context: Context) = File(context.noBackupFilesDir, "voice/profile.json")

        /** Null when the text is not a usable profile; a threshold out of range is brought back into it. */
        fun fromJson(json: String): VoiceProfile? = runCatching {
            val data = JSONObject(json)
            val array = data.getJSONArray("vectors")
            val vectors = (0 until array.length()).map { i ->
                val values = array.getJSONArray(i)
                FloatArray(values.length()) { values.getDouble(it).toFloat() }
            }
            require(vectors.size >= 2 && vectors.all { it.isNotEmpty() && it.size == vectors[0].size })
            val threshold = data.optDouble("threshold", VoiceMatch.MIN_THRESHOLD)
                .let { if (it.isNaN()) VoiceMatch.MIN_THRESHOLD else it }
                .coerceIn(VoiceMatch.MIN_THRESHOLD, VoiceMatch.MAX_THRESHOLD)
            // Profiles saved before 2.19 left «Solo mi voz» on without making clear that nobody else
            // could wake MURMUR: they come back switched off, and anyone's voice works again.
            VoiceProfile(vectors, threshold, data.optInt("version", 1) >= VERSION && data.optBoolean("enabled", false))
        }.getOrNull()

        fun load(context: Context): VoiceProfile? =
            file(context).takeIf { it.isFile }?.let { runCatching { fromJson(it.readText()) }.getOrNull() }

        /** The profile verification should use right now: present and switched on. */
        fun active(context: Context): VoiceProfile? = load(context)?.takeIf { it.enabled }

        /** Written to a temporary file first, so a crash never leaves half a profile. */
        @Synchronized fun save(context: Context, profile: VoiceProfile) {
            val target = file(context)
            target.parentFile?.mkdirs()
            val temporary = File(target.parentFile, target.name + ".tmp")
            temporary.writeText(profile.toJson())
            check(temporary.renameTo(target)) { "No se pudo guardar tu voz" }
        }

        @Synchronized fun clear(context: Context) {
            file(context).delete()
        }
    }
}

/**
 * "Entrena tu voz": three takes of "Ok MURMUR". Each take records up to 4 s from the
 * voice-recognition microphone (the wake listener lets go of it meanwhile), requires enough voice,
 * the phrase in an open transcription and a usable x-vector that resembles the earlier takes.
 * The third accepted take saves the profile, switched on.
 */
object VoiceEnrollment {
    private const val LOG_TAG = "MURMUR"
    private const val RATE = 16000
    private const val FRAME = RATE / 10 // 100 ms
    private const val MAX_FRAMES = 40 // 4 s at most
    private const val END_QUIET = 6 // 0.6 s of quiet after the voice ends the take
    private const val MIN_FRAMES_BEFORE_END = 12

    private val takes = arrayOfNulls<FloatArray>(VoiceMatch.TAKES)
    private val busy = AtomicBoolean(false)
    private val main by lazy { Handler(Looper.getMainLooper()) }

    /** Result of one take; [restart] asks the screen to begin again from the first take. */
    class Outcome(val ok: Boolean, val done: Boolean = false, val message: String? = null, val restart: Boolean = false)

    /** Downloads (first time) and loads what the takes need. Blocking: call off the main thread. */
    fun prepare(context: Context) {
        if (!WakeWordModel.available(context)) WakeWordModel.download(context)
        if (!SpeakerModelStore.available(context)) SpeakerModelStore.download(context)
        if (SpeakerModelStore.shared(context) == null) {
            SpeakerModelStore.repair(context)
            checkNotNull(SpeakerModelStore.shared(context)) { "«Solo mi voz» no está disponible en este teléfono." }
        }
    }

    /** Forgets takes recorded but not finished. */
    fun discard() = synchronized(takes) { takes.fill(null) }

    /** Records and judges take [number] (1 to [VoiceMatch.TAKES]). Blocking: call off the main thread. */
    fun take(context: Context, number: Int): Outcome {
        if (number !in 1..VoiceMatch.TAKES) return Outcome(false, message = "Empecemos de nuevo.", restart = true)
        if (!busy.compareAndSet(false, true)) return Outcome(false, message = "Ya te estoy escuchando.")
        try {
            synchronized(takes) {
                if (number == 1) takes.fill(null)
                else if ((0 until number - 1).any { takes[it] == null }) return Outcome(false, message = "Empecemos de nuevo desde la primera.", restart = true)
            }
            prepare(context)
            val speaker = SpeakerModelStore.shared(context) ?: return Outcome(false, message = "«Solo mi voz» no está disponible en este teléfono.")
            if (!WakeWordService.holdMicrophone()) return Outcome(false, message = "MURMUR está atendiendo una petición. Inténtalo en un momento.")
            var own: Model? = null
            var recognizer: Recognizer? = null
            try {
                // The listener's model when it is running; otherwise one loaded only for this take.
                val model = WakeWordService.sharedModel() ?: Model(WakeWordModel.directory(context).absolutePath).also { own = it }
                recognizer = Recognizer(model, RATE.toFloat(), speaker)
                val (audio, levels) = try { record(context, number) } catch (_: Exception) {
                    return Outcome(false, message = "No se pudo usar el micrófono. Cierra otras apps que lo usen e inténtalo de nuevo.")
                }
                return judge(context, number, recognizer, audio, levels)
            } finally {
                recognizer?.close()
                own?.close()
                WakeWordService.releaseMicrophone()
            }
        } finally {
            busy.set(false)
        }
    }

    /** Up to 4 s; stops 0.6 s after the voice ends. Music is lowered meanwhile; the screen gets live levels. */
    private fun record(context: Context, number: Int): Pair<List<ShortArray>, List<Double>> {
        if (context.checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) != android.content.pm.PackageManager.PERMISSION_GRANTED)
            throw SecurityException("Sin permiso de micrófono")
        val record = android.media.AudioRecord(android.media.MediaRecorder.AudioSource.VOICE_RECOGNITION, RATE,
            android.media.AudioFormat.CHANNEL_IN_MONO, android.media.AudioFormat.ENCODING_PCM_16BIT,
            maxOf(android.media.AudioRecord.getMinBufferSize(RATE, android.media.AudioFormat.CHANNEL_IN_MONO, android.media.AudioFormat.ENCODING_PCM_16BIT), FRAME * 4))
        if (record.state != android.media.AudioRecord.STATE_INITIALIZED) { record.release(); error("Micrófono ocupado") }
        val audio = mutableListOf<ShortArray>()
        val levels = mutableListOf<Double>()
        main.post { HybridMediaService.instance?.setDucking(true) }
        try {
            record.startRecording()
            NativeEvents.emit("onVoiceEnrollment", JSObject().put("take", number).put("phase", "listening"))
            val buffer = ShortArray(FRAME)
            var voiced = 0
            var quiet = 0
            var reads = 0
            while (audio.size < MAX_FRAMES && reads++ < MAX_FRAMES * 2) {
                val read = record.read(buffer, 0, FRAME)
                if (read < 0) break
                if (read == 0) continue
                val chunk = buffer.copyOf(read)
                var sum = 0.0
                for (sample in chunk) sum += sample * sample.toDouble()
                val rms = sqrt(sum / read)
                audio += chunk; levels += rms
                if (rms > VoiceMatch.MIN_VOICE_RMS) { voiced++; quiet = 0 } else if (voiced > 0) quiet++
                NativeEvents.emit("onVoiceEnrollment", JSObject().put("take", number).put("phase", "level").put("rms", rms.toInt()))
                if (voiced >= VoiceMatch.MIN_VOICED_FRAMES && quiet >= END_QUIET && audio.size >= MIN_FRAMES_BEFORE_END) break
            }
        } finally {
            runCatching { record.stop() }
            record.release()
            main.post { HybridMediaService.instance?.setDucking(false) }
            NativeEvents.emit("onVoiceEnrollment", JSObject().put("take", number).put("phase", "checking"))
        }
        return audio to levels
    }

    private fun judge(context: Context, number: Int, recognizer: Recognizer, audio: List<ShortArray>, levels: List<Double>): Outcome {
        if (VoiceMatch.voicedFrames(levels) < VoiceMatch.MIN_VOICED_FRAMES)
            return rejected(number, "quiet", "No te escuché. Acerca un poco el teléfono y di «Ok MURMUR».")
        val segments = mutableListOf<VoiceMatch.Segment>()
        for (chunk in audio) if (recognizer.acceptWaveForm(chunk, chunk.size)) segments += VoiceMatch.segment(recognizer.result)
        segments += VoiceMatch.segment(recognizer.finalResult)
        if (!WakePhrase.confirmed(segments.map { it.text }))
            return rejected(number, "phrase", "No reconocí «Ok MURMUR». Dilo otra vez, claro y a tu ritmo.")
        val sample = VoiceMatch.sample(segments)?.takeIf { it.second >= VoiceMatch.MIN_FRAMES }
            ?: return rejected(number, "short", "Fue muy breve. Di «Ok MURMUR» con tu voz de siempre, sin prisa.")
        synchronized(takes) {
            val previous = (0 until number - 1).mapNotNull { takes[it] }
            if (!VoiceMatch.takeFits(previous, sample.first))
                return rejected(number, "unlike", "Esta toma sonó distinta a las anteriores. Repítela en un lugar tranquilo.",
                    VoiceMatch.similarity(previous, sample.first))
            takes[number - 1] = sample.first
            debug(String.format(java.util.Locale.ROOT, "voice take %d accepted frames=%d similarity=%.3f",
                number, sample.second, if (previous.isEmpty()) Double.NaN else VoiceMatch.similarity(previous, sample.first)))
            if (number < VoiceMatch.TAKES) return Outcome(true)
            val all = takes.map { it!! }
            val threshold = VoiceMatch.threshold(all)
            VoiceProfile.save(context, VoiceProfile(all, threshold, enabled = true))
            takes.fill(null)
            debug(String.format(java.util.Locale.ROOT, "voice enrolled threshold=%.3f", threshold))
            return Outcome(true, done = true)
        }
    }

    private fun rejected(number: Int, reason: String, message: String, similarity: Double = Double.NaN): Outcome {
        debug(String.format(java.util.Locale.ROOT, "voice take %d rejected reason=%s similarity=%.3f", number, reason, similarity))
        return Outcome(false, message = message)
    }

    /** Numbers only: never what was said. */
    private fun debug(line: String) {
        if (android.util.Log.isLoggable(LOG_TAG, android.util.Log.DEBUG)) android.util.Log.d(LOG_TAG, line)
    }
}
