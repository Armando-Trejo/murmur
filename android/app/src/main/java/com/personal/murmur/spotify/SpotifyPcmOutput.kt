package com.personal.murmur.spotify

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import androidx.annotation.Keep
import java.nio.ByteBuffer

/** Blocking native decoder output; lifecycle never holds a lock while waiting for write(). */
@Keep
class SpotifyPcmOutput(private val failure:(String)->Unit = {}) {
    @Volatile var amplitude=0f; private set
    private val lock = Any()
    @Volatile private var track: AudioTrack? = null
    @Volatile private var playing = false
    @Volatile private var enabled = false
    private val reported=java.util.concurrent.atomic.AtomicBoolean(false)
    @Volatile private var gain = 1f
    private var sampleRate = 0
    private var channels = 0
    private fun failed(){enabled=false;playing=false;if(reported.compareAndSet(false,true))failure("Android no pudo abrir la salida de audio del motor Spotify.")}
    fun enable(value:Boolean){enabled=value;if(value)reported.set(false);track?.let{runCatching{if(value&&playing)it.play()else{it.pause();it.flush()}}.onFailure{failed()}}}
    fun start() { playing = true; if(enabled)track?.let { runCatching { it.play() }.onFailure{failed()} } }
    fun stop() { playing = false; track?.let { runCatching { it.pause(); it.flush() } } }
    fun volume(value: Float) { gain = value.coerceIn(0f,1f); track?.let { runCatching { it.setVolume(gain) } } }
    fun release() { playing = false; synchronized(lock) { track?.let { runCatching { it.pause(); it.flush(); it.release() } }; track = null } }
    fun writeVoice(buffer: ByteBuffer, bytes: Int, rate: Int, count: Int) = write(buffer,bytes,rate,count)
    fun write(buffer: ByteBuffer, bytes: Int, rate: Int, count: Int) {
        try {writePcm(buffer,bytes,rate,count)}catch(_:Exception){failed()}
    }
    private fun writePcm(buffer: ByteBuffer, bytes: Int, rate: Int, count: Int) {
        if (bytes <= 0) return
        require(rate>0 && count in 1..2)
        val output = synchronized(lock) {
            if (track == null || sampleRate != rate || channels != count) {
                track?.let { runCatching { it.release() } }
                val mask = if (count == 1) AudioFormat.CHANNEL_OUT_MONO else AudioFormat.CHANNEL_OUT_STEREO
                val minimum = AudioTrack.getMinBufferSize(rate,mask,AudioFormat.ENCODING_PCM_16BIT)
                check(minimum > 0) { "Formato PCM no compatible" }
                sampleRate = rate; channels = count
                track = AudioTrack.Builder().setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
                    .setAudioFormat(AudioFormat.Builder().setSampleRate(rate).setChannelMask(mask).setEncoding(AudioFormat.ENCODING_PCM_16BIT).build())
                    .setBufferSizeInBytes(maxOf(minimum*4,rate*count*2/4)).setTransferMode(AudioTrack.MODE_STREAM).build().apply {
                        check(state == AudioTrack.STATE_INITIALIZED) { "No se pudo iniciar la salida de audio" }; setVolume(gain); if (playing && enabled) play()
                    }
            }
            track!!
        }
        if (!playing || !enabled) { Thread.sleep((bytes.toLong()*1000/(rate*count*2)).coerceAtMost(100)); return }
        val meter=buffer.duplicate().order(java.nio.ByteOrder.LITTLE_ENDIAN);meter.position(0)
        var energy=0.0;var samples=0;val end=minOf(bytes,meter.capacity())
        var at=0;while(at+1<end){val value=meter.getShort(at)/32768.0;energy+=value*value;samples++;at+=64}
        amplitude=if(samples>0)kotlin.math.sqrt(energy/samples).toFloat()else 0f
        val frame = buffer.duplicate().apply { position(0); limit(minOf(bytes,capacity())) }
        while (frame.hasRemaining() && playing && enabled && track === output) {
            val written = output.write(frame,frame.remaining(),AudioTrack.WRITE_BLOCKING)
            check(written >= 0) { "La salida PCM falló ($written)" }
            if (written == 0) Thread.yield()
        }
    }
}
