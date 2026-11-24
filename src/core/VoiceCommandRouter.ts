import { parseVoiceIntent, type Platform } from "./VoiceIntentParser";
import {
  searchAll,
  buildAffinity,
  hybridScore,
  generateArtistMix,
} from "./DiscoveryEngine";
import { db, playlistTracks, saveTrack } from "./db";
import { player } from "./AudioOrchestrator";
import { Auth, Voice, isNative } from "../native";
import { similarity } from "./SourceResolver";
import { songKey } from "./blendMixes";
import { albumTracks, searchAlbums } from "./albumSearch";
import { creditedArtists } from "../components/ArtistProfile";
import { normalize } from "./FanUploadParser";
import type { QueueItem } from "./types";

async function playbackResult(action: () => Promise<unknown>, message: string, note = "") {
  await action();
  const state = player.getSnapshot();
  if (state.error) throw new Error(state.error);
  return note + (state.loading ? "Preparando audio…" : message);
}

const platformName: Record<Platform, string> = { spotify: "Spotify", youtube: "YouTube" };
/** Where to look, in order: the platform asked for first, then the other one; Spotify's official catalogue first otherwise. */
const platformOrder = (asked?: Platform): Platform[] =>
  asked === "youtube" ? ["youtube", "spotify"] : ["spotify", "youtube"];
const fallbackNote = (asked: Platform | undefined, used: Platform) =>
  asked && asked !== used ? `No estaba en ${platformName[asked]}; va desde ${platformName[used]}. ` : "";

/** Songs on one platform: YouTube Music's song search (official audio) before plain YouTube videos. */
async function songsOn(platform: Platform, query: string): Promise<QueueItem[]> {
  if (platform === "youtube" && isNative) {
    const songs = (await Auth.youtubeSongs({ query }).catch(() => undefined))?.songs ?? [];
    if (songs.length)
      return songs.map((s): QueueItem => ({
        id: "yt:" + s.videoId, videoId: s.videoId, source: "youtube", title: s.title, artist: s.artist,
        album: s.album, duration: s.duration > 0 ? s.duration : 0, artworkUrl: s.artworkUrl, tags: [],
      }));
  }
  return searchAll(query, platform).catch(() => []);
}

const lead = (artist: string) => creditedArtists(artist)[0] ?? artist;
const unwanted = /(live|en vivo|cover|karaoke|remix|instrumental|sped up|slowed|8d)/;

/** The closest song to what was asked, preferring the studio recording over live or covers. */
export function bestSong(list: QueueItem[], title: string, artist?: string) {
  let best: QueueItem | undefined;
  let score = 0;
  for (const track of list) {
    const t = similarity(track.title, title);
    const a = artist ? Math.max(similarity(lead(track.artist), artist), similarity(track.artist, artist)) : 0.8;
    const penalty = unwanted.test(normalize(track.title)) && !unwanted.test(normalize(title)) ? 0.25 : 0;
    const s = t * 0.6 + a * 0.4 - penalty;
    if (s > score) { score = s; best = track; }
  }
  return score >= 0.62 ? best : undefined;
}

/** One entry per song (no second version of the same one), keeping the first. */
export function oncePerSong(tracks: QueueItem[]) {
  const seen = new Set<string>();
  return tracks.filter((t) => { const k = songKey(t); if (seen.has(k)) return false; seen.add(k); return true; });
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
      // "Pon X": an artist gets a mix of their songs; a song title plays that song (and MURMUR
      // continues with related music when it ends). Never several versions of the same song.
      const found = await generateArtistMix(intent.query);
      for (const platform of intent.platform ? platformOrder(intent.platform) : [undefined]) {
        const pool = platform ? found.filter((t) => t.source === platform) : found;
        const byArtist = oncePerSong(pool.filter((t) => similarity(lead(t.artist), intent.query) > 0.8));
        if (byArtist.length >= 3)
          return playbackResult(() => player.playList(byArtist), "Mix de " + intent.query, fallbackNote(intent.platform, byArtist[0].source as Platform));
        const song = bestSong(pool, intent.query) ?? (platform ? bestSong(await songsOn(platform, intent.query), intent.query) : undefined);
        if (song)
          return playbackResult(() => player.playList([song]), "Reproduciendo " + song.title, fallbackNote(intent.platform, song.source as Platform));
      }
      const rest = oncePerSong(found);
      if (!rest.length) return "No encontré ese artista ni esa canción";
      return playbackResult(() => player.playList(rest), "Mix de " + intent.query);
    }
    case "youtube": {
      const tracks = await searchAll(intent.query, "youtube");
      if (!tracks.length) return "No encontré ese video";
      return playbackResult(
        () => player.playList(tracks.slice(0, 1)),
        "Reproduciendo desde YouTube",
      );
    }
    case "track": {
      for (const platform of platformOrder(intent.platform)) {
        const song = bestSong(await songsOn(platform, intent.query), intent.title, intent.artist);
        if (song)
          return playbackResult(() => player.playList([song]), "Reproduciendo " + song.title, fallbackNote(intent.platform, platform));
      }
      return "No encontré esa canción en Spotify ni en YouTube";
    }
    case "album": {
      const { albums } = await searchAlbums(intent.query);
      for (const platform of platformOrder(intent.platform)) {
        let best: (typeof albums)[number] | undefined;
        let score = 0;
        for (const album of albums.filter((a) => a.source === platform)) {
          const s = similarity(album.title, intent.title) * 0.65 +
            (intent.artist ? similarity(lead(album.artist), intent.artist) : 0.8) * 0.35;
          if (s > score) { score = s; best = album; }
        }
        if (!best || score < 0.6) continue;
        const tracks = await albumTracks(best).catch(() => []);
        if (!tracks.length) continue;
        return playbackResult(() => player.playList(tracks), "Álbum " + best.title, fallbackNote(intent.platform, platform));
      }
      return "No encontré ese álbum en Spotify ni en YouTube";
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
