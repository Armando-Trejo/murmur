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
        // Apps that read HTML (Gmail, Outlook) show the link as a real hyperlink.
        call.getString("html")?.take(20_000)?.let { send.putExtra(Intent.EXTRA_HTML_TEXT, it) }
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
    /** "Súbele", "bájale", "volumen al 50": the media volume, showing Android's own slider. */
    @PluginMethod fun adjustVolume(call: PluginCall) {
        val audio = context.getSystemService(android.media.AudioManager::class.java) ?: return call.reject("No se pudo cambiar el volumen.")
        val stream = android.media.AudioManager.STREAM_MUSIC
        val max = audio.getStreamMaxVolume(stream)
        val target = VolumeSteps.target(audio.getStreamVolume(stream), max, call.getString("direction"), call.getInt("percent"))
        try {
            audio.setStreamVolume(stream, target, android.media.AudioManager.FLAG_SHOW_UI)
        } catch (_: SecurityException) { return call.reject("Android no permitió cambiar el volumen (modo No molestar).") }
        call.resolve(JSObject().put("percent", VolumeSteps.percent(audio.getStreamVolume(stream), max)))
    }
    @PluginMethod fun setVoiceHints(call: PluginCall) {
        val array = call.getArray("hints") ?: JSArray()
        VoiceHints.save(context, (0 until minOf(array.length(), VoiceHints.MAX_SAVED)).mapNotNull { runCatching { array.getString(it).take(60) }.getOrNull() })
        call.resolve()
    }
    /** "Ok MURMUR": state, and turning it on (needs the microphone; must start while MURMUR is in front). */
    @PluginMethod fun wakeWordStatus(call: PluginCall) {
        call.resolve(JSObject().put("enabled", WakeWordService.enabled(context) && WakeWordService.canListen(context)).put("running", WakeWordService.running)
            .put("model", WakeWordModel.available(context)).put("mode", WakeWordService.mode(context)))
    }
    /** When «Ok MURMUR» may open the microphone: "music" (on screen or with music) or "screen" (only on screen). */
    @PluginMethod fun setWakeMode(call: PluginCall) {
        WakeWordService.setMode(context, call.getString("mode") ?: "music")
        call.resolve(JSObject().put("mode", WakeWordService.mode(context)))
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
    /** "Solo mi voz": whether a voice is enrolled, the switch, and whether its model is on the phone. */
    @PluginMethod fun voiceMatchStatus(call: PluginCall) {
        val profile = VoiceProfile.load(context)
        call.resolve(JSObject().put("enabled", profile?.enabled == true).put("enrolled", profile != null)
            .put("model", SpeakerModelStore.available(context)))
    }
    /** Downloads (the first time, ~13 MB) and loads what "Entrena tu voz" needs. */
    @PluginMethod fun prepareVoiceMatch(call: PluginCall) { scope.launch {
        try { withContext(Dispatchers.IO) { VoiceEnrollment.prepare(context) }; call.resolve(JSObject().put("model", true)) }
        catch (e: Exception) { call.reject(e.message ?: "No se pudo preparar «Solo mi voz». Revisa tu conexión e inténtalo de nuevo.") }
    } }
    /** One take of "Entrena tu voz" (1 to 3): records up to 4 s; ok=false with a message when it was not usable. */
    @PluginMethod fun enrollVoiceTake(call: PluginCall) { activity.runOnUiThread {
        if (getPermissionState("microphone") != PermissionState.GRANTED) { requestPermissionForAlias("microphone", call, "enrollMicrophoneResult"); return@runOnUiThread }
        enrollTake(call)
    } }
    @PermissionCallback private fun enrollMicrophoneResult(call: PluginCall) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) enrollTake(call)
        else call.reject(VoiceRecognitionPolicy.message(9), "MICROPHONE_DENIED")
    }
    private fun enrollTake(call: PluginCall) {
        val take = call.getInt("take") ?: 1
        scope.launch {
            try {
                val outcome = withContext(Dispatchers.IO) { VoiceEnrollment.take(context, take) }
                val result = JSObject().put("ok", outcome.ok).put("take", take).put("done", outcome.done).put("restart", outcome.restart)
                outcome.message?.let { result.put("message", it) }
                call.resolve(result)
            } catch (e: Exception) { call.reject(e.message ?: "No se pudo preparar «Solo mi voz».") }
        }
    }
    /** Switches "Solo mi voz" on or off; turning it on needs an enrolled voice (which is kept when off). */
    @PluginMethod fun setVoiceMatch(call: PluginCall) {
        val enabled = call.getBoolean("enabled") ?: false
        val profile = VoiceProfile.load(context)
        if (enabled && profile == null) { call.reject("Primero entrena tu voz.", "NOT_ENROLLED"); return }
        try {
            profile?.let { VoiceProfile.save(context, it.withEnabled(enabled)) }
            call.resolve(JSObject().put("enabled", enabled && profile != null))
        } catch (e: Exception) { call.reject(e.message ?: "No se pudo guardar el ajuste.") }
    }
    /** "Borrar mi voz": removes the enrolled voice from the phone; "Ok MURMUR" answers any voice again. */
    @PluginMethod fun clearVoiceProfile(call: PluginCall) {
        VoiceEnrollment.discard()
        VoiceProfile.clear(context)
        call.resolve(JSObject().put("enabled", false).put("enrolled", false))
    }
    @PluginMethod fun downloadModel(call: PluginCall) { scope.launch { try { withContext(Dispatchers.IO) { SemanticModel.download(context) }; call.resolve(JSObject().put("available", true).put("message", "Modelo local listo · 6 MB · integridad verificada")) } catch (e: Exception) { call.reject(e.message ?: "No se pudo descargar el modelo", e) } } }
    @PluginMethod fun rankTags(call: PluginCall) { scope.launch { try { val query = call.getString("query")?.take(500) ?: error("Falta consulta"); val array = call.getArray("tags") ?: JSArray(); val tags = (0 until minOf(array.length(), 256)).map { array.getString(it).take(100) }; val ranked = withContext(Dispatchers.IO) { SemanticModel.rank(context, query, tags) }; val result = JSArray(); ranked.forEach { (text, score) -> result.put(JSObject().put("text", text).put("score", score)) }; call.resolve(JSObject().put("ranked", result)) } catch (e: LinkageError) { call.reject("El modelo no es compatible con esta arquitectura. Se usará el parser local de etiquetas.") } catch (e: Exception) { call.reject(e.message ?: "No se pudo calcular afinidad", e) } } }
    override fun handleOnDestroy() { scope.cancel(); super.handleOnDestroy() }
}
