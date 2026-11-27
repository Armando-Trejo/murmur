package com.personal.murmur

import android.content.Context

/** "Pantalla musical al bloquear": on by default, switchable from Opciones › Apariencia. */
object LockVisualizer {
    private const val KEY = "lock_visualizer"
    fun enabled(context: Context) = context.getSharedPreferences("playback", 0).getBoolean(KEY, true)
    fun set(context: Context, value: Boolean) = context.getSharedPreferences("playback", 0).edit().putBoolean(KEY, value).apply()
}

/**
 * "Bloquear la barra en la pantalla musical": off by default. In a pocket the screen can wake and a
 * touch would move the song; locked, the bar only shows progress (back, play and next still work).
 */
object VisualSeekLock {
    private const val KEY = "visual_seek_locked"
    fun locked(context: Context) = context.getSharedPreferences("playback", 0).getBoolean(KEY, false)
    fun set(context: Context, value: Boolean) = context.getSharedPreferences("playback", 0).edit().putBoolean(KEY, value).apply()
}
