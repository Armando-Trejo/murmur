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
    private const val KEY = "voice_hints"
    private val base = listOf("Spotify", "YouTube", "YouTube Music", "MURMUR", "álbum", "disco", "playlist", "siguiente", "pausa", "aleatorio", "rola")
    fun save(context: Context, hints: List<String>) =
        context.getSharedPreferences("playback", 0).edit().putString(KEY, hints.take(200).joinToString("\n")).apply()
    private fun load(context: Context) =
        context.getSharedPreferences("playback", 0).getString(KEY, "")!!.split("\n").filter { it.isNotBlank() }

    fun request(context: Context, preferOffline: Boolean): Intent {
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "es-MX")
            .putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, preferOffline)
            .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5)
            // Let people pause mid-sentence ("ponme… la de… Bailarina") without being cut off.
            .putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 1500L)
            .putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 1200L)
        if (Build.VERSION.SDK_INT >= 33) intent.putStringArrayListExtra(RecognizerIntent.EXTRA_BIASING_STRINGS, ArrayList((base + load(context)).distinct().take(250)))
        return intent
    }

    /** The recognizer's alternatives, best first, joined for the app (which picks the one it understands). */
    fun join(results: List<String>?): String? =
        results?.map { it.trim() }?.filter { it.isNotBlank() }?.distinct()?.take(5)?.joinToString("\n")?.takeIf { it.isNotBlank() }
}
