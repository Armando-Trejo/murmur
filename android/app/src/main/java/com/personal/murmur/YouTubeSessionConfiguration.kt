package com.personal.murmur

import org.json.JSONObject
import org.json.JSONTokener

object YouTubeSessionConfiguration {
    const val SCRIPT="""(function(){var c=(window.ytcfg&&window.ytcfg.data_)||(window.yt&&window.yt.config_)||{};return JSON.stringify({clientVersion:c.INNERTUBE_CLIENT_VERSION||((c.INNERTUBE_CONTEXT||{}).client||{}).clientVersion||'',visitorData:c.VISITOR_DATA||((c.INNERTUBE_CONTEXT||{}).client||{}).visitorData||'',pageId:c.DELEGATED_SESSION_ID||'',sessionIndex:String(c.SESSION_INDEX||'0')});})()"""
    fun fromJavascript(raw:String):JSONObject {
        val value=JSONTokener(raw).nextValue()
        val data=if(value is String)JSONObject(value)else value as? JSONObject ?: error("Espera a que termine de cargar YouTube Music.")
        check(validVersion(data.optString("clientVersion"))){"Vuelve a YouTube Music después de iniciar sesión y pulsa Guardar conexión."}
        return data
    }
    fun validVersion(value:String)=value.matches(Regex("[0-9][A-Za-z0-9._-]{2,99}"))
    fun fromHtml(html:String):String? {
        val normalized=html.replace("\\\"","\"")
        return Regex("""["'](?:INNERTUBE_CLIENT_VERSION|clientVersion)["']\s*:\s*["']([^"']+)["']""").findAll(normalized).map{it.groupValues[1]}.firstOrNull(::validVersion)
    }
}
