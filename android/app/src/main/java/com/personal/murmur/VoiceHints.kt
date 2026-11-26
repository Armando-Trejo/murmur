package com.personal.murmur

import android.content.Context
import android.content.Intent
import android.os.Build
import android.speech.RecognizerIntent

/**
 * What MURMUR tells the speech recognizer before it listens: Mexican Spanish, free-form, up to five
 * alternatives, and (Android 13+) the words it should expect: platform names, commands and the
 * artists and playlists of the user's library, so "Spotify" or "Enjambre" are spelled right.
 * All alternatives travel to the app joined by new lines; the app keeps the first one it understands.
 */
object VoiceHints {
    /**
     * Online recognition understands song and artist names far better and uses the biasing list;
     * trying the offline engine first cost a failed attempt (1–2 s) whenever it lacked Spanish.
     * The phone's own recognizer is only used without internet.
     */
    fun preferOnDevice(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < 31 || !android.speech.SpeechRecognizer.isOnDeviceRecognitionAvailable(context)) return false
        val online = runCatching {
            val cm = context.getSystemService(android.net.ConnectivityManager::class.java)
            cm.getNetworkCapabilities(cm.activeNetwork)?.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true
        }.getOrDefault(true)
        return !online
    }
    private const val KEY = "voice_hints"
    /** Names the app may send: top artists, saved and most played songs, albums and playlists. */
    const val MAX_SAVED = 480
    /** Biasing strings handed to the recognizer in total (it ignores what it cannot use). */
    const val MAX_BIASING = 500
    private val base = listOf("Spotify", "YouTube", "YouTube Music", "MURMUR", "álbum", "disco", "playlist", "siguiente", "pausa", "aleatorio", "rola")
    fun save(context: Context, hints: List<String>) =
        context.getSharedPreferences("playback", 0).edit().putString(KEY, hints.take(MAX_SAVED).joinToString("\n")).apply()
    private fun load(context: Context) =
        context.getSharedPreferences("playback", 0).getString(KEY, "")!!.split("\n").filter { it.isNotBlank() }

    fun request(context: Context, preferOffline: Boolean): Intent {
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "es-MX")
            .putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, preferOffline)
            .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5)
            // Words appear in the voice panel while they are being said.
            .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            // Let people pause mid-sentence ("ponme… la de… Bailarina") without being cut off.
            .putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 1300L)
            .putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 1000L)
        if (Build.VERSION.SDK_INT >= 33) intent.putStringArrayListExtra(RecognizerIntent.EXTRA_BIASING_STRINGS, ArrayList(biasing(load(context))))
        return intent
    }

    /** Commands and platform names first, then the library's names, without repeats, at most MAX_BIASING. */
    fun biasing(saved: List<String>): List<String> =
        (base + saved.map { it.trim() }.filter { it.isNotBlank() }).distinct().take(MAX_BIASING)

    /** The recognizer's alternatives, best first, joined for the app (which picks the one it understands). */
    fun join(results: List<String>?): String? =
        results?.map { it.trim() }?.filter { it.isNotBlank() }?.distinct()?.take(5)?.joinToString("\n")?.takeIf { it.isNotBlank() }
}
