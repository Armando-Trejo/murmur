import { chromium } from '@playwright/test';
import fs from 'node:fs';
const png=path=>'data:image/png;base64,'+fs.readFileSync(path).toString('base64');
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try {
 const page=await browser.newPage({viewport:{width:720,height:440}});
 await page.setContent(`<body style="margin:0;background:#000;color:#aaa;font:14px system-ui;display:flex;align-items:center;justify-content:space-around;height:100vh;text-align:center"><div><img src="${png('android/app/src/main/res/drawable-nodpi/murmur_lockup.png')}" width="320" height="320"><p>Recurso de apertura</p></div><div><img src="${png('android/app/src/main/res/drawable-nodpi/murmur_launcher.png')}" width="160" height="160" style="border-radius:36px;background:#121212"><p>Recurso de icono adaptativo</p></div></body>`);
 await page.locator('img').evaluateAll(images=>Promise.all(images.map(i=>i.decode())));
 await page.screenshot({path:'.impeccable/review/qa/logo-new.png'});
 console.log('Captured supplied logo resources on black; this is not an Android runtime screenshot.');
}finally{await browser.close()}
