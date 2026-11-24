package com.personal.murmur

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Encrypted preferences that survive a lost Keystore key. The key lives in Android Keystore and is
 * deleted on uninstall, but the XML can come back (Android backup, a restored data folder): opening
 * it then throws AEADBadTagException and used to crash MURMUR at start. Those tokens are unreadable
 * anyway, so the file is discarded and the user simply reconnects the account.
 */
object SecurePrefs {
    fun open(context: Context, name: String): SharedPreferences {
        val app = context.applicationContext
        return try {
            create(app, name)
        } catch (failure: Exception) {
            android.util.Log.w("MURMUR", "Sesiones cifradas ilegibles en $name; se descartan", failure)
            app.deleteSharedPreferences(name)
            create(app, name)
        }
    }

    private fun create(context: Context, name: String): SharedPreferences = EncryptedSharedPreferences.create(
        context, name,
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )
}
