package com.personal.murmur

import android.content.Context
import android.os.Build
import java.io.File

/** MediaSessionService owns playback while activities are hidden. */
class MurmurApplication : android.app.Application() {
    override fun onCreate() {
        super.onCreate()
        CrashLog.install(this)
        Loudness.init(this)
    }
}

/**
 * If MURMUR closes unexpectedly, what happened is written to the app's private storage (never sent
 * anywhere by itself). On the next start the app offers to share it, so problems on other people's
 * phones reach whoever maintains MURMUR.
 */
object CrashLog {
    private fun file(context: Context) = File(context.filesDir, "last-crash.txt")

    fun install(context: Context) {
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        val app = context.applicationContext
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            runCatching {
                val version = app.packageManager.getPackageInfo(app.packageName, 0).versionName
                file(app).writeText(buildString {
                    appendLine("MURMUR $version · Android ${Build.VERSION.RELEASE} (${Build.VERSION.SDK_INT}) · ${Build.MANUFACTURER} ${Build.MODEL}")
                    appendLine("Hilo: ${thread.name} · ${java.util.Date()}")
                    appendLine(error.stackTraceToString().take(12_000))
                })
            }
            previous?.uncaughtException(thread, error)
        }
    }

    /** The report of the last unexpected close, once; null when there was none. */
    fun take(context: Context): String? {
        val f = file(context)
        if (!f.isFile) return null
        return runCatching { f.readText() }.getOrNull().also { f.delete() }
    }
}
