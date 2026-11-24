package com.personal.murmur

import android.app.*
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.content.ContextCompat

/** Square LoginKeepAlive pattern: loopback must answer while the browser is foreground. */
class LoginKeepAlive:Service() {
    companion object {
        fun start(context:Context){ContextCompat.startForegroundService(context,Intent(context,LoginKeepAlive::class.java))}
        fun stop(context:Context){context.stopService(Intent(context,LoginKeepAlive::class.java))}
    }
    override fun onBind(intent:Intent?):IBinder?=null
    override fun onStartCommand(intent:Intent?,flags:Int,startId:Int):Int {
        val manager=getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel("murmur_login","Autorización de cuenta",NotificationManager.IMPORTANCE_LOW))
        val notification=Notification.Builder(this,"murmur_login").setSmallIcon(R.drawable.ic_stat_sound).setContentTitle("Conectando Spotify").setContentText("Completa la autorización en el navegador y vuelve a MURMUR.").setOngoing(true).build()
        if(Build.VERSION.SDK_INT>=29)startForeground(4301,notification,ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)else startForeground(4301,notification)
        return START_NOT_STICKY
    }
}
