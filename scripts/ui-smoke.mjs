import { chromium } from '@playwright/test';
import fs from 'node:fs';
fs.mkdirSync('.impeccable/review',{recursive:true}); fs.mkdirSync('verification',{recursive:true});
const browser = await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const errors=[]; const results=[];
try {
 for (const viewport of [{width:390,height:844},{width:1280,height:900}]) {
  const context = await browser.newContext({viewport,reducedMotion:'reduce'}); const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:5173'); await page.getByRole('heading',{name:'Tu música. Sin fronteras.'}).waitFor();
  const name=viewport.width<600?'browser-mobile':'browser-desktop'; await page.screenshot({path:'.impeccable/review/'+name+'.png',fullPage:true});
  await page.getByRole('button',{name:'Solo YouTube',exact:true}).click(); await page.getByRole('heading',{name:'El otro lado de tu música'}).waitFor();
  if (await page.locator('.mix-card').count() !== 1 || !(await page.locator('.mix-card').innerText()).includes('OTHER')) throw new Error('YouTube filter mix identity mismatch');
  await page.screenshot({path:'.impeccable/review/'+name+'-youtube.png',fullPage:true});
  await page.getByRole('button',{name:'Música',exact:true}).click(); await page.getByRole('heading',{name:'Tu música en Spotify'}).waitFor();
  await page.getByRole('button',{name:'Mix Híbrido',exact:true}).click(); await page.getByRole('heading',{name:'Tus playlists híbridas'}).waitFor();
  await page.getByRole('button',{name:'Todo',exact:true}).click();
  if (await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)) throw new Error('Horizontal overflow at '+viewport.width);
  const nav=viewport.width<1000?page.getByRole('navigation',{name:'Navegación principal'}):page.locator('.desktop-rail');
  await nav.getByRole('button',{name:'Buscar',exact:true}).click(); await page.getByRole('textbox',{name:'Buscar canciones, artistas o conciertos'}).fill('caifanes');
  await page.getByRole('heading',{name:'Sin resultados'}).waitFor();
  await nav.getByRole('button',{name:'Tu Biblioteca',exact:true}).click(); await page.getByRole('button',{name:'Crear playlist híbrida',exact:true}).click();
  await page.getByRole('textbox',{name:'Nombre de la playlist'}).fill('Noche sin fronteras'); await page.getByRole('button',{name:'Crear playlist',exact:true}).click();
  await page.getByRole('heading',{name:'Noche sin fronteras',exact:true}).waitFor();
  await nav.getByRole('button',{name:'Conexiones',exact:true}).click(); await page.getByRole('heading',{name:'Tus dos mundos'}).waitFor();
  await page.getByRole('button',{name:'DJ 10s',exact:true}).click();
  await page.getByRole('button',{name:'Importar JSON'}).click({trial:true});
  const backup={format:'hybrid-sound',version:1,tables:{tracks:[{id:'yt:testfixture',source:'youtube',videoId:'abcdefghijk',title:'Prueba de biblioteca',artist:'Artista de prueba',duration:245,tags:['live']}],playlists:[],playlist_overrides:[],history:[],affinity:[],settings:[]}};
  await page.locator('input[type=file]').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});
  await page.getByRole('status').filter({hasText:'Respaldo importado'}).waitFor();
  await page.getByRole('button',{name:'Cerrar aviso'}).click(); await page.waitForTimeout(300); await page.screenshot({path:'.impeccable/review/'+name+'-connections.png',fullPage:true});
  await nav.getByRole('button',{name:'Tu Biblioteca',exact:true}).click(); await page.getByRole('button',{name:'Canciones',exact:true}).click();
  await page.getByText('Prueba de biblioteca',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Opciones de Prueba de biblioteca'}).click(); await page.getByRole('button',{name:'Guardar en Playlist Híbrida'}).click();
  await page.getByRole('button',{name:'Noche sin fronteras'}).click(); await page.getByRole('status').filter({hasText:'Añadida a Noche sin fronteras'}).waitFor();
  await page.reload(); await nav.getByRole('button',{name:'Tu Biblioteca',exact:true}).click(); await page.getByRole('button',{name:'Playlists',exact:true}).click();
  await page.getByRole('button',{name:/Noche sin fronteras/}).click(); await page.getByText('Prueba de biblioteca',{exact:true}).waitFor();
  results.push({viewport,passed:['home render','no horizontal overflow','search empty state','create playlist','mix setting','backup import','add playlist track','reload persistence']});
  await context.close();
 }
 if(errors.length) throw new Error(errors.join('\n'));
 fs.writeFileSync('verification/ui-smoke.json',JSON.stringify({runtime:'desktop Chrome; browser preview only, not Android device verification',results,errors},null,2)); console.log(JSON.stringify({results,errors},null,2));
} finally {await browser.close();}
