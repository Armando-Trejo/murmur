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
        handleIntent(intent)
    }
    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); setIntent(intent); handleIntent(intent) }
    override fun onStart() { super.onStart(); HybridMediaService.uiVisible = true }
    override fun onStop() { HybridMediaService.uiVisible = false; super.onStop() }
    override fun onResume() {
        super.onResume()
        if(intent?.getBooleanExtra("open_player",false)==true){intent.removeExtra("open_player");NativeEvents.emit("onOpenPlayer")}
        intent?.getStringExtra("voice_text")?.let { text ->
            intent.removeExtra("voice_text")
            NativeEvents.emit("onVoiceCommandCaptured", JSObject().put("text", text.take(1000)))
        }
        intent?.getStringExtra("voice_error")?.let { message ->
            intent.removeExtra("voice_error")
            NativeEvents.emit("onVoiceError", JSObject().put("message", message))
        }
    }
    private fun handleIntent(intent: Intent?) { val uri = intent?.data; if (uri?.scheme == "com.personal.murmur" && uri.host == "oauth-return") return; if (uri?.scheme == "com.personal.murmur" && uri.host == "oauth") { (bridge.getPlugin("AuthBridge")?.instance as? AuthBridgePlugin)?.oauthCallback(uri); return }; val text = if (intent?.action == Intent.ACTION_SEND) intent.getStringExtra(Intent.EXTRA_TEXT) else if (intent?.action == Intent.ACTION_VIEW) uri?.toString() else null; text?.let { NativeEvents.emit("onSharedUrlReceived", JSObject().put("url", it.take(3000))) }; intent?.getStringExtra("shortcut")?.let { NativeEvents.emit("onShortcutReceived", JSObject().put("target", it)) } }
    override fun onDestroy() { unregisterReceiver(bluetooth); super.onDestroy() }
}
