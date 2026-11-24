package com.personal.murmur
import android.service.quicksettings.TileService
import android.content.Intent
import android.app.PendingIntent
class VoiceTileService : TileService() {
    override fun onClick() {
        super.onClick()
        val intent = VoiceTriggerManager.intent(this, "quick-settings").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (android.os.Build.VERSION.SDK_INT >= 34) startActivityAndCollapse(PendingIntent.getActivity(this, 1, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
        else launchBeforeAndroid14(intent)
    }
    // The PendingIntent overload exists only on API 34+. This method is reached solely on API 26–33.
    @android.annotation.SuppressLint("StartActivityAndCollapseDeprecated")
    @Suppress("DEPRECATION")
    private fun launchBeforeAndroid14(intent: Intent) { startActivityAndCollapse(intent) }
}
