package com.personal.murmur

import android.content.Context
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.text.textembedder.TextEmbedder
import com.google.mediapipe.tasks.components.containers.Embedding
import java.io.File
import java.security.MessageDigest

object SemanticModel {
    private const val URL = "https://storage.googleapis.com/mediapipe-models/text_embedder/universal_sentence_encoder/float32/1/universal_sentence_encoder.tflite"
    private const val SHA256 = "89ad3c74175dd8caa398cc22b657296d94302d20c525c12b58b29420f7249749"
    private const val BYTES = 6120274L
    private var embedder: TextEmbedder? = null
    private val embeddings = object : LinkedHashMap<String, Embedding>(128, .75f, true) { override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Embedding>?): Boolean = size > 256 }
    private fun file(context: Context) = File(context.filesDir, "models/universal_sentence_encoder.tflite")
    fun available(context: Context) = file(context).isFile && file(context).length() == BYTES
    @Synchronized fun download(context: Context) {
        val target = file(context); if (available(context)) return
        target.parentFile?.mkdirs(); val part = File(target.parentFile, "encoder.part")
        try {
            NativeNetwork.client.newCall(okhttp3.Request.Builder().url(URL).build()).execute().use { response ->
                check(response.isSuccessful) { "No se pudo descargar el modelo (${response.code})" }
                val digest = MessageDigest.getInstance("SHA-256"); var total = 0L
                response.body?.byteStream()?.use { input -> part.outputStream().use { output -> val buffer = ByteArray(65536); while (true) { val size = input.read(buffer); if (size < 0) break; total += size; check(total <= BYTES) { "Tamaño del modelo inesperado" }; digest.update(buffer, 0, size); output.write(buffer, 0, size) } } } ?: error("Modelo vacío")
                check(total == BYTES && digest.digest().joinToString("") { "%02x".format(it) } == SHA256) { "La integridad del modelo no coincide" }
                check(part.renameTo(target)) { "No se pudo guardar el modelo" }
            }
        } finally { part.delete() }
    }
    @Synchronized fun rank(context: Context, query: String, tags: List<String>): List<Pair<String, Double>> {
        check(available(context)) { "Descarga el modelo de 6 MB desde Opciones (⋯)" }
        val model = embedder ?: TextEmbedder.createFromOptions(context, TextEmbedder.TextEmbedderOptions.builder().setBaseOptions(BaseOptions.builder().setModelAssetPath(file(context).absolutePath).build()).setL2Normalize(true).build()).also { embedder = it }
        fun vector(text: String): Embedding = embeddings.getOrPut(text) { model.embed(text).embeddingResult().embeddings().first() }
        val q = vector(query)
        return tags.distinct().take(256).map { it to TextEmbedder.cosineSimilarity(q, vector(it)) }.sortedByDescending { it.second }
    }
}
