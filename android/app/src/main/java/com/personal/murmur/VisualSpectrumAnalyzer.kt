package com.personal.murmur

import java.nio.ByteBuffer
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.ln
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Lock-free single-producer / single-consumer PCM tap for the visualizer.
 *
 * The audio thread downmixes every buffer to mono into a ring and publishes the running frame count
 * with a volatile write; the UI thread copies the window that is audible *now* (the sink buffers
 * ~250 ms ahead of the speaker, so reading the newest samples would make beats flash early).
 * Nothing here allocates after the first buffer, and nothing is ever logged.
 */
class VisualPcmTap(capacity: Int = 1 shl 16) {
    private val size = capacity.also { require(it >= 1024 && it and (it - 1) == 0) }
    private val mask = (size - 1).toLong()
    @Volatile private var ring: FloatArray? = null
    /** Mono frames published so far (monotonic, never reset so indices stay comparable). */
    @Volatile var written = 0L
        private set
    @Volatile var sampleRate = 44_100
        private set
    @Volatile private var lastWriteNanos = 0L

    // Audible clock: (frame index heard at nanoTime), published by the producer through a seqlock.
    @Volatile private var clockSeq = 0
    @Volatile private var clockIndex = 0L
    @Volatile private var clockNanos = 0L

    // Media-time anchor, touched only on the playback thread (sink + processor share it).
    /** Presentation time of the buffer the sink is handling; set by [VisualClockSink]. */
    @JvmField internal var handledPresentationUs = TIME_UNSET
    private var anchorPending = true
    private var anchorValid = false
    private var anchorIndex = 0L
    private var anchorUs = 0L

    /**
     * Producer: downmixes [buffer] (position..limit, untouched) and returns its RMS over all channels.
     * Supports 8/16/24/32-bit integer and float little-endian PCM; other encodings return 0.
     */
    fun write(buffer: ByteBuffer, encoding: Int, channels: Int, rate: Int): Float {
        val bytes = when (encoding) {
            ENCODING_PCM_16BIT -> 2
            ENCODING_PCM_FLOAT, ENCODING_PCM_32BIT -> 4
            ENCODING_PCM_24BIT -> 3
            ENCODING_PCM_8BIT -> 1
            else -> return 0f
        }
        val count = channels.coerceAtLeast(1)
        val start = buffer.position()
        val frames = (buffer.limit() - start) / (bytes * count)
        if (frames <= 0 || rate <= 0) return 0f
        val target = ring ?: FloatArray(size).also { ring = it }
        if (rate != sampleRate) sampleRate = rate
        val base = written
        if (anchorPending && handledPresentationUs != TIME_UNSET) {
            anchorIndex = base
            anchorUs = handledPresentationUs
            anchorPending = false
            anchorValid = true
        }
        val scale = 1f / count
        var energy = 0.0
        var at = start
        if (encoding == ENCODING_PCM_16BIT) {
            for (frame in 0 until frames) {
                var mono = 0f
                for (channel in 0 until count) {
                    val value = ((buffer.get(at).toInt() and 0xFF) or (buffer.get(at + 1).toInt() shl 8)).toShort() / 32768f
                    at += 2
                    mono += value
                    energy += value * value
                }
                target[((base + frame) and mask).toInt()] = mono * scale
            }
        } else {
            for (frame in 0 until frames) {
                var mono = 0f
                for (channel in 0 until count) {
                    val value = sample(buffer, at, encoding)
                    at += bytes
                    mono += value
                    energy += value * value
                }
                target[((base + frame) and mask).toInt()] = mono * scale
            }
        }
        written = base + frames
        lastWriteNanos = System.nanoTime()
        return sqrt(energy / (frames * count)).toFloat()
    }

    /** Producer helper for already-decoded mono samples (tests, synthetic sources). */
    fun writeMono(samples: FloatArray, offset: Int, count: Int, rate: Int) {
        if (count <= 0 || rate <= 0) return
        val target = ring ?: FloatArray(size).also { ring = it }
        if (rate != sampleRate) sampleRate = rate
        val base = written
        for (i in 0 until count) target[((base + i) and mask).toInt()] = samples[offset + i]
        written = base + count
        lastWriteNanos = System.nanoTime()
    }

    private fun sample(buffer: ByteBuffer, at: Int, encoding: Int): Float = when (encoding) {
        ENCODING_PCM_FLOAT -> Float.fromBits(int32(buffer, at)).let { if (it.isNaN()) 0f else it.coerceIn(-4f, 4f) }
        ENCODING_PCM_32BIT -> int32(buffer, at) / 2147483648f
        ENCODING_PCM_24BIT -> ((buffer.get(at).toInt() and 0xFF) or ((buffer.get(at + 1).toInt() and 0xFF) shl 8) or
            (buffer.get(at + 2).toInt() shl 16)) / 8388608f
        else -> ((buffer.get(at).toInt() and 0xFF) - 128) / 128f
    }

    private fun int32(buffer: ByteBuffer, at: Int) = (buffer.get(at).toInt() and 0xFF) or
        ((buffer.get(at + 1).toInt() and 0xFF) shl 8) or ((buffer.get(at + 2).toInt() and 0xFF) shl 16) or
        (buffer.get(at + 3).toInt() shl 24)

    /** Producer: the stream jumped (seek, flush, new format); wait for the next presentation time. */
    fun discontinuity() {
        anchorPending = true
        anchorValid = false
    }

    /** Producer (playback thread): the sink reports the media time currently leaving the speaker. */
    fun publishMediaPosition(positionUs: Long, nowNanos: Long) {
        if (!anchorValid) return
        publishAudible(anchorIndex + (positionUs - anchorUs) * sampleRate / 1_000_000L, nowNanos)
    }

    /** Producer: frame [index] of this tap is audible at [nowNanos] (System.nanoTime clock). */
    fun publishAudible(index: Long, nowNanos: Long) {
        clockSeq += 1
        clockIndex = index
        clockNanos = nowNanos
        clockSeq += 1
    }

    /**
     * Consumer (UI thread): copies the [dest].size samples centred on what is audible at [nowNanos].
     * Returns false when the tap holds nothing fresh (paused, stalled or never written).
     */
    fun readAudible(dest: FloatArray, nowNanos: Long): Boolean {
        val source = ring ?: return false
        val total = written
        if (total <= 0L) return false
        val rate = sampleRate.toLong()
        var index = 0L
        var stamp = 0L
        for (attempt in 0 until 4) {
            val sequence = clockSeq
            if (sequence and 1 != 0) continue
            val candidate = clockIndex
            val time = clockNanos
            if (clockSeq == sequence) {
                index = candidate
                stamp = time
                break
            }
        }
        val audible = if (stamp != 0L) {
            val age = nowNanos - stamp
            if (age > STALE_NANOS) return false
            index + age.coerceIn(0L, EXTRAPOLATE_NANOS) * rate / 1_000_000_000L
        } else {
            if (nowNanos - lastWriteNanos > STALE_NANOS) return false
            total - rate / 4 // No clock yet: assume a typical 250 ms sink buffer.
        }
        val length = dest.size
        val end = min(audible + length / 2, total)
        val start = max(end - length, total - size + 1)
        for (i in 0 until length) {
            val at = start + i
            dest[i] = if (at < 0L || at >= total) 0f else source[(at and mask).toInt()]
        }
        return true
    }

    companion object {
        // Same values as android.media.AudioFormat / media3 C.ENCODING_* (kept local: those are API 31+ / unstable).
        const val ENCODING_PCM_16BIT = 2
        const val ENCODING_PCM_8BIT = 3
        const val ENCODING_PCM_FLOAT = 4
        const val ENCODING_PCM_24BIT = 21
        const val ENCODING_PCM_32BIT = 22
        internal const val TIME_UNSET = Long.MIN_VALUE + 1
        private const val STALE_NANOS = 350_000_000L
        private const val EXTRAPOLATE_NANOS = 120_000_000L
    }
}

/** One frame of visual analysis. The instance is reused by its analyzer; read it on the UI thread. */
class VisualSpectrum internal constructor(val bandCount: Int) {
    /** Smoothed, loudness-normalised band levels 0..1, log-spaced from low to high. */
    val bands = FloatArray(bandCount)
    /** Peak-hold levels 0..1 that wait, then fall with gravity (LED peak dots). */
    val peaks = FloatArray(bandCount)
    /** Centre frequency of each band in Hz. */
    val frequencies = FloatArray(bandCount)
    var bass = 0f; internal set
    var mid = 0f; internal set
    var high = 0f; internal set
    /** Overall loudness 0..1. */
    var level = 0f; internal set
    /** True only on the frame where a beat (bass onset) was detected. */
    var beat = false; internal set
    /** 0..1 strength of the most recent beat. */
    var beatStrength = 0f; internal set
    /** Increments on every beat, so a renderer that skips frames never misses one. */
    var beatCount = 0L; internal set
    /** 1 on a beat, decaying exponentially (~170 ms). */
    var pulse = 0f; internal set
    /** True when the last frame was computed from fresh audible audio. */
    var signal = false; internal set
}

/**
 * UI-thread spectrum analyzer: Hann window, radix-2 FFT, log-spaced bands with attack/release
 * smoothing and automatic gain, bass/mid/high energies and adaptive bass-onset beat detection.
 * Allocation-free per frame.
 */
class SpectrumAnalyzer(val fftSize: Int = 2048, bandCount: Int = 36) {
    init { require(fftSize >= 64 && fftSize and (fftSize - 1) == 0) { "fftSize must be a power of two" } }

    val spectrum = VisualSpectrum(bandCount)
    private val bandTotal = bandCount
    private val samples = FloatArray(fftSize)
    private val re = FloatArray(fftSize)
    private val im = FloatArray(fftSize)
    private val window = FloatArray(fftSize) { 0.5f - 0.5f * cos(2.0 * PI * it / fftSize).toFloat() }
    private val cosTable = FloatArray(fftSize / 2) { cos(2.0 * PI * it / fftSize).toFloat() }
    private val sinTable = FloatArray(fftSize / 2) { sin(2.0 * PI * it / fftSize).toFloat() }
    private val reversed = IntArray(fftSize).also { table ->
        val bits = Integer.numberOfTrailingZeros(fftSize)
        for (i in table.indices) table[i] = Integer.reverse(i) ushr (32 - bits)
    }
    private val power = FloatArray(fftSize / 2 + 1)
    private val bandLow = FloatArray(bandCount)
    private val bandHigh = FloatArray(bandCount)
    private val tilt = FloatArray(bandCount)
    private val group = IntArray(bandCount) // 0 bass, 1 mid, 2 high
    private val target = FloatArray(bandCount)
    private val holdUntil = DoubleArray(bandCount)
    private val fall = FloatArray(bandCount)
    private var rate = 0
    private var bassFrom = 1
    private var bassTo = 1
    private val groupSize = IntArray(3)
    private val groupSums = FloatArray(3)
    private var ceilingDb = -30f
    private var bassFast = Float.NaN
    private var riseMean = 0f
    private var riseVariance = 0f
    private var previousBass = -120f
    private var lastBeat = -10.0
    private var time = 0.0
    private var lastNanos = 0L

    /**
     * Advances one frame from [tap] at [nowNanos]. Calling twice with the same timestamp returns the
     * cached frame, so several views can share one analyzer.
     */
    fun update(tap: VisualPcmTap?, playing: Boolean, nowNanos: Long): VisualSpectrum {
        if (nowNanos == lastNanos) return spectrum
        val dt = if (lastNanos == 0L) 1f / 60f else ((nowNanos - lastNanos) / 1e9f).coerceIn(0f, .1f)
        lastNanos = nowNanos
        if (playing && tap != null && tap.readAudible(samples, nowNanos)) analyze(samples, tap.sampleRate, dt)
        else release(dt)
        return spectrum
    }

    /** Analyses [input] (fftSize mono samples, centred on "now") as one frame lasting [dt] seconds. */
    fun analyze(input: FloatArray, sampleRate: Int, dt: Float): VisualSpectrum {
        if (sampleRate != rate) configure(sampleRate)
        time += dt
        for (i in 0 until fftSize) {
            re[i] = input[i] * window[i]
            im[i] = 0f
        }
        transform()
        // |X| * 4 / N makes a full-scale sine read 1.0 (Hann coherent gain is 0.5).
        val normal = 16f / (fftSize.toFloat() * fftSize)
        for (k in 0..fftSize / 2) power[k] = (re[k] * re[k] + im[k] * im[k]) * normal

        var loudest = -120f
        for (b in 0 until bandTotal) {
            val db = 10f * log10(bandPower(b) + 1e-12f) + tilt[b]
            target[b] = db
            if (db > loudest) loudest = db
        }
        // Automatic gain: quiet masters still dance, silence never gets amplified into noise.
        ceilingDb = if (loudest > ceilingDb) ceilingDb + (loudest - ceilingDb) * (1f - exp(-dt / .06f))
        else ceilingDb - dt * 3.5f
        ceilingDb = ceilingDb.coerceAtLeast(-46f)
        val floorDb = ceilingDb - RANGE_DB
        for (b in 0 until bandTotal) {
            val t = ((target[b] - floorDb) / RANGE_DB).coerceIn(0f, 1f)
            target[b] = t * sqrt(t)
        }
        smooth(dt)

        var bassEnergy = 0f
        for (k in bassFrom..bassTo) bassEnergy += power[k]
        detectBeat(10f * log10(bassEnergy + 1e-12f), dt)
        spectrum.signal = true
        return spectrum
    }

    private fun release(dt: Float) {
        time += dt
        target.fill(0f)
        smooth(dt)
        spectrum.beat = false
        spectrum.pulse *= exp(-dt / PULSE_DECAY)
        spectrum.signal = false
    }

    private fun smooth(dt: Float) {
        val attack = 1f - exp(-dt / .018f)
        val decay = 1f - exp(-dt / .15f)
        val bands = spectrum.bands
        val peaks = spectrum.peaks
        val sums = groupSums
        sums.fill(0f)
        var all = 0f
        for (b in 0 until bandTotal) {
            val goal = target[b]
            val now = bands[b]
            val next = now + (goal - now) * if (goal > now) attack else decay
            bands[b] = next
            if (next >= peaks[b]) {
                peaks[b] = next
                holdUntil[b] = time + .42
                fall[b] = 0f
            } else if (time > holdUntil[b]) {
                fall[b] += 2.6f * dt
                peaks[b] = max(next, peaks[b] - fall[b] * dt)
            }
            sums[group[b]] += next
            all += next
        }
        spectrum.bass = if (groupSize[0] > 0) sums[0] / groupSize[0] else 0f
        spectrum.mid = if (groupSize[1] > 0) sums[1] / groupSize[1] else 0f
        spectrum.high = if (groupSize[2] > 0) sums[2] / groupSize[2] else 0f
        spectrum.level = all / bandTotal
    }

    /**
     * Bass onset: energy rising well above its fast-moving recent mean. The threshold adapts to how
     * busy the low end has been (mean + 1.6 sigma of recent rises) and a refractory period caps it
     * at 250 BPM, so a held bass note or a dense bassline does not machine-gun beats.
     */
    private fun detectBeat(bassDb: Float, dt: Float) {
        spectrum.beat = false
        if (bassFast.isNaN()) bassFast = bassDb
        val rise = bassDb - bassFast
        val threshold = max(MIN_RISE_DB, riseMean + 1.6f * sqrt(riseVariance))
        if (rise > threshold && bassDb > SILENCE_DB && bassDb > previousBass && time - lastBeat > REFRACTORY) {
            lastBeat = time
            spectrum.beat = true
            spectrum.beatCount++
            spectrum.beatStrength = (.4f + (rise - threshold) / 14f).coerceIn(.2f, 1f)
        }
        spectrum.pulse = max(spectrum.pulse * exp(-dt / PULSE_DECAY), if (spectrum.beat) spectrum.beatStrength else 0f)
        bassFast += (bassDb - bassFast) * (1f - exp(-dt / .12f))
        val k = 1f - exp(-dt / 1.6f)
        val delta = max(rise, 0f) - riseMean
        riseMean += k * delta
        riseVariance = (1f - k) * (riseVariance + k * delta * delta)
        previousBass = bassDb
    }

    private fun bandPower(b: Int): Float {
        val from = bandLow[b]
        val to = bandHigh[b]
        val first = kotlin.math.ceil(from).toInt().coerceAtLeast(1)
        val last = kotlin.math.floor(to - 1e-4f).toInt().coerceAtMost(fftSize / 2)
        if (last >= first) {
            var sum = 0f
            for (k in first..last) sum += power[k]
            return sum / (last - first + 1)
        }
        // Band narrower than a bin (deep bass): interpolate at its centre.
        val centre = ((from + to) / 2f).coerceIn(1f, fftSize / 2f - 1f)
        val k = centre.toInt()
        val f = centre - k
        return power[k] * (1f - f) + power[k + 1] * f
    }

    private fun configure(sampleRate: Int) {
        rate = sampleRate
        val bin = sampleRate.toFloat() / fftSize
        val top = min(16_000f, sampleRate * .46f)
        val ratio = ln(top / LOWEST_HZ)
        groupSize.fill(0)
        for (b in 0 until bandTotal) {
            val low = LOWEST_HZ * exp(ratio * b / bandTotal)
            val high = LOWEST_HZ * exp(ratio * (b + 1) / bandTotal)
            val centre = sqrt(low * high)
            bandLow[b] = low / bin
            bandHigh[b] = high / bin
            spectrum.frequencies[b] = centre
            // +3 dB/octave around 1 kHz flattens music's natural pink slope.
            tilt[b] = 3f * (ln(centre / 1000f) / ln(2f))
            group[b] = when {
                centre < 160f -> 0
                centre < 2_500f -> 1
                else -> 2
            }
            groupSize[group[b]]++
        }
        bassFrom = kotlin.math.ceil(40f / bin).toInt().coerceAtLeast(1)
        bassTo = kotlin.math.floor(150f / bin).toInt().coerceAtLeast(bassFrom)
    }

    private fun transform() {
        val n = fftSize
        for (i in 0 until n) {
            val j = reversed[i]
            if (j > i) {
                val r = re[i]; re[i] = re[j]; re[j] = r
                val m = im[i]; im[i] = im[j]; im[j] = m
            }
        }
        var span = 2
        while (span <= n) {
            val half = span / 2
            val step = n / span
            var start = 0
            while (start < n) {
                var k = 0
                for (j in start until start + half) {
                    val wr = cosTable[k]
                    val wi = -sinTable[k]
                    val l = j + half
                    val tr = wr * re[l] - wi * im[l]
                    val ti = wr * im[l] + wi * re[l]
                    re[l] = re[j] - tr
                    im[l] = im[j] - ti
                    re[j] += tr
                    im[j] += ti
                    k += step
                }
                start += span
            }
            span *= 2
        }
    }

    private companion object {
        const val LOWEST_HZ = 35f
        const val RANGE_DB = 44f
        const val MIN_RISE_DB = 6f
        const val SILENCE_DB = -52f
        const val REFRACTORY = .24
        const val PULSE_DECAY = .17f
    }
}
