package com.personal.murmur

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import okhttp3.Request
import java.io.File
import java.security.MessageDigest

/**
 * Downloads a MURMUR release APK from GitHub and hands it to Android's installer. Only GitHub
 * release files of this repository are accepted, and the APK must be signed with the same key as
 * the installed app (otherwise Android would refuse to update and the person would be stuck).
 */
object UpdateInstaller {
    private const val REPO_PATH = "/Armando-Trejo/murmur/"

    fun allowed(url: String): Boolean {
        val uri = Uri.parse(url)
        return uri.scheme == "https" && uri.host == "github.com" && (uri.path ?: "").startsWith(REPO_PATH) &&
            (uri.path ?: "").endsWith(".apk")
    }

    private fun trustedHost(host: String?) = host != null &&
        (host == "github.com" || host.endsWith(".githubusercontent.com"))

    /** Downloads to the cache (replacing a previous download); reports 0..100. */
    fun download(context: Context, url: String, progress: (Int) -> Unit): File {
        require(allowed(url)) { "Enlace de actualización no permitido" }
        val dir = File(context.cacheDir, "updates").apply { mkdirs() }
        dir.listFiles()?.forEach { it.delete() }
        val target = File(dir, "MURMUR-update.apk")
        val request = Request.Builder().url(url).header("Accept", "application/octet-stream").build()
        NativeNetwork.client.newCall(request).execute().use { response ->
            check(trustedHost(response.request.url.host)) { "La descarga no vino de GitHub" }
            if (!response.isSuccessful) throw java.io.IOException("GitHub respondió ${response.code}")
            val body = response.body ?: throw java.io.IOException("Descarga vacía")
            val total = body.contentLength()
            check(total <= 0 || total < 200L * 1024 * 1024) { "Archivo demasiado grande" }
            var read = 0L
            var last = -1
            body.byteStream().use { input ->
                target.outputStream().use { output ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buffer)
                        if (n < 0) break
                        output.write(buffer, 0, n)
                        read += n
                        if (total > 0) {
                            val pct = (read * 100 / total).toInt()
                            if (pct != last) { last = pct; progress(pct) }
                        }
                    }
                }
            }
        }
        return target
    }

    private fun signatures(context: Context, info: android.content.pm.PackageInfo?): Set<String> {
        if (info == null) return emptySet()
        val certs = if (Build.VERSION.SDK_INT >= 28) {
            val signing = info.signingInfo ?: return emptySet()
            if (signing.hasMultipleSigners()) signing.apkContentsSigners else signing.signingCertificateHistory
        } else @Suppress("DEPRECATION") info.signatures
        return certs.orEmpty().map { sig ->
            MessageDigest.getInstance("SHA-256").digest(sig.toByteArray()).joinToString("") { "%02x".format(it) }
        }.toSet()
    }

    /** Same package, newer version and a signature Android will accept as an update. */
    fun verify(context: Context, apk: File): String? {
        val flags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else @Suppress("DEPRECATION") PackageManager.GET_SIGNATURES
        val pm = context.packageManager
        val archive = pm.getPackageArchiveInfo(apk.absolutePath, flags) ?: return "El archivo descargado no es un APK válido."
        if (archive.packageName != context.packageName) return "El APK descargado no es MURMUR."
        val installed = pm.getPackageInfo(context.packageName, flags)
        val newer = if (Build.VERSION.SDK_INT >= 28) archive.longVersionCode > installed.longVersionCode
            else @Suppress("DEPRECATION") archive.versionCode > installed.versionCode
        if (!newer) return "Ya tienes esta versión o una más nueva."
        val mine = signatures(context, installed)
        val theirs = signatures(context, archive)
        if (mine.isEmpty() || theirs.isEmpty() || mine.intersect(theirs).isEmpty()) return "SIGNATURE"
        return null
    }

    fun canInstall(context: Context) = Build.VERSION.SDK_INT < 26 || context.packageManager.canRequestPackageInstalls()

    fun permissionIntent(context: Context) = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + context.packageName))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    fun installIntent(context: Context, apk: File): Intent {
        val uri = FileProvider.getUriForFile(context, context.packageName + ".fileprovider", apk)
        return Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
    }
}
