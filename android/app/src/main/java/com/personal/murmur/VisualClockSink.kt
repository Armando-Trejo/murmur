package com.personal.murmur

import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.ForwardingAudioSink
import java.nio.ByteBuffer

/**
 * Lets the visualizer know which tapped sample is leaving the speaker: the sink reports the
 * presentation time of each buffer (anchoring the tap's sample index) and its audible position,
 * which already accounts for the AudioTrack buffer and output latency. Playback thread only.
 */
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
internal class VisualClockSink(sink: AudioSink, private val tap: VisualPcmTap) : ForwardingAudioSink(sink) {
    override fun handleBuffer(buffer: ByteBuffer, presentationTimeUs: Long, encodedAccessUnitCount: Int): Boolean {
        tap.handledPresentationUs = presentationTimeUs
        return super.handleBuffer(buffer, presentationTimeUs, encodedAccessUnitCount)
    }

    override fun getCurrentPositionUs(sourceEnded: Boolean): Long {
        val position = super.getCurrentPositionUs(sourceEnded)
        if (position != AudioSink.CURRENT_POSITION_NOT_SET) tap.publishMediaPosition(position, System.nanoTime())
        return position
    }

    override fun flush() {
        super.flush()
        tap.discontinuity()
    }
}
