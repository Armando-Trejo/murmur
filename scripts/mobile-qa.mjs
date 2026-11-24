import { chromium } from '@playwright/test';
import fs from 'node:fs';
fs.mkdirSync('.impeccable/review/qa',{recursive:true});
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const errors=[]; const results=[];
const title='Canción con un título muy largo para comprobar que los controles y la carátula permanecen dentro de la pantalla';
const colorArt='data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><path fill="#ed2945" d="M0 0h40v120H0z"/><path fill="#16ad67" d="M40 0h40v120H40z"/><path fill="#2f73ef" d="M80 0h40v120H80z"/></svg>').toString('base64');
const fixture={format:'hybrid-sound',version:1,tables:{tracks:[{id:'yt:qa-layout',videoId:'abcdefghijk',source:'youtube',title,artist:'Artista con metadatos largos para la comprobación de interfaz',duration:245,tags:['live'],chapters:[{title:'Capítulo extenso de un concierto para comprobar el ajuste de línea',positionMs:0}]}],playlists:[{id:'local:qa-layout',title:'Playlist de comprobación con un nombre largo que debe ajustarse sin desplazarse hacia los lados',source:'hybrid',trackIds:['yt:qa-layout']}],playlist_overrides:[],history:[],affinity:[],settings:[]}};
async function assertLayout(page,label) {
  const issue=await page.evaluate(()=>{
    const width=innerWidth;
    if(document.documentElement.scrollWidth>width+1)return 'Page width '+document.documentElement.scrollWidth+' > '+width;
    const scrolls=[...document.querySelectorAll('*')].filter(el=>{const css=getComputedStyle(el);return ['auto','scroll'].includes(css.overflowX)&&el.scrollWidth>el.clientWidth+1&&el.clientWidth>0;}).map(el=>el.className);
    if(scrolls.length)return 'Horizontal scroll containers: '+scrolls.join(',');
    const out=[...document.querySelectorAll('button,input,select')].filter(el=>{const rect=el.getBoundingClientRect();return rect.width>0&&rect.height>0&&(rect.right>width+1||rect.left< -1);}).map(el=>el.getAttribute('aria-label')||el.textContent?.slice(0,50));
    return out.length ? 'Clipped controls: '+out.join(',') : '';
  });
  if(issue)throw new Error(label+': '+issue);
}
async function assertArtworkColor(page) {
 const image=page.locator('img.cover').first();await image.waitFor();await image.evaluate(el=>el.decode());await image.scrollIntoViewIfNeeded();await image.evaluate(el=>{const r=el.getBoundingClientRect();const header=document.querySelector('.topbar')?.getBoundingClientRect().bottom||0;const bottom=document.querySelector('.bottom-shell')?.getBoundingClientRect().top||innerHeight;if(r.top<header+8||r.bottom>bottom-8)window.scrollBy({top:r.top-(header+bottom-r.height)/2,behavior:'instant'})});
 const filters=await image.evaluate(el=>{const result=[];for(let node=el;node;node=node.parentElement)result.push(getComputedStyle(node).filter);return result});
 if(filters.some(value=>/grayscale|saturate\(0\)/.test(value)))throw Error('Artwork color was removed');
 const png=(await image.screenshot()).toString('base64');
 const colored=await page.evaluate(async data=>{const bitmap=new Image();bitmap.src='data:image/png;base64,'+data;await bitmap.decode();const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const c=canvas.getContext('2d');c.drawImage(bitmap,0,0);const rgba=c.getImageData(Math.floor(canvas.width/2),Math.floor(canvas.height/2),1,1).data;return Math.max(...rgba.slice(0,3))-Math.min(...rgba.slice(0,3))>50},png);
 if(!colored){await page.screenshot({path:'.impeccable/review/qa/color-diagnostic.png'});throw Error('Rendered cover lost its color at '+JSON.stringify(page.viewportSize())+' '+JSON.stringify(await image.boundingBox()))}
}
fixture.tables.tracks[0].artworkUrl=colorArt;
fixture.tables.playlists[0].artworkUrl=colorArt;
try {
 for(const scenario of [{width:320,height:740,scale:1},{width:360,height:800,scale:1},{width:390,height:844,scale:1},{width:412,height:915,scale:1},{width:480,height:854,scale:1},{width:390,height:844,scale:1.3},{width:320,height:740,scale:2},{width:844,height:390,scale:1},{width:1280,height:900,scale:1}]) {
  const {scale,...viewport}=scenario;const context=await browser.newContext({viewport,reducedMotion:'reduce'});const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:5173/#/home');if(scale!==1)await page.addStyleTag({content:`html{font-size:${16*scale}px}`});await page.getByRole('heading',{name:'Mixes de MURMUR'}).waitFor();
  const tag=`${viewport.width}x${viewport.height}-${scale}`; const capture=scale===1&&[320,390,1280].includes(viewport.width);
  await assertLayout(page,tag+' Inicio');if(capture)await page.screenshot({path:`.impeccable/review/qa/${tag}-home.png`,fullPage:true});
  const nav=viewport.width<1000?page.locator('.bottom-nav'):page.locator('.desktop-rail');
  await nav.getByRole('button',{name:'Buscar',exact:true}).click();await assertLayout(page,tag+' Buscar');
  await page.getByRole('textbox',{name:'Buscar canciones, artistas o conciertos'}).fill('Una consulta suficientemente larga para comprobar el campo de búsqueda');await page.getByRole('heading',{name:'Sin resultados'}).waitFor();
  if(capture)await page.screenshot({path:`.impeccable/review/qa/${tag}-search.png`,fullPage:true});
  await nav.getByRole('button',{name:'Tu Biblioteca',exact:true}).click();await assertLayout(page,tag+' Biblioteca vacía');
  await nav.getByRole('button',{name:'Conexiones',exact:true}).click();await page.getByRole('heading',{name:'Spotify',exact:true}).waitFor();await assertLayout(page,tag+' Conexiones');
  if(capture)await page.screenshot({path:`.impeccable/review/qa/${tag}-connections.png`,fullPage:true});
  await page.getByText('El navegador no regresó',{exact:true}).click();
  if(!(await page.getByRole('button',{name:'Completar autorización',exact:true}).isDisabled()))throw Error('Recovery enabled with no return URL');
  await page.getByLabel('Enlace de retorno del motor',{exact:true}).fill('http://127.0.0.1:5588/login?code=synthetic&state=qa');
  await assertLayout(page,tag+' OAuth recovery');
  if(capture)await page.screenshot({path:`.impeccable/review/qa/${tag}-oauth-recovery.png`,fullPage:true});
  await page.getByLabel('Enlace de retorno del motor',{exact:true}).fill('');await page.getByText('El navegador no regresó',{exact:true}).click();
  const clientId=page.getByRole('textbox',{name:'Client ID de Spotify',exact:true});
  if(!(await clientId.isVisible()))await page.getByText('Configuración de Spotify',{exact:true}).click();
  await clientId.fill('');
  if(!(await page.getByRole('button',{name:'Autorizar Spotify',exact:true}).isDisabled()))throw Error('OAuth enabled without Client ID');
  await clientId.fill('0123456789abcdef0123456789abcdef');
  await page.getByText('Configuración de Spotify',{exact:true}).click();
  if(await page.getByRole('button',{name:'Autorizar Spotify',exact:true}).isDisabled())throw Error('OAuth unavailable for valid Client ID');
  await page.getByRole('button',{name:'Autorizar Spotify',exact:true}).click();await page.getByRole('alert').filter({hasText:'APK de Android'}).waitFor();await assertLayout(page,tag+' Dark error toast');await page.waitForFunction(()=>{const el=document.querySelector('.snackbar');return el&&Number(getComputedStyle(el).opacity)===1});if(capture)await page.screenshot({path:`.impeccable/review/qa/${tag}-error-toast.png`,fullPage:false});await page.getByRole('button',{name:'Cerrar aviso',exact:true}).click();await page.locator('.snackbar').waitFor({state:'detached'});
  await page.locator('input[type=file]').setInputFiles({name:'qa-library.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))});await page.getByRole('status').filter({hasText:'Respaldo importado'}).waitFor();await page.getByRole('button',{name:'Cerrar aviso',exact:true}).click();
  await nav.getByRole('button',{name:'Tu Biblioteca',exact:true}).click();await page.getByText(title,{exact:true}).waitFor();await assertLayout(page,tag+' Biblioteca larga');await assertArtworkColor(page);
  await page.getByRole('button',{name:'Playlists',exact:true}).click();await page.getByRole('button',{name:/Playlist de comprobación/}).click();await assertLayout(page,tag+' Playlist');
  await page.getByRole('button',{name:'Reproducir',exact:true}).click();await page.getByRole('alert').filter({hasText:'requiere la app Android'}).waitFor();await page.getByRole('button',{name:'Cerrar aviso',exact:true}).click();await page.locator('.snackbar').waitFor({state:'detached'});await assertLayout(page,tag+' Mini player');
  await page.getByRole('button',{name:'Abrir reproductor',exact:true}).click();await page.getByRole('dialog',{name:'Reproductor',exact:true}).waitFor();await assertLayout(page,tag+' Reproductor');
  await page.waitForFunction(()=>{const el=document.querySelector('.expanded-player');if(!el)return false;const rect=el.getBoundingClientRect();return Math.abs(rect.top)<1&&Math.abs(rect.height-innerHeight)<2&&Number(getComputedStyle(el).opacity)===1});
  if(capture)await page.screenshot({path:`.impeccable/review/qa/${tag}-player.png`,fullPage:false});
  await page.locator('.transport').evaluate(el=>{const panel=el.closest('.expanded-player');panel.style.scrollBehavior='auto';panel.scrollTop+=el.getBoundingClientRect().top-panel.getBoundingClientRect().top-120});
  await page.waitForFunction(()=>{const r=document.querySelector('.transport').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight});
  await assertLayout(page,tag+' Player controls');if(capture)await page.screenshot({path:`.impeccable/review/qa/${tag}-player-controls.png`,fullPage:false});await page.locator('.expanded-player').evaluate(el=>el.scrollTo({top:0}));
  await page.getByRole('button',{name:'Opciones de canción',exact:true}).click();await page.getByRole('dialog',{name:'Acciones de canción'}).waitFor();await assertLayout(page,tag+' Menú');await page.getByRole('button',{name:'Cerrar opciones',exact:true}).click();await page.waitForTimeout(250);
  await page.getByRole('button',{name:'Cerrar reproductor',exact:true}).click();await page.waitForTimeout(300);await page.locator('.topbar').getByRole('button',{name:'MURMUR · Ir a Inicio'}).click();await page.getByRole('heading',{name:'Mixes de MURMUR'}).waitFor();
  await page.evaluate(()=>{location.hash='/invalid-route';});await page.getByRole('status').filter({hasText:'vista no existe'}).waitFor();if(!page.url().endsWith('#/home'))throw Error('Invalid route did not recover');
  results.push({viewport,scale,checks:['all screens without horizontal scroll or clipped controls','long metadata','mini-player reserve','expanded player and song menu','dark error toast','OAuth disabled until valid Client ID','logo home link','invalid route fallback']});await context.close();
 }
 if(errors.length)throw Error(errors.join('\n'));fs.writeFileSync('verification/mobile-qa.json',JSON.stringify({runtime:'Chrome browser preview. Synthetic library stays in isolated test contexts, never in the APK.',results,errors},null,2));console.log(JSON.stringify({scenarios:results.length,errors},null,2));
} finally {await browser.close();}
