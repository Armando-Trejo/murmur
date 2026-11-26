import { asksToPlay, misheardPlay, parseVoiceIntent, spokenContent, type Platform, type VoiceIntent } from "./VoiceIntentParser";

/** Intents that start music (as opposed to controlling what already plays). */
const MUSIC = new Set<VoiceIntent["type"]>(["track", "album", "artist", "vibe", "youtube", "request", "playlist", "top", "latest", "saved", "history"]);
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
import { albumTracks, fromSpotify, searchAlbums, SPOTIFY_ALBUM_PREFIX, type AlbumResult } from "./albumSearch";
import { creditedArtists } from "../components/ArtistProfile";
import { continuationPicks } from "./continuation";
import { magicPicks } from "./magicShuffle";
import { normalize } from "./FanUploadParser";
import { spotifyTrack } from "./DiscoveryEngine";
import type { QueueItem } from "./types";
import { phraseScore, songScore, tokens, type Tok } from "./voicePhonetics";
import {
  artistLine, byArtist, compareHits, correctQuery, hintNames, knowsArtist, librarySongsBy, loadVoiceLibrary, matchLibrary,
  titleVariants, type LibraryHit, type VoiceLibrary, type Want,
} from "./voiceLibrary";
import { offerVoiceChoices } from "./voiceChoices";
import { moodByKey, type Mood } from "./moods";
import { unlikeSong } from "./libraryEdit";
import { catalogueRank, exactName } from "./voiceCatalogue";

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
  const said = tokens(title);
  const by = artist ? tokens(artist) : [];
  for (const track of list) {
    // Spelling and sound: "jolidei in cambodia" is "Holiday in Cambodia".
    const t = Math.max(similarity(track.title, title), ...titleVariants(track.title).map((v) => phraseScore(said, tokens(v), 0.7)));
    const a = artist ? Math.max(similarity(lead(track.artist), artist), similarity(track.artist, artist), phraseScore(by, tokens(artistLine(track.artist)), 0.8)) : 0.8;
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

/**
 * How sure MURMUR must be. From the library, `library` plays without asking and below `libraryFloor`
 * it never plays (the library is only matched by sound); from a catalogue (which already found it
 * by these words), `sure` plays without asking and below `floor` nothing plays. In between it plays
 * the best and offers the others («¿No era esta?»). A misheard «pon» needs `misheard`.
 */
export const VOICE_CONFIDENCE = { library: 0.85, libraryFloor: 0.75, sure: 0.82, floor: 0.7, misheard: 0.85 } as const;
/** How sure an option is (without the small preference the library gets when ranking). */
const confidence = (o: Option) => o.score - (o.boost ?? 0);
const playable = (o: Option, strict: boolean) =>
  confidence(o) >= (strict ? VOICE_CONFIDENCE.misheard : o.from === "library" ? VOICE_CONFIDENCE.libraryFloor : VOICE_CONFIDENCE.floor);

/** What the log keeps about the choice, for tuning: which alternative, what, from where, how sure. */
interface Trace { alt?: number; pick?: string; from?: string; confidence?: number; choices?: number }
/** One recognizer alternative that names music. */
interface Alt { said: string; intent: VoiceIntent; index: number; asked: boolean }

export async function routeVoiceCommand(
  text: string,
  save: (track: QueueItem) => Promise<void> = saveTrack,
): Promise<string> {
  // The recognizer sends up to five alternatives, one per line, best first.
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
  const trace: Trace = {};
  let answer = "";
  try {
    // Only the wake phrase was caught ("okay murmuro"): MURMUR is listening, there is nothing to do yet.
    if (heard.length && heard.every((h) => !spokenContent(h))) return (answer = "Te escucho: dime qué pongo");
    if (MUSIC.has(intent.type)) {
      const alts: Alt[] = heard.flatMap((said, index) =>
        MUSIC.has(intents[index].type) ? [{ said, intent: intents[index], index, asked: asksToPlay(said) }] : []);
      const asked = alts.filter((a) => a.asked);
      if (!asked.length) {
        // «Pon» misheard as «don»/«con» ("Don Can you West"): played only when the rest clearly names music.
        const misheard = heard.flatMap((said, index): Alt[] => {
          const rest = misheardPlay(said);
          const i = rest ? parseVoiceIntent("pon " + rest, playlists) : undefined;
          return i && ["track", "request", "artist"].includes(i.type) ? [{ said: "pon " + rest, intent: i, index, asked: true }] : [];
        });
        const played = misheard.length ? await resolveMusic(misheard, trace, true) : undefined;
        if (played) return (answer = played);
        // Music without "pon", a wish or a platform is not played: it may be talk near the phone.
        return (answer = `Para poner música, di «pon» y lo que quieres escuchar. Escuché: «${heard[at]}»`);
      }
      // Every alternative that names music competes (those without the «pon», a little behind).
      return (answer = (await resolveMusic([...asked, ...alts.filter((a) => !a.asked)], trace)) ?? "No te entendí");
    }
    answer = await run(intent, save);
    return answer;
  } catch (error) {
    answer = "Error: " + (error as Error).message;
    throw error;
  } finally {
    void remember(text, JSON.stringify({ ...intent, ...trace }), answer).catch(() => {});
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
    case "unsave": {
      const now = player.current;
      if (!now) return "Primero reproduce una canción";
      await unlikeSong(now.id);
      return `Quité «${now.title}» de Guardadas`;
    }
    case "restart":
      if (!player.current) return "Primero elige una canción";
      await player.seek(0);
      if (!player.getSnapshot().playing) await player.toggle();
      return "Desde el principio";
    case "volume": {
      if (!isNative) return "El volumen se cambia en Android";
      const { percent } = await Voice.adjustVolume(
        typeof intent.change === "number" ? { percent: intent.change } : { direction: intent.change });
      return `Volumen al ${percent} %`;
    }
    case "surprise":
      return playSaved();
    case "save":
      if (player.current) {
        await save(player.current);
        return "Canción guardada";
      }
      return "Primero reproduce una canción";
    case "sleep": {
      // The app owns the timer (native call + the moon in the player); it listens for this event.
      if (typeof window !== "undefined")
        window.dispatchEvent(new CustomEvent("murmur:sleep", { detail: intent.minutes === "track" ? "track" : intent.minutes }));
      if (intent.minutes === "track") return "La música se apagará al terminar esta canción";
      if (intent.minutes === 0) return "Temporizador cancelado";
      const m = intent.minutes;
      const when = m % 60 === 0 ? (m === 60 ? "una hora" : `${m / 60} horas`) : m > 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} minutos`;
      return `La música se apagará en ${when}`;
    }
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
    case "artist":
      return playArtist(intent.query, intent.platform, intent.another);
    case "top":
      return playTop(intent.query, intent.platform);
    case "latest":
      return playLatest(intent.query, intent.platform);
    case "saved":
      return playSaved();
    case "history":
      return playHistory(intent.when);
    case "youtube": {
      const tracks = await searchAll(intent.query, "youtube");
      if (!tracks.length) return "No encontré ese video";
      return playbackResult(
        () => player.playList(tracks.slice(0, 1)),
        "Reproduciendo desde YouTube",
      );
    }
    case "track":
      if (!intent.exact) return (await resolveMusic([{ said: intent.said ?? intent.query, intent, index: 0, asked: true }], {})) ?? "No te entendí";
      return playExact(intent.title, intent.artist, intent.query, intent.platform);
    case "album":
    case "request":
      return (await resolveMusic([{ said: intent.query, intent, index: 0, asked: true }], {})) ?? "No te entendí";
    case "vibe": {
      // The catalogue knows moods far better than the library's few tags; tags are the offline backup.
      const fromCatalogue = await playVibeFromCatalogue(intent.query, intent.mood, intent.extra);
      if (!fromCatalogue.startsWith("No encontré")) return fromCatalogue;
      const tracks = (await db.tracks.toArray()).filter((t) => !t.deleted);
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
 * Returns the songs without playing them; also the last resort of the mix of the moment (momentMix.ts).
 */
export async function vibeFromCatalogue(query: string): Promise<{ tracks: QueueItem[]; list?: string }> {
  if (!isNative) return { tracks: [] };
  const lists = (await Auth.youtubePlaylists({ query }).catch(() => undefined))?.playlists ?? [];
  const pools = await Promise.all(lists.slice(0, 2).map((p) => Auth.youtubeCollection({ id: p.id.replace(/^VL/, "") }).then((c) => c.tracks ?? []).catch(() => [] as QueueItem[])));
  const songs = oncePerSong(interleaveTwo(pools[0] ?? [], pools[1] ?? []).filter((t) => !longForm(t)));
  if (!songs.length) return { tracks: [] };
  const known = new Map<string, number>();
  for (const t of await db.tracks.toArray().catch(() => [] as QueueItem[])) {
    const a = normalize(lead(t.artist));
    known.set(a, (known.get(a) ?? 0) + (t.saved ? 2 : 1));
  }
  const ranked = songs
    .map((t, i) => ({ t, s: Math.min(3, known.get(normalize(lead(t.artist))) ?? 0) * 4 - i * 0.15 + Math.random() * 3 }))
    .sort((a, b) => b.s - a.s).map((x) => x.t).slice(0, 25);
  return { tracks: ranked, list: lists[0]?.title };
}

/** The chips above the owner's Inicio, read once every few hours. */
let chipCache: { at: number; chips: { title: string; params: string }[] } | undefined;
async function moodChip(mood: Mood) {
  if (!chipCache || Date.now() - chipCache.at > 6 * 3_600_000 || !chipCache.chips.length)
    chipCache = { at: Date.now(), chips: (await Auth.youtubeHomeChips()).chips ?? [] };
  return chipCache.chips.find((c) => mood.chip.test(normalize(c.title)));
}

/**
 * A mood from the owner's own algorithm: YouTube Music's Inicio filtered by its chip for the mood
 * ("Triste", "Fiesta"…) is what YouTube picks for this person in that mood — their quick picks and
 * their mixes, not a generic playlist. Songs from those shelves first, then two of the personal mixes
 * there; the general catalogue only fills in when that falls short.
 */
export async function moodForYou(mood: Mood, extra = ""): Promise<{ tracks: QueueItem[]; list?: string }> {
  if (!isNative) return { tracks: [] };
  let mine: QueueItem[] = [];
  let list: string | undefined;
  const chip = extra ? undefined : await moodChip(mood).catch(() => undefined);
  if (chip) {
    const shelves = (await Auth.youtubeHome({ params: chip.params }).catch(() => undefined))?.shelves ?? [];
    const direct = shelves.flatMap((s) => s.items.flatMap((i) => (i.track ? [i.track] : [])));
    const mixes = shelves.flatMap((s) => s.items.filter((i) => !i.track && !i.artistId && i.link)).slice(0, 2);
    const pools = await Promise.all(mixes.map((m) => Auth.youtubeCollection({ id: m.id, personalized: true }).then((c) => c.tracks ?? []).catch(() => [] as QueueItem[])));
    mine = oncePerSong([...direct, ...interleaveTwo(pools[0] ?? [], pools[1] ?? [])].filter((t) => !longForm(t)));
    list = "tu " + chip.title + " de YouTube Music";
  }
  if (mine.length >= 15) {
    // Lightly shuffled so asking twice doesn't give the same order; the shelves' own order mostly kept.
    const tracks = mine.map((t, i) => ({ t, s: -i + Math.random() * 6 })).sort((a, b) => b.s - a.s).map((x) => x.t).slice(0, 30);
    return { tracks, list };
  }
  const general = await vibeFromCatalogue([mood.query, extra].filter(Boolean).join(" "));
  const used = new Set(mine.map(songKey));
  return { tracks: [...mine, ...general.tracks.filter((t) => !used.has(songKey(t)))].slice(0, 30), list: list ?? general.list };
}

async function playVibeFromCatalogue(query: string, moodKey?: string, extra = "") {
  const mood = moodByKey(moodKey);
  const { tracks, list } = mood ? await moodForYou(mood, extra) : await vibeFromCatalogue(query);
  if (!tracks.length) return "No encontré música para «" + query + "»";
  // Songs asked for by mood carry it: the presenter names it and the endless queue keeps it.
  const tagged = mood ? tracks.map((t) => ({ ...t, mood: mood.spoken, moodKey: mood.key, moodAsked: true })) : tracks;
  return playbackResult(() => player.playList(tagged), (mood ? "Poniendo " + mood.spoken : "Música " + query) + (list ? " · " + list : ""));
}

/**
 * The music words as they sound: like musicText, but a "gü" the recognizer wrote ("güin") keeps
 * its w sound, which plain normalizing would lose ("guin").
 */
function soundText(alt: Alt) {
  let text = musicText(alt.intent);
  for (const word of alt.said.toLowerCase().match(/\S*gü\S*/g) ?? []) {
    const plain = normalize(word);
    if (plain) text = text.replace(new RegExp(`(^| )${plain}(?= |$)`), "$1" + normalize(word.replace(/gü/g, "w")));
  }
  return text;
}

/** The music words of an alternative (no verbs, no platform). */
function musicText(intent: VoiceIntent) {
  switch (intent.type) {
    case "track": return intent.said ?? intent.query;
    case "request": case "artist": case "album": case "top": case "latest": return intent.query;
    default: return "";
  }
}
const platformOf = (intent: VoiceIntent) => ("platform" in intent ? intent.platform : undefined);
const distinct = (list: (string | undefined)[]) => [...new Set(list.filter((x): x is string => !!x && !!x.trim()).map((x) => x.trim()))];

/**
 * Music asked for by voice. The owner's library is matched first, by sound (what the owner means);
 * the catalogues only when it is not sure. Every recognizer alternative is scored and the best
 * interpretation wins. Below VOICE_CONFIDENCE.floor nothing plays: the closest options are offered.
 * `strict` (a misheard «pon»): only a sure match plays, and nothing is offered otherwise.
 */
async function resolveMusic(alts: Alt[], trace: Trace, strict = false): Promise<string | undefined> {
  const first = alts[0].intent;
  const platform = platformOf(first);
  // Said this way before and corrected with a tap («¿No era esta?»): what the owner chose then.
  if (!strict && ["track", "request", "album", "artist"].includes(first.type)) {
    const known = await learnedOption(alts).catch(() => undefined);
    if (known) {
      Object.assign(trace, { alt: known.alt, pick: `${known.kind}: ${known.label}`, from: "learned", confidence: 1 });
      return playOption(known, platform);
    }
  }
  switch (first.type) {
    case "artist":
    case "top":
    case "latest": {
      const same = alts.filter((a) => a.intent.type === first.type);
      const named = await canonicalArtist(distinct(same.map(soundText)), distinct(same.map((a) => musicText(a.intent))));
      if (strict && named.score < VOICE_CONFIDENCE.misheard) return undefined;
      Object.assign(trace, { pick: "artist: " + named.name, from: named.from, confidence: round(named.score) });
      if (first.type === "top") return playTop(named.name, platform);
      if (first.type === "latest") return playLatest(named.name, platform);
      return playArtist(named.name, platform, first.type === "artist" && first.another);
    }
    case "album":
      if (strict) return undefined;
      return resolveNamed(alts.filter((a) => a.intent.type === "album"), "album", platform, trace, false);
    case "track":
    case "request":
      return resolveNamed(alts.filter((a) => a.intent.type === "track" || a.intent.type === "request"), "any", platform, trace, strict);
    default:
      if (strict) return undefined;
      return run(first, saveTrack);
  }
}

/** A possible meaning of what was said, from the library or a catalogue. */
interface Option {
  kind: LibraryHit["kind"];
  /** Confidence 0..1 (with the small library, plays and popularity bonuses). */
  score: number;
  base: number;
  from: "library" | "spotify" | "youtube";
  /** Index of the recognizer alternative that explains it. */
  alt: number;
  label: string;
  key: string;
  /** Preference added for ranking only (the library's), not part of the confidence. */
  boost?: number;
  /** The song itself, or one by the artist / on the album (its cover in the choices). */
  track?: QueueItem;
  name?: string;
  album?: { title: string; artist: string; playlistId?: string; result?: AlbumResult; tracks?: QueueItem[]; artworkUrl?: string };
  playlistId?: string;
}
const round = (n: number) => Math.round(n * 100) / 100;
const sortOptions = (options: Option[], songFirst = false) => options.sort((a, b) => compareHits(a, b, songFirst));

function fromLibrary(hit: LibraryHit, alt: number, behind: number, lib: VoiceLibrary): Option {
  const o = { score: hit.score - behind, base: hit.base - behind, from: "library" as const, alt, label: hit.label, key: hit.key };
  switch (hit.kind) {
    case "track": return { ...o, kind: "track", track: hit.track };
    case "artist": return { ...o, kind: "artist", name: hit.name, track: librarySongsBy(lib, hit.name)[0] };
    case "album": return { ...o, kind: "album", album: { title: hit.title, artist: hit.artist, playlistId: hit.playlistId, tracks: hit.tracks, artworkUrl: hit.artworkUrl }, track: hit.tracks[0] };
    case "playlist": return { ...o, kind: "playlist", playlistId: hit.id };
  }
}

/** Songs, artists or albums named by the alternatives: library first, then the catalogues. */
async function resolveNamed(alts: Alt[], want: Want, platform: Platform | undefined, trace: Trace, strict: boolean): Promise<string | undefined> {
  const lib = await loadVoiceLibrary();
  const songFirst = alts.some((a) => a.intent.type === "request" && a.intent.want === "song");
  const options: Option[] = [];
  alts.forEach((a, n) => {
    const wanted: Want = a.intent.type === "request" && a.intent.want === "song" ? "song" : want;
    // Later alternatives, and those where no «pon» was heard, a little behind.
    const behind = (a.asked ? 0 : 0.03) + n * 0.005;
    for (const hit of matchLibrary(lib, soundText(a), wanted)) options.push(fromLibrary(hit, a.index, behind, lib));
  });
  sortOptions(options, songFirst);
  const ctx = { alts, platform, trace, strict, songFirst };
  if (options[0] && options[0].score >= VOICE_CONFIDENCE.library) return decide(once(options), ctx);
  // Not sure from the library: the catalogues, with what was said, the library's spelling of it and the best library guess.
  const said = musicText(alts[0].intent);
  const guess = options[0] && options[0].score >= 0.65 ? (options[0].kind === "artist" ? options[0].name : options[0].kind === "album" ? `${options[0].album!.title} ${options[0].album!.artist}` : options[0].kind === "track" ? `${options[0].track!.title} ${lead(options[0].track!.artist)}` : undefined) : undefined;
  // "X de Y" with Y an artist the owner knows: the search is narrowed to them, other artists' X fall behind.
  const split = alts[0].intent.type === "track" ? alts[0].intent : undefined;
  const knownBy = split ? matchLibrary(lib, split.artist, "artist", 1)[0] : undefined;
  const artist = knownBy?.kind === "artist" && knownBy.score >= VOICE_CONFIDENCE.library ? knownBy.name : undefined;
  const queries = distinct([
    musicText(alts[0].intent),
    split && artist ? `${split.title} ${artist}` : undefined,
    ...alts.slice(1, 3).map((a) => musicText(a.intent)),
    split ? split.query : undefined,
    correctQuery(lib, said),
    guess,
  ]).slice(0, 4);
  // "La canción X": only songs.
  const found = await catalogueOptions(queries, alts, songFirst && want === "any" ? "song" : want, lib, platform, strict, artist);
  // What the library knows stays a little ahead: it is what the owner listens to.
  return decide(once(sortOptions([...options.map((o) => ({ ...o, score: o.score + 0.03, base: o.base + 0.03, boost: 0.03 })), ...found], songFirst)), ctx);
}

/** One option per song, artist, album or playlist (the best scored). */
function once(options: Option[]) {
  const seen = new Set<string>();
  return options.filter((o) => !seen.has(o.key) && !!seen.add(o.key));
}

/** What the catalogues answer for the queries, scored against every alternative. */
async function catalogueOptions(queries: string[], alts: Alt[], want: Want, lib: VoiceLibrary, platform: Platform | undefined, strict: boolean, artist?: string): Promise<Option[]> {
  const saids = alts.map((a) => ({ toks: tokens(soundText(a)), alt: a.index, behind: a.asked ? 0 : 0.03, raw: normalize(musicText(a.intent)) }));
  const best = (score: (toks: Tok[]) => number) => {
    let top = { score: 0, alt: saids[0]?.alt ?? 0 };
    for (const s of saids) { const v = score(s.toks) - s.behind; if (v > top.score) top = { score: v, alt: s.alt }; }
    return top;
  };
  const out: Option[] = [];
  if (want === "album") {
    const albums = (await Promise.all(queries.slice(0, 3).map((q) => searchAlbums(q).then((r) => r.albums).catch(() => [] as AlbumResult[])))).flat();
    const seen = new Set<string>();
    for (const album of albums) {
      if (seen.has(album.feedId)) continue;
      seen.add(album.feedId);
      const known = knowsArtist(lib, album.artist);
      const title = tokens(titleVariants(album.title)[0]);
      let { score, alt } = best((t) => songScore(t, title, tokens(lead(album.artist))));
      const artistHeard = best((t) => songScore(t, title, tokens(lead(album.artist)))).score > best((t) => phraseScore(t, title, 0.7)).score + 0.02;
      if (known) score += 0.04;
      else if (!artistHeard && title.length <= 1) score = Math.min(score, 0.58);
      if (album.source === (platform ?? "spotify")) score += 0.02;
      out.push({ kind: "album", score: Math.min(1, score), base: score, from: album.source, alt, label: `${album.title} · ${album.artist}`, key: "l:" + normalize(album.title) + "|" + normalize(lead(album.artist)), album: { title: album.title, artist: album.artist, result: album, artworkUrl: album.artworkUrl } });
    }
    return out;
  }
  const results = await Promise.all(queries.map(async (q) => {
    const [spotify, youtube] = await Promise.allSettled([
      isNative ? Auth.spotifyRequest({ path: "/search?type=track,artist,album&limit=5&q=" + encodeURIComponent(q) }) : Promise.reject(new Error("web")),
      songsOn("youtube", q),
    ]);
    return { data: spotify.status === "fulfilled" ? spotify.value.data : undefined, youtube: youtube.status === "fulfilled" ? youtube.value.slice(0, 6) : [] as QueueItem[] };
  }));
  const tracks = new Map<string, QueueItem>();
  const artists = new Map<string, { name: string; popularity?: number; source: "spotify" | "youtube" }>();
  const albums = new Map<string, AlbumResult>();
  for (const { data, youtube } of results) {
    // Spotify stopped sending popularity: its search order says what is well known.
    const found = ((data?.tracks?.items ?? []).filter(Boolean).map(spotifyTrack) as QueueItem[])
      .map((t, i) => ({ ...t, popularity: t.popularity ?? catalogueRank(i) }));
    for (const t of [...found, ...youtube]) if (!tracks.has(t.id)) tracks.set(t.id, t);
    for (const [i, a] of ((data?.artists?.items ?? []) as { name?: string; popularity?: number }[]).entries()) {
      if (!a?.name) continue;
      const popularity = a.popularity ?? catalogueRank(i);
      const seen = artists.get(normalize(a.name));
      if (!seen || (seen.popularity ?? 0) < popularity) artists.set(normalize(a.name), { name: a.name, popularity, source: "spotify" });
    }
    for (const al of fromSpotify(data?.albums?.items ?? [])) albums.set(al.feedId, al);
    // Without Spotify, YouTube's song artists are the artist candidates (popular when several songs are theirs).
    if (!data)
      for (const name of new Set(youtube.map((t) => lead(t.artist))))
        if (!artists.has(normalize(name))) artists.set(normalize(name), { name, popularity: youtube.filter((t) => lead(t.artist) === name).length >= 2 ? 50 : 20, source: "youtube" });
  }
  for (const a of want === "song" ? [] : artists.values()) {
    const toks = tokens(a.name);
    let { score, alt } = best((t) => phraseScore(t, toks, 0.75));
    // The very name that was said ("AC DC", "Muse", "Queen") is no guess, however short it is.
    const exact = saids.find((s) => exactName(s.raw, a.name));
    if (exact) {
      score = Math.max(score, 0.97 - exact.behind) + (a.popularity ?? 0) / 5000;
      alt = exact.alt;
    }
    if (knowsArtist(lib, a.name)) score += 0.04;
    // Not the name that was said, short and not clearly popular: a guess ("ac dc" → "CatDog"), so
    // it is offered among the choices instead of playing on its own.
    else if (!exact && toks.reduce((n, t) => n + t.key.length, 0) <= 7 && (a.popularity ?? 0) < 70) score = Math.min(score, 0.58);
    if (strict && score < 0.88) continue;
    const sample = [...tracks.values()].find((t) => byArtist(t, a.name));
    out.push({ kind: "artist", score: Math.min(1, score), base: score, from: a.source, alt, label: a.name, key: "a:" + tokens(a.name).map((t) => t.key).join(" "), name: a.name, track: sample });
  }
  if (strict) return out;
  for (const t of tracks.values()) {
    if (longForm(t)) continue;
    const by = tokens(artistLine(t.artist));
    let top = { score: 0, alt: 0 };
    let artistHeard = false;
    let words = 99;
    for (const variant of titleVariants(t.title)) {
      const title = tokens(variant);
      const withArtist = best((s) => songScore(s, title, by));
      if (withArtist.score > top.score) {
        top = withArtist;
        artistHeard = withArtist.score > best((s) => phraseScore(s, title, 0.7)).score + 0.02;
        words = title.length;
      }
    }
    let score = top.score;
    const known = knowsArtist(lib, t.artist);
    if (known) score += artistHeard ? 0.03 : 0.05;
    // A title alone, by someone the owner does not listen to, is never sure (the options are offered);
    // a one-word one is only a fair guess when it is a hit.
    else if (!artistHeard) score = Math.min(score, words > 1 ? 0.8 : (t.popularity ?? 0) >= 70 ? 0.75 : 0.58);
    if (unwanted.test(normalize(t.title)) && !saids.some((s) => unwanted.test(s.raw))) score -= 0.15;
    if (artist && !byArtist(t, artist)) score -= 0.1;
    score += ((t.popularity ?? 0) / 100) * 0.02 + (t.source === platform ? 0.02 : 0);
    out.push({ kind: "track", score: Math.min(1, score), base: score, from: t.source, alt: top.alt, label: `${t.title} · ${t.artist}`, key: "t:" + songKey(t), track: t });
  }
  for (const album of want === "song" ? [] : albums.values()) {
    const title = tokens(titleVariants(album.title)[0]);
    let { score, alt } = best((s) => songScore(s, title, tokens(lead(album.artist))));
    // An album named like a song is the song: albums stay just behind.
    score -= 0.03;
    if (title.length <= 1 && !knowsArtist(lib, album.artist)) score = Math.min(score, 0.58);
    out.push({ kind: "album", score, base: score, from: "spotify", alt, label: `${album.title} · ${album.artist}`, key: "l:" + normalize(album.title) + "|" + normalize(lead(album.artist)), album: { title: album.title, artist: album.artist, result: album, artworkUrl: album.artworkUrl } });
  }
  return out;
}

const KIND_LABEL: Record<Option["kind"], string> = { track: "Canción", artist: "Artista", album: "Álbum", playlist: "Playlist" };
/** How an option looks among the choices: a song is itself; the rest, a stand-in with their name and cover. */
function choiceItem(o: Option): QueueItem {
  if (o.kind === "track" && o.track) return o.track;
  const cover = o.track ?? o.album?.tracks?.[0];
  return {
    id: "voice:" + o.key, source: cover?.source ?? "youtube", videoId: cover?.videoId, duration: 0, tags: [],
    title: o.kind === "artist" ? o.name! : o.kind === "album" ? o.album!.title : o.label,
    artist: o.kind === "artist" ? "Artista" : o.kind === "album" ? "Álbum · " + o.album!.artist : "Playlist",
    artworkUrl: o.album?.artworkUrl ?? cover?.artworkUrl,
  };
}
/** The songs one option stands for. */
async function songsFor(o: Option, platform?: Platform): Promise<QueueItem[]> {
  switch (o.kind) {
    case "track": return o.track ? [o.track] : [];
    case "artist": return (await artistMix(o.name!, platform)).list;
    case "album": return (await albumSongs(o.album!, platform)).list;
    case "playlist": {
      const p = await db.playlists.get(o.playlistId!);
      return p ? playlistTracks(p) : [];
    }
  }
}
function offer(heard: string, options: Option[], played: boolean, platform: Platform | undefined, trace: Trace, alts: Alt[] = []) {
  const picks = options.slice(0, 3);
  if (!picks.length) return;
  trace.choices = picks.length;
  offerVoiceChoices({
    heard, played,
    choices: picks.map(choiceItem),
    kinds: picks.map((o) => KIND_LABEL[o.kind]),
    expand: (i) => songsFor(picks[i], platform),
    // The tap teaches MURMUR what these words meant: next time they play it directly.
    chosen: (i) => void learnChoice(alts.map((a) => musicText(a.intent)), picks[i]).then(() => updateVoiceHints()).catch(() => {}),
  });
}

/** Words → what the owner picked for them among the choices, so the same words play it next time. */
const LEARNED_KEY = "voice:learned";
interface Learned { option: Option; at: number }
async function learned(): Promise<Record<string, Learned>> {
  return ((await db.settings.get(LEARNED_KEY).catch(() => undefined))?.value as Record<string, Learned> | undefined) ?? {};
}
/** Remembers the choice for every way the recognizer wrote the request (the 120 latest kept). */
export async function learnChoice(phrases: string[], option: Option) {
  const keys = distinct(phrases.map(normalize)).filter((k) => k.length >= 2);
  if (!keys.length) return;
  const all = await learned();
  // A plain copy (no functions, no huge album pages) that survives the database.
  const plain = JSON.parse(JSON.stringify({ ...option, album: option.album ? { ...option.album, result: undefined } : undefined })) as Option;
  for (const key of keys) all[key] = { option: plain, at: Date.now() };
  const kept = Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, 120);
  await db.settings.put({ key: LEARNED_KEY, value: Object.fromEntries(kept) });
}
/** The learned choice for what was said, as a sure option of the alternative that said it. */
async function learnedOption(alts: Alt[]): Promise<Option | undefined> {
  const all = await learned();
  for (const a of alts) {
    const hit = all[normalize(musicText(a.intent))];
    if (hit) return { ...hit.option, alt: a.index, score: 1, base: 1, boost: 0 };
  }
  return undefined;
}
/** Names the owner taught by choosing them: the recognizer should expect them first. */
async function learnedNames() {
  return Object.values(await learned()).map((l) => l.option.kind === "track" && l.option.track ? l.option.track.title : l.option.kind === "artist" ? l.option.name : l.option.album?.title ?? l.option.label)
    .filter((n): n is string => !!n);
}

/** Plays the best option if it is good enough, and offers the close ones («¿No era esta?»). */
async function decide(options: Option[], ctx: { alts: Alt[]; platform?: Platform; trace: Trace; strict: boolean }): Promise<string | undefined> {
  const best = options.find((o) => playable(o, ctx.strict));
  const top = best ?? options[0];
  const heardAs = (o?: Option) => ctx.alts.find((a) => a.index === o?.alt)?.said ?? ctx.alts[0].said;
  const query = musicText(ctx.alts.find((a) => a.index === top?.alt)?.intent ?? ctx.alts[0].intent);
  if (top) Object.assign(ctx.trace, { alt: top.alt, pick: `${top.kind}: ${top.label}`, from: top.from, confidence: round(confidence(top)) });
  if (!best) {
    if (ctx.strict) return undefined;
    // Not sure enough to play anything: the closest options, one tap away.
    const close = options.filter((o) => o.score >= 0.35);
    offer(ctx.alts[0].said, close, false, ctx.platform, ctx.trace, ctx.alts);
    if (top) ctx.trace.pick = "none (" + ctx.trace.pick + ")";
    return close.length ? `No estoy seguro de qué es «${query}». ¿Es alguna de estas?` : `No encontré «${query}» en tu música, Spotify ni YouTube`;
  }
  const answer = await playOption(best, ctx.platform);
  const rest = options.filter((o) => o !== best && o.score >= 0.45);
  const unsure = confidence(best) < (best.from === "library" ? VOICE_CONFIDENCE.library : VOICE_CONFIDENCE.sure);
  if (rest.length && (unsure || confidence(rest[0]) >= confidence(best) - 0.04)) offer(heardAs(best), rest, true, ctx.platform, ctx.trace, ctx.alts);
  return answer;
}

async function playOption(o: Option, platform?: Platform): Promise<string> {
  switch (o.kind) {
    case "track": {
      const t = o.track!;
      // Asked on the other platform: the same song there, if it is.
      if (platform && t.source !== platform) return playExact(titleVariants(t.title).at(-1)!, lead(t.artist), `${titleVariants(t.title).at(-1)} ${lead(t.artist)}`, platform, t);
      return playbackResult(() => player.playList([t]), "Reproduciendo " + t.title);
    }
    case "artist":
      return playArtist(o.name!, platform);
    case "album": {
      const { list, note, title } = await albumSongs(o.album!, platform);
      if (!list.length) return "No pude abrir el álbum «" + o.album!.title + "»";
      return playbackResult(() => player.playList(list), "Álbum " + title, note);
    }
    case "playlist":
      return run({ type: "playlist", id: o.playlistId! }, saveTrack);
  }
}

/** A song by title and artist on the platform asked for (the other one as a fallback). */
async function playExact(title: string, artist: string, query: string, platform?: Platform, fallback?: QueueItem): Promise<string> {
  for (const p of platformOrder(platform)) {
    const song = bestSong(await songsOn(p, query), title, artist);
    if (song) return playbackResult(() => player.playList([song]), "Reproduciendo " + song.title, fallbackNote(platform, p));
  }
  if (fallback) return playbackResult(() => player.playList([fallback]), "Reproduciendo " + fallback.title, platform ? fallbackNote(platform, fallback.source) : "");
  return "No encontré esa canción en Spotify ni en YouTube";
}

/** An album's songs: the saved one, the catalogue's (on the platform asked for first), or the library's songs from it. */
async function albumSongs(album: NonNullable<Option["album"]>, platform?: Platform): Promise<{ list: QueueItem[]; note: string; title: string }> {
  if (album.playlistId) {
    const p = await db.playlists.get(album.playlistId).catch(() => undefined);
    const list = p ? await playlistTracks(p) : album.tracks ?? [];
    if (list.length) return { list, note: "", title: album.title };
  }
  if (album.result) {
    const list = await albumTracks(album.result).catch(() => [] as QueueItem[]);
    if (list.length) return { list, note: fallbackNote(platform, album.result.source), title: album.result.title };
  }
  // Known only from the library's songs: the whole album from a catalogue.
  const { albums } = await searchAlbums(`${album.title} ${lead(album.artist)}`).catch(() => ({ albums: [] as AlbumResult[] }));
  const title = tokens(album.title);
  const artist = tokens(lead(album.artist));
  const ranked = albums
    .map((a) => ({ a, s: songScore([...title, ...artist], tokens(titleVariants(a.title)[0]), tokens(lead(a.artist))) + (a.source === (platform ?? "spotify") ? 0.02 : 0) }))
    .filter((x) => x.s >= 0.8)
    .sort((x, y) => y.s - x.s);
  for (const { a } of ranked.slice(0, 2)) {
    const list = await albumTracks(a).catch(() => [] as QueueItem[]);
    if (list.length) return { list, note: fallbackNote(platform, a.source), title: a.title };
  }
  return { list: album.tracks ?? [], note: "", title: album.title };
}

/**
 * The artist's name as the library (or Spotify) spells it: "de misfits" → "The Misfits",
 * "king caesars and the leaser weaser" → "King Gizzard & The Lizard Wizard". `score` says how sure.
 */
async function canonicalArtist(sounds: string[], queries = sounds): Promise<{ name: string; score: number; from: string }> {
  let best: { name: string; score: number; from: string } | undefined;
  const lib = await loadVoiceLibrary().catch(() => undefined);
  if (lib)
    for (const q of sounds) {
      const hit = matchLibrary(lib, q, "artist", 1)[0];
      if (hit?.kind === "artist" && (!best || hit.score > best.score)) best = { name: hit.name, score: hit.score, from: "library" };
    }
  // Only a near-certain library name skips the catalogue: one that merely sounds alike must not win
  // over the artist that was actually named.
  if (best && best.score >= 0.93) return best;
  if (isNative) {
    const found = await Promise.all(queries.slice(0, 2).map((q) =>
      Auth.spotifyRequest({ path: "/search?type=artist&limit=5&q=" + encodeURIComponent(q) }).then((r) => (r.data?.artists?.items ?? []) as { name?: string }[]).catch(() => [])));
    found.forEach((items, i) => {
      for (const a of items) {
        if (!a?.name) continue;
        const score = exactName(queries[i], a.name) ? 1 : phraseScore(tokens(queries[i]), tokens(a.name), 0.75);
        // The library keeps a small advantage: it is what the owner listens to.
        if (score >= 0.8 && (!best || score > best.score + (best.from === "library" ? 0.03 : 0))) best = { name: a.name, score, from: "spotify" };
      }
    });
    if (best && best.score >= 0.8) return best;
  }
  return { name: queries[0] ?? "", score: best?.score ?? 0, from: "said" };
}

function shuffled<T>(list: T[]) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

/**
 * "Pon X": a mix of the artist's songs (official audio, not concerts or full-album videos), the
 * owner's favourites by them between the catalogue's; never two versions of the same song.
 * Spotify's catalogue and YouTube Music's song search, the platform asked for first; without one, both.
 */
async function artistMix(name: string, platform?: Platform, another = false): Promise<{ list: QueueItem[]; note: string; single?: boolean }> {
  const lib = await loadVoiceLibrary().catch(() => undefined);
  const mine = (lib ? librarySongsBy(lib, name) : []).filter((t) => !longForm(t) && (!platform || t.source === platform));
  const [fromSpotify, fromYouTube] = await Promise.all([artistSongs(name, "spotify"), artistSongs(name, "youtube")]);
  const on = { spotify: fromSpotify, youtube: fromYouTube };
  let catalogue: QueueItem[] = [];
  let note = "";
  if (!platform) catalogue = oncePerSong(interleaveTwo(fromSpotify, fromYouTube));
  else for (const p of platformOrder(platform)) if (oncePerSong(on[p]).length >= 3) { catalogue = oncePerSong(on[p]); note = fallbackNote(platform, p); break; }
  if (catalogue.length < 3 && !mine.length) {
    // Maybe it was a song's title, not an artist.
    for (const p of platformOrder(platform)) {
      const song = bestSong(await songsOn(p, name), name);
      if (song) return { list: [song], note: fallbackNote(platform, p), single: true };
    }
    catalogue = oncePerSong((await generateArtistMix(name).catch(() => [] as QueueItem[])).filter((t) => !longForm(t) && byArtist(t, name)));
  }
  // Favourites (the 15 most played by them) in a new order each time, between the catalogue's songs.
  let list = oncePerSong(interleaveTwo(shuffled(mine.slice(0, 15)), catalogue));
  const now = player.current;
  if (another && now) list = list.filter((t) => t.id !== now.id && songKey(t) !== songKey(now));
  return { list: list.slice(0, 30), note };
}

async function playArtist(name: string, platform?: Platform, another = false): Promise<string> {
  const { list, note, single } = await artistMix(name, platform, another);
  if (!list.length) return "No encontré ese artista ni esa canción";
  if (single) return playbackResult(() => player.playList(list), "Reproduciendo " + list[0].title, note);
  const shown = list.some((t) => byArtist(t, name)) ? name : lead(list[0].artist);
  return playbackResult(() => player.playList(list), (another ? "Otra de " : "Mix de ") + shown, note);
}

const songShelf = /^(?:canciones|songs|top songs|populares|lo más popular)/i;
/** "Las mejores de X": their most popular songs, in order. */
async function topSongs(name: string, platform?: Platform): Promise<{ list: QueueItem[]; note: string }> {
  const fromSpotify = async () => (await artistSongs(name, "spotify")).sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
  const fromYouTube = async () => {
    if (!isNative) return [];
    const page = await Auth.youtubeArtist({ name }).catch(() => undefined);
    if (!page || phraseScore(tokens(name), tokens(page.name), 0.75) < 0.8) return [];
    const shelf = page.shelves.find((s) => songShelf.test(s.title) && s.items.some((i) => i.track));
    return (shelf?.items ?? []).flatMap((i) => (i.track ? [i.track] : []));
  };
  for (const p of platformOrder(platform)) {
    const list = oncePerSong((await (p === "spotify" ? fromSpotify() : fromYouTube())).filter((t) => !longForm(t)));
    if (list.length >= 3) return { list: list.slice(0, 20), note: fallbackNote(platform, p) };
  }
  // Offline or unknown to the catalogues: the owner's most played by them.
  const lib = await loadVoiceLibrary().catch(() => undefined);
  return { list: lib ? librarySongsBy(lib, name).filter((t) => !longForm(t)).slice(0, 20) : [], note: "" };
}
async function playTop(name: string, platform?: Platform): Promise<string> {
  const { list, note } = await topSongs(name, platform);
  if (!list.length) return playArtist(name, platform);
  return playbackResult(() => player.playList(list), "Lo mejor de " + name, note);
}

/** "Lo nuevo de X": their latest album or single (Spotify's release dates, or YouTube Music's artist page). */
async function latestRelease(name: string, platform?: Platform): Promise<{ title: string; list: QueueItem[]; source: Platform } | undefined> {
  if (!isNative) return undefined;
  const fromSpotify = async () => {
    const found = await Auth.spotifyRequest({ path: "/search?type=artist&limit=3&q=" + encodeURIComponent(name) }).catch(() => undefined);
    const artist = ((found?.data?.artists?.items ?? []) as { id?: string; name?: string }[]).find((a) => a?.id && a.name && phraseScore(tokens(name), tokens(a.name), 0.75) >= 0.8);
    if (!artist) return undefined;
    const albums = await Auth.spotifyRequest({ path: `/artists/${artist.id}/albums?include_groups=album,single&limit=10` }).catch(() => undefined);
    const latest = ((albums?.data?.items ?? []) as { id?: string; name?: string; release_date?: string }[])
      .filter((a) => a?.id && a.release_date)
      .sort((a, b) => b.release_date!.localeCompare(a.release_date!))[0];
    if (!latest) return undefined;
    const list = await albumTracks({ feedId: SPOTIFY_ALBUM_PREFIX + latest.id, source: "spotify" }).catch(() => [] as QueueItem[]);
    return list.length ? { title: latest.name ?? "", list } : undefined;
  };
  const fromYouTube = async () => {
    const page = await Auth.youtubeArtist({ name }).catch(() => undefined);
    if (!page || phraseScore(tokens(name), tokens(page.name), 0.75) < 0.8) return undefined;
    const releases = page.shelves.filter((s) => /(?:album|álbum|single|sencillo|\bep\b)/i.test(s.title)).flatMap((s) => s.items).filter((i) => /^MPREb/.test(i.id));
    const year = (subtitle?: string) => Number(subtitle?.match(/\b(?:19|20)\d{2}\b/)?.[0] ?? 0);
    const latest = [...releases].sort((a, b) => year(b.subtitle) - year(a.subtitle))[0];
    if (!latest) return undefined;
    const list = await albumTracks({ feedId: latest.id, source: "youtube" }).catch(() => [] as QueueItem[]);
    return list.length ? { title: latest.title, list } : undefined;
  };
  for (const p of platformOrder(platform)) {
    const found = await (p === "spotify" ? fromSpotify() : fromYouTube());
    if (found) return { ...found, source: p };
  }
  return undefined;
}
async function playLatest(name: string, platform?: Platform): Promise<string> {
  const latest = await latestRelease(name, platform);
  if (!latest) return playTop(name, platform);
  return playbackResult(() => player.playList(latest.list), `Lo más nuevo de ${name}: «${latest.title}»`, fallbackNote(platform, latest.source));
}

/** "Mis favoritas": the saved songs, shuffled. */
async function playSaved(): Promise<string> {
  const saved = (await db.tracks.toArray()).filter((t) => t.saved && !longForm(t));
  if (!saved.length) return "Aún no tienes canciones guardadas";
  return playbackResult(() => player.playList(shuffled(saved).slice(0, 100)), "Tus guardadas en aleatorio");
}

/** "Lo que escuché ayer": the songs that played then (half a minute or more), in the order they played. */
async function playHistory(when: "yesterday" | "today" | "recent"): Promise<string> {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const [from, to] = when === "yesterday" ? [today - 86_400_000, today] : when === "today" ? [today, Date.now()] : [Date.now() - 86_400_000, Date.now()];
  const entries = await db.history.where("at").between(from, to, true, false).toArray().catch(() => []);
  const ids = [...new Set(entries.filter((e) => e.seconds >= 30).sort((a, b) => a.at - b.at).map((e) => e.trackId))];
  const found: (QueueItem | undefined)[] = await db.tracks.bulkGet(ids.slice(-60)).catch(() => []);
  const list = found.filter((t): t is QueueItem => !!t);
  if (!list.length) return when === "yesterday" ? "No encontré lo que escuchaste ayer" : "No encontré lo que estabas escuchando";
  return playbackResult(() => player.playList(list), when === "yesterday" ? "Lo que escuchaste ayer" : "Lo que estabas escuchando");
}

/**
 * Tells the speech recognizer which names to expect (up to 470): the artists listened to most, the
 * saved and most played songs, the albums and the playlists.
 */
export async function updateVoiceHints() {
  if (!isNative) return;
  const names = hintNames(await loadVoiceLibrary());
  const taught = await learnedNames().catch(() => [] as string[]);
  const hints = [...new Set([...taught, ...names.artists, ...names.songs, ...names.albums, ...names.playlists])].slice(0, 470);
  await Voice.setVoiceHints({ hints }).catch(() => {});
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
  return songs.filter((t) => !longForm(t) && (creditedArtists(t.artist).some((a) => similarity(a, name) > 0.8) || byArtist(t, name)));
}

function interleaveTwo<T>(a: T[], b: T[]) {
  const out: T[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) { if (a[i]) out.push(a[i]); if (b[i]) out.push(b[i]); }
  return out;
}
