// Builds public/jam/og.jpg: the card WhatsApp, Telegram or iMessage show when a JAM link is shared.
// Uso: node scripts/build-jam-card.mjs   (needs Google Chrome installed)
import { chromium } from "@playwright/test";
import fs from "node:fs";

const mark = "data:image/png;base64," + fs.readFileSync("src/assets/murmur-mark.png").toString("base64");
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
*{margin:0;box-sizing:border-box}
body{width:1200px;height:630px;background:#000;color:#fff;font-family:Inter,"Segoe UI",Roboto,sans-serif;overflow:hidden;position:relative}
.fluid{position:absolute;inset:-20%;filter:blur(70px) saturate(1.2)}
.fluid i{position:absolute;border-radius:50%;mix-blend-mode:screen}
.a{width:620px;height:620px;left:560px;top:40px;background:#7c5cff}
.b{width:520px;height:520px;left:860px;top:330px;background:#ff8fd3;opacity:.85}
.c{width:460px;height:460px;left:700px;top:-120px;background:#2f6bff;opacity:.8}
.grid{position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.06) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.06) 1px,transparent 1px);background-size:60px 60px}
.topo{position:absolute;right:-80px;top:-60px;width:760px;height:760px}
.wrap{position:absolute;inset:64px 72px;display:flex;flex-direction:column;justify-content:space-between}
.top{display:flex;align-items:center;gap:18px}
.top img{width:64px;height:64px}
.word{font-weight:650;letter-spacing:.32em;font-size:26px}
.tag{font-family:ui-monospace,Consolas,monospace;font-weight:800;font-size:20px;letter-spacing:.14em;color:#000;background:#b69aff;padding:8px 14px;border-radius:8px}
h1{font-size:104px;line-height:.95;letter-spacing:-.045em;font-weight:800;max-width:760px}
h1 em{font-style:normal;background:linear-gradient(90deg,#b69aff,#ff8fd3);-webkit-background-clip:text;color:transparent}
.foot{display:flex;align-items:flex-end;justify-content:space-between;gap:40px}
p{font-size:30px;line-height:1.35;color:#d4d4d8;max-width:640px}
.mono{font-family:ui-monospace,Consolas,monospace;font-size:18px;letter-spacing:.16em;color:rgba(255,255,255,.88);text-transform:uppercase;text-align:right;line-height:1.8}
</style></head><body>
<div class="fluid"><i class="a"></i><i class="b"></i><i class="c"></i></div>
<div class="grid"></div>
<svg class="topo" viewBox="0 0 760 760" fill="none" stroke="rgba(255,255,255,.22)" stroke-width="1.4">
${Array.from({ length: 11 }, (_, k) => {
  const r = 70 + k * 30;
  const pts = Array.from({ length: 73 }, (_, i) => {
    const t = (i / 72) * Math.PI * 2;
    const w = r + Math.sin(t * 3 + k * 0.7) * (8 + k * 1.6) + Math.cos(t * 5 - k) * 5;
    return `${(380 + Math.cos(t) * w).toFixed(1)},${(380 + Math.sin(t) * w * 0.92).toFixed(1)}`;
  });
  return `<polyline points="${pts.join(" ")}"/>`;
}).join("")}
</svg>
<div class="wrap">
  <div class="top"><img src="${mark}"><span class="word">MURMUR</span><span class="tag">JAM</span></div>
  <h1>Pon tu música en <em>mi JAM</em></h1>
  <div class="foot"><p>Busca, añade y ordena canciones desde tu navegador. Sin instalar nada.</p><div class="mono">En vivo<br>misma red wi-fi</div></div>
</div>
</body></html>`;

const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.setContent(html);
  await page.locator("img").evaluateAll((images) => Promise.all(images.map((i) => i.decode())));
  await page.screenshot({ path: "public/jam/og.jpg", type: "jpeg", quality: 86 });
  console.log("public/jam/og.jpg");
} finally {
  await browser.close();
}
