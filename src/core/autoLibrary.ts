import { db } from "./db";
import { Audio, isNative } from "../native";
import { isLiked } from "./libraryEdit";
import { bridged, spotifyViaYouTube, type YouTubeSong } from "./spotifyBridge";
import type { Playlist, QueueItem } from "./types";

/**
 * What Android Auto (and any other media browser) can open while driving: a compact copy of the
 * library written to the phone, so the car can browse and start music even when MURMUR's screen is
 * closed. Spotify songs carry their YouTube Music twin when that is how they sound; the rest keep
 * their Spotify id for the in-app Spotify player.
 */
export interface AutoTrack {
  id: string;
  source: "youtube" | "spotify";
  title: string;
  artist: string;
  album?: string;
  albumId?: string;
  duration: number;
  artworkUrl?: string;
  videoId?: string;
  spotifyUri?: string;
  offlinePath?: string;
  bridgedFrom?: "spotify";
}
export interface AutoCollection {
  id: string;
  title: string;
  subtitle?: string;
  artworkUrl?: string;
  /** Where it appears in the car: «Para ti», «Playlists» or «Álbumes». */
  group: "foryou" | "playlists" | "albums";
  tracks: AutoTrack[];
}
export interface AutoLibrary { updatedAt: number; collections: AutoCollection[] }

export const AUTO_TRACKS_PER_LIST = 100;
const MAX_PLAYLISTS = 40;
const MAX_ALBUMS = 30;

const slim = (t: QueueItem): AutoTrack => ({
  id: t.id,
  source: t.source === "spotify" ? "spotify" : "youtube",
  title: t.edits?.title || t.title,
  artist: t.edits?.artist || t.artist,
  album: t.edits?.album || t.album,
  albumId: t.albumId,
  duration: t.duration || 0,
  artworkUrl: t.artworkUrl,
  videoId: t.videoId,
  spotifyUri: t.spotifyUri,
  offlinePath: t.offlinePath,
});

/** A song the car can start: YouTube with its id or file, Spotify as it sounds in MURMUR. */
export function carTrack(t: QueueItem, viaYouTube: boolean, twin?: YouTubeSong | null): AutoTrack | undefined {
  if (t.deleted) return undefined;
  if (t.source !== "spotify") return t.videoId || t.offlinePath ? slim(t) : undefined;
  if (!viaYouTube) return t.spotifyUri ? slim(t) : undefined;
  if (!twin) return undefined;
  return { ...slim(bridged(t, twin)), bridgedFrom: "spotify" };
}

export async function buildAutoLibrary(now = Date.now()): Promise<AutoLibrary> {
  const [tracks, playlists, history] = await Promise.all([
    db.tracks.toArray(),
    db.playlists.toArray(),
    db.history.orderBy("at").reverse().limit(400).toArray(),
  ]);
  const viaYouTube = spotifyViaYouTube();
  const byId = new Map(tracks.map((t) => [t.id, t]));
  const twins = new Map<string, YouTubeSong | null>();
  if (viaYouTube) {
    const keys = tracks.filter((t) => t.source === "spotify").map((t) => "twin:v1:" + t.id);
    const rows = await db.settings.bulkGet(keys);
    rows.forEach((row) => { if (row) twins.set(row.key.slice(8), row.value as YouTubeSong | null); });
  }
  const songs = (ids: Iterable<string>) => {
    const out: AutoTrack[] = [];
    const seen = new Set<string>();
    for (const id of ids) {
      if (out.length >= AUTO_TRACKS_PER_LIST) break;
      if (seen.has(id)) continue;
      seen.add(id);
      const t = byId.get(id);
      const item = t && carTrack(t, viaYouTube, twins.get(id));
      if (item) out.push(item);
    }
    return out;
  };
  const collections: AutoCollection[] = [];
  const recent = songs(history.map((h) => h.trackId));
  if (recent.length) collections.push({ id: "auto:recent", title: "Escuchado recientemente", group: "foryou", tracks: recent, artworkUrl: recent[0]?.artworkUrl });
  const liked = tracks.filter(isLiked).sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0)).map((t) => t.id);
  const saved = songs(liked);
  if (saved.length) collections.push({ id: "auto:saved", title: "Guardadas", subtitle: `${liked.length} canciones`, group: "foryou", tracks: saved, artworkUrl: saved[0]?.artworkUrl });
  const listed = (p: Playlist) => !p.id.startsWith("local:mix:") && p.id !== "sp:liked";
  const mixes = playlists.filter((p) => p.id.startsWith("auto:") && listed(p));
  const own = playlists.filter((p) => !p.id.startsWith("auto:") && listed(p))
    .sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0));
  const add = (p: Playlist, group: AutoCollection["group"]) => {
    const list = songs(p.trackIds.filter((id) => !(p.removedIds ?? []).includes(id)));
    if (list.length) collections.push({
      id: p.id, title: p.title, subtitle: p.artist || p.subtitle, group, tracks: list,
      // A cover the owner picked lives on the phone as a data URL: the car only loads web images.
      artworkUrl: p.artworkUrl || list[0]?.artworkUrl,
    });
  };
  mixes.forEach((p) => add(p, "foryou"));
  own.filter((p) => p.kind !== "album").slice(0, MAX_PLAYLISTS).forEach((p) => add(p, "playlists"));
  own.filter((p) => p.kind === "album").slice(0, MAX_ALBUMS).forEach((p) => add(p, "albums"));
  return { updatedAt: now, collections };
}

let pending: ReturnType<typeof setTimeout> | undefined;
let lastJson = "";
/** Writes the car's copy of the library (at most every 20 s, only when it changed). */
export function syncAutoLibrary(delayMs = 20_000) {
  if (!isNative) return;
  if (pending) return;
  pending = setTimeout(() => {
    pending = undefined;
    void buildAutoLibrary().then((library) => {
      const json = JSON.stringify(library.collections);
      if (json === lastJson) return;
      lastJson = json;
      return Audio.setAutoLibrary({ json: JSON.stringify(library) });
    }).catch(() => { /* the car keeps its previous copy */ });
  }, delayMs);
}
