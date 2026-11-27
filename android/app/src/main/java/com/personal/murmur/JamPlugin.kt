package com.personal.murmur

import com.getcapacitor.*
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.OutputStream
import java.net.Inet4Address
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import java.security.SecureRandom
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * JAM: people nearby add songs to MURMUR's queue from their own browser, without installing anything.
 * The phone serves a small web page on the local network (same Wi-Fi or the phone's hotspot):
 * the QR carries http://<ip>:<port>/j/<token>/. Guests only reach this page and its API, and only
 * with the token of the JAM that is running. The queue logic stays in MURMUR's web layer: requests
 * go there as "jamRequest" events and come back through respond().
 */
@CapacitorPlugin(name = "Jam")
class JamPlugin : Plugin() {
    private var server: ServerSocket? = null
    private val pool = Executors.newFixedThreadPool(6)
    @Volatile private var token = ""
    /** Latest state the app published (now playing + queue), served directly so polling never waits on the web layer. */
    @Volatile private var state = "{\"active\":false}"
    private val pending = ConcurrentHashMap<String, CompletableFuture<Pair<Int, String>>>()
    private val counter = AtomicInteger()

    @PluginMethod fun start(call: PluginCall) {
        val ip = localAddress() ?: return call.reject("Conéctate a una red Wi-Fi o enciende el hotspot del teléfono para empezar un JAM.", "JAM_NO_NETWORK")
        if (server == null || server!!.isClosed) {
            token = newToken()
            val socket = ServerSocket()
            socket.reuseAddress = true
            val port = PORTS.firstOrNull { runCatching { socket.bind(InetSocketAddress(it)) }.isSuccess }
                ?: runCatching { socket.bind(InetSocketAddress(0)); socket.localPort }.getOrNull()
                ?: return call.reject("No se pudo abrir el JAM en este teléfono.")
            server = socket
            Thread({ acceptLoop(socket) }, "murmur-jam").apply { isDaemon = true }.start()
            android.util.Log.i(DEBUG_TAG, "jam started on $ip:$port")
        }
        val port = server!!.localPort
        call.resolve(JSObject().put("url", "http://$ip:$port/j/$token/").put("ip", ip).put("port", port).put("token", token))
    }

    @PluginMethod fun stop(call: PluginCall) {
        runCatching { server?.close() }
        server = null
        token = ""
        state = "{\"active\":false}"
        pending.values.forEach { it.complete(410 to "{\"error\":\"La JAM terminó\"}") }
        pending.clear()
        call.resolve()
    }

    /** The network address can change (another Wi-Fi, hotspot on): the app asks again for a fresh QR. */
    @PluginMethod fun address(call: PluginCall) {
        val ip = localAddress()
        val running = server?.isClosed == false
        call.resolve(JSObject().put("ip", ip).put("running", running)
            .put("url", if (running && ip != null) "http://$ip:${server!!.localPort}/j/$token/" else null))
    }

    @PluginMethod fun publish(call: PluginCall) {
        call.getString("state")?.takeIf { it.length < 400_000 }?.let { state = it }
        call.resolve()
    }

    @PluginMethod fun respond(call: PluginCall) {
        val id = call.getString("id") ?: return call.reject("Falta la solicitud")
        pending.remove(id)?.complete((call.getInt("status") ?: 200) to (call.getString("body") ?: "{}"))
        call.resolve()
    }

    override fun handleOnDestroy() {
        runCatching { server?.close() }
        pool.shutdownNow()
        super.handleOnDestroy()
    }

    private fun acceptLoop(socket: ServerSocket) {
        while (!socket.isClosed) {
            val client = runCatching { socket.accept() }.getOrNull() ?: break
            runCatching { pool.execute { serve(client) } }.onFailure { runCatching { client.close() } }
        }
    }

    private fun serve(client: Socket) = client.use { s ->
        runCatching {
            s.soTimeout = 15_000
            val input = BufferedInputStream(s.getInputStream())
            val line = readLine(input) ?: return@use
            val parts = line.split(" ")
            if (parts.size < 2) return@use
            val method = parts[0]
            val target = parts[1]
            val headers = mutableMapOf<String, String>()
            while (true) {
                val header = readLine(input) ?: break
                if (header.isEmpty()) break
                val colon = header.indexOf(':')
                if (colon > 0) headers[header.substring(0, colon).trim().lowercase()] = header.substring(colon + 1).trim()
                if (headers.size > 60) break
            }
            val length = headers["content-length"]?.toIntOrNull() ?: 0
            if (length > MAX_BODY) return@use send(s.getOutputStream(), 413, "application/json", "{\"error\":\"Demasiado grande\"}".toByteArray())
            val body = ByteArray(length).also { var read = 0; while (read < length) { val n = input.read(it, read, length - read); if (n < 0) break; read += n } }
            route(s.getOutputStream(), method, target, headers, String(body, Charsets.UTF_8), s.inetAddress?.hostAddress ?: "")
        }
    }

    private fun route(out: OutputStream, method: String, target: String, headers: Map<String, String>, body: String, ip: String) {
        val path = target.substringBefore('?')
        val query = target.substringAfter('?', "")
        if (path == "/" || path == "/favicon.ico") return send(out, 404, "text/plain; charset=utf-8", "MURMUR JAM".toByteArray())
        val match = Regex("^/j/([A-Za-z0-9]{6,16})(/.*)?$").find(path)
        val current = token
        if (match == null || current.isEmpty() || match.groupValues[1] != current)
            return sendAsset(out, "ended.html", 404)
        if (match.groupValues[2].isEmpty()) {
            out.write("HTTP/1.1 301 Moved Permanently\r\nLocation: /j/$current/\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray(Charsets.ISO_8859_1))
            return out.flush()
        }
        val rest = match.groupValues[2]
        when {
            rest == "/" || rest == "/index.html" -> {
                // Link previews (WhatsApp, Telegram…) need absolute addresses: the page gets this JAM's own.
                val host = headers["host"]?.takeIf { it.matches(Regex("[A-Za-z0-9.:-]{3,80}")) }
                    ?: "${localAddress()}:${server?.localPort}"
                sendAsset(out, "index.html", origin = "http://$host/j/$current/")
            }
            rest == "/api/state" -> send(out, 200, "application/json; charset=utf-8", state.toByteArray())
            rest.startsWith("/api/") -> {
                if (method != "GET" && method != "POST") return send(out, 405, "application/json", "{}".toByteArray())
                val name = rest.removePrefix("/api/")
                if (!name.matches(Regex("[a-z]{2,20}"))) return send(out, 404, "application/json", "{}".toByteArray())
                val id = "j" + counter.incrementAndGet()
                val future = CompletableFuture<Pair<Int, String>>()
                pending[id] = future
                val params = JSObject()
                query.split('&').filter { it.contains('=') }.take(20).forEach {
                    params.put(URLDecoder.decode(it.substringBefore('='), "UTF-8"), URLDecoder.decode(it.substringAfter('='), "UTF-8").take(300))
                }
                val event = JSObject().put("id", id).put("name", name).put("method", method).put("params", params)
                    .put("body", body.take(MAX_BODY)).put("guest", (headers["x-jam-guest"] ?: "").take(80)).put("ip", ip)
                notifyListeners("jamRequest", event)
                val (status, response) = runCatching { future.get(20, TimeUnit.SECONDS) }.getOrElse { 504 to "{\"error\":\"MURMUR tardó en responder. Intenta de nuevo.\"}" }
                pending.remove(id)
                send(out, status, "application/json; charset=utf-8", response.toByteArray())
            }
            rest.matches(Regex("^/[a-z0-9_-]{1,40}\\.(png|jpg|svg|css|js|webmanifest)$")) -> sendAsset(out, rest.removePrefix("/"))
            else -> send(out, 404, "text/plain; charset=utf-8", "No encontrado".toByteArray())
        }
    }

    private fun sendAsset(out: OutputStream, name: String, status: Int = 200, origin: String? = null) {
        val raw = runCatching { context.assets.open("public/jam/$name").use { it.readBytes() } }.getOrNull()
            ?: return send(out, 404, "text/plain; charset=utf-8", "No encontrado".toByteArray())
        val bytes = if (origin != null) String(raw, Charsets.UTF_8).replace("{{ORIGIN}}", origin).toByteArray() else raw
        val type = when (name.substringAfterLast('.')) {
            "html" -> "text/html; charset=utf-8"; "png" -> "image/png"; "jpg" -> "image/jpeg"; "svg" -> "image/svg+xml"
            "css" -> "text/css; charset=utf-8"; "js" -> "text/javascript; charset=utf-8"; else -> "application/manifest+json"
        }
        send(out, status, type, bytes, cache = name.endsWith(".png") || name.endsWith(".jpg") || name.endsWith(".svg"))
    }

    private fun send(out: OutputStream, status: Int, type: String, bytes: ByteArray, cache: Boolean = false) {
        val reason = mapOf(200 to "OK", 404 to "Not Found", 405 to "Method Not Allowed", 410 to "Gone", 413 to "Payload Too Large", 429 to "Too Many Requests", 400 to "Bad Request", 504 to "Gateway Timeout")[status] ?: "OK"
        val head = "HTTP/1.1 $status $reason\r\nContent-Type: $type\r\nContent-Length: ${bytes.size}\r\n" +
            "Cache-Control: ${if (cache) "max-age=86400" else "no-store"}\r\nX-Content-Type-Options: nosniff\r\n" +
            "Referrer-Policy: no-referrer\r\nConnection: close\r\n\r\n"
        out.write(head.toByteArray(Charsets.ISO_8859_1))
        out.write(bytes)
        out.flush()
    }

    private fun readLine(input: BufferedInputStream): String? {
        val buffer = ByteArrayOutputStream()
        while (true) {
            val b = input.read()
            if (b < 0) return if (buffer.size() == 0) null else buffer.toString("UTF-8")
            if (b == '\n'.code) break
            if (b != '\r'.code) buffer.write(b)
            if (buffer.size() > 8192) return null
        }
        return buffer.toString("UTF-8")
    }

    private fun newToken(): String {
        val alphabet = "abcdefghjkmnpqrstuvwxyz23456789"
        val random = SecureRandom()
        return (1..8).map { alphabet[random.nextInt(alphabet.length)] }.joinToString("")
    }

    /** The phone's address on the Wi-Fi or on its own hotspot (IPv4, private range). */
    private fun localAddress(): String? {
        val candidates = runCatching { NetworkInterface.getNetworkInterfaces().toList() }.getOrDefault(emptyList())
            .filter { runCatching { it.isUp && !it.isLoopback }.getOrDefault(false) }
            .flatMap { nic -> nic.inetAddresses.toList().filterIsInstance<Inet4Address>().filter { it.isSiteLocalAddress }.map { nic.name to it.hostAddress } }
        val rank = { name: String -> when { name.startsWith("wlan") -> 0; name.startsWith("ap") || name.startsWith("swlan") || name.contains("softap") -> 1; name.startsWith("eth") -> 2; name.startsWith("rndis") -> 3; else -> 4 } }
        // Mobile data addresses (rmnet, ccmni) are not reachable by people nearby.
        return candidates.filterNot { it.first.startsWith("rmnet") || it.first.startsWith("ccmni") || it.first.startsWith("v4-") }
            .minByOrNull { rank(it.first) }?.second
    }

    private companion object {
        val PORTS = listOf(8737, 8738, 8739, 8747)
        const val MAX_BODY = 32_000
    }
}
