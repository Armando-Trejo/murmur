package com.personal.murmur
object OAuthCallbackRequest {
    fun target(line: String, callbackPath: String = "/callback"): String? {
        if (line.length > 8192) return null
        val parts = line.split(' ')
        if(parts.size != 3 || parts[0] != "GET" || !parts[2].startsWith("HTTP/1.")) return null
        val path = parts[1]
        if(!path.startsWith("$callbackPath?") || path.contains('#') || path.contains('\\')) return null
        return path
    }
    fun validState(expected: String?, received: String?, startedAt: Long, now: Long): Boolean = !expected.isNullOrBlank() && expected == received && now - startedAt in 0..600000
}
