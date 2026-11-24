package com.personal.murmur

import android.net.Uri
import kotlinx.coroutines.*
import java.net.InetAddress
import java.net.ServerSocket
import java.net.SocketException

class LoopbackOAuthServer(private val scope: CoroutineScope, private val callback: (Uri) -> Unit, private val failure: (String) -> Unit, private val port: Int = 43821, private val callbackPath: String = "/callback") {
    companion object { const val REDIRECT = "http://127.0.0.1:43821/callback" }
    private var socket: ServerSocket? = null
    private var job: Job? = null
    fun start() {
        val server = ServerSocket().apply { reuseAddress=true;bind(java.net.InetSocketAddress(InetAddress.getByName("127.0.0.1"),port),4);soTimeout = 600000 }
        socket = server
        job = scope.launch(Dispatchers.IO) {
            try {
                while (isActive && !server.isClosed) {
                    var accepted: Uri? = null
                    server.accept().use { client ->
                        client.soTimeout = 5000
                        val input=client.getInputStream(); val lineBuffer=StringBuilder()
                        while(lineBuffer.length<=8192) { val next=input.read(); if(next<0 || next==10)break; if(next!=13)lineBuffer.append(next.toChar()) }
                        val line=lineBuffer.toString()
                        val target = OAuthCallbackRequest.target(line,callbackPath)
                        val ok = target != null
                        if (target != null) accepted = Uri.parse("http://127.0.0.1:$port$target")
                        val html = if(ok) "<!doctype html><html lang='es'><meta name='viewport' content='width=device-width'><title>MURMUR</title><body style='background:#000;color:#fff;font-family:sans-serif;padding:40px'><h1>MURMUR</h1><p>Solicitud recibida. Vuelve a la aplicación para comprobar la autorización.</p><a style='color:#fff' href='com.personal.murmur://oauth-return'>Volver a MURMUR</a></body></html>" else "Not found"
                        val bytes = html.toByteArray(Charsets.UTF_8)
                        val headers = "HTTP/1.1 ${if(ok) "200 OK" else "404 Not Found"}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: ${bytes.size}\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: default-src 'none'; style-src 'unsafe-inline'\r\nConnection: close\r\n\r\n"
                        // The browser may close its tab as soon as it dispatches the redirect.
                        // A broken response socket must not discard an already received code.
                        try {client.getOutputStream().apply { write(headers.toByteArray()); write(bytes); flush() }}catch(_:java.io.IOException){}
                    }
                    if(accepted != null) { withContext(Dispatchers.Main) { callback(accepted!!) }; break }
                }
            } catch (e: Exception) { if (!server.isClosed && isActive) withContext(Dispatchers.Main) { failure("La autorización local caducó. Pulsa Autorizar Spotify para intentarlo de nuevo.") } }
            finally { server.close(); if (socket === server) socket = null }
        }
    }
    fun stop() { socket?.close(); socket = null; job?.cancel(); job = null }
}
