package com.personal.murmur
import android.app.Activity
import android.os.Bundle
import android.content.Intent
class BackupWriter : Activity() {
    companion object { var pending: String? = null; var completion: ((Boolean, String?) -> Unit)? = null }
    override fun onCreate(savedInstanceState: Bundle?) { super.onCreate(savedInstanceState); if (pending == null) { finish(); return }; if (savedInstanceState == null) { @Suppress("DEPRECATION") startActivityForResult(Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/json").putExtra(Intent.EXTRA_TITLE, "murmur-backup.json"), 41) } }
    @Deprecated("Android Activity result") override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if(requestCode != 41) return
        try {
            if(resultCode != RESULT_OK || data?.data == null) { completion?.invoke(false,null); return }
            val content = pending ?: error("No se encontró el contenido del respaldo")
            val stream = contentResolver.openOutputStream(data.data!!) ?: error("No se pudo abrir el destino del respaldo")
            stream.bufferedWriter(Charsets.UTF_8).use { it.write(content) }
            completion?.invoke(true,null)
        } catch (e: Exception) { completion?.invoke(false,"No se pudo guardar el respaldo. Revisa el espacio y los permisos del destino.") }
        finally { pending = null; completion = null; finish() }
    }
}
