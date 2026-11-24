import {chromium} from '@playwright/test';

import fs from 'node:fs';

fs.mkdirSync('.impeccable/review/qa',{recursive:true});
const art=JSON.parse(fs.readFileSync('verification/music-art-fixtures.json','utf8'));

const tracks=Array.from({length:12},(_,index)=>{const source=art[index%art.length];return {id:'yt:experience-'+index,source:'youtube',videoId:'abcdefghijk',title:source.title+(index===0?' featuring a very long original score title with multiple artists and the complete extended edition':'')+' · QA '+index,artist:source.artist,duration:240,tags:[],saved:true,viewCount:100000-index*1000,artworkUrl:'data:image/jpeg;base64,'+fs.readFileSync(source.image).toString('base64')};});

const fixture={format:'hybrid-sound',version:1,tables:{tracks,playlists:[{id:'local:experience',title:'Mi música · QA',source:'hybrid',trackIds:tracks.map(t=>t.id)}],playlist_overrides:[],history:[{id:1,trackId:tracks[3].id,at:1000,seconds:150,skipped:false}],affinity:[],settings:[]}};

const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});

const results=[];

async function check(page,label){const issue=await page.evaluate(()=>{if(document.documentElement.scrollWidth>innerWidth+1)return 'document overflow';return [...document.querySelectorAll('button,input,select')].some(el=>{const r=el.getBoundingClientRect();return r.width&&r.height&&(r.left< -1||r.right>innerWidth+1)})?'clipped control':''});if(issue)throw Error(label+': '+issue);}

try{

 for(const viewport of [{width:320,height:740},{width:390,height:844},{width:1280,height:900}]){

  const context=await browser.newContext({viewport,hasTouch:true,isMobile:viewport.width<1000,reducedMotion:'reduce'});

  await context.addInitScript(items=>{

   window.__qa={plays:0,seeks:0,queueWrites:0,pauses:0,listenerAdds:0,events:{}};const native={};

   window.CapacitorPlatforms={currentPlatform:{getPlatform:()=> 'android',isNativePlatform:()=>true,registerPlugin:name=>new Proxy({}, {get:(_target,method)=>method==='then'?undefined:async (options,callback)=>{

    if(method==='addListener'){window.__qa.listenerAdds++;(window.__qa.events[options]??=[]).push(callback);return {remove:async()=>{window.__qa.events[options]=window.__qa.events[options].filter(fn=>fn!==callback)}};}

    if(method==='status')return {spotify:true,youtube:true,oauth:true};
    if(method==='youtubeHome')return {shelves:[{title:'Tu selección musical',items:items.slice(0,5).map((t,i)=>({id:t.id,title:'En tu Inicio '+i,artworkUrl:t.artworkUrl,track:{...t,title:'En tu Inicio '+i}}))}]};
    if(method==='spotifyRequest'&&options.path.startsWith('/me/top/tracks'))return {data:{items:[{id:'qa-affinity',name:'De tu cuenta Spotify',uri:'spotify:track:example',duration_ms:240000,artists:[{name:'Música Spotify'}],album:{images:[{url:items[1].artworkUrl}]}}]}};

    if(method==='getState')return {playing:false,positionMs:0};

    if(method==='extractAndPlay'){window.__qa.plays++;return {duration:240,description:'',playing:true,loading:false};}

    if(method==='pause'){window.__qa.pauses++;return {};}
    if(method==='setQueue'){window.__qa.queueWrites++;window.__qa.lastQueue=options;return {};}
    if(method==='seekTo'){window.__qa.seeks++;return {};}

    if(method==='searchYouTube')return {tracks:[...items].reverse()};

    if(method==='spotifyRequest')return {data:{tracks:{items:[]}}};

    return {};

   }})}};

  },tracks);

  const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));

  await page.route('https://lrclib.net/**',route=>route.fulfill({status:404,body:'{}'}));

  await page.goto((process.env.MURMUR_QA_URL || 'http://127.0.0.1:5173')+'/#/connections',{waitUntil:'domcontentloaded',timeout:60000});await page.locator('input[type=file]').setInputFiles({name:'experience-qa.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))});

  await page.getByRole('status').filter({hasText:'Respaldo importado'}).waitFor();await page.getByRole('button',{name:'Cerrar aviso',exact:true}).click();await page.locator('.snackbar').waitFor({state:'detached'});

  const nav=viewport.width<1000?page.locator('.bottom-nav'):page.locator('.desktop-rail');

  await page.getByRole('button',{name:'Menta',exact:true}).click();await page.getByRole('button',{name:'Menta',exact:true}).getAttribute('aria-pressed').then(value=>{if(value!=='true')throw Error('Accent not selected')});

  await page.getByRole('button',{name:'Cerrar aviso',exact:true}).click();await page.locator('.snackbar').waitFor({state:'detached'});

  await check(page,'Appearance');await page.screenshot({path:`.impeccable/review/qa/experience-${viewport.width}-settings.png`,fullPage:true});

  await nav.getByRole('button',{name:'Inicio',exact:true}).click();await page.locator('.mix-collage img').first().waitFor();await page.getByRole('heading',{name:'Tu selección musical'}).waitFor();
  await page.getByText('De tu cuenta Spotify',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Ver más',exact:true}).first().click();await page.getByText('En tu Inicio 4',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Ver menos',exact:true}).first().click();
  await page.locator('.feed-filters').getByRole('button',{name:'Spotify',exact:true}).click();
  await page.getByRole('heading',{name:'Tu selección musical'}).waitFor({state:'hidden'});
  await page.locator('.feed-filters').getByRole('button',{name:'Todos',exact:true}).click();await check(page,'Home artwork');await page.screenshot({path:`.impeccable/review/qa/experience-${viewport.width}-home.png`,fullPage:true});

  const mixTapAt=Date.now();
  const playsBeforeMix=await page.evaluate(()=>window.__qa.plays);
  await page.locator('.mix-collage').first().click();await page.waitForFunction(()=>location.hash.includes('playlist='));if(Date.now()-mixTapAt>=1000)throw Error('Mix navigation exceeded1s');
  await page.locator('.song-row').first().waitFor();if(await page.evaluate(()=>window.__qa.plays)!==playsBeforeMix)throw Error('Mix preview autoplayed');
  await nav.getByRole('button',{name:'Inicio',exact:true}).click();
  const routesAt=Date.now();
  const listenersBefore=await page.evaluate(()=>window.__qa.listenerAdds);
  await page.evaluate(async selector=>{const names=['Inicio','Buscar','Tu Biblioteca','Conexiones'];for(let i=0;i<48;i++){const button=[...document.querySelectorAll(selector+' button')].find(b=>b.textContent.trim()===names[i%4]);button.click();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));}},viewport.width<1000?'.bottom-nav':'.desktop-rail');
  if(await page.evaluate(()=>window.__qa.listenerAdds)!==listenersBefore)throw Error('Native listeners were rebound during rapid navigation');
  const averageRouteMs=(Date.now()-routesAt)/48;if(averageRouteMs>=1000)throw Error('Navigation exceeds1s');
  if(!page.url().includes('/connections'))throw Error('Rapid navigation lost final destination');

  await nav.getByRole('button',{name:'Tu Biblioteca',exact:true}).click();const length=await page.evaluate(()=>history.length);await nav.getByRole('button',{name:'Tu Biblioteca',exact:true}).click();if(await page.evaluate(()=>history.length)!==length)throw Error('Repeated tab created duplicate history');

  if(!(await page.locator('.song-row').first().innerText()).includes(tracks[3].title))throw Error('Listening history not first in library');

  await page.getByRole('button',{name:'Playlists',exact:true}).click();await page.getByRole('button',{name:/Mi música · QA/}).click();await page.getByRole('button',{name:'Reproducir',exact:true}).click();

  await page.getByRole('button',{name:'Abrir reproductor',exact:true}).waitFor();

  const cdp=await context.newCDPSession(page);

  async function swipe(locator,dx,dy,during){await locator.scrollIntoViewIfNeeded();await locator.evaluate(el=>{const panel=el.closest('.expanded-player');const r=el.getBoundingClientRect();const top=panel?0:document.querySelector('.topbar').getBoundingClientRect().bottom;const bottom=panel?innerHeight:document.querySelector('.bottom-shell').getBoundingClientRect().top;const delta=r.top-(top+bottom-r.height)/2;if(panel)panel.scrollTop+=delta;else window.scrollBy({top:delta,behavior:'instant'});});await page.waitForTimeout(50);const box=await locator.boundingBox();const x=box.x+Math.min(box.width/2,75),y=box.y+box.height/2;await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});for(let step=1;step<=8;step++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx*step/8,y:y+dy*step/8}]});await page.waitForTimeout(16);if(step===4&&during)await during();}await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}

  const before=await page.evaluate(()=>window.__qa.plays);

  await swipe(page.locator('.song-row').first().locator('.song-main .cover'),110,3);await page.getByRole('status').filter({hasText:'Añadida a continuación'}).waitFor();

  if(await page.evaluate(()=>window.__qa.plays)!==before)throw Error('Swipe-to-queue accidentally played song');await page.getByRole('button',{name:'Cerrar aviso',exact:true}).click();await page.locator('.snackbar').waitFor({state:'detached'});

  await page.waitForTimeout(480);

  await page.getByRole('button',{name:'Abrir reproductor',exact:true}).click();await page.getByRole('dialog',{name:'Reproductor',exact:true}).waitFor();

  await page.getByRole('button',{name:'Opciones de canción',exact:true}).click();await page.getByRole('dialog',{name:'Acciones de canción',exact:true}).waitFor();

  await page.goBack();await page.getByRole('dialog',{name:'Acciones de canción',exact:true}).waitFor({state:'detached'});if(!(await page.getByRole('dialog',{name:'Reproductor',exact:true}).isVisible()))throw Error('Back closed player underneath sheet');

  await page.goBack();await page.getByRole('dialog',{name:'Reproductor',exact:true}).waitFor({state:'detached',timeout:1500});if(!page.url().includes('playlist='))throw Error('Back lost playlist');

  await page.goForward();await page.getByRole('dialog',{name:'Reproductor',exact:true}).waitFor();if(await page.evaluate(()=>window.__qa.plays)!==before)throw Error('Navigation replayed audio');

  const seek=page.locator('input.seek');await swipe(seek,50,0);if(!(await page.getByRole('dialog',{name:'Reproductor',exact:true}).isVisible()))throw Error('Seeking dismissed the player');

  await page.locator('.now-title .marquee-active').waitFor();
  if(!await page.locator('.now-title .marquee-title').evaluate(el=>el.getBoundingClientRect().height<parseFloat(getComputedStyle(el).fontSize)*1.7))throw Error('Long title wraps across lines');
  await check(page,'Player');await page.screenshot({path:`.impeccable/review/qa/experience-${viewport.width}-player.png`,fullPage:false});

  await page.getByRole('button',{name:'Mostrar cola',exact:true}).click();await page.locator('.queue-item').first().waitFor();await page.waitForFunction(()=>{const r=document.querySelector('.queue-anchor').getBoundingClientRect();return r.top>=0&&r.bottom<innerHeight});const queue=await page.locator('.queue-item strong').allTextContents();

  await swipe(page.locator('.queue-item').first().locator('strong'),0,-90);if(JSON.stringify(await page.locator('.queue-item strong').allTextContents())!==JSON.stringify(queue))throw Error('Queue scroll reordered songs');

  const writesBefore=await page.evaluate(()=>window.__qa.queueWrites);
  await swipe(page.locator('.queue-item').first().locator('.drag-handle'),0,140);await page.waitForTimeout(300);if(JSON.stringify(await page.locator('.queue-item strong').allTextContents())===JSON.stringify(queue))throw Error('Explicit queue grip did not reorder');

  if(await page.evaluate(()=>window.__qa.queueWrites)-writesBefore>1)throw Error('Drag flooded the native queue bridge');
  const orderBefore=await page.locator('.queue-item strong').allTextContents();
  const shuffle=page.getByRole('button',{name:'Volver a sortear la cola',exact:true});
  await shuffle.click();await page.waitForFunction(before=>JSON.stringify([...document.querySelectorAll('.queue-item strong')].map(el=>el.textContent))!==JSON.stringify(before),orderBefore);
  const once=await page.locator('.queue-item strong').allTextContents();await shuffle.click();await page.waitForFunction(before=>JSON.stringify([...document.querySelectorAll('.queue-item strong')].map(el=>el.textContent))!==JSON.stringify(before),once);
  if(await page.evaluate(()=>window.__qa.plays)!==before)throw Error('Shuffle restarted current track');
  const queuedBefore=await page.locator('.queue-item strong').count();
  await swipe(page.locator('.queue-item').first().locator('.drag-handle'),0,140,async()=>{
    await page.getByRole('button',{name:'Opciones de canción',exact:true}).evaluate(el=>el.click());
    await page.getByRole('button',{name:'Añadir a la cola',exact:true}).evaluate(el=>el.click());
    await page.getByRole('dialog',{name:'Acciones de canción',exact:true}).waitFor({state:'detached'});
  });
  await page.waitForFunction(count=>document.querySelectorAll('.queue-item strong').length===count,queuedBefore+1);
  const beforeAdvance=await page.locator('.queue-item strong').allTextContents();await page.waitForTimeout(150);
  await swipe(page.locator('.queue-item').first().locator('.drag-handle'),0,140,async()=>{
    await page.evaluate(()=>{const next=window.__qa.lastQueue.tracks[0];window.__qa.events.onNativeTrackChanged.forEach(fn=>fn({id:next.id,queueId:next.queueId,playing:true,loading:false,transport:'youtube'}));});
  });
  await page.waitForFunction(count=>document.querySelectorAll('.queue-item strong').length===count,beforeAdvance.length-1);
  const afterAdvance=await page.locator('.queue-item strong').allTextContents();
  if(JSON.stringify(afterAdvance)!==JSON.stringify(beforeAdvance.slice(1)))throw Error('Drag retained a removed entry or lost an enqueued entry during native advance');
  await page.locator('.queue-item').first().scrollIntoViewIfNeeded();await check(page,'Queue');await page.screenshot({path:`.impeccable/review/qa/experience-${viewport.width}-queue.png`,fullPage:false});

  const queueBeforeJump=await page.locator('.queue-item strong').allTextContents();
  await page.locator('.queue-track').nth(2).click();
  await page.waitForFunction(count=>document.querySelectorAll('.queue-item').length===count,queueBeforeJump.length-3);
  if(JSON.stringify(await page.locator('.queue-item strong').allTextContents())!==JSON.stringify(queueBeforeJump.slice(3)))throw Error('Queue jump retained earlier entries');
  await page.getByRole('button',{name:'Cerrar reproductor',exact:true}).click();await page.getByRole('dialog',{name:'Reproductor',exact:true}).waitFor({state:'detached',timeout:1500});

  await nav.getByRole('button',{name:'Buscar',exact:true}).click();await page.getByRole('textbox',{name:'Buscar canciones, artistas o conciertos'}).fill('QA');await page.locator('.music-sort select').waitFor();

  if(await page.getByLabel('Orden de búsqueda',{exact:true}).inputValue()!=='relevance')throw Error('Provider relevance not default');
  await page.getByLabel('Orden de búsqueda',{exact:true}).selectOption('popular');
  await page.waitForFunction(()=>document.querySelector('.song-row')?.textContent.includes('QA 0'));
  if(await page.locator('.search-page .song-row').count()!==tracks.length)throw Error('Sort duplicated search rows');

  await page.getByLabel('Orden de búsqueda',{exact:true}).selectOption('listening');await page.waitForFunction(()=>document.querySelector('.song-row')?.textContent.includes('QA 3'));

  await page.getByRole('textbox',{name:'Buscar canciones, artistas o conciertos'}).focus();
  await page.waitForFunction(()=>{const field=document.querySelector('.search-field').getBoundingClientRect(),header=document.querySelector('.topbar').getBoundingClientRect();return field.top>=header.bottom-1&&field.bottom<innerHeight/2});
  await check(page,'Search');await page.screenshot({path:`.impeccable/review/qa/experience-${viewport.width}-search.png`,fullPage:false});

  if(viewport.width===390){await page.emulateMedia({reducedMotion:'no-preference'});await page.getByRole('button',{name:'Abrir reproductor',exact:true}).click();await page.waitForFunction(()=>{const element=document.querySelector('.expanded-player');return !!element&&Number(getComputedStyle(element).opacity)===1;});await page.getByRole('button',{name:'Siguiente',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.art-stage').length===2);await page.screenshot({path:'.impeccable/review/qa/experience-390-transition.png',fullPage:false});await page.waitForFunction(()=>document.querySelectorAll('.art-stage').length===1);await check(page,'Track animation');}

  if(await page.getByRole('dialog',{name:'Reproductor',exact:true}).count()){await page.getByRole('button',{name:'Cerrar reproductor',exact:true}).click();await page.getByRole('dialog',{name:'Reproductor',exact:true}).waitFor({state:'detached',timeout:1500});}

  await nav.getByRole('button',{name:'Tu Biblioteca',exact:true}).click();await page.getByLabel('Crear playlist híbrida',{exact:true}).click();await page.getByLabel('Nombre de la playlist',{exact:true}).fill('Creación QA');await page.getByRole('button',{name:'Crear playlist',exact:true}).click();await page.getByRole('heading',{name:'Creación QA',exact:true}).waitFor();await page.getByRole('dialog',{name:'Crear playlist',exact:true}).waitFor({state:'detached'});await page.goBack();await page.waitForFunction(()=>!location.hash.includes('playlist='));if(await page.evaluate(()=>history.state?.murmur?.sheet?.kind==='create'))throw Error('Back restored a completed creation route');await page.getByRole('dialog',{name:'Crear playlist',exact:true}).waitFor({state:'detached'});

  if(await page.evaluate(()=>window.__qa.events.onAppBackground?.length??0))throw Error('Obsolete background pause listener registered');
  if(errors.length)throw Error(errors.join(';'));

  results.push({viewport,passed:true,averageRouteMs,checks:['48 rapid routes without listener churn','real repeated shuffle without replay','single native queue commit per drag','enqueue and native advance during drag reconcile safely','player closes within1500ms after concurrent drag updates','background pause listener removed; native lifecycle tested separately','remote provider feed and source filter','mix opens preview without autoplay','queue tap discards earlier entries','provider relevance default','search focus stays visible beneath header','queue button scrolls to upcoming tracks','saved accent and original cover pixels','real-art mixes','deduplicated navigation/back/forward/layers','completed creation form stays closed on Back','listening/popularity order','touch swipe does not play','slider does not dismiss','queue text scroll does not reorder']});await context.close();

 }

 fs.writeFileSync('verification/experience-qa.json',JSON.stringify({scope:'Chrome touch input and simulated Capacitor audio/search. Album covers from public metadata in isolated QA fixtures, never bundled. No phone performance or Android notification UI claim.',results},null,2));console.log(JSON.stringify(results));

}finally{await browser.close()}

