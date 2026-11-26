package com.personal.murmur
import android.content.Intent
import android.os.Bundle
import android.content.BroadcastReceiver
import android.content.Context
import android.content.IntentFilter
import android.bluetooth.BluetoothDevice
import androidx.core.content.ContextCompat
import com.getcapacitor.BridgeActivity
import com.getcapacitor.JSObject
import android.graphics.Color
import android.view.View
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
class MainActivity : BridgeActivity() {
    private val bluetooth = object : BroadcastReceiver() { override fun onReceive(context: Context?, intent: Intent?) { NativeEvents.emit("onCarModeChanged", JSObject().put("connected", intent?.action == BluetoothDevice.ACTION_ACL_CONNECTED)) } }
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(YouTubeAudioPlugin::class.java); registerPlugin(AuthBridgePlugin::class.java); registerPlugin(LocalIntentPlugin::class.java)
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.statusBarColor = Color.BLACK; window.navigationBarColor = Color.BLACK
        WindowInsetsControllerCompat(window, window.decorView).apply { isAppearanceLightStatusBars = false; isAppearanceLightNavigationBars = false }
        val content = findViewById<View>(android.R.id.content)
        content.setBackgroundColor(Color.BLACK)
        ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val keyboard = insets.getInsets(WindowInsetsCompat.Type.ime())
            view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, keyboard.bottom))
            WindowInsetsCompat.CONSUMED
        }
        ViewCompat.requestApplyInsets(content)
        ContextCompat.registerReceiver(this, bluetooth, IntentFilter().apply { addAction(BluetoothDevice.ACTION_ACL_CONNECTED); addAction(BluetoothDevice.ACTION_ACL_DISCONNECTED) }, ContextCompat.RECEIVER_EXPORTED)
        ContextCompat.registerReceiver(this, screenOff, IntentFilter(Intent.ACTION_SCREEN_OFF), ContextCompat.RECEIVER_NOT_EXPORTED)
        handleIntent(intent)
    }
    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); setIntent(intent); handleIntent(intent) }
    /** Screen-off while MURMUR is in front and music plays: show the music screen over the lock screen. */
    private val screenOff = object : BroadcastReceiver() { override fun onReceive(context: Context?, intent: Intent?) { if (visible) showLockVisualizer() } }
    private var visible = false
    private var lockShownAt = 0L
    override fun onPause() { super.onPause(); showLockVisualizer() }
    private fun showLockVisualizer() {
        val power = getSystemService(android.os.PowerManager::class.java)
        if (power?.isInteractive != false || !LockVisualizer.enabled(this)) return
        val service = HybridMediaService.instance ?: return
        if (!service.visualPlaying && !service.youtubeLoading) return
        val now = android.os.SystemClock.elapsedRealtime()
        if (now - lockShownAt < 2_000) return
        lockShownAt = now
        // Started while this activity is still the top one (pausing), so Android allows the launch.
        try {
            startActivity(Intent(this, MusicVisualActivity::class.java).putExtra(MusicVisualActivity.EXTRA_LOCKSCREEN, true)
                .addFlags(Intent.FLAG_ACTIVITY_NO_ANIMATION))
        } catch (_: Exception) { }
    }
    override fun onStart() {
        super.onStart(); visible = true; HybridMediaService.uiVisible = true; WakeWordService.appVisible = true
        // "Ok MURMUR" was on but Android stopped it (reboot, memory): resume it while MURMUR is in front.
        if (WakeWordService.enabled(this) && !WakeWordService.running) {
            val started = runCatching { WakeWordService.start(this) }.getOrDefault(false)
            if (!started && !WakeWordService.canListen(this)) NativeEvents.emit("onVoiceError", JSObject().put("message",
                "«Ok MURMUR» está activado pero falta el permiso del micrófono. Vuelve a activarlo en Opciones (⋯)."))
        }
    }
    override fun onStop() { visible = false; HybridMediaService.uiVisible = false; WakeWordService.appVisible = false; super.onStop() }
    override fun onResume() {
        super.onResume()
        if(intent?.getBooleanExtra("open_player",false)==true){intent.removeExtra("open_player");NativeEvents.emit("onOpenPlayer")}
        intent?.getStringExtra("voice_text")?.let { text ->
            intent.removeExtra("voice_text")
            NativeEvents.emit("onVoiceCommandCaptured", JSObject().put("text", text.take(1000)))
        }
        // "Reproduce Soda Stereo en MURMUR" (Google Assistant, Android Auto): same as «Ok MURMUR, pon …».
        if (intent?.action == android.provider.MediaStore.INTENT_ACTION_MEDIA_PLAY_FROM_SEARCH) {
            val query = intent.getStringExtra(android.app.SearchManager.QUERY).orEmpty().trim()
            intent.action = Intent.ACTION_MAIN
            NativeEvents.emit("onVoiceCommandCaptured", JSObject().put("text", (if (query.isBlank()) "sorpréndeme" else "pon $query").take(1000)))
        }
        intent?.getStringExtra("voice_error")?.let { message ->
            intent.removeExtra("voice_error")
            NativeEvents.emit("onVoiceError", JSObject().put("message", message))
        }
    }
    private fun handleIntent(intent: Intent?) { val uri = intent?.data; if (uri?.scheme == "com.personal.murmur" && uri.host == "oauth-return") return; if (uri?.scheme == "com.personal.murmur" && uri.host == "oauth") { (bridge.getPlugin("AuthBridge")?.instance as? AuthBridgePlugin)?.oauthCallback(uri); return }; val text = if (intent?.action == Intent.ACTION_SEND) intent.getStringExtra(Intent.EXTRA_TEXT) else if (intent?.action == Intent.ACTION_VIEW) uri?.toString() else null; text?.let { NativeEvents.emit("onSharedUrlReceived", JSObject().put("url", it.take(3000))) }; intent?.getStringExtra("shortcut")?.let { NativeEvents.emit("onShortcutReceived", JSObject().put("target", it)) } }
    override fun onDestroy() { unregisterReceiver(bluetooth); unregisterReceiver(screenOff); super.onDestroy() }
}
