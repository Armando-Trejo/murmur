package com.personal.murmur.spotify

import android.content.Context
import androidx.annotation.Keep

/** ABI matched to native/spotify/src/ffi.rs, adapted from Square 139441f. */
@Keep
object SpotifyNative {
    init { System.loadLibrary("murmurspotify") }
    external fun nativeInitContext(context: Context)
    external fun nativeSetAudioOutput(output: Any)
    external fun nativeStart(clientId: String, deviceName: String, deviceId: String, accessToken: String, credentialsDir: String, cacheDir: String, language: String, bitrateKbps: Int, crossfadeMs: Int, listener: Any)
    external fun nativeLoadQueue(uris: String, index: Int, playing: Boolean, positionMs: Int, contextUri: String, asContext: Boolean)
    external fun nativePlay()
    external fun nativePause()
    external fun nativeStop()
    external fun nativeSeek(positionMs: Long)
    external fun nativeIsConnected(): Boolean
    external fun nativeShutdown()
}
