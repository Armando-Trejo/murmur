package com.personal.murmur
import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.view.Gravity
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView

/** Native brand screen that preserves the original launch/share intent. */
class SplashActivity : Activity() {
    private val handler = android.os.Handler(android.os.Looper.getMainLooper())
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Color.BLACK; window.navigationBarColor = Color.BLACK
        val density = resources.displayMetrics.density
        val root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        val identity = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER }
        identity.addView(ImageView(this).apply { setImageResource(R.drawable.murmur_lockup); scaleType = ImageView.ScaleType.FIT_CENTER; contentDescription = "MURMUR" }, LinearLayout.LayoutParams((184*density).toInt(), (184*density).toInt()))
        root.addView(identity, FrameLayout.LayoutParams(-2, -2, Gravity.CENTER)); setContentView(root)
        handler.postDelayed({ startActivity(Intent(intent).setClass(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)); finish() }, 420)
    }
    override fun onDestroy() { handler.removeCallbacksAndMessages(null); super.onDestroy() }
}
