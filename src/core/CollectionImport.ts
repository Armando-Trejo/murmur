import { Auth, isNative } from "../native";
import { addedStamp, db } from "./db";
import { applyAlbumCover, forgetDeleted, mergeSyncedPlaylist, mergeSyncedTrack } from "./libraryEdit";
import { fetchSpotifyPages, unwrapSpotifyTrack } from "./SpotifyLibrary";
import type { Playlist, QueueItem } from "./types";
export function parseCollectionLink(input:string){
 const text=input.trim();
 const uri=/^spotify:(playlist|album):([A-Za-z0-9]{22})$/.exec(text);
 if(uri)return {source:"spotify" as const,kind:uri[1],id:uri[2]};
 let url:URL;try{url=new URL(text)}catch{throw Error("Pega un enlace completo de una playlist, mix o álbum.")}
 if(url.protocol!=="https:"||url.username||url.password)throw Error("Usa un enlace HTTPS de YouTube o Spotify.");
 if(url.hostname==="open.spotify.com"){
  const match=/^\/(?:intl-[a-z]+\/)?(playlist|album)\/([A-Za-z0-9]{22})\/?$/.exec(url.pathname);
  if(match)return {source:"spotify" as const,kind:match[1],id:match[2]};
 }
 if(["youtube.com","www.youtube.com","m.youtube.com","music.youtube.com","youtu.be"].includes(url.hostname)){
  const id=url.searchParams.get("list");
  if(id&&/^[A-Za-z0-9_-]{2,120}$/.test(id))return {source:"youtube" as const,kind:id.startsWith("RD")?"mix":id.startsWith("OLAK5uy")?"album":"playlist",id};
  const album=/^\/browse\/(MPREb[A-Za-z0-9_-]{2,120})$/.exec(url.pathname);
  if(url.hostname==="music.youtube.com"&&album)return {source:"youtube" as const,kind:"album",id:album[1]};
 }
 throw Error("Este enlace no contiene una colección compatible. Usa Compartir en la playlist, mix o álbum y copia su enlace completo.");
}
export async function readCollectionLink(input:string, personalized=false){
 const link=parseCollectionLink(input);
 if(!isNative)throw Error("Importa enlaces desde MURMUR en Android.");
 let title:string,artworkUrl:string|undefined,items:QueueItem[];
 let details:Pick<Playlist,"artist"|"year"|"subtitle">={};
 if(link.source==="spotify"){
  const base=`/${link.kind}s/${link.id}`;
  const {data}=await Auth.spotifyRequest({path:base});
  title=data.name;artworkUrl=data.images?.[0]?.url;
  if(link.kind==="album")details={artist:data.artists?.map((a:{name?:string})=>a.name).filter(Boolean).join(", ")||undefined,year:typeof data.release_date==="string"?data.release_date.slice(0,4):undefined};
  if(typeof title!=="string"||!title.trim())throw Error("Spotify no entregó el nombre de esta colección.");
  const raw=await fetchSpotifyPages(base+(link.kind==="album"?"/tracks":"/items"));
  items=raw.map(value=>link.kind==="album"?{...value,album:{id:link.id,name:data.name,images:data.images}}:value).map(unwrapSpotifyTrack).filter((t):t is QueueItem=>!!t);
 }else{
  const result=await Auth.youtubeCollection({id:link.id,personalized});title=result.title;artworkUrl=result.artworkUrl;items=result.tracks;
  details={artist:result.artist,year:result.year,subtitle:result.subtitle};
 }
 if(!Array.isArray(items))throw Error("El proveedor no entregó las canciones de la colección.");
 if(!items.length)throw Error("La colección está vacía o el proveedor no permitió leer sus canciones. No se reemplazó tu biblioteca.");
 // An album's cover is the cover of its songs, whatever thumbnail each one came with.
 if(link.kind==="album"){artworkUrl=artworkUrl||items.find(t=>t.artworkUrl)?.artworkUrl;items=items.map(t=>({...t,album:title,albumId:link.id,artworkUrl:artworkUrl||t.artworkUrl}));}
 const playlist:Playlist={id:link.source==="spotify"?(link.kind==="album"?"sp:album:":"")+link.id:"ytpl:"+(link.id.startsWith("MPREb")?link.id:"VL"+link.id),title,kind:link.kind==="album"?"album":"playlist",source:link.source,artworkUrl,trackIds:items.map(t=>t.id),...Object.fromEntries(Object.entries(details).filter(([,v])=>typeof v==="string"&&v))};
 return { playlist, items };
}
/**
 * Saves a playlist or an album the owner chose. An album goes to «Álbumes» without liking its songs:
 * each one is liked on its own.
 */
export async function saveCollection({playlist, items}: Awaited<ReturnType<typeof readCollectionLink>>){
 const now=Date.now();
 const album=playlist.kind==="album";
 await forgetDeleted(playlist.id);
 let stored=playlist;
 await db.transaction("rw",db.tracks,db.playlists,async()=>{
  for(const [index,track] of items.entries()){
   const existing=await db.tracks.get(track.id);
   const saved=album?!!existing&&!existing.deleted&&existing.saved!==false:true;
   const merged=mergeSyncedTrack(existing,{...track,saved});
   await db.tracks.put({...merged,saved:album?saved:merged.saved,deleted:undefined,addedAt:album?existing?.addedAt:addedStamp(existing,now-index)});
  }
  stored=mergeSyncedPlaylist(await db.playlists.get(playlist.id),playlist)!;
  await db.playlists.put(stored);
 });
 if(album)await applyAlbumCover(stored.id,true);
 return stored;
}

export async function importCollectionLink(input:string){
 return saveCollection(await readCollectionLink(input));
}
