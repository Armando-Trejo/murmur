package com.personal.murmur

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import org.vosk.Model
import org.vosk.Recognizer
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.Locale
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.math.sqrt
import kotlin.random.Random

/**
 * Measures «Ok MURMUR» on the phone with the real detector (test builds only):
 *   adb shell am broadcast -n com.personal.murmur/.WakeBenchReceiver -a com.personal.murmur.BENCH --es step synth|run
 * "synth" records the phrase and trap sentences with every Spanish (and some English) voice of the
 * phone; "run" plays them to WakeDetector near, far, very far, over noise and shouted close, and
 * writes files/bench/result.txt.
 */
class WakeBenchReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val app = context.applicationContext
        val step = intent.getStringExtra("step")
        // The work outlasts a broadcast; MURMUR is open while it runs, so the process stays.
        Thread {
            try {
                if (step == "synth") synth(app) else run(app)
            } catch (e: Throwable) { Log.e(TAG, "bench failed", e) }
        }.start()
    }

    private fun folder(context: Context) = File(context.filesDir, "bench").apply { mkdirs() }

    private fun synth(context: Context) {
        val ready = CountDownLatch(1)
        val tts = TextToSpeech(context, { ready.countDown() }, "com.google.android.tts")
        ready.await(10, TimeUnit.SECONDS)
        val voices = tts.voices.orEmpty()
            .filter { !it.isNetworkConnectionRequired && "notInstalled" !in it.features }
            .filter { it.locale.language == "es" || (it.locale.language == "en" && it.locale.country == "US") }
            .sortedBy { it.name }
        val spanish = voices.filter { it.locale.language == "es" }
        val chosen = spanish + voices.filter { it.locale.language == "en" }.take(4)
        Log.i(TAG, "bench voices ${chosen.size}: ${chosen.joinToString { it.name }}")
        var done: CountDownLatch? = null
        tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(id: String?) {}
            override fun onDone(id: String?) { done?.countDown() }
            @Deprecated("old") override fun onError(id: String?) { done?.countDown() }
        })
        fun record(name: String, text: String, pitch: Float, rate: Float) {
            tts.setPitch(pitch); tts.setSpeechRate(rate)
            done = CountDownLatch(1)
            tts.synthesizeToFile(text, null, File(folder(context), "$name.wav"), name)
            done!!.await(15, TimeUnit.SECONDS)
        }
        folder(context).listFiles()?.forEach { it.delete() }
        // The same engine voice at other pitches and speeds stands in for more people.
        val people = listOf(1.0f to 1.0f, 0.78f to 0.92f, 1.3f to 1.12f)
        chosen.forEachIndexed { v, voice ->
            tts.voice = voice
            people.forEachIndexed { p, (pitch, rate) ->
                POSITIVES.forEachIndexed { i, text -> if ((v + p + i) % 2 == 0) record("pos_${voice.name}_${p}_$i", text, pitch, rate) }
            }
        }
        spanish.forEachIndexed { v, voice ->
            tts.voice = voice
            NEGATIVES.forEachIndexed { i, text -> record("neg_${voice.name}_$i", text, 1.0f, 1.0f) }
        }
        tts.shutdown()
        Log.i(TAG, "bench synth done: ${folder(context).list()?.size} files")
    }

    /** PCM16 mono WAV resampled to 16 kHz. */
    private fun read(file: File): DoubleArray {
        val bytes = file.readBytes()
        val data = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
        val rate = data.getInt(24)
        var at = 12
        while (String(bytes, at, 4) != "data") at += 8 + data.getInt(at + 4)
        val declared = data.getInt(at + 4)
        val available = bytes.size - at - 8
        val count = (if (declared in 1..available) declared else available) / 2
        val samples = DoubleArray(count) { data.getShort(at + 8 + it * 2).toDouble() }
        val out = DoubleArray((count.toLong() * 16000 / rate).toInt())
        for (i in out.indices) {
            val x = i.toDouble() * rate / 16000
            val k = x.toInt().coerceAtMost(count - 2)
            out[i] = samples[k] + (samples[k + 1] - samples[k]) * (x - k)
        }
        return out
    }

    /** Speech at [speechRms] in a room with [noise]; far speech carries the room's echoes. */
    private class Scene(val name: String, val speechRms: Double, val noise: Double, val echo: Boolean)

    private fun render(speech: DoubleArray, scene: Scene, seed: Int): ShortArray {
        val voiced = speech.filter { kotlin.math.abs(it) > 300 }
        val rms = sqrt(voiced.sumOf { it * it } / maxOf(1, voiced.size))
        val scale = scene.speechRms / maxOf(1.0, rms)
        val lead = 16000
        val out = DoubleArray(lead + speech.size + 24000)
        for (i in speech.indices) out[lead + i] += speech[i] * scale
        if (scene.echo) {
            val dry = out.copyOf()
            for ((delay, level) in listOf(0.023 to 0.45, 0.041 to 0.34, 0.067 to 0.24, 0.097 to 0.16, 0.139 to 0.10)) {
                val d = (delay * 16000).toInt()
                for (i in d until out.size) out[i] += dry[i - d] * level
            }
        }
        val random = Random(seed)
        var brown = 0.0
        for (i in out.indices) {
            brown = brown * 0.9 + (random.nextDouble() - 0.5)
            out[i] += brown * scene.noise * 1.5
        }
        return ShortArray(out.size) { out[it].toInt().coerceIn(-32768, 32767).toShort() }
    }

    private fun run(context: Context) {
        val model = Model(WakeWordModel.directory(context).absolutePath)
        val report = StringBuilder()
        val scenes = listOf(
            Scene("cerca", 7000.0, 30.0, false),
            Scene("pegado", 20000.0, 30.0, false),
            Scene("normal", 2000.0, 60.0, false),
            Scene("lejos", 450.0, 60.0, true),
            Scene("muylejos", 220.0, 45.0, true),
            Scene("ruido", 1800.0, 450.0, false),
        )
        val files = folder(context).listFiles { f -> f.name.endsWith(".wav") && f.length() > 1000 }!!.sortedBy { it.name }
        val hits = HashMap<String, IntArray>()
        val checkMs = mutableListOf<Long>()
        for ((n, file) in files.withIndex()) {
            val speech = read(file)
            val positive = file.name.startsWith("pos_")
            val use = if (positive) scenes else listOf(scenes[0], scenes[2], scenes[3], scenes[5])
            val phrase = (if (positive) POSITIVES else NEGATIVES)[file.nameWithoutExtension.substringAfterLast('_').toInt()]
            for (scene in use) {
                val audio = render(speech, scene, n)
                var checked: String? = null
                val detector = WakeDetector(model) { recent, _ ->
                    val started = android.os.SystemClock.elapsedRealtime()
                    val ok = WakeCheck.passes(model, recent)
                    checkMs += android.os.SystemClock.elapsedRealtime() - started
                    if (checked == null || ok) {
                        val open = Recognizer(model, 16000f)
                        val parts = mutableListOf<String>()
                        for (s in recent) if (open.acceptWaveForm(s, s.size)) parts += VoiceMatch.segment(open.result).text
                        parts += VoiceMatch.segment(open.finalResult).text
                        open.close()
                        checked = parts.joinToString(" ").trim()
                    }
                    ok
                }
                var woke = false
                var offset = 0
                while (offset + WakeDetector.FRAME <= audio.size) {
                    if (detector.accept(audio.copyOfRange(offset, offset + WakeDetector.FRAME), WakeDetector.FRAME, false)) woke = true
                    offset += WakeDetector.FRAME
                }
                detector.close()
                // Spanish and English voices apart: an English "murmur" is another sound.
                val key = (if (!positive) "neg " else if (file.name.startsWith("pos_es")) "pos es " else "pos en ") + scene.name
                val tally = hits.getOrPut(key) { IntArray(3) }
                tally[0]++
                if (woke) tally[1]++
                if (checked != null) tally[2]++
                if (positive != woke)
                    report.appendLine("${if (positive) "MISS" else "FALSE"} ${scene.name} ${file.nameWithoutExtension} «$phrase» open=${checked ?: "(el detector no disparó)"}")
            }
            if (n % 25 == 0) Log.i(TAG, "bench $n/${files.size}")
        }
        val summary = hits.toSortedMap().entries.joinToString("\n") { (k, v) ->
            String.format(Locale.ROOT, "%-14s %4d/%4d activaciones (%.0f%%) · el detector disparó %d", k, v[1], v[0], 100.0 * v[1] / v[0], v[2])
        }
        val median = checkMs.sorted().getOrNull(checkMs.size / 2) ?: 0L
        File(folder(context), "result.txt").writeText(summary + "\nsegunda comprobación: mediana $median ms\n\n" + report)
        model.close()
        Log.i(TAG, "bench run done\n$summary")
    }

    companion object {
        private const val TAG = "MURMURBENCH"
        private val POSITIVES = listOf("Ok murmur", "Okey murmur", "Ok, murmur", "Okay murmur")
        private val NEGATIVES = listOf(
            "Ok", "Ok Google", "Okey mamá, ya voy", "Ok, muy bien, nos vemos", "O qué más da", "El murmullo del agua",
            "Lo que murmuran de mí", "Ok, me muero de hambre", "Porque murieron todos", "Oye, ¿qué murmuras?",
            "Ok, mira, mañana lo vemos", "Okey, muchas gracias", "Hay un murmullo en la sala", "O que mal me siento",
            "Ok, un momento por favor", "Murmur", "Okey Mauro, pásame eso", "Ok amor, te marco al rato",
            "Con mucho amor y mucho humor", "Pon la música más fuerte", "Ok, Marmolejo llegó temprano",
            "No sé cómo pudo ocurrir", "O quién sabe dónde estará", "Okey, mucho muro y poco techo",
            "Todo lo que murmura la gente", "Ok, mi amor", "Okey, mejor mañana", "Ok, ahorita voy para allá",
            "Okay, nos vemos en el mercado", "Okey mijo, a dormir", "¿Cómo que no? Mira nada más", "Ok, mortal combat",
            "El río murmura entre las piedras", "Okey, muévete tantito", "Ok, murió la batería", "Aunque mamá no quiera",
            "Yo creo que mañana llueve mucho", "Pásame el control, por favor", "Ok, número cuatro", "Oye Mario, ven a comer",
        )
    }
}
