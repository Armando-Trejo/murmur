package com.personal.murmur

import android.content.Context

/** "Pantalla musical al bloquear": on by default, switchable from Opciones › Apariencia. */
object LockVisualizer {
    private const val KEY = "lock_visualizer"
    fun enabled(context: Context) = context.getSharedPreferences("playback", 0).getBoolean(KEY, true)
    fun set(context: Context, value: Boolean) = context.getSharedPreferences("playback", 0).edit().putBoolean(KEY, value).apply()
}
