package com.personal.murmur

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import java.util.concurrent.Executors
import kotlin.math.*

/** MURMUR's confirmation pulse. Does not change any system stream volume. */
object SubBassFeedback {
    const val SAMPLE_RATE = 44_100
    const val FREQUENCY_HZ = 75
    const val DURATION_MS = 140
    const val RAMP_MS = 20
    private val worker = Executors.newSingleThreadExecutor { task -> Thread(task, "murmur-feedback").apply { isDaemon = true } }
    fun synthesize(): ShortArray {
        val length = SAMPLE_RATE * DURATION_MS / 1000
        val ramp = SAMPLE_RATE * RAMP_MS / 1000
        return ShortArray(length) { i ->
            val distance = min(i, length - 1 - i)
            val envelope = if (distance < ramp) 0.5 - 0.5 * cos(PI * distance / ramp) else 1.0
            (Short.MAX_VALUE * .22 * envelope * sin(2 * PI * FREQUENCY_HZ * i / SAMPLE_RATE)).roundToInt().toShort()
        }
    }
    fun play() {
        worker.execute {
            var track: AudioTrack? = null
            try {
                val samples = synthesize()
                track = AudioTrack.Builder()
                    .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
                    .setAudioFormat(AudioFormat.Builder().setSampleRate(SAMPLE_RATE).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).setEncoding(AudioFormat.ENCODING_PCM_16BIT).build())
                    .setTransferMode(AudioTrack.MODE_STATIC).setBufferSizeInBytes(samples.size * 2).build()
                if (track.state != AudioTrack.STATE_INITIALIZED) return@execute
                if (track.write(samples, 0, samples.size, AudioTrack.WRITE_BLOCKING) != samples.size) return@execute
                track.play()
                val deadline = android.os.SystemClock.elapsedRealtime() + DURATION_MS + 200L
                while (track.playbackHeadPosition < samples.size && android.os.SystemClock.elapsedRealtime() < deadline) Thread.sleep(10)
            } catch (_: Exception) {
                // A missing output must not prevent voice capture or leave playback ducked.
            } finally { runCatching { track?.stop() }; track?.release() }
        }
    }
}
