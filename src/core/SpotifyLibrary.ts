import { Auth } from "../native";
import { addedStamp, db } from "./db";
import { spotifyTrack } from "./DiscoveryEngine";
import { applyAllAlbumCovers, deletedPlaylists, mergeSyncedPlaylist, mergeSyncedTrack } from "./libraryEdit";
import type { Playlist, QueueItem } from "./types";

export interface SyncSummary {
  tracks: number;
  playlists: number;
  unavailable: string[];
  topUnavailable: boolean;
}
export interface SpotifyPage {
  items: any[];
  next?: string | null;
  total?: number;
}
export async function fetchSpotifyPages(
  path: string,
  request = Auth.spotifyRequest.bind(Auth),
): Promise<any[]> {
  const all: any[] = [];
  let offset = 0;
  for (let page = 0; page < 200; page++) {
    const result = await request({
      path: `${path}${path.includes("?") ? "&" : "?"}limit=50&offset=${offset}`,
    });
    const data = result.data as SpotifyPage;
    if (!Array.isArray(data.items))
      throw new Error(
        "Spotify devolvió una página de biblioteca inválida. No se reemplazaron tus datos locales.",
      );
    all.push(...data.items);
    if (!data.next || !data.items.length) return all;
    offset += data.items.length;
  }
  throw new Error(
    "La biblioteca supera el límite de sincronización de 10 000 registros por lista. Tus datos locales se conservan.",
  );
}
export function unwrapSpotifyTrack(value: any): QueueItem | undefined {
  const track = value?.item ?? value?.track ?? value;
  if (
    !track?.id ||
    track.is_local ||
    (track.type && track.type !== "track") ||
    typeof track.name !== "string"
  )
    return;
  return { ...spotifyTrack(track), saved: true };
}
export async function syncSpotifyLibrary(
  onProgress: (text: string) => void = () => {},
): Promise<SyncSummary> {
  const access = await Auth.verifySpotify();
  if (!access.spotify)
    throw new Error(
      access.spotifyMessage ||
        "Autoriza el acceso de Spotify a tu biblioteca desde Opciones (⋯).",
    );
  const result: SyncSummary = {
    tracks: 0,
    playlists: 0,
    unavailable: [],
    topUnavailable: false,
  };
  const importedIds = new Set<string>();
  async function commit(playlist: Playlist, items: QueueItem[]) {
    const now = Date.now();
    if (playlist.id in (await deletedPlaylists())) return;
    await db.transaction("rw", [db.tracks, db.playlists], async () => {
      for (const [index, track] of items.entries()) {
        const existing = await db.tracks.get(track.id);
        await db.tracks.put({
          ...mergeSyncedTrack(existing, track),
          // Liked songs arrive newest first: the first one gets the latest "added" date.
          addedAt: addedStamp(existing, now - index),
        });
        importedIds.add(track.id);
      }
      const merged = mergeSyncedPlaylist(await db.playlists.get(playlist.id), playlist);
      if (merged) await db.playlists.put(merged);
    });
  }
  onProgress("Importando tus Me Gusta…");
  const likes = (await fetchSpotifyPages("/me/tracks"))
    .map(unwrapSpotifyTrack)
    .filter((t): t is QueueItem => !!t)
    .map((t) => ({ ...t, tags: ["liked"] }));
  await commit(
    {
      id: "sp:liked",
      title: "Tus Me Gusta · Spotify",
      source: "spotify",
      trackIds: likes.map((t) => t.id),
    },
    likes,
  );
  onProgress("Buscando tus playlists…");
  const playlists = await fetchSpotifyPages("/me/playlists");
  for (let index = 0; index < playlists.length; index++) {
    const p = playlists[index];
    if (!p?.id || !p.name) continue;
    onProgress(`Importando playlist ${index + 1} de ${playlists.length}…`);
    try {
      const items = (
        await fetchSpotifyPages(`/playlists/${encodeURIComponent(p.id)}/items`)
      )
        .map(unwrapSpotifyTrack)
        .filter((t): t is QueueItem => !!t);
      await commit(
        {
          id: p.id,
          title: p.name,
          source: "spotify",
          trackIds: items.map((t) => t.id),
          artworkUrl: p.images?.[0]?.url,
        },
        items,
      );
      result.playlists++;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (
        code === "SESSION_EXPIRED" ||
        code === "RATE_LIMITED" ||
        code === "SPOTIFY_OAUTH_REQUIRED"
      )
        throw error;
      result.unavailable.push(p.name);
      // Preserve previously imported songs and all local overlays when Spotify denies a followed playlist.
    }
  }
  try {
    const { data } = await Auth.spotifyRequest({
      path: "/me/top/tracks?limit=20",
    });
    for (const item of data.items || []) {
      const track = unwrapSpotifyTrack(item);
      if (!track) continue;
      const existing = await db.tracks.get(track.id);
      const merged = mergeSyncedTrack(existing, track);
      await db.tracks.put({ ...merged, tags: [...new Set([...merged.tags, "top"])] });
    }
  } catch {
    result.topUnavailable = true;
  }
  await applyAllAlbumCovers();
  result.tracks = importedIds.size;
  return result;
}
