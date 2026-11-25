package com.personal.murmur

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.provider.MediaStore

/**
 * A copy of the library and settings in Descargas/MURMUR/murmur-respaldo.json, kept up to date by
 * the app. Files in Descargas survive uninstalling MURMUR, so after a reinstall (for example a
 * version signed with another key) the welcome screen can restore everything in one step.
 * Sessions and passwords never go here: they stay in Android's encrypted storage.
 * Android 10+ lets an app write its own files in Descargas without any storage permission.
 */
object AutoBackup {
    const val NAME = "murmur-respaldo.json"
    private const val FOLDER = "Download/MURMUR/"
    private const val PREF = "auto_backup_uri"

    fun write(context: Context, content: String): Boolean {
        if (Build.VERSION.SDK_INT < 29) return false
        val resolver = context.contentResolver
        val prefs = context.getSharedPreferences("playback", 0)
        // Reuse our own file when it still exists; otherwise create it (a reinstall cannot reuse the old one).
        val known = prefs.getString(PREF, null)?.let(Uri::parse)
        val target = known?.takeIf { uri -> runCatching { resolver.openOutputStream(uri, "wt")?.use { it.writer(Charsets.UTF_8).use { w -> w.write(content) } }; true }.getOrDefault(false) }
        if (target != null) return true
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, NAME)
            put(MediaStore.MediaColumns.MIME_TYPE, "application/json")
            put(MediaStore.MediaColumns.RELATIVE_PATH, FOLDER)
            put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: return false
        return try {
            resolver.openOutputStream(uri, "wt")?.use { it.writer(Charsets.UTF_8).use { w -> w.write(content) } } ?: error("Sin destino")
            resolver.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
            prefs.edit().putString(PREF, uri.toString()).apply()
            true
        } catch (failure: Exception) {
            runCatching { resolver.delete(uri, null, null) }
            false
        }
    }
}
