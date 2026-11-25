package com.personal.murmur

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import java.util.concurrent.Executors
import kotlin.math.*

/**
 * "Te escucho": a soft two-note beep (rising, like a phone assistant's) and a short tap of
 * vibration the moment MURMUR starts listening. Quiet on purpose; it never changes a system volume.
 */
object ListeningCue {
    const val SAMPLE_RATE = 44_100
    /** Two notes, low then high: A5 then D6. */
    val NOTES_HZ = intArrayOf(880, 1175)
    const val NOTE_MS = 75
    const val RAMP_MS = 10
    /** ~ -23 dBFS: heard next to the phone, not across the room. */
    const val LEVEL = 0.07
    const val VIBRATION_MS = 35L
    private val worker = Executors.newSingleThreadExecutor { task -> Thread(task, "murmur-feedback").apply { isDaemon = true } }

    fun synthesize(): ShortArray {
        val note = SAMPLE_RATE * NOTE_MS / 1000
        val ramp = SAMPLE_RATE * RAMP_MS / 1000
        return ShortArray(note * NOTES_HZ.size) { i ->
            val at = i % note
            val hz = NOTES_HZ[i / note]
            val distance = min(at, note - 1 - at)
            val envelope = if (distance < ramp) 0.5 - 0.5 * cos(PI * distance / ramp) else 1.0
            (Short.MAX_VALUE * LEVEL * envelope * sin(2 * PI * hz * at / SAMPLE_RATE)).roundToInt().toShort()
        }
    }

    fun play(context: Context) {
        vibrate(context)
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
                val deadline = android.os.SystemClock.elapsedRealtime() + NOTE_MS * NOTES_HZ.size + 200L
                while (track.playbackHeadPosition < samples.size && android.os.SystemClock.elapsedRealtime() < deadline) Thread.sleep(10)
            } catch (_: Exception) {
                // A missing output must not prevent voice capture or leave playback ducked.
            } finally { runCatching { track?.stop() }; track?.release() }
        }
    }

    private fun vibrate(context: Context) = runCatching {
        val vibrator = if (Build.VERSION.SDK_INT >= 31) context.getSystemService(VibratorManager::class.java)?.defaultVibrator
            else @Suppress("DEPRECATION") context.getSystemService(Vibrator::class.java)
        if (vibrator?.hasVibrator() != true) return@runCatching
        val amplitude = if (vibrator.hasAmplitudeControl()) 90 else VibrationEffect.DEFAULT_AMPLITUDE
        vibrator.vibrate(VibrationEffect.createOneShot(VIBRATION_MS, amplitude))
    }
}
