import { asksToPlay, parseVoiceIntent, type Platform, type VoiceIntent } from "./VoiceIntentParser";

/** Intents that start music (as opposed to controlling what already plays). */
const MUSIC = new Set<VoiceIntent["type"]>(["track", "album", "artist", "vibe", "youtube", "request", "playlist"]);
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
import { continuationPicks } from "./continuation";
import { magicPicks } from "./magicShuffle";
import { normalize } from "./FanUploadParser";
import { interpret, type Candidate } from "./requestResolver";
import { spotifyTrack } from "./DiscoveryEngine";
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
const unwanted = /\b(live|en vivo|cover|karaoke|remix|instrumental|sped up|slowed|8d)\b/;

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

const LOG_KEY = "voice:log";
/** The last 30 commands as heard, what MURMUR understood and answered: for Diagnóstico and tuning. */
export async function voiceLog(): Promise<{ at: number; heard: string; understood: string; answer: string }[]> {
  return ((await db.settings.get(LOG_KEY))?.value as never[]) ?? [];
}
async function remember(heard: string, understood: string, answer: string) {
  const log = await voiceLog().catch(() => []);
  await db.settings.put({ key: LOG_KEY, value: [{ at: Date.now(), heard, understood, answer }, ...log].slice(0, 30) }).catch(() => {});
}

export async function routeVoiceCommand(
  text: string,
  save: (track: QueueItem) => Promise<void> = saveTrack,
): Promise<string> {
  // The recognizer sends its alternatives one per line, best first: keep the first one that makes sense.
  const playlists = await db.playlists.toArray();
  const heard = text.split("\n").map((t) => t.trim()).filter(Boolean);
  const intents = heard.map((t) => parseVoiceIntent(t, playlists));
  // A control ("para la música") or an explicit request beats a guess from another alternative.
  const rank = (i: VoiceIntent, said: string) =>
    i.type === "unknown" ? 0 : MUSIC.has(i.type) && !asksToPlay(said) ? 1 : 2;
  let at = 0;
  intents.forEach((intent, index) => { if (rank(intent, heard[index]) > rank(intents[at], heard[at])) at = index; });
  const intent = intents[at] ?? { type: "unknown" as const };
  text = heard.join(" | ");
  let answer = "";
  try {
    // Music without "pon", a wish or a platform is not played: it may be talk near the phone.
    if (MUSIC.has(intent.type) && !asksToPlay(heard[at] ?? "")) {
      answer = `Para poner música, di «pon» y lo que quieres escuchar. Escuché: «${heard[at]}»`;
      return answer;
    }
    answer = await run(intent, save);
    return answer;
  } catch (error) {
    answer = "Error: " + (error as Error).message;
    throw error;
  } finally {
    void remember(text, JSON.stringify(intent), answer).catch(() => {});
  }
}

async function run(intent: ReturnType<typeof parseVoiceIntent>, save: (track: QueueItem) => Promise<void>): Promise<string> {
  switch (intent.type) {
    case "nowPlaying": {
      const now = player.current;
      return now ? `Suena «${now.title}» de ${now.artist}` : "No hay nada sonando";
    }
    case "moreLikeThis": {
      const now = player.current;
      if (!now) return "Primero reproduce una canción";
      const picks = await continuationPicks(player.getSnapshot().queue, now, 20);
      if (!picks.length) return "No encontré canciones parecidas ahora";
      player.enqueue(picks);
      return `Agregué ${picks.length} canciones parecidas a «${now.title}»`;
    }
    case "shuffle": {
      const message = await player.cycleShuffle(magicPicks);
      return message || "Aleatorio";
    }
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
      // Songs (official audio), not concerts or full-album videos: Spotify's catalogue and YouTube
      // Music's song search, the platform asked for first; without one, both (Spotify first).
      const [fromSpotify, fromYouTube] = await Promise.all([artistSongs(intent.query, "spotify"), artistSongs(intent.query, "youtube")]);
      const on = { spotify: fromSpotify, youtube: fromYouTube };
      if (!intent.platform) {
        const both = oncePerSong(interleaveTwo(fromSpotify, fromYouTube));
        if (both.length >= 3) return playbackResult(() => player.playList(both.slice(0, 30)), "Mix de " + lead(both[0].artist));
      }
      for (const platform of platformOrder(intent.platform)) {
        const byArtist = oncePerSong(on[platform]);
        if (byArtist.length >= 3)
          return playbackResult(() => player.playList(byArtist.slice(0, 30)), "Mix de " + lead(byArtist[0].artist), fallbackNote(intent.platform, platform));
        const song = bestSong(await songsOn(platform, intent.query), intent.query);
        if (song)
          return playbackResult(() => player.playList([song]), "Reproduciendo " + song.title, fallbackNote(intent.platform, platform));
      }
      const rest = oncePerSong((await generateArtistMix(intent.query)).filter((t) => !longForm(t)));
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
      // "Vámonos de viaje" is a title, "Bailarina de Miranda" a title and an artist: the catalogues decide.
      if (!intent.exact && intent.said) return resolveRequest(intent.said, intent.platform, save, false, intent);
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
    case "request":
      return resolveRequest(intent.query, intent.platform, save, !!intent.strict);
    case "vibe": {
      // The catalogue knows moods far better than the library's few tags; tags are the offline backup.
      const fromCatalogue = await vibeFromCatalogue(intent.query);
      if (!fromCatalogue.startsWith("No encontré")) return fromCatalogue;
      const tracks = await db.tracks.toArray();
      if (!tracks.length) return fromCatalogue;
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
        return "No encontré música para «" + intent.query + "»";
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
      return "No te entendí. Prueba: «pon Bailarina de Miranda en Spotify», «pon el disco… de…», «la que sigue» o «¿qué canción es?»";
  }
}

/**
 * A mood or activity ("algo tranquilo para trabajar"): YouTube Music's playlists for it (its own
 * first), two of them mixed, with the artists you already listen to moved up and no repeats.
 */
async function vibeFromCatalogue(query: string) {
  if (!isNative) return "No encontré música para «" + query + "»";
  const lists = (await Auth.youtubePlaylists({ query }).catch(() => undefined))?.playlists ?? [];
  const pools = await Promise.all(lists.slice(0, 2).map((p) => Auth.youtubeCollection({ id: p.id.replace(/^VL/, "") }).then((c) => c.tracks ?? []).catch(() => [] as QueueItem[])));
  const songs = oncePerSong(interleaveTwo(pools[0] ?? [], pools[1] ?? []).filter((t) => !longForm(t)));
  if (!songs.length) return "No encontré música para «" + query + "»";
  const known = new Map<string, number>();
  for (const t of await db.tracks.toArray().catch(() => [] as QueueItem[])) {
    const a = normalize(lead(t.artist));
    known.set(a, (known.get(a) ?? 0) + (t.saved ? 2 : 1));
  }
  const ranked = songs
    .map((t, i) => ({ t, s: Math.min(3, known.get(normalize(lead(t.artist))) ?? 0) * 4 - i * 0.15 + Math.random() * 3 }))
    .sort((a, b) => b.s - a.s).map((x) => x.t).slice(0, 25);
  return playbackResult(() => player.playList(ranked), "Música " + query + (lists[0] ? " · " + lists[0].title : ""));
}

/**
 * Anything that sounds like music but has no fixed shape: asks both catalogues and keeps the song,
 * artist or album that best explains the words said (see requestResolver). If nothing explains them
 * well, plays the catalogue's own top hit, which already tolerates loose wording.
 */
async function resolveRequest(query: string, asked: Platform | undefined, save: (track: QueueItem) => Promise<void>,
  strict = false, hint?: { title: string; artist: string; query: string }): Promise<string> {
  const [spotify, youtube] = await Promise.allSettled([
    isNative ? Auth.spotifyRequest({ path: "/search?type=track,artist,album&limit=5&q=" + encodeURIComponent(query) }) : Promise.reject(new Error("web")),
    songsOn("youtube", query),
  ]);
  const data = spotify.status === "fulfilled" ? spotify.value.data : undefined;
  const spTracks: QueueItem[] = (data?.tracks?.items ?? []).filter(Boolean).map(spotifyTrack);
  const ytSongs = youtube.status === "fulfilled" ? youtube.value.slice(0, 6) : [];
  const candidates: Candidate[] = [
    ...spTracks.map((t): Candidate => ({ kind: "track", title: t.title, artist: t.artist, popularity: t.popularity, ref: t })),
    ...ytSongs.map((t): Candidate => ({ kind: "track", title: t.title, artist: t.artist, ref: t })),
    ...(data?.artists?.items ?? []).filter((a: { name?: string }) => a?.name)
      .map((a: { name: string; popularity?: number }): Candidate => ({ kind: "artist", name: a.name, popularity: a.popularity, ref: a.name })),
    ...(data?.albums?.items ?? []).filter((a: { name?: string }) => a?.name)
      .map((a: { name: string; artists?: { name: string }[] }): Candidate => ({ kind: "album", title: a.name, artist: (a.artists ?? []).map((x) => x.name).join(", "), ref: a })),
    // Without Spotify, YouTube's song artists are the artist candidates.
    ...(data ? [] : [...new Set(ytSongs.map((t) => lead(t.artist)))].map((name): Candidate => ({ kind: "artist", name, ref: name }))),
  ];
  const pick = interpret(candidates, query);
  if (pick?.kind === "artist") return run({ type: "artist", query: pick.ref as string, platform: asked }, save);
  if (pick?.kind === "album") return run({ type: "album", query: pick.title + " " + lead(pick.artist), title: pick.title, artist: lead(pick.artist), platform: asked }, save);
  if (pick?.kind === "track") {
    const t = pick.ref as QueueItem;
    if (!asked || t.source === asked) return playbackResult(() => player.playList([t]), "Reproduciendo " + t.title);
    return run({ type: "track", query: t.title + " " + lead(t.artist), title: t.title, artist: lead(t.artist), platform: asked, exact: true }, save);
  }
  // The grammar's own reading ("title de artist"), checked against each platform.
  if (hint) {
    const exact = await run({ type: "track", query: hint.query, title: hint.title, artist: hint.artist, platform: asked, exact: true }, save);
    if (!exact.startsWith("No encontré")) return exact;
  }
  if (strict) return "No te entendí «" + query + "». Prueba: «pon Bailarina de Miranda», «algo de Enjambre», «la que sigue»";
  // Nothing explains the words well: the top hit of the platform asked for (Spotify first otherwise).
  for (const platform of platformOrder(asked)) {
    const top = platform === "spotify" ? spTracks[0] : ytSongs[0];
    if (top) return playbackResult(() => player.playList([top]), "Reproduciendo " + top.title, fallbackNote(asked, platform));
  }
  return "No encontré «" + query + "» en Spotify ni en YouTube";
}

/** Tells the speech recognizer which names to expect: your most played artists and your playlists. */
export async function updateVoiceHints() {
  if (!isNative) return;
  const [tracks, playlists] = await Promise.all([db.tracks.toArray(), db.playlists.toArray()]);
  const count = new Map<string, number>();
  for (const t of tracks) { const a = lead(t.artist); if (a) count.set(a, (count.get(a) ?? 0) + (t.saved ? 3 : 1)); }
  const artists = [...count.entries()].sort((a, b) => b[1] - a[1]).map(([a]) => a).slice(0, 150);
  const lists = playlists.map((p) => p.title).filter((t) => t && t.length < 50).slice(0, 50);
  await Voice.setVoiceHints({ hints: [...artists, ...lists] }).catch(() => {});
}

/** Concerts, full albums and hour-long mixes: not what "pon a X" means. */
export const longForm = (t: QueueItem) =>
  t.duration > 12 * 60 || /\b(full (?:album|performance|concert|set)|album completo|concierto completo|live on kexp|en vivo desde|mix \d{4}|1 hour|1 hora)\b/i.test(t.title);

/** One artist's songs on one platform, matched by credited artist. */
async function artistSongs(name: string, platform: Platform): Promise<QueueItem[]> {
  if (!isNative) return [];
  let songs: QueueItem[] = [];
  if (platform === "spotify") {
    const found = await Auth.spotifyRequest({ path: "/search?type=track&limit=10&q=" + encodeURIComponent(`artist:"${name}"`) }).catch(() => undefined);
    songs = (found?.data?.tracks?.items ?? []).filter(Boolean).map(spotifyTrack);
  } else songs = await songsOn("youtube", name);
  return songs.filter((t) => !longForm(t) && creditedArtists(t.artist).some((a) => similarity(a, name) > 0.8));
}

function interleaveTwo<T>(a: T[], b: T[]) {
  const out: T[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) { if (a[i]) out.push(a[i]); if (b[i]) out.push(b[i]); }
  return out;
}
