package com.personal.murmur

import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.MediaType.Companion.toMediaType
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** Anonymous ANDROID_MUSIC fast path used by Spotui 2502236/YTPlayerUtils. */
object YouTubeMusicResolver {
    const val USER_AGENT="com.google.android.apps.youtube.music/8.39.42 (Linux; U; Android 15; en_US; Pixel 9 Pro; Build/AP4A.250205.002) gzip"
    private val http=NativeNetwork.client.newBuilder().callTimeout(10,TimeUnit.SECONDS).build()
    data class Audio(val duration:Long,val description:String,val sources:List<PlaybackSource>)
    fun parse(data:JSONObject):Audio {
        val status=data.optJSONObject("playabilityStatus")?.optString("status")
        if(status!="OK")throw YoutubeSourceFailure("playability_denied")
        val formats=data.optJSONObject("streamingData")?.optJSONArray("adaptiveFormats")
        val candidates=(0 until (formats?.length()?:0)).map{formats!!.getJSONObject(it)}
            .filter{it.optString("mimeType").startsWith("audio/") && it.optString("url").startsWith("https://")}
            .sortedWith(compareBy<JSONObject>{if(it.optString("mimeType").startsWith("audio/mp4"))0 else 1}.thenByDescending{it.optLong("bitrate")})
            .map{PlaybackSource(it.getString("url"),it.optString("mimeType").substringBefore(';'))}.distinctBy{it.uri}
        if(candidates.isEmpty())throw YoutubeSourceFailure("direct_audio_unavailable")
        val details=data.optJSONObject("videoDetails")?:JSONObject()
        return Audio(details.optString("lengthSeconds").toLongOrNull()?:0L,details.optString("shortDescription"),candidates)
    }
    fun resolve(videoId:String):Audio {
        require(videoId.matches(Regex("[A-Za-z0-9_-]{11}")))
        val client=JSONObject().put("clientName","ANDROID_MUSIC").put("clientVersion","8.39.42").put("hl","es").put("gl","MX").put("osName","Android").put("osVersion","15").put("androidSdkVersion",35)
        val body=JSONObject().put("context",JSONObject().put("client",client)).put("videoId",videoId).put("contentCheckOk",true).put("racyCheckOk",true)
        return http.newCall(Request.Builder().url("https://music.youtube.com/youtubei/v1/player?prettyPrint=false")
            .header("User-Agent",USER_AGENT).header("X-YouTube-Client-Name","21").header("X-YouTube-Client-Version","8.39.42")
            .post(body.toString().toRequestBody("application/json".toMediaType())).build()).execute().use { response ->
            if(!response.isSuccessful)throw YoutubeSourceFailure("player_http",response.code)
            parse(JSONObject(response.body?.string() ?: throw YoutubeSourceFailure("empty_response")))
        }
    }
}
