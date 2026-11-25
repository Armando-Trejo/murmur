package com.personal.murmur

import android.app.Activity
import com.spotify.android.appremote.api.ConnectionParams
import com.spotify.android.appremote.api.Connector
import com.spotify.android.appremote.api.SpotifyAppRemote
import com.spotify.protocol.client.CallResult
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.CancellableContinuation
import kotlinx.coroutines.CancellationException
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** Official Spotify IPC wakes the installed player; audio stays in Spotify. Main thread only. */
class SpotifyRemotePlayer(
    private val activity: Activity,
    private val installed: (Activity) -> Boolean = { SpotifyAppRemote.isSpotifyInstalled(it) },
    private val connector: (Activity, ConnectionParams, Connector.ConnectionListener) -> Unit = { a,p,l -> SpotifyAppRemote.connect(a,p,l) },
    private val release: (SpotifyAppRemote) -> Unit = { SpotifyAppRemote.disconnect(it) }
) {
    private var remote: SpotifyAppRemote? = null
    @Volatile private var generation = 0
    private val pendingCalls = java.util.Collections.synchronizedSet(mutableSetOf<CancellableContinuation<*>>())
    val connected get() = remote?.isConnected == true
    private suspend fun connect(clientId: String): SpotifyAppRemote {
        remote?.takeIf { it.isConnected }?.let { return it }
        if (!installed(activity)) throw ProviderFailure("SPOTIFY_APP_NOT_INSTALLED",404,"spotify","playback","Instala Spotify e inicia sesión para usar su reproducción oficial.")
        val ticket = generation
        return try { withTimeout(20000) { suspendCancellableCoroutine { pending ->
            pendingCalls.add(pending); pending.invokeOnCancellation { pendingCalls.remove(pending) }
            val params = ConnectionParams.Builder(clientId).setRedirectUri("http://127.0.0.1:43821/callback").showAuthView(true).build()
            connector(activity,params,object : Connector.ConnectionListener {
                override fun onConnected(value: SpotifyAppRemote) {
                    pendingCalls.remove(pending)
                    if (pending.isActive && ticket == generation) { remote = value; pending.resume(value) }
                    else release(value)
                }
                override fun onFailure(error: Throwable) {
                    pendingCalls.remove(pending)
                    if (pending.isActive) pending.resumeWithException(ProviderFailure("SPOTIFY_REMOTE_AUTH_REQUIRED",403,"spotify","playback","Spotify no permitió activar su reproductor. Comprueba Android, paquete y huella de firma en Spotify for Developers (datos en Opciones (⋯) → Configuración de Spotify). También puedes abrir Spotify y reintentar con Connect."))
                }
            })
        } } } catch (_: TimeoutCancellationException) { throw ProviderFailure("SPOTIFY_REMOTE_TIMEOUT",408,"spotify","playback","Spotify no respondió al iniciar su reproductor. Revisa que tenga sesión iniciada y vuelve a intentarlo.") }
    }
    private suspend fun <T> result(call: CallResult<T>): T = withTimeout(12000) { suspendCancellableCoroutine { pending ->
        pendingCalls.add(pending); pending.invokeOnCancellation { pendingCalls.remove(pending) }
        call.setResultCallback { value -> pendingCalls.remove(pending); if (pending.isActive) pending.resume(value) }
            .setErrorCallback { pendingCalls.remove(pending); if (pending.isActive) pending.resumeWithException(ProviderFailure("SPOTIFY_REMOTE_PLAYBACK_FAILED",403,"spotify","playback","Spotify rechazó la reproducción de esta canción. Comprueba la cuenta y vuelve a intentarlo.")) }
    } }
    suspend fun play(clientId: String, uri: String) { require(uri.matches(Regex("spotify:track:[A-Za-z0-9]{22}"))) { "Identificador de Spotify inválido" }; result(connect(clientId).playerApi.play(uri)) }
    suspend fun pause() { remote?.takeIf { it.isConnected }?.let { result(it.playerApi.pause()) } }
    suspend fun resume() { remote?.takeIf { it.isConnected }?.let { result(it.playerApi.resume()) } }
    suspend fun seek(position: Long) { remote?.takeIf { it.isConnected }?.let { result(it.playerApi.seekTo(position)) } }
    fun disconnect() {
        generation++
        val pending = synchronized(pendingCalls) { pendingCalls.toList().also { pendingCalls.clear() } }
        pending.forEach { it.cancel(CancellationException("Control de Spotify cancelado.")) }
        remote?.let { release(it) }; remote = null
    }
}
