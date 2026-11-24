import { Auth } from "../native";
import { db } from "./db";
import type { Playlist, QueueItem } from "./types";
import { parseFanUpload } from "./FanUploadParser";
export async function importYouTubeLibrary(
  progress: (message: string) => void = () => {},
) {
  const { playlists } = await Auth.youtubeLibrary();
  let imported = 0;
  const tracks = new Set<string>();
  const unavailable: string[] = [];
  for (let i = 0; i < playlists.length; i++) {
    const p = playlists[i];
    if (typeof p.id !== "string" || typeof p.title !== "string") continue;
    progress(`Importando playlist ${i + 1} de ${playlists.length} de YouTube…`);
    try {
      const result = await Auth.youtubePlaylist({ id: p.id });
      if (!Array.isArray(result.tracks))
        throw new Error("YouTube no entregó las canciones de la playlist.");
      const items: QueueItem[] = result.tracks.map((track) => {
        const parsed = parseFanUpload(track.title);
        return {
          ...track,
          title: parsed.title,
          artist: parsed.candidateArtist || track.artist,
          tags: [...new Set([...track.tags, ...parsed.tags])],
          saved: true,
        };
      });
      await db.transaction("rw", [db.tracks, db.playlists], async () => {
        for (const track of items) {
          const existing = await db.tracks.get(track.id);
          await db.tracks.put({
            ...existing,
            ...track,
            offlinePath: existing?.offlinePath,
          });
          tracks.add(track.id);
        }
        await db.playlists.put({
          id: p.id,
          title: p.title,
          source: "youtube",
          trackIds: items.map((t) => t.id),
          artworkUrl: p.artworkUrl,
        } satisfies Playlist);
      });
      imported++;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (
        code === "NETWORK_ERROR" ||
        code === "SESSION_EXPIRED" ||
        code === "RATE_LIMITED"
      )
        throw new Error(
          `${imported ? imported + " playlists ya se guardaron. " : ""}${(error as Error).message}`,
        );
      unavailable.push(p.title);
    }
  }
  if (playlists.length && imported === 0)
    throw new Error(
      "YouTube detectó tus playlists, pero no permitió importar sus canciones. Renueva la sesión. No se crearon listas vacías ni se borraron tus datos locales.",
    );
  return {
    detected: playlists.length,
    imported,
    tracks: tracks.size,
    unavailable,
  };
}
