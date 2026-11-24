package com.personal.murmur

import android.os.Looper
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.CompletableFuture
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
@Config(manifest=Config.NONE,sdk=[28])
class LoopbackOAuthServerTest {
    @Test fun realSocketAnswersBrowserAndDeliversCallbackWithoutEchoingCode() {
        val port=ServerSocket(0).use{it.localPort};val scope=CoroutineScope(SupervisorJob()+Dispatchers.Main)
        val callback=CompletableFuture<android.net.Uri>();val error=CompletableFuture<String>()
        val server=LoopbackOAuthServer(scope,{callback.complete(it)},{error.complete(it)},port,"/login")
        val worker=Executors.newSingleThreadExecutor()
        fun request(path:String)=worker.submit<String>{Socket("127.0.0.1",port).use{socket->socket.soTimeout=3000;socket.getOutputStream().write("GET $path HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n".toByteArray());socket.getInputStream().bufferedReader().readText()}}.get(4,TimeUnit.SECONDS)
        try {
            server.start();val rejected=request("/favicon.ico");assertTrue(rejected.startsWith("HTTP/1.1 404"));assertFalse(callback.isDone)
            val response=request("/login?code=synthetic-only&state=test-state")
            assertTrue(response.startsWith("HTTP/1.1 200"));assertTrue(response.contains("Volver a MURMUR"));assertFalse(response.contains("synthetic-only"))
            val deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(3)
            while(!callback.isDone && System.nanoTime()<deadline){shadowOf(Looper.getMainLooper()).idle();Thread.sleep(5)}
            assertEquals("synthetic-only",callback.get(1,TimeUnit.SECONDS).getQueryParameter("code"));assertFalse(error.isDone)
        }finally{server.stop();scope.cancel();worker.shutdownNow()}
    }
}
