// Evaluates an expression in MURMUR's WebView through the forwarded DevTools socket.
// Usage: node cdp.mjs "<expression>"   (port 9222 forwarded with adb)
const expression = process.argv[2];
const targets = await (await fetch("http://127.0.0.1:9222/json")).json();
const page = targets.find((t) => t.type === "page" && t.url.startsWith("https://localhost"));
if (!page) { console.log("NO_PAGE", JSON.stringify(targets.map((t) => t.url))); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
const result = await new Promise((resolve) => {
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id === 1) resolve(d.result); };
  ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
});
console.log(JSON.stringify(result.result?.value ?? result.exceptionDetails ?? result, null, 1));
ws.close();
