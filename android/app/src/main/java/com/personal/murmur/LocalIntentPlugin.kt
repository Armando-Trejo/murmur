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
    /** Report of the last unexpected close (returned once), plus the app version. */
    @PluginMethod fun lastCrash(call: PluginCall) {
        val version = runCatching { context.packageManager.getPackageInfo(context.packageName, 0).versionName }.getOrNull() ?: ""
        call.resolve(JSObject().put("report", CrashLog.take(context)).put("version", version))
    }
    /** Android's share sheet with a text (WhatsApp, correo…): the person chooses where it goes. */
    @PluginMethod fun shareText(call: PluginCall) { activity.runOnUiThread {
        val text = call.getString("text")?.take(20_000) ?: return@runOnUiThread call.reject("Nada que compartir")
        val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text)
            .putExtra(Intent.EXTRA_SUBJECT, call.getString("title") ?: "Reporte de MURMUR")
        activity.startActivity(Intent.createChooser(send, call.getString("title") ?: "Compartir"))
        call.resolve()
    } }
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
    /** Artist and playlist names the speech recognizer should expect (Android 13+ biasing). */
    @PluginMethod fun setVoiceHints(call: PluginCall) {
        val array = call.getArray("hints") ?: JSArray()
        VoiceHints.save(context, (0 until minOf(array.length(), 200)).mapNotNull { runCatching { array.getString(it).take(60) }.getOrNull() })
        call.resolve()
    }
    /** "Ok MURMUR": state, and turning it on (needs the microphone; must start while MURMUR is in front). */
    @PluginMethod fun wakeWordStatus(call: PluginCall) {
        call.resolve(JSObject().put("enabled", WakeWordService.enabled(context)).put("running", WakeWordService.running)
            .put("model", WakeWordModel.available(context)))
    }
    @PluginMethod fun setWakeWord(call: PluginCall) { activity.runOnUiThread {
        val enabled = call.getBoolean("enabled") ?: false
        if (!enabled) { WakeWordService.setEnabled(context, false); WakeWordService.stop(context); call.resolve(JSObject().put("enabled", false)); return@runOnUiThread }
        if (getPermissionState("microphone") != PermissionState.GRANTED) { requestPermissionForAlias("microphone", call, "wakeMicrophoneResult"); return@runOnUiThread }
        enableWake(call)
    } }
    @PermissionCallback private fun wakeMicrophoneResult(call: PluginCall) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) enableWake(call)
        else call.reject(VoiceRecognitionPolicy.message(9), "MICROPHONE_DENIED")
    }
    private fun enableWake(call: PluginCall) {
        try {
            WakeWordService.setEnabled(context, true); WakeWordService.start(context)
            call.resolve(JSObject().put("enabled", true).put("model", WakeWordModel.available(context)))
        } catch (e: Exception) {
            WakeWordService.setEnabled(context, false)
            call.reject("Android no permitió iniciar la escucha. Vuelve a intentarlo con MURMUR abierto.")
        }
    }
    @PluginMethod fun downloadModel(call: PluginCall) { scope.launch { try { withContext(Dispatchers.IO) { SemanticModel.download(context) }; call.resolve(JSObject().put("available", true).put("message", "Modelo local listo · 6 MB · integridad verificada")) } catch (e: Exception) { call.reject(e.message ?: "No se pudo descargar el modelo", e) } } }
    @PluginMethod fun rankTags(call: PluginCall) { scope.launch { try { val query = call.getString("query")?.take(500) ?: error("Falta consulta"); val array = call.getArray("tags") ?: JSArray(); val tags = (0 until minOf(array.length(), 256)).map { array.getString(it).take(100) }; val ranked = withContext(Dispatchers.IO) { SemanticModel.rank(context, query, tags) }; val result = JSArray(); ranked.forEach { (text, score) -> result.put(JSObject().put("text", text).put("score", score)) }; call.resolve(JSObject().put("ranked", result)) } catch (e: LinkageError) { call.reject("El modelo no es compatible con esta arquitectura. Se usará el parser local de etiquetas.") } catch (e: Exception) { call.reject(e.message ?: "No se pudo calcular afinidad", e) } } }
    override fun handleOnDestroy() { scope.cancel(); super.handleOnDestroy() }
}
