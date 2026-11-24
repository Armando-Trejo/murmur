package com.personal.murmur

import com.getcapacitor.JSObject
import android.os.Handler
import android.os.Looper

object NativeEvents {
    var plugin: YouTubeAudioPlugin? = null
    private val main = Handler(Looper.getMainLooper())
    private val pending = ArrayDeque<Pair<String, JSObject>>()
    private val retained = setOf("onSharedUrlReceived", "onVoiceCommandCaptured", "onVoiceError", "onShortcutReceived", "onAuthChanged", "onAuthError", "onSpotifyEngineAuthorized", "onOpenPlayer")
    fun attach(value: YouTubeAudioPlugin) { main.post {
        plugin = value
        while (pending.isNotEmpty()) { val (event, data) = pending.removeFirst(); value.emit(event, data) }
    } }
    fun emit(event: String, data: JSObject = JSObject()) { main.post {
        val current = plugin
        if (current != null) current.emit(event, data)
        else if (event in retained) { if (pending.size >= 8) pending.removeFirst(); pending.addLast(event to data) }
    } }
}
