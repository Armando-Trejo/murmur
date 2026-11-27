package com.personal.murmur

import android.content.Context
import android.content.SharedPreferences
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.log10
import kotlin.math.pow
import kotlin.math.sqrt

/**
 * «Volumen parejo»: every song sounds at the same level, like YouTube Music and Spotify do.
 * YouTube tells how loud each upload is against its reference (playerConfig.audioConfig.loudnessDb,
 * positive = louder). MURMUR brings every song to that reference: loud ones go down with the player's
 * volume, quiet ones come up with Android's LoudnessEnhancer (it limits peaks, so they never clip).
 * When YouTube does not say (another extractor, an old download), MURMUR measures the first seconds.
 * Values are kept per video, so a song is measured once.
 */
object Loudness {
    /**
     * Where every song lands, over YouTube's −14 LUFS reference: +3 dB ≈ −11 LUFS, Spotify's «Alto».
     * Almost all current music is mastered louder than −14, so the plain reference would make MURMUR
     * much quieter than before; this keeps songs even while the overall level barely drops.
     */
    const val TARGET_DB = 3f
    const val MAX_CUT_DB = 12f
    const val MAX_BOOST_DB = 6f
    /** RMS (dBFS, unweighted) to YouTube's scale; calibrated against songs where both are known. */
    @Volatile var measureOffsetDb = 14f
    private const val PREFS = "loudness"
    private const val ENABLED_KEY = "even_volume"

    @Volatile private var prefs: SharedPreferences? = null
    @Volatile private var playback: SharedPreferences? = null
    private val reported = ConcurrentHashMap<String, Float>()
    private val measured = ConcurrentHashMap<String, Float>()
    private val video = Regex("[A-Za-z0-9_-]{11}")

    fun init(context: Context) {
        if (prefs != null) return
        prefs = context.applicationContext.getSharedPreferences(PREFS, 0)
        playback = context.applicationContext.getSharedPreferences("playback", 0)
    }

    /** On by default; Opciones › Apariencia can turn it off. */
    fun enabled() = playback?.getBoolean(ENABLED_KEY, true) ?: true
    fun setEnabled(context: Context, value: Boolean) {
        init(context)
        playback?.edit()?.putBoolean(ENABLED_KEY, value)?.apply()
    }

    /** YouTube's value for a video (from the player response). */
    fun report(videoId: String, db: Double) {
        if (!videoId.matches(video) || db.isNaN() || db < -40 || db > 40) return
        reported[videoId] = db.toFloat()
        store(videoId, db.toFloat())
    }

    /** A value measured on the phone, only kept when YouTube's is unknown. */
    fun measure(videoId: String, db: Float) {
        if (!videoId.matches(video) || db.isNaN()) return
        measured[videoId] = db
        if (known(videoId) == null) store("m:$videoId", db)
    }

    /** What is known about the song: YouTube's value first, then a measurement. */
    fun known(videoId: String): Float? {
        if (!videoId.matches(video)) return null
        reported[videoId]?.let { return it }
        prefs?.getFloat(videoId, Float.NaN)?.takeUnless { it.isNaN() }?.let { reported[videoId] = it; return it }
        measured[videoId]?.let { return it }
        return prefs?.getFloat("m:$videoId", Float.NaN)?.takeUnless { it.isNaN() }?.also { measured[videoId] = it }
    }

    /** Correction in dB for the song: negative turns it down, positive up. Null = unknown or off. */
    fun correctionDb(videoId: String?): Float? {
        if (videoId == null || !enabled()) return null
        val db = known(videoId) ?: return null
        return (TARGET_DB - db).coerceIn(-MAX_CUT_DB, MAX_BOOST_DB)
    }

    /** Player volume for the song (≤ 1: only turning down happens here). */
    fun attenuation(videoId: String?): Float {
        val correction = correctionDb(videoId) ?: return 1f
        return if (correction < 0f) 10f.pow(correction / 20f) else 1f
    }

    /** LoudnessEnhancer gain in millibels for a quiet song (0 = none). */
    fun boostMb(videoId: String?): Int {
        val correction = correctionDb(videoId) ?: return 0
        return if (correction > 0f) (correction * 100).toInt() else 0
    }

    /**
     * YouTube's level from playerConfig.audioConfig, in dB over its reference. Newer responses say it
     * as the song's loudness and the target (trackAbsoluteLoudnessLkfs −7.1 against −14 = 6.9 dB too
     * loud); older ones directly as loudnessDb.
     */
    fun fromAudioConfig(value: (String) -> Double?): Double? {
        value("loudnessDb")?.let { return it }
        val absolute = value("trackAbsoluteLoudnessLkfs") ?: value("perceptualLoudnessDb") ?: return null
        val target = value("loudnessTargetLkfs") ?: -14.0
        return absolute - target
    }

    /** Mean square of the tapped RMS values → YouTube's scale. */
    fun fromMeanSquare(meanSquare: Double): Float =
        if (meanSquare <= 0.0) Float.NaN else (20 * log10(sqrt(meanSquare))).toFloat() + measureOffsetDb

    private fun store(key: String, db: Float) {
        val p = prefs ?: return
        // A few thousand songs at most; past that the oldest knowledge is simply forgotten.
        if (p.all.size > 6000) p.edit().clear().apply()
        p.edit().putFloat(key, db).apply()
    }
}
