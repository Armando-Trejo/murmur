package com.personal.murmur
import android.Manifest
import android.content.Intent
import android.speech.SpeechRecognizer
import android.app.Activity
import android.net.Uri
import android.provider.Settings
import androidx.activity.result.ActivityResult
import com.getcapacitor.*
import com.getcapacitor.annotation.*
import kotlinx.coroutines.*
@CapacitorPlugin(name = "LocalIntent", permissions = [Permission(alias = "microphone", strings = [Manifest.permission.RECORD_AUDIO])])
class LocalIntentPlugin : Plugin() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var listening = false
    @PluginMethod fun status(call: PluginCall) { activity.runOnUiThread {
        val local = android.os.Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(context)
        call.resolve(JSObject().put("available", local || SpeechRecognizer.isRecognitionAvailable(context)).put("onDevice", local)
            .put("microphone", getPermissionState("microphone").toString()).put("model", SemanticModel.available(context)))
    } }
    @PluginMethod fun openSettings(call: PluginCall) { activity.runOnUiThread {
        try { activity.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + context.packageName))); call.resolve() }
        catch (_: Exception) { call.reject("Abre Ajustes de Android → Apps → MURMUR → Permisos.") }
    } }
    @PluginMethod fun listen(call: PluginCall) { activity.runOnUiThread {
        if (listening) { call.reject("Ya hay una escucha en curso.", "VOICE_BUSY"); return@runOnUiThread }
        listening = true
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "microphoneResult"); return@runOnUiThread
        }
        launch(call)
    } }
    @PermissionCallback private fun microphoneResult(call: PluginCall) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) launch(call)
        else { listening = false; call.reject(VoiceRecognitionPolicy.message(9), "MICROPHONE_DENIED") }
    }
    private fun launch(call: PluginCall) {
        try { startActivityForResult(call, VoiceTriggerManager.intent(activity, "button").putExtra("return_result", true), "voiceResult") }
        catch (_: Exception) { listening = false; call.reject("No se pudo abrir el micrófono. Vuelve a abrir MURMUR.") }
    }
    @ActivityCallback private fun voiceResult(call: PluginCall?, result: ActivityResult) {
        listening = false
        val text = result.data?.getStringExtra("voice_text")?.trim()
        if (result.resultCode == Activity.RESULT_OK && !text.isNullOrEmpty()) call?.resolve(JSObject().put("text", text))
        else call?.reject(result.data?.getStringExtra("voice_error") ?: "Escucha cancelada.", "VOICE_CAPTURE_FAILED")
    }
    @PluginMethod fun downloadModel(call: PluginCall) { scope.launch { try { withContext(Dispatchers.IO) { SemanticModel.download(context) }; call.resolve(JSObject().put("available", true).put("message", "Modelo local listo · 6 MB · integridad verificada")) } catch (e: Exception) { call.reject(e.message ?: "No se pudo descargar el modelo", e) } } }
    @PluginMethod fun rankTags(call: PluginCall) { scope.launch { try { val query = call.getString("query")?.take(500) ?: error("Falta consulta"); val array = call.getArray("tags") ?: JSArray(); val tags = (0 until minOf(array.length(), 256)).map { array.getString(it).take(100) }; val ranked = withContext(Dispatchers.IO) { SemanticModel.rank(context, query, tags) }; val result = JSArray(); ranked.forEach { (text, score) -> result.put(JSObject().put("text", text).put("score", score)) }; call.resolve(JSObject().put("ranked", result)) } catch (e: LinkageError) { call.reject("El modelo no es compatible con esta arquitectura. Se usará el parser local de etiquetas.") } catch (e: Exception) { call.reject(e.message ?: "No se pudo calcular afinidad", e) } } }
    override fun handleOnDestroy() { scope.cancel(); super.handleOnDestroy() }
}
