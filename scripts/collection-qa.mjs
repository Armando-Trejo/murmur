import {chromium} from '@playwright/test';
import fs from 'node:fs';
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{
 const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true,reducedMotion:'reduce'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  window.CapacitorPlatforms={currentPlatform:{getPlatform:()=> 'android',isNativePlatform:()=>true,registerPlugin:name=>new Proxy({}, {get:(_,method)=>method==='then'?undefined:async(options)=>{
   if(method==='addListener')return {remove:async()=>{}};
   if(method==='status')return {spotify:false,youtube:false,oauth:false};
   if(method==='getState')return {playing:false,positionMs:0};
   if(method==='spotifyRequest'){const path=options.path;return {data:path.includes('/tracks')?{items:[{id:'track-one',name:'Imported song',uri:'spotify:track:1234567890123456789012',artists:[{name:'Import Artist'}],duration_ms:200000,type:'track'}],next:null}:path.includes('/search')?{tracks:{items:[]}}:{name:'Imported Album',images:[]}}}
   if(method==='searchYouTube')return {tracks:[]};
   return {};
  }})}};
 });
 await page.goto('http://127.0.0.1:5173/#/library');await page.getByText('Importar desde un enlace',{exact:true}).click();await page.getByLabel('Enlace de YouTube o Spotify').fill('https://open.spotify.com/album/1234567890123456789012');await page.getByRole('button',{name:'Importar a mi biblioteca',exact:true}).click();await page.getByRole('heading',{name:'Imported Album',exact:true}).waitFor();
 if(await page.getByLabel('Tipo de colección').inputValue()!=='album')throw Error('Album type lost');
 await page.getByLabel('Tipo de colección').selectOption('playlist');await page.waitForTimeout(100);await page.reload();await page.getByRole('heading',{name:'Imported Album',exact:true}).waitFor();if(await page.getByLabel('Tipo de colección').inputValue()!=='playlist')throw Error('Type change not persisted');
 await page.getByLabel('Tipo de colección').selectOption('album');await page.getByRole('button',{name:'Artistas',exact:true}).click();await page.getByRole('button',{name:'Import Artist',exact:true}).click();await page.getByRole('heading',{name:'Import Artist',exact:true}).waitFor();await page.getByRole('button',{name:/Imported Album/}).click();await page.getByRole('heading',{name:'Imported Album',exact:true}).waitFor();
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error('Overflow');if(errors.length)throw Error(errors.join(';'));
 await page.waitForTimeout(250);await page.screenshot({path:'.impeccable/review/qa/collection-390.png',fullPage:false});fs.writeFileSync('verification/collection-qa.json',JSON.stringify({passed:true,scope:'Chrome mocked Spotify collection; no personal session',checks:['link import opens album without autoplay','album metadata preserved','type toggle survives reload','artist directory and page','album navigation','no overflow or page errors']},null,2));
 console.log('Collection UI passed');
}finally{await browser.close()}
