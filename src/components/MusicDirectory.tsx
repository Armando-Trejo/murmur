import { useEffect, useState } from "react";
import { searchAll } from "../core/DiscoveryEngine";
import { db } from "../core/db";
import { orderMusic } from "../core/musicOrder";
import type { Playlist,QueueItem } from "../core/types";
export function MusicDirectory({artist,mode,tracks,playlists,onArtist,onAlbum,onPlay,onBack}:{artist?:string;mode?:"artists"|"albums";tracks:QueueItem[];playlists:Playlist[];onArtist:(name:string)=>void;onAlbum:(p:Playlist)=>void;onPlay:(tracks:QueueItem[],index:number)=>void;onBack:()=>void}){
 const [online,setOnline]=useState<QueueItem[]>([]);const [loading,setLoading]=useState(false);const [error,setError]=useState("");
 useEffect(()=>{let live=true;setOnline([]);setError("");if(artist){setLoading(true);void searchAll(artist,"all").then(items=>{if(live)setOnline(items)}).catch(e=>{if(live)setError(e.message)}).finally(()=>{if(live)setLoading(false)})}return()=>{live=false}},[artist]);
 const local=artist?tracks.filter(t=>t.artist.split(", ").some(a=>a.toLocaleLowerCase()===artist.toLocaleLowerCase())):tracks;
 const relevant=[...new Map([...orderMusic(local,"popular"),...online].map(t=>[t.id,t])).values()].slice(0,30);
 const artists=[...new Set(tracks.flatMap(t=>t.artist.split(", ")))].sort((a,b)=>a.localeCompare(b,"es"));
 const albums=new Map<string,{title:string;items:QueueItem[]}>();
 for(const t of local)if(t.album){const key=t.albumId||t.artist+"/"+t.album;const group=albums.get(key)||{title:t.album,items:[]};group.items.push(t);albums.set(key,group)}
 return <section className="music-directory"><button className="text-button" onClick={onBack}>Volver a Tu Biblioteca</button><h1>{artist|| (mode==="artists"?"Artistas":"Álbumes")}</h1>
 {!artist&&mode==="artists"?<div className="directory-grid">{artists.map(name=>{const item=tracks.find(t=>t.artist.split(", ").includes(name));return <button key={name} onClick={()=>onArtist(name)}>{item?.artworkUrl&&<img src={item.artworkUrl} alt="" loading="lazy"/>}<strong>{name}</strong></button>})}{!artists.length&&<p>Importa música para organizar tus artistas.</p>}</div>:<>
 {(artist||mode==="albums")&&<><h2>Álbumes en tu biblioteca</h2><div className="directory-grid">
 {playlists.filter(p=>p.kind==="album"&&(!artist||p.trackIds.some(id=>local.some(t=>t.id===id)))).map(p=><button key={p.id} onClick={()=>onAlbum(p)}>{p.artworkUrl&&<img src={p.artworkUrl} alt="" loading="lazy"/>}<strong>{p.title}</strong><small>{p.trackIds.length} canciones</small></button>)}
 {[...albums].filter(([key])=>!playlists.some(p=>p.kind==="album"&&p.trackIds.includes(albums.get(key)!.items[0].id))).map(([key,group])=><button key={key} onClick={()=>{void (async()=>{const p:Playlist={id:"local:album:"+encodeURIComponent(key),title:group.title,kind:"album",source:"hybrid",trackIds:group.items.map(t=>t.id),artworkUrl:group.items[0].artworkUrl};await db.playlists.put(p);onAlbum(p)})()}}>{group.items[0].artworkUrl&&<img src={group.items[0].artworkUrl} alt="" loading="lazy"/>}<strong>{group.title}</strong><small>{group.items.length} canciones disponibles</small></button>)}
 </div>{!albums.size&&!playlists.some(p=>p.kind==="album")&&<p>Los álbumes aparecerán al importar enlaces o música con datos de álbum.</p>}</>}
 {artist&&<><h2>Lo más relevante</h2><p className="help-copy">Tu biblioteca y resultados disponibles de los proveedores.</p>{loading&&<p role="status">Buscando más música…</p>}{error&&<p role="status">{error}</p>}{relevant.map((t,index)=><button className="directory-song" key={t.id} onClick={()=>onPlay(relevant,index)}>{t.artworkUrl&&<img src={t.artworkUrl} alt="" loading="lazy"/>}<span><strong>{t.title}</strong><small>{t.artist} · {t.source=== "spotify"?"Spotify":"YouTube"}</small></span></button>)}</>}
 </>}
 </section>;
}
