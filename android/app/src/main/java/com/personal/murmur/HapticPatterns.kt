package com.personal.murmur

import android.view.HapticFeedbackConstants

/** Maps MURMUR's interface feedback to Android's system haptics, which follow the user's touch settings. */
object HapticPatterns {
    /** CONFIRM and REJECT are compile-time ints; the SDK check keeps older phones on their fallbacks. */
    @android.annotation.SuppressLint("InlinedApi")
    fun constant(kind: String, sdk: Int): Int = when (kind) {
        "confirm" -> if (sdk >= 30) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.VIRTUAL_KEY
        "reject" -> if (sdk >= 30) HapticFeedbackConstants.REJECT else HapticFeedbackConstants.LONG_PRESS
        else -> HapticFeedbackConstants.CLOCK_TICK
    }
}
