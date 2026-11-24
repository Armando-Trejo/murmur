import { useState } from "react";
import { importCollectionLink } from "../core/CollectionImport";
import type { Playlist } from "../core/types";
export function CollectionLinkImport({onImported,notify}:{onImported:(p:Playlist)=>void;notify:(text:string,kind?:"success"|"error")=>void}){
 const [link,setLink]=useState("");const [busy,setBusy]=useState(false);const [error,setError]=useState("");
 return <details className="collection-import"><summary>Importar desde un enlace</summary><form onSubmit={async e=>{e.preventDefault();if(busy)return;setBusy(true);setError("");try{const p=await importCollectionLink(link);notify(`Importada «${p.title}» · ${p.trackIds.length} canciones`,"success");setLink("");onImported(p)}catch(e){const message=(e as Error).message;setError(message);notify(message,"error")}finally{setBusy(false)}}}>
 <label htmlFor="collection-link">Enlace de YouTube o Spotify</label><input id="collection-link" type="text" inputMode="url" autoCapitalize="none" autoCorrect="off" value={link} onChange={e=>setLink(e.target.value)} placeholder="https://…" required disabled={busy}/>
 <p>Playlists, mixes y álbumes. Spotify requiere autorización; las listas privadas de YouTube requieren sesión. Los mixes se guardan con las canciones disponibles al importar.</p>
 <button className="button primary" type="submit" disabled={busy||!link.trim()}>{busy?"Importando colección…":"Importar a mi biblioteca"}</button>{error&&<p role="alert">{error}</p>}
 </form></details>;
}
