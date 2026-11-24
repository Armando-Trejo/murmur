package com.personal.murmur
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin
object AutoMixCurve {
    fun gains(progress: Double): Pair<Float, Float> { val p = progress.coerceIn(0.0, 1.0); return cos(p * PI / 2).toFloat() to sin(p * PI / 2).toFloat() }
}
