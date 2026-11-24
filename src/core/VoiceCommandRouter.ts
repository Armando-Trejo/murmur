import { parseVoiceIntent } from "./VoiceIntentParser";
import {
  searchAll,
  buildAffinity,
  hybridScore,
  generateArtistMix,
} from "./DiscoveryEngine";
import { db, playlistTracks, saveTrack } from "./db";
import { player } from "./AudioOrchestrator";
import { Voice, isNative } from "../native";
import { resolveSource, similarity } from "./SourceResolver";
import { normalize } from "./FanUploadParser";
import type { QueueItem } from "./types";

async function playbackResult(action: () => Promise<unknown>, message: string) {
  await action();
  const state = player.getSnapshot();
  if (state.error) throw new Error(state.error);
  return state.loading ? "Preparando audio…" : message;
}

export async function routeVoiceCommand(
  text: string,
  save: (track: QueueItem) => Promise<void> = saveTrack,
): Promise<string> {
  const intent = parseVoiceIntent(text, await db.playlists.toArray());
  switch (intent.type) {
    case "next":
      if (!player.nextTrack) return "No hay otra canción en la cola";
      return playbackResult(() => player.next(), "Siguiente canción");
    case "previous":
      if (!player.current) return "Primero elige una canción";
      return playbackResult(() => player.previous(), "Canción anterior");
    case "mix":
      if (!player.nextTrack) return "No hay otra canción en la cola";
      return playbackResult(() => player.mixNow(), "Mezclando");
    case "save":
      if (player.current) {
        await save(player.current);
        return "Canción guardada";
      }
      return "Primero reproduce una canción";
    case "pause":
      if (!player.current) return "No hay una canción en reproducción";
      await player.pause();
      return "En pausa";
    case "resume":
      if (!player.current) return "Primero elige una canción";
      if (player.getSnapshot().playing)
        return "La música ya está en reproducción";
      return playbackResult(() => player.toggle(), "Reanudando");
    case "playlist": {
      const p = await db.playlists.get(intent.id);
      if (!p) return "No encontré esa playlist";
      const items = await playlistTracks(p);
      if (!items.length) return "Esa playlist está vacía";
      return playbackResult(
        () => player.playList(items),
        "Reproduciendo " + p.title,
      );
    }
    case "artist": {
      const items = await generateArtistMix(intent.query);
      if (!items.length) return "No encontré canciones de ese artista";
      return playbackResult(
        () => player.playList(items),
        "Mix de " + intent.query,
      );
    }
    case "youtube": {
      const tracks = await searchAll(intent.query, "youtube");
      if (!tracks.length) return "No encontré ese video";
      return playbackResult(
        () => player.playList(tracks),
        "Reproduciendo desde YouTube",
      );
    }
    case "track": {
      const tracks = await searchAll(intent.query, "all");
      const spotify = tracks.filter((t) => t.source === "spotify");
      const youtube = tracks.filter((t) => t.source === "youtube");
      const target = youtube.find(
        (t) =>
          similarity(t.title, intent.title) > 0.7 &&
          similarity(t.artist, intent.artist) > 0.7,
      );
      const resolved = target
        ? resolveSource(target, spotify)
        : spotify.find(
            (t) =>
              similarity(t.title, intent.title) > 0.85 &&
              similarity(t.artist, intent.artist) > 0.85,
          ) || tracks[0];
      if (!resolved) return "No encontré esa canción";
      return playbackResult(
        () => player.playList([resolved]),
        "Reproduciendo " + resolved.title,
      );
    }
    case "vibe": {
      const tracks = await db.tracks.toArray();
      if (!tracks.length)
        return "Guarda algunas canciones para crear mixes por vibra";
      const tags = [...new Set(tracks.flatMap((t) => t.tags))];
      let rankedTags: { text: string; score: number }[] = [];
      if (isNative && tags.length) {
        try {
          rankedTags = (await Voice.rankTags({ query: intent.query, tags }))
            .ranked;
        } catch {
          /* Offline lexical fallback is always available. */
        }
      }
      const words = normalize(intent.query).split(" ");
      const affinity = await buildAffinity();
      const candidates = tracks
        .map((track) => ({
          track,
          score:
            (rankedTags.length
              ? Math.max(
                  0,
                  ...track.tags.map(
                    (tag) => rankedTags.find((t) => t.text === tag)?.score || 0,
                  ),
                ) * 100
              : track.tags.filter((tag) =>
                  words.some((w) => normalize(tag).includes(w)),
                ).length * 30) +
            hybridScore(
              track.tags,
              affinity.spotify,
              affinity.youtube,
              affinity.penalties,
            ) *
              0.1,
        }))
        .sort((a, b) => b.score - a.score);
      if (!candidates.some((t) => t.score > 0))
        return "Aún no hay suficientes etiquetas para esa vibra. Añade canciones o prueba un artista.";
      return playbackResult(
        () =>
          player.playList(
            candidates
              .filter((c) => c.score > 0)
              .slice(0, 30)
              .map((c) => c.track),
          ),
        "Mix por vibra: " + intent.query,
      );
    }
    default:
      return "Prueba: Murmur reproduce un artista, Siguiente o Mezcla ahora";
  }
}
