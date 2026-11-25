package com.personal.murmur

import android.content.Context
import android.media.AudioAttributes
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import org.json.JSONObject
import java.io.File
import java.util.Locale

/**
 * MURMUR's voice: short spoken answers to voice commands ("En pausa") and, when the presenter is on,
 * a friendly radio-style line as each new song starts. The presenter can be a woman, a man or both
 * taking turns ("Dúo"); engines don't label voices by gender, so each voice's pitch is measured once
 * (VoiceGender). The music dips under the voice (HybridMediaService.setTalkOver) and comes back after.
 */
object SpokenReplies {
    private const val PREFS = "playback"
    private const val PRESENTER = "presenter"
    private const val HOST = "presenter_host"
    private const val REPLIES = "spoken_replies"
    private const val VOICE = "tts_voice"
    private const val GENDER = "tts_gender:"
    /** Google's engine has the most natural (neural) Spanish voices; the phone's default is the fallback. */
    private const val GOOGLE_TTS = "com.google.android.tts"
    private val main = Handler(Looper.getMainLooper())
    private val pendingVoices = mutableListOf<() -> Unit>()
    private var tts: TextToSpeech? = null
    private var ready = false
    private val waiting = ArrayDeque<Pair<String, String?>>()
    /** Lines still being spoken (by utterance id): the music stays dipped while any is. */
    private val speaking = mutableSetOf<String>()
    private val restore = Runnable { speaking.clear(); HybridMediaService.instance?.setTalkOver(false) }
    private var lastAnnounced = ""
    private var lastAnnouncedAt = 0L
    private var announcements = 0
    /** Songs since the presenter last talked (starts high so the first song is presented). */
    private var sinceTalk = 99
    private var lastMood = ""
    /** Voices whose pitch is being measured: utterance id → speaker. */
    private val probes = mutableMapOf<String, String>()
    private val afterProbes = mutableListOf<() -> Unit>()

    fun chosenVoice(context: Context): String? = context.getSharedPreferences(PREFS, 0).getString(VOICE, null)
    fun setVoice(context: Context, name: String?) {
        context.getSharedPreferences(PREFS, 0).edit().putString(VOICE, name).apply()
    }
    /** "duo" (a woman and a man take turns, default), "mujer" or "hombre". */
    fun host(context: Context) = context.getSharedPreferences(PREFS, 0).getString(HOST, "duo") ?: "duo"
    fun setHost(context: Context, value: String) =
        context.getSharedPreferences(PREFS, 0).edit().putString(HOST, value.takeIf { it in setOf("duo", VoiceGender.FEMALE, VoiceGender.MALE) } ?: "duo").apply()
    /** How often the presenter talks: every song (1), every 3 or every 5 (blocks). */
    fun every(context: Context) = context.getSharedPreferences(PREFS, 0).getInt("presenter_every", 1).let { if (it in setOf(1, 3, 5)) it else 1 }
    fun setEvery(context: Context, value: Int) = context.getSharedPreferences(PREFS, 0).edit().putInt("presenter_every", value).apply()
    /** In blocks, the endless queue changes mood every block (the app reads this; the presenter names the mood). */
    fun moodsEnabled(context: Context) = context.getSharedPreferences(PREFS, 0).getBoolean("presenter_moods", true)
    fun setMoods(context: Context, value: Boolean) = context.getSharedPreferences(PREFS, 0).edit().putBoolean("presenter_moods", value).apply()

    private fun gender(context: Context, voiceName: String) =
        context.getSharedPreferences(PREFS, 0).getString(GENDER + VoiceGender.speaker(voiceName), null)

    /** Spanish voices of the engine in use, best first, labelled with gender, for the picker in Ajustes. */
    fun voices(context: Context, done: (List<JSONObject>) -> Unit) {
        main.post {
            val engine = tts ?: create(context.applicationContext)
            val build = {
                val chosen = chosenVoice(context) ?: engine.voice?.name
                val ranked = SpeakerVoices.rank(options(engine), online(context))
                ranked.mapIndexed { index, option ->
                    val g = gender(context, option.name)
                    JSONObject().put("name", option.name).put("label", SpeakerVoices.label(option, index, g))
                        .put("gender", g ?: "").put("network", option.network).put("selected", option.name == chosen)
                }
            }
            whenReady { measureGenders(context) { done(build()) } }
        }
    }

    private fun whenReady(action: () -> Unit) { if (ready) action() else pendingVoices.add(action) }

    private fun options(engine: TextToSpeech) = runCatching { engine.voices.orEmpty() }.getOrDefault(emptySet()).map {
        SpeakerVoices.Option(it.name, it.locale.language, it.locale.country, it.quality, it.isNetworkConnectionRequired,
            it.features?.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED) == true)
    }

    private fun online(context: Context) = runCatching {
        val cm = context.getSystemService(android.net.ConnectivityManager::class.java)
        cm.getNetworkCapabilities(cm.activeNetwork)?.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true
    }.getOrDefault(false)

    /**
     * Measures the pitch of every Spanish speaker not measured yet: a short line synthesized to a
     * file with its offline voice (no network needed), analysed, remembered. Runs once per phone.
     */
    private fun measureGenders(context: Context, then: () -> Unit) {
        val engine = tts ?: return then()
        val all = runCatching { engine.voices.orEmpty() }.getOrDefault(emptySet())
            .filter { it.locale.language == "es" && it.features?.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED) != true }
        val pending = all.groupBy { VoiceGender.speaker(it.name) }
            .filter { (speaker, _) -> gender(context, speaker) == null && speaker !in probes.values }
            .mapValues { (_, voices) -> voices.firstOrNull { !it.isNetworkConnectionRequired } ?: voices.first() }
        if (pending.isEmpty() && probes.isEmpty()) return then()
        afterProbes.add(then)
        val restore = engine.voice
        for ((speaker, voice) in pending) {
            val id = "probe-" + System.nanoTime()
            probes[id] = speaker
            runCatching { engine.voice = voice }
            val file = File(context.cacheDir, "tts-probe-$speaker.wav")
            if (engine.synthesizeToFile("Hola, qué gusto saludarte. Aquí va la siguiente canción.", Bundle(), file, id) != TextToSpeech.SUCCESS)
                probes.remove(id)
        }
        restore?.let { runCatching { engine.voice = it } }
        if (probes.isEmpty()) flushProbes()
        // Never leave the picker waiting if the engine stays silent.
        main.postDelayed({ if (probes.isNotEmpty()) { probes.clear(); flushProbes() } }, 8_000)
    }

    private fun probeDone(context: Context, id: String) {
        main.post {
            val speaker = probes.remove(id) ?: return@post
            val file = File(context.cacheDir, "tts-probe-$speaker.wav")
            val g = runCatching { VoiceGender.readWav(file.readBytes())?.let { (samples, rate) -> VoiceGender.classify(VoiceGender.pitch(samples, rate)) } }.getOrNull()
            file.delete()
            if (g != null) context.getSharedPreferences(PREFS, 0).edit().putString(GENDER + speaker, g).apply()
            if (probes.isEmpty()) flushProbes()
        }
    }

    private fun flushProbes() { val list = afterProbes.toList(); afterProbes.clear(); list.forEach { it() } }

    /** The best voice of a gender (neural when online), else the best voice at all. */
    private fun voiceFor(context: Context, engine: TextToSpeech, wanted: String?): Voice? {
        val all = runCatching { engine.voices.orEmpty() }.getOrDefault(emptySet())
        val ranked = SpeakerVoices.rank(options(engine), online(context)).mapNotNull { o -> all.firstOrNull { it.name == o.name } }
        if (wanted == null) return chosenVoice(context)?.let { name -> all.firstOrNull { it.name == name } } ?: ranked.firstOrNull()
        return ranked.firstOrNull { gender(context, it.name) == wanted }
            ?: chosenVoice(context)?.let { name -> all.firstOrNull { it.name == name } } ?: ranked.firstOrNull()
    }

    fun presenterEnabled(context: Context) = context.getSharedPreferences(PREFS, 0).getBoolean(PRESENTER, false)
    fun setPresenter(context: Context, value: Boolean) = context.getSharedPreferences(PREFS, 0).edit().putBoolean(PRESENTER, value).apply()
    fun repliesEnabled(context: Context) = context.getSharedPreferences(PREFS, 0).getBoolean(REPLIES, true)
    fun setReplies(context: Context, value: Boolean) = context.getSharedPreferences(PREFS, 0).edit().putBoolean(REPLIES, value).apply()

    /** Speaks [text] now with the chosen voice (replacing anything still queued: answers must be current). */
    fun speak(context: Context, text: String) = speakAs(context, text, null)

    /** A sample of a gender's voice ("mujer" / "hombre"), for the presenter picker. */
    fun sample(context: Context, gender: String) {
        val line = if (gender == VoiceGender.MALE) "¡Qué tal! Soy tu locutor. Aquí va Afuera, de Caifanes."
        else "¡Hola! Soy tu locutora. Aquí va Bailarina, de Miranda."
        speakAs(context, line, gender)
    }

    private fun speakAs(context: Context, text: String, gender: String?) {
        val line = SpokenLines.clean(text)
        if (line.isBlank()) return
        main.post {
            val engine = tts ?: create(context.applicationContext)
            if (!ready) { waiting.clear(); waiting.addLast(line to gender); return@post }
            measureGenders(context) { say(context, engine, line, gender) }
        }
    }

    /** Presenter: announce a song that just started, at most once per song and never twice in 20 s. */
    fun announce(context: Context, track: JSONObject?) {
        if (track == null || !presenterEnabled(context)) return
        val identity = track.optString("queueId").ifBlank { track.optString("id") }
        val now = android.os.SystemClock.elapsedRealtime()
        if (identity.isBlank() || identity == lastAnnounced || now - lastAnnouncedAt < 20_000) return
        lastAnnounced = identity; lastAnnouncedAt = now
        // A new mood is always presented; otherwise only every N songs.
        val mood = track.optString("mood").trim()
        val moodChanged = mood.isNotEmpty() && mood != lastMood
        if (mood.isNotEmpty()) lastMood = mood
        val every = every(context)
        sinceTalk++
        if (!moodChanged && sinceTalk < every) return
        sinceTalk = 0
        val turn = announcements++
        val host = when (host(context)) { VoiceGender.MALE -> VoiceGender.MALE; VoiceGender.FEMALE -> VoiceGender.FEMALE
            else -> if (turn % 2 == 0) VoiceGender.FEMALE else VoiceGender.MALE }
        val hour = java.util.Calendar.getInstance().get(java.util.Calendar.HOUR_OF_DAY)
        val seed = (now / 1000).toInt()
        val title = track.optString("title"); val artist = track.optString("artist")
        val line = when {
            moodChanged -> SpokenLines.mood(title, artist, mood, seed)
            every > 1 -> SpokenLines.block(title, artist, seed, hour, turn)
            else -> SpokenLines.radio(title, artist, seed, hour, turn)
        }
        if (line.isNotBlank()) speakAs(context, line, host)
    }

    private fun create(context: Context): TextToSpeech {
        val google = runCatching { context.packageManager.getPackageInfo(GOOGLE_TTS, 0); true }.getOrDefault(false)
        val listener = TextToSpeech.OnInitListener { status ->
            main.post {
                val current = tts ?: return@post
                if (status != TextToSpeech.SUCCESS) { tts = null; current.shutdown(); waiting.clear(); return@post }
                val spanish = listOf(Locale("es", "MX"), Locale("es", "US"), Locale("es", "ES"), Locale("es"))
                    .firstOrNull { current.isLanguageAvailable(it) >= TextToSpeech.LANG_AVAILABLE }
                if (spanish == null) { waiting.clear(); return@post }
                current.language = spanish
                current.setAudioAttributes(AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ASSISTANT)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                current.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                    override fun onStart(utteranceId: String?) {}
                    override fun onDone(utteranceId: String?) = done(context, utteranceId)
                    // A line cut off by the next one (QUEUE_FLUSH) ends here, not in onDone.
                    override fun onStop(utteranceId: String?, interrupted: Boolean) = done(context, utteranceId)
                    @Deprecated("Android API") override fun onError(utteranceId: String?) = done(context, utteranceId)
                    override fun onError(utteranceId: String?, errorCode: Int) = done(context, utteranceId)
                })
                ready = true
                val queued = waiting.toList(); waiting.clear()
                measureGenders(context) { queued.forEach { (line, g) -> say(context, current, line, g) } }
                pendingVoices.toList().forEach { it() }; pendingVoices.clear()
            }
        }
        val engine = if (google) TextToSpeech(context, listener, GOOGLE_TTS) else TextToSpeech(context, listener)
        tts = engine
        return engine
    }

    private fun done(context: Context, id: String?) {
        if (id != null && id.startsWith("probe-")) probeDone(context, id) else finished(id)
    }

    private fun say(context: Context, engine: TextToSpeech, line: String, gender: String?) {
        val voice = voiceFor(context, engine, gender)
        voice?.let { runCatching { engine.voice = it } }
        // A touch warmer and livelier than the engine's flat default; a little lower for a man's voice.
        val actual = voice?.let { gender(context, it.name) }
        engine.setSpeechRate(1.04f)
        engine.setPitch(if (actual == VoiceGender.MALE) 0.97f else 1.03f)
        if (android.util.Log.isLoggable(DEBUG_TAG, android.util.Log.DEBUG))
            android.util.Log.d(DEBUG_TAG, "speak voice=${voice?.name} gender=$actual wanted=$gender")
        // The music dips under the voice and comes back when it ends.
        val id = "murmur-" + System.nanoTime()
        // QUEUE_FLUSH drops whatever was still speaking: only this line holds the music down now.
        speaking.clear(); speaking += id
        HybridMediaService.instance?.setTalkOver(true)
        // Safety net: if the engine never reports the end, the music comes back anyway.
        main.removeCallbacks(restore)
        main.postDelayed(restore, 4_000L + line.length * 90L)
        val result = engine.speak(line, TextToSpeech.QUEUE_FLUSH, Bundle(), id)
        if (result != TextToSpeech.SUCCESS) finished(id)
    }

    private fun finished(id: String?) {
        main.post {
            if (id != null) speaking.remove(id) else speaking.clear()
            if (speaking.isEmpty()) { main.removeCallbacks(restore); HybridMediaService.instance?.setTalkOver(false) }
        }
    }
}

/** What MURMUR says, as plain functions (JVM-testable). */
object SpokenLines {
    /** Notices are written for the screen: drop quotes' styling, symbols and anything after a long first sentence. */
    fun clean(text: String): String {
        val plain = text.replace(Regex("[«»\"“”]"), "").replace(Regex("[*_#>|]"), " ").replace(Regex("\\s+"), " ").trim()
        if (plain.length <= 160) return plain
        val cut = plain.take(160)
        val end = cut.lastIndexOfAny(charArrayOf('.', '!', '?'))
        return if (end > 40) cut.take(end + 1) else cut.substringBeforeLast(' ') + "…"
    }

    /** Plain announcement (kept for short contexts): "Ahora suena X, de Y." */
    fun announcement(title: String, artist: String, seed: Int): String {
        val (song, who) = parts(title, artist) ?: return ""
        if (who.isBlank()) return "Ahora suena $song."
        val lines = listOf(
            "Ahora suena $song, de $who.",
            "Con ustedes, $who: $song.",
            "Sigue $song, de $who.",
            "Esto es $who, con $song.",
        )
        return end(lines[Math.floorMod(seed, lines.size)])
    }

    /**
     * Friendly radio host lines, varied so it never sounds like a list: sometimes a greeting for the
     * time of day, sometimes a small comment. Short (one breath) so the song keeps the spotlight.
     */
    fun radio(title: String, artist: String, seed: Int, hour: Int, turn: Int): String {
        val (song, who) = parts(title, artist) ?: return ""
        if (who.isBlank()) return end(listOf("Aquí va $song.", "Ahora suena $song.", "Sigue $song, disfrútala.")[Math.floorMod(seed, 3)])
        val lines = listOf(
            "Ahora suena $song, de $who.",
            "¡Qué tal! Aquí va $who con $song.",
            "Seguimos con $song, de $who. Disfrútala.",
            "Esta me encanta: $song, de $who.",
            "Súbele tantito, que viene $who con $song.",
            "Para seguir con buena vibra: $song, de $who.",
            "Con ustedes, $who, con $song.",
            "Aquí está $song, de $who. ¡Que la disfrutes!",
            "No te muevas, que sigue $who con $song.",
            "Va para ti: $song, de $who.",
        )
        val line = end(lines[Math.floorMod(seed, lines.size)])
        // Every few songs, a greeting for the time of day in front.
        val greeting = when (hour) { in 5..11 -> "Buenos días."; in 12..18 -> "Buenas tardes."; else -> "Buenas noches." }
        return if (turn % 6 == 0) "$greeting $line" else line
    }

    /** The first song of a new mood ("algo alegre"): the presenter names the change. */
    fun mood(title: String, artist: String, mood: String, seed: Int): String {
        val (song, who) = parts(title, artist) ?: return ""
        val by = if (who.isBlank()) song else "$song, de $who"
        val lines = listOf(
            "Cambiamos de ambiente: ahora, $mood. Arrancamos con $by.",
            "Le damos un giro: viene $mood. Abrimos con $by.",
            "Va un bloque con $mood, para ti. Empieza $by.",
            "¿Qué tal $mood? Para empezar: $by.",
        )
        return end(lines[Math.floorMod(seed, lines.size)])
    }

    /** The presenter only between blocks of songs: a little more of a host's welcome. */
    fun block(title: String, artist: String, seed: Int, hour: Int, turn: Int): String {
        val (song, who) = parts(title, artist) ?: return ""
        val by = if (who.isBlank()) song else "$song, de $who"
        val lines = listOf(
            "Aquí seguimos contigo. Arranca otro bloque con $by.",
            "Nuevo bloque, la misma buena vibra: $by.",
            "Gracias por quedarte. Lo que viene empieza con $by.",
            "Seguimos con la música. Para abrir este bloque: $by.",
        )
        val line = end(lines[Math.floorMod(seed, lines.size)])
        val greeting = when (hour) { in 5..11 -> "Buenos días."; in 12..18 -> "Buenas tardes."; else -> "Buenas noches." }
        return if (turn % 3 == 0) "$greeting $line" else line
    }

    private fun parts(title: String, artist: String): Pair<String, String>? {
        val song = cleanTitle(title)
        if (song.isBlank()) return null
        val who = artist.split(Regex(",|&| feat\\.? | ft\\.? | x ", RegexOption.IGNORE_CASE)).firstOrNull()?.trim().orEmpty()
        return song to who
    }

    /** No doubled punctuation when a name already ends in "!" or "?" ("Miranda!."). */
    private fun end(line: String) = line.replace(Regex("([!?])\\."), "$1")

    /** "Bailarina (Official Video) [Remastered 2011]" → "Bailarina". */
    fun cleanTitle(title: String) = title
        .replace(Regex("\\s*[\\(\\[][^\\)\\]]*(official|oficial|video|audio|lyric|letra|remaster|live|en vivo|hd|4k|visualizer)[^\\)\\]]*[\\)\\]]", RegexOption.IGNORE_CASE), "")
        .replace(Regex("\\s+-\\s+(official|oficial).*$", RegexOption.IGNORE_CASE), "")
        .trim()
}
