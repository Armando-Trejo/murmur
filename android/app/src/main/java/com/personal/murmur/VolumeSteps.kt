package com.personal.murmur

import kotlin.math.max
import kotlin.math.roundToInt

/** The arithmetic of the voice volume commands: "súbele" moves about a fifth of the slider. */
object VolumeSteps {
    fun target(current: Int, max: Int, direction: String?, percent: Int?): Int {
        val step = max(1, (max * 0.2).roundToInt())
        val wanted = when {
            percent != null -> (max * percent.coerceIn(0, 100) / 100.0).roundToInt()
            direction == "down" -> current - step
            else -> current + step
        }
        return wanted.coerceIn(0, max)
    }

    fun percent(level: Int, max: Int) = if (max <= 0) 0 else (level * 100.0 / max).roundToInt()
}
