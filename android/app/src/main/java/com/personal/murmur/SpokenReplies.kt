package com.personal.murmur

import android.content.Context
import android.media.AudioAttributes
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import org.json.JSONObject
import java.util.Locale

/**
 * MURMUR's voice: short spoken answers to voice commands ("En pausa") and, when the presenter is on,
 * a radio-style line as each new song starts ("Ahora suena «Bailarina», de Miranda!"). Uses the
 * phone's own text-to-speech in Mexican Spanish (offline when the voice pack is installed); the music
 * dips while it talks and comes back right after.
 */
object SpokenReplies {
    private const val PREFS = "playback"
    private const val PRESENTER = "presenter"
    private const val REPLIES = "spoken_replies"
    private val main = Handler(Looper.getMainLooper())
    private var tts: TextToSpeech? = null
    private var ready = false
    private val waiting = ArrayDeque<String>()
    private var speaking = 0
    private var lastAnnounced = ""
    private var lastAnnouncedAt = 0L

    fun presenterEnabled(context: Context) = context.getSharedPreferences(PREFS, 0).getBoolean(PRESENTER, false)
    fun setPresenter(context: Context, value: Boolean) = context.getSharedPreferences(PREFS, 0).edit().putBoolean(PRESENTER, value).apply()
    fun repliesEnabled(context: Context) = context.getSharedPreferences(PREFS, 0).getBoolean(REPLIES, true)
    fun setReplies(context: Context, value: Boolean) = context.getSharedPreferences(PREFS, 0).edit().putBoolean(REPLIES, value).apply()

    /** Speaks [text] now (replacing anything still queued: answers must be current, never a backlog). */
    fun speak(context: Context, text: String) {
        val line = SpokenLines.clean(text)
        if (line.isBlank()) return
        main.post {
            val engine = tts ?: create(context.applicationContext)
            if (!ready) { waiting.clear(); waiting.addLast(line); return@post }
            say(engine, line)
        }
    }

    /** Presenter: announce a song that just started, at most once per song and never twice in 20 s. */
    fun announce(context: Context, track: JSONObject?) {
        if (track == null || !presenterEnabled(context)) return
        val identity = track.optString("queueId").ifBlank { track.optString("id") }
        val now = android.os.SystemClock.elapsedRealtime()
        if (identity.isBlank() || identity == lastAnnounced || now - lastAnnouncedAt < 20_000) return
        lastAnnounced = identity; lastAnnouncedAt = now
        val line = SpokenLines.announcement(track.optString("title"), track.optString("artist"), (now / 1000).toInt())
        if (line.isNotBlank()) speak(context, line)
    }

    private fun create(context: Context): TextToSpeech {
        val engine = TextToSpeech(context) { status ->
            main.post {
                val current = tts ?: return@post
                if (status != TextToSpeech.SUCCESS) { tts = null; current.shutdown(); waiting.clear(); return@post }
                val spanish = listOf(Locale("es", "MX"), Locale("es", "US"), Locale("es", "ES"), Locale("es"))
                    .firstOrNull { current.isLanguageAvailable(it) >= TextToSpeech.LANG_AVAILABLE }
                if (spanish == null) { waiting.clear(); return@post }
                current.language = spanish
                current.setSpeechRate(1.04f)
                current.setAudioAttributes(AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ASSISTANT)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                current.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                    override fun onStart(utteranceId: String?) {}
                    override fun onDone(utteranceId: String?) = finished()
                    @Deprecated("Android API") override fun onError(utteranceId: String?) = finished()
                    override fun onError(utteranceId: String?, errorCode: Int) = finished()
                })
                ready = true
                while (waiting.isNotEmpty()) say(current, waiting.removeFirst())
            }
        }
        tts = engine
        return engine
    }

    private fun say(engine: TextToSpeech, line: String) {
        // The music dips under the voice (the same level used while MURMUR listens).
        if (speaking++ == 0) HybridMediaService.instance?.setDucking(true)
        val result = engine.speak(line, TextToSpeech.QUEUE_FLUSH, Bundle(), "murmur-" + System.nanoTime())
        if (result != TextToSpeech.SUCCESS) finished()
    }

    private fun finished() {
        main.post {
            speaking = (speaking - 1).coerceAtLeast(0)
            if (speaking == 0) HybridMediaService.instance?.setDucking(false)
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

    /** Radio-style lines, rotated so the presenter doesn't repeat itself. */
    fun announcement(title: String, artist: String, seed: Int): String {
        val song = cleanTitle(title)
        val who = artist.split(Regex(",|&| feat\\.? | ft\\.? | x ", RegexOption.IGNORE_CASE)).firstOrNull()?.trim().orEmpty()
        if (song.isBlank()) return ""
        if (who.isBlank()) return "Ahora suena $song."
        val lines = listOf(
            "Ahora suena $song, de $who.",
            "Con ustedes, $who: $song.",
            "Sigue $song, de $who.",
            "Esto es $who, con $song.",
        )
        return lines[Math.floorMod(seed, lines.size)]
    }

    /** "Bailarina (Official Video) [Remastered 2011]" → "Bailarina". */
    fun cleanTitle(title: String) = title
        .replace(Regex("\\s*[\\(\\[][^\\)\\]]*(official|oficial|video|audio|lyric|letra|remaster|live|en vivo|hd|4k|visualizer)[^\\)\\]]*[\\)\\]]", RegexOption.IGNORE_CASE), "")
        .replace(Regex("\\s+-\\s+(official|oficial).*$", RegexOption.IGNORE_CASE), "")
        .trim()
}
