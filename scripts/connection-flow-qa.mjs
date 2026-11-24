import { chromium } from '@playwright/test';
import fs from 'node:fs';
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const results=[];
try{
 for(const viewport of [{width:320,height:740},{width:390,height:844},{width:1280,height:900}]){
  const context=await browser.newContext({viewport,reducedMotion:'reduce'});
  await context.addInitScript(()=>{
   let mode='integrated';let web=false;const listeners={};
   const status=()=>({spotify:false,youtube:false,oauth:web,spotifyPlaybackMode:mode,spotifyWebAuthorized:web});
   window.CapacitorPlatforms={currentPlatform:{getPlatform:()=> 'android',isNativePlatform:()=>true,registerPlugin:(name)=>new Proxy({}, {get:(_target,method)=>method==='then'?undefined:async options=>{
    if(method==='addListener')return {remove:async()=>{}};
    if(name==='AuthBridge'){
     if(method==='status')return status();
     if(method==='setSpotifyPlaybackMode'){mode=options.mode;return status();}
     if(method==='oauthLogin'){web=true;return {};}
    }
    if(method==='getState')return {playing:false,positionMs:0};
    return {};
   }})}};
  });
  const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:5173/#/connections');await page.getByLabel('Reproducción de Spotify',{exact:true}).selectOption('web');
  await page.getByText('Pendiente de renovar Autorizar Spotify',{exact:false}).waitFor();
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);if(overflow)throw Error('Web mode horizontal overflow');
  await page.screenshot({path:`.impeccable/review/qa/${viewport.width}x${viewport.height}-web-mode-simulated.png`,fullPage:true});
  await page.getByRole('button',{name:'Autorizar Spotify',exact:true}).click();await page.getByText('Permisos Web autorizados.',{exact:false}).waitFor();
  if(errors.length)throw Error(errors.join(';'));results.push({viewport,passed:true});await context.close();
 }
 fs.writeFileSync('verification/connection-flow-qa.json',JSON.stringify({scope:'Chrome with simulated Capacitor state and OAuth. Layout/control wiring only, no Android or actual account/audio claim.',results},null,2));
 console.log(JSON.stringify(results));
}finally{await browser.close();}
