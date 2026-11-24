package com.personal.murmur
import android.app.Activity
import android.app.PictureInPictureParams
import android.os.Bundle
import android.util.Rational
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import androidx.media3.common.MediaItem
import kotlinx.coroutines.*
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class VideoActivity : Activity() {
    private var player: ExoPlayer? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    override fun onCreate(savedInstanceState: Bundle?) { super.onCreate(savedInstanceState); val view = PlayerView(this); setContentView(view); HybridMediaService.instance?.primaryPlayer?.pause(); scope.launch { try { val info = withContext(Dispatchers.IO) { NativeNetwork.extract(intent.getStringExtra("videoId") ?: "") }; val stream = info.videoStreams.filter { it.isUrl }.maxByOrNull { it.resolution.filter(Char::isDigit).toIntOrNull() ?: 0 } ?: error("Este video no ofrece formato compatible con audio"); player = ExoPlayer.Builder(this@VideoActivity).build().also { view.player = it; it.setMediaItem(MediaItem.fromUri(stream.content)); it.prepare(); it.play() } } catch (e: Exception) { android.widget.Toast.makeText(this@VideoActivity, e.message, android.widget.Toast.LENGTH_LONG).show(); finish() } } }
    override fun onUserLeaveHint() { if (packageManager.hasSystemFeature(android.content.pm.PackageManager.FEATURE_PICTURE_IN_PICTURE)) enterPictureInPictureMode(PictureInPictureParams.Builder().setAspectRatio(Rational(16, 9)).build()) }
    override fun onStop() { super.onStop(); if (!isInPictureInPictureMode) player?.pause() }
    override fun onDestroy() { scope.cancel(); player?.release(); super.onDestroy() }
}
